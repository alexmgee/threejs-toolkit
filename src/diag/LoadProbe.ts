import { CameraEpochObserver, type CameraEpochRuntimePolicy, type CameraState, type CameraStateProvider } from "./cameraEpochs";
import { ConvergenceObserver, resolveTerminal, weightedDelta, type ConvergenceObservation, type ConvergenceRuntimePolicy, type FinalEvidence } from "./convergence";
import { LoadRecord, type LoadRecordEnvironment, type LoadRecordRevision, type LoadRecordVersioning } from "./LoadRecord";
import type { EventPayloads, EventSource, EventType, JsonValue, ProbeStatus, RawEvent, TerminalOutcome, VisibilityPhase } from "./events";
import {
  DEFAULT_CAMERA_EPOCH_POLICY,
  DEFAULT_CONVERGENCE_POLICY,
  DEFAULT_RECORD_CAP_POLICY,
  DEFAULT_SAMPLING_POLICY,
  type RecordCapPolicy,
} from "./policies";
import { sanitizeSceneId, stripSceneUrl } from "./privacy";
import { createTelemetryFanout, type PageHideContext, type SinkFailureStatus, type TelemetryFanout, type TelemetrySink } from "./sinks";
import { VisibilityObserver, type LifecycleEvent } from "./visibility";

export const LOAD_PROBE_VERSION = "1";

export interface SamplingRuntimePolicy {
  readonly version: string;
  readonly optionalCpuMsPerRenderedFrame: number;
  readonly optionalCpuMsPerWindow: number;
  readonly foregroundWindowMs: number;
}

export interface RecordCapRuntimePolicy {
  readonly version: string;
  readonly rawBytes: number;
  readonly totalBytes: number;
}

export interface VersionedPolicyOverride<TPolicy extends { readonly version: string }> {
  readonly version: string;
  readonly values: Readonly<Partial<Omit<TPolicy, "version">>>;
}

export interface ConsentDecisions {
  readonly ephemeralMeasurement: "granted" | "pending" | "denied";
  readonly localPersistence: "granted" | "denied";
  readonly remoteTransmission: "granted" | "denied";
}

export interface ProbeCapabilityStatus {
  readonly attached: boolean;
  readonly consent: "granted" | "pending" | "denied" | "disabled";
  readonly capabilities: readonly string[];
}

export const PENDING_STATUS: Readonly<ProbeCapabilityStatus> = Object.freeze({
  attached: false,
  consent: "pending",
  capabilities: Object.freeze([]),
});

export const DENIED_STATUS: Readonly<ProbeCapabilityStatus> = Object.freeze({
  attached: false,
  consent: "denied",
  capabilities: Object.freeze([]),
});

export const DISABLED_STATUS: Readonly<ProbeCapabilityStatus> = Object.freeze({
  attached: false,
  consent: "disabled",
  capabilities: Object.freeze([]),
});

export const FAILED_STATUS: Readonly<ProbeCapabilityStatus> = Object.freeze({
  attached: false,
  consent: "granted",
  capabilities: Object.freeze([]),
});

export interface PendingAttachOptions {
  readonly consent: "pending";
}

export interface DeniedAttachOptions {
  readonly consent: "denied";
}

export interface ProbeSceneMetadata {
  readonly sceneId: string;
  readonly sceneUrl?: string;
  readonly sceneUrlBase?: string;
  readonly serverVersion: string | null;
  readonly radFormatVersion: string | null;
  readonly topologyFingerprint: string | null;
  readonly adapterStatus: ProbeStatus;
  readonly statusReasons: readonly string[];
  readonly declaredGaps: readonly string[];
  readonly capabilityFlags: readonly string[];
  readonly environment: Readonly<LoadRecordEnvironment>;
  readonly versions: Omit<LoadRecordVersioning, "schemaVersion" | "semanticsVersion" | "probeVersion">;
  readonly revealPolicyObserved: JsonValue;
  readonly featureFlags: readonly string[];
  readonly wallClockBucket: string | null;
  readonly clockQuality: string;
}

export interface ProbeFactoryContext {
  readonly loadId: string;
  readonly recordId: string;
  readonly sceneId: string;
  readonly scene: unknown;
  readonly mesh: unknown;
  readonly renderer?: unknown;
  readonly telemetryEndpoint?: string;
}

export interface DisposableSource {
  dispose(): void;
}

