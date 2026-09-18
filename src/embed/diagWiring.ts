/**
 * Load-telemetry wiring (Phase 7) — the runtime's ONLY diagnostics import
 * boundary. SiteRuntime imports `wireLoadTelemetry` through the stable
 * `@embed/diagWiring` alias; the measurement build swaps this module for
 * `diagWiring.stub.ts` at config time so Rollup statically eliminates the
 * whole diagnostics graph (see vite.config.ts TELEMETRY_MEASURE).
 *
 * Ordering rule proven in Phase 0b/6: `mesh.paged.pager` exists only after
 * the first render tick, which also starts fetching — so scene registration
 * polls for the pager and the adapter attaches mid-load against its
 * pre-attach baseline. Consent gates everything: pending/denied construct
 * nothing beyond the coordinator-free static status inside the probe.
 *
 * The pager-source composite here intentionally mirrors the sandbox copy in
 * examples/loadtest/main.ts (recorded follow-up: consolidate once Phase 7
 * settles — the sandbox exercises its own copy by design today).
 */

import type { SplatHandle as SplatMesh } from "../backend/SplatBackend";
import {
  attachSparkPagerAdapter,
  type AdapterSnapshot,
  type SparkPagerAdapterEvent,
  type SparkPagerAdapterHandle,
} from "../diag/SparkPagerAdapter";
import { LaggardMapper, type SpatialPageEvidence } from "../diag/LaggardMapper";
import {
  type AffirmativeAttachOptions,
  type CapturedProbeEvent,
  type ConsentDecisions,
  type DisposableSource,
  type NetworkSnapshot,
  type NetworkSource,
  type ProbeSceneMetadata,
} from "../diag/LoadProbe";
import { LoadCoordinator } from "../diag/LoadCoordinator";
import { NetworkObserver } from "../diag/NetworkObserver";
import type { JsonValue } from "../diag/events";
import { createConsoleReportSink } from "../diag/sinkConsole";
import { createStoreSink } from "../diag/sinkStore";
import { createBeaconSink } from "../diag/sinkBeacon";
import {
  bucketConnection,
  bucketDeviceMemory,
  bucketDpr,
  bucketGpu,
  bucketLogicalCores,
  bucketViewport,
  sanitizeSceneId,
  stripSceneUrl,
} from "../diag/privacy";
import { DEFAULT_PRIVACY_POLICY } from "../diag/policies";
import { LOAD_RECORD_SEMANTICS_VERSION } from "../diag/LoadRecord";

/** Measurement marker — build B (TELEMETRY_MEASURE=off) must not contain it. */
export const LOAD_TELEMETRY_MARKER = `loadTelemetry:semanticsVersion:${LOAD_RECORD_SEMANTICS_VERSION}` as const;

export interface SiteTelemetryOptions {
  /** Only `false` disables; absent/true means on (spec §2 decision 1). */
  readonly telemetry?: boolean;
  readonly telemetryEndpoint?: string;
  /** Host consent hook; default first-party policy grants ephemeral+local, denies remote. */
  readonly consentHook?: () => Readonly<ConsentDecisions>;
  readonly policies?: Pick<
    AffirmativeAttachOptions,
    "convergencePolicy" | "cameraEpochPolicy" | "samplingPolicy" | "recordCapPolicy"
  >;
}

export interface TelemetryCameraSample {
  readonly position: readonly [number, number, number];
  readonly quaternion: readonly [number, number, number, number];
  readonly projectionMatrix: readonly number[];
  readonly verticalFovDegrees: number;
  readonly viewportWidthCssPx: number;
  readonly viewportHeightCssPx: number;
  readonly dpr: number;
  readonly foveation: Readonly<Record<string, number>>;
  readonly pivot: readonly [number, number, number];
}

export interface WireLoadTelemetryInput {
  readonly options: Readonly<SiteTelemetryOptions> | undefined;
  readonly authorMode: boolean;
  readonly readCameraState: () => Readonly<TelemetryCameraSample>;
}

export interface RegisterPagedSceneInput {
  readonly sceneId: string;
  readonly mesh: SplatMesh;
  readonly renderer: unknown;
  readonly sceneUrl: string;
}

export interface TelemetryWiringStatus {
  readonly attached: boolean;
  readonly consent: "granted" | "pending" | "denied" | "disabled" | "error";
}

export interface TelemetrySceneStatus {
  readonly sceneId: string;
  readonly adapterStatus: string;
  readonly reasons: readonly string[];
  readonly declaredGaps: readonly string[];
}

