import {
  GEOMETRY_EPSILON,
  pointInPolygon,
  polygonAabb,
  polygonsOverlap,
} from "./geometry";
import type { Vec2 } from "./types";

export interface PartitionRegion {
  min: Vec2;
  max: Vec2;
}

export interface PartitionOptions {
  budget: number;
  minCameras?: number;
  maxDepth?: number;
}

/**
 * A non-fatal deviation surfaced to the user (Plan 22 D-3/D-7). Never silent.
 * - `uneven-split`: a strip/row could not reach its quota of interior cuts; the
 *   cell count for that strip was reduced. `detail` is `"<wanted>-><got>"`.
 * - `no-interior-cut`: no interior cut existed at all; the whole run is one cell.
 * - `partial`: the remainder cell — fewer than `budget` cameras by construction.
 * - `clip-split`: a rectangle clipped into multiple polygon pieces (polygon regions).
 */
export interface PartitionFlag {
  kind: "uneven-split" | "no-interior-cut" | "partial" | "clip-split";
  detail?: string;
}

export interface PartitionRect {
  min: Vec2;
  max: Vec2;
  cameraCount: number;
  depth: number;
  /** Legacy field from the recursive splitter; unused by the rank partitioner. */
  stoppedBy?: "minCameras" | "maxDepth" | "degenerate";
  flags?: PartitionFlag[];
}

export interface PartitionResult {
  rects: PartitionRect[];
  overBudget: PartitionRect[];
}

export interface PartitionPolygon {
  polygon2d: Vec2[];
  cameraCount: number;
  depth: number;
  /** Legacy field from the recursive splitter; unused by the rank partitioner. */
  stoppedBy?: PartitionRect["stoppedBy"];
  flags?: PartitionFlag[];
}

export interface PartitionBoundaryResult {
  polygons: PartitionPolygon[];
  overBudget: PartitionPolygon[];
}

export class InvalidPartitionBoundaryError extends Error {
  override readonly name = "InvalidPartitionBoundaryError";
}

export class PartitionBoundaryDecompositionError extends Error {
  override readonly name = "PartitionBoundaryDecompositionError";
}

type Axis = 0 | 1;

function clonePoint(point: Vec2): Vec2 {
  return [point[0], point[1]];
}

function pointsEqual(first: Vec2, second: Vec2): boolean {
  return first[0] === second[0] && first[1] === second[1];
}

function signedPolygonArea(polygon: readonly Vec2[]): number {
  let twiceArea = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const next = (index + 1) % polygon.length;
    twiceArea += polygon[index][0] * polygon[next][1] - polygon[next][0] * polygon[index][1];
  }
  return twiceArea / 2;
}

function polygonAreaSummandMagnitude(polygon: readonly Vec2[]): number {
  let twiceMagnitude = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const next = (index + 1) % polygon.length;
    twiceMagnitude += Math.abs(polygon[index][0] * polygon[next][1])
      + Math.abs(polygon[next][0] * polygon[index][1]);
  }
  return twiceMagnitude / 2;
}

function cross(origin: Vec2, first: Vec2, second: Vec2): number {
  return (
    (first[0] - origin[0]) * (second[1] - origin[1])
    - (first[1] - origin[1]) * (second[0] - origin[0])
  );
}

function pointOnSegment(point: Vec2, start: Vec2, end: Vec2, epsilon: number): boolean {
  if (Math.abs(cross(start, end, point)) > epsilon) return false;
  return (
    point[0] >= Math.min(start[0], end[0]) - epsilon
    && point[0] <= Math.max(start[0], end[0]) + epsilon
    && point[1] >= Math.min(start[1], end[1]) - epsilon
    && point[1] <= Math.max(start[1], end[1]) + epsilon
  );
}

function segmentsIntersectOrTouch(
  aStart: Vec2,
  aEnd: Vec2,
  bStart: Vec2,
  bEnd: Vec2,
  epsilon: number,
): boolean {
  const a = cross(aStart, aEnd, bStart);
  const b = cross(aStart, aEnd, bEnd);
  const c = cross(bStart, bEnd, aStart);
  const d = cross(bStart, bEnd, aEnd);
  if (
    ((a > epsilon && b < -epsilon) || (a < -epsilon && b > epsilon))
    && ((c > epsilon && d < -epsilon) || (c < -epsilon && d > epsilon))
  ) {
    return true;
  }
  return (
    (Math.abs(a) <= epsilon && pointOnSegment(bStart, aStart, aEnd, epsilon))
    || (Math.abs(b) <= epsilon && pointOnSegment(bEnd, aStart, aEnd, epsilon))
    || (Math.abs(c) <= epsilon && pointOnSegment(aStart, bStart, bEnd, epsilon))
    || (Math.abs(d) <= epsilon && pointOnSegment(aEnd, bStart, bEnd, epsilon))
  );
}

function polygonScale(polygon: readonly Vec2[]): number {
  const bounds = polygonAabb(polygon);
  return Math.max(1, bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]);
}

function polygonIsSimple(polygon: readonly Vec2[]): boolean {
  if (polygon.length < 3) return false;
  const epsilon = GEOMETRY_EPSILON * polygonScale(polygon);
  for (let index = 0; index < polygon.length; index += 1) {
    if (pointsEqual(polygon[index], polygon[(index + 1) % polygon.length])) return false;
  }
  for (let first = 0; first < polygon.length; first += 1) {
    const firstNext = (first + 1) % polygon.length;
    for (let second = first + 1; second < polygon.length; second += 1) {
      const secondNext = (second + 1) % polygon.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (segmentsIntersectOrTouch(
        polygon[first],
        polygon[firstNext],
        polygon[second],
        polygon[secondNext],
        epsilon,
      )) return false;
    }
  }
  return true;
}

