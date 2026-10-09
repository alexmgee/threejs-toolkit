/**
 * hlife — H-LIFE ×10 and the end-to-end run on the WHOLE `<splat-site>` element
 * (ticket 13, owner ruling W3 a; doc 04's Phase 2 exit; AC3).
 *
 * Sites: `./sites/lab.site.json` and `./sites/lm-lifetime.site.json` — the pin's
 * own portfolio sites (fd67153:examples/portfolio/…) with one line changed, the
 * scene URL (ticket 09:504-509). Every site in both repos holds one scene, so a
 * scene swap is the product's own mechanism: a new `src` on the live element —
 * boot() fetches the site, mountRuntime() disposes the old runtime and mounts the
 * new one in the same viewport (src/embed/SplatSiteElement.ts:670-676, :905-1063).
 *
 * END TO END: the element on lab.site.json — load, `ready` with the site progress
 * contract (ruling Stop 5 P1), then every stop and back (goToStop 1 → 2 → 0, each
 * announced by `stopchanged` and the rail coming to rest).
 * H-LIFE ×N (default 10) on the SAME live element, alternating a src swap
 * (lab ↔ lm-lifetime) with a remove / re-append; the element is removed at the
 * end, so every runtime it ever held is torn down exactly once. Per runtime:
 *   - its renderer's counters (renderer.info.memory) read at first observation
 *     are its BASELINE, and must all be 0 — a baseline that holds nothing cannot
 *     hide a leak (on WebGL2 one empty render precedes the observation and
 *     allocates nothing; measured, so render calls are recorded, not required); at its
 *     steady point they must have GROWN; right after its dispose() returns they
 *     must equal the baseline EXACTLY — read in the window before the renderer's
 *     own deferred teardown resets them, the window proven open by a flag on
 *     renderer.dispose (site-lab's method, examples/site-lab/main.ts:226-235,
 *     :429-467);
 *   - its load runs to the H-LOAD harness's steady point (loadSettled,
 *     lod.admitting 0, selected > 0, held 5 frames; doc 06 D36 addendum item 10)
 *     before the next cycle, so every cycle disposes a complete load;
 *   - the JS heap is read after a 200-yield drain at that steady point. The
 *     series is judged by site-lab's standard — NOT strictly increasing
 *     (examples/site-lab/main.ts:485-495) — no tolerance invented (W3 a). Swap
 *     cycles have no empty moment (the old runtime goes as the new one mounts),
 *     so every reading is taken in the same state: one site loaded and steady.
 *
 * The run's own frame names no runtime: the first mount and each cycle run in
 * helpers (mountFirst, runCycle) whose variables end when they return, and every
 * heap reading and the READOUTS are taken after those helpers return. A runtime's
 * record drops it on disposal and the load list is cleared once a load is steady,
 * so after a teardown only numbers remain and the readings measure the product,
 * not this page (a retained WebGL2 runtime holds its texture arrays). CORRECTED
 * 2026-09-27 (ticket 13, finding HF-1): an earlier version made this claim while
 * its run function still held runtime 0 and the last cycle's old and new runtimes.
 * READOUTS after the final teardown (reported, not gated — the ruling set the gates): which
 * of the runtimes, renderers and splat meshes the garbage collector actually freed under
 * allocation pressure (a FinalizationRegistry, which keeps nothing alive) — whether anything
 * still holds a torn-down runtime — and then the idle heap (site-lab's empty state), read
 * after those collection rounds and more than 50 ms after the page's previous heap reading
 * (HEAP_REFRESH_MS; ticket 13, OBSERVATION IH-1). The reading counts ArrayBuffer memory too,
 * so it can still hold the last pressure round's dropped arrays if they are not yet collected.
 * Frames: by default the element's own loop — a VISIBLE tab (the owner's Chrome);
 * `?pump=1` drives rail + render from the page for the hidden built-in pane, which
 * runs no animation frames (logic only). `?webgl=1` hides navigator.gpu before any
 * module loads (hlife.html). `?cycles=N` shortens a logic or plant run.
 * Plants (URL only, never source; red-first): `gpu-leak` uploads a texture the runtime
 * does not own on each runtime's renderer before its disposal; `heap-grow` retains
 * `?leakmb=` (default 512) MB per cycle; `skip-stop` skips stop 1; `expect-other`
 * flips the expected backend; `restless` (pumped runs only) keeps the rail moving once
 * stop 2 is announced, so that arrival never comes to rest.
 * Results: the page (assertions, then the JSON record and its sha256), the console,
 * and localStorage `t13-hlife-v1` (one record per run).
 */

