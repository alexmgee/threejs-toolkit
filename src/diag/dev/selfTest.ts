export * from "./FrameDiffValidator";
export * from "./reportUI";

import { CameraEpochObserver, type CameraState } from "../cameraEpochs";
import { ConvergenceObserver, resolveTerminal, weightedDelta, type FinalEvidence } from "../convergence";
import { LoadCoordinator, type SceneRegistration } from "../LoadCoordinator";
import {
  attach,
  DENIED_STATUS,
  getLoadProbeControl,
  PENDING_STATUS,
  type AffirmativeAttachOptions,
  type AttachOptions,
  type CapturedProbeEvent,
  type LiveLoadProbeHandle,
  type LoadProbeControl,
  type NetworkSource,
  type SpatialMapper,
} from "../LoadProbe";
import { LoadRecord, type LoadRecordInit, type LoadRecordRevision } from "../LoadRecord";
import { LaggardMapper, type SpatialEvidenceObservation, type SpatialPageEvidence } from "../LaggardMapper";
import { NetworkObserver } from "../NetworkObserver";
import { createBeaconSink } from "../sinkBeacon";
import { createStoreSink } from "../sinkStore";
import { createTelemetryFanout, type SinkCapabilities, type SinkFailureStatus, type TelemetrySink } from "../sinks";
import { bucketGpu, sanitizeSceneId, stripSceneUrl } from "../privacy";
import { VisibilityObserver } from "../visibility";
import type { JsonValue, RawEvent, TerminalOutcome } from "../events";
import { DEFAULT_RECORD_CAP_POLICY, DEFAULT_STORAGE_POLICY } from "../policies";

export type SelfTestStatus = "pass" | "fail" | "skipped" | "deferred";

export interface SelfTestAssertion {
  readonly id: string;
  readonly label: string;
  readonly status: SelfTestStatus;
  readonly expected: unknown;
  readonly actual: unknown;
  readonly detail?: string;
}

export interface SelfTestOptions {
  readonly phase7AcceptanceEnabled?: boolean;
  readonly phase7RuntimeEvaluator?: () => Promise<Readonly<{ expected: unknown; actual: unknown }>>;
}

export interface SelfTestResults {
  readonly assertions: readonly Readonly<SelfTestAssertion>[];
  readonly passedCount: number;
  readonly evaluatedCount: number;
  readonly passed: boolean;
  readonly summaryLine: string;
  readonly machineLines: readonly string[];
}

export async function runSelfTest(options: Readonly<SelfTestOptions> = {}): Promise<Readonly<SelfTestResults>> {
  const assertions: SelfTestAssertion[] = [];
  assertions.push(assertTerminalPrecedence());
  assertions.push(assertCameraHysteresis());
  assertions.push(assertPersistedLifecycle());
  assertions.push(assertBudgetLadder());
  assertions.push(assertBudgetDenominatorAdvances());
  assertions.push(assertWeightedGap());
  assertions.push(assertLaggardMapper());
  assertions.push(assertNetworkAmbiguity());
  assertions.push(assertUtf8Boundary());
  assertions.push(await assertSinkFanout());
  assertions.push(await assertStoreBounds());
  assertions.push(assertBeaconCases());
  assertions.push(assertPrivacy());
  assertions.push(assertConstructionFreeConsent());
  assertions.push(await assertDeferredPhase7(options));
  assertions.push(assertCoordinator());

  const evaluated = assertions.filter((assertion) => assertion.status === "pass" || assertion.status === "fail");
  const passedCount = evaluated.filter((assertion) => assertion.status === "pass").length;
  const summaryLine = `SELF-TEST: ${passedCount}/${evaluated.length} PASS`;
  const machineLines = Object.freeze([
    ...assertions.map(machineLine),
    summaryLine,
  ]);
  return Object.freeze({
    assertions: Object.freeze(assertions),
    passedCount,
    evaluatedCount: evaluated.length,
    passed: passedCount === evaluated.length,
    summaryLine,
    machineLines,
  });
}

export function renderSelfTestResults(container: HTMLElement, results: Readonly<SelfTestResults>): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "panel";
  const heading = document.createElement("h2");
  heading.className = results.passed ? "pass" : "fail";
  heading.textContent = results.summaryLine;
  panel.append(heading);
  for (const assertion of results.assertions) {
    const row = document.createElement("article");
    row.className = `assertion ${assertion.status === "pass" ? "pass" : assertion.status === "fail" ? "fail" : "skip"}`;
    const title = document.createElement("div");
    title.textContent = `${assertion.status.toUpperCase()} ${assertion.id} — ${assertion.label}`;
    const comparison = document.createElement("pre");
    comparison.textContent = `expected=${stableStringify(assertion.expected)}\nactual=${stableStringify(assertion.actual)}${assertion.detail ? `\ndetail=${assertion.detail}` : ""}`;
    row.append(title, comparison);
    panel.append(row);
  }
  container.append(panel);
  return panel;
}

function assertTerminalPrecedence(): SelfTestAssertion {
  const base: FinalEvidence = {
    adapterInvalidBeforeProof: false,
    laterDependsOnPager: false,
    convergedProven: false,
    nonPersistedPageHide: false,
    disposed: false,
    endedHidden: false,
    confirmedMotionInvalidatedCandidate: false,
    laterQualified: false,
    provableStall: false,
    maximumWindowExpired: false,
  };
  const cases: Array<readonly [FinalEvidence, TerminalOutcome]> = [
    [{ ...base, adapterInvalidBeforeProof: true, laterDependsOnPager: true, convergedProven: true, disposed: true }, "adapter_invalid"],
    [{ ...base, convergedProven: true, disposed: true, endedHidden: true }, "converged"],
    [{ ...base, nonPersistedPageHide: true, endedHidden: true, provableStall: true }, "abandoned"],
    [{ ...base, endedHidden: true, provableStall: true }, "hidden"],
    [{ ...base, confirmedMotionInvalidatedCandidate: true, laterQualified: false, provableStall: true }, "camera_invalidated"],
    [{ ...base, provableStall: true, maximumWindowExpired: true }, "stalled"],
    [{ ...base, maximumWindowExpired: true }, "timed_out"],
    [base, "insufficient_stable_observation"],
  ];
  const actual = cases.map(([evidence]) => resolveTerminal(evidence));
  const expected = cases.map(([, outcome]) => outcome);
  return compared("terminal-precedence", "all eight FinalEvidence outcomes in precedence order", expected, actual);
}