export interface LoadTelemetryHandle {
  /** Frozen wiring status — the spec's static capability status for
   *  disabled/pending/denied outcomes; DebugPanel's binding surface. */
  readonly status: Readonly<TelemetryWiringStatus>;
  registerPagedScene(input: Readonly<RegisterPagedSceneInput>): void;
  markSceneFirstSplatReady(sceneId: string, numSplats: number): void;
  markAllScenesVisible(): void;
  /** Call once per rendered frame; internally throttled. Never throws. */
  tick(): void;
  markInteraction(kind: string): void;
  /** Per-scene adapter status for the DebugPanel (empty when inert). */
  sceneStatuses(): readonly Readonly<TelemetrySceneStatus>[];
  /** Author-initiated export: checkpoint every scene and return the revisions. */
  exportRecords(): readonly unknown[];
  dispose(): void;
}

const SNAPSHOT_INTERVAL_MS = 100;
const PAGER_WAIT_INTERVAL_MS = 200;
const PAGER_WAIT_TIMEOUT_MS = 30_000;

const DEFAULT_CONSENT: Readonly<ConsentDecisions> = Object.freeze({
  ephemeralMeasurement: "granted",
  localPersistence: "granted",
  remoteTransmission: "denied",
});

/**
 * Wire load telemetry into a site runtime. Returns undefined when telemetry is
 * disabled or ephemeral consent is not affirmative — in both cases NOTHING is
 * constructed here. Never throws: a wiring failure degrades to "no telemetry",
 * never into the visitor path.
 */
export function wireLoadTelemetry(input: Readonly<WireLoadTelemetryInput>): LoadTelemetryHandle {
  try {
    const options = input.options;
    if (options?.telemetry === false) return inertHandle("disabled");
    const consentHook = options?.consentHook ?? (() => DEFAULT_CONSENT);
    let decisions: Readonly<ConsentDecisions>;
    try {
      decisions = consentHook();
    } catch {
      return inertHandle("error");
    }
    if (decisions.ephemeralMeasurement === "pending") return inertHandle("pending");
    if (decisions.ephemeralMeasurement !== "granted") return inertHandle("denied");
    return new SiteTelemetry(input, options, consentHook, decisions);
  } catch {
    return inertHandle("error");
  }
}

const NO_SCENE_STATUSES: readonly Readonly<TelemetrySceneStatus>[] = Object.freeze([]);
const NO_RECORDS: readonly unknown[] = Object.freeze([]);
const NOOP = (): void => { /* inert */ };

/** The zero-construction outcome: one frozen object, no adapter, no
 *  coordinator, no ID, no record, no queue, no sink, no DB, no beacon. */
function inertHandle(consent: Exclude<TelemetryWiringStatus["consent"], "granted">): LoadTelemetryHandle {
  return Object.freeze({
    status: Object.freeze({ attached: false, consent }),
    registerPagedScene: NOOP,
    markSceneFirstSplatReady: NOOP,
    markAllScenesVisible: NOOP,
    tick: NOOP,
    markInteraction: NOOP,
    sceneStatuses: () => NO_SCENE_STATUSES,
    exportRecords: () => NO_RECORDS,
    dispose: NOOP,
  });
}

interface RegisteredScene {
  readonly sceneId: string;
  source?: PagerNetworkSource;
  pendingFirstSplat?: number;
  cancelled: boolean;
}

class SiteTelemetry implements LoadTelemetryHandle {
  readonly status: Readonly<TelemetryWiringStatus> = Object.freeze({ attached: true, consent: "granted" });
  private readonly coordinator = new LoadCoordinator();
  private readonly scenes = new Map<string, RegisteredScene>();
  private readonly listeners: (() => void)[] = [];
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private lastTickMs = Number.NEGATIVE_INFINITY;
  private disposed = false;

  constructor(
    private readonly input: Readonly<WireLoadTelemetryInput>,
    private readonly options: Readonly<SiteTelemetryOptions> | undefined,
    private readonly consentHook: () => Readonly<ConsentDecisions>,
    private readonly decisions: Readonly<ConsentDecisions>,
  ) {
    const addListener = (target: EventTarget, name: string, handler: (event: Event) => void): void => {
      target.addEventListener(name, handler);
      this.listeners.push(() => target.removeEventListener(name, handler));
    };
    addListener(document, "visibilitychange", () => {
      this.forwardLifecycle({ type: "visibilitychange", eventTimeMs: performance.now(), visible: !document.hidden });
    });
    addListener(window, "pagehide", (event) => {
      const persisted = (event as PageTransitionEvent).persisted === true;
      this.forwardLifecycle({ type: "pagehide", eventTimeMs: performance.now(), persisted });
    });
    addListener(window, "pageshow", (event) => {
      const persisted = (event as PageTransitionEvent).persisted === true;
      this.forwardLifecycle({ type: "pageshow", eventTimeMs: performance.now(), persisted });
    });
  }