import * as THREE from "three/webgpu";
import { defineSplatSite } from "@toolkit/index";
import { ThreeGsBackend } from "@toolkit/backend/ThreeGsBackend";

const params = new URLSearchParams(location.search);
const PUMP = params.get("pump") === "1";
const CYCLES = Math.max(1, Math.floor(Number(params.get("cycles") ?? 10)) || 10);
/** One or more plants, comma-separated — each acts on its own check only. */
const PLANTS = new Set((params.get("plant") ?? "").split(",").filter((name) => name !== ""));
const PLANT_LABEL = [...PLANTS].join(",") || null;
const LEAK_MB = Math.max(1, Number(params.get("leakmb") ?? 512) || 512);
const RUN = params.get("v") ?? `run-${Date.now()}`;
const askedWebgl = params.get("webgl") === "1";
const expectedBackend = askedWebgl !== PLANTS.has("expect-other") ? "webgl2-fallback" : "webgpu";
const SITES = { lab: "./sites/lab.site.json", lm: "./sites/lm-lifetime.site.json" } as const;
type SiteKey = keyof typeof SITES;
const WAIT_BOUND_MS = 240_000;
const STEADY_FRAMES = 5;
const DRAIN_YIELDS = 200;
const STORE_KEY = "t13-hlife-v1";

const viewer = document.getElementById("viewer")!;
const out = document.getElementById("out")!;
const hudElement = document.getElementById("hud")!;
function hud(text: string): void {
  hudElement.textContent = `hlife ${RUN} (${PUMP ? "pumped" : "own loop"}, expect ${expectedBackend}${PLANT_LABEL !== null ? `, plant ${PLANT_LABEL}` : ""})\n${text}`;
}

// ─── Assertions ───

interface Assertion {
  name: string;
  pass: boolean;
  detail: string;
}
const assertions: Assertion[] = [];
function assert(name: string, pass: boolean, detail: string): void {
  assertions.push({ name, pass, detail });
  const div = document.createElement("div");
  div.className = `assertion ${pass ? "pass" : "fail"}`;
  div.textContent = `${pass ? "PASS" : "FAIL"} — ${name}: ${detail}`;
  out.appendChild(div);
  console.log(`hlife ${pass ? "PASS" : "FAIL"} ${name} — ${detail}`);
}

// ─── Waiting without the page's frames (pumped) or on them (own loop) ───

const yieldResolvers: Array<() => void> = [];
const yieldChannel = new MessageChannel();
yieldChannel.port1.onmessage = () => yieldResolvers.shift()?.();
function yieldMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    yieldResolvers.push(resolve);
    yieldChannel.port2.postMessage(0);
  });
}

/** One animation frame — or one second, so a hidden tab (no frames) still
 *  reaches its time bound instead of hanging. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 1000);
  });
}

// ─── The element's runtime (TS-private, read at runtime) ───

interface Runtime {
  sparkScene: {
    renderer: {
      info: { memory: unknown; render: { calls: number } };
      dispose: () => void;
      render: (scene: unknown, camera: unknown) => unknown;
      initTexture: (texture: THREE.Texture) => void;
    };
    scene: THREE.Scene;
    camera: THREE.Camera;
    backend?: string;
  };
  cameraRail: { update: (deltaSeconds: number) => void; setProgress: (t: number) => void; readonly progress: number };
  loadedScenes: ReadonlyArray<{ mesh: object }>;
  motionState: string;
  dispose: () => void;
}
function runtimeOf(el: Element): Runtime | null {
  return (el as unknown as { runtime?: Runtime | null }).runtime ?? null;
}

/** Plant `restless`: the event index after which an announced stop starts the nudge in
 *  pump(); null when the plant is not acting. */
