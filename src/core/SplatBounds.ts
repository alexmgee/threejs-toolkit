/**
 * SplatBounds — World-space bounding box for a splat handle, read from the seam
 *
 * Rebuilt at pin fd67153 (Phase 2 ticket 11, doc 06 D33). The pin sampled
 * SplatMesh centers via Spark's forEachSplat; here the SplatBackend seam's
 * `bounds(handle)` is the only truth — an object-space box of splat CENTERS,
 * exact per point on the monolithic path and, on the paged .rad path, the
 * union of the RESIDENT pages' exact per-point boxes, so it reflects the
 * currently streamed splats: it grows as pages arrive and shrinks when they
 * are evicted. Returns null when no splat data is readable yet — callers
 * treat null as "no bounds" (obstacle layout degrades to plain column flow).
 *
 * World space is the 8-corner transform of that box by the handle object's
 * matrixWorld (doc 03 Bounds, ruling B1): exact for axis-aligned transforms
 * (the loader's flip, translation, scale), conservative — never smaller —
 * under an arbitrary rotation, the safe direction for framing.
 *
 * Nothing is cached — callers decide when to recompute (bounds change
 * only when the transform or the resident splat data changes; obstacle
 * consumers re-project per frame, not re-read).
 */

import * as THREE from "three";
import { SplatBackendError, type SplatBackend, type SplatHandle } from "../backend/SplatBackend";

export interface SplatBoundsOptions {
  /** @deprecated Ignored — nothing is sampled: the seam's box is exact (doc 06 D33). Kept so pin callers compile. */
  targetSamples?: number;
  /** Transform the box by the handle object's matrixWorld, 8-corner (default: true) */
  world?: boolean;
  /** Expand the box by this fraction of its size per axis (default: 0.05) */
  padFraction?: number;
}

/** The seam's refusals that mean "no readable splat data yet" — answered with
 *  null, as the pin did. Every other refusal propagates: a disposed handle's
 *  `unknown-handle` is a caller bug (ruling S2). */
const NO_DATA_YET: ReadonlySet<string> = new Set(["bounds-before-construct", "no-resident-pages"]);

const _pad = new THREE.Vector3();

/** Compute the handle's bounding box. Returns null when no splat data is readable yet. */
export function computeSplatBounds(
  backend: SplatBackend,
  handle: SplatHandle,
  options: SplatBoundsOptions = {},
): THREE.Box3 | null {
  const { world = true, padFraction = 0.05 } = options;

  let box: THREE.Box3;
  try {
    // A copy the caller owns — the seam's box is never transformed in place.
    box = backend.bounds(handle).clone();
  } catch (error) {
    if (error instanceof SplatBackendError && NO_DATA_YET.has(error.reason)) return null;
    throw error;
  }
  if (box.isEmpty()) return null;

  if (world) {
    // Ancestors included (which the pin's updateMatrixWorld(true) does not do):
    // a parent moved since the last render still counts. FORCED, because three
    // recomputes matrixWorld only when matrixWorldNeedsUpdate is set — and an
    // object with matrixAutoUpdate = false (the common "static object"
    // optimisation) never sets it, so a frozen handle under a moved ancestor
    // would otherwise be framed at its stale position (adversarial review,
    // 2026-09-20, reproduced at THREE r185).
    handle.object.updateWorldMatrix(true, false, true);
    box.applyMatrix4(handle.object.matrixWorld);
  }

  box.getSize(_pad).multiplyScalar(padFraction);
  box.min.sub(_pad);
  box.max.add(_pad);
  return box;
}
