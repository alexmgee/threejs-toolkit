/**
 * Phase 0 spike entry — smoke stage.
 *
 * Current scope: prove the vendored dev-branch addon constructs and renders a
 * trivial synthetic splat cloud under published three 0.185.1, on WebGPU and on
 * the forceWebGL fallback (?webgl=1). The pager lands next (task 4) and replaces
 * the synthetic geometry with streamed hero pages.
 */
import * as THREE from "three/webgpu";
// @ts-expect-error vendored dev-branch addon ships no declarations (plan doc 03 §F)
import { GaussianSplatMesh } from "./vendor/GaussianSplatMesh.js";

const hud = document.getElementById("hud")!;
const say = (s: string) => (hud.textContent = s);

const params = new URLSearchParams(location.search);
const forceWebGL = params.get("webgl") === "1";

async function boot() {
  const renderer = new THREE.WebGPURenderer({ antialias: false, forceWebGL });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  document.getElementById("app")!.appendChild(renderer.domElement);
  await renderer.init();

  // Splat alpha blending must run in sRGB working space (plan doc 02).
  THREE.ColorManagement.workingColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f1319);
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.02, 1000);
  camera.position.set(0, 0, 4);

  // Synthetic cloud: N random gaussians on a sphere shell — enough to exercise
  // buffer construction, sorting, and blending without any file I/O.
  const N = 20000;
  const positions = new Float32Array(N * 3);
  const covariance = new Float32Array(N * 6);
  const colors = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    const r = 1.4 + Math.random() * 0.1;
    const t = Math.random() * Math.PI * 2;
    const p = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(p) * Math.cos(t);
    positions[i * 3 + 1] = r * Math.sin(p) * Math.sin(t);
    positions[i * 3 + 2] = r * Math.cos(p);
    // isotropic covariance = (s^2) I, upper triangle xx,xy,xz,yy,yz,zz
    const s = 0.015 + Math.random() * 0.01;
    covariance[i * 6] = s * s;
    covariance[i * 6 + 3] = s * s;
    covariance[i * 6 + 5] = s * s;
    colors[i * 4] = 80 + Math.random() * 175;
    colors[i * 4 + 1] = 120 + Math.random() * 100;
    colors[i * 4 + 2] = 200 + Math.random() * 55;
    colors[i * 4 + 3] = 200;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("covariance", new THREE.BufferAttribute(covariance, 6));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4, true));

  const splats = new GaussianSplatMesh(geometry);
  scene.add(splats);

  let frames = 0;
  const t0 = performance.now();
  renderer.setAnimationLoop(() => {
    splats.rotation.y += 0.003;
    splats.updateSort(renderer, camera);
    renderer.render(scene, camera);
    frames++;
    if (frames % 30 === 0) {
      const backend = forceWebGL ? "WebGL2 fallback" : "WebGPU";
      say(
        `native-rad spike — smoke stage\n` +
        `backend: ${backend}\n` +
        `splats:  ${N.toLocaleString()} synthetic\n` +
        `frames:  ${frames} (${((frames * 1000) / (performance.now() - t0)).toFixed(0)} fps avg)`,
      );
    }
  });

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // Headless verification hook: renders one frame into an offscreen target and
  // reports how much of it the splats cover. Works with the pane hidden (no rAF,
  // no compositor needed) — the same readback path measure.ts will use for
  // first-pixel detection, since WebGPU has no preserveDrawingBuffer.
  (window as unknown as Record<string, unknown>).__spike = {
    renderer, scene, camera, splats,
    async probe(size = 64): Promise<{ backend: string; coveredFraction: number; ms: number }> {
      const t0 = performance.now();
      splats.updateSort(renderer, camera);
      let covered = 0;
      let px = 0;
      if (forceWebGL) {
        // WebGL backend: readRenderTargetPixelsAsync awaits a fence that only
        // resolves on an animation tick — deadlocks in a hidden pane. Instead:
        // render to the canvas and drawImage it into a 2D canvas in the SAME
        // task, before any compositing clear can happen.
        renderer.render(scene, camera);
        const c2d = document.createElement("canvas");
        c2d.width = size; c2d.height = size;
        const ctx = c2d.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(renderer.domElement, 0, 0, size, size);
        const img = ctx.getImageData(0, 0, size, size).data;
        px = size * size;
        for (let i = 0; i < px; i++) {
          if (img[i * 4] > 30 || img[i * 4 + 1] > 30 || img[i * 4 + 2] > 30) covered++;
        }
      } else {
        const target = new THREE.RenderTarget(size, size);
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);
        const buf = (await renderer.readRenderTargetPixelsAsync(
          target, 0, 0, size, size,
        )) as Uint8Array | Float32Array;
        px = size * size;
        for (let i = 0; i < px; i++) {
          const bg = buf instanceof Float32Array ? 0.12 : 30;
          if (buf[i * 4] > bg || buf[i * 4 + 1] > bg || buf[i * 4 + 2] > bg) covered++;
        }
        target.dispose();
      }
      return {
        backend: forceWebGL ? "webgl2-fallback" : "webgpu",
        coveredFraction: covered / px,
        ms: performance.now() - t0,
      };
    },
  };
}

boot().catch((e) => {
  say(`BOOT FAILED\n${e?.message ?? e}\n\n(see console)`);
  console.error(e);
});
