/**
 * hload — the Phase 2 H-LOAD trial harness (ticket 13; doc 05 H-LOAD; doc 06 D36 + addendum).
 *
 * The spike's own instrument (`spikes/native-rad/src/measure.ts`), re-hosted on the PRODUCT: the
 * `<splat-site>` element booted on `examples/site-lab/sites/lab.site.json` (ruling Q1b). One page
 * load = one trial of one configuration; `?auto=1` self-sequences 5 clean trials x {webgpu,
 * webgl2} x {derived default, `?pages=32`} in the spike's order, re-running any trial that was
 * ever hidden (the spike's rule, measure.ts:194-198) or failed an environmental check. Records
 * persist to localStorage; `window.__hload.report()` aggregates. Run it in a VISIBLE tab (Q1).
 *
 * URL: `?[pages=32][&webgl=1][&telemetry=1][&auto=1][&v=<id>][&plant=<name>]`
 *
 * Two SETS (doc 06 D36 addendum item 11): the counted trials at the product's VISITOR default
 * (telemetry off); `&telemetry=1` is the separate opt-in set — the site's own settings.telemetry,
 * its own configuration names, its own attempt cap — that supplies the load record's figures and
 * the measured cost of telemetry itself. Each trial proves which set it was: one new finalized
 * load record for opt-in, none for the visitor default.
 *
 * Definitions and methods — doc 06 D36 + addendum:
 *  - first-pixel: the spike's — the first rendered frame whose traversal selection is non-empty
 *    (spikes/native-rad/main.ts:455-457). The D26 reveal (backend phase "ready"), the element's
 *    `ready` event and the load record's `scene_first_splat_ready` ride ALONGSIDE, never substituted.
 *  - full-quality: the first frame whose traversal reports fullQuality with a non-empty selection
 *    (main.ts:431-433). Steady: loadSettled && lod.admitting === 0 && selection > 0, held 5
 *    rendered frames — the production analog of measure.ts:216-221, :309-322. The load record's
 *    convergence verdict rides alongside.
 *  - longest task: page-wide, the spike's observer (measure.ts:180-186), installed when this module
 *    loads — before the element boots; the load record's per-scene figure alongside (Q3).
 *  - peak JS heap: the spike's 500 ms performance.memory poll (measure.ts:188-192).
 *  - pose A (0,0,3) -> origin and the quarter orbit over 4 s (measure.ts:340-355), through the
 *    element's public CameraSystem, written immediately before each render; the element's near
 *    plane (0.1) against the spike's (0.01) is declared in every record (H2).
 *  - pixel ratio pinned to 1 through the runtime's public scene handle, the element in a fixed
 *    1280x720 box (index.html) — H3's fallback: the spike's trial size is unrecorded.
 *  - the docked-idle throttle kept off by a synthetic `pointermove` dispatched on `window` before
 *    each render — the element's own input-reset path (src/embed/SiteRuntime.ts:491-494); every
 *    record carries how many frames the product's own gate skipped, which must be 0 (H4).
 *  - cold cache: the hero URL made absolute + a per-trial `?cb=` nonce, the site handed to the
 *    element as a `blob:` src; proven per trial from resource timing (H6).
 *  - `?pages=32`: set on the element's backend through an observation hook on
 *    `ThreeGsBackend.prototype.load` — no product change (H1); the backend's own budget report is
 *    asserted every trial.
 *  - the HUD is not written during DRAG, so no DOM work lands in the measured frames.
 *
 * PLANTS (red-first, ticket 13): `?plant=<name>` turns ONE check's fault on; a planted run is
 * stored with its plant name and never aggregated or counted. no-override | no-input | warm |
 * expect-other | pose-limit | part | telemetry-flip. The contamination check's plant is a hidden
 * tab.
 */

import * as THREE from "three/webgpu";
import { defineSplatSite } from "@toolkit/index";
import { ThreeGsBackend, type PagerDiagnostics } from "@toolkit/backend/ThreeGsBackend";
import type { SplatHandle, SplatSource } from "@toolkit/backend/SplatBackend";
import type { SiteRuntimeHandle } from "@toolkit/embed/SiteRuntime";
import type { CameraState } from "@toolkit/core/CameraSystem";
import labSite from "../site-lab/sites/lab.site.json";

// ─── Module-load instruments: installed BEFORE the element boots (measure.ts:180) ───

// Long tasks, PAGE-WIDE — the spike's exact method (measure.ts:180-186; ruling Q3).
let longestTaskMs = 0;
try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) longestTaskMs = Math.max(longestTaskMs, e.duration);
  }).observe({ type: "longtask", buffered: true });
} catch {
  /* longtask unsupported → stays 0, reported as such (measure.ts:186) */
}

// Peak JS heap — the spike's 500 ms poll (measure.ts:188-192; ticket 12's heap ruling).
let peakHeap: number | null = null;
setInterval(() => {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  if (mem) peakHeap = Math.max(peakHeap ?? 0, mem.usedJSHeapSize);
}, 500);

// A trial that was ever hidden is invalid and must be re-run, never recorded as real
// (measure.ts:194-198).
let contaminated = document.hidden;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) contaminated = true;
});

// ─── Configuration ───

