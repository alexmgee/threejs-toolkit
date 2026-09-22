/**
 * PagerTelemetrySource — the production `NetworkSource` for this toolkit's
 * own pager (Phase 2 ticket 12, §G).
 *
 * REPLACES `SparkPagerAdapter` + `diagWiring`'s `PagerNetworkSource`. The
 * difference is the whole point of §G: Spark exposed no counters, so the
 * adapter monkey-patched four private methods and pinned 32 private names
 * to see anything at all. Our pager publishes a counter door
 * (`pagerDiagnostics`), so this source only ever READS — it never patches,
 * wraps or reaches past the door, and there is no fingerprint to invalidate
 * because there is no private shape being guessed at.
 *
 * The port is unchanged: `LoadProbe` asks for a `NetworkSource`, and this
 * supplies one. That is why `LoadProbe` (752 lines) and `LaggardMapper`
 * (560) survived §G untouched — the Spark coupling was never inside the
 * framework, only inside the implementations of its ports.
 *
 * THE DOOR OPENS LATE, AND THAT IS NOT A FAILURE. A paged handle's state is
 * built after its header lands, so `pagerDiagnostics` throws `not-paged` for
 * the first stretch of every paged load — measured at ~910 ms for the lab
 * hero on 2026-09-20. That window is exactly the part of the load telemetry
 * most wants to watch, so it is treated as "not yet", not as "never": only a
 * gone handle (`unknown-handle`) closes this source for good.
 *
 * SAMPLED, NOT SUBSCRIBED. The door hands out snapshots; events are derived
 * by differencing consecutive snapshots at `readSnapshot`/`tick` time. So
 * every emitted event is a statement about an interval, not an instant, and
 * anything that rises and falls entirely between two samples is missed. That
 * is a declared gap below, not a silent one.
 */

import { SplatBackendError, type SplatBackend, type SplatHandle } from "../backend/SplatBackend";
import type { PagerDiagnostics, PagerDiagnosticsProvider } from "../backend/ThreeGsBackend";
import { NetworkObserver } from "./NetworkObserver";
import type {
  CapturedProbeEvent,
  DisposableSource,
  NetworkSnapshot,
  NetworkSource,
} from "./LoadProbe";
import type { SpatialPageEvidence } from "./LaggardMapper";
import type { ProbeStatus } from "./events";
import { stripSceneUrl } from "./privacy";

/**
 * Always "valid". The pin's status tracked whether the ADAPTER's guesses
 * about Spark's private shape still held, and went "invalid" when a
 * fingerprint changed under it. Reading a published door has no such
 * failure mode: either the door answers or the handle is gone, and a gone
 * handle stops observation rather than degrading it. Kept as a field
 * because the record schema and the DebugPanel both carry it.
 */
const PROBE_STATUS: ProbeStatus = "valid";

/** What this source can actually observe through the door. */
const CAPABILITIES: readonly string[] = Object.freeze([
  "residency",
  "decode_progress",
  "gpu_upload",
  "rendered_frames",
  "selection",
  "page_budget",
]);

/**
 * What it CANNOT, stated up front so a record never implies more than it
 * measured. The adapter declared six gaps for Spark; these are ours, and
 * they are different gaps for a different reason — not missing private
 * internals, but a door that reports state rather than streaming events.
 */
const DECLARED_GAPS: readonly string[] = Object.freeze([
  // The door reports counts, not per-request identity: bytes and ranges
  // belong to RadPager's fetcher, which the seam does not surface. Resource
  // timing still links loads to the asset URL through NetworkObserver.
  "per_request_identity_absent_counts_only",
  // Derived by differencing samples: sub-sample transitions are invisible.
  "sampled_transitions_not_instants",
  // Our pages are flat chunks, not an LOD tree: there is no parent to
  // retire and no child to replace it, so LaggardMapper's replacement
  // reasoning runs on a single level.
  "page_topology_flat_no_parent_retirement",
  // "Render eligible" is per-page only; the exact frame a page first
  // contributed pixels is not observable without an in-band readback.
  "render_eligible_page_level_only",
]);

