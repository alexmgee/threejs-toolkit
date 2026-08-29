import { SH_BAND_WORDS } from "../GaussianSplatUtils.js";
import { ForkPatchError } from "./dispose.js";

const VEC4_BYTES_PER_SPLAT = 16;

/** Mirrors GaussianSplatMesh.js:47 (`const BIN_COUNT = 4096`) — a private
 *  constant of the pinned vendored file; inventoried in FORK.md's
 *  [capacity-guard] entry and re-verified at every re-diff. */
const SORT_BIN_COUNT = 4096;

/**
 * Largest single storage-buffer binding the mesh will create for this count
 * and SH degree. Per-splat vec4 buffers (center, covarianceA, covarianceB,
 * color, lazy sphericalHarmonicsContribution) are count×16; SH band d is
 * count×SH_BAND_WORDS[d]×4; the sort's histogram/offset buffers are
 * binCount×4 = 16,384 bytes REGARDLESS of splat count — below ~1k splats
 * they are the largest binding, so they are IN the max (adversarial-review
 * finding: the first cut called them "strictly smaller", an undercount for
 * every small scene). Order/bin are count×4 — always ≤ the vec4 buffers.
 */
export function maxStorageBindingBytes(count: number, shDegree: number): number {
  let maxBytes = Math.max(
    count * VEC4_BYTES_PER_SPLAT,
    SORT_BIN_COUNT * 4,
  );

  for (let d = 1; d <= shDegree; d++) {
    const words = SH_BAND_WORDS[d];
    if (words === undefined) {
      // NaN math would make the guard silently vacuous for out-of-range
      // degrees (review finding) — refuse loudly instead.
      throw new ForkPatchError(
        "unsupported-sh-degree",
        `no SH_BAND_WORDS entry for degree ${d} (max ${SH_BAND_WORDS.length - 1})`,
      );
    }
    const shBytes = count * words * 4;
    if (shBytes > maxBytes) {
      maxBytes = shBytes;
    }
  }

  return maxBytes;
}

export function assertStorageWithinLimit(
  count: number,
  shDegree: number,
  limitBytes: number,
): void {
  const needed = maxStorageBindingBytes(count, shDegree);
  if (needed > limitBytes) {
    throw new ForkPatchError(
      "over-capacity",
      `asset needs a ${needed}-byte storage binding; device maxStorageBufferBindingSize is ${limitBytes} (${count} splats, SH degree ${shDegree})`,
    );
  }
}
