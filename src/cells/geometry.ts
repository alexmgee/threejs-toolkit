import type { Vec2 } from "./types";

export const GEOMETRY_EPSILON = 1e-9;

export interface Aabb2 {
  min: Vec2;
  max: Vec2;
}

function squaredPointSegmentDistance(point: Vec2, start: Vec2, end: Vec2): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    const px = point[0] - start[0];
    const py = point[1] - start[1];
    return px * px + py * py;
  }

  const projection = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared),
  );
  const closestX = start[0] + projection * dx;
  const closestY = start[1] + projection * dy;
  const px = point[0] - closestX;
  const py = point[1] - closestY;
  return px * px + py * py;
}

function assertPolygon(polygon: readonly Vec2[]): void {
  if (polygon.length < 3) {
    throw new RangeError("A polygon requires at least three vertices");
  }
}

/** Strict polygon interior. Boundary points within epsilon are excluded. */
export function pointInPolygon(
  point: Vec2,
  polygon: readonly Vec2[],
  epsilon = GEOMETRY_EPSILON,
): boolean {
  assertPolygon(polygon);

  const epsilonSquared = epsilon * epsilon;
  for (let index = 0; index < polygon.length; index += 1) {
    const next = (index + 1) % polygon.length;
    if (squaredPointSegmentDistance(point, polygon[index], polygon[next]) <= epsilonSquared) {
      return false;
    }
  }

  let inside = false;
  for (let index = 0; index < polygon.length; index += 1) {
    const next = (index + 1) % polygon.length;
    const start = polygon[index];
    const end = polygon[next];

    // A ray sees a non-horizontal edge only on [minY, maxY), so a shared
    // vertex is counted once rather than once for each incident edge.
    const crossesY =
      (start[1] <= point[1] && point[1] < end[1]) ||
      (end[1] <= point[1] && point[1] < start[1]);
    if (!crossesY) continue;

    const crossingX =
      start[0] + ((point[1] - start[1]) * (end[0] - start[0])) / (end[1] - start[1]);
    if (crossingX > point[0]) inside = !inside;
  }

  return inside;
}

export function unsignedPolygonDistance(
  point: Vec2,
  polygon: readonly Vec2[],
  epsilon = GEOMETRY_EPSILON,
): number {
  assertPolygon(polygon);
  if (pointInPolygon(point, polygon, epsilon)) return 0;

  let minimumSquared = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const next = (index + 1) % polygon.length;
    minimumSquared = Math.min(
      minimumSquared,
      squaredPointSegmentDistance(point, polygon[index], polygon[next]),
    );
  }
  return Math.sqrt(minimumSquared);
}

export function polygonAabb(polygon: readonly Vec2[]): Aabb2 {
  assertPolygon(polygon);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const [x, y] of polygon) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return { min: [minX, minY], max: [maxX, maxY] };
}

function cross(origin: Vec2, first: Vec2, second: Vec2): number {
  return (
    (first[0] - origin[0]) * (second[1] - origin[1]) -
    (first[1] - origin[1]) * (second[0] - origin[0])
  );
}

function segmentsProperlyCross(
  aStart: Vec2,
  aEnd: Vec2,
  bStart: Vec2,
  bEnd: Vec2,
  epsilon: number,
): boolean {
  const aSideStart = cross(aStart, aEnd, bStart);
  const aSideEnd = cross(aStart, aEnd, bEnd);
  const bSideStart = cross(bStart, bEnd, aStart);
  const bSideEnd = cross(bStart, bEnd, aEnd);
  return (
    ((aSideStart > epsilon && aSideEnd < -epsilon) ||
      (aSideStart < -epsilon && aSideEnd > epsilon)) &&
    ((bSideStart > epsilon && bSideEnd < -epsilon) ||
      (bSideStart < -epsilon && bSideEnd > epsilon))
  );
}

function hasSharedInteriorBesideEdge(
  polygon: readonly Vec2[],
  other: readonly Vec2[],
  epsilon: number,
): boolean {
  const bounds = polygonAabb(polygon);
  const scale = Math.max(1, bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]);
  const offset = epsilon * 16 * scale;

  for (let index = 0; index < polygon.length; index += 1) {
    const next = (index + 1) % polygon.length;
    const start = polygon[index];
    const end = polygon[next];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;

    const midpoint: Vec2 = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    const normal: Vec2 = [(-dy / length) * offset, (dx / length) * offset];
    const probes: Vec2[] = [
      [midpoint[0] + normal[0], midpoint[1] + normal[1]],
      [midpoint[0] - normal[0], midpoint[1] - normal[1]],
    ];
    if (
      probes.some(
        (probe) => pointInPolygon(probe, polygon, epsilon) && pointInPolygon(probe, other, epsilon),
      )
    ) {
      return true;
    }
  }

  return false;
}

/** True only when the strict interiors have non-zero overlap. */
export function polygonsOverlap(
  first: readonly Vec2[],
  second: readonly Vec2[],
  epsilon = GEOMETRY_EPSILON,
): boolean {
  assertPolygon(first);
  assertPolygon(second);

  const firstBounds = polygonAabb(first);
  const secondBounds = polygonAabb(second);
  if (
    Math.min(firstBounds.max[0], secondBounds.max[0]) -
        Math.max(firstBounds.min[0], secondBounds.min[0]) <=
      epsilon ||
    Math.min(firstBounds.max[1], secondBounds.max[1]) -
        Math.max(firstBounds.min[1], secondBounds.min[1]) <=
      epsilon
  ) {
    return false;
  }

  for (let firstIndex = 0; firstIndex < first.length; firstIndex += 1) {
    const firstNext = (firstIndex + 1) % first.length;
    for (let secondIndex = 0; secondIndex < second.length; secondIndex += 1) {
      const secondNext = (secondIndex + 1) % second.length;
      if (
        segmentsProperlyCross(
          first[firstIndex],
          first[firstNext],
          second[secondIndex],
          second[secondNext],
          epsilon,
        )
      ) {
        return true;
      }
    }
  }

  if (first.some((vertex) => pointInPolygon(vertex, second, epsilon))) return true;
  if (second.some((vertex) => pointInPolygon(vertex, first, epsilon))) return true;

  // Coincident polygons have no proper crossings and every vertex is on a
  // boundary. Probe immediately to either side of each edge to distinguish
  // coincident interiors from a merely shared edge.
  return (
    hasSharedInteriorBesideEdge(first, second, epsilon) ||
    hasSharedInteriorBesideEdge(second, first, epsilon)
  );
}