/** Validate the public boundary contract without importing planner or UI code. */
export function validatePartitionBoundary(boundary: readonly Vec2[]): void {
  if (boundary.length < 3) {
    throw new InvalidPartitionBoundaryError("partition boundary requires at least three vertices");
  }
  for (const point of boundary) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
      throw new InvalidPartitionBoundaryError("partition boundary coordinates must be finite");
    }
  }
  const scale = polygonScale(boundary);
  if (Math.abs(signedPolygonArea(boundary)) <= GEOMETRY_EPSILON * scale * scale) {
    throw new InvalidPartitionBoundaryError("partition boundary must have non-zero area");
  }
  if (!polygonIsSimple(boundary)) {
    throw new InvalidPartitionBoundaryError("partition boundary must be a simple polygon");
  }
}

function compareNumbers(first: number, second: number): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function validateCameraUV(cameraUV: Float64Array): void {
  if (cameraUV.length % 2 !== 0) {
    throw new RangeError("cameraUV length must be divisible by 2");
  }
  for (const coordinate of cameraUV) {
    if (!Number.isFinite(coordinate)) {
      throw new RangeError("cameraUV coordinates must be finite");
    }
  }
}

function validateRegion(region: PartitionRegion): void {
  if (
    !Number.isFinite(region.min[0])
    || !Number.isFinite(region.min[1])
    || !Number.isFinite(region.max[0])
    || !Number.isFinite(region.max[1])
  ) {
    throw new RangeError("region coordinates must be finite");
  }
  if (region.min[0] >= region.max[0] || region.min[1] >= region.max[1]) {
    throw new RangeError("region min must be strictly less than region max on both axes");
  }
}

/** Half-open containment, except at the root region's closed outer edge. */
export function partitionRectContains(
  rect: PartitionRegion,
  point: Vec2,
  rootRegion: PartitionRegion,
): boolean {
  return (
    rect.min[0] <= point[0]
    && (point[0] < rect.max[0] || (rect.max[0] === rootRegion.max[0] && point[0] <= rect.max[0]))
    && rect.min[1] <= point[1]
    && (point[1] < rect.max[1] || (rect.max[1] === rootRegion.max[1] && point[1] <= rect.max[1]))
  );
}

/**
 * Every rank r in [minCameras, n-minCameras] that is a valid cut: coords[r-1] < coords[r]
 * (no tie) and the midpoint is a strictly-interior representable plane — never on a camera
 * coordinate or the closed root edge (Plan 22 D-3). r itself is bounded so the first cut is
 * >= minCameras from rank 0 and the last is >= minCameras from rank n.
 */
function validCutRanks(
  coords: readonly number[],
  axisMin: number,
  axisMax: number,
  minCameras: number,
): number[] {
  const n = coords.length;
  const ranks: number[] = [];
  for (let r = Math.max(1, minCameras); r <= n - minCameras; r += 1) {
    if (coords[r - 1] === coords[r]) continue;
    const plane = coords[r - 1] / 2 + coords[r] / 2;
    if (plane > coords[r - 1] && plane < coords[r] && plane > axisMin && plane < axisMax) ranks.push(r);
  }
  return ranks;
}

interface CutSelection {
  /** Placed rank boundaries (strictly increasing; excludes 0 and n). */
  ranks: number[];
  /** Midpoint cut plane per placed rank. */
  planes: number[];
  /** True when fewer than `cutCount` cuts could be placed. */
  reduced: boolean;
}

/**
 * Place up to `cutCount` equal-count cuts, choosing the JOINTLY optimal set (code-review
 * #3 — greedy nearest-placement could block a later cut and over-reduce). Two objectives,
 * in order: (1) maximise the number of cuts placed — the max feasible count under the
 * >= minCameras spacing; (2) among sets of that size, minimise total deviation from the
 * evenly-spaced ideal ranks, so cells stay balanced. Solved with a spacing-constrained DP
 * over the valid cut ranks (O(candidates · M) via a running prefix-minimum).
 */
