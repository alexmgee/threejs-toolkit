/**
 * CameraRail — Rail camera system for guided tours and scroll-driven scenes
 *
 * Drives the camera along a sequence of stops while the viewer retains
 * full orbit control at all times. The path author defines suggested
 * orientations at each stop; during transitions the camera blends toward
 * the suggested view, and on arrival a brief "settle" gently orients the
 * camera before handing full control back to the user.
 *
 * Two primary input modes:
 *  - setProgress(t): external scroll/slider drives position (0→1)
 *  - goToStop(i) / next() / prev(): animated navigation between stops
 *
 * Works with CameraSystem — composes pivot/distance from the rail with
 * user-controlled yaw/pitch from OrbitControls every frame.
 */

import type { CameraSystem, CameraState, OrbitLimits } from "./CameraSystem";
import type { EasingFn } from "./CameraPath";

// ─── Types ────────────────────────────────────────────────

export interface RailStop {
  /** Camera state at this stop (yaw/pitch/distance/pivot) */
  camera: CameraState;
  /** Per-stop optics blended during rail travel; absent fields inherit the global/current value. */
  optics?: RailOptics;
  /** Optional orbit limits while at this stop */
  orbitLimits?: Partial<OrbitLimits>;
  /** Transition duration TO this stop in seconds (overrides default) */
  duration?: number;
  /** Label for this stop (useful for UI/debug) */
  label?: string;
  /** Arbitrary metadata — content overlays, COLMAP image refs, etc. */
  meta?: Record<string, unknown>;
}

export interface RailOptics {
  fov?: number;
  focalDistance?: number;
  apertureAngle?: number;
}

export interface CameraRailConfig {
  /** CameraSystem to drive */
  cameraSystem: CameraSystem;
  /** Canvas element — used to detect user interaction for settle cancellation */
  canvas: HTMLCanvasElement;
  /** Ordered list of stops */
  stops?: RailStop[];
  /** Easing function for transitions (default: cubic ease-in-out) */
  easing?: EasingFn;
  /** Default transition duration in seconds (default: 2) */
  transitionDuration?: number;
  /** Settle duration in seconds (default: 0.5) */
  settleDuration?: number;
  /** Callback when arriving at a stop (after settle completes or is cancelled) */
  onStopArrived?: (index: number, stop: RailStop) => void;
  /** Callback during transitions — from/to indices and normalized progress */
  onTransition?: (from: number, to: number, t: number) => void;
  /** Callback with blended per-stop optics; consumer applies renderer-specific values */
  onOptics?: (o: RailOptics) => void;
  /** Callback when settle starts */
  onSettleStart?: (index: number) => void;
  /** Callback when settle ends (completed or cancelled) */
  onSettleEnd?: (index: number, cancelled: boolean) => void;
}

// ─── Default Easing ───────────────────────────────────────

/** Cubic ease-in-out: smooth start and end */
const cubicEaseInOut: EasingFn = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// ─── Merge-onto-path ──────────────────────────────────────

/**
 * Seconds over which an off-path camera merges back onto the rail.
 *
 * The rail derives pivot/distance from `progress` alone, so the FIRST driven
 * frame after the visitor moved the camera off the path (Explore zoom, orbit
 * while docked, WASD fly) used to write the path value directly — a one-frame
 * teleport. The author, re-testing 2026-08-03: "the camera zooms outward from
 * the position it was at when i started scrolling upward… wholly unreliable"
 * and "the re-orientation of the camera upon scrolling after this was still too
 * sudden and fast."
 *
 * The fix keeps the path authoritative and adds a decaying offset:
 * `camera = path(progress) + offset · w(t)`, w easing 1→0 (cubic ease-out).
 */
const MERGE_SEC = 0.8;
/** Below this the offset is not worth a merge — capture is skipped entirely so
 *  on-path travel takes the exact pre-fix code path, bit for bit. */
const MERGE_EPS = 1e-4;

interface MergeOffset {
  distance: number;
  px: number;
  py: number;
  pz: number;
}

// ─── Internal State ───────────────────────────────────────

const enum RailMode {
  /** Idle at a stop — no setState calls, user has full control */
  Idle,
  /** Transitioning between stops via goToStop/next/prev (time-driven) */
  Animating,
  /** Being driven externally via setProgress (scroll-driven) */
  Scrubbing,
  /** Arrived at stop, blending toward suggested orientation */
  Settling,
}