  registerPagedScene(sceneInput: Readonly<RegisterPagedSceneInput>): void {
    if (this.disposed) return;
    const sceneId = sanitizeSceneId(sceneInput.sceneId);
    if (this.scenes.has(sceneId)) return;
    const registered: RegisteredScene = { sceneId, cancelled: false };
    this.scenes.set(sceneId, registered);
    const startedAt = performance.now();
    const poll = (): void => {
      if (this.disposed || registered.cancelled) return;
      try {
        const paged = (sceneInput.mesh as unknown as { paged?: { pager?: unknown } }).paged;
        if (paged?.pager) {
          this.attachScene(registered, sceneInput);
          return;
        }
        if (performance.now() - startedAt > PAGER_WAIT_TIMEOUT_MS) return;
      } catch {
        return;
      }
      const timer = setTimeout(poll, PAGER_WAIT_INTERVAL_MS);
      this.timers.add(timer);
    };
    poll();
  }

  markSceneFirstSplatReady(sceneId: string, numSplats: number): void {
    if (this.disposed) return;
    const registered = this.scenes.get(sanitizeSceneId(sceneId));
    if (!registered) return;
    if (!registered.source) {
      // The pager (and probe) may attach after the first page streams in;
      // retain the readiness signal and replay it on attach.
      registered.pendingFirstSplat = numSplats;
      return;
    }
    this.coordinator.markSceneFirstSplatReady(sceneId, numSplats);
  }

  markAllScenesVisible(): void {
    if (this.disposed) return;
    this.coordinator.markAllScenesVisible(performance.now());
  }

  tick(): void {
    if (this.disposed) return;
    const atMs = performance.now();
    if (atMs - this.lastTickMs < SNAPSHOT_INTERVAL_MS) return;
    this.lastTickMs = atMs;
    for (const registered of this.scenes.values()) {
      try {
        registered.source?.tick(atMs);
      } catch {
        // Observation is never allowed to surface into the render loop.
      }
    }
  }

  markInteraction(kind: string): void {
    if (this.disposed) return;
    try {
      this.coordinator.checkpointAll(`interaction:${kind}`);
    } catch {
      // Observer-only.
    }
  }

  sceneStatuses(): readonly Readonly<TelemetrySceneStatus>[] {
    const statuses: Readonly<TelemetrySceneStatus>[] = [];
    for (const registered of this.scenes.values()) {
      const capabilities = registered.source?.adapter.capabilities;
      statuses.push(Object.freeze({
        sceneId: registered.sceneId,
        adapterStatus: capabilities?.probeStatus ?? "awaiting_pager",
        reasons: capabilities?.reasons ?? Object.freeze([]),
        declaredGaps: capabilities?.declaredGaps ?? Object.freeze([]),
      }));
    }
    return Object.freeze(statuses);
  }

  exportRecords(): readonly unknown[] {
    if (this.disposed) return NO_RECORDS;
    try {
      return this.coordinator.checkpointAll("author_export");
    } catch {
      return NO_RECORDS;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const registered of this.scenes.values()) {
      registered.cancelled = true;
      try { registered.source?.dispose(); } catch { /* isolated */ }
    }
    for (const remove of this.listeners.splice(0)) remove();
    this.coordinator.dispose();
  }

  private forwardLifecycle(event: Parameters<LoadCoordinator["handleLifecycleEvent"]>[0]): void {
    if (this.disposed) return;
    try {
      this.coordinator.handleLifecycleEvent(event);
    } catch {
      // Observer-only.
    }
  }