const STORE_KEY = "threejs-toolkit-hload-trials-v1";
const TRIALS_PER_CONFIG = 5; // measure.ts:110
const MAX_TOTAL_ATTEMPTS = 60; // measure.ts:111 — the spike's own cap
const STEADY_FRAMES = 5; // measure.ts:314
const STABILITY_HASHES = 3; // measure.ts:333
const DRAG_MS = 4000; // measure.ts:341 — quarter orbit over 4 s
const HASH_SIZE = 64; // measure.ts:155
const SPIKE_CAMERA_NEAR = 0.01; // spikes/native-rad/main.ts:213
// Pose-check tolerance = the pipeline's OWN re-sort/re-traverse thresholds
// (src/vendor/three-gs/patches/selection.ts:45-46, upstream GaussianSplatMesh.js:49-50): a pose
// error inside them cannot change what is selected or sorted. Restated because examples may not
// import vendor code (the vendor-seam-only lint rule).
const POSE_POSITION_TOLERANCE = 0.0025;
const POSE_DIRECTION_MIN_DOT = 0.9995;
// Plant `part` reproduces ticket 13's E2 regime: chunk 0's request held 3,000 ms and no frame
// for the first 2,500 ms of the load.
const PART_HOLD_MS = 3000;
const PART_NO_RENDER_MS = 2500;
const TELEMETRY_DB = "sparkjs-load-telemetry-v1"; // src/diag/sinkStore.ts:47
const TELEMETRY_RECORDS_STORE = "records"; // src/diag/sinkStore.ts:39

// The full matrix in the spike's run order; `pages: null` = derived default (measure.ts:131-136).
const AUTO_MATRIX: { webgl: boolean; pages: number | null }[] = [
  { webgl: false, pages: null },
  { webgl: false, pages: 32 },
  { webgl: true, pages: null },
  { webgl: true, pages: 32 },
];

const configName = (webgl: boolean, pages: number | null): string =>
  `${webgl ? "webgl" : "webgpu"}-${pages === null ? "default" : `pages${pages}`}`; // measure.ts:141

const params = new URLSearchParams(location.search);
const forceWebGL = params.get("webgl") === "1";
const pagesParam = params.get("pages") !== null ? Number.parseInt(params.get("pages")!, 10) : null;
const auto = params.get("auto") === "1";
const plant = params.get("plant");
const v = params.get("v") ?? `manual-${Date.now()}`;
// `?telemetry=1` = the OPT-IN set (doc 06 D36 addendum item 11): the site's own
// `settings.telemetry` switched on, under its own configuration name so it can never enter the
// visitor-default medians. Without it, the product's visitor default (telemetry off,
// src/embed/SiteRuntime.ts:2357-2373) — the counted trials.
const telemetryOptIn = params.get("telemetry") === "1";
const config = configName(forceWebGL, pagesParam) + (telemetryOptIn ? "-telemetry" : "");
const requestedBackend = forceWebGL ? "webgl2-fallback" : "webgpu";
const expectedBackend =
  plant === "expect-other" ? (forceWebGL ? "webgpu" : "webgl2-fallback") : requestedBackend;

// ─── Records ───

interface TrialRecord {
  config: string;
  v: string;
  date: string;
  plant: string | null;
  valid: boolean;
  invalidReasons: string[];
  error: string | null;
  contaminated: boolean;
  backend: string | null;
  expectedBackend: string;
  backendOk: boolean;
  budgetPages: number | null;
  budgetOverride: number | null;
  budgetSource: string | null;
  budgetOk: boolean;
  capacity: number | null;
  windowW: number;
  windowH: number;
  canvasW: number;
  canvasH: number;
  pixelRatio: number;
  cameraNear: number;
  spikeCameraNear: number;
  scrollRailPresent: boolean;
  renderOverrideSeen: boolean;
  // criterion 1 (spike definitions) and what rides alongside
  firstPixelMs: number | null;
  fullQualityMs: number | null;
  steadyMs: number | null;
  revealMs: number | null;
  elementReadyMs: number | null;
  recordFirstSplatMs: number | null;
  rendersRevealToFirstPixel: number | null;
  // criterion 2 + H6
  heroEntries: number;
  non206: number;
  notTransferred: number;
  rangeOnly: boolean;
  coldOk: boolean;
  // criterion 3
  steadySelected: number | null;
  // criterion 4
  pixelHashes: string[];
  // criterion 5
  dragP95FrameMs: number | null;
  dragFrames: number;
  // criterion 6
  gpuErrors: number;
  residentAtSteady: number | null;
  // criterion 7
  restoreSelected: number | null;
  restoreHash: string | null;
  // criterion 8
  progressMonotonic: boolean;
  // criteria 9-10 (selection grew under the motionless camera during LOAD)
  motionlessGrowth: boolean;
  // Q3 / heap
  longestTaskMs: number;
  recordLongestTaskMs: number | null;
  peakJsHeapMB: number | null;
  // H4
  throttleGatePresent: boolean;
  throttleSkips: number;
  throttleOk: boolean;
  // H2
  poseErrorMax: number;
  poseDotMin: number;
  poseOk: boolean;
  // the production load record, read after teardown finalized it (opt-in set only)
  telemetryOptIn: boolean;
  telemetryOk: boolean;
  recordFound: number;
  recordTerminalOutcome: string | null;
  recordConvergedProven: boolean | null;
  recordRenderedSampleWindows: number | null;
  rendersTotal: number;
  // traversal cost (AC4-1 / AC4-7 material)
  traverseCount: number;
  traverseMsAvg: number | null;
  traverseMsMax: number | null;
}