export interface PagerTelemetrySourceOptions {
  /** The seam plus the counter door — G3's ruled type. */
  readonly backend: SplatBackend & PagerDiagnosticsProvider;
  readonly handle: SplatHandle;
  readonly sceneUrl: string;
  /** Scene-local id used to build stable page ids. */
  readonly sceneLocalPagedId: string;
  readonly now: () => number;
}

/** The fields we difference between samples, kept small on purpose. */
interface Sample {
  readonly atMs: number;
  readonly renders: number;
  readonly residentChunks: readonly number[];
  readonly residentSplats: number;
  readonly firstUploaded: number;
  readonly decoded: number;
  readonly uploaded: number;
  readonly bytes: number;
  readonly unavailable: number;
  /** In-flight admissions only — see the note at its assignment. */
  readonly outstanding: number;
  readonly selected: number;
  readonly fullQuality: boolean;
  readonly loadSettled: boolean;
}

export class PagerTelemetrySource implements NetworkSource {
  readonly capabilities: readonly string[];
  readonly declaredGaps: readonly string[];

  private readonly network: NetworkObserver;
  private readonly resourceUrl: string;
  private readonly pending: CapturedProbeEvent[] = [];
  private receiver: ((event: Readonly<CapturedProbeEvent>) => void) | undefined;
  private networkSubscription: DisposableSource | undefined;
  private previous: Sample | undefined;
  private lastSnapshot: Readonly<NetworkSnapshot> | undefined;
  private disposed = false;
  /** Set once the door starts throwing (disposed handle mid-observation);
   *  observation stops rather than throwing into the render loop. */
  private doorClosed = false;
  /** Re-entrancy guard. Emitting synchronously re-enters LoadProbe's capture,
   *  which runs its own optional observation and calls back into
   *  readSnapshot; without this, one interval would be differenced (and
   *  emitted) twice and `previous` would be rewound by the outer call.
   *  LoadProbe guards its own side for the same reason (LoadProbe.ts:418). */
  private sampling = false;

  constructor(private readonly options: Readonly<PagerTelemetrySourceOptions>) {
    this.resourceUrl = stripSceneUrl(options.sceneUrl, location.href);
    this.network = new NetworkObserver({
      resourceUrl: this.resourceUrl,
      resourceUrlBase: location.href,
    });
    this.capabilities = Object.freeze([...CAPABILITIES, ...this.network.capabilities]);
    this.declaredGaps = Object.freeze([
      ...new Set([...DECLARED_GAPS, ...this.network.declaredGaps]),
    ]);
  }

  attach(receiver: (event: Readonly<CapturedProbeEvent>) => void): DisposableSource {
    this.receiver = receiver;
    this.networkSubscription = this.network.attach(receiver);
    for (const event of this.pending.splice(0)) this.emit(event);
    return Object.freeze({ dispose: () => this.detach() });
  }

  /** Read the door once, never throwing into the observation path.
   *
   *  The two refusals mean OPPOSITE things and must not be collapsed:
   *  `not-paged` is "not yet" (the pager is still being built, or this is a
   *  monolithic scene) and the source keeps trying; `unknown-handle` is
   *  "gone for good" and latches the source closed. Collapsing them cost a
   *  whole load's telemetry once — registration happens before the pager
   *  exists, so a permanent latch on the first `not-paged` silenced the
   *  source for the entire load while every other part still looked healthy.
   */
  private read(): PagerDiagnostics | undefined {
    if (this.disposed || this.doorClosed) return undefined;
    try {
      return this.options.backend.pagerDiagnostics(this.options.handle);
    } catch (error) {
      if (error instanceof SplatBackendError && error.reason === "not-paged") return undefined;
      this.doorClosed = true;
      return undefined;
    }
  }