function assertCameraHysteresis(): SelfTestAssertion {
  const observer = new CameraEpochObserver();
  const observations = [
    observer.observe(0, cameraState(0)),
    observer.observe(100, cameraState(0.2)),
    observer.observe(200, cameraState(0.4)),
    observer.observe(300, cameraState(0.2)),
    observer.observe(799, cameraState(0.2)),
    observer.observe(800, cameraState(0.2)),
  ];
  const actual = {
    firstHighMotion: observations[1].motionConfirmed,
    secondHighMotion: observations[2].motionConfirmed,
    phaseAfterSecondHigh: observations[2].phase,
    resumedBefore500Ms: observations[4].stabilityResumed,
    resumedAt500Ms: observations[5].stabilityResumed,
    finalPhase: observations[5].phase,
    precedingMedianUsed: observations[5].anchor.position[0] === 0.2,
    fixedAnchorNotDeltaBaseline: observations[2].anchor.position[0] === 0,
  };
  const expected = {
    firstHighMotion: false,
    secondHighMotion: true,
    phaseAfterSecondHigh: "motion",
    resumedBefore500Ms: false,
    resumedAt500Ms: true,
    finalPhase: "stable",
    precedingMedianUsed: true,
    fixedAnchorNotDeltaBaseline: true,
  };
  return compared("camera-hysteresis", "two-high motion and half-low rolling-median resume", expected, actual);
}

function assertPersistedLifecycle(): SelfTestAssertion {
  const visibility = new VisibilityObserver(0, true, true);
  const suspended = visibility.handle({ type: "pagehide", eventTimeMs: 10, persisted: true });
  const reconciled = visibility.handle({ type: "pageshow", eventTimeMs: 20, persisted: true });
  const harness = createProbeHarness("lifecycle-scene");
  harness.control.handleLifecycleEvent({ type: "pagehide", eventTimeMs: performance.now(), persisted: true });
  const checkpoint = harness.control.checkpoint("after_suspend");
  harness.control.handleLifecycleEvent({ type: "pageshow", eventTimeMs: performance.now() + 1, persisted: true });
  const final = harness.control.finalize("converged");
  const events = final?.evidence.rawEvents ?? [];
  const actual = {
    statePath: [suspended.phase, reconciled.reconciled ? "reconciled" : "not_reconciled", reconciled.phase === "foreground_visible" ? "observing" : reconciled.phase],
    sameRecordId: checkpoint?.identity.recordId === final?.identity.recordId,
    revisionsStrict: (checkpoint?.identity.revisionId ?? 0) < (final?.identity.revisionId ?? 0),
    eventSequencesStrict: strictlyIncreasing(events.map((event) => event.sequence)),
    suspensionEvents: events.filter((event) => event.type === "suspension").length,
    reconciliationEvents: events.filter((event) => event.type === "reconciliation").length,
    abandoned: final?.status.terminalOutcome === "abandoned",
  };
  const expected = {
    statePath: ["suspended", "reconciled", "observing"],
    sameRecordId: true,
    revisionsStrict: true,
    eventSequencesStrict: true,
    suspensionEvents: 1,
    reconciliationEvents: 1,
    abandoned: false,
  };
  return compared("bfcache-lifecycle", "persisted suspension reconciles the same record", expected, actual);
}

function assertBudgetLadder(): SelfTestAssertion {
  let clockMs = 0;
  const clock = {
    now: (): number => clockMs++,
    advance: (deltaMs: number): void => { clockMs += deltaMs; },
  };
  const harness = createProbeHarness("budget-scene", { optionalCpuMsPerRenderedFrame: 0, optionalCpuMsPerWindow: 50 }, clock.now);
  const event = (atMs: number): CapturedProbeEvent => ({
    type: "pager_snapshot",
    source: "pager",
    eventTimeMs: atMs,
    renderedFrame: true,
    payload: { residentPageIds: [], requestCount: 0, residentSplats: 0 },
  });
  for (let index = 0; index < 4; index += 1) {
    harness.control.capture(event(clock.now()));
    if (index < 3) clock.advance(5_001);
  }
  let waited = false;
  const slowPayload = Object.defineProperty({}, "kind", {
    enumerable: true,
    get(): string {
      if (!waited) {
        waited = true;
        clock.advance(55);
      }
      return "mandatory-after-budget";
    },
  }) as { kind: string };
  harness.control.capture({ type: "user_interaction", source: "interaction", eventTimeMs: clock.now(), payload: slowPayload });
  harness.control.capture({ type: "user_interaction", source: "interaction", eventTimeMs: clock.now(), payload: { kind: "continues" } });
  const final = harness.control.finalize("converged");
  const events = final?.evidence.rawEvents ?? [];
  const emittedActions = events.flatMap((raw) => raw.type === "budget_action" ? [raw.payload.action] : []);
  const normalized = emittedActions.map((action) => ({
    lower_spatial_frequency: "reduce_spatial",
    lower_snapshot_frequency: "reduce_snapshots",
    disable_optional_work: "disable_optional",
  })[action]);
  const overrun = events.find((raw) => raw.type === "budget_overrun");
  const actual = {
    applyBudgetActions: normalized.slice(0, 3),
    emittedActions: emittedActions.slice(0, 3),
    mandatoryEventsAfterDisable: events.filter((raw) => raw.type === "user_interaction").length,
    overrunRecordedAbove50Ms: overrun?.type === "budget_overrun" && overrun.payload.measuredCpuMs > 50,
  };
  const expected = {
    applyBudgetActions: ["reduce_spatial", "reduce_snapshots", "disable_optional"],
    emittedActions: ["lower_spatial_frequency", "lower_snapshot_frequency", "disable_optional_work"],
    mandatoryEventsAfterDisable: 2,
    overrunRecordedAbove50Ms: true,
  };
  return compared("budget-ladder", "adaptive optional ladder preserves mandatory capture", expected, actual,
    "The executable LoadProbe API emits the production budget_action names; the plan sketch names are compared through an explicit normalization.");
}

