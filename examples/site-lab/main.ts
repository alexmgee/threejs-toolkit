/**
 * site-lab — the production runtime driving a REAL site.json (Phase 2 ticket 09).
 *
 * One regime per run: the default is WebGPU; `?webgl=1` hides `navigator.gpu`
 * before any toolkit module loads (index.html), so three's own fallback selects
 * WebGL2 inside `renderer.init()` — the path a visitor without WebGPU takes
 * (owner ruling Stop 11; deliberately different coverage from the other labs'
 * construction-time `forceWebGL`).
 *
 * Proves, on whichever backend the URL selects:
 * - the two LATENT semantic changes Phase 2 activates, each with a passing
 *   control: an authored block at a marker's reserved copy id throws at
 *   `normalizeSiteConfig` (SiteConfig.ts:1237-1243), and two show-blocks
 *   effects in one rule naming the same blocks throw at RuleModel validation
 *   (RuleModel.ts:974-990);
 * - a scene the backend refuses on the spot (.spz) fails the load through the
 *   runtime's load-error path and still hands back a runtime its owner can
 *   dispose (review finding 1);
 * - a real site.json loads, reveals and announces readiness, with the site-level
 *   progress contract of ruling Stop 5 (P1) and the S5 warning-noise count
 *   (Stop 6);
 * - navigation announces the stop it arrived at;
 * - teardown disposes every scene THROUGH THE SEAM and leaves the runtime's own
 *   renderer at its pre-load counters (Stop 16, H1 — the drill asserts its own
 *   measuring window, see `disposeWindow`);
 * - ten load→dispose cycles at runtime scope keep the JS heap off a strictly
 *   increasing path.
 *
 * Frames are pumped explicitly (fixed step) rather than waiting on the runtime's
 * own rAF loop: reveal is paint-observed, and a hidden pane runs no animation
 * frames. Waits are time-bounded and timer-free.
 */

import type * as THREE from "three";
import { createCapture } from "../shared/capture";
import { createSiteRuntime, type SiteReadyDetail, type SiteRuntimeHandle, type SiteStopDetail } from "@toolkit/embed/SiteRuntime";
import { normalizeSiteConfig } from "@toolkit/site/SiteConfig";
import { ThreeGsBackend } from "@toolkit/backend/ThreeGsBackend";
import { ThreeSplatScene } from "@toolkit/core/ThreeSplatScene";
import { loadSplat } from "@toolkit/core/SplatLoader";
import { createDecodeWorker } from "@toolkit/backend/decode-url";
import { wireLoadTelemetry } from "@toolkit/embed/diagWiring";
import { PagerTelemetrySource } from "@toolkit/diag/PagerTelemetrySource";
import { runSelfTest } from "@toolkit/diag/dev/selfTest";
import { REVISION } from "three";
import { SplatBackendError, type SplatHandle } from "@toolkit/backend/SplatBackend";
import labSite from "./sites/lab.site.json";
import lmLifetimeSite from "./sites/lm-lifetime.site.json";
import obstacleSite from "./sites/obstacle.site.json";
import throwCopyBlockSite from "./sites/throw-copy-block-id.site.json";
import controlCopyBlockSite from "./sites/control-copy-block-id.site.json";
import throwDuplicateSite from "./sites/throw-duplicate-show-blocks.site.json";
import controlDuplicateSite from "./sites/control-duplicate-show-blocks.site.json";

const container = document.getElementById("viewer")!;
const out = document.getElementById("out")!;
const params = new URLSearchParams(location.search);
const expectedBackend = params.get("webgl") === "1" ? "webgl2-fallback" : "webgpu";

// Pager-lab's bound: 10 × the measured cold hero load (~12 s, ticket 05).
const WAIT_BOUND_MS = 10 * 12_000;

/** The same paged .rad the lab site's hero loads — read from the site config
 *  rather than re-typed, so the two can never drift apart. */
const PAGED_ASSET = (labSite as { scenes: { url: string }[] }).scenes[0]!.url;

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, detail: string): void {
  const div = document.createElement("div");
  div.className = `assertion ${condition ? "pass" : "fail"}`;
  div.textContent = `${condition ? "PASS" : "FAIL"} — ${name}: ${detail}`;
  out.appendChild(div);
  console.log(`site-lab ${condition ? "PASS" : "FAIL"} ${name} — ${detail}`);
  condition ? passed++ : failed++;
}

function finishSummary(): void {
  const heading = document.createElement("h2");
  heading.className = failed === 0 ? "pass" : "fail";
  heading.textContent = `site-lab: ${passed} passed, ${failed} failed`;
  out.appendChild(heading);
  console.log(`site-lab RESULT ${passed} passed, ${failed} failed`);
}

const yieldResolvers: Array<() => void> = [];
const yieldChannel = new MessageChannel();
yieldChannel.port1.onmessage = () => yieldResolvers.shift()?.();
function yieldMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    yieldResolvers.push(resolve);
    yieldChannel.port2.postMessage(0);
  });
}

// Every console.warn is recorded; the contract's own warnings carry these
// prefixes, so counts are never polluted by unrelated library warnings.
const logs: string[] = [];
const originalLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
  logs.push(args.map(String).join(" "));
  originalLog(...args);
};
function telemetrySummariesSince(mark: number): string[] {
  return logs.slice(mark).filter((l) => l.includes("Load telemetry summary:"));
}

const warnings: string[] = [];
const originalWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  warnings.push(args.map(String).join(" "));
  originalWarn(...args);
};
function contractWarningsSince(mark: number): string[] {
  return warnings
    .slice(mark)
    .filter((w) => w.startsWith("[ThreeGsBackend]") || w.startsWith("[SplatLoader]") || w.startsWith("[SiteRuntime]"));
}

