/**
 * Fork patch [selection] (ticket 07, fork patch 2): a SELECTION-AWARE sort
 * for the paged mesh — the spike's `[selection]` promoted as a PURE .ts
 * SIBLING (D20) with ONE declared divergence from the spike (owner ruling
 * 07-S1): deselected splats leave the draw through the SORT, not the vertex
 * shader. The vendored JS stays byte-identical; this module reaches private
 * internals of the PINNED three version from outside. FORK.md's [selection]
 * entry inventories every field; the re-diff procedure re-verifies them.
 *
 * Mechanism: the selection flag lives in the `center.w` lane the paged
 * upload already zeroes (PagedMesh.setSelection writes it). The vendored
 * CountingSort exposes `setBinNode` as its door: this patch installs a bin
 * function that sends every DESELECTED row (w < 0.5 — deselected AND empty
 * capacity slots alike) to the RESERVED last bin, so the sort scatters them
 * to the tail of the order buffer; the depth bins shrink from 4096 to 4095
 * (BIN_COUNT − 1), a stated, negligible cost. The backend then sets the
 * geometry's public `instanceCount` to the selected count: deselected rows
 * are never drawn and never enter the vertex shader at all — an improvement
 * over the spike's degenerate-quad cull, which still ran every deselected
 * instance through the vertex node. The spike audit's defect (its bin
 * function ignored `center.w`, so deselected splats stayed in draw order)
 * is what this patch closes.
 *
 * Both sort paths are covered: the GPU compute nodes (rebuilt through
 * `setBinNode`; the vendored constructor's originals are disposed first so
 * nothing leaks) and the WebGL2 CPU path (`_sortCPU`, replaced on the
 * INSTANCE with a version that reads the vec4 center storage array — its w
 * lane — instead of the source position attribute).
 *
 * Re-traversal hysteresis (owner ruling 07-S5): the LOD driver re-traverses
 * on the SAME camera-motion thresholds the vendored `_needsSort` uses —
 * mirrored here as constants (like BIN_COUNT in capacity-guard.ts) and
 * re-verified at every re-diff — so traversal and sort re-trigger in step
 * and no new number is invented.
 */
import { instanceIndex, max, select, uint, vec4 } from "three/tsl";
import type { GaussianSplatMesh } from "../GaussianSplatMesh.js";
import { forkInternalsMissingIn } from "./dispose.js";

/** Mirrors GaussianSplatMesh.js:47 `const BIN_COUNT = 4096` (private constant
 *  of the pinned vendored file — also mirrored by capacity-guard.ts). */
export const SORT_BIN_COUNT = 4096;
/** Mirrors GaussianSplatMesh.js:49-50 — the vendored `_needsSort` motion
 *  thresholds (owner ruling 07-S5: the LOD driver reuses them). */
export const SORT_DIRECTION_THRESHOLD = 0.9995;
export const SORT_POSITION_THRESHOLD = 0.0025;
/** The reserved bin: deselected rows sort here, at the tail of the order. */
export const DESELECTED_BIN = SORT_BIN_COUNT - 1;
/** Depth bins available to selected rows. */
export const DEPTH_BIN_COUNT = SORT_BIN_COUNT - 1;

function forkInternalsMissing(what: string): never {
  return forkInternalsMissingIn("selection", what);
}

interface UniformLike<T> {
  value: T;
}

interface TslNode {
  element(index: unknown): unknown;
}

interface SortInternals {
  setBinNode(binNode: () => unknown): void;
  computeCPU(binFn: (i: number) => number): void;
  binCount: number;
  count: number;
  _resetNode: { dispose(): void } | null;
  _histogramNode: { dispose(): void } | null;
  _prefixNode: { dispose(): void } | null;
  _scatterNode: { dispose(): void } | null;
}

/**
 * Install the selection-aware sort on a paged GaussianSplatMesh. Call ONCE,
 * right after construction and BEFORE the first render (the vendored
 * compute nodes it replaces have no GPU resources until first compute).
 * Returns the center storage array reader the backend's CPU sort uses.
 */