/**
 * THE DENOMINATOR GUARD (owner ruling G2, 2026-09-20; AC3).
 *
 * LoadProbe's optional-work allowance is
 *   min(max(1, renderedFrames) * optionalCpuMsPerRenderedFrame,
 *       optionalCpuMsPerWindow)
 * and `renderedFrames` counts ONLY captured events carrying
 * `renderedFrame: true` (LoadProbe.ts:364). Under Spark the sole production
 * feeder was the adapter's pager_snapshot; §G deletes the adapter, so an
 * unfed replacement would pin the denominator at max(1, 0) and the ladder
 * would quietly throttle itself to a permanent one-frame window while still
 * emitting entirely plausible budget numbers.
 *
 * Reading the counter directly is not possible — it is a closure local, and
 * exporting it would only prove that the export works. So this asserts the
 * denominator through its ONLY observable consequence, twice over: the same
 * optional CPU cost, fed to two identical probes, must overrun the budget
 * when the frames are NOT declared and stay within it when they ARE. A
 * regression that stops feeding `renderedFrame` collapses the second run
 * onto the first and this goes red.
 */
function assertBudgetDenominatorAdvances(): SelfTestAssertion {
  // Each optional observation is made to cost COST_MS of measured time by
  // advancing the fake clock INSIDE readSnapshot — which is where LoadProbe
  // measures it (`start` is taken after the stride check, and readSnapshot
  // is the first call in the try). Charging the event payload instead would
  // land in capture()'s mandatory window and never touch this budget.
  //
  // With COST_MS < PER_FRAME_MS the two runs separate cleanly:
  //   unfed  allowance = max(1, 0) * 10 = 10 ms fixed, cost = 6k  -> overruns at k = 2
  //   fed    allowance = k * 10 ms,                   cost = 6k  -> never overruns
  // The inequality is strict in both directions, so neither outcome is an
  // accident of rounding.
  const COST_MS = 6;
  const PER_FRAME_MS = 10;
  const FRAMES = 8;

  const run = (declareRenderedFrames: boolean): number => {
    let clockMs = 0;
    const costingNetworkSource = (): NetworkSource => ({
      capabilities: ["denominator_probe"],
      declaredGaps: [],
      attach: () => ({ dispose() {} }),
      readSnapshot: () => {
        clockMs += COST_MS;
        return {
          adapterStatus: "valid",
          requiredReadingsValid: true,
          workingSetStable: true,
          relevantOutstanding: false,
          recentContradictoryEvent: false,
          qualifyingProgress: false,
          value: { denominatorProbe: true },
        };
      },
      dispose() {},
    });
    const attached = attach({
      ...registration(`denominator-${declareRenderedFrames ? "fed" : "unfed"}`),
      samplingPolicy: {
        version: "self-test-denominator",
        values: { optionalCpuMsPerRenderedFrame: PER_FRAME_MS, optionalCpuMsPerWindow: 10_000 },
      },
      networkSourceFactory: costingNetworkSource,
      now: () => clockMs,
      loadId: `self-test-denominator-${declareRenderedFrames}`,
    });
    if (!("status" in attached)) throw new Error("denominator probe failed to attach");
    const control = getLoadProbeControl(attached as LiveLoadProbeHandle);
    if (!control) throw new Error("denominator probe control unavailable");
    for (let index = 0; index < FRAMES; index += 1) {
      control.capture({
        type: "pager_snapshot",
        source: "pager",
        eventTimeMs: clockMs,
        ...(declareRenderedFrames ? { renderedFrame: true } : {}),
        payload: { residentPageIds: [], requestCount: index, residentSplats: index },
      });
      clockMs += 1;
    }
    const final = control.finalize("converged");
    return (final?.evidence.rawEvents ?? []).filter((raw) => raw.type === "budget_action").length;
  };

  const unfedActions = run(false);
  const fedActions = run(true);
  const actual = {
    unfedOverrunsBudget: unfedActions > 0,
    fedStaysWithinBudget: fedActions === 0,
    denominatorChangesOutcome: unfedActions !== fedActions,
  };
  const expected = {
    unfedOverrunsBudget: true,
    fedStaysWithinBudget: true,
    denominatorChangesOutcome: true,
  };
  return compared("budget-denominator-advances",
    "rendered-frame denominator is fed, not pinned at one frame", expected, actual,
    "Observed through the ladder because the counter itself is a closure local: identical optional cost, "
    + "overrunning when frames are undeclared and within budget when they are declared.");
}

function assertWeightedGap(): SelfTestAssertion {
  const observer = new ConvergenceObserver();
  const qualifying = (eventTimeMs: number) => ({
    eventTimeMs,
    foregroundVisible: true,
    stableCameraEpoch: true,
    adapterValid: true,
    requiredReadingsValid: true,
    workingSetStable: true,
    relevantOutstanding: false,
    recentContradictoryEvent: false,
    coarsePageLikelihood: 0,
    coarsePageThreshold: 0.1,
    validatedVisibleCoarseness: false,
    qualifyingProgress: false,
  });
  observer.observe(qualifying(0));
  const at500 = observer.observe(qualifying(500));
  const at1250 = observer.observe(qualifying(1_250));
  const actual = {
    weights: [weightedDelta(0, 500), weightedDelta(500, 1_250)],
    totalWeight: weightedDelta(0, 500) + weightedDelta(500, 1_250),
    dwellAt500: at500.candidateDwellMs,
    gapBrokeDwell: at1250.gapBrokeDwell,
    dwellAfter750Gap: at1250.candidateDwellMs,
  };
  const expected = { weights: [500, 500], totalWeight: 1_000, dwellAt500: 500, gapBrokeDwell: true, dwellAfter750Gap: 0 };
  return compared("weighted-gap", "min(gap,500) aggregation with separate dwell reset", expected, actual);
}

