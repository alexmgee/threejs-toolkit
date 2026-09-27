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

function maxCaptureDiff(
  a: Record<string, number[] | string>,
  b: Record<string, number[] | string>,
  names: readonly string[],
): number {
  let max = 0;
  for (const name of names) {
    max = Math.max(max, maxChannelDiff(px(a, name), px(b, name)));
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

async function renderAndSettle(): Promise<void> {
  scene3.renderer.render(scene3.scene, scene3.camera);
  await yieldMacrotask();
  scene3.renderer.render(scene3.scene, scene3.camera);
}

async function spinUntilLodResidencyConverged(
  h: ReturnType<ThreeGsBackend["load"]>,
): Promise<{
  spins: number;
  elapsedMs: number;
  residencyChanges: number;
  selectedCount: number;
  residentPages: number;
  admitting: number;
  converged: boolean;
}> {
  // Convergence is a CHAIN: each admitted page re-traverses, which may want
  // the next page (under a budget smaller than the wanted set, pages swap
  // until the frontier and the protected set agree). Bound by TIME, not
  // spins — a spin is ~5 ms when nothing is dirty and ~300 ms when a
  // traversal runs, so a spin count means nothing (observed live
  // 2026-09-12: 200 spins expired mid-chain, then the state settled).
  // Converged = no admission in flight and residency + selection unchanged
  // across three consecutive samples.
  const t0 = performance.now();
  let prevResident = Number.NaN;
  let prevSelected = Number.NaN;
  let stable = 0;
  let spins = 0;
  let residencyChanges = 0;
  while (performance.now() - t0 < WAIT_BOUND_MS) {
    await renderAndSettle();
    spins++;
    const snap = backend.pagerDiagnostics(h);
    if (snap.residentPages !== prevResident || snap.lod.selectedCount !== prevSelected) {
      if (!Number.isNaN(prevResident)) residencyChanges++;
      stable = 0;
    } else if (snap.lod.admitting === 0) {
      stable++;
    }
    prevResident = snap.residentPages;
    prevSelected = snap.lod.selectedCount;
    if (stable >= 3) {
      return {
        spins,
        elapsedMs: performance.now() - t0,
        residencyChanges,
        selectedCount: snap.lod.selectedCount,
        residentPages: snap.residentPages,
        admitting: snap.lod.admitting,
        converged: true,
      };
    }
  }
  const snap = backend.pagerDiagnostics(h);
  return {
    spins,
    elapsedMs: performance.now() - t0,
    residencyChanges,
    selectedCount: snap.lod.selectedCount,
    residentPages: snap.residentPages,
    admitting: snap.lod.admitting,
    converged: false,
  };
}

function countResidentChunks(snap: PagerDiagnostics, chunkCount = 122): number {
  let n = 0;
  for (let i = 0; i < chunkCount; i++) {
    if (snap.isResident(i)) n++;
  }
  return n;
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
      if (diag.loadSettled) {
        // Ticket 07: the load settling is not the END of residency work —
        // each traversal admits newly wanted cached chunks (re-decode), and
        // each arrival re-traverses. Converge: no admission in flight and
        // residency + selection unchanged across two consecutive renders.
        const converged = await spinUntilLodResidencyConverged(h);
        if (!converged.converged) {
          throw new Error(`spinUntilSettled: LOD residency did not converge within ${WAIT_BOUND_MS} ms (admitting=${converged.admitting} residentPages=${converged.residentPages} spins=${converged.spins} residencyChanges=${converged.residencyChanges})`);
        }
        console.log(`pager-lab CONVERGENCE spins=${converged.spins} elapsedMs=${converged.elapsedMs.toFixed(0)} residencyChanges=${converged.residencyChanges} selected=${converged.selectedCount} residentPages=${converged.residentPages}`);
        return backend.pagerDiagnostics(h);
      }
    } catch (error) {
      if (error instanceof SplatBackendError && error.reason === "not-paged") continue;
      throw error;
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

  // Ticket 07: residency follows the traversal's wanted order (the
  // ChunkPriority swap point) — the PROTECTED set is the first `pages`
  // wanted chunks and, after convergence, every one of them is resident;
  // chunks the frontier never wanted at this pose stay deferred (fetched +
  // cached, never decoded). The budget is never exceeded.
  const wantedAtSettle = diag.lod.wantedChunks;
  const protectedWanted = wantedAtSettle.slice(0, Math.min(budgetPages, wantedAtSettle.length));
  let allProtectedResident = protectedWanted.length > 0;
  for (const chunk of protectedWanted) {
    if (!diag.isResident(chunk)) allProtectedResident = false;
  }
  // Every chunk is exactly one of: resident, cached for a later admission
  // (deferred at load OR evicted since), or unavailable — nothing may fall
  // through (a chunk with no bytes anywhere could never be shown again).
  let cachedNotResident = 0;
  for (let c = 0; c < 122; c++) if (!diag.isResident(c) && diag.isCached(c)) cachedNotResident++;
  const accounted = diag.residentPages + cachedNotResident + diag.unavailable.length;
  assert(
    "residency-within-budget",
    residentPagesMax <= budgetPages &&
      diag.residentPages <= budgetPages &&
      diag.residentPages === Math.min(budgetPages, wantedAtSettle.length) &&
      allProtectedResident &&
      accounted === 122 &&
      diag.unavailable.length === 0 &&
      diag.refused.length === 0,
    `residentPages=${diag.residentPages}/${budgetPages} (max observed during load ${residentPagesMax}); wanted=${wantedAtSettle.length}, protected=${protectedWanted.length} all resident=${allProtectedResident}; cached-not-resident=${cachedNotResident} (deferred at load ${diag.deferred.length}) unavailable=${diag.unavailable.length} refused=${diag.refused.length} → accounted ${accounted}/122`,
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
      counts.selected === diagForCounts.lod.drawCount &&
      counts.selected > 0 &&
      counts.selected <= counts.resident &&
      counts.selected <= diagForCounts.lod.tuning.maxSplats &&
      boundsOk,
    `total=${counts.total} resident=${counts.resident} selected=${counts.selected} maxSplats=${diagForCounts.lod.tuning.maxSplats} bounds min=(${box.min.x},${box.min.y},${box.min.z}) max=(${box.max.x},${box.max.y},${box.max.z})`,
  );

  // Ticket 07: the evict -> re-admit MACHINERY proof below is a ticket-06
  // drill and needs a residency the LOD driver will not heal on its own:
  // with selection ON, evicting a wanted chunk is undone by the next
  // traversal's admission before the capture can see it (observed live
  // 2026-09-12: evicted max diff 0 with the root re-admitted mid-drill).
  // Run it with selection OFF (every resident row drawn, the 06 behaviour),
  // then restore selection and re-converge. AC4's pose-driven half runs
  // further down with selection ON.
  await spinUntilLodResidencyConverged(handle);
  backend.pagerDiagnostics(handle).lod.setSelectionEnabled(false);
  await renderAndSettle();
  const P0 = await meteredCapture();
  // Sort-nondeterminism CONTROL (doc 05 H-LOAD criterion 4: "within-bin
  // sort order may reorder equal-depth splats — record the measured diff
  // band, never a silent pass"). With NO residency change, force the
  // vendored mesh's re-sort alone and measure how far the sampled pixels
  // move: on the WebGPU backend the GPU counting sort's within-bin order is
  // nondeterministic (measured live 2026-09-12: 1–11 channel units at the
  // same points a plain re-render leaves pixel-exact); the WebGL2 CPU sort
  // is deterministic (band 0). The evict/re-admit criterion below is
  // "within this measured band" — derived from this run, not invented.
  const SORT_CONTROL_RUNS = 5;
  const meshRec = diag.mesh as unknown as Record<string, unknown>;
  let sortBand = 0;
  for (let i = 0; i < SORT_CONTROL_RUNS; i++) {
    meshRec._sortInitialized = false;
    scene3.renderer.render(scene3.scene, scene3.camera);
    const Pc = await meteredCapture();
    for (const name of CAPTURE_POINT_NAMES) {
      sortBand = Math.max(sortBand, maxChannelDiff(px(P0, name), px(Pc, name)));
    }
  }
  // Evict chunks in index order, one at a time, until the sampled pixels
  // move by MORE than the sort band — the drill must be able to tell an
  // eviction from sort noise before "restored" means anything (at full
  // residency a single 65,536-splat chunk moved the ten points by 6 with a
  // band of 13; measured 2026-09-12). The count is whatever the band
  // demands, bounded by the resident pages — nothing pinned.
  const evictedChunks: number[] = [];
  const slotsBefore = new Map<number, number>();
  let evictedMax = 0;
  // Under LOD residency the resident set is the frontier's, not 0..pages-1
  // (at ?pages=32: chunks 0, 27, 104, ...) — walk the RESIDENT chunks.
  const residentForDrill: number[] = [];
  {
    const dRes = backend.pagerDiagnostics(handle);
    for (let c = 0; c < 122; c++) if (dRes.isResident(c)) residentForDrill.push(c);
  }
  for (const chunk of residentForDrill) {
    if (evictedMax > sortBand) break;
    slotsBefore.set(chunk, backend.pagerDiagnostics(handle).slotOf(chunk));
    if (!backend.pagerDiagnostics(handle).evictChunk(chunk)) break;
    evictedChunks.push(chunk);
    scene3.renderer.render(scene3.scene, scene3.camera);
    const P1 = await meteredCapture();
    for (const name of CAPTURE_POINT_NAMES.slice(0, 9)) {
      evictedMax = Math.max(evictedMax, maxChannelDiff(px(P0, name), px(P1, name)));
    }
  }
  const gridChanged = evictedMax > sortBand;
  // Re-admission restores RESIDENCY, not slot identity: with several slots
  // free the pool hands out the first free one, so multi-chunk re-admits
  // land in a permutation of the freed slots (observed live 2026-09-12;
  // the rendered result is slot-independent). The count of chunks that
  // came back to their old slot is reported, never asserted.
  let allResident = true;
  let sameSlot = 0;
  for (const chunk of evictedChunks) {
    await diag.admitChunk(chunk);
    if (!diag.isResident(chunk)) allResident = false;
    if (diag.slotOf(chunk) === slotsBefore.get(chunk)) sameSlot++;
  }
  scene3.renderer.render(scene3.scene, scene3.camera);
  const P2 = await meteredCapture();
  let readmitMax = 0;
  const diffDetails: string[] = [];
  for (const name of CAPTURE_POINT_NAMES) {
    const d = maxChannelDiff(px(P0, name), px(P2, name));
    if (d > 0) diffDetails.push(`${name}=${d}`);
    readmitMax = Math.max(readmitMax, d);
  }
  const evictReadmitOk = gridChanged && allResident && readmitMax <= sortBand;
  backend.pagerDiagnostics(handle).lod.setSelectionEnabled(true);
  await spinUntilLodResidencyConverged(handle);
  assert(
    "evict-readmit-pixel-identical",
    evictReadmitOk,
    `backend=${scene3.backend} evicted ${evictedChunks.length} chunk(s) [${evictedChunks.join(",")}], all resident again=${allResident} (${sameSlot} in their original slot); sort-only control band=${sortBand} over ${SORT_CONTROL_RUNS} re-sorts; evicted max diff=${evictedMax} (${gridChanged ? "above band" : "NOT above band — drill blind"}); re-admit max diff=${readmitMax}${diffDetails.length > 0 ? ` [${diffDetails.join(", ")}]` : " (exact)"} — ${readmitMax <= sortBand ? "within" : "OUTSIDE"} the measured band`,
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

  const gridPointNames = CAPTURE_POINT_NAMES.slice(0, 9);

  await renderAndSettle();
  const dSelection = backend.pagerDiagnostics(handle);
  assert(
    "selection-active",
    dSelection.lod.traversals >= 1 &&
      dSelection.lod.selectedCount === dSelection.lod.drawCount &&
      dSelection.lod.drawCount > 0 &&
      dSelection.lod.drawCount < dSelection.residentSplats &&
      dSelection.lod.wantedChunks.length > 0 &&
      dSelection.lod.wantedChunks[0] === 0,
    `selectedCount=${dSelection.lod.selectedCount} residentSplats=${dSelection.residentSplats} fullQuality=${dSelection.lod.fullQuality} traversals=${dSelection.lod.traversals} lastTraversalMs=${dSelection.lod.lastTraversalMs} wantedChunks.length=${dSelection.lod.wantedChunks.length} stats=${JSON.stringify(dSelection.lod.stats)}`,
  );

  const selectedCountTrials: number[] = [];
  for (let i = 0; i < 5; i++) {
    backend.pagerDiagnostics(handle).lod.markDirty();
    await renderAndSettle();
    selectedCountTrials.push(backend.pagerDiagnostics(handle).lod.selectedCount);
  }
  const selectedCountsEqual = selectedCountTrials.every((c) => c === selectedCountTrials[0]);
  const cameraUnchangedAfterTrials = scene3.camera.matrixWorld.equals(cameraBeforeLoad);
  assert(
    "selected-count-deterministic-5-trials",
    selectedCountsEqual && cameraUnchangedAfterTrials,
    `counts=[${selectedCountTrials.join(",")}] cameraUnchanged=${cameraUnchangedAfterTrials}`,
  );

  const pixelTrials: Array<Record<string, number[] | string>> = [];
  const pixelTrialMaxDiffs: number[] = [];
  for (let i = 0; i < 5; i++) {
    backend.pagerDiagnostics(handle).lod.markDirty();
    await renderAndSettle();
    const captured = await meteredCapture();
    pixelTrials.push(captured);
    if (i === 0) {
      pixelTrialMaxDiffs.push(0);
    } else {
      pixelTrialMaxDiffs.push(maxCaptureDiff(pixelTrials[0]!, captured, CAPTURE_POINT_NAMES));
    }
  }
  // AC2 / doc 05 criterion 4: "pixel-stable across trials; if strict
  // stability is unachievable, the measured diff band is recorded, never
  // passed silently". The WebGL2 CPU sort is deterministic → strict (band
  // must be 0). The WebGPU counting sort's within-bin order is
  // nondeterministic by design (06 evidence) → strict stability is
  // unachievable there; the trial band AND the sort-only control band are
  // recorded, and the checkable half — identical selection across the
  // trials (the content) — is what passes or fails. A sample-max-vs-
  // sample-max comparison of two noise draws would be a coin flip, not a
  // criterion.
  const pixelTrialBand = Math.max(...pixelTrialMaxDiffs);
  const pixelStableOk = isWebGpuBackend
    ? selectedCountsEqual
    : pixelTrialBand === 0 && selectedCountsEqual;
  assert(
    "pixel-stable-5-trials",
    pixelStableOk,
    `backend=${scene3.backend}: per-trial max diffs vs trial 1=[${pixelTrialMaxDiffs.join(",")}] → trial band=${pixelTrialBand}; sort-only control band=${sortBand}; selection identical across trials=${selectedCountsEqual}${isWebGpuBackend ? " (WebGPU: band RECORDED — strict pixel stability unachievable by the vendored GPU sort's design)" : " (WebGL2: strict — band must be 0)"}`,
  );

  resetInvalidationCounts();
  const P_a = await meteredCapture();
  const selectedCountBeforeScale = backend.pagerDiagnostics(handle).lod.selectedCount;
  // The coarser threshold must produce a VISIBLE change at the ten sample
  // points, not just a smaller count. Measured on WebGPU at 122 pages
  // (2026-09-12, band 9–16): scale 4 → 1,669,521 selected, diff 18; 16 →
  // 418,755 / 24; 64 → 107,750 / 62; 256 → 27,146 / 72; 1024 → 5,365 / 65.
  // Scale 64 is the first probe point whose change is unambiguously above
  // the noise band — the drill's lever is chosen from that table.
  const COARSE_LOD_RENDER_SCALE = 64;
  backend.pagerDiagnostics(handle).lod.setLodRenderScale(COARSE_LOD_RENDER_SCALE);
  await spinUntilLodResidencyConverged(handle);
  const P_b = await meteredCapture();
  const dScale = backend.pagerDiagnostics(handle);
  const scaleGridDiff = maxCaptureDiff(P_a, P_b, gridPointNames);
  dScale.lod.setLodRenderScale(1);
  // A coarser frontier can want chunks the fine one did not; restoring the
  // scale must be followed by residency re-convergence before comparing.
  const scaleReturn = await spinUntilLodResidencyConverged(handle);
  const P_c = await meteredCapture();
  const scaleRestoreDiff = maxCaptureDiff(P_a, P_c, CAPTURE_POINT_NAMES);
  // Criterion 10 (doc 05): the selection change re-dispatched the sort with
  // the camera motionless, the frontier shrank (coarser threshold) and the
  // draw count followed it, and restoring the threshold restored the exact
  // selection. Pixel diffs are RECORDED: at a 256×128 capture ten sample
  // points cannot reliably separate a 2× coarser frontier from sort noise
  // (measured live: 2 units), so they are evidence, not the criterion.
  assert(
    "selection-change-updates-draw-order-motionless",
    sortDispatches >= 1 &&
      dScale.lod.selectedCount < selectedCountBeforeScale &&
      dScale.lod.drawCount === dScale.lod.selectedCount &&
      scaleGridDiff > sortBand &&
      scaleReturn.converged &&
      scaleReturn.selectedCount === selectedCountBeforeScale &&
      scene3.camera.matrixWorld.equals(cameraBeforeLoad),
    `camera motionless; lodRenderScale 1→${COARSE_LOD_RENDER_SCALE}→1: selected ${selectedCountBeforeScale} → ${dScale.lod.selectedCount} → ${scaleReturn.selectedCount} (restore converged=${scaleReturn.converged} in ${scaleReturn.elapsedMs.toFixed(0)} ms, ${scaleReturn.residencyChanges} residency changes); sort re-dispatched ${sortDispatches}×; frame changed by ${scaleGridDiff} (> band ${sortBand} = visible) and returned to within ${scaleRestoreDiff} of the original (band recorded)`,
  );

  const P_on = await meteredCapture();
  const dCulling = backend.pagerDiagnostics(handle);
  dCulling.lod.setCullingEnabled(false);
  await renderAndSettle();
  const P_off = await meteredCapture();
  const dCullingOff = backend.pagerDiagnostics(handle);
  const cullingOffDiff = maxCaptureDiff(P_on, P_off, CAPTURE_POINT_NAMES);
  assert(
    "culling-off-restores-content",
    cullingOffDiff <= sortBand && dCullingOff.mesh.frustumCulled === false,
    `maxDiff=${cullingOffDiff} sortBand=${sortBand} frustumCulled=${dCullingOff.mesh.frustumCulled}`,
  );
  dCullingOff.lod.setCullingEnabled(true);

  // Culling is three's own frustum test against the resident pages' bounding
  // sphere (public API). At the pinned pose the camera sits INSIDE that
  // sphere (the hero spans ~950 units; the camera is 3 units from the
  // origin), so no rotation can cull it: a sphere test only culls when the
  // camera is outside the sphere looking away. Park the camera far outside
  // the resident bounds, facing away; restore the EXACT pose afterwards
  // (rotate/rotate-back is not an identity in floating point).
  const savedPos = scene3.camera.position.clone();
  const savedQuat = scene3.camera.quaternion.clone();
  const boundsForCull = backend.bounds(handle);
  const extent = Math.max(boundsForCull.max.x - boundsForCull.min.x, boundsForCull.max.y - boundsForCull.min.y, boundsForCull.max.z - boundsForCull.min.z);
  const farZ = boundsForCull.max.z + 4 * extent;
  const traversalsBeforeAway = backend.pagerDiagnostics(handle).lod.traversals;
  scene3.camera.position.set(0, 0, farZ);
  scene3.camera.lookAt(0, 0, farZ + 1);
  await renderAndSettle();
  const P_away = await meteredCapture();
  const dAway = backend.pagerDiagnostics(handle);
  let awayAllNearBackground = true;
  for (const name of gridPointNames) {
    if (!isNearBackground(px(P_away, name))) awayAllNearBackground = false;
  }
  const traversalsUnchanged = dAway.lod.traversals === traversalsBeforeAway;
  scene3.camera.position.copy(savedPos);
  scene3.camera.quaternion.copy(savedQuat);
  scene3.camera.updateMatrixWorld(true);
  await spinUntilLodResidencyConverged(handle);
  const P_back = await meteredCapture();
  const awayRestoreDiff = maxCaptureDiff(P_on, P_back, CAPTURE_POINT_NAMES);
  const restoredExactly = scene3.camera.matrixWorld.equals(cameraBeforeLoad);
  assert(
    "culling-culls-when-away",
    awayAllNearBackground && traversalsUnchanged && awayRestoreDiff <= sortBand && restoredExactly,
    `camera parked at z=${farZ.toFixed(0)} facing away: near-background=${awayAllNearBackground}, traversals before=${traversalsBeforeAway} after=${dAway.lod.traversals} (a culled mesh gets no onBeforeRender); restored exactly=${restoredExactly} restore max diff=${awayRestoreDiff} sortBand=${sortBand}`,
  );

  const poseS0 = backend.pagerDiagnostics(handle).lod.selectedCount;
  const poseP0 = await meteredCapture();
  if (pages === 32) {
    scene3.camera.position.set(0, 0, 30);
    scene3.camera.lookAt(0, 0, 0);
    const pose2 = await spinUntilLodResidencyConverged(handle);
    const dPose2 = backend.pagerDiagnostics(handle);
    const residentChunksAtPose2 = countResidentChunks(dPose2);
    const selectedAtPose2 = dPose2.lod.selectedCount;
    scene3.camera.position.copy(savedPos);
    scene3.camera.quaternion.copy(savedQuat);
    scene3.camera.updateMatrixWorld(true);
    const poseReturn = await spinUntilLodResidencyConverged(handle);
    const dPoseReturn = backend.pagerDiagnostics(handle);
    const residentChunksAtReturn = countResidentChunks(dPoseReturn);
    const P_return = await meteredCapture();
    const poseReturnDiff = maxCaptureDiff(poseP0, P_return, CAPTURE_POINT_NAMES);
    const poseReturnDiffDetails: string[] = [];
    for (const name of CAPTURE_POINT_NAMES) {
      const d = maxChannelDiff(px(poseP0, name), px(P_return, name));
      if (d > 0) poseReturnDiffDetails.push(`${name}=${d}`);
    }
    // AC4's pose-driven half: leaving the pose changes residency (eviction
    // pressure at 32 pages), returning must restore the SAME selection —
    // that is the checkable content criterion. Pixels: strict (band 0) on
    // the deterministic WebGL2 sort; on WebGPU the diff is RECORDED against
    // the sort-only band (doc 05 criterion 4), not judged — a noise draw vs
    // a noise draw is a coin flip, not a criterion (observed: 6 vs band 5
    // with the selection restored exactly).
    const poseOk =
      pose2.converged &&
      poseReturn.converged &&
      dPoseReturn.lod.selectedCount === poseS0 &&
      (isWebGpuBackend || poseReturnDiff === 0);
    assert(
      "pose-revisit-restores-selection",
      poseOk,
      `S0=${poseS0} selectedAtPose2=${selectedAtPose2} selectedAfterReturn=${dPoseReturn.lod.selectedCount} residentChunksAtPose2=${residentChunksAtPose2} residentChunksAtReturn=${residentChunksAtReturn} residentPages pose2=${pose2.residentPages} return=${poseReturn.residentPages} spins pose2=${pose2.spins} return=${poseReturn.spins} converged pose2=${pose2.converged} return=${poseReturn.converged} maxDiff=${poseReturnDiff} sortBand=${sortBand}${poseReturnDiffDetails.length > 0 ? ` [${poseReturnDiffDetails.join(", ")}]` : ""} (${isWebGpuBackend ? "WebGPU: pixel band RECORDED, selection judged" : "WebGL2: strict"})`,
    );
  } else {
    assert(
      "pose-revisit-restores-selection",
      true,
      "not applicable (no eviction pressure at 122 pages)",
    );
  }

  const dSelOff = backend.pagerDiagnostics(handle);
  dSelOff.lod.setSelectionEnabled(false);
  await renderAndSettle();
  const dSelOffAfter = backend.pagerDiagnostics(handle);
  const selectionOffOk = dSelOffAfter.lod.drawCount === dSelOffAfter.residentSplats;
  dSelOffAfter.lod.setSelectionEnabled(true);
  await renderAndSettle();
  const dSelOnAfter = backend.pagerDiagnostics(handle);
  const selectionOnOk = dSelOnAfter.lod.drawCount === poseS0;
  assert(
    "selection-off-draws-all-resident",
    selectionOffOk && selectionOnOk,
    `off drawCount=${dSelOffAfter.lod.drawCount} residentSplats=${dSelOffAfter.residentSplats} restored drawCount=${dSelOnAfter.lod.drawCount} S0=${poseS0}`,
  );

  // ─── Criterion 9's direct SH-output check (ticket 13, owner ruling W4 a) ───
  // doc 05 criterion 9: a page uploaded under a motionless camera becomes visible
  // with sort + SH re-dispatched. On WebGPU the vendored mesh keeps ONE
  // precomputed SH contribution per splat in a storage buffer
  // (GaussianSplatMesh.js:422-435; the pass at :592-607 writes every row of the
  // capacity) and SKIPS that pass while camera and mesh matrices are unchanged
  // (:207-220) — so a page admitted under a still camera gets fresh
  // view-dependent colour only because the backend re-arms the pass (residency
  // change → ThreeGsBackend.ts:959 → patches/paged.ts:330-332; the traversal the
  // insertion triggers re-arms it again, ThreeGsBackend.ts:1046, and runs BEFORE
  // the pass, paged.ts:198-203). WebGL2 evaluates SH per vertex on every draw
  // (GaussianSplatMesh.js:176-178) and never allocates the buffer (:426-429):
  // nothing stored can go stale there, so on WebGL2 the check asserts that premise.
  // It runs AFTER every pixel drill above, so none of them ever sees the slot
  // layout it leaves behind.
  // Drill (WebGPU): hold the page's own loop (throttleGate) so only the renders
  // below run; evict two resident non-root chunks — A at the lowest slot, B at
  // the highest — and admit B, which takes the first free slot: A's. Render once
  // under the unchanged camera and read that slot's contribution rows back (R1);
  // then force the pass (the flag reset) and read them again (R2). Same inputs,
  // so R1 must equal R2 bit for bit — and R2 must differ from the slot's rows
  // before the drill (R0, A's contributions), or the drill proved nothing.
  // Plants (URL only, never source): `?plant=sh-rearm-held` holds the flag at true
  // through the drill, swallowing every re-arm, so R1 keeps A's rows and the check
  // must FAIL; `?plant=sh-rearm-once` undoes only the insertion's re-arm, which the
  // traversal's own re-arm repairs in the same render — green by design;
  // `?plant=sh-premise` (WebGL2) puts the precomputed-SH node into the material,
  // as if that path read stored contributions — the premise check must FAIL.
  const shPlant = new URLSearchParams(location.search).get("plant");
  const meshRecord = diag.mesh as unknown as Record<string, unknown>;
  const shBuffers = meshRecord._buffers as
    | { sphericalHarmonicsContributionRead?: { value: THREE.StorageBufferAttribute } }
    | undefined;
  if (!isWebGpu) {
    const allocated = shBuffers?.sphericalHarmonicsContributionRead !== undefined;
    const material = (diag.mesh as unknown as { material: { vertexNode?: unknown } }).material;
    // The next render puts the backend's own node back (GaussianSplatMesh.js:176-185).
    if (shPlant === "sh-premise") material.vertexNode = meshRecord._precomputedSphericalHarmonicsVertexNode;
    const perVertex = material.vertexNode === meshRecord._sphericalHarmonicsVertexNode;
    assert(
      "sh-output-fresh-after-admission",
      !allocated && perVertex,
      `backend=${scene3.backend}: exempt by design — SH is evaluated per vertex on every draw; ` +
        `contribution buffer allocated=${allocated}, per-vertex SH node in use=${perVertex}` +
        (shPlant === null ? "" : shPlant === "sh-premise" ? "; plant sh-premise" : `; plant ${shPlant} has nothing to act on here`),
    );
  } else {
    const heldGate = scene3.throttleGate;
    scene3.throttleGate = () => true; // hold the loop: only the renders below run
    let shOk = false;
    let shDetail = "";
    try {
      const attribute = shBuffers?.sphericalHarmonicsContributionRead?.value;
      if (attribute === undefined) throw new Error("no SH contribution buffer on WebGPU");
      const cameraAtDrill = scene3.camera.matrixWorld.clone();
      const snap = backend.pagerDiagnostics(handle);
      const rows = attribute.count / snap.budget.pages;
      if (!Number.isInteger(rows)) {
        throw new Error(`capacity ${attribute.count} is not ${snap.budget.pages} whole slots`);
      }
      const readSlotRows = async (slot: number): Promise<Uint32Array> => {
        const bytes = rows * 16; // one vec4 of float32 per splat
        const data = await scene3.renderer.getArrayBufferAsync(attribute, null, slot * bytes, bytes);
        return new Uint32Array(data.slice(0)); // bit patterns, so equal floats compare exactly
      };
      const differing = (a: Uint32Array, b: Uint32Array): number => {
        let n = 0;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
        return n;
      };
      const residents: Array<[number, number]> = [];
      for (let chunk = 1; chunk < snap.budget.pAsset - 1; chunk++) {
        const slot = snap.slotOf(chunk);
        if (slot !== -1) residents.push([chunk, slot]);
      }
      residents.sort((x, y) => x[1] - y[1]);
      const [chunkA, slotA] = residents[0]!;
      const [chunkB, slotB] = residents[residents.length - 1]!;
      const r0 = await readSlotRows(slotA);
      if (shPlant === "sh-rearm-held") {
        Object.defineProperty(meshRecord, "_sphericalHarmonicsInitialized", {
          configurable: true,
          get: () => true,
          set: () => {},
        });
      }
      const evicted = snap.evictChunk(chunkA) && snap.evictChunk(chunkB);
      const admitted = await snap.admitChunk(chunkB);
      const landed = backend.pagerDiagnostics(handle).slotOf(chunkB);
      if (shPlant === "sh-rearm-once") meshRecord._sphericalHarmonicsInitialized = true;
      resetInvalidationCounts();
      scene3.renderer.render(scene3.scene, scene3.camera);
      const passesOnAdmissionRender = shDispatches;
      const r1 = await readSlotRows(slotA);
      if (shPlant === "sh-rearm-held") delete meshRecord._sphericalHarmonicsInitialized;
      meshRecord._sphericalHarmonicsInitialized = false; // force the pass over every row
      scene3.renderer.render(scene3.scene, scene3.camera);
      const r2 = await readSlotRows(slotA);
      const d12 = differing(r1, r2);
      const d02 = differing(r0, r2);
      let nonZero = 0;
      for (let i = 0; i < r2.length; i++) if (r2[i] !== 0) nonZero++;
      const cameraUnchanged = scene3.camera.matrixWorld.equals(cameraAtDrill);
      const restored = await spinUntilLodResidencyConverged(handle);
      const aBack = backend.pagerDiagnostics(handle).isResident(chunkA);
      shOk =
        evicted && admitted && landed === slotA && d12 === 0 && d02 > 0 && nonZero > 0 &&
        cameraUnchanged && restored.converged && aBack;
      shDetail =
        `backend=webgpu plant=${shPlant ?? "none"}: chunk ${chunkB} (slot ${slotB}) admitted into chunk ${chunkA}'s ` +
        `vacated slot ${slotA} → landed in ${landed}; SH passes on the admission render=${passesOnAdmissionRender}; ` +
        `R1 vs R2 (forced pass): ${d12} of ${r1.length} words differ; R0 (A's rows) vs R2: ${d02} differ; ` +
        `R2 non-zero words=${nonZero}; camera unchanged=${cameraUnchanged}; A resident again=${aBack} ` +
        `(converged=${restored.converged}, ${restored.spins} spins)`;
    } catch (error) {
      shDetail = `backend=webgpu plant=${shPlant ?? "none"}: the drill threw — ${String(error)}`;
    } finally {
      if (Object.getOwnPropertyDescriptor(meshRecord, "_sphericalHarmonicsInitialized")?.get !== undefined) {
        delete meshRecord._sphericalHarmonicsInitialized;
        meshRecord._sphericalHarmonicsInitialized = false;
      }
      scene3.throttleGate = heldGate;
    }
    assert("sh-output-fresh-after-admission", shOk, shDetail);
  }

  const evLod = backend.pagerDiagnostics(handle);
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
      `  backend: ${scene3.backend}\n` +
      `  lod: ${JSON.stringify({
        selected: evLod.lod.selectedCount,
        resident: evLod.residentSplats,
        fullQuality: evLod.lod.fullQuality,
        traversals: evLod.lod.traversals,
        lastTraversalMs: evLod.lod.lastTraversalMs,
        wanted: evLod.lod.wantedChunks.length,
      })}`,
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
      // The protected set is the first `pages` WANTED chunks (traversal
      // order), all resident after convergence; the unprotected chunk is
      // any cached non-resident chunk outside it.
      const wanted = d0.lod.wantedChunks;
      const protectedSet = new Set(wanted.slice(0, Math.min(pagesHere, wanted.length)));
      let protectedLast = pagesHere - 1;
      for (let r = Math.min(pagesHere, wanted.length) - 1; r >= 0; r--) {
        if (d0.isResident(wanted[r]!)) {
          protectedLast = wanted[r]!;
          break;
        }
      }
      let unprotected = pagesHere;
      for (let i = 0; i < chunks; i++) {
        if (!protectedSet.has(i) && !d0.isResident(i)) {
          unprotected = i;
          break;
        }
      }
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
