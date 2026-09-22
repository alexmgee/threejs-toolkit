/**
 * Load-telemetry wiring (Phase 7) — the runtime's ONLY diagnostics import
 * boundary. SiteRuntime imports `wireLoadTelemetry` through the stable
 * `@embed/diagWiring` alias; the measurement build swaps this module for
 * `diagWiring.stub.ts` at config time so Rollup statically eliminates the
 * whole diagnostics graph (see vite.config.ts TELEMETRY_MEASURE).
 *
 * Registration is IMMEDIATE (Phase 2 ticket 12, §G) — but the pager it
 * observes still arrives later, and the source is built to expect that. The
 * pin POLLED a private `mesh.paged.pager` for 30 s and then gave up in
 * silence. Two different things were tangled in that poll: Spark hid the
 * pager behind private names (gone — we read a published door), and a
 * paged scene's state genuinely does not exist until its header lands
 * (NOT gone — measured at ~910 ms for the lab hero). So the handle is
 * registered at once and `PagerTelemetrySource` treats the door's
 * `not-paged` as "not yet" rather than "never"; nothing is polled, nothing
 * is guessed at, and no load is silently abandoned.
 * Consent gates everything: pending/denied construct nothing beyond the
 * coordinator-free static status inside the probe.
 */

import { REVISION } from "three";
import type { SplatBackend, SplatHandle } from "../backend/SplatBackend";
import type { PagerDiagnosticsProvider } from "../backend/ThreeGsBackend";
import { PagerTelemetrySource } from "../diag/PagerTelemetrySource";
import { LaggardMapper } from "../diag/LaggardMapper";
import {
  type AffirmativeAttachOptions,
  type ConsentDecisions,
  type ProbeSceneMetadata,
} from "../diag/LoadProbe";
import { LoadCoordinator } from "../diag/LoadCoordinator";
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

/**
 * The seam pair, re-typed from the pin's Spark mesh (owner ruling G3,
 * 2026-09-20; doc 06 D34). The pin's input carried a Spark `SplatMesh`
 * whose `paged.pager` this backend never has — a shape that could only
 * ever be satisfied by lying. `backend` is the seam plus the one extra
 * door telemetry needs, named in the type rather than assumed.
 */
