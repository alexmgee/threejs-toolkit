/**
 * pager-lab — ThreeGsBackend paged .rad path fixture (ticket 06).
 *
 * Rendering fixture for the paged .rad load path: page budget, residency,
 * invalidation, progress monotonicity, and H-LIFE dispose cycles.
 *
 * DEV hook: window.__pagerLab { scene3, backend, handle, capture, captureSync, step }.
 */

import * as THREE from "three/webgpu";
import { ThreeSplatScene } from "@toolkit/core/ThreeSplatScene";
import { SplatBackendError } from "@toolkit/backend/SplatBackend";
import {
  ThreeGsBackend,
  type PagerDiagnostics,
} from "@toolkit/backend/ThreeGsBackend";
import { createCapture } from "../shared/capture";

const ASSET = "/@fs/D:/Projects/sparkjs-toolkit/examples/assets/lab-sh1-sparsity.rad";

const container = document.getElementById("viewer")!;
const out = document.getElementById("out")!;
const forceWebGL = new URLSearchParams(location.search).get("webgl") === "1";

const pagesParam = new URLSearchParams(location.search).get("pages");
const pagesParsed = Number(pagesParam);
const pages =
  pagesParam !== null && !Number.isNaN(pagesParsed) ? pagesParsed : undefined;

const CAMERA_Z = 3;
const FOV = 60;

const CAPTURE_POINT_NAMES = [
  "p00",
  "p01",
  "p02",
  "p10",
  "p11",
  "p12",
  "p20",
  "p21",
  "p22",
  "corner",
] as const;

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, detail: string): void {
  const div = document.createElement("div");
  div.className = `assertion ${condition ? "pass" : "fail"}`;
  div.textContent = `${condition ? "PASS" : "FAIL"} — ${name}: ${detail}`;
  out.appendChild(div);
  console.log(`pager-lab ${condition ? "PASS" : "FAIL"} ${name} — ${detail}`);
  condition ? passed++ : failed++;
}

function finishSummary(): void {
  const heading = document.createElement("h2");
  heading.className = failed === 0 ? "pass" : "fail";
  heading.textContent = `pager-lab: ${passed} passed, ${failed} failed`;
  out.appendChild(heading);
  console.log(`pager-lab RESULT ${passed} passed, ${failed} failed`);
}

function createDecodeWorker(): Worker {
  return new Worker(new URL("@toolkit/backend/rad-worker.ts", import.meta.url), {
    type: "module",
  });
}

function getRangeHeader(init?: RequestInit): string | null {
  if (!init?.headers) return null;
  const headers = init.headers;
  if (headers instanceof Headers) return headers.get("Range");
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      if (key.toLowerCase() === "range") return value;
    }
    return null;
  }
  const record = headers as Record<string, string>;
  return record.Range ?? record.range ?? null;
}

function parseRangeStart(rangeHeader: string | null): number | null {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d+)/.exec(rangeHeader);
  return match ? Number(match[1]) : null;
}

function px(pixels: Record<string, number[] | string>, name: string): number[] {
  const v = pixels[name];
  if (!Array.isArray(v)) {
    throw new Error(`capture sample "${name}" unavailable: ${String(v)}`);
  }
  return v;
}

function pixelsEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function maxChannelDiff(a: number[], b: number[]): number {
  let max = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    max = Math.max(max, Math.abs(a[i]! - b[i]!));
  }
  return max;
}

function isNearBackground(rgba: number[]): boolean {
  const bgR = 0x11;
  const bgG = 0x11;
  const bgB = 0x33;
  return (
    Math.abs(rgba[0]! - bgR) < 32 &&
    Math.abs(rgba[1]! - bgG) < 32 &&
    Math.abs(rgba[2]! - bgB) < 32
  );
}

const scene3 = new ThreeSplatScene({
  container,
  fov: FOV,
  cameraPosition: [0, 0, CAMERA_Z],
  background: 0x111133,
  forceWebGL,
});

const backend = new ThreeGsBackend({
  renderer: scene3.renderer,
  createDecodeWorker,
  pageBudgetOverride: pages ?? undefined,
});

let handle!: ReturnType<ThreeGsBackend["load"]>;

const status = document.createElement("div");
status.className = "splat-input-bar";
status.style.top = "auto";
status.style.bottom = "0";
container.appendChild(status);

