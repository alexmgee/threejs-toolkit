/**
 * measure.ts — task 6 instrumentation (H-LOAD as amended 2026-08-16, ADR 0003).
 *
 * Absolute-baseline instrument: no Spark control runs. One page load = one trial
 * of one configuration; the driver navigates 5× per {backend × regime} with a
 * fresh cache-buster (`v`) per trial. Results persist to localStorage; call
 * `window.__measure.report()` to aggregate.
 *
 * Trial phases (rAF-driven — the pane must be VISIBLE per doc 05 rule 5):
 *   LOAD      wait for steady state; record firstPixelMs / fullQualityMs,
 *             longest main-thread block (LongTask), peak JS heap, range purity.
 *   STABILITY three probe readbacks → pixel hash (criterion 4).
 *   DRAG      scripted quarter-orbit, per-frame ms → p95 (criterion 5).
 *   RESTORE   return to pose A, wait steady → selected count + hash must match
 *             the LOAD steady state (criterion 7; meaningful in ?pages=32).
 *   DONE      persist. HUD shows TRIAL DONE.
 *
 * URL: ?measure=1[&pages=32][&webgl=1]&v=<nonce>
 *
 * AUTO MODE: ?measure=1&auto=1 self-sequences the full matrix (5 clean trials
 * × {webgpu, webgl} × {derived default, pages=32}) by navigating itself to the
 * next needed configuration after each TRIAL DONE. Contaminated trials
 * (hidden pane) are recorded but not counted; the sequencer re-runs them.
 * Open it once in a normal, visible browser window and leave it alone.
 */
import * as THREE from "three/webgpu";

interface SpikeHandle {
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  splats: {
    updateSort(r: unknown, c: unknown): boolean;
    partialUploadBroken: boolean;
    assertPartialUploadConsumed(): boolean;
  };
  pool: {
    pageCount: number;
    capacity: number;
    progress: number;
    residentPageCount: number;
    admissibleMissing(): number[];
  };
  fetcher: { stats: { requested: number; landed: number; bytesLanded: number; rangeVerified: boolean } };
  stats: () => {
    backend: string;
    selectedCount: number;
    fullQuality: boolean;
    firstPixelMs: number | null;
    fullQualityMs: number | null;
    decodeMsTotal: number;
    uploadMsTotal: number;
    traverseMsTotal: number;
    traverseCount: number;
    decodedChunks: number;
    pixelScaleHeight: number;
  };
  isDecodeBusy: () => boolean;
  traverseNow: () => void;
}

export interface TrialRecord {
  config: string; // regime identity: "webgpu-default" | "webgl-pages32" | …
  v: string;
  date: string;
  budgetPages: number;
  /** True if the pane was ever hidden during the trial — timings invalid, discard and re-run. */
  contaminated: boolean;
  /** Render size at trial end — doc 05 wants a fixed size across trials; drift is flagged in report(). */
  windowW: number;
  windowH: number;
  // criterion 1
  firstPixelMs: number | null;
  fullQualityMs: number | null;
  /** Navigation → steady state (fetch done, admissible empty, decode idle) — the constrained regime's load-completion analog. */
  steadyMs: number | null;
  // criterion 2
  rangeOnly: boolean;
  chunksRequested: number;
  chunksLanded: number;
  // criterion 3
  steadySelected: number;
  // criterion 4
  pixelHashes: string[];
  // criterion 5
  dragP95FrameMs: number | null;
  dragFrames: number;
  // criterion 6
  allocationFailure: boolean;
  residentAtSteady: number;
  // criterion 7
  restoreSelected: number | null;
  restoreHash: string | null;
  // criterion 8
  progressMonotonic: boolean;
  // criteria 9–10 (arrivals under motionless camera became visible: selection
  // grew and order/SH updated without camera input during LOAD)
  motionlessGrowth: boolean;
  partialUploadBroken: boolean;
  longestTaskMs: number;
  peakJsHeapMB: number | null;
  gpuPoolBytes: number;
  decodeMsTotal: number;
  uploadMsTotal: number;
  traverseMsAvg: number;
  pixelScaleHeight: number;
}

const STORE_KEY = "native-rad-spike-trials-v1";
const TRIALS_PER_CONFIG = 5;
const MAX_TOTAL_ATTEMPTS = 60;

