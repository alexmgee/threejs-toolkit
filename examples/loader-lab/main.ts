/**
 * loader-lab — the §A5 load/reveal/ready contract in the rebuilt SplatLoader
 * (Phase 2 ticket 08; owner rulings S0–S5 in the ticket's Comments).
 *
 * Proves, on whichever backend and regime the URL selects (default WebGPU,
 * `?webgl=1`; default page budget, `?pages=32` — ONE regime per run):
 * - reveal = the seam's paint-observed ready; reported progress is the true
 *   fraction until reveal, then exactly 1 once; eviction mid-load never
 *   un-reveals (AC3);
 * - a partial shortfall still reveals and is reported (one warning, truthful
 *   counts); all-unavailable fails by name (AC4);
 * - a whole-load failure AFTER reveal reaches onError (AC5);
 * - loadSplat's shape: handle returned, pin flip/quaternion/position/scale,
 *   fileName format pick, S5 contradiction warnings, S4 loadSplatAsync
 *   refusal (AC6).
 *
 * Hero loads run one at a time (handoff 007: concurrent hero loads lose the
 * GPU device). Waits are time-bounded and timer-free (MessageChannel).
 */

import { Group } from "three/webgpu";
import { ThreeSplatScene } from "@toolkit/core/ThreeSplatScene";
import { loadSplat, loadSplatAsync, type SplatLoadOptions } from "@toolkit/core/SplatLoader";
import {
  SplatBackendError,
  type LoadProgress,
  type LoadPhase,
  type SplatBackend,
  type SplatHandle,
  type SplatSource,
} from "@toolkit/backend/SplatBackend";
import { ThreeGsBackend } from "@toolkit/backend/ThreeGsBackend";
import { parseRadHeader } from "@toolkit/backend/RadHeader";
import plyUrl from "../assets/splat-lab/fixture.ply?url";

const ASSET = "/@fs/D:/Projects/sparkjs-toolkit/examples/assets/lab-sh1-sparsity.rad";

const container = document.getElementById("viewer")!;
const out = document.getElementById("out")!;
const params = new URLSearchParams(location.search);
const forceWebGL = params.get("webgl") === "1";
const pagesParam = params.get("pages");
const pages = pagesParam !== null && !Number.isNaN(Number(pagesParam)) ? Number(pagesParam) : undefined;

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, detail: string): void {
  const div = document.createElement("div");
  div.className = `assertion ${condition ? "pass" : "fail"}`;
  div.textContent = `${condition ? "PASS" : "FAIL"} — ${name}: ${detail}`;
  out.appendChild(div);
  console.log(`loader-lab ${condition ? "PASS" : "FAIL"} ${name} — ${detail}`);
  condition ? passed++ : failed++;
}

function finishSummary(): void {
  const heading = document.createElement("h2");
  heading.className = failed === 0 ? "pass" : "fail";
  heading.textContent = `loader-lab: ${passed} passed, ${failed} failed`;
  out.appendChild(heading);
  console.log(`loader-lab RESULT ${passed} passed, ${failed} failed`);
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

const scene3 = new ThreeSplatScene({
  container,
  fov: 60,
  cameraPosition: [0, 0, 3],
  background: 0x111133,
  forceWebGL,
});

/** Yield until `done()` without calling render here. This does NOT stop the
 *  scene's own animation loop from rendering, so it cannot by itself keep the
 *  LOD driver from kicking admissions — a drill that needs that turns
 *  selection off first. */
async function yieldUntil(label: string, done: () => boolean): Promise<number> {
  const t0 = performance.now();
  while (!done()) {
    if (performance.now() - t0 > WAIT_BOUND_MS) {
      throw new Error(`${label}: not reached within ${WAIT_BOUND_MS} ms`);
    }
    await yieldMacrotask();
  }
  return performance.now() - t0;
}

/** Render + yield until `done()` holds; each iteration may also sample. */
async function pumpUntil(label: string, done: () => boolean, sample?: () => void): Promise<number> {
  const t0 = performance.now();
  for (;;) {
    sample?.();
    if (done()) return performance.now() - t0;
    if (performance.now() - t0 > WAIT_BOUND_MS) {
      throw new Error(`${label}: not reached within ${WAIT_BOUND_MS} ms`);
    }
    scene3.renderer.render(scene3.scene, scene3.camera);
    await yieldMacrotask();
  }
}

// Every console.warn is recorded; the contract's own warnings carry these
// prefixes, so counts are never polluted by unrelated library warnings.
const warnings: string[] = [];
const originalWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  warnings.push(args.map(String).join(" "));
  originalWarn(...args);
};
function contractWarningsSince(mark: number): string[] {
  return warnings
    .slice(mark)
    .filter((w) => w.startsWith("[ThreeGsBackend]") || w.startsWith("[SplatLoader]"));
}

let unhandledRejections = 0;
window.addEventListener("unhandledrejection", (ev) => {
  unhandledRejections++;
  console.error("loader-lab UNHANDLED REJECTION", ev.reason);
});

// ─── The recorded load: every loader callback, in order, with the seam's
//     own view sampled at the same instant ───

type LogEvent =
  | { kind: "progress"; value: number; seamFraction: number; seamPhase: string }
  | { kind: "load"; seamPhase: string; seamFraction: number; firstUploaded: number; renders: number; loadSettled: boolean }
  | { kind: "error"; reason: string };

interface RecordedLoad {
  readonly handle: SplatHandle;
  readonly log: LogEvent[];
  loads(): number;
  errors(): Array<Extract<LogEvent, { kind: "error" }>>;
}