const { capture, captureSync } = createCapture(scene3, (W, H) => {
  const points: Record<string, [number, number]> = {};
  const xs = [
    Math.floor(W * 0.25),
    Math.floor(W * 0.5),
    Math.floor(W * 0.75),
  ];
  const ys = [
    Math.floor(H * 0.25),
    Math.floor(H * 0.5),
    Math.floor(H * 0.75),
  ];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      points[`p${row}${col}`] = [xs[col]!, ys[row]!];
    }
  }
  points.corner = [Math.floor(W / 2), 2];
  return points;
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

function gpuMemoryCounters(renderer: THREE.WebGPURenderer): GpuCounters {
  const memory = renderer.info.memory as unknown as Record<string, unknown>;
  const counters = {} as GpuCounters;
  for (const key of GPU_COUNTER_KEYS) {
    const v = memory[key];
    if (typeof v !== "number") {
      throw new Error(`renderer.info.memory.${key} missing — H-LIFE gate cannot run`);
    }
    counters[key] = v;
  }
  return counters;
}

function countersEqual(a: GpuCounters, b: GpuCounters): boolean {
  return GPU_COUNTER_KEYS.every((k) => a[k] === b[k]);
}

function formatCounters(c: GpuCounters): string {
  return GPU_COUNTER_KEYS.map((k) => `${k}=${c[k]}`).join(" ");
}

function cloneCounters(c: GpuCounters): GpuCounters {
  return { ...c };
}

function countersPlus(a: GpuCounters, delta: GpuCounters): GpuCounters {
  const outCounters = {} as GpuCounters;
  for (const k of GPU_COUNTER_KEYS) outCounters[k] = a[k] + delta[k];
  return outCounters;
}

const captureLeak = {} as GpuCounters;
for (const k of GPU_COUNTER_KEYS) captureLeak[k] = 0;

