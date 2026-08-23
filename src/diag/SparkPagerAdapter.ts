import type { ProbeStatus } from "./events";

export const SPARK_PAGER_ADAPTER_VERSION = "spark-pager-2.1.0.1" as const;
export const SUPPORTED_SPARK_VERSION = "2.1.0" as const;

export const ADAPTER_DECLARED_GAPS = Object.freeze([
  "bytes_received_absent",
  "network_start_and_response_metadata_absent",
  "decode_timing_combined_with_fetch",
  "gpu_completion_absent_cpu_staging_only",
  "render_eligible_exact_frame_absent_page_level_only",
  "parent_retired_absent",
] as const);

export type AdapterCapabilityName =
  | "request"
  | "bytesReceived"
  | "decode"
  | "gpuUpload"
  | "renderEligible"
  | "parentRetired";

export interface AdapterStageCapabilities {
  readonly request: "confirmed";
  readonly bytesReceived: "absent";
  readonly decode: "confirmed_combined";
  readonly gpuUpload: "confirmed_cpu_staging";
  readonly renderEligible: "degraded_page_level";
  readonly parentRetired: "absent";
}

export const SPARK_PAGER_CAPABILITIES: Readonly<AdapterStageCapabilities> = Object.freeze({
  request: "confirmed",
  bytesReceived: "absent",
  decode: "confirmed_combined",
  gpuUpload: "confirmed_cpu_staging",
  renderEligible: "degraded_page_level",
  parentRetired: "absent",
});

export type AdapterInvalidReason =
  | "version_missing"
  | "version_mismatch"
  | "fingerprint_mismatch"
  | "fingerprint_changed"
  | "thrown_getter"
  | "hook_replaced"
  | "invalid_page_range"
  | "forward_reverse_disagreement"
  | "resident_over_requested"
  | "resident_splats_over_requested"
  | "counter_decreased"
  | "invalid_level"
  | "invalid_topology"
  | "invalid_bounds"
  | "reordered_lifecycle"
  | "invalid_request_id"
  | "invalid_result"
  | "upload_owner_missing"
  | "read_failed";

export interface AdapterCapabilityReport {
  readonly adapterVersion: typeof SPARK_PAGER_ADAPTER_VERSION;
  readonly sparkVersion: string;
  readonly probeStatus: ProbeStatus;
  readonly reasons: readonly string[];
  readonly stages: Readonly<AdapterStageCapabilities>;
  readonly declaredGaps: readonly string[];
  readonly fingerprint?: Readonly<AdapterShapeFingerprint>;
  readonly ledgerSinceMs?: number;
  readonly baseline?: Readonly<AdapterAttachBaseline>;
}

export interface AdapterShapeFingerprint {
  readonly pagedMembers: readonly string[];
  readonly pagerMembers: readonly string[];
  readonly pageSplats: number;
  readonly maxPages: number;
  readonly maxSplats: number;
}

export interface AdapterByteRange {
  readonly start: number;
  readonly endExclusive: number;
  readonly header: string;
}

export type AdapterRequestOutcome = "fulfilled" | "rejected" | "threw";

export interface AdapterRequestState {
  readonly requestId: string;
  readonly sceneLocalPagedId: string;
  readonly chunk: number;
  readonly attempt: number;
  readonly combinedStartMs: number;
  readonly combinedEndMs?: number;
  readonly outcome?: AdapterRequestOutcome;
  readonly expectedUrl?: string;
  readonly byteRange?: Readonly<AdapterByteRange>;
  readonly numSplats?: number;
  readonly error?: string;
}

export interface AdapterPageState {
  readonly pageId: string;
  readonly sceneLocalPagedId: string;
  readonly physicalPage: number;
  readonly generation: number;
  readonly chunk: number;
  readonly lru: number;
  readonly numSplats?: number;
  readonly level?: number;
  readonly parentPageId?: string;
  readonly childPageIds?: readonly string[];
}

export interface AdapterBaselineResident {
  readonly provenance: "pre_attach";
  readonly sceneLocalPagedId: string;
  readonly chunk: number;
  readonly physicalPage: number;
}

export interface AdapterBaselineFetcher {
  readonly provenance: "pre_attach";
  readonly sceneLocalPagedId: string;
  readonly chunk: number;
}

export interface AdapterBaselineQueued {
  readonly provenance: "pre_attach";
  readonly sceneLocalPagedId: string;
  readonly chunk: number;
}

export interface AdapterAttachBaseline {
  readonly capturedAtMs: number;
  readonly provenance: "pre_attach";
  readonly residentPages: readonly Readonly<AdapterBaselineResident>[];
  readonly fetchers: readonly Readonly<AdapterBaselineFetcher>[];
  readonly queued: readonly Readonly<AdapterBaselineQueued>[];
}

export interface AdapterQueueLengths {
  readonly pageFreelist: number;
  readonly freeablePages: number;
  readonly newUploads: number;
  readonly readyUploads: number;
  readonly lodTreeUpdates: number;
  readonly fetchers: number;
  readonly fetched: number;
  readonly fetchPriority: number;
}

export interface AdapterSelectionState {
  readonly numSplats: number;
  readonly indexFingerprint: string;
  readonly physicalPages: readonly number[];
}

export interface AdapterSnapshot {
  readonly sequence: number;
  readonly atMs: number;
  readonly ledgerSinceMs: number;
  readonly probeStatus: Exclude<ProbeStatus, "invalid">;
  readonly reasons: readonly string[];
  readonly declaredGaps: readonly string[];
  readonly requestedChunkAttempts: number;
  readonly decodedChunkCount: number;
  readonly decodedSplatCount: number;
  readonly uploadedPageCount: number;
  readonly residentPages: readonly Readonly<AdapterPageState>[];
  readonly queueLengths: Readonly<AdapterQueueLengths>;
  readonly selection?: Readonly<AdapterSelectionState>;
}

interface AdapterEventBase {
  readonly atMs: number;
  readonly probeStatus: ProbeStatus;
  readonly reasons: readonly string[];
  readonly declaredGaps: readonly string[];
}

export type SparkPagerAdapterEvent =
  | (AdapterEventBase & { readonly type: "adapter_attached"; readonly capabilities: Readonly<AdapterStageCapabilities>; readonly fingerprint: Readonly<AdapterShapeFingerprint>; readonly ledgerSinceMs: number; readonly baseline: Readonly<AdapterAttachBaseline> })
  | (AdapterEventBase & { readonly type: "adapter_invalidated"; readonly code: AdapterInvalidReason; readonly terminal: true })
  | (AdapterEventBase & { readonly type: "request_started"; readonly request: Readonly<AdapterRequestState> })
  | (AdapterEventBase & { readonly type: "request_range_joined"; readonly requestId: string; readonly expectedUrl?: string; readonly byteRange?: Readonly<AdapterByteRange> })
  | (AdapterEventBase & { readonly type: "decode_combined_completed"; readonly request: Readonly<AdapterRequestState> })
  | (AdapterEventBase & { readonly type: "request_failed"; readonly request: Readonly<AdapterRequestState> })
  | (AdapterEventBase & { readonly type: "gpu_upload_started" | "gpu_upload_completed"; readonly pageId: string; readonly requestId?: string; readonly physicalPage: number; readonly sceneLocalPagedId: string; readonly chunk: number })
  | (AdapterEventBase & { readonly type: "gpu_upload_failed"; readonly pageId: string; readonly requestId?: string; readonly physicalPage: number; readonly sceneLocalPagedId: string; readonly chunk: number; readonly error: string })
  | (AdapterEventBase & { readonly type: "selection_changed"; readonly selection: Readonly<AdapterSelectionState> })
  | (AdapterEventBase & { readonly type: "pager_snapshot"; readonly snapshot: Readonly<AdapterSnapshot> });