export type CapturedProbeEvent = {
  [K in EventType]: {
    readonly type: K;
    readonly eventTimeMs: number;
    readonly source: EventSource;
    readonly payload: EventPayloads[K];
    readonly adapterStatus?: ProbeStatus;
    readonly capabilityFlags?: readonly string[];
    readonly declaredGaps?: readonly string[];
    readonly renderedFrame?: boolean;
    readonly longTaskDurationMs?: number;
  };
}[EventType];

export interface NetworkSnapshot {
  readonly adapterStatus: ProbeStatus;
  readonly requiredReadingsValid: boolean;
  readonly workingSetStable: boolean;
  readonly relevantOutstanding: boolean;
  readonly recentContradictoryEvent: boolean;
  readonly qualifyingProgress: boolean;
  readonly value?: JsonValue;
}

export interface NetworkSource {
  readonly capabilities: readonly string[];
  readonly declaredGaps: readonly string[];
  attach(receiver: (event: Readonly<CapturedProbeEvent>) => void): DisposableSource;
  readSnapshot(atMs: number): Readonly<NetworkSnapshot> | undefined;
  dispose(): void;
}

export interface SpatialObservation {
  readonly coarsePageLikelihood: number;
  readonly coarsePageThreshold: number;
  readonly validatedVisibleCoarseness: boolean;
  readonly requiredReadingsValid: boolean;
  readonly value?: JsonValue;
}

export interface SpatialMapperInput {
  readonly eventTimeMs: number;
  readonly cameraState: Readonly<CameraState>;
  readonly networkSnapshot: Readonly<NetworkSnapshot>;
}

export interface SpatialMapper {
  readonly capabilities: readonly string[];
  readonly declaredGaps: readonly string[];
  observe(input: Readonly<SpatialMapperInput>): Readonly<SpatialObservation> | undefined;
  dispose(): void;
}

export type NetworkSourceFactory = (context: Readonly<ProbeFactoryContext>) => NetworkSource;
export type SpatialMapperFactory = (context: Readonly<ProbeFactoryContext>) => SpatialMapper;
export type CameraStateProviderFactory = (context: Readonly<ProbeFactoryContext>) => CameraStateProvider;

export interface SinkFactoryContext extends ProbeFactoryContext {
  readonly consent: Readonly<ConsentDecisions>;
}

export interface ProbeSinkFactories {
  readonly ephemeral?: readonly ((context: Readonly<SinkFactoryContext>) => TelemetrySink)[];
  readonly local?: readonly ((context: Readonly<SinkFactoryContext>) => TelemetrySink)[];
  readonly remote?: readonly ((context: Readonly<SinkFactoryContext>) => TelemetrySink)[];
}

export interface AffirmativeAttachOptions {
  readonly consent: "granted" | "affirmative";
  readonly now?: () => number;
  readonly telemetry?: boolean;
  readonly telemetryEndpoint?: string;
  readonly consentHook: () => Readonly<ConsentDecisions>;
  readonly loadId: string;
  readonly scene: unknown;
  readonly mesh: unknown;
  readonly renderer?: unknown;
  readonly metadata: Readonly<ProbeSceneMetadata>;
  readonly sinkFactories: Readonly<ProbeSinkFactories>;
  readonly cameraProviderFactory: CameraStateProviderFactory;
  readonly networkSourceFactory: NetworkSourceFactory;
  readonly spatialMapperFactory: SpatialMapperFactory;
  readonly convergencePolicy?: Readonly<VersionedPolicyOverride<ConvergenceRuntimePolicy>>;
  readonly cameraEpochPolicy?: Readonly<VersionedPolicyOverride<CameraEpochRuntimePolicy>>;
  readonly samplingPolicy?: Readonly<VersionedPolicyOverride<SamplingRuntimePolicy>>;
  readonly recordCapPolicy?: Readonly<VersionedPolicyOverride<RecordCapRuntimePolicy>>;
  readonly sinkDeadlineMs?: number;
  readonly initiallyVisible?: boolean;
  readonly initiallyFocused?: boolean;
}

export type AttachOptions = PendingAttachOptions | DeniedAttachOptions | AffirmativeAttachOptions;

export interface LiveLoadProbeHandle {
  readonly status: Readonly<ProbeCapabilityStatus>;
  markInteraction(kind: string, eventTimeMs?: number): void;
  finalize(outcomeHint?: TerminalOutcome): Readonly<LoadRecordRevision> | undefined;
  dispose(): void;
}

