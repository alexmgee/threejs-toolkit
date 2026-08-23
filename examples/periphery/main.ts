/**
 * Periphery fixture — ticket 08 runtime proof.
 *
 * Exercises the scene-periphery cluster under ThreeSplatScene on both
 * backends (?webgl=1 forces the WebGL2 fallback, repo fixture pattern):
 *  - EnvironmentLoader: HDR equirect (default) or 6-face cubemap
 *    (?env=cube) through the three/webgpu PMREMGenerator.
 *  - PropLayer: a generated one-box .glb prop.
 *  - Controls: createOrbitControls drives the camera.
 * ColmapData / FrustumRenderer are compile-verified only (no runtime AC
 * names them; exercising FrustumRenderer needs a COLMAP dataset).
 *
 * Assets are generated, deterministic fixtures (examples/assets/periphery,
 * script recorded in ticket 08's Comments) — no copyrighted content, no
 * network dependence.
 *
 * DEV hook: window.__periphery { scene3, env, props, controls, report }.
 */

import { ThreeSplatScene } from "@toolkit/core/ThreeSplatScene";
import { EnvironmentLoader } from "@toolkit/core/EnvironmentLoader";
import { createOrbitControls } from "@toolkit/core/Controls";
import { PropLayer } from "@toolkit/render/PropLayer";
import { createCapture } from "../shared/capture";

const query = new URLSearchParams(location.search);
const forceWebGL = query.get("webgl") === "1";
const useCube = query.get("env") === "cube";

const container = document.getElementById("viewer")!;

const scene3 = new ThreeSplatScene({
  container,
  fov: 60,
  cameraPosition: [0, 1, 4],
  background: 0x111133,
  forceWebGL,
});

const controls = createOrbitControls({
  camera: scene3.camera,
  canvas: scene3.canvas,
  target: [0, 0, 0],
});

scene3.setOnFrame(() => {
  controls.update();
});

const env = new EnvironmentLoader({ sparkScene: scene3 });
const props = new PropLayer();
props.attach({ scene: scene3.scene });

// Filled by boot(); read by the harness after `ready` settles.
const report: Record<string, unknown> = { phase: "booting" };

async function boot(): Promise<void> {
  await scene3.ready;
  report.backend = scene3.backend;

  const envTexture = await env.load(
    useCube
      ? {
          cubeMapUrls: [
            "../assets/periphery/face-px.png",
            "../assets/periphery/face-nx.png",
            "../assets/periphery/face-py.png",
            "../assets/periphery/face-ny.png",
            "../assets/periphery/face-pz.png",
            "../assets/periphery/face-nz.png",
          ],
        }
      : { hdrUrl: "../assets/periphery/env-64x32.hdr" },
  );
  report.envKind = useCube ? "cubemap" : "hdr";
  report.envTextureType = envTexture.constructor.name;
  report.sceneEnvironmentSet = scene3.scene.environment === envTexture;
  report.sceneBackgroundSet = scene3.scene.background === envTexture;

  await props.setProps([
    {
      id: "box",
      url: "../assets/periphery/box.glb",
      position: [0, 0, 0],
      rotationDeg: [0, 30, 0],
    },
  ]);
  const installed = scene3.scene.getObjectByName("box");
  report.propInstalled = installed !== undefined;
  report.propMeshCount = (() => {
    let n = 0;
    installed?.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh) n++;
    });
    return n;
  })();

  report.phase = "ready";
  console.log("[periphery] ready", JSON.stringify(report));
}

const booted = boot().catch((err) => {
  report.phase = "failed";
  report.error = String(err);
  console.error("[periphery] boot failed", err);
});

// Readback proof (doc 05 rule 2: artifacts or it didn't happen): center
// pixel hits the box prop (camera [0,1,4] → origin), edge pixel sees the
// environment background. y stays at H/2 (backend row-order convention).
const { capture, captureSync } = createCapture(scene3, (W, H) => ({
  center: [Math.floor(W / 2), Math.floor(H / 2)],
  edge: [Math.floor(W * 0.06), Math.floor(H / 2)],
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dev-only sandbox hook
(window as any).__periphery = { scene3, env, props, controls, report, booted, capture, captureSync };