function placeCuts(
  coords: readonly number[],
  cutCount: number,
  axisMin: number,
  axisMax: number,
  minCameras: number,
): CutSelection {
  const empty = { ranks: [], planes: [], reduced: cutCount > 0 };
  if (cutCount <= 0) return { ranks: [], planes: [], reduced: false };
  let candidates = validCutRanks(coords, axisMin, axisMax, minCameras);
  if (candidates.length === 0) return empty;

  // Bound the DP table: a pathological huge strip (e.g. 1e6 cameras with a high quota)
  // would allocate ~cuts * candidates entries and OOM (fix-review #2). Subsample the
  // candidates uniformly so the table stays bounded; the placement is then approximate
  // and the strip is flagged via `reduced`. Real data (<<4M work) never triggers this.
  const MAX_DP_WORK = 4_000_000;
  let bounded = false;
  if (candidates.length * cutCount > MAX_DP_WORK) {
    const keep = Math.max(cutCount + 1, Math.floor(MAX_DP_WORK / cutCount));
    if (keep < candidates.length) {
      const sampled: number[] = [];
      for (let i = 0; i < keep; i += 1) {
        sampled.push(candidates[Math.floor((i * candidates.length) / keep)]);
      }
      candidates = sampled;
      bounded = true;
    }
  }

  // (1) Max feasible cut count: earliest-first greedy with >= minCameras spacing maximises it.
  let feasible = 0;
  let last = Number.NEGATIVE_INFINITY;
  for (const rank of candidates) {
    if (rank - last >= minCameras) {
      feasible += 1;
      last = rank;
      if (feasible === cutCount) break;
    }
  }
  const cuts = Math.min(cutCount, feasible);
  if (cuts === 0) return empty;

  // (2) DP: place exactly `cuts` cuts minimising sum |candidate - ideal|. First/last cut
  // boundaries hold by construction (candidates lie in [minCameras, n-minCameras]).
  const n = coords.length;
  const ideals = Array.from({ length: cuts }, (_, j) => ((j + 1) * n) / (cuts + 1));
  const size = candidates.length;
  const cost = Array.from({ length: cuts + 1 }, () => new Array<number>(size).fill(Infinity));
  const from = Array.from({ length: cuts + 1 }, () => new Array<number>(size).fill(-1));
  for (let i = 0; i < size; i += 1) cost[1][i] = Math.abs(candidates[i] - ideals[0]);
  for (let level = 2; level <= cuts; level += 1) {
    let pointer = 0;
    let bestCost = Infinity;
    let bestIndex = -1;
    for (let i = 0; i < size; i += 1) {
      while (pointer < i && candidates[pointer] <= candidates[i] - minCameras) {
        if (cost[level - 1][pointer] < bestCost) {
          bestCost = cost[level - 1][pointer];
          bestIndex = pointer;
        }
        pointer += 1;
      }
      if (bestIndex >= 0) {
        cost[level][i] = bestCost + Math.abs(candidates[i] - ideals[level - 1]);
        from[level][i] = bestIndex;
      }
    }
  }
  let endIndex = -1;
  let endCost = Infinity;
  for (let i = 0; i < size; i += 1) {
    if (cost[cuts][i] < endCost) { endCost = cost[cuts][i]; endIndex = i; }
  }
  const ranks: number[] = [];
  for (let level = cuts, i = endIndex; level >= 1 && i >= 0; i = from[level][i], level -= 1) {
    ranks.push(candidates[i]);
  }
  ranks.reverse();
  const planes = ranks.map((rank) => coords[rank - 1] / 2 + coords[rank] / 2);
  return { ranks, planes, reduced: cuts < cutCount || bounded };
}

/**
 * Apportion `cells` cells among strips proportional to each strip's camera count by
 * the largest-remainder (Hamilton) method — every strip gets >= 1 cell and the total
 * is exactly `cells`. Coupling the row count to ACHIEVED strip sizes stops a displaced
 * strip boundary from leaving a strip under-celled and over budget (code-review #2);
 * true largest-remainder (not round-robin) so a heavily-loaded strip is not starved
 * (fix-review #1). Assumes `cells >= strips` (guaranteed: stripCount <= cellCount).
 */
function apportion(stripCameraCounts: readonly number[], cells: number): number[] {
  const strips = stripCameraCounts.length;
  const totalCameras = stripCameraCounts.reduce((sum, value) => sum + value, 0) || 1;
  const ideal = stripCameraCounts.map((count) => (count / totalCameras) * cells);
  const quotas = ideal.map((value) => Math.max(1, Math.floor(value)));
  let assigned = quotas.reduce((sum, value) => sum + value, 0);
  const byRemainder = ideal
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }));
  // Add residual cells to the largest fractional remainders.
  const largestFirst = [...byRemainder].sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let cursor = 0; assigned < cells; cursor += 1) {
    quotas[largestFirst[cursor % strips].index] += 1;
    assigned += 1;
  }
  // Over-assignment can only come from raising tiny strips to the >= 1 floor; take the
  // excess back from the smallest-remainder strips that still have more than one cell.
  // Loop until the total is exact (fix-review #1: a fixed iteration cap could stop early
  // when the excess must come from just a few large strips). Terminates because
  // assigned > cells >= strips implies some quota is still above 1.
  const smallestFirst = [...byRemainder].sort((a, b) => a.fraction - b.fraction || a.index - b.index);
  while (assigned > cells) {
    let removed = false;
    for (const { index } of smallestFirst) {
      if (assigned === cells) break;
      if (quotas[index] > 1) {
        quotas[index] -= 1;
        assigned -= 1;
        removed = true;
      }
    }
    if (!removed) break;
  }
  return quotas;
}

/** The p21-polyregion 4-ULP coincidence tolerance, mirrored so canonicalization matches it. */
function ordinateTolerance(first: number, second: number): number {
  return Number.EPSILON * Math.max(1, Math.abs(first), Math.abs(second)) * 4;
}

interface RowPlane {
  strip: number;
  value: number;
}

/**
 * Cross-strip row planes that land within 4 ULP of each other would need a shared
 * boundary we do NOT synthesize. Snapping them to one value proved fragile — it either
 * collapsed a same-strip row or rounded a camera across a boundary (code-review #1,
 * fix-review #2/#3). Such coincidences do not occur on real, spread-out camera data
 * (coordinates span hundreds of units); if they ever do, the affected strips are
 * FLAGGED rather than emitting a hairline-mismatched shared edge or silently corrupting
 * ownership (no silent caps). Returns the set of strips to flag.
 */
function strandedRowPlaneStrips(planes: readonly RowPlane[]): Set<number> {
  const stranded = new Set<number>();
  const sorted = [...planes].sort((first, second) => first.value - second.value);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (
      previous.strip !== current.strip
      && current.value - previous.value <= ordinateTolerance(previous.value, current.value)
    ) {
      stranded.add(previous.strip);
      stranded.add(current.strip);
    }
  }
  return stranded;
}