  private sample(diagnostics: PagerDiagnostics, atMs: number): Sample {
    // Chunk indices run [0, pAsset) — the asset's own chunk count, which is
    // the only total the door publishes. `isResident` is the door's
    // authority on residency; the count field is used only to cross-check.
    const residentChunks: number[] = [];
    for (let chunk = 0; chunk < diagnostics.budget.pAsset; chunk += 1) {
      if (diagnostics.isResident(chunk)) residentChunks.push(chunk);
    }
    return {
      atMs,
      renders: diagnostics.renders,
      residentChunks,
      residentSplats: diagnostics.residentSplats,
      firstUploaded: diagnostics.firstUploaded,
      decoded: diagnostics.progressTerms.decoded,
      uploaded: diagnostics.progressTerms.uploaded,
      bytes: diagnostics.progressTerms.bytes,
      unavailable: diagnostics.unavailable.length,
      // IN-FLIGHT work only. `lod.admitting` is a real queue (a Map with
      // set/delete). `deferred` is NOT: it is a readonly number[] that only
      // ever grows (ThreeGsBackend.ts:835 is its single writer), a historical
      // log of chunks the admission gate consciously declined. Counting it
      // here made "outstanding" permanently non-zero for any constrained
      // budget, so convergence could never be reached at all — doc 05
      // criterion 1 notes full quality is structurally unreachable under
      // `?pages=32`, and deferrals are that regime's steady state, not
      // pending work.
      outstanding: diagnostics.lod.admitting,
      selected: diagnostics.lod.selectedCount,
      fullQuality: diagnostics.lod.fullQuality,
      loadSettled: diagnostics.loadSettled,
    };
  }

  private pageId(chunk: number): string {
    return `${this.options.sceneLocalPagedId}:chunk:${chunk}`;
  }

  /**
   * Difference two samples into probe events. The event vocabulary is
   * `events.ts`'s, which is renderer-neutral and survived §G unchanged —
   * the same types the Spark adapter fed, now produced from our own door.
   */
  private emitDifferences(previous: Sample, next: Sample, adapterStatus: ProbeStatus): void {
    const common = {
      eventTimeMs: next.atMs,
      adapterStatus,
      declaredGaps: this.declaredGaps,
    } as const;

    const before = new Set(previous.residentChunks);
    const after = new Set(next.residentChunks);

    for (const chunk of after) {
      if (before.has(chunk)) continue;
      // A newly resident chunk was decoded and uploaded within this
      // interval; both are reported at the sample time, with the interval
      // gap declared above.
      this.emit({
        ...common,
        type: "decode",
        source: "pager",
        payload: { phase: "complete", pageId: this.pageId(chunk) },
      });
      this.emit({
        ...common,
        type: "gpu_upload",
        source: "pager",
        payload: { phase: "complete", pageId: this.pageId(chunk) },
      });
    }

    for (const chunk of before) {
      if (after.has(chunk)) continue;
      this.emit({
        ...common,
        type: "eviction",
        source: "pager",
        payload: { pageId: this.pageId(chunk), reason: "pager_residency_budget" },
      });
    }

    if (next.unavailable > previous.unavailable) {
      this.emit({
        ...common,
        type: "request_failure",
        source: "pager",
        payload: {
          requestId: `${this.options.sceneLocalPagedId}:unavailable:${next.unavailable}`,
          pageId: `${this.options.sceneLocalPagedId}:unavailable`,
          reason: "chunk_unavailable",
          terminal: true,
        },
      });
    }

    if (next.selected > previous.selected) {
      this.emit({
        ...common,
        type: "first_render_contribution",
        source: "renderer",
        payload: { numSplats: next.selected },
      });
    }

    // THE CPU-BUDGET DENOMINATOR (owner ruling G2, AC3). LoadProbe's
    // optional-work allowance is
    //   min(max(1, renderedFrames) * optionalCpuMsPerRenderedFrame,
    //       optionalCpuMsPerWindow)
    // and `renderedFrames` counts ONLY events carrying `renderedFrame: true`
    // (LoadProbe.ts:364). Under Spark that flag came from the adapter's
    // pager_snapshot; with the adapter deleted and nothing replacing it the
    // denominator would sit at max(1, 0) forever, so the ladder would
    // self-disable while still emitting plausible numbers — the §G trap AC3
    // forbids. It is fed HONESTLY here: the flag is set only when the
    // pager's own render counter actually advanced across this interval, so
    // an idle tab contributes nothing.
    //
    // WHAT THIS FLAG MEANS, EXACTLY (owner ruling 2026-09-22, D35 item 5):
    // "rendering occurred during this SAMPLE WINDOW", not "one frame
    // rendered". One event is emitted per snapshot while rendering runs at
    // frame rate, so the probe's denominator counts windows, not frames —
    // measured at 120 frames against 19 flagged events (6.32x) on a real
    // paged load. This is the PIN's own cadence, not a regression
    // (`fd67153:SparkPagerAdapter.ts:529` emits one `pager_snapshot` per
    // `readSnapshot`), and it is kept deliberately: emitting true frame
    // counts would loosen the optional-work throttle roughly sixfold past
    // any behaviour the pin ever shipped — a policy change wearing a bug
    // fix's clothes. Whether the allowance should be recalibrated against
    // true frames is ticket 13's post-parity tuning item.
    const renderedFrame = next.renders > previous.renders;
    this.emit({
      ...common,
      type: "pager_snapshot",
      source: "pager",
      ...(renderedFrame ? { renderedFrame: true } : {}),
      payload: {
        residentPageIds: next.residentChunks.map((chunk) => this.pageId(chunk)),
        requestCount: next.residentChunks.length + next.outstanding,
        residentSplats: next.residentSplats,
      },
    });
  }

