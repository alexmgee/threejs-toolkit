/**
 * Camera-rail parity fixture — ADAPTED from sparkjs-toolkit examples/rail/main.ts
 * (ticket 04; adaptation sanctioned by owner ruling — examples/ fixtures are
 * adaptations by design, R5's byte-identity binds the src/ COPY files only).
 *
 * Tests: scroll drives camera along rail, next/prev buttons,
 * settle-on-arrival, orbit always works during transitions,
 * per-stop orbit limits (see the latch note at the stops below).
 *
 * The complete strip/add inventory lives in ticket 04's Comments
 * (.scratch/phase-1-foundation/issues/04-foundation-cluster.md) — the single
 * home for this fixture's declared divergences; this header does not
 * re-enumerate it. When ticket 03 lands ThreeSplatScene, repointing this
 * bootstrap is ticket 03's or ticket 08's business.
 */

import * as THREE from "three";
import { CameraSystem } from "@toolkit/core/CameraSystem";
import { CameraRail, type RailStop } from "@toolkit/core/CameraRail";

const container = document.getElementById("viewer")!;

// Rail stops are the single source for both the camera targets and the
// placeholder markers below — a marker always marks a stop's pivot.
//
// LATCH NOTE (frozen CameraRail semantics, CameraRail.ts applyOrbitLimits):
// per-stop orbit limits are applied when a stop defines them and are NEVER
// restored on leaving — visiting "Red marker" clamps pitch 5..60 for the
// rest of the session. A parity harness pinning poses at stops 0/2 must
// therefore pin visit order too.
const RAIL_STOPS: RailStop[] = [
  {
    label: "Front",
    camera: { yaw: 0, pitch: 15, distance: 30, pivot: { x: 0, y: 1.5, z: 0 } },
    meta: { markerColor: 0x4f9dff },
  },
  {
    label: "Red marker",
    camera: { yaw: 120, pitch: 25, distance: 18, pivot: { x: 12, y: 2, z: -8 } },
    orbitLimits: { minPitch: 5, maxPitch: 60 },
    meta: { markerColor: 0xff6b6b },
  },
  {
    label: "Green marker",
    camera: { yaw: -100, pitch: 35, distance: 22, pivot: { x: -10, y: 1, z: 10 } },
    meta: { markerColor: 0x71e07a },
  },
];

// --- Inline bootstrap (replaces SparkScene; CameraSystemConfig requires a
// --- WebGLRenderer, so the fixture renders WebGL) ---

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

// Sized by the zero-guarded applySize() seed below (immediate, works
// wherever layout is computable) with the ResizeObserver as the ongoing
// authority. Aspect starts at a safe 1 — never computed unguarded from a
// possibly-unlaid-out container (the h=0 case yields Infinity).
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
camera.position.set(0, 5, 30);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
container.appendChild(renderer.domElement);

// ResizeObserver on the container, mirroring SparkScene's own sizing
// mechanism (SparkScene.ts:233).
const applySize = () => {
  const width = container.clientWidth;
  const height = container.clientHeight;
  if (width === 0 || height === 0) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
};
const resizeObserver = new ResizeObserver(applySize);
resizeObserver.observe(container);
// Seed once immediately: reading clientWidth forces layout, which covers
// environments where ResizeObserver delivery is deferred (e.g. hidden
// tabs — RO callbacks ride rendering steps). Zero-size guarded, so a
// genuinely pre-layout run just waits for the observer.
applySize();

// Placeholder geometry so rail motion and orbit are visible without splats —
// one wireframe marker per rail stop, at that stop's pivot.
scene.add(new THREE.GridHelper(60, 30, 0x444444, 0x222222));
for (const stop of RAIL_STOPS) {
  const { x, y, z } = stop.camera.pivot;
  const color = (stop.meta?.markerColor as number | undefined) ?? 0xffffff;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2 * y, 2),
    new THREE.MeshBasicMaterial({ color, wireframe: true }),
  );
  mesh.position.set(x, y, z);
  scene.add(mesh);
}

const cameraSystem = new CameraSystem({
  camera,
  canvas: renderer.domElement,
  scene,
  renderer,
  target: [0, 0, 0],
  minDistance: 0.5,
  maxDistance: 500,
  enableRecenter: true,
});

const cameraRail = new CameraRail({
  cameraSystem,
  canvas: renderer.domElement,
  stops: RAIL_STOPS,
  transitionDuration: 2,
  settleDuration: 0.5,
  onStopArrived: (index, stop) => {
    console.log(`Arrived at stop ${index}: ${stop.label}`);
    updateStopLabel(stop.label ?? `Stop ${index}`);
  },
});

// --- On-screen nav UI ---

const navBar = document.createElement("div");
navBar.className = "splat-input-bar";
navBar.style.top = "auto";
navBar.style.bottom = "0";
navBar.style.justifyContent = "center";

const prevBtn = document.createElement("button");
prevBtn.textContent = "← Prev";
prevBtn.addEventListener("click", () => cameraRail.prev());

const stopLabel = document.createElement("span");
stopLabel.className = "status";
stopLabel.style.minWidth = "80px";
stopLabel.style.textAlign = "center";
stopLabel.textContent = RAIL_STOPS[0].label ?? "Stop 0";

const nextBtn = document.createElement("button");
nextBtn.textContent = "Next →";
nextBtn.addEventListener("click", () => cameraRail.next());

navBar.appendChild(prevBtn);
navBar.appendChild(stopLabel);
navBar.appendChild(nextBtn);
container.appendChild(navBar);

function updateStopLabel(label: string): void {
  stopLabel.textContent = label;
}

// --- Scroll binding (togglable) ---

let railScrollEnabled = false;

const scrollHandler = (e: WheelEvent) => {
  if (!railScrollEnabled) return;
  e.preventDefault();
  const step = e.deltaY > 0 ? 0.02 : -0.02;
  cameraRail.setProgress(Math.max(0, Math.min(1, cameraRail.progress + step)));
};
window.addEventListener("wheel", scrollHandler, { passive: false });

const toggleBtn = document.createElement("button");
toggleBtn.textContent = "Rail: OFF";
toggleBtn.addEventListener("click", () => {
  railScrollEnabled = !railScrollEnabled;
  toggleBtn.textContent = railScrollEnabled ? "Rail: ON" : "Rail: OFF";
});
navBar.appendChild(toggleBtn);

// --- Animation loop (replaces SparkScene.setOnFrame) ---

const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const deltaTime = clock.getDelta();
  cameraSystem.update(deltaTime);
  cameraRail.update(deltaTime);
  renderer.render(scene, camera);
});

// Programmatic hook for the parity harnesses (doc 05 drives fixtures at
// pinned poses) and for headless verification where rAF is paused.
// DEV-only: the gate's site build emits this page into dist/, and a live
// global of the camera system does not belong in a built artifact.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__railFixture = {
    camera,
    cameraSystem,
    cameraRail,
    renderer,
    scene,
  };
}