function centroid(rect: PartitionRect, axis: Axis): number {
  return rect.min[axis] / 2 + rect.max[axis] / 2;
}

function rowMajor(rects: readonly PartitionRect[]): PartitionRect[] {
  if (rects.length < 2) return [...rects];
  const smallestHeight = Math.min(...rects.map((rect) => rect.max[1] - rect.min[1]));
  const rowThreshold = smallestHeight / 2;
  const byVerticalCentroid = [...rects].sort((first, second) =>
    compareNumbers(centroid(first, 1), centroid(second, 1))
    || compareNumbers(centroid(first, 0), centroid(second, 0))
    || compareNumbers(first.min[1], second.min[1])
    || compareNumbers(first.min[0], second.min[0]),
  );
  const rows: PartitionRect[][] = [];
  let rowStart = Number.NaN;
  for (const rect of byVerticalCentroid) {
    const verticalCentroid = centroid(rect, 1);
    if (rows.length === 0 || verticalCentroid - rowStart >= rowThreshold) {
      rows.push([]);
      rowStart = verticalCentroid;
    }
    rows[rows.length - 1].push(rect);
  }
  for (const row of rows) {
    row.sort((first, second) =>
      compareNumbers(centroid(first, 0), centroid(second, 0))
      || compareNumbers(first.min[1], second.min[1])
      || compareNumbers(first.min[0], second.min[0]),
    );
  }
  return rows.flat();
}

/**
 * Tile a region into cells of ~`budget` cameras each (Plan 22). `budget` is now the
 * TARGET cameras-per-chunk: the region is split into N = ceil(camerasInRegion / budget)
 * cells via quota-weighted rank strips (VastGaussian progressive partitioning), with
 * one flagged `partial` remainder cell. Cuts are chosen jointly on strictly-interior
 * planes; near-coincident cross-strip ordinates are canonicalized in a batch.
 */
