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
import { DecodeFailedError } from "./DecodePool.js";
import { PagePool, indexOrder } from "./PagePool.js";
import { RadPager } from "./RadPager.js";
import type { ChunkUnavailable } from "./RadFetcher.js";
import type { RadHeaderInfo } from "./RadHeader.js";
import type { DecodeResult } from "./rad-worker.js";
import {
  HANDLE_BRAND,
  SplatBackendError,
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
  slotOf(chunk: number): number;
  /** Explicit eviction: the slot is zeroed on the GPU and freed. */
  evictChunk(chunk: number): boolean;
  /** Re-decode from cached bytes and upload (admission after deferral or
   *  eviction). Resolves false when the pool refuses a slot. */
  admitChunk(chunk: number): Promise<boolean>;
  readonly mesh: GaussianSplatMesh;
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
}

const handles = new WeakMap<SplatHandle, HandleState>();

function inferFormat(source: SplatSource): SplatFormat {
  if (source.format !== undefined) return source.format;
  const pathPart = source.url.split(/[?#]/)[0] ?? source.url;
  const ext = pathPart.split(".").pop()?.toLowerCase();
  if (ext === "ply" || ext === "spz" || ext === "splat" || ext === "rad") {
    return ext;
  }
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
  state.progress = {
    ...state.progress,
    phase: "failed",
  };
  state.rejectReady(error);
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
  state.progress = {
    bytesLoaded,
    bytesTotal,
    phase: "fetching",
    fraction,
  };
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

  constructor(options: ThreeGsBackendOptions = {}) {
    this.renderer = options.renderer;
    this.maxStorageBufferBindingSizeOverride =
      options.maxStorageBufferBindingSizeOverride;
    this.createDecodeWorker = options.createDecodeWorker;
    this.pageBudgetOverride = options.pageBudgetOverride;
    this.fetchImpl = options.fetchImpl;
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
          const pool = new PagePool({
            chunkCount: header.chunks.length,
            pageCount: budget.pages,
            pageSize,
            priority: indexOrder(header.chunks.length),
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
          paged = {
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
          this.updatePagedProgress(state, "constructing");
        },
        admit: (index) => paged !== null && paged.pool.isAdmissible(index),
        onDeferred: (index) => {
          paged?.deferred.push(index);
        },
        onUnavailable: (given) => {
          if (paged === null) return;
          paged.unavailable.push(given);
          paged.unavailableSet.add(given.index);
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
      paged.paged.setBounds(bounds.min, bounds.max);
    }
    paged.paged.invalidate();
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
    state.progress = {
      bytesLoaded: paged.pager.progress.bytesLanded,
      bytesTotal: paged.header.allChunkBytes,
      phase,
      fraction: Math.min(1, fraction),
    };
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
        backendRef.residencyChanged(state, paged);
        return true;
      },
      admitChunk: async (chunk) => {
        if (state.disposed || state.failure !== null) return false;
        if (paged.pool.isResident(chunk)) return true;
        // A chunk given up on stays given up on: a decode failure is
        // deterministic on the same bytes (S3) and a fetch failure left no
        // bytes to decode — never a retry through this door.
        if (paged.unavailableSet.has(chunk)) return false;
        let result: DecodeResult;
        try {
          result = await paged.pager.decodeCached(chunk);
        } catch (error) {
          // Promise<boolean> means boolean: pool-disposed (dispose landed
          // mid-admit), decode-failed, chunk-not-cached, worker failure —
          // all resolve false; a decode failure joins the unavailable set.
          if (error instanceof DecodeFailedError) {
            paged.unavailableSet.add(chunk);
            paged.unavailable.push({ index: chunk, reason: "decode-failed", attempts: 1, detail: error.message });
          }
          return false;
        }
        if (state.disposed || state.failure !== null) return false;
        return backendRef.insertPage(state, paged, result);
      },
      mesh: paged.paged.mesh,
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

      state.progress = {
        bytesLoaded,
        bytesTotal: Math.max(bytesTotal, bytesLoaded),
        phase: "constructing",
        fraction: 1,
      };

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
        state.progress = {
          ...state.progress,
          phase: "ready",
          fraction: 1,
        };
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
      // Paged path: resident = splats in resident pages; everything resident
      // is shown until ticket 07's selection.
      const resident = state.paged.pool.residentSplatCount;
      return { total: state.total, resident, selected: resident };
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