async function meteredCapture(): Promise<Record<string, number[] | string>> {
  const before = gpuMemoryCounters(scene3.renderer);
  try {
    return await capture();
  } catch (error) {
    if (scene3.backend !== "webgl2-fallback") throw error;
    const result = captureSync();
    const after = gpuMemoryCounters(scene3.renderer);
    for (const k of GPU_COUNTER_KEYS) captureLeak[k] += after[k] - before[k];
    return result;
  }
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

async function sampleCenterRgba(): Promise<number[]> {
  let pixelsAfter: Record<string, number[] | string>;
  if (scene3.backend === "webgl2-fallback") {
    pixelsAfter = captureSync();
  } else {
    pixelsAfter = await meteredCapture();
  }
  const v = pixelsAfter.p11;
  if (!Array.isArray(v)) {
    throw new Error("capture sample p11 unavailable: " + String(v));
  }
  return v;
}

const phaseOrder: Record<string, number> = {
  fetching: 0,
  constructing: 1,
  ready: 2,
  failed: -1,
};
let prevFraction = -1;
let prevPhaseIdx = -1;
let prevBytes = -1;
let prevDecoded = -1;
let prevUploaded = -1;
let sampleCount = 0;
let sawReady = false;
let progressOk = true;
let progressDetail = "ok";
let fractionAtReady = -1;
let residentPagesMax = 0;

function sampleProgress(h: ReturnType<ThreeGsBackend["load"]>): void {
  const p = backend.progress(h);
  const phaseIdx = phaseOrder[p.phase] ?? -2;
  sampleCount++;
  if (p.phase === "ready") {
    sawReady = true;
    if (fractionAtReady < 0) fractionAtReady = p.fraction;
  }
  if (p.fraction < prevFraction) {
    progressOk = false;
    progressDetail = `fraction decreased ${prevFraction} -> ${p.fraction}`;
  }
  if (phaseIdx < prevPhaseIdx) {
    progressOk = false;
    progressDetail = `phase moved backward at ${p.phase}`;
  }
  prevFraction = p.fraction;
  if (phaseIdx > prevPhaseIdx) prevPhaseIdx = phaseIdx;

  try {
    const diag = backend.pagerDiagnostics(h);
    const terms = diag.progressTerms;
    if (prevBytes >= 0 && terms.bytes < prevBytes) {
      progressOk = false;
      progressDetail = `bytes term decreased ${prevBytes} -> ${terms.bytes}`;
    }
    if (prevDecoded >= 0 && terms.decoded < prevDecoded) {
      progressOk = false;
      progressDetail = `decoded term decreased ${prevDecoded} -> ${terms.decoded}`;
    }
    if (prevUploaded >= 0 && terms.uploaded < prevUploaded) {
      progressOk = false;
      progressDetail = `uploaded term decreased ${prevUploaded} -> ${terms.uploaded}`;
    }
    prevBytes = terms.bytes;
    prevDecoded = terms.decoded;
    prevUploaded = terms.uploaded;
    residentPagesMax = Math.max(residentPagesMax, diag.residentPages);
  } catch {
    // pagerDiagnostics throws not-paged before the header hook lands.
  }
}

// Hang guard for the wait loops — ELAPSED time, not a spin count: during
// "fetching" a spin is a bare MessageChannel yield (~0.1 ms), so splat-lab's
// 20,000-spin bound (sized for a 3 KB asset) expires in ~2 s, long before a
// cold 213 MB hero load lands (Phase 0 / ticket 05 measured ~12 s cold from
// the dev server). Bound = 10× that measured cold load. Still timer-free
// (performance.now() reads, MessageChannel yields).
const WAIT_BOUND_MS = 10 * 12_000;

async function awaitWhenReadyWithKick(
  h: ReturnType<ThreeGsBackend["load"]>,
): Promise<void> {
  const t0 = performance.now();
  while (performance.now() - t0 < WAIT_BOUND_MS) {
    sampleProgress(h);
    const phase = backend.progress(h).phase;
    if (phase === "ready" || phase === "failed") return backend.whenReady(h);
    if (phase !== "fetching") {
      scene3.renderer.render(scene3.scene, scene3.camera);
    }
    await yieldMacrotask();
  }
  throw new Error(`awaitWhenReadyWithKick: no ready/failed after ${WAIT_BOUND_MS} ms (phase=${backend.progress(h).phase})`);
}

async function spinUntilSettled(
  h: ReturnType<ThreeGsBackend["load"]>,
): Promise<PagerDiagnostics> {
  const t0 = performance.now();
  while (performance.now() - t0 < WAIT_BOUND_MS) {
    sampleProgress(h);
    scene3.renderer.render(scene3.scene, scene3.camera);
    await yieldMacrotask();
    try {
      const diag = backend.pagerDiagnostics(h);
      if (diag.loadSettled) return diag;
    } catch {
      // not paged yet
    }
  }
  throw new Error(`spinUntilSettled: loadSettled not reached after ${WAIT_BOUND_MS} ms`);
}

let sortDispatches = 0;
let shDispatches = 0;

function resetInvalidationCounts(): void {
  sortDispatches = 0;
  shDispatches = 0;
}

function wrapMeshInvalidation(mesh: PagerDiagnostics["mesh"]): void {
  const rec = mesh as unknown as Record<string, unknown>;
  const origSort = rec.updateSort;
  const origSh = rec.updateSphericalHarmonics;
  // Forward (renderer, camera) — the vendored methods need both.
  if (typeof origSort === "function") {
    rec.updateSort = (...args: unknown[]) => {
      const result = (origSort as (...a: unknown[]) => boolean).apply(mesh, args);
      if (result === true) sortDispatches++;
      return result;
    };
  }
  if (typeof origSh === "function") {
    rec.updateSphericalHarmonics = (...args: unknown[]) => {
      const result = (origSh as (...a: unknown[]) => boolean).apply(mesh, args);
      if (result === true) shDispatches++;
      return result;
    };
  }
}

let unhandledRejections = 0;
window.addEventListener("unhandledrejection", (ev) => {
  unhandledRejections++;
  console.error("pager-lab UNHANDLED REJECTION", ev.reason);
});

const done = (async () => {
  await scene3.ready;
  const baseline0 = gpuMemoryCounters(scene3.renderer);

  let workerFactoryOk = false;
  try {
    new ThreeGsBackend({ renderer: scene3.renderer }).load({ url: ASSET });
  } catch (error) {
    workerFactoryOk =
      error instanceof SplatBackendError && error.reason === "rad-needs-worker-factory";
  }
  assert(
    "rad-needs-worker-factory",
    workerFactoryOk,
    "throws SplatBackendError(rad-needs-worker-factory)",
  );

  const cameraBeforeLoad = scene3.camera.matrixWorld.clone();
  const preLoadBaseline = gpuMemoryCounters(scene3.renderer);
  const loadStart = performance.now();

  handle = backend.load({ url: ASSET });
  scene3.scene.add(handle.object);
  // .rad scene data is Y-down. The 180-degree X-flip is SiteConfig's CONDITIONAL
  // eulerRotationDeg behavior (sparkjs SplatLoader.ts:81-88; docs/plan/results/phase-0.md:27 trap) - ticket 09's
  // layer, never the backend's. The fixture applies it here so the hero is upright at the pinned pose.
  handle.object.rotation.x = Math.PI;
  if (import.meta.env.DEV && window.__pagerLab) {
    window.__pagerLab.handle = handle;
  }

  await awaitWhenReadyWithKick(handle);
  const diag = await spinUntilSettled(handle);
  const loadMs = performance.now() - loadStart;

  const budgetPages = diag.budget.pages;
  const expectedBudgetPages = Math.min(
    diag.budget.pLimits,
    diag.budget.pAsset,
    pages ?? Number.POSITIVE_INFINITY,
  );
  const overrideRegimeOk =
    pages === undefined ||
    (budgetPages === 32 && pages === 32 && diag.budget.source.startsWith("override"));
  assert(
    "budget-derived",
    diag.budget.pages === expectedBudgetPages &&
      diag.budget.pAsset === 122 &&
      diag.budget.pLimits >= 1 &&
      overrideRegimeOk,
    `budget=${JSON.stringify(diag.budget)} backend=${scene3.backend}`,
  );

  const isWebGpuBackend = scene3.backend !== "webgl2-fallback";
  const loadedCounters = gpuMemoryCounters(scene3.renderer);
  assert(
    "no-allocation-failure",
    backend.progress(handle).phase === "ready" && !countersEqual(loadedCounters, preLoadBaseline),
    `phase=${backend.progress(handle).phase} pre={${formatCounters(preLoadBaseline)}} loaded={${formatCounters(loadedCounters)}}`,
  );

  let allProtectedResident = true;
  for (let i = 0; i < budgetPages; i++) {
    if (!diag.isResident(i)) allProtectedResident = false;
  }
  const expectedDeferred = 122 - Math.min(budgetPages, 122);
  assert(
    "residency-within-budget",
    residentPagesMax <= budgetPages &&
      diag.residentPages === Math.min(budgetPages, 122) &&
      allProtectedResident &&
      diag.deferred.length === expectedDeferred &&
      diag.unavailable.length === 0 &&
      diag.refused.length === 0,
    `residentPages=${diag.residentPages}/${budgetPages} deferred=${diag.deferred.length} unavailable=${diag.unavailable.length} refused=${diag.refused.length}`,
  );

  const centerRgba = px(await meteredCapture(), "p11");
  const motionlessVisible =
    scene3.camera.matrixWorld.equals(cameraBeforeLoad) &&
    !isNearBackground(centerRgba) &&
    centerRgba[3] === 255;
  assert(
    "motionless-camera-visible",
    motionlessVisible,
    `cameraUnchanged=${scene3.camera.matrixWorld.equals(cameraBeforeLoad)} p11=[${centerRgba.join(",")}]`,
  );

  wrapMeshInvalidation(diag.mesh);
  const isWebGpu = scene3.backend !== "webgl2-fallback";

  resetInvalidationCounts();
  const evicted = diag.evictChunk(0);
  scene3.renderer.render(scene3.scene, scene3.camera);
  const evictSort = sortDispatches;
  const evictSh = shDispatches;
  const evictInvalidationOk =
    evicted &&
    evictSort >= 1 &&
    (!isWebGpu || evictSh >= 1) &&
    scene3.camera.matrixWorld.equals(cameraBeforeLoad);

  resetInvalidationCounts();
  const readmitted = await diag.admitChunk(0);
  scene3.renderer.render(scene3.scene, scene3.camera);
  const admitSort = sortDispatches;
  const admitSh = shDispatches;
  const admitInvalidationOk =
    readmitted && admitSort >= 1 && (!isWebGpu || admitSh >= 1);

  assert(
    "invalidation-shown",
    evictInvalidationOk && admitInvalidationOk,
    `backend=${scene3.backend} evict sort=${evictSort} sh=${evictSh}; admit sort=${admitSort} sh=${admitSh}`,
  );

  // Fresh snapshot: the evict/re-admit drills above mutated the live pager
  // (built-in review, 2026-09-03 — `diag` is the settle-time snapshot).
  const diagNow = backend.pagerDiagnostics(handle);
  const finalProg = backend.progress(handle);
  const finalTerms = diagNow.progressTerms;
  const finalFraction = finalProg.fraction;
  const meanTerms = (finalTerms.bytes + finalTerms.decoded + finalTerms.uploaded) / 3;
  assert(
    "progress-monotonic",
    progressOk &&
      sawReady &&
      sampleCount >= 2 &&
      fractionAtReady < finalFraction &&
      Math.abs(finalFraction - meanTerms) < 1e-9,
    `terms=${JSON.stringify(finalTerms)} fractionAtReady=${fractionAtReady} finalFraction=${finalFraction} samples=${sampleCount} (${progressDetail})`,
  );

  // WebGPU: the partial-range buffer path must be HIT (ranges consumed by
  // the backend's per-range write). WebGL2 fallback: storage is read
  // through PBO textures, nothing consumes buffer ranges — the RECORDED
  // fallback characteristic (whole-texture re-upload per page); the
  // assertion there is "pbo-texture path, never a false broken flag".
  const partialOk = isWebGpuBackend
    ? diag.uploadPath === "partial" && diag.rangesPushed > 0 && diag.rangesConsumed > 0
    : diag.uploadPath === "pbo-texture" && diag.pboUploads > 0;
  assert(
    "partial-upload-path-hit",
    diag.partialUploadBroken === false && partialOk,
    `backend=${scene3.backend} uploadPath=${diag.uploadPath} pushed=${diag.rangesPushed} consumed=${diag.rangesConsumed} pboUploads=${diag.pboUploads} renders=${diag.renders}`,
  );

  const counts = backend.counts(handle);
  const diagForCounts = backend.pagerDiagnostics(handle);
  const box = backend.bounds(handle);
  const boundsOk =
    Number.isFinite(box.min.x) &&
    Number.isFinite(box.min.y) &&
    Number.isFinite(box.min.z) &&
    Number.isFinite(box.max.x) &&
    Number.isFinite(box.max.y) &&
    Number.isFinite(box.max.z) &&
    box.min.x < box.max.x &&
    box.min.y < box.max.y &&
    box.min.z < box.max.z;
  assert(
    "counts-and-bounds",
    counts.total === 7935358 &&
      counts.resident === diagForCounts.residentSplats &&
      diagForCounts.residentSplats > 0 &&
      counts.selected === counts.resident &&
      boundsOk,
    `total=${counts.total} resident=${counts.resident} selected=${counts.selected} bounds min=(${box.min.x},${box.min.y},${box.min.z}) max=(${box.max.x},${box.max.y},${box.max.z})`,
  );

  const P0 = await meteredCapture();
  const slot0 = diag.slotOf(0);
  diag.evictChunk(0);
  scene3.renderer.render(scene3.scene, scene3.camera);
  const P1 = await meteredCapture();
  let gridChanged = false;
  for (const name of CAPTURE_POINT_NAMES.slice(0, 9)) {
    if (!pixelsEqual(px(P0, name), px(P1, name))) {
      gridChanged = true;
      break;
    }
  }
  await diag.admitChunk(0);
  scene3.renderer.render(scene3.scene, scene3.camera);
  const P2 = await meteredCapture();
  let evictReadmitOk = gridChanged && diag.slotOf(0) === slot0;
  const diffDetails: string[] = [];
  if (evictReadmitOk) {
    for (const name of CAPTURE_POINT_NAMES) {
      if (!pixelsEqual(px(P0, name), px(P2, name))) {
        evictReadmitOk = false;
        diffDetails.push(`${name} maxDiff=${maxChannelDiff(px(P0, name), px(P2, name))}`);
      }
    }
  }
  assert(
    "evict-readmit-pixel-identical",
    evictReadmitOk,
    gridChanged
      ? diffDetails.length > 0
        ? diffDetails.join("; ")
        : `slot0=${slot0} slotAfter=${diag.slotOf(0)}`
      : "evict drill blind — no grid point changed after evictChunk(0)",
  );

  // The partial-path flag is LIVE; `diag` above is a snapshot taken at
  // settle. Re-read after the evict/re-admit uploads so a breakage during
  // those later uploads cannot hide behind the earlier value (adversarial
  // review, 2026-09-03).
  const diagAfterDrills = backend.pagerDiagnostics(handle);
  assert(
    "partial-path-healthy-after-drills",
    diagAfterDrills.partialUploadBroken === false &&
      diagAfterDrills.uploadPath === diag.uploadPath &&
      (isWebGpuBackend ? diagAfterDrills.rangesConsumed > diag.rangesConsumed : diagAfterDrills.pboUploads > diag.pboUploads),
    `uploadPath=${diagAfterDrills.uploadPath} pushed=${diagAfterDrills.rangesPushed} consumed=${diagAfterDrills.rangesConsumed} pboUploads=${diagAfterDrills.pboUploads} (at settle: consumed=${diag.rangesConsumed} pboUploads=${diag.pboUploads})`,
  );

  console.log(
    `pager-lab EVIDENCE\n` +
      `  budget: ${JSON.stringify(diag.budget)}\n` +
      `  residentPages: ${diag.residentPages}\n` +
      `  firstUploaded: ${diag.firstUploaded}\n` +
      `  deferred: ${diag.deferred.length}\n` +
      `  progressTerms: ${JSON.stringify(finalTerms)}\n` +
      `  rangesPushed: ${diag.rangesPushed}\n` +
      `  rangesConsumed: ${diag.rangesConsumed}\n` +
      `  load ms: ${loadMs.toFixed(1)}\n` +
      `  backend: ${scene3.backend}`,
  );

  const heapSamples: (number | null)[] = [];
  const cycleDetails: string[] = [];
  let disposeCyclesOk = true;
  let disposeCyclesDetail = "ok";

  // Ticket 04's H-LIFE criterion is a 10-cycle series (owner ruling
  // 2026-08-29); three samples of ~1 GB loads flipped between rising and
  // falling on GC timing alone (recorded in the ticket).
  for (let i = 0; i < 10; i++) {
    const pre = gpuMemoryCounters(scene3.renderer);
    const leakBefore = cloneCounters(captureLeak);
    const cycleHandle = backend.load({ url: ASSET });
    scene3.scene.add(cycleHandle.object);
    cycleHandle.object.rotation.x = Math.PI;
    await awaitWhenReadyWithKick(cycleHandle);
    await spinUntilSettled(cycleHandle);

    const loaded = gpuMemoryCounters(scene3.renderer);
    // 5 = the paged mesh's per-splat storage attributes at SH degree 1:
    // center, covarianceA, covarianceB, color (4 vec4) + the SH1 band —
    // the hero is maxSh 1. On WebGPU they land as storage attributes (plus
    // the lazy SH contribution buffer and the sort's buffers); on the
    // WebGL2 fallback as PBO textures (observed +6 per load). A load that
    // moved fewer than these five could not have the SH band live.
    const shBandLive =
      loaded.storageAttributes - pre.storageAttributes >= 5 ||
      loaded.textures - pre.textures >= 5;
    if (countersEqual(loaded, pre) || !shBandLive) {
      disposeCyclesOk = false;
      disposeCyclesDetail =
        `cycle ${i}: GATE BLIND — loaded={${formatCounters(loaded)}} pre={${formatCounters(pre)}} shBandLive=${shBandLive}`;
      break;
    }

    scene3.renderer.render(scene3.scene, scene3.camera);
    const cycleCenter = await sampleCenterRgba();
    if (isNearBackground(cycleCenter) || cycleCenter[3] !== 255) {
      disposeCyclesOk = false;
      disposeCyclesDetail = `cycle ${i}: center not visible rgba=[${cycleCenter.join(",")}]`;
      break;
    }

    backend.dispose(cycleHandle);
    scene3.scene.remove(cycleHandle.object);
    // Heap sample AFTER dispose + a drain of yields: sampling while loaded
    // measures the ~1 GB load itself plus GC lag (three runs flipped between
    // rising and falling triples; a 6-cycle console experiment at the full
    // budget read 1646 → 1711 → 1073 MB after successive disposes — GC lag,
    // not retention). The structural assertion (series not strictly
    // increasing) is ticket 04's criterion, kept as written.
    for (let drain = 0; drain < 200; drain++) await yieldMacrotask();
    const heap =
      (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
        ?.usedJSHeapSize ?? null;
    heapSamples.push(heap);

    const after = gpuMemoryCounters(scene3.renderer);
    cycleDetails.push(
      `cycle ${i}: heap ${heap}, storage ${after.storageAttributes}/${after.storageAttributesSize}B, textures ${after.textures}/${after.texturesSize}B`,
    );

    const leakDelta = {} as GpuCounters;
    for (const k of GPU_COUNTER_KEYS) leakDelta[k] = captureLeak[k] - leakBefore[k];
    const expected = countersPlus(pre, leakDelta);
    if (!countersEqual(after, expected)) {
      disposeCyclesOk = false;
      disposeCyclesDetail =
        `cycle ${i}: after-dispose counters diverge — after {${formatCounters(after)}} vs expected {${formatCounters(expected)}}`;
      break;
    }
  }

  assert(
    "dispose-cycles-gpu-flat-with-sh",
    disposeCyclesOk,
    disposeCyclesOk ? cycleDetails.join("; ") : disposeCyclesDetail,
  );

  const memAvailable = heapSamples.every((h) => h !== null);
  if (!memAvailable) {
    assert(
      "heap-not-strictly-increasing",
      false,
      "SKIPPED-as-FAIL: performance.memory unavailable",
    );
  } else {
    let allStrictlyIncreasing = true;
    for (let i = 1; i < heapSamples.length; i++) {
      if (heapSamples[i]! <= heapSamples[i - 1]!) {
        allStrictlyIncreasing = false;
        break;
      }
    }
    assert(
      "heap-not-strictly-increasing",
      !allStrictlyIncreasing,
      `heaps=[${heapSamples.join(",")}]`,
    );
  }

  backend.dispose(handle);
  scene3.scene.remove(handle.object);
  if (import.meta.env.DEV && window.__pagerLab) {
    window.__pagerLab.handle = null;
  }

  const afterMainDispose = gpuMemoryCounters(scene3.renderer);
  const expectedFinal = countersPlus(baseline0, captureLeak);
  assert(
    "dispose-main-restores-baseline0",
    countersEqual(afterMainDispose, expectedFinal),
    `after {${formatCounters(afterMainDispose)}} vs baseline0+capture-leak {${formatCounters(expectedFinal)}}`,
  );

  let unknownHandleOk = false;
  try {
    backend.counts(handle);
  } catch (error) {
    unknownHandleOk =
      error instanceof SplatBackendError && error.reason === "unknown-handle";
  }
  assert(
    "disposed-handle-unknown",
    unknownHandleOk,
    "throws SplatBackendError(unknown-handle)",
  );

  const noPagesFetch: typeof fetch = async (input, init) => {
    const rangeHeader = getRangeHeader(init);
    const start = parseRangeStart(rangeHeader);
    // Only the header probe (Range start 0) reaches the server. The hero's
    // header is 8,128 bytes, so chunk 0's range starts far below the probe
    // size — a ">= 65536" threshold let chunk 0 through, one page uploaded,
    // and the drill waited for a paint-observed ready without rendering
    // (caught live, 2026-09-03).
    if (start !== 0) {
      return new Response(null, { status: 404 });
    }
    return fetch(input, init);
  };
  const noPagesBackend = new ThreeGsBackend({
    renderer: scene3.renderer,
    createDecodeWorker,
    fetchImpl: noPagesFetch,
  });
  const noPagesHandle = noPagesBackend.load({ url: ASSET });
  let noPagesReason = "";
  try {
    await noPagesBackend.whenReady(noPagesHandle);
  } catch (error) {
    if (error instanceof SplatBackendError) noPagesReason = error.reason;
  }
  assert(
    "no-pages-available",
    noPagesReason === "no-pages-available" &&
      noPagesBackend.progress(noPagesHandle).phase === "failed",
    `whenReady rejects SplatBackendError(${noPagesReason}), phase=${noPagesBackend.progress(noPagesHandle).phase}`,
  );
  noPagesBackend.dispose(noPagesHandle);

  // Automatic oldest-unprotected eviction (adversarial review: every chunk
  // the static priority admits is PROTECTED, so the initial load never
  // exercises insert()'s eviction branch). Regime-gated: it needs an
  // unprotected chunk, which exists only when pages < chunks.
  {
    const drillHandle = backend.load({ url: ASSET });
    scene3.scene.add(drillHandle.object);
    drillHandle.object.rotation.x = Math.PI;
    await awaitWhenReadyWithKick(drillHandle);
    const d0 = await spinUntilSettled(drillHandle);
    const pagesHere = d0.budget.pages;
    const chunks = d0.budget.pAsset;
    if (pagesHere < chunks) {
      const protectedLast = pagesHere - 1;
      const unprotected = pagesHere; // first chunk outside the protected set
      // 1. A full pool of protected residents refuses an unprotected chunk.
      const refusedWhenFull = !(await d0.admitChunk(unprotected));
      // 2. Free a protected slot; the unprotected chunk takes it (free-slot path).
      const freed = d0.evictChunk(protectedLast);
      const tookFree = await d0.admitChunk(unprotected);
      const unprotectedSlot = d0.slotOf(unprotected);
      // 3. Re-admit the protected chunk: no free slot → insert must evict
      //    the oldest UNPROTECTED resident (the only candidate) and take
      //    its slot; the unprotected chunk is no longer resident.
      const readmitted = await d0.admitChunk(protectedLast);
      const evictedUnprotected = !d0.isResident(unprotected);
      const tookEvictedSlot = d0.slotOf(protectedLast) === unprotectedSlot;
      const fresh = backend.pagerDiagnostics(drillHandle);
      assert(
        "automatic-eviction-oldest-unprotected",
        refusedWhenFull && freed && tookFree && readmitted && evictedUnprotected && tookEvictedSlot &&
          fresh.residentPages === pagesHere &&
          // The one deliberate full-pool refusal is exactly what the
          // diagnostics' defensive `refused` log must show — nothing else.
          fresh.refused.length === 1 && fresh.refused[0] === unprotected,
        `pages=${pagesHere}: full-pool admit(${unprotected}) refused=${refusedWhenFull}; evict(${protectedLast})=${freed}; admit(${unprotected}) took slot ${unprotectedSlot}=${tookFree}; re-admit(${protectedLast})=${readmitted} evicted ${unprotected}=${evictedUnprotected} into slot ${d0.slotOf(protectedLast)}=${tookEvictedSlot}; residentPages=${fresh.residentPages} firstUploaded=${fresh.firstUploaded} refused=[${fresh.refused.join(",")}]`,
      );
    } else {
      assert(
        "automatic-eviction-oldest-unprotected",
        true,
        `not applicable in this regime (pages=${pagesHere} >= chunks=${chunks}: no unprotected chunk exists) — proven under ?pages=32`,
      );
    }
    backend.dispose(drillHandle);
    scene3.scene.remove(drillHandle.object);
  }

  await yieldMacrotask();
  assert(
    "no-unhandled-rejections",
    unhandledRejections === 0,
    `${unhandledRejections} unhandledrejection events across every load in this fixture`,
  );

  status.textContent = `backend: ${scene3.backend} — ${passed} passed, ${failed} failed`;
  finishSummary();
  return { passed, failed };
})();

done.catch((err) => {
  const div = document.createElement("div");
  div.className = "assertion fail";
  div.textContent = `PAGER-LAB RUNNER FAILED: ${err}`;
  out.appendChild(div);
  failed++;
  finishSummary();
  console.error("pager-lab runner failed", err);
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    scene3.dispose();
    status.remove();
  });
}

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__pagerLab = {
    scene3,
    backend,
    handle: null,
    capture,
    captureSync,
    step: () => scene3.renderer.render(scene3.scene, scene3.camera),
  };
}

declare global {
  interface Window {
    __pagerLab?: {
      scene3: ThreeSplatScene;
      backend: ThreeGsBackend;
      handle: ReturnType<ThreeGsBackend["load"]> | null;
      capture: () => Promise<Record<string, number[]>>;
      captureSync: () => Record<string, number[] | string>;
      step: () => void;
    };
  }
}