export function partitionRegion(
  region: PartitionRegion,
  cameraUV: Float64Array,
  options: PartitionOptions,
): PartitionResult {
  validateRegion(region);
  validateCameraUV(cameraUV);
  if (!Number.isInteger(options.budget) || options.budget <= 0) {
    throw new RangeError("budget must be a positive integer");
  }
  const target = options.budget;
  const minCameras = options.minCameras ?? 30;
  if (!Number.isInteger(minCameras) || minCameras <= 0) {
    throw new RangeError("minCameras must be a positive integer");
  }
  // options.maxDepth is accepted for backward compatibility and ignored by the rank partitioner.

  const rootRegion: PartitionRegion = {
    min: [region.min[0], region.min[1]],
    max: [region.max[0], region.max[1]],
  };
  const rootCameras: number[] = [];
  for (let cameraIndex = 0; cameraIndex < cameraUV.length / 2; cameraIndex += 1) {
    const point: Vec2 = [cameraUV[cameraIndex * 2], cameraUV[cameraIndex * 2 + 1]];
    if (partitionRectContains(rootRegion, point, rootRegion)) rootCameras.push(cameraIndex);
  }
  const total = rootCameras.length;

  // Count via the SAME predicate the recount invariant uses, so cameraCount always
  // matches an independent recount (p21-partition "independent camera recount").
  const buildRect = (min: Vec2, max: Vec2, flags: PartitionFlag[]): PartitionRect => {
    const rect: PartitionRegion = { min, max };
    let count = 0;
    for (const cameraIndex of rootCameras) {
      const point: Vec2 = [cameraUV[cameraIndex * 2], cameraUV[cameraIndex * 2 + 1]];
      if (partitionRectContains(rect, point, rootRegion)) count += 1;
    }
    return { min, max, cameraCount: count, depth: 0, ...(flags.length > 0 ? { flags } : {}) };
  };
  const whole = (flags: PartitionFlag[]): PartitionResult => {
    const rects = [buildRect(
      [rootRegion.min[0], rootRegion.min[1]],
      [rootRegion.max[0], rootRegion.max[1]],
      flags,
    )];
    return { rects, overBudget: rects.filter((rect) => rect.cameraCount > target) };
  };

  if (total === 0) return whole([]);
  const cellCount = Math.ceil(total / target);
  if (cellCount <= 1) return whole([]);

  const longAxis: Axis =
    rootRegion.max[0] - rootRegion.min[0] >= rootRegion.max[1] - rootRegion.min[1] ? 0 : 1;
  const shortAxis: Axis = longAxis === 0 ? 1 : 0;
  const longSpan = rootRegion.max[longAxis] - rootRegion.min[longAxis];
  const shortSpan = rootRegion.max[shortAxis] - rootRegion.min[shortAxis];
  // Guard non-finite / overflowing spans (code-review #5): a square-ish fallback when
  // the aspect ratio is not a finite positive number.
  const aspect = Number.isFinite(longSpan) && Number.isFinite(shortSpan) && shortSpan > 0
    ? longSpan / shortSpan
    : 1;
  const estimate = Math.round(Math.sqrt(cellCount * aspect));
  const stripCount = Math.max(
    1,
    Math.min(cellCount, Number.isFinite(estimate) ? estimate : Math.round(Math.sqrt(cellCount))),
  );

  // Strips at EQUAL camera count along the long axis (VastGaussian); rows within each
  // strip at equal camera count. Cells come out near-equal ~ total/cellCount ~ target.
  const byLong = [...rootCameras].sort(
    (first, second) => cameraUV[first * 2 + longAxis] - cameraUV[second * 2 + longAxis],
  );
  const longCoords = byLong.map((cameraIndex) => cameraUV[cameraIndex * 2 + longAxis]);
  const stripCuts = placeCuts(
    longCoords, stripCount - 1, rootRegion.min[longAxis], rootRegion.max[longAxis], minCameras,
  );
  const stripBounds = [rootRegion.min[longAxis], ...stripCuts.planes, rootRegion.max[longAxis]];
  const stripRankBounds = [0, ...stripCuts.ranks, byLong.length];
  const numStrips = stripBounds.length - 1;
  const stripReduced = stripCuts.reduced;

  // Apportion cellCount cells among the ACHIEVED strips by their camera counts, so a
  // displaced/dropped strip boundary never leaves a strip under-celled + over budget
  // (code-review #2). Sum of quotas === cellCount ⇒ exact-N when nothing is dropped.
  const stripCounts: number[] = [];
  for (let strip = 0; strip < numStrips; strip += 1) {
    stripCounts.push(stripRankBounds[strip + 1] - stripRankBounds[strip]);
  }
  const quotas = apportion(stripCounts, cellCount);

  // Per strip, place equal-count row cuts; collect planes with strip + gap for canonicalization.
  const rowPlanesByStrip: number[][] = [];
  const rowReduced: boolean[] = [];
  const rowNoCut: boolean[] = [];
  const allRowPlanes: RowPlane[] = [];
  for (let strip = 0; strip < numStrips; strip += 1) {
    const quota = quotas[strip];
    if (quota <= 1) {
      rowPlanesByStrip.push([]);
      rowReduced.push(false);
      rowNoCut.push(false);
      continue;
    }
    const stripCameras = byLong.slice(stripRankBounds[strip], stripRankBounds[strip + 1]);
    const byShort = [...stripCameras].sort(
      (first, second) => cameraUV[first * 2 + shortAxis] - cameraUV[second * 2 + shortAxis],
    );
    const shortCoords = byShort.map((cameraIndex) => cameraUV[cameraIndex * 2 + shortAxis]);
    const cuts = placeCuts(
      shortCoords, quota - 1, rootRegion.min[shortAxis], rootRegion.max[shortAxis], minCameras,
    );
    rowPlanesByStrip.push(cuts.planes);
    rowReduced.push(cuts.reduced);
    rowNoCut.push(quota > 1 && cuts.planes.length === 0);
    for (const value of cuts.planes) allRowPlanes.push({ strip, value });
  }
  const stranded = strandedRowPlaneStrips(allRowPlanes);

  const emitted: PartitionRect[] = [];
  for (let strip = 0; strip < numStrips; strip += 1) {
    const longLo = stripBounds[strip];
    const longHi = stripBounds[strip + 1];
    const shortBounds = [
      rootRegion.min[shortAxis],
      ...rowPlanesByStrip[strip],
      rootRegion.max[shortAxis],
    ];
    const rows = shortBounds.length - 1;
    const flags: PartitionFlag[] = [];
    if (stripReduced || rowReduced[strip]) {
      const kind = rowNoCut[strip] ? "no-interior-cut" : "uneven-split";
      flags.push({ kind, detail: `${quotas[strip]}->${rows}` });
    } else if (stranded.has(strip)) {
      flags.push({ kind: "uneven-split", detail: "near-coincident-edge" });
    }
    for (let row = 0; row < rows; row += 1) {
      const min: Vec2 = [0, 0];
      const max: Vec2 = [0, 0];
      min[longAxis] = longLo;
      max[longAxis] = longHi;
      min[shortAxis] = shortBounds[row];
      max[shortAxis] = shortBounds[row + 1];
      emitted.push(buildRect(min, max, [...flags]));
    }
  }

  // Any cell still over the target (a strip that could not reach its row quota) is
  // flagged, never silent — and never mislabeled anything but a split failure (code-review #2).
  for (const rect of emitted) {
    const alreadyFlagged = (rect.flags ?? []).some(
      (flag) => flag.kind === "uneven-split" || flag.kind === "no-interior-cut",
    );
    if (rect.cameraCount > target && !alreadyFlagged) {
      rect.flags = [...(rect.flags ?? []), { kind: "uneven-split", detail: `${rect.cameraCount}>${target}` }];
    }
  }

  const rects = rowMajor(emitted);
  return { rects, overBudget: rects.filter((rect) => rect.cameraCount > target) };
}

interface ClipEdge {
  axis: Axis;
  bound: number;
  keepGreater: boolean;
}

function withoutConsecutiveDuplicates(polygon: readonly Vec2[]): Vec2[] {
  const result: Vec2[] = [];
  for (const point of polygon) {
    if (result.length === 0 || !pointsEqual(result[result.length - 1], point)) {
      result.push(clonePoint(point));
    }
  }
  if (result.length > 1 && pointsEqual(result[0], result[result.length - 1])) result.pop();
  return result;
}

function clipIntersection(start: Vec2, end: Vec2, edge: ClipEdge): Vec2 {
  const denominator = end[edge.axis] - start[edge.axis];
  if (denominator === 0) {
    throw new PartitionBoundaryDecompositionError("parallel segment crossed a clip edge");
  }
  const t = (edge.bound - start[edge.axis]) / denominator;
  const other: Axis = edge.axis === 0 ? 1 : 0;
  const point: Vec2 = [0, 0];
  point[edge.axis] = edge.bound;
  point[other] = start[other] + t * (end[other] - start[other]);
  return point;
}

