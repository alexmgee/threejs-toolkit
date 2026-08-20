import type { ColmapDataset } from "./colmap";
import {
  frustumObservations,
  type CovisibilityGraph,
} from "./covisibility";
import {
  GEOMETRY_EPSILON,
  pointInPolygon,
  polygonAabb,
  unsignedPolygonDistance,
} from "./geometry";
import { cellAcceptor, isInteriorOrHalo, type CellAcceptor } from "./ownership";
import type {
  AbsoluteCountThreshold,
  Cell,
  FootprintCell,
  PlanningSettings,
  Vec2,
  Vec3,
} from "./types";

export interface CameraAssignment {
  assigned: string[];
  reasons: Record<string, string>;
}

export type CameraAssignments = Record<string, CameraAssignment>;

export interface GuaranteeAssignmentOptions {
  /**
   * Camera ground positions in dataset image order. Supplying these is required
   * when the dataset extrinsics are not already expressed in the cells' frame.
   */
  cameraPositions2d?: ArrayLike<number>;
  guaranteeCoverage?: boolean;
  includePositionFallback?: boolean;
  /** Original-space dataset whose poses and points are used for frustum projection. */
  frustumDataset?: ColmapDataset;
  /** Session cache shared by complete assignment and refinement passes. */
  frustumObservationCache?: FrustumObservationCache;
}

type ManualAction = "include" | "exclude";
type FrustumObservationProjector = typeof frustumObservations;

const DEFAULT_THRESHOLD: AbsoluteCountThreshold = { mode: "absoluteCount", value: 50 };

export class FrustumObservationCache {
  private dataset: ColmapDataset | null = null;
  private readonly observed = new Map<number, Uint32Array>();

  constructor(
    private readonly project: FrustumObservationProjector = frustumObservations,
  ) {}

  observations(
    dataset: ColmapDataset,
    imageIds: readonly number[],
  ): Map<number, Uint32Array> {
    if (this.dataset !== dataset) {
      this.dataset = dataset;
      this.observed.clear();
    }
    const uniqueIds = [...new Set(imageIds)];
    const missing = uniqueIds.filter((imageId) => !this.observed.has(imageId));
    if (missing.length > 0) {
      const projected = this.project(dataset, missing);
      for (const imageId of missing) {
        const value = projected.get(imageId);
        if (!value) {
          throw new RangeError(`Frustum projector omitted COLMAP image id: ${imageId}`);
        }
        this.observed.set(imageId, value);
      }
    }
    return new Map(uniqueIds.map((imageId) => [imageId, this.observed.get(imageId)!]));
  }

  clear(): void {
    this.dataset = null;
    this.observed.clear();
  }
}

function thresholdValue(threshold: AbsoluteCountThreshold): number {
  if (threshold.mode !== "absoluteCount") {
    throw new RangeError(`Unknown assignment threshold mode: ${String(threshold.mode)}`);
  }
  if (!Number.isFinite(threshold.value) || threshold.value < 0) {
    throw new RangeError(`Assignment threshold must be a non-negative finite number: ${threshold.value}`);
  }
  return threshold.value;
}

function manualAction(cell: Cell, imageName: string): ManualAction | undefined {
  let included = false;
  for (const value of cell.cameras.manualOverrides) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
    if (value.image !== imageName) continue;
    if (value.action === "exclude") return "exclude";
    if (value.action === "include") included = true;
  }
  return included ? "include" : undefined;
}

function requireFootprint(cell: Cell): FootprintCell {
  if (cell.kind !== "footprint") {
    throw new RangeError(`Camera assignment requires a footprint cell: ${cell.id}`);
  }
  return cell;
}

function countObservedInCell(
  dataset: ColmapDataset,
  observed: Uint32Array,
  cell: FootprintCell,
  acceptor: CellAcceptor,
  point: Vec3,
): number {
  let count = 0;
  for (const pointIndex of observed) {
    const offset = pointIndex * 3;
    if (offset + 2 >= dataset.points3D.positions.length) {
      throw new RangeError(`Observed point index is out of range: ${pointIndex}`);
    }
    const x = dataset.points3D.positions[offset];
    const y = dataset.points3D.positions[offset + 1];
    const z = dataset.points3D.positions[offset + 2];
    if (!acceptor.accepts(x, y, z)) continue;
    point[0] = x;
    point[1] = y;
    point[2] = z;
    if (isInteriorOrHalo(point, cell)) count += 1;
  }
  return count;
}

function polygonCentroid(polygon: readonly Vec2[]): Vec2 {
  let twiceArea = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const next = polygon[(index + 1) % polygon.length];
    const cross = polygon[index][0] * next[1] - next[0] * polygon[index][1];
    twiceArea += cross;
    weightedX += (polygon[index][0] + next[0]) * cross;
    weightedY += (polygon[index][1] + next[1]) * cross;
  }
  if (twiceArea !== 0) {
    return [weightedX / (3 * twiceArea), weightedY / (3 * twiceArea)];
  }
  let x = 0;
  let y = 0;
  for (const point of polygon) {
    x += point[0];
    y += point[1];
  }
  return [x / polygon.length, y / polygon.length];
}

function cameraPositionsFromExtrinsics(dataset: ColmapDataset): Float64Array {
  const result = new Float64Array(dataset.images.ids.length * 2);
  for (let imageIndex = 0; imageIndex < dataset.images.ids.length; imageIndex += 1) {
    const quaternionOffset = imageIndex * 4;
    const w0 = dataset.images.quaternions[quaternionOffset];
    const x0 = dataset.images.quaternions[quaternionOffset + 1];
    const y0 = dataset.images.quaternions[quaternionOffset + 2];
    const z0 = dataset.images.quaternions[quaternionOffset + 3];
    const norm = Math.hypot(w0, x0, y0, z0);
    if (norm === 0) {
      throw new RangeError(
        `Camera ${dataset.images.names[imageIndex]} has a zero quaternion; provide cameraPositions2d`,
      );
    }
    const w = w0 / norm;
    const x = x0 / norm;
    const y = y0 / norm;
    const z = z0 / norm;
    const r00 = 1 - 2 * (y * y + z * z);
    const r01 = 2 * (x * y - z * w);
    const r10 = 2 * (x * y + z * w);
    const r11 = 1 - 2 * (x * x + z * z);
    const r20 = 2 * (x * z - y * w);
    const r21 = 2 * (y * z + x * w);
    const translationOffset = imageIndex * 3;
    const tx = dataset.images.translations[translationOffset];
    const ty = dataset.images.translations[translationOffset + 1];
    const tz = dataset.images.translations[translationOffset + 2];
    result[imageIndex * 2] = -(r00 * tx + r10 * ty + r20 * tz);
    result[imageIndex * 2 + 1] = -(r01 * tx + r11 * ty + r21 * tz);
  }
  return result;
}