  readSnapshot(atMs: number): Readonly<NetworkSnapshot> | undefined {
    if (this.sampling) return this.lastSnapshot;
    const timing = this.network.readSnapshot(atMs);
    const diagnostics = this.read();
    if (!diagnostics) return this.lastSnapshot ?? timing;
    this.sampling = true;
    try {
      return this.sampleAndEmit(diagnostics, atMs, timing);
    } finally {
      this.sampling = false;
    }
  }

  private sampleAndEmit(
    diagnostics: PagerDiagnostics,
    atMs: number,
    timing: Readonly<NetworkSnapshot> | undefined,
  ): Readonly<NetworkSnapshot> {
    const next = this.sample(diagnostics, atMs);
    const previous = this.previous;
    if (previous) this.emitDifferences(previous, next, PROBE_STATUS);
    this.previous = next;

    const qualifyingProgress = previous !== undefined
      && (next.decoded > previous.decoded
        || next.uploaded > previous.uploaded
        || next.bytes > previous.bytes
        || next.residentSplats > previous.residentSplats);

    const maxLevel = 0; // flat chunk topology — declared gap above
    const pages: SpatialPageEvidence[] = next.residentChunks.map((chunk) => ({
      canonicalPageId: this.pageId(chunk),
      pageLevel: 0,
      maxLevel,
      resident: true,
      // Selection is per-render and aggregate; per-page render eligibility
      // is not observable through the door (declared gap).
      renderEligibilityObservable: false,
      replacementAmbiguity: 1,
      occlusionEvidence: 0,
      confidence: 0.5,
    }));

    const snapshot: Readonly<NetworkSnapshot> = Object.freeze({
      adapterStatus: PROBE_STATUS,
      requiredReadingsValid: true,
      // `loadSettled` is REQUIRED here, not decorative. These two fields feed
      // the convergence CANDIDATE condition directly (convergence.ts:114-115),
      // so "stable and nothing outstanding" is the probe's licence to start
      // calling the load converged. The door's `deferred` and `lod.admitting`
      // count only admission-gate deferrals and cache re-decodes — NEITHER
      // counts the initial fetch/decode/upload pipeline — so between two chunk
      // completions they both read 0 while the load is still streaming.
      // Measured on the lab hero before this guard: 3 samples claimed a stable
      // working set starting at 1190 ms, against a load that settled at
      // 1703 ms. The pin could ask Spark for real queue depths
      // (`queueLengths.fetchers/fetched/newUploads/readyUploads`); our door
      // publishes the pager's own settled flag instead, which answers the same
      // question without exposing queue internals.
      workingSetStable: next.loadSettled && next.outstanding === 0,
      relevantOutstanding: !next.loadSettled || next.outstanding > 0,
      recentContradictoryEvent: false,
      qualifyingProgress,
      value: {
        pagerSnapshot: {
          renders: next.renders,
          residentPages: next.residentChunks.length,
          residentSplats: next.residentSplats,
          firstUploaded: next.firstUploaded,
          selected: next.selected,
          fullQuality: next.fullQuality,
          loadSettled: next.loadSettled,
          outstanding: next.outstanding,
          progressTerms: {
            bytes: next.bytes,
            decoded: next.decoded,
            uploaded: next.uploaded,
          },
          budget: {
            pages: diagnostics.budget.pages,
            pAsset: diagnostics.budget.pAsset,
            backend: diagnostics.budget.backend,
          },
          uploadPath: diagnostics.uploadPath,
        },
        resourceTiming: timing?.value ?? null,
        spatialEvidence: {
          pages: pages as unknown as Record<string, never>[],
          nearPlane: 0.01,
          // No private shape is being tracked, so there is no fingerprint to
          // change: topology invalidation was a Spark-adapter concern.
          topologyFingerprint: null,
        },
      } as unknown as NetworkSnapshot["value"],
    });
    this.lastSnapshot = snapshot;
    return snapshot;
  }

