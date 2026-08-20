/**
 * CameraSystem — Advanced camera controls for SparkJS Toolkit
 *
 * Wraps Three.js OrbitControls with:
 * - Double-click to re-orbit (WASM splat raycasting with view-plane fallback)
 * - Smooth animated transitions with configurable easing
 * - Dynamic pitch limits (distance-interpolated angle clamping)
 * - Per-axis input speed multipliers
 * - Camera state readout and clipboard copy
 *
 * Combines the best elements from splatter.app (click-to-orbit),
 * supersplat (smooth transitions, scene-relative distance), and
 * sculpture-website (GPU depth readback, dynamic pitch, recenter animation).
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ─── Types ────────────────────────────────────────────────

export interface CameraState {
  yaw: number;
  pitch: number;
  distance: number;
  pivot: { x: number; y: number; z: number };
}

export interface RecenterConfig {
  enabled: boolean;
  duration: number;
  easing: number;
  distance: number;
  doubleClickMs: number;
}

export interface DynamicPitchConfig {
  enabled: boolean;
  closeDistance: number;
  farDistance: number;
  closePitchMin: number;
  closePitchMax: number;
  farPitchMin: number;
  farPitchMax: number;
}

/** Distance under which a raycast hit is treated as camera-hugging fuzz rather
 *  than scene content. Shared by every picker so they cannot disagree about what
 *  counts as a real hit. */
export const NEAR_PICK_FUZZ = 0.5;

export interface OrbitLimits {
  minDistance: number;
  maxDistance: number;
  minPitch: number;
  maxPitch: number;
  /** Azimuth (yaw) bounds in RADIANS, matching OrbitControls' own units — unlike
   *  the pitch fields above, which are human-readable degrees, because these map
   *  straight onto `minAzimuthAngle`/`maxAzimuthAngle` with no conversion or
   *  inversion. Absent (or ±Infinity) means unrestricted, which is the default. */
  minAzimuth?: number;
  maxAzimuth?: number;
}

export interface InputSpeeds {
  rotateSpeed: number;
  zoomSpeed: number;
  panSpeed: number;
}

export interface KeyboardFlyConfig {
  enabled: boolean;
  /** Movement speed in units/second (default: 5) */
  moveSpeed: number;
  /** Speed multiplier when holding Shift (default: 3) */
  sprintMultiplier: number;
  /**
   * How keyboard fly arms (construction-time — not changeable via setKeyboardFly):
   * - "always": keys are live page-wide (window listener). Right for full-page
   *   sites that own the whole viewport (default; the historical behavior).
   * - "engaged": keys are live only while the canvas has focus — the canvas is
   *   made focusable and click/tap/Tab engages it (the Maps-embed convention).
   *   Right for `<splat-site>` embeds: multiple instances on one page don't
   *   cross-drive, and host-page typing never flies the camera.
   */
  activation: "always" | "engaged";
}

export interface CameraSystemConfig {
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;

  /** SparkRenderer instance — required for GPU depth readback (click-to-orbit) */
  sparkRenderer?: THREE.Mesh;

  // Orbit limits
  minDistance?: number;
  maxDistance?: number;
  minPitch?: number;
  maxPitch?: number;

  // Damping
  enableDamping?: boolean;
  dampingFactor?: number;

  // Input speeds
  rotateSpeed?: number;
  zoomSpeed?: number;
  panSpeed?: number;
  enablePan?: boolean;

  // Recenter
  enableRecenter?: boolean;
  recenterDuration?: number;
  recenterEasing?: number;
  recenterDistance?: number;
  doubleClickMs?: number;

  // Dynamic pitch
  dynamicPitch?: Partial<DynamicPitchConfig>;

  // Keyboard fly (WASD+QE)
  keyboardFly?: Partial<KeyboardFlyConfig>;

  // Initial state
  target?: [number, number, number];
  /** Initial camera from spherical coordinates (yaw/pitch/distance/pivot) — overrides camera position */
  initialState?: CameraState;
  autoRotate?: boolean;
  autoRotateSpeed?: number;
}

// ─── Helpers ──────────────────────────────────────────────

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** The keys updateKeyboardFly reads — the takeover report in the keydown
 *  handler is gated to exactly these, so an unrelated key is never camera
 *  input. Kept beside the constants rather than derived from the fly code so
 *  a new fly key is a two-line change that tsc cannot miss. */
const FLY_KEYS: ReadonlySet<string> = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE"]);

/** Convert pitch in degrees to OrbitControls polar angle in radians */
function pitchToPolar(pitchDeg: number): number {
  return (90 - pitchDeg) * DEG2RAD;
}

/** Wrap a yaw delta into [-180, 180) so tweens always take the short way round
 *  (same formula as CameraRail's). */
function shortestArcDeg(deltaDeg: number): number {
  return ((deltaDeg % 360) + 540) % 360 - 180;
}

/** Cubic ease-in-out: smooth start and end. */
function cubicEaseInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ─── CameraSystem ─────────────────────────────────────────

