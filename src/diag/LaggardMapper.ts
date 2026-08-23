import type { CameraState } from "./cameraEpochs";
import type {
  NetworkSnapshot,
  SpatialMapper,
  SpatialMapperInput,
  SpatialObservation,
} from "./LoadProbe";
import { DEFAULT_SPATIAL_POLICY, type SpatialPolicy } from "./policies";

export type Vec3 = readonly [number, number, number];
export type Mat4 = readonly number[];

export interface WorldBounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface SpatialPageEvidence {
  readonly canonicalPageId: string;
  readonly parentPageId?: string;
  readonly childPageIds?: readonly string[];
  readonly pageLevel: number;
  readonly maxLevel: number;
  readonly resident: boolean;
  readonly renderEligibilityObservable: boolean;
  readonly renderEligible?: boolean;
  readonly worldBounds?: Readonly<WorldBounds>;
  readonly replacementAmbiguity: number;
  readonly occlusionEvidence: number;
  readonly confidence: number;
}

export interface SpatialEvidenceObservation {
  readonly eventTimeMs: number;
  readonly weightedDeltaMs: number;
  readonly pages: readonly Readonly<SpatialPageEvidence>[];
  readonly camera: Readonly<CameraState>;
  readonly viewMatrix?: Mat4;
  readonly nearPlane: number;
  readonly topologyFingerprint: string | null;
}

export interface SpatialGridCell {
  readonly column: number;
  readonly row: number;
  readonly coarsePageLikelihood: number;
}

export interface SpatialPageSummary {
  readonly canonicalPageId: string;
  readonly parentPageId?: string;
  readonly childPageIds: readonly string[];
  readonly pageLevel: number;
  readonly maxLevel: number;
  readonly replacementAmbiguity: number;
  readonly occlusionEvidence: number;
  readonly confidence: number;
  readonly worldBounds: Readonly<WorldBounds>;
  readonly topologyFingerprint: string | null;
  readonly cameraMatrices: readonly Readonly<{ view: readonly number[]; projection: readonly number[] }>[];
  readonly coverage: readonly Readonly<{ column: number; row: number; fraction: number; eventTimeMs: number }>[];
  readonly timeWeights: readonly Readonly<{ eventTimeMs: number; weightedDeltaMs: number }>[];
}

export interface LaggardMapResult {
  readonly gridColumns: number;
  readonly gridRows: number;
  readonly cells: readonly Readonly<SpatialGridCell>[];
  readonly pages: readonly Readonly<SpatialPageSummary>[];
  readonly totalWeightedDurationMs: number;
  readonly insufficientSpatialEvidence: boolean;
  readonly boundedUnavailable: boolean;
  readonly boundedUnavailablePageCount: number;
  readonly boundedUnavailablePages: readonly Readonly<BoundedUnavailablePage>[];
  readonly excludedStatusCounts: Readonly<{ boundedUnavailable: number; notValidatedVisible: number }>;
}

export interface BoundedUnavailablePage {
  readonly status: "bounded-unavailable";
  readonly canonicalPageId: string;
  readonly parentPageId?: string;
  readonly childPageIds: readonly string[];
  readonly pageLevel: number;
  readonly maxLevel: number;
  readonly topologyFingerprint: string | null;
  readonly eventTimeMs: number;
  readonly weightedDeltaMs: number;
}

export interface LaggardMapperOptions {
  readonly policy?: SpatialPolicy;
  readonly coarsePageThreshold?: number;
  readonly residencyConfidencePenalty?: number;
  readonly readEvidence?: (input: Readonly<SpatialMapperInput>) => Readonly<Omit<SpatialEvidenceObservation, "eventTimeMs" | "weightedDeltaMs" | "camera">> | undefined;
}

interface MutablePageSummary {
  canonicalPageId: string;
  parentPageId?: string;
  childPageIds: readonly string[];
  pageLevel: number;
  maxLevel: number;
  replacementAmbiguity: number;
  occlusionEvidence: number;
  confidence: number;
  worldBounds: Readonly<WorldBounds>;
  topologyFingerprint: string | null;
  cameraMatrices: Array<Readonly<{ view: readonly number[]; projection: readonly number[] }>>;
  coverage: Array<Readonly<{ column: number; row: number; fraction: number; eventTimeMs: number }>>;
  timeWeights: Array<Readonly<{ eventTimeMs: number; weightedDeltaMs: number }>>;
}

const CAPABILITIES = Object.freeze([
  "spatial_grid_32x18",
  "near_plane_clipping",
  "time_weighted_coarse_page_likelihood",
  "render_eligible_degraded_page_level",
] as const);

