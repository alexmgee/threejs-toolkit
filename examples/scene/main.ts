/**
 * ThreeSplatScene plain-mesh demo — ticket 03, Phase 1 exit criterion (b):
 * a plain three.js mesh scene renders under ThreeSplatScene on BOTH
 * backends. Backend switch: default = WebGPU; `?webgl=1` = forceWebGL
 * (the spike's proven switch, spikes/native-rad/main.ts:30).
 *
 * Verification is by EXECUTION, not compilation: the DEV hook exposes
 * `capture()`, which renders into an offscreen target and reads pixels
 * back asynchronously (doc 05 H-VISUAL: "capture via readback after
 * completion, not toDataURL habits"). Known geometry at known colors makes
 * the expected pixel values deterministic (MeshBasicMaterial — unlit).
 */

import * as THREE from "three/webgpu";
import { ThreeSplatScene } from "@toolkit/core/ThreeSplatScene";
import { createCapture } from "../shared/capture";

const container = document.getElementById("viewer")!;
const forceWebGL = new URLSearchParams(location.search).get("webgl") === "1";

const CAMERA_Z = 6;
const FOV = 60;

const scene3 = new ThreeSplatScene({
  container,
  fov: FOV,
  cameraPosition: [0, 0, CAMERA_Z],
  background: 0x111133,
  forceWebGL,
});

// Deterministic unlit geometry: red box center, green sphere left,
// yellow box right — pixel expectations derive from these constants.
const red = new THREE.Mesh(
  new THREE.BoxGeometry(2, 2, 2),
  new THREE.MeshBasicMaterial({ color: 0xff0000 }),
);
scene3.scene.add(red);

const green = new THREE.Mesh(
  new THREE.SphereGeometry(0.8, 24, 16),
  new THREE.MeshBasicMaterial({ color: 0x00ff00 }),
);
green.position.set(-3, 0, 0);
scene3.scene.add(green);

const yellow = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshBasicMaterial({ color: 0xffff00 }),
);
yellow.position.set(3, 0, 0);
scene3.scene.add(yellow);

const status = document.createElement("div");
status.className = "splat-input-bar";
status.style.top = "auto";
status.style.bottom = "0";
container.appendChild(status);

scene3.ready
  .then(() => {
    status.textContent = `backend: ${scene3.backend}`;
    console.log(`[scene-demo] ready, backend: ${scene3.backend}`);
  })
  .catch((err) => {
    status.textContent = `INIT FAILED: ${err}`;
    console.error("[scene-demo] init failed", err);
  });

/**
 * Fraction of viewport width where world x lands (single home for the
 * projection math): half-extent at z=0 is tan(fov/2)*CAMERA_Z*aspect, so
 * worldX maps to (1 + worldX/halfExtent)/2. captureSync passes the live
 * camera aspect; capture passes its forced offscreen aspect.
 */
function xFrac(worldX: number, aspect: number): number {
  const halfExtent = Math.tan((FOV * Math.PI) / 360) * CAMERA_Z * aspect;
  // Clamp: on a narrow/tall viewport a side mesh is genuinely off-frame and
  // the raw fraction goes negative/>1 — gl.readPixels with a negative x
  // returns a zero buffer that reads as a false render failure (review).
  // A clamped sample reads the frame edge instead; interpret accordingly.
  return Math.min(0.999, Math.max(0, (1 + worldX / halfExtent) / 2));
}

/**
 * Capture pair from the shared module (examples/shared/capture.ts —
 * generalized out of this file by ticket 10; the rAF-fence, target-restore,
 * and row-padding discipline all live there now). This demo contributes
 * only its sample-point map: center (red box), left (green sphere), right
 * (yellow box), corner (background), all at y=H/2 (row-order note in the
 * shared module).
 */
const { capture, captureSync } = createCapture(scene3, (W, H, aspect) => ({
  center: [Math.floor(W / 2), Math.floor(H / 2)],
  // floor, not round: round(W * 0.999-clamped) can index one past the
  // last column and silently read the next row's first pixel (sweep).
  left: [Math.floor(W * xFrac(-3, aspect)), Math.floor(H / 2)],
  right: [Math.floor(W * xFrac(3, aspect)), Math.floor(H / 2)],
  corner: [2, Math.floor(H / 2)],
}));

// HMR teardown: without this, each save in `vite dev` appends a second
// canvas + live loop, and captureSync would read the stale canvas (review).
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    scene3.dispose();
    status.remove(); // the scene disposes only its own canvas (sweep)
  });
}
// Accepted residual (sweep, documented): disposing mid-capture surfaces as
// a "readback failed" rejection to the capture caller rather than a
// labeled "scene disposed" — cosmetic; no extra machinery for a DEV probe.

// DEV-only: the gate's site build emits this page into dist/, and a live
// scene/renderer global does not belong in a built artifact.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__sceneDemo = {
    scene3,
    capture,
    captureSync,
    // Manual frame step for headless verification where rAF is paused.
    step: () => scene3.renderer.render(scene3.scene, scene3.camera),
  };
}