export class CameraSystem {
  readonly controls: OrbitControls;

  private camera: THREE.PerspectiveCamera;
  private canvas: HTMLCanvasElement;
  private scene: THREE.Scene;
  private disposed = false;

  // Configuration
  recenter: RecenterConfig;
  dynamicPitch: DynamicPitchConfig;

  // Initial state for reset
  private initialTarget: THREE.Vector3;
  private initialCameraPos: THREE.Vector3;

  // Recenter animation state
  private recenterAnim: {
    active: boolean;
    elapsed: number;
    startTarget: THREE.Vector3;
    endTarget: THREE.Vector3;
    startCamPos: THREE.Vector3;
    endCamPos: THREE.Vector3;
  };

  // Frame animation state — a FULL spherical-state tween (yaw/pitch/distance/
  // pivot), unlike recenter's parallel pan. Powers frameTo() (selection framing).
  private frameAnim: {
    active: boolean;
    elapsed: number;
    duration: number;
    startYaw: number;
    endYaw: number;
    startPitch: number;
    endPitch: number;
    startDistance: number;
    endDistance: number;
    startPivot: THREE.Vector3;
    endPivot: THREE.Vector3;
    /** controls.enabled BEFORE the tween disabled it — restored on end, so a
     *  tween finishing mid-gizmo-drag doesn't wrongly re-enable orbit. */
    wasEnabled: boolean;
    /** Fired exactly once when the tween ends: `arrived` is true only when it
     *  ran to completion. A replacement frameTo, a cancel, user input, or a
     *  recenter takeover all report false. Lets a caller CHAIN tweens through
     *  this one funnel (the D31 sequence player) without polling pose deltas
     *  or growing a second animator. */
    onComplete: ((arrived: boolean) => void) | null;
  };

  // Cancels an active frame tween on user input (the user always wins).
  private framePointerDownHandler: () => void;

  /** Told that the visitor just took the camera — see `setUserTakeoverCallback`. */
  private onUserTakeover: (() => void) | null = null;
  private wheelTakeoverHandler: () => void;

  // Double-click handler
  private dblclickHandler: (e: MouseEvent) => void;

  // Keyboard fly state
  keyboardFly: KeyboardFlyConfig;
  private keysDown = new Set<string>();
  /** Master input gate (Plan 25 engagement model). False = the scene is not the
   *  input owner: keys must not fly and a pointerdown must not cancel motion. */
  private inputEnabled = true;
  private keydownHandler: (e: KeyboardEvent) => void;
  private keyupHandler: (e: KeyboardEvent) => void;
  private blurHandler: () => void;
  /** Where key listeners attach: window ("always") or the canvas ("engaged"). */
  private keyEventTarget: Window | HTMLCanvasElement;
  /** The canvas's tabindex ATTRIBUTE before engaged mode set it (null = absent) —
   *  restored on dispose so callers who reuse their canvas get it back untouched. */
  private originalTabIndexAttr: string | null = null;
  /** Whether engaged mode added the accessible name (never overwrite a caller's). */
  private addedAriaLabel = false;
  private _flyForward = new THREE.Vector3();
  private _flyRight = new THREE.Vector3();
  private _flyDelta = new THREE.Vector3();

  // Reusable objects for click-to-reorbit pick
  private _raycaster = new THREE.Raycaster();
  private _pickNDC = new THREE.Vector2();
  private _pickResult = new THREE.Vector3();
  private _framePivot = new THREE.Vector3();

