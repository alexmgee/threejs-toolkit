import {
  ADAPTER_DECLARED_GAPS,
  SPARK_PAGER_ADAPTER_VERSION,
  SPARK_PAGER_CAPABILITIES,
  SUPPORTED_SPARK_VERSION,
  type AdapterByteRange,
  type AdapterStageCapabilities,
} from "../SparkPagerAdapter";
import type { ProbeStatus } from "../events";

export const SPARK_PAGER_FIXTURE_SCHEMA_VERSION = 1 as const;

export interface SparkPagerFixtureFingerprint {
  readonly pagedMembers: readonly string[];
  readonly pagerMembers: readonly string[];
  readonly pageSplats: number;
}

export interface SparkPagerFixtureRequest {
  readonly requestId: string;
  readonly sceneLocalPagedId: string;
  readonly chunk: number;
  readonly attempt: number;
  readonly expectedUrl?: string;
  readonly byteRange?: Readonly<AdapterByteRange>;
  readonly combinedStartMs: number;
  readonly combinedEndMs?: number;
  readonly outcome?: "fulfilled" | "rejected" | "threw";
  readonly error?: string;
  readonly numSplats?: number;
  readonly physicalPage?: number;
  readonly canonicalPageId?: string;
}

export interface SparkPagerFixtureForwardRow {
  readonly sceneLocalPagedId: string;
  readonly chunk: number;
  readonly page: number;
  readonly lru: number;
}

export interface SparkPagerFixtureReverseRow {
  readonly page: number;
  readonly sceneLocalPagedId: string;
  readonly chunk: number;
  readonly time: number;
}

export interface SparkPagerFixtureQueueLengths {
  readonly pageFreelist: number;
  readonly freeablePages: number;
  readonly newUploads: number;
  readonly readyUploads: number;
  readonly lodTreeUpdates: number;
  readonly fetchers: number;
  readonly fetched: number;
  readonly fetchPriority: number;
}

export interface SparkPagerFixtureSelection {
  readonly numSplats: number;
  readonly indexFingerprint: string;
  readonly physicalPages: readonly number[];
}

export interface SparkPagerFixtureSnapshot {
  readonly sequence: number;
  readonly atMs: number;
  readonly probeStatus: ProbeStatus;
  readonly reasons: readonly string[];
  readonly declaredGaps: readonly string[];
  readonly forward: readonly Readonly<SparkPagerFixtureForwardRow>[];
  readonly reverse: readonly Readonly<SparkPagerFixtureReverseRow>[];
  readonly queueLengths: Readonly<SparkPagerFixtureQueueLengths>;
  readonly selection?: Readonly<SparkPagerFixtureSelection>;
  readonly transitions: readonly string[];
}

export type SparkPagerFixtureRowType =
  | "adapter_attached"
  | "adapter_invalidated"
  | "request_started"
  | "request_range_joined"
  | "decode_combined_completed"
  | "request_failed"
  | "gpu_upload_started"
  | "gpu_upload_completed"
  | "gpu_upload_failed"
  | "selection_changed"
  | "pager_snapshot";

export interface SparkPagerFixtureRow {
  readonly sequence: number;
  readonly atMs: number;
  readonly type: SparkPagerFixtureRowType;
  readonly probeStatus: ProbeStatus;
  readonly reasons: readonly string[];
  readonly declaredGaps: readonly string[];
  readonly requestId?: string;
  readonly canonicalPageId?: string;
  readonly sceneLocalPagedId?: string;
  readonly chunk?: number;
  readonly physicalPage?: number;
  readonly outcome?: "fulfilled" | "rejected" | "threw";
}

/** Runtime-verified Phase-0b JSON fixture schema. */
export interface SparkPagerFixture {
  readonly schemaVersion: typeof SPARK_PAGER_FIXTURE_SCHEMA_VERSION;
  readonly adapterVersion: typeof SPARK_PAGER_ADAPTER_VERSION;
  readonly sparkVersion: typeof SUPPORTED_SPARK_VERSION;
  readonly assetUrl: string;
  readonly fingerprint: Readonly<SparkPagerFixtureFingerprint>;
  readonly capabilities: Readonly<AdapterStageCapabilities>;
  readonly declaredGaps: readonly string[];
  readonly requests: readonly Readonly<SparkPagerFixtureRequest>[];
  readonly snapshots: readonly Readonly<SparkPagerFixtureSnapshot>[];
  readonly rows: readonly Readonly<SparkPagerFixtureRow>[];
}

const ROW_TYPES: ReadonlySet<string> = new Set<SparkPagerFixtureRowType>([
  "adapter_attached",
  "adapter_invalidated",
  "request_started",
  "request_range_joined",
  "decode_combined_completed",
  "request_failed",
  "gpu_upload_started",
  "gpu_upload_completed",
  "gpu_upload_failed",
  "selection_changed",
  "pager_snapshot",
]);