// GPU pool bytes are computed from the fork's allocation layout — no browser
// API reports them. Each term names one allocation in
// GaussianSplatMesh.fork.js (WebGPU path, SH degree 1, after the first SH
// compute); the WebGL fallback allocates more (buffer + transform-feedback
// dual + PBO texture per attribute) and is NOT modelled here.
const SORT_BIN_COUNT = 4096; // CountingSort binCount, fork constructor
const GPU_BYTES_PER_SPLAT =
  4 * 16 + // center, covarianceA, covarianceB, color — one vec4 f32 each
  3 * 4 + // sh1 — SH_BAND_WORDS[1] packed u32 words
  16 + // SH contribution — vec4 f32
  4 + // CountingSort order — u32
  4; // CountingSort bin — u32
const GPU_FIXED_BYTES =
  2 * SORT_BIN_COUNT * 4 + // CountingSort histogram + offset, u32 each
  4 * 3 * 4 + // instanced quad: 4 vertices × vec3 f32
  6 * 2; // quad index buffer: 6 × u16

// The full matrix in run order; `pages: null` = derived default budget.
const AUTO_MATRIX: { webgl: boolean; pages: number | null }[] = [
  { webgl: false, pages: null },
  { webgl: false, pages: 32 },
  { webgl: true, pages: null },
  { webgl: true, pages: 32 },
];

// Regime-based identity ("webgpu-default", "webgl-pages32"): the default
// regime's resolved page count is backend/device-derived and unknowable before
// boot, so records are keyed by regime; budgetPages carries the resolved value.
const configName = (webgl: boolean, pages: number | null): string =>
  `${webgl ? "webgl" : "webgpu"}-${pages === null ? "default" : `pages${pages}`}`;

const hashPixels = (buf: Uint8Array | Uint8ClampedArray | Float32Array): string => {
  // FNV-1a over quantized bytes — stable across identical renders.
  let h = 0x811c9dc5;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf instanceof Float32Array ? Math.round(buf[i] * 255) & 0xff : buf[i];
    h ^= byte;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
};

async function readbackHash(s: SpikeHandle, forceWebGL: boolean, size = 64): Promise<string> {
  s.splats.updateSort(s.renderer, s.camera);
  if (forceWebGL) {
    s.renderer.render(s.scene, s.camera);
    const c2d = document.createElement("canvas");
    c2d.width = size; c2d.height = size;
    const ctx = c2d.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(s.renderer.domElement, 0, 0, size, size);
    return hashPixels(ctx.getImageData(0, 0, size, size).data);
  }
  const target = new THREE.RenderTarget(size, size);
  s.renderer.setRenderTarget(target);
  s.renderer.render(s.scene, s.camera);
  s.renderer.setRenderTarget(null);
  const buf = (await s.renderer.readRenderTargetPixelsAsync(target, 0, 0, size, size)) as Uint8Array | Float32Array;
  target.dispose();
  return hashPixels(buf);
}

