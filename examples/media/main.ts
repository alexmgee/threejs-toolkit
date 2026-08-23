/**
 * MediaLayer fixture — ticket 09 runtime proof + colour-baseline bench.
 *
 * An image plane of KNOWN sRGB pixel value renders under ThreeSplatScene on
 * both backends (?webgl=1 forces the WebGL2 fallback). The readback at the
 * plane's center is this toolkit's OWN colour baseline (ADR 0003: an
 * absolute record, never a comparison): the source PNG is solid sRGB
 * [200,60,60] (examples/assets/periphery/face-px.png, generated,
 * deterministic), the texture is tagged SRGBColorSpace and the material is
 * toneMapped:false. The MEASURED baseline (which is not identity for the
 * texture path — one sRGB decode, no re-encode) lives in
 * docs/plan/results/ticket09-color-baseline/README.md; this page carries
 * no expected value of its own.
 *
 * DEV hook: window.__media { scene3, layer, report, booted, capture,
 * captureSync }.
 */

import { ThreeSplatScene } from "@toolkit/core/ThreeSplatScene";
import { MediaLayer } from "@toolkit/render/MediaLayer";
import { createCapture } from "../shared/capture";
// ?url import so vite EMITS the asset into the build — a bare runtime
// string 404s in dist/ (adversarial review; no publicDir in this repo).
import imgUrl from "../assets/periphery/face-px.png?url";

const forceWebGL = new URLSearchParams(location.search).get("webgl") === "1";
const container = document.getElementById("viewer")!;

const scene3 = new ThreeSplatScene({
  container,
  fov: 60,
  cameraPosition: [0, 0, 4],
  background: 0x111133,
  forceWebGL,
});

const layer = new MediaLayer();

const report: Record<string, unknown> = { phase: "booting" };

const booted = (async () => {
  await scene3.ready;
  report.backend = scene3.backend;

  // attach()'s declared param is {scene} only; the renderer is read through
  // an internal cast (MediaLayer.ts:86) — pass it the same way sparkjs's
  // SiteRuntime does, via a wider object.
  layer.attach({ scene: scene3.scene, renderer: scene3.renderer } as { scene: typeof scene3.scene });
  layer.setMedia([
    {
      id: "img",
      kind: "image",
      url: imgUrl,
      position: [0, 0, 0],
      size: [2, 2],
      binding: { always: true },
    },
  ]);
  layer.setVisible(new Set(["img"]));

  // TextureLoader resolves asynchronously — poll for the installed mesh.
  const deadline = performance.now() + 10_000;
  while (!layer.getObject("img")) {
    if (performance.now() > deadline) {
      throw new Error("media plane never installed (texture load failed?)");
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  layer.tick(scene3.camera);
  report.planeInstalled = true;
  // installed ≠ rendered: visible is the sync-visibility outcome, and the
  // center readback below is the actual rendering evidence.
  report.planeVisible = layer.getObject("img")?.visible === true;
  report.phase = "ready";
  console.log("[media] ready", JSON.stringify(report));
})().catch((err) => {
  report.phase = "failed";
  report.error = String(err);
  console.error("[media] boot failed", err);
});

// Center pixel = the media plane (camera [0,0,4] → plane at origin, 2×2,
// fov 60 → plane spans ~half the frame height); edge = scene background.
// y stays at H/2 (backend row-order convention).
const { capture, captureSync } = createCapture(scene3, (W, H) => ({
  center: [Math.floor(W / 2), Math.floor(H / 2)],
  edge: [Math.floor(W * 0.06), Math.floor(H / 2)],
}));

(window as unknown as Record<string, unknown>).__media = {
  scene3,
  layer,
  report,
  booted,
  capture,
  captureSync,
};

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    layer.dispose();
    scene3.dispose();
  });
}
