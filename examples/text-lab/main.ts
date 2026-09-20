/**
 * Text Lab — ADAPTED from sparkjs-toolkit examples/text-lab/main.ts at pin
 * fd67153 (ticket 05; examples/ fixtures are adaptations by design — owner
 * ruling at ticket 04; R5 byte-identity binds the src/ COPY files only).
 *
 * The complete strip/add inventory lives in ticket 05's Comments
 * (.scratch/phase-1-foundation/issues/05-text-and-markers-cluster.md) — the
 * single home for this fixture's declared divergences (Phase 2 ticket 11's
 * obstacle swap is recorded there too, dated). In brief: SparkScene →
 * ThreeSplatScene; the obstacle loads through loadSplat + computeSplatBounds
 * on the SplatBackend seam, from moss.ply — the pin's own scene in its closest
 * loadable form (the pin's moss.spz is refused here — SPZ waits for r186);
 * the splat-text bench catches the D19 stub's constructor throw and displays
 * it LOUDLY (the splat text path is rebuilt in Phase 4, doc 03 §E).
 *
 * Sections (from the original):
 *  1. Font-parity bench — Pretext wrapLines vs native DOM wrap. UNCHANGED.
 *  2. Splat Text Bench — SplatTextMesh is the D19 stub: boot catches the
 *     throw and shows the stub error in the bench status. Fails loudly.
 *  3. Editorial Obstacle View — two Pretext columns flow around a live
 *     projected splat obstacle, framed once at reveal as the pin does.
 */

import * as THREE from "three";
import {
  DEFAULT_FONT_STACK,
  getPrepared,
  wrapLines,
  measureTextHeight,
  whenFontsReady,
} from "@toolkit/ui/TextLayout";
import { SplatTextMesh } from "@toolkit/ui/SplatTextMesh";
import {
  LinePool,
  layoutObstacleColumn,
  projectBox3ToScreen,
  START_CURSOR,
} from "@toolkit/ui/ObstacleLayout";
import { ThreeSplatScene } from "@toolkit/core/ThreeSplatScene";
import { CameraSystem } from "@toolkit/core/CameraSystem";
import { loadSplat } from "@toolkit/core/SplatLoader";
import { computeSplatBounds } from "@toolkit/core/SplatBounds";
import { ThreeGsBackend } from "@toolkit/backend/ThreeGsBackend";
import { createDecodeWorker } from "@toolkit/backend/decode-url";

// Backend toggle, matching the repo's fixture pattern (examples/scene,
// examples/grade): ?webgl=1 forces the WebGL2 fallback on both scenes.
const forceWebGL = new URLSearchParams(location.search).get("webgl") === "1";

const COPY =
  "Photogrammetry turns thousands of overlapping photographs into a single spatial memory — " +
  "a Gaussian splat scene you can orbit in a browser. \"Accuracy,\" though, isn't optional: " +
  "captions beside these scenes must wrap identically everywhere, punctuation included; even " +
  "absurdly-long specimens like supercalifragilisticexpialidocious must break the same way.";

// ─── Elements ─────────────────────────────────────────────

const widthInput = document.getElementById("width") as HTMLInputElement;
const widthVal = document.getElementById("widthVal") as HTMLSpanElement;
const lineHeightInput = document.getElementById("lineHeight") as HTMLInputElement;
const fontInput = document.getElementById("font") as HTMLInputElement;
const overlayToggle = document.getElementById("overlay") as HTMLInputElement;
const status = document.getElementById("status") as HTMLDivElement;
const panels = document.getElementById("panels") as HTMLDivElement;
const domHost = document.getElementById("domHost") as HTMLDivElement;
const domText = document.getElementById("domText") as HTMLParagraphElement;
const ptxPanel = document.getElementById("ptxPanel") as HTMLDivElement;
const ptxHost = document.getElementById("ptxHost") as HTMLDivElement;

// ─── Render ───────────────────────────────────────────────

function clearOverlayLines(): void {
  for (const el of Array.from(domHost.querySelectorAll(".ptx-abs"))) {
    el.remove();
  }
}