function recordedLoad(
  backend: SplatBackend,
  options: Omit<SplatLoadOptions, "backend" | "onProgress" | "onLoad" | "onError">,
  onRevealed?: () => void,
): RecordedLoad {
  const log: LogEvent[] = [];
  let handle: SplatHandle | null = null;
  const paged = backend instanceof ThreeGsBackend;
  handle = loadSplat({
    ...options,
    backend,
    onProgress: (value) => {
      const seam = backend.progress(handle!);
      log.push({ kind: "progress", value, seamFraction: seam.fraction, seamPhase: seam.phase });
    },
    onLoad: (h) => {
      const seam = backend.progress(h);
      let firstUploaded = -1;
      let renders = -1;
      let loadSettled = false;
      if (paged) {
        try {
          const d = (backend as ThreeGsBackend).pagerDiagnostics(h);
          firstUploaded = d.firstUploaded;
          renders = d.renders;
          loadSettled = d.loadSettled;
        } catch (error) {
          if (!(error instanceof SplatBackendError && error.reason === "not-paged")) throw error;
        }
      }
      log.push({ kind: "load", seamPhase: seam.phase, seamFraction: seam.fraction, firstUploaded, renders, loadSettled });
      onRevealed?.();
    },
    onError: (error) => {
      log.push({ kind: "error", reason: error.reason });
    },
  });
  return {
    handle,
    log,
    loads: () => log.filter((e) => e.kind === "load").length,
    errors: () => log.filter((e): e is Extract<LogEvent, { kind: "error" }> => e.kind === "error"),
  };
}

/** The S1 reveal log: pre-reveal reports are the seam's true fraction (< 1,
 *  strictly increasing), then exactly one 1 immediately followed by onLoad.
 *  Returns [ok, detail]. */
function checkRevealLog(log: LogEvent[]): [boolean, string] {
  const loadAt = log.findIndex((e) => e.kind === "load");
  if (loadAt === -1) return [false, "no onLoad in log"];
  const before = log.slice(0, loadAt);
  const progress = before.filter((e): e is Extract<LogEvent, { kind: "progress" }> => e.kind === "progress");
  const ones = log.filter((e) => e.kind === "progress" && e.value === 1).length;
  const last = progress[progress.length - 1];
  const pre = progress.slice(0, -1);
  let increasing = true;
  let prev = 0;
  for (const p of pre) {
    if (!(p.value > prev)) increasing = false;
    prev = p.value;
  }
  const trueFraction = pre.every((p) => p.value < 1 && p.value === p.seamFraction && p.seamPhase !== "ready");
  const oneLast = last !== undefined && last.value === 1 && loadAt === log.indexOf(last) + 1;
  const ok = before.every((e) => e.kind === "progress") && increasing && trueFraction && oneLast && ones === 1;
  return [
    ok,
    `pre-reveal reports=${pre.length} [${pre.slice(0, 3).map((p) => p.value.toFixed(4)).join(", ")}${pre.length > 3 ? ", …" : ""}${pre.length > 0 ? ` … last ${pre[pre.length - 1]!.value.toFixed(4)}` : ""}] strictly increasing=${increasing}, each === seam fraction at the call=${trueFraction}; exactly-one 1=${ones === 1} and it immediately precedes onLoad=${oneLast}`,
  ];
}

/** A scripted stand-in for the seam: the test drives exactly which progress
 *  notifications, readiness and failure arrive, in which order — so the
 *  loader's POLICY is judged deterministically. (On the hero the seam
 *  refreshes progress only at header parse and page uploads, and reveal is
 *  the first page's paint, so a real load reports one or two values before
 *  reveal — too few for a strictly-increasing check to have teeth.) */
function scriptedSeam() {
  let source: SplatSource | null = null;
  let current: LoadProgress = { bytesLoaded: 0, bytesTotal: 0, phase: "fetching", fraction: 0 };
  let resolveReady!: () => void;
  let rejectReady!: (error: SplatBackendError) => void;
  const whenReady = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  whenReady.catch(() => {});
  const handle = { object: new Group() } as unknown as SplatHandle;
  const backend = {
    load: (given: SplatSource) => {
      source = given;
      return handle;
    },
    progress: () => current,
    whenReady: () => whenReady,
  } as unknown as SplatBackend;
  return {
    backend,
    emit(phase: LoadPhase, fraction: number): void {
      current = { bytesLoaded: 0, bytesTotal: 0, phase, fraction };
      source!.onProgress?.({ ...current });
    },
    ready(): void {
      resolveReady();
    },
    /** Same order as the real ThreeGsBackend fail(): failed-phase progress
     *  notification, whenReady rejection, then onFailure. */
    fail(reason: string, reject: boolean): void {
      current = { ...current, phase: "failed" };
      source!.onProgress?.({ ...current });
      const error = new SplatBackendError(reason);
      if (reject) rejectReady(error);
      source!.onFailure?.(error);
    },
  };
}

/** A pass-through backend recording every RAW seam progress notification of
 *  the loads it starts, before the loader's own observer sees it — so a
 *  check about what the seam reported never depends on when renders land. */
