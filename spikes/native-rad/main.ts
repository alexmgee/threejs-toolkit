/**
 * Phase 0 spike entry — hero stage (tasks 4–5 wired).
 *
 * Default: stream the 204 MB hero .rad through RadFetcher (prefetch-all, 206-or-die)
 * → single decode worker → PagePool (runtime-derived page budget per ADR 0003;
 * Spark-shaped LOD traversal as concept reference, not a parity target)
 * → GaussianSplatMesh.fork ({capacity}, uploadPage, center.w selection, explicit
 * invalidation). Pinned test pose (borrowed from the loadtest sandbox, since it
 * frames the hero well): PerspectiveCamera 60° 0.01–1000 at (0,0,3) → origin.
 *
 * ?synthetic=1 keeps the task-2 smoke scene, now through the fork's non-capacity
 * path. This exercises that path compiles and renders — it is NOT an H-FORK
 * identity check (nothing renders the vendor mesh side-by-side; that harness
 * arrives with FORK.md in Phase 1).
 * ?webgl=1 forces the WebGL2 fallback backend, as before.
 */
import * as THREE from "three/webgpu";
// @ts-expect-error fork ships no declarations (plan doc 03 §F)
import { GaussianSplatMesh } from "./src/GaussianSplatMesh.fork.js";
import { parseRadHeader } from "./src/RadHeader.js";
import { RadFetcher } from "./src/RadFetcher.js";
import { PagePool, PAGE_SIZE } from "./src/PagePool.js";
import type { CameraParams } from "./src/PagePool.js";
import type { DecodeResult } from "./src/rad-worker.js";

const hud = document.getElementById("hud")!;
const say = (s: string) => (hud.textContent = s);

const params = new URLSearchParams(location.search);
const forceWebGL = params.get("webgl") === "1";
const synthetic = params.get("synthetic") === "1";
const measure = params.get("measure") === "1";

// `v` is the cold-cache buster (doc 05 rule 1: versioned URLs per trial).
const cacheBuster = params.get("v");
const HERO_URL =
  "/@fs/D:/Projects/sparkjs-toolkit/examples/assets/lab-sh1-sparsity.rad" +
  (cacheBuster !== null ? `?v=${encodeURIComponent(cacheBuster)}` : "");

interface SpikeStats {
  backend: string;
  progress: number;
  residentPages: number;
  selectedCount: number;
  fullQuality: boolean;
  partialUploadBroken: boolean;
  fetch: { requested: number; landed: number; bytesLanded: number };
  decodedChunks: number;
  decodeMsTotal: number;
  uploadMsTotal: number;
  traverseMsTotal: number;
  traverseCount: number;
  firstPixelMs: number | null;
  fullQualityMs: number | null;
  /** Render height the LOD limit was computed from — measurement runs must see the real pane height here, not the fallback. */
  pixelScaleHeight: number;
}

// Hidden Browser pane reports a 0×0 window (trap 2 environment); fall back to
// a 16:9 shape so boot, resize, traversal and probe stay well-formed. Resolved
// in ONE place — per-axis, so a half-zero window can never produce Infinity/NaN.
const FALLBACK_W = 1280;
const FALLBACK_H = 720;
const viewSize = (): { w: number; h: number } => ({ w: innerWidth || FALLBACK_W, h: innerHeight || FALLBACK_H });

