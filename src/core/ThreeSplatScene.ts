/**
 * ThreeSplatScene — the scene facade that replaces SparkScene for this
 * toolkit (doc 02 module map; ticket 03).
 *
 * Phase 1 scope: a plain three.js mesh scene on WebGPU AND the forceWebGL
 * fallback — no splat code, no pager code (that is Phase 2, through the
 * SplatBackend seam). The constructor is SYNCHRONOUS (sync-facade pattern,
 * doc 04 Phase 1 item 3): WebGPURenderer.init() is async, so construction
 * exposes `ready` — rendering starts only after it resolves, and consumers
 * that need a live frame await it.
 *
 * SparkScene-shaped by mandate (read as reference, never modified —
 * ticket 03 AC 2). The complete parity/divergence inventory is DECLARED in
 * ticket 03's Comments (.scratch/phase-1-foundation/issues/
 * 03-three-splat-scene.md) — the single home; this header does not
 * re-enumerate it (rail-fixture convention, ticket 04).
 */

import * as THREE from "three/webgpu";
// Side-effect import: opts the app into the toolkit's sRGB working space
// before any Color IN THIS MODULE (or in importers) is constructed. Honest
// ordering note: three's own module graph necessarily evaluates first —
// colorSpace.ts itself imports from three — but three constructs only
// unconverted default Colors at module scope, so the write still precedes
// every conversion that matters. See colorSpace.ts for the full contract.
import "./colorSpace";

export interface ThreeSplatSceneConfig {
  /** Container element to mount the canvas into (default: document.body) */
  container?: HTMLElement;
  /** Camera field of view in degrees (default: 60) */
  fov?: number;
  /** Camera near clip plane (default: 0.1) */
  near?: number;
  /** Camera far clip plane (default: 1000) */
  far?: number;
  /** Initial camera position (default: [0, 0, 5]) */
  cameraPosition?: [number, number, number];
  /** Background color — null for transparent (default: null) */
  background?: THREE.ColorRepresentation | null;
  /** Explicit pixel ratio override; null = auto-cap, matching SparkScene's
   *  contract (default: device-capped) */
  pixelRatio?: number | null;
  /** Mobile pixel-ratio cap (default: 1.5, SparkScene's choice) */
  mobilePixelRatioCap?: number;
  /** Desktop pixel-ratio cap (default: 2.0, SparkScene's choice) */
  desktopPixelRatioCap?: number;
  /** Force the WebGL2 fallback backend (default: false = WebGPU) */
  forceWebGL?: boolean;
  /** Per-frame callback, before render: (timeSeconds, deltaSeconds) */
  onFrame?: (time: number, deltaTime: number) => void;
}

