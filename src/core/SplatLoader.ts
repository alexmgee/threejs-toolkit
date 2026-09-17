/**
 * SplatLoader — the splat file loader, rebuilt over the SplatBackend seam
 * (Phase 2 ticket 08).
 *
 * Same barrel name and options shape as sparkjs-toolkit's pin
 * (fd67153:src/core/SplatLoader.ts). Owner rulings (ticket 08 Comments,
 * doc 06 D25/D26):
 * - `backend` is a new required option — the seam instance that owns the
 *   renderer and decode-worker factory — and the loader returns the seam's
 *   SplatHandle instead of Spark's SplatMesh; the caller composes
 *   `handle.object` (D25).
 * - The ONE §A5 reveal/progress policy lives here (S1, D26): reveal = the
 *   seam's paint-observed ready, on both load paths; `onProgress` reports the
 *   true completed-work fraction, strictly increasing, until reveal, then
 *   exactly 1, once. A fraction of 1 before reveal (PLY "constructing") is
 *   held so the single 1 lands at reveal. Never un-revealed.
 * - A failure before OR after reveal reaches `onError` by name (S2/S3),
 *   pushed by the backend — nothing polls.
 * - `extSplats` / `lod` / `paged` are accepted; a supplied value the format
 *   contradicts warns once, by name (S5).
 * - The conditional 180° X-flip is applied exactly as the pin does
 *   (pin SplatLoader.ts:81-88): presence of `eulerRotationDeg` arms it.
 */

import {
  SplatBackendError,
  formatFromName,
  type LoadProgress,
  type SplatBackend,
  type SplatFormat,
  type SplatHandle,
} from "../backend/SplatBackend";

export interface SplatLoadOptions {
  /** URL to the splat file */
  url: string;
  /** The seam instance that loads and owns the handle (doc 06 D25). A paged
   *  `.rad` needs a backend constructed with the renderer and a decode-worker
   *  factory. */
  backend: SplatBackend;
  /** Pin: ExtSplats float32 precision (default true). This backend's centres
   *  and covariances are always float32 — `false` warns (ruling S5). */
  extSplats?: boolean;
  /** Pin: LOD tree generation at load. Here the format decides — a `.rad`
   *  always traverses its LOD tree, a PLY has none; a contradicting value
   *  warns (S5). */
  lod?: boolean;
  /** Pin: paged streaming for `.rad`. Here a `.rad` is always paged and a
   *  PLY never is; a contradicting value warns (S5). */
  paged?: boolean;
  /** Initial position [x, y, z] (default: [0, 0, 0]) */
  position?: [number, number, number];
  /** Quaternion rotation [x, y, z, w] — set to [1,0,0,0] for OpenCV→OpenGL coord flip (default: undefined) */
  quaternion?: [number, number, number, number];
  /** Euler rotation in degrees [x, y, z] with automatic 180° X-flip for Y-down→Y-up conversion.
   *  Applies `rotation.set(PI + rx, ry, rz)` matching the COLMAP/3DGS convention.
   *  Takes priority over `quaternion` if both are provided. (default: undefined) */
  eulerRotationDeg?: [number, number, number];
  /** Uniform scale (default: 1.0) */
  scale?: number;
  /** Original filename — its extension picks the format when the URL has none
   *  (e.g. a blob URL) (default: undefined) */
  fileName?: string;
  /** Load progress 0..1 — the true completed-work fraction, strictly
   *  increasing, until reveal; then exactly 1, once (ruling S1). */
  onProgress?: (progress: number) => void;
  /** Reveal: fires once, at the seam's paint-observed ready, on both load
   *  paths (ruling S1). The pin's SiteRuntime already ignored Spark's onLoad
   *  for paged meshes, so no pin consumer relied on its old timing. */
  onLoad?: (handle: SplatHandle) => void;
  /** The named failure, before or after reveal (rulings S2/S3). Fires at
   *  most once; `onLoad` never follows it. Includes
   *  dispose-before-reveal (`handle-disposed`), exactly as `whenReady`
   *  rejects — a consumer that disposes guards, as the pin's SiteRuntime did. */
  onError?: (error: SplatBackendError) => void;
}

/** What the format decides for the pin's Spark-era options (ruling S5). */
function formatDecides(format: SplatFormat): { paged: boolean; lod: boolean } {
  return format === "rad" ? { paged: true, lod: true } : { paged: false, lod: false };
}

