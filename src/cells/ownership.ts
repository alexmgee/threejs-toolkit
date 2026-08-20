import {
  GEOMETRY_EPSILON,
  pointInPolygon,
  polygonAabb,
  unsignedPolygonDistance,
} from "./geometry";
import type { Cell, FootprintCell, Vec2, Vec3 } from "./types";

export interface OwnershipPlanning {
  ownership: {
    rule: string;
    tieBreak: string;
    exteriorOwner: string;
    exteriorCutoff: number;
  };
  cells: readonly Cell[];
}

export interface OwnershipGoldenVector {
  id: string;
  category: string;
  point: Vec3;
  expectedOwner: string;
  interior?: Record<string, boolean>;
  halo?: Record<string, boolean>;
  band?: {
    cells: [string, string];
    expected: boolean;
  };
}

export interface CellsGoldens {
  version: 1;
  generated: OwnershipGoldenVector[];
  analyticPlanning: OwnershipPlanning;
  analytic: OwnershipGoldenVector[];
}

/** Snapshot pre-filter: false is definitive; true still requires the full predicate. */
export interface CellAcceptor {
  accepts(x: number, y: number, z: number): boolean;
}

interface AxisAlignedRectangle {
  polygon: FootprintCell["polygon2d"];
  coordinates: readonly [number, number, number, number, number, number, number, number];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const rectangleCache = new WeakMap<FootprintCell, AxisAlignedRectangle>();

export class UnknownOwnershipRuleError extends Error {
  readonly rule: string;

  constructor(rule: string) {
    super(`Unknown ownership rule: ${rule}`);
    this.name = "UnknownOwnershipRuleError";
    this.rule = rule;
  }
}

function compareCellIds(first: FootprintCell, second: FootprintCell): number {
  return first.id < second.id ? -1 : first.id > second.id ? 1 : 0;
}

function footprintCells(planning: OwnershipPlanning): FootprintCell[] {
  return planning.cells.filter((cell): cell is FootprintCell => cell.kind === "footprint");
}

export function margin(cell: FootprintCell): number {
  const bounds = polygonAabb(cell.polygon2d);
  return (
    cell.overlap.fraction *
    Math.min(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1])
  );
}

function axisAlignedRectangle(cell: FootprintCell): AxisAlignedRectangle | null {
  const cached = rectangleCache.get(cell);
  if (cached) {
    const polygon = cell.polygon2d;
    if (
      polygon === cached.polygon
      && polygon.length === 4
      && Object.is(polygon[0][0], cached.coordinates[0])
      && Object.is(polygon[0][1], cached.coordinates[1])
      && Object.is(polygon[1][0], cached.coordinates[2])
      && Object.is(polygon[1][1], cached.coordinates[3])
      && Object.is(polygon[2][0], cached.coordinates[4])
      && Object.is(polygon[2][1], cached.coordinates[5])
      && Object.is(polygon[3][0], cached.coordinates[6])
      && Object.is(polygon[3][1], cached.coordinates[7])
    ) {
      return cached;
    }
    rectangleCache.delete(cell);
  }

  const polygon = cell.polygon2d;
  let rectangle: AxisAlignedRectangle | null = null;
  if (polygon.length === 4) {
    const [first, second, third, fourth] = polygon;
    const firstHorizontal = first[1] === second[1] && first[0] !== second[0];
    const firstVertical = first[0] === second[0] && first[1] !== second[1];
    const alternating = firstHorizontal
      ? second[0] === third[0] && second[1] !== third[1]
        && third[1] === fourth[1] && third[0] !== fourth[0]
        && fourth[0] === first[0] && fourth[1] !== first[1]
      : firstVertical
        && second[1] === third[1] && second[0] !== third[0]
        && third[0] === fourth[0] && third[1] !== fourth[1]
        && fourth[1] === first[1] && fourth[0] !== first[0];
    if (alternating) {
      const bounds = polygonAabb(polygon);
      const corners = new Set(polygon.map(([x, y]) => `${x},${y}`));
      if (
        corners.size === 4
        && corners.has(`${bounds.min[0]},${bounds.min[1]}`)
        && corners.has(`${bounds.max[0]},${bounds.min[1]}`)
        && corners.has(`${bounds.max[0]},${bounds.max[1]}`)
        && corners.has(`${bounds.min[0]},${bounds.max[1]}`)
      ) {
        rectangle = {
          polygon,
          coordinates: [
            first[0], first[1], second[0], second[1],
            third[0], third[1], fourth[0], fourth[1],
          ],
          minX: bounds.min[0],
          minY: bounds.min[1],
          maxX: bounds.max[0],
          maxY: bounds.max[1],
        };
      }
    }
  }
  if (rectangle) rectangleCache.set(cell, rectangle);
  return rectangle;
}