function assertLaggardMapper(): SelfTestAssertion {
  const mapper = new LaggardMapper();
  const page: SpatialPageEvidence = {
    canonicalPageId: "page-0",
    pageLevel: 0,
    maxLevel: 2,
    resident: true,
    renderEligibilityObservable: true,
    renderEligible: true,
    worldBounds: { min: [-0.5, -0.5, -0.2], max: [0.5, 0.5, 0.05] },
    replacementAmbiguity: 0,
    occlusionEvidence: 1,
    confidence: 1,
  };
  const base = spatialObservation([page], 500);
  const near = mapper.map([base]);
  const zeroLevel = mapper.map([{ ...base, pages: [{ ...page, maxLevel: 0 }] }]);
  const zeroDuration = mapper.map([{ ...base, weightedDeltaMs: 0 }]);
  const actual = {
    grid: [near.gridColumns, near.gridRows],
    nearPlaneGeometryClippedAndProjected: near.cells.length > 0,
    maxLevelZeroCells: zeroLevel.cells.length,
    maxLevelZeroInsufficient: zeroLevel.insufficientSpatialEvidence,
    zeroDurationCells: zeroDuration.cells.length,
    zeroDurationInsufficient: zeroDuration.insufficientSpatialEvidence,
  };
  const expected = {
    grid: [32, 18],
    nearPlaneGeometryClippedAndProjected: true,
    maxLevelZeroCells: 0,
    maxLevelZeroInsufficient: true,
    zeroDurationCells: 0,
    zeroDurationInsufficient: true,
  };
  return compared("laggard-mapper", "near clipping and insufficient spatial fixtures", expected, actual);
}

function assertNetworkAmbiguity(): SelfTestAssertion {
  const target = "https://telemetry-fixture.invalid/lab.rad";
  let callback: PerformanceObserverCallback | undefined;
  const fakeObserver = {
    observe(): void {},
    disconnect(): void {},
    takeRecords(): PerformanceEntryList { return []; },
  } as PerformanceObserver;
  const fakePerformance = {
    timeOrigin: 1_000,
    now: () => 25,
    addEventListener(): void {},
    removeEventListener(): void {},
  } as unknown as Performance;
  const observer = new NetworkObserver({
    resourceUrl: target,
    performance: fakePerformance,
    observerFactory: (receiver) => {
      callback = receiver;
      return fakeObserver;
    },
  });
  const events: CapturedProbeEvent[] = [];
  observer.registerRequestKey({ requestId: "r1", resourceName: target, resourceStartTimeMs: 10 });
  observer.registerRequestKey({ requestId: "r2", resourceName: target, resourceStartTimeMs: 10 });
  observer.attach((event) => events.push(event as CapturedProbeEvent));
  const entries = [resourceTiming(target, 10, true), resourceTiming(target, 10, false)];
  const list = { getEntries: () => entries } as unknown as PerformanceObserverEntryList;
  callback?.(list, fakeObserver);
  const snapshot = observer.readSnapshot(30);
  const timingEvents = events.filter((event) => event.type === "resource_timing");
  const taoEvents = events.flatMap((event) => event.type === "tao_status" ? [event.payload.status] : []);
  const actual = {
    ambiguousEntryCount: events.filter((event) => event.type === "resource_ambiguity").length,
    linkedRequestIds: timingEvents.flatMap((event) => event.type === "resource_timing" && event.payload.requestId ? [event.payload.requestId] : []),
    taoAvailable: taoEvents,
    pageOrRangeOwnersAdded: timingEvents.some((event) => event.type === "resource_timing" && "pageId" in event.payload),
    snapshotTaoAll: isRecord(snapshot?.value) ? snapshot.value.taoAvailable : undefined,
  };
  const expected = {
    ambiguousEntryCount: 2,
    linkedRequestIds: [],
    taoAvailable: ["allowed", "blocked"],
    pageOrRangeOwnersAdded: false,
    snapshotTaoAll: false,
  };
  observer.dispose();
  return compared("network-ambiguity", "ambiguous resource timing with and without TAO stays unlinked", expected, actual,
    "NetworkObserver exposes matches through captured events/readSnapshot; the earlier plan name takeMatches is not an installed method.");
}

