/**
 * D30 STUB — API-preserving typed stub of sparkjs-toolkit's SplatBounds
 * (doc 06 D30; Phase 2 ticket 09, owner ruling Stop 3, 2026-09-17).
 *
 * The pin samples splat centres through Spark's `forEachSplat`
 * (fd67153:src/core/SplatBounds.ts), which this backend does not expose;
 * ticket 11 rebuilds it on the backend's resident-page union. This stub keeps
 * the pin's exported names and returns `null` — the pin's OWN documented
 * outcome ("Returns null when no splat data is readable yet — callers treat
 * null as 'no bounds'", pin :12-14).
 *
 * Silent for the same reason D27's stub is: the one consumer branch cannot be
 * reached in Phase 2. SiteRuntime calls this only from `sphereFromObject`
 * behind an `isSplatMesh` duck-type that the vendored mesh never satisfies (it
 * sets `isGaussianSplatMesh`), and the only pin objects that do satisfy it are
 * splat-text meshes, which D19's throwing stub keeps from existing until
 * Phase 4. SAME OBLIGATION AS D19 AND D27: ticket 11 DELETES this file and
 * replaces it; the barrel name stays deferred until then.
 */

import type * as THREE from "three";

export interface SplatBoundsOptions {
  /** Target number of sampled splats — sampleRate is derived (default: 1000) */
  targetSamples?: number;
  /** Transform sampled centers by mesh.matrixWorld (default: true) */
  world?: boolean;
  /** Expand the sampled box by this fraction of its size per axis (default: 0.05) */
  padFraction?: number;
}

/** Compute a sampled bounding box. The stub reads no splat data, so it always
 *  answers the pin's "no bounds" result. The mesh parameter is widened from
 *  Spark's SplatMesh to Object3D (doc 06 D30). */
export function computeSplatBounds(
  mesh: THREE.Object3D,
  options: SplatBoundsOptions = {},
): THREE.Box3 | null {
  void mesh;
  void options;
  return null;
}