function contradictions(options: SplatLoadOptions, format: SplatFormat | undefined): string[] {
  const found: string[] = [];
  if (options.extSplats === false) {
    found.push("extSplats=false (precision is always float32 here)");
  }
  if (format === undefined) return found;
  const decided = formatDecides(format);
  if (options.paged !== undefined && options.paged !== decided.paged) {
    found.push(`paged=${options.paged} (a .${format} is ${decided.paged ? "always" : "never"} paged here)`);
  }
  if (options.lod !== undefined && options.lod !== decided.lod) {
    found.push(`lod=${options.lod} (a .${format} ${decided.lod ? "always traverses its LOD tree" : "has no LOD tree"} here)`);
  }
  return found;
}

export function loadSplat(options: SplatLoadOptions): SplatHandle {
  const {
    url,
    backend,
    position,
    quaternion,
    eulerRotationDeg,
    scale,
    fileName,
    onProgress,
    onLoad,
    onError,
  } = options;

  const format = fileName !== undefined ? formatFromName(fileName) : undefined;

  // The S5 warning is about the options vs the format, so it comes first —
  // a load the backend refuses on the spot still gets it (review F3).
  const warnings = contradictions(options, format ?? formatFromName(url));
  if (warnings.length > 0) {
    console.warn(`[SplatLoader] "${fileName ?? url}": ${warnings.join("; ")}`);
  }

  let lastReported = 0;
  let revealed = false;
  let failed = false;

  const handle = backend.load({
    url,
    ...(format !== undefined ? { format } : {}),
    onProgress: (progress: LoadProgress) => {
      if (revealed || failed) return;
      // Only pre-ready phases report; the paged fraction keeps rising after
      // ready by design, and reveal reports the single 1 itself.
      if (progress.phase !== "fetching" && progress.phase !== "constructing") return;
      if (progress.fraction >= 1 || progress.fraction <= lastReported) return;
      lastReported = progress.fraction;
      onProgress?.(progress.fraction);
    },
    onFailure: (error) => {
      if (failed) return;
      failed = true;
      onError?.(error);
    },
  });

  const object = handle.object;
  if (position) {
    object.position.set(...position);
  }
  if (eulerRotationDeg) {
    // Euler rotation with automatic 180° X-flip (Y-down → Y-up coordinate conversion)
    const DEG2RAD = Math.PI / 180;
    const [rx, ry, rz] = eulerRotationDeg;
    object.rotation.set(Math.PI + rx * DEG2RAD, ry * DEG2RAD, rz * DEG2RAD);
  } else if (quaternion) {
    object.quaternion.set(...quaternion);
  }
  if (scale !== undefined) {
    object.scale.setScalar(scale);
  }

  // Reveal on the seam's paint-observed ready. A promise reaction, so a
  // consumer's onLoad runs after the render that observed the paint, never
  // inside it. A rejection is the failure path above (onFailure).
  void backend.whenReady(handle).then(
    () => {
      if (revealed || failed) return;
      revealed = true;
      // Separate guards: a throwing progress observer must not cost the
      // consumer its reveal (review F2).
      try {
        onProgress?.(1);
      } catch (error) {
        reportError(error);
      }
      try {
        onLoad?.(handle);
      } catch (error) {
        reportError(error);
      }
    },
    () => {},
  );

  return handle;
}

/**
 * REFUSED by name (owner ruling 08-S4). The pin resolved on construction
 * (`mesh.initialized`) and its one caller, SceneComposer, added the mesh AFTER
 * awaiting. This seam's ready is paint-observed and needs the object already
 * in a rendered scene, so a promise that hands over the handle only at reveal
 * could never resolve. SceneComposer's own ticket (Phase 3) settles the real
 * semantics against an actual caller.
 */
export async function loadSplatAsync(options: SplatLoadOptions): Promise<SplatHandle> {
  throw new SplatBackendError(
    "load-splat-async-refused",
    `loadSplatAsync("${options.url}") refused — ready is paint-observed, so a promise for an object nobody has added to a scene yet can never resolve; use loadSplat with onLoad (ticket 08 ruling S4; SceneComposer's Phase 3 ticket settles it)`,
  );
}