// three reports an unsupported material through its own error channel, which
// lands on console.error — recorded so a drill can count it.
const consoleErrors: string[] = [];
const originalError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  consoleErrors.push(args.map((a) => String((a as { message?: string })?.message ?? a)).join(" "));
  originalError(...args);
};

/** The author-mode obstacle outlines currently in a runtime's scene. */
function sceneOutlines(booted: Booted): THREE.Object3D[] {
  return booted.handle.sparkScene.scene.children.filter(
    (child) => (child as { isLineSegments2?: boolean }).isLineSegments2 === true,
  );
}

let unhandledRejections = 0;
window.addEventListener("unhandledrejection", (ev) => {
  unhandledRejections++;
  console.error("site-lab UNHANDLED REJECTION", ev.reason);
});

const GPU_COUNTER_KEYS = [
  "attributes",
  "attributesSize",
  "geometries",
  "indexAttributes",
  "indexAttributesSize",
  "storageAttributes",
  "storageAttributesSize",
  "textures",
  "texturesSize",
] as const;
type GpuCounters = Record<(typeof GPU_COUNTER_KEYS)[number], number>;

function gpuMemoryCounters(renderer: { info: { memory: unknown } }): GpuCounters {
  const memory = renderer.info.memory as Record<string, unknown>;
  const counters = {} as GpuCounters;
  for (const key of GPU_COUNTER_KEYS) {
    const v = memory[key];
    if (typeof v !== "number") {
      throw new Error(`renderer.info.memory.${key} missing — the teardown gate cannot run`);
    }
    counters[key] = v;
  }
  return counters;
}

function countersEqual(a: GpuCounters, b: GpuCounters): boolean {
  return GPU_COUNTER_KEYS.every((k) => a[k] === b[k]);
}

function countersGrew(baseline: GpuCounters, loaded: GpuCounters): boolean {
  return GPU_COUNTER_KEYS.some((k) => loaded[k] > baseline[k]);
}

function summarize(c: GpuCounters): string {
  return `storage ${c.storageAttributes}/${c.storageAttributesSize}B, attributes ${c.attributes}, geometries ${c.geometries}, textures ${c.textures}/${c.texturesSize}B`;
}

/** A booted runtime plus the fixture's own instruments for it. */
interface Booted {
  readonly handle: SiteRuntimeHandle;
  readonly host: HTMLElement;
  readonly progress: number[];
  readonly stops: SiteStopDetail[];
  readonly errors: unknown[];
  ready: SiteReadyDetail | null;
  /** Set by the fixture's wrapper the moment the runtime's renderer tears
   *  itself down — the teardown drill's measuring-window assertion. */
  rendererDisposed: boolean;
}

function boot(
  rawSite: unknown,
  options: { author?: boolean; telemetry?: Parameters<typeof createSiteRuntime>[0]["telemetry"] } = {},
): Booted {
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:0;top:0;width:512px;height:256px";
  container.appendChild(host);
  const booted: Partial<Booted> & { progress: number[]; stops: SiteStopDetail[]; errors: unknown[] } = {
    progress: [],
    stops: [],
    errors: [],
    ready: null,
    rendererDisposed: false,
  };
  const handle = createSiteRuntime({
    container: host,
    rawSite: structuredClone(rawSite),
    author: options.author ?? false,
    ...(options.telemetry ? { telemetry: options.telemetry } : {}),
    onReady: (detail) => {
      booted.ready = detail;
    },
    onLoadProgress: (value) => {
      booted.progress.push(value);
    },
    onLoadError: (error) => {
      booted.errors.push(error);
    },
    onStopChanged: (detail) => {
      booted.stops.push(detail);
    },
  });
  // The renderer's own dispose is deferred by a microtask (ThreeSplatScene),
  // and three's Renderer.dispose() RESETS info — so a counter read after it
  // would be vacuously "flat". Flag it, and the teardown drill fails loudly if
  // that ordering ever changes.
  const renderer = handle.sparkScene.renderer as unknown as { dispose: () => void };
  const originalDispose = renderer.dispose.bind(renderer);
  renderer.dispose = () => {
    (booted as Booted).rendererDisposed = true;
    originalDispose();
  };
  return Object.assign(booted, { handle, host }) as Booted;
}

/** Fixed-step pump: drive the rail and paint, without waiting on rAF (a hidden
 *  pane runs none, and reveal is paint-observed). Never throws; returns the
 *  elapsed wall time so a drill can report it. */
async function pumpUntil(booted: Booted, done: () => boolean): Promise<number> {
  const t0 = performance.now();
  const { sparkScene, cameraRail } = booted.handle;
  // The runtime's construction is synchronous but its renderer's init is not
  // (ThreeSplatScene's sync facade), and render() before init throws by name.
  await sparkScene.ready.catch(() => {});
  while (!done() && performance.now() - t0 < WAIT_BOUND_MS) {
    cameraRail.update(1 / 60);
    sparkScene.renderer.render(sparkScene.scene, sparkScene.camera);
    await yieldMacrotask();
  }
  return performance.now() - t0;
}

/** The site-level progress contract of ruling Stop 5 (P1): strictly rising
 *  values below 1, then exactly one 1 at the last reveal. */
function checkProgress(values: number[]): [boolean, string] {
  const ones = values.filter((v) => v === 1).length;
  const beforeOne = values.slice(0, values.indexOf(1) === -1 ? values.length : values.indexOf(1));
  let rising = true;
  let prev = 0;
  for (const v of beforeOne) {
    if (!(v > prev) || v >= 1) rising = false;
    prev = v;
  }
  const oneIsLast = ones === 1 && values[values.length - 1] === 1;
  return [
    rising && oneIsLast,
    `${values.length} report(s) [${values.slice(0, 4).map((v) => v.toFixed(4)).join(", ")}${values.length > 4 ? ", …" : ""}]; strictly rising below 1=${rising}; exactly one 1 and it is last=${oneIsLast}`,
  ];
}

