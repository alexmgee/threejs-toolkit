/**
 * splat-lab — ThreeGsBackend monolithic PLY behavioral fixture (ticket 03).
 *
 * Independent CPU read of the same PLY (no vendor imports) cross-checks
 * counts, bounds, and sigmoid opacity. Pixel proof via shared capture.
 *
 * DEV hook: window.__splatLab { scene3, backend, handle, capture, captureSync, step }.
 */

import * as THREE from "three/webgpu";
import { ThreeSplatScene } from "@toolkit/core/ThreeSplatScene";
import { SplatBackendError } from "@toolkit/backend/SplatBackend";
import { ThreeGsBackend } from "@toolkit/backend/ThreeGsBackend";
import { createCapture } from "../shared/capture";
import plyUrl from "../assets/splat-lab/fixture.ply?url";

const container = document.getElementById("viewer")!;
const out = document.getElementById("out")!;
const forceWebGL = new URLSearchParams(location.search).get("webgl") === "1";

const CAMERA_Z = 6;
const FOV = 60;

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, detail: string): void {
  const div = document.createElement("div");
  div.className = `assertion ${condition ? "pass" : "fail"}`;
  div.textContent = `${condition ? "PASS" : "FAIL"} — ${name}: ${detail}`;
  out.appendChild(div);
  console.log(`splat-lab ${condition ? "PASS" : "FAIL"} ${name} — ${detail}`);
  condition ? passed++ : failed++;
}

function finishSummary(): void {
  const heading = document.createElement("h2");
  heading.className = failed === 0 ? "pass" : "fail";
  heading.textContent = `splat-lab: ${passed} passed, ${failed} failed`;
  out.appendChild(heading);
  console.log(`splat-lab RESULT ${passed} passed, ${failed} failed`);
}

interface IndependentPly {
  count: number;
  min: [number, number, number];
  max: [number, number, number];
  logits: number[];
  /** Flat xyz triples, in file order — per-splat provenance check. */
  positions: number[];
}

const FLOATS_PER_VERTEX = 14;