function automaticCount(reason: string | undefined): number | undefined {
  const match = /^(?:covisibility|frustum):(\d+)$/.exec(reason ?? "");
  return match ? Number(match[1]) : undefined;
}

function squaredDistance(first: Vec2, second: Vec2): number {
  const x = first[0] - second[0];
  const y = first[1] - second[1];
  return x * x + y * y;
}

function positionInsideOrOnCell(position: Vec2, cell: FootprintCell): boolean {
  return pointInPolygon(position, cell.polygon2d)
    || unsignedPolygonDistance(position, cell.polygon2d) <= GEOMETRY_EPSILON;
}

/**
 * Give every still-unassigned camera with track or fallback frustum evidence
 * one deterministic home. This deliberately runs after assignCameras has seen
 * the complete cell set; callers that assign cells incrementally must wait
 * until the round ends.
 *
 * The supplied assignments are updated in place and returned.
 */
export function guaranteeAssignments(
  dataset: ColmapDataset,
  graph: CovisibilityGraph,
  cells: readonly Cell[],
  assignments: CameraAssignments,
  options: GuaranteeAssignmentOptions = {},
): CameraAssignments {
  if (options.guaranteeCoverage === false) return assignments;
  const footprintCells = [...cells].map(requireFootprint).sort((first, second) =>
    first.id < second.id ? -1 : first.id > second.id ? 1 : 0,
  );
  if (footprintCells.length === 0) return assignments;
  for (const cell of footprintCells) {
    if (!assignments[cell.id]) {
      throw new RangeError(`Missing camera assignments for cell: ${cell.id}`);
    }
  }
  if (
    (options.frustumDataset === undefined)
    !== (options.frustumObservationCache === undefined)
  ) {
    throw new RangeError(
      "frustumDataset and frustumObservationCache must be supplied together",
    );
  }

  const expectedPositionLength = dataset.images.ids.length * 2;
  const rawPositions = options.cameraPositions2d ?? cameraPositionsFromExtrinsics(dataset);
  if (rawPositions.length !== expectedPositionLength) {
    throw new RangeError(
      `cameraPositions2d must contain ${expectedPositionLength} values, received ${rawPositions.length}`,
    );
  }
  const centroids = new Map(footprintCells.map((cell) => [cell.id, polygonCentroid(cell.polygon2d)]));
  const assignedNames = new Set<string>();
  for (const cell of footprintCells) {
    for (const name of assignments[cell.id].assigned) assignedNames.add(name);
  }

  const point: Vec3 = [0, 0, 0];
  const pending: Array<{
    imageIndex: number;
    imageName: string;
    position: Vec2;
    bestCount: number;
    bestCells: FootprintCell[];
  }> = [];
  for (let imageIndex = 0; imageIndex < dataset.images.ids.length; imageIndex += 1) {
    const imageName = dataset.images.names[imageIndex];
    if (assignedNames.has(imageName)) continue;
    if (footprintCells.some((cell) => assignments[cell.id].reasons[imageName] === "manual:exclude")) {
      continue;
    }

    const position: Vec2 = [
      Number(rawPositions[imageIndex * 2]),
      Number(rawPositions[imageIndex * 2 + 1]),
    ];
    if (!Number.isFinite(position[0]) || !Number.isFinite(position[1])) {
      throw new RangeError(`Camera ${imageName} has a non-finite ground position`);
    }
    const observed = graph.observedPoints(dataset.images.ids[imageIndex]);
    let bestCount = 0;
    let bestCells: FootprintCell[] = [];
    for (const cell of footprintCells) {
      const assignment = assignments[cell.id];
      const recorded = automaticCount(assignment.reasons[imageName]);
      const count = recorded ?? countObservedInCell(
        dataset,
        observed,
        cell,
        cellAcceptor(cell),
        point,
      );
      if (count > bestCount) {
        bestCount = count;
        bestCells = [cell];
      } else if (count === bestCount && count > 0) {
        bestCells.push(cell);
      }
    }
    pending.push({ imageIndex, imageName, position, bestCount, bestCells });
  }

  const zeroTrack = pending.filter((camera) => camera.bestCount === 0);
  const frustumByImage = zeroTrack.length > 0
    && options.frustumDataset
    && options.frustumObservationCache
    ? options.frustumObservationCache.observations(
        options.frustumDataset,
        zeroTrack.map((camera) => dataset.images.ids[camera.imageIndex]),
      )
    : undefined;
  const nearestCentroid = (
    candidates: FootprintCell[],
    position: Vec2,
  ): FootprintCell | undefined => candidates.sort((first, second) => {
    const distance = squaredDistance(position, centroids.get(first.id)!);
    const otherDistance = squaredDistance(position, centroids.get(second.id)!);
    return distance - otherDistance
      || (first.id < second.id ? -1 : first.id > second.id ? 1 : 0);
  })[0];

  for (const camera of pending) {
    let selected: FootprintCell | undefined;
    let reason: string | undefined;
    if (camera.bestCount > 0) {
      selected = nearestCentroid(camera.bestCells, camera.position);
      reason =
        `guarantee:best-observed:${camera.bestCount}`
        + `${camera.bestCount < 10 ? ":low-confidence" : ""}`;
    } else if (frustumByImage) {
      const imageId = dataset.images.ids[camera.imageIndex];
      const observed = frustumByImage.get(imageId);
      if (!observed) throw new RangeError(`Missing cached frustum observations for image id: ${imageId}`);
      let bestFrustumCount = 0;
      let bestFrustumCells: FootprintCell[] = [];
      for (const cell of footprintCells) {
        const count = countObservedInCell(
          dataset,
          observed,
          cell,
          cellAcceptor(cell),
          point,
        );
        if (count > bestFrustumCount) {
          bestFrustumCount = count;
          bestFrustumCells = [cell];
        } else if (count === bestFrustumCount && count > 0) {
          bestFrustumCells.push(cell);
        }
      }
      if (bestFrustumCount > 0) {
        selected = nearestCentroid(bestFrustumCells, camera.position);
        reason = `guarantee:frustum:${bestFrustumCount}`;
      }
    }
    if (!selected && options.includePositionFallback === true) {
      selected = footprintCells
        .filter((cell) => positionInsideOrOnCell(camera.position, cell))
        .sort((first, second) => {
          const distance = unsignedPolygonDistance(camera.position, first.polygon2d);
          const otherDistance = unsignedPolygonDistance(camera.position, second.polygon2d);
          return distance - otherDistance
            || (first.id < second.id ? -1 : first.id > second.id ? 1 : 0);
        })[0];
      if (selected) reason = "guarantee:position";
    }

    if (selected && reason) {
      const assignment = assignments[selected.id];
      assignment.assigned.push(camera.imageName);
      assignment.assigned.sort();
      assignment.reasons[camera.imageName] = reason;
      assignedNames.add(camera.imageName);
    } else if (camera.bestCount === 0) {
      for (const cell of footprintCells) {
        const assignment = assignments[cell.id];
        if (assignment.reasons[camera.imageName] === "manual:include"
          || assignment.reasons[camera.imageName] === "manual:exclude") continue;
        assignment.reasons[camera.imageName] = frustumByImage
          ? "unassigned:no-frustum-evidence"
          : "unassigned:no-tracked-evidence-in-any-cell";
      }
    }
  }
  return assignments;
}

