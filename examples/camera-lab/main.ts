/**
 * camera-lab — CameraSystem orbit/recenter parity fixture (Phase 2 ticket 10).
 *
 * Owner ruling Q3 (2026-09-17): a dedicated page; the capture is taken on the
 * PRE-EDIT CameraSystem, and after the D22 edit the same page must reproduce
 * it EXACTLY — camera numbers AND pixel readbacks, on both backends
 * (default WebGPU, `?webgl=1`).
 *
 * The script is deterministic by construction: a pinned 512×256 CSS viewport
 * at pixel ratio 1 (OrbitControls scales drags by the canvas client height),
 * `update()` driven with a fixed step (never the clock), orbit input as
 * dispatched synthetic pointer events (verified empirically on this build to
 * drive OrbitControls — the stronger drill, per the ruling), recenter as a
 * dispatched `dblclick` through CameraSystem's real handler. The whole
 * script runs twice on fresh CameraSystems; the page asserts both runs are
 * identical, then prints the canonical capture JSON and its SHA-256 — the
 * before/after comparison is made on those.
 *
 * Capture mode is fixed per backend so before/after runs are comparable in
 * any pane visibility: WebGPU uses the async offscreen readback; WebGL2 uses
 * the same-task sync readback (the async fallback fence needs animation
 * frames, which a hidden pane does not run).
 */

import * as THREE from "three/webgpu";
import { ThreeSplatScene } from "@toolkit/core/ThreeSplatScene";
import { CameraSystem, type CameraState } from "@toolkit/core/CameraSystem";
import { createCapture } from "../shared/capture";

const container = document.getElementById("viewer")!;
const out = document.getElementById("out")!;
const captureOut = document.getElementById("capture")!;
const forceWebGL = new URLSearchParams(location.search).get("webgl") === "1";

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, detail: string): void {
  const div = document.createElement("div");
  div.className = `assertion ${condition ? "pass" : "fail"}`;
  div.textContent = `${condition ? "PASS" : "FAIL"} — ${name}: ${detail}`;
  out.appendChild(div);
  console.log(`camera-lab ${condition ? "PASS" : "FAIL"} ${name} — ${detail}`);
  condition ? passed++ : failed++;
}

function finishSummary(): void {
  const heading = document.createElement("h2");
  heading.className = failed === 0 ? "pass" : "fail";
  heading.textContent = `camera-lab: ${passed} passed, ${failed} failed`;
  out.appendChild(heading);
  console.log(`camera-lab RESULT ${passed} passed, ${failed} failed`);
}

const pageErrors: string[] = [];
window.addEventListener("error", (ev) => {
  pageErrors.push(String(ev.error ?? ev.message));
});
window.addEventListener("unhandledrejection", (ev) => {
  pageErrors.push(`unhandledrejection: ${String(ev.reason)}`);
});

const scene3 = new ThreeSplatScene({
  container,
  fov: 60,
  cameraPosition: [0, 0, 8],
  background: 0x111133,
  pixelRatio: 1,
  forceWebGL,
});

// Plain unlit boxes at known positions: exact, backend-stable colors.
const BOXES: Array<{ at: [number, number, number]; color: number }> = [
  { at: [0, 0, 0], color: 0xff0000 },
  { at: [2, 0, 0], color: 0x00ff00 },
  { at: [-2, 0, 0], color: 0x0000ff },
  { at: [0, 2, 0], color: 0xffff00 },
  { at: [0, -2, 0], color: 0x00ffff },
  { at: [0, 0, -2], color: 0xff00ff },
];
for (const { at, color } of BOXES) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color }));
  mesh.position.set(...at);
  scene3.scene.add(mesh);
}

// 9 columns × 5 rows, floored and clamped below the edge (capture.ts: px()
// has no range check). Dense enough that an orbit about the vertical axis
// moves some sample off or onto a box — a sparse grid on the centre column
// only saw the vertical box stack, which such an orbit leaves in place.
const { capture, captureSync } = createCapture(scene3, (W, H) => {
  const points: Record<string, [number, number]> = {};
  const xs = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((f) => Math.min(W - 1, Math.floor(W * f)));
  const ys = [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => Math.min(H - 1, Math.floor(H * f)));
  ys.forEach((y, r) => xs.forEach((x, c) => {
    points[`p${r}${c}`] = [x, y];
  }));
  return points;
});