type AdapterEventPayload = SparkPagerAdapterEvent extends infer TEvent
  ? TEvent extends AdapterEventBase
    ? Omit<TEvent, keyof AdapterEventBase>
    : never
  : never;

export interface AttachOptions {
  readonly pagedMesh: unknown;
  readonly renderer: unknown;
  /** Installed package version. It is pinned to 2.1.0. */
  readonly sparkVersion?: string;
  /** Alias retained for callers that name the installed version explicitly. */
  readonly installedVersion?: string;
  /** If supplied, this must also be the pinned 2.1.0 contract. */
  readonly expectedVersion?: string;
  readonly sceneLocalPagedId?: string;
  readonly eventReceiver?: (event: Readonly<SparkPagerAdapterEvent>) => void;
  readonly now?: () => number;
}

export interface SparkPagerAdapterHandle {
  readonly capabilities: Readonly<AdapterCapabilityReport>;
  readSnapshot(atMs: number): Readonly<AdapterSnapshot> | undefined;
  detach(): void;
}

type UnknownRecord = Record<PropertyKey, unknown>;
type UnknownFunction = (this: unknown, ...args: unknown[]) => unknown;

interface PagedShape extends UnknownRecord {
  pager: PagerShape;
  rootUrl: string;
  numSplats: number;
  dynoNumSplats: object;
  dynoIndices: object;
  radMetaPromise?: PromiseLike<unknown>;
  fetchDecodeChunk: UnknownFunction;
  update: UnknownFunction;
}

interface PagerShape extends UnknownRecord {
  renderer: object;
  extSplats: boolean;
  pageSplats: number;
  maxPages: number;
  maxSplats: number;
  autoDrive: boolean;
  numFetchers: number;
  splatsChunkToPage: Map<unknown, unknown>;
  pageToSplatsChunk: unknown[];
  pageFreelist: unknown[];
  pageLru: Set<unknown>;
  freeablePages: unknown[];
  newUploads: unknown[];
  readyUploads: unknown[];
  lodTreeUpdates: unknown[];
  fetchers: unknown[];
  fetched: unknown[];
  fetchPriority: unknown[];
  uploadPage: UnknownFunction;
  processUploads: UnknownFunction;
}

interface ShapeInspection {
  readonly paged: PagedShape;
  readonly pager: PagerShape;
  readonly renderer: UnknownRecord;
  readonly fingerprint: AdapterShapeFingerprint;
  readonly degradationReasons: readonly string[];
}

interface MutableRequestState {
  requestId: string;
  sceneLocalPagedId: string;
  chunk: number;
  attempt: number;
  combinedStartMs: number;
  combinedEndMs?: number;
  outcome?: AdapterRequestOutcome;
  expectedUrl?: string;
  byteRange?: AdapterByteRange;
  numSplats?: number;
  error?: string;
}

interface UploadProvenance {
  readonly splats: object;
  readonly sceneLocalPagedId: string;
  readonly chunk: number;
  readonly requestId: string;
  readonly numSplats: number;
}

interface PageGeneration {
  owner: object;
  chunk: number;
  generation: number;
  pageId: string;
}

const PAGED_MEMBER_NAMES = Object.freeze([
  "pager:object",
  "rootUrl:string",
  "numSplats:number",
  "dynoNumSplats:object",
  "dynoIndices:object",
  "getRadMeta:function",
  "fetchDecodeChunk:function",
  "update:function",
  "getNumSplats:function",
] as const);

const PAGER_MEMBER_NAMES = Object.freeze([
  "renderer:object", "extSplats:boolean", "pageSplats:integer", "maxPages:integer",
  "maxSplats:integer", "autoDrive:boolean", "numFetchers:integer",
  "splatsChunkToPage:Map", "pageToSplatsChunk:Array", "pageFreelist:Array",
  "freeablePages:Array", "newUploads:Array", "readyUploads:Array", "lodTreeUpdates:Array",
  "fetchers:Array", "fetched:Array", "fetchPriority:Array", "pageLru:Set",
  "getSplatsChunk:function", "driveFetchers:function", "uploadPage:function",
  "processUploads:function", "consumeLodTreeUpdates:function",
] as const);

/**
 * Spark 2.1.0 confirmed map adapter. This is the sole diagnostics module that
 * reads pager internals. Hooks are own properties, delegate with Reflect.apply
 * exactly once, and are restored by deleting those properties.
 */