  constructor(config: CameraSystemConfig) {
    const {
      camera,
      canvas,
      scene,
      renderer,
      minDistance = 0.5,
      maxDistance = 100,
      minPitch = -89,
      maxPitch = 89,
      enableDamping = true,
      dampingFactor = 0.12,
      rotateSpeed = 1.0,
      zoomSpeed = 1.0,
      panSpeed = 1.0,
      enablePan = true,
      enableRecenter = true,
      recenterDuration = 0.4,
      recenterEasing = 3,
      recenterDistance = 0,
      doubleClickMs = 450,
      dynamicPitch,
      keyboardFly,
      target = [0, 0, 0],
      autoRotate = false,
      autoRotateSpeed = 1.0,
    } = config;

    this.camera = camera;
    this.canvas = canvas;
    this.scene = scene;

    // Create OrbitControls
    this.controls = new OrbitControls(camera, canvas);
    this.controls.enableDamping = enableDamping;
    this.controls.dampingFactor = dampingFactor;
    this.controls.minDistance = minDistance;
    this.controls.maxDistance = maxDistance;
    this.controls.minPolarAngle = pitchToPolar(maxPitch);
    this.controls.maxPolarAngle = pitchToPolar(minPitch);
    this.controls.rotateSpeed = rotateSpeed;
    this.controls.zoomSpeed = zoomSpeed;
    this.controls.panSpeed = panSpeed;
    this.controls.enablePan = enablePan;
    this.controls.autoRotate = autoRotate;
    this.controls.autoRotateSpeed = autoRotateSpeed;
    this.controls.target.set(...target);

    // Save initial state for reset
    this.initialTarget = new THREE.Vector3(...target);
    this.initialCameraPos = camera.position.clone();

    // Recenter config
    this.recenter = {
      enabled: enableRecenter,
      duration: recenterDuration,
      easing: recenterEasing,
      distance: recenterDistance,
      doubleClickMs,
    };

    // Dynamic pitch config
    this.dynamicPitch = {
      enabled: dynamicPitch?.enabled ?? false,
      closeDistance: dynamicPitch?.closeDistance ?? 1.0,
      farDistance: dynamicPitch?.farDistance ?? 20.0,
      closePitchMin: dynamicPitch?.closePitchMin ?? -89,
      closePitchMax: dynamicPitch?.closePitchMax ?? 89,
      farPitchMin: dynamicPitch?.farPitchMin ?? -10,
      farPitchMax: dynamicPitch?.farPitchMax ?? 45,
    };

    // Recenter animation state
    this.recenterAnim = {
      active: false,
      elapsed: 0,
      startTarget: new THREE.Vector3(),
      endTarget: new THREE.Vector3(),
      startCamPos: new THREE.Vector3(),
      endCamPos: new THREE.Vector3(),
    };

    // Frame animation state
    this.frameAnim = {
      active: false,
      elapsed: 0,
      duration: 0.6,
      startYaw: 0,
      endYaw: 0,
      startPitch: 0,
      endPitch: 0,
      startDistance: 0,
      endDistance: 0,
      startPivot: new THREE.Vector3(),
      endPivot: new THREE.Vector3(),
      wasEnabled: true,
      onComplete: null,
    };
    // User input cancels a frame tween. CAPTURE phase so it runs before
    // OrbitControls' own (bubble-phase) pointerdown — the cancel re-enables
    // controls, then OrbitControls handles the SAME gesture as an orbit start.
    // Without capture, the first gesture only cancels and the user must click
    // again to orbit.
    this.framePointerDownHandler = () => {
      // A click on a scene the visitor does not own must not cancel an in-flight
      // frameTo — that pointerdown is an engage gesture, not a camera command.
      if (!this.inputEnabled) return;
      if (this.frameAnim.active) this.cancelFrame();
      // Announced whether or not a tween was running: a chained caller can be
      // BETWEEN tweens (a sequence resting at a waypoint) and would otherwise
      // hear nothing, then yank the camera back when its timer expired. Same
      // qualification as the cancel above, so there is still exactly one place
      // that decides what counts as the visitor taking the camera.
      this.onUserTakeover?.();
    };
    canvas.addEventListener("pointerdown", this.framePointerDownHandler, true);

    // Apply initial spherical camera state if provided
    if (config.initialState) {
      this.setState(config.initialState);
      this.initialTarget = new THREE.Vector3(
        config.initialState.pivot.x,
        config.initialState.pivot.y,
        config.initialState.pivot.z,
      );
      this.initialCameraPos = camera.position.clone();
    }

    // Keyboard fly config
    this.keyboardFly = {
      enabled: keyboardFly?.enabled ?? true,
      moveSpeed: keyboardFly?.moveSpeed ?? 5,
      sprintMultiplier: keyboardFly?.sprintMultiplier ?? 3,
      activation: keyboardFly?.activation ?? "always",
    };

    // Keyboard event handlers (WASD + QE fly controls)
    this.keydownHandler = (e: KeyboardEvent) => {
      if (!this.inputEnabled) return;
      // Don't capture while the user is editing. Structural, path-based guard:
      // any editing control in the composed path swallows the key. Tag names,
      // not instanceof — a node adopted from another same-origin realm fails
      // this realm's constructor checks. The composed path is retargeting-proof
      // for OPEN shadow roots (e.target retargets to the host, the path does
      // not); CLOSED roots conceal their internals — an accepted limitation of
      // page-global key routing. <select> matters: native type-ahead ("w" jumps
      // to an option) must not also fly the camera.
      const path = e.composedPath();
      for (const node of path.length > 0 ? path : [e.target]) {
        const tag = (node as Element | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if ((node as HTMLElement | null)?.isContentEditable) return;
      }
      this.keysDown.add(e.code);
      // A fly key is camera input as surely as a pointer is — without this a
      // sequence HOLDING at a waypoint survives W/A/S/D and yanks the visitor
      // away when the timer expires. Gated to the keys updateKeyboardFly
      // actually reads, so an unrelated key never claims a takeover.
      if (this.keyboardFly.enabled && FLY_KEYS.has(e.code)) this.onUserTakeover?.();
    };
    this.keyupHandler = (e: KeyboardEvent) => {
      // Not gated on inputEnabled: a key pressed while engaged must still be
      // released if the gate closes mid-hold. `setInputEnabled(false)` clears the
      // set anyway; this is the belt to that braces.
      this.keysDown.delete(e.code);
    };
    this.blurHandler = () => {
      this.keysDown.clear();
    };
    // "always": page-wide keys (window). "engaged": keys are delivered only
    // while the canvas has focus — make it focusable so click/tap/Tab engages
    // it; the browser's focus system IS the arming state (no hover tracking).
    if (this.keyboardFly.activation === "engaged") {
      this.originalTabIndexAttr = canvas.getAttribute("tabindex");
      canvas.tabIndex = 0;
      this.keyEventTarget = canvas;
      // Focus loss disarms: releasing keys can't be observed once unfocused.
      canvas.addEventListener("blur", this.blurHandler);
    } else {
      this.keyEventTarget = window;
    }
    // A focusable canvas needs an accessible name + usage instruction, or a
    // screen reader announces an unnamed "canvas" with no hint that keys operate
    // it. Applied however the canvas became focusable — "engaged" above, or a
    // caller that set `tabindex` itself — because the CANVAS is what receives
    // focus. A label on the host element (e.g. <splat-site>) does not name it,
    // so a screen reader would still announce an anonymous canvas.
    // Never overwrite a caller-provided label.
    // `tabindex="-1"` counts: it is not in the tab order but IS programmatically
    // focusable, and a script that focuses it would otherwise announce an
    // anonymous "canvas".
    const focusable = canvas.tabIndex >= 0 || canvas.hasAttribute("tabindex");
    if (focusable && !canvas.hasAttribute("aria-label")) {
      canvas.setAttribute(
        "aria-label",
        "Interactive 3D scene. W, A, S, D and Q, E fly the camera; drag to orbit; double-click to recenter.",
      );
      this.addedAriaLabel = true;
    }
    this.keyEventTarget.addEventListener("keydown", this.keydownHandler as EventListener);
    this.keyEventTarget.addEventListener("keyup", this.keyupHandler as EventListener);
    // Alt-tab must clear held keys in both modes.
    window.addEventListener("blur", this.blurHandler);

    // Double-click handler — native dblclick fires after both clicks complete,
    // avoiding camera rotation from OrbitControls processing the first click
    this.dblclickHandler = (e: MouseEvent) => this.handleDoubleClick(e);
    canvas.addEventListener("dblclick", this.dblclickHandler);

    // Wheel zoom is camera input the pointer path never sees: OrbitControls
    // consumes it internally, so without this a sequence HOLDING at a waypoint
    // survives an explore zoom and flies on from under the visitor. Passive —
    // this only reports; OrbitControls keeps its own preventDefault decision.
    this.wheelTakeoverHandler = () => {
      if (!this.inputEnabled || !this.controls.enabled || !this.controls.enableZoom) return;
      this.onUserTakeover?.();
    };
    canvas.addEventListener("wheel", this.wheelTakeoverHandler, { passive: true });
  }

  // ─── Distance getter ────────────────────────────────────

  get distance(): number {
    return this.camera.position.distanceTo(this.controls.target);
  }

  // ─── Per-frame update ───────────────────────────────────

  update(deltaTime: number): void {
    if (this.disposed) return;

    // Animate frame tween — dt clamped so a background-tab return (one huge
    // clock delta) advances smoothly instead of teleporting to the end.
    if (this.frameAnim.active) {
      this.updateFrameAnimation(Math.min(deltaTime, 0.1));
      return;
    }

    // Animate recenter — skip controls.update() during animation to prevent conflicts
    if (this.recenterAnim.active) {
      this.updateRecenterAnimation(deltaTime);
      return;
    }

    // Keyboard fly (WASD + QE)
    if (this.keyboardFly.enabled && this.keysDown.size > 0) {
      this.updateKeyboardFly(deltaTime);
    }

    // Dynamic pitch limits
    if (this.dynamicPitch.enabled) {
      this.updateDynamicPitch();
    }

    this.controls.update();
  }

  // ─── Recenter Animation ─────────────────────────────────

  private updateRecenterAnimation(dt: number): void {
    const rc = this.recenterAnim;
    const cfg = this.recenter;

    rc.elapsed += dt;
    const t = Math.min(rc.elapsed / cfg.duration, 1);
    const eased = 1 - Math.pow(1 - t, cfg.easing);

    // Parallel pan: lerp both target and camera by the same delta
    this.controls.target.lerpVectors(rc.startTarget, rc.endTarget, eased);
    this.camera.position.lerpVectors(rc.startCamPos, rc.endCamPos, eased);

    if (t >= 1) {
      rc.active = false;
      this.controls.enabled = true;
      // Flush stale rotation deltas — with damping enabled, update() only
      // partially applies deltas. Temporarily disable damping so update()
      // zeroes all internal deltas and cleanly syncs to our new positions.
      const wasDamping = this.controls.enableDamping;
      this.controls.enableDamping = false;
      this.controls.update();
      this.controls.enableDamping = wasDamping;
    }
  }

  // ─── Dynamic Pitch ──────────────────────────────────────

  private updateDynamicPitch(): void {
    const cfg = this.dynamicPitch;
    const dist = this.distance;

    const range = cfg.farDistance - cfg.closeDistance;
    const t = range > 0 ? Math.max(0, Math.min(1, (dist - cfg.closeDistance) / range)) : 0;

    const effectiveMin = cfg.closePitchMin + (cfg.farPitchMin - cfg.closePitchMin) * t;
    const effectiveMax = cfg.closePitchMax + (cfg.farPitchMax - cfg.closePitchMax) * t;

    this.controls.maxPolarAngle = pitchToPolar(effectiveMin);
    this.controls.minPolarAngle = pitchToPolar(effectiveMax);
  }

  // ─── Keyboard Fly (WASD + QE) ──────────────────────────

  private updateKeyboardFly(dt: number): void {
    const keys = this.keysDown;
    const speed = this.keyboardFly.moveSpeed
      * (keys.has("ShiftLeft") || keys.has("ShiftRight") ? this.keyboardFly.sprintMultiplier : 1)
      * dt;

    // Forward/back along camera's look direction (projected to XZ for W/S)
    this.camera.getWorldDirection(this._flyForward);

    // Right vector from camera
    this._flyRight.crossVectors(this._flyForward, this.camera.up).normalize();

    this._flyDelta.set(0, 0, 0);

    if (keys.has("KeyW")) this._flyDelta.add(this._flyForward);
    if (keys.has("KeyS")) this._flyDelta.sub(this._flyForward);
    if (keys.has("KeyA")) this._flyDelta.sub(this._flyRight);
    if (keys.has("KeyD")) this._flyDelta.add(this._flyRight);
    if (keys.has("KeyE")) this._flyDelta.y += 1;
    if (keys.has("KeyQ")) this._flyDelta.y -= 1;

    if (this._flyDelta.lengthSq() === 0) return;

    this._flyDelta.normalize().multiplyScalar(speed);

    // Move both camera and orbit target together (parallel translation)
    this.camera.position.add(this._flyDelta);
    this.controls.target.add(this._flyDelta);
  }

  // ─── Double-Click to Re-orbit ───────────────────────────

  private handleDoubleClick(e: MouseEvent): void {
    if (!this.recenter.enabled) return;
    const rect = this.canvas.getBoundingClientRect();
    const normX = (e.clientX - rect.left) / rect.width;
    const normY = (e.clientY - rect.top) / rect.height;

    console.log("[CameraSystem] double-click at", normX.toFixed(3), normY.toFixed(3));

    const hitPoint = this.depthPick(normX, normY);
    if (!hitPoint) {
      console.log("[CameraSystem] no hit — depth pick returned null");
      return;
    }

    console.log("[CameraSystem] hit world:", hitPoint.x.toFixed(3), hitPoint.y.toFixed(3), hitPoint.z.toFixed(3));
    this.startRecenterTo(hitPoint);
  }

  /** Start a smooth recenter animation to a world-space target point */
  startRecenterTo(target: THREE.Vector3): void {
    // Recenter and frame tween are mutually exclusive motion owners. The
    // displaced tween's callback still fires (false) — a chained caller must
    // never be left waiting on a tween that silently stopped existing.
    this.frameAnim.active = false;
    this.takeFrameCallback()?.(false);
    const rc = this.recenterAnim;
    rc.startTarget.copy(this.controls.target);
    rc.endTarget.copy(target);
    rc.startCamPos.copy(this.camera.position);
    // Parallel translation — camera moves by the same delta as target
    const delta = target.clone().sub(this.controls.target);
    rc.endCamPos.copy(this.camera.position).add(delta);
    rc.elapsed = 0;
    rc.active = true;
    this.controls.enabled = false;
  }

  // ─── Frame Tween ────────────────────────────────────────

  /**
   * Tween the FULL camera state — yaw (shortest arc), pitch, distance, pivot —
   * to `state` with cubic ease-in-out. Unlike `setState(state, true)`, which
   * only pans, this reorients. The target is clamped to the orbit limits and
   * (when enabled) the dynamic-pitch band effective AT the target distance, so
   * the tween never ends outside limits and snaps on the next user input.
   * Cancels/replaces recenter and any prior frame tween; a canvas pointerdown
   * cancels it mid-flight (the user always wins).
   */
  frameTo(state: CameraState, durationMs = 600, onComplete?: (arrived: boolean) => void): void {
    if (this.disposed) return;
    this.recenterAnim.active = false;
    // Replacing an active tween: its caller hears the truth (not arrived)
    // BEFORE the new tween installs its own callback.
    if (this.frameAnim.active) this.takeFrameCallback()?.(false);

    const distance = Math.min(
      Math.max(state.distance, this.controls.minDistance),
      this.controls.maxDistance,
    );
    // Pitch band at the TARGET distance (static limits when dynamic pitch is off;
    // controls' polar angles are the source of truth for the static bounds).
    let minPitch = 90 - this.controls.maxPolarAngle * RAD2DEG;
    let maxPitch = 90 - this.controls.minPolarAngle * RAD2DEG;
    if (this.dynamicPitch.enabled) {
      const cfg = this.dynamicPitch;
      const range = cfg.farDistance - cfg.closeDistance;
      const t = range > 0
        ? Math.max(0, Math.min(1, (distance - cfg.closeDistance) / range))
        : 0;
      minPitch = cfg.closePitchMin + (cfg.farPitchMin - cfg.closePitchMin) * t;
      maxPitch = cfg.closePitchMax + (cfg.farPitchMax - cfg.closePitchMax) * t;
    }
    const pitch = Math.min(Math.max(state.pitch, minPitch), maxPitch);

    const current = this.getState();
    const fa = this.frameAnim;
    fa.startYaw = current.yaw;
    fa.endYaw = current.yaw + shortestArcDeg(state.yaw - current.yaw);
    fa.startPitch = current.pitch;
    fa.endPitch = pitch;
    fa.startDistance = current.distance;
    fa.endDistance = distance;
    fa.startPivot.set(current.pivot.x, current.pivot.y, current.pivot.z);
    fa.endPivot.set(state.pivot.x, state.pivot.y, state.pivot.z);
    fa.elapsed = 0;
    fa.duration = Math.max(durationMs, 1) / 1000;
    // Capture the TRUE pre-tween enabled state: a frameTo that replaces an
    // already-active tween must keep the original value, not the (already
    // disabled) current one — else a direct frameTo→frameTo leaves controls
    // permanently disabled.
    fa.wasEnabled = fa.active ? fa.wasEnabled : this.controls.enabled;
    fa.onComplete = onComplete ?? null;
    fa.active = true;
    this.controls.enabled = false;
  }

  /** Abort an in-flight frame tween (external motion owners: a rail-driven stop
   *  selection must cancel a bounds tween that would otherwise fight it). No-op
   *  when idle. Leaves the camera where the last frame put it. */
  cancelFrameTo(): void {
    if (this.frameAnim.active) this.cancelFrame();
  }

  private updateFrameAnimation(dt: number): void {
    const fa = this.frameAnim;
    fa.elapsed += dt;
    const t = Math.min(fa.elapsed / fa.duration, 1);
    const eased = cubicEaseInOut(t);

    const yaw = fa.startYaw + (fa.endYaw - fa.startYaw) * eased;
    const pitch = fa.startPitch + (fa.endPitch - fa.startPitch) * eased;
    const distance = fa.startDistance + (fa.endDistance - fa.startDistance) * eased;
    this._framePivot.lerpVectors(fa.startPivot, fa.endPivot, eased);

    const phi = pitch * DEG2RAD;
    const theta = yaw * DEG2RAD;
    this.controls.target.copy(this._framePivot);
    this.camera.position.set(
      this._framePivot.x + distance * Math.cos(phi) * Math.sin(theta),
      this._framePivot.y + distance * Math.sin(phi),
      this._framePivot.z + distance * Math.cos(phi) * Math.cos(theta),
    );

    if (t >= 1) this.cancelFrame(true);
  }

  /** Detach and return the pending completion callback, so every path that ends
   *  a tween reports exactly once and a stale callback can never fire twice. */
  private takeFrameCallback(): ((arrived: boolean) => void) | null {
    const callback = this.frameAnim.onComplete;
    this.frameAnim.onComplete = null;
    return callback;
  }

  /** End/abort the frame tween, leaving the camera where this frame put it.
   *  `arrived` is true only from the t≥1 path. */
  private cancelFrame(arrived = false): void {
    // Taken FIRST: the callback is invoked at the very end of this method, and
    // it may immediately start a new tween — the state restore below must not
    // run against the new tween's fields.
    const callback = this.takeFrameCallback();
    this.frameAnim.active = false;
    // Restore the pre-tween enabled state — NOT a hard `true`. If a gizmo drag
    // owned (disabled) controls when the tween started, it keeps ownership.
    this.controls.enabled = this.frameAnim.wasEnabled;
    // The tween skipped update() each frame, so the dynamic-pitch limits are
    // stale (from the START distance). Recompute them for the FINAL distance
    // before the damping flush, or update() clamps a valid final pitch and snaps.
    if (this.dynamicPitch.enabled) this.updateDynamicPitch();
    if (this.controls.enabled) {
      // Flush stale rotation deltas exactly like recenter's end (damping would
      // otherwise replay pre-tween input against the new state). Skipped when a
      // gizmo owns controls — don't touch update().
      const wasDamping = this.controls.enableDamping;
      this.controls.enableDamping = false;
      this.controls.update();
      this.controls.enableDamping = wasDamping;
    }
    // LAST, after every restore above: the callback may immediately start the
    // next tween (sequence chaining), and it must see a fully settled system.
    callback?.(arrived);
  }

  // ─── Click-to-Reorbit Pick ──────────────────────────────

  /**
   * Raycast against splat meshes for accurate surface picking.
   * Falls back to view-plane intersection at orbit target depth
   * when no splat is under the cursor (e.g. background clicks).
   */
  private depthPick(normX: number, normY: number): THREE.Vector3 | null {
    this._pickNDC.set(normX * 2 - 1, -(normY * 2 - 1));
    this._raycaster.setFromCamera(this._pickNDC, this.camera);

    // DEAD (Phase 1): splat picking needs a splat-mesh class to filter hits
    // against, and the Spark value import is removed with the Spark
    // dependency. The capability returns as `backend.raycast()` through the
    // seam in Phase 3 (doc 03 §B). Until then no splat hit is possible and
    // depthPick always takes the view-plane fallback below.
    const splatHits: THREE.Intersection[] = [];
    // ⚠ Skip near-camera fuzz. Photogrammetry captures routinely carry stray
    // splats sitting essentially ON the camera — measured on the portfolio hero,
    // EVERY ray direction returned a first hit ~0.04 units away, inside the near
    // plane. Taking it recenters onto that floater, and because startRecenterTo
    // translates the camera by (target − orbitTarget), the result is a large
    // lurch in a direction unrelated to what was clicked. Prefer the first hit
    // past the fuzz radius, falling back to the nearest only if nothing else was
    // hit at all. Identical rule to the author-mode picker (SiteRuntime.ts), via
    // the shared constant, so the two pickers cannot drift apart.
    const splatHit = splatHits.find((h) => h.distance > NEAR_PICK_FUZZ) ?? splatHits[0];
    if (splatHit?.point) return splatHit.point.clone();

    // Fallback: view-plane at orbit target depth
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      this.camera.getWorldDirection(this._pickResult),
      this.controls.target,
    );
    const hit = this._raycaster.ray.intersectPlane(plane, this._pickResult);
    return hit ? hit.clone() : null;
  }