const DECLARED_GAPS = Object.freeze([
  "render_eligible_exact_frame_absent_page_level_only",
  "residency_substitution_confidence_penalty",
  "occlusion_not_ground_truth",
] as const);

export class LaggardMapper implements SpatialMapper {
  readonly capabilities = CAPABILITIES;
  readonly declaredGaps = DECLARED_GAPS;

  private readonly policy: SpatialPolicy;
  private readonly threshold: number;
  private readonly residencyConfidencePenalty: number;
  private readonly readEvidence: LaggardMapperOptions["readEvidence"];
  private observations: SpatialEvidenceObservation[] = [];
  private previousAtMs: number | undefined;
  private disposed = false;

  constructor(options: Readonly<LaggardMapperOptions> = {}) {
    this.policy = options.policy ?? DEFAULT_SPATIAL_POLICY;
    this.threshold = clamp(options.coarsePageThreshold ?? 0, 0, 1);
    this.residencyConfidencePenalty = clamp(options.residencyConfidencePenalty ?? 0.5, 0, 1);
    this.readEvidence = options.readEvidence;
  }

  observe(input: Readonly<SpatialMapperInput>): Readonly<SpatialObservation> | undefined {
    if (this.disposed) return undefined;
    const evidence = this.readEvidence?.(input) ?? readEvidenceFromSnapshot(input.networkSnapshot);
    if (!evidence) return undefined;

    const weightedDeltaMs = this.previousAtMs === undefined ? 0 : Math.max(0, input.eventTimeMs - this.previousAtMs);
    this.previousAtMs = input.eventTimeMs;
    this.observations.push(Object.freeze({
      ...evidence,
      eventTimeMs: input.eventTimeMs,
      weightedDeltaMs,
      camera: input.cameraState,
    }));
    const mapped = this.map(this.observations);
    const coarsePageLikelihood = mapped.cells.reduce((maximum, cell) => Math.max(maximum, cell.coarsePageLikelihood), 0);
    return Object.freeze({
      coarsePageLikelihood,
      coarsePageThreshold: this.threshold,
      validatedVisibleCoarseness: !mapped.insufficientSpatialEvidence,
      requiredReadingsValid: input.networkSnapshot.requiredReadingsValid && !mapped.insufficientSpatialEvidence,
      value: mapped,
    });
  }

