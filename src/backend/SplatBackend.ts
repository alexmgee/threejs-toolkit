import type * as THREE from "three";

export type SplatFormat = "rad" | "spz" | "ply" | "splat";

export interface SplatSource {
  url: string;
  format?: SplatFormat;
  /** Optional observer (ticket 08 ruling S3): called every time the backend
   *  refreshes this handle's LoadProgress, with the same snapshot
   *  `progress()` would return at that moment — including the terminal
   *  "failed" phase. The seam is otherwise pull-only; nothing polls, so it
   *  keeps working in hidden tabs. A throwing observer is reported
   *  (`reportError`) and never alters the load. */
  onProgress?: (progress: LoadProgress) => void;
  /** Optional observer (ruling S3): called once, with the named error, when
   *  the handle fails terminally — before OR after ready. `whenReady`
   *  settles once, so a whole-load failure after first paint has no other
   *  push path (ruling S2). Mirrors `whenReady`'s rejection before ready,
   *  including dispose-before-ready (`handle-disposed`). */
  onFailure?: (error: SplatBackendError) => void;
}

const FORMAT_EXTENSIONS: readonly SplatFormat[] = ["ply", "spz", "splat", "rad"];

/** The format a file name or URL's extension names (query and fragment
 *  ignored), or undefined. The one extension rule: the backend infers a
 *  source's format with it, and the loader picks the format from a blob
 *  URL's `fileName` with it (ticket 08, pin SplatLoader semantics). */
export function formatFromName(name: string): SplatFormat | undefined {
  const pathPart = name.split(/[?#]/)[0] ?? name;
  const ext = pathPart.split(".").pop()?.toLowerCase();
  return FORMAT_EXTENSIONS.find((format) => format === ext);
}

export type LoadPhase = "fetching" | "constructing" | "ready" | "failed";

/**
 * Load progress for one splat handle.
 *
 * `fraction` = bytesLoaded/bytesTotal while fetching (0 when bytesTotal is
 * unknown; clamped to 1 in case a lying content-length under-reports, which
 * also keeps monotonicity), holds at 1.0 through "constructing", and
 * "ready"/whenReady is the authoritative gate — monotone by construction. On
 * failure the fraction freezes and phase becomes "failed". The paged path's
 * fraction is the equal-weight mean of three completed-work ratios (ruling
 * 06-S5) and keeps rising after ready. The §A5 REVEAL policy built on this
 * (ticket 08, doc 06 D26) lives in `core/SplatLoader`, not here.
 */
export interface LoadProgress {
  readonly bytesLoaded: number;
  /** 0 when the server sent no content-length */
  readonly bytesTotal: number;
  readonly phase: LoadPhase;
  readonly fraction: number;
}

export const HANDLE_BRAND: unique symbol = Symbol("SplatHandle");

export interface SplatHandle {
  /** The renderable — caller composes it (scene.add(handle.object)).
   *  Owner-ruled 2026-08-29: the handle carries the object; the seam
   *  interface itself stays at exactly the doc 02:67-84 method set. */
  readonly object: THREE.Object3D;
  readonly [HANDLE_BRAND]: true;
}

export interface SplatHit {
  readonly index: number;
  readonly point: THREE.Vector3;
  readonly distance: number;
}

/** Phase 3 §C owns the real shape; placeholder until then. */
export interface SdfEdit {
  readonly kind: string;
}

export interface SplatOptics {
  readonly focalDistance: number;
  readonly apertureAngle: number;
}

export interface SplatCounts {
  readonly total: number;
  readonly resident: number;
  readonly selected: number;
}

export interface SplatBackend {
  load(source: SplatSource): SplatHandle;
  dispose(handle: SplatHandle): void;
  progress(handle: SplatHandle): LoadProgress;
  /** Resolves after the handle's FIRST REAL PAINT. Precondition: the caller
   *  has added `handle.object` to a scene that is being rendered — awaiting
   *  before composing the object never settles (ready is paint-observed,
   *  not construction-observed; doc 03 §A5). Rejects with the named
   *  SplatBackendError on load failure. */
  whenReady(handle: SplatHandle): Promise<void>;
  raycast(handle: SplatHandle, ray: THREE.Ray): SplatHit | null;
  bounds(handle: SplatHandle): THREE.Box3;
  counts(handle: SplatHandle): SplatCounts;
  setEdits(handle: SplatHandle, edits: SdfEdit[]): void;
  setMeshColor(
    handle: SplatHandle,
    rgba: readonly [number, number, number, number],
  ): void;
  setOptics(handle: SplatHandle, optics: SplatOptics | null): void;
}

/** Every backend failure. `reason` is the machine-readable code (assert on
 *  it, not on message prose); `message` carries NO name prefix — `name`
 *  already supplies "SplatBackendError" on stringification. */
export class SplatBackendError extends Error {
  readonly reason: string;

  constructor(reason: string, message?: string) {
    super(message ?? reason);
    this.name = "SplatBackendError";
    this.reason = reason;
  }
}