export function attachSparkPagerAdapter(options: Readonly<AttachOptions>): SparkPagerAdapterHandle {
  const now = options.now ?? monotonicNow;
  const receive = options.eventReceiver ?? (() => undefined);
  const installedVersion = options.installedVersion ?? options.sparkVersion ?? options.expectedVersion;
  const expectedVersion = options.expectedVersion ?? SUPPORTED_SPARK_VERSION;
  const initialAtMs = safeNow(now);

  if (installedVersion === undefined) {
    return invalidHandle("version_missing", "installed Spark version was not supplied", "", initialAtMs, receive);
  }
  if (installedVersion !== SUPPORTED_SPARK_VERSION || expectedVersion !== SUPPORTED_SPARK_VERSION) {
    return invalidHandle("version_mismatch", `expected ${SUPPORTED_SPARK_VERSION}, received installed=${installedVersion}, expected=${expectedVersion}`, installedVersion, initialAtMs, receive);
  }

  let inspection: ShapeInspection;
  try {
    inspection = inspectShape(options.pagedMesh, options.renderer);
  } catch (error) {
    const classified = classifyReadError(error, "fingerprint_mismatch");
    return invalidHandle(classified, errorMessage(error), installedVersion, initialAtMs, receive);
  }

  const { paged, pager, fingerprint } = inspection;
  const primaryPagedId = canonicalPagedId(options.sceneLocalPagedId ?? "paged-0");
  const pagedIds = new WeakMap<object, string>();
  pagedIds.set(paged, primaryPagedId);
  let nextPagedOrdinal = 1;
  const getPagedId = (value: object): string => {
    const existing = pagedIds.get(value);
    if (existing) return existing;
    const id = canonicalPagedId(`paged-${nextPagedOrdinal++}`);
    pagedIds.set(value, id);
    return id;
  };

  let status: ProbeStatus = "degraded";
  let reasons = Object.freeze([
    "declared_capability_gaps",
    ...inspection.degradationReasons,
  ]);
  let report = makeReport(installedVersion, status, reasons, fingerprint);
  let detached = false;
  let readable = true;
  let invalidationEmitted = false;
  let snapshotSequence = 0;
  let previousReadMs: number | undefined;
  let decodedChunkCount = 0;
  let decodedSplatCount = 0;
  let uploadedPageCount = 0;
  let lastDecodedChunkCount: number | undefined;
  let lastDecodedSplatCount: number | undefined;
  let lastUploadedPageCount: number | undefined;
  const attempts = new Map<string, number>();
  const requests = new Map<string, MutableRequestState>();
  const requestedOwners = new Set<string>();
  const baselineResidentEntries = new Set<string>();
  const baselineFetcherOwners = new Set<string>();
  const baselineQueuedOwners = new Set<string>();
  const baselineRequestedOwners = new Set<string>();
  const decodedUploadProvenance = new WeakMap<object, UploadProvenance>();
  const queuedUploadProvenance = new WeakMap<object, UploadProvenance>();
  const pageSplats = new Map<string, number>();
  const pageGenerations = new Map<number, PageGeneration>();
  const lastMappingTimes = new Map<string, number>();
  let lastSelection: Uint32Array | undefined;
  let lastSelectionState: AdapterSelectionState | undefined;
  const hookRestorers: Array<() => void> = [];
  const hookValues = new Map<string, UnknownFunction>();
  let attachBaseline: Readonly<AdapterAttachBaseline> | undefined;

  const emit = (event: AdapterEventPayload, atMs: number): void => {
    const envelope = {
      ...event,
      atMs,
      probeStatus: status,
      reasons,
      declaredGaps: ADAPTER_DECLARED_GAPS,
    } as unknown as SparkPagerAdapterEvent;
    try {
      receive(Object.freeze(envelope));
    } catch {
      // Observers are isolated; Spark scheduling and record lifecycle continue.
    }
  };

  const detachReadersAndHooks = (): void => {
    if (detached) return;
    detached = true;
    readable = false;
    for (let index = hookRestorers.length - 1; index >= 0; index -= 1) {
      try {
        hookRestorers[index]();
      } catch {
        // A failed observer restoration must not invoke or dispose Spark.
      }
    }
  };

  const invalidate = (code: AdapterInvalidReason, atMs: number, detail?: string): void => {
    if (status === "invalid") return;
    status = "invalid";
    reasons = Object.freeze([code, ...(detail ? [detail] : [])]);
    report = makeReport(installedVersion, status, reasons, fingerprint, attachBaseline ? initialAtMs : undefined, attachBaseline);
    detachReadersAndHooks();
    if (!invalidationEmitted) {
      invalidationEmitted = true;
      emit({ type: "adapter_invalidated", code, terminal: true }, atMs);
    }
  };

  try {
    const initial = validateAndReadPages(pager, getPagedId, pageGenerations, lastMappingTimes, pageSplats, initialAtMs);
    const baseline = readAttachBaseline(
      initial.pages,
      pager,
      getPagedId,
      initialAtMs,
      decodedUploadProvenance,
      queuedUploadProvenance,
    );
    for (const page of baseline.residentPages) {
      baselineResidentEntries.add(residentEntryKey(page.sceneLocalPagedId, page.chunk, page.physicalPage));
      baselineRequestedOwners.add(ownerChunkKey(page.sceneLocalPagedId, page.chunk));
    }
    for (const fetcher of baseline.fetchers) {
      const owner = ownerChunkKey(fetcher.sceneLocalPagedId, fetcher.chunk);
      baselineFetcherOwners.add(owner);
      baselineRequestedOwners.add(owner);
    }
    for (const queued of baseline.queued) {
      const owner = ownerChunkKey(queued.sceneLocalPagedId, queued.chunk);
      baselineQueuedOwners.add(owner);
      baselineRequestedOwners.add(owner);
    }
    installFetchHook(paged);
    installUploadHook(pager);
    installProcessUploadsHook(pager);
    installUpdateHook(paged);
    attachBaseline = baseline;
    previousReadMs = initialAtMs;
    lastDecodedChunkCount = decodedChunkCount;
    lastDecodedSplatCount = decodedSplatCount;
    lastUploadedPageCount = uploadedPageCount;
    report = makeReport(installedVersion, status, reasons, fingerprint, initialAtMs, baseline);
  } catch (error) {
    const code = classifyReadError(error, "fingerprint_mismatch");
    invalidate(code, initialAtMs, errorMessage(error));
  }

  if ((status as ProbeStatus) !== "invalid" && attachBaseline) {
    emit({ type: "adapter_attached", capabilities: SPARK_PAGER_CAPABILITIES, fingerprint, ledgerSinceMs: initialAtMs, baseline: attachBaseline }, initialAtMs);
  }

  const handle: SparkPagerAdapterHandle = {
    get capabilities(): Readonly<AdapterCapabilityReport> {
      return report;
    },
    readSnapshot(atMs: number): Readonly<AdapterSnapshot> | undefined {
      if (!readable || status === "invalid") return undefined;
      try {
        if (!Number.isFinite(atMs) || (previousReadMs !== undefined && atMs < previousReadMs)) {
          throw adapterError("counter_decreased", "snapshot time decreased");
        }
        validateFingerprintStillMatches(paged, pager, inspection.renderer, fingerprint, hookValues);
        const pageRead = validateAndReadPages(pager, getPagedId, pageGenerations, lastMappingTimes, pageSplats, atMs);
        const unexpectedResident = pageRead.pages.find((page) => {
          const owner = ownerChunkKey(page.sceneLocalPagedId, page.chunk);
          const baselineEntry = residentEntryKey(page.sceneLocalPagedId, page.chunk, page.physicalPage);
          return !baselineResidentEntries.has(baselineEntry)
            && !baselineFetcherOwners.has(owner)
            && !baselineQueuedOwners.has(owner)
            && !requestedOwners.has(owner);
        });
        if (unexpectedResident) {
          throw adapterError("resident_over_requested", `${unexpectedResident.pageId} has neither pre-attach resident/fetcher/queued provenance nor an observed request`);
        }
        const knownResidentSplats = pageRead.pages.reduce((sum, page) => sum + (page.numSplats ?? 0), 0);
        const requestedSplatEquivalent = baselineRequestedOwners.size * pager.pageSplats + decodedSplatCount;
        if (knownResidentSplats > requestedSplatEquivalent) {
          throw adapterError("resident_splats_over_requested", `${knownResidentSplats} resident splats exceed ${requestedSplatEquivalent}`);
        }
        if (lastDecodedChunkCount === undefined || lastDecodedSplatCount === undefined || lastUploadedPageCount === undefined) {
          throw adapterError("counter_decreased", "attach-time counter baseline is missing");
        }
        if (decodedChunkCount < lastDecodedChunkCount || decodedSplatCount < lastDecodedSplatCount || uploadedPageCount < lastUploadedPageCount) {
          throw adapterError("counter_decreased", "adapter cumulative counter decreased");
        }
        lastDecodedChunkCount = decodedChunkCount;
        lastDecodedSplatCount = decodedSplatCount;
        lastUploadedPageCount = uploadedPageCount;
        previousReadMs = atMs;
        const snapshot: AdapterSnapshot = Object.freeze({
          sequence: ++snapshotSequence,
          atMs,
          ledgerSinceMs: initialAtMs,
          probeStatus: status as Exclude<ProbeStatus, "invalid">,
          reasons,
          declaredGaps: ADAPTER_DECLARED_GAPS,
          requestedChunkAttempts: requests.size,
          decodedChunkCount,
          decodedSplatCount,
          uploadedPageCount,
          residentPages: Object.freeze(pageRead.pages),
          queueLengths: Object.freeze(readQueueLengths(pager)),
          ...(lastSelectionState ? { selection: lastSelectionState } : {}),
        });
        emit({ type: "pager_snapshot", snapshot }, atMs);
        return snapshot;
      } catch (error) {
        invalidate(classifyReadError(error, "read_failed"), atMs, errorMessage(error));
        return undefined;
      }
    },
    detach(): void {
      detachReadersAndHooks();
    },
  };
  return Object.freeze(handle);

  function installFetchHook(target: PagedShape): void {
    const original = target.fetchDecodeChunk;
    const wrapper: UnknownFunction = function (this: unknown, ...args: unknown[]): unknown {
      const atMs = safeNow(now);
      const chunk = args[0];
      if (!isNonNegativeInteger(chunk)) {
        return Reflect.apply(original, this, args);
      }
      const ownerObject = isObject(this) ? this : target;
      const sceneLocalPagedId = getPagedId(ownerObject);
      const attemptKey = ownerChunkKey(sceneLocalPagedId, chunk);
      const attempt = (attempts.get(attemptKey) ?? 0) + 1;
      attempts.set(attemptKey, attempt);
      requestedOwners.add(attemptKey);
      const requestId = canonicalRequestId(sceneLocalPagedId, chunk, attempt);
      const request: MutableRequestState = { requestId, sceneLocalPagedId, chunk, attempt, combinedStartMs: atMs };
      requests.set(requestId, request);
      emit({ type: "request_started", request: freezeRequest(request) }, atMs);

      let returned: unknown;
      try {
        returned = Reflect.apply(original, this, args);
      } catch (error) {
        request.combinedEndMs = safeNow(now);
        request.outcome = "threw";
        request.error = errorMessage(error);
        emit({ type: "request_failed", request: freezeRequest(request) }, request.combinedEndMs);
        throw error;
      }

      observeRangeMetadata(ownerObject, request, atMs);
      if (!isPromiseLike(returned)) {
        invalidate("invalid_result", safeNow(now), "fetchDecodeChunk did not return a promise-like object");
        return returned;
      }
      returned.then(
        (result) => {
          try {
            const completedAtMs = safeNow(now);
            const decoded = readDecodedResult(result, pager.pageSplats);
            request.combinedEndMs = completedAtMs;
            request.outcome = "fulfilled";
            request.numSplats = decoded.numSplats;
            decodedChunkCount += 1;
            decodedSplatCount += decoded.numSplats;
            const provenance: UploadProvenance = Object.freeze({
              splats: ownerObject,
              sceneLocalPagedId,
              chunk,
              requestId,
              numSplats: decoded.numSplats,
            });
            for (const identity of decoded.uploadIdentities) decodedUploadProvenance.set(identity, provenance);
            emit({ type: "decode_combined_completed", request: freezeRequest(request) }, completedAtMs);
          } catch (error) {
            invalidate(classifyReadError(error, "invalid_result"), safeNow(now), errorMessage(error));
          }
        },
        (error) => {
          request.combinedEndMs = safeNow(now);
          request.outcome = "rejected";
          request.error = errorMessage(error);
          emit({ type: "request_failed", request: freezeRequest(request) }, request.combinedEndMs);
        },
      );
      return returned;
    };
    hookValues.set("paged.fetchDecodeChunk", wrapper);
    hookRestorers.push(installOwnHook(target, "fetchDecodeChunk", wrapper));
  }

  function observeRangeMetadata(owner: object, request: MutableRequestState, requestAtMs: number): void {
    let promise: unknown;
    try {
      promise = (owner as UnknownRecord).radMetaPromise;
    } catch (error) {
      invalidate("thrown_getter", requestAtMs, errorMessage(error));
      return;
    }
    if (!isPromiseLike(promise)) return;
    promise.then((value) => {
      try {
        const joined = expectedRangeFromMetadata(owner as UnknownRecord, request.chunk, value);
        if (!joined) return;
        request.expectedUrl = joined.expectedUrl;
        request.byteRange = joined.byteRange;
        emit({
          type: "request_range_joined",
          requestId: request.requestId,
          ...(joined.expectedUrl ? { expectedUrl: joined.expectedUrl } : {}),
          ...(joined.byteRange ? { byteRange: joined.byteRange } : {}),
        }, safeNow(now));
      } catch (error) {
        invalidate(classifyReadError(error, "invalid_result"), safeNow(now), errorMessage(error));
      }
    }, () => undefined);
  }

  function installUploadHook(target: PagerShape): void {
    const original = target.uploadPage;
    const wrapper: UnknownFunction = function (this: unknown, ...args: unknown[]): unknown {
      const atMs = safeNow(now);
      const page = args[0];
      const packedArray = args[1];
      if (!isNonNegativeInteger(page) || page >= target.maxPages || !isObject(packedArray)) {
        return Reflect.apply(original, this, args);
      }

      // Phase-0b correction: the processUploads boundary captures the upload QUEUE ITEM's
      // own {splats, chunk} before Spark shifts it. The reverse map is stale at
      // uploadPage entry on page reuse and is deliberately never consulted here.
      const provenance = queuedUploadProvenance.get(packedArray);
      if (!provenance) {
        invalidate("upload_owner_missing", atMs, "upload queue item lacked splats/chunk provenance");
        return Reflect.apply(original, this, args);
      }
      const generation = pageGeneration(page, provenance.splats, provenance.chunk, provenance.sceneLocalPagedId, pageGenerations);
      pageSplats.set(generation.pageId, provenance.numSplats);
      emit({
        type: "gpu_upload_started",
        pageId: generation.pageId,
        ...(provenance.requestId ? { requestId: provenance.requestId } : {}),
        physicalPage: page,
        sceneLocalPagedId: provenance.sceneLocalPagedId,
        chunk: provenance.chunk,
      }, atMs);
      try {
        const result = Reflect.apply(original, this, args);
        uploadedPageCount += 1;
        emit({
          type: "gpu_upload_completed",
          pageId: generation.pageId,
          ...(provenance.requestId ? { requestId: provenance.requestId } : {}),
          physicalPage: page,
          sceneLocalPagedId: provenance.sceneLocalPagedId,
          chunk: provenance.chunk,
        }, safeNow(now));
        return result;
      } catch (error) {
        emit({
          type: "gpu_upload_failed",
          pageId: generation.pageId,
          ...(provenance.requestId ? { requestId: provenance.requestId } : {}),
          physicalPage: page,
          sceneLocalPagedId: provenance.sceneLocalPagedId,
          chunk: provenance.chunk,
          error: errorMessage(error),
        }, safeNow(now));
        throw error;
      }
    };
    hookValues.set("pager.uploadPage", wrapper);
    hookRestorers.push(installOwnHook(target, "uploadPage", wrapper));
  }

  function installProcessUploadsHook(target: PagerShape): void {
    const original = target.processUploads;
    const wrapper: UnknownFunction = function (this: unknown, ...args: unknown[]): unknown {
      try {
        registerUploadQueueProvenance(
          [...target.newUploads, ...target.readyUploads],
          reverseMapOwnerResolver(target),
          getPagedId,
          decodedUploadProvenance,
          queuedUploadProvenance,
        );
      } catch (error) {
        invalidate(classifyReadError(error, "invalid_result"), safeNow(now), errorMessage(error));
      }
      return Reflect.apply(original, this, args);
    };
    hookValues.set("pager.processUploads", wrapper);
    hookRestorers.push(installOwnHook(target, "processUploads", wrapper));
  }

  function installUpdateHook(target: PagedShape): void {
    const original = target.update;
    const wrapper: UnknownFunction = function (this: unknown, ...args: unknown[]): unknown {
      const result = Reflect.apply(original, this, args);
      try {
        const numSplats = args[0];
        const indices = args[1];
        if (!isNonNegativeInteger(numSplats) || !(indices instanceof Uint32Array) || numSplats > indices.length) {
          throw adapterError("invalid_result", "update selection shape is invalid");
        }
        const active = indices.slice(0, numSplats);
        if (lastSelection && lastSelection.length === active.length && equalUint32(lastSelection, active)) return result;
        lastSelection = active;
        const physicalPages = Object.freeze([...new Set(Array.from(active, (index) => index >>> 16))].sort((a, b) => a - b));
        if (physicalPages.some((page) => page < 0 || page >= pager.maxPages)) {
          throw adapterError("invalid_page_range", "selection references a page outside the pager pool");
        }
        lastSelectionState = Object.freeze({
          numSplats,
          indexFingerprint: fingerprintIndices(active),
          physicalPages,
        });
        emit({ type: "selection_changed", selection: lastSelectionState }, safeNow(now));
      } catch (error) {
        invalidate(classifyReadError(error, "invalid_result"), safeNow(now), errorMessage(error));
      }
      return result;
    };
    hookValues.set("paged.update", wrapper);
    hookRestorers.push(installOwnHook(target, "update", wrapper));
  }
}

