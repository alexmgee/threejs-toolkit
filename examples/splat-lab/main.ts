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

const backend = new ThreeGsBackend();
// format is EXPLICIT: in `vite build` this ?url import becomes a data: URL
// (3 KB asset, under the 4096-byte assetsInlineLimit) with no extension to
// infer from — inference-only would throw at module top level and kill the
// built page (review finding, verified with a real build).
const handle = backend.load({ url: plyUrl, format: "ply" });
scene3.scene.add(handle.object);

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
  corner: [2, Math.floor(H / 2)],
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
sampleProgress();
const progressTimer = setInterval(() => {
  sampleProgress();
  const p = backend.progress(handle);
  if (p.phase === "ready" || p.phase === "failed") clearInterval(progressTimer);
}, 16);

/** One frame advance that survives a hidden pane: rAF when it ticks,
 *  otherwise a manual synchronous render (same escape hatch as the demos'
 *  `step()` — rendering fires onFrame and the mesh's onAfterRender). */
function awaitFrame(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    requestAnimationFrame(() => {
      if (settled) return;
      settled = true;
      resolve();
    });
    setTimeout(() => {
      if (settled) return;
      settled = true;
      scene3.renderer.render(scene3.scene, scene3.camera);
      resolve();
    }, 250);
  });
}

const done = (async () => {
  const independentBuf = await (await fetch(plyUrl)).arrayBuffer();
  const independent = parseFixturePly(independentBuf);

  await scene3.ready;
  // Ready-kick watchdog: whenReady is paint-observed, and a hidden pane
  // freezes the rAF loop — without a periodic manual render the await
  // upstream of awaitFrame could hang forever (review finding). Extra
  // renders are harmless when the loop is live.
  let readySettled = false;
  const readyKick = setInterval(() => {
    if (readySettled) {
      clearInterval(readyKick);
      return;
    }
    scene3.renderer.render(scene3.scene, scene3.camera);
  }, 250);
  try {
    await backend.whenReady(handle);
  } finally {
    readySettled = true;
    clearInterval(readyKick);
  }
  const paintsAtReady = paintCount;
  await awaitFrame();
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
    ["rad", () => backend.load({ url: "x.rad" }), "rad-refused", "tickets 05/06"],
    ["dispose", () => backend.dispose(handle), "dispose-not-implemented", "ticket 04"],
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
  // real failure and must surface (adversarial-review finding).
  let pixels: Record<string, number[] | string>;
  try {
    pixels = await capture();
  } catch (error) {
    if (scene3.backend !== "webgl2-fallback") throw error;
    pixels = captureSync() as Record<string, number[] | string>;
  }
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
    center[0]! > 96 && center[0]! > 2 * center[1]! && center[0]! > 2 * center[2]! && center[3] === 255,
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
    handle,
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
      handle: ReturnType<ThreeGsBackend["load"]>;
      capture: () => Promise<Record<string, number[]>>;
      captureSync: () => Record<string, number[] | string>;
      step: () => void;
    };
  }
}