function parseFixturePly(buffer: ArrayBuffer): IndependentPly {
  const bytes = new Uint8Array(buffer);
  const headerText = new TextDecoder().decode(bytes);
  const marker = "end_header\n";
  const headerEnd = headerText.indexOf(marker);
  if (headerEnd === -1) throw new Error("PLY header missing end_header");
  const header = headerText.slice(0, headerEnd);
  const count = Number(header.match(/element vertex (\d+)/)?.[1] ?? 0);
  const dataOffset = headerEnd + marker.length;
  const view = new DataView(buffer, dataOffset);
  const logits: number[] = [];
  const positions: number[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const base = i * FLOATS_PER_VERTEX * 4;
    const x = view.getFloat32(base, true);
    const y = view.getFloat32(base + 4, true);
    const z = view.getFloat32(base + 8, true);
    const opacity = view.getFloat32(base + 13 * 4, true);
    logits.push(opacity);
    positions.push(x, y, z);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return {
    count,
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    logits,
    positions,
  };
}

/** One definition of "red" for every probe — the initial pixel assert and
 *  the refusal/cycle liveness checks must agree (review finding). */
function isDominantRed(rgba: number[]): boolean {
  return (
    rgba[0]! > 96 &&
    rgba[0]! > 2 * rgba[1]! &&
    rgba[0]! > 2 * rgba[2]! &&
    rgba[3] === 255
  );
}

function xFrac(worldX: number, aspect: number): number {
  const halfExtent = Math.tan((FOV * Math.PI) / 360) * CAMERA_Z * aspect;
  return Math.min(0.999, Math.max(0, (1 + worldX / halfExtent) / 2));
}

const scene3 = new ThreeSplatScene({
  container,
  fov: FOV,
  cameraPosition: [0, 0, CAMERA_Z],
  background: 0x111133,
  forceWebGL,
});

const backend = new ThreeGsBackend({ renderer: scene3.renderer });
// format is EXPLICIT: in `vite build` this ?url import becomes a data: URL
// (3 KB asset, under the 4096-byte assetsInlineLimit) with no extension to
// infer from — inference-only would throw at module top level and kill the
// built page (review finding, verified with a real build).
let handle!: ReturnType<ThreeGsBackend["load"]>;

// Paint sentinel: counts ACTUAL paints, not animation-loop ticks — the
// scene facade renders a forced first frame during init (ThreeSplatScene.ts
// :192, direct render, bypasses onFrame), and that frame can legitimately
// be the mesh's first paint when a local fetch beats WebGPU init. A
// depth/color-silent always-rendered mesh sees every render pass.
let paintCount = 0;
{
  const sentinelMaterial = new THREE.MeshBasicMaterial();
  sentinelMaterial.colorWrite = false;
  sentinelMaterial.depthWrite = false;
  const sentinel = new THREE.Mesh(
    new THREE.PlaneGeometry(0.001, 0.001),
    sentinelMaterial,
  );
  sentinel.frustumCulled = false;
  sentinel.onAfterRender = () => {
    paintCount++;
  };
  scene3.scene.add(sentinel);
}

const status = document.createElement("div");
status.className = "splat-input-bar";
status.style.top = "auto";
status.style.bottom = "0";
container.appendChild(status);

const { capture, captureSync } = createCapture(scene3, (W, H, aspect) => ({
  center: [Math.floor(W / 2), Math.floor(H / 2)],
  left: [Math.floor(W * xFrac(-3, aspect)), Math.floor(H / 2)],
  right: [Math.floor(W * xFrac(3, aspect)), Math.floor(H / 2)],
  // Background probe at mid-column near the frame's horizontal edge — NOT
  // [2, H/2]: under captureSync's LIVE aspect (hidden-pane fallback) a
  // narrow pane clamps the side clusters onto the left edge and the old
  // x=2 probe sampled the green blob (false red on a correct render —
  // ticket-03 review finding A5, observed live in ticket 04). Row 2 is
  // background under both backends' opposite row orders (clusters sit on
  // the center row; top and bottom rows are empty either way).
  corner: [Math.floor(W / 2), 2],
}));

// Progress sampling is TIMER-driven, not rAF-driven: a hidden pane pauses
// rAF entirely (handoff 003/005 trap — fixture loops never tick), and a
// sampler that never runs would let the monotonicity assertion pass
// vacuously. The final assert requires the sampler to have SEEN "ready".
const phaseOrder: Record<string, number> = {
  fetching: 0,
  constructing: 1,
  ready: 2,
  failed: -1,
};
let prevFraction = -1;
let prevPhaseIdx = -1;
let sampleCount = 0;
let sawReady = false;
let progressOk = true;
let progressDetail = "ok";

function sampleProgress(): void {
  const p = backend.progress(handle);
  const phaseIdx = phaseOrder[p.phase] ?? -2;
  sampleCount++;
  if (p.phase === "ready") sawReady = true;
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
}

// The H-LIFE gate compares the UNION of the counters that carry the splat
// data on either backend: WebGPU puts it in storage attributes; the WebGL2
// fallback emulates storage via PBO TEXTURES (measured live: mesh loaded →
// storageAttributes 0 but textures 56 / texturesSize 2.1 MB), so a
// storage-only gate would compare 0===0 there — backend-conditional
// vacuity (trap-1). Excluded on purpose: programs/renderTargets/
// uniformBuffers/readbackBuffers (lazily compiled or allocator-cached —
// they legitimately persist across dispose).
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
  const out = {} as GpuCounters;
  for (const key of GPU_COUNTER_KEYS) {
    const v = memory[key];
    // A renamed/absent counter must fail loudly — an undefined===undefined
    // comparison would make the exactness gate vacuously green (trap-1;
    // caught live when a `buffers` field read undefined).
    if (typeof v !== "number") {
      throw new Error(`renderer.info.memory.${key} missing — H-LIFE gate cannot run`);
    }
    out[key] = v;
  }
  return out;
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
  const out = {} as GpuCounters;
  for (const k of GPU_COUNTER_KEYS) out[k] = a[k] + delta[k];
  return out;
}