function assertUtf8Boundary(): SelfTestAssertion {
  const recordId = "utf8-record";
  const sceneId = "utf8-scene";
  const record = makeRecord(recordId, sceneId);
  const cap = 4 * 1024 * 1024;
  const emptyEvent = makeEvent(recordId, sceneId, 1, "error", { name: "Padding", message: "", operation: "boundary" });
  const baseBytes = rawContainerBytes([emptyEvent]);
  const paddingBytes = cap - baseBytes;
  const exactEvent = makeEvent(recordId, sceneId, 1, "error", { name: "Padding", message: "x".repeat(paddingBytes), operation: "boundary" });
  const exactCandidateBytes = rawContainerBytes([exactEvent]);
  const exactAppend = record.append(exactEvent);
  const atCap = record.snapshot();
  const oneByte = new TextEncoder().encode("x").byteLength;
  const nextAppend = record.append(makeEvent(recordId, sceneId, 2, "user_interaction", { kind: "x" }));
  const after = record.snapshot();
  const actual = {
    exactCandidateBytes,
    exactCapAppended: exactAppend.appended,
    exactRawBytes: atCap.caps.currentRawBytes,
    oneBytePayloadBytes: oneByte,
    nextCompactedOrDroppedBeforeInsertion: after.evidence.compactedSegments.length + after.evidence.droppedEvents.length > 0,
    boundaryMarkerCount: after.evidence.compactedSegments.length + after.evidence.droppedEvents.length,
    nextAppendAccounted: nextAppend.appended || nextAppend.reason !== undefined,
    rawWithinCap: after.caps.currentRawBytes <= DEFAULT_RECORD_CAP_POLICY.rawBytes,
    totalWithinCap: after.caps.currentTotalBytes <= DEFAULT_RECORD_CAP_POLICY.totalBytes,
  };
  const expected = {
    exactCandidateBytes: cap,
    exactCapAppended: true,
    exactRawBytes: cap,
    oneBytePayloadBytes: 1,
    nextCompactedOrDroppedBeforeInsertion: true,
    boundaryMarkerCount: 1,
    nextAppendAccounted: true,
    rawWithinCap: true,
    totalWithinCap: true,
  };
  return compared("utf8-boundary", "pre-append 4 MiB UTF-8 cap", expected, actual);
}

async function assertSinkFanout(): Promise<SelfTestAssertion> {
  const source = makeRevision("fanout-record", 7, true);
  const failures: SinkFailureStatus[] = [];
  const survivorRevisions: number[] = [];
  const rejecting = sink("rejecter", () => { throw new Error("injected rejection"); });
  const timeout = sink("timeout", () => new Promise<void>(() => undefined));
  const survivor = sink("survivor", (record) => { survivorRevisions.push(record.identity.revisionId); });
  const fanout = createTelemetryFanout([rejecting, timeout, survivor], {
    deadlineMs: 5,
    statusRevision: (failure) => {
      failures.push(failure as SinkFailureStatus);
      return makeRevision(source.identity.recordId, 8 + failures.length, true);
    },
  });
  let rejected = false;
  try { await fanout.onRecord(source); } catch { rejected = true; }
  const actual = {
    settlements: failures.map((failure) => ({ sinkName: failure.sinkName, reason: failure.reason })),
    survivorReceivedSourceRevision: survivorRevisions.includes(7),
    survivorStatusRevisionCount: survivorRevisions.filter((revision) => revision > 7).length,
    probePromiseRejected: rejected,
  };
  const expected = {
    settlements: [{ sinkName: "rejecter", reason: "rejection" }, { sinkName: "timeout", reason: "timeout" }],
    survivorReceivedSourceRevision: true,
    survivorStatusRevisionCount: 2,
    probePromiseRejected: false,
  };
  return compared("sink-fanout", "rejection and timeout settlements preserve survivor delivery", expected, actual);
}

async function assertStoreBounds(): Promise<SelfTestAssertion> {
  let clock = 0;
  const persistentBoundStore = createStoreSink({
    ephemeralMeasurementConsent: "granted",
    localPersistenceConsent: "granted",
    indexedDB: null,
    now: () => ++clock,
    policy: { ...DEFAULT_STORAGE_POLICY, memoryFallbackMaxRecords: 50, memoryFallbackMaxBytes: 25 * 1024 * 1024 } as unknown as typeof DEFAULT_STORAGE_POLICY,
  });
  for (let index = 0; index < 51; index += 1) await persistentBoundStore.onRecord(makeRevision(`persistent-${index}`, 1, true));
  await persistentBoundStore.onRecord(makeRevision("persistent-50", 2, true));
  const persistentRecords = await persistentBoundStore.exportRecords();

  const fallbackStore = createStoreSink({
    ephemeralMeasurementConsent: "granted",
    localPersistenceConsent: "denied",
    indexedDB: null,
    now: () => ++clock,
  });
  for (let index = 0; index < 6; index += 1) await fallbackStore.onRecord(makeRevision(`fallback-${index}`, 1, true));
  await fallbackStore.onRecord(makeRevision("fallback-5", 2, true));
  const fallbackRecords = await fallbackStore.exportRecords();
  const persistentBytes = encodedBytes(persistentRecords);
  const fallbackBytes = encodedBytes(fallbackRecords);
  const persistentCurrent = persistentRecords.find((record) => record.identity.recordId === "persistent-50");
  const fallbackCurrent = fallbackRecords.find((record) => record.identity.recordId === "fallback-5");
  const persistentLastStatus = persistentCurrent?.status.sinkHistory[persistentCurrent.status.sinkHistory.length - 1];
  const fallbackLastStatus = fallbackCurrent?.status.sinkHistory[fallbackCurrent.status.sinkHistory.length - 1];
  // The pin's `storageDenialSignal` key is GONE with faultInjector (ticket
  // 12, B1): the "storage_denial" fault's whole body pushed the string
  // "storage_denial:memory_fallback" into an array, and this assertion
  // compared that array to the same literal — a tautology that could not go
  // red. The real claim it gestured at, "a denied store falls back to
  // memory", is asserted below for real by `deniedFallbackTier`, which
  // reads the live store's own capabilities.
  const actual = {
    persistentRecordCount: persistentRecords.length,
    persistentBytesWithin25MiB: persistentBytes <= 25 * 1024 * 1024,
    fallbackRecordCount: fallbackRecords.length,
    fallbackBytesWithin5MiB: fallbackBytes <= 5 * 1024 * 1024,
    persistentUpsertRevision: persistentCurrent?.identity.revisionId,
    fallbackUpsertRevision: fallbackCurrent?.identity.revisionId,
    persistentEvictionStatus: persistentLastStatus?.status,
    fallbackEvictionStatus: fallbackLastStatus?.status,
    persistenceFallbackTier: persistentBoundStore.capabilities().fallbackTier,
    deniedFallbackTier: fallbackStore.capabilities().fallbackTier,
  };
  const expected = {
    persistentRecordCount: 50,
    persistentBytesWithin25MiB: true,
    fallbackRecordCount: 5,
    fallbackBytesWithin5MiB: true,
    persistentUpsertRevision: 2,
    fallbackUpsertRevision: 2,
    persistentEvictionStatus: "evicted_complete_oldest",
    fallbackEvictionStatus: "evicted_complete_oldest",
    persistenceFallbackTier: "memory",
    deniedFallbackTier: "memory",
  };
  return compared("store-bounds", "storage denial, upsert, oldest-complete eviction, and both bounds", expected, actual);
}