function squaredPointSegmentDistance(
  x: number,
  y: number,
  start: Vec2,
  end: Vec2,
): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    const px = x - start[0];
    const py = y - start[1];
    return px * px + py * py;
  }

  const projection = Math.max(
    0,
    Math.min(1, ((x - start[0]) * dx + (y - start[1]) * dy) / lengthSquared),
  );
  const closestX = start[0] + projection * dx;
  const closestY = start[1] + projection * dy;
  const px = x - closestX;
  const py = y - closestY;
  return px * px + py * py;
}

function rectangleInterior2d(x: number, y: number, rectangle: AxisAlignedRectangle): boolean {
  const polygon = rectangle.polygon;
  const epsilonSquared = GEOMETRY_EPSILON * GEOMETRY_EPSILON;
  // Preserve pointInPolygon's four boundary-distance calculations exactly. Once
  // those exclude the epsilon band, ray crossing for this rectangle is the four
  // strict AABB comparisons below, independent of winding and starting corner.
  if (
    squaredPointSegmentDistance(x, y, polygon[0], polygon[1]) <= epsilonSquared
    || squaredPointSegmentDistance(x, y, polygon[1], polygon[2]) <= epsilonSquared
    || squaredPointSegmentDistance(x, y, polygon[2], polygon[3]) <= epsilonSquared
    || squaredPointSegmentDistance(x, y, polygon[3], polygon[0]) <= epsilonSquared
  ) {
    return false;
  }
  return (
    x > rectangle.minX
    && x < rectangle.maxX
    && y > rectangle.minY
    && y < rectangle.maxY
  );
}

function rectangleDistanceSquared(
  x: number,
  y: number,
  rectangle: AxisAlignedRectangle,
): number {
  const polygon = rectangle.polygon;
  // Keep the general polygon path's operation order so distance² == margin² has
  // the same floating-point verdict; only the loop and repeated interior test go.
  let minimumSquared = Number.POSITIVE_INFINITY;
  minimumSquared = Math.min(
    minimumSquared,
    squaredPointSegmentDistance(x, y, polygon[0], polygon[1]),
  );
  minimumSquared = Math.min(
    minimumSquared,
    squaredPointSegmentDistance(x, y, polygon[1], polygon[2]),
  );
  minimumSquared = Math.min(
    minimumSquared,
    squaredPointSegmentDistance(x, y, polygon[2], polygon[3]),
  );
  minimumSquared = Math.min(
    minimumSquared,
    squaredPointSegmentDistance(x, y, polygon[3], polygon[0]),
  );
  return minimumSquared;
}

function polygonBoundaryDistanceSquared(x: number, y: number, polygon: readonly Vec2[]): number {
  let minimumSquared = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    minimumSquared = Math.min(
      minimumSquared,
      squaredPointSegmentDistance(x, y, polygon[index], polygon[(index + 1) % polygon.length]),
    );
  }
  return minimumSquared;
}