// ─── CameraRail ───────────────────────────────────────────

export class CameraRail {
  private cameraSystem: CameraSystem;
  private canvas: HTMLCanvasElement;
  private easing: EasingFn;
  private defaultDuration: number;
  private settleDuration: number;

  // Stops
  private stops: RailStop[] = [];

  // Progress: 0 = first stop, 1 = last stop
  private _progress = 0;
  private _currentStop = 0;

  // Mode
  private mode: RailMode = RailMode.Idle;

  // Animation state (for goToStop/next/prev)
  private animFrom = 0;
  private animTo = 0;
  private animElapsed = 0;
  private animDuration = 2;

  // Settle state
  private settleElapsed = 0;
  private settleStartYaw = 0;
  private settleStartPitch = 0;
  private settleTargetYaw = 0;
  private settleTargetPitch = 0;
  private settleStopIndex = 0;

  // Previous progress — to detect stop arrival in scrubbing mode
  private prevProgress = 0;
  private prevSegment = -1;

  // Settle cancellation listener
  private cancelSettleHandler: (() => void) | null = null;

  // Orientation-deviation state (see applyCameraAtProgress). The rail's
  // orientation is a pure function of progress; this holds only the visitor's
  // own departure from it, which decays back to zero.
  private orientOffsetYaw = 0;
  private orientOffsetPitch = 0;
  private lastWrittenYaw: number | null = null;
  private lastWrittenPitch = 0;

  // Merge-onto-path state (see MERGE_SEC). `mergeActive` false ⇒ every camera
  // write below is byte-for-byte the pre-fix expression.
  private mergeActive = false;
  // Countdown of frames since the last setProgress write. A PARKED scrub
  // (merge decayed, no wheel events) drives nothing — but the first wheel
  // notch of a RESUMED scrub writes the camera from setProgress itself, an
  // event the per-frame update() never sees. Two frames of "hot" covers the
  // event-vs-frame ordering so `driving` is true for any consumer that reads
  // it in the frame a scrub write actually landed.
  private scrubHot = 0;
  private mergeElapsed = 0;
  private mergeDuration = MERGE_SEC;
  private mergeOffset: MergeOffset = { distance: 0, px: 0, py: 0, pz: 0 };

  // Callbacks
  private onStopArrivedCb: ((index: number, stop: RailStop) => void) | null;
  private onTransitionCb: ((from: number, to: number, t: number) => void) | null;
  private onOpticsCb: ((o: RailOptics) => void) | null;
  private onSettleStartCb: ((index: number) => void) | null;
  private onSettleEndCb: ((index: number, cancelled: boolean) => void) | null;

  // ─── Getters ──────────────────────────────────────────────

  get currentStop(): number {
    return this._currentStop;
  }

  get stopCount(): number {
    return this.stops.length;
  }

  get transitioning(): boolean {
    return this.mode === RailMode.Animating || this.mode === RailMode.Scrubbing;
  }

  get settling(): boolean {
    return this.mode === RailMode.Settling;
  }

  get progress(): number {
    return this._progress;
  }

  get idle(): boolean {
    return this.mode === RailMode.Idle;
  }

  /** Is the rail actually writing the camera — time-driven travel or settle, or
   *  a scrub whose merge offset is still decaying (the one case Scrubbing writes
   *  per frame, see update()). A PARKED scrub — mode Scrubbing, merge done —
   *  drives nothing: the mode word is bookkeeping left over from the last wheel
   *  event, and the camera is genuinely at rest until the next one. Callers
   *  asking "is the camera at rest?" want this, not `idle`: the mode word can
   *  stay Scrubbing for a whole visit (nothing clears it short of an arrival),
   *  while the camera sits still. */
  get driving(): boolean {
    return this.mode === RailMode.Animating
      || this.mode === RailMode.Settling
      || (this.mode === RailMode.Scrubbing && (this.mergeActive || this.scrubHot > 0));
  }

  // ─── Constructor ──────────────────────────────────────────