function assertBeaconCases(): SelfTestAssertion {
  let endpointOnlySends = 0;
  let deniedSends = 0;
  const endpointOnly = createBeaconSink(undefined, true, { sendBeacon: () => { endpointOnlySends += 1; return true; } });
  const denied = createBeaconSink("https://telemetry.invalid/collect", false, { sendBeacon: () => { deniedSends += 1; return true; } });
  const source = makeRevision("beacon-record", 1, false, "x".repeat(80_000));
  endpointOnly.onRecord(source);
  denied.onRecord(source);
  const oversized = createBeaconSink("https://telemetry.invalid/collect", true, { asyncTransport: async () => false });
  oversized.onRecord(source);
  const pending = oversized.exportPending();
  const persisted = createBeaconSink("https://telemetry.invalid/collect", true, {
    sendBeacon: () => false,
    asyncTransport: async () => false,
  });
  persisted.onPageHide({ recordId: source.identity.recordId, revisionId: source.identity.revisionId, eventTimeMs: 10, persisted: true, record: source });
  const persistedPending = persisted.exportPending();
  const persistedEnvelope = persistedPending[persistedPending.length - 1];
  const actual = {
    endpointOnlySendCount: endpointOnlySends,
    deniedRemoteSendCount: deniedSends,
    envelopeCountPositive: pending.length > 0,
    envelopesStrictlyBelow49152: pending.every((envelope) => encodedBytes(envelope) < 49_152),
    persistedLifecycle: persistedEnvelope?.lifecycle,
    reconciledSameRecord: persistedEnvelope?.recordId === source.identity.recordId,
  };
  const expected = {
    endpointOnlySendCount: 0,
    deniedRemoteSendCount: 0,
    envelopeCountPositive: true,
    envelopesStrictlyBelow49152: true,
    persistedLifecycle: { persisted: true, outcome: "suspended" },
    reconciledSameRecord: true,
  };
  return compared("beacon-cases", "endpoint/consent gates, strict envelopes, and persisted suspension", expected, actual);
}

function assertPrivacy(): SelfTestAssertion {
  const stripped = stripSceneUrl("https://example.invalid/scene.rad?token=secret#fragment");
  const sceneId = sanitizeSceneId(`${"illegal scene id!".repeat(8)}${"x".repeat(80)}`);
  const rawGpu = "NVIDIA GeForce RTX SECRET RAW STRING";
  const gpu = bucketGpu("NVIDIA", rawGpu, "high");
  const record = makeRevision("privacy-record", 1, true, undefined, {
    gpuBucket: JSON.stringify(gpu),
    rendererClass: gpu.rendererClass,
  });
  const serialized = JSON.stringify(record);
  const actual = {
    queryAbsent: !stripped.includes("?"),
    fragmentAbsent: !stripped.includes("#"),
    sceneIdAllowed: /^[A-Za-z0-9._-]+$/.test(sceneId),
    sceneIdLength: sceneId.length,
    rawGpuAbsent: !serialized.includes(rawGpu),
    gpuBucketFields: Object.keys(gpu).sort(),
  };
  const expected = {
    queryAbsent: true,
    fragmentAbsent: true,
    sceneIdAllowed: true,
    sceneIdLength: 64,
    rawGpuAbsent: true,
    gpuBucketFields: ["capabilityTier", "rendererClass", "vendorClass"],
  };
  return compared("privacy", "URL, scene ID, and GPU serialization privacy", expected, actual);
}

function assertConstructionFreeConsent(): SelfTestAssertion {
  const calls = { adapter: 0, id: 0, record: 0, queue: 0, sink: 0 };
  const throwingFactory = (name: keyof typeof calls) => (): never => {
    calls[name] += 1;
    throw new Error(`${name} factory must not run before consent`);
  };
  const guarded = (consent: "pending" | "denied"): AttachOptions => ({
    consent,
    adapterFactory: throwingFactory("adapter"),
    idFactory: throwingFactory("id"),
    recordFactory: throwingFactory("record"),
    queueFactory: throwingFactory("queue"),
    consentHook: throwingFactory("adapter"),
    cameraProviderFactory: throwingFactory("adapter"),
    networkSourceFactory: throwingFactory("adapter"),
    spatialMapperFactory: throwingFactory("adapter"),
    sinkFactories: { ephemeral: [throwingFactory("sink")] },
  }) as unknown as AttachOptions;
  const pending = attach(guarded("pending"));
  const denied = attach(guarded("denied"));
  const actual = {
    pendingIdentity: pending === PENDING_STATUS,
    deniedIdentity: denied === DENIED_STATUS,
    pendingFrozen: Object.isFrozen(pending),
    deniedFrozen: Object.isFrozen(denied),
    attached: [(pending as { attached: boolean }).attached, (denied as { attached: boolean }).attached],
    factoryCalls: calls,
    artifactsConstructed: Object.values(calls).reduce((sum, value) => sum + value, 0),
  };
  const expected = {
    pendingIdentity: true,
    deniedIdentity: true,
    pendingFrozen: true,
    deniedFrozen: true,
    attached: [false, false],
    factoryCalls: { adapter: 0, id: 0, record: 0, queue: 0, sink: 0 },
    artifactsConstructed: 0,
  };
  return compared("consent-zero-construction", "pending and denied attach return static identities without construction", expected, actual);
}

