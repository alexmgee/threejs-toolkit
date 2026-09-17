import * as THREE from "three/webgpu";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { GaussianSplatMesh } from "../vendor/three-gs/GaussianSplatMesh.js";
import {
  SH_BAND_WORDS,
  SH_DEGREE_TO_COMPONENTS,
  createGaussianSplatGeometryFromPLYGeometry,
  getGaussianSplatPLYPropertyMapping,
} from "../vendor/three-gs/GaussianSplatUtils.js";
import {
  assertStorageWithinLimit,
  maxStorageBindingBytes,
} from "../vendor/three-gs/patches/capacity-guard.js";
import {
  ForkPatchError,
  disposeGaussianSplatMesh,
} from "../vendor/three-gs/patches/dispose.js";
import { createPagedMesh, type PagedMesh } from "../vendor/three-gs/patches/paged.js";
import {
  SORT_DIRECTION_THRESHOLD,
  SORT_POSITION_THRESHOLD,
  installSelectionSort,
} from "../vendor/three-gs/patches/selection.js";
import { DECODE_POOL_SIZE, DecodeFailedError } from "./DecodePool.js";
import { LodTraversal, type LodTuning, type TraverseResult } from "./LodTraversal.js";
import { PagePool, indexOrder, type ChunkPriority } from "./PagePool.js";
import { RadPager } from "./RadPager.js";
import type { ChunkUnavailable } from "./RadFetcher.js";
import type { RadHeaderInfo } from "./RadHeader.js";
import type { DecodeResult } from "./rad-worker.js";
import {
  HANDLE_BRAND,
  SplatBackendError,
  formatFromName,
  type LoadProgress,
  type SdfEdit,
  type SplatBackend,
  type SplatCounts,
  type SplatFormat,
  type SplatHandle,
  type SplatHit,
  type SplatOptics,
  type SplatSource,
} from "./SplatBackend.js";

interface HandleState {
  readonly group: THREE.Group;
  progress: LoadProgress;
  readonly whenReady: Promise<void>;
  resolveReady: () => void;
  rejectReady: (error: SplatBackendError) => void;
  bounds: THREE.Box3;
  total: number;
  boundsReady: boolean;
  failure: SplatBackendError | null;
  disposed: boolean;
  /** The splat mesh, held directly — handle.object is the PUBLIC group and
   *  consumers may parent helpers into it, so children[0] is not the mesh
   *  by contract (review finding). */
  mesh: GaussianSplatMesh | null;
  /** Aborts the in-flight fetch on dispose — without it a cancelled load
   *  keeps downloading the whole body (review finding). */
  readonly abort: AbortController;
  /** The paged (.rad) path's state; null on the monolithic path. */
  paged: PagedState | null;
  /** The load request's observers (ticket 08 ruling S3). */
  readonly onProgress: SplatSource["onProgress"];
  readonly onFailure: SplatSource["onFailure"];
}

/** ADR 0003 decision 2: pages = min(P_limits, P_asset, override). */
export interface PageBudget {
  readonly pages: number;
  readonly pLimits: number;
  readonly pAsset: number;
  readonly override: number | null;
  /** Human-readable derivation — which term bound, with the limit values. */
  readonly source: string;
  readonly backend: "webgpu" | "webgl2-fallback";
}

interface PagedState {
  /** The asset URL — names the asset in shortfall warnings. */
  readonly url: string;
  readonly pager: RadPager;
  readonly header: RadHeaderInfo;
  readonly budget: PageBudget;
  readonly pool: PagePool;
  readonly paged: PagedMesh;
  /** Chunks the admission gate deferred (fetched + cached, not decoded). */
  readonly deferred: number[];
  readonly unavailable: ChunkUnavailable[];
  /** Admitted chunks the pool refused a slot (defensive — see insertPage). */
  readonly refused: number[];
  /** Chunks given up on (fetch/decode), by index — admitChunk refuses them
   *  by name rather than retrying a deterministic failure (S3). */
  readonly unavailableSet: Set<number>;
  loadSettled: boolean;
  /** Splats carried by first uploads — the ready / no-pages gates use THIS,
   *  not the page count: a chunk declaring count 0 uploads nothing visible
   *  (adversarial review, 2026-09-03). */
  uploadedSplats: number;
  /** Ticket 07 — LOD traversal, selection, culling. */
  readonly lod: LodDriver;
}

/** ADR 0003 / owner ruling 07-S2: the projected-size threshold is derived
 *  from the camera each traversal; this scale (default 1, the null value)
 *  is ticket 13's knob. */
export interface LodOptions extends Partial<LodTuning> {
  lodRenderScale?: number;
}

/** The traversal's ORDER is the ChunkPriority swap point (06-S2): before the
 *  first traversal the static index order stands (chunk 0 = the tree root
 *  must land first anyway); after it, the last traversal's wanted order. */
class TraversalPriority implements ChunkPriority {
  private wanted: readonly number[] = [];
  constructor(private readonly fallback: ChunkPriority) {}
  set(wanted: readonly number[]): void {
    this.wanted = wanted;
  }
  order(): readonly number[] {
    return this.wanted.length > 0 ? this.wanted : this.fallback.order();
  }
}

interface LodDriver {
  readonly traversal: LodTraversal;
  readonly priority: TraversalPriority;
  lodRenderScale: number;
  /** Set by residency changes / tuning changes; the next render traverses. */
  dirty: boolean;
  traversals: number;
  lastTraversalMs: number;
  lastResult: TraverseResult | null;
  /** Camera pose in MESH-OBJECT space at the last traversal — 07-S5 hysteresis. */
  readonly lastPosition: THREE.Vector3;
  readonly lastDirection: THREE.Vector3;
  lastPixelScaleLimit: number;
  /** In-flight admissions (wanted-but-missing cached chunks re-decoding),
   *  ONE promise per chunk shared by the driver and the diagnostics door —
   *  a second admit of the same chunk awaits the first instead of racing
   *  it for bytes that already left the cache (caught live, 2026-09-12). */
  readonly admitting: Map<number, Promise<boolean>>;
  /** Selection off = every resident splat drawn (the 06 behaviour; the
   *  fixture's "features off" control). */
  selectionEnabled: boolean;
  /** Renders skipped because three frustum-culled the mesh cannot be
   *  counted from inside (no onBeforeRender); this counts renders that
   *  DID run, for the culling-off equality drill. */
  rendersWithTraversalHook: number;
}

/** Ticket 12 (§G diagnostics) owns the final shape; this is the pager's
 *  public counter door so nothing ever needs to monkey-patch it. Not part
 *  of the seam interface (doc 02's method set is fixed). The numeric
 *  fields are a SNAPSHOT taken by the call — call `pagerDiagnostics` again
 *  for fresh values; the functions act on the live pager. */