let restlessFrom: number | null = null;

/** Pumped mode only: advance the rail and paint the CURRENT runtime once. */
function pump(el: Element): void {
  const runtime = runtimeOf(el);
  if (runtime === null) return;
  runtime.cameraRail.update(1 / 60);
  // Plant `restless`: once its leg's stop is announced, scrub the rail in place every
  // frame (after the update, before the arrival is read), so it never comes to rest.
  if (restlessFrom !== null && events.slice(restlessFrom).some((e) => e.type === "stopchanged")) {
    runtime.cameraRail.setProgress(runtime.cameraRail.progress);
  }
  try {
    runtime.sparkScene.renderer.render(runtime.sparkScene.scene, runtime.sparkScene.camera);
  } catch {
    // Before the renderer's init settles, render() refuses by name — keep going.
  }
}

async function waitFor(el: Element, done: () => boolean, boundMs = WAIT_BOUND_MS): Promise<{ ok: boolean; ms: number }> {
  const t0 = performance.now();
  while (performance.now() - t0 < boundMs) {
    if (PUMP) pump(el);
    if (done()) return { ok: true, ms: performance.now() - t0 };
    if (PUMP) await yieldMacrotask();
    else await nextFrame();
  }
  return { ok: done(), ms: performance.now() - t0 };
}

async function drain(): Promise<void> {
  for (let i = 0; i < DRAIN_YIELDS; i++) await yieldMacrotask();
}

// ─── Counters (site-lab's keys and comparisons, examples/site-lab/main.ts:140-179) ───

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
    if (typeof v !== "number") throw new Error(`renderer.info.memory.${key} missing — the H-LIFE gate cannot run`);
    counters[key] = v;
  }
  return counters;
}
const countersEqual = (a: GpuCounters, b: GpuCounters): boolean => GPU_COUNTER_KEYS.every((k) => a[k] === b[k]);
const countersGrew = (baseline: GpuCounters, loaded: GpuCounters): boolean =>
  GPU_COUNTER_KEYS.some((k) => loaded[k] > baseline[k]);
const summarize = (c: GpuCounters | null): string =>
  c === null
    ? "—"
    : `storage ${c.storageAttributes}/${c.storageAttributesSize}B, attributes ${c.attributes}, geometries ${c.geometries}, textures ${c.textures}/${c.texturesSize}B`;

/** Chromium refreshes performance.memory at most once per 50 ms, counted from its last
 *  refresh, and refreshes only when it is read (kFiftyMs and HeapSizeCache::MaybeUpdate,
 *  third_party/blink/renderer/core/timing/memory_info.cc; probe 2 measured changes 50.0-52.2 ms
 *  apart — ticket 13, IH-1). So a read more than 50 ms after the previous read is fresh. */