export type LoadProbeAttachResult = Readonly<ProbeCapabilityStatus> | LiveLoadProbeHandle;

export interface LoadProbeControl {
  readonly sceneId: string;
  capture(event: Readonly<CapturedProbeEvent>): void;
  markSceneFirstSplatReady(numSplats: number, eventTimeMs?: number): void;
  markCoordinatorOverlayReveal(eventTimeMs?: number): void;
  handleLifecycleEvent(event: Readonly<LifecycleEvent>): void;
  checkpoint(reason?: string): Readonly<LoadRecordRevision> | undefined;
  finalize(outcomeHint?: TerminalOutcome): Readonly<LoadRecordRevision> | undefined;
  dispose(): void;
}

const controls = new WeakMap<LiveLoadProbeHandle, LoadProbeControl>();

export function attach(options: Readonly<AttachOptions>): LoadProbeAttachResult {
  if (options.consent === "pending") return PENDING_STATUS;
  if (options.consent === "denied") return DENIED_STATUS;
  if (options.telemetry === false) return DISABLED_STATUS;

  let decisions: Readonly<ConsentDecisions>;
  try {
    decisions = options.consentHook();
  } catch {
    return DENIED_STATUS;
  }
  if (decisions.ephemeralMeasurement === "pending") return PENDING_STATUS;
  if (decisions.ephemeralMeasurement === "denied") return DENIED_STATUS;

  try {
    return constructAffirmativelyConsentedProbe(options, decisions);
  } catch {
    return FAILED_STATUS;
  }
}

export function getLoadProbeControl(handle: LiveLoadProbeHandle): LoadProbeControl | undefined {
  return controls.get(handle);
}