export interface PagerDiagnostics {
  readonly budget: PageBudget;
  readonly pageSize: number;
  readonly capacity: number;
  readonly residentPages: number;
  readonly residentSplats: number;
  readonly firstUploaded: number;
  readonly deferred: readonly number[];
  readonly unavailable: readonly ChunkUnavailable[];
  readonly refused: readonly number[];
  readonly partialUploadBroken: boolean;
  /** See PagedMesh.uploadPath: "partial" (WebGPU), "pbo-texture" (WebGL2
   *  fallback, by design), "full-fallback" (broken partial path). */
  readonly uploadPath: "partial" | "pbo-texture" | "full-fallback";
  readonly rangesPushed: number;
  readonly rangesConsumed: number;
  readonly pboUploads: number;
  readonly renders: number;
  readonly cachedBytes: number;
  readonly loadSettled: boolean;
  /** The three completed-work ratios behind `progress().fraction`. */
  readonly progressTerms: { bytes: number; decoded: number; uploaded: number };
  isResident(chunk: number): boolean;
  /** Raw bytes held for a later admission (false while resident-and-mid-
   *  decode, or never landed). */
  isCached(chunk: number): boolean;
  slotOf(chunk: number): number;
  /** Explicit eviction: the slot is zeroed on the GPU and freed. */
  evictChunk(chunk: number): boolean;
  /** Re-decode from cached bytes and upload (admission after deferral or
   *  eviction). Resolves false when the pool refuses a slot. */
  admitChunk(chunk: number): Promise<boolean>;
  readonly mesh: GaussianSplatMesh;
  /** Ticket 07 — LOD / selection / culling counters and controls. */
  readonly lod: {
    readonly selectedCount: number;
    readonly drawCount: number;
    readonly fullQuality: boolean;
    readonly traversals: number;
    readonly lastTraversalMs: number;
    readonly wantedChunks: readonly number[];
    readonly changedSlotsLast: number;
    readonly stats: TraverseResult["stats"] | null;
    readonly tuning: Readonly<LodTuning>;
    readonly lodRenderScale: number;
    readonly selectionEnabled: boolean;
    readonly cullingEnabled: boolean;
    readonly admitting: number;
    readonly admittingChunks: readonly number[];
    /** Change the render-scale knob (07-S2); marks the traversal dirty. */
    setLodRenderScale(scale: number): void;
    /** Selection off draws every resident splat (the ticket-06 behaviour). */
    setSelectionEnabled(enabled: boolean): void;
    /** Frustum culling on/off (mesh.frustumCulled from the pager AABB sphere). */
    setCullingEnabled(enabled: boolean): void;
    /** Force a traversal on the next render (fixture drills). */
    markDirty(): void;
  };
}

export interface ThreeGsBackendOptions {
  renderer?: unknown;
  /** TEST-ONLY seam (owner ruling 2026-08-29): overrides the queried
   *  device limit so the over-capacity refusal is drillable at fixture
   *  scale. Never set in production code. */
  maxStorageBufferBindingSizeOverride?: number;
  /** Decode-worker factory for the paged .rad path (ticket 06). The
   *  backend never imports the worker itself (inline-worker boundary
   *  rules): the embed passes decode.ts's inline factory, pages a
   *  URL-constructed one. Required for .rad — refused by name otherwise. */
  createDecodeWorker?: () => Worker;
  /** ADR 0003's `?pages=N` measurement regime: caps the page budget
   *  (pages = min(P_limits, P_asset, override)). Never below 1. */
  pageBudgetOverride?: number;
  /** TEST-ONLY seam (owner ruling 05-S5 precedent): injected fetch for the
   *  paged path's fixtures. Never set in production code. */
  fetchImpl?: typeof fetch;
  /** Ticket 07: LOD tuning (Spark's defaults as starting values — owner
   *  rulings 07-S3/S4) and the render-scale knob (07-S2). */
  lod?: LodOptions;
}

const handles = new WeakMap<SplatHandle, HandleState>();

// Scratch objects for the per-render LOD driver (no allocation per frame).
const _size = new THREE.Vector2();
const _cameraPosition = new THREE.Vector3();
const _cameraDirection = new THREE.Vector3();
const _worldToObject = new THREE.Matrix4();
const _camToObject = new THREE.Matrix4();
const _allFlags = new Uint8Array(65536);

function inferFormat(source: SplatSource): SplatFormat {
  if (source.format !== undefined) return source.format;
  const format = formatFromName(source.url);
  if (format !== undefined) return format;
  throw new SplatBackendError(
    "unknown-format",
    `cannot infer format from url "${source.url}"`,
  );
}

function requireHandle(handle: SplatHandle, method: string): HandleState {
  const state = handles.get(handle);
  if (state === undefined || handle[HANDLE_BRAND] !== true) {
    throw new SplatBackendError(
      "unknown-handle",
      `${method} received an unknown handle`,
    );
  }
  return state;
}

/**
 * Record a terminal failure on the handle: phase → "failed" (fraction
 * frozen), whenReady rejected with the named error. Does NOT throw — the
 * pipeline `return`s after calling it, so a failure can never escape as an
 * unhandled rejection of the fire-and-forget pipeline promise
 * (adversarial-review finding, 2026-08-29).
 */
function fail(state: HandleState, reason: string, message: string): void {
  if (state.failure !== null) return;
  const error = new SplatBackendError(reason, message);
  state.failure = error;
  setProgress(state, {
    ...state.progress,
    phase: "failed",
  });
  state.rejectReady(error);
  // Ticket 08 ruling S2/S3: the one terminal-failure site announces itself.
  // Before this, a whole-load failure AFTER first paint only flipped the
  // phase above — whenReady had already resolved, so nothing heard it.
  notifyObserver(state.onFailure, error);
}

/** Observer calls are isolated (ruling S3): a consumer bug must neither
 *  fail the load under a misleading reason nor make fail() throw. */
function notifyObserver<T>(observer: ((value: T) => void) | undefined, value: T): void {
  if (observer === undefined) return;
  try {
    observer(value);
  } catch (error) {
    reportError(error);
  }
}

/** Every LoadProgress refresh goes through here, so the request's
 *  `onProgress` observer sees exactly what `progress()` would return. */
function setProgress(state: HandleState, progress: LoadProgress): void {
  state.progress = progress;
  notifyObserver(state.onProgress, { ...progress });
}

/** PLY headers are ASCII and live at the front of the file — decode a
 *  bounded prefix, never the whole (possibly multi-hundred-MB) buffer
 *  (review finding: a full-file TextDecode is a file-sized transient
 *  string at the load path's memory peak). */
const HEADER_SCAN_LIMIT = 65536;

function readPlyHeader(buffer: ArrayBuffer): string {
  const prefix = new Uint8Array(
    buffer,
    0,
    Math.min(buffer.byteLength, HEADER_SCAN_LIMIT),
  );
  const text = new TextDecoder().decode(prefix);
  // CRLF headers are valid to PLYLoader itself (end_header(\r\n|\r|\n),
  // PLYLoader.js:148) — refusing them here would reject files the parser
  // we delegate to accepts (review finding).
  const marker = /end_header\r?\n/.exec(text);
  if (marker === null) {
    throw new SplatBackendError(
      "invalid-ply-header",
      `PLY header missing end_header in the first ${HEADER_SCAN_LIMIT} bytes`,
    );
  }
  return text.slice(0, marker.index);
}

/** INRIA 3DGS properties the pipeline needs. PLYLoader fills a MAPPED but
 *  ABSENT property with undefined→NaN at full length (PLYLoader.js:648-656),
 *  so an ordinary mesh PLY would otherwise convert "successfully" into an
 *  invisible NaN mesh and report ready — the silent blank the named-refusal
 *  design forbids (review finding). Validate against the header instead. */
const REQUIRED_SPLAT_PROPERTIES = [
  "x", "y", "z",
  "scale_0", "scale_1", "scale_2",
  "rot_0", "rot_1", "rot_2", "rot_3",
  "f_dc_0", "f_dc_1", "f_dc_2",
  "opacity",
];