function loadAll(): TrialRecord[] {
  return JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]") as TrialRecord[];
}

// ─── HUD ───

const hudElement = document.getElementById("hud")!;
function hud(text: string): void {
  hudElement.textContent = text;
}

// ─── Telemetry store: snapshot the record ids that exist BEFORE this trial ───
// Keys only, kicked now and NOT awaited before boot, so it can never delay first-pixel. Opened
// without a version and only when the database already exists: opening a missing database
// would create it with no object stores and break the product's own sink (sinkStore.ts:201-205).

async function openTelemetryDb(): Promise<IDBDatabase | null> {
  const listed = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
  if (!listed.some((entry) => entry.name === TELEMETRY_DB)) return null;
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(TELEMETRY_DB);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readStore<T>(read: (store: IDBObjectStore) => IDBRequest<T>, fallback: T): Promise<T> {
  const db = await openTelemetryDb();
  if (db === null) return fallback;
  try {
    if (!db.objectStoreNames.contains(TELEMETRY_RECORDS_STORE)) return fallback;
    return await new Promise<T>((resolve, reject) => {
      const request = read(db.transaction(TELEMETRY_RECORDS_STORE, "readonly").objectStore(TELEMETRY_RECORDS_STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

const recordIdsBefore: Promise<Set<string>> = readStore<IDBValidKey[]>((store) => store.getAllKeys(), [])
  .then((keys) => new Set(keys.map(String)))
  .catch(() => new Set<string>());

interface StoredRecordLike {
  recordId: string;
  finalized: boolean;
  updatedAtMs: number;
  record: {
    status?: { terminalOutcome?: string | null };
    evidence?: {
      rawEvents?: { type: string; eventTimeMs: number }[];
      derivedBlocks?: { name: string; value?: Record<string, unknown> }[];
    };
  };
}

// ─── The observation hook (H1; the Q2 probe's): which backend + handle the runtime made ───

type HookedBackend = { pageBudgetOverride?: number; fetchImpl?: typeof fetch };
let backend: ThreeGsBackend | null = null;
let handle: SplatHandle | null = null;
let loadCalls = 0;
const originalLoad = ThreeGsBackend.prototype.load;

// Plant `part`: hold the first request after the header probe (chunk 0, the LOD root).
let partFetchCalls = 0;
const holdFirstChunk: typeof fetch = async (input, init) => {
  partFetchCalls++;
  if (partFetchCalls === 2) await new Promise((resolve) => setTimeout(resolve, PART_HOLD_MS));
  return fetch(input, init);
};

// Plant `warm`: fetch #1 is the header probe (its Content-Range carries the file size); fetch #3
// — the first non-root chunk — is answered with a synthetic 206 of the right length and no
// network request. Its zero bytes fail to decode, so that chunk is given up on (never the root,
// so the load still settles); the plant only needs the entry count to fall one short.
let warmFetchCalls = 0;
let warmTotalBytes: string | null = null;
const answerOneChunkFromMemory: typeof fetch = async (input, init) => {
  warmFetchCalls++;
  const range = (init?.headers as Record<string, string> | undefined)?.Range;
  const match = range === undefined ? null : /^bytes=(\d+)-(\d+)$/.exec(range);
  if (warmFetchCalls === 3 && match !== null && warmTotalBytes !== null) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    return new Response(new Uint8Array(end - start + 1), {
      status: 206,
      headers: { "Content-Range": `bytes ${start}-${end}/${warmTotalBytes}` },
    });
  }
  const response = await fetch(input, init);
  if (warmFetchCalls === 1) warmTotalBytes = response.headers.get("Content-Range")?.split("/")[1] ?? null;
  return response;
};

ThreeGsBackend.prototype.load = function (this: ThreeGsBackend, source: SplatSource): SplatHandle {
  loadCalls++;
  if (backend === null) {
    const own = this as unknown as HookedBackend;
    // The backend's documented measurement regime (ThreeGsBackend.ts:272-274), read when the
    // header lands (:678) — set before the first load of the element's own backend.
    if (pagesParam !== null && plant !== "no-override") own.pageBudgetOverride = pagesParam;
    if (plant === "part") own.fetchImpl = holdFirstChunk;
    // Plant `warm`: bytes that did NOT cross the network in this trial. Measured on this dev
    // server (ticket 13): it answers `Cache-Control: no-cache` + a weak ETag, the backend's
    // default fetch receives full 206 bodies every time (two plain-URL runs transferred all 123),
    // and even force-cache found none of the 123 chunk ranges stored — a warm HTTP cache cannot
    // reach a trial here. What CAN is a chunk answered without a request (a service worker, an
    // in-memory cache), which leaves no resource entry; this plant answers the first non-root
    // chunk request (fetch #3) from memory, so the entry count falls one short.
    if (plant === "warm") own.fetchImpl = answerOneChunkFromMemory;
  }
  const created = originalLoad.call(this, source);
  if (backend === null) {
    backend = this;
    handle = created;
  }
  return created;
};

// ─── Pixel hash (measure.ts:144-172, copied) ───

function hashPixels(buf: Uint8Array | Uint8ClampedArray | Float32Array): string {
  // FNV-1a over quantized bytes — stable across identical renders.
  let h = 0x811c9dc5;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf instanceof Float32Array ? Math.round(buf[i]! * 255) & 0xff : buf[i]!;
    h ^= byte;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ─── The trial ───

type Phase = "boot" | "load" | "stability" | "drag" | "restore" | "done";

const ORIGIN = { x: 0, y: 0, z: 0 };
const RAD2DEG = 180 / Math.PI;
const POSE_A: CameraState = { yaw: 0, pitch: 0, distance: 3, pivot: ORIGIN }; // (0,0,3) -> origin
const POSE_LIMIT_PLANT: CameraState = { yaw: 0, pitch: 0, distance: 250, pivot: ORIGIN };

async function runTrial(): Promise<void> {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];

  // H6: the site's content with the hero URL made absolute + this trial's cache-buster.
  const site = structuredClone(labSite);
  const heroAbsolute = new URL(site.scenes[0]!.url, location.origin).href;
  const nonce = `${v}-${Date.now()}`;
  site.scenes[0]!.url = plant === "warm" ? heroAbsolute : `${heroAbsolute}?cb=${encodeURIComponent(nonce)}`;
  // The opt-in set: the site's OWN switch (SiteRuntime.ts:2366, :2371). Plant `telemetry-flip`
  // inverts it against the configuration's claim, so the record-count check must fail.
  if (telemetryOptIn !== (plant === "telemetry-flip")) {
    (site as Record<string, unknown>).settings = { telemetry: { telemetry: true } };
  }
  const srcUrl = URL.createObjectURL(new Blob([JSON.stringify(site)], { type: "application/json" }));

  defineSplatSite();
  const el = document.createElement("splat-site");
  let elementReadyMs: number | null = null;
  el.addEventListener("ready", () => {
    if (elementReadyMs === null) elementReadyMs = performance.now();
  });
  el.setAttribute("src", srcUrl);
  document.getElementById("viewer")!.appendChild(el);

  const runtimeOf = (): SiteRuntimeHandle | null =>
    (el as unknown as { runtime?: SiteRuntimeHandle | null }).runtime ?? null;
  const bootDeadline = performance.now() + 30000;
  while (runtimeOf() === null) {
    if (performance.now() > bootDeadline) throw new Error("the element's runtime never appeared");
    // A timer, not rAF: a hidden tab (the contamination plant) may deliver no frames at all.
    await new Promise((resolve) => setTimeout(resolve, 4));
  }
  const runtime = runtimeOf()!;
  const scene = runtime.sparkScene;
  const renderer = scene.renderer;
  const camera = scene.camera;
  const cameraSystem = runtime.cameraSystem;

  // H3: pixel ratio 1 through the public handle (the scene's resize path calls only setSize,
  // src/core/ThreeSplatScene.ts:151-158, so the pin holds).
  renderer.setPixelRatio(1);

  // H4: count the frames the product's OWN gate skips.
  let throttleSkips = 0;
  const gate = scene.throttleGate;
  const throttleGatePresent = gate !== null;
  if (gate !== null) {
    scene.throttleGate = (timeMs: number) => {
      const skip = gate(timeMs);
      if (skip) throttleSkips++;
      return skip;
    };
  }

  // Criterion 6: GPU errors surface asynchronously (measure.ts:244-248) — listen when a device exists.
  let gpuErrors = 0;
  void scene.ready.then(() => {
    const device = (renderer.backend as unknown as { device?: EventTarget }).device;
    device?.addEventListener("uncapturederror", () => {
      gpuErrors++;
    });
  }, () => {});

  // ── Per-render state ──
  // Widened on purpose: the phase advances inside the render hooks, which TypeScript's
  // narrowing cannot see from the wait loop below.
  let phase = "load" as Phase;
  let renders = 0;
  let lastRenderAt = 0;
  let firstPixelMs: number | null = null;
  let firstPixelRender: number | null = null;
  let fullQualityMs: number | null = null;
  let revealMs: number | null = null;
  let revealRender: number | null = null;
  let steadyMs: number | null = null;
  let steadySelected: number | null = null;
  let residentAtSteady: number | null = null;
  let steadyFrames = 0;
  let lastSelected = -1;
  let motionlessGrowth = false;
  let progressMonotonic = true;
  let lastFraction = 0;
  let lastTraversals = 0;
  const traversalMs: number[] = [];
  const hashes: string[] = [];
  const dragDeltas: number[] = [];
  let dragStart = 0;
  let restoreFrames = 0;
  let restoreSelected: number | null = null;
  let restoreHash: string | null = null;
  let busy = false;
  let poseErrorMax = 0;
  let poseDotMin = 1;
  let renderOverrideSeen = false;
  let finishing = false;
  const forward = new THREE.Vector3();
  const toOrigin = new THREE.Vector3();

  const readbackHash = async (): Promise<string> => {
    // measure.ts:155-172, copied; the harness's own renders bypass the render hooks.
    if (scene.backend === "webgl2-fallback") {
      originalRender(scene.scene, camera);
      const c2d = document.createElement("canvas");
      c2d.width = HASH_SIZE;
      c2d.height = HASH_SIZE;
      const ctx = c2d.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(renderer.domElement, 0, 0, HASH_SIZE, HASH_SIZE);
      return hashPixels(ctx.getImageData(0, 0, HASH_SIZE, HASH_SIZE).data);
    }
    const target = new THREE.RenderTarget(HASH_SIZE, HASH_SIZE);
    renderer.setRenderTarget(target);
    originalRender(scene.scene, camera);
    renderer.setRenderTarget(null);
    const buf = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, HASH_SIZE, HASH_SIZE)) as
      | Uint8Array
      | Float32Array;
    target.dispose();
    return hashPixels(buf);
  };

  const applyPose = (now: number): void => {
    let state: CameraState;
    let wanted: [number, number, number];
    if (phase === "drag") {
      // measure.ts:341-353: position (3 sin θ, 0.3 t, 3 cos θ), looking at the origin.
      const t = Math.min(1, (now - dragStart) / DRAG_MS);
      const theta = (Math.PI / 2) * t;
      wanted = [3 * Math.sin(theta), 0.3 * t, 3 * Math.cos(theta)];
      const distance = Math.hypot(...wanted);
      state = {
        yaw: Math.atan2(wanted[0], wanted[2]) * RAD2DEG,
        pitch: Math.asin(wanted[1] / distance) * RAD2DEG,
        distance,
        pivot: ORIGIN,
      };
    } else if (plant === "pose-limit") {
      state = POSE_LIMIT_PLANT;
      wanted = [0, 0, POSE_LIMIT_PLANT.distance];
    } else {
      state = POSE_A;
      wanted = [0, 0, 3];
    }
    cameraSystem.setState(state, false);
    camera.updateMatrixWorld();
    const p = camera.position;
    poseErrorMax = Math.max(poseErrorMax, Math.hypot(p.x - wanted[0], p.y - wanted[1], p.z - wanted[2]));
    camera.getWorldDirection(forward);
    toOrigin.set(-wanted[0], -wanted[1], -wanted[2]).normalize();
    poseDotMin = Math.min(poseDotMin, forward.dot(toOrigin));
  };

  const beforeRender = (): void => {
    if (phase === "done") return;
    // H4: the element's own input-reset path — a window-level pointermove (SiteRuntime.ts:491-494).
    if (plant !== "no-input") window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    applyPose(performance.now());
  };

  const afterRender = (): void => {
    if (phase === "done" || backend === null || handle === null) return;
    const now = performance.now();
    renders++;
    if (scene.renderOverride !== null) renderOverrideSeen = true;
    if (phase === "drag") dragDeltas.push(now - lastRenderAt);
    lastRenderAt = now;

    const progress = backend.progress(handle);
    progressMonotonic &&= progress.fraction >= lastFraction - 1e-9; // measure.ts:302
    lastFraction = progress.fraction;
    if (revealMs === null && progress.phase === "ready") {
      revealMs = now;
      revealRender = renders;
    }
    let d: PagerDiagnostics;
    try {
      d = backend.pagerDiagnostics(handle);
    } catch {
      return; // not-paged: the door opens once the header has landed (ticket 12)
    }
    const selected = d.lod.selectedCount;
    if (firstPixelMs === null && selected > 0) {
      firstPixelMs = now;
      firstPixelRender = renders;
    }
    if (fullQualityMs === null && d.lod.fullQuality && selected > 0) fullQualityMs = now;
    if (d.lod.traversals > lastTraversals) {
      traversalMs.push(d.lod.lastTraversalMs);
      lastTraversals = d.lod.traversals;
    }
    const steady = d.loadSettled && d.lod.admitting === 0 && selected > 0;

    switch (phase) {
      case "load": {
        if (lastSelected >= 0 && selected > lastSelected) motionlessGrowth = true;
        lastSelected = selected;
        if (renders % 30 === 0) {
          hud(`hload ${config} v=${v}${plant ? ` PLANT=${plant}` : ""} — LOAD\nrenders ${renders} · selected ${selected} · resident ${d.residentPages}/${d.budget.pages} · fraction ${progress.fraction.toFixed(3)}`);
        }
        if (steady) {
          steadyFrames++;
          if (steadyFrames >= STEADY_FRAMES) {
            steadyMs = now;
            steadySelected = selected;
            residentAtSteady = d.residentPages;
            phase = "stability";
            hud(`hload ${config} — STABILITY (steady at ${now.toFixed(0)} ms, selected ${selected})`);
          }
        } else {
          steadyFrames = 0;
        }
        break;
      }
      case "stability": {
        // Plant `no-input`: hold here, idle, until the product's own gate skips a frame — a
        // quick load could otherwise end before the 15 s idle delay and prove nothing.
        if (plant === "no-input" && throttleSkips === 0) break;
        if (busy) break;
        if (hashes.length >= STABILITY_HASHES) {
          phase = "drag";
          dragStart = now;
          lastRenderAt = now;
          hud(`hload ${config} — DRAG`);
          break;
        }
        busy = true;
        readbackHash()
          .then((hash) => hashes.push(hash), (error: unknown) => errors.push(`stability readback: ${String(error)}`))
          .finally(() => {
            busy = false;
          });
        break;
      }
      case "drag": {
        if (now - dragStart >= DRAG_MS) {
          phase = "restore";
          restoreFrames = 0;
          hud(`hload ${config} — RESTORE`);
        }
        break;
      }
      case "restore": {
        if (!steady) {
          restoreFrames = 0;
          break;
        }
        restoreFrames++;
        if (restoreFrames >= STEADY_FRAMES && !busy && !finishing) {
          busy = true;
          finishing = true;
          restoreSelected = selected;
          readbackHash()
            .then((hash) => {
              restoreHash = hash;
            }, (error: unknown) => errors.push(`restore readback: ${String(error)}`))
            .finally(() => {
              busy = false;
              void finish();
            });
        }
        break;
      }
      default:
        break;
    }
  };

  // Frames stay the element's own; the harness only wraps the renderer's instance render.
  const originalRender = renderer.render.bind(renderer) as (s: THREE.Object3D, c: THREE.Camera) => unknown;
  (renderer as unknown as { render: (s: THREE.Object3D, c: THREE.Camera) => unknown }).render = (s, c) => {
    beforeRender();
    const out = originalRender(s, c);
    afterRender();
    return out;
  };

  // H2: pose A from the start (and before every render thereafter, via beforeRender).
  applyPose(performance.now());

  // Plant `part`: no frames for the first PART_NO_RENDER_MS, then the scene's own loop again.
  if (plant === "part") {
    await scene.ready;
    await renderer.setAnimationLoop(null);
    await new Promise((resolve) => setTimeout(resolve, PART_NO_RENDER_MS));
    const animate = (scene as unknown as { animate(timeMs: number): void }).animate.bind(scene);
    await renderer.setAnimationLoop((timeMs: number) => animate(timeMs));
  }

  const finish = async (): Promise<void> => {
    phase = "done";
    hud(`hload ${config} — FINALIZING`);
    const b = backend!;
    const h = handle!;
    const diag = b.pagerDiagnostics(h);
    const budget = diag.budget;
    const backendIdentity = scene.backend;
    const cameraNear = camera.near;
    const canvasW = renderer.domElement.width;
    const canvasH = renderer.domElement.height;
    const pixelRatio = renderer.getPixelRatio();
    const scrollRailPresent = runtime.scrollRail !== null;

    // H6 + criterion 2: every hero request a ranged 206 whose body came over the wire.
    const heroEntries = (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter((e) =>
      e.name.startsWith(heroAbsolute),
    );
    const statusOf = (e: PerformanceResourceTiming): number => (e as unknown as { responseStatus?: number }).responseStatus ?? 0;
    const non206 = heroEntries.filter((e) => statusOf(e) !== 206).length;
    const notTransferred = heroEntries.filter((e) => !(e.encodedBodySize > 0 && e.transferSize >= e.encodedBodySize)).length;

    const dragP95FrameMs = dragDeltas.length
      ? [...dragDeltas].sort((a, b2) => a - b2)[Math.floor(dragDeltas.length * 0.95)]! // measure.ts:241-243
      : null;
    const longestTaskAtEnd = Math.round(longestTaskMs * 10) / 10;
    const peakHeapMB = peakHeap === null ? null : Math.round(peakHeap / 1048576);

    // Tear the element down — the runtime's teardown finalizes the load record — then read it.
    el.remove();
    URL.revokeObjectURL(srcUrl);
    const before = await recordIdsBefore;
    let fresh: StoredRecordLike[] = [];
    const readDeadline = performance.now() + 10000;
    while (performance.now() < readDeadline) {
      const all = await readStore<StoredRecordLike[]>((store) => store.getAll() as IDBRequest<StoredRecordLike[]>, []).catch(
        () => [] as StoredRecordLike[],
      );
      fresh = all.filter((r) => r.finalized && !before.has(r.recordId));
      if (fresh.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const latest = fresh.sort((a, b2) => b2.updatedAtMs - a.updatedAtMs)[0];
    const summary = latest?.record.evidence?.derivedBlocks?.find((block) => block.name === "probe_summary")?.value;
    const longTasks = summary?.longTasks as { maximumDurationMs?: number } | undefined;
    const convergence = summary?.convergence as { convergedProven?: boolean } | undefined;
    const firstSplat = latest?.record.evidence?.rawEvents?.find((e) => e.type === "scene_first_splat_ready");

    const traverseMsAvg = traversalMs.length
      ? Math.round((traversalMs.reduce((sum, x) => sum + x, 0) / traversalMs.length) * 10) / 10
      : null;
    const traverseMsMax = traversalMs.length ? Math.round(Math.max(...traversalMs) * 10) / 10 : null;

    const backendOk = backendIdentity === expectedBackend;
    const budgetOk = pagesParam === null
      ? budget.override === null
      : budget.override === pagesParam && budget.pages === pagesParam;
    // Every chunk (pAsset = the asset's chunk count, ThreeGsBackend's budget report) plus the
    // header probe must have crossed the network in THIS trial: a chunk answered without a request
    // leaves no entry at all, which the per-entry tests alone cannot see.
    const expectedHeroRequests = budget.pAsset + 1;
    const coldOk = heroEntries.length >= expectedHeroRequests && non206 === 0 && notTransferred === 0;
    const throttleOk = throttleGatePresent && throttleSkips === 0;
    const poseOk = poseErrorMax <= POSE_POSITION_TOLERANCE && poseDotMin >= POSE_DIRECTION_MIN_DOT;
    // The two sets never mix: an opt-in trial must leave exactly one new finalized load record,
    // a visitor-default trial none.
    const telemetryOk = telemetryOptIn ? fresh.length === 1 : fresh.length === 0;
    const invalidReasons: string[] = [];
    if (contaminated) invalidReasons.push("contaminated (the page was hidden)");
    if (!backendOk) invalidReasons.push(`backend ${backendIdentity} != expected ${expectedBackend}`);
    if (!budgetOk) invalidReasons.push(`budget pages=${budget.pages} override=${budget.override} (asked ${pagesParam ?? "derived default"})`);
    if (!coldOk) invalidReasons.push(`not cold: ${heroEntries.length} hero entries (expected >= ${expectedHeroRequests}), ${non206} non-206, ${notTransferred} not transferred`);
    if (!throttleOk) invalidReasons.push(throttleGatePresent ? `idle throttle skipped ${throttleSkips} frame(s)` : "no throttle gate to observe");
    if (!poseOk) invalidReasons.push(`pose error ${poseErrorMax.toExponential(3)} / min dot ${poseDotMin.toFixed(6)}`);
    if (!telemetryOk) {
      invalidReasons.push(`${fresh.length} new load record(s) on a ${telemetryOptIn ? "telemetry opt-in" : "visitor-default"} trial (expected ${telemetryOptIn ? 1 : 0})`);
    }
    if (errors.length > 0) invalidReasons.push(...errors);

    const record: TrialRecord = {
      config,
      v,
      date: startedAt,
      plant,
      valid: invalidReasons.length === 0,
      invalidReasons,
      error: null,
      contaminated,
      backend: backendIdentity,
      expectedBackend,
      backendOk,
      budgetPages: budget.pages,
      budgetOverride: budget.override,
      budgetSource: budget.source,
      budgetOk,
      capacity: diag.capacity,
      windowW: innerWidth,
      windowH: innerHeight,
      canvasW,
      canvasH,
      pixelRatio,
      cameraNear,
      spikeCameraNear: SPIKE_CAMERA_NEAR,
      scrollRailPresent,
      renderOverrideSeen,
      firstPixelMs,
      fullQualityMs,
      steadyMs,
      revealMs,
      elementReadyMs,
      recordFirstSplatMs: firstSplat?.eventTimeMs ?? null,
      rendersRevealToFirstPixel:
        revealRender !== null && firstPixelRender !== null ? firstPixelRender - revealRender : null,
      heroEntries: heroEntries.length,
      non206,
      notTransferred,
      rangeOnly: heroEntries.length > 0 && non206 === 0,
      coldOk,
      steadySelected,
      pixelHashes: hashes,
      dragP95FrameMs,
      dragFrames: dragDeltas.length,
      gpuErrors,
      residentAtSteady,
      restoreSelected,
      restoreHash,
      progressMonotonic,
      motionlessGrowth,
      longestTaskMs: longestTaskAtEnd,
      recordLongestTaskMs: longTasks?.maximumDurationMs ?? null,
      peakJsHeapMB: peakHeapMB,
      throttleGatePresent,
      throttleSkips,
      throttleOk,
      poseErrorMax,
      poseDotMin,
      poseOk,
      telemetryOptIn,
      telemetryOk,
      recordFound: fresh.length,
      recordTerminalOutcome: latest?.record.status?.terminalOutcome ?? null,
      recordConvergedProven: convergence?.convergedProven ?? null,
      recordRenderedSampleWindows: (summary?.renderedSampleWindows as number | undefined) ?? null,
      rendersTotal: renders,
      traverseCount: traversalMs.length,
      traverseMsAvg,
      traverseMsMax,
    };
    persist(record);
  };

  const hardDeadline = performance.now() + 240000;
  while (phase !== "done") {
    if (performance.now() > hardDeadline) throw new Error(`trial stuck in phase "${phase}" after 240 s`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function persist(record: TrialRecord): void {
  const all = loadAll();
  all.push(record);
  localStorage.setItem(STORE_KEY, JSON.stringify(all));
  const verdict = record.valid ? "VALID" : `INVALID — ${record.invalidReasons.join("; ")}`;
  hud(
    `TRIAL DONE ${record.config} v=${record.v}${record.plant ? ` PLANT=${record.plant}` : ""}\n${verdict}\n` +
      `firstPixel ${record.firstPixelMs?.toFixed(0) ?? "—"} ms · reveal ${record.revealMs?.toFixed(0) ?? "—"} ms · ` +
      `fullQuality ${record.fullQualityMs?.toFixed(0) ?? "—"} ms · steady ${record.steadyMs?.toFixed(0) ?? "—"} ms\n` +
      `selected ${record.steadySelected ?? "—"} · dragP95 ${record.dragP95FrameMs?.toFixed(1) ?? "—"} ms · ` +
      `longest task ${record.longestTaskMs} ms · heap ${record.peakJsHeapMB ?? "—"} MB · throttle skips ${record.throttleSkips}`,
  );
  if (auto && record.plant === null) sequenceNext(all, record);
}

/** measure.ts:274-292, carried; a harness-side failure (backend, budget, pose) ABORTS instead of
 *  re-running, because repeating a systematic fault would only burn the attempt cap. */
function sequenceNext(all: TrialRecord[], last: TrialRecord): void {
  if (!last.backendOk || !last.budgetOk || !last.poseOk || !last.telemetryOk || last.error !== null) {
    hud(`AUTO SEQUENCE ABORTED — a harness-side check failed on ${last.config}: ${last.invalidReasons.join("; ") || last.error}`);
    return;
  }
  // The spike's cap applies per SET: the opt-in set is its own 5 x 4 matrix.
  const counted = all.filter((r) => r.plant === null && Boolean(r.telemetryOptIn) === telemetryOptIn);
  if (counted.length >= MAX_TOTAL_ATTEMPTS) {
    hud(`AUTO SEQUENCE ABORTED: ${counted.length} attempts without ${TRIALS_PER_CONFIG} clean trials per config.`);
    return;
  }
  const suffix = telemetryOptIn ? "-telemetry" : "";
  for (const cfg of AUTO_MATRIX) {
    const clean = counted.filter((r) => r.config === configName(cfg.webgl, cfg.pages) + suffix && r.valid).length;
    if (clean < TRIALS_PER_CONFIG) {
      const url =
        `${location.pathname}?auto=1&v=auto-${Date.now()}` +
        (cfg.pages !== null ? `&pages=${cfg.pages}` : "") +
        (cfg.webgl ? "&webgl=1" : "") +
        (telemetryOptIn ? "&telemetry=1" : "");
      setTimeout(() => location.replace(url), 1500); // brief HUD visibility (measure.ts:285)
      return;
    }
  }
  hud(`ALL TRIALS DONE — ${counted.filter((r) => r.valid).length} valid records (${counted.length} attempts).\nwindow.__hload.report() aggregates.`);
}

function report(): Record<string, unknown> {
  const all = loadAll();
  const median = (xs: (number | null)[]): number | null => {
    const nums = xs.filter((x): x is number => x !== null);
    return nums.length ? [...nums].sort((a, b) => a - b)[Math.floor(nums.length / 2)]! : null; // measure.ts:387
  };
  const byConfig: Record<string, TrialRecord[]> = {};
  for (const r of all) {
    if (r.plant !== null || !r.valid) continue; // plants and invalid trials never aggregate
    (byConfig[r.config] ??= []).push(r);
  }
  const summary: Record<string, unknown> = {};
  for (const [name, rs] of Object.entries(byConfig)) {
    summary[name] = {
      trials: rs.length,
      medianFirstPixelMs: median(rs.map((r) => r.firstPixelMs)),
      medianRevealMs: median(rs.map((r) => r.revealMs)),
      medianElementReadyMs: median(rs.map((r) => r.elementReadyMs)),
      medianRecordFirstSplatMs: median(rs.map((r) => r.recordFirstSplatMs)),
      rendersRevealToFirstPixel: [...new Set(rs.map((r) => r.rendersRevealToFirstPixel))],
      medianFullQualityMs: median(rs.map((r) => r.fullQualityMs)),
      medianSteadyMs: median(rs.map((r) => r.steadyMs)),
      selectedCounts: [...new Set(rs.map((r) => r.steadySelected))],
      hashesConsistentWithinTrials: rs.every((r) => new Set(r.pixelHashes).size <= 1),
      hashesAcrossTrials: [...new Set(rs.flatMap((r) => r.pixelHashes))],
      medianDragP95: median(rs.map((r) => r.dragP95FrameMs)),
      restoreSelectedMatches: rs.every((r) => r.restoreSelected === null || r.restoreSelected === r.steadySelected),
      restoreHashMatches: rs.every((r) => r.restoreHash === null || r.pixelHashes.includes(r.restoreHash)),
      windowSizes: [...new Set(rs.map((r) => `${r.windowW}x${r.windowH}`))],
      canvasSizes: [...new Set(rs.map((r) => `${r.canvasW}x${r.canvasH}@${r.pixelRatio}`))],
      progressMonotonicAll: rs.every((r) => r.progressMonotonic),
      motionlessGrowthAll: rs.every((r) => r.motionlessGrowth),
      rangeOnlyAll: rs.every((r) => r.rangeOnly),
      coldAll: rs.every((r) => r.coldOk),
      gpuErrorsTotal: rs.reduce((sum, r) => sum + r.gpuErrors, 0),
      budgetPages: [...new Set(rs.map((r) => r.budgetPages))],
      longestTaskMsMax: Math.max(...rs.map((r) => r.longestTaskMs)),
      recordLongestTaskMsMax: Math.max(...rs.map((r) => r.recordLongestTaskMs ?? 0)),
      peakJsHeapMBMax: Math.max(...rs.map((r) => r.peakJsHeapMB ?? 0)),
      throttleSkipsTotal: rs.reduce((sum, r) => sum + r.throttleSkips, 0),
      poseErrorMax: Math.max(...rs.map((r) => r.poseErrorMax)),
      traverseMsAvgMedian: median(rs.map((r) => r.traverseMsAvg)),
      traverseMsMaxMax: Math.max(...rs.map((r) => r.traverseMsMax ?? 0)),
      recordTerminalOutcomes: [...new Set(rs.map((r) => r.recordTerminalOutcome))],
      rendersPerSampleWindow: rs.map((r) =>
        r.recordRenderedSampleWindows ? Math.round((r.rendersTotal / r.recordRenderedSampleWindows) * 100) / 100 : null,
      ),
    };
  }
  return { raw: all, summary };
}

(window as unknown as Record<string, unknown>).__hload = {
  report,
  clear(): void {
    localStorage.removeItem(STORE_KEY);
  },
};

hud(`hload ${config} v=${v}${plant ? ` PLANT=${plant}` : ""} — booting`);
runTrial().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.message}` : String(error);
  hud(`TRIAL FAILED ${config}: ${message}`);
  const record = {
    config,
    v,
    date: new Date().toISOString(),
    plant,
    valid: false,
    invalidReasons: [`harness error: ${message}`],
    error: message,
    contaminated,
    backendOk: false,
    telemetryOptIn,
  } as unknown as TrialRecord;
  const all = loadAll();
  all.push(record);
  localStorage.setItem(STORE_KEY, JSON.stringify(all));
});
