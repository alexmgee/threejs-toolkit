/**
 * SceneGrade demo — ticket 10, the Phase 1 GATE: the grade (contrast /
 * tint / vignette) running on node RenderPipeline + TSL, on BOTH backends.
 * Backend switch: default = WebGPU; `?webgl=1` = forceWebGL. Grade switch:
 * default = ON at the PINNED H-GRADE settings; `?grade=0` = off (facade
 * render path — the ungraded control frame).
 *
 * Same deterministic unlit geometry as examples/scene (red box center,
 * green sphere left, yellow box right, 0x111133 background) so graded
 * pixel expectations derive from known inputs.
 *
 * COLOR SPACE of recorded pixels (ticket 10 Comments caution, pinned by
 * MEASUREMENT 2026-08-21): BOTH paths read back display-space sRGB here.
 * Grade ON applies renderOutput() explicitly in the node chain; grade OFF
 * (facade render into the capture's plain RenderTarget) also arrives
 * sRGB-transformed — measured [17,17,51] for the 0x111133 background on
 * both backends, NOT the linearized [1,1,8].
 */

import * as THREE from "three/webgpu";
import { ThreeSplatScene } from "@toolkit/core/ThreeSplatScene";
import { SceneGrade } from "@toolkit/render/SceneGrade";
import { createCapture } from "../shared/capture";

const container = document.getElementById("viewer")!;
const query = new URLSearchParams(location.search);
const forceWebGL = query.get("webgl") === "1";
const gradeOn = query.get("grade") !== "0";

const CAMERA_Z = 6;
const FOV = 60;

/** PINNED H-GRADE settings — the ticket's three knobs, held identical on
 *  the sparkjs-toolkit side during the side-by-side. */
const PINNED_GRADE = {
  enabled: true,
  contrast: 1.25,
  tint: 0.5,
  vignette: 0.5,
};

const scene3 = new ThreeSplatScene({
  container,
  fov: FOV,
  cameraPosition: [0, 0, CAMERA_Z],
  background: 0x111133,
  forceWebGL,
});

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

const sceneGrade = new SceneGrade();
sceneGrade.attach(scene3);
if (gradeOn) {
  sceneGrade.update(PINNED_GRADE);
  sceneGrade.setEnabled(true);
}

const status = document.createElement("div");
status.className = "splat-input-bar";
status.style.top = "auto";
status.style.bottom = "0";
container.appendChild(status);

scene3.ready
  .then(() => {
    status.textContent =
      `backend: ${scene3.backend} — grade: ${gradeOn ? "ON (pinned)" : "off"}`;
    console.log(`[grade-demo] ready, backend: ${scene3.backend}`);
  })
  .catch((err) => {
    status.textContent = `INIT FAILED: ${err}`;
    console.error("[grade-demo] init failed", err);
  });

/** Same projection math as examples/scene (single home per demo). */
function xFrac(worldX: number, aspect: number): number {
  const halfExtent = Math.tan((FOV * Math.PI) / 360) * CAMERA_Z * aspect;
  return Math.min(0.999, Math.max(0, (1 + worldX / halfExtent) / 2));
}

/**
 * Capture renders through the ACTIVE frame path — the grade pipeline when
 * enabled, the facade render otherwise — so readbacks record what the
 * screen shows. Sample map adds `midEdge` (x=W/4) where the vignette falls
 * between corner-strength and center-zero.
 */
const { capture, captureSync } = createCapture(
  scene3,
  (W, H, aspect) => ({
    center: [Math.floor(W / 2), Math.floor(H / 2)],
    left: [Math.floor(W * xFrac(-3, aspect)), Math.floor(H / 2)],
    right: [Math.floor(W * xFrac(3, aspect)), Math.floor(H / 2)],
    corner: [2, Math.floor(H / 2)],
    midEdge: [Math.floor(W / 4), Math.floor(H / 2)],
  }),
  () => {
    if (scene3.renderOverride) scene3.renderOverride();
    else scene3.renderer.render(scene3.scene, scene3.camera);
  },
);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    sceneGrade.dispose();
    scene3.dispose();
    status.remove();
  });
}

// DEV-only: the gate's site build emits this page into dist/, and live
// globals do not belong in a built artifact.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__gradeDemo = {
    scene3,
    sceneGrade,
    capture,
    captureSync,
    setGrade: (on: boolean) => sceneGrade.setEnabled(on),
    step: () => {
      if (scene3.renderOverride) scene3.renderOverride();
      else scene3.renderer.render(scene3.scene, scene3.camera);
    },
  };
}