const HEAP_REFRESH_MS = 50;
let lastHeapReadMs = Number.NEGATIVE_INFINITY;
function heapBytes(): number | null {
  lastHeapReadMs = performance.now();
  return (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
}

// ─── The backend each runtime created (observation hook; hload's pattern) ───

interface Door {
  pagerDiagnostics(handle: unknown): { loadSettled: boolean; lod: { admitting: number; selectedCount: number } };
}
const loads: Array<{ backend: Door; renderer: unknown; handle: unknown }> = [];
const backendProto = ThreeGsBackend.prototype as unknown as { load: (this: unknown, source: unknown) => unknown };
const originalLoad = backendProto.load;
backendProto.load = function (this: unknown, source: unknown): unknown {
  const handle = originalLoad.call(this, source);
  loads.push({ backend: this as Door, renderer: (this as { renderer?: unknown }).renderer, handle });
  return handle;
};

// ─── What the collector frees (a readout; FinalizationRegistry keeps nothing alive) ───

const collected = new Set<string>();
const collection = new FinalizationRegistry<string>((key) => collected.add(key));
const watched: string[] = [];
function watchCollection(target: object, key: string): void {
  collection.register(target, key);
  watched.push(key);
}
const COLLECTION_ROUNDS = 40;

// ─── Per-runtime record ───

interface Observed {
  index: number;
  site: SiteKey;
  cause: "first" | "swap" | "readd";
  /** Null once disposed: the page must not keep a torn-down runtime alive. */
  runtime: Runtime | null;
  backend: string | undefined;
  baseline: GpuCounters;
  baselineRenderCalls: number;
  loaded: GpuCounters | null;
  after: GpuCounters | null;
  windowOpen: boolean | null;
  rendererDisposed: boolean;
  readyMs: number | null;
  steadyMs: number | null;
  heapBytes: number | null;
}

function observe(runtime: Runtime, index: number, site: SiteKey, cause: Observed["cause"]): Observed {
  const renderer = runtime.sparkScene.renderer;
  const obs: Observed = {
    index,
    site,
    cause,
    runtime,
    // Read at the steady point: the renderer picks its backend during its async
    // init, so at first observation the field does not exist yet.
    backend: undefined,
    baseline: gpuMemoryCounters(renderer),
    baselineRenderCalls: renderer.info.render.calls,
    loaded: null,
    after: null,
    windowOpen: null,
    rendererDisposed: false,
    readyMs: null,
    steadyMs: null,
    heapBytes: null,
  };
  watchCollection(runtime, `runtime ${index}`);
  watchCollection(renderer, `renderer ${index}`);
  const originalRendererDispose = renderer.dispose.bind(renderer);
  renderer.dispose = () => {
    obs.rendererDisposed = true;
    originalRendererDispose();
  };
  const originalDispose = runtime.dispose;
  runtime.dispose = () => {
    try {
      originalDispose();
      // Synchronously after dispose() returns: the backend has freed its buffers and
      // the renderer's own teardown (which resets info) is still a microtask away.
      obs.after = gpuMemoryCounters(renderer);
      obs.windowOpen = !obs.rendererDisposed;
    } finally {
      // Even when dispose() throws, the page must not keep the runtime it tore down.
      obs.runtime = null;
    }
  };
  return obs;
}

/** Poll (macrotask yields, no frames) until the element holds a runtime other
 *  than `previous` — well before that runtime's renderer finishes its async init. */
async function nextRuntime(el: Element, previous: Runtime | null): Promise<Runtime | null> {
  const t0 = performance.now();
  while (performance.now() - t0 < WAIT_BOUND_MS) {
    const runtime = runtimeOf(el);
    if (runtime !== null && runtime !== previous) return runtime;
    await yieldMacrotask();
  }
  return null;
}

function steadyProbe(obs: Observed): () => boolean {
  let held = 0;
  const renderer = obs.runtime?.sparkScene.renderer;
  return () => {
    const load = [...loads].reverse().find((l) => renderer !== undefined && l.renderer === renderer);
    if (load === undefined) return false;
    let d: ReturnType<Door["pagerDiagnostics"]>;
    try {
      d = load.backend.pagerDiagnostics(load.handle);
    } catch {
      held = 0;
      return false;
    }
    held = d.loadSettled && d.lod.admitting === 0 && d.lod.selectedCount > 0 ? held + 1 : 0;
    return held >= STEADY_FRAMES;
  };
}

// ─── Plants ───

const heapLeak: Uint8Array[] = [];
/** `gpu-leak`: a texture the runtime does not own, uploaded on its renderer — its dispose()
 *  cannot free it, so the counters must show it. CHANGED 2026-10-05 (ticket 13, R2-4): the plant
 *  used to draw a small mesh into the runtime's scene, and that kept the last runtime alive.
 *  three's shared TSL node `modelWorldMatrix` keeps the last object it drew
 *  (`this.object3d = frame.object`, three/src/nodes/accessors/ModelNode.js:44); a drawn mesh's
 *  geometry and material keep the dispose listeners its render object registered
 *  (three/src/renderers/common/RenderObject.js:346-347), and a render object holds its renderer
 *  (:106). The splat mesh never draws through that node, so only the page's mesh was left in it.
 *  An upload touches no shared node. */
function plantGpuLeak(obs: Observed): void {
  const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  texture.needsUpdate = true;
  obs.runtime!.sparkScene.renderer.initTexture(texture);
}

// ─── The run's steps that hold a runtime (helpers, so the run's frame never does) ───

/** Runtime 0, observed. Only its record leaves this helper (finding HF-1). */
async function mountFirst(el: Element, site: SiteKey): Promise<Observed> {
  const runtime = await nextRuntime(el, null);
  if (runtime === null) throw new Error("the element never produced a runtime");
  return observe(runtime, 0, site, "first");
}

interface CycleResult {
  site: SiteKey;
  /** The cycle's runtime, observed; null when none mounted. */
  next: Observed | null;
  steady: boolean;
  notes: string[];
}

/** One H-LIFE cycle on the live element: tear the current runtime down by a src swap
 *  or a remove / re-append, then observe the next one to its steady point. The heap
 *  is read by the caller AFTER this returns: until then this frame still names the
 *  runtime it tore down (finding HF-1). */
async function runCycle(el: Element, current: Observed, cycle: number, site: SiteKey): Promise<CycleResult> {
  const cause: Observed["cause"] = cycle % 2 === 1 ? "swap" : "readd";
  hud(`H-LIFE cycle ${cycle}/${CYCLES} — ${cause} (${site} loaded)`);
  if (PLANTS.has("gpu-leak")) plantGpuLeak(current);
  const previousRuntime = current.runtime;
  const mark = events.length;
  let nextSite = site;
  if (cause === "swap") {
    nextSite = site === "lab" ? "lm" : "lab";
    el.setAttribute("src", SITES[nextSite]);
  } else {
    el.remove();
    await yieldMacrotask();
    viewer.appendChild(el);
  }
  const runtime = await nextRuntime(el, previousRuntime);
  if (runtime === null) return { site: nextSite, next: null, steady: false, notes: [`cycle ${cycle}: no new runtime`] };
  const notes: string[] = [];
  if (current.after === null) {
    notes.push(`cycle ${cycle}: the previous runtime was not disposed before the next mounted`);
  }
  const next = observe(runtime, cycle, nextSite, cause);
  if (!(await waitReadyAndSteady(el, next, mark))) {
    notes.push(`cycle ${cycle}: never reached ready + steady`);
    return { site: nextSite, next, steady: false, notes };
  }
  return { site: nextSite, next, steady: true, notes };
}

// ─── The run ───

interface ElementEvent {
  type: string;
  t: number;
  detail: unknown;
}
const events: ElementEvent[] = [];
const visibility: Array<{ t: number; state: DocumentVisibilityState }> = [
  { t: performance.now(), state: document.visibilityState },
];
document.addEventListener("visibilitychange", () => {
  visibility.push({ t: performance.now(), state: document.visibilityState });
});
const pageErrors: string[] = [];
window.addEventListener("error", (ev) => pageErrors.push(`error: ${String(ev.message)}`));
window.addEventListener("unhandledrejection", (ev) => pageErrors.push(`unhandledrejection: ${String(ev.reason)}`));

function eventsSince(mark: number, type: string): ElementEvent[] {
  return events.slice(mark).filter((e) => e.type === type);
}

async function waitReadyAndSteady(el: Element, obs: Observed, mark: number): Promise<boolean> {
  const t0 = performance.now();
  const ready = await waitFor(el, () => eventsSince(mark, "ready").length > 0 || eventsSince(mark, "loaderror").length > 0);
  if (!ready.ok || eventsSince(mark, "ready").length === 0) return false;
  obs.readyMs = performance.now() - t0;
  const steady = await waitFor(el, steadyProbe(obs));
  if (!steady.ok) return false;
  obs.steadyMs = performance.now() - t0;
  obs.loaded = gpuMemoryCounters(obs.runtime!.sparkScene.renderer);
  obs.backend = obs.runtime!.sparkScene.backend;
  const mesh = obs.runtime!.loadedScenes[0]?.mesh;
  if (mesh !== undefined) watchCollection(mesh, `mesh ${obs.index}`);
  loads.length = 0; // the load is steady: forget its backend (it would pin the disposed scene)
  return true;
}

async function measureHeap(obs: Observed): Promise<void> {
  if (PLANTS.has("heap-grow")) heapLeak.push(new Uint8Array(LEAK_MB * 1048576).fill(1));
  await drain();
  obs.heapBytes = heapBytes();
}

const done = (async () => {
  defineSplatSite();
  const el = document.createElement("splat-site");
  for (const type of ["loadstart", "ready", "loadprogress", "loaderror", "stopchanged"]) {
    el.addEventListener(type, (event) => {
      events.push({ type, t: performance.now(), detail: (event as CustomEvent<unknown>).detail });
    });
  }
  const observed: Observed[] = [];
  let cyclesOk = true;
  const cycleNotes: string[] = [];

  // ─── End to end: lab.site.json, ready, every stop and back ───
  hud("end to end — loading lab.site.json");
  let site: SiteKey = "lab";
  const mark = events.length;
  el.setAttribute("src", SITES.lab);
  viewer.appendChild(el);
  let current = await mountFirst(el, site);
  observed.push(current);
  const firstLoaded = await waitReadyAndSteady(el, current, mark);
  if (!firstLoaded) {
    cyclesOk = false;
    cycleNotes.push("the first load never reached ready + steady");
  }
  await measureHeap(current);
  const readyDetail = (eventsSince(mark, "ready")[0]?.detail ?? null) as {
    stopCount?: number;
    initialStop?: { index?: number; id?: string };
  } | null;
  const progressValues = eventsSince(mark, "loadprogress").map((e) => (e.detail as { progress: number }).progress);

  const stopMark = events.length;
  const targets = PLANTS.has("skip-stop") ? [2, 0] : [1, 2, 0];
  const arrivals: string[] = [];
  let everyArrivalAtRest = true;
  for (const target of targets) {
    hud(`end to end — travelling to stop ${target}`);
    const before = eventsSince(stopMark, "stopchanged").length;
    restlessFrom = PLANTS.has("restless") && target === 2 ? events.length : null;
    (el as unknown as { goToStop(index: number): void }).goToStop(target);
    const arrived = await waitFor(
      el,
      () =>
        eventsSince(stopMark, "stopchanged").length > before &&
        runtimeOf(el)?.motionState === "idle",
    );
    restlessFrom = null;
    if (!arrived.ok) everyArrivalAtRest = false;
    const last = eventsSince(stopMark, "stopchanged").slice(-1)[0]?.detail as { index?: number; id?: string } | undefined;
    arrivals.push(`${target}→${arrived.ok ? `${last?.index}/${last?.id} in ${arrived.ms.toFixed(0)} ms` : "never"}`);
  }
  const announced = eventsSince(stopMark, "stopchanged").map((e) => (e.detail as { index?: number }).index);

  // ─── H-LIFE ×N on the same live element ───
  for (let cycle = 1; cycle <= CYCLES; cycle++) {
    const result = await runCycle(el, current, cycle, site);
    site = result.site;
    if (result.next !== null) observed.push(result.next);
    if (result.notes.length > 0) {
      cyclesOk = false;
      cycleNotes.push(...result.notes);
    }
    if (!result.steady || result.next === null) break;
    await measureHeap(result.next);
    current = result.next;
  }

  // The last runtime is torn down too: every runtime the element held, once.
  hud("final teardown");
  if (PLANTS.has("gpu-leak")) plantGpuLeak(current);
  el.remove();
  await yieldMacrotask();

  // ─── Readouts after the teardown: what the collector frees, then the idle heap ───
  hud("after teardown — the collection readout, then the idle heap");
  await drain();
  let pressureRounds = 0;
  while (pressureRounds < COLLECTION_ROUNDS && collected.size < watched.length) {
    let junk: Float64Array[] | null = [];
    for (let i = 0; i < 8; i++) junk.push(new Float64Array(4 * 1048576)); // 8 x 32 MB, dropped at once
    junk = null;
    await new Promise((resolve) => setTimeout(resolve, 250));
    pressureRounds++;
  }
  const notCollected = watched.filter((key) => !collected.has(key));
  // After the collection rounds, and past performance.memory's refresh window (IH-1).
  while (performance.now() - lastHeapReadMs <= HEAP_REFRESH_MS) await yieldMacrotask();
  const idleHeap = heapBytes();
  const readout =
    `after teardown: idle heap ${idleHeap === null ? "null" : (idleHeap / 1048576).toFixed(1)} MB; ` +
    `collected ${watched.length - notCollected.length} of ${watched.length} (runtimes, renderers, splat meshes) ` +
    `after ${pressureRounds} pressure round(s)${notCollected.length > 0 ? `; NOT collected: ${notCollected.join(", ")}` : ""}`;
  const readoutDiv = document.createElement("div");
  readoutDiv.className = "readout";
  readoutDiv.textContent = `READOUT — ${readout}`;
  out.appendChild(readoutDiv);
  console.log(`hlife READOUT ${readout}`);

  // ─── Verdicts ───
  const backends = observed.map((o) => o.backend);
  assert(
    "backend-as-expected",
    backends.every((b) => b === expectedBackend),
    `expected ${expectedBackend}; every runtime's backend [${backends.join(", ")}]`,
  );

  const [progressOk, progressDetail] = checkProgress(progressValues);
  const readyOk =
    readyDetail !== null && readyDetail.stopCount === 3 && readyDetail.initialStop?.index === 0 &&
    readyDetail.initialStop.id === "overview";
  assert(
    "e2e-ready-and-progress",
    firstLoaded && readyOk && progressOk,
    `lab.site.json ready=${JSON.stringify(readyDetail)}; progress: ${progressDetail}`,
  );
  assert(
    "e2e-every-stop-and-back",
    everyArrivalAtRest && JSON.stringify(announced) === JSON.stringify([1, 2, 0]),
    `goToStop ${targets.join(" → ")}: ${arrivals.join("; ")}; every arrival at rest=${everyArrivalAtRest}; announced [${announced.join(", ")}] (expected [1, 2, 0])`,
  );

  const perRuntime = observed.map((o) => {
    const exact = o.after !== null && countersEqual(o.baseline, o.after);
    const grew = o.loaded !== null && countersGrew(o.baseline, o.loaded);
    const emptyBaseline = GPU_COUNTER_KEYS.every((k) => o.baseline[k] === 0);
    return { o, ok: exact && grew && o.windowOpen === true && emptyBaseline };
  });
  assert(
    "hlife-counters-back-to-baseline-exactly",
    perRuntime.length === CYCLES + 1 && perRuntime.every((r) => r.ok),
    `${perRuntime.length} runtime(s) (expected ${CYCLES + 1}), each torn down once: [${perRuntime
      .map((r) => (r.ok ? "1" : "0"))
      .join("")}]` +
      perRuntime
        .filter((r) => !r.ok)
        .map(
          (r) =>
            `; runtime ${r.o.index} (${r.o.cause}, ${r.o.site}): baseline ${summarize(r.o.baseline)} (render calls ${r.o.baselineRenderCalls}) → loaded ${summarize(r.o.loaded)} → after dispose ${summarize(r.o.after)}, window open=${r.o.windowOpen}`,
        )
        .join("") +
      (perRuntime.length > 0 ? `; runtime 0: baseline ${summarize(perRuntime[0]!.o.baseline)} → loaded ${summarize(perRuntime[0]!.o.loaded)} → after ${summarize(perRuntime[0]!.o.after)}` : ""),
  );

  const heaps = observed.map((o) => o.heapBytes);
  const heapKnown = heaps.every((h): h is number => h !== null);
  const strictlyIncreasing = heapKnown && heaps.every((h, i) => i === 0 || h! > heaps[i - 1]!);
  assert(
    "hlife-heap-not-strictly-increasing",
    heapKnown && heaps.length === CYCLES + 1 && !strictlyIncreasing,
    `heap at each steady point (MB, site): [${observed
      .map((o) => `${o.heapBytes === null ? "null" : (o.heapBytes / 1048576).toFixed(1)} ${o.site}`)
      .join(", ")}] strictly increasing=${strictlyIncreasing}${PLANTS.has("heap-grow") ? ` (plant: +${LEAK_MB} MB retained per cycle)` : ""}`,
  );

  const loadErrors = events.filter((e) => e.type === "loaderror").length;
  assert(
    "hlife-every-cycle-ready-and-steady",
    cyclesOk && loadErrors === 0 && pageErrors.length === 0,
    `${observed.length} load(s); ready ms [${observed.map((o) => (o.readyMs === null ? "—" : o.readyMs.toFixed(0))).join(", ")}]; steady ms [${observed
      .map((o) => (o.steadyMs === null ? "—" : o.steadyMs.toFixed(0)))
      .join(", ")}]; loaderror ${loadErrors}; page errors ${pageErrors.length}${pageErrors.length > 0 ? ` (${pageErrors.slice(0, 2).join(" | ")})` : ""}${cycleNotes.length > 0 ? `; ${cycleNotes.join("; ")}` : ""}`,
  );

  const everHidden = visibility.some((v) => v.state !== "visible");
  assert(
    "visible-throughout",
    PUMP || !everHidden,
    PUMP
      ? `pumped (the built-in pane) — frames driven by the page, not a visitor run; visibility ${visibility.map((v) => v.state).join(" → ")}`
      : `own loop; visibility ${visibility.map((v) => `${v.state}@${v.t.toFixed(0)}`).join(" → ")}`,
  );

  // ─── Record ───
  const passed = assertions.filter((a) => a.pass).length;
  const failed = assertions.length - passed;
  const record = {
    run: RUN,
    date: new Date().toISOString(),
    mode: PUMP ? "pumped" : "own-loop",
    plant: PLANT_LABEL,
    expectedBackend,
    cycles: CYCLES,
    userAgent: navigator.userAgent,
    devicePixelRatio,
    window: [innerWidth, innerHeight],
    e2e: { readyDetail, progressValues, targets, arrivals, announced },
    runtimes: observed.map((o) => ({
      index: o.index,
      cause: o.cause,
      site: o.site,
      backend: o.backend,
      baselineRenderCalls: o.baselineRenderCalls,
      baseline: o.baseline,
      loaded: o.loaded,
      after: o.after,
      windowOpen: o.windowOpen,
      readyMs: o.readyMs,
      steadyMs: o.steadyMs,
      heapBytes: o.heapBytes,
    })),
    afterTeardown: {
      idleHeapBytes: idleHeap,
      watched,
      notCollected,
      pressureRounds,
    },
    visibility,
    pageErrors,
    assertions,
    summary: `${passed} passed, ${failed} failed`,
  };
  const json = JSON.stringify(record);
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json)))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  try {
    const all = JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]") as unknown[];
    all.push(record);
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    // Storage is a convenience copy; the page and console carry the record.
  }
  const heading = document.createElement("h2");
  heading.className = failed === 0 ? "pass" : "fail";
  heading.textContent = `hlife: ${passed} passed, ${failed} failed`;
  out.appendChild(heading);
  const pre = document.createElement("pre");
  pre.id = "record";
  pre.textContent = `RECORD sha256 ${digest} (${json.length} chars)\n${json}`;
  out.appendChild(pre);
  console.log(`hlife RESULT ${passed} passed, ${failed} failed — record sha256 ${digest}`);
  hud(`DONE — ${passed} passed, ${failed} failed`);
})();

done.catch((error: unknown) => {
  assert("hlife-ran", false, `the run threw — ${String(error)}`);
  hud(`THREW — ${String(error)}`);
});

/** The site-level progress contract of ruling Stop 5 (P1), copied from
 *  examples/site-lab/main.ts:256-272: strictly rising values below 1, then
 *  exactly one 1 at the last reveal. */
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