function inspectShape(pagedMeshValue: unknown, rendererValue: unknown): ShapeInspection {
  const pagedMesh = requireObject(pagedMeshValue, "paged mesh");
  const renderer = requireObject(rendererValue, "Spark renderer");
  const paged = requireObject(pagedMesh.paged, "pagedMesh.paged") as PagedShape;
  const pager = requireObject(paged.pager, "paged.pager") as PagerShape;

  requireString(paged.rootUrl, "paged.rootUrl");
  requireNonNegativeFinite(paged.numSplats, "paged.numSplats");
  requireObject(paged.dynoNumSplats, "paged.dynoNumSplats");
  requireObject(paged.dynoIndices, "paged.dynoIndices");
  for (const name of ["getRadMeta", "fetchDecodeChunk", "update", "getNumSplats"] as const) requireFunction(paged[name], `paged.${name}`);

  requireObject(pager.renderer, "pager.renderer");
  requireBoolean(pager.extSplats, "pager.extSplats");
  requirePositiveInteger(pager.pageSplats, "pager.pageSplats");
  requirePositiveInteger(pager.maxPages, "pager.maxPages");
  requirePositiveInteger(pager.maxSplats, "pager.maxSplats");
  requireBoolean(pager.autoDrive, "pager.autoDrive");
  requireNonNegativeInteger(pager.numFetchers, "pager.numFetchers");
  if (pager.maxSplats !== pager.pageSplats * pager.maxPages) throw adapterError("fingerprint_mismatch", "maxSplats does not equal pageSplats * maxPages");
  if (!(pager.splatsChunkToPage instanceof Map)) throw adapterError("fingerprint_mismatch", "pager.splatsChunkToPage is not a Map");
  if (!(pager.pageLru instanceof Set)) throw adapterError("fingerprint_mismatch", "pager.pageLru is not a Set");
  for (const name of ["pageToSplatsChunk", "pageFreelist", "freeablePages", "newUploads", "readyUploads", "lodTreeUpdates", "fetchers", "fetched", "fetchPriority"] as const) {
    if (!Array.isArray(pager[name])) throw adapterError("fingerprint_mismatch", `pager.${name} is not an Array`);
  }
  for (const name of ["getSplatsChunk", "driveFetchers", "uploadPage", "processUploads", "consumeLodTreeUpdates"] as const) requireFunction(pager[name], `pager.${name}`);

  const degradationReasons: string[] = [];
  const display = renderer.display;
  if (!isObject(display) || !isFiniteNumber(display.mappingVersion)) degradationReasons.push("render_mapping_version_unavailable");
  return {
    paged,
    pager,
    renderer,
    fingerprint: Object.freeze({
      pagedMembers: PAGED_MEMBER_NAMES,
      pagerMembers: PAGER_MEMBER_NAMES,
      pageSplats: pager.pageSplats,
      maxPages: pager.maxPages,
      maxSplats: pager.maxSplats,
    }),
    degradationReasons: Object.freeze(degradationReasons),
  };
}