function constructAffirmativelyConsentedProbe(
  options: Readonly<AffirmativeAttachOptions>,
  decisions: Readonly<ConsentDecisions>,
): LiveLoadProbeHandle {
  const now = options.now ?? defaultNow;
  const startedAtMs = now();
  const sceneId = sanitizeSceneId(options.metadata.sceneId);
  if (options.metadata.sceneUrl !== undefined) stripSceneUrl(options.metadata.sceneUrl, options.metadata.sceneUrlBase);
  const recordId = ephemeralId("record", now);
  const context: Readonly<ProbeFactoryContext> = Object.freeze({
    loadId: options.loadId,
    recordId,
    sceneId,
    scene: options.scene,
    mesh: options.mesh,
    ...(options.renderer === undefined ? {} : { renderer: options.renderer }),
    ...(options.telemetryEndpoint === undefined ? {} : { telemetryEndpoint: options.telemetryEndpoint }),
  });
  const convergencePolicy = mergePolicy(DEFAULT_CONVERGENCE_POLICY, options.convergencePolicy);
  const cameraPolicy = mergePolicy(DEFAULT_CAMERA_EPOCH_POLICY, options.cameraEpochPolicy);
  const samplingPolicy = mergePolicy(DEFAULT_SAMPLING_POLICY, options.samplingPolicy);
  const recordCapPolicy = mergePolicy<RecordCapRuntimePolicy>(DEFAULT_RECORD_CAP_POLICY, options.recordCapPolicy);

  const cameraProvider = options.cameraProviderFactory(context);
  const networkSource = options.networkSourceFactory(context);
  const spatialMapper = options.spatialMapperFactory(context);
  const capabilityFlags = Object.freeze([...new Set([
    ...options.metadata.capabilityFlags,
    ...networkSource.capabilities,
    ...spatialMapper.capabilities,
  ])]);
  const declaredGaps = Object.freeze([...new Set([
    ...options.metadata.declaredGaps,
    ...networkSource.declaredGaps,
    ...spatialMapper.declaredGaps,
  ])]);
  const record = new LoadRecord({
    identity: {
      recordId,
      loadId: options.loadId,
      sceneId,
      serverVersion: options.metadata.serverVersion,
      radFormatVersion: options.metadata.radFormatVersion,
      topologyFingerprint: options.metadata.topologyFingerprint,
    },
    versioning: {
      probeVersion: LOAD_PROBE_VERSION,
      ...options.metadata.versions,
    },
    policy: {
      convergencePolicy: asJsonRecord(convergencePolicy),
      samplingPolicy: asJsonRecord(samplingPolicy),
      revealPolicyObserved: options.metadata.revealPolicyObserved,
      featureFlags: options.metadata.featureFlags,
      capabilityFlags,
    },
    status: {
      probeStatus: options.metadata.adapterStatus,
      reasons: options.metadata.statusReasons,
      declaredGaps,
      sinkHistory: [],
    },
    environment: options.metadata.environment,
    timing: {
      monotonicTimeOriginMs: startedAtMs,
      wallClockBucket: options.metadata.wallClockBucket,
      clockQuality: options.metadata.clockQuality,
      elapsedDurationMs: 0,
      foregroundVisibleDurationMs: 0,
      nonComparableSpans: [],
    },
    caps: recordCapPolicy as RecordCapPolicy,
  });

  const visibility = new VisibilityObserver(startedAtMs, options.initiallyVisible ?? true, options.initiallyFocused ?? true);
  const cameraEpochs = new CameraEpochObserver(cameraPolicy);
  const convergence = new ConvergenceObserver(convergencePolicy);
  const sinks = constructSinks(options.sinkFactories, Object.freeze({ ...context, consent: decisions }), decisions, options.telemetryEndpoint);
  let sequence = 0;
  let adapterStatus = options.metadata.adapterStatus;
  let paused = false;
  let finalizedRevision: Readonly<LoadRecordRevision> | undefined;
  let disposed = false;
  let sourceHandle: DisposableSource | undefined;
  let sinkFanout: TelemetryFanout;
  let eventCount = 0;
  const renderedFrameTimes: number[] = [];
  let lastObservationMs: number | undefined;
  const samplingGaps = { count: 0, totalDurationMs: 0, weightedDurationMs: 0, maximumDurationMs: 0 };
  let spatialStride = 1;
  let snapshotStride = 1;
  let optionalDisabled = false;
  let lastOverrunWindow = Number.NEGATIVE_INFINITY;
  const cpuEntries: Array<{ atMs: number; mandatoryMs: number; optionalMs: number }> = [];
  const longTasks = { count: 0, totalDurationMs: 0, maximumDurationMs: 0 };
  const budgetActions: string[] = [];
  const observedDeclaredGaps = new Set(declaredGaps);

  const append = (event: Readonly<CapturedProbeEvent>, measureMandatory = true): void => {
    if (finalizedRevision) return;
    const start = now();
    try {
      adapterStatus = event.adapterStatus ?? adapterStatus;
      const raw = makeRawEvent(event, ++sequence, recordId, sceneId, adapterStatus, visibility.phase, capabilityFlags, declaredGaps);
      record.append(raw);
      if (event.type === "adapter_invalidation") adapterStatus = "invalid";
      if (event.longTaskDurationMs !== undefined) {
        longTasks.count += 1;
        longTasks.totalDurationMs += event.longTaskDurationMs;
        longTasks.maximumDurationMs = Math.max(longTasks.maximumDurationMs, event.longTaskDurationMs);
      }
      if (event.renderedFrame) renderedFrameTimes.push(event.eventTimeMs);
    } catch {
      // Capture failures are contained; a capped LoadRecord already retains its loss boundaries.
    } finally {
      if (measureMandatory) {
        const cost = Math.max(0, now() - start);
        addCpu(event.eventTimeMs, cost, 0);
        maybeRecordMandatoryOverrun(event.eventTimeMs);
      }
    }
  };

  const appendOwn = <K extends EventType>(type: K, source: EventSource, payload: EventPayloads[K], eventTimeMs = now()): void => {
    append({ type, source, payload, eventTimeMs } as CapturedProbeEvent);
  };

  const statusRevision = (failure: Readonly<SinkFailureStatus>): Readonly<LoadRecordRevision> | undefined => {
    appendOwn("sink_failure", "sink", failure, now());
    return safeCheckpoint();
  };
  sinkFanout = createTelemetryFanout(sinks, {
    deadlineMs: options.sinkDeadlineMs ?? samplingPolicy.foregroundWindowMs,
    statusRevision,
  });

  const safeCheckpoint = (): Readonly<LoadRecordRevision> | undefined => {
    try {
      return record.checkpoint();
    } catch {
      return undefined;
    }
  };

  const recordBudgetAction = (eventTimeMs: number, measuredCpuMs: number): void => {
    const action = !optionalDisabled && spatialStride === 1
      ? "lower_spatial_frequency"
      : !optionalDisabled && snapshotStride === 1
        ? "lower_snapshot_frequency"
        : "disable_optional_work";
    if (action === "lower_spatial_frequency") spatialStride = 2;
    else if (action === "lower_snapshot_frequency") snapshotStride = 2;
    else optionalDisabled = true;
    budgetActions.push(action);
    appendOwn("budget_action", "probe", { action, measuredCpuMs }, eventTimeMs);
  };

  let observing = false;
  const runOptionalObservation = (eventTimeMs: number): void => {
    if (paused || optionalDisabled || visibility.phase !== "foreground_visible") return;
    // Re-entrancy guard: networkSource.readSnapshot() below synchronously emits a
    // pager_snapshot event that flows back through capture() -> runOptionalObservation.
    // Without this, each snapshot read triggers another observation, recursing
    // ~1000-deep and stalling the main thread for seconds during load (confirmed by
    // a Firefox profile 2026-08-07: this cascade dominated the load's main thread).
    if (observing) return;
    eventCount += 1;
    if (eventCount % snapshotStride !== 0) return;
    const start = now();
    observing = true;
    try {
      const networkSnapshot = networkSource.readSnapshot(eventTimeMs);
      const cameraState = cameraProvider.readCameraState(eventTimeMs);
      if (!networkSnapshot || !cameraState) return;
      const camera = cameraEpochs.observe(eventTimeMs, cameraState);
      const newCameraGaps = camera.declaredGaps.filter((gap) => !observedDeclaredGaps.has(gap));
      if (newCameraGaps.length > 0) {
        for (const gap of newCameraGaps) observedDeclaredGaps.add(gap);
        append({
          type: "degradation",
          source: "camera",
          eventTimeMs,
          payload: { reason: "camera_pivot_fallback", capabilities: Object.freeze(["camera_epochs"]) },
          declaredGaps: Object.freeze([...observedDeclaredGaps]),
        });
      }
      if (camera.motionConfirmed) convergence.invalidateCandidateForMotion();
      if (eventCount % spatialStride !== 0) return;
      const spatial = spatialMapper.observe({ eventTimeMs, cameraState, networkSnapshot });
      if (!spatial) return;
      const observation: ConvergenceObservation = {
        eventTimeMs,
        foregroundVisible: true,
        stableCameraEpoch: camera.eligibleForConvergence,
        adapterValid: networkSnapshot.adapterStatus !== "invalid",
        requiredReadingsValid: networkSnapshot.requiredReadingsValid && spatial.requiredReadingsValid,
        workingSetStable: networkSnapshot.workingSetStable,
        relevantOutstanding: networkSnapshot.relevantOutstanding,
        recentContradictoryEvent: networkSnapshot.recentContradictoryEvent,
        coarsePageLikelihood: spatial.coarsePageLikelihood,
        coarsePageThreshold: spatial.coarsePageThreshold,
        validatedVisibleCoarseness: spatial.validatedVisibleCoarseness,
        qualifyingProgress: networkSnapshot.qualifyingProgress,
      };
      convergence.observe(observation);
    } catch {
      optionalDisabled = true;
    } finally {
      observing = false;
      const cost = Math.max(0, now() - start);
      addCpu(eventTimeMs, 0, cost);
      const window = cpuWindow(eventTimeMs);
      const allowed = Math.min(
        Math.max(1, renderedFrameTimes.length) * samplingPolicy.optionalCpuMsPerRenderedFrame,
        samplingPolicy.optionalCpuMsPerWindow,
      );
      if (window.optionalMs > allowed) recordBudgetAction(eventTimeMs, window.optionalMs);
    }
  };

  const capture = (event: Readonly<CapturedProbeEvent>): void => {
    try {
      if (finalizedRevision) return;
      if (lastObservationMs !== undefined) {
        const rawGap = Math.max(0, event.eventTimeMs - lastObservationMs);
        if (rawGap > convergencePolicy.maxObservationGapMs) {
          samplingGaps.count += 1;
          samplingGaps.totalDurationMs += rawGap;
          samplingGaps.weightedDurationMs += weightedDelta(lastObservationMs, event.eventTimeMs, convergencePolicy.maxObservationGapMs);
          samplingGaps.maximumDurationMs = Math.max(samplingGaps.maximumDurationMs, rawGap);
          appendOwn("sampling_gap", "probe", { durationMs: rawGap, reason: "maximum_observation_gap_exceeded" }, event.eventTimeMs);
        }
      }
      lastObservationMs = Math.max(lastObservationMs ?? event.eventTimeMs, event.eventTimeMs);
      append(event);
      runOptionalObservation(event.eventTimeMs);
    } catch {
      // Probe callbacks never throw into their source.
    }
  };

  const checkpoint = (reason = "manual"): Readonly<LoadRecordRevision> | undefined => {
    if (finalizedRevision) return finalizedRevision;
    appendOwn("checkpoint", "probe", { revisionId: record.snapshot().identity.revisionId + 1, reason }, now());
    const revision = safeCheckpoint();
    if (revision) void sinkFanout.onRecord(revision);
    return revision;
  };

  const finalize = (outcomeHint?: TerminalOutcome): Readonly<LoadRecordRevision> | undefined => {
    if (finalizedRevision) return finalizedRevision;
    try {
      const evidence = convergence.evidence;
      const visibilitySnapshot = visibility.snapshot(now());
      const finalEvidence: FinalEvidence = {
        adapterInvalidBeforeProof: (adapterStatus === "invalid" || outcomeHint === "adapter_invalid") && !evidence.convergedProven,
        laterDependsOnPager: outcomeHint !== "abandoned" && outcomeHint !== "hidden",
        convergedProven: evidence.convergedProven || outcomeHint === "converged",
        nonPersistedPageHide: visibilitySnapshot.nonPersistedExit || outcomeHint === "abandoned",
        disposed: disposed || outcomeHint === "abandoned",
        endedHidden: visibilitySnapshot.phase === "hidden" || outcomeHint === "hidden",
        confirmedMotionInvalidatedCandidate: evidence.confirmedMotionInvalidatedCandidate || outcomeHint === "camera_invalidated",
        laterQualified: evidence.laterQualified,
        provableStall: evidence.provableStall || outcomeHint === "stalled",
        maximumWindowExpired: evidence.maximumWindowExpired || outcomeHint === "timed_out",
      };
      const outcome = resolveTerminal(finalEvidence);
      const finalDeclaredGaps = Object.freeze([...observedDeclaredGaps]);
      record.appendDerivedBlock({
        name: "probe_summary",
        policyVersion: samplingPolicy.version,
        value: {
          cpu: cpuWindow(now()),
          /** The optional-budget DENOMINATOR, recorded so AC3's "shown
           *  non-zero on a real load" is readable from the record itself
           *  rather than inferred from the ladder's behaviour. Zero here on
           *  a load that rendered means the feed is broken — which is the
           *  §G trap, now visible in the artifact (ticket 12, G2).
           *
           *  NAMED FOR WHAT IT COUNTS (owner ruling 2026-09-22, doc 06 D35
           *  item 5): SAMPLE WINDOWS in which rendering occurred, NOT
           *  rendered frames. One entry is pushed per captured event
           *  carrying `renderedFrame`, and the telemetry source emits one
           *  such event per SNAPSHOT while rendering runs at frame rate —
           *  measured at 120 frames against 19 flagged events, a 6.32x
           *  ratio on this machine. That sampling cadence is the pin's own
           *  (`fd67153:SparkPagerAdapter.ts:529` emits one `pager_snapshot`
           *  per `readSnapshot`), so the ladder's behaviour is unchanged
           *  from what shipped; only the name is corrected. The policy
           *  constant it divides, `optionalCpuMsPerRenderedFrame`, keeps
           *  its inherited name: recalibrating the allowance against true
           *  frames is a POST-PARITY TUNING decision, recorded in ticket
           *  13, not a rename. */
          renderedSampleWindows: renderedFrameTimes.length,
          longTasks,
          requestedFrequency: { spatialStride: 1, snapshotStride: 1 },
          effectiveFrequency: { spatialStride, snapshotStride },
          budgetActions,
          samplingGaps,
          optionalDisabled,
          disabledCapabilities: optionalDisabled ? ["network_snapshot", "spatial_mapping"] : [],
          convergence: convergence.evidence,
          camera: cameraEpochs.finish(),
          visibility: visibilitySnapshot,
        },
      });
      appendOwn("finalization", "probe", { outcome, uncertaintyReasons: finalDeclaredGaps }, now());
      finalizedRevision = record.finalize(outcome, finalDeclaredGaps);
      void sinkFanout.onRecord(finalizedRevision);
      return finalizedRevision;
    } catch {
      return finalizedRevision;
    }
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    finalize("abandoned");
    safeDispose(sourceHandle);
    safeDispose(networkSource);
    safeDispose(spatialMapper);
  };

  const handleLifecycleEvent = (event: Readonly<LifecycleEvent>): void => {
    try {
      const transition = visibility.handle(event);
      appendLifecycle(event);
      if (transition.breaksComparability) convergence.breakDwellForHidden();
      paused = transition.shouldPause ? true : transition.shouldResume ? false : paused;
      if (event.type === "pagehide") {
        if (event.persisted) {
          appendOwn("suspension", "lifecycle", { persisted: true, reason: "bfcache" }, event.eventTimeMs);
          const revision = checkpoint("persisted_pagehide");
          if (revision) {
            const pageHide: PageHideContext = {
              recordId,
              revisionId: revision.identity.revisionId,
              eventTimeMs: event.eventTimeMs,
              persisted: true,
              record: revision,
            };
            void sinkFanout.onPageHide(pageHide);
          }
        } else {
          finalize("abandoned");
        }
      } else if (event.type === "pageshow" && transition.reconciled && transition.suspendedAtMs !== undefined) {
        appendOwn("reconciliation", "lifecycle", {
          suspendedAtMs: transition.suspendedAtMs,
          resumedAtMs: event.eventTimeMs,
          nonComparable: true,
        }, event.eventTimeMs);
      }
    } catch {
      // Lifecycle integration is observer-only and cannot escape into callers.
    }
  };

  const appendLifecycle = (event: Readonly<LifecycleEvent>): void => {
    switch (event.type) {
      case "visibilitychange": appendOwn("visibility_change", "lifecycle", { visible: event.visible }, event.eventTimeMs); break;
      case "focus": appendOwn("focus_change", "lifecycle", { focused: true }, event.eventTimeMs); break;
      case "blur": appendOwn("focus_change", "lifecycle", { focused: false }, event.eventTimeMs); break;
      case "freeze": appendOwn("freeze", "lifecycle", { observable: true }, event.eventTimeMs); break;
      case "resume": appendOwn("resume", "lifecycle", { observable: true }, event.eventTimeMs); break;
      case "pagehide": appendOwn("pagehide", "lifecycle", { persisted: event.persisted }, event.eventTimeMs); break;
      case "pageshow": appendOwn("pageshow", "lifecycle", { persisted: event.persisted }, event.eventTimeMs); break;
    }
  };

  function addCpu(atMs: number, mandatoryMs: number, optionalMs: number): void {
    cpuEntries.push({ atMs, mandatoryMs, optionalMs });
    const cutoff = atMs - samplingPolicy.foregroundWindowMs;
    while (cpuEntries.length > 0 && cpuEntries[0].atMs < cutoff) cpuEntries.shift();
    while (renderedFrameTimes.length > 0 && renderedFrameTimes[0] < cutoff) renderedFrameTimes.shift();
  }

  function cpuWindow(atMs: number): { mandatoryMs: number; optionalMs: number; totalMs: number; windowMs: number } {
    const cutoff = atMs - samplingPolicy.foregroundWindowMs;
    let mandatoryMs = 0;
    let optionalMs = 0;
    for (const entry of cpuEntries) {
      if (entry.atMs < cutoff) continue;
      mandatoryMs += entry.mandatoryMs;
      optionalMs += entry.optionalMs;
    }
    return { mandatoryMs, optionalMs, totalMs: mandatoryMs + optionalMs, windowMs: samplingPolicy.foregroundWindowMs };
  }

  function maybeRecordMandatoryOverrun(atMs: number): void {
    const window = cpuWindow(atMs);
    if (window.mandatoryMs <= samplingPolicy.optionalCpuMsPerWindow) return;
    if (atMs - lastOverrunWindow < samplingPolicy.foregroundWindowMs) return;
    lastOverrunWindow = atMs;
    append({
      type: "budget_overrun",
      source: "probe",
      eventTimeMs: atMs,
      payload: { measuredCpuMs: window.mandatoryMs, windowMs: samplingPolicy.foregroundWindowMs, mandatory: true },
    }, false);
  }

  appendOwn("probe_attach", "probe", { probeVersion: LOAD_PROBE_VERSION }, startedAtMs);
  appendOwn("capability_report", "probe", {
    capabilities: Object.freeze(Object.fromEntries(capabilityFlags.map((flag) => [flag, true]))),
    declaredGaps,
  }, startedAtMs);
  try {
    sourceHandle = networkSource.attach(capture);
  } catch (error) {
    appendOwn("error", "probe", {
      name: error instanceof Error ? error.name : "NetworkSourceAttachError",
      message: error instanceof Error ? error.message : String(error),
      operation: "network_source_attach",
    }, now());
    appendOwn("degradation", "probe", {
      reason: "mandatory_event_source_unavailable",
      capabilities: Object.freeze(["network_event_capture"]),
    }, now());
    optionalDisabled = true;
  }

  const status: Readonly<ProbeCapabilityStatus> = Object.freeze({
    attached: true,
    consent: "granted",
    capabilities: capabilityFlags,
  });
  const handle: LiveLoadProbeHandle = Object.freeze({
    status,
    markInteraction(kind: string, eventTimeMs = now()): void {
      try { appendOwn("user_interaction", "interaction", { kind }, eventTimeMs); } catch { /* contained */ }
    },
    finalize,
    dispose,
  });
  controls.set(handle, Object.freeze({
    sceneId,
    capture,
    markSceneFirstSplatReady(numSplats: number, eventTimeMs = now()): void {
      appendOwn("scene_first_splat_ready", "renderer", { numSplats }, eventTimeMs);
    },
    markCoordinatorOverlayReveal(eventTimeMs = now()): void {
      appendOwn("coordinator_overlay_reveal", "coordinator", { allScenesVisible: true, loadingHideCalled: true }, eventTimeMs);
    },
    handleLifecycleEvent,
    checkpoint,
    finalize,
    dispose,
  }));
  return handle;
}