  private attachScene(registered: RegisteredScene, sceneInput: Readonly<RegisterPagedSceneInput>): void {
    const source = new PagerNetworkSource(sceneInput.mesh, sceneInput.renderer, sceneInput.sceneUrl, registered.sceneId);
    registered.source = source;
    const endpoint = this.options?.telemetryEndpoint;
    const authorMode = this.input.authorMode;
    const localGranted = this.decisions.localPersistence === "granted";
    const remoteGranted = this.decisions.remoteTransmission === "granted";
    const registration: Omit<AffirmativeAttachOptions, "loadId"> = {
      consent: "granted",
      consentHook: this.consentHook,
      ...(this.options?.telemetryEndpoint ? { telemetryEndpoint: this.options.telemetryEndpoint } : {}),
      scene: null,
      mesh: sceneInput.mesh,
      renderer: sceneInput.renderer,
      metadata: buildSceneMetadata(registered.sceneId, sceneInput.sceneUrl, source.adapter, this.input),
      sinkFactories: {
        ...(authorMode ? { ephemeral: [() => createConsoleReportSink({ development: true })] } : {}),
        ...(localGranted ? { local: [() => createStoreSink({ ephemeralMeasurementConsent: "granted", localPersistenceConsent: "granted" })] } : {}),
        ...(endpoint ? { remote: [() => createBeaconSink(endpoint, () => remoteGranted && this.consentHook().remoteTransmission === "granted")] } : {}),
      },
      cameraProviderFactory: () => ({ readCameraState: this.input.readCameraState }),
      networkSourceFactory: () => source,
      spatialMapperFactory: () => new LaggardMapper(),
      ...(this.options?.policies ?? {}),
    };
    const result = this.coordinator.registerScene(registration);
    if ("status" in result && registered.pendingFirstSplat !== undefined) {
      this.coordinator.markSceneFirstSplatReady(registered.sceneId, registered.pendingFirstSplat);
      registered.pendingFirstSplat = undefined;
    }
  }
}

function buildSceneMetadata(
  sceneId: string,
  sceneUrl: string,
  adapter: SparkPagerAdapterHandle,
  input: Readonly<WireLoadTelemetryInput>,
): Readonly<ProbeSceneMetadata> {
  const navigatorLike = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { effectiveType?: string };
  };
  const camera = safeCameraSample(input);
  const capabilities = adapter.capabilities;
  return {
    sceneId,
    sceneUrl: stripSceneUrl(sceneUrl, location.href),
    sceneUrlBase: location.origin,
    serverVersion: null,
    radFormatVersion: null,
    topologyFingerprint: capabilities.fingerprint ? JSON.stringify(capabilities.fingerprint) : null,
    adapterStatus: capabilities.probeStatus,
    statusReasons: capabilities.reasons,
    declaredGaps: capabilities.declaredGaps,
    capabilityFlags: Object.keys(capabilities.stages),
    environment: {
      browserBucket: browserFamilyBucket(navigator.userAgent),
      osClass: osClassBucket(navigator.userAgent),
      gpuBucket: JSON.stringify(bucketGpu(undefined, undefined, "unknown")),
      viewportBucket: JSON.stringify(bucketViewport(camera?.viewportWidthCssPx ?? innerWidth, camera?.viewportHeightCssPx ?? innerHeight)),
      dprBucket: String(bucketDpr(devicePixelRatio, { version: DEFAULT_PRIVACY_POLICY.version, dprBucketStep: DEFAULT_PRIVACY_POLICY.dprBucketStep, dprCap: 4 })),
      connectionBucket: bucketConnection(navigatorLike.connection?.effectiveType),
      deviceMemoryBucket: String(bucketDeviceMemory(navigatorLike.deviceMemory)),
      logicalCoreBucket: String(bucketLogicalCores(navigator.hardwareConcurrency)),
      rendererClass: "webgl",
    },
    versions: {
      adapterVersion: capabilities.adapterVersion,
      sparkVersion: capabilities.sparkVersion,
      toolkitVersion: "0.1.0",
    },
    revealPolicyObserved: { marker: LOAD_TELEMETRY_MARKER, mode: "site-runtime" },
    featureFlags: ["phase7_site_runtime"],
    wallClockBucket: null,
    clockQuality: "performance_time_origin",
  };
}

function safeCameraSample(input: Readonly<WireLoadTelemetryInput>): Readonly<TelemetryCameraSample> | undefined {
  try {
    return input.readCameraState();
  } catch {
    return undefined;
  }
}