function rectangleInteriorOrHalo(
  point: Vec3,
  cell: FootprintCell,
  rectangle: AxisAlignedRectangle,
): boolean {
  const [x, y, z] = point;
  const cellMargin = cell.overlap.fraction * Math.min(
    rectangle.maxX - rectangle.minX,
    rectangle.maxY - rectangle.minY,
  );
  if (
    Number.isFinite(cellMargin)
    && cellMargin >= 0
    && (
      !(z >= cell.heightRange[0] - cellMargin && z < cell.heightRange[1] + cellMargin)
      || x < rectangle.minX - cellMargin
      || x > rectangle.maxX + cellMargin
      || y < rectangle.minY - cellMargin
      || y > rectangle.maxY + cellMargin
    )
  ) {
    return false;
  }

  const interior2d = rectangleInterior2d(x, y, rectangle);
  if (z >= cell.heightRange[0] && z < cell.heightRange[1] && interior2d) return true;
  if (!(z >= cell.heightRange[0] - cellMargin && z < cell.heightRange[1] + cellMargin)) {
    return false;
  }
  if (interior2d) return 0 <= cellMargin;
  return cellMargin >= 0
    && rectangleDistanceSquared(x, y, rectangle) <= cellMargin * cellMargin;
}

export function cellAcceptor(cell: FootprintCell): CellAcceptor {
  const bounds = polygonAabb(cell.polygon2d);
  const cellMargin =
    cell.overlap.fraction
    * Math.min(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]);
  axisAlignedRectangle(cell);

  if (!Number.isFinite(cellMargin) || cellMargin < 0) {
    return { accepts: () => true };
  }
  const minX = bounds.min[0] - cellMargin;
  const minY = bounds.min[1] - cellMargin;
  const maxX = bounds.max[0] + cellMargin;
  const maxY = bounds.max[1] + cellMargin;
  const minZ = cell.heightRange[0] - cellMargin;
  const maxZ = cell.heightRange[1] + cellMargin;
  return {
    accepts: (x, y, z) => (
      z >= minZ
      && z < maxZ
      && x >= minX
      && x <= maxX
      && y >= minY
      && y <= maxY
    ),
  };
}

export function isInterior(point: Vec3, cell: FootprintCell): boolean {
  return (
    point[2] >= cell.heightRange[0] &&
    point[2] < cell.heightRange[1] &&
    pointInPolygon([point[0], point[1]], cell.polygon2d, GEOMETRY_EPSILON)
  );
}

export function isHalo(point: Vec3, cell: FootprintCell): boolean {
  if (isInterior(point, cell)) return false;
  const cellMargin = margin(cell);
  return (
    cellMargin >= 0 &&
    point[2] >= cell.heightRange[0] - cellMargin &&
    point[2] < cell.heightRange[1] + cellMargin &&
    (
      pointInPolygon([point[0], point[1]], cell.polygon2d, GEOMETRY_EPSILON)
      || polygonBoundaryDistanceSquared(point[0], point[1], cell.polygon2d) <=
        cellMargin * cellMargin
    )
  );
}

export function isInteriorOrHalo(point: Vec3, cell: FootprintCell): boolean {
  const rectangle = axisAlignedRectangle(cell);
  if (rectangle) return rectangleInteriorOrHalo(point, cell, rectangle);
  return isInterior(point, cell) || isHalo(point, cell);
}

export function isInBand(point: Vec3, first: FootprintCell, second: FootprintCell): boolean {
  return (
    (isHalo(point, first) && isInterior(point, second)) ||
    (isInterior(point, first) && isHalo(point, second))
  );
}

function heightDistance(height: number, range: readonly [number, number]): number {
  if (height < range[0]) return range[0] - height;
  if (height > range[1]) return height - range[1];
  return 0;
}

function distanceToCell(point: Vec3, cell: FootprintCell): number {
  const distance2d = unsignedPolygonDistance(
    [point[0], point[1]],
    cell.polygon2d,
    GEOMETRY_EPSILON,
  );
  return Math.hypot(distance2d, heightDistance(point[2], cell.heightRange));
}

