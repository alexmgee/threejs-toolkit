import {
  INVALID_POINT3D_INDEX,
  type ColmapDataset,
} from "./colmap";
import type { AssignmentSettings } from "./types";

export type VisibilitySource = AssignmentSettings["visibility"];

export interface CovisibilityGraph {
  sharedPointCount(a: number, b: number): number;
  observedPoints(imageId: number): Uint32Array;
  neighbors(imageId: number, minShared: number): number[];
}

const GRID_SIZE = 256;
const GRID_CELL_COUNT = GRID_SIZE * GRID_SIZE;
const PAIR_BATCH_SIZE = 1_000_000;

interface ProjectionCamera {
  width: number;
  height: number;
  modelId: number;
  parameters: Float64Array;
  rotation: Float64Array;
  translation: Float64Array;
}

interface Plane {
  a: number;
  b: number;
  c: number;
  d: number;
}

interface Point2 {
  x: number;
  y: number;
}

interface PointBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

interface GroundGrid {
  bounds: PointBounds;
  offsets: Uint32Array;
  pointIndices: Uint32Array;
  xScale: number;
  yScale: number;
}

function indexById(ids: Uint32Array, label: string): Map<number, number> {
  const result = new Map<number, number>();
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];
    if (result.has(id)) throw new RangeError(`Duplicate ${label} id: ${id}`);
    result.set(id, index);
  }
  return result;
}

function rotationFromQuaternion(values: Float64Array, offset: number): Float64Array {
  const w = values[offset];
  const x = values[offset + 1];
  const y = values[offset + 2];
  const z = values[offset + 3];
  const norm = Math.hypot(w, x, y, z);
  if (norm === 0) throw new RangeError("COLMAP image has a zero quaternion");
  const qw = w / norm;
  const qx = x / norm;
  const qy = y / norm;
  const qz = z / norm;
  return Float64Array.of(
    1 - 2 * (qy * qy + qz * qz),
    2 * (qx * qy - qz * qw),
    2 * (qx * qz + qy * qw),
    2 * (qx * qy + qz * qw),
    1 - 2 * (qx * qx + qz * qz),
    2 * (qy * qz - qx * qw),
    2 * (qx * qz - qy * qw),
    2 * (qy * qz + qx * qw),
    1 - 2 * (qx * qx + qy * qy),
  );
}

function makeProjectionCameras(dataset: ColmapDataset): ProjectionCamera[] {
  const cameraIndexById = indexById(dataset.cameras.ids, "camera");
  const result = new Array<ProjectionCamera>(dataset.images.ids.length);
  for (let imageIndex = 0; imageIndex < dataset.images.ids.length; imageIndex += 1) {
    const cameraIndex = cameraIndexById.get(dataset.images.cameraIds[imageIndex]);
    if (cameraIndex === undefined) {
      throw new RangeError(`Image ${dataset.images.ids[imageIndex]} references an unknown camera`);
    }
    const parameterStart = dataset.cameras.parameterOffsets[cameraIndex];
    const parameterEnd = dataset.cameras.parameterOffsets[cameraIndex + 1];
    result[imageIndex] = {
      width: dataset.cameras.widths[cameraIndex],
      height: dataset.cameras.heights[cameraIndex],
      modelId: dataset.cameras.modelIds[cameraIndex],
      parameters: dataset.cameras.parameters.subarray(parameterStart, parameterEnd),
      rotation: rotationFromQuaternion(dataset.images.quaternions, imageIndex * 4),
      translation: dataset.images.translations.subarray(imageIndex * 3, imageIndex * 3 + 3),
    };
  }
  return result;
}