export function assignCameras(
  dataset: ColmapDataset,
  graph: CovisibilityGraph,
  planningSettings: PlanningSettings,
  cells: readonly Cell[],
): CameraAssignments {
  if (
    dataset.images.ids.length !== dataset.images.names.length ||
    dataset.images.ids.length !== dataset.images.cameraIds.length
  ) {
    throw new RangeError("COLMAP image arrays have inconsistent lengths");
  }

  const assignment = planningSettings.assignment;
  const visibility = assignment?.visibility ?? "tracks";
  if (visibility !== "tracks" && visibility !== "frustum") {
    throw new RangeError(`Unknown assignment visibility: ${String(visibility)}`);
  }
  const defaultThreshold = assignment?.default ?? DEFAULT_THRESHOLD;
  const images = Array.from(dataset.images.ids, (imageId, index) => ({
    imageId,
    cameraId: dataset.images.cameraIds[index],
    name: dataset.images.names[index],
  })).sort((first, second) =>
    first.name < second.name ? -1 : first.name > second.name ? 1 : first.imageId - second.imageId,
  );

  const names = new Set<string>();
  for (const image of images) {
    if (names.has(image.name)) throw new RangeError(`Duplicate COLMAP image name: ${image.name}`);
    names.add(image.name);
  }

  const result: CameraAssignments = {};
  const sortedCells = [...cells].sort((first, second) =>
    first.id < second.id ? -1 : first.id > second.id ? 1 : 0,
  );
  for (const inputCell of sortedCells) {
    const cell = requireFootprint(inputCell);
    const acceptor = cellAcceptor(cell);
    const point: Vec3 = [0, 0, 0];
    const assigned: string[] = [];
    const reasons: Record<string, string> = {};
    for (const image of images) {
      const count = countObservedInCell(
        dataset,
        graph.observedPoints(image.imageId),
        cell,
        acceptor,
        point,
      );
      const action = manualAction(cell, image.name);
      if (action === "exclude") {
        reasons[image.name] = "manual:exclude";
        continue;
      }
      if (action === "include") {
        assigned.push(image.name);
        reasons[image.name] = "manual:include";
        continue;
      }

      const sensorThreshold = assignment?.perSensor[String(image.cameraId)] ?? defaultThreshold;
      if (count >= thresholdValue(sensorThreshold)) assigned.push(image.name);
      reasons[image.name] = `${visibility === "tracks" ? "covisibility" : "frustum"}:${count}`;
    }
    assigned.sort();
    result[cell.id] = { assigned, reasons };
  }
  return result;
}

export interface CapFlag {
  kind: "coverage-saturated" | "sector-uncovered";
  detail?: string;
}

export interface CapAssignmentResult {
  assignments: CameraAssignments;
  flags: Record<string, CapFlag[]>;
}

const SECTOR_COUNT = 8;
// Wedge 0 is centred on +X (East); indices advance counter-clockwise by 45°.
const SECTOR_LABELS = ["E", "NE", "N", "NW", "W", "SW", "S", "SE"] as const;

function pointSegmentDistanceSquared(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

/** Signed distance to the polygon boundary: positive inside, negative outside. */
function signedBoundaryDistance(polygon: readonly Vec2[], x: number, y: number): number {
  let minSquared = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    minSquared = Math.min(minSquared, pointSegmentDistanceSquared(x, y, a[0], a[1], b[0], b[1]));
  }
  const distance = Math.sqrt(minSquared);
  return pointInPolygon([x, y], polygon) ? distance : -distance;
}

/**
 * A point guaranteed to lie strictly inside a simple polygon, found by nudging
 * edge midpoints inward at shrinking scales. Returns null only for a degenerate
 * polygon. Used to seed the pole search so it never returns an exterior point.
 */
function interiorSeed(polygon: readonly Vec2[]): Vec2 | null {
  const bounds = polygonAabb(polygon);
  const scale = Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]);
  if (!(scale > 0)) return null;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    const midX = (a[0] + b[0]) / 2;
    const midY = (a[1] + b[1]) / 2;
    const normalX = -dy / length;
    const normalY = dx / length;
    for (let step = scale * 0.25; step > scale * 1e-15; step *= 0.5) {
      for (const signed of [step, -step]) {
        const candidate: Vec2 = [midX + normalX * signed, midY + normalY * signed];
        if (pointInPolygon(candidate, polygon)) return candidate;
      }
    }
  }
  return null;
}

/**
 * The interior point farthest from any polygon edge (the "pole of
 * inaccessibility"). Unlike the area centroid, this is guaranteed to fall
 * inside a concave cell, so it is a sound anchor for angular sector binning.
 * Mapbox polylabel: quadtree cell subdivision by an upper-bound priority,
 * which finds the true pole even for thin arms a fixed lattice would miss.
 * Deterministic (linear max-selection, fixed subdivision order).
 */
