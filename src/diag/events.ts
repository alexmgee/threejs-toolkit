export type ProbeStatus = "valid" | "degraded" | "invalid";

export type VisibilityPhase =
  | "foreground_visible"
  | "foreground_blurred"
  | "hidden"
  | "frozen"
  | "suspended";

export type EventSource =
  | "probe"
  | "adapter"
  | "network"
  | "pager"
  | "camera"
  | "lifecycle"
  | "coordinator"
  | "renderer"
  | "interaction"
  | "sink";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface EventEnvelope<TType extends EventType, TPayload> {
  eventId: string;
  sequence: number;
  eventTimeMs: number;
  type: TType;
  source: EventSource;
  recordId: string;
  sceneId: string;
  adapterStatus: ProbeStatus;
  visibilityPhase: VisibilityPhase;
  cameraEpochId?: string;
  capabilityFlags: readonly string[];
  declaredGaps: readonly string[];
  payload: TPayload;
}

export interface PageReference {
  pageId: string;
  requestId?: string;
  parentPageId?: string;
  childPageIds?: readonly string[];
}

export interface EventTimeRange {
  startMs: number;
  endMs: number;
}

export interface EventPayloads {
  probe_attach: { probeVersion: string };
  shape_fingerprint: { fingerprint: string };
  capability_report: { capabilities: Readonly<Record<string, boolean>>; declaredGaps: readonly string[] };
  degradation: { reason: string; capabilities: readonly string[] };
  adapter_invalidation: { reason: string; terminal: true };
  budget_action: { action: "lower_spatial_frequency" | "lower_snapshot_frequency" | "disable_optional_work"; measuredCpuMs: number };
  budget_overrun: { measuredCpuMs: number; windowMs: number; mandatory: boolean };
  sampling_gap: { durationMs: number; reason: string };
  overhead: { cpuMs: number; operation: string };
  compaction_boundary: { eventCount: number; eventTimeRange: EventTimeRange; perTypeCounts: Readonly<Partial<Record<EventType, number>>> };
  drop_boundary: { eventType: EventType; eventTimeRange: EventTimeRange; count: number; reason: string };
  error: { name: string; message: string; operation?: string };
  finalization: { outcome: TerminalOutcome; uncertaintyReasons: readonly string[] };
  request_created: PageReference & { requestId: string; byteRange?: string };
  request_ownership: PageReference & { requestId: string; canonicalPageId: string; byteRange?: string };
  request_retry: PageReference & { requestId: string; attempt: number; reason?: string };
  request_failure: PageReference & { requestId: string; reason: string; terminal: boolean };
  cache_status: PageReference & { status: "hit" | "miss" | "bypass" | "unknown"; serviceWorker: boolean | "unknown" };
  bytes: PageReference & { byteCount: number; cumulativeByteCount?: number };
  decode: PageReference & { phase: "start" | "complete" | "failure"; decodedBytes?: number; reason?: string };
  gpu_allocation: PageReference & { phase: "start" | "complete" | "failure"; byteCount?: number; reason?: string };
  gpu_upload: PageReference & { phase: "start" | "complete" | "failure"; byteCount?: number; reason?: string };
  render_eligible: PageReference & { eligible: boolean };
  eviction: PageReference & { reason?: string };
  replacement: PageReference & { replacementPageId: string; phase: "start" | "complete" };
  parent_retired: { parentPageId: string; replacementPageIds: readonly string[] };
  resource_timing: { requestId?: string; resourceName: string; startTimeMs: number; durationMs: number; transferSize?: number };
  tao_status: { requestId?: string; status: "allowed" | "blocked" | "unknown" };
  resource_ambiguity: { resourceName: string; candidateRequestIds: readonly string[] };
  timing_buffer_overflow: { droppedEntryCount?: number };
  pager_snapshot: { residentPageIds: readonly string[]; requestCount?: number; residentSplats?: number };
  topology_change: { fingerprint: string; addedPageIds: readonly string[]; removedPageIds: readonly string[] };
  camera_pose_change: { position: readonly number[]; quaternion: readonly number[]; pivotDistance?: number };
  camera_projection_change: { projectionMatrix: readonly number[]; verticalFovDegrees?: number };
  viewport_change: { widthCssPx: number; heightCssPx: number };
  dpr_change: { dpr: number };
  foveation_change: { parameters: Readonly<Record<string, number>> };
  camera_epoch_boundary: { epochId: string; phase: "start" | "motion" | "stable" | "end"; reason: string };
  visibility_change: { visible: boolean };
  focus_change: { focused: boolean };
  freeze: { observable: true };
  resume: { observable: true };
  pagehide: { persisted: boolean };
  pageshow: { persisted: boolean };
  scene_first_splat_ready: { numSplats: number };
  coordinator_overlay_reveal: { allScenesVisible: true; loadingHideCalled: true };
  first_render_contribution: { pageId?: string; numSplats?: number };
  user_interaction: { kind: string };
  sink_status: { sinkName: string; operation: SinkOperation; status: string; detail?: string };
  sink_failure: { sinkName: string; operation: SinkOperation; reason: "rejection" | "timeout"; message: string };
  checkpoint: { revisionId: number; reason: string };
  suspension: { persisted: boolean; reason: string };
  reconciliation: { suspendedAtMs: number; resumedAtMs: number; nonComparable: boolean };
}

export type SinkOperation = "capabilities" | "onRecord" | "onPageHide";

export type TerminalOutcome =
  | "converged"
  | "stalled"
  | "abandoned"
  | "hidden"
  | "timed_out"
  | "camera_invalidated"
  | "insufficient_stable_observation"
  | "adapter_invalid";

export type EventType = keyof EventPayloads;

export type RawEvent = {
  [K in EventType]: EventEnvelope<K, EventPayloads[K]>;
}[EventType];