function distortProjection(camera: ProjectionCamera, x: number, y: number): [number, number] {
  const p = camera.parameters;
  const radiusSquared = x * x + y * y;
  switch (camera.modelId) {
    case 0:
      return [p[0] * x + p[1], p[0] * y + p[2]];
    case 1:
      return [p[0] * x + p[2], p[1] * y + p[3]];
    case 2: {
      const radial = 1 + p[3] * radiusSquared;
      return [p[0] * radial * x + p[1], p[0] * radial * y + p[2]];
    }
    case 3: {
      const radial = 1 + p[3] * radiusSquared + p[4] * radiusSquared * radiusSquared;
      return [p[0] * radial * x + p[1], p[0] * radial * y + p[2]];
    }
    case 4: {
      const radial = 1 + p[4] * radiusSquared + p[5] * radiusSquared * radiusSquared;
      const dx = 2 * p[6] * x * y + p[7] * (radiusSquared + 2 * x * x);
      const dy = p[6] * (radiusSquared + 2 * y * y) + 2 * p[7] * x * y;
      return [p[0] * (radial * x + dx) + p[2], p[1] * (radial * y + dy) + p[3]];
    }
    case 5:
    case 8:
    case 9: {
      const radius = Math.sqrt(radiusSquared);
      const theta = Math.atan(radius);
      const thetaSquared = theta * theta;
      let distortedTheta = theta;
      if (camera.modelId === 5) {
        distortedTheta *=
          1 +
          p[4] * thetaSquared +
          p[5] * thetaSquared ** 2 +
          p[6] * thetaSquared ** 3 +
          p[7] * thetaSquared ** 4;
      } else if (camera.modelId === 8) {
        distortedTheta *= 1 + p[3] * thetaSquared;
      } else {
        distortedTheta *= 1 + p[3] * thetaSquared + p[4] * thetaSquared ** 2;
      }
      const scale = radius === 0 ? 1 : distortedTheta / radius;
      if (camera.modelId === 5) {
        return [p[0] * scale * x + p[2], p[1] * scale * y + p[3]];
      }
      return [p[0] * scale * x + p[1], p[0] * scale * y + p[2]];
    }
    case 6: {
      const radiusFourth = radiusSquared * radiusSquared;
      const radiusSixth = radiusFourth * radiusSquared;
      const radial =
        (1 + p[4] * radiusSquared + p[5] * radiusFourth + p[8] * radiusSixth) /
        (1 + p[9] * radiusSquared + p[10] * radiusFourth + p[11] * radiusSixth);
      const dx = 2 * p[6] * x * y + p[7] * (radiusSquared + 2 * x * x);
      const dy = p[6] * (radiusSquared + 2 * y * y) + 2 * p[7] * x * y;
      return [p[0] * (radial * x + dx) + p[2], p[1] * (radial * y + dy) + p[3]];
    }
    case 7: {
      const radius = Math.sqrt(radiusSquared);
      const omega = p[4];
      const scale =
        radius === 0 || omega === 0
          ? 1
          : Math.atan(2 * radius * Math.tan(omega / 2)) / (radius * omega);
      return [p[0] * scale * x + p[2], p[1] * scale * y + p[3]];
    }
    default:
      throw new RangeError(`Frustum visibility does not support camera model id ${camera.modelId}`);
  }
}

function inFrustumDepth(
  camera: ProjectionCamera,
  positions: Float64Array,
  pointIndex: number,
): number {
  const pointOffset = pointIndex * 3;
  const worldX = positions[pointOffset];
  const worldY = positions[pointOffset + 1];
  const worldZ = positions[pointOffset + 2];
  const r = camera.rotation;
  const cameraX = r[0] * worldX + r[1] * worldY + r[2] * worldZ + camera.translation[0];
  const cameraY = r[3] * worldX + r[4] * worldY + r[5] * worldZ + camera.translation[1];
  const depth = r[6] * worldX + r[7] * worldY + r[8] * worldZ + camera.translation[2];
  if (!(depth > 0)) return -1;
  const [imageX, imageY] = distortProjection(camera, cameraX / depth, cameraY / depth);
  return imageX >= 0 && imageX < camera.width && imageY >= 0 && imageY < camera.height
    ? depth
    : -1;
}

function uniqueSorted(values: number[]): Uint32Array {
  if (values.length === 0) return new Uint32Array();
  values.sort((a, b) => a - b);
  let count = 1;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] !== values[count - 1]) {
      values[count] = values[index];
      count += 1;
    }
  }
  return Uint32Array.from(values.slice(0, count));
}

function observationsFromTracks(dataset: ColmapDataset): Uint32Array[] {
  const result = new Array<Uint32Array>(dataset.images.ids.length);
  for (let imageIndex = 0; imageIndex < result.length; imageIndex += 1) {
    const values: number[] = [];
    for (
      let observation = dataset.images.point2DOffsets[imageIndex];
      observation < dataset.images.point2DOffsets[imageIndex + 1];
      observation += 1
    ) {
      const pointIndex = dataset.images.point3DIndices[observation];
      if (pointIndex !== INVALID_POINT3D_INDEX) values.push(pointIndex);
    }
    result[imageIndex] = uniqueSorted(values);
  }
  return result;
}