export interface RegisterPagedSceneInput {
  readonly sceneId: string;
  readonly backend: SplatBackend & PagerDiagnosticsProvider;
  readonly handle: SplatHandle;
  readonly sceneUrl: string;
  /** Which renderer actually initialized, for the record's environment
   *  (owner ruling B3 — "the scene already knows"). It travels with the
   *  registration because scene metadata is fixed at attach time, while the
   *  counter door that also carries it does not open until the header
   *  lands; reading it here would record "unknown" on every paged load. */
  readonly backendKind: "webgpu" | "webgl2-fallback" | null;
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
  /** performance.now() at registration — the left edge of this scene's
   *  long-task attribution window (see the observer in the constructor). */
  readonly registeredAtMs: number;
  source?: PagerTelemetrySource;
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
  private longTasks: PerformanceObserver | undefined;

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
    // ONE long-task observer per runtime (ticket 12, condition #11). It sits
    // here rather than in the source because a long task is a property of the
    // PAGE, not of a scene: two registered scenes must each see it once, not
    // twice between them. `longtask` is Chromium-only, so an unsupported
    // browser leaves the aggregate at its honest zero. `buffered: true` asks
    // for entries predating the observer; they are still filtered by each
    // scene's own registration time below, so in practice it only helps a
    // scene that registers within the same task as the runtime is wired.
    try {
      this.longTasks = new PerformanceObserver((list) => {
        if (this.disposed) return;
        for (const entry of list.getEntries()) {
          const endedAtMs = entry.startTime + entry.duration;
          for (const registered of this.scenes.values()) {
            // A scene's record says "longest main-thread block during THIS
            // load", so only blocks that had not already finished when the
            // scene registered count. `buffered: true` delivers the page's
            // whole history, which would otherwise attribute boot-time
            // blocks to every scene registered afterwards — measured in the
            // site-lab fixture as 178 attributed events against 9 that
            // actually occurred, and a "longest" of 1174 ms against 287.
            if (endedAtMs < registered.registeredAtMs) continue;
            try {
              registered.source?.recordLongTask(entry.duration, endedAtMs);
            } catch {
              // Observation never surfaces into the page.
            }
          }
        }
      });
      this.longTasks.observe({ type: "longtask", buffered: true });
    } catch {
      // No longtask support (Firefox, Safari): the record's longTasks block
      // stays zero, which is true rather than merely convenient.
      this.longTasks = undefined;
    }
  }

  registerPagedScene(sceneInput: Readonly<RegisterPagedSceneInput>): void {
    if (this.disposed) return;
    const sceneId = sanitizeSceneId(sceneInput.sceneId);
    if (this.scenes.has(sceneId)) return;
    const registered: RegisteredScene = { sceneId, cancelled: false, registeredAtMs: performance.now() };
    this.scenes.set(sceneId, registered);
    // No poll: the seam's handle is live at registration (§G). Attach
    // failures degrade to "no telemetry for this scene", never into the
    // visitor path — the same contract the poll's silent give-up had, now
    // reached in one step instead of after 30 s of guessing.
    try {
      this.attachScene(registered, sceneInput);
    } catch {
      registered.cancelled = true;
    }
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
      const source = registered.source;
      statuses.push(Object.freeze({
        // There is no adapter to be "invalid" any more: the door either
        // reads or the scene was never attached. "not_attached" replaces
        // the pin's "awaiting_pager", which named a wait that no longer
        // exists.
        adapterStatus: source ? "valid" : "not_attached",
        sceneId: registered.sceneId,
        reasons: Object.freeze([]),
        declaredGaps: source?.declaredGaps ?? Object.freeze([]),
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
    try { this.longTasks?.disconnect(); } catch { /* already gone */ }
    this.longTasks = undefined;
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
    const source = new PagerTelemetrySource({
      backend: sceneInput.backend,
      handle: sceneInput.handle,
      sceneUrl: sceneInput.sceneUrl,
      sceneLocalPagedId: registered.sceneId,
      now: () => performance.now(),
    });
    registered.source = source;
    // The record states which renderer produced it (owner ruling B3),
    // replacing the pin's hardcoded "webgl". "unknown" survives as the
    // honest answer for a runtime whose renderer has not initialized.
    const backendIdentity = sceneInput.backendKind ?? "unknown";
    const endpoint = this.options?.telemetryEndpoint;
    const authorMode = this.input.authorMode;
    const localGranted = this.decisions.localPersistence === "granted";
    const remoteGranted = this.decisions.remoteTransmission === "granted";
    const registration: Omit<AffirmativeAttachOptions, "loadId"> = {
      consent: "granted",
      consentHook: this.consentHook,
      ...(this.options?.telemetryEndpoint ? { telemetryEndpoint: this.options.telemetryEndpoint } : {}),
      scene: null,
      mesh: sceneInput.handle,
      renderer: undefined,
      metadata: buildSceneMetadata(registered.sceneId, sceneInput.sceneUrl, backendIdentity, source, this.input),
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
  backendIdentity: string,
  source: PagerTelemetrySource,
  input: Readonly<WireLoadTelemetryInput>,
): Readonly<ProbeSceneMetadata> {
  const navigatorLike = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { effectiveType?: string };
  };
  const camera = safeCameraSample(input);
  return {
    sceneId,
    sceneUrl: stripSceneUrl(sceneUrl, location.href),
    sceneUrlBase: location.origin,
    serverVersion: null,
    radFormatVersion: null,
    // No private shape is being tracked, so there is nothing to fingerprint
    // and nothing that can silently change under us: topology invalidation
    // was a Spark-adapter concern that dies with it.
    topologyFingerprint: null,
    adapterStatus: "valid",
    statusReasons: Object.freeze([]),
    declaredGaps: source.declaredGaps,
    capabilityFlags: source.capabilities,
    environment: {
      browserBucket: browserFamilyBucket(navigator.userAgent),
      osClass: osClassBucket(navigator.userAgent),
      gpuBucket: JSON.stringify(bucketGpu(undefined, undefined, "unknown")),
      viewportBucket: JSON.stringify(bucketViewport(camera?.viewportWidthCssPx ?? innerWidth, camera?.viewportHeightCssPx ?? innerHeight)),
      dprBucket: String(bucketDpr(devicePixelRatio, { version: DEFAULT_PRIVACY_POLICY.version, dprBucketStep: DEFAULT_PRIVACY_POLICY.dprBucketStep, dprCap: 4 })),
      connectionBucket: bucketConnection(navigatorLike.connection?.effectiveType),
      deviceMemoryBucket: String(bucketDeviceMemory(navigatorLike.deviceMemory)),
      logicalCoreBucket: String(bucketLogicalCores(navigator.hardwareConcurrency)),
      // Owner ruling B3 (2026-09-20): the runtime's ACTUAL backend, read
      // from the counter door's PageBudget.backend, replacing the pin's
      // hardcoded "webgl" — which made every WebGPU run record itself as
      // WebGL (RED quoted in ticket 12).
      rendererClass: backendIdentity,
    },
    versions: {
      // `sparkVersion` and `adapterVersion` are GONE (owner rulings B2 and
      // its sibling, 2026-09-20; doc 06 D35). Both were fossils: their only
      // source was the deleted SparkPagerAdapter. `engineVersion` is what
      // the field always meant — the engine that produced the record —
      // taken from three's own REVISION rather than hardcoded, so it cannot
      // drift from the engine actually running.
      engineVersion: REVISION,
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