  constructor(config: CameraRailConfig) {
    this.cameraSystem = config.cameraSystem;
    this.canvas = config.canvas;
    this.easing = config.easing ?? cubicEaseInOut;
    this.defaultDuration = config.transitionDuration ?? 2;
    this.settleDuration = config.settleDuration ?? 0.5;

    this.onStopArrivedCb = config.onStopArrived ?? null;
    this.onTransitionCb = config.onTransition ?? null;
    this.onOpticsCb = config.onOptics ?? null;
    this.onSettleStartCb = config.onSettleStart ?? null;
    this.onSettleEndCb = config.onSettleEnd ?? null;

    if (config.stops) {
      this.stops = config.stops.map((s) => deepCopyStop(s));
    }

    // Jump to first stop if available
    if (this.stops.length > 0) {
      this.cameraSystem.setState(this.stops[0].camera);
      this._currentStop = 0;
      this._progress = 0;
      this.applyOrbitLimits(0);
      this.applyStopOptics(0);
    }
  }

  // ─── Navigation (Animated) ────────────────────────────────

  /** Animate to a specific stop */
  /** The duration `goToStop(index)` would use if given none — the authored
   *  per-stop value, else the rail default. Exposed so a caller can SCALE the
   *  authored timing (reduced motion) instead of replacing it with a constant. */
  resolvedDuration(index: number): number {
    const i = clamp(index, 0, Math.max(0, this.stops.length - 1));
    return this.stops[i]?.duration ?? this.defaultDuration;
  }

  goToStop(index: number, duration?: number): void {
    if (this.stops.length < 2) return;
    index = clamp(index, 0, this.stops.length - 1);

    const wasDriving = this.mode === RailMode.Animating || this.mode === RailMode.Scrubbing;
    this.cancelSettle();

    const fromProgress = this._progress;
    const toProgress = this.stopIndexToProgress(index);

    this.animFrom = fromProgress;
    this.animTo = toProgress;
    this.animElapsed = 0;
    this.animDuration = duration ?? this.stops[index].duration ?? this.defaultDuration;
    // The rail is about to start writing the camera. If the camera is not where
    // path(fromProgress) puts it, take the difference as a merge offset instead
    // of snapping. Bounded by the flight itself so w hits 0 no later than
    // arrival — the authored framing is never displaced.
    if (!wasDriving) {
      this.captureMergeOffset(fromProgress, this.animDuration);
      this.resetOrientBlend();
    }
    this.mode = RailMode.Animating;
  }

  /**
   * Discrete arrival: set progress and camera to the stop and announce, with
   * NO travel animation and NO settle phase (prefers-reduced-motion, spec §5.7).
   * Fires the same onStopArrived contract as an animated arrival — routing
   * depends on it (Plan 24 Task 2's terminal signal).
   *
   * ⚠ `duration: 0` is NOT a cut: updateAnimation's completion always enters
   * startSettle, which runs a second orientation animation. This path replicates
   * ONLY startSettle's non-animated work (applyOrbitLimits + applyStopOptics —
   * CameraRail.ts's settle at :401-402) and deliberately NOT its pointerdown
   * cancel-listener wiring: a cut has no animation to interrupt, so copying it
   * would register a stray one-shot listener.
   */
  cutToStop(index: number): void {
    if (this.stops.length === 0) return;
    index = clamp(index, 0, this.stops.length - 1);
    this.cancelSettleQuiet();
    this.clearMerge(); // a cut is exact by definition — no merge remainder
    this.mode = RailMode.Idle;
    this._progress = this.stopIndexToProgress(index);
    this._currentStop = index;
    this.applyCameraAtProgress(this._progress);
    // Snap orientation exactly to the authored pose — the settle would have.
    this.cameraSystem.setState(this.stops[index].camera);
    this.resetOrientBlend();
    this.applyOrbitLimits(index);
    this.applyStopOptics(index);
    this.onStopArrivedCb?.(index, this.stops[index]);
  }

  /** cancelSettle WITHOUT the arrival announcement — a cut announces exactly
   *  once, itself; the user-input cancel path's announce would double it. */
  private cancelSettleQuiet(): void {
    if (this.mode === RailMode.Settling) {
      this.mode = RailMode.Idle;
    }
    this.removeCancelListener();
  }

  /**
   * Halt any in-flight rail motion (travel or settle) WITHOUT writing camera
   * state — the camera stays wherever this frame left it. For external motion
   * owners (e.g. selection framing) that need the rail to yield. Travel cancel
   * fires no arrival events (nothing arrived — same contract as a scrub
   * takeover); settle cancel reuses the user-input cancel path, which does
   * announce arrival. Scrubbing is externally driven and is not affected.
   */
  cancelMotion(): void {
    if (this.mode === RailMode.Animating) {
      this._currentStop = this.progressToNearestStop(this._progress);
      this.clearMerge();
      this.resetOrientBlend();
      this.mode = RailMode.Idle;
      return;
    }
    this.cancelSettle();
  }

