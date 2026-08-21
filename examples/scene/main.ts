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
 * Async capture: renders into an offscreen target and reads pixels back
 * (doc 05 H-VISUAL: "readback after completion, not toDataURL habits").
 * Returns center (red box), left (green sphere), right (yellow box), and
 * corner (background) [r,g,b,a] samples. Serialized: concurrent callers
 * share the in-flight capture (a second would clobber the bound target).
 *
 * KNOWN LIMIT (verified against three's source, ticket 03): on the WebGL2
 * fallback, readRenderTargetPixelsAsync polls its GPU fence via
 * requestAnimationFrame (three.webgpu.js:68900) — in a hidden pane the
 * promise never settles; the timeout below rejects so `finally` can
 * restore state, and callers fall back to captureSync(). While a capture
 * awaits, the live animation loop renders the same scene into the bound
 * target — content-identical, readback unaffected; the on-screen canvas
 * just freezes for the capture's duration.
 */
let captureInFlight: Promise<Record<string, number[]>> | null = null;

function capture(): Promise<Record<string, number[]>> {
  captureInFlight ??= (async () => {
    await scene3.ready;
    // W is LOAD-BEARING: WebGPU pads readback rows to 256 bytes
    // (bytesPerRow = ceil(W*4/256)*256, three.webgpu.js) and px() below
    // indexes with stride W*4 — correct only when W*4 is a multiple of 256.
    const W = 256;
    const H = 128;
    if ((W * 4) % 256 !== 0) throw new Error("W*4 must be 256-byte aligned");
    const rt = new THREE.RenderTarget(W, H);
    const prevAspect = scene3.camera.aspect;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let readbackSettled = false;
    try {
      scene3.camera.aspect = W / H;
      scene3.camera.updateProjectionMatrix();
      scene3.renderer.setRenderTarget(rt);
      scene3.renderer.render(scene3.scene, scene3.camera);
      // One full-rect readback, one timeout: four per-pixel round-trips
      // would cost up to 4x5s of bound-target time on a hung fallback.
      const buf = (await Promise.race([
        scene3.renderer
          .readRenderTargetPixelsAsync(rt, 0, 0, W, H)
          .finally(() => {
            readbackSettled = true;
          }),
        new Promise<never>((_, rej) => {
          timeoutId = setTimeout(
            () => rej(new Error("readback timeout — use captureSync")),
            5000,
          );
        }),
      ])) as Uint8Array | Uint8ClampedArray;
      const px = (x: number, y: number) => {
        const i = (y * W + x) * 4;
        return Array.from(buf.slice(i, i + 4));
      };
      const aspect = W / H;
      // All samples at y=H/2: readback row ORDER differs between backends
      // (GL reads bottom-up, WebGPU top-down — review, verified in three's
      // source), so only vertically symmetric sample rows are
      // backend-independent. corner = left frame edge at mid-height.
      return {
        center: px(W / 2, H / 2),
        // floor, not round: round(W * 0.999-clamped) can index one past the
        // last column and silently read the next row's first pixel (sweep).
        left: px(Math.floor(W * xFrac(-3, aspect)), H / 2),
        right: px(Math.floor(W * xFrac(3, aspect)), H / 2),
        corner: px(2, H / 2),
      };
    } finally {
      // Never leave the offscreen target bound — a hung readback otherwise
      // silently redirects every later render (observed during review).
      clearTimeout(timeoutId);
      scene3.renderer.setRenderTarget(null);
      // Restore only if the ResizeObserver didn't legitimately change the
      // aspect during the await (a mid-capture container resize would
      // otherwise be clobbered back and stick until the next resize; sweep).
      if (scene3.camera.aspect === W / H) {
        scene3.camera.aspect = prevAspect;
        scene3.camera.updateProjectionMatrix();
      }
      // On the hung-readback path the copy is still in flight against this
      // texture — disposing it would race the outstanding readback (device
      // validation errors). Leak it instead; the hang is terminal here.
      if (readbackSettled) rt.dispose();
    }
  })().finally(() => {
    captureInFlight = null;
  });
  return captureInFlight;
}

/**
 * Synchronous fallback capture for the WebGL2 backend (tracked code, doc 05
 * rule 2 — "artifacts or it didn't happen"): render manually, then read the
 * default framebuffer in the SAME task via the canvas's own gl context,
 * before compositing can clear it. Sample positions use the LIVE camera
 * aspect via xFrac.
 */
function captureSync(): Record<string, number[] | string> {
  // Never run while an async capture holds the render target (the guard
  // below serializes capture() only against itself — review).
  if (captureInFlight) return { error: "capture() in flight — retry later" };
  const gl = scene3.canvas.getContext("webgl2");
  if (!gl) return { error: "no webgl2 context (WebGPU backend? use capture())" };
  scene3.renderer.setRenderTarget(null);
  scene3.renderer.render(scene3.scene, scene3.camera);
  const W = gl.drawingBufferWidth;
  const H = gl.drawingBufferHeight;
  const px = (x: number, y: number) => {
    const b = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b);
    return Array.from(b);
  };
  const aspect = scene3.camera.aspect;
  return {
    center: px(Math.floor(W / 2), Math.floor(H / 2)),
    left: px(Math.floor(W * xFrac(-3, aspect)), Math.floor(H / 2)),
    right: px(Math.floor(W * xFrac(3, aspect)), Math.floor(H / 2)),
    // Mid-height frame edge: backend/orientation-independent (see the
    // row-order note in capture()).
    corner: px(2, Math.floor(H / 2)),
  };
}

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