function render(): void {
  const width = parseInt(widthInput.value, 10);
  const lineHeightPx = parseInt(lineHeightInput.value, 10) || 24;
  const font = fontInput.value;
  widthVal.textContent = `${width}px`;

  let lines: string[];
  let height: number;
  try {
    lines = wrapLines(COPY, font, width);
    height = measureTextHeight(COPY, font, width, lineHeightPx);
  } catch (err) {
    status.textContent = err instanceof Error ? err.message : String(err);
    status.classList.add("error");
    return;
  }
  status.classList.remove("error");
  status.textContent = `${lines.length} lines · block height ${height}px`;

  // DOM panel — native wrap at the same width/font/line-height
  domText.style.width = `${width}px`;
  domText.style.font = font;
  domText.style.lineHeight = `${lineHeightPx}px`;
  domText.textContent = COPY;

  // Pretext lines
  clearOverlayLines();
  ptxHost.innerHTML = "";

  if (overlayToggle.checked) {
    panels.classList.add("overlay-mode");
    ptxPanel.style.display = "none";
    for (let i = 0; i < lines.length; i++) {
      const div = document.createElement("div");
      div.className = "ptx-abs";
      div.textContent = lines[i];
      div.style.font = font;
      div.style.lineHeight = `${lineHeightPx}px`;
      div.style.top = `${i * lineHeightPx}px`;
      domHost.appendChild(div);
    }
  } else {
    panels.classList.remove("overlay-mode");
    ptxPanel.style.display = "";
    ptxHost.style.width = `${width}px`;
    for (const line of lines) {
      const div = document.createElement("div");
      div.className = "ptx-line";
      div.textContent = line;
      div.style.font = font;
      div.style.lineHeight = `${lineHeightPx}px`;
      div.style.height = `${lineHeightPx}px`;
      ptxHost.appendChild(div);
    }
  }
}

// ─── Splat Text Bench (D19 stub in Phases 1–3) ────────────
//
// The original bench superimposes a DOM copy over splat text at the parity
// camera distance. SplatTextMesh is the D19 stub here — its constructor
// throws — so bootBench catches that throw, shows it in the bench status,
// and the rest of the fixture keeps running. The calibration tables from
// the original header comment live with the original; they re-enter with
// the Phase 4 rebuild.

const stText = document.getElementById("stText") as HTMLInputElement;
const stFontSize = document.getElementById("stFontSize") as HTMLInputElement;
const stWidth = document.getElementById("stWidth") as HTMLInputElement;
const stWidthVal = document.getElementById("stWidthVal") as HTMLSpanElement;
const stLhw = document.getElementById("stLhw") as HTMLInputElement;
const stLhwVal = document.getElementById("stLhwVal") as HTMLSpanElement;
const stDist = document.getElementById("stDist") as HTMLInputElement;
const stDistVal = document.getElementById("stDistVal") as HTMLSpanElement;
const stBillboard = document.getElementById("stBillboard") as HTMLSelectElement;
const stColor = document.getElementById("stColor") as HTMLInputElement;
const stWeightPrefix = document.getElementById("stWeightPrefix") as HTMLInputElement;
const stOverlay = document.getElementById("stOverlay") as HTMLInputElement;
const stParityCam = document.getElementById("stParityCam") as HTMLButtonElement;
const stStatus = document.getElementById("stStatus") as HTMLDivElement;
const stViewport = document.getElementById("stViewport") as HTMLDivElement;
const stOverlayBlock = document.getElementById("stOverlayBlock") as HTMLDivElement;

const BENCH_FOV = 50;

interface Bench {
  splatScene: ThreeSplatScene;
  cameraSystem: CameraSystem;
  splatText: SplatTextMesh | null;
}
const bench: Bench = { splatScene: null!, cameraSystem: null!, splatText: null };

function benchLineHeightPx(): number {
  return 1.2 * parseInt(stFontSize.value, 10);
}

/** Camera distance where 1 raster px maps to exactly 1 CSS px on screen. */
function parityDistance(): number {
  const objectScale = parseFloat(stLhw.value) / benchLineHeightPx();
  const viewportH = stViewport.clientHeight;
  return (viewportH * objectScale) / (2 * Math.tan((BENCH_FOV / 2) * (Math.PI / 180)));
}

/** (Re)create the SplatTextMesh — the D19 stub throws here, LOUDLY. */
function recreateSplatText(): void {
  if (bench.splatText) {
    bench.splatScene.scene.remove(bench.splatText.object);
    bench.splatText.dispose();
  }
  const font = (stWeightPrefix.checked ? "700 " : "") + DEFAULT_FONT_STACK;
  try {
    bench.splatText = new SplatTextMesh({
      text: stText.value,
      font,
      fontSize: parseInt(stFontSize.value, 10),
      maxWidthPx: parseInt(stWidth.value, 10),
      lineHeightPx: benchLineHeightPx(),
      lineHeightWorld: parseFloat(stLhw.value),
      color: new THREE.Color(stColor.value),
      textAlign: "center",
      billboard: stBillboard.value as "full" | "y" | "none",
    });
  } catch (err) {
    bench.splatText = null;
    const message = err instanceof Error ? err.message : String(err);
    stStatus.textContent = message;
    stStatus.classList.add("error");
    console.error("[text-lab] splat text bench unavailable:", err);
    syncOverlayBlock();
    return;
  }
  stStatus.classList.remove("error");
  bench.splatScene.scene.add(bench.splatText.object);
  void bench.splatText.ready().then(updateBenchStatus);
  syncOverlayBlock();
}