function validateFingerprintStillMatches(
  paged: PagedShape,
  pager: PagerShape,
  renderer: UnknownRecord,
  fingerprint: AdapterShapeFingerprint,
  hookValues: ReadonlyMap<string, UnknownFunction>,
): void {
  try {
    requireString(paged.rootUrl, "paged.rootUrl");
    requireNonNegativeFinite(paged.numSplats, "paged.numSplats");
    requireObject(paged.pager, "paged.pager");
    requireObject(paged.dynoNumSplats, "paged.dynoNumSplats");
    requireObject(paged.dynoIndices, "paged.dynoIndices");
    if (paged.pager !== pager) throw adapterError("fingerprint_changed", "paged.pager identity changed");
    for (const name of ["getRadMeta", "fetchDecodeChunk", "update", "getNumSplats"] as const) requireFunction(paged[name], `paged.${name}`);
    requireObject(pager.renderer, "pager.renderer");
    requireBoolean(pager.extSplats, "pager.extSplats");
    requireBoolean(pager.autoDrive, "pager.autoDrive");
    requireNonNegativeInteger(pager.numFetchers, "pager.numFetchers");
    if (pager.pageSplats !== fingerprint.pageSplats || pager.maxPages !== fingerprint.maxPages || pager.maxSplats !== fingerprint.maxSplats) {
      throw adapterError("fingerprint_changed", "pager scalar fingerprint changed");
    }
    if (!(pager.splatsChunkToPage instanceof Map) || !(pager.pageLru instanceof Set)) throw adapterError("fingerprint_changed", "pager collection category changed");
    for (const name of ["pageToSplatsChunk", "pageFreelist", "freeablePages", "newUploads", "readyUploads", "lodTreeUpdates", "fetchers", "fetched", "fetchPriority"] as const) {
      if (!Array.isArray(pager[name])) throw adapterError("fingerprint_changed", `pager.${name} category changed`);
    }
    for (const name of ["getSplatsChunk", "driveFetchers", "uploadPage", "processUploads", "consumeLodTreeUpdates"] as const) requireFunction(pager[name], `pager.${name}`);
    requireObject(renderer, "renderer");
    if (paged.fetchDecodeChunk !== hookValues.get("paged.fetchDecodeChunk")
      || paged.update !== hookValues.get("paged.update")
      || pager.uploadPage !== hookValues.get("pager.uploadPage")
      || pager.processUploads !== hookValues.get("pager.processUploads")) {
      throw adapterError("hook_replaced", "an adapter own-property hook was replaced");
    }
  } catch (error) {
    if (isAdapterError(error)) throw error;
    throw adapterError("thrown_getter", errorMessage(error));
  }
}