function tapProgress(backend: ThreeGsBackend, record: (progress: LoadProgress) => void): SplatBackend {
  return new Proxy(backend, {
    get(target, prop) {
      if (prop === "load") {
        return (source: SplatSource) =>
          target.load({
            ...source,
            onProgress: (progress) => {
              record(progress);
              source.onProgress?.(progress);
            },
          });
      }
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

function logShape(log: LogEvent[]): string {
  return log.map((e) => (e.kind === "progress" ? String(e.value) : e.kind === "error" ? `error:${e.reason}` : "load")).join(",");
}

function resident(backend: ThreeGsBackend, h: SplatHandle): number {
  return backend.pagerDiagnostics(h).residentPages;
}

const done = (async () => {
  await scene3.ready;
  assert("backend", true, `renderer backend=${scene3.backend} regime=${pages === undefined ? "default" : `?pages=${pages}`}`);

  // ─── AC6: loadSplat shape on the monolithic path (cheap drills first) ───

  const plyBytes = await (await fetch(plyUrl)).arrayBuffer();
  const plyBlobUrl = URL.createObjectURL(new Blob([plyBytes]));
  const plyBackend = new ThreeGsBackend({ renderer: scene3.renderer });

  // Control: without fileName a blob URL names no format — the pick below is
  // fileName's doing, not the URL's.
  let controlReason = "";
  try {
    loadSplat({ url: plyBlobUrl, backend: plyBackend });
  } catch (error) {
    if (error instanceof SplatBackendError) controlReason = error.reason;
  }

  const warnMarkE = warnings.length;
  const position: [number, number, number] = [0.5, -0.25, 0];
  const quaternion: [number, number, number, number] = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  let sawSeamOneBeforeReveal = false;
  const tappedPly = tapProgress(plyBackend, (progress) => {
    if (e.loads() === 0 && progress.phase !== "ready" && progress.fraction === 1) sawSeamOneBeforeReveal = true;
  });
  const e = recordedLoad(tappedPly, {
    url: plyBlobUrl,
    fileName: "fixture.ply",
    paged: false,
    lod: false,
    extSplats: true,
    position,
    quaternion,
    scale: 0.5,
  });
  const obj = e.handle.object;
  assert(
    "format-from-fileName",
    controlReason === "unknown-format",
    `blob URL alone → SplatBackendError(${controlReason}); with fileName "fixture.ply" → loaded (see monolithic reveal below)`,
  );
  assert(
    "position-quaternion-scale-applied",
    obj.position.x === position[0] && obj.position.y === position[1] && obj.position.z === position[2] &&
      obj.quaternion.x === quaternion[0] && obj.quaternion.y === quaternion[1] &&
      obj.quaternion.z === quaternion[2] && obj.quaternion.w === quaternion[3] &&
      obj.scale.x === 0.5 && obj.scale.y === 0.5 && obj.scale.z === 0.5,
    `position=(${obj.position.toArray().join(",")}) quaternion=(${obj.quaternion.toArray().join(",")}) scale=(${obj.scale.toArray().join(",")}) — no eulerRotationDeg, so the quaternion stands (pin :84-86)`,
  );
  assert(
    "no-warning-when-options-agree-ply",
    contractWarningsSince(warnMarkE).length === 0,
    `paged=false lod=false extSplats=true on a .ply → ${contractWarningsSince(warnMarkE).length} contract warnings`,
  );

  scene3.scene.add(obj);
  const monoMs = await pumpUntil("monolithic reveal", () => e.loads() > 0 || e.errors().length > 0);
  const [monoLogOk, monoLogDetail] = checkRevealLog(e.log);
  const monoLoad = e.log.find((x) => x.kind === "load");
  assert(
    "monolithic-reveal-at-seam-ready",
    e.loads() === 1 && e.errors().length === 0 && monoLoad?.kind === "load" && monoLoad.seamPhase === "ready" && monoLogOk,
    `onLoad=${e.loads()} onError=${e.errors().length} seam phase at onLoad=${monoLoad?.kind === "load" ? monoLoad.seamPhase : "-"} after ${monoMs.toFixed(0)} ms; ${monoLogDetail}`,
  );
  assert(
    "pre-reveal-one-held",
    sawSeamOneBeforeReveal && e.log.filter((x) => x.kind === "progress" && x.value === 1).length === 1,
    `seam notified fraction 1 before reveal (PLY fetch complete / "constructing"; raw notifications tapped)=${sawSeamOneBeforeReveal}; the loader reported 1 exactly once, at reveal`,
  );
  scene3.scene.remove(obj);
  plyBackend.dispose(e.handle);

  // Euler priority + S5 contradictions on the PLY path; disposed before reveal.
  const warnMarkF = warnings.length;
  const f = recordedLoad(plyBackend, {
    url: plyBlobUrl,
    fileName: "fixture.ply",
    eulerRotationDeg: [90, 0, 0],
    quaternion: [0, 0, 0, 1],
    paged: true,
    lod: true,
    extSplats: false,
  });
  const fRot = f.handle.object.rotation;
  const warnsF = contractWarningsSince(warnMarkF);
  assert(
    "euler-flip-priority-over-quaternion",
    fRot.x === Math.PI + 90 * (Math.PI / 180) && fRot.y === 0 && fRot.z === 0,
    `eulerRotationDeg=[90,0,0] + quaternion given → rotation=(${fRot.x}, ${fRot.y}, ${fRot.z}); pin: rotation.set(PI + rx, ry, rz) and the quaternion is ignored`,
  );
  assert(
    "contradiction-warns-once-by-name-ply",
    warnsF.length === 1 && /paged=true/.test(warnsF[0]!) && /lod=true/.test(warnsF[0]!) && /extSplats=false/.test(warnsF[0]!),
    `${warnsF.length} warning(s): ${JSON.stringify(warnsF)}`,
  );
  plyBackend.dispose(f.handle);
  await pumpUntil("dispose-before-reveal", () => f.errors().length > 0 || f.loads() > 0);
  assert(
    "dispose-before-reveal-reported",
    f.loads() === 0 && f.errors().length === 1 && f.errors()[0]!.reason === "handle-disposed",
    `onLoad=${f.loads()} onError=${JSON.stringify(f.errors().map((x) => x.reason))} (mirrors whenReady's rejection)`,
  );

  // S4: loadSplatAsync refuses by name without touching the backend.
  let asyncLoadCalls = 0;
  const countingBackend = {
    load: () => {
      asyncLoadCalls++;
      throw new Error("loadSplatAsync must not start a load");
    },
  } as unknown as SplatBackend;
  let asyncReason = "";
  try {
    await loadSplatAsync({ url: plyBlobUrl, fileName: "fixture.ply", backend: countingBackend });
  } catch (error) {
    if (error instanceof SplatBackendError) asyncReason = error.reason;
  }
  assert(
    "loadSplatAsync-refuses-by-name",
    asyncReason === "load-splat-async-refused" && asyncLoadCalls === 0,
    `rejects SplatBackendError(${asyncReason}); backend.load calls=${asyncLoadCalls}`,
  );

  // S1 policy, scripted: duplicates and non-increases dropped, a pre-reveal
  // 1.0 held, ready-phase values ignored, exactly one 1 at reveal, nothing
  // after reveal except a failure (S2/S3).
  {
    const seam = scriptedSeam();
    const r = recordedLoad(seam.backend, { url: "scripted.rad" });
    seam.emit("fetching", 0);
    seam.emit("fetching", 0.1);
    seam.emit("fetching", 0.1);
    seam.emit("fetching", 0.05);
    seam.emit("constructing", 0.4);
    seam.emit("constructing", 1);
    seam.emit("ready", 1);
    const beforeReady = logShape(r.log);
    seam.ready();
    await yieldMacrotask();
    seam.emit("ready", 0.6);
    seam.fail("range-unsupported", false);
    const expected = "0.1,0.4,1,load,error:range-unsupported";
    assert(
      "reveal-policy-scripted",
      beforeReady === "0.1,0.4" && logShape(r.log) === expected,
      `script fetching 0, 0.1, 0.1, 0.05 → constructing 0.4, 1 → ready 1 → whenReady resolves → ready 0.6 → failure: before whenReady [${beforeReady}] (the seam's 1.0 held back, ready-phase 1 ignored); full log [${logShape(r.log)}], expected [${expected}]`,
    );
  }
  {
    const seam = scriptedSeam();
    const r = recordedLoad(seam.backend, { url: "scripted.rad" });
    seam.emit("fetching", 0.2);
    seam.fail("no-pages-available", true);
    await yieldMacrotask();
    const seamLate = scriptedSeam();
    const late = recordedLoad(seamLate.backend, { url: "scripted.rad" });
    seamLate.emit("constructing", 0.3);
    seamLate.fail("rad-pipeline-failed", false);
    seamLate.ready();
    await yieldMacrotask();
    assert(
      "failure-first-never-reveals-scripted",
      logShape(r.log) === "0.2,error:no-pages-available" && logShape(late.log) === "0.3,error:rad-pipeline-failed",
      `failure + whenReady rejection → [${logShape(r.log)}]; failure then a (contrived) whenReady resolution → [${logShape(late.log)}] — onLoad and the 1 never follow onError`,
    );
  }

  // Review F2: a consumer throwing on the final progress(1) must not cost it
  // the reveal — onLoad still fires, and the throw is REPORTED, not swallowed.
  {
    const seam = scriptedSeam();
    let loads = 0;
    const reported: string[] = [];
    const onWindowError = (ev: ErrorEvent): void => {
      const message = ev.error instanceof Error ? ev.error.message : ev.message;
      if (message.includes("loader-lab: synthetic onProgress throw")) {
        reported.push(message);
        ev.preventDefault();
      }
    };
    window.addEventListener("error", onWindowError);
    loadSplat({
      url: "scripted.rad",
      backend: seam.backend,
      onProgress: (value) => {
        if (value === 1) throw new Error("loader-lab: synthetic onProgress throw");
      },
      onLoad: () => {
        loads++;
      },
    });
    seam.ready();
    await yieldMacrotask();
    window.removeEventListener("error", onWindowError);
    assert(
      "onLoad-survives-throwing-progress-observer",
      loads === 1 && reported.length === 1,
      `onProgress(1) threw → onLoad fired ${loads} time(s); the throw reached window "error" ${reported.length} time(s) (reportError)`,
    );
  }

  // Review F3(a): the S5 warning is about the options vs the format, so a
  // load the backend refuses on the spot still gets it.
  {
    const noWorkerBackend = new ThreeGsBackend({ renderer: scene3.renderer });
    const mark = warnings.length;
    let reason = "";
    try {
      loadSplat({ url: ASSET, backend: noWorkerBackend, paged: false });
    } catch (error) {
      if (error instanceof SplatBackendError) reason = error.reason;
    }
    const warns = contractWarningsSince(mark);
    assert(
      "refused-load-still-warns",
      reason === "rad-needs-worker-factory" && warns.length === 1 && /paged=false/.test(warns[0]!),
      `loadSplat threw SplatBackendError(${reason}); ${warns.length} warning(s): ${JSON.stringify(warns)}`,
    );
  }

  // ─── The hero's chunk ranges, from its own header (for exact drills) ───

  const probe = await fetch(ASSET, { headers: { Range: "bytes=0-65535" } });
  const header = parseRadHeader(await probe.arrayBuffer());
  const chunkCount = header.chunks.length;
  const chunkStart = (index: number): number => header.chunksStart + header.chunks[index]!.offset;
  const lastChunk = chunkCount - 1;

  // S5 on the rad path: contradictions warn, the load itself is refused at
  // the header (no 213 MB download for a warning drill).
  {
    const refuseAll: typeof fetch = async () => new Response(null, { status: 404 });
    const warnBackend = new ThreeGsBackend({ renderer: scene3.renderer, createDecodeWorker, fetchImpl: refuseAll });
    const warnMark = warnings.length;
    const w = recordedLoad(warnBackend, { url: ASSET, paged: false, lod: false });
    const warns = contractWarningsSince(warnMark);
    assert(
      "contradiction-warns-once-by-name-rad",
      warns.length === 1 && /paged=false/.test(warns[0]!) && /lod=false/.test(warns[0]!) && /\.rad/.test(warns[0]!),
      `${warns.length} warning(s): ${JSON.stringify(warns)}`,
    );
    await pumpUntil("rad warning drill failure", () => w.errors().length > 0);
    warnBackend.dispose(w.handle);
  }

  // ─── AC3: reveal at the seam's ready, true fraction, eviction mid-load ───
  // The last chunk's request is HELD until the drill releases it, so the
  // eviction provably happens before the load settles.
  {
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const holdLast: typeof fetch = async (input, init) => {
      if (parseRangeStart(getRangeHeader(init)) === chunkStart(lastChunk)) await released;
      return fetch(input, init);
    };
    const backendA = new ThreeGsBackend({
      renderer: scene3.renderer,
      createDecodeWorker,
      pageBudgetOverride: pages,
      fetchImpl: holdLast,
    });
    const warnMark = warnings.length;
    const a = recordedLoad(backendA, { url: ASSET, eulerRotationDeg: [0, 0, 0], paged: true, lod: true, extSplats: true });
    const rot = a.handle.object.rotation;
    assert(
      "flip-armed-by-eulerRotationDeg",
      rot.x === Math.PI && rot.y === 0 && rot.z === 0 && contractWarningsSince(warnMark).length === 0,
      `eulerRotationDeg=[0,0,0] → rotation=(${rot.x}, ${rot.y}, ${rot.z}) (pin: presence arms the 180° X-flip); paged/lod/extSplats=true on a .rad → ${contractWarningsSince(warnMark).length} warnings`,
    );
    scene3.scene.add(a.handle.object);
    const revealMs = await pumpUntil("hero reveal", () => a.loads() > 0 || a.errors().length > 0);
    const loadEvent = a.log.find((x) => x.kind === "load");
    const budget = backendA.pagerDiagnostics(a.handle).budget;
    assert(
      "reveal-at-seam-ready",
      a.loads() === 1 && a.errors().length === 0 && loadEvent?.kind === "load" &&
        loadEvent.seamPhase === "ready" && loadEvent.firstUploaded >= 1 && loadEvent.renders >= 1 &&
        !loadEvent.loadSettled && loadEvent.seamFraction < 1,
      loadEvent?.kind === "load"
        ? `onLoad=${a.loads()} after ${revealMs.toFixed(0)} ms: seam phase=${loadEvent.seamPhase}, first-uploaded pages=${loadEvent.firstUploaded}, paged-mesh renders=${loadEvent.renders} (paint confirmation), load settled=${loadEvent.loadSettled} (last chunk held), seam fraction=${loadEvent.seamFraction.toFixed(4)}; budget ${budget.pages} pages (${budget.source})`
        : `onLoad=${a.loads()} onError=${JSON.stringify(a.errors())}`,
    );
    // Everything the loader may ever say about this load ends at the onLoad
    // entry; any later entry (progress, a second load, an error) is a breach.
    const loadIndexA = a.log.findIndex((x) => x.kind === "load");
    const [logOk, logDetail] = checkRevealLog(a.log);
    const preReports = a.log.filter((x) => x.kind === "progress" && x.value < 1).length;
    assert("progress-true-fraction-then-one", logOk && preReports >= 1, logDetail);

    // Eviction mid-load. Selection off first, so the LOD driver cannot heal
    // the drill by re-admitting wanted chunks (handoff trap 5).
    backendA.pagerDiagnostics(a.handle).lod.setSelectionEnabled(false);
    scene3.renderer.render(scene3.scene, scene3.camera);
    const fractionBefore = backendA.progress(a.handle).fraction;
    const residentBefore = resident(backendA, a.handle);
    const settledAtEvict = backendA.pagerDiagnostics(a.handle).loadSettled;
    const diagEvict = backendA.pagerDiagnostics(a.handle);
    let evicted = 0;
    for (let c = 0; c < chunkCount; c++) {
      if (diagEvict.isResident(c) && diagEvict.evictChunk(c)) evicted++;
    }
    const residentAfter = resident(backendA, a.handle);
    for (let i = 0; i < 3; i++) {
      scene3.renderer.render(scene3.scene, scene3.camera);
      await yieldMacrotask();
    }
    const seamAfter = backendA.progress(a.handle);
    assert(
      "eviction-mid-load-does-not-unreveal",
      !settledAtEvict && evicted >= 1 && residentAfter < residentBefore &&
        a.loads() === 1 && a.log.length === loadIndexA + 1 && seamAfter.phase === "ready" &&
        seamAfter.fraction >= fractionBefore,
      `load settled at eviction=${settledAtEvict}; evicted ${evicted} chunks: resident pages ${residentBefore} → ${residentAfter} (a residency-derived signal would have fallen ${(residentBefore / budget.pages).toFixed(3)} → ${(residentAfter / budget.pages).toFixed(3)}); after 3 renders: onLoad=${a.loads()}, loader events after reveal=${a.log.length - loadIndexA - 1}, seam phase=${seamAfter.phase}, seam fraction ${fractionBefore.toFixed(4)} → ${seamAfter.fraction.toFixed(4)}`,
    );

    release();
    const settleMs = await pumpUntil("hero settle", () => backendA.pagerDiagnostics(a.handle).loadSettled);
    const fractionAtReveal = loadEvent?.kind === "load" ? loadEvent.seamFraction : 1;
    const settled = backendA.progress(a.handle);
    assert(
      "no-report-after-reveal",
      settled.fraction > fractionAtReveal && a.log.length === loadIndexA + 1 && a.errors().length === 0 &&
        contractWarningsSince(warnMark).length === 0,
      `seam fraction rose after reveal ${fractionAtReveal.toFixed(4)} → ${settled.fraction.toFixed(4)} (settled after release in ${settleMs.toFixed(0)} ms); loader events after reveal=${a.log.length - loadIndexA - 1}, onError=${a.errors().length}, contract warnings=${contractWarningsSince(warnMark).length}`,
    );
    scene3.scene.remove(a.handle.object);
    backendA.dispose(a.handle);
  }

  // ─── AC4: partial shortfall reveals and reports; all-unavailable fails ───
  {
    const UNAVAILABLE = [1, 7];
    const refusedStarts = new Set(UNAVAILABLE.map(chunkStart));
    const refuseSome: typeof fetch = async (input, init) => {
      const start = parseRangeStart(getRangeHeader(init));
      if (start !== null && refusedStarts.has(start)) return new Response(null, { status: 404 });
      return fetch(input, init);
    };
    const backendB = new ThreeGsBackend({
      renderer: scene3.renderer,
      createDecodeWorker,
      pageBudgetOverride: pages,
      fetchImpl: refuseSome,
    });
    const warnMark = warnings.length;
    const b = recordedLoad(backendB, { url: ASSET, eulerRotationDeg: [0, 0, 0] });
    scene3.scene.add(b.handle.object);
    const bMs = await pumpUntil(
      "shortfall settle",
      () => b.errors().length > 0 || (b.loads() > 0 && backendB.pagerDiagnostics(b.handle).loadSettled),
    );
    const [bLogOk, bLogDetail] = checkRevealLog(b.log);
    assert(
      "shortfall-still-reveals",
      b.loads() === 1 && b.errors().length === 0 && bLogOk,
      `onLoad=${b.loads()} onError=${JSON.stringify(b.errors())}; revealed and settled within ${bMs.toFixed(0)} ms (nothing wedged); ${bLogDetail}`,
    );
    const d = backendB.pagerDiagnostics(b.handle);
    const counts = backendB.counts(b.handle);
    const unavailable = d.unavailable.map((u) => `${u.index}:${u.reason}`).sort();
    const warns = contractWarningsSince(warnMark);
    assert(
      "shortfall-reported",
      JSON.stringify(unavailable) === JSON.stringify(UNAVAILABLE.map((i) => `${i}:range-rejected`).sort()) &&
        warns.length === 1 && warns[0]!.includes(`${UNAVAILABLE.length} of ${chunkCount} chunks unavailable`) &&
        UNAVAILABLE.every((i) => warns[0]!.includes(`chunk ${i} (range-rejected`)) &&
        counts.total === header.count && counts.resident === d.residentSplats &&
        d.residentPages <= d.budget.pages && d.progressTerms.decoded * chunkCount <= chunkCount - UNAVAILABLE.length,
      `unavailable=${JSON.stringify(unavailable)}; ${warns.length} warning(s): ${JSON.stringify(warns)}; counts total=${counts.total} (header ${header.count}) resident=${counts.resident} (= ${d.residentPages} pages ≤ budget ${d.budget.pages}); decoded term=${d.progressTerms.decoded.toFixed(4)} ≤ ${((chunkCount - UNAVAILABLE.length) / chunkCount).toFixed(4)}; final fraction=${backendB.progress(b.handle).fraction.toFixed(4)}`,
    );
    scene3.scene.remove(b.handle.object);
    backendB.dispose(b.handle);

    const refuseChunks: typeof fetch = async (input, init) => {
      // The header probe (Range start 0) passes; every chunk range is refused.
      if (parseRangeStart(getRangeHeader(init)) !== 0) return new Response(null, { status: 404 });
      return fetch(input, init);
    };
    const backendC = new ThreeGsBackend({ renderer: scene3.renderer, createDecodeWorker, pageBudgetOverride: pages, fetchImpl: refuseChunks });
    const warnMarkC = warnings.length;
    const c = recordedLoad(backendC, { url: ASSET, eulerRotationDeg: [0, 0, 0] });
    scene3.scene.add(c.handle.object);
    const cMs = await pumpUntil("all-unavailable", () => c.errors().length > 0 || c.loads() > 0);
    assert(
      "all-unavailable-fails-by-name",
      c.loads() === 0 && c.errors().length === 1 && c.errors()[0]!.reason === "no-pages-available" &&
        !c.log.some((x) => x.kind === "progress" && x.value === 1) &&
        contractWarningsSince(warnMarkC).length === 0 && backendC.progress(c.handle).phase === "failed",
      `onLoad=${c.loads()} onError=${JSON.stringify(c.errors().map((x) => x.reason))} after ${cMs.toFixed(0)} ms; progress 1 reported=${c.log.some((x) => x.kind === "progress" && x.value === 1)}; shortfall warnings=${contractWarningsSince(warnMarkC).length} (the failure names it); seam phase=${backendC.progress(c.handle).phase}`,
    );
    scene3.scene.remove(c.handle.object);
    backendC.dispose(c.handle);

    // The seam's own observers, no loader in between (review F5): the
    // documented terminal "failed" progress notification, then onFailure.
    const seamLog: string[] = [];
    const direct = backendC.load({
      url: ASSET,
      onProgress: (progress) => seamLog.push(`progress:${progress.phase}`),
      onFailure: (error) => seamLog.push(`failure:${error.reason}`),
    });
    scene3.scene.add(direct.object);
    await pumpUntil("seam observers", () => seamLog.some((entry) => entry.startsWith("failure:")));
    const tail = seamLog.slice(-2);
    assert(
      "seam-observers-failed-phase-then-failure",
      tail[0] === "progress:failed" && tail[1] === "failure:no-pages-available" &&
        seamLog.filter((entry) => entry.startsWith("failure:")).length === 1 &&
        seamLog.filter((entry) => entry === "progress:failed").length === 1,
      `${seamLog.length} notifications, last two [${tail.join(", ")}]; failures=${seamLog.filter((entry) => entry.startsWith("failure:")).length}, failed-phase progress=${seamLog.filter((entry) => entry === "progress:failed").length}`,
    );
    scene3.scene.remove(direct.object);
    backendC.dispose(direct);
  }

  // ─── AC5: a whole-load failure AFTER reveal reaches onError ───
  // The last chunk's request is held until onLoad, then answered with a 200
  // (206-or-die → whole-load range-unsupported, ruling 05-S3).
  {
    let answer!: () => void;
    const revealed = new Promise<void>((resolve) => { answer = resolve; });
    const lateTwoHundred: typeof fetch = async (input, init) => {
      if (parseRangeStart(getRangeHeader(init)) === chunkStart(lastChunk)) {
        await revealed;
        return new Response(new ArrayBuffer(8), { status: 200 });
      }
      return fetch(input, init);
    };
    const backendD = new ThreeGsBackend({ renderer: scene3.renderer, createDecodeWorker, pageBudgetOverride: pages, fetchImpl: lateTwoHundred });
    const dl = recordedLoad(backendD, { url: ASSET, eulerRotationDeg: [0, 0, 0] }, () => answer());
    scene3.scene.add(dl.handle.object);
    const dMs = await pumpUntil("failure after reveal", () => dl.errors().length > 0);
    let whenReadyResolved = false;
    await backendD.whenReady(dl.handle).then(() => { whenReadyResolved = true; }, () => {});
    const loadAt = dl.log.findIndex((x) => x.kind === "load");
    const errorAt = dl.log.findIndex((x) => x.kind === "error");
    assert(
      "failure-after-reveal-reaches-onError",
      dl.loads() === 1 && dl.errors().length === 1 && dl.errors()[0]!.reason === "range-unsupported" &&
        loadAt !== -1 && errorAt > loadAt && whenReadyResolved &&
        backendD.progress(dl.handle).phase === "failed" &&
        !dl.log.slice(loadAt + 1).some((x) => x.kind === "progress"),
      `log order: onLoad at ${loadAt}, onError(${dl.errors()[0]?.reason}) at ${errorAt} after ${dMs.toFixed(0)} ms; whenReady had resolved=${whenReadyResolved} (so its rejection could never carry this); seam phase=${backendD.progress(dl.handle).phase}`,
    );
    scene3.scene.remove(dl.handle.object);
    backendD.dispose(dl.handle);
  }

  // ─── Review F1: a decode pool that breaks AFTER the load settled ───
  // The pool's real worker-error handler is driven with a synthetic
  // ErrorEvent; an evicted wanted chunk then needs re-admission, which
  // re-decodes through the broken pool.
  {
    const workers: Worker[] = [];
    const capturingFactory = (): Worker => {
      const worker = createDecodeWorker();
      workers.push(worker);
      return worker;
    };
    const backendP = new ThreeGsBackend({ renderer: scene3.renderer, createDecodeWorker: capturingFactory, pageBudgetOverride: pages });
    const pl = recordedLoad(backendP, { url: ASSET, eulerRotationDeg: [0, 0, 0] });
    scene3.scene.add(pl.handle.object);
    await pumpUntil(
      "pool-break drill settle",
      () => pl.errors().length > 0 || (pl.loads() > 0 && backendP.pagerDiagnostics(pl.handle).loadSettled),
    );
    const diagP = backendP.pagerDiagnostics(pl.handle);
    let victim = -1;
    for (let chunk = 0; chunk < chunkCount && victim === -1; chunk++) {
      if (diagP.isResident(chunk) && diagP.isCached(chunk)) victim = chunk;
    }
    const evicted = victim !== -1 && diagP.evictChunk(victim);
    workers[0]!.dispatchEvent(new ErrorEvent("error", { message: "loader-lab: synthetic worker crash after settle" }));
    diagP.lod.markDirty();
    const breakMs = await pumpUntil("pool break after settle", () => pl.errors().length > 0);
    const loadAt = pl.log.findIndex((x) => x.kind === "load");
    const errorAt = pl.log.findIndex((x) => x.kind === "error");
    assert(
      "pool-break-after-settle-reaches-onError",
      evicted && pl.loads() === 1 && pl.errors().length === 1 && pl.errors()[0]!.reason === "decode-worker-error" &&
        loadAt !== -1 && errorAt > loadAt && backendP.progress(pl.handle).phase === "failed",
      `load settled, chunk ${victim} evicted=${evicted}, worker 0 crashed (synthetic); onLoad at ${loadAt}, onError(${pl.errors()[0]?.reason}) at ${errorAt} after ${breakMs.toFixed(0)} ms; seam phase=${backendP.progress(pl.handle).phase}`,
    );
    scene3.scene.remove(pl.handle.object);
    backendP.dispose(pl.handle);
  }

  // ─── Owner rulings F4-A + fold-in (2026-09-17): a chunk given up on AFTER
  //     the load settled joins the unavailable list and is announced by name ───
  // Deterministic in every regime: after the load settles, selection goes
  // off (the LOD driver kicks nothing new) and in-flight admissions drain. The
  // three targets are chunks whose bytes are cached but which are not
  // resident — taken from the deferred set, or made by evicting residents
  // (eviction keeps the bytes). Each is admitted through the door, and a
  // ONE-SHOT synthetic worker fault meets its re-decode: a non-fatal error
  // reply carrying the chunk's own bytes (decode-failed — the per-chunk crate
  // Err, as rad-lab drills at load), a synchronous postMessage throw
  // (decode-dispatch-failed), and a reply for the wrong chunk
  // (decode-protocol-error).
  {
    let fault: "none" | "decode" | "dispatch" | "protocol" = "none";
    // Read through a call: the wrapper resets `fault` from a closure, which
    // TypeScript's narrowing after an assignment cannot see.
    const faultFired = (): boolean => fault === "none";
    const faultingFactory = (): Worker => {
      const worker = createDecodeWorker();
      const post = worker.postMessage.bind(worker) as (message: unknown, transfer: Transferable[]) => void;
      worker.postMessage = ((message: unknown, transfer?: Transferable[]) => {
        const armed = fault;
        if (armed === "none") {
          post(message, transfer ?? []);
          return;
        }
        fault = "none";
        if (armed === "dispatch") {
          throw new DOMException("loader-lab: synthetic dispatch failure", "DataCloneError");
        }
        const request = message as { index: number; bytes: ArrayBuffer };
        const data = armed === "decode"
          ? { index: request.index, error: "loader-lab: synthetic decode failure", bytes: request.bytes }
          : { index: request.index + 1_000_000, error: "loader-lab: synthetic wrong-chunk reply" };
        void Promise.resolve().then(() => worker.dispatchEvent(new MessageEvent("message", { data })));
      }) as Worker["postMessage"];
      return worker;
    };
    const backendF = new ThreeGsBackend({
      renderer: scene3.renderer,
      createDecodeWorker: faultingFactory,
      pageBudgetOverride: pages,
    });
    const fl = recordedLoad(backendF, { url: ASSET, eulerRotationDeg: [0, 0, 0] });
    scene3.scene.add(fl.handle.object);
    await pumpUntil(
      "given-up drills settle",
      () => fl.errors().length > 0 || (fl.loads() > 0 && backendF.pagerDiagnostics(fl.handle).loadSettled),
    );
    // Selection off first: with it off the LOD driver never kicks admissions,
    // so nothing but this drill admits a chunk — whether or not anything
    // renders meanwhile. Then in-flight admissions drain.
    backendF.pagerDiagnostics(fl.handle).lod.setSelectionEnabled(false);
    await yieldUntil("admissions idle", () => backendF.pagerDiagnostics(fl.handle).lod.admitting === 0);
    const door = backendF.pagerDiagnostics(fl.handle);
    const warnMarkSettle = warnings.length;
    const isTarget = (chunk: number): boolean => !door.isResident(chunk) && door.isCached(chunk);
    const targets: number[] = [];
    for (let chunk = chunkCount - 1; chunk >= 0 && targets.length < 3; chunk--) {
      if (isTarget(chunk)) targets.push(chunk);
    }
    let madeByEviction = 0;
    for (let chunk = chunkCount - 1; chunk >= 0 && targets.length < 3; chunk--) {
      if (door.isResident(chunk) && door.isCached(chunk) && door.evictChunk(chunk)) {
        targets.push(chunk);
        madeByEviction++;
      }
    }
    const setup = `settled: resident pages=${door.residentPages}/${door.budget.pages}, unavailable before=${door.unavailable.length}; targets=[${targets.join(", ")}] (${madeByEviction} made by eviction)`;
    const unavailableEntry = (chunk: number | undefined) =>
      chunk === undefined ? undefined : backendF.pagerDiagnostics(fl.handle).unavailable.find((u) => u.index === chunk);

    const drills: Array<{ name: string; mode: "decode" | "dispatch" | "protocol"; reason: string; chunk: number | undefined; bytesStay: boolean }> = [
      { name: "post-settle-decode-failure-warns-by-name", mode: "decode", reason: "decode-failed", chunk: targets[0], bytesStay: true },
      { name: "post-settle-dispatch-failure-marks-unavailable", mode: "dispatch", reason: "decode-dispatch-failed", chunk: targets[1], bytesStay: false },
      { name: "post-settle-protocol-error-marks-unavailable", mode: "protocol", reason: "decode-protocol-error", chunk: targets[2], bytesStay: false },
    ];
    for (const drill of drills) {
      const mark = warnings.length;
      fault = drill.mode;
      const admitted = drill.chunk !== undefined && (await door.admitChunk(drill.chunk));
      const fired = faultFired();
      fault = "none";
      const entry = unavailableEntry(drill.chunk);
      const warns = contractWarningsSince(mark);
      const cachedAfter = drill.chunk !== undefined && door.isCached(drill.chunk);
      assert(
        drill.name,
        drill.chunk !== undefined && fired && !admitted && entry?.reason === drill.reason &&
          warns.length === 1 && warns[0]!.includes(`chunk ${drill.chunk} `) && warns[0]!.includes(drill.reason) &&
          cachedAfter === drill.bytesStay,
        `${setup}; chunk ${drill.chunk}: fault fired=${fired}, admitted=${admitted}, unavailable entry=${JSON.stringify(entry ?? null)}, bytes still cached=${cachedAfter}; ${warns.length} warning(s): ${JSON.stringify(warns)}`,
      );
    }
    assert(
      "post-settle-given-up-chunks-stay-per-chunk",
      fl.loads() === 1 && fl.errors().length === 0 && backendF.progress(fl.handle).phase === "ready" &&
        contractWarningsSince(warnMarkSettle).length === 3,
      `onLoad=${fl.loads()} onError=${fl.errors().length} seam phase=${backendF.progress(fl.handle).phase}; contract warnings since settle=${contractWarningsSince(warnMarkSettle).length} (one per given-up chunk)`,
    );
    scene3.scene.remove(fl.handle.object);
    backendF.dispose(fl.handle);
  }

  URL.revokeObjectURL(plyBlobUrl);
  // Let any stray rejection surface before the tripwire reads.
  await yieldMacrotask();
  await yieldMacrotask();
  assert("no-unhandled-rejections", unhandledRejections === 0, `${unhandledRejections} unhandledrejection events across every load in this fixture`);
})();

done
  .catch((error: unknown) => {
    failed++;
    const div = document.createElement("div");
    div.className = "assertion fail";
    div.textContent = `FAIL — runner crashed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`;
    out.appendChild(div);
    console.error("loader-lab runner crashed", error);
  })
  .finally(finishSummary);