function syncOverlayBlock(): void {
  const fontSize = parseInt(stFontSize.value, 10);
  stOverlayBlock.style.display = stOverlay.checked ? "block" : "none";
  stOverlayBlock.style.width = `${parseInt(stWidth.value, 10)}px`;
  stOverlayBlock.style.font = `${fontSize}px ${DEFAULT_FONT_STACK}`;
  stOverlayBlock.style.lineHeight = `${benchLineHeightPx()}px`;
  stOverlayBlock.style.textAlign = "center";
  stOverlayBlock.textContent = stText.value;
}

function updateBenchStatus(): void {
  const st = bench.splatText;
  if (!st) return;
  stStatus.textContent =
    `splats: ${st.splatCount.toLocaleString()} · builds: ${st.buildCount} · ` +
    `parity distance: ${parityDistance().toFixed(2)}`;
}

function snapCamera(distance: number): void {
  bench.cameraSystem.setState({ yaw: 0, pitch: 0, distance, pivot: { x: 0, y: 0, z: 0 } });
  stDist.value = distance.toFixed(1);
  stDistVal.textContent = distance.toFixed(1);
}

function bootBench(): void {
  bench.splatScene = new ThreeSplatScene({
    container: stViewport,
    fov: BENCH_FOV,
    cameraPosition: [0, 0, 2],
    background: 0x0c0c10,
    forceWebGL,
  });
  // Backend-init outcome must be LOUD (sibling-fixture pattern) — the
  // facade's ready swallows its own rejection by design.
  bench.splatScene.ready
    .then(() => console.log(`[text-lab] bench ready, backend: ${bench.splatScene.backend}`))
    .catch((err) => {
      stStatus.textContent = `INIT FAILED: ${err}`;
      stStatus.classList.add("error");
      console.error("[text-lab] bench init failed", err);
    });
  bench.cameraSystem = new CameraSystem({
    camera: bench.splatScene.camera,
    canvas: bench.splatScene.canvas,
    scene: bench.splatScene.scene,
    renderer: bench.splatScene.renderer,
    minDistance: 0.2,
    maxDistance: 30,
  });
  recreateSplatText();
  snapCamera(parityDistance());

  bench.splatScene.setOnFrame((_time, deltaTime) => {
    bench.cameraSystem.update(deltaTime);
    bench.splatText?.update(bench.splatScene.camera);
  });

  // Live-updatable without rebuild-by-recreation
  stText.addEventListener("change", () => {
    bench.splatText?.setText(stText.value);
    syncOverlayBlock();
    updateBenchStatus();
  });
  stWidth.addEventListener("input", () => {
    stWidthVal.textContent = `${stWidth.value}px`;
    bench.splatText?.setMaxWidth(parseInt(stWidth.value, 10));
    syncOverlayBlock();
    updateBenchStatus();
  });
  stColor.addEventListener("input", () => {
    bench.splatText?.setColor(new THREE.Color(stColor.value));
    updateBenchStatus(); // builds counter must NOT move on retint
  });
  // Baked at build time — recreate
  for (const el of [stFontSize, stLhw, stBillboard, stWeightPrefix]) {
    el.addEventListener("change", () => {
      stLhwVal.textContent = parseFloat(stLhw.value).toFixed(2);
      recreateSplatText();
      updateBenchStatus();
    });
  }
  stDist.addEventListener("input", () => {
    stDistVal.textContent = parseFloat(stDist.value).toFixed(1);
    snapCamera(parseFloat(stDist.value));
  });
  stParityCam.addEventListener("click", () => snapCamera(parityDistance()));
  stOverlay.addEventListener("change", syncOverlayBlock);

  // Dev hook for driving the bench from the console / automation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dev-only sandbox hook
  (window as any).__textLab = {
    bench,
    parityDistance,
    recreateSplatText,
    get splatText() {
      return bench.splatText;
    },
  };
}

