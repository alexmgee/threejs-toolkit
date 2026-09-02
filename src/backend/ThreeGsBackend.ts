import * as THREE from "three/webgpu";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { GaussianSplatMesh } from "../vendor/three-gs/GaussianSplatMesh.js";
import {
  SH_DEGREE_TO_COMPONENTS,
  createGaussianSplatGeometryFromPLYGeometry,
  getGaussianSplatPLYPropertyMapping,
} from "../vendor/three-gs/GaussianSplatUtils.js";
import { assertStorageWithinLimit } from "../vendor/three-gs/patches/capacity-guard.js";
import {
  ForkPatchError,
  disposeGaussianSplatMesh,
} from "../vendor/three-gs/patches/dispose.js";
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
}

export interface ThreeGsBackendOptions {
  renderer?: unknown;
  /** TEST-ONLY seam (owner ruling 2026-08-29): overrides the queried
   *  device limit so the over-capacity refusal is drillable at fixture
   *  scale. Never set in production code. */
  maxStorageBufferBindingSizeOverride?: number;
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

/**
 * Monolithic PLY backend over vendored GaussianSplatMesh (ticket 03).
 * dispose() is real as of ticket 04; remaining refusal stubs: raycast,
 * setEdits, setMeshColor, setOptics, and non-PLY formats.
 */
export class ThreeGsBackend implements SplatBackend {
  private readonly renderer: unknown;
  private readonly maxStorageBufferBindingSizeOverride: number | undefined;

  constructor(options: ThreeGsBackendOptions = {}) {
    this.renderer = options.renderer;
    this.maxStorageBufferBindingSizeOverride =
      options.maxStorageBufferBindingSizeOverride;
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
      throw new SplatBackendError(
        "rad-refused",
        "rad refused — paged path lands with ticket 06 (fetch + decode pool landed in ticket 05 as RadPager)",
      );
    }
    // Exhaustiveness: when SplatFormat grows, this line makes the compiler
    // flag the new format instead of letting it fall through into the PLY
    // pipeline and die at runtime on garbage (review finding).
    format satisfies "ply";

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
    void this.runPlyPipeline(source.url, state);
    return handle;
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
      throw new SplatBackendError(
        "bounds-before-construct",
        "bounds requested before construct",
      );
    }
    return state.bounds.clone();
  }

  counts(handle: SplatHandle): SplatCounts {
    const state = requireHandle(handle, "counts");
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