  /** Navigate to the next stop */
  next(duration?: number): void {
    if (this._currentStop < this.stops.length - 1) {
      this.goToStop(this._currentStop + 1, duration);
    }
  }

  /** Navigate to the previous stop */
  prev(duration?: number): void {
    if (this._currentStop > 0) {
      this.goToStop(this._currentStop - 1, duration);
    }
  }

  // ─── Direct Progress Control (Scroll Binding) ─────────────

  /**
   * Set rail progress directly. 0 = first stop, 1 = last stop.
   * Intended for scroll binding: consumer maps scroll position to [0,1].
   */
  setProgress(t: number): void {
    if (this.stops.length < 2) return;

    // If settling, cancel it — user is scrolling
    this.cancelSettle();

    // If we were animating, switch to scrubbing
    if (this.mode === RailMode.Animating) {
      this.mode = RailMode.Scrubbing;
    } else if (this.mode === RailMode.Idle) {
      // Entering travel from a docked stop — the visitor may have zoomed,
      // orbited or flown away from the path. Merge rather than snap. A scrub has
      // no known end time, so the full MERGE_SEC applies; an arrival that lands
      // before it finishes re-bases the remainder onto the settle (startSettle).
      this.captureMergeOffset(this._progress, MERGE_SEC);
      this.resetOrientBlend();
      this.mode = RailMode.Scrubbing;
    }

    this.prevProgress = this._progress;
    this._progress = clamp(t, 0, 1);
    this.scrubHot = 2;

    // Apply interpolated camera state
    this.applyCameraAtProgress(this._progress);

    // Detect if we've arrived at a stop
    const stopIndex = this.progressToNearestStop(this._progress);
    const stopProgress = this.stopIndexToProgress(stopIndex);
    const atStop = Math.abs(this._progress - stopProgress) < 0.001;

    if (atStop) {
      const wasAtDifferentStop = this._currentStop !== stopIndex
        || this.prevSegment !== this.progressToSegment(this.prevProgress);

      this._currentStop = stopIndex;

      if (wasAtDifferentStop) {
        this.startSettle(stopIndex);
      }
    }

    this.prevSegment = this.progressToSegment(this._progress);
  }

  // ─── Per-Frame Update ─────────────────────────────────────

  /** Call every frame from the animation loop */
  update(deltaTime: number): void {
    if (this.stops.length < 2) return;

    // The merge weight decays on the frame clock whenever the rail is driving,
    // so a scrub that stops mid-travel still finishes converging.
    if (this.mergeActive && this.mode !== RailMode.Idle) this.mergeElapsed += deltaTime;
    if (this.scrubHot > 0) this.scrubHot -= 1;

    switch (this.mode) {
      case RailMode.Animating:
        this.updateAnimation(deltaTime);
        break;

      case RailMode.Settling:
        this.updateSettle(deltaTime);
        break;

      case RailMode.Scrubbing:
        // Scrubbing is driven by setProgress() — except while a merge offset is
        // still decaying, which no scroll event re-applies. Re-writing the same
        // progress here is what actually walks the camera onto the path when the
        // visitor stops scrolling mid-travel.
        if (this.mergeActive) {
          this.applyCameraAtProgress(this._progress);
          if (this.mergeWeight() <= 0) this.clearMerge();
        }
        break;

      case RailMode.Idle:
        // Nothing — user has full control
        break;
    }
  }

  // ─── Stop Management ──────────────────────────────────────

  addStop(stop: RailStop): void {
    this.stops.push(deepCopyStop(stop));
  }

  setStops(stops: RailStop[]): void {
    this.stops = stops.map((s) => deepCopyStop(s));
    this.clearMerge();
    this.resetOrientBlend();
    this.mode = RailMode.Idle;
    this._progress = 0;
    this._currentStop = 0;

    if (this.stops.length > 0) {
      this.cameraSystem.setState(this.stops[0].camera);
      this.applyOrbitLimits(0);
      this.applyStopOptics(0);
    }
  }

  getStops(): RailStop[] {
    return this.stops.map((s) => deepCopyStop(s));
  }

  removeStop(index: number): void {
    if (index >= 0 && index < this.stops.length) {
      this.stops.splice(index, 1);
    }
  }

  // ─── Serialization ────────────────────────────────────────

  toJSON(): string {
    return JSON.stringify(this.stops, null, 2);
  }