// ─── Editorial Obstacle View ──────────────────────────────
//
// Two Pretext columns flow over a live splat viewport. Per frame: project
// the splat's Box3 (computeSplatBounds, taken once at reveal) to a screen
// rect, carve each line band around it, place one layoutNextLine result per
// band, and let LinePool.commit diff against the previous frame (ADR-7:
// compute always, commit on change — idle frames cost zero DOM writes).

const OB_COPY =
  "A photogrammetric capture starts as pure excess: thousands of photographs, most of them " +
  "nearly identical, taken by walking slowly around a subject that never asked to be measured. " +
  "Structure-from-motion reads that redundancy the way a surveyor reads a horizon, triangulating " +
  "camera poses from whatever features survive between frames. What emerges is not yet a scene — " +
  "just a sparse constellation of points and the cameras that agree on them. Gaussian splatting " +
  "turns that constellation into something the eye accepts: millions of soft, oriented ellipsoids, " +
  "each one a small opinion about color and light, blended until the opinions become a room. The " +
  "result renders in a browser at interactive rates, which changes what a website can be. A page " +
  "no longer needs a hero image when it can hold the place itself. But places make demanding " +
  "neighbors for typography. Text laid over a live scene has to negotiate with it — the scene " +
  "moves, the text must yield, and the yielding has to happen every frame without the layout " +
  "engine asking the DOM what size anything is. That is the entire trick of this page: the " +
  "paragraph you are reading is not wrapped by the browser. Each line was measured from cached " +
  "glyph widths, carved around the projected silhouette of the splat scene beside it, and placed " +
  "as an absolutely positioned span. Orbit the scene and the silhouette shifts; the lines re-route " +
  "around the new shape while the words keep their order. Nothing here is exotic on its own — " +
  "interval subtraction is textbook geometry, and projecting a bounding box costs almost nothing. " +
  "What is new is the contract: the three-dimensional scene participates in editorial layout as a " +
  "first-class typographic obstacle, the way a pull quote or an inset photograph would in print. " +
  "A capture stops being an embedded viewer and becomes part of the page's grammar, something the " +
  "copy flows around because the copy knows exactly where it is.";

const OB_FONT = `15px ${DEFAULT_FONT_STACK}`;
const OB_LINE = 22;
const OB_MARGIN = 24;
const OB_GAP = 32;
// Phase 2 ticket 11, ruling S7 (superseding S3-(b)): the pin's
// "/examples/assets/moss.spz" is refused here (SPZ waits for r186 — doc 06
// watch item 13), so the obstacle is the SAME SCENE as a PLY, served
// read-only through /@fs like the labs' assets. NOT the paged hero: its exact
// bounds are floater-dominated — the outermost centres set 94 % of the box —
// so framing on them means nothing until Phase 4's percentile clamping
// (doc 04, measured in ticket 11). The paged consumer proof lives in
// examples/counters-lab/.
const OB_SPLAT_URL = "/@fs/D:/Projects/sparkjs-toolkit/examples/assets/moss.ply";