export function installMeasure(getSpike: () => SpikeHandle | undefined, forceWebGL: boolean, hud: (s: string) => void): void {
  const params = new URLSearchParams(location.search);
  const v = params.get("v") ?? "0";
  const auto = params.get("auto") === "1";
  const pagesParam = params.get("pages") !== null ? Number.parseInt(params.get("pages")!, 10) : null;

  // LongTask observer — installed at import time so boot-phase blocks count.
  let longestTaskMs = 0;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) longestTaskMs = Math.max(longestTaskMs, e.duration);
    }).observe({ type: "longtask", buffered: true });
  } catch { /* longtask unsupported → stays 0, reported as such */ }

  let peakHeap: number | null = null;
  setInterval(() => {
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    if (mem) peakHeap = Math.max(peakHeap ?? 0, mem.usedJSHeapSize);
  }, 500);

  // A hidden pane parks rAF and stretches every wall-clock number; a trial
  // that was ever hidden is invalid and must be re-run, never recorded as real.
  let contaminated = document.hidden;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) contaminated = true;
  });

  let progressMonotonic = true;
  let lastProgress = 0;
  let steadyFrames = 0;
  let lastSelected = -1;
  let selectedGrewWithoutMotion = false;
  let phase: "boot" | "load" | "stability" | "drag" | "restore" | "done" = "boot";

  const poseA = { position: new THREE.Vector3(0, 0, 3), target: new THREE.Vector3(0, 0, 0) };
  const record: Partial<TrialRecord> = {};
  const hashes: string[] = [];
  const dragDeltas: number[] = [];
  let dragStart = 0;
  let lastFrameT = 0;
  let restoreWaitFrames = 0;

  const steady = (s: SpikeHandle): boolean =>
    s.fetcher.stats.landed === s.fetcher.stats.requested &&
    s.fetcher.stats.requested > 0 &&
    s.pool.admissibleMissing().length === 0 &&
    !s.isDecodeBusy() &&
    s.stats().selectedCount > 0;

  const finalize = (s: SpikeHandle) => {
    const st = s.stats();
    const rec: TrialRecord = {
      config: configName(forceWebGL, pagesParam),
      v,
      date: new Date().toISOString(),
      budgetPages: s.pool.pageCount,
      contaminated,
      windowW: innerWidth,
      windowH: innerHeight,
      firstPixelMs: st.firstPixelMs,
      fullQualityMs: st.fullQualityMs,
      steadyMs: record.steadyMs ?? null,
      rangeOnly: s.fetcher.stats.rangeVerified,
      chunksRequested: s.fetcher.stats.requested,
      chunksLanded: s.fetcher.stats.landed,
      steadySelected: record.steadySelected ?? st.selectedCount,
      pixelHashes: hashes,
      dragP95FrameMs: dragDeltas.length
        ? [...dragDeltas].sort((a, b) => a - b)[Math.floor(dragDeltas.length * 0.95)]
        : null,
      dragFrames: dragDeltas.length,
      // Storage-buffer allocation failure has no synchronous signal: three.js
      // does not size-check before createBuffer, and WebGPU surfaces the
      // violation asynchronously via device.onuncapturederror. A trial that
      // completes at budget is evidence of no FATAL failure, not proof none
      // occurred — treat this field as "no failure observed".
      allocationFailure: false,
      residentAtSteady: record.residentAtSteady ?? s.pool.residentPageCount,
      restoreSelected: record.restoreSelected ?? null,
      restoreHash: record.restoreHash ?? null,
      progressMonotonic,
      motionlessGrowth: selectedGrewWithoutMotion,
      partialUploadBroken: s.splats.partialUploadBroken,
      longestTaskMs: Math.round(longestTaskMs * 10) / 10,
      peakJsHeapMB: peakHeap === null ? null : Math.round(peakHeap / 1048576),
      gpuPoolBytes: s.pool.capacity * GPU_BYTES_PER_SPLAT + GPU_FIXED_BYTES,
      decodeMsTotal: Math.round(st.decodeMsTotal),
      uploadMsTotal: Math.round(st.uploadMsTotal),
      traverseMsAvg: st.traverseCount ? Math.round((st.traverseMsTotal / st.traverseCount) * 10) / 10 : 0,
      pixelScaleHeight: st.pixelScaleHeight,
    };
    const all = JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]") as TrialRecord[];
    all.push(rec);
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
    phase = "done";
    hud(`TRIAL DONE ${rec.config} v=${v}${rec.contaminated ? " (CONTAMINATED — will re-run)" : ""}\nselected ${rec.steadySelected} · firstPixel ${rec.firstPixelMs?.toFixed(0)} ms · fullQuality ${rec.fullQualityMs?.toFixed(0)} ms\ndragP95 ${rec.dragP95FrameMs?.toFixed(1) ?? "—"} ms · hashes ${hashes.join(",")}\nrestore ${rec.restoreSelected ?? "—"}/${rec.restoreHash ?? "—"}`);

    if (auto) sequenceNext(all);
  };

  const sequenceNext = (all: TrialRecord[]) => {
    if (all.length >= MAX_TOTAL_ATTEMPTS) {
      hud(`AUTO SEQUENCE ABORTED: ${all.length} attempts without ${TRIALS_PER_CONFIG} clean trials per config.\nKeep the window visible and re-open ?measure=1&auto=1 to continue.`);
      return;
    }
    for (const cfg of AUTO_MATRIX) {
      const clean = all.filter((r) => r.config === configName(cfg.webgl, cfg.pages) && !r.contaminated).length;
      if (clean < TRIALS_PER_CONFIG) {
        const url =
          `${location.pathname}?measure=1&auto=1&v=auto-${Date.now()}` +
          (cfg.pages !== null ? `&pages=${cfg.pages}` : "") +
          (cfg.webgl ? "&webgl=1" : "");
        setTimeout(() => location.replace(url), 1500); // brief HUD visibility
        return;
      }
    }
    const clean = all.filter((r) => !r.contaminated).length;
    hud(`ALL TRIALS DONE — ${clean} clean records (${all.length} attempts).\nResults are in localStorage; __measure.report() aggregates.`);
  };

  let stabilityBusy = false;

  const tick = async () => {
    const s = getSpike();
    if (!s || phase === "done") return;
    const st = s.stats();
    const now = performance.now();

    progressMonotonic &&= s.pool.progress >= lastProgress - 1e-9;
    lastProgress = s.pool.progress;

    switch (phase) {
      case "boot":
        phase = "load";
        break;
      case "load": {
        if (lastSelected >= 0 && st.selectedCount > lastSelected) selectedGrewWithoutMotion = true;
        lastSelected = st.selectedCount;
        if (steady(s)) {
          steadyFrames++;
          if (steadyFrames >= 5) {
            record.steadyMs = now;
            record.steadySelected = st.selectedCount;
            record.residentAtSteady = s.pool.residentPageCount;
            phase = "stability";
          }
        } else {
          steadyFrames = 0;
        }
        break;
      }
      case "stability": {
        if (stabilityBusy) break;
        stabilityBusy = true;
        try {
          hashes.push(await readbackHash(s, forceWebGL));
        } finally {
          stabilityBusy = false;
        }
        if (hashes.length >= 3) {
          phase = "drag";
          dragStart = now;
          lastFrameT = now;
        }
        break;
      }
      case "drag": {
        const t = (now - dragStart) / 4000; // quarter orbit over 4 s
        if (t >= 1) {
          s.camera.position.copy(poseA.position);
          s.camera.lookAt(poseA.target);
          phase = "restore";
          restoreWaitFrames = 0;
          break;
        }
        const theta = (Math.PI / 2) * t;
        s.camera.position.set(3 * Math.sin(theta), 0.3 * t, 3 * Math.cos(theta));
        s.camera.lookAt(poseA.target);
        dragDeltas.push(now - lastFrameT);
        lastFrameT = now;
        break;
      }
      case "restore": {
        if (steady(s)) {
          restoreWaitFrames++;
          if (restoreWaitFrames >= 5 && !stabilityBusy) {
            stabilityBusy = true;
            try {
              record.restoreSelected = s.stats().selectedCount;
              record.restoreHash = await readbackHash(s, forceWebGL);
            } finally {
              stabilityBusy = false;
            }
            finalize(s);
          }
        } else {
          restoreWaitFrames = 0;
        }
        break;
      }
    }
  };

  (window as unknown as Record<string, unknown>).__measure = {
    tick, // main.ts calls this every animation frame
    phase: () => phase,
    report(): Record<string, unknown> {
      const all = JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]") as TrialRecord[];
      const byConfig: Record<string, TrialRecord[]> = {};
      for (const r of all) {
        if (r.contaminated) continue; // hidden-pane trials never aggregate
        (byConfig[r.config] ??= []).push(r);
      }
      const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
      const summary: Record<string, unknown> = {};
      for (const [config, rs] of Object.entries(byConfig)) {
        summary[config] = {
          trials: rs.length,
          medianFirstPixelMs: median(rs.map((r) => r.firstPixelMs ?? NaN)),
          medianFullQualityMs: median(rs.map((r) => r.fullQualityMs ?? NaN)),
          medianSteadyMs: median(rs.map((r) => r.steadyMs ?? NaN)),
          selectedCounts: [...new Set(rs.map((r) => r.steadySelected))],
          hashesConsistentWithinTrials: rs.every((r) => new Set(r.pixelHashes).size <= 1),
          hashesAcrossTrials: [...new Set(rs.flatMap((r) => r.pixelHashes))],
          medianDragP95: median(rs.map((r) => r.dragP95FrameMs ?? NaN)),
          // Criterion 7, both halves: selected-count restoration AND the pixel
          // check (restore hash must match one of the trial's own steady-state
          // stability hashes; GPU within-bin nondeterminism makes cross-check
          // hash misses possible without error — reported, not conflated).
          restoreSelectedMatches: rs.every((r) => r.restoreSelected === null || r.restoreSelected === r.steadySelected),
          restoreHashMatches: rs.every((r) => r.restoreHash === null || r.pixelHashes.includes(r.restoreHash)),
          windowSizesConsistent: new Set(rs.map((r) => `${r.windowW}x${r.windowH}`)).size <= 1,
          progressMonotonicAll: rs.every((r) => r.progressMonotonic),
          motionlessGrowthAll: rs.every((r) => r.motionlessGrowth),
          rangeOnlyAll: rs.every((r) => r.rangeOnly && r.chunksLanded === r.chunksRequested),
          partialUploadBrokenAny: rs.some((r) => r.partialUploadBroken),
          longestTaskMsMax: Math.max(...rs.map((r) => r.longestTaskMs)),
          peakJsHeapMBMax: Math.max(...rs.map((r) => r.peakJsHeapMB ?? 0)),
        };
      }
      return { raw: all, summary };
    },
    clear() {
      localStorage.removeItem(STORE_KEY);
    },
  };
}