function validateAndReadPages(
  pager: PagerShape,
  getPagedId: (value: object) => string,
  generations: Map<number, PageGeneration>,
  lastMappingTimes: Map<string, number>,
  pageSplats: ReadonlyMap<string, number>,
  atMs: number,
): { readonly pages: readonly AdapterPageState[] } {
  const pages: AdapterPageState[] = [];
  const seenPhysical = new Set<number>();

  for (const [splatsValue, chunksValue] of pager.splatsChunkToPage) {
    if (!isObject(splatsValue) || !Array.isArray(chunksValue)) throw adapterError("invalid_topology", "forward map must be Map<PagedSplats, Array<entry|null>>");
    const sceneLocalPagedId = getPagedId(splatsValue);
    for (let chunk = 0; chunk < chunksValue.length; chunk += 1) {
      const entryValue = chunksValue[chunk];
      if (entryValue === null || entryValue === undefined) continue;
      const entry = requireObject(entryValue, "forward entry");
      const page = entry.page;
      const lru = entry.lru;
      if (!isNonNegativeInteger(page) || page >= pager.maxPages) throw adapterError("invalid_page_range", `forward page ${String(page)} is outside [0, ${pager.maxPages})`);
      if (!isFiniteNumber(lru) || lru < 0) throw adapterError("invalid_topology", "forward lru is not a non-negative finite number");
      if (seenPhysical.has(page)) throw adapterError("forward_reverse_disagreement", `physical page ${page} has multiple forward owners`);
      seenPhysical.add(page);
      const reverse = requireObject(pager.pageToSplatsChunk[page], `reverse page ${page}`);
      if (reverse.splats !== splatsValue || reverse.chunk !== chunk) throw adapterError("forward_reverse_disagreement", `forward/reverse owner mismatch at page ${page}`);
      const time = reverse.time;
      if (!isFiniteNumber(time) || time < 0) throw adapterError("invalid_topology", `reverse page ${page} has invalid time`);
      const mappingKey = `${sceneLocalPagedId}:${chunk}:${page}`;
      const previousTime = lastMappingTimes.get(mappingKey);
      if (previousTime !== undefined && time < previousTime) throw adapterError("counter_decreased", `mapping time decreased at page ${page}`);
      lastMappingTimes.set(mappingKey, time);
      validateOptionalTopology(reverse, page, pager.maxPages);
      const generation = pageGeneration(page, splatsValue, chunk, sceneLocalPagedId, generations);
      const explicitNumSplats = reverse.numSplats;
      if (explicitNumSplats !== undefined && (!isNonNegativeInteger(explicitNumSplats) || explicitNumSplats > pager.pageSplats)) {
        throw adapterError("resident_splats_over_requested", `page ${page} has invalid numSplats`);
      }
      const knownNumSplats = explicitNumSplats as number | undefined ?? pageSplats.get(generation.pageId);
      pages.push(Object.freeze({
        pageId: generation.pageId,
        sceneLocalPagedId,
        physicalPage: page,
        generation: generation.generation,
        chunk,
        lru,
        ...(knownNumSplats === undefined ? {} : { numSplats: knownNumSplats }),
        ...(isNonNegativeInteger(reverse.level) ? { level: reverse.level } : {}),
        ...(isNonNegativeInteger(reverse.parentPage) ? { parentPageId: canonicalPhysicalPageId(sceneLocalPagedId, reverse.parentPage, generations.get(reverse.parentPage)?.generation ?? 0) } : {}),
        ...(Array.isArray(reverse.childPages) ? { childPageIds: Object.freeze(reverse.childPages.map((child) => canonicalPhysicalPageId(sceneLocalPagedId, child as number, generations.get(child as number)?.generation ?? 0))) } : {}),
      }));
    }
  }

  for (let page = 0; page < pager.pageToSplatsChunk.length; page += 1) {
    const reverseValue = pager.pageToSplatsChunk[page];
    if (reverseValue === null || reverseValue === undefined) continue;
    if (page >= pager.maxPages) throw adapterError("invalid_page_range", `reverse page ${page} is outside pager capacity`);
    const reverse = requireObject(reverseValue, `reverse page ${page}`);
    if (!isObject(reverse.splats) || !isNonNegativeInteger(reverse.chunk)) throw adapterError("invalid_topology", `reverse page ${page} owner is invalid`);
    const chunks = pager.splatsChunkToPage.get(reverse.splats);
    if (!Array.isArray(chunks)) throw adapterError("forward_reverse_disagreement", `reverse page ${page} has no forward owner array`);
    const forward = chunks[reverse.chunk];
    if (!isObject(forward) || forward.page !== page) throw adapterError("forward_reverse_disagreement", `reverse/forward mismatch at page ${page}`);
  }

  validatePageCollections(pager);
  pages.sort((a, b) => a.physicalPage - b.physicalPage);
  return { pages: Object.freeze(pages) };
}

function readAttachBaseline(
  pages: readonly AdapterPageState[],
  pager: PagerShape,
  getPagedId: (value: object) => string,
  capturedAtMs: number,
  decodedProvenance: WeakMap<object, UploadProvenance>,
  queuedProvenance: WeakMap<object, UploadProvenance>,
): Readonly<AdapterAttachBaseline> {
  const residentPages = pages.map((page) => Object.freeze({
    provenance: "pre_attach" as const,
    sceneLocalPagedId: page.sceneLocalPagedId,
    chunk: page.chunk,
    physicalPage: page.physicalPage,
  }));
  const baselineFetchers: Readonly<AdapterBaselineFetcher>[] = [];
  const seenFetchers = new Set<string>();
  for (const value of pager.fetchers) {
    const fetcher = requireObject(value, "fetcher entry");
    if (!isObject(fetcher.splats) || !isNonNegativeInteger(fetcher.chunk) || !isPromiseLike(fetcher.promise)) {
      throw adapterError("invalid_topology", "fetcher entry must contain splats, chunk, and promise");
    }
    const sceneLocalPagedId = getPagedId(fetcher.splats);
    const owner = ownerChunkKey(sceneLocalPagedId, fetcher.chunk);
    if (seenFetchers.has(owner)) throw adapterError("invalid_topology", `duplicate pre-attach fetcher ${owner}`);
    seenFetchers.add(owner);
    baselineFetchers.push(Object.freeze({
      provenance: "pre_attach",
      sceneLocalPagedId,
      chunk: fetcher.chunk,
    }));
  }
  const baselineQueued: Readonly<AdapterBaselineQueued>[] = [];
  const seenQueued = new Set<string>();
  for (const [queueName, values] of [
    ["fetched", pager.fetched],
    ["newUploads", pager.newUploads],
    ["readyUploads", pager.readyUploads],
  ] as const) {
    for (const value of values) {
      const queued = requireObject(value, `${queueName} entry`);
      // Spark 2.1.0 shapes differ per queue: `fetched` entries carry {splats, chunk}
      // directly, but `newUploads`/`readyUploads` entries are {page, numSplats,
      // packedArray, extra} — their owner lives in the reverse map, which is fresh
      // here (same frame as processFetched's insert).
      let splats = isObject(queued.splats) ? queued.splats : undefined;
      let chunk = isNonNegativeInteger(queued.chunk) ? queued.chunk : undefined;
      if ((splats === undefined || chunk === undefined) && queueName !== "fetched" && isNonNegativeInteger(queued.page)) {
        const reverse = pager.pageToSplatsChunk[queued.page];
        if (isObject(reverse) && isObject(reverse.splats) && isNonNegativeInteger(reverse.chunk)) {
          splats = reverse.splats;
          chunk = reverse.chunk;
        }
      }
      if (splats === undefined || chunk === undefined) {
        throw adapterError("invalid_topology", `${queueName} entry owner is unresolvable`);
      }
      const sceneLocalPagedId = getPagedId(splats);
      const owner = ownerChunkKey(sceneLocalPagedId, chunk);
      if (seenQueued.has(owner)) continue;
      seenQueued.add(owner);
      baselineQueued.push(Object.freeze({
        provenance: "pre_attach",
        sceneLocalPagedId,
        chunk,
      }));
    }
  }
  registerUploadQueueProvenance(
    [...pager.newUploads, ...pager.readyUploads],
    reverseMapOwnerResolver(pager),
    getPagedId,
    decodedProvenance,
    queuedProvenance,
  );
  return Object.freeze({
    capturedAtMs,
    provenance: "pre_attach",
    residentPages: Object.freeze(residentPages),
    fetchers: Object.freeze(baselineFetchers),
    queued: Object.freeze(baselineQueued),
  });
}

function validatePageCollections(pager: PagerShape): void {
  for (const [name, values] of [["pageFreelist", pager.pageFreelist], ["freeablePages", pager.freeablePages]] as const) {
    const seen = new Set<number>();
    for (const value of values) {
      if (!isNonNegativeInteger(value) || value >= pager.maxPages) throw adapterError("invalid_page_range", `${name} contains an invalid page`);
      if (seen.has(value)) throw adapterError("invalid_topology", `${name} contains a duplicate page`);
      seen.add(value);
    }
  }
  for (const value of pager.pageLru) {
    const entry = requireObject(value, "pageLru entry");
    if (!isNonNegativeInteger(entry.page) || entry.page >= pager.maxPages || !isFiniteNumber(entry.lru) || entry.lru < 0) {
      throw adapterError("invalid_topology", "pageLru contains an invalid record");
    }
  }
  for (const queueName of ["newUploads", "readyUploads", "lodTreeUpdates"] as const) {
    for (const value of pager[queueName]) {
      const entry = requireObject(value, `${queueName} entry`);
      if (!isNonNegativeInteger(entry.page) || entry.page >= pager.maxPages) throw adapterError("invalid_page_range", `${queueName} contains an invalid page`);
      if (entry.numSplats !== undefined && (!isNonNegativeInteger(entry.numSplats) || entry.numSplats > pager.pageSplats)) {
        throw adapterError("resident_splats_over_requested", `${queueName} contains invalid numSplats`);
      }
      validateOptionalTopology(entry, entry.page, pager.maxPages);
    }
  }
}