  // ─── Camera State ───────────────────────────────────────

  getState(): CameraState {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const dist = offset.length();
    const pitch = dist > 0 ? Math.asin(offset.y / dist) * RAD2DEG : 0;
    const yaw = Math.atan2(offset.x, offset.z) * RAD2DEG;

    return {
      yaw,
      pitch,
      distance: dist,
      pivot: {
        x: this.controls.target.x,
        y: this.controls.target.y,
        z: this.controls.target.z,
      },
    };
  }

  setState(state: CameraState, animate = false): void {
    const phi = state.pitch * DEG2RAD;
    const theta = state.yaw * DEG2RAD;

    const newTarget = new THREE.Vector3(state.pivot.x, state.pivot.y, state.pivot.z);
    const newPos = new THREE.Vector3(
      state.pivot.x + state.distance * Math.cos(phi) * Math.sin(theta),
      state.pivot.y + state.distance * Math.sin(phi),
      state.pivot.z + state.distance * Math.cos(phi) * Math.cos(theta),
    );

    if (animate) {
      this.startRecenterTo(newTarget);
    } else {
      this.controls.target.copy(newTarget);
      this.camera.position.copy(newPos);
      this.controls.update();
    }
  }

  copyState(): void {
    const state = this.getState();
    const json = JSON.stringify(state, null, 2);
    navigator.clipboard.writeText(json).then(
      () => console.log("[CameraSystem] State copied to clipboard"),
      (err) => console.warn("[CameraSystem] Clipboard write failed:", err),
    );
  }