  fromJSON(json: string): void {
    const parsed = JSON.parse(json) as RailStop[];
    this.setStops(parsed);
  }

  // ─── Cleanup ──────────────────────────────────────────────

  dispose(): void {
    this.cancelSettle();
    this.clearMerge();
    this.resetOrientBlend();
    this.mode = RailMode.Idle;
    this.stops = [];
  }

  // ─── Private: Animation ───────────────────────────────────

  private updateAnimation(dt: number): void {
    this.animElapsed += dt;
    const rawT = clamp(this.animElapsed / this.animDuration, 0, 1);
    const eased = this.easing(rawT);

    this._progress = this.animFrom + (this.animTo - this.animFrom) * eased;
    this.applyCameraAtProgress(this._progress);

    // Fire transition callback
    const fromStop = this.progressToNearestStop(this.animFrom);
    const toStop = this.progressToNearestStop(this.animTo);
    this.onTransitionCb?.(fromStop, toStop, rawT);

    // Complete?
    if (rawT >= 1) {
      this._progress = this.animTo;
      this._currentStop = this.progressToNearestStop(this._progress);
      this.applyCameraAtProgress(this._progress);
      this.startSettle(this._currentStop);
    }
  }

  // ─── Private: Settle ──────────────────────────────────────

  private startSettle(stopIndex: number): void {
    const stop = this.stops[stopIndex];
    if (!stop) return;

    // Capture current user orientation. The settle target yaw is
    // re-expressed relative to the (normalized) start yaw via the shortest
    // arc, so the existing linear lerp in updateSettle never sweeps more
    // than 180° regardless of how the stop's yaw was authored.
    const current = this.cameraSystem.getState();
    this.settleStartYaw = current.yaw;
    this.settleStartPitch = current.pitch;
    this.settleTargetYaw = current.yaw + shortestArcDeg(stop.camera.yaw - current.yaw);
    this.settleTargetPitch = stop.camera.pitch;
    this.settleStopIndex = stopIndex;
    this.settleElapsed = 0;
    this.rebaseMergeForSettle();
    // The settle owns orientation from here (it lerps from the live pose to the
    // authored one), so the travel blend's offset must not survive into it.
    this.resetOrientBlend();
    this.mode = RailMode.Settling;

    // Apply orbit limits for this stop
    this.applyOrbitLimits(stopIndex);
    this.applyStopOptics(stopIndex);

    // Listen for user interaction to cancel settle
    this.cancelSettleHandler = () => this.cancelSettle();
    this.canvas.addEventListener("pointerdown", this.cancelSettleHandler, { once: true });

    this.onSettleStartCb?.(stopIndex);
  }

  private updateSettle(dt: number): void {
    this.settleElapsed += dt;
    const rawT = clamp(this.settleElapsed / this.settleDuration, 0, 1);
    const eased = this.easing(rawT);

    // Blend yaw/pitch toward suggested orientation
    const yaw = this.settleStartYaw + (this.settleTargetYaw - this.settleStartYaw) * eased;
    const pitch = this.settleStartPitch + (this.settleTargetPitch - this.settleStartPitch) * eased;

    // Keep pivot/distance at the stop position — plus any merge remainder
    // re-based onto this settle, which reaches 0 no later than rawT === 1.
    const stop = this.stops[this.settleStopIndex];
    const w = this.mergeWeight();
    const pivot = { ...stop.camera.pivot };
    let distance = stop.camera.distance;
    if (w > 0) {
      pivot.x += this.mergeOffset.px * w;
      pivot.y += this.mergeOffset.py * w;
      pivot.z += this.mergeOffset.pz * w;
      distance += this.mergeOffset.distance * w;
    }
    this.cameraSystem.setState({ yaw, pitch, distance, pivot });
    this.applyStopOptics(this.settleStopIndex);

    // Complete?
    if (rawT >= 1) {
      this.clearMerge();
      this.mode = RailMode.Idle;
      this._currentStop = this.settleStopIndex;
      this.removeCancelListener();
      this.onSettleEndCb?.(this.settleStopIndex, false);
      this.onStopArrivedCb?.(this.settleStopIndex, stop);
    }
  }