function clipAgainstEdge(subject: readonly Vec2[], edge: ClipEdge): Vec2[] {
  if (subject.length === 0) return [];
  const output: Vec2[] = [];
  const inside = (point: Vec2): boolean => edge.keepGreater
    ? point[edge.axis] >= edge.bound
    : point[edge.axis] <= edge.bound;
  let start = subject[subject.length - 1];
  let startInside = inside(start);
  for (const end of subject) {
    const endInside = inside(end);
    if (endInside) {
      if (!startInside) output.push(clipIntersection(start, end, edge));
      output.push(clonePoint(end));
    } else if (startInside) {
      output.push(clipIntersection(start, end, edge));
    }
    start = end;
    startInside = endInside;
  }
  return withoutConsecutiveDuplicates(output);
}

function canonicalBoundaryIntersection(
  boundary: readonly Vec2[],
  axis: Axis,
  bound: number,
  approximateOther: number,
): number | undefined {
  const other: Axis = axis === 0 ? 1 : 0;
  const scale = polygonScale(boundary);
  const tolerance = GEOMETRY_EPSILON * scale * 16;
  let closest: number | undefined;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < boundary.length; index += 1) {
    const start = boundary[index];
    const end = boundary[(index + 1) % boundary.length];
    const denominator = end[axis] - start[axis];
    if (denominator === 0) continue;
    const t = (bound - start[axis]) / denominator;
    if (t < 0 || t > 1) continue;
    const value = start[other] + t * (end[other] - start[other]);
    const distance = Math.abs(value - approximateOther);
    if (distance <= tolerance && distance < closestDistance) {
      closest = value;
      closestDistance = distance;
    }
  }
  return closest;
}

/**
 * Force every subject-edge/clip-line intersection through the same expression
 * based on the original boundary edge. Adjacent rectangles therefore copy the
 * same floating-point endpoint even when earlier half-plane clips differed.
 */
function canonicalizeClipVertices(
  polygon: readonly Vec2[],
  boundary: readonly Vec2[],
  rect: PartitionRegion,
): Vec2[] {
  return withoutConsecutiveDuplicates(polygon.map((source) => {
    const point = clonePoint(source);
    const onMinX = point[0] === rect.min[0];
    const onMaxX = point[0] === rect.max[0];
    const onMinY = point[1] === rect.min[1];
    const onMaxY = point[1] === rect.max[1];
    if ((onMinX || onMaxX) && (onMinY || onMaxY)) return point;
    if (onMinX || onMaxX) {
      const value = canonicalBoundaryIntersection(boundary, 0, point[0], point[1]);
      if (value !== undefined) point[1] = value;
    }
    if (onMinY || onMaxY) {
      const value = canonicalBoundaryIntersection(boundary, 1, point[1], point[0]);
      if (value !== undefined) point[0] = value;
    }
    return point;
  }));
}

/** Sutherland-Hodgman: boundary is the subject; the convex rectangle is the clip window. */
function clipBoundaryToRect(boundary: readonly Vec2[], rect: PartitionRegion): Vec2[] {
  let clipped = boundary.map(clonePoint);
  for (const edge of [
    { axis: 0, bound: rect.min[0], keepGreater: true },
    { axis: 0, bound: rect.max[0], keepGreater: false },
    { axis: 1, bound: rect.min[1], keepGreater: true },
    { axis: 1, bound: rect.max[1], keepGreater: false },
  ] satisfies ClipEdge[]) {
    clipped = clipAgainstEdge(clipped, edge);
    if (clipped.length === 0) break;
  }
  return canonicalizeClipVertices(clipped, boundary, rect);
}

function pointKey(point: Vec2): string {
  const x = point[0] === 0 ? 0 : point[0];
  const y = point[1] === 0 ? 0 : point[1];
  return `${x},${y}`;
}

function edgeKey(start: string, end: string): string {
  return `${start}>${end}`;
}

/**
 * Sutherland-Hodgman represents disconnected intersections as one closed walk
 * whose artificial clip-edge connectors are traversed in both directions.
 * Split every walk edge at known vertices, cancel those reverse traversals,
 * then trace the remaining degree-two graph into its separate rings.
 */
