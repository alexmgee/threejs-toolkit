/**
 * Pixel-readback capture — GENERALIZED from examples/scene/main.ts
 * (ticket 10's instruction: generalize, don't rewrite). Everything the
 * original encoded is carried: the hidden-pane rAF-fence finding, the
 * timeout + finally target-restore discipline, the same-task gl.readPixels
 * fallback, the 256-byte WebGPU row-padding guard, and the y=H/2 sample-row
 * convention (readback row ORDER differs per backend — GL bottom-up, WebGPU
 * top-down — so only vertically symmetric rows are backend-independent).
 *
 * Callers provide the scene and a sample-point function; each demo keeps
 * its own projection math and passes it in.
 *
 * KNOWN LIMITS (review, 2026-08-21):
 * - A COMPOSED renderFrame (node pipeline) is not resolution-faithful to
 *   the offscreen W x H: PassNode/SMAA intermediates size from the LIVE
 *   drawing buffer (PassNode.js:801-805) and are then resampled into the
 *   bound target. Geometry/aspect are correct, but sampled values can
 *   shift slightly with pane size — record the pane size beside any pinned
 *   expectation taken through a composed path.
 * - px() indexes with stride W*4 and NO range check: sample-point
 *   functions MUST clamp fractions below 1 and floor to integers (see the
 *   demos' xFrac) — an out-of-range x silently reads the next row.
 */

import * as THREE from "three/webgpu";
import type { ThreeSplatScene } from "@toolkit/core/ThreeSplatScene";

/** Sample points as pixel coordinates for a W x H frame at the given
 *  aspect. Convention: keep y at H/2 (see row-order note above). */
export type SamplePoints = (
  W: number,
  H: number,
  aspect: number,
) => Record<string, [number, number]>;

/**
 * Create the capture pair for one scene. `render` defaults to the facade's
 * plain render; a demo whose frame goes through a composer (SceneGrade)
 * passes its own so the capture records the composed output.
 */
export function createCapture(
  scene3: ThreeSplatScene,
  samplePoints: SamplePoints,
  render?: () => void,
) {
  const renderFrame =
    render ?? (() => scene3.renderer.render(scene3.scene, scene3.camera));

  /**
   * Async capture: renders into an offscreen target and reads pixels back
   * (doc 05 H-VISUAL: "readback after completion, not toDataURL habits").
   * Serialized: concurrent callers share the in-flight capture (a second
   * would clobber the bound target).
   *
   * KNOWN LIMIT (verified against three's source, ticket 03): on the WebGL2
   * fallback, readRenderTargetPixelsAsync polls its GPU fence via
   * requestAnimationFrame (three.webgpu.js:68900) — in a hidden pane the
   * promise never settles; the timeout below rejects so `finally` can
   * restore state, and callers fall back to captureSync().
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
      let readbackStarted = false;
      let readbackSettled = false;
      try {
        scene3.camera.aspect = W / H;
        scene3.camera.updateProjectionMatrix();
        scene3.renderer.setRenderTarget(rt);
        renderFrame();
        readbackStarted = true;
        // One full-rect readback, one timeout: per-pixel round-trips would
        // cost up to Nx5s of bound-target time on a hung fallback.
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
        const points = samplePoints(W, H, W / H);
        const out: Record<string, number[]> = {};
        for (const [name, [x, y]] of Object.entries(points)) {
          out[name] = px(x, y);
        }
        return out;
      } finally {
        // Never leave the offscreen target bound — a hung readback otherwise
        // silently redirects every later render (observed during review).
        clearTimeout(timeoutId);
        scene3.renderer.setRenderTarget(null);
        // Restore only if the ResizeObserver didn't legitimately change the
        // aspect during the await (a mid-capture container resize would
        // otherwise be clobbered back and stick until the next resize).
        if (scene3.camera.aspect === W / H) {
          scene3.camera.aspect = prevAspect;
          scene3.camera.updateProjectionMatrix();
        }
        // On the hung-readback path the copy is still in flight against this
        // texture — disposing it would race the outstanding readback (device
        // validation errors). Leak it instead; the hang is terminal here.
        // A renderFrame() throw BEFORE the readback started has no copy in
        // flight — dispose then too (review finding, 2026-08-21).
        if (readbackSettled || !readbackStarted) rt.dispose();
      }
    })().finally(() => {
      captureInFlight = null;
    });
    return captureInFlight;
  }

  /**
   * Synchronous fallback capture for the WebGL2 backend: render manually,
   * then read the default framebuffer in the SAME task via the canvas's own
   * gl context, before compositing can clear it. Sample positions use the
   * LIVE camera aspect and drawing-buffer size.
   */
  function captureSync(): Record<string, number[] | string> {
    // Never run while an async capture holds the render target (the guard
    // above serializes capture() only against itself).
    if (captureInFlight) return { error: "capture() in flight — retry later" };
    const gl = scene3.canvas.getContext("webgl2");
    if (!gl) {
      return { error: "no webgl2 context (WebGPU backend? use capture())" };
    }
    scene3.renderer.setRenderTarget(null);
    renderFrame();
    const W = gl.drawingBufferWidth;
    const H = gl.drawingBufferHeight;
    const px = (x: number, y: number) => {
      const b = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b);
      return Array.from(b);
    };
    const points = samplePoints(W, H, scene3.camera.aspect);
    const out: Record<string, number[] | string> = {};
    for (const [name, [x, y]] of Object.entries(points)) {
      out[name] = px(x, y);
    }
    return out;
  }

  return { capture, captureSync };
}