/** Test-only mutation canary. The global lookup is safe when bundled for browsers. */
function mutateTieBreak(): boolean {
  const processValue = (
    globalThis as typeof globalThis & {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process;
  return processValue?.env?.SCENE_CELLS_MUTATE === "tiebreak-highest";
}

function interiorThenNearest(
  point: Vec3,
  planning: OwnershipPlanning,
  mutationEnabled: boolean,
): string {
  const cells = footprintCells(planning).sort(compareCellIds);
  const containing = cells.find((cell) => isInterior(point, cell));
  if (containing) return containing.id;

  let best: FootprintCell | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const cell of cells) {
    const distance = distanceToCell(point, cell);
    if (distance > planning.ownership.exteriorCutoff) continue;
    if (
      distance < bestDistance ||
      (distance === bestDistance &&
        best !== undefined &&
        (mutationEnabled ? cell.id > best.id : cell.id < best.id))
    ) {
      best = cell;
      bestDistance = distance;
    }
  }
  return best?.id ?? planning.ownership.exteriorOwner;
}

type OwnershipRuleEvaluator = (point: Vec3, planning: OwnershipPlanning) => string;

const RULES: Readonly<Record<string, OwnershipRuleEvaluator>> = Object.freeze({
  "interior-then-nearest": (point, planning) =>
    interiorThenNearest(point, planning, mutateTieBreak()),
});

export function evaluateOwnership(point: Vec3, planning: OwnershipPlanning): string {
  const evaluator = RULES[planning.ownership.rule];
  if (!evaluator) throw new UnknownOwnershipRuleError(planning.ownership.rule);
  return evaluator(point, planning);
}

function goldenOwner(point: Vec3, planning: OwnershipPlanning): string {
  if (planning.ownership.rule !== "interior-then-nearest") {
    throw new UnknownOwnershipRuleError(planning.ownership.rule);
  }
  return interiorThenNearest(point, planning, false);
}

function analyticCell(id: string, minX: number, maxX: number): FootprintCell {
  return {
    id,
    kind: "footprint",
    polygon2d: [
      [minX, 0],
      [maxX, 0],
      [maxX, 10],
      [minX, 10],
    ],
    heightRange: [0, 10],
    overlap: { fraction: 0.1 },
    cameras: { assigned: [], reasons: {}, manualOverrides: [] },
    seedPoints: { count: 0 },
  };
}

const ANALYTIC_PLANNING: OwnershipPlanning = {
  ownership: {
    rule: "interior-then-nearest",
    tieBreak: "lowest-cell-id",
    exteriorOwner: "z-exterior",
    exteriorCutoff: 5,
  },
  cells: [analyticCell("A", 0, 10), analyticCell("B", 10, 20), analyticCell("z-exterior", 100, 110)],
};

const EPSILON_INSIDE = GEOMETRY_EPSILON * 2;

// These vectors are intentionally literal, not produced by the evaluator. A and B are
// adjacent 10x10 cells with margin 1 and height [0,10); z-exterior is the fallback.
const ANALYTIC_GOLDENS: readonly OwnershipGoldenVector[] = [
  // Strict footprint interiors are selected before any distance comparison.
  { id: "analytic-01", category: "interior-a", point: [5, 5, 5], expectedOwner: "A", interior: { A: true } },
  { id: "analytic-02", category: "interior-b", point: [15, 5, 5], expectedOwner: "B", interior: { B: true } },
  // The shared edge is excluded from both strict interiors; both distances are zero, so A wins by id.
  { id: "analytic-03", category: "edge-tie", point: [10, 5, 5], expectedOwner: "A", interior: { A: false, B: false } },
  // Moving more than epsilon to either side restores the corresponding half-open ray-crossing interior.
  { id: "analytic-04", category: "edge-a-plus-epsilon", point: [10 - EPSILON_INSIDE, 5, 5], expectedOwner: "A", interior: { A: true, B: false } },
  { id: "analytic-05", category: "edge-b-plus-epsilon", point: [10 + EPSILON_INSIDE, 5, 5], expectedOwner: "B", interior: { A: false, B: true } },
  // Exterior polygon edges have zero 2D distance and therefore remain owned by their nearest cell.
  { id: "analytic-06", category: "edge-west", point: [0, 5, 5], expectedOwner: "A", interior: { A: false } },
  { id: "analytic-07", category: "edge-east", point: [20, 5, 5], expectedOwner: "B", interior: { B: false } },
  { id: "analytic-08", category: "edge-south", point: [5, 0, 5], expectedOwner: "A", interior: { A: false } },
  { id: "analytic-09", category: "edge-north", point: [15, 10, 5], expectedOwner: "B", interior: { B: false } },
  // Height is lower-inclusive and upper-exclusive: h0 is interior while h1 is nearest with dH=0.
  { id: "analytic-10", category: "height-h0", point: [5, 5, 0], expectedOwner: "A", interior: { A: true } },
  { id: "analytic-11", category: "height-h1", point: [5, 5, 10], expectedOwner: "A", interior: { A: false }, halo: { A: true } },
  // The lower halo boundary is inclusive; one epsilon below it is outside.
  { id: "analytic-12", category: "halo-height-lower", point: [5, 5, -1], expectedOwner: "A", halo: { A: true } },
  { id: "analytic-13", category: "halo-height-lower-minus-epsilon", point: [5, 5, -1 - GEOMETRY_EPSILON], expectedOwner: "A", halo: { A: false } },
  // The upper halo boundary is exclusive, so boundary-epsilon is in and the boundary itself is out.
  { id: "analytic-14", category: "halo-height-upper-minus-epsilon", point: [5, 5, 11 - GEOMETRY_EPSILON], expectedOwner: "A", halo: { A: true } },
  { id: "analytic-15", category: "halo-height-upper", point: [5, 5, 11], expectedOwner: "A", halo: { A: false } },
  // Unsigned 2D distance at margin-epsilon and margin is in the halo; margin+epsilon is out.
  { id: "analytic-16", category: "halo-edge-minus-epsilon", point: [-1 + GEOMETRY_EPSILON, 5, 5], expectedOwner: "A", halo: { A: true } },
  { id: "analytic-17", category: "halo-edge-boundary", point: [-1, 5, 5], expectedOwner: "A", halo: { A: true } },
  { id: "analytic-18", category: "halo-edge-plus-epsilon", point: [-1 - GEOMETRY_EPSILON, 5, 5], expectedOwner: "A", halo: { A: false } },
  // exteriorCutoff is inclusive; one epsilon beyond it reaches the serialized exterior owner.
  { id: "analytic-19", category: "cutoff-boundary", point: [-5, 5, 5], expectedOwner: "A" },
  { id: "analytic-20", category: "cutoff-plus-epsilon", point: [-5 - GEOMETRY_EPSILON, 5, 5], expectedOwner: "z-exterior" },
  { id: "analytic-21", category: "far-exterior", point: [-50, -50, 50], expectedOwner: "z-exterior" },
  // Inside B within A's margin, and vice versa, are the two nonempty halves of band(A,B).
  { id: "analytic-22", category: "band-a-halo-b-interior", point: [10.5, 5, 5], expectedOwner: "B", band: { cells: ["A", "B"], expected: true } },
  { id: "analytic-23", category: "band-a-interior-b-halo", point: [9.5, 5, 5], expectedOwner: "A", band: { cells: ["A", "B"], expected: true } },
  // A shared edge has no strict interior member, while margin+epsilon lies beyond A's halo.
  { id: "analytic-24", category: "band-shared-edge", point: [10, 5, 5], expectedOwner: "A", band: { cells: ["A", "B"], expected: false } },
  { id: "analytic-25", category: "band-outside", point: [11 + GEOMETRY_EPSILON, 5, 5], expectedOwner: "B", band: { cells: ["A", "B"], expected: false } },
];

function globalBounds(cells: readonly FootprintCell[]): {
  min: Vec2;
  max: Vec2;
  minHeight: number;
  maxHeight: number;
} {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;
  for (const cell of cells) {
    const bounds = polygonAabb(cell.polygon2d);
    minX = Math.min(minX, bounds.min[0]);
    minY = Math.min(minY, bounds.min[1]);
    maxX = Math.max(maxX, bounds.max[0]);
    maxY = Math.max(maxY, bounds.max[1]);
    minHeight = Math.min(minHeight, cell.heightRange[0]);
    maxHeight = Math.max(maxHeight, cell.heightRange[1]);
  }
  return { min: [minX, minY], max: [maxX, maxY], minHeight, maxHeight };
}

export function emitGoldens(manifestPlanning: OwnershipPlanning, count: number): CellsGoldens {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`Golden count must be a non-negative integer: ${count}`);
  }
  if (manifestPlanning.ownership.rule !== "interior-then-nearest") {
    throw new UnknownOwnershipRuleError(manifestPlanning.ownership.rule);
  }
  const cells = footprintCells(manifestPlanning).sort(compareCellIds);
  if (cells.length === 0) throw new RangeError("Golden generation requires a footprint cell");

  const bounds = globalBounds(cells);
  const width = Math.max(GEOMETRY_EPSILON, bounds.max[0] - bounds.min[0]);
  const height = Math.max(GEOMETRY_EPSILON, bounds.max[1] - bounds.min[1]);
  const centerHeight = (bounds.minHeight + bounds.maxHeight) / 2;
  const generated: OwnershipGoldenVector[] = [];
  const add = (category: string, point: Vec3): void => {
    generated.push({
      id: `generated-${String(generated.length + 1).padStart(4, "0")}`,
      category,
      point,
      expectedOwner: goldenOwner(point, manifestPlanning),
    });
  };

  // A regular grid supplies broad interior, gap, and junction coverage.
  for (let row = 0; row < 10; row += 1) {
    for (let column = 0; column < 10; column += 1) {
      add("grid", [
        bounds.min[0] + (width * column) / 9,
        bounds.min[1] + (height * row) / 9,
        centerHeight,
      ]);
    }
  }

  // Every polygon edge contributes its boundary and probes at boundary +/- epsilon.
  for (const cell of cells) {
    for (let index = 0; index < cell.polygon2d.length; index += 1) {
      const start = cell.polygon2d[index];
      const end = cell.polygon2d[(index + 1) % cell.polygon2d.length];
      const dx = end[0] - start[0];
      const dy = end[1] - start[1];
      const length = Math.hypot(dx, dy);
      if (length === 0) continue;
      const midpoint: Vec2 = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
      const normal: Vec2 = [-dy / length, dx / length];
      add("boundary", [midpoint[0], midpoint[1], centerHeight]);
      add("boundary-minus-epsilon", [
        midpoint[0] - normal[0] * GEOMETRY_EPSILON,
        midpoint[1] - normal[1] * GEOMETRY_EPSILON,
        centerHeight,
      ]);
      add("boundary-plus-epsilon", [
        midpoint[0] + normal[0] * GEOMETRY_EPSILON,
        midpoint[1] + normal[1] * GEOMETRY_EPSILON,
        centerHeight,
      ]);
    }
  }

  // Midpoints between cell AABB centers deliberately exercise inter-cell gaps.
  for (let index = 0; index + 1 < cells.length; index += 1) {
    const first = polygonAabb(cells[index].polygon2d);
    const second = polygonAabb(cells[index + 1].polygon2d);
    add("gap", [
      (first.min[0] + first.max[0] + second.min[0] + second.max[0]) / 4,
      (first.min[1] + first.max[1] + second.min[1] + second.max[1]) / 4,
      centerHeight,
    ]);
  }

  const exteriorOffset = Math.max(width, height) + manifestPlanning.ownership.exteriorCutoff + 1;
  for (const [x, y] of [
    [bounds.min[0] - exteriorOffset, bounds.min[1] - exteriorOffset],
    [bounds.max[0] + exteriorOffset, bounds.min[1] - exteriorOffset],
    [bounds.max[0] + exteriorOffset, bounds.max[1] + exteriorOffset],
    [bounds.min[0] - exteriorOffset, bounds.max[1] + exteriorOffset],
  ] as Vec2[]) {
    add("exterior", [x, y, bounds.maxHeight + exteriorOffset]);
  }

  const target = Math.max(200, count);
  const fillSize = Math.ceil(Math.sqrt(Math.max(1, target - generated.length)));
  for (let row = 0; generated.length < target; row += 1) {
    const column = row % fillSize;
    const gridRow = Math.floor(row / fillSize);
    add("grid-fill", [
      bounds.min[0] + (width * (column + 0.5)) / fillSize,
      bounds.min[1] + (height * (gridRow + 0.5)) / fillSize,
      centerHeight,
    ]);
  }

  return {
    version: 1,
    generated,
    analyticPlanning: ANALYTIC_PLANNING,
    analytic: ANALYTIC_GOLDENS.map((vector) => ({
      ...vector,
      point: [...vector.point] as Vec3,
    })),
  };
}