function validateSplatPlyHeader(header: string): void {
  const declared = new Set(
    header
      .split(/\r?\n/)
      .filter((line) => line.startsWith("property "))
      .map((line) => line.trim().split(/\s+/).pop() ?? ""),
  );
  for (const prop of REQUIRED_SPLAT_PROPERTIES) {
    if (!declared.has(prop)) {
      throw new SplatBackendError(
        "not-splat-ply",
        `PLY is not a 3DGS splat file — required property "${prop}" missing from header`,
      );
    }
  }
}

function parseVertexCount(header: string): number {
  // Line-anchored: an unanchored regex would match "element vertex N"
  // inside a comment line and mis-size the capacity guard (review finding).
  for (const line of header.split(/\r?\n/)) {
    const match = /^element vertex (\d+)\s*$/.exec(line.trim());
    if (match !== null) return Number(match[1]);
  }
  throw new SplatBackendError(
    "invalid-ply-header",
    "PLY header missing element vertex count",
  );
}

function detectSphericalHarmonicsDegree(header: string): number {
  const restCount = header
    .split(/\r?\n/)
    .filter((line) => line.startsWith("property float f_rest_")).length;
  const degree = SH_DEGREE_TO_COMPONENTS.indexOf(restCount);
  if (degree === -1) {
    throw new SplatBackendError(
      "unsupported-sh-degree",
      `unsupported f_rest property count ${restCount} in PLY header`,
    );
  }
  return degree;
}

function computePositionBounds(geometry: THREE.BufferGeometry): THREE.Box3 {
  const position = geometry.getAttribute("position");
  if (position === undefined) {
    throw new SplatBackendError(
      "ply-missing-position",
      "PLY geometry has no position attribute",
    );
  }
  return new THREE.Box3().setFromBufferAttribute(
    position as THREE.BufferAttribute,
  );
}

function updateFetchProgress(
  state: HandleState,
  bytesLoaded: number,
  declaredTotal: number,
): void {
  // content-length is the COMPRESSED size when the server encodes the
  // response, while the stream reader counts decompressed bytes — report a
  // total that can never sit below bytesLoaded so LoadProgress never
  // self-contradicts (review finding). The fraction clamp is the same
  // lying-content-length defense, documented on LoadProgress.
  const bytesTotal =
    declaredTotal > 0 ? Math.max(declaredTotal, bytesLoaded) : 0;
  const fraction =
    bytesTotal > 0 ? Math.min(1, bytesLoaded / bytesTotal) : 0;
  setProgress(state, {
    bytesLoaded,
    bytesTotal,
    phase: "fetching",
    fraction,
  });
}

/** "chunk N (reason, K attempts)" — the one wording of a given-up chunk in
 *  both shortfall warnings. */
function describeUnavailable(u: ChunkUnavailable): string {
  return `chunk ${u.index} (${u.reason}, ${u.attempts} attempt${u.attempts === 1 ? "" : "s"})`;
}

/** three's PBO texture layout (GLSLNodeBuilder setupPBO, verified in
 *  0.185.1): width = 2^ceil(log2(sqrt(n))), height = ceil(n / width), +1 when
 *  width*height*itemSize < elements. Returns [width, height]. */
function pboTextureSize(n: number, itemSize: number): [number, number] {
  const width = Math.pow(2, Math.ceil(Math.log2(Math.sqrt(n))));
  let height = Math.ceil(n / width);
  if (width * height * itemSize < n * itemSize) height++;
  return [width, height];
}

/** Largest page count whose PBO textures fit MAX_TEXTURE_SIZE: vec4 storage
 *  attrs (n = N splats, itemSize 4) and, at SH degree ≥ 1, the SH1 word
 *  attr (n = N × SH_BAND_WORDS[1], itemSize 1). ADR 0003 decision 2. */
function webglPageLimit(maxTextureSize: number, maxPages: number, pageSize: number, shDegree: number): number {
  for (let p = maxPages; p >= 1; p--) {
    const n = p * pageSize;
    const [w4, h4] = pboTextureSize(n, 4);
    let fits = w4 <= maxTextureSize && h4 <= maxTextureSize;
    if (fits && shDegree >= 1) {
      const [w1, h1] = pboTextureSize(n * SH_BAND_WORDS[1]!, 1);
      fits = w1 <= maxTextureSize && h1 <= maxTextureSize;
    }
    if (fits) return p;
  }
  return 0;
}

/**
 * Monolithic PLY backend over vendored GaussianSplatMesh (ticket 03).
 * Paged .rad backend as of ticket 06 (RadPager + PagePool + [paged] patch).
 * dispose() is real as of ticket 04; remaining refusal stubs: raycast,
 * setEdits, setMeshColor, setOptics, and non-PLY formats.
 */
export class ThreeGsBackend implements SplatBackend {
  private readonly renderer: unknown;
  private readonly maxStorageBufferBindingSizeOverride: number | undefined;
  private readonly createDecodeWorker: (() => Worker) | undefined;
  private readonly pageBudgetOverride: number | undefined;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly lodOptions: LodOptions;

  constructor(options: ThreeGsBackendOptions = {}) {
    this.renderer = options.renderer;
    this.maxStorageBufferBindingSizeOverride =
      options.maxStorageBufferBindingSizeOverride;
    this.createDecodeWorker = options.createDecodeWorker;
    this.pageBudgetOverride = options.pageBudgetOverride;
    this.fetchImpl = options.fetchImpl;
    this.lodOptions = options.lod ?? {};
  }

  load(source: SplatSource): SplatHandle {
    const format = inferFormat(source);
    if (format === "spz") {
      throw new SplatBackendError(
        "spz-refused",
        "SPZ refused — three 0.185.1 ships no SPZLoader (doc 06 watch item 13, r186)",
      );
    }
    if (format === "splat") {
      throw new SplatBackendError(
        "splat-refused",
        "splat format refused — ticket 08 monolithic follow-up not landed",
      );
    }
    if (format === "rad") {
      if (this.createDecodeWorker === undefined) {
        throw new SplatBackendError(
          "rad-needs-worker-factory",
          "rad needs ThreeGsBackendOptions.createDecodeWorker — the backend never imports the decode worker itself",
        );
      }
      if (this.renderer === undefined || this.renderer === null) {
        throw new SplatBackendError(
          "rad-needs-renderer",
          "rad needs the renderer — the page budget derives from the created device's limits (ADR 0003)",
        );
      }
    }
    // Exhaustiveness: when SplatFormat grows, this line makes the compiler
    // flag the new format instead of letting it fall through into a
    // pipeline and die at runtime on garbage (review finding).
    format satisfies "ply" | "rad";

    const group = new THREE.Group();
    let resolveReady!: () => void;
    let rejectReady!: (error: SplatBackendError) => void;
    const whenReady = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    const state: HandleState = {
      group,
      progress: {
        bytesLoaded: 0,
        bytesTotal: 0,
        phase: "fetching",
        fraction: 0,
      },
      whenReady,
      resolveReady,
      rejectReady,
      bounds: new THREE.Box3(),
      total: 0,
      boundsReady: false,
      failure: null,
      disposed: false,
      mesh: null,
      abort: new AbortController(),
      paged: null,
      onProgress: source.onProgress,
      onFailure: source.onFailure,
    };
    // A failure that lands before any consumer calls whenReady() must not
    // fire the browser's unhandledrejection — later whenReady() callers
    // still receive the rejection (a caught promise stays rejected).
    whenReady.catch(() => {});

    const handle = {
      object: group,
      [HANDLE_BRAND]: true as const,
    };
    handles.set(handle, state);
    if (format === "rad") {
      void this.runRadPipeline(source.url, state);
    } else {
      void this.runPlyPipeline(source.url, state);
    }
    return handle;
  }