function bootObstacle(): void {
  const region = document.getElementById("obRegion") as HTMLDivElement;
  const canvasHost = document.getElementById("obCanvasHost") as HTMLDivElement;
  const textHost = document.getElementById("obTextHost") as HTMLDivElement;
  const srCopy = document.getElementById("obSrCopy") as HTMLParagraphElement;
  const boundsToggle = document.getElementById("obBounds") as HTMLInputElement;
  const obStatus = document.getElementById("obStatus") as HTMLSpanElement;

  srCopy.textContent = OB_COPY;
  const prepared = getPrepared(OB_COPY, OB_FONT);
  const pool = new LinePool(textHost, { font: OB_FONT, lineHeightPx: OB_LINE });

  const obScene = new ThreeSplatScene({
    container: canvasHost,
    fov: 55,
    cameraPosition: [0, 0, 4],
    background: 0x0c0c10,
    forceWebGL,
  });
  obScene.ready
    .then(() => console.log(`[text-lab] obstacle ready, backend: ${obScene.backend}`))
    .catch((err) => {
      obStatus.textContent = `INIT FAILED: ${err}`;
      console.error("[text-lab] obstacle init failed", err);
    });
  const obCamera = new CameraSystem({
    camera: obScene.camera,
    canvas: obScene.canvas,
    scene: obScene.scene,
    renderer: obScene.renderer,
    minDistance: 0.05,
    maxDistance: 50,
  });

  let regionW = region.clientWidth;
  let regionH = region.clientHeight;
  new ResizeObserver((entries) => {
    const rect = entries[entries.length - 1]?.contentRect;
    if (rect) {
      regionW = rect.width;
      regionH = rect.height;
    }
  }).observe(region);

  let bounds: THREE.Box3 | null = null;
  let helper: THREE.Box3Helper | null = null;
  let loadFailure: string | null = null;

  // The seam instance that loads and owns the obstacle (doc 06 D25); a paged
  // .rad needs the renderer and a decode-worker factory.
  const backend = new ThreeGsBackend({ renderer: obScene.renderer, createDecodeWorker });
  const handle = loadSplat({
    url: OB_SPLAT_URL,
    backend,
    extSplats: true,
    quaternion: [1, 0, 0, 0], // OpenCV → OpenGL coord flip — exactly the loader's 180° X flip
    onLoad: (loaded) => {
      bounds = computeSplatBounds(backend, loaded);
      if (bounds) {
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        obCamera.setState({
          yaw: 30,
          pitch: 12,
          distance: size.length(),
          pivot: { x: center.x, y: center.y, z: center.z },
        });
      }
    },
    // Loud-not-fatal, like the scene's init failure above: a failed load
    // would otherwise read as the pin's "none (fallback)" layout.
    onError: (error) => {
      loadFailure = error.reason;
      console.error("[text-lab] obstacle load failed", error);
    },
  });
  obScene.scene.add(handle.object);

  boundsToggle.addEventListener("change", () => {
    if (boundsToggle.checked && bounds && !helper) {
      helper = new THREE.Box3Helper(bounds, 0x4ade80);
      obScene.scene.add(helper);
    } else if (!boundsToggle.checked && helper) {
      obScene.scene.remove(helper);
      helper = null;
    }
  });

  // Rolling commit-rate telemetry (ADR-7 verification)
  let frames = 0;
  let commits = 0;
  let lastObstacle = false;
  const stats = { commitsPerWindow: 0, lines: 0 };

  obScene.setOnFrame((_time, deltaTime) => {
    obCamera.update(deltaTime);

    const rect = bounds
      ? projectBox3ToScreen(bounds, obScene.camera, regionW, regionH)
      : null;
    const obstacles = rect ? [rect] : [];
    lastObstacle = rect !== null;

    const colW = (regionW - 2 * OB_MARGIN - OB_GAP) / 2;
    const usableH = regionH - 2 * OB_MARGIN;
    const left = layoutObstacleColumn(
      prepared,
      START_CURSOR,
      { x: OB_MARGIN, y: OB_MARGIN, width: colW, height: usableH },
      OB_LINE,
      obstacles,
    );
    const right = layoutObstacleColumn(
      prepared,
      left.cursor,
      { x: OB_MARGIN + colW + OB_GAP, y: OB_MARGIN, width: colW, height: usableH },
      OB_LINE,
      obstacles,
    );
    const allLines = left.lines.concat(right.lines);
    if (pool.commit(allLines)) commits++;
    frames++;
    stats.lines = allLines.length;

    if (frames >= 60) {
      stats.commitsPerWindow = commits;
      obStatus.textContent =
        `commits: ${commits}/60 frames · lines: ${allLines.length} · ` +
        `obstacle: ${lastObstacle ? "projected" : loadFailure ? `LOAD FAILED (${loadFailure})` : "none (fallback)"}`;
      frames = 0;
      commits = 0;
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dev-only sandbox hook
  ((window as any).__textLab ??= {}).obstacle = {
    obScene,
    obCamera,
    pool,
    stats,
    copy: OB_COPY,
    // The seam pair, so a check can call computeSplatBounds(backend, handle)
    // itself (ticket 11's pass criterion); `mesh` is the renderable, as at the pin.
    backend,
    handle,
    get bounds() {
      return bounds;
    },
    get mesh() {
      return handle.object;
    },
  };
}

// ─── Boot ─────────────────────────────────────────────────

void (async () => {
  fontInput.value = `16px ${DEFAULT_FONT_STACK}`;
  status.textContent = "Loading fonts…";
  // Explicitly request the faces — webfonts load lazily on first use, so a bare
  // fonts.ready await resolves before DM Sans is even fetched (verified: stale
  // fallback measurements get cached; see plan doc R1).
  await whenFontsReady(fontInput.value);
  render();

  widthInput.addEventListener("input", render);
  lineHeightInput.addEventListener("input", render);
  fontInput.addEventListener("change", render);
  overlayToggle.addEventListener("change", render);

  bootBench();
  bootObstacle();
})();