  map(observations: readonly Readonly<SpatialEvidenceObservation>[]): Readonly<LaggardMapResult> {
    const columns = this.policy.gridColumns;
    const rows = this.policy.gridRows;
    const duration = observations.reduce((sum, observation) => sum + Math.max(0, observation.weightedDeltaMs), 0);
    const maximumLevel = observations.reduce(
      (maximum, observation) => observation.pages.reduce((pageMaximum, page) => Math.max(pageMaximum, page.maxLevel), maximum),
      0,
    );
    if (duration <= 0 || maximumLevel === 0) {
      return emptySpatialEvidence(columns, rows, duration, observations);
    }

    const weightedCells = new Float64Array(columns * rows);
    const summaries = new Map<string, MutablePageSummary>();
    let boundedUnavailable = 0;
    let notValidatedVisible = 0;
    const boundedUnavailablePages: BoundedUnavailablePage[] = [];

    for (const observation of observations) {
      const weight = Math.max(0, observation.weightedDeltaMs);
      if (weight <= 0) continue;
      const view = validMatrix(observation.viewMatrix) ?? viewMatrixFromCamera(observation.camera);
      const projection = validMatrix(observation.camera.projectionMatrix);
      if (!view || !projection || !(observation.nearPlane > 0)) {
        notValidatedVisible += observation.pages.length;
        continue;
      }

      for (const page of observation.pages) {
        if (!page.worldBounds) {
          boundedUnavailable += 1;
          boundedUnavailablePages.push(Object.freeze({
            status: "bounded-unavailable",
            canonicalPageId: page.canonicalPageId,
            ...(page.parentPageId === undefined ? {} : { parentPageId: page.parentPageId }),
            childPageIds: Object.freeze([...(page.childPageIds ?? [])]),
            pageLevel: page.pageLevel,
            maxLevel: page.maxLevel,
            topologyFingerprint: observation.topologyFingerprint,
            eventTimeMs: observation.eventTimeMs,
            weightedDeltaMs: weight,
          }));
          continue;
        }
        const renderCondition = page.renderEligibilityObservable ? page.renderEligible === true : page.resident;
        if (!renderCondition || page.pageLevel < 0 || page.maxLevel <= 0 || page.pageLevel > page.maxLevel) {
          notValidatedVisible += 1;
          continue;
        }
        const polygon = projectedBoundsPolygon(page.worldBounds, view, projection, observation.nearPlane);
        if (polygon.length < 3) {
          notValidatedVisible += 1;
          continue;
        }

        const confidence = clamp(page.confidence, 0, 1)
          * clamp(1 - page.replacementAmbiguity, 0, 1)
          * clamp(page.occlusionEvidence, 0, 1)
          * (page.renderEligibilityObservable ? 1 : this.residencyConfidencePenalty);
        const coarseness = 1 - page.pageLevel / page.maxLevel;
        if (coarseness <= 0 || confidence <= 0) continue;
        const coverage = cellCoverage(polygon, columns, rows);
        if (coverage.length === 0) {
          notValidatedVisible += 1;
          continue;
        }
        for (const cell of coverage) {
          weightedCells[cell.row * columns + cell.column] += weight * cell.fraction * coarseness * confidence;
        }

        const summary = summaries.get(page.canonicalPageId) ?? createSummary(page, observation.topologyFingerprint);
        summary.cameraMatrices.push(Object.freeze({ view: Object.freeze([...view]), projection: Object.freeze([...projection]) }));
        summary.timeWeights.push(Object.freeze({ eventTimeMs: observation.eventTimeMs, weightedDeltaMs: weight }));
        for (const cell of coverage) summary.coverage.push(Object.freeze({ ...cell, eventTimeMs: observation.eventTimeMs }));
        summaries.set(page.canonicalPageId, summary);
      }
    }

    const cells: SpatialGridCell[] = [];
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const value = clamp(weightedCells[row * columns + column] / duration, 0, 1);
        if (value > 0) cells.push(Object.freeze({ column, row, coarsePageLikelihood: value }));
      }
    }
    const pages = [...summaries.values()].map(freezeSummary);
    return Object.freeze({
      gridColumns: columns,
      gridRows: rows,
      cells: Object.freeze(cells),
      pages: Object.freeze(pages),
      totalWeightedDurationMs: duration,
      insufficientSpatialEvidence: cells.length === 0,
      boundedUnavailable: boundedUnavailable > 0,
      boundedUnavailablePageCount: boundedUnavailable,
      boundedUnavailablePages: Object.freeze(boundedUnavailablePages),
      excludedStatusCounts: Object.freeze({ boundedUnavailable, notValidatedVisible }),
    });
  }

  resetEpoch(): void {
    this.observations = [];
    this.previousAtMs = undefined;
  }

  dispose(): void {
    this.disposed = true;
    this.resetEpoch();
  }
}

type Point2 = readonly [number, number];
type Point3 = readonly [number, number, number];

function projectedBoundsPolygon(bounds: Readonly<WorldBounds>, view: readonly number[], projection: readonly number[], near: number): Point2[] {
  if (!validBounds(bounds)) return [];
  const corners = boundsCorners(bounds).map((point) => transformPoint(view, point));
  const triangles = [
    [0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5],
    [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6],
    [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3],
  ] as const;
  const points: Point2[] = [];
  for (const triangle of triangles) {
    const clipped = clipNear(triangle.map((index) => corners[index]), near);
    for (const point of clipped) {
      const projected = projectPoint(projection, point);
      if (projected) points.push(projected);
    }
  }
  if (points.length < 3) return [];
  return clipRect(convexHull(points), -1, -1, 1, 1);
}

function cellCoverage(polygon: readonly Point2[], columns: number, rows: number): Array<{ column: number; row: number; fraction: number }> {
  const result: Array<{ column: number; row: number; fraction: number }> = [];
  const cellWidth = 2 / columns;
  const cellHeight = 2 / rows;
  for (let row = 0; row < rows; row += 1) {
    const top = 1 - row * cellHeight;
    const bottom = top - cellHeight;
    for (let column = 0; column < columns; column += 1) {
      const left = -1 + column * cellWidth;
      const right = left + cellWidth;
      const clipped = clipRect(polygon, left, bottom, right, top);
      if (clipped.length < 3) continue;
      const fraction = clamp(polygonArea(clipped) / (cellWidth * cellHeight), 0, 1);
      if (fraction > 0) result.push({ column, row, fraction });
    }
  }
  return result;
}

function clipNear(polygon: readonly Point3[], near: number): Point3[] {
  return clipPolygon(polygon, (point) => point[2] <= -near, (a, b) => {
    const t = (-near - a[2]) / (b[2] - a[2]);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, -near];
  });
}