function makeGroundGrid(positions: Float64Array): GroundGrid | undefined {
  const pointCount = positions.length / 3;
  if (pointCount === 0) return undefined;
  const bounds: PointBounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  };
  for (let index = 0; index < positions.length; index += 3) {
    bounds.minX = Math.min(bounds.minX, positions[index]);
    bounds.maxX = Math.max(bounds.maxX, positions[index]);
    bounds.minY = Math.min(bounds.minY, positions[index + 1]);
    bounds.maxY = Math.max(bounds.maxY, positions[index + 1]);
    bounds.minZ = Math.min(bounds.minZ, positions[index + 2]);
    bounds.maxZ = Math.max(bounds.maxZ, positions[index + 2]);
  }
  const xScale = bounds.maxX === bounds.minX ? 0 : GRID_SIZE / (bounds.maxX - bounds.minX);
  const yScale = bounds.maxY === bounds.minY ? 0 : GRID_SIZE / (bounds.maxY - bounds.minY);
  const binOf = (x: number, y: number): number => {
    const gridX = xScale === 0 ? 0 : Math.min(GRID_SIZE - 1, Math.floor((x - bounds.minX) * xScale));
    const gridY = yScale === 0 ? 0 : Math.min(GRID_SIZE - 1, Math.floor((y - bounds.minY) * yScale));
    return gridY * GRID_SIZE + gridX;
  };
  const counts = new Uint32Array(GRID_CELL_COUNT);
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const offset = pointIndex * 3;
    counts[binOf(positions[offset], positions[offset + 1])] += 1;
  }
  const offsets = new Uint32Array(GRID_CELL_COUNT + 1);
  for (let bin = 0; bin < GRID_CELL_COUNT; bin += 1) offsets[bin + 1] = offsets[bin] + counts[bin];
  const pointIndices = new Uint32Array(pointCount);
  const writeOffsets = offsets.slice(0, GRID_CELL_COUNT);
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const offset = pointIndex * 3;
    const bin = binOf(positions[offset], positions[offset + 1]);
    pointIndices[writeOffsets[bin]] = pointIndex;
    writeOffsets[bin] += 1;
  }
  return { bounds, offsets, pointIndices, xScale, yScale };
}

function worldPlane(camera: ProjectionCamera, x: number, y: number, z: number): Plane {
  const r = camera.rotation;
  return {
    a: r[0] * x + r[3] * y + r[6] * z,
    b: r[1] * x + r[4] * y + r[7] * z,
    c: r[2] * x + r[5] * y + r[8] * z,
    d: x * camera.translation[0] + y * camera.translation[1] + z * camera.translation[2],
  };
}