async function assertDeferredPhase7(options: Readonly<SelfTestOptions>): Promise<SelfTestAssertion> {
  if (options.phase7AcceptanceEnabled !== true) {
    return deferred("phase7-runtime-consent", "SiteRuntime pending/denied zero-construction acceptance",
      "DEFERRED — Phase 7 acceptance; disabled by phase7AcceptanceEnabled=false");
  }
  if (!options.phase7RuntimeEvaluator) {
    return failed("phase7-runtime-consent", "SiteRuntime pending/denied zero-construction acceptance", "injected Phase 7 evaluator", null,
      "The acceptance flag was enabled without a Phase 7 runtime evaluator.");
  }
  const comparison = await options.phase7RuntimeEvaluator();
  return compared("phase7-runtime-consent", "SiteRuntime pending/denied zero-construction acceptance", comparison.expected, comparison.actual);
}

function assertCoordinator(): SelfTestAssertion {
  const coordinator = new LoadCoordinator();
  coordinator.registerScene(registration("coordinator-a"));
  coordinator.registerScene(registration("coordinator-b"));
  coordinator.markSceneFirstSplatReady("coordinator-a", 1, 10);
  coordinator.markSceneFirstSplatReady("coordinator-b", 2, 11);
  coordinator.markAllScenesVisible(12);
  coordinator.markAllScenesVisible(13);
  const first = coordinator.finalizeAll("converged");
  const second = coordinator.finalizeAll("converged");
  const allEvents = first.flatMap((revision) => revision.evidence.rawEvents);
  const actual = {
    recordCount: first.length,
    sharedLoadIds: new Set(first.map((revision) => revision.identity.loadId)).size,
    distinctRecordIds: new Set(first.map((revision) => revision.identity.recordId)).size,
    firstSplatEvents: allEvents.filter((event) => event.type === "scene_first_splat_ready").length,
    coordinatorRevealSignals: new Set(allEvents.filter((event) => event.type === "coordinator_overlay_reveal").map((event) => event.eventTimeMs)).size,
    perSceneRevealEvents: allEvents.filter((event) => event.type === "coordinator_overlay_reveal").length,
    repeatedFinalizationSame: deepEqual(first.map(revisionIdentity), second.map(revisionIdentity)),
    currentRevisionsPerScene: first.every((revision) => second.filter((candidate) => candidate.identity.recordId === revision.identity.recordId
      && candidate.identity.revisionId === revision.identity.revisionId).length === 1),
  };
  const expected = {
    recordCount: 2,
    sharedLoadIds: 1,
    distinctRecordIds: 2,
    firstSplatEvents: 2,
    coordinatorRevealSignals: 1,
    perSceneRevealEvents: 2,
    repeatedFinalizationSame: true,
    currentRevisionsPerScene: true,
  };
  return compared("coordinator", "two-scene shared load and idempotent finalization", expected, actual);
}

function compared(id: string, label: string, expected: unknown, actual: unknown, detail?: string): SelfTestAssertion {
  return Object.freeze({ id, label, status: deepEqual(expected, actual) ? "pass" : "fail", expected, actual, ...(detail ? { detail } : {}) });
}

function failed(id: string, label: string, expected: unknown, actual: unknown, detail?: string): SelfTestAssertion {
  return Object.freeze({ id, label, status: "fail", expected, actual, ...(detail ? { detail } : {}) });
}

function skipped(id: string, label: string, detail: string): SelfTestAssertion {
  return Object.freeze({ id, label, status: "skipped", expected: "captured fixture", actual: "missing", detail });
}

function deferred(id: string, label: string, detail: string): SelfTestAssertion {
  return Object.freeze({ id, label, status: "deferred", expected: "Phase 7 evaluator enabled", actual: "disabled", detail });
}

function machineLine(assertion: Readonly<SelfTestAssertion>): string {
  return `SELF-TEST ${assertion.id} ${assertion.status.toUpperCase()} expected=${stableStringify(assertion.expected)} actual=${stableStringify(assertion.actual)}`;
}

function createProbeHarness(
  sceneId: string,
  sampling?: Readonly<{ optionalCpuMsPerRenderedFrame: number; optionalCpuMsPerWindow: number }>,
  fakeClock?: () => number,
): { readonly handle: LiveLoadProbeHandle; readonly control: LoadProbeControl } {
  const result = attach({
    ...registration(sceneId),
    ...(sampling ? { samplingPolicy: { version: "self-test-budget", values: sampling } } : {}),
    ...(fakeClock ? { now: fakeClock } : {}),
    loadId: `self-test-${sceneId}`,
  });
  if (!("status" in result)) throw new Error(`Failed to attach self-test probe: ${result.consent}`);
  const handle = result as LiveLoadProbeHandle;
  const control = getLoadProbeControl(handle);
  if (!control) throw new Error("Self-test probe control is unavailable");
  return { handle, control };
}

function registration(sceneId: string): Omit<AffirmativeAttachOptions, "loadId"> {
  return {
    consent: "granted",
    consentHook: () => ({ ephemeralMeasurement: "granted", localPersistence: "denied", remoteTransmission: "denied" }),
    scene: {},
    mesh: {},
    metadata: metadata(sceneId),
    sinkFactories: {},
    cameraProviderFactory: () => ({ readCameraState: () => cameraState(0) }),
    networkSourceFactory: () => fakeNetworkSource(),
    spatialMapperFactory: () => fakeSpatialMapper(),
  };
}

function metadata(sceneId: string): AffirmativeAttachOptions["metadata"] {
  return {
    sceneId,
    serverVersion: null,
    radFormatVersion: null,
    topologyFingerprint: null,
    adapterStatus: "valid",
    statusReasons: [],
    declaredGaps: [],
    capabilityFlags: ["self_test"],
    environment: defaultEnvironment(),
    versions: { engineVersion: "self-test-engine", toolkitVersion: "0.1.0" },
    revealPolicyObserved: { mode: "self_test" },
    featureFlags: ["self_test"],
    wallClockBucket: null,
    clockQuality: "monotonic",
  };
}