function validateOptionalTopology(value: UnknownRecord, page: number, maxPages: number): void {
  if (value.level !== undefined && (!isNonNegativeInteger(value.level) || value.level > 63)) throw adapterError("invalid_level", `page ${page} has an invalid level`);
  if (value.parentPage !== undefined) {
    if (!isNonNegativeInteger(value.parentPage) || value.parentPage >= maxPages || value.parentPage === page) throw adapterError("invalid_topology", `page ${page} has an invalid parent`);
  }
  if (value.childPages !== undefined) {
    if (!Array.isArray(value.childPages)) throw adapterError("invalid_topology", `page ${page} childPages is not an array`);
    const children = value.childPages;
    if (new Set(children).size !== children.length || children.some((child) => !isNonNegativeInteger(child) || child >= maxPages || child === page)) {
      throw adapterError("invalid_topology", `page ${page} has invalid children`);
    }
  }
  if (value.bounds !== undefined) validateBounds(value.bounds, page);
  const times = [value.requestStartMs, value.decodeEndMs, value.uploadStartMs, value.uploadEndMs].filter((time) => time !== undefined);
  if (times.some((time) => !isFiniteNumber(time) || time < 0)) throw adapterError("reordered_lifecycle", `page ${page} has invalid lifecycle timestamps`);
  for (let index = 1; index < times.length; index += 1) {
    if ((times[index] as number) < (times[index - 1] as number)) throw adapterError("reordered_lifecycle", `page ${page} lifecycle timestamps are reordered`);
  }
}

function validateBounds(value: unknown, page: number): void {
  if (!Array.isArray(value) || value.length !== 2 || !Array.isArray(value[0]) || !Array.isArray(value[1]) || value[0].length !== 3 || value[1].length !== 3) {
    throw adapterError("invalid_bounds", `page ${page} bounds shape is invalid`);
  }
  for (let axis = 0; axis < 3; axis += 1) {
    const minimum = value[0][axis];
    const maximum = value[1][axis];
    if (!isFiniteNumber(minimum) || !isFiniteNumber(maximum) || minimum > maximum) throw adapterError("invalid_bounds", `page ${page} bounds are invalid`);
  }
}

function readQueueLengths(pager: PagerShape): AdapterQueueLengths {
  return {
    pageFreelist: pager.pageFreelist.length,
    freeablePages: pager.freeablePages.length,
    newUploads: pager.newUploads.length,
    readyUploads: pager.readyUploads.length,
    lodTreeUpdates: pager.lodTreeUpdates.length,
    fetchers: pager.fetchers.length,
    fetched: pager.fetched.length,
    fetchPriority: pager.fetchPriority.length,
  };
}

function expectedRangeFromMetadata(owner: UnknownRecord, chunk: number, value: unknown): { expectedUrl?: string; byteRange?: AdapterByteRange } | undefined {
  const metadata = requireObject(value, "radMetaPromise result");
  const meta = requireObject(metadata.meta, "RAD metadata");
  if (!Array.isArray(meta.chunks) || !isNonNegativeInteger(chunk) || chunk >= meta.chunks.length) throw adapterError("invalid_result", "RAD chunk metadata is missing");
  const descriptor = requireObject(meta.chunks[chunk], "RAD chunk descriptor");
  const offset = descriptor.offset;
  const bytes = descriptor.bytes;
  if (!isNonNegativeInteger(offset) || !isNonNegativeInteger(bytes) || bytes === 0) throw adapterError("invalid_result", "RAD range is invalid");
  const rootUrl = requireString(owner.rootUrl, "paged.rootUrl");
  if (typeof descriptor.filename === "string" && descriptor.filename.length > 0) {
    return { expectedUrl: resolveExpectedUrl(descriptor.filename, rootUrl) };
  }
  if (!isNonNegativeInteger(metadata.chunksStart)) throw adapterError("invalid_result", "RAD chunksStart is invalid");
  const start = offset + metadata.chunksStart;
  const endExclusive = start + bytes;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(endExclusive) || endExclusive <= start) throw adapterError("invalid_result", "RAD byte range overflows");
  return { expectedUrl: rootUrl, byteRange: Object.freeze({ start, endExclusive, header: `bytes=${start}-${endExclusive - 1}` }) };
}

function resolveExpectedUrl(filename: string, rootUrl: string): string {
  try {
    const base = typeof globalThis.location?.href === "string" ? new URL(rootUrl, globalThis.location.href).toString() : rootUrl;
    return new URL(filename, base).toString();
  } catch {
    const slash = rootUrl.lastIndexOf("/");
    return slash >= 0 ? `${rootUrl.slice(0, slash + 1)}${filename}` : filename;
  }
}

function readDecodedResult(value: unknown, pageSplats: number): { numSplats: number; uploadIdentities: readonly object[] } {
  const result = requireObject(value, "decoded result");
  if (!isNonNegativeInteger(result.numSplats) || result.numSplats > pageSplats) throw adapterError("invalid_result", "decoded numSplats is invalid");
  const identities: object[] = [];
  if (isObject(result.packedArray)) identities.push(result.packedArray);
  if (Array.isArray(result.extArrays)) {
    for (const candidate of result.extArrays) if (isObject(candidate)) identities.push(candidate);
  }
  if (isObject(result.extra)) identities.push(result.extra);
  if (identities.length === 0) throw adapterError("invalid_result", "decoded result has no upload payload identity");
  return { numSplats: result.numSplats, uploadIdentities: Object.freeze(identities) };
}

function reverseMapOwnerResolver(pager: PagerShape): (page: number) => { splats: UnknownRecord; chunk: number } | undefined {
  return (page) => {
    const entry = pager.pageToSplatsChunk[page];
    if (!isObject(entry) || !isObject(entry.splats) || !isNonNegativeInteger(entry.chunk)) return undefined;
    return { splats: entry.splats, chunk: entry.chunk };
  };
}

function registerUploadQueueProvenance(
  values: readonly unknown[],
  resolveOwner: (page: number) => { splats: UnknownRecord; chunk: number } | undefined,
  getPagedId: (value: object) => string,
  decodedProvenance: WeakMap<object, UploadProvenance>,
  queuedProvenance: WeakMap<object, UploadProvenance>,
): void {
  for (const value of values) {
    if (!isObject(value) || !isObject(value.packedArray) || !isNonNegativeInteger(value.page)) continue;
    const provenance = provenanceFromUploadQueueItem(
      value,
      value.page,
      value.packedArray,
      resolveOwner,
      getPagedId,
      decodedProvenance,
    );
    if (provenance) queuedProvenance.set(value.packedArray, provenance);
  }
}