const done = (async () => {
  // ─── The latent semantic changes, each with a passing control ───
  // Both are pure config validation: no renderer, no GPU.

  let copyThrow = "";
  try {
    normalizeSiteConfig(structuredClone(throwCopyBlockSite));
  } catch (error) {
    copyThrow = error instanceof Error ? error.message : String(error);
  }
  let copyControl = "ok";
  try {
    normalizeSiteConfig(structuredClone(controlCopyBlockSite));
  } catch (error) {
    copyControl = `THREW ${error instanceof Error ? error.message : String(error)}`;
  }
  assert(
    "latent-throw-annotation-copy-block-id",
    /reserved for annotation "marker"/.test(copyThrow) && copyControl === "ok",
    `authored block "annotation-marker-copy" → ${JSON.stringify(copyThrow)}; control (block "marker-notes", same site otherwise) → ${copyControl}`,
  );

  let duplicateThrow = "";
  try {
    normalizeSiteConfig(structuredClone(throwDuplicateSite));
  } catch (error) {
    duplicateThrow = error instanceof Error ? error.message : String(error);
  }
  let duplicateControl = "ok";
  try {
    normalizeSiteConfig(structuredClone(controlDuplicateSite));
  } catch (error) {
    duplicateControl = `THREW ${error instanceof Error ? error.message : String(error)}`;
  }
  assert(
    "latent-throw-duplicate-show-blocks",
    /two show-blocks effects naming exactly the same blocks/.test(duplicateThrow) && duplicateControl === "ok",
    `two show-blocks effects naming ["note-a"] → ${JSON.stringify(duplicateThrow)}; control (one effect) → ${duplicateControl}`,
  );

  // ─── A scene the backend refuses on the spot (review finding 1, owner ruling) ───
  // ThreeGsBackend refuses .spz, .splat and an unknown extension SYNCHRONOUSLY
  // (ticket 08's refuse-immediately rule), and by then the runtime has built its
  // renderer, canvas, rail DOM and listeners. The refusal must fail the load
  // through the runtime's load-error path — never throw out of construction —
  // so the owner always receives a runtime it can dispose. The valid scene
  // BEFORE the refused one proves an earlier load stays owned and is freed.
  {
    const refusedSite = {
      ...structuredClone(obstacleSite),
      obstacles: [],
      scenes: [
        { id: "fixture", url: "/examples/assets/splat-lab/fixture.ply" },
        { id: "refused", url: "/examples/assets/splat-lab/refused.spz" },
      ],
    };
    const disposeCallsR: SplatHandle[] = [];
    const protoR = ThreeGsBackend.prototype as unknown as { dispose: (h: SplatHandle) => void };
    const originalDisposeR = protoR.dispose;
    protoR.dispose = function (this: ThreeGsBackend, handle: SplatHandle) {
      disposeCallsR.push(handle);
      return originalDisposeR.call(this, handle);
    };
    let refused: Booted | null = null;
    let refusedThrow = "";
    try {
      refused = boot(refusedSite);
    } catch (error) {
      refusedThrow = error instanceof SplatBackendError ? `${error.reason}: ${error.message}` : String(error);
    }
    if (refused === null) {
      // boot() appended the host before the runtime threw: whatever the runtime
      // built inside it is now ownerless.
      const orphan = container.lastElementChild as HTMLElement | null;
      const leftCanvas = orphan !== null && orphan.querySelector("canvas") !== null;
      assert(
        "refused-scene-fails-the-load-and-stays-disposable",
        false,
        `createSiteRuntime THREW ${JSON.stringify(refusedThrow)} — no runtime to dispose; left behind in the host: canvas=${leftCanvas}, ${orphan?.childElementCount ?? 0} element(s)`,
      );
      orphan?.remove();
    } else {
      const r = refused;
      const errorsAtReturn = r.errors.length;
      const baselineR = gpuMemoryCounters(r.handle.sparkScene.renderer);
      await pumpUntil(r, () => r.errors.length > 0 && r.handle.loadedScenes[0]?.visible === true);
      const loadedR = gpuMemoryCounters(r.handle.sparkScene.renderer);
      const firstError = r.errors[0];
      const reason = firstError instanceof SplatBackendError ? firstError.reason : String(firstError);
      const handlesR = r.handle.loadedScenes.map((entry) => entry.handle);
      const canvasBefore = r.host.contains(r.handle.sparkScene.canvas);
      r.handle.dispose();
      const afterR = gpuMemoryCounters(r.handle.sparkScene.renderer);
      const windowOpenR = !r.rendererDisposed;
      const freedThroughSeam = handlesR.length === 1 && disposeCallsR.length === 1 && disposeCallsR[0] === handlesR[0];
      assert(
        "refused-scene-fails-the-load-and-stays-disposable",
        errorsAtReturn === 0 && r.errors.length === 1 && reason === "spz-refused" &&
          r.handle.loadedScenes.length === 1 && r.handle.loadedScenes[0]!.visible === true &&
          r.ready === null && !r.progress.includes(1) &&
          windowOpenR && countersGrew(baselineR, loadedR) && countersEqual(baselineR, afterR) &&
          freedThroughSeam && canvasBefore && !r.host.contains(r.handle.sparkScene.canvas),
        `runtime returned; onLoadError at return=${errorsAtReturn}, after=${r.errors.length} (${JSON.stringify(reason)}); scenes owned=${r.handle.loadedScenes.length} (the valid one visible=${r.handle.loadedScenes[0]?.visible}); ready=${JSON.stringify(r.ready)}; progress=${JSON.stringify(r.progress)}; dispose: window open=${windowOpenR}, ${summarize(baselineR)} → ${summarize(loadedR)} → ${summarize(afterR)}, backend.dispose calls=${disposeCallsR.length} for the owned handle=${freedThroughSeam}; canvas attached ${canvasBefore} → ${r.host.contains(r.handle.sparkScene.canvas)}`,
      );
      r.host.remove();
    }
    protoR.dispose = originalDisposeR;
  }

  // ─── A real site.json: load, reveal, readiness ───

  const warnMark = warnings.length;
  const site = boot(labSite);
  const readyMs = await pumpUntil(site, () => site.ready !== null || site.errors.length > 0);
  assert(
    "real-site-ready",
    site.ready !== null &&
      site.ready.name === "portfolio-lab-p0-scaffold" &&
      site.ready.stopCount === 3 &&
      site.ready.initialStop?.id === "overview" &&
      site.handle.sparkScene.backend === expectedBackend &&
      site.handle.loadedScenes.length === 1 &&
      site.handle.loadedScenes[0]!.paged === true &&
      site.handle.loadedScenes[0]!.visible === true &&
      site.errors.length === 0,
    `backend=${site.handle.sparkScene.backend} (expected ${expectedBackend}); ready in ${readyMs.toFixed(0)} ms: ${JSON.stringify(site.ready)}; scenes=${site.handle.loadedScenes.length} paged=${site.handle.loadedScenes[0]?.paged} visible=${site.handle.loadedScenes[0]?.visible}; onLoadError=${site.errors.length}`,
  );

  const [progressOk, progressDetail] = checkProgress(site.progress);
  assert("site-progress-contract", progressOk, progressDetail);

  // Stop 6: the S5 contradiction warning's noise level on the pin's OWN site
  // (it authors paged: true + extSplats: true, which the format agrees with).
  const siteWarnings = contractWarningsSince(warnMark);
  assert(
    "s5-warning-noise-on-the-real-site",
    siteWarnings.length === 0,
    `${siteWarnings.length} contract warning(s) across the whole load: ${JSON.stringify(siteWarnings)}`,
  );

  // ─── Navigation ───

  const stopsBefore = site.stops.length;
  site.handle.goToStop(2);
  const travelMs = await pumpUntil(site, () => site.stops.length > stopsBefore);
  const announced = site.stops[site.stops.length - 1];
  await pumpUntil(site, () => site.handle.motionState === "idle");
  assert(
    "navigation-announces-arrival",
    announced?.id === "shelf" && announced.index === 2 && site.handle.cameraRail.currentStop === 2 &&
      site.handle.motionState === "idle" && site.handle.stopIndexById("workbench") === 1 &&
      site.handle.stopByIndex(0)?.id === "overview",
    `goToStop(2) → stopchanged ${JSON.stringify(announced)} after ${travelMs.toFixed(0)} ms; rail currentStop=${site.handle.cameraRail.currentStop}; motionState=${site.handle.motionState}; stopIndexById("workbench")=${site.handle.stopIndexById("workbench")}`,
  );

  // ─── Teardown through the seam (Stop 16, H1) ───
  // Counters are read SYNCHRONOUSLY after dispose() returns: the backend has
  // freed its buffers, and the renderer's own teardown (which resets info) is
  // still a microtask away. `rendererDisposed` proves that window was open.

  const disposeCalls: SplatHandle[] = [];
  const backendProto = ThreeGsBackend.prototype as unknown as { dispose: (h: SplatHandle) => void };
  const originalBackendDispose = backendProto.dispose;
  backendProto.dispose = function (this: ThreeGsBackend, handle: SplatHandle) {
    disposeCalls.push(handle);
    return originalBackendDispose.call(this, handle);
  };

  const teardown = boot(labSite);
  const baseline = gpuMemoryCounters(teardown.handle.sparkScene.renderer);
  await pumpUntil(teardown, () => teardown.ready !== null || teardown.errors.length > 0);
  const loaded = gpuMemoryCounters(teardown.handle.sparkScene.renderer);
  const rendersBefore = teardown.handle.sparkScene.renderCount;
  const canvasAttached = teardown.host.contains(teardown.handle.sparkScene.canvas);
  const handlesExpected = teardown.handle.loadedScenes.map((entry) => entry.handle);
  const meshChildrenBefore = teardown.handle.loadedScenes[0]!.mesh.children.length;

  teardown.handle.dispose();
  const afterDispose = gpuMemoryCounters(teardown.handle.sparkScene.renderer);
  const windowOpen = !teardown.rendererDisposed;

  const disposedThroughSeam = handlesExpected.every((h) => disposeCalls.includes(h)) &&
    disposeCalls.length === handlesExpected.length;
  backendProto.dispose = originalBackendDispose;

  await yieldMacrotask();
  const rendersAfter = teardown.handle.sparkScene.renderCount;
  assert(
    "teardown-frees-through-the-seam",
    windowOpen && countersGrew(baseline, loaded) && countersEqual(baseline, afterDispose) &&
      disposedThroughSeam && canvasAttached && !teardown.host.contains(teardown.handle.sparkScene.canvas) &&
      rendersAfter === rendersBefore && teardown.handle.loadedScenes[0]!.mesh.children.length === 0,
    `measuring window open (renderer not yet disposed)=${windowOpen}; baseline ${summarize(baseline)} → loaded ${summarize(loaded)} → after dispose ${summarize(afterDispose)}; grew=${countersGrew(baseline, loaded)} back to baseline=${countersEqual(baseline, afterDispose)}; backend.dispose calls=${disposeCalls.length} for ${handlesExpected.length} scene handle(s)=${disposedThroughSeam}; canvas attached ${canvasAttached} → ${teardown.host.contains(teardown.handle.sparkScene.canvas)}; mesh children ${meshChildrenBefore} → ${teardown.handle.loadedScenes[0]!.mesh.children.length}; renders frozen at ${rendersAfter} (was ${rendersBefore})`,
  );
  teardown.host.remove();

  // ─── Ten load→dispose cycles at runtime scope ───

  const heaps: number[] = [];
  const cycleFlat: boolean[] = [];
  for (let i = 0; i < 10; i++) {
    const cycle = boot(labSite);
    const cycleBaseline = gpuMemoryCounters(cycle.handle.sparkScene.renderer);
    await pumpUntil(cycle, () => cycle.ready !== null || cycle.errors.length > 0);
    const cycleLoaded = gpuMemoryCounters(cycle.handle.sparkScene.renderer);
    cycle.handle.dispose();
    const cycleAfter = gpuMemoryCounters(cycle.handle.sparkScene.renderer);
    cycleFlat.push(
      !cycle.rendererDisposed && countersGrew(cycleBaseline, cycleLoaded) && countersEqual(cycleBaseline, cycleAfter),
    );
    cycle.host.remove();
    // Sample the heap after a drain of yields: sampling while the disposed
    // graph is still unreachable-but-uncollected reads noise.
    for (let drain = 0; drain < 200; drain++) await yieldMacrotask();
    const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
    heaps.push(heap);
  }
  const strictlyIncreasing = heaps.every((h, i) => i === 0 || h > heaps[i - 1]!);
  assert(
    "runtime-h-life-10-cycles",
    cycleFlat.every(Boolean) && !strictlyIncreasing,
    `every cycle's renderer back to its pre-load counters (window open each time)=${cycleFlat.every(Boolean)} [${cycleFlat.map((f) => (f ? "1" : "0")).join("")}]; heaps=[${heaps.join(",")}] strictly increasing=${strictlyIncreasing}`,
  );

  site.handle.dispose();
  site.host.remove();

  // ─── Authored `lifetime` under the full runtime (ticket 01's re-sync) ───
  // The pin's own lm-lifetime site: activating "The poster" shows a world block
  // that ends ON TRAVEL, and activating "The keepsake" shows one that does not.
  // The keepsake is the control that tells "lifetime honoured" apart from
  // "travel cleared everything" — the trap ticket 01 closed.

  const life = boot(lmLifetimeSite);
  await pumpUntil(life, () => life.ready !== null || life.errors.length > 0);
  const markers = [...life.host.querySelectorAll("button")].filter(
    (el) => el.style.borderRadius === "50%",
  );
  const markerByTitle = (title: string): HTMLButtonElement | undefined =>
    markers.find((el) => el.getAttribute("aria-label") === title);
  // Count by LABEL, not by button: the runtime's own chrome (nav, engagement)
  // also renders round buttons into the same container.
  const annotationTitles = [
    "The plain marker", "The poster", "The keepsake", "The sentinel",
    "The tour guide", "The ghost", "The curator", "Rig probe",
  ];
  const markersFound = annotationTitles.filter((title) => markerByTitle(title) !== undefined).length;
  const poster = markerByTitle("The poster");
  const keepsake = markerByTitle("The keepsake");
  poster?.click();
  keepsake?.click();
  const surface = (id: string): unknown => life.handle.textSystem.getBlockSurface(id);
  await pumpUntil(life, () => surface("annotation-poster-effect-1") !== null && surface("annotation-keepsake-effect-1") !== null);
  const shownPoster = surface("annotation-poster-effect-1") !== null;
  const shownKeepsake = surface("annotation-keepsake-effect-1") !== null;
  life.handle.goToStop(1);
  await pumpUntil(life, () => surface("annotation-poster-effect-1") === null);
  const posterAfter = surface("annotation-poster-effect-1");
  const keepsakeAfter = surface("annotation-keepsake-effect-1");
  assert(
    "authored-lifetime-runs-under-the-runtime",
    markersFound === annotationTitles.length && shownPoster && shownKeepsake && posterAfter === null && keepsakeAfter !== null,
    `${markersFound} of ${annotationTitles.length} annotation markers found by label (${markers.length} round buttons in the container); activating them showed poster=${shownPoster} keepsake=${shownKeepsake}; after travelling to stop 1 — poster (lifetime until travel) mounted=${posterAfter !== null}, keepsake (until dismiss, the control) mounted=${keepsakeAfter !== null}`,
  );
  life.handle.dispose();
  life.host.remove();

  // ─── Author-mode obstacle outlines on this renderer (ticket 09 Stop 15) ───
  // The pin draws them with LineSegments2 + the classic LineMaterial, which
  // three's WebGPU node library has no mapping for: it logs "Material
  // "LineMaterial" is not compatible." and substitutes a plain node material,
  // on WebGPU AND on the WebGL2 fallback. Green means no such error and an
  // outline that actually renders — proven by removing it and seeing the
  // pixels change.
  // The error count starts BEFORE boot (review finding 3): three logs the
  // incompatible material ONCE, when it first builds it, and the outline exists
  // as soon as the author modules resolve — possibly while the ready-wait pump
  // below is still rendering, which a later mark would miss.

  const errorMark = consoleErrors.length;
  const authored = boot(obstacleSite, { author: true });
  await pumpUntil(authored, () => authored.ready !== null || authored.errors.length > 0);
  await authored.handle.authorReady.catch(() => {});
  await pumpUntil(authored, () => sceneOutlines(authored).length > 0);
  const outlines = sceneOutlines(authored);
  // A DENSE grid: a 3px outline crosses few pixels, so three sample points
  // would miss it and report "no change" whether or not it rendered.
  const { capture, captureSync } = createCapture(authored.handle.sparkScene, (W, H) => {
    const points: Record<string, [number, number]> = {};
    for (let col = 0; col < 31; col++) {
      for (let row = 0; row < 17; row++) {
        points[`c${col}r${row}`] = [
          Math.min(W - 1, Math.floor((W * (col + 0.5)) / 31)),
          Math.min(H - 1, Math.floor((H * (row + 0.5)) / 17)),
        ];
      }
    }
    return points;
  });
  const grab = async (): Promise<Record<string, number[] | string>> =>
    authored.handle.sparkScene.backend === "webgl2-fallback" ? captureSync() : await capture();
  const withOutline = await grab();
  for (const outline of outlines) outline.removeFromParent();
  const withoutOutline = await grab();
  for (const outline of outlines) authored.handle.sparkScene.scene.add(outline);
  const incompatible = consoleErrors.slice(errorMark).filter((e) => /is not compatible/.test(e));
  const changed = Object.keys(withOutline).filter(
    (key) => JSON.stringify(withOutline[key]) !== JSON.stringify(withoutOutline[key]),
  );
  const pixelsDiffer = changed.length > 0;
  assert(
    "author-obstacle-outlines-render",
    outlines.length === 1 && incompatible.length === 0 && pixelsDiffer,
    `${outlines.length} outline object(s), material ${(outlines[0] as { material?: { type?: string } } | undefined)?.material?.type ?? "none"}; "not compatible" errors while rendering=${incompatible.length} ${JSON.stringify(incompatible.slice(0, 1))}; removing the outline changes ${changed.length} of ${Object.keys(withOutline).length} sampled pixels (e.g. ${changed.slice(0, 3).map((k) => `${k} ${JSON.stringify(withOutline[k])}->${JSON.stringify(withoutOutline[k])}`).join(", ") || "none"})`,
  );
  authored.handle.dispose();
  authored.host.remove();


  // ─── §G — the rewired diagnostics stack on a REAL load (ticket 12) ────────
  //
  // Three claims, each on the backend this run selected:
  //   1. the stack still produces a complete record of a real paged load, now
  //      fed by our own counter door instead of a Spark adapter (AC2), with
  //      the CPU-budget denominator non-zero (AC3) and the record's own
  //      identity fields telling the truth (B2, B3);
  //   2. SiteRuntime registers its paged scenes again and marks first-splat
  //      at the reveal — A2 closed, G4 wired;
  //   3. consent PENDING constructs nothing at runtime level (G5's phase7
  //      evaluator), which is what un-defers the 21st self-test assertion.

  // --- 1. the stack, end to end, on the same paged asset the site uses ------
  const telemetryHost = document.createElement("div");
  telemetryHost.style.cssText = "position:absolute;left:0;top:0;width:256px;height:128px";
  container.appendChild(telemetryHost);
  const diagScene = new ThreeSplatScene({ container: telemetryHost, forceWebGL: expectedBackend === "webgl2-fallback" });
  await diagScene.ready.catch(() => {});
  const diagBackend = new ThreeGsBackend({ renderer: diagScene.renderer, createDecodeWorker });
  let diagRevealed = false;
  const diagHandle = loadSplat({
    url: PAGED_ASSET,
    backend: diagBackend,
    paged: true,
    onLoad: () => { diagRevealed = true; },
  });
  diagScene.scene.add(diagHandle.object);

  const telemetry = wireLoadTelemetry({
    options: {
      // Ephemeral only: the lab must not write to the browser's storage.
      consentHook: () => ({ ephemeralMeasurement: "granted", localPersistence: "denied", remoteTransmission: "denied" }),
    },
    authorMode: false,
    readCameraState: () => ({
      position: diagScene.camera.position.toArray() as [number, number, number],
      quaternion: diagScene.camera.quaternion.toArray() as [number, number, number, number],
      projectionMatrix: diagScene.camera.projectionMatrix.toArray(),
      verticalFovDegrees: diagScene.camera.fov,
      viewportWidthCssPx: 256,
      viewportHeightCssPx: 128,
      dpr: window.devicePixelRatio,
      foveation: {},
      pivot: [0, 0, 0],
    }),
  });
  telemetry.registerPagedScene({
    sceneId: "diag-hero",
    backend: diagBackend,
    handle: diagHandle,
    sceneUrl: PAGED_ASSET,
    backendKind: diagScene.backend,
  });

  // Render AND tick: `tick()` is what samples the door, and it is internally
  // throttled to 100 ms, so the pump has to actually spend wall time. The
  // renders are what make the denominator non-zero — that is the whole point
  // of AC3, so they are driven here rather than assumed.
  const diagT0 = performance.now();
  while (!diagRevealed && performance.now() - diagT0 < WAIT_BOUND_MS) {
    diagScene.renderer.render(diagScene.scene, diagScene.camera);
    telemetry.tick();
    await yieldMacrotask();
  }
  // Keep sampling past the reveal so residency and decode differences land in
  // the record rather than only the pre-reveal ramp.
  // An independent observer, so "a long task happened" is measured rather
  // than assumed by the same code under test.
  let independentLongTasks = 0;
  let independentLongestMs = 0;
  let longTaskObserverSupported = true;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        independentLongTasks += 1;
        independentLongestMs = Math.max(independentLongestMs, entry.duration);
      }
    }).observe({ type: "longtask" });
  } catch {
    longTaskObserverSupported = false;
  }
  const settleUntil = performance.now() + 1_200;
  while (performance.now() < settleUntil) {
    diagScene.renderer.render(diagScene.scene, diagScene.camera);
    telemetry.tick();
    // A REAL main-thread block, not a synthesised number: >50 ms is the
    // longtask threshold, so this is the thing the metric is meant to catch.
    const blockUntil = performance.now() + 120;
    while (performance.now() < blockUntil) { /* deliberate main-thread block */ }
    await yieldMacrotask();
  }

  const records = telemetry.exportRecords() as ReadonlyArray<{
    readonly identity: { readonly recordId: string };
    readonly versioning: Record<string, string>;
    readonly environment: Record<string, string>;
    readonly evidence: {
      readonly rawEvents: ReadonlyArray<{ readonly type: string }>;
      readonly derivedBlocks: ReadonlyArray<{ readonly name: string; readonly value: Record<string, unknown> }>;
    };
    readonly status: { readonly declaredGaps: readonly string[]; readonly probeStatus: string };
  }>;
  const record = records[0];
  // Snapshot the independent counter AT THE SAME INSTANT the record was
  // exported: the record is frozen here while the observer keeps counting,
  // so comparing the frozen snapshot against the live counter would fail for
  // the passage of time rather than for a dropped event.
  const independentAtExport = independentLongTasks;
  const eventTypes = new Set((record?.evidence.rawEvents ?? []).map((e) => e.type));
  const summaryBlock = record?.evidence.derivedBlocks.find((b) => b.name === "probe_summary");
  const renderedSampleWindows = Number(summaryBlock?.value.renderedSampleWindows ?? 0);
  const counts = diagBackend.counts(diagHandle);

  assert(
    "diag-record-produced-on-a-real-load",
    records.length === 1 && eventTypes.has("pager_snapshot") && eventTypes.has("gpu_upload") && eventTypes.has("decode"),
    `${records.length} record(s) from a real paged load (revealed=${diagRevealed}, resident=${counts.resident} of ${counts.total} splats); `
    + `event types present: ${[...eventTypes].sort().join(", ")}; declared gaps: ${record?.status.declaredGaps.join(", ") ?? "none"}`,
  );

  // AC3 — the §G trap, closed. The denominator's ONLY production feeder is
  // this source's `renderedFrame` flag, so that is what is measured here: a
  // second source is attached directly to the same live handle and its
  // events counted. (probe_summary.renderedSampleWindows is written only by
  // finalize() — LoadProbe.ts:521 is its single call site — and
  // exportRecords() is a checkpoint, so the block is legitimately absent
  // from the record read above; it is reported rather than asserted.)
  const flagProbe = new PagerTelemetrySource({
    backend: diagBackend, handle: diagHandle, sceneUrl: PAGED_ASSET,
    sceneLocalPagedId: "denominator-probe", now: () => performance.now(),
  });
  let flagTotal = 0;
  let flagWithRenderedFrame = 0;
  flagProbe.attach((event) => {
    if (event.type !== "pager_snapshot") return;
    flagTotal += 1;
    if (event.renderedFrame === true) flagWithRenderedFrame += 1;
  });
  const rendersBeforeFlag = diagBackend.pagerDiagnostics(diagHandle).renders;
  for (let index = 0; index < 12; index += 1) {
    diagScene.renderer.render(diagScene.scene, diagScene.camera);
    flagProbe.tick(performance.now());
    await yieldMacrotask();
  }
  const rendersAfterFlag = diagBackend.pagerDiagnostics(diagHandle).renders;
  flagProbe.dispose();
  assert(
    "diag-cpu-budget-denominator-fed",
    flagWithRenderedFrame > 0 && flagWithRenderedFrame === flagTotal && rendersAfterFlag > rendersBeforeFlag,
    `${flagWithRenderedFrame} of ${flagTotal} pager_snapshot event(s) declared renderedFrame while the pager's own counter `
    + `moved ${rendersBeforeFlag} → ${rendersAfterFlag} on ${expectedBackend}; probe_summary.renderedSampleWindows in the `
    + `checkpoint record=${renderedSampleWindows} (finalize-only block). One event per SAMPLE WINDOW, not per frame — the `
    + `pin's own cadence, named for what it counts (D35 item 5). The pin's only feeder was the deleted Spark adapter — unfed, every one `
    + `of these would read undefined and the ladder would sit at max(1, 0)`,
  );

  // B2 — the fossils are gone and the engine names itself.
  assert(
    "diag-record-versions-have-no-fossils",
    record?.versioning.engineVersion !== undefined
      && record?.versioning.engineVersion === REVISION
      && !("sparkVersion" in (record?.versioning ?? {}))
      && !("adapterVersion" in (record?.versioning ?? {}))
      && record?.versioning.semanticsVersion === "2",
    `versioning=${JSON.stringify(record?.versioning)}; three's own REVISION=${REVISION}; `
    + `sparkVersion present=${"sparkVersion" in (record?.versioning ?? {})}, adapterVersion present=${"adapterVersion" in (record?.versioning ?? {})}`,
  );

  // B3 — the record names the renderer that actually produced it.
  assert(
    "diag-record-names-its-real-backend",
    record?.environment.rendererClass === expectedBackend,
    `environment.rendererClass=${JSON.stringify(record?.environment.rendererClass)} on a ${expectedBackend} run `
    + `(today's pre-ticket code hardcoded "webgl" here, so a WebGPU run recorded itself as WebGL)`,
  );

  // Condition #11 (owner ruling 2026-09-20, option (c)): "longest main-thread
  // block" is one of the four metrics doc 05 names for this stack, and it was
  // STRUCTURALLY UNFED — LoadProbe aggregated longTaskDurationMs that nothing
  // ever set, so every record reported 0. RED, measured on this tree before
  // the observer existed: 20 real long tasks (longest 626 ms, confirmed by an
  // independent observer) produced 110 record events, 0 carrying a duration.
  //
  // This check does NOT require the browser to produce a long task. Measured
  // 2026-09-20: `longtask` is in `PerformanceObserver.supportedEntryTypes`
  // and `observe()` succeeds, yet eight deliberate 130 ms blocks produced
  // ZERO entries on the WebGL2 run of this hidden pane while the same code
  // produced ten on the WebGPU run. Long-task REPORTING is environmental, so
  // asserting that one occurs would make this fixture flaky for a reason that
  // has nothing to do with the code under test. Asserted instead: the emitter
  // works (deterministic), and nothing the browser DID report is dropped.
  const emitted: Array<{ cpuMs: number; operation: string; tagged: boolean }> = [];
  const emitterProbe = new PagerTelemetrySource({
    backend: diagBackend, handle: diagHandle, sceneUrl: PAGED_ASSET,
    sceneLocalPagedId: "long-task-emitter", now: () => performance.now(),
  });
  emitterProbe.attach((event) => {
    if (event.type !== "overhead") return;
    const payload = event.payload as { cpuMs: number; operation: string };
    emitted.push({ cpuMs: payload.cpuMs, operation: payload.operation, tagged: event.longTaskDurationMs === 137 });
  });
  emitterProbe.recordLongTask(137, performance.now());
  emitterProbe.recordLongTask(0, performance.now());   // refused: not a block
  emitterProbe.dispose();
  const recordedLongTasks = (record?.evidence.rawEvents ?? []).filter(
    (e) => e.type === "overhead" && (e as { payload?: { operation?: string } }).payload?.operation === "long_task",
  ).length;
  assert(
    "diag-longest-main-thread-block-fed",
    emitted.length === 1
      && emitted[0]!.cpuMs === 137
      && emitted[0]!.operation === "long_task"
      && emitted[0]!.tagged
      && recordedLongTasks >= independentAtExport,
    `emitter: ${emitted.length} event(s) from two calls (137 ms accepted, 0 ms refused), `
    + `carrying longTaskDurationMs=${emitted[0]?.tagged ? 137 : "absent"} — the field LoadProbe aggregates into `
    + `longTasks and that NOTHING in the tree set before this ticket. On this run the browser reported `
    + `${independentLongTasks} long task(s) independently (longest ${Math.round(independentLongestMs)} ms) and the record `
    + `carries ${recordedLongTasks}, so none were dropped`
    + (longTaskObserverSupported ? "" : " (longtask unobservable in this browser — the aggregate stays at its honest zero)"),
  );

  telemetry.dispose();
  diagBackend.dispose(diagHandle);
  diagScene.dispose();
  telemetryHost.remove();

  // --- 2. SiteRuntime registers paged scenes again (A2 closed, G4 wired) ---
  // Author mode wires the console report sink, and a record only reaches a
  // sink if registerPagedScene ran — so the summary line IS the proof that
  // the skip is gone. The site's hero is `paged: true`.
  const regMark = logs.length;
  const registered = boot(labSite, { author: true });
  await pumpUntil(registered, () => registered.ready !== null || registered.errors.length > 0);
  const registeredRevealed = registered.handle.loadedScenes[0]?.visible === true;
  registered.handle.dispose();
  registered.host.remove();
  // finalize() hands the revision to the sink fanout WITHOUT awaiting it, so
  // the console sink's line lands a microtask or two after dispose returns.
  await yieldMacrotask();
  await yieldMacrotask();
  const summaries = telemetrySummariesSince(regMark);
  assert(
    "siteruntime-registers-paged-scenes",
    registeredRevealed && summaries.length >= 1,
    `paged hero revealed=${registeredRevealed}; load-telemetry summaries emitted by the runtime's own wiring=${summaries.length} `
    + `(${summaries[0]?.slice(0, 140) ?? "none"}) — a record cannot exist unless registerPagedScene ran, which ticket 09's A2 skipped`,
  );

  // --- 3. G5 — the phase7 runtime-consent evaluator, here rather than on the
  // renderer-free diag page. Consent PENDING must construct nothing at runtime
  // level; the contrast case proves the check is not vacuous.
  const phase7RuntimeEvaluator = async (): Promise<{ expected: unknown; actual: unknown }> => {
    const pendingMark = logs.length;
    const pending = boot(labSite, {
      author: true,
      telemetry: { consentHook: () => ({ ephemeralMeasurement: "pending", localPersistence: "denied", remoteTransmission: "denied" }) },
    });
    await pumpUntil(pending, () => pending.ready !== null || pending.errors.length > 0);
    const pendingRevealed = pending.handle.loadedScenes[0]?.visible === true;
    pending.handle.dispose();
    pending.host.remove();
    await yieldMacrotask();
    await yieldMacrotask();
    const pendingSummaries = telemetrySummariesSince(pendingMark).length;

    const grantedMark = logs.length;
    const granted = boot(labSite, {
      author: true,
      telemetry: { consentHook: () => ({ ephemeralMeasurement: "granted", localPersistence: "denied", remoteTransmission: "denied" }) },
    });
    await pumpUntil(granted, () => granted.ready !== null || granted.errors.length > 0);
    granted.handle.dispose();
    granted.host.remove();
    await yieldMacrotask();
    await yieldMacrotask();
    const grantedSummaries = telemetrySummariesSince(grantedMark).length;

    return {
      expected: { pendingRecords: 0, grantedRecordsAtLeastOne: true, pendingSiteStillRevealed: true },
      actual: {
        pendingRecords: pendingSummaries,
        grantedRecordsAtLeastOne: grantedSummaries >= 1,
        pendingSiteStillRevealed: pendingRevealed,
      },
    };
  };

  const selfTest = await runSelfTest({ phase7AcceptanceEnabled: true, phase7RuntimeEvaluator });
  const phase7 = selfTest.assertions.find((a) => a.id === "phase7-runtime-consent");
  assert(
    "selftest-with-phase7-runtime-evaluator",
    selfTest.passed && selfTest.evaluatedCount === 16 && phase7?.status === "pass",
    `${selfTest.summaryLine} with the runtime evaluator injected (the renderer-free diag page reports 15/15 and leaves phase7 deferred); `
    + `phase7-runtime-consent=${phase7?.status}, actual=${JSON.stringify(phase7?.actual)}`,
  );

  assert(
    "no-unhandled-rejections",
    unhandledRejections === 0,
    `${unhandledRejections} unhandledrejection events across every runtime in this fixture`,
  );

  finishSummary();
  return { passed, failed };
})();

void done;