// The shared capture module LEAKS its offscreen render target BY DESIGN
// when a hidden-pane readback times out (its own comment: "Leak it
// instead; the hang is terminal here") — observed live as +2 textures /
// +262,144 B per timed-out capture on the WebGL2 fallback. The H-LIFE
// gate must not attribute that documented capture-module cost to
// dispose(): meter every capture's own counter delta and fold it into
// the expected baselines. Fully derived — zero tolerance constants.
const captureLeak = {} as GpuCounters;
for (const k of GPU_COUNTER_KEYS) captureLeak[k] = 0;

async function meteredCapture(): Promise<Record<string, number[] | string>> {
  const before = gpuMemoryCounters(scene3.renderer);
  try {
    return await capture();
  } catch (error) {
    if (scene3.backend !== "webgl2-fallback") throw error;
    // ONLY the timeout path absorbs a delta — that is where the capture
    // module leaks its render target by design. A successful capture
    // disposes its target (delta 0), and absorbing success-path deltas
    // would whitelist a real splat leak surfacing lazily during the
    // capture render (adversarial-review finding).
    const result = captureSync();
    const after = gpuMemoryCounters(scene3.renderer);
    for (const k of GPU_COUNTER_KEYS) captureLeak[k] += after[k] - before[k];
    return result;
  }
}

// Timer-free macrotask yield: Chrome INTENSIVELY throttles nested timers
// on long-hidden pages (~1 fire/minute), which froze the first cycle run
// for minutes — MessageChannel messages are macrotasks that are NOT
// subject to timer throttling, and fetch/microtasks keep flowing. ONE
// shared channel with a resolver queue: a channel pair per yield is
// thousands of port allocations feeding GC noise into the very heap
// series the leak gate reads (review finding).
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
  // On the WebGL2 fallback use the SYNCHRONOUS path directly: the async
  // readback's escape timeout is a throttled timer on a hidden pane, and
  // the center probe (W/2, H/2) is aspect-safe under captureSync's live
  // camera. WebGPU keeps the async readback (settles while hidden).
  let pixelsAfter: Record<string, number[] | string>;
  if (scene3.backend === "webgl2-fallback") {
    // Synchronous path allocates nothing — its counter delta stays fully
    // visible to the gate on purpose (no absorption; adversarial-review
    // finding: blanket metering would legalize the leak under test).
    pixelsAfter = captureSync();
  } else {
    pixelsAfter = await meteredCapture();
  }
  const v = pixelsAfter.center;
  if (!Array.isArray(v)) {
    throw new Error('capture sample center unavailable: ' + String(v));
  }
  return v;
}




// Timer-free ready wait: poll phase, render synchronously (the paint is
// what flips ready), yield via MessageChannel so the fetch/parse pipeline
// advances. Bounded so a real hang goes red instead of spinning forever.
async function awaitWhenReadyWithKick(h: ReturnType<ThreeGsBackend['load']>): Promise<void> {
  for (let spins = 0; spins < 20000; spins++) {
    const phase = backend.progress(h).phase;
    if (phase === 'ready' || phase === 'failed') return backend.whenReady(h);
    // A render can only flip readiness once the mesh exists — during
    // "fetching" it is pure waste (hundreds of renders/second against
    // the spin bound; review finding). Yield-only until constructing.
    if (phase !== 'fetching') {
      scene3.renderer.render(scene3.scene, scene3.camera);
    }
    await yieldMacrotask();
  }
  throw new Error('awaitWhenReadyWithKick: no ready/failed after 20000 spins');
}