  resetPivot(animate = true): void {
    if (animate) {
      this.startRecenterTo(this.initialTarget.clone());
    } else {
      this.controls.target.copy(this.initialTarget);
      this.controls.update();
    }
  }

  resetCamera(animate = false): void {
    if (animate) {
      this.startRecenterTo(this.initialTarget.clone());
    } else {
      this.controls.target.copy(this.initialTarget);
      this.camera.position.copy(this.initialCameraPos);
      this.controls.update();
    }
  }

  // ─── Configuration setters ──────────────────────────────

  setRecenterConfig(config: Partial<RecenterConfig>): void {
    Object.assign(this.recenter, config);
  }

  /**
   * Master input gate — keyboard fly and the pointerdown motion-cancel.
   *
   * Separate from `setRecenterEnabled` on purpose: recenter is one interaction,
   * this is "is the scene the input owner at all". Held keys are cleared when
   * the gate closes, or a W held across a disengage would fly forever (keyup is
   * delivered to whatever has focus afterwards, which may not be this target).
   */
  setInputEnabled(on: boolean): void {
    if (this.inputEnabled === on) return;
    this.inputEnabled = on;
    if (!on) this.keysDown.clear();
  }

  /**
   * Subscribe to "the visitor just took the camera" — a qualifying canvas
   * pointerdown, the same gesture that cancels a frame tween, reported even when
   * no tween is running.
   *
   * Exists because `frameTo`'s completion callback only speaks for a tween: a
   * caller chaining tweens through this funnel (the D31 sequence player) is
   * deaf between them, and would fly on from a waypoint the visitor had already
   * grabbed the camera at. Pass null to unsubscribe. One subscriber — this is a
   * motion-owner handoff, not an event bus.
   */
  setUserTakeoverCallback(callback: (() => void) | null): void {
    this.onUserTakeover = callback;
  }