function provenanceFromUploadQueueItem(
  value: unknown,
  page: number,
  packedArray: object,
  resolveOwner: (page: number) => { splats: UnknownRecord; chunk: number } | undefined,
  getPagedId: (value: object) => string,
  decodedProvenance: WeakMap<object, UploadProvenance>,
): UploadProvenance | undefined {
  if (!isObject(value)
    || value.page !== page
    || value.packedArray !== packedArray
    || !isNonNegativeInteger(value.numSplats)) return undefined;
  // Spark 2.1.0 upload queue items are {page, numSplats, packedArray, extra} —
  // no splats/chunk fields (those live on lodTreeUpdates entries, a different
  // queue). Owner resolves through the reverse map at HARVEST time, when the
  // mapping is same-frame fresh; direct fields are honored if a future Spark
  // adds them.
  let splats = isObject(value.splats) ? value.splats : undefined;
  let chunk = isNonNegativeInteger(value.chunk) ? value.chunk : undefined;
  if (splats === undefined || chunk === undefined) {
    const owner = resolveOwner(page);
    if (!owner) return undefined;
    splats = owner.splats;
    chunk = owner.chunk;
  }
  if (splats === undefined || chunk === undefined) return undefined;
  const decoded = decodedProvenance.get(packedArray);
  if (decoded && (decoded.splats !== splats || decoded.chunk !== chunk || decoded.numSplats !== value.numSplats)) {
    throw adapterError("invalid_topology", "upload queue ownership contradicts decoded provenance");
  }
  return Object.freeze({
    splats,
    sceneLocalPagedId: getPagedId(splats),
    chunk,
    requestId: decoded?.requestId ?? "",
    numSplats: value.numSplats,
  });
}

function pageGeneration(
  page: number,
  owner: object,
  chunk: number,
  sceneLocalPagedId: string,
  generations: Map<number, PageGeneration>,
): PageGeneration {
  const previous = generations.get(page);
  if (previous && previous.owner === owner && previous.chunk === chunk) return previous;
  const generation = (previous?.generation ?? -1) + 1;
  const next = { owner, chunk, generation, pageId: canonicalPhysicalPageId(sceneLocalPagedId, page, generation) };
  generations.set(page, next);
  return next;
}

function makeReport(
  sparkVersion: string,
  probeStatus: ProbeStatus,
  reasons: readonly string[],
  fingerprint?: AdapterShapeFingerprint,
  ledgerSinceMs?: number,
  baseline?: Readonly<AdapterAttachBaseline>,
): Readonly<AdapterCapabilityReport> {
  return Object.freeze({
    adapterVersion: SPARK_PAGER_ADAPTER_VERSION,
    sparkVersion,
    probeStatus,
    reasons: Object.freeze([...reasons]),
    stages: SPARK_PAGER_CAPABILITIES,
    declaredGaps: ADAPTER_DECLARED_GAPS,
    ...(fingerprint ? { fingerprint } : {}),
    ...(ledgerSinceMs === undefined ? {} : { ledgerSinceMs }),
    ...(baseline ? { baseline } : {}),
  });
}

function invalidHandle(
  code: AdapterInvalidReason,
  detail: string,
  sparkVersion: string,
  atMs: number,
  receive: (event: Readonly<SparkPagerAdapterEvent>) => void,
): SparkPagerAdapterHandle {
  const reasons = Object.freeze([code, detail]);
  const report = makeReport(sparkVersion, "invalid", reasons);
  const event = Object.freeze({
    type: "adapter_invalidated" as const,
    code,
    terminal: true as const,
    atMs,
    probeStatus: "invalid" as const,
    reasons,
    declaredGaps: ADAPTER_DECLARED_GAPS,
  });
  try {
    receive(event);
  } catch {
    // Event receiver failure is isolated from adapter construction.
  }
  return Object.freeze({ capabilities: report, readSnapshot: () => undefined, detach: () => undefined });
}

function installOwnHook(target: UnknownRecord, name: string, wrapper: UnknownFunction): () => void {
  if (Object.prototype.hasOwnProperty.call(target, name)) throw adapterError("fingerprint_mismatch", `${name} is unexpectedly an own property`);
  Object.defineProperty(target, name, { configurable: true, writable: true, value: wrapper });
  return () => {
    if (Object.prototype.hasOwnProperty.call(target, name) && target[name] === wrapper) delete target[name];
  };
}

function canonicalPagedId(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) throw adapterError("invalid_request_id", "sceneLocalPagedId is not canonical");
  return value;
}

export function canonicalRequestId(sceneLocalPagedId: string, chunk: number, attempt: number): string {
  const owner = canonicalPagedId(sceneLocalPagedId);
  if (!isNonNegativeInteger(chunk) || !Number.isSafeInteger(attempt) || attempt < 1) throw adapterError("invalid_request_id", "request identity fields are invalid");
  return `${owner}:chunk:${chunk}:attempt:${attempt}`;
}

export function canonicalPhysicalPageId(sceneLocalPagedId: string, physicalPage: number, generation: number): string {
  const owner = canonicalPagedId(sceneLocalPagedId);
  if (!isNonNegativeInteger(physicalPage) || !isNonNegativeInteger(generation)) throw adapterError("invalid_topology", "page identity fields are invalid");
  return `${owner}:page:${physicalPage}:generation:${generation}`;
}

function ownerChunkKey(sceneLocalPagedId: string, chunk: number): string {
  return `${sceneLocalPagedId}:chunk:${chunk}`;
}

function residentEntryKey(sceneLocalPagedId: string, chunk: number, physicalPage: number): string {
  return `${ownerChunkKey(sceneLocalPagedId, chunk)}:page:${physicalPage}`;
}

function freezeRequest(value: MutableRequestState): Readonly<AdapterRequestState> {
  return Object.freeze({ ...value, ...(value.byteRange ? { byteRange: Object.freeze({ ...value.byteRange }) } : {}) });
}

function fingerprintIndices(indices: Uint32Array): string {
  let hash = 0x811c9dc5;
  for (const value of indices) {
    hash ^= value;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${indices.length}:${hash.toString(16).padStart(8, "0")}`;
}

function equalUint32(a: Uint32Array, b: Uint32Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

interface TaggedAdapterError extends Error {
  readonly adapterCode: AdapterInvalidReason;
}

function adapterError(code: AdapterInvalidReason, message: string): TaggedAdapterError {
  return Object.assign(new Error(message), { adapterCode: code });
}

function isAdapterError(value: unknown): value is TaggedAdapterError {
  return value instanceof Error && "adapterCode" in value;
}

function classifyReadError(error: unknown, fallback: AdapterInvalidReason): AdapterInvalidReason {
  if (isAdapterError(error)) return error.adapterCode;
  return error instanceof Error ? "thrown_getter" : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireObject(value: unknown, label: string): UnknownRecord {
  if (!isObject(value)) throw adapterError("fingerprint_mismatch", `${label} is not an object`);
  return value;
}

function requireFunction(value: unknown, label: string): asserts value is UnknownFunction {
  if (typeof value !== "function") throw adapterError("fingerprint_mismatch", `${label} is not callable`);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw adapterError("fingerprint_mismatch", `${label} is not a string`);
  return value;
}

function requireBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== "boolean") throw adapterError("fingerprint_mismatch", `${label} is not boolean`);
}

function requirePositiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw adapterError("fingerprint_mismatch", `${label} is not a positive integer`);
}

function requireNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!isNonNegativeInteger(value)) throw adapterError("fingerprint_mismatch", `${label} is not a non-negative integer`);
}

function requireNonNegativeFinite(value: unknown, label: string): asserts value is number {
  if (!isFiniteNumber(value) || value < 0) throw adapterError("fingerprint_mismatch", `${label} is not a non-negative finite number`);
}

function isObject(value: unknown): value is UnknownRecord {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return isObject(value) && typeof value.then === "function";
}

function monotonicNow(): number {
  return typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
}

function safeNow(now: () => number): number {
  try {
    const value = now();
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}