export function poleOfInaccessibility(polygon: readonly Vec2[]): Vec2 {
  const bounds = polygonAabb(polygon);
  const center: Vec2 = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
  ];
  const width = bounds.max[0] - bounds.min[0];
  const height = bounds.max[1] - bounds.min[1];
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return center;
  }
  const cellSize = Math.min(width, height);
  const precision = Math.max(cellSize * 1e-3, Number.MIN_VALUE);

  interface QueueCell { x: number; y: number; half: number; distance: number; potential: number; }
  const makeCell = (x: number, y: number, half: number): QueueCell => {
    const distance = signedBoundaryDistance(polygon, x, y);
    return { x, y, half, distance, potential: distance + half * Math.SQRT2 };
  };

  const queue: QueueCell[] = [];
  const initialHalf = cellSize / 2;
  for (let x = bounds.min[0]; x < bounds.max[0]; x += cellSize) {
    for (let y = bounds.min[1]; y < bounds.max[1]; y += cellSize) {
      queue.push(makeCell(x + initialHalf, y + initialHalf, initialHalf));
    }
  }
  // Seed with a guaranteed-interior point so pruning can never return an exterior
  // result for a valid (possibly very thin) polygon; centroid is the last resort.
  const seed = interiorSeed(polygon) ?? center;
  let best = makeCell(seed[0], seed[1], 0);
  let guard = 0;
  while (queue.length > 0 && guard < 100_000) {
    guard += 1;
    let bestIndex = 0;
    for (let i = 1; i < queue.length; i += 1) {
      if (queue[i].potential > queue[bestIndex].potential) bestIndex = i;
    }
    const cell = queue.splice(bestIndex, 1)[0];
    if (cell.distance > best.distance) best = cell;
    if (cell.potential - best.distance <= precision) continue;
    const half = cell.half / 2;
    queue.push(makeCell(cell.x - half, cell.y - half, half));
    queue.push(makeCell(cell.x + half, cell.y - half, half));
    queue.push(makeCell(cell.x - half, cell.y + half, half));
    queue.push(makeCell(cell.x + half, cell.y + half, half));
  }
  return [best.x, best.y];
}

function sectorOf(anchor: Vec2, x: number, y: number): number {
  const angle = Math.atan2(y - anchor[1], x - anchor[0]);
  // Wedge 0 is centred on +X (East): shift by half a wedge so a cardinal
  // direction sits at a wedge centre, not on a boundary that splits neighbours.
  let turns = angle / (2 * Math.PI) + 1 / (2 * SECTOR_COUNT);
  turns -= Math.floor(turns);
  const index = Math.floor(turns * SECTOR_COUNT);
  return index >= SECTOR_COUNT ? index - SECTOR_COUNT : index;
}

interface CapCamera {
  imageIndex: number;
  imageId: number;
  name: string;
  position: Vec2;
  pinned: string[];
  excluded: Set<string>;
  /** Observed tracked-point count per cell (>0 only). */
  tracked: Map<string, number>;
  /** Evidence rung used to home a camera lacking tracked evidence. */
  kind: "tracked" | "frustum" | "position" | "none";
  /** Cells this camera can be matched into, best-evidence first. */
  eligible: Array<{ cellId: string; count: number }>;
  /** Frustum observed count per eligible cell, for the reason label. */
  frustumCounts?: Map<string, number>;
}

/**
 * Minimum-cardinality set cover of `targetMask` using candidate coverage masks.
 * Deterministic: fewer cameras, then higher summed evidence, then name order.
 * `targetMask` fits in SECTOR_COUNT bits, so the mask DP is tiny and exact.
 */
function minimumSectorCover(
  targetMask: number,
  candidates: ReadonlyArray<{ name: string; mask: number; count: number }>,
): string[] {
  if (targetMask === 0) return [];
  interface Cover {
    names: string[];
    evidence: number;
  }
  const better = (a: Cover, b: Cover): boolean => {
    if (a.names.length !== b.names.length) return a.names.length < b.names.length;
    if (a.evidence !== b.evidence) return a.evidence > b.evidence;
    for (let index = 0; index < a.names.length; index += 1) {
      if (a.names[index] !== b.names[index]) return a.names[index] < b.names[index];
    }
    return false;
  };
  const best = new Map<number, Cover>();
  best.set(0, { names: [], evidence: 0 });
  for (const candidate of candidates) {
    const contribution = candidate.mask & targetMask;
    if (contribution === 0) continue;
    for (const [mask, cover] of [...best.entries()]) {
      const nextMask = mask | contribution;
      if (nextMask === mask) continue;
      const nextCover: Cover = {
        names: [...cover.names, candidate.name],
        evidence: cover.evidence + candidate.count,
      };
      const existing = best.get(nextMask);
      if (!existing || better(nextCover, existing)) best.set(nextMask, nextCover);
    }
  }
  return best.get(targetMask)?.names ?? [];
}

/**
 * Capacity-constrained final selection (Plan 22 D-5 / D-5b). Each cell trains at
 * most `cap` cameras: pins are honoured, the full evidence ladder (tracked →
 * frustum → position) gives every evidenced camera a home via deterministic
 * capacitated bipartite matching, per-sector halo coverage is reserved by
 * minimum-cardinality set cover about each cell's pole of inaccessibility, and
 * remaining slots are filled by observed-count. A camera that no augmenting path
 * can seat within `cap` is kept anyway and its cell flagged `coverage-saturated`;
 * an occupied sector with no eligible observer flags `sector-uncovered`. The
 * supplied assignments are rebuilt in place and returned alongside the flags.
 */