const STEP_SECONDS = 1 / 60;
const PINNED_POSE: CameraState = { yaw: 30, pitch: 15, distance: 8, pivot: { x: 0, y: 0, z: 0 } };

interface Snapshot {
  readonly label: string;
  readonly state: CameraState;
  readonly position: number[];
  readonly quaternion: number[];
  readonly target: number[];
  readonly pixels: Record<string, number[] | string>;
}

function stepUpdates(cameraSystem: CameraSystem, count: number): void {
  for (let i = 0; i < count; i++) cameraSystem.update(STEP_SECONDS);
}

async function snapshot(label: string, cameraSystem: CameraSystem): Promise<Snapshot> {
  const pixels = scene3.backend === "webgl2-fallback" ? captureSync() : await capture();
  return {
    label,
    state: cameraSystem.getState(),
    position: scene3.camera.position.toArray(),
    quaternion: scene3.camera.quaternion.toArray(),
    target: cameraSystem.controls.target.toArray(),
    pixels,
  };
}

/** A synthetic mouse drag, in canvas-relative CSS pixels. */
function drag(from: [number, number], moves: Array<[number, number]>): void {
  const canvas = scene3.canvas;
  const rect = canvas.getBoundingClientRect();
  const base = { pointerId: 1, pointerType: "mouse", isPrimary: true, bubbles: true, cancelable: true, composed: true };
  let [x, y] = from;
  canvas.dispatchEvent(new PointerEvent("pointerdown", { ...base, button: 0, buttons: 1, clientX: rect.left + x, clientY: rect.top + y }));
  for (const [dx, dy] of moves) {
    x += dx;
    y += dy;
    canvas.dispatchEvent(new PointerEvent("pointermove", { ...base, button: -1, buttons: 1, clientX: rect.left + x, clientY: rect.top + y }));
  }
  canvas.dispatchEvent(new PointerEvent("pointerup", { ...base, button: 0, buttons: 0, clientX: rect.left + x, clientY: rect.top + y }));
}

/** A synthetic double-click at canvas-relative CSS pixels. */
function doubleClick(at: [number, number]): void {
  const rect = scene3.canvas.getBoundingClientRect();
  scene3.canvas.dispatchEvent(new MouseEvent("dblclick", {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: rect.left + at[0],
    clientY: rect.top + at[1],
  }));
}

/** The scripted sequence, on a FRESH CameraSystem (its OrbitControls carries
 *  damping state, so a reused instance would not restart from zero). The
 *  literal mirrors the rail page's construction (renderer passed). */