  // ───────────────────────── paged .rad path (ticket 06) ─────────────────────────

  /**
   * ADR 0003 decision 2, exactly: pages = min(P_limits, P_asset, override).
   * P_limits on WebGPU = the largest page count whose LARGEST storage
   * binding (ticket-04 capacity guard — the single limit check) fits
   * min(maxStorageBufferBindingSize, maxBufferSize); on the WebGL2 fallback
   * (storage attributes live in PBO textures) = the largest page count whose
   * PBO textures fit MAX_TEXTURE_SIZE under three's own layout
   * (GLSLNodeBuilder setupPBO: width = 2^ceil(log2(sqrt(n))), height =
   * ceil(n/width), n = elements/itemSize — vec4 attrs n = N, the SH1 word
   * attr n = 3N). The "device memory class" term is UNPINNED (owner ruling
   * 06-S1): its debt is mobile-class measurement, not a divisor guess.
   */
  private derivePageBudget(header: RadHeaderInfo, shDegree: number): PageBudget {
    const pageSize = header.chunkSize;
    const pAsset = header.chunks.length;
    const backend = (this.renderer as { backend?: Record<string, unknown> }).backend;
    let pLimits: number;
    let limitsNote: string;
    let backendName: PageBudget["backend"];
    if (backend?.isWebGLBackend === true) {
      backendName = "webgl2-fallback";
      const gl = backend.gl as WebGL2RenderingContext | undefined;
      if (gl === undefined || typeof gl.getParameter !== "function") {
        throw new SplatBackendError("rad-needs-renderer", "WebGL2 backend exposes no gl context for MAX_TEXTURE_SIZE");
      }
      const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
      pLimits = webglPageLimit(maxTex, pAsset, pageSize, shDegree);
      limitsNote = `MAX_TEXTURE_SIZE ${maxTex}`;
    } else {
      backendName = "webgpu";
      const limits = (backend?.device as { limits?: Record<string, number> } | undefined)?.limits;
      const bind = this.maxStorageBufferBindingSizeOverride ?? limits?.maxStorageBufferBindingSize;
      const buf = this.maxStorageBufferBindingSizeOverride ?? limits?.maxBufferSize;
      if (typeof bind !== "number" || typeof buf !== "number") {
        throw new SplatBackendError("rad-needs-renderer", "WebGPU device limits unavailable — was the renderer initialized?");
      }
      const limit = Math.min(bind, buf);
      pLimits = 0;
      for (let p = pAsset; p >= 1; p--) {
        if (maxStorageBindingBytes(p * pageSize, shDegree) <= limit) {
          pLimits = p;
          break;
        }
      }
      limitsNote = `bind ${(bind / 2 ** 20).toFixed(0)} MiB / buf ${(buf / 2 ** 20).toFixed(0)} MiB`;
    }
    const override = this.pageBudgetOverride ?? null;
    if (override !== null && (!Number.isInteger(override) || override < 1)) {
      throw new SplatBackendError("invalid-page-override", `pageBudgetOverride must be a positive integer, got ${override}`);
    }
    const pages = Math.min(override ?? Number.MAX_SAFE_INTEGER, pLimits, pAsset);
    if (pages < 1) {
      throw new SplatBackendError(
        "over-capacity",
        `not even one ${pageSize}-splat page fits the device (${limitsNote}, SH degree ${shDegree})`,
      );
    }
    const source =
      override !== null && pages === override
        ? `override (${override})`
        : pages === pLimits
          ? `device limit (${limitsNote})`
          : `asset (${pAsset} chunks; device allows ${pLimits} — ${limitsNote})`;
    return { pages, pLimits, pAsset, override, source, backend: backendName };
  }

  private async runRadPipeline(url: string, state: HandleState): Promise<void> {
    const createWorker = this.createDecodeWorker!;
    const pager = new RadPager(url, {
      createWorker,
      signal: state.abort.signal,
      ...(this.fetchImpl !== undefined ? { fetchImpl: this.fetchImpl } : {}),
    });
    let paged: PagedState | null = null;
    try {
      const report = await pager.load({
        onHeader: (header) => {
          const shDegree = header.maxSh;
          const budget = this.derivePageBudget(header, shDegree);
          const pageSize = header.chunkSize;
          const capacity = budget.pages * pageSize;
          // Same pre-check the monolithic path runs (on WebGPU the budget
          // already fits by construction; on WebGL2 there is no limit to
          // check — allocation failure is caught and named below).
          const limit = this.maxStorageBufferBindingSizeOverride ??
            (this.renderer as { backend?: { device?: { limits?: { maxStorageBufferBindingSize?: number } } } })
              ?.backend?.device?.limits?.maxStorageBufferBindingSize;
          if (typeof limit === "number") assertStorageWithinLimit(capacity, shDegree, limit);
          // ChunkPriority is the swap point (06-S2): the traversal's order
          // object goes straight into PagePool; before the first traversal
          // it answers with the static index order.
          const priority = new TraversalPriority(indexOrder(header.chunks.length));
          const pool = new PagePool({
            chunkCount: header.chunks.length,
            pageCount: budget.pages,
            pageSize,
            priority,
          });
          pool.refreshPriority();
          let pagedMesh: PagedMesh;
          try {
            pagedMesh = createPagedMesh(capacity, pageSize, shDegree);
          } catch (error) {
            if (error instanceof RangeError) {
              throw new SplatBackendError("over-capacity", `allocation failed — ${error.message}`);
            }
            throw error;
          }
          const { lodRenderScale, ...tuning } = this.lodOptions;
          if (lodRenderScale !== undefined && !(lodRenderScale > 0)) {
            throw new SplatBackendError("lod-tuning", `lodRenderScale must be > 0, got ${lodRenderScale}`);
          }
          const traversal = new LodTraversal(
            { pageCount: budget.pages, chunkCount: header.chunks.length, slotOf: (chunk) => pool.slotOf(chunk) },
            pageSize,
            tuning,
          );
          // Fork patch 2: selection-aware sort (07-S1) — before the first render.
          installSelectionSort(pagedMesh.mesh);
          // Frustum culling through public API: three tests the draw
          // geometry's bounding sphere, which setBounds keeps over the
          // resident pages' AABB union (doc 03 §F).
          pagedMesh.mesh.frustumCulled = true;
          pagedMesh.setDrawCount(0);
          paged = {
            url,
            pager,
            header,
            budget,
            pool,
            paged: pagedMesh,
            deferred: [],
            unavailable: [],
            refused: [],
            unavailableSet: new Set<number>(),
            loadSettled: false,
            uploadedSplats: 0,
            lod: {
              traversal,
              priority,
              lodRenderScale: lodRenderScale ?? 1,
              dirty: true,
              traversals: 0,
              lastTraversalMs: 0,
              lastResult: null,
              lastPosition: new THREE.Vector3(Infinity, Infinity, Infinity),
              lastDirection: new THREE.Vector3(0, 0, -1),
              lastPixelScaleLimit: 0,
              admitting: new Map<number, Promise<boolean>>(),
              selectionEnabled: true,
              rendersWithTraversalHook: 0,
            },
          };
          state.paged = paged;
          state.total = header.count;
          state.mesh = pagedMesh.mesh;
          state.group.add(pagedMesh.mesh);
          // Ready = the first paint AFTER the first page upload (a mesh with
          // no pages paints empty — that paint must not count).
          pagedMesh.afterRender = () => {
            if (state.progress.phase === "ready" || state.failure !== null) return;
            if (paged === null || paged.uploadedSplats === 0) return;
            this.updatePagedProgress(state, "ready");
            state.resolveReady();
          };
          pagedMesh.beforeRender = (renderer, camera) => {
            if (paged === null || state.disposed || state.failure !== null) return;
            this.driveLod(state, paged, renderer, camera);
          };
          this.updatePagedProgress(state, "constructing");
        },
        admit: (index) => paged !== null && paged.pool.isAdmissible(index),
        onDeferred: (index) => {
          paged?.deferred.push(index);
        },
        onUnavailable: (given) => {
          if (paged === null) return;
          this.markUnavailable(state, paged, given);
        },
        onChunk: (result) => {
          // A failed handle (fail() never sets disposed) must not keep
          // uploading — built-in review, 2026-09-03.
          if (paged === null || state.disposed || state.failure !== null) return;
          this.insertPage(state, paged, result);
        },
      });
      if (this.checkDisposed(state)) return;
      if (paged === null) {
        fail(state, "rad-pipeline-failed", "pager resolved without a header hook");
        return;
      }
      const settled: PagedState = paged;
      settled.loadSettled = true;
      this.updatePagedProgress(state, state.progress.phase === "ready" ? "ready" : "constructing");
      // Owner ruling 06-S6: zero pages ever uploaded = the silent blank the
      // seam forbids — fail by name. Partial shortfall stays ready with
      // truthful counts/progress.
      if (settled.uploadedSplats === 0) {
        fail(
          state,
          "no-pages-available",
          `no splat could be uploaded — ${settled.pool.firstUploadedCount} pages uploaded (all empty), ${report.unavailable.length} unavailable, ${report.deferred.length} deferred of ${report.header.chunks.length}`,
        );
      } else if (state.failure === null && settled.unavailable.length > 0) {
        // Owner ruling 08-S2: a partial shortfall reveals normally, with
        // truthful counts and ONE console warning — printed here because the
        // backend is the only layer holding the unavailable list.
        const given = settled.unavailable.map(describeUnavailable).join(", ");
        console.warn(
          `[ThreeGsBackend] "${url}" settled with ${settled.unavailable.length} of ${report.header.chunks.length} chunks unavailable — ${given}`,
        );
      }
    } catch (error) {
      if (error instanceof SplatBackendError) {
        if (state.disposed && error.reason === "fetch-aborted") {
          this.checkDisposed(state);
          return;
        }
        fail(state, error.reason, error.message);
        return;
      }
      if (error instanceof ForkPatchError) {
        fail(state, error.reason, error.message);
        return;
      }
      if (state.disposed && error instanceof DOMException && error.name === "AbortError") {
        this.checkDisposed(state);
        return;
      }
      const detail = error instanceof Error ? error.message : String(error);
      fail(state, "rad-pipeline-failed", `rad pipeline failed — ${detail}`);
    }
  }