  private cancelSettle(): void {
    if (this.mode !== RailMode.Settling) {
      this.removeCancelListener();
      return;
    }

    const stopIndex = this.settleStopIndex;
    // The rail stops writing the camera here, so a surviving offset would be
    // frozen in rather than decayed away. (Only the Settling branch clears —
    // the early return above is hit on EVERY setProgress/goToStop, where an
    // in-flight merge must survive.)
    this.clearMerge();
    this.resetOrientBlend();
    this.mode = RailMode.Idle;
    this.removeCancelListener();
    this.onSettleEndCb?.(stopIndex, true);
    this.onStopArrivedCb?.(stopIndex, this.stops[stopIndex]);
  }

  private removeCancelListener(): void {
    if (this.cancelSettleHandler) {
      this.canvas.removeEventListener("pointerdown", this.cancelSettleHandler);
      this.cancelSettleHandler = null;
    }
  }

  // ─── Private: Camera Interpolation ────────────────────────

  /**
   * Interpolate the camera state at a given progress value.
   * Pivot and distance are fully interpolated from the rail.
   * Yaw and pitch are blended from current user orientation toward
   * the target stop's suggested orientation.
   */
  /** The rail's own pivot/distance at `progress`. */
  private pathPivotDistance(progress: number): { pivot: { x: number; y: number; z: number }; distance: number } {
    const { segIndex, localT } = this.progressToSegmentAndT(progress);
    const from = this.stops[segIndex];
    const to = this.stops[segIndex + 1] ?? this.stops[segIndex];
    const eased = this.easing(localT);
    return {
      pivot: {
        x: from.camera.pivot.x + (to.camera.pivot.x - from.camera.pivot.x) * eased,
        y: from.camera.pivot.y + (to.camera.pivot.y - from.camera.pivot.y) * eased,
        z: from.camera.pivot.z + (to.camera.pivot.z - from.camera.pivot.z) * eased,
      },
      distance: from.camera.distance + (to.camera.distance - from.camera.distance) * eased,
    };
  }

  /**
   * The rail's own ORIENTATION at `progress` — the authored view, interpolated
   * WITHIN the segment rather than pinned to its far endpoint.
   *
   * This is the D39 fix. The blend used to pull the live camera a fraction
   * toward `to.camera.yaw` (the segment's END stop) every call, which made
   * orientation an integral over the call history instead of a function of
   * progress: scrolling back up kept pulling toward the same far endpoint, so
   * the view carried on rotating the way it had been going. Measured on the lab
   * tour, six wheel ticks down and six back up returned progress to exactly 0
   * while yaw sat at 14.01° instead of the authored 0°.
   *
   * Interpolating A→B by the same eased local t the pivot/distance use makes
   * orientation retrace exactly, makes a direction flip continuous (t simply
   * walks back down), and still lands on B exactly at t === 1 so arrival
   * framing and the settle are unchanged. Yaw takes the shortest arc between
   * the two AUTHORED values, so a 240° → 0° leg sweeps through 300°, not back
   * through 120°.
   */
  private pathOrientation(progress: number): { yaw: number; pitch: number } {
    const { segIndex, localT } = this.progressToSegmentAndT(progress);
    const from = this.stops[segIndex];
    const to = this.stops[segIndex + 1] ?? this.stops[segIndex];
    const eased = this.easing(localT);
    return {
      yaw: from.camera.yaw + shortestArcDeg(to.camera.yaw - from.camera.yaw) * eased,
      pitch: from.camera.pitch + (to.camera.pitch - from.camera.pitch) * eased,
    };
  }

  /**
   * Forget the visitor's orientation deviation and the rail's last write.
   *
   * Called wherever the rail stops owning the camera (settle/idle/cut) and on
   * entry to travel from Idle — the next driven frame then re-measures the
   * whole departure from the path as the offset, which is what keeps the first
   * frame of travel free of a snap.
   */
  private resetOrientBlend(): void {
    this.orientOffsetYaw = 0;
    this.orientOffsetPitch = 0;
    this.lastWrittenYaw = null;
    this.lastWrittenPitch = 0;
  }

  // ─── Private: Merge onto path ─────────────────────────────

  /** Cubic ease-OUT decay of the merge offset: most of the correction happens
   *  early, the last of it arrives gently. 0 when no merge is in flight, which is
   *  what makes on-path travel identical to pre-fix. */
  private mergeWeight(): number {
    if (!this.mergeActive || this.mergeDuration <= 0) return 0;
    const t = clamp(this.mergeElapsed / this.mergeDuration, 0, 1);
    const inv = 1 - t;
    return inv * inv * inv;
  }