export function capAssignments(
  dataset: ColmapDataset,
  graph: CovisibilityGraph,
  cells: readonly Cell[],
  assignments: CameraAssignments,
  cap: number,
  options: GuaranteeAssignmentOptions = {},
): CapAssignmentResult {
  if (!Number.isInteger(cap) || cap < 1) {
    throw new RangeError(`Camera cap must be a positive integer: ${cap}`);
  }
  const footprintCells = [...cells].map(requireFootprint).sort((first, second) =>
    first.id < second.id ? -1 : first.id > second.id ? 1 : 0,
  );
  const flags: Record<string, CapFlag[]> = {};
  for (const cell of footprintCells) {
    if (!assignments[cell.id]) {
      throw new RangeError(`Missing camera assignments for cell: ${cell.id}`);
    }
    flags[cell.id] = [];
  }
  if (footprintCells.length === 0) return { assignments, flags };
  if (
    (options.frustumDataset === undefined)
    !== (options.frustumObservationCache === undefined)
  ) {
    throw new RangeError(
      "frustumDataset and frustumObservationCache must be supplied together",
    );
  }

  const expectedPositionLength = dataset.images.ids.length * 2;
  const rawPositions = options.cameraPositions2d ?? cameraPositionsFromExtrinsics(dataset);
  if (rawPositions.length !== expectedPositionLength) {
    throw new RangeError(
      `cameraPositions2d must contain ${expectedPositionLength} values, received ${rawPositions.length}`,
    );
  }

  const acceptors = new Map(footprintCells.map((cell) => [cell.id, cellAcceptor(cell)]));
  const point: Vec3 = [0, 0, 0];

  // --- Per-camera evidence ladder ------------------------------------------
  const cameras: CapCamera[] = [];
  for (let imageIndex = 0; imageIndex < dataset.images.ids.length; imageIndex += 1) {
    const name = dataset.images.names[imageIndex];
    const position: Vec2 = [
      Number(rawPositions[imageIndex * 2]),
      Number(rawPositions[imageIndex * 2 + 1]),
    ];
    if (!Number.isFinite(position[0]) || !Number.isFinite(position[1])) {
      throw new RangeError(`Camera ${name} has a non-finite ground position`);
    }
    const pinned: string[] = [];
    const excluded = new Set<string>();
    const tracked = new Map<string, number>();
    for (const cell of footprintCells) {
      const reason = assignments[cell.id].reasons[name];
      if (reason === "manual:exclude") {
        excluded.add(cell.id);
        continue;
      }
      if (reason === "manual:include") {
        pinned.push(cell.id);
        continue;
      }
      const count = automaticCount(reason);
      if (count !== undefined && count > 0) tracked.set(cell.id, count);
    }
    cameras.push({
      imageIndex,
      imageId: dataset.images.ids[imageIndex],
      name,
      position,
      pinned,
      excluded,
      tracked,
      kind: "none",
      eligible: [],
    });
  }

  const byCount = (
    first: { cellId: string; count: number },
    second: { cellId: string; count: number },
  ): number =>
    second.count - first.count
    || (first.cellId < second.cellId ? -1 : first.cellId > second.cellId ? 1 : 0);

  // Tracked cameras home to the cells they observe into.
  for (const camera of cameras) {
    if (camera.pinned.length > 0 || camera.tracked.size === 0) continue;
    camera.kind = "tracked";
    camera.eligible = [...camera.tracked.entries()]
      .map(([cellId, count]) => ({ cellId, count }))
      .sort(byCount);
  }

  // Zero-track cameras (pinned or not) fall back to frustum projection. The frustum
  // counts feed eligibility for unpinned cameras and sector coverage for every one,
  // so a pinned camera with only frustum evidence still covers the sectors it sees.
  const zeroTrack = cameras.filter((camera) => camera.tracked.size === 0);
  const frustumByImage = zeroTrack.length > 0
    && options.frustumDataset
    && options.frustumObservationCache
    ? options.frustumObservationCache.observations(
        options.frustumDataset,
        zeroTrack.map((camera) => camera.imageId),
      )
    : undefined;
  for (const camera of zeroTrack) {
    if (frustumByImage) {
      const observed = frustumByImage.get(camera.imageId);
      if (!observed) throw new RangeError(`Missing cached frustum observations for image id: ${camera.imageId}`);
      const frustumCounts = new Map<string, number>();
      for (const cell of footprintCells) {
        if (camera.excluded.has(cell.id)) continue;
        const count = countObservedInCell(dataset, observed, cell, acceptors.get(cell.id)!, point);
        if (count > 0) frustumCounts.set(cell.id, count);
      }
      if (frustumCounts.size > 0) camera.frustumCounts = frustumCounts;
    }
    // Pins already have a home; their frustum counts serve sector coverage only.
    if (camera.pinned.length > 0) continue;
    if (camera.frustumCounts && camera.frustumCounts.size > 0) {
      camera.kind = "frustum";
      camera.eligible = [...camera.frustumCounts.entries()]
        .map(([cellId, count]) => ({ cellId, count }))
        .sort(byCount);
      continue;
    }
    if (options.includePositionFallback === true) {
      const containing = footprintCells
        .filter((cell) => !camera.excluded.has(cell.id) && positionInsideOrOnCell(camera.position, cell))
        .sort((first, second) => {
          const distance = unsignedPolygonDistance(camera.position, first.polygon2d);
          const otherDistance = unsignedPolygonDistance(camera.position, second.polygon2d);
          return distance - otherDistance
            || (first.id < second.id ? -1 : first.id > second.id ? 1 : 0);
        });
      if (containing.length > 0) {
        camera.kind = "position";
        camera.eligible = containing.map((cell) => ({ cellId: cell.id, count: 0 }));
      }
    }
  }

  const cameraByName = new Map(cameras.map((camera) => [camera.name, camera]));

  // Cameras with any evidence for a cell (tracked, frustum, or a pin), so sector
  // reservation scans only a cell's own candidates rather than every camera.
  const eligibleByCell = new Map<string, string[]>(footprintCells.map((cell) => [cell.id, []]));
  for (const camera of cameras) {
    const relevant = new Set<string>(camera.pinned);
    for (const cellId of camera.tracked.keys()) relevant.add(cellId);
    if (camera.frustumCounts) for (const cellId of camera.frustumCounts.keys()) relevant.add(cellId);
    for (const cellId of relevant) {
      if (!camera.excluded.has(cellId)) eligibleByCell.get(cellId)!.push(camera.name);
    }
  }

  // --- Coverage helpers: the occupied halo sectors a camera observes into ---
  const seated = new Map<string, Set<string>>(footprintCells.map((cell) => [cell.id, new Set()]));

  // A camera with any tracked cell uses its tracked observations; a zero-track camera
  // uses its projected frustum set. Keying on `tracked.size` (not on the raw array being
  // non-empty) is essential: a zero-track camera can still carry an out-of-cell raw track
  // that would otherwise shadow the frustum evidence that actually covers a sector.
  // Cached per image so a camera's observation array is fetched (and .slice()'d) once.
  const observationCache = new Map<number, Uint32Array | undefined>();
  const observationsForCamera = (camera: CapCamera): Uint32Array | undefined => {
    if (observationCache.has(camera.imageId)) return observationCache.get(camera.imageId);
    let result: Uint32Array | undefined;
    if (camera.tracked.size > 0) result = graph.observedPoints(camera.imageId);
    else if (frustumByImage) result = frustumByImage.get(camera.imageId);
    observationCache.set(camera.imageId, result);
    return result;
  };

  const coverageMask = (camera: CapCamera, cell: FootprintCell, anchor: Vec2, occupied: number): number => {
    const observed = observationsForCamera(camera);
    if (!observed) return 0;
    const positions = dataset.points3D.positions;
    let mask = 0;
    for (const pointIndex of observed) {
      const offset = pointIndex * 3;
      if (offset + 2 >= positions.length) continue;
      point[0] = positions[offset];
      point[1] = positions[offset + 1];
      point[2] = positions[offset + 2];
      if (!isInteriorOrHalo(point, cell)) continue;
      const bit = 1 << sectorOf(anchor, point[0], point[1]);
      if ((occupied & bit) !== 0) mask |= bit;
    }
    return mask;
  };

  // Pins fix a camera into a cell; matched cameras get one home each; sector
  // reservations are additional fixed members. The matching's free capacity is
  // whatever the fixed members (pins + reservations) leave.
  const pinsByCell = new Map<string, Set<string>>(footprintCells.map((cell) => [cell.id, new Set()]));
  for (const camera of cameras) {
    for (const cellId of camera.pinned) pinsByCell.get(cellId)!.add(camera.name);
  }
  const freeOccupants = new Map<string, string[]>(footprintCells.map((cell) => [cell.id, []]));
  const matchHome = new Map<string, string>();
  const sectorFixed = new Map<string, Set<string>>(footprintCells.map((cell) => [cell.id, new Set()]));
  const freeCapacity = (cellId: string): number =>
    cap - pinsByCell.get(cellId)!.size - sectorFixed.get(cellId)!.size;

  // --- Capacitated bipartite matching: one coverage home per free camera ----
  const freePool = cameras
    .filter((camera) => camera.pinned.length === 0 && camera.eligible.length > 0)
    .sort((first, second) => (first.name < second.name ? -1 : first.name > second.name ? 1 : 0));

  // Seat `sourceName` in an eligible cell via a shortest augmenting path, never
  // routing through `forbidden`, displacing only free (matched) occupants.
  const augment = (sourceName: string, forbidden?: string): boolean => {
    const queue: string[] = [sourceName];
    const cellFrom = new Map<string, string>();
    const cameraFrom = new Map<string, string>();
    const visitedCells = new Set<string>();
    if (forbidden !== undefined) visitedCells.add(forbidden);
    const visitedCameras = new Set<string>([sourceName]);
    let head = 0;
    while (head < queue.length) {
      const camera = cameraByName.get(queue[head++])!;
      for (const { cellId } of camera.eligible) {
        if (visitedCells.has(cellId)) continue;
        visitedCells.add(cellId);
        cellFrom.set(cellId, camera.name);
        const occupants = freeOccupants.get(cellId)!;
        if (occupants.length < freeCapacity(cellId)) {
          let target = cellId;
          for (;;) {
            const placed = cellFrom.get(target)!;
            freeOccupants.get(target)!.push(placed);
            matchHome.set(placed, target);
            const previous = cameraFrom.get(placed);
            if (previous === undefined) break;
            const from = freeOccupants.get(previous)!;
            from.splice(from.indexOf(placed), 1);
            target = previous;
          }
          return true;
        }
        for (const occupant of occupants) {
          if (!visitedCameras.has(occupant)) {
            visitedCameras.add(occupant);
            cameraFrom.set(occupant, cellId);
            queue.push(occupant);
          }
        }
      }
    }
    return false;
  };

  for (const camera of freePool) {
    if (!augment(camera.name)) {
      // No augmenting path exists: keep the camera in its best cell (overflow).
      freeOccupants.get(camera.eligible[0].cellId)!.push(camera.name);
      matchHome.set(camera.name, camera.eligible[0].cellId);
    }
  }

  // Relocate a free occupant out of `fromCell` to another eligible cell.
  const relocate = (occName: string, fromCell: string): boolean => {
    const from = freeOccupants.get(fromCell)!;
    const at = from.indexOf(occName);
    if (at < 0) return false;
    from.splice(at, 1);
    matchHome.delete(occName);
    if (augment(occName, fromCell)) return true;
    from.push(occName);
    matchHome.set(occName, fromCell);
    return false;
  };

  // Seat a sector observer in a cell, freeing a slot by relocating a displaceable
  // free occupant when the cell is full — this is how sector reservations enter the
  // matching (D-5b): a sole observer can displace a camera that has another home.
  const forceIntoCell = (reserveName: string, cellId: string): void => {
    const fixedHere = sectorFixed.get(cellId)!;
    if (pinsByCell.get(cellId)!.has(reserveName) || fixedHere.has(reserveName)) return;
    const occupants = freeOccupants.get(cellId)!;
    if (matchHome.get(reserveName) === cellId) {
      // Already matched here — promote to a fixed reservation (occupancy unchanged).
      occupants.splice(occupants.indexOf(reserveName), 1);
      matchHome.delete(reserveName);
      fixedHere.add(reserveName);
      return;
    }
    // Room without displacement: seat here, keeping any home elsewhere (multi-cell).
    if (pinsByCell.get(cellId)!.size + occupants.length + fixedHere.size < cap) {
      fixedHere.add(reserveName);
      return;
    }
    // Full: free the reserve from its other matched home first, so that freed slot can
    // absorb a displaced occupant — this is the two-cell swap a pure add cannot express.
    const priorHome = matchHome.get(reserveName);
    if (priorHome !== undefined) {
      const prior = freeOccupants.get(priorHome)!;
      prior.splice(prior.indexOf(reserveName), 1);
      matchHome.delete(reserveName);
    }
    for (const occ of [...occupants]) {
      if (relocate(occ, cellId)) { fixedHere.add(reserveName); return; }
    }
    // Displacement failed: restore the reserve to its prior home (keep that coverage) and
    // accept an overflow here — an uncovered prior-home sector is re-reserved next pass.
    if (priorHome !== undefined) {
      freeOccupants.get(priorHome)!.push(reserveName);
      matchHome.set(reserveName, priorHome);
    }
    fixedHere.add(reserveName);
  };

  // --- Per-cell occupied halo sectors, binned about each pole of inaccessibility
  const occupiedByCell = new Map<string, number>();
  const anchorByCell = new Map<string, Vec2>();
  for (const cell of footprintCells) {
    const anchor = poleOfInaccessibility(cell.polygon2d);
    anchorByCell.set(cell.id, anchor);
    const acceptor = acceptors.get(cell.id)!;
    const positions = dataset.points3D.positions;
    let occupied = 0;
    for (let pointIndex = 0; pointIndex < positions.length / 3; pointIndex += 1) {
      const offset = pointIndex * 3;
      const x = positions[offset];
      const y = positions[offset + 1];
      const z = positions[offset + 2];
      if (!acceptor.accepts(x, y, z)) continue;
      point[0] = x;
      point[1] = y;
      point[2] = z;
      if (isInteriorOrHalo(point, cell)) occupied |= 1 << sectorOf(anchor, x, y);
    }
    occupiedByCell.set(cell.id, occupied);
  }

  // Sectors covered by the given members; stops once every occupied sector is met.
  const memberCoverage = (
    cell: FootprintCell,
    anchor: Vec2,
    occupied: number,
    members: Iterable<string>,
  ): number => {
    let covered = 0;
    for (const name of members) {
      covered |= coverageMask(cameraByName.get(name)!, cell, anchor, occupied);
      if ((covered & occupied) === occupied) break;
    }
    return covered;
  };
  const cellMembers = (cellId: string): Set<string> => {
    const members = new Set(pinsByCell.get(cellId));
    for (const name of freeOccupants.get(cellId)!) members.add(name);
    for (const name of sectorFixed.get(cellId)!) members.add(name);
    return members;
  };

  // --- Sector reservation: reserve the fewest observers per cell, re-checking
  //     each pass because relocating an occupant can uncover a sector it had held.
  //     Reservations only ever grow (bounded by cells x sectors), so this converges;
  //     the bound is a safety net and the `changed` break exits after one pass normally.
  //     This is the plan's greedy match-then-reserve design (D-5), not a global joint
  //     optimizer: at pathological tight caps (cap 1-2 with conflicting sector demands)
  //     it can overflow a cell that a global optimum would have kept within cap. Such an
  //     overflow is always flagged `coverage-saturated` (never silent, never an orphan,
  //     sectors still covered), and does not arise at real cap-scale where cells have
  //     ample slack. Measured: 4 of 508 feasible cap<=2 adversarial tiny instances.
  for (let pass = 0; pass < footprintCells.length * SECTOR_COUNT + 2; pass += 1) {
    let changed = false;
    for (const cell of footprintCells) {
      const occupied = occupiedByCell.get(cell.id)!;
      if (occupied === 0) continue;
      const anchor = anchorByCell.get(cell.id)!;
      const members = cellMembers(cell.id);
      const uncovered = occupied & ~memberCoverage(cell, anchor, occupied, members);
      if (uncovered === 0) continue;
      const reserve: Array<{ name: string; mask: number; count: number }> = [];
      for (const name of eligibleByCell.get(cell.id)!) {
        if (members.has(name)) continue;
        const camera = cameraByName.get(name)!;
        const mask = coverageMask(camera, cell, anchor, occupied) & uncovered;
        if (mask === 0) continue;
        const count = (camera.tracked.get(cell.id) ?? 0) || (camera.frustumCounts?.get(cell.id) ?? 0);
        reserve.push({ name, mask, count });
      }
      reserve.sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      let coverable = 0;
      for (const candidate of reserve) coverable |= candidate.mask;
      for (const name of minimumSectorCover(uncovered & coverable, reserve)) {
        forceIntoCell(name, cell.id);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Assemble the seated set from pins + matched cameras + sector reservations.
  for (const cell of footprintCells) {
    const chosen = seated.get(cell.id)!;
    for (const name of pinsByCell.get(cell.id)!) chosen.add(name);
    for (const name of freeOccupants.get(cell.id)!) chosen.add(name);
    for (const name of sectorFixed.get(cell.id)!) chosen.add(name);
  }

  // --- Fill remaining slots by observed tracked count -----------------------
  for (const cell of footprintCells) {
    const chosen = seated.get(cell.id)!;
    if (chosen.size >= cap) continue;
    const fill = cameras
      .filter((camera) =>
        !chosen.has(camera.name)
        && !camera.excluded.has(cell.id)
        && (camera.tracked.get(cell.id) ?? 0) > 0)
      .map((camera) => ({ name: camera.name, count: camera.tracked.get(cell.id)! }))
      .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (let index = 0; index < fill.length && chosen.size < cap; index += 1) {
      chosen.add(fill[index].name);
    }
  }

  // --- Assemble assignments + reasons + flags (re-runnable for the exact repair) ---
  const originalReasons = new Map(
    footprintCells.map((cell) => [cell.id, { ...assignments[cell.id].reasons }]),
  );
  const frustumAttempted = frustumByImage !== undefined;
  const finalize = (chosenByCell: Map<string, Set<string>>): void => {
    for (const cell of footprintCells) {
      flags[cell.id] = [];
      assignments[cell.id].reasons = { ...originalReasons.get(cell.id)! };
    }
    for (const cell of footprintCells) {
      const chosen = chosenByCell.get(cell.id)!;
      const occupied = occupiedByCell.get(cell.id)!;
      if (occupied !== 0) {
        const stillUncovered = occupied & ~memberCoverage(cell, anchorByCell.get(cell.id)!, occupied, chosen);
        for (let sector = 0; sector < SECTOR_COUNT; sector += 1) {
          if ((stillUncovered & (1 << sector)) !== 0) {
            flags[cell.id].push({ kind: "sector-uncovered", detail: SECTOR_LABELS[sector] });
          }
        }
      }
      if (chosen.size > cap) flags[cell.id].push({ kind: "coverage-saturated", detail: `${chosen.size}>${cap}` });
      for (const name of chosen) {
        const camera = cameraByName.get(name)!;
        if (camera.pinned.includes(cell.id) || (camera.tracked.get(cell.id) ?? 0) > 0) continue;
        if (camera.frustumCounts?.has(cell.id)) {
          assignments[cell.id].reasons[name] = `guarantee:frustum:${camera.frustumCounts.get(cell.id)}`;
        } else if (camera.kind === "position") {
          assignments[cell.id].reasons[name] = "guarantee:position";
        }
      }
      assignments[cell.id].assigned = [...chosen].sort();
    }
    for (const camera of cameras) {
      if (camera.pinned.length > 0) continue;
      if (footprintCells.some((cell) => chosenByCell.get(cell.id)!.has(camera.name))) continue;
      if (camera.tracked.size > 0 || camera.kind !== "none") continue;
      const label = frustumAttempted
        ? "unassigned:no-frustum-evidence"
        : "unassigned:no-tracked-evidence-in-any-cell";
      for (const cell of footprintCells) {
        const reason = assignments[cell.id].reasons[camera.name];
        if (reason === "manual:include" || reason === "manual:exclude") continue;
        assignments[cell.id].reasons[camera.name] = label;
      }
    }
  };
  finalize(seated);

  // --- Exact repair for a small instance the greedy overflowed --------------
  // The greedy match-then-reserve (D-5) is optimal at real cap-scale but can overflow a
  // tight-cap sector conflict a global optimum fits. That problem is NP-hard in general,
  // so only when the greedy DID overflow AND the instance is small enough to enumerate do
  // we solve it exactly and adopt a strictly-lower-overflow assignment. Real data never
  // reaches this (the product below explodes past the bound); tiny tight-cap cases do.
  const greedyOverflow = footprintCells.reduce((sum, cell) => sum + Math.max(0, seated.get(cell.id)!.size - cap), 0);
  if (greedyOverflow > 0) {
    const exact = solveExactly(footprintCells, cameras, occupiedByCell, anchorByCell, coverageMask, cap, greedyOverflow);
    if (exact) finalize(exact);
  }

  return { assignments, flags };
}

/**
 * Exhaustive minimum-overflow assignment for a small instance, or null if the option
 * space exceeds a tractable bound or nothing beats `greedyOverflow`. Each camera takes a
 * non-empty subset of its eligible cells (pins mandatory), every coverable occupied sector
 * must be covered, and among coverage-complete assignments the fewest overflow-then-fewest
 * seats wins deterministically (first in a fixed enumeration order).
 */
function solveExactly(
  footprintCells: readonly FootprintCell[],
  cameras: readonly CapCamera[],
  occupiedByCell: ReadonlyMap<string, number>,
  anchorByCell: ReadonlyMap<string, Vec2>,
  coverageMask: (camera: CapCamera, cell: FootprintCell, anchor: Vec2, occupied: number) => number,
  cap: number,
  greedyOverflow: number,
): Map<string, Set<string>> | null {
  const MAX_COMBOS = 200_000;
  const MAX_OPTIONAL = 20; // 2^MAX_OPTIONAL stays under a 31-bit shift and the combo bound
  const cellIndex = new Map(footprintCells.map((cell, index) => [cell.id, index]));
  // A camera's candidate cells are every cell it has evidence for (tracked, frustum, or its
  // ladder-selected eligible cells for position) plus its mandatory pins — exactly what the
  // greedy can use. Pinned cameras skip `eligible`, so tracked/frustum keys are essential here.
  const candidateCells = (camera: CapCamera): number[] => {
    const set = new Set<number>();
    for (const entry of camera.eligible) set.add(cellIndex.get(entry.cellId)!);
    for (const cellId of camera.tracked.keys()) set.add(cellIndex.get(cellId)!);
    if (camera.frustumCounts) for (const cellId of camera.frustumCounts.keys()) set.add(cellIndex.get(cellId)!);
    for (const cellId of camera.pinned) set.add(cellIndex.get(cellId)!);
    return [...set].sort((a, b) => a - b);
  };
  // Only cameras with somewhere to go affect the assignment; evidence-free cameras stay
  // unassigned (labelled by finalize) and must not count toward the tractability gate.
  const active = cameras.filter((camera) => candidateCells(camera).length > 0);
  if (active.length > 64) return null;

  const options: number[][][] = [];
  const covMask: number[][] = [];
  let product = 1;
  for (const camera of active) {
    const eligible = candidateCells(camera);
    const pins = camera.pinned.map((id) => cellIndex.get(id)!);
    const pinSet = new Set(pins);
    const optional = eligible.filter((li) => !pinSet.has(li));
    if (optional.length > MAX_OPTIONAL) return null;
    // Bound the combination product BEFORE allocating any subsets or coverage masks, using the
    // EXACT subset count: a pinned camera keeps every one of 2^optional home-sets, a non-pinned
    // one drops the empty set (2^optional - 1). The conservative 2^optional would falsely bail a
    // valid tiny search near the bound and retain an avoidable overflow.
    const subsetCount = (1 << optional.length) - (pins.length === 0 ? 1 : 0);
    if (product * subsetCount > MAX_COMBOS) return null;
    const masks = footprintCells.map(() => 0);
    for (const li of eligible) masks[li] = coverageMask(camera, footprintCells[li], anchorByCell.get(footprintCells[li].id)!, occupiedByCell.get(footprintCells[li].id)!);
    covMask.push(masks);
    // Pins are always present; enumerate only the optional cells (never 2^total, never 1<<31).
    const subsets: number[][] = [];
    for (let mask = 0; mask < (1 << optional.length); mask += 1) {
      const subset = [...pins];
      for (let b = 0; b < optional.length; b += 1) if (mask & (1 << b)) subset.push(optional[b]);
      if (subset.length > 0) subsets.push(subset); // a non-pinned camera needs a non-empty home
    }
    options.push(subsets);
    product *= subsets.length; // stays <= MAX_COMBOS by the pre-check above
  }
  const coverable = footprintCells.map((cell, li) => {
    let mask = 0;
    for (let ci = 0; ci < active.length; ci += 1) if (options[ci].some((s) => s.includes(li))) mask |= covMask[ci][li];
    return mask & occupiedByCell.get(cell.id)!;
  });
  let best: { overflow: number; count: number; assign: number[][] } | null = null;
  const pick = new Array<number>(active.length).fill(0);
  for (let combo = 0; combo < product; combo += 1) {
    let rem = combo;
    for (let ci = 0; ci < active.length; ci += 1) { pick[ci] = rem % options[ci].length; rem = Math.floor(rem / options[ci].length); }
    const load = footprintCells.map(() => 0);
    const covered = footprintCells.map(() => 0);
    let count = 0;
    for (let ci = 0; ci < active.length; ci += 1) for (const li of options[ci][pick[ci]]) { load[li] += 1; covered[li] |= covMask[ci][li]; count += 1; }
    let coversAll = true;
    for (let li = 0; li < footprintCells.length; li += 1) if ((coverable[li] & ~covered[li]) !== 0) { coversAll = false; break; }
    if (!coversAll) continue;
    let overflow = 0;
    for (let li = 0; li < footprintCells.length; li += 1) overflow += Math.max(0, load[li] - cap);
    if (!best || overflow < best.overflow || (overflow === best.overflow && count < best.count)) {
      best = { overflow, count, assign: options.map((subs, ci) => subs[pick[ci]]) };
    }
  }
  if (!best || best.overflow >= greedyOverflow) return null;
  const result = new Map(footprintCells.map((cell) => [cell.id, new Set<string>()]));
  for (let ci = 0; ci < active.length; ci += 1) for (const li of best.assign[ci]) result.get(footprintCells[li].id)!.add(active[ci].name);
  return result;
}