  /** PagePool.insert + upload + invalidate + progress, for both the initial
   *  load and later admissions. */
  private insertPage(state: HandleState, paged: PagedState, result: DecodeResult): boolean {
    const chunk = Math.floor(result.base / paged.header.chunkSize);
    if (result.base % paged.header.chunkSize !== 0 || chunk !== result.index) {
      // The format permits chunks[] order and payload base to disagree; the
      // hero is base-contiguous. Fail loudly rather than upload to the
      // wrong slot (spike assertion carried over).
      fail(state, "rad-chunk-order-mismatch", `chunks[${result.index}] has base ${result.base} (page size ${paged.header.chunkSize})`);
      return false;
    }
    const firstUploadsBefore = paged.pool.firstUploadedCount;
    const { slot, evicted } = paged.pool.insert(chunk, result.count, result.center);
    if (slot === -1) {
      // Defensive: with the admission gate a protected missing chunk always
      // has a slot (pigeonhole); record if it ever happens.
      paged.refused.push(chunk);
      return false;
    }
    if (paged.pool.firstUploadedCount > firstUploadsBefore) paged.uploadedSplats += result.count;
    try {
      paged.paged.uploadPage(slot, result);
      paged.lod.traversal.setPage(slot, result);
    } catch (error) {
      if (error instanceof ForkPatchError) {
        fail(state, error.reason, error.message);
        return false;
      }
      throw error;
    }
    this.residencyChanged(state, paged);
    this.updatePagedProgress(state, state.progress.phase === "ready" ? "ready" : "constructing");
    return true;
  }

  /** After any residency change: bounds (seam + the sort's depth sphere)
   *  and the explicit sort/SH invalidation (doc 03 §A4) — ONE place, used
   *  by inserts and evictions alike. */
  private residencyChanged(state: HandleState, paged: PagedState): void {
    const bounds = paged.pool.residentBounds();
    if (bounds === null) {
      // Nothing resident (possible after evictions): the seam's bounds()
      // refuses by name and the sort sphere collapses to the origin rather
      // than lingering over the last evicted page.
      state.boundsReady = false;
      paged.paged.setBounds([0, 0, 0], [0, 0, 0]);
    } else {
      state.bounds.min.set(bounds.min[0], bounds.min[1], bounds.min[2]);
      state.bounds.max.set(bounds.max[0], bounds.max[1], bounds.max[2]);
      state.boundsReady = true;
      // The seam's bounds() are the CENTER bounds (doc 03 §E contract). The
      // CULLING sphere must also cover splat FOOTPRINTS: the vendored
      // fragment kernel discards at r² > 4, i.e. a footprint radius of 2σ
      // (GaussianSplatMesh.js:740) — inflate by 2 × the largest resident
      // scale so a center just outside the frustum whose footprint overlaps
      // it is never culled away (adversarial review, 2026-09-12: culling
      // must change cost, never content).
      const margin = 2 * paged.lod.traversal.maxResidentScale();
      paged.paged.setBounds(
        [bounds.min[0] - margin, bounds.min[1] - margin, bounds.min[2] - margin],
        [bounds.max[0] + margin, bounds.max[1] + margin, bounds.max[2] + margin],
      );
    }
    paged.paged.invalidate();
    // Residency changed → the frontier must be re-derived at the next
    // render (ticket 07); until then the new page stays deselected (w = 0
    // from the upload) so nothing pops in unsorted.
    paged.lod.dirty = true;
  }

  // ───────────────────────── ticket 07: LOD driver ─────────────────────────