const CAPABILITY_ENTRIES = Object.entries(SPARK_PAGER_CAPABILITIES) as ReadonlyArray<readonly [keyof AdapterStageCapabilities, string]>;

/**
 * Rejects malformed, version-mismatched, non-monotonic, unknown-discriminant,
 * or internally inconsistent fixtures before Phase-6 replay.
 */
export function validateFixtureSchema(value: unknown): value is SparkPagerFixture {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== SPARK_PAGER_FIXTURE_SCHEMA_VERSION) return false;
  if (value.adapterVersion !== SPARK_PAGER_ADAPTER_VERSION || value.sparkVersion !== SUPPORTED_SPARK_VERSION) return false;
  if (typeof value.assetUrl !== "string" || value.assetUrl.length === 0) return false;
  if (!validateFingerprint(value.fingerprint) || !validateCapabilities(value.capabilities)) return false;
  if (!isStringArray(value.declaredGaps) || !containsRequiredGaps(value.declaredGaps)) return false;
  if (!Array.isArray(value.requests) || !Array.isArray(value.snapshots) || !Array.isArray(value.rows)) return false;
  if (!validateRequests(value.requests)) return false;
  if (!validateSnapshots(value.snapshots, value.fingerprint.pageSplats)) return false;
  if (!validateRows(value.rows)) return false;
  return true;
}

function validateFingerprint(value: unknown): value is SparkPagerFixtureFingerprint {
  if (!isRecord(value)) return false;
  return isUniqueStringArray(value.pagedMembers)
    && value.pagedMembers.length > 0
    && isUniqueStringArray(value.pagerMembers)
    && value.pagerMembers.length > 0
    && value.pageSplats === 65_536;
}

function validateCapabilities(value: unknown): value is AdapterStageCapabilities {
  if (!isRecord(value)) return false;
  return CAPABILITY_ENTRIES.every(([name, classification]) => value[name] === classification);
}

function validateRequests(values: readonly unknown[]): boolean {
  const ids = new Set<string>();
  let previousStart = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!isRecord(value)) return false;
    if (typeof value.sceneLocalPagedId !== "string" || !isCanonicalPagedId(value.sceneLocalPagedId)) return false;
    if (!isNonNegativeInteger(value.chunk) || !isPositiveInteger(value.attempt)) return false;
    const expectedId = `${value.sceneLocalPagedId}:chunk:${value.chunk}:attempt:${value.attempt}`;
    if (value.requestId !== expectedId || ids.has(expectedId)) return false;
    ids.add(expectedId);
    if (!isNonNegativeFinite(value.combinedStartMs) || value.combinedStartMs < previousStart) return false;
    previousStart = value.combinedStartMs;
    if (value.combinedEndMs !== undefined && (!isNonNegativeFinite(value.combinedEndMs) || value.combinedEndMs < value.combinedStartMs)) return false;
    if (value.outcome !== undefined && value.outcome !== "fulfilled" && value.outcome !== "rejected" && value.outcome !== "threw") return false;
    if (value.outcome !== undefined && value.combinedEndMs === undefined) return false;
    if (value.error !== undefined && typeof value.error !== "string") return false;
    if (value.expectedUrl !== undefined && typeof value.expectedUrl !== "string") return false;
    if (value.byteRange !== undefined && !validateByteRange(value.byteRange)) return false;
    if (value.numSplats !== undefined && (!isNonNegativeInteger(value.numSplats) || value.numSplats > 65_536)) return false;
    if (value.physicalPage !== undefined && !isNonNegativeInteger(value.physicalPage)) return false;
    if (value.canonicalPageId !== undefined && (typeof value.canonicalPageId !== "string" || value.physicalPage === undefined)) return false;
  }
  return true;
}

function validateSnapshots(values: readonly unknown[], pageSplats: number): boolean {
  let previousSequence = 0;
  let previousAtMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!isRecord(value)) return false;
    if (!isPositiveInteger(value.sequence) || value.sequence <= previousSequence) return false;
    if (!isNonNegativeFinite(value.atMs) || value.atMs < previousAtMs) return false;
    previousSequence = value.sequence;
    previousAtMs = value.atMs;
    if (!isProbeStatus(value.probeStatus) || !isStringArray(value.reasons) || !isStringArray(value.declaredGaps) || !containsRequiredGaps(value.declaredGaps)) return false;
    if (!Array.isArray(value.forward) || !Array.isArray(value.reverse) || !isRecord(value.queueLengths) || !Array.isArray(value.transitions)) return false;
    if (!validateForwardReverse(value.forward, value.reverse)) return false;
    if (!validateQueueLengths(value.queueLengths)) return false;
    if (!isStringArray(value.transitions)) return false;
    if (value.selection !== undefined && !validateSelection(value.selection, pageSplats)) return false;
  }
  return true;
}