  private clearMerge(): void {
    this.mergeActive = false;
    this.mergeElapsed = 0;
    this.mergeDuration = MERGE_SEC;
    this.mergeOffset.distance = 0;
    this.mergeOffset.px = 0;
    this.mergeOffset.py = 0;
    this.mergeOffset.pz = 0;
  }

  /**
   * Take the live camera's departure from path(progress) as a merge offset.
   *
   * `maxDuration` is the motion the offset must be gone by — the flight's own
   * duration for goToStop/prev/next, MERGE_SEC for an open-ended scrub. This is
   * the ARRIVAL-EXACTNESS guarantee: w is driven to 0 over
   * min(MERGE_SEC, maxDuration), so a flight shorter than MERGE_SEC still lands
   * exactly on the authored framing.
   */
  private captureMergeOffset(progress: number, maxDuration: number): void {
    this.clearMerge();
    const path = this.pathPivotDistance(progress);
    const live = this.cameraSystem.getState();
    const distance = live.distance - path.distance;
    const px = live.pivot.x - path.pivot.x;
    const py = live.pivot.y - path.pivot.y;
    const pz = live.pivot.z - path.pivot.z;
    const magnitude = Math.abs(distance) + Math.abs(px) + Math.abs(py) + Math.abs(pz);
    if (magnitude <= MERGE_EPS) return; // already on the path — nothing to merge
    const duration = Math.min(MERGE_SEC, maxDuration);
    if (duration <= 0) return; // a zero-length motion is a cut, not a merge
    this.mergeOffset = { distance, px, py, pz };
    this.mergeDuration = duration;
    this.mergeElapsed = 0;
    this.mergeActive = true;
  }

  /**
   * Arrival re-bases whatever is left of the merge onto the settle.
   *
   * A scrub has no known end, so its offset can still be non-zero when a stop is
   * reached. The settle writes the stop's pivot/distance verbatim, which would
   * put the snap back — so instead the effective offset (offset·w) becomes the
   * new offset and is decayed to zero across the settle. Continuous at the
   * hand-off, and zero by the time the settle completes.
   */
  private rebaseMergeForSettle(): void {
    if (!this.mergeActive) return;
    const w = this.mergeWeight();
    const remaining = this.mergeDuration - this.mergeElapsed;
    const duration = Math.min(remaining, this.settleDuration);
    if (w <= 0 || duration <= 0) {
      this.clearMerge();
      return;
    }
    this.mergeOffset = {
      distance: this.mergeOffset.distance * w,
      px: this.mergeOffset.px * w,
      py: this.mergeOffset.py * w,
      pz: this.mergeOffset.pz * w,
    };
    this.mergeDuration = duration;
    this.mergeElapsed = 0;
  }

  private applyCameraAtProgress(progress: number): void {
    const { segIndex, localT } = this.progressToSegmentAndT(progress);
    const from = this.stops[segIndex];
    const to = this.stops[segIndex + 1] ?? this.stops[segIndex];

    const eased = this.easing(localT);

    // Interpolate pivot and distance from the rail
    const path = this.pathPivotDistance(progress);
    const pivot = path.pivot;
    let distance = path.distance;

    // …then add the decaying merge offset, if the camera entered travel off the
    // path. w reaches 0 at or before arrival, so this never displaces a stop.
    const w = this.mergeWeight();
    if (w > 0) {
      pivot.x += this.mergeOffset.px * w;
      pivot.y += this.mergeOffset.py * w;
      pivot.z += this.mergeOffset.pz * w;
      distance += this.mergeOffset.distance * w;
    }

    // ── Orientation ──
    // The authored orientation at THIS progress — pure function of progress,
    // identical in both directions of travel (see pathOrientation).
    const target = this.pathOrientation(progress);

    // Whatever moved the camera since the rail's own last write is the
    // visitor's (drag-while-travelling, or the pose they were left in when
    // travel started). It is carried as an offset on top of the path and
    // decays by the same fraction the old blend used, so a drag still bends
    // the view and still re-blends gently — but a visitor who never touches
    // the camera has offset === 0 and therefore sees the authored path exactly,
    // frame for frame, whichever way they scroll.
    const current = this.cameraSystem.getState();
    if (this.lastWrittenYaw === null) {
      this.orientOffsetYaw = shortestArcDeg(current.yaw - target.yaw);
      this.orientOffsetPitch = current.pitch - target.pitch;
    } else {
      this.orientOffsetYaw += shortestArcDeg(current.yaw - this.lastWrittenYaw);
      this.orientOffsetPitch += current.pitch - this.lastWrittenPitch;
    }
    const pull = eased * 0.3;
    this.orientOffsetYaw -= this.orientOffsetYaw * pull;
    this.orientOffsetPitch -= this.orientOffsetPitch * pull;

    const yaw = target.yaw + this.orientOffsetYaw;
    const pitch = target.pitch + this.orientOffsetPitch;

    this.cameraSystem.setState({ yaw, pitch, distance, pivot });
    // Read back what the camera ACTUALLY took (orbit limits may clamp pitch,
    // yaw normalizes to [-180, 180]) — the next frame's delta must be measured
    // against that, or a clamp would be re-counted as visitor input forever.
    const written = this.cameraSystem.getState();
    this.lastWrittenYaw = written.yaw;
    this.lastWrittenPitch = written.pitch;
    this.applyBlendedOptics(from, to, eased);
  }

