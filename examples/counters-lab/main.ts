/**
 * counters-lab — StatsHUD and computeSplatBounds read the seam's counters
 * (Phase 2 ticket 11: AC1 and AC2; rulings D1/S5/S6 for the HUD and
 * A1/B1/C1/S2/S4 for the bounds).
 *
 * Runs the hero in the EVICTION regime (`?pages=32`, this page's default) on
 * whichever backend the URL selects (default WebGPU, `?webgl=1`):
 *  - AC1 — the HUD's DISPLAYED `src` and `resident` against an independent
 *    read: this fixture's own parse of the .rad header (its total, and the
 *    sum of the per-chunk counts over the resident chunks). Its `drawn` is
 *    compared to `counts().selected` read at the same instant, which is
 *    HONEST BUT SELF-REFERENTIAL: the draw count has no other public source,
 *    so that check pins consistency, not truth (owner's addition at the
 *    fixture-plan approval).
 *  - AC2 — at sampled moments during load, around `evictChunk` /
 *    `admitChunk`, with nothing resident, and at convergence, `bounds()`
 *    EXACTLY equals the union this fixture computes by decoding the resident
 *    chunks ITSELF (own Range fetches, own decode workers, own per-point
 *    min/max). No direction is asserted: a paged union grows as pages arrive
 *    and SHRINKS on eviction.
 *  - S4 — under the loader's flip, `computeSplatBounds(…, {padFraction: 0})`
 *    equals this fixture's own PER-POINT world box exactly; under a tilt it
 *    is never smaller, and strictly larger on at least one axis, so the
 *    never-smaller check cannot pass vacuously.
 *  - S2/S6 — the ruled refusals on real data: null before construct and with
 *    no page resident; `unknown-handle` after dispose from BOTH
 *    computeSplatBounds and the HUD's update.
 *
 * Every sample is ONE synchronous block (resident sweep, `bounds()`,
 * `counts()`, HUD refresh and read): residency only moves in worker-message
 * macrotasks, so nothing can shift inside a sample. The resident SET is
 * backend-reported (`isResident`) — the seam's own answer, not an independent
 * one; what this fixture computes independently is the geometry and the
 * counts behind it. Chunk boxes are a pure function of the file, so decoding
 * happens ONCE, after sampling, and every sample is scored from that cache.
 *
 * Selection is turned OFF around the eviction samples so the LOD driver
 * cannot heal them, and a HELD last-chunk fetch keeps the load
 * deterministically unsettled for the mid-load samples; the convergence
 * sample runs with selection back ON.
 *
 * Hero loads run one at a time (handoff 007: concurrent hero loads lose the
 * GPU device). Waits are time-bounded and timer-free (MessageChannel).
 *
 * DEV hook: window.__countersLab { done } — await done for {passed, failed}.
 */

import { ThreeSplatScene } from "@toolkit/core/ThreeSplatScene";
import { loadSplat } from "@toolkit/core/SplatLoader";
import { StatsHUD } from "@toolkit/core/StatsHUD";
import { computeSplatBounds } from "@toolkit/core/SplatBounds";
import { SplatBackendError, type SplatCounts, type SplatHandle } from "@toolkit/backend/SplatBackend";
import { ThreeGsBackend } from "@toolkit/backend/ThreeGsBackend";
import type { DecodeResult } from "@toolkit/backend/rad-worker";

const ASSET = "/@fs/D:/Projects/sparkjs-toolkit/examples/assets/lab-sh1-sparsity.rad";

const container = document.getElementById("viewer")!;
const hudHost = document.getElementById("hud")!;
const out = document.getElementById("out")!;
const params = new URLSearchParams(location.search);
const forceWebGL = params.get("webgl") === "1";
const pagesParam = params.get("pages");
// This page IS the eviction-regime fixture (ADR 0003's `?pages=N`), so a bare
// URL runs the regime the ACs need; ?pages=N still overrides it.
const pages = pagesParam !== null && !Number.isNaN(Number(pagesParam)) ? Number(pagesParam) : 32;

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, detail: string): void {
  const div = document.createElement("div");
  div.className = `assertion ${condition ? "pass" : "fail"}`;
  div.textContent = `${condition ? "PASS" : "FAIL"} — ${name}: ${detail}`;
  out.appendChild(div);
  console.log(`counters-lab ${condition ? "PASS" : "FAIL"} ${name} — ${detail}`);
  condition ? passed++ : failed++;
}