function clipRect(polygon: readonly Point2[], left: number, bottom: number, right: number, top: number): Point2[] {
  let output = [...polygon];
  output = clipPolygon(output, (p) => p[0] >= left, (a, b) => intersectAxis(a, b, 0, left));
  output = clipPolygon(output, (p) => p[0] <= right, (a, b) => intersectAxis(a, b, 0, right));
  output = clipPolygon(output, (p) => p[1] >= bottom, (a, b) => intersectAxis(a, b, 1, bottom));
  output = clipPolygon(output, (p) => p[1] <= top, (a, b) => intersectAxis(a, b, 1, top));
  return output;
}

function clipPolygon<T extends readonly number[]>(polygon: readonly T[], inside: (point: T) => boolean, intersection: (a: T, b: T) => T): T[] {
  if (polygon.length === 0) return [];
  const output: T[] = [];
  let previous = polygon[polygon.length - 1];
  let previousInside = inside(previous);
  for (const current of polygon) {
    const currentInside = inside(current);
    if (currentInside !== previousInside) output.push(intersection(previous, current));
    if (currentInside) output.push(current);
    previous = current;
    previousInside = currentInside;
  }
  return output;
}

function intersectAxis(a: Point2, b: Point2, axis: 0 | 1, value: number): Point2 {
  const t = (value - a[axis]) / (b[axis] - a[axis]);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function convexHull(points: readonly Point2[]): Point2[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Point2, a: Point2, b: Point2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point2[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Point2[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function polygonArea(points: readonly Point2[]): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    twiceArea += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(twiceArea) / 2;
}

function boundsCorners(bounds: Readonly<WorldBounds>): Point3[] {
  const [minX, minY, minZ] = bounds.min;
  const [maxX, maxY, maxZ] = bounds.max;
  return [
    [minX, minY, minZ], [maxX, minY, minZ], [minX, maxY, minZ], [maxX, maxY, minZ],
    [minX, minY, maxZ], [maxX, minY, maxZ], [minX, maxY, maxZ], [maxX, maxY, maxZ],
  ];
}

function transformPoint(matrix: readonly number[], point: Point3): Point3 {
  const [x, y, z] = point;
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  const divisor = w === 0 ? 1 : w;
  return [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / divisor,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / divisor,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / divisor,
  ];
}

function projectPoint(matrix: readonly number[], point: Point3): Point2 | undefined {
  const [x, y, z] = point;
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  if (!(w > 0) || !Number.isFinite(w)) return undefined;
  const projectedX = (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w;
  const projectedY = (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w;
  const projectedZ = (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w;
  return Number.isFinite(projectedX) && Number.isFinite(projectedY) && projectedZ >= -1 && projectedZ <= 1
    ? [projectedX, projectedY]
    : undefined;
}

function viewMatrixFromCamera(camera: Readonly<CameraState>): readonly number[] | undefined {
  const [x, y, z, w] = camera.quaternion;
  if (![x, y, z, w, ...camera.position].every(Number.isFinite)) return undefined;
  const [px, py, pz] = camera.position;
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  const r00 = 1 - 2 * (yy + zz), r01 = 2 * (xy - wz), r02 = 2 * (xz + wy);
  const r10 = 2 * (xy + wz), r11 = 1 - 2 * (xx + zz), r12 = 2 * (yz - wx);
  const r20 = 2 * (xz - wy), r21 = 2 * (yz + wx), r22 = 1 - 2 * (xx + yy);
  return [
    r00, r01, r02, 0,
    r10, r11, r12, 0,
    r20, r21, r22, 0,
    -(r00 * px + r10 * py + r20 * pz),
    -(r01 * px + r11 * py + r21 * pz),
    -(r02 * px + r12 * py + r22 * pz),
    1,
  ];
}

function validMatrix(matrix: readonly number[] | undefined): readonly number[] | undefined {
  return matrix?.length === 16 && matrix.every(Number.isFinite) ? matrix : undefined;
}

function validBounds(bounds: Readonly<WorldBounds>): boolean {
  return bounds.min.length === 3 && bounds.max.length === 3
    && [...bounds.min, ...bounds.max].every(Number.isFinite)
    && bounds.min.every((value, index) => value <= bounds.max[index]);
}

function createSummary(page: Readonly<SpatialPageEvidence>, topologyFingerprint: string | null): MutablePageSummary {
  return {
    canonicalPageId: page.canonicalPageId,
    ...(page.parentPageId === undefined ? {} : { parentPageId: page.parentPageId }),
    childPageIds: Object.freeze([...(page.childPageIds ?? [])]),
    pageLevel: page.pageLevel,
    maxLevel: page.maxLevel,
    replacementAmbiguity: page.replacementAmbiguity,
    occlusionEvidence: page.occlusionEvidence,
    confidence: page.confidence,
    worldBounds: Object.freeze({ min: Object.freeze([...page.worldBounds!.min]) as Vec3, max: Object.freeze([...page.worldBounds!.max]) as Vec3 }),
    topologyFingerprint,
    cameraMatrices: [],
    coverage: [],
    timeWeights: [],
  };
}

function freezeSummary(summary: MutablePageSummary): Readonly<SpatialPageSummary> {
  return Object.freeze({
    ...summary,
    cameraMatrices: Object.freeze(summary.cameraMatrices),
    coverage: Object.freeze(summary.coverage),
    timeWeights: Object.freeze(summary.timeWeights),
  });
}

function emptySpatialEvidence(
  columns: number,
  rows: number,
  duration: number,
  observations: readonly Readonly<SpatialEvidenceObservation>[],
): Readonly<LaggardMapResult> {
  const summaries = new Map<string, MutablePageSummary>();
  const unavailable: BoundedUnavailablePage[] = [];
  for (const observation of observations) {
    const view = validMatrix(observation.viewMatrix) ?? viewMatrixFromCamera(observation.camera);
    const projection = validMatrix(observation.camera.projectionMatrix);
    for (const page of observation.pages) {
      if (!page.worldBounds) {
        unavailable.push(Object.freeze({
          status: "bounded-unavailable",
          canonicalPageId: page.canonicalPageId,
          ...(page.parentPageId === undefined ? {} : { parentPageId: page.parentPageId }),
          childPageIds: Object.freeze([...(page.childPageIds ?? [])]),
          pageLevel: page.pageLevel,
          maxLevel: page.maxLevel,
          topologyFingerprint: observation.topologyFingerprint,
          eventTimeMs: observation.eventTimeMs,
          weightedDeltaMs: Math.max(0, observation.weightedDeltaMs),
        }));
        continue;
      }
      const summary = summaries.get(page.canonicalPageId) ?? createSummary(page, observation.topologyFingerprint);
      if (view && projection) {
        summary.cameraMatrices.push(Object.freeze({ view: Object.freeze([...view]), projection: Object.freeze([...projection]) }));
      }
      summary.timeWeights.push(Object.freeze({
        eventTimeMs: observation.eventTimeMs,
        weightedDeltaMs: Math.max(0, observation.weightedDeltaMs),
      }));
      summaries.set(page.canonicalPageId, summary);
    }
  }
  return Object.freeze({
    gridColumns: columns,
    gridRows: rows,
    cells: Object.freeze([]),
    pages: Object.freeze([...summaries.values()].map(freezeSummary)),
    totalWeightedDurationMs: duration,
    insufficientSpatialEvidence: true,
    boundedUnavailable: unavailable.length > 0,
    boundedUnavailablePageCount: unavailable.length,
    boundedUnavailablePages: Object.freeze(unavailable),
    excludedStatusCounts: Object.freeze({ boundedUnavailable: unavailable.length, notValidatedVisible: 0 }),
  });
}

function readEvidenceFromSnapshot(snapshot: Readonly<NetworkSnapshot>): Readonly<Omit<SpatialEvidenceObservation, "eventTimeMs" | "weightedDeltaMs" | "camera">> | undefined {
  const value = snapshot.value;
  if (!isRecord(value)) return undefined;
  const spatial = isRecord(value.spatialEvidence) ? value.spatialEvidence : value;
  if (!Array.isArray(spatial.pages) || typeof spatial.nearPlane !== "number") return undefined;
  const pages = spatial.pages.filter(isSpatialPageEvidence);
  return Object.freeze({
    pages: Object.freeze(pages),
    ...(Array.isArray(spatial.viewMatrix) ? { viewMatrix: spatial.viewMatrix.filter((item): item is number => typeof item === "number") } : {}),
    nearPlane: spatial.nearPlane,
    topologyFingerprint: typeof spatial.topologyFingerprint === "string" ? spatial.topologyFingerprint : null,
  });
}

function isSpatialPageEvidence(value: unknown): value is Readonly<SpatialPageEvidence> {
  if (!isRecord(value)) return false;
  return typeof value.canonicalPageId === "string"
    && typeof value.pageLevel === "number"
    && typeof value.maxLevel === "number"
    && typeof value.resident === "boolean"
    && typeof value.renderEligibilityObservable === "boolean"
    && typeof value.replacementAmbiguity === "number"
    && typeof value.occlusionEvidence === "number"
    && typeof value.confidence === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