const done = (async () => {
  const independentBuf = await (await fetch(plyUrl)).arrayBuffer();
  const independent = parseFixturePly(independentBuf);

  await scene3.ready;
  const baseline0 = gpuMemoryCounters(scene3.renderer);

  handle = backend.load({ url: plyUrl, format: "ply" });
  scene3.scene.add(handle.object);
  if (import.meta.env.DEV && window.__splatLab) {
    window.__splatLab.handle = handle;
  }

  sampleProgress();
  const progressTimer = setInterval(() => {
    sampleProgress();
    const p = backend.progress(handle);
    if (p.phase === "ready" || p.phase === "failed") clearInterval(progressTimer);
  }, 16);

  // Timer-free ready wait — the same helper the cycles use; the old 250 ms
  // setInterval kick was subject to the very hidden-page timer throttling
  // the cycle rework eliminated (review finding).
  await awaitWhenReadyWithKick(handle);
  const paintsAtReady = paintCount;
  scene3.renderer.render(scene3.scene, scene3.camera);
  // Deterministic final sample: the interval sampler races this microtask
  // after visibility flips — sample once more so "saw ready" cannot lose
  // that race while monotonicity is still checked across the whole series.
  sampleProgress();

  const counts = backend.counts(handle);
  assert(
    "counts-total",
    counts.total === 48 && counts.total === independent.count,
    `backend=${counts.total} independent=${independent.count}`,
  );
  assert(
    "counts-resident-selected",
    counts.resident === counts.total && counts.selected === counts.total,
    `resident=${counts.resident} selected=${counts.selected} total=${counts.total}`,
  );

  const box = backend.bounds(handle);
  const boundsMatch =
    box.min.x === independent.min[0] &&
    box.min.y === independent.min[1] &&
    box.min.z === independent.min[2] &&
    box.max.x === independent.max[0] &&
    box.max.y === independent.max[1] &&
    box.max.z === independent.max[2];
  assert(
    "bounds-match-independent",
    boundsMatch,
    `backend min=(${box.min.x},${box.min.y},${box.min.z}) max=(${box.max.x},${box.max.y},${box.max.z})`,
  );

  const meshChild = handle.object.children[0] as any;

  // Per-splat provenance: every center the backend's mesh carries equals the
  // file's position triple exactly (extrema alone would miss interior
  // corruption — adversarial-review finding).
  const posAttr = meshChild.splatGeometry.getAttribute("position");
  let positionsOk = posAttr.count === independent.count;
  for (let i = 0; positionsOk && i < independent.count; i++) {
    positionsOk =
      posAttr.array[i * 3] === independent.positions[i * 3] &&
      posAttr.array[i * 3 + 1] === independent.positions[i * 3 + 1] &&
      posAttr.array[i * 3 + 2] === independent.positions[i * 3 + 2];
  }
  assert(
    "positions-match-independent",
    positionsOk,
    `all ${independent.count} xyz triples exact (===)`,
  );

  const colorAttr = meshChild.splatGeometry.getAttribute("color");
  const expectedAlpha = new Uint8ClampedArray(independent.count);
  for (let i = 0; i < independent.count; i++) {
    expectedAlpha[i] = (1 / (1 + Math.exp(-independent.logits[i]!))) * 255;
  }
  let sigmoidOk = true;
  for (let i = 0; i < independent.count; i++) {
    const actual = colorAttr.array[i * 4 + 3]!;
    const expected = expectedAlpha[i]!;
    if (actual !== expected) {
      sigmoidOk = false;
      break;
    }
  }
  assert("sigmoid-opacity-bytes", sigmoidOk, `48 alpha bytes match sigmoid(logit)*255`);

  assert(
    "progress-monotonic",
    progressOk && sawReady && sampleCount >= 2,
    `${progressDetail} (samples=${sampleCount}, sawReady=${sawReady})`,
  );

  const prog = backend.progress(handle);
  assert(
    "whenReady-after-first-paint",
    paintsAtReady >= 1 &&
      handle.object.children.length === 1 &&
      prog.phase === "ready" &&
      prog.fraction === 1,
    `paintsAtReady=${paintsAtReady} meshChildren=${handle.object.children.length} phase=${prog.phase} fraction=${prog.fraction}`,
  );

  // Every refusal stub and refused format, asserted on the machine-readable
  // reason CODE (message prose can be reworded without breaking behavior —
  // review finding) plus the owner citation, so a stub regressing to a
  // silent no-op goes red.
  const refusalCases: Array<[string, () => void, string, string]> = [
    ["spz", () => backend.load({ url: "x.spz" }), "spz-refused", "watch item 13"],
    // Ticket 06 replaced the rad refusal with the paged path; a backend
    // built WITHOUT a decode-worker factory (this one) still refuses by name.
    ["rad-without-worker-factory", () => backend.load({ url: "x.rad" }), "rad-needs-worker-factory", "createDecodeWorker"],
    ["raycast", () => backend.raycast(handle, new THREE.Ray()), "raycast-not-implemented", "Phase 3 §B"],
    ["setEdits", () => backend.setEdits(handle, []), "set-edits-not-implemented", "Phase 3 §C"],
    ["setMeshColor", () => backend.setMeshColor(handle, [1, 1, 1, 1]), "set-mesh-color-not-implemented", "Phase 4"],
    ["setOptics", () => backend.setOptics(handle, null), "set-optics-not-implemented", "Phase 5"],
  ];
  for (const [name, call, reason, owner] of refusalCases) {
    let ok = false;
    try {
      call();
    } catch (error) {
      ok =
        error instanceof SplatBackendError &&
        error.reason === reason &&
        error.message.includes(owner);
    }
    assert(
      `${name}-named-refusal`,
      ok,
      `throws SplatBackendError(${reason}) citing ${owner}`,
    );
  }

  // Failure surfacing: a missing asset and a non-PLY payload must both land
  // as REJECTED whenReady + phase "failed" — never a hang in "constructing"
  // (the exact defect the adversarial review found in the first cut) and
  // never a silent blank.
  // A missing asset must land as a REJECTED whenReady with a named reason
  // and phase "failed" — never a constructing hang. Which reason depends on
  // the server (dev returns a real 404 → fetch-failed; an SPA-fallback host
  // would 200 with HTML → invalid-ply-header) — the backend contract is
  // "named failure", not a specific server behavior (review finding).
  // Fixed path, NOT derived from plyUrl: in a build plyUrl is a data: URL
  // and appending to it makes a malformed URL whose fetch throws a
  // TypeError instead of returning a 404.
  const missing = backend.load({
    url: "/examples/assets/splat-lab/definitely-missing.ply",
    format: "ply",
  });
  let missingReason = "";
  try {
    await backend.whenReady(missing);
  } catch (error) {
    if (error instanceof SplatBackendError) missingReason = error.reason;
  }
  assert(
    "missing-asset-fails-named",
    (missingReason === "fetch-failed" || missingReason === "invalid-ply-header") &&
      backend.progress(missing).phase === "failed",
    `whenReady rejects SplatBackendError(${missingReason}), phase=${backend.progress(missing).phase}`,
  );

  // A structurally valid MESH PLY (x/y/z only) must be refused by header
  // validation — PLYLoader would otherwise fill the mapped-but-absent splat
  // properties with NaN and the scene would reach "ready" as an invisible
  // mesh (review finding, PLYLoader.js:648-656).
  const meshPlyHeader =
    "ply\nformat binary_little_endian 1.0\nelement vertex 1\n" +
    "property float x\nproperty float y\nproperty float z\nend_header\n";
  const meshPlyUrl = URL.createObjectURL(
    new Blob([meshPlyHeader, new Float32Array([0, 0, 0])]),
  );
  const meshPly = backend.load({ url: meshPlyUrl, format: "ply" });
  let meshPlyReason = "";
  try {
    await backend.whenReady(meshPly);
  } catch (error) {
    if (error instanceof SplatBackendError) meshPlyReason = error.reason;
  } finally {
    URL.revokeObjectURL(meshPlyUrl);
  }
  assert(
    "mesh-ply-refused-not-splat",
    meshPlyReason === "not-splat-ply" &&
      backend.progress(meshPly).phase === "failed",
    `whenReady rejects SplatBackendError(${meshPlyReason}) — no NaN silent-ready`,
  );

  const notPly = backend.load({ url: "/examples/splat-lab/index.html", format: "ply" });
  let notPlyReason = "";
  try {
    await backend.whenReady(notPly);
  } catch (error) {
    if (error instanceof SplatBackendError) notPlyReason = error.reason;
  }
  assert(
    "non-ply-payload-fails-named",
    notPlyReason === "invalid-ply-header" &&
      backend.progress(notPly).phase === "failed",
    `whenReady rejects SplatBackendError(${notPlyReason}), phase=failed (no constructing hang)`,
  );

  // Hidden-pane fallback: WebGPU's async readback settles hidden, but the
  // WebGL2 fallback polls its fence via rAF and times out — captureSync is
  // the escape hatch for THAT case only; on WebGPU a capture failure is a
  // real failure and must surface (adversarial-review finding). Metered:
  // see captureLeak above.
  const pixels: Record<string, number[] | string> = await meteredCapture();
  const px = (name: string): number[] => {
    const v = pixels[name];
    if (!Array.isArray(v)) throw new Error(`capture sample "${name}" unavailable: ${v}`);
    return v;
  };
  const center = px("center");
  const left = px("left");
  const right = px("right");
  const corner = px("corner");

  // Alpha must be fully opaque at every sampled point — a zero/partial
  // alpha readback is a stale or broken frame even when RGB looks right
  // (adversarial-review finding).
  assert(
    "pixel-center-red",
    isDominantRed(center),
    `rgba=[${center.join(",")}]`,
  );
  assert(
    "pixel-left-green",
    left[1]! > 96 && left[1]! > 2 * left[0]! && left[1]! > 2 * left[2]! && left[3] === 255,
    `rgba=[${left.join(",")}]`,
  );
  assert(
    "pixel-right-yellow",
    right[0]! > 96 &&
      right[1]! > 96 &&
      right[0]! > 2 * right[2]! &&
      right[1]! > 2 * right[2]! &&
      right[3] === 255,
    `rgba=[${right.join(",")}]`,
  );
  const bgR = 0x11;
  const bgG = 0x11;
  const bgB = 0x33;
  assert(
    "pixel-corner-background",
    Math.abs(corner[0]! - bgR) < 32 &&
      Math.abs(corner[1]! - bgG) < 32 &&
      Math.abs(corner[2]! - bgB) < 32,
    `rgba=[${corner.join(",")}] near background`,
  );


  const tiny = new ThreeGsBackend({
    renderer: scene3.renderer,
    maxStorageBufferBindingSizeOverride: 256,
  });
  const overCap = tiny.load({ url: plyUrl, format: 'ply' });
  let overCapReason = '';
  let overCapMsg = '';
  try {
    await tiny.whenReady(overCap);
  } catch (error) {
    if (error instanceof SplatBackendError) {
      overCapReason = error.reason;
      overCapMsg = error.message;
    }
  }
  assert(
    'over-capacity-refused',
    overCapReason === 'over-capacity' &&
      tiny.progress(overCap).phase === 'failed' &&
      overCapMsg.includes('16384') &&
      overCapMsg.includes('256'),
    'whenReady rejects SplatBackendError(' + overCapReason + '), phase=' + tiny.progress(overCap).phase + ', msg=' + overCapMsg,
  );

  const afterRefusalCenter = await sampleCenterRgba();
  assert(
    'page-usable-after-refusal',
    isDominantRed(afterRefusalCenter),
    'rgba=[' + afterRefusalCenter.join(',') + ']',
  );

  const heapSamples: (number | null)[] = [];
  const cycleDetails: string[] = [];
  let disposeCyclesOk = true;
  let disposeCyclesDetail = 'ok';

  for (let i = 0; i < 10; i++) {
    // Per-cycle baselines: the expected after-dispose state is the cycle's
    // own pre-load counters PLUS whatever the capture module leaked during
    // the cycle (metered, derived — see captureLeak above).
    const pre = gpuMemoryCounters(scene3.renderer);
    const leakBefore = cloneCounters(captureLeak);
    const cycleHandle = backend.load({ url: plyUrl, format: 'ply' });
    scene3.scene.add(cycleHandle.object);
    await awaitWhenReadyWithKick(cycleHandle);

    const cycleCounts = backend.counts(cycleHandle);
    if (cycleCounts.total !== 48) {
      disposeCyclesOk = false;
      disposeCyclesDetail = 'cycle ' + i + ': counts.total=' + cycleCounts.total;
      break;
    }

    scene3.renderer.render(scene3.scene, scene3.camera); // guaranteed paint, timer-free
    const cycleCenter = await sampleCenterRgba();
    if (!isDominantRed(cycleCenter)) {
      disposeCyclesOk = false;
      disposeCyclesDetail = 'cycle ' + i + ': center not dominant-red rgba=[' + cycleCenter.join(',') + ']';
      break;
    }

    // Gate liveness: with the cycle mesh live, the tracked counters must
    // DIFFER from baseline — otherwise "flat after dispose" would be
    // vacuously true (a gate that cannot see the load cannot prove the
    // unload; trap-1, and backend-conditional: storage moves on WebGPU,
    // textures on WebGL2).
    const loaded = gpuMemoryCounters(scene3.renderer);
    if (countersEqual(loaded, pre)) {
      disposeCyclesOk = false;
      disposeCyclesDetail =
        'cycle ' + i + ': GATE BLIND — loaded counters equal baseline (' + formatCounters(loaded) + ')';
      break;
    }

    const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
    heapSamples.push(heap);

    backend.dispose(cycleHandle);
    scene3.scene.remove(cycleHandle.object);

    const after = gpuMemoryCounters(scene3.renderer);
    cycleDetails.push(
      'cycle ' + i + ': heap ' + heap + ', storage ' + after.storageAttributes + '/' + after.storageAttributesSize +
      'B, textures ' + after.textures + '/' + after.texturesSize + 'B',
    );

    const leakDelta = {} as typeof captureLeak;
    for (const k of GPU_COUNTER_KEYS) leakDelta[k] = captureLeak[k] - leakBefore[k];
    const expected = countersPlus(pre, leakDelta);
    if (!countersEqual(after, expected)) {
      disposeCyclesOk = false;
      disposeCyclesDetail =
        'cycle ' + i + ': after-dispose counters diverge — after {' + formatCounters(after) +
        '} vs expected {' + formatCounters(expected) + '} (pre + metered capture leak)';
      break;
    }
  }

  assert(
    'dispose-cycles-gpu-flat',
    disposeCyclesOk,
    disposeCyclesOk ? cycleDetails.join('; ') : disposeCyclesDetail,
  );

  const memAvailable = heapSamples.every((h) => h !== null);
  if (!memAvailable) {
    assert(
      'heap-not-strictly-increasing',
      false,
      'SKIPPED-as-FAIL: performance.memory unavailable',
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
      'heap-not-strictly-increasing',
      !allStrictlyIncreasing,
      'heaps=[' + heapSamples.join(',') + ']',
    );
  }

  clearInterval(progressTimer); // its callback probes handle — now dying
  backend.dispose(handle);
  scene3.scene.remove(handle.object);
  if (import.meta.env.DEV && window.__splatLab) {
    window.__splatLab.handle = null;
  }

  const afterMainDispose = gpuMemoryCounters(scene3.renderer);
  const expectedFinal = countersPlus(baseline0, captureLeak);
  assert(
    'dispose-main-restores-baseline0',
    countersEqual(afterMainDispose, expectedFinal),
    'after {' + formatCounters(afterMainDispose) + '} vs baseline0+capture-leak {' + formatCounters(expectedFinal) + '}',
  );

  let unknownHandleOk = false;
  try {
    backend.counts(handle);
  } catch (error) {
    unknownHandleOk = error instanceof SplatBackendError && error.reason === 'unknown-handle';
  }
  assert(
    'disposed-handle-unknown',
    unknownHandleOk,
    'throws SplatBackendError(unknown-handle)',
  );

  // Mid-load dispose: the pipeline must stop at its next checkpoint, the
  // pending whenReady must reject handle-disposed, and no mesh may ever
  // land in the group (adversarial-review coverage finding).
  const midLoad = backend.load({ url: plyUrl, format: 'ply' });
  // Grab the promise BEFORE disposing — the post-dispose contract makes the
  // handle unknown to every method, so a consumer awaiting readiness must
  // already hold it (this is the real consumer pattern).
  const midLoadReady = backend.whenReady(midLoad);
  backend.dispose(midLoad);
  let midLoadReason = '';
  try {
    await midLoadReady;
  } catch (error) {
    if (error instanceof SplatBackendError) midLoadReason = error.reason;
  }
  // Let the abandoned pipeline run to its checkpoint before inspecting.
  for (let i = 0; i < 50; i++) await yieldMacrotask();
  assert(
    'mid-load-dispose-named',
    midLoadReason === 'handle-disposed' && midLoad.object.children.length === 0,
    'whenReady rejects SplatBackendError(' + midLoadReason + '), meshChildren=' + midLoad.object.children.length,
  );

  // A rendererless backend must refuse dispose by name (it cannot free GPU
  // memory), not half-work.
  const noRenderer = new ThreeGsBackend();
  const orphan = noRenderer.load({ url: plyUrl, format: 'ply' });
  let noRendererReason = '';
  try {
    noRenderer.dispose(orphan);
  } catch (error) {
    if (error instanceof SplatBackendError) noRendererReason = error.reason;
  }
  assert(
    'dispose-needs-renderer',
    noRendererReason === 'dispose-needs-renderer',
    'throws SplatBackendError(' + noRendererReason + ')',
  );

  status.textContent = `backend: ${scene3.backend} — ${passed} passed, ${failed} failed`;
  finishSummary();
  return { passed, failed };
})();

done.catch((err) => {
  const div = document.createElement("div");
  div.className = "assertion fail";
  div.textContent = `SPLAT-LAB RUNNER FAILED: ${err}`;
  out.appendChild(div);
  // A crashed runner is a FAILED run — without this the summary reads
  // "N passed, 0 failed" in pass styling (adversarial-review finding).
  failed++;
  finishSummary();
  console.error("splat-lab runner failed", err);
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    scene3.dispose();
    status.remove();
  });
}

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__splatLab = {
    scene3,
    backend,
    handle: null, // assigned once load() runs inside done() — never undefined
    capture,
    captureSync,
    step: () => scene3.renderer.render(scene3.scene, scene3.camera),
  };
}

declare global {
  interface Window {
    __splatLab?: {
      scene3: ThreeSplatScene;
      backend: ThreeGsBackend;
      handle: ReturnType<ThreeGsBackend["load"]> | null;
      capture: () => Promise<Record<string, number[]>>;
      captureSync: () => Record<string, number[] | string>;
      step: () => void;
    };
  }
}