export class ThreeSplatScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGPURenderer;
  readonly canvas: HTMLCanvasElement;
  // Timer, not SparkScene's Clock — Clock is deprecated in 0.185 (warns on
  // every load); declared divergence, ticket 03 Comments.
  readonly clock: THREE.Timer;
  readonly isMobile: boolean;
  /** Resolves when the renderer backend is initialized and the first frame
   *  has been rendered. Rejects if backend init fails (no WebGPU and the
   *  WebGL2 fallback also unavailable). */
  readonly ready: Promise<void>;
  private _backend: "webgpu" | "webgl2-fallback" | null = null;
  /** Which backend actually initialized — null until `ready` resolves
   *  (readonly to consumers; await `ready` before branching on it). */
  get backend(): "webgpu" | "webgl2-fallback" | null {
    return this._backend;
  }

  /** When set, replaces the default `renderer.render` call each frame —
   *  SparkScene's contract verbatim (SparkScene.ts:113/:299; owner-approved
   *  Option A, ticket 10). ASSIGNMENT is last-writer-wins (as upstream);
   *  only the CLEAR side is guarded — SceneGrade clears it on disable only
   *  if it still owns it. */
  renderOverride: (() => void) | null = null;

  private container: HTMLElement;
  private onFrameCallback?: (time: number, deltaTime: number) => void;
  private resizeObserver: ResizeObserver;
  private disposed = false;

  constructor(config: ThreeSplatSceneConfig = {}) {
    const {
      container = document.body,
      fov = 60,
      near = 0.1,
      far = 1000,
      cameraPosition = [0, 0, 5],
      background = null,
      pixelRatio,
      mobilePixelRatioCap = 1.5,
      desktopPixelRatioCap = 2.0,
      forceWebGL = false,
      onFrame,
    } = config;

    this.container = container;
    this.onFrameCallback = onFrame;
    this.clock = new THREE.Timer();
    // Without connect(), Timer does NOT zero its delta across page-hidden
    // gaps (rAF pauses while hidden; the first delta after tab-return would
    // be the whole hidden duration — the init-spike bug's sibling).
    this.clock.connect(document);
    this.isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    this.scene = new THREE.Scene();
    if (background !== null) {
      this.scene.background = new THREE.Color(background);
    }

    // Guarded, not `w / h || 1`: width>0 with height 0 yields Infinity,
    // which is truthy and survives `|| 1` (the rail-fixture lesson —
    // applySize below can then never repair the degenerate matrix).
    const w = container.clientWidth;
    const h = container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(
      fov,
      w > 0 && h > 0 ? w / h : 1,
      near,
      far,
    );
    this.camera.position.set(...cameraPosition);

    const effectivePixelRatio =
      pixelRatio ??
      Math.min(
        window.devicePixelRatio,
        this.isMobile ? mobilePixelRatioCap : desktopPixelRatioCap,
      );

    // WebGPURenderer covers both backends: WebGPU, or its WebGL2 fallback
    // when forced/unavailable. antialias:false mirrors SparkScene ("critical
    // for splat performance"); alpha mirrors its transparent-background rule.
    this.renderer = new THREE.WebGPURenderer({
      antialias: false,
      alpha: background === null,
      forceWebGL,
    });
    this.renderer.setPixelRatio(effectivePixelRatio);
    this.canvas = this.renderer.domElement;
    this.canvas.style.display = "block";
    this.canvas.style.touchAction = "none";
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    container.appendChild(this.canvas);

    // Sizing: zero-guarded immediate seed + ResizeObserver authority
    // (ticket 04 rail-fixture lesson; SparkScene.ts:233 uses RO alone).
    const applySize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return;
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
    };
    this.resizeObserver = new ResizeObserver(applySize);
    this.resizeObserver.observe(container);
    applySize();

    // Async backend init behind the sync facade.
    this.ready = this.renderer.init().then(async () => {
      // dispose() may legally run before init settles — never start
      // rendering into a torn-down scene (review finding: the continuation
      // vs dispose ordering was luck, not design).
      if (this.disposed) return;
      // three's own runtime discriminant (three.webgpu.js checks
      // `backend.isWebGPUBackend === true`); the base Backend type lacks it.
      const backend = this.renderer.backend as { isWebGPUBackend?: boolean };
      this._backend = backend.isWebGPUBackend === true
        ? "webgpu"
        : "webgl2-fallback";
      // Reset the delta origin: without this, the first onFrame delta is
      // the entire backend-init duration (review finding — SparkScene's
      // Clock auto-started at ~0; a delta-driven consumer would integrate
      // one giant step). getElapsed() still counts from construction —
      // continuous time, harmless for time uniforms; declared in ticket 03.
      this.clock.update();
      // First frame rendered before `ready` resolves — consumers awaiting
      // ready get a live canvas, mirroring SparkScene's forced first render.
      // Plain render(): after await init() this is the sanctioned call
      // (renderAsync is deprecated in 0.185 for exactly this pattern).
      // Honor renderOverride here too: SparkScene's forced render could not
      // race an override (sync init — the constructor returns before any
      // consumer can assign one), but our async init means an override set
      // before `ready` is live NOW, and the first frame must reflect it
      // (adversarial-review finding, 2026-08-21).
      if (this.renderOverride) this.renderOverride();
      else this.renderer.render(this.scene, this.camera);
      this.renderer.setAnimationLoop((timeMs) => this.animate(timeMs));
    });
    // Keep init failure observable on `ready` for consumers who await it,
    // without the browser firing unhandledrejection for consumers who —
    // legally, given the sync facade — never touch it.
    this.ready.catch(() => {});
  }

  /** Set or clear (null) the per-frame callback — SparkScene's contract. */
  setOnFrame(cb: ((time: number, deltaTime: number) => void) | null): void {
    this.onFrameCallback = cb ?? undefined;
  }

  private animate(timeMs: number): void {
    this.clock.update();
    const deltaTime = this.clock.getDelta();
    this.onFrameCallback?.(timeMs / 1000, deltaTime);
    // Docked-idle throttle: skip only the RENDER — the state callback above
    // already ran (SparkScene.animate's order, pin SparkScene.ts:279-300).
    if (this.throttleGate && this.throttleGate(timeMs)) {
      this._throttled = true;
      return;
    }
    this._throttled = false;
    this._renderCount++;
    if (this.renderOverride) this.renderOverride();
    else this.renderer.render(this.scene, this.camera);
  }

  // ─── Docked-idle render throttle (SparkScene's contract, carried by Phase 2
  //     ticket 09 Stop 4f; doc 06 D29) ───

  /** Consulted per frame; return true to SKIP this frame's render (state
   *  callbacks above have already run). Absent → never throttled. */
  throttleGate: ((timeMs: number) => boolean) | null = null;
  private _renderCount = 0;
  private _throttled = false;

  /** Frames actually rendered by the animation loop — how a fixture measures
   *  renders per second instead of eyeballing. */
  get renderCount(): number {
    return this._renderCount;
  }

  /** True while the docked-idle throttle skipped the latest frame. */
  get throttled(): boolean {
    return this._throttled;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // setAnimationLoop is async in three's WebGPU renderer (it awaits init
    // when uninitialized) — swallow a failed-init rejection here the same
    // way the constructor's ready tail does, or disposing after a failed
    // init fires unhandledrejection (review finding).
    void Promise.resolve(this.renderer.setAnimationLoop(null)).catch(
      () => {},
    );
    this.resizeObserver.disconnect();
    this.clock.disconnect();
    this.onFrameCallback = undefined;
    this.canvas.remove();
    // three's Renderer.dispose() frees nothing while uninitialized (its
    // internals sit behind an `_initialized === true` guard), so teardown
    // waits for init to settle — `ready` always settles, an already-settled
    // promise runs this on the next microtask, and the continuation above
    // early-returns on `disposed`, so nothing renders in between (review
    // finding; one call site, so future teardown edits can't miss a branch).
    // After a FAILED init it must not run at all: dispose() still ends with
    // setAnimationLoop(null), which is async and awaits init() again — the
    // stored rejected promise — unobserved, firing unhandledrejection; a
    // failed init also left nothing to free (ticket 09 review finding 2).
    void this.ready.then(
      () => this.renderer.dispose(),
      () => {},
    );
  }
}