  /**
   * Runs in the paged mesh's onBeforeRender, BEFORE the vendored sort/SH
   * updates. Re-traverses when residency/tuning changed or the camera moved
   * past the vendored sort's own motion thresholds (owner ruling 07-S5:
   * mirrored constants, no new numbers), writes changed pages' selection
   * lanes, sets the draw count, hands the wanted order to the pool
   * (ChunkPriority swap point), kicks admission of wanted-but-missing cached
   * chunks, and invalidates sort + SH (selection-change invalidation joins
   * 06's two). With selection disabled every resident splat is selected.
   */
  private driveLod(state: HandleState, paged: PagedState, renderer: unknown, cameraIn: unknown): void {
    const lod = paged.lod;
    lod.rendersWithTraversalHook++;
    const camera = cameraIn as THREE.PerspectiveCamera;
    const mesh = paged.paged.mesh;
    // Pixels are DRAWING-BUFFER pixels (Spark: renderer.getDrawingBufferSize
    // → renderSize), not CSS pixels — at DPR 2 the CSS height would halve
    // the refinement (adversarial review, 2026-09-12).
    const size = (renderer as { getDrawingBufferSize(target: THREE.Vector2): THREE.Vector2 }).getDrawingBufferSize(_size);
    const renderHeight = size.y;
    if (!(renderHeight > 0) || typeof camera.fov !== "number") return; // hidden pane / non-perspective: leave dirty
    // Spark's driveLod formula: world units per pixel at distance 1 (07-S2).
    const pixelScaleLimit = ((2 * Math.tan((camera.fov * Math.PI) / 360)) / renderHeight) * lod.lodRenderScale;

    // Camera in MESH-OBJECT space (the spike's runTraversal) — and the
    // hysteresis compares THIS pose, so a moving mesh or parent re-triggers
    // exactly like a moving camera (adversarial review, 2026-09-12: a
    // world-pose comparison never saw the ticket-09 SiteConfig transforms).
    camera.updateMatrixWorld();
    mesh.updateWorldMatrix(true, false);
    _worldToObject.copy(mesh.matrixWorld).invert();
    _camToObject.multiplyMatrices(_worldToObject, camera.matrixWorld);
    const c = _camToObject.elements;
    const fLen = Math.hypot(c[8]!, c[9]!, c[10]!) || 1;
    _cameraPosition.set(c[12]!, c[13]!, c[14]!);
    _cameraDirection.set(-c[8]! / fLen, -c[9]! / fLen, -c[10]! / fLen);
    const moved =
      _cameraPosition.distanceToSquared(lod.lastPosition) > SORT_POSITION_THRESHOLD * SORT_POSITION_THRESHOLD ||
      _cameraDirection.dot(lod.lastDirection) < SORT_DIRECTION_THRESHOLD;
    if (!lod.dirty && !moved && pixelScaleLimit === lod.lastPixelScaleLimit) return;

    const t0 = performance.now();
    let selectedCount: number;
    if (lod.selectionEnabled) {
      const result = lod.traversal.traverse({
        origin: [c[12]!, c[13]!, c[14]!],
        forward: [-c[8]! / fLen, -c[9]! / fLen, -c[10]! / fLen],
        pixelScaleLimit,
      });
      lod.lastResult = result;
      for (const slot of result.changedSlots) {
        paged.paged.setSelection(slot, lod.traversal.selectionOf(slot));
      }
      selectedCount = result.selectedCount;
      lod.priority.set(result.wantedChunks);
      paged.pool.refreshPriority();
      // The spike touched every WANTED resident page per traversal so the
      // oldest-first eviction among unprotected residents prefers pages the
      // frontier no longer wants (spike PagePool.traverse: "eviction ages by
      // this tick") — promoted verbatim.
      for (const chunk of result.wantedChunks) paged.pool.touch(chunk);
      this.kickAdmissions(state, paged);
    } else {
      // Selection off: every resident row drawn (06 behaviour).
      selectedCount = 0;
      for (let slot = 0; slot < paged.pool.pageCount; slot++) {
        const count = paged.pool.pageCountAt(slot);
        _allFlags.fill(0);
        _allFlags.fill(1, 0, count);
        paged.paged.setSelection(slot, _allFlags.subarray(0, paged.header.chunkSize));
        selectedCount += count;
      }
      lod.lastResult = null;
      // The lanes now hold "every occupied row selected": tell the traversal
      // so its next diff rewrites every slot that differs from that.
      lod.traversal.assumeAllSelected();
    }
    paged.paged.setDrawCount(selectedCount);
    paged.paged.invalidate(); // selection changed → sort + SH re-dispatch (H-LOAD 9–10)
    lod.lastTraversalMs = performance.now() - t0;
    lod.traversals++;
    lod.dirty = false;
    lod.lastPosition.copy(_cameraPosition);
    lod.lastDirection.copy(_cameraDirection);
    lod.lastPixelScaleLimit = pixelScaleLimit;
  }

  /** Every chunk given up on goes through here. Before the load settles it
   *  only joins the list (the settle warning reports the whole shortfall,
   *  owner ruling 08-S2); a chunk given up on AFTER settle is a new fact and
   *  gets its own named warning (owner ruling F4-A, 2026-09-17). A given-up
   *  chunk is never retried, so the warnings are bounded by the chunk count. */
  private markUnavailable(state: HandleState, paged: PagedState, given: ChunkUnavailable): void {
    if (paged.unavailableSet.has(given.index)) return;
    paged.unavailableSet.add(given.index);
    paged.unavailable.push(given);
    if (paged.loadSettled && state.failure === null && !state.disposed) {
      console.warn(
        `[ThreeGsBackend] "${paged.url}": ${describeUnavailable(given)} became unavailable after the load settled — ${given.detail}`,
      );
    }
  }

  /** Wanted-but-missing chunks whose bytes are cached re-decode through the
   *  pool (owner ruling 06-S4); at most poolSize in flight. A chunk given up
   *  on is never retried (S3). */
  private kickAdmissions(state: HandleState, paged: PagedState): void {
    const lod = paged.lod;
    const limit = DECODE_POOL_SIZE; // one re-decode in flight per worker
    for (const chunk of paged.pool.admissibleMissing()) {
      if (lod.admitting.size >= limit) break;
      if (lod.admitting.has(chunk) || paged.unavailableSet.has(chunk)) continue;
      if (!paged.pager.hasCached(chunk)) continue; // still downloading — the load's own gate admits it
      this.admit(state, paged, chunk);
    }
  }

  /** One shared admission per chunk: re-decode from the cache, insert.
   *  Resolves false when refused (slot, disposed/failed handle, decode
   *  failure — which joins the unavailable set, S3). */
  private admit(state: HandleState, paged: PagedState, chunk: number): Promise<boolean> {
    const lod = paged.lod;
    const existing = lod.admitting.get(chunk);
    if (existing !== undefined) return existing;
    const promise = paged.pager.decodeCached(chunk).then(
      (result) => {
        if (state.disposed || state.failure !== null) return false;
        return this.insertPage(state, paged, result);
      },
      (error: unknown) => {
        if (error instanceof DecodeFailedError) {
          this.markUnavailable(state, paged, { index: chunk, reason: "decode-failed", attempts: 1, detail: error.message });
        } else if (
          error instanceof SplatBackendError &&
          (error.reason === "decode-dispatch-failed" || error.reason === "decode-protocol-error")
        ) {
          // Per-job pool rejections: the pool itself is healthy, but
          // decodeCached already took this chunk's bytes out of the cache, so
          // it can never be admitted again — give it up by name instead of
          // letting it vanish (owner ruling 2026-09-17).
          this.markUnavailable(state, paged, { index: chunk, reason: error.reason, attempts: 1, detail: error.message });
        } else if (!state.disposed && error instanceof SplatBackendError && error.reason === "decode-worker-error") {
          // A BROKEN pool rejects every later decode with this same error
          // (DecodePool.breakPool) — after the load settled, no page can
          // ever be admitted again. That is a whole-load failure after first
          // paint, never a silent `false` (owner ruling 08-S2; review F1).
          fail(state, error.reason, error.message);
        }
        return false;
      },
    ).finally(() => {
      lod.admitting.delete(chunk);
    });
    lod.admitting.set(chunk, promise);
    return promise;
  }