function decomposeClippedWalk(walk: readonly Vec2[]): Vec2[][] {
  const normalized = withoutConsecutiveDuplicates(walk);
  if (normalized.length < 3) return [];
  const scale = polygonScale(normalized);
  const epsilon = GEOMETRY_EPSILON * scale * 16;
  const points = new Map<string, Vec2>();
  for (const point of normalized) points.set(pointKey(point), clonePoint(point));
  const directed = new Map<string, { start: string; end: string; count: number }>();
  const addEdge = (start: string, end: string): void => {
    if (start === end) return;
    const reverseKey = edgeKey(end, start);
    const reverse = directed.get(reverseKey);
    if (reverse && reverse.count > 0) {
      reverse.count -= 1;
      if (reverse.count === 0) directed.delete(reverseKey);
      return;
    }
    const key = edgeKey(start, end);
    const current = directed.get(key);
    if (current) current.count += 1;
    else directed.set(key, { start, end, count: 1 });
  };

  const nodes = [...points.entries()];
  for (let index = 0; index < normalized.length; index += 1) {
    const start = normalized[index];
    const end = normalized[(index + 1) % normalized.length];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) continue;
    const along = nodes
      .filter(([, point]) => pointOnSegment(point, start, end, epsilon))
      .map(([key, point]) => ({
        key,
        t: ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared,
      }))
      .sort((first, second) => first.t - second.t);
    for (let part = 0; part + 1 < along.length; part += 1) {
      addEdge(along[part].key, along[part + 1].key);
    }
  }

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const edge of directed.values()) {
    if (edge.count !== 1) {
      throw new PartitionBoundaryDecompositionError("clipped boundary has repeated directed edges");
    }
    const from = outgoing.get(edge.start) ?? [];
    from.push(edge.end);
    outgoing.set(edge.start, from);
    const to = incoming.get(edge.end) ?? [];
    to.push(edge.start);
    incoming.set(edge.end, to);
  }
  const active = new Set([...outgoing.keys(), ...incoming.keys()]);
  for (const key of active) {
    if ((outgoing.get(key)?.length ?? 0) !== 1 || (incoming.get(key)?.length ?? 0) !== 1) {
      throw new PartitionBoundaryDecompositionError("clipped boundary cannot be separated into degree-two rings");
    }
  }

  const unused = new Set(directed.keys());
  const pieces: Vec2[][] = [];
  while (unused.size > 0) {
    const firstEdge = directed.get(unused.values().next().value as string);
    if (!firstEdge) {
      throw new PartitionBoundaryDecompositionError("clipped boundary edge graph is incomplete");
    }
    const start = firstEdge.start;
    const ring: Vec2[] = [];
    let current = start;
    for (let step = 0; step <= directed.size; step += 1) {
      const point = points.get(current);
      const next = outgoing.get(current)?.[0];
      if (!point || !next) {
        throw new PartitionBoundaryDecompositionError("clipped boundary ring is open");
      }
      ring.push(clonePoint(point));
      unused.delete(edgeKey(current, next));
      current = next;
      if (current === start) break;
      if (step === directed.size) {
        throw new PartitionBoundaryDecompositionError("clipped boundary ring did not close");
      }
    }
    const cleaned = withoutConsecutiveDuplicates(ring);
    if (cleaned.length >= 3 && Math.abs(signedPolygonArea(cleaned)) > 0) {
      if (!polygonIsSimple(cleaned)) {
        throw new PartitionBoundaryDecompositionError("decomposed clip piece is not a simple polygon");
      }
      pieces.push(cleaned);
    }
  }
  for (let first = 0; first < pieces.length; first += 1) {
    for (let second = first + 1; second < pieces.length; second += 1) {
      if (polygonsOverlap(pieces[first], pieces[second])) {
        throw new PartitionBoundaryDecompositionError("decomposed clip pieces overlap");
      }
    }
  }
  const walkArea = Math.abs(signedPolygonArea(normalized));
  const pieceArea = pieces.reduce((total, piece) => total + Math.abs(signedPolygonArea(piece)), 0);
  const areaOperationCount = normalized.length
    + pieces.reduce((total, piece) => total + piece.length, 0)
    + pieces.length;
  const areaSummandMagnitude = polygonAreaSummandMagnitude(normalized)
    + pieces.reduce((total, piece) => total + polygonAreaSummandMagnitude(piece), 0);
  const areaTolerance = Number.EPSILON * areaOperationCount * areaSummandMagnitude;
  if (Math.abs(walkArea - pieceArea) > areaTolerance) {
    throw new PartitionBoundaryDecompositionError("decomposed clip pieces do not preserve clipped area");
  }
  return pieces;
}

function clippedPieces(boundary: readonly Vec2[], rect: PartitionRegion): Vec2[][] {
  const clipped = clipBoundaryToRect(boundary, rect);
  if (clipped.length < 3) return [];
  if (Math.abs(signedPolygonArea(clipped)) === 0) return [];
  if (polygonIsSimple(clipped)) return [clipped];
  return decomposeClippedWalk(clipped);
}

function isAxisAlignedRectangle(boundary: readonly Vec2[]): PartitionRegion | null {
  if (boundary.length !== 4) return null;
  const bounds = polygonAabb(boundary);
  const corners = new Set([
    `${bounds.min[0]},${bounds.min[1]}`,
    `${bounds.max[0]},${bounds.min[1]}`,
    `${bounds.max[0]},${bounds.max[1]}`,
    `${bounds.min[0]},${bounds.max[1]}`,
  ]);
  if (!boundary.every((point) => corners.has(pointKey(point)))) return null;
  for (let index = 0; index < boundary.length; index += 1) {
    const next = boundary[(index + 1) % boundary.length];
    if (boundary[index][0] !== next[0] && boundary[index][1] !== next[1]) return null;
  }
  return { min: clonePoint(bounds.min), max: clonePoint(bounds.max) };
}

function polygonBoundsCentroid(polygon: readonly Vec2[], axis: Axis): number {
  const bounds = polygonAabb(polygon);
  return bounds.min[axis] / 2 + bounds.max[axis] / 2;
}

function rowMajorPolygons(polygons: readonly PartitionPolygon[]): PartitionPolygon[] {
  if (polygons.length < 2) return [...polygons];
  const bounds = polygons.map((polygon) => polygonAabb(polygon.polygon2d));
  const byPolygon = new Map(polygons.map((polygon, index) => [polygon, bounds[index]]));
  const smallestHeight = Math.min(...bounds.map((value) => value.max[1] - value.min[1]));
  const rowThreshold = smallestHeight / 2;
  const vertical = [...polygons].sort((first, second) => {
    const firstBounds = byPolygon.get(first)!;
    const secondBounds = byPolygon.get(second)!;
    return compareNumbers(polygonBoundsCentroid(first.polygon2d, 1), polygonBoundsCentroid(second.polygon2d, 1))
      || compareNumbers(polygonBoundsCentroid(first.polygon2d, 0), polygonBoundsCentroid(second.polygon2d, 0))
      || compareNumbers(firstBounds.min[1], secondBounds.min[1])
      || compareNumbers(firstBounds.min[0], secondBounds.min[0]);
  });
  const rows: PartitionPolygon[][] = [];
  let rowStart = Number.NaN;
  for (const polygon of vertical) {
    const verticalCentroid = polygonBoundsCentroid(polygon.polygon2d, 1);
    if (rows.length === 0 || verticalCentroid - rowStart >= rowThreshold) {
      rows.push([]);
      rowStart = verticalCentroid;
    }
    rows[rows.length - 1].push(polygon);
  }
  for (const row of rows) {
    row.sort((first, second) => {
      const firstBounds = byPolygon.get(first)!;
      const secondBounds = byPolygon.get(second)!;
      return compareNumbers(polygonBoundsCentroid(first.polygon2d, 0), polygonBoundsCentroid(second.polygon2d, 0))
        || compareNumbers(firstBounds.min[1], secondBounds.min[1])
        || compareNumbers(firstBounds.min[0], secondBounds.min[0]);
    });
  }
  return rows.flat();
}