function finishSummary(): void {
  const heading = document.createElement("h2");
  heading.className = failed === 0 ? "pass" : "fail";
  heading.textContent = `counters-lab: ${passed} passed, ${failed} failed`;
  out.appendChild(heading);
  console.log(`counters-lab RESULT ${passed} passed, ${failed} failed`);
}

function createDecodeWorker(): Worker {
  return new Worker(new URL("@toolkit/backend/rad-worker.ts", import.meta.url), {
    type: "module",
  });
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

// Pager-lab's bound: 10 × the measured cold hero load (~12 s from the dev
// server, ticket 05). Timer-free: performance.now() reads + MessageChannel.
const WAIT_BOUND_MS = 10 * 12_000;

let unhandledRejections = 0;
window.addEventListener("unhandledrejection", (ev) => {
  unhandledRejections++;
  console.error("counters-lab UNHANDLED REJECTION", ev.reason);
});

const scene3 = new ThreeSplatScene({
  container,
  fov: 60,
  cameraPosition: [0, 0, 3],
  background: 0x111133,
  forceWebGL,
});

/** Render + yield until `done()` holds. The pane's own animation frames are
 *  absent or throttled, so the fixture drives every frame it needs. */
async function pumpUntil(label: string, done: () => boolean): Promise<number> {
  const t0 = performance.now();
  for (;;) {
    if (done()) return performance.now() - t0;
    if (performance.now() - t0 > WAIT_BOUND_MS) {
      throw new Error(`${label}: not reached within ${WAIT_BOUND_MS} ms`);
    }
    scene3.renderer.render(scene3.scene, scene3.camera);
    await yieldMacrotask();
  }
}

// ─── This fixture's OWN read of the container format (decode-lab's pattern;
//     never parseRadHeader, which is the backend's own code) ───

async function fetchRange(from: number, to: number): Promise<ArrayBuffer> {
  const res = await fetch(ASSET, { headers: { Range: `bytes=${from}-${to}` } });
  if (res.status !== 206) throw new Error(`expected 206 for bytes=${from}-${to}, got ${res.status}`);
  return res.arrayBuffer();
}

interface OwnHeader {
  readonly total: number;
  readonly chunkSize: number;
  readonly chunks: ReadonlyArray<{ offset: number; bytes: number; count: number; base: number }>;
  readonly chunksStart: number;
}

async function readOwnHeader(): Promise<OwnHeader> {
  const head = new DataView(await fetchRange(0, 7));
  const magic = head.getUint32(0, true);
  if (magic !== 0x30444152) throw new Error(`not a .rad container: magic 0x${magic.toString(16)}`);
  const headerLength = head.getUint32(4, true);
  const meta = JSON.parse(new TextDecoder().decode(await fetchRange(8, 8 + headerLength - 1))) as {
    count: number;
    chunkSize: number;
    chunks: Array<{ offset: number; bytes: number; count: number; base: number }>;
  };
  return {
    total: meta.count,
    chunkSize: meta.chunkSize,
    chunks: meta.chunks,
    chunksStart: 8 + Math.ceil(headerLength / 8) * 8,
  };
}

// ─── The independent geometry: this fixture decodes chunks itself ───

interface OwnChunk {
  readonly count: number;
  /** Exact per-point min/max of this chunk's centres: [minX,minY,minZ,maxX,maxY,maxZ]. */
  readonly box: readonly number[];
  /** Kept only for the chunks the S4 per-point world box needs. */
  readonly centers: Float32Array | null;
}

const ownChunks = new Map<number, OwnChunk>();

function decodeOn(worker: Worker, index: number, bytes: ArrayBuffer): Promise<DecodeResult> {
  return new Promise((resolve, reject) => {
    worker.onmessage = (ev: MessageEvent<DecodeResult & { error?: string }>) =>
      ev.data.error ? reject(new Error(`chunk ${index}: ${ev.data.error}`)) : resolve(ev.data);
    worker.onerror = (e) => reject(new Error(`worker error on chunk ${index}: ${e.message}`));
    worker.postMessage({ index, bytes }, [bytes]);
  });
}

/** Decode `wanted` with this fixture's own workers and cache each chunk's
 *  exact per-point box; centres are retained only for `keepCenters`. */
async function decodeOwnChunks(header: OwnHeader, wanted: number[], keepCenters: ReadonlySet<number>): Promise<void> {
  const todo = wanted.filter((i) => !ownChunks.has(i));
  if (todo.length === 0) return;
  let next = 0;
  const workers = [0, 1, 2, 3].map(() => createDecodeWorker());
  try {
    await Promise.all(
      workers.map(async (worker) => {
        while (next < todo.length) {
          const index = todo[next++]!;
          const c = header.chunks[index]!;
          const bytes = await fetchRange(header.chunksStart + c.offset, header.chunksStart + c.offset + c.bytes - 1);
          const r = await decodeOn(worker, index, bytes);
          let minX = Infinity, minY = Infinity, minZ = Infinity;
          let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
          for (let k = 0; k < r.count; k++) {
            const x = r.center[k * 3]!, y = r.center[k * 3 + 1]!, z = r.center[k * 3 + 2]!;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (z < minZ) minZ = z;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
            if (z > maxZ) maxZ = z;
          }
          ownChunks.set(index, {
            count: r.count,
            box: [minX, minY, minZ, maxX, maxY, maxZ],
            centers: keepCenters.has(index) ? r.center : null,
          });
        }
      }),
    );
  } finally {
    for (const w of workers) w.terminate();
  }
}

/** Union of this fixture's own per-chunk boxes, or null for an empty set. */
function ownUnion(chunks: readonly number[]): number[] | null {
  let box: number[] | null = null;
  for (const i of chunks) {
    const c = ownChunks.get(i);
    if (c === undefined) throw new Error(`chunk ${i} was never decoded by this fixture`);
    box = box === null
      ? [...c.box]
      : [
        Math.min(box[0]!, c.box[0]!), Math.min(box[1]!, c.box[1]!), Math.min(box[2]!, c.box[2]!),
        Math.max(box[3]!, c.box[3]!), Math.max(box[4]!, c.box[4]!), Math.max(box[5]!, c.box[5]!),
      ];
  }
  return box;
}

/** This fixture's own PER-POINT world box: every retained centre through the
 *  given world matrix (the 16 elements as three orders them). */
function ownWorldBox(chunks: readonly number[], m: readonly number[]): number[] | null {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let seen = 0;
  for (const i of chunks) {
    const centers = ownChunks.get(i)?.centers;
    if (!centers) throw new Error(`chunk ${i}'s centres were not retained`);
    const c = ownChunks.get(i)!;
    for (let k = 0; k < c.count; k++) {
      const x = centers[k * 3]!, y = centers[k * 3 + 1]!, z = centers[k * 3 + 2]!;
      const wx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
      const wy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
      const wz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
      if (wx < minX) minX = wx;
      if (wy < minY) minY = wy;
      if (wz < minZ) minZ = wz;
      if (wx > maxX) maxX = wx;
      if (wy > maxY) maxY = wy;
      if (wz > maxZ) maxZ = wz;
      seen++;
    }
  }
  return seen === 0 ? null : [minX, minY, minZ, maxX, maxY, maxZ];
}

const fmtBox = (b: readonly number[] | null): string =>
  b === null ? "none" : `[${b.slice(0, 3).map((v) => v.toFixed(6)).join(", ")}]..[${b.slice(3).map((v) => v.toFixed(6)).join(", ")}]`;

const boxesEqual = (a: readonly number[] | null, b: readonly number[] | null): boolean =>
  a === null || b === null ? a === b : a.every((v, i) => v === b[i]);

/** a contains b (never smaller), with no tolerance. */
const contains = (a: readonly number[], b: readonly number[]): boolean =>
  a[0]! <= b[0]! && a[1]! <= b[1]! && a[2]! <= b[2]! && a[3]! >= b[3]! && a[4]! >= b[4]! && a[5]! >= b[5]!;

/** Strictly larger on at least one axis — what keeps "never smaller" honest. */
const strictlyLargerSomewhere = (a: readonly number[], b: readonly number[]): boolean =>
  a[0]! < b[0]! || a[1]! < b[1]! || a[2]! < b[2]! || a[3]! > b[3]! || a[4]! > b[4]! || a[5]! > b[5]!;

const K = (n: number): string => `${(n / 1000).toFixed(0)}K`;

// ─── Samples ───

interface Sample {
  readonly label: string;
  readonly residentChunks: number[];
  readonly seam: { kind: "box"; box: number[] } | { kind: "refused"; reason: string };
  readonly counts: SplatCounts;
  readonly hudText: string;
  readonly residentPages: number;
  readonly loadSettled: boolean;
  readonly selectionEnabled: boolean;
}

const samples: Sample[] = [];

const hudFields = (text: string): { drawn: string; resident: string; src: string } | null => {
  const m = /^\d+ fps \| drawn: (\d+K) \| resident: (\d+K) \| src: (\d+K)$/.exec(text);
  return m === null ? null : { drawn: m[1]!, resident: m[2]!, src: m[3]! };
};

async function main(): Promise<void> {
  await scene3.ready;
  const header = await readOwnHeader();
  const chunkCount = header.chunks.length;
  const lastChunk = chunkCount - 1;
  const chunkStart = (index: number): number => header.chunksStart + header.chunks[index]!.offset;
  assert(
    "regime",
    true,
    `renderer backend=${scene3.backend}; ?pages=${pages}; this fixture's own header read: ${header.total} splats in ${chunkCount} chunks of ${header.chunkSize} (last ${header.chunks[lastChunk]!.count})`,
  );

  // The last chunk's request is HELD, so the load stays deterministically
  // unsettled while the mid-load samples are taken (loader-lab's pattern).
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  const holdLast: typeof fetch = async (input, init) => {
    const range = init?.headers instanceof Headers
      ? init.headers.get("Range")
      : (init?.headers as Record<string, string> | undefined)?.Range ?? null;
    const start = range ? Number(/^bytes=(\d+)/.exec(range)?.[1] ?? NaN) : NaN;
    if (start === chunkStart(lastChunk)) await released;
    return fetch(input, init);
  };

  const backend = new ThreeGsBackend({
    renderer: scene3.renderer,
    createDecodeWorker,
    pageBudgetOverride: pages,
    fetchImpl: holdLast,
  });

  let revealed = false;
  let loadError: string | null = null;
  const handle = loadSplat({
    url: ASSET,
    backend,
    quaternion: [1, 0, 0, 0], // the loader's 180° X flip, exactly (S4 tests it)
    onLoad: () => { revealed = true; },
    onError: (error) => { loadError = error.reason; },
  });

  // S2 on real data: nothing is built yet, so the seam refuses by name and
  // computeSplatBounds answers the pin's null rather than throwing.
  let preReason = "";
  try {
    backend.bounds(handle);
  } catch (error) {
    if (error instanceof SplatBackendError) preReason = error.reason;
  }
  assert(
    "s2-before-construct-null",
    computeSplatBounds(backend, handle) === null && preReason === "bounds-before-construct",
    `seam refused with "${preReason}"; computeSplatBounds → null`,
  );

  scene3.scene.add(handle.object);
  const hud = new StatsHUD({ container: hudHost, backend, handles: handle });
  const hudElement = (): string => hudHost.lastElementChild?.textContent ?? "";
  // deltaTime ≥ the HUD's own 10 Hz interval, so every sample gets a refresh
  // rather than a stale line.
  const HUD_FORCE_DT = 1;

  /** ONE synchronous block: no render and no await inside, so residency —
   *  which only changes in worker-message macrotasks — cannot move mid-sample. */
  function sample(label: string): Sample {
    const diag = backend.pagerDiagnostics(handle);
    const residentChunks: number[] = [];
    for (let c = 0; c < chunkCount; c++) if (diag.isResident(c)) residentChunks.push(c);
    let seam: Sample["seam"];
    try {
      const b = backend.bounds(handle);
      seam = { kind: "box", box: [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z] };
    } catch (error) {
      seam = { kind: "refused", reason: error instanceof SplatBackendError ? error.reason : String(error) };
    }
    const counts = backend.counts(handle);
    hud.update(HUD_FORCE_DT);
    const entry: Sample = {
      label,
      residentChunks,
      seam,
      counts,
      hudText: hudElement(),
      residentPages: diag.residentPages,
      loadSettled: diag.loadSettled,
      selectionEnabled: diag.lod.selectionEnabled,
    };
    samples.push(entry);
    return entry;
  }

  await pumpUntil("hero reveal", () => revealed || loadError !== null);
  assert("reveal", revealed && loadError === null, `revealed=${revealed} error=${loadError ?? "none"}`);

  // ── Mid-load samples: the last chunk is held, so the load cannot settle ──
  for (let i = 0; i < 3; i++) {
    const before = backend.pagerDiagnostics(handle).firstUploaded;
    await pumpUntil(`mid-load progress ${i}`, () => backend.pagerDiagnostics(handle).firstUploaded > before);
    sample(`mid-load ${i + 1}`);
  }
  // The hold is the only thing making these samples MID-load. Assert it bit:
  // if the matcher ever stops matching the backend's request shape, these
  // become post-settle samples and every check below would still pass
  // (built-in review, 2026-09-20).
  {
    const midLoad = samples.filter((s) => s.label.startsWith("mid-load"));
    assert(
      "mid-load-samples-are-mid-load",
      midLoad.length === 3 && midLoad.every((s) => !s.loadSettled && !s.residentChunks.includes(lastChunk)),
      `held chunk ${lastChunk}: load settled at each sample = [${midLoad.map((s) => s.loadSettled).join(", ")}], held chunk resident = [${midLoad.map((s) => s.residentChunks.includes(lastChunk)).join(", ")}]`,
    );
  }

  // ── Eviction and admission, selection OFF so the driver cannot heal them ──
  // The drill evicts a KNOWN count, so wait until that many pages are actually
  // resident first: under a slow upload schedule the check would otherwise go
  // red for a reason that has nothing to do with eviction (adversarial review,
  // 2026-09-20 — demonstrated by running this block against a scripted
  // one-upload-per-pump backend).
  // Never more than the effective budget can hold, so a small `?pages=N` run
  // fails a check rather than spinning out the wait bound (built-in review).
  const EVICT_COUNT = Math.min(5, backend.pagerDiagnostics(handle).budget.pages);
  await pumpUntil(
    `${EVICT_COUNT} pages resident`,
    () => backend.pagerDiagnostics(handle).residentPages >= EVICT_COUNT,
  );
  backend.pagerDiagnostics(handle).lod.setSelectionEnabled(false);
  scene3.renderer.render(scene3.scene, scene3.camera);
  const beforeEvict = sample("selection-off, before eviction");
  const evicted: number[] = [];
  {
    const diag = backend.pagerDiagnostics(handle);
    for (const c of beforeEvict.residentChunks.slice(0, EVICT_COUNT)) if (diag.evictChunk(c)) evicted.push(c);
  }
  const afterEvict = sample("after evictChunk");
  assert(
    "eviction-took",
    beforeEvict.residentPages >= EVICT_COUNT && evicted.length === EVICT_COUNT &&
      afterEvict.residentPages === beforeEvict.residentPages - EVICT_COUNT,
    `evicted [${evicted.join(", ")}] of ${beforeEvict.residentPages} resident: resident pages ${beforeEvict.residentPages} → ${afterEvict.residentPages}`,
  );

  const admitted = evicted[0]!;
  const admitOk = await backend.pagerDiagnostics(handle).admitChunk(admitted);
  const afterAdmit = sample("after admitChunk");
  assert(
    "admission-took",
    admitOk && afterAdmit.residentChunks.includes(admitted),
    `admitChunk(${admitted}) → ${admitOk}; resident pages ${afterEvict.residentPages} → ${afterAdmit.residentPages}`,
  );

  // ── Nothing resident: the seam refuses by name, computeSplatBounds nulls ──
  {
    const diag = backend.pagerDiagnostics(handle);
    for (const c of [...afterAdmit.residentChunks]) diag.evictChunk(c);
  }
  const empty = sample("all pages evicted");
  const emptyBounds = computeSplatBounds(backend, handle);
  assert(
    "s2-no-resident-pages-null",
    empty.residentChunks.length === 0 && empty.seam.kind === "refused" &&
      empty.seam.reason === "no-resident-pages" && emptyBounds === null,
    `resident chunks=${empty.residentChunks.length}; seam refused with "${empty.seam.kind === "refused" ? empty.seam.reason : "—"}"; computeSplatBounds → ${emptyBounds === null ? "null" : "a box"}`,
  );

  // ── Release the held chunk, selection back ON, run to convergence ──
  release();
  backend.pagerDiagnostics(handle).lod.setSelectionEnabled(true);
  await pumpUntil("hero settle", () => backend.pagerDiagnostics(handle).loadSettled);
  // The EFFECTIVE budget, not the requested override: the backend takes
  // min(P_limits, P_asset, override), so a request above the asset's chunk
  // count or above the device's limit settles lower — comparing against the
  // request would fail honestly-converged runs and hang the wait (adversarial
  // review, 2026-09-20; `?pages=123` on this 122-chunk asset is the case).
  const budget = backend.pagerDiagnostics(handle).budget;
  await pumpUntil(
    "budget refilled",
    () => backend.pagerDiagnostics(handle).residentPages >= budget.pages,
  );
  const converged = sample("converged, selection on");
  assert(
    "convergence",
    converged.loadSettled && converged.selectionEnabled && converged.residentPages === budget.pages &&
      converged.counts.selected > 0,
    `load settled, selection on: ${converged.residentPages}/${budget.pages} pages resident (budget source: ${budget.source}; requested ?pages=${pages}) = ${converged.counts.resident} of ${converged.counts.total} splats; drawn ${converged.counts.selected}`,
  );

  // ── S4, in one synchronous block: the flip, then a tilt on top of it ──
  const flip = handle.object.quaternion.clone();
  const s4 = sample("S4 (flip, then tilt)");
  const s4Flip = computeSplatBounds(backend, handle, { padFraction: 0 });
  const flipMatrix = handle.object.matrixWorld.elements.slice();
  // COMPOSED onto the flip, not replacing it: assigning `rotation` would
  // overwrite the quaternion (three syncs Euler → quaternion), so the tilt
  // would be tested without the loader's flip — which the record then
  // misdescribed (adversarial review, 2026-09-20). rotateX/Y/Z multiply.
  handle.object.rotateX(0.3);
  handle.object.rotateY(0.5);
  handle.object.rotateZ(0.2);
  const s4Tilt = computeSplatBounds(backend, handle, { padFraction: 0 });
  const tiltMatrix = handle.object.matrixWorld.elements.slice();
  handle.object.quaternion.copy(flip);
  handle.object.updateWorldMatrix(true, false, true);

  // ── Decode what the samples need, with this fixture's own workers ──
  const needed = new Set<number>();
  for (const s of samples) for (const c of s.residentChunks) needed.add(c);
  const decodeMs = performance.now();
  await decodeOwnChunks(header, [...needed].sort((a, b) => a - b), new Set(s4.residentChunks));
  assert(
    "independent-decode",
    [...needed].every((i) => ownChunks.get(i)!.count === header.chunks[i]!.count),
    `${needed.size} chunks decoded by this fixture in ${(performance.now() - decodeMs).toFixed(0)} ms (own Range fetches, own workers); every decoded count equals the header's`,
  );

  // ── AC2: exact equality at every sampled moment, no direction asserted ──
  {
    const rows = samples.map((s) => {
      const mine = ownUnion(s.residentChunks);
      const theirs = s.seam.kind === "box" ? s.seam.box : null;
      const ok = mine === null
        ? s.seam.kind === "refused" && (s.seam.reason === "no-resident-pages" || s.seam.reason === "bounds-before-construct")
        : boxesEqual(mine, theirs);
      return { s, mine, theirs, ok };
    });
    const bad = rows.filter((r) => !r.ok);
    const spread = rows.filter((r) => r.mine !== null);
    const first = spread[0]?.mine ?? null;
    const moved = spread.some((r) => !boxesEqual(r.mine, first));
    assert(
      "ac2-bounds-equals-own-decoded-union",
      bad.length === 0 && rows.length === samples.length,
      bad.length === 0
        ? `${rows.length} sampled moments, resident pages ${rows.map((r) => r.s.residentPages).join(" → ")}: every seam box equals this fixture's own union EXACTLY (e.g. ${rows[0]!.s.label}: ${fmtBox(rows[0]!.mine)}); the union moved across samples=${moved} (no direction asserted)`
        : bad.map((r) => `${r.s.label}: mine ${fmtBox(r.mine)} vs seam ${r.s.seam.kind === "box" ? fmtBox(r.theirs) : `refused(${r.s.seam.reason})`}`).join(" | "),
    );
  }

  // ── AC1: the HUD's displayed numbers against the independent header read ──
  {
    const rows = samples.map((s) => {
      const fields = hudFields(s.hudText);
      const residentFromHeader = s.residentChunks.reduce((sum, c) => sum + header.chunks[c]!.count, 0);
      return {
        s,
        fields,
        residentFromHeader,
        ok: fields !== null &&
          fields.src === K(header.total) &&
          fields.resident === K(residentFromHeader) &&
          fields.drawn === K(s.counts.selected),
      };
    });
    const bad = rows.filter((r) => !r.ok);
    assert(
      "ac1-hud-tracks-independent-counters",
      bad.length === 0,
      bad.length === 0
        ? `${rows.length} sampled moments: displayed src === ${K(header.total)} (this fixture's header total) and displayed resident === the header's per-chunk sum over the resident chunks at every one (${rows.map((r) => r.fields!.resident).join(" → ")}); displayed drawn === counts().selected read in the same block — SELF-REFERENTIAL by construction (the draw count has no independent public source; this pins consistency, not truth)`
        : bad.map((r) => `${r.s.label}: "${r.s.hudText}" vs src ${K(header.total)} / resident ${K(r.residentFromHeader)} / drawn ${K(r.s.counts.selected)}`).join(" | "),
    );
  }

  // ── S4: exact under the flip, never smaller (and strictly larger) tilted ──
  {
    const mineFlip = ownWorldBox(s4.residentChunks, flipMatrix);
    const mineTilt = ownWorldBox(s4.residentChunks, tiltMatrix);
    const eight = s4Flip === null ? null : [s4Flip.min.x, s4Flip.min.y, s4Flip.min.z, s4Flip.max.x, s4Flip.max.y, s4Flip.max.z];
    const eightTilt = s4Tilt === null ? null : [s4Tilt.min.x, s4Tilt.min.y, s4Tilt.min.z, s4Tilt.max.x, s4Tilt.max.y, s4Tilt.max.z];
    const splats = s4.residentChunks.reduce((sum, c) => sum + ownChunks.get(c)!.count, 0);
    assert(
      "s4-flip-exact",
      eight !== null && mineFlip !== null && boxesEqual(eight, mineFlip),
      `${s4.residentChunks.length} resident chunks, ${splats} centres transformed per point: computeSplatBounds(pad 0) ${fmtBox(eight)} vs this fixture's own per-point world box ${fmtBox(mineFlip)}`,
    );
    assert(
      "s4-tilt-never-smaller-and-strictly-larger",
      eightTilt !== null && mineTilt !== null && contains(eightTilt, mineTilt) && strictlyLargerSomewhere(eightTilt, mineTilt),
      `under rotation (0.3, 0.5, 0.2) on top of the flip: 8-corner ${fmtBox(eightTilt)} contains the per-point box ${fmtBox(mineTilt)} and is strictly larger on at least one axis (so the check cannot pass by equality)`,
    );
  }

  // ── S2 / S6 after dispose: both consumers refuse by name ──
  scene3.scene.remove(handle.object);
  backend.dispose(handle);
  let boundsReason = "";
  try {
    computeSplatBounds(backend, handle);
  } catch (error) {
    if (error instanceof SplatBackendError) boundsReason = error.reason;
  }
  let hudReason = "";
  try {
    hud.update(HUD_FORCE_DT);
  } catch (error) {
    if (error instanceof SplatBackendError) hudReason = error.reason;
  }
  assert(
    "s2-s6-disposed-handle-throws",
    boundsReason === "unknown-handle" && hudReason === "unknown-handle",
    `computeSplatBounds threw "${boundsReason}", StatsHUD.update threw "${hudReason}" — a disposed handle is a caller bug, never a silent skip`,
  );
  hud.dispose();

  await yieldMacrotask();
  await yieldMacrotask();
  assert("no-unhandled-rejections", unhandledRejections === 0, `${unhandledRejections} unhandledrejection events across this fixture`);
}

const done = main()
  .catch((error: unknown) => {
    failed++;
    const div = document.createElement("div");
    div.className = "assertion fail";
    div.textContent = `FAIL — runner crashed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`;
    out.appendChild(div);
    console.error("counters-lab runner crashed", error);
  })
  .finally(finishSummary)
  .then(() => ({ passed, failed }));

declare global {
  interface Window {
    __countersLab?: { done: Promise<{ passed: number; failed: number }> };
  }
}
window.__countersLab = { done };