  /** Owner ruling 06-S5: fraction = equal-weight mean of the three
   *  spec-named completed-work ratios (bytes fetched, chunks decoded, pages
   *  first-uploaded) — each monotone by construction, so the mean is; never
   *  residency. Phase is paint-observed and fraction keeps rising after
   *  ready (reveal thresholds are ticket 08's). */
  private updatePagedProgress(state: HandleState, phase: "constructing" | "ready"): void {
    const paged = state.paged;
    if (paged === null || state.failure !== null) return;
    const terms = this.pagedProgressTerms(paged);
    const fraction = (terms.bytes + terms.decoded + terms.uploaded) / 3;
    // No Math.max clamp against the previous value: each term is exactly
    // non-decreasing (fixed denominators, non-decreasing numerators), so
    // the mean is; a clamp would only hide a genuine term regression from
    // the fixture's monotonicity tripwire (built-in review, 2026-09-03).
    setProgress(state, {
      bytesLoaded: paged.pager.progress.bytesLanded,
      bytesTotal: paged.header.allChunkBytes,
      phase,
      fraction: Math.min(1, fraction),
    });
  }

  private pagedProgressTerms(paged: PagedState): { bytes: number; decoded: number; uploaded: number } {
    const p = paged.pager.progress;
    const chunks = p.chunkCount;
    return {
      bytes: p.allChunkBytes > 0 ? Math.min(1, p.bytesLanded / p.allChunkBytes) : 0,
      decoded: chunks > 0 ? p.decoded / chunks : 0,
      uploaded: chunks > 0 ? paged.pool.firstUploadedCount / chunks : 0,
    };
  }

  /** Public counter door for the pager (see PagerDiagnostics). Throws
   *  `not-paged` on a monolithic handle. */
  pagerDiagnostics(handle: SplatHandle): PagerDiagnostics {
    const state = requireHandle(handle, "pagerDiagnostics");
    const paged = state.paged;
    if (paged === null) {
      throw new SplatBackendError("not-paged", "pagerDiagnostics on a non-paged handle");
    }
    const backendRef = this;
    return {
      budget: paged.budget,
      pageSize: paged.header.chunkSize,
      capacity: paged.paged.capacity,
      residentPages: paged.pool.residentPageCount,
      residentSplats: paged.pool.residentSplatCount,
      firstUploaded: paged.pool.firstUploadedCount,
      deferred: paged.deferred,
      unavailable: paged.unavailable,
      refused: paged.refused,
      partialUploadBroken: paged.paged.partialUploadBroken,
      uploadPath: paged.paged.uploadPath,
      rangesPushed: paged.paged.rangesPushed,
      rangesConsumed: paged.paged.rangesConsumed,
      pboUploads: paged.paged.pboUploads,
      renders: paged.paged.renders,
      cachedBytes: paged.pager.cachedBytes,
      loadSettled: paged.loadSettled,
      progressTerms: this.pagedProgressTerms(paged),
      isResident: (chunk) => paged.pool.isResident(chunk),
      isCached: (chunk) => paged.pager.hasCached(chunk),
      slotOf: (chunk) => paged.pool.slotOf(chunk),
      // Both mutators refuse (false) on a disposed OR failed handle — a
      // handle whose whenReady rejected must never revive content, and a
      // diagnostics object retained past dispose must not touch a torn-down
      // pool (built-in review, 2026-09-03).
      evictChunk: (chunk) => {
        if (state.disposed || state.failure !== null) return false;
        const slot = paged.pool.evict(chunk);
        if (slot === -1) return false;
        paged.paged.clearPage(slot);
        paged.lod.traversal.clearPage(slot);
        backendRef.residencyChanged(state, paged);
        return true;
      },
      admitChunk: (chunk) => {
        if (state.disposed || state.failure !== null) return Promise.resolve(false);
        if (paged.pool.isResident(chunk)) return Promise.resolve(true);
        // A chunk given up on stays given up on: a decode failure is
        // deterministic on the same bytes (S3) and a fetch failure left no
        // bytes to decode — never a retry through this door.
        if (paged.unavailableSet.has(chunk)) return Promise.resolve(false);
        if (!paged.pager.hasCached(chunk) && !paged.lod.admitting.has(chunk)) return Promise.resolve(false);
        // Promise<boolean> means boolean: every failure inside resolves false.
        return backendRef.admit(state, paged, chunk);
      },
      mesh: paged.paged.mesh,
      lod: {
        selectedCount: paged.lod.lastResult?.selectedCount ?? paged.paged.drawCount,
        drawCount: paged.paged.drawCount,
        fullQuality: paged.lod.lastResult?.fullQuality ?? false,
        traversals: paged.lod.traversals,
        lastTraversalMs: paged.lod.lastTraversalMs,
        wantedChunks: paged.lod.lastResult?.wantedChunks ?? [],
        changedSlotsLast: paged.lod.lastResult?.changedSlots.length ?? 0,
        stats: paged.lod.lastResult?.stats ?? null,
        tuning: paged.lod.traversal.tuning,
        lodRenderScale: paged.lod.lodRenderScale,
        selectionEnabled: paged.lod.selectionEnabled,
        cullingEnabled: paged.paged.mesh.frustumCulled,
        admitting: paged.lod.admitting.size,
        admittingChunks: [...paged.lod.admitting.keys()],
        setLodRenderScale: (scale) => {
          if (!(scale > 0)) throw new SplatBackendError("lod-tuning", `lodRenderScale must be > 0, got ${scale}`);
          paged.lod.lodRenderScale = scale;
          paged.lod.dirty = true;
        },
        setSelectionEnabled: (enabled) => {
          paged.lod.selectionEnabled = enabled;
          paged.lod.dirty = true;
        },
        setCullingEnabled: (enabled) => {
          paged.paged.mesh.frustumCulled = enabled;
        },
        markDirty: () => {
          paged.lod.dirty = true;
        },
      },
    };
  }


  private checkDisposed(state: HandleState): boolean {
    if (!state.disposed) return false;
    if (state.failure === null && state.progress.phase !== "ready") {
      fail(
        state,
        "handle-disposed",
        "handle was disposed before load completed",
      );
    }
    return true;
  }