function browserFamilyBucket(userAgent: string): string {
  if (/firefox/i.test(userAgent)) return "firefox";
  if (/edg\//i.test(userAgent)) return "edge";
  if (/chrome|chromium/i.test(userAgent)) return "chromium";
  if (/safari/i.test(userAgent)) return "safari";
  return "other";
}

function osClassBucket(userAgent: string): string {
  if (/windows/i.test(userAgent)) return "windows";
  if (/mac os|macintosh/i.test(userAgent)) return "mac";
  if (/android/i.test(userAgent)) return "android";
  if (/iphone|ipad|ios/i.test(userAgent)) return "ios";
  if (/linux/i.test(userAgent)) return "linux";
  return "other";
}

// ─── Pager source composite (mirrors examples/loadtest/main.ts; see header) ───

class PagerNetworkSource implements NetworkSource {
  readonly adapter: SparkPagerAdapterHandle;
  readonly capabilities: readonly string[];
  readonly declaredGaps: readonly string[];

  private readonly network: NetworkObserver;
  private readonly pending: CapturedProbeEvent[] = [];
  private receiver: ((event: Readonly<CapturedProbeEvent>) => void) | undefined;
  private networkSubscription: DisposableSource | undefined;
  private lastSnapshot: AdapterSnapshot | undefined;
  private previousCounters: readonly number[] | undefined;
  private readonly resourceUrl: string;

  constructor(mesh: SplatMesh, renderer: unknown, sceneUrl: string, private readonly pagedId: string) {
    this.resourceUrl = stripSceneUrl(sceneUrl, location.href);
    this.network = new NetworkObserver({ resourceUrl: this.resourceUrl, resourceUrlBase: location.href });
    this.adapter = attachSparkPagerAdapter({
      pagedMesh: mesh,
      renderer,
      installedVersion: "2.1.0",
      expectedVersion: "2.1.0",
      sceneLocalPagedId: this.pagedId,
      eventReceiver: (event) => this.acceptAdapterEvent(event),
      now: () => performance.now(),
    });
    this.capabilities = Object.freeze([
      ...Object.keys(this.adapter.capabilities.stages),
      ...this.network.capabilities,
    ]);
    this.declaredGaps = Object.freeze([...new Set([
      ...this.adapter.capabilities.declaredGaps,
      ...this.network.declaredGaps,
    ])]);
  }

  attach(receiver: (event: Readonly<CapturedProbeEvent>) => void): DisposableSource {
    this.receiver = receiver;
    this.networkSubscription = this.network.attach(receiver);
    for (const event of this.pending.splice(0)) this.emit(event);
    return Object.freeze({ dispose: () => this.detach() });
  }

  tick(atMs: number): AdapterSnapshot | undefined {
    const snapshot = this.adapter.readSnapshot(atMs);
    if (snapshot) this.lastSnapshot = snapshot;
    return snapshot;
  }

  readSnapshot(atMs: number): Readonly<NetworkSnapshot> | undefined {
    const adapterSnapshot = this.tick(atMs) ?? this.lastSnapshot;
    const timing = this.network.readSnapshot(atMs);
    if (!adapterSnapshot) return timing;
    const counters = [
      adapterSnapshot.requestedChunkAttempts,
      adapterSnapshot.decodedChunkCount,
      adapterSnapshot.decodedSplatCount,
      adapterSnapshot.uploadedPageCount,
    ] as const;
    const qualifyingProgress = this.previousCounters !== undefined
      && counters.some((value, index) => value > (this.previousCounters?.[index] ?? value));
    this.previousCounters = counters;
    const outstanding = adapterSnapshot.queueLengths.fetchers
      + adapterSnapshot.queueLengths.fetched
      + adapterSnapshot.queueLengths.newUploads
      + adapterSnapshot.queueLengths.readyUploads;
    const maxLevel = Math.max(0, ...adapterSnapshot.residentPages.map((candidate) => candidate.level ?? 0));
    const pages: SpatialPageEvidence[] = adapterSnapshot.residentPages.map((page) => ({
      canonicalPageId: page.pageId,
      ...(page.parentPageId ? { parentPageId: page.parentPageId } : {}),
      ...(page.childPageIds ? { childPageIds: page.childPageIds } : {}),
      pageLevel: page.level ?? 0,
      maxLevel,
      resident: true,
      renderEligibilityObservable: false,
      replacementAmbiguity: 1,
      occlusionEvidence: 0,
      confidence: 0.5,
    }));
    return Object.freeze({
      adapterStatus: adapterSnapshot.probeStatus,
      requiredReadingsValid: true,
      workingSetStable: outstanding === 0,
      relevantOutstanding: outstanding > 0,
      recentContradictoryEvent: false,
      qualifyingProgress,
      value: {
        adapterSnapshot: adapterSnapshot as unknown as JsonValue,
        resourceTiming: timing?.value ?? null,
        spatialEvidence: {
          pages: pages as unknown as JsonValue,
          nearPlane: 0.01,
          topologyFingerprint: this.adapter.capabilities.fingerprint
            ? JSON.stringify(this.adapter.capabilities.fingerprint)
            : null,
        },
      },
    });
  }

  dispose(): void {
    this.detach();
    try { this.adapter.detach(); } catch { /* already detached */ }
    this.network.dispose();
  }

  private detach(): void {
    this.networkSubscription?.dispose();
    this.networkSubscription = undefined;
    this.receiver = undefined;
  }

  private acceptAdapterEvent(event: Readonly<SparkPagerAdapterEvent>): void {
    if (event.type === "request_range_joined" && event.byteRange) {
      try {
        this.network.registerRequestKey({
          requestId: event.requestId,
          resourceName: event.expectedUrl ?? this.resourceUrl,
          startTimeLowerBoundMs: Math.max(0, event.atMs - 25),
          startTimeUpperBoundMs: performance.now() + 25,
        });
      } catch {
        // Enrichment linking is best-effort; ambiguity stays unlinked.
      }
    }
    const converted = adapterEventToProbeEvent(event);
    if (!converted) return;
    this.emit(converted);
  }

  private emit(event: Readonly<CapturedProbeEvent>): void {
    if (this.receiver) {
      this.receiver(event);
      return;
    }
    if (this.pending.length < 2_000) this.pending.push(event);
  }
}

function adapterEventToProbeEvent(event: Readonly<SparkPagerAdapterEvent>): CapturedProbeEvent | undefined {
  const common = { eventTimeMs: event.atMs, adapterStatus: event.probeStatus, declaredGaps: event.declaredGaps } as const;
  switch (event.type) {
    case "adapter_attached":
      return { ...common, type: "shape_fingerprint", source: "adapter", payload: { fingerprint: JSON.stringify(event.fingerprint) } };
    case "adapter_invalidated":
      return { ...common, type: "adapter_invalidation", source: "adapter", payload: { reason: event.code, terminal: true } };
    case "request_started":
      return { ...common, type: "request_created", source: "adapter", payload: {
        requestId: event.request.requestId,
        pageId: `${event.request.sceneLocalPagedId}:chunk:${event.request.chunk}`,
        ...(event.request.byteRange ? { byteRange: event.request.byteRange.header } : {}),
      } };
    case "request_range_joined":
      return { ...common, type: "request_ownership", source: "adapter", payload: {
        requestId: event.requestId,
        pageId: event.requestId,
        canonicalPageId: event.requestId,
        ...(event.byteRange ? { byteRange: event.byteRange.header } : {}),
      } };
    case "decode_combined_completed":
      return { ...common, type: "decode", source: "adapter", payload: {
        phase: "complete", requestId: event.request.requestId, pageId: event.request.requestId,
        ...(event.request.numSplats === undefined ? {} : { decodedBytes: event.request.numSplats }),
      } };
    case "request_failed":
      return { ...common, type: "request_failure", source: "adapter", payload: {
        requestId: event.request.requestId, pageId: event.request.requestId,
        reason: event.request.error ?? event.request.outcome ?? "unknown", terminal: true,
      } };
    case "gpu_upload_started":
    case "gpu_upload_completed":
      return { ...common, type: "gpu_upload", source: "adapter", payload: {
        phase: event.type === "gpu_upload_started" ? "start" : "complete",
        pageId: event.pageId,
        ...(event.requestId ? { requestId: event.requestId } : {}),
      } };
    case "gpu_upload_failed":
      return { ...common, type: "gpu_upload", source: "adapter", payload: {
        phase: "failure", pageId: event.pageId,
        ...(event.requestId ? { requestId: event.requestId } : {}), reason: event.error,
      } };
    case "selection_changed":
      return { ...common, type: "first_render_contribution", source: "renderer", payload: { numSplats: event.selection.numSplats } };
    case "pager_snapshot":
      return { ...common, type: "pager_snapshot", source: "pager", renderedFrame: true, payload: {
        residentPageIds: event.snapshot.residentPages.map((page) => page.pageId),
        requestCount: event.snapshot.requestedChunkAttempts,
        residentSplats: event.snapshot.residentPages.reduce((sum, page) => sum + (page.numSplats ?? 0), 0),
      } };
  }
}