  /** Toggle double-click recenter. The engagement model needs this as its own
   *  switch: a disengaged scene must not react to a double-click at all. */
  setRecenterEnabled(on: boolean): void {
    this.recenter.enabled = on;
  }

  setDynamicPitch(config: Partial<DynamicPitchConfig>): void {
    Object.assign(this.dynamicPitch, config);
  }

  setOrbitLimits(limits: Partial<OrbitLimits>): void {
    if (limits.minDistance !== undefined) this.controls.minDistance = limits.minDistance;
    if (limits.maxDistance !== undefined) this.controls.maxDistance = limits.maxDistance;
    if (limits.minPitch !== undefined) this.controls.maxPolarAngle = pitchToPolar(limits.minPitch);
    if (limits.maxPitch !== undefined) this.controls.minPolarAngle = pitchToPolar(limits.maxPitch);
    // Azimuth passes straight through: OrbitControls supports yaw bounds natively,
    // so there is no clamp to build. Note these do NOT invert the way the pitch
    // pair does — polar angle runs opposite to pitch, azimuth does not.
    if (limits.minAzimuth !== undefined) this.controls.minAzimuthAngle = limits.minAzimuth;
    if (limits.maxAzimuth !== undefined) this.controls.maxAzimuthAngle = limits.maxAzimuth;
  }