function constructSinks(
  factories: Readonly<ProbeSinkFactories>,
  context: Readonly<SinkFactoryContext>,
  consent: Readonly<ConsentDecisions>,
  endpoint: string | undefined,
): readonly TelemetrySink[] {
  const selected = [
    ...(factories.ephemeral ?? []),
    ...(consent.localPersistence === "granted" ? factories.local ?? [] : []),
    ...(consent.remoteTransmission === "granted" && endpoint !== undefined ? factories.remote ?? [] : []),
  ];
  const sinks: TelemetrySink[] = [];
  for (const factory of selected) {
    try { sinks.push(factory(context)); } catch { /* one factory cannot suppress other tiers */ }
  }
  return Object.freeze(sinks);
}

function makeRawEvent(
  event: Readonly<CapturedProbeEvent>,
  sequence: number,
  recordId: string,
  sceneId: string,
  adapterStatus: ProbeStatus,
  visibilityPhase: VisibilityPhase,
  capabilityFlags: readonly string[],
  declaredGaps: readonly string[],
): RawEvent {
  return {
    eventId: `${recordId}:${sequence}`,
    sequence,
    eventTimeMs: event.eventTimeMs,
    type: event.type,
    source: event.source,
    recordId,
    sceneId,
    adapterStatus,
    visibilityPhase,
    capabilityFlags: event.capabilityFlags ?? capabilityFlags,
    declaredGaps: event.declaredGaps ?? declaredGaps,
    payload: event.payload,
  } as RawEvent;
}

function mergePolicy<TPolicy extends { readonly version: string }>(
  defaults: Readonly<TPolicy>,
  override: Readonly<VersionedPolicyOverride<TPolicy>> | undefined,
): Readonly<TPolicy> {
  return Object.freeze({ ...defaults, ...(override?.values ?? {}), version: override?.version ?? defaults.version }) as Readonly<TPolicy>;
}

function asJsonRecord(value: object): Readonly<Record<string, JsonValue>> {
  return value as Readonly<Record<string, JsonValue>>;
}

function ephemeralId(prefix: string, now: () => number): string {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject && typeof cryptoObject.randomUUID === "function") return `${prefix}-${cryptoObject.randomUUID()}`;
  return `${prefix}-${Math.random().toString(36).slice(2)}-${now().toString(36)}`;
}

function defaultNow(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function safeDispose(value: { dispose(): void } | undefined): void {
  try { value?.dispose(); } catch { /* disposal is idempotent and contained */ }
}