async function createRenderer(): Promise<THREE.WebGPURenderer> {
  const renderer = new THREE.WebGPURenderer({ antialias: false, forceWebGL });
  const { w, h } = viewSize();
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  document.getElementById("app")!.appendChild(renderer.domElement);
  await renderer.init();
  // Splat alpha blending must run in sRGB working space (plan doc 02).
  THREE.ColorManagement.workingColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

function installProbe(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  splats: { updateSort(r: unknown, c: unknown): boolean },
  extras: Record<string, unknown>,
): void {
  // Headless verification hook (trap 2/3: hidden pane parks rAF; WebGL async
  // readback deadlocks hidden — render + same-task drawImage instead).
  (window as unknown as Record<string, unknown>).__spike = {
    renderer, scene, camera, splats, THREE, ...extras,
    async probe(size = 64): Promise<{ backend: string; coveredFraction: number; ms: number }> {
      const t0 = performance.now();
      splats.updateSort(renderer, camera);
      let covered = 0;
      let px = 0;
      if (forceWebGL) {
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

// ---------------------------------------------------------------------------
// Page-budget derivation (owner decision 2026-08-16; ADR 0003)
// pages = min(P_limits, P_asset), overridable via ?pages=N (eviction regime).
// Every term is derived from the CREATED device's real limits — no constants.
// ---------------------------------------------------------------------------

const VEC4_BYTES_PER_SPLAT = 16; // each vec4 storage buffer; the binding-limited allocation

interface PageBudget {
  pages: number;
  /** Human-readable derivation (which term bound, with the limit values). */
  source: string;
}

// sh1 words per splat — must match the fork's packed layout (SH_BAND_WORDS[1]
// in vendor/GaussianSplatUtils.js; the fork derives its byte layout from the
// same constant).
const SH1_WORDS = 3;

/** Largest page count whose PBO textures fit maxTextureSize (WebGL2 fallback stores storage attributes as textures — three.webgpu.js setupPBO layout). */
function webglPageLimit(maxTextureSize: number, maxPages: number): number {
  for (let p = maxPages; p >= 1; p--) {
    const n = p * PAGE_SIZE;
    const w4 = THREE.MathUtils.ceilPowerOfTwo(Math.sqrt(n)); // vec4 attrs: count n, itemSize 4
    const h4 = Math.ceil(n / w4);
    const w1 = THREE.MathUtils.ceilPowerOfTwo(Math.sqrt(SH1_WORDS * n)); // sh1 words, itemSize 1
    const h1 = Math.ceil((SH1_WORDS * n) / w1);
    if (w4 <= maxTextureSize && h4 <= maxTextureSize && w1 <= maxTextureSize && h1 <= maxTextureSize) return p;
  }
  return 1;
}

function derivePageBudget(renderer: THREE.WebGPURenderer, chunkCount: number): PageBudget {
  const backend = (renderer as unknown as { backend: Record<string, unknown> }).backend;
  let pLimits: number;
  let limitsNote: string;
  if ((backend as { isWebGLBackend?: boolean }).isWebGLBackend === true) {
    const gl = (backend as { gl: WebGL2RenderingContext }).gl;
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    pLimits = webglPageLimit(maxTex, chunkCount);
    limitsNote = `MAX_TEXTURE_SIZE ${maxTex}`;
  } else {
    const device = (backend as { device: { limits: { maxStorageBufferBindingSize: number; maxBufferSize: number } } }).device;
    const lBind = device.limits.maxStorageBufferBindingSize;
    const lBuf = device.limits.maxBufferSize;
    pLimits = Math.floor(Math.min(lBind, lBuf) / (PAGE_SIZE * VEC4_BYTES_PER_SPLAT));
    limitsNote = `bind ${(lBind / 2 ** 20).toFixed(0)} MiB / buf ${(lBuf / 2 ** 20).toFixed(0)} MiB`;
  }
  const pAsset = chunkCount;
  const raw = params.get("pages");
  const override = raw !== null ? Number.parseInt(raw, 10) : null;
  if (override !== null && (!Number.isInteger(override) || override < 1)) {
    throw new Error(`invalid ?pages=${raw}`);
  }
  const pages = Math.min(override ?? Number.MAX_SAFE_INTEGER, pLimits, pAsset);
  const source = override !== null
    ? `override ?pages=${override}${pages < override ? ` clamped to ${pages}` : ""}`
    : pages === pLimits
      ? `device limit (${limitsNote})`
      : `asset (${pAsset} chunks; device allows ${pLimits} — ${limitsNote})`;
  return { pages, source };
}

// ---------------------------------------------------------------------------
// Hero mode (default)
// ---------------------------------------------------------------------------

async function bootHero() {
  // Load the instrument FIRST so its LongTask observer covers boot (task 6).
  if (measure) {
    const { installMeasure } = await import("./src/measure.js");
    installMeasure(
      () => (window as unknown as Record<string, never>).__spike,
      forceWebGL,
      say,
    );
  }

  const renderer = await createRenderer();
  if (measure) renderer.setPixelRatio(1); // doc 05: pin DPR so sizes agree across trials

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f1319);
  // Test pose (borrowed from the loadtest sandbox: 60° fov, (0,0,3) → origin).
  const camera = new THREE.PerspectiveCamera(60, viewSize().w / viewSize().h, 0.01, 1000);
  camera.position.set(0, 0, 3);
  camera.lookAt(0, 0, 0);

  const headerBytes = await RadFetcher.fetchHeader(HERO_URL);
  const header = parseRadHeader(headerBytes);
  if (header.maxSh > 1) throw new Error(`maxSh ${header.maxSh} outside spike scope (hero is 1)`);

  const budget = derivePageBudget(renderer, header.chunks.length);
  const pool = new PagePool(header, budget.pages);

  // Stub geometry: supplies only the SH degree and a caller-maintained
  // boundingSphere; the fork allocates real buffers at {capacity}.
  const stub = new THREE.BufferGeometry();
  stub.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
  stub.setAttribute("covariance", new THREE.BufferAttribute(new Float32Array(6), 6));
  stub.setAttribute("color", new THREE.BufferAttribute(new Uint8Array(4), 4, true));
  if (header.maxSh >= 1) {
    stub.setAttribute("sphericalHarmonics1", new THREE.BufferAttribute(new Uint32Array(3), 3));
  }
  stub.computeBoundingBox();
  stub.computeBoundingSphere();
  stub.boundingSphere!.center.set(0, 0, 0);
  stub.boundingSphere!.radius = 1;

  const mesh = new GaussianSplatMesh(stub, { capacity: pool.capacity });
  // 3DGS .rad data is Y-down. sparkjs-toolkit flips 180° about X, but only on
  // the eulerRotationDeg path (SplatLoader.ts:81-88) — the field's presence arms
  // it, and lab.site.json authors [0,0,0], so this hero flips. Matching that
  // path here; the traversal handles it via worldToObject.
  mesh.rotation.x = Math.PI;
  scene.add(mesh);

  const stats: SpikeStats = {
    backend: forceWebGL ? "webgl2-fallback" : "webgpu",
    progress: 0,
    residentPages: 0,
    selectedCount: 0,
    fullQuality: false,
    partialUploadBroken: false,
    fetch: { requested: 0, landed: 0, bytesLanded: 0 },
    decodedChunks: 0,
    decodeMsTotal: 0,
    uploadMsTotal: 0,
    traverseMsTotal: 0,
    traverseCount: 0,
    firstPixelMs: null,
    fullQualityMs: null,
    pixelScaleHeight: 0,
  };

  // Scene bounds accumulate from decoded centers (drives the sort depth range).
  const boundsMin = [Infinity, Infinity, Infinity];
  const boundsMax = [-Infinity, -Infinity, -Infinity];
  const growBounds = (center: Float32Array, count: number) => {
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < 3; c++) {
        const v = center[i * 3 + c];
        if (v < boundsMin[c]) boundsMin[c] = v;
        if (v > boundsMax[c]) boundsMax[c] = v;
      }
    }
    const sphere = stub.boundingSphere!;
    sphere.center.set(
      (boundsMin[0] + boundsMax[0]) / 2,
      (boundsMin[1] + boundsMax[1]) / 2,
      (boundsMin[2] + boundsMax[2]) / 2,
    );
    sphere.radius = Math.max(0.001, 0.5 * Math.hypot(
      boundsMax[0] - boundsMin[0],
      boundsMax[1] - boundsMin[1],
      boundsMax[2] - boundsMin[2],
    ));
  };

  // --- decode scheduling -----------------------------------------------------
  const worker = new Worker(new URL("./src/rad-worker.ts", import.meta.url), { type: "module" });
  const bytesCache = new Map<number, ArrayBuffer>(); // kept for re-decode after eviction (criterion 7)
  const everDecoded = new Set<number>();
  // Guards only the free-page warm-fill branch of chooseChunk (a refused insert
  // there means the free-slot count raced to zero); the admissibleMissing branch
  // re-excludes non-admittable chunks on every call by itself.
  const refused = new Set<number>(); // cleared when the wanted set changes
  let decodeBusy = false;
  let decodingChunk = -1;
  let needsTraverse = true;
  let lastWantedKey = "";

  const chooseChunk = (): number => {
    for (const c of pool.admissibleMissing()) {
      if (bytesCache.has(c) && !refused.has(c) && c !== decodingChunk) return c;
    }
    if (pool.freePageCount > 0) {
      for (const c of bytesCache.keys()) {
        if (!everDecoded.has(c) && !pool.isResident(c) && c !== decodingChunk) return c;
      }
    }
    return -1;
  };

  const kickDecode = () => {
    if (decodeBusy) return;
    const chunk = chooseChunk();
    if (chunk === -1) return;
    decodeBusy = true;
    decodingChunk = chunk;
    // Zero-copy round trip: transfer the buffer out; the worker transfers the
    // same buffer back in its reply and the cache entry is restored there.
    const bytes = bytesCache.get(chunk)!;
    bytesCache.delete(chunk);
    worker.postMessage({ index: chunk, bytes }, [bytes]);
  };

  worker.onmessage = (ev: MessageEvent<DecodeResult | { index: number; error: string; bytes: ArrayBuffer }>) => {
    decodeBusy = false;
    decodingChunk = -1;
    if ("error" in ev.data) {
      bytesCache.set(ev.data.index, ev.data.bytes); // transferred back — cache restored
      console.error(`decode chunk ${ev.data.index}: ${ev.data.error}`);
      say(`DECODE FAILED chunk ${ev.data.index}\n${ev.data.error}`);
      return;
    }
    const result = ev.data;
    bytesCache.set(result.index, result.bytes); // transferred back — cache restored
    everDecoded.add(result.index);
    stats.decodedChunks = everDecoded.size;
    stats.decodeMsTotal += result.decodeMs;

    // The scheduler keys its maps by fetch-array index; the pool derives the
    // chunk number from the payload's own base. The format permits these to
    // disagree — fail loudly if they ever do (the hero is base-contiguous).
    if (Math.floor(result.base / PAGE_SIZE) !== result.index) {
      say(`CHUNK ORDER MISMATCH: chunks[${result.index}] has base ${result.base}`);
      throw new Error(`chunk index/base mismatch: index ${result.index}, base ${result.base}`);
    }

    const slot = pool.insert(result);
    if (slot === -1) {
      refused.add(result.index);
    } else {
      const t0 = performance.now();
      mesh.uploadPage(slot, result);
      stats.uploadMsTotal += performance.now() - t0;
      needsTraverse = true;
      growBounds(result.center, result.count);
    }
    kickDecode();
    // Hidden pane parks rAF (trap 2) — the loop below never runs there. Keep the
    // pager self-driving so headless probes see converged state.
    if (document.hidden && needsTraverse) {
      needsTraverse = false;
      runTraversal();
    }
  };

  const fetcher = new RadFetcher(HERO_URL, header);
  fetcher.prefetchAll(
    ({ index, bytes }) => {
      bytesCache.set(index, bytes);
      stats.fetch = { requested: fetcher.stats.requested, landed: fetcher.stats.landed, bytesLanded: fetcher.stats.bytesLanded };
      kickDecode();
    },
    (i, e) => {
      console.error(`chunk ${i} fetch failed`, e);
      say(`FETCH FAILED chunk ${i}\n${e}`);
    },
  );

  // --- traversal + render loop ----------------------------------------------
  const worldToObject = new THREE.Matrix4();
  const camToObject = new THREE.Matrix4();
  const lastCamera = new THREE.Matrix4().makeScale(0, 0, 0); // never equal on frame 1

  const rendererSize = new THREE.Vector2();
  const runTraversal = () => {
    // The render loop calls this BEFORE renderer.render — which is what updates
    // a parentless camera's matrixWorld — so fold in the current pose explicitly
    // or frame 1 traverses from the identity matrix (origin [0,0,0]).
    camera.updateMatrixWorld();
    mesh.updateWorldMatrix(true, false);
    worldToObject.copy(mesh.matrixWorld).invert();
    camToObject.multiplyMatrices(worldToObject, camera.matrixWorld);
    const e = camToObject.elements;
    const fLen = Math.hypot(e[8], e[9], e[10]) || 1;
    const renderHeight = renderer.getSize(rendererSize).y || FALLBACK_H;
    const cam: CameraParams = {
      origin: [e[12], e[13], e[14]],
      forward: [-e[8] / fLen, -e[9] / fLen, -e[10] / fLen],
      // 2·tan(fovY/2) / renderHeight — world units per pixel at distance 1
      // (formula borrowed from SparkRenderer.ts:1132-1146).
      pixelScaleLimit: (2 * Math.tan((camera.fov * Math.PI) / 360)) / renderHeight,
    };
    stats.pixelScaleHeight = renderHeight;

    const t0 = performance.now();
    const res = pool.traverse(cam);
    stats.traverseMsTotal += performance.now() - t0;
    stats.traverseCount++;

    const wantedKey = res.touchedChunks.join(",");
    if (wantedKey !== lastWantedKey) {
      lastWantedKey = wantedKey;
      refused.clear();
    }

    // pool.insert() invalidates a freshly-populated slot's selection baseline,
    // so changedSlots alone covers uploads — single owner for selection state.
    for (const slot of res.changedSlots) {
      mesh.setSelection(slot, res.selected.subarray(slot * PAGE_SIZE, (slot + 1) * PAGE_SIZE));
    }
    if (res.changedSlots.length > 0) {
      mesh.invalidate(); // nothing updates by itself (H-LOAD criteria 9–10)
    }

    stats.selectedCount = res.selectedCount;
    stats.residentPages = pool.residentPageCount;
    stats.progress = pool.progress;
    stats.fullQuality = res.fullQuality;
    if (res.fullQuality && res.selectedCount > 0 && stats.fullQualityMs === null) {
      stats.fullQualityMs = performance.now();
    }
    kickDecode();
  };

  let frames = 0;
  renderer.setAnimationLoop(() => {
    if (needsTraverse || !camera.matrixWorld.equals(lastCamera)) {
      needsTraverse = false;
      lastCamera.copy(camera.matrixWorld);
      runTraversal();
    }
    renderer.render(scene, camera);
    frames++;

    const m = (window as unknown as { __measure?: { tick(): void } }).__measure;
    if (m) m.tick();

    // Partial-upload health comes from the fork's accumulation watchdog
    // (race-free); the deterministic assertPartialUploadConsumed() is for
    // controlled probe sequences only.
    stats.partialUploadBroken = mesh.partialUploadBroken;

    if (stats.firstPixelMs === null && stats.selectedCount > 0) {
      stats.firstPixelMs = performance.now();
    }

    if (frames % 15 === 0) {
      say(
        `native-rad spike — hero stage\n` +
        `backend:   ${stats.backend}\n` +
        `fetched:   ${stats.fetch.landed}/${header.chunks.length} chunks (${(stats.fetch.bytesLanded / 1e6).toFixed(1)} MB)\n` +
        `decoded:   ${stats.decodedChunks} chunks (${stats.decodeMsTotal.toFixed(0)} ms worker total)\n` +
        `pool:      ${stats.residentPages}/${pool.pageCount} pages [${budget.source}] · progress ${(stats.progress * 100).toFixed(1)}%\n` +
        `selected:  ${stats.selectedCount.toLocaleString()} splats${stats.fullQuality ? " (full quality)" : ""}\n` +
        `partial upload: ${stats.partialUploadBroken ? "BROKEN → full-buffer fallback" : "ok"}`,
      );
    }
  });

  addEventListener("resize", () => {
    const { w, h } = viewSize();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    needsTraverse = true; // pixelScaleLimit depends on render height
  });

  installProbe(renderer, scene, camera, mesh, {
    pool,
    header,
    fetcher,
    stats: () => stats,
    traverseNow: () => runTraversal(),
    isDecodeBusy: () => decodeBusy,
  });
}

// ---------------------------------------------------------------------------
// Synthetic smoke mode (?synthetic=1) — task-2 scene through the fork's
// non-capacity path (fork-off identity sanity).
// ---------------------------------------------------------------------------

async function bootSynthetic() {
  const renderer = await createRenderer();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f1319);
  const camera = new THREE.PerspectiveCamera(60, viewSize().w / viewSize().h, 0.02, 1000);
  camera.position.set(0, 0, 4);

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
      say(
        `native-rad spike — synthetic smoke (fork, non-capacity path)\n` +
        `backend: ${forceWebGL ? "WebGL2 fallback" : "WebGPU"}\n` +
        `splats:  ${N.toLocaleString()} synthetic\n` +
        `frames:  ${frames} (${((frames * 1000) / (performance.now() - t0)).toFixed(0)} fps avg)`,
      );
    }
  });

  addEventListener("resize", () => {
    const { w, h } = viewSize();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });

  installProbe(renderer, scene, camera, splats, {});
}

(synthetic ? bootSynthetic() : bootHero()).catch((e) => {
  say(`BOOT FAILED\n${e?.message ?? e}\n\n(see console)`);
  console.error(e);
});