/** Partition a simple polygon by reusing the rectangle median recursion, then clipping its output. */
export function partitionBoundary(
  boundary: readonly Vec2[],
  cameraUV: Float64Array,
  options: PartitionOptions,
): PartitionBoundaryResult {
  validatePartitionBoundary(boundary);
  validateCameraUV(cameraUV);
  const rectangle = isAxisAlignedRectangle(boundary);
  if (rectangle) {
    const result = partitionRegion(rectangle, cameraUV, options);
    const polygons = result.rects.map((rect) => ({
      polygon2d: rectToPolygon(rect),
      cameraCount: rect.cameraCount,
      depth: rect.depth,
      ...(rect.flags === undefined ? {} : { flags: rect.flags }),
    }));
    return {
      polygons,
      overBudget: polygons.filter((polygon) => polygon.cameraCount > options.budget),
    };
  }

  const bounds = polygonAabb(boundary);
  const rootRegion: PartitionRegion = {
    min: clonePoint(bounds.min),
    max: clonePoint(bounds.max),
  };
  const inside: number[] = [];
  for (let offset = 0; offset < cameraUV.length; offset += 2) {
    const point: Vec2 = [cameraUV[offset], cameraUV[offset + 1]];
    if (pointInPolygon(point, boundary)) inside.push(point[0], point[1]);
  }
  const containedCameraUV = new Float64Array(inside);
  const rectangles = partitionRegion(rootRegion, containedCameraUV, options);
  const emitted: PartitionPolygon[] = [];
  for (const rect of rectangles.rects) {
    const pieces = clippedPieces(boundary, rect);
    for (const piece of pieces) {
      let cameraCount = rect.cameraCount;
      if (pieces.length > 1) {
        cameraCount = 0;
        for (let offset = 0; offset < containedCameraUV.length; offset += 2) {
          const point: Vec2 = [containedCameraUV[offset], containedCameraUV[offset + 1]];
          if (pointInPolygon(point, piece)) cameraCount += 1;
        }
      }
      const flags: PartitionFlag[] = [
        ...(rect.flags ?? []),
        ...(pieces.length > 1 ? [{ kind: "clip-split" as const }] : []),
      ];
      emitted.push({
        polygon2d: piece,
        cameraCount,
        depth: rect.depth,
        ...(flags.length > 0 ? { flags } : {}),
      });
    }
  }
  const polygons = rowMajorPolygons(emitted);
  return {
    polygons,
    overBudget: polygons.filter((polygon) => polygon.cameraCount > options.budget),
  };
}

function percentile(sorted: readonly number[], value: number): number {
  const position = ((sorted.length - 1) * value) / 100;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const fraction = position - lowerIndex;
  if (lowerIndex === upperIndex) return sorted[lowerIndex];
  return sorted[lowerIndex] * (1 - fraction) + sorted[upperIndex] * fraction;
}

/** The footprint to tile: independent per-axis camera-position percentiles. */
export function regionFromCameras(
  cameraUV: Float64Array,
  lowPercentile = 1,
  highPercentile = 99,
): PartitionRegion {
  validateCameraUV(cameraUV);
  if (cameraUV.length === 0) throw new RangeError("cameraUV must not be empty");
  if (!Number.isFinite(lowPercentile) || lowPercentile < 0 || lowPercentile > 100) {
    throw new RangeError("lowPercentile must be between 0 and 100");
  }
  if (!Number.isFinite(highPercentile) || highPercentile < 0 || highPercentile > 100) {
    throw new RangeError("highPercentile must be between 0 and 100");
  }
  if (lowPercentile >= highPercentile) {
    throw new RangeError("lowPercentile must be less than highPercentile");
  }
  const u: number[] = [];
  const v: number[] = [];
  for (let offset = 0; offset < cameraUV.length; offset += 2) {
    u.push(cameraUV[offset]);
    v.push(cameraUV[offset + 1]);
  }
  u.sort((first, second) => first - second);
  v.sort((first, second) => first - second);
  const region: PartitionRegion = {
    min: [percentile(u, lowPercentile), percentile(v, lowPercentile)],
    max: [percentile(u, highPercentile), percentile(v, highPercentile)],
  };
  if (region.min[0] >= region.max[0] || region.min[1] >= region.max[1]) {
    throw new RangeError("cameraUV percentile region must have non-zero extent on both axes");
  }
  return region;
}

/** Counter-clockwise rectangle corners copied verbatim from min/max. */
export function rectToPolygon(rect: PartitionRect): Vec2[] {
  return [
    [rect.min[0], rect.min[1]],
    [rect.max[0], rect.min[1]],
    [rect.max[0], rect.max[1]],
    [rect.min[0], rect.max[1]],
  ];
}