  /**
   * Feed one observed long task into this scene's record (ticket 12,
   * carried condition #11 / owner ruling 2026-09-20 option (c)).
   *
   * `LoadProbe` has always AGGREGATED `longTaskDurationMs` into the record's
   * `longTasks` block (`:347`, `:359-362`, `:526`) and nothing in the tree
   * has ever SET it, so "longest main-thread block" — one of the four
   * metrics doc 05 names for this stack — reported 0 on every record: a
   * plausible number meaning "never measured". Measured on 2026-09-20
   * before this existed: 20 real long tasks (longest 626 ms, confirmed by an
   * independent PerformanceObserver) produced 110 record events, 0 of them
   * carrying a duration.
   *
   * The page-level observer lives in `diagWiring`'s `SiteTelemetry` — one
   * per runtime, beside the other page-level listeners — and calls this per
   * registered scene, so each scene's record carries the blocks that
   * occurred during ITS load rather than a shared global.
   */
  recordLongTask(durationMs: number, atMs: number): void {
    if (this.disposed || !(durationMs > 0)) return;
    this.emit({
      type: "overhead",
      source: "probe",
      eventTimeMs: atMs,
      longTaskDurationMs: durationMs,
      payload: { cpuMs: durationMs, operation: "long_task" },
    });
  }

  /** Called once per throttled frame by the telemetry handle's `tick`. */
  tick(atMs: number): void {
    this.readSnapshot(atMs);
  }

  dispose(): void {
    this.disposed = true;
    this.detach();
    this.network.dispose();
  }

  private detach(): void {
    this.networkSubscription?.dispose();
    this.networkSubscription = undefined;
    this.receiver = undefined;
  }

  private emit(event: Readonly<CapturedProbeEvent>): void {
    if (this.receiver) {
      this.receiver(event);
      return;
    }
    if (this.pending.length < 2_000) this.pending.push(event);
  }
}