function pinholeFootprint(camera: ProjectionCamera, bounds: PointBounds): Point2[] | undefined {
  if (camera.modelId !== 0 && camera.modelId !== 1) return undefined;
  const p = camera.parameters;
  const fx = p[0];
  const fy = camera.modelId === 0 ? p[0] : p[1];
  const cx = camera.modelId === 0 ? p[1] : p[2];
  const cy = camera.modelId === 0 ? p[2] : p[3];
  if (!(fx > 0) || !(fy > 0)) return undefined;
  const planes: Plane[] = [
    worldPlane(camera, 0, 0, 1),
    worldPlane(camera, fx, 0, cx),
    worldPlane(camera, -fx, 0, camera.width - cx),
    worldPlane(camera, 0, fy, cy),
    worldPlane(camera, 0, -fy, camera.height - cy),
    { a: 1, b: 0, c: 0, d: -bounds.minX },
    { a: -1, b: 0, c: 0, d: bounds.maxX },
    { a: 0, b: 1, c: 0, d: -bounds.minY },
    { a: 0, b: -1, c: 0, d: bounds.maxY },
    { a: 0, b: 0, c: 1, d: -bounds.minZ },
    { a: 0, b: 0, c: -1, d: bounds.maxZ },
  ];
  const vertices: Point2[] = [];
  const coordinateScale = Math.max(
    1,
    Math.abs(bounds.minX),
    Math.abs(bounds.minY),
    Math.abs(bounds.minZ),
    Math.abs(bounds.maxX),
    Math.abs(bounds.maxY),
    Math.abs(bounds.maxZ),
  );
  for (let first = 0; first < planes.length - 2; first += 1) {
    for (let second = first + 1; second < planes.length - 1; second += 1) {
      for (let third = second + 1; third < planes.length; third += 1) {
        const a = planes[first];
        const b = planes[second];
        const c = planes[third];
        const crossX = b.b * c.c - b.c * c.b;
        const crossY = b.c * c.a - b.a * c.c;
        const crossZ = b.a * c.b - b.b * c.a;
        const determinant = a.a * crossX + a.b * crossY + a.c * crossZ;
        const determinantScale =
          Math.hypot(a.a, a.b, a.c) *
          Math.hypot(b.a, b.b, b.c) *
          Math.hypot(c.a, c.b, c.c);
        if (Math.abs(determinant) <= 1e-12 * determinantScale) continue;
        const bcX = crossX;
        const bcY = crossY;
        const bcZ = crossZ;
        const caX = c.b * a.c - c.c * a.b;
        const caY = c.c * a.a - c.a * a.c;
        const caZ = c.a * a.b - c.b * a.a;
        const abX = a.b * b.c - a.c * b.b;
        const abY = a.c * b.a - a.a * b.c;
        const abZ = a.a * b.b - a.b * b.a;
        const x = (-a.d * bcX - b.d * caX - c.d * abX) / determinant;
        const y = (-a.d * bcY - b.d * caY - c.d * abY) / determinant;
        const z = (-a.d * bcZ - b.d * caZ - c.d * abZ) / determinant;
        if (planes.every((plane) => {
          const tolerance =
            1e-9 * coordinateScale * Math.max(1, Math.hypot(plane.a, plane.b, plane.c));
          return plane.a * x + plane.b * y + plane.c * z + plane.d >= -tolerance;
        })) {
          vertices.push({ x, y });
        }
      }
    }
  }
  if (vertices.length === 0) return [];
  vertices.sort((left, right) => left.x - right.x || left.y - right.y);
  const cross = (origin: Point2, left: Point2, right: Point2): number =>
    (left.x - origin.x) * (right.y - origin.y) -
    (left.y - origin.y) * (right.x - origin.x);
  const lower: Point2[] = [];
  for (const point of vertices) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: Point2[] = [];
  for (let index = vertices.length - 1; index >= 0; index -= 1) {
    const point = vertices[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function polygonIntersectsRectangle(
  polygon: readonly Point2[],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const axisX = -(end.y - start.y);
    const axisY = end.x - start.x;
    let polygonMin = Number.POSITIVE_INFINITY;
    let polygonMax = Number.NEGATIVE_INFINITY;
    for (const point of polygon) {
      const projection = point.x * axisX + point.y * axisY;
      polygonMin = Math.min(polygonMin, projection);
      polygonMax = Math.max(polygonMax, projection);
    }
    const projections = [
      minX * axisX + minY * axisY,
      minX * axisX + maxY * axisY,
      maxX * axisX + minY * axisY,
      maxX * axisX + maxY * axisY,
    ];
    const rectangleMin = Math.min(...projections);
    const rectangleMax = Math.max(...projections);
    const tolerance =
      1e-9 * Math.max(1, Math.abs(polygonMin), Math.abs(polygonMax), Math.abs(rectangleMin), Math.abs(rectangleMax));
    if (polygonMax < rectangleMin - tolerance || rectangleMax < polygonMin - tolerance) return false;
  }
  return true;
}

function candidateBins(grid: GroundGrid, camera: ProjectionCamera): number[] {
  const footprint = pinholeFootprint(camera, grid.bounds);
  if (footprint !== undefined && footprint.length === 0) return [];
  if (footprint === undefined || footprint.length < 3 || grid.xScale === 0 || grid.yScale === 0) {
    const all: number[] = [];
    for (let bin = 0; bin < GRID_CELL_COUNT; bin += 1) {
      if (grid.offsets[bin] !== grid.offsets[bin + 1]) all.push(bin);
    }
    return all;
  }
  let footprintMinX = Number.POSITIVE_INFINITY;
  let footprintMinY = Number.POSITIVE_INFINITY;
  let footprintMaxX = Number.NEGATIVE_INFINITY;
  let footprintMaxY = Number.NEGATIVE_INFINITY;
  for (const point of footprint) {
    footprintMinX = Math.min(footprintMinX, point.x);
    footprintMinY = Math.min(footprintMinY, point.y);
    footprintMaxX = Math.max(footprintMaxX, point.x);
    footprintMaxY = Math.max(footprintMaxY, point.y);
  }
  const minGridX = Math.max(
    0,
    Math.floor((footprintMinX - grid.bounds.minX) * grid.xScale) - 1,
  );
  const minGridY = Math.max(
    0,
    Math.floor((footprintMinY - grid.bounds.minY) * grid.yScale) - 1,
  );
  const maxGridX = Math.min(
    GRID_SIZE - 1,
    Math.floor((footprintMaxX - grid.bounds.minX) * grid.xScale) + 1,
  );
  const maxGridY = Math.min(
    GRID_SIZE - 1,
    Math.floor((footprintMaxY - grid.bounds.minY) * grid.yScale) + 1,
  );
  const cellWidth = (grid.bounds.maxX - grid.bounds.minX) / GRID_SIZE;
  const cellHeight = (grid.bounds.maxY - grid.bounds.minY) / GRID_SIZE;
  const result: number[] = [];
  for (let gridY = minGridY; gridY <= maxGridY; gridY += 1) {
    const minY = grid.bounds.minY + gridY * cellHeight;
    const maxY = minY + cellHeight;
    for (let gridX = minGridX; gridX <= maxGridX; gridX += 1) {
      const bin = gridY * GRID_SIZE + gridX;
      if (grid.offsets[bin] === grid.offsets[bin + 1]) continue;
      const minX = grid.bounds.minX + gridX * cellWidth;
      const maxX = minX + cellWidth;
      if (polygonIntersectsRectangle(footprint, minX, minY, maxX, maxY)) result.push(bin);
    }
  }
  return result;
}

function percentile95(values: number[]): number {
  const target = Math.ceil(values.length * 0.95) - 1;
  let left = 0;
  let right = values.length - 1;
  while (left < right) {
    const pivot = values[(left + right) >>> 1];
    let lower = left;
    let upper = right;
    while (lower <= upper) {
      while (values[lower] < pivot) lower += 1;
      while (values[upper] > pivot) upper -= 1;
      if (lower <= upper) {
        [values[lower], values[upper]] = [values[upper], values[lower]];
        lower += 1;
        upper -= 1;
      }
    }
    if (target <= upper) right = upper;
    else if (target >= lower) left = lower;
    else return values[target];
  }
  return values[target];
}

function observationsFromFrustums(dataset: ColmapDataset): Uint32Array[] {
  const cameras = makeProjectionCameras(dataset);
  const grid = makeGroundGrid(dataset.points3D.positions);
  if (!grid) return cameras.map(() => new Uint32Array());
  const result = new Array<Uint32Array>(cameras.length);
  for (let imageIndex = 0; imageIndex < cameras.length; imageIndex += 1) {
    const camera = cameras[imageIndex];
    const bins = candidateBins(grid, camera);
    const depths: number[] = [];
    for (const bin of bins) {
      for (let offset = grid.offsets[bin]; offset < grid.offsets[bin + 1]; offset += 1) {
        const depth = inFrustumDepth(camera, dataset.points3D.positions, grid.pointIndices[offset]);
        if (depth > 0) depths.push(depth);
      }
    }
    const depthLimit = depths.length < 100 ? Number.POSITIVE_INFINITY : percentile95(depths);
    const observed: number[] = [];
    for (const bin of bins) {
      for (let offset = grid.offsets[bin]; offset < grid.offsets[bin + 1]; offset += 1) {
        const pointIndex = grid.pointIndices[offset];
        const depth = inFrustumDepth(camera, dataset.points3D.positions, pointIndex);
        if (depth > 0 && depth <= depthLimit) observed.push(pointIndex);
      }
    }
    result[imageIndex] = uniqueSorted(observed);
  }
  return result;
}

/**
 * Project only the requested cameras and return their observed point indices.
 * Unlike build(dataset, "frustum"), this does not construct a covisibility
 * graph or enumerate pairs of cameras that observe the same point.
 */
export function frustumObservations(
  dataset: ColmapDataset,
  imageIds: readonly number[],
): Map<number, Uint32Array> {
  const imageIndexById = indexById(dataset.images.ids, "image");
  const cameras = makeProjectionCameras(dataset);
  const grid = makeGroundGrid(dataset.points3D.positions);
  const result = new Map<number, Uint32Array>();
  for (const imageId of imageIds) {
    const imageIndex = imageIndexById.get(imageId);
    if (imageIndex === undefined) throw new RangeError(`Unknown COLMAP image id: ${imageId}`);
    if (!grid) {
      result.set(imageId, new Uint32Array());
      continue;
    }
    const camera = cameras[imageIndex];
    const bins = candidateBins(grid, camera);
    const depths: number[] = [];
    for (const bin of bins) {
      for (let offset = grid.offsets[bin]; offset < grid.offsets[bin + 1]; offset += 1) {
        const depth = inFrustumDepth(camera, dataset.points3D.positions, grid.pointIndices[offset]);
        if (depth > 0) depths.push(depth);
      }
    }
    const depthLimit = depths.length < 100 ? Number.POSITIVE_INFINITY : percentile95(depths);
    const observed: number[] = [];
    for (const bin of bins) {
      for (let offset = grid.offsets[bin]; offset < grid.offsets[bin + 1]; offset += 1) {
        const pointIndex = grid.pointIndices[offset];
        const depth = inFrustumDepth(camera, dataset.points3D.positions, pointIndex);
        if (depth > 0 && depth <= depthLimit) observed.push(pointIndex);
      }
    }
    result.set(imageId, uniqueSorted(observed));
  }
  return result;
}

function makeGraph(
  dataset: ColmapDataset,
  observedByImage: Uint32Array[],
): CovisibilityGraph {
  const imageCount = dataset.images.ids.length;
  const pointCount = dataset.points3D.ids.length;
  const observerCounts = new Uint32Array(pointCount);
  let observationCount = 0;
  for (const observed of observedByImage) {
    observationCount += observed.length;
    if (!Number.isSafeInteger(observationCount)) throw new RangeError("Visibility is too large");
    for (const pointIndex of observed) observerCounts[pointIndex] += 1;
  }
  const observerOffsets = new Float64Array(pointCount + 1);
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    observerOffsets[pointIndex + 1] = observerOffsets[pointIndex] + observerCounts[pointIndex];
  }
  const observers = new Uint32Array(observationCount);
  const writeOffsets = observerOffsets.slice(0, pointCount);
  for (let imageIndex = 0; imageIndex < imageCount; imageIndex += 1) {
    for (const pointIndex of observedByImage[imageIndex]) {
      observers[writeOffsets[pointIndex]] = imageIndex;
      writeOffsets[pointIndex] += 1;
    }
  }

  const pairCounts = new Map<number, number>();
  const batch = new Map<number, number>();
  let batchEvents = 0;
  const flush = (): void => {
    for (const [key, count] of batch) pairCounts.set(key, (pairCounts.get(key) ?? 0) + count);
    batch.clear();
    batchEvents = 0;
  };
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const start = observerOffsets[pointIndex];
    const end = observerOffsets[pointIndex + 1];
    for (let left = start; left < end - 1; left += 1) {
      for (let right = left + 1; right < end; right += 1) {
        const first = observers[left];
        const second = observers[right];
        const key = first * imageCount + second;
        batch.set(key, (batch.get(key) ?? 0) + 1);
        batchEvents += 1;
        if (batchEvents === PAIR_BATCH_SIZE) flush();
      }
    }
  }
  flush();

  const adjacency: Array<Array<[number, number]>> = Array.from(
    { length: imageCount },
    () => [],
  );
  for (const [key, count] of pairCounts) {
    const first = Math.floor(key / imageCount);
    const second = key - first * imageCount;
    adjacency[first].push([second, count]);
    adjacency[second].push([first, count]);
  }
  const imageIndexById = indexById(dataset.images.ids, "image");
  const requireImage = (imageId: number): number => {
    const imageIndex = imageIndexById.get(imageId);
    if (imageIndex === undefined) throw new RangeError(`Unknown COLMAP image id: ${imageId}`);
    return imageIndex;
  };

  return {
    sharedPointCount(a, b) {
      const first = requireImage(a);
      const second = requireImage(b);
      if (first === second) return observedByImage[first].length;
      const low = Math.min(first, second);
      const high = Math.max(first, second);
      return pairCounts.get(low * imageCount + high) ?? 0;
    },
    observedPoints(imageId) {
      return observedByImage[requireImage(imageId)].slice();
    },
    neighbors(imageId, minShared) {
      if (!Number.isFinite(minShared) || minShared < 0) {
        throw new RangeError(`minShared must be a non-negative finite number: ${minShared}`);
      }
      const imageIndex = requireImage(imageId);
      return adjacency[imageIndex]
        .filter(([, count]) => count >= minShared)
        .map(([neighbor]) => dataset.images.ids[neighbor])
        .sort((a, b) => a - b);
    },
  };
}

export function build(dataset: ColmapDataset, visibility: VisibilitySource): CovisibilityGraph {
  const observed =
    visibility === "tracks"
      ? observationsFromTracks(dataset)
      : visibility === "frustum"
        ? observationsFromFrustums(dataset)
        : (() => {
            throw new RangeError(`Unknown visibility source: ${String(visibility)}`);
          })();
  return makeGraph(dataset, observed);
}