  /**
   * Read back the controls' CURRENT orbit bounds.
   *
   * Exists so a caller that narrows the bounds temporarily — `explore: "bounded"`
   * is the one in the toolkit — can capture what they were and restore them on
   * leaving. Without it a bounded stop would permanently narrow the rest of the
   * site, because the original values live only inside OrbitControls.
   */
  getOrbitLimits(): OrbitLimits {
    return {
      minDistance: this.controls.minDistance,
      maxDistance: this.controls.maxDistance,
      // The controls store polar angles; pitch is the inverse of that pair.
      minPitch: 90 - this.controls.maxPolarAngle * RAD2DEG,
      maxPitch: 90 - this.controls.minPolarAngle * RAD2DEG,
      minAzimuth: this.controls.minAzimuthAngle,
      maxAzimuth: this.controls.maxAzimuthAngle,
    };
  }

  setKeyboardFly(config: Partial<Omit<KeyboardFlyConfig, "activation">>): void {
    // activation is construction-time only: it decides listener topology
    // (window vs canvas) and canvas focusability. Assigning it here would
    // report a new mode while the listeners stay wired for the old one —
    // strip it at runtime too, since JS callers bypass the type.
    const { activation: _ignored, ...rest } = config as Partial<KeyboardFlyConfig>;
    Object.assign(this.keyboardFly, rest);
  }