function validateForwardReverse(forwardValues: readonly unknown[], reverseValues: readonly unknown[]): boolean {
  const forwardByPage = new Map<number, string>();
  for (const value of forwardValues) {
    if (!isRecord(value) || typeof value.sceneLocalPagedId !== "string" || !isCanonicalPagedId(value.sceneLocalPagedId)) return false;
    if (!isNonNegativeInteger(value.chunk) || !isNonNegativeInteger(value.page) || !isNonNegativeFinite(value.lru)) return false;
    if (forwardByPage.has(value.page)) return false;
    forwardByPage.set(value.page, `${value.sceneLocalPagedId}:${value.chunk}`);
  }
  const reverseByPage = new Map<number, string>();
  for (const value of reverseValues) {
    if (!isRecord(value) || typeof value.sceneLocalPagedId !== "string" || !isCanonicalPagedId(value.sceneLocalPagedId)) return false;
    if (!isNonNegativeInteger(value.chunk) || !isNonNegativeInteger(value.page) || !isNonNegativeFinite(value.time)) return false;
    if (reverseByPage.has(value.page)) return false;
    reverseByPage.set(value.page, `${value.sceneLocalPagedId}:${value.chunk}`);
  }
  if (forwardByPage.size !== reverseByPage.size) return false;
  for (const [page, owner] of forwardByPage) if (reverseByPage.get(page) !== owner) return false;
  return true;
}

function validateQueueLengths(value: Record<PropertyKey, unknown>): boolean {
  return ["pageFreelist", "freeablePages", "newUploads", "readyUploads", "lodTreeUpdates", "fetchers", "fetched", "fetchPriority"]
    .every((name) => isNonNegativeInteger(value[name]));
}

function validateSelection(value: unknown, pageSplats: number): value is SparkPagerFixtureSelection {
  if (!isRecord(value) || !isNonNegativeInteger(value.numSplats) || typeof value.indexFingerprint !== "string" || !Array.isArray(value.physicalPages)) return false;
  if (pageSplats !== 65_536) return false;
  const maxSelectedPages = value.numSplats === 0 ? 0 : value.numSplats;
  return value.physicalPages.every(isNonNegativeInteger)
    && new Set(value.physicalPages).size === value.physicalPages.length
    && value.physicalPages.length <= maxSelectedPages;
}

function validateRows(values: readonly unknown[]): boolean {
  let previousSequence = 0;
  let previousAtMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!isRecord(value) || !isPositiveInteger(value.sequence) || value.sequence <= previousSequence) return false;
    if (!isNonNegativeFinite(value.atMs) || value.atMs < previousAtMs) return false;
    previousSequence = value.sequence;
    previousAtMs = value.atMs;
    if (typeof value.type !== "string" || !ROW_TYPES.has(value.type)) return false;
    if (!isProbeStatus(value.probeStatus) || !isStringArray(value.reasons) || !isStringArray(value.declaredGaps) || !containsRequiredGaps(value.declaredGaps)) return false;
    if (value.requestId !== undefined && (typeof value.requestId !== "string" || !/^[A-Za-z0-9._-]+:chunk:\d+:attempt:\d+$/.test(value.requestId))) return false;
    if (value.canonicalPageId !== undefined && (typeof value.canonicalPageId !== "string" || !/^[A-Za-z0-9._-]+:page:\d+:generation:\d+$/.test(value.canonicalPageId))) return false;
    if (value.sceneLocalPagedId !== undefined && (typeof value.sceneLocalPagedId !== "string" || !isCanonicalPagedId(value.sceneLocalPagedId))) return false;
    if (value.chunk !== undefined && !isNonNegativeInteger(value.chunk)) return false;
    if (value.physicalPage !== undefined && !isNonNegativeInteger(value.physicalPage)) return false;
    if (value.outcome !== undefined && value.outcome !== "fulfilled" && value.outcome !== "rejected" && value.outcome !== "threw") return false;
  }
  return true;
}

function validateByteRange(value: unknown): value is AdapterByteRange {
  if (!isRecord(value)) return false;
  return isNonNegativeInteger(value.start)
    && isPositiveInteger(value.endExclusive)
    && value.endExclusive > value.start
    && value.header === `bytes=${value.start}-${value.endExclusive - 1}`;
}

function containsRequiredGaps(values: readonly string[]): boolean {
  return ADAPTER_DECLARED_GAPS.every((gap) => values.includes(gap));
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

function isProbeStatus(value: unknown): value is ProbeStatus {
  return value === "valid" || value === "degraded" || value === "invalid";
}

function isCanonicalPagedId(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value);
}

function isUniqueStringArray(value: unknown): value is readonly string[] {
  return isStringArray(value) && new Set(value).size === value.length;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}