  private async runPlyPipeline(url: string, state: HandleState): Promise<void> {
    try {
      const response = await fetch(url, { signal: state.abort.signal });
      if (this.checkDisposed(state)) return;
      if (!response.ok) {
        fail(
          state,
          "fetch-failed",
          `fetch failed with status ${response.status} for "${url}"`,
        );
        return;
      }

      const bytesTotal = Number(response.headers.get("content-length") ?? 0);
      const reader = response.body?.getReader();
      if (reader === undefined) {
        fail(
          state,
          "fetch-no-body",
          `fetch returned no body for "${url}"`,
        );
        return;
      }

      const chunks: Uint8Array[] = [];
      let bytesLoaded = 0;
      updateFetchProgress(state, bytesLoaded, bytesTotal);

      while (true) {
        const { done, value } = await reader.read();
        if (this.checkDisposed(state)) return;
        if (done) break;
        chunks.push(value);
        bytesLoaded += value.byteLength;
        updateFetchProgress(state, bytesLoaded, bytesTotal);
      }

      const arrayBuffer = new ArrayBuffer(bytesLoaded);
      const out = new Uint8Array(arrayBuffer);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
      }

      setProgress(state, {
        bytesLoaded,
        bytesTotal: Math.max(bytesTotal, bytesLoaded),
        phase: "constructing",
        fraction: 1,
      });

      const header = readPlyHeader(arrayBuffer);
      validateSplatPlyHeader(header);
      const degree = detectSphericalHarmonicsDegree(header);
      const vertexCount = parseVertexCount(header);
      const limit =
        this.maxStorageBufferBindingSizeOverride ??
        (this.renderer as { backend?: { device?: { limits?: { maxStorageBufferBindingSize?: number } } } })
          ?.backend?.device?.limits?.maxStorageBufferBindingSize;
      if (typeof limit === "number") {
        try {
          assertStorageWithinLimit(vertexCount, degree, limit);
        } catch (error) {
          if (error instanceof ForkPatchError) {
            fail(state, error.reason, error.message);
            return;
          }
          throw error;
        }
      }
      if (this.checkDisposed(state)) return;
      const loader = new PLYLoader();
      loader.setCustomPropertyNameMapping(
        getGaussianSplatPLYPropertyMapping(degree),
      );
      let plyGeometry: THREE.BufferGeometry;
      try {
        plyGeometry = loader.parse(arrayBuffer);
      } catch (error) {
        // Parsing allocates the file-sized attribute arrays — an allocation
        // RangeError here is the same over-capacity surface as conversion /
        // construction (adversarial-review finding).
        const detail = error instanceof Error ? error.message : String(error);
        if (error instanceof RangeError) {
          fail(state, "over-capacity", `allocation failed — ${detail}`);
        } else {
          fail(state, "ply-parse-failed", `PLY parse failed — ${detail}`);
        }
        return;
      }
      state.total = plyGeometry.getAttribute("position")?.count ?? 0;

      let splatGeometry;
      try {
        // Vendor applies 1/(1+exp(-x)) to opacity logits at load
        // (GaussianSplatUtils.js:330) — matching Spark ply.ts:553-555. The
        // write-side inverse (ply.ts:673 / ply.rs:1244) must never appear here.
        splatGeometry = createGaussianSplatGeometryFromPLYGeometry(plyGeometry);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (error instanceof RangeError) {
          fail(
            state,
            "over-capacity",
            `allocation failed — ${detail}`,
          );
        } else {
          fail(
            state,
            "ply-decode-failed",
            `PLY decode failed — ${detail}`,
          );
        }
        return;
      }

      state.bounds = computePositionBounds(plyGeometry);
      state.boundsReady = true;

      let mesh: GaussianSplatMesh;
      try {
        mesh = new GaussianSplatMesh(splatGeometry);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (error instanceof RangeError) {
          fail(
            state,
            "over-capacity",
            `allocation failed — ${detail}`,
          );
        } else {
          fail(
            state,
            "mesh-construct-failed",
            `GaussianSplatMesh construction failed — ${detail}`,
          );
        }
        return;
      }

      mesh.onAfterRender = () => {
        if (state.progress.phase === "ready") return;
        setProgress(state, {
          ...state.progress,
          phase: "ready",
          fraction: 1,
        });
        state.resolveReady();
      };

      if (this.checkDisposed(state)) return;
      state.mesh = mesh;
      state.group.add(mesh);
    } catch (error) {
      // Named refusals thrown by helpers (header scan, SH-degree detect) and
      // unexpected errors alike terminate the handle HERE — the old
      // instanceof-return left helper refusals unrecorded, hanging whenReady
      // in "constructing" forever (adversarial-review finding, 2026-08-29).
      if (error instanceof SplatBackendError) {
        fail(state, error.reason, error.message);
        return;
      }
      // dispose() aborts the fetch; the DOMException must land as the
      // handle-disposed refusal, not a generic pipeline failure.
      if (state.disposed && error instanceof DOMException && error.name === "AbortError") {
        this.checkDisposed(state);
        return;
      }
      const detail = error instanceof Error ? error.message : String(error);
      fail(
        state,
        "ply-pipeline-failed",
        `PLY pipeline failed — ${detail}`,
      );
    }
  }

  progress(handle: SplatHandle): LoadProgress {
    return { ...requireHandle(handle, "progress").progress };
  }

  whenReady(handle: SplatHandle): Promise<void> {
    return requireHandle(handle, "whenReady").whenReady;
  }

  bounds(handle: SplatHandle): THREE.Box3 {
    const state = requireHandle(handle, "bounds");
    if (!state.boundsReady) {
      if (state.paged !== null && state.progress.phase === "ready") {
        throw new SplatBackendError(
          "no-resident-pages",
          "bounds requested while no page is resident",
        );
      }
      throw new SplatBackendError(
        "bounds-before-construct",
        "bounds requested before construct",
      );
    }
    return state.bounds.clone();
  }

  counts(handle: SplatHandle): SplatCounts {
    const state = requireHandle(handle, "counts");
    if (state.paged !== null) {
      // Paged path: resident = splats in resident pages; selected = the last
      // RENDER's frontier (the draw count; 0 before the first render), never
      // more than what is resident right now — residency can shrink between
      // renders (adversarial review, 2026-09-12).
      const resident = state.paged.pool.residentSplatCount;
      return { total: state.total, resident, selected: Math.min(state.paged.paged.drawCount, resident) };
    }
    // Monolithic path: once ready, everything is resident and selected.
    const resident = state.progress.phase === "ready" ? state.total : 0;
    return { total: state.total, resident, selected: resident };
  }

  dispose(handle: SplatHandle): void {
    const state = requireHandle(handle, "dispose");
    if (this.renderer === undefined || this.renderer === null) {
      throw new SplatBackendError(
        "dispose-needs-renderer",
        "dispose cannot free GPU memory without the renderer that owns it",
      );
    }
    state.disposed = true;
    state.abort.abort();
    // Paged path: stop fetch/decode first (workers terminate, raw cache
    // dropped), then the mesh teardown below frees the GPU storage — SH
    // band + contribution buffer included (ticket 04 residual, closed here).
    state.paged?.pager.dispose();
    const mesh = state.mesh;
    try {
      if (mesh !== null) {
        disposeGaussianSplatMesh(mesh, this.renderer);
      }
    } catch (error) {
      if (error instanceof ForkPatchError) {
        throw new SplatBackendError(error.reason, error.message);
      }
      throw error;
    } finally {
      // Guaranteed even when the patch throws (adversarial-review finding:
      // a reshape must never leave the mesh attached and the handle live —
      // the GPU memory may be unfreeable then, but the scene detach and
      // handle invalidation are unconditional).
      if (mesh !== null) state.group.remove(mesh);
      state.mesh = null;
      this.checkDisposed(state);
      handles.delete(handle);
    }
  }

  raycast(_handle: SplatHandle, _ray: THREE.Ray): SplatHit | null {
    requireHandle(_handle, "raycast");
    // Named-refusal stub — Phase 3 §B owns raycast.
    throw new SplatBackendError(
      "raycast-not-implemented",
      "raycast refused — Phase 3 §B",
    );
  }

  setEdits(_handle: SplatHandle, _edits: SdfEdit[]): void {
    requireHandle(_handle, "setEdits");
    // Named-refusal stub — Phase 3 §C owns edits.
    throw new SplatBackendError(
      "set-edits-not-implemented",
      "setEdits refused — Phase 3 §C",
    );
  }

  setMeshColor(
    _handle: SplatHandle,
    _rgba: readonly [number, number, number, number],
  ): void {
    requireHandle(_handle, "setMeshColor");
    // Named-refusal stub — Phase 4 owns mesh color.
    throw new SplatBackendError(
      "set-mesh-color-not-implemented",
      "setMeshColor refused — Phase 4",
    );
  }

  setOptics(_handle: SplatHandle, _optics: SplatOptics | null): void {
    requireHandle(_handle, "setOptics");
    // Named-refusal stub — Phase 5 owns optics.
    throw new SplatBackendError(
      "set-optics-not-implemented",
      "setOptics refused — Phase 5",
    );
  }
}