  setInputSpeeds(speeds: Partial<InputSpeeds>): void {
    if (speeds.rotateSpeed !== undefined) this.controls.rotateSpeed = speeds.rotateSpeed;
    if (speeds.zoomSpeed !== undefined) this.controls.zoomSpeed = speeds.zoomSpeed;
    if (speeds.panSpeed !== undefined) this.controls.panSpeed = speeds.panSpeed;
  }

  // ─── Cleanup ────────────────────────────────────────────

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // A tween pending at teardown reports (false) rather than never — a caller
    // chained on it must not be left waiting on a system that no longer exists.
    this.frameAnim.active = false;
    this.takeFrameCallback()?.(false);

    this.canvas.removeEventListener("dblclick", this.dblclickHandler);
    // Registered with capture:true — must be removed with the SAME phase flag.
    this.canvas.removeEventListener("pointerdown", this.framePointerDownHandler, true);
    this.canvas.removeEventListener("wheel", this.wheelTakeoverHandler);
    this.keyEventTarget.removeEventListener("keydown", this.keydownHandler as EventListener);
    this.keyEventTarget.removeEventListener("keyup", this.keyupHandler as EventListener);
    if (this.keyEventTarget !== window) {
      this.canvas.removeEventListener("blur", this.blurHandler);
      // Engaged mode mutated the canvas — restore it for callers who reuse
      // theirs: the pre-existing tabindex attribute (or its absence), and the
      // accessible name only if we added it.
      if (this.originalTabIndexAttr === null) this.canvas.removeAttribute("tabindex");
      else this.canvas.setAttribute("tabindex", this.originalTabIndexAttr);
      if (this.addedAriaLabel) this.canvas.removeAttribute("aria-label");
    }
    window.removeEventListener("blur", this.blurHandler);
    this.controls.dispose();
  }
}