  private applyStopOptics(stopIndex: number): void {
    const stop = this.stops[stopIndex];
    if (!stop) return;
    this.onOpticsCb?.({ ...stop.optics });
  }

  private applyBlendedOptics(from: RailStop, to: RailStop, t: number): void {
    if (!this.onOpticsCb) return;
    const optics: RailOptics = {};
    const fov = blendOpticValue(from.optics?.fov, to.optics?.fov, t);
    const focalDistance = blendOpticValue(from.optics?.focalDistance, to.optics?.focalDistance, t);
    const apertureAngle = blendOpticValue(from.optics?.apertureAngle, to.optics?.apertureAngle, t);
    if (fov !== undefined) optics.fov = fov;
    if (focalDistance !== undefined) optics.focalDistance = focalDistance;
    if (apertureAngle !== undefined) optics.apertureAngle = apertureAngle;
    this.onOpticsCb(optics);
  }

  // ─── Private: Orbit Limits ────────────────────────────────

  private applyOrbitLimits(stopIndex: number): void {
    const stop = this.stops[stopIndex];
    if (stop?.orbitLimits) {
      this.cameraSystem.setOrbitLimits(stop.orbitLimits);
    }
  }

  // ─── Private: Progress ↔ Stop Conversion ──────────────────

  private stopIndexToProgress(index: number): number {
    if (this.stops.length <= 1) return 0;
    return index / (this.stops.length - 1);
  }

  private progressToNearestStop(progress: number): number {
    if (this.stops.length <= 1) return 0;
    return Math.round(progress * (this.stops.length - 1));
  }

  private progressToSegment(progress: number): number {
    if (this.stops.length <= 1) return 0;
    const continuous = progress * (this.stops.length - 1);
    return clamp(Math.floor(continuous), 0, this.stops.length - 2);
  }

  private progressToSegmentAndT(progress: number): { segIndex: number; localT: number } {
    if (this.stops.length <= 1) return { segIndex: 0, localT: 0 };

    const continuous = progress * (this.stops.length - 1);
    const segIndex = clamp(Math.floor(continuous), 0, this.stops.length - 2);
    const localT = clamp(continuous - segIndex, 0, 1);

    return { segIndex, localT };
  }
}

// ─── Helpers ──────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Wrap a yaw delta (degrees) to the shortest arc in [-180, 180].
 *
 * CameraSystem.getState() re-derives yaw from the camera vector each frame,
 * so it always reads back normalized to [-180, 180] regardless of what a
 * stop authored (e.g. a stop at 225° reads back as -135° once reached).
 * Every yaw blend must therefore operate on the wrapped delta — raw
 * subtraction produces multi-revolution sweeps whenever a tour crosses
 * the ±180° seam.
 */
function shortestArcDeg(deltaDeg: number): number {
  return ((deltaDeg % 360) + 540) % 360 - 180;
}

function blendOpticValue(from: number | undefined, to: number | undefined, t: number): number | undefined {
  if (from !== undefined && to !== undefined) return from + (to - from) * t;
  return from ?? to;
}

function deepCopyStop(stop: RailStop): RailStop {
  return {
    camera: {
      ...stop.camera,
      pivot: { ...stop.camera.pivot },
    },
    optics: stop.optics ? { ...stop.optics } : undefined,
    orbitLimits: stop.orbitLimits ? { ...stop.orbitLimits } : undefined,
    duration: stop.duration,
    label: stop.label,
    meta: stop.meta ? { ...stop.meta } : undefined,
  };
}