export function installSelectionSort(mesh: GaussianSplatMesh): void {
  const record = mesh as unknown as Record<string, unknown>;
  const sort = record._sort as SortInternals | undefined;
  if (sort === undefined || sort === null || typeof sort.setBinNode !== "function" || typeof sort.computeCPU !== "function") {
    forkInternalsMissing("mesh._sort.setBinNode / computeCPU");
  }
  if (sort.binCount !== SORT_BIN_COUNT) {
    forkInternalsMissing(`mesh._sort.binCount === ${SORT_BIN_COUNT} (got ${sort.binCount})`);
  }
  const buffers = record._buffers as Record<string, unknown> | undefined;
  const centerRead = buffers?.centerRead as TslNode | undefined;
  if (centerRead === undefined || typeof centerRead.element !== "function") forkInternalsMissing("mesh._buffers.centerRead");
  const centerAttr = (centerRead as unknown as { value?: { array?: unknown } }).value;
  if (centerAttr === undefined || !(centerAttr.array instanceof Float32Array)) forkInternalsMissing("mesh._buffers.centerRead.value.array");
  const sortMatrix = record._sortMatrix as UniformLike<{ elements: Float32Array | number[] }> & TslNode | undefined;
  const sortDepthRange = record._sortDepthRange as UniformLike<{ x: number; y: number }> & TslNode | undefined;
  if (sortMatrix === undefined || sortMatrix.value === undefined) forkInternalsMissing("mesh._sortMatrix");
  if (sortDepthRange === undefined || sortDepthRange.value === undefined) forkInternalsMissing("mesh._sortDepthRange");
  for (const key of ["_resetNode", "_histogramNode", "_prefixNode", "_scatterNode"] as const) {
    const node = sort[key];
    if (node === null || typeof node !== "object" || typeof node.dispose !== "function") {
      forkInternalsMissing(`mesh._sort.${key}.dispose`);
    }
  }
  if (typeof record._sortCPU !== "function") forkInternalsMissing("mesh._sortCPU");

  // ── GPU path: dispose the constructor's compute nodes, rebuild with the
  //    selection-aware bin function (same depth math as the vendored bin
  //    node, over DEPTH_BIN_COUNT bins; w < 0.5 → DESELECTED_BIN). ──
  for (const key of ["_resetNode", "_histogramNode", "_prefixNode", "_scatterNode"] as const) {
    sort[key]!.dispose();
  }
  // TSL nodes are typed loosely on purpose: @types/three's node typings do
  // not model the vendored storage nodes' chained accessors.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const tsl = { instanceIndex, max, select, uint, vec4 } as unknown as Record<string, (...a: any[]) => any>;
  const centerReadAny = centerRead as unknown as any;
  const sortMatrixAny = sortMatrix as unknown as any;
  const sortDepthRangeAny = sortDepthRange as unknown as any;
  sort.setBinNode(() => {
    const centerFull = centerReadAny.element(tsl.instanceIndex).toVar("centerFull");
    const viewCenter = sortMatrixAny.mul(tsl.vec4!(centerFull.xyz, 1)).xyz.toVar("viewCenter");
    const depth = viewCenter.z.negate().toVar("depth");
    const range = tsl.max!(sortDepthRangeAny.y.sub(sortDepthRangeAny.x), 0.0001).toVar("range");
    const normalized = depth.sub(sortDepthRangeAny.x).div(range).clamp(0, 1).toVar("normalized");
    const depthBin = tsl.uint!(normalized.mul(DEPTH_BIN_COUNT - 1)).toVar("depthBin");
    const selectedBin = tsl.uint!(DEPTH_BIN_COUNT - 1).sub(depthBin);
    return tsl.select!(centerFull.w.lessThan(0.5), tsl.uint!(DESELECTED_BIN), selectedBin);
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // ── CPU path (WebGL2 fallback): same bins, from the vec4 center array. ──
  const centers = centerAttr as { array: Float32Array };
  record._sortCPU = function selectionSortCPU(this: unknown): void {
    const data = centers.array; // re-read per call: the PBO setup may replace it
    const matrix = sortMatrix.value.elements;
    const nearDepth = sortDepthRange.value.x;
    const range = Math.max(sortDepthRange.value.y - nearDepth, 0.0001);
    const scale = (DEPTH_BIN_COUNT - 1) / range;
    sort.computeCPU((i: number): number => {
      const i4 = i * 4;
      if (data[i4 + 3]! < 0.5) return DESELECTED_BIN;
      const depth = -(matrix[2]! * data[i4]! + matrix[6]! * data[i4 + 1]! + matrix[10]! * data[i4 + 2]! + matrix[14]!);
      const depthBin = Math.min(DEPTH_BIN_COUNT - 1, Math.max(0, Math.floor((depth - nearDepth) * scale)));
      return DEPTH_BIN_COUNT - 1 - depthBin;
    });
  };
}