async function runScript(): Promise<Snapshot[]> {
  const cameraSystem = new CameraSystem({
    camera: scene3.camera,
    canvas: scene3.canvas,
    scene: scene3.scene,
    renderer: scene3.renderer,
    target: [0, 0, 0],
    minDistance: 0.5,
    maxDistance: 500,
    enableRecenter: true,
  });
  const shots: Snapshot[] = [];
  try {
    cameraSystem.setState(PINNED_POSE);
    stepUpdates(cameraSystem, 2);
    shots.push(await snapshot("pinned-pose", cameraSystem));

    drag([256, 128], [[12, 0], [12, 0], [12, 0], [12, 0], [12, 4], [12, 4]]);
    stepUpdates(cameraSystem, 90);
    shots.push(await snapshot("after-orbit-right-down", cameraSystem));

    drag([300, 100], [[-20, -8], [-20, -8], [-20, -8], [-20, -8], [-20, -8]]);
    stepUpdates(cameraSystem, 90);
    shots.push(await snapshot("after-orbit-left-up", cameraSystem));

    doubleClick([360, 96]);
    stepUpdates(cameraSystem, 10);
    shots.push(await snapshot("recenter-mid", cameraSystem));
    stepUpdates(cameraSystem, 40);
    shots.push(await snapshot("after-recenter", cameraSystem));

    drag([256, 128], [[-15, 6], [-15, 6], [-15, 6], [-15, 6]]);
    stepUpdates(cameraSystem, 90);
    shots.push(await snapshot("orbit-around-new-pivot", cameraSystem));
  } finally {
    cameraSystem.dispose();
  }
  return shots;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const done = (async () => {
  await scene3.ready;
  const buffer = new THREE.Vector2();
  scene3.renderer.getDrawingBufferSize(buffer);
  const captureMode = scene3.backend === "webgl2-fallback" ? "sync (same-task gl.readPixels)" : "async (offscreen readback)";
  const rect = scene3.canvas.getBoundingClientRect();
  assert(
    "viewport-pinned",
    buffer.x === 512 && buffer.y === 256 && scene3.renderer.getPixelRatio() === 1 && scene3.canvas.clientHeight === 256 &&
      Number.isInteger(rect.left) && Number.isInteger(rect.top) && rect.width === 512 && rect.height === 256,
    `backend=${scene3.backend}; drawing buffer ${buffer.x}×${buffer.y}, pixel ratio ${scene3.renderer.getPixelRatio()}, canvas CSS ${scene3.canvas.clientWidth}×${scene3.canvas.clientHeight} at (${rect.left}, ${rect.top}) (integer offsets: synthetic MouseEvent coordinates are truncated); capture ${captureMode}`,
  );

  const first = await runScript();
  const second = await runScript();
  const firstJson = JSON.stringify(first);
  const secondJson = JSON.stringify(second);
  assert(
    "script-deterministic",
    firstJson === secondJson,
    `two runs on fresh CameraSystems: ${firstJson === secondJson ? "identical" : "DIFFER"} (${first.length} snapshots each, numbers and pixels)`,
  );

  const byLabel = new Map(first.map((shot) => [shot.label, shot]));
  const pinned = byLabel.get("pinned-pose")!;
  const orbit = byLabel.get("after-orbit-right-down")!;
  const orbit2 = byLabel.get("after-orbit-left-up")!;
  const mid = byLabel.get("recenter-mid")!;
  const recentered = byLabel.get("after-recenter")!;
  const aroundNew = byLabel.get("orbit-around-new-pivot")!;
  const sameNumbers = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
  const pixelKeys = Object.keys(pinned.pixels);
  const pixelsDiffer = (a: Snapshot, b: Snapshot) =>
    pixelKeys.some((key) => JSON.stringify(a.pixels[key]) !== JSON.stringify(b.pixels[key]));

  assert(
    "synthetic-pointer-orbit-moves-camera",
    pinned.state.yaw !== orbit.state.yaw && orbit.state.pitch !== orbit2.state.pitch &&
      sameNumbers(pinned.target, orbit.target) && pixelsDiffer(pinned, orbit),
    `yaw ${pinned.state.yaw} → ${orbit.state.yaw} → ${orbit2.state.yaw}; pitch ${pinned.state.pitch} → ${orbit.state.pitch} → ${orbit2.state.pitch}; target unchanged by orbiting=${sameNumbers(pinned.target, orbit.target)}; pixels changed=${pixelsDiffer(pinned, orbit)}`,
  );
  assert(
    "double-click-recenter-moves-pivot",
    !sameNumbers(orbit2.target, recentered.target) && !sameNumbers(mid.target, recentered.target) &&
      !sameNumbers(orbit2.target, mid.target) && pixelsDiffer(orbit2, recentered) &&
      sameNumbers(recentered.target, aroundNew.target),
    `pivot (${orbit2.target.join(", ")}) → mid (${mid.target.join(", ")}) → (${recentered.target.join(", ")}); later orbit keeps the new pivot=${sameNumbers(recentered.target, aroundNew.target)}; pixels changed=${pixelsDiffer(orbit2, recentered)}`,
  );
  const unavailablePixels = first.flatMap((shot) => Object.values(shot.pixels).filter((value) => !Array.isArray(value)));
  assert(
    "pixels-read",
    unavailablePixels.length === 0,
    `${first.length * pixelKeys.length} samples, unavailable=${JSON.stringify(unavailablePixels)}`,
  );
  assert("no-page-errors", pageErrors.length === 0, `${pageErrors.length} error(s): ${JSON.stringify(pageErrors)}`);

  const digest = await sha256Hex(firstJson);
  captureOut.textContent = `CAPTURE backend=${scene3.backend} sha256=${digest}\n${firstJson}`;
  console.log(`camera-lab CAPTURE backend=${scene3.backend} sha256=${digest}`);
})();

done
  .catch((error: unknown) => {
    failed++;
    const div = document.createElement("div");
    div.className = "assertion fail";
    div.textContent = `FAIL — runner crashed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`;
    out.appendChild(div);
    console.error("camera-lab runner crashed", error);
  })
  .finally(finishSummary);