function fakeNetworkSource(): NetworkSource {
  return {
    capabilities: ["fake_network"],
    declaredGaps: [],
    attach: () => ({ dispose() {} }),
    readSnapshot: () => ({
      adapterStatus: "valid",
      requiredReadingsValid: true,
      workingSetStable: true,
      relevantOutstanding: false,
      recentContradictoryEvent: false,
      qualifyingProgress: false,
      value: { fake: true },
    }),
    dispose() {},
  };
}

function fakeSpatialMapper(): SpatialMapper {
  return {
    capabilities: ["fake_spatial"],
    declaredGaps: [],
    observe: () => ({
      coarsePageLikelihood: 0,
      coarsePageThreshold: 0.1,
      validatedVisibleCoarseness: false,
      requiredReadingsValid: true,
      value: { fake: true },
    }),
    dispose() {},
  };
}

function makeRecord(recordId: string, sceneId: string): LoadRecord {
  return new LoadRecord(recordInit(recordId, sceneId));
}

function recordInit(recordId: string, sceneId: string): LoadRecordInit {
  return {
    identity: { recordId, loadId: "self-test-load", sceneId, serverVersion: null, radFormatVersion: null, topologyFingerprint: null },
    versioning: { probeVersion: "self-test", engineVersion: "self-test-engine", toolkitVersion: "0.1.0" },
    policy: { convergencePolicy: {}, samplingPolicy: {}, revealPolicyObserved: null, featureFlags: [], capabilityFlags: [] },
    status: { probeStatus: "valid", reasons: [], declaredGaps: [], sinkHistory: [] },
    environment: defaultEnvironment(),
    timing: { monotonicTimeOriginMs: 0, wallClockBucket: null, clockQuality: "self-test", elapsedDurationMs: 0, foregroundVisibleDurationMs: 0, nonComparableSpans: [] },
  };
}

function makeRevision(
  recordId: string,
  revisionId: number,
  finalized: boolean,
  padding?: string,
  environmentOverrides: Partial<LoadRecordRevision["environment"]> = {},
): Readonly<LoadRecordRevision> {
  const record = makeRecord(recordId, `scene-${recordId}`);
  if (padding !== undefined) record.append(makeEvent(recordId, `scene-${recordId}`, 1, "error", { name: "Padding", message: padding }));
  let revision = finalized ? record.finalize("converged") : record.checkpoint();
  revision = {
    ...revision,
    identity: { ...revision.identity, revisionId },
    environment: { ...revision.environment, ...environmentOverrides },
  };
  return JSON.parse(JSON.stringify(revision)) as Readonly<LoadRecordRevision>;
}

function makeEvent<K extends RawEvent["type"]>(
  recordId: string,
  sceneId: string,
  sequence: number,
  type: K,
  payload: Extract<RawEvent, { type: K }>["payload"],
): RawEvent {
  return {
    eventId: `${recordId}:${sequence}`,
    sequence,
    eventTimeMs: sequence,
    type,
    source: "probe",
    recordId,
    sceneId,
    adapterStatus: "valid",
    visibilityPhase: "foreground_visible",
    capabilityFlags: [],
    declaredGaps: [],
    payload,
  } as RawEvent;
}

function defaultEnvironment(): LoadRecordInit["environment"] {
  return {
    browserBucket: "self-test",
    osClass: "self-test",
    gpuBucket: "self-test",
    viewportBucket: "self-test",
    dprBucket: "self-test",
    connectionBucket: "self-test",
    deviceMemoryBucket: "self-test",
    logicalCoreBucket: "self-test",
    rendererClass: "self-test",
  };
}

function cameraState(x: number): CameraState {
  return {
    position: [x, 0, 10],
    quaternion: [0, 0, 0, 1],
    projectionMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    verticalFovDegrees: 60,
    viewportWidthCssPx: 1_000,
    viewportHeightCssPx: 600,
    dpr: 1,
    foveation: {},
    pivot: [0, 0, 0],
  };
}

function spatialObservation(pages: readonly SpatialPageEvidence[], weightedDeltaMs: number): SpatialEvidenceObservation {
  return {
    eventTimeMs: 500,
    weightedDeltaMs,
    pages,
    camera: cameraState(0),
    viewMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    nearPlane: 0.1,
    topologyFingerprint: "self-test-topology",
  };
}

function resourceTiming(name: string, startTime: number, tao: boolean): PerformanceResourceTiming {
  return {
    name,
    entryType: "resource",
    startTime,
    duration: 5,
    responseStart: tao ? startTime + 1 : 0,
    transferSize: tao ? 100 : 0,
    encodedBodySize: tao ? 80 : 0,
    decodedBodySize: tao ? 80 : 0,
  } as PerformanceResourceTiming;
}

function sink(name: string, onRecord: TelemetrySink["onRecord"]): TelemetrySink {
  const capabilities: SinkCapabilities = {
    available: true,
    consent: "not_required",
    persistence: "unavailable",
    partitioned: false,
    quota: "unknown",
    lastSuccessMs: null,
    lastFailureMs: null,
    fallbackTier: null,
    status: "self-test",
  };
  return { name, capabilities: () => capabilities, onRecord, onPageHide() {} };
}

function revisionIdentity(revision: Readonly<LoadRecordRevision>): readonly [string, number] {
  return [revision.identity.recordId, revision.identity.revisionId];
}

function rawContainerBytes(events: readonly RawEvent[]): number {
  return encodedBytes({ rawEvents: events, compactedSegments: [], droppedEvents: [] });
}

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function strictlyIncreasing(values: readonly number[]): boolean {
  return values.every((value, index) => index === 0 || value > values[index - 1]);
}

function deepEqual(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
