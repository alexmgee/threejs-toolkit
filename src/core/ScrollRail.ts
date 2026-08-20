/**
 * ScrollRail — Scroll-driven rail travel with docked interaction windows
 *
 * The scroll grammar for full-viewport splat sites, layered on top of
 * CameraRail. One state machine, two input dialects:
 *
 *  - "traveling": scroll owns the rail. Desktop wheel and mobile
 *    vertical swipes scrub CameraRail.setProgress; drag still orbits
 *    (the rail blends user orientation during travel). Stops act as
 *    detents — arrival docks automatically via the rail's own
 *    onStopArrived (consumer calls dock() from that callback).
 *  - "docked": the stop is open. Scroll input no longer moves the
 *    camera; it fills an intent accumulator that decays when idle.
 *    Only sustained scroll past detentThresholdPx undocks — a stray
 *    flick can never yank the visitor out of a stop.
 *  - "explore" (coarse pointers only): an explicit mode the consumer
 *    toggles from a chip. ScrollRail stops intercepting entirely and
 *    OrbitControls gets the whole thumb — full orbit, pinch zoom.
 *
 * Touch handling: on coarse-pointer devices ScrollRail claims
 * single-touch gestures before OrbitControls sees them (capture-phase
 * listener on the canvas' parent — listeners on the canvas itself run
 * in registration order at target, which OrbitControls would win).
 * The first ~10px decide the axis: vertical = travel / leave-intent,
 * horizontal = yaw nudge. Mouse input is never intercepted, so desktop
 * drag-to-orbit is untouched. Ctrl+wheel (including trackpad pinch,
 * which browsers report as wheel+ctrlKey) passes through for zoom.
 *
 * Headless by design: progress bars, leave-pills, and explore chips
 * are consumer UI driven by onStateChange / onAccumulator.
 */

import type { CameraRail } from "./CameraRail";
import type { CameraSystem } from "./CameraSystem";

/** Smallest vertical delta the rail will act on, applied to BOTH the wheel and
 *  touch paths. Guards two cases the old 320px detent used to absorb: a movement
 *  with no vertical component (delta exactly 0, which sign-classifies as
 *  backward) and sub-pixel noise. */
const MIN_WHEEL_DELTA_PX = 1;
// The ONE reduced-motion signal — do not create another matchMedia subscription.

// ─── Types ────────────────────────────────────────────────

export type ScrollRailState = "traveling" | "docked" | "explore";

export interface ScrollRailConfig {
  cameraRail: CameraRail;
  cameraSystem: CameraSystem;
  /** The scene canvas — gestures are filtered to this target */
  canvas: HTMLCanvasElement;
  /** Element to listen on in the capture phase (default: canvas.parentElement) */
  container?: HTMLElement;
  /** Sustained scroll (px) needed to leave a docked stop (default: 0).
   *
   *  ⚠ Defaulted to 320 until Plan 25. The detent existed because the scene took
   *  the wheel UNCONDITIONALLY: without a threshold a stray scroll yanked the
   *  camera, and the same accumulator doubled as the visitor's only escape from
   *  the trap. Engagement retired both jobs — the scene now owns the wheel only
   *  when the visitor deliberately switched it on, and leaving is the toggle,
   *  Escape, or a sustained scroll at the rail's end. What remained was pure
   *  friction before travel could start. A site can restore it by setting this. */
  detentThresholdPx?: number;
  /** Hold forward wheel at the tour's end behind the ~320px exit detent before
   *  reporting the release (default: true). Author mode passes false — an
   *  author's wheel at the end should reach the page with no door in the way,
   *  since the release callback never disengages authors and the detent would
   *  otherwise swallow their scroll forever. */
  holdAtEnd?: boolean;
  /** Accumulator decay in px/s while idle (default: 900) */
  accumulatorDecayPxPerSec?: number;
  /** Wheel px for a full 0→1 rail traversal (default: 4000) */
  wheelPxPerProgress?: number;
  /** Touch-drag px for a full 0→1 rail traversal (default: 2600) */
  touchPxPerProgress?: number;
  /** Yaw degrees per horizontal touch px in traveling/docked (default: 0.25) */
  yawDegPerPx?: number;
  onStateChange?: (state: ScrollRailState) => void;
  /** Leave-intent fill in [0,1] plus direction; fires on change and decay */
  onAccumulator?: (fill: number, direction: 1 | -1) => void;
  /** The wheel was handed BACK to the page because the rail has nowhere left to
   *  travel in `direction` (docked at an end). Fires only while this rail is
   *  actually claiming input — it reports a release, not a declined event. */
  onEndRelease?: (direction: 1 | -1) => void;
}

// ─── ScrollRail ───────────────────────────────────────────

export class ScrollRail {
  /** True when the device's primary pointer is coarse (touch) */
  readonly coarsePointer: boolean;

  private cameraRail: CameraRail;
  private cameraSystem: CameraSystem;
  private canvas: HTMLCanvasElement;
  private listenTarget: HTMLElement;
  private detentThresholdPx: number;
  private accumulatorDecay: number;
  private wheelPxPerProgress: number;
  private touchPxPerProgress: number;
  private yawDegPerPx: number;
  private onStateChangeCb: ((state: ScrollRailState) => void) | null;
  private onAccumulatorCb: ((fill: number, direction: 1 | -1) => void) | null;
  private onEndReleaseCb: ((direction: 1 | -1) => void) | null;

  private _state: ScrollRailState = "docked";
  private acc = 0;
  private accDir: 1 | -1 = 1;
  /** Separate accumulator for scroll spent AT a rail end, past which the
   *  release is reported (and D19 disengages). Distinct from `acc`, which is
   *  the leave-intent fill shown in the pill — this one drives no UI. */
  private endAcc = 0;
  private endAccDir: 1 | -1 = 1;
  /** Deliberate scroll needed at a rail END before the release is reported.
   *  MUST stay independent of `detentThresholdPx`: that one now defaults to 0
   *  so travel starts instantly, but leaving must still take intent, or a
   *  visitor who engages while parked at the last stop is ejected by their very
   *  next tick — the exact defect this threshold was introduced to fix. */
  private readonly endReleaseThresholdPx = 320;
  private holdAtEnd: boolean;
  private gesture: {
    id: number;
    axis: "pending" | "vertical" | "horizontal";
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
  } | null = null;
  private disposed = false;
  /** Per-stop `explore` policy (Plan 24 Task 3). Defaults reproduce today's
   *  behavior exactly, so a site with no `explore` authored is unaffected. */
  private travelEnabled = true;
  private orbitAllowed = true;
  /** Master switch — does this rail claim ANY input (Plan 25 engagement model).
   *  Default true = today's behavior. When false the rail claims nothing: no
   *  wheel preventDefault, no touch gesture, no direct yaw write. */
  private captureEnabled = true;
  /** Control flags captured the moment THIS rail suppressed orbit, so the restore
   *  puts back exactly what was there rather than assuming `true` and clobbering
   *  a value someone else set. Null means "not currently suppressing". */
  private preLock: { rotate: boolean; zoom: boolean } | null = null;

  constructor(config: ScrollRailConfig) {
    this.cameraRail = config.cameraRail;
    this.cameraSystem = config.cameraSystem;
    this.canvas = config.canvas;
    this.listenTarget = config.container ?? config.canvas.parentElement ?? config.canvas;
    this.detentThresholdPx = config.detentThresholdPx ?? 0;
    this.holdAtEnd = config.holdAtEnd ?? true;
    this.accumulatorDecay = config.accumulatorDecayPxPerSec ?? 900;
    this.wheelPxPerProgress = config.wheelPxPerProgress ?? 4000;
    this.touchPxPerProgress = config.touchPxPerProgress ?? 2600;
    this.yawDegPerPx = config.yawDegPerPx ?? 0.25;
    this.onStateChangeCb = config.onStateChange ?? null;
    this.onAccumulatorCb = config.onAccumulator ?? null;
    this.onEndReleaseCb = config.onEndRelease ?? null;
    this.coarsePointer = window.matchMedia("(pointer: coarse)").matches;

    this.listenTarget.addEventListener("wheel", this.onWheel, {
      passive: false,
      capture: true,
    });
    this.listenTarget.addEventListener("pointerdown", this.onPointerDown, { capture: true });
    this.listenTarget.addEventListener("pointermove", this.onPointerMove, { capture: true });
    this.listenTarget.addEventListener("pointerup", this.onPointerEnd, { capture: true });
    this.listenTarget.addEventListener("pointercancel", this.onPointerEnd, { capture: true });

    this.applyRotatePolicy();
  }

  // ─── Public API ───────────────────────────────────────────

  get state(): ScrollRailState {
    return this._state;
  }

  /** Current leave-intent fill in [0,1]. Zero when there is no detent to fill —
   *  guarding the divide, which would otherwise be Infinity and peg the pill. */
  get accumulatorFill(): number {
    if (this.detentThresholdPx <= 0) return 0;
    return Math.min(1, this.acc / this.detentThresholdPx);
  }

  /** Call from CameraRail's onStopArrived — arrival is the detent. */
  dock(): void {
    this.acc = 0;
    // Arriving anywhere clears the at-the-end scroll: a visitor who travelled
    // away from an end and back should have to earn the release again.
    this.endAcc = 0;
    this.setState("docked");
  }

  /**
   * Re-arm the leave detent at runtime (Plan 25 re-test, author's arrival-buffer
   * idea). A LOCKED stop wants "lock the scroll into place temporarily" — the
   * same one-flick door the tour's end already has — while every other stop keeps
   * the configured value (default 0, travel starts on the first tick).
   *
   * Changing the threshold invalidates whatever is already in the accumulator
   * (it was measured against the old door), so it is zeroed and reported — the
   * consumer's pill must not be left showing a fill against a threshold that no
   * longer exists.
   */
  setDetentThresholdPx(px: number): void {
    const next = Math.max(0, px);
    if (this.detentThresholdPx === next) return;
    this.detentThresholdPx = next;
    this.acc = 0;
    this.onAccumulatorCb?.(0, this.accDir);
  }

  /** Explicit explore toggle (the mobile chip). */
  setExplore(on: boolean): void {
    // Partial leave-intent must not survive a mode change and release early on
    // the far side of it.
    this.endAcc = 0;
    this.setState(on ? "explore" : "docked");
  }

  /**
   * Switch 1 — does INPUT drive the rail.
   *
   * When false, wheel/touch never fill the leave accumulator and the rail can
   * never enter "traveling" from input. Programmatic `goToStop` still works —
   * this gates INPUT, not navigation. Default true (today's behavior).
   */
  setTravelEnabled(on: boolean): void {
    if (this.travelEnabled === on) return;
    this.travelEnabled = on;
    this.endAcc = 0;
    if (!on && this.acc > 0) {
      // A half-filled leave-intent indicator must not freeze on screen when the
      // mechanism behind it is switched off.
      this.acc = 0;
      this.onAccumulatorCb?.(0, this.accDir);
    }
  }

  /**
   * Switch 0 — does this rail claim input AT ALL.
   *
   * The page owns input until the visitor engages the scene. Turning capture off
   * mid-gesture must also drop what is already in flight: the leave accumulator
   * (or its pill would freeze half-filled) and the active touch gesture (or the
   * next pointermove would still yaw the camera).
   */
  setCaptureEnabled(on: boolean): void {
    if (this.captureEnabled === on) return;
    this.captureEnabled = on;
    if (on) return;
    this.gesture = null;
    this.endAcc = 0;
    if (this.acc > 0) {
      this.acc = 0;
      this.onAccumulatorCb?.(0, this.accDir);
    }
  }

  /**
   * Switch 2 — can the visitor look around. Independent of travel: `bounded`
   * allows both, `locked` allows neither, `free` allows orbit but not travel.
   */
  setOrbitAllowed(on: boolean): void {
    // ⚠ NO same-value guard. The engagement model writes `controls.enableRotate`
    // directly when the visitor leaves and re-enters tour, so this rail's cached
    // `orbitAllowed` can be correct while the CONTROLS have drifted — a locked
    // stop would come back from Explore rotatable. Re-applying unconditionally is
    // the only way the policy survives a mode round-trip.
    //
    // Safe for `preLock`: the capture in applyRotatePolicy is itself guarded by
    // `preLock === null`, so a repeated lock re-asserts rotate/zoom=false without
    // overwriting what was captured at the FIRST lock, and a repeated unlock
    // restores-then-nulls exactly once.
    this.orbitAllowed = on;
    this.applyRotatePolicy();
  }

  /** Call every frame — decays the leave-intent accumulator. */
  update(deltaTime: number): void {
    if (this.disposed || this.acc <= 0 || this._state === "traveling") return;
    this.acc = Math.max(0, this.acc - this.accumulatorDecay * deltaTime);
    this.onAccumulatorCb?.(this.accumulatorFill, this.accDir);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listenTarget.removeEventListener("wheel", this.onWheel, { capture: true });
    this.listenTarget.removeEventListener("pointerdown", this.onPointerDown, { capture: true });
    this.listenTarget.removeEventListener("pointermove", this.onPointerMove, { capture: true });
    this.listenTarget.removeEventListener("pointerup", this.onPointerEnd, { capture: true });
    this.listenTarget.removeEventListener("pointercancel", this.onPointerEnd, { capture: true });
    // Put back anything this rail suppressed before the historical unconditional
    // rotate restore, or a torn-down locked stop would leave zoom off forever.
    if (this.preLock !== null) {
      this.cameraSystem.controls.enableZoom = this.preLock.zoom;
      this.preLock = null;
    }
    this.cameraSystem.controls.enableRotate = true;
  }

  // ─── State ────────────────────────────────────────────────

  private setState(state: ScrollRailState): void {
    if (state === this._state) return;
    this._state = state;
    this.applyRotatePolicy();
    this.onStateChangeCb?.(state);
  }

  /**
   * On coarse-pointer devices, single-touch orbit belongs to
   * OrbitControls only in explore mode — traveling/docked own the thumb
   * (vertical = travel, horizontal = manual yaw nudge). Desktop rotate
   * is otherwise never restricted.
   *
   * ⚠ The `orbitAllowed` gate is checked BEFORE the coarse-pointer early return,
   * or `explore: "locked"` would silently fail to lock desktop — the historical
   * early return exists to leave desktop rotate alone, which is exactly what a
   * locked stop must not do.
   */
  /** True when the rail has nowhere left to travel in `direction` — the first
   *  stop going back, or the last stop going forward. */
  private atRailEnd(direction: 1 | -1): boolean {
    const rail = this.cameraRail;
    return (
      (direction > 0 && rail.currentStop >= rail.stopCount - 1) ||
      (direction < 0 && rail.currentStop <= 0)
    );
  }

  private applyRotatePolicy(): void {
    const controls = this.cameraSystem.controls;
    if (!this.orbitAllowed) {
      if (this.preLock === null) {
        this.preLock = { rotate: controls.enableRotate, zoom: controls.enableZoom };
      }
      controls.enableRotate = false;
      // Zoom goes with it. `locked` means "held on the view", and a stop the
      // visitor can still dolly is not held. It is ALSO what lets the host page
      // keep its own scroll over a locked stop: measured, OrbitControls
      // preventDefaults the wheel only while zoom is enabled, so this rail
      // declining to swallow the event is necessary but not sufficient on its own.
      controls.enableZoom = false;
      return;
    }
    // Undo OUR suppression only, back to the captured values. Writing `true`
    // unconditionally would be a behavior change: on a fine pointer this branch
    // historically wrote nothing at all, so an external consumer that disabled
    // rotate for its own reasons would find it silently re-enabled on the next
    // rail state change.
    if (this.preLock !== null) {
      controls.enableRotate = this.preLock.rotate;
      controls.enableZoom = this.preLock.zoom;
      this.preLock = null;
    }
    if (!this.coarsePointer) return; // desktop rotate is otherwise never restricted
    controls.enableRotate = this._state === "explore";
  }

  // ─── Wheel ────────────────────────────────────────────────

  private onWheel = (e: WheelEvent): void => {
    if (this.disposed || e.target !== this.canvas) return;
    // Capture gate FIRST — before any preventDefault. A disengaged scene must
    // leave the wheel entirely to the page.
    if (!this.captureEnabled) return;
    if (e.ctrlKey || e.metaKey) return; // pinch/ctrl zoom passes to OrbitControls
    // Travel gate BEFORE preventDefault: a locked stop that still swallowed the
    // wheel would trap the visitor on the hero with a page that refuses to
    // scroll — the exact §5.5 failure this switch exists to fix. Mid-travel is
    // exempt so an in-flight scrub can still be completed.
    if (!this.travelEnabled && this._state !== "traveling") return;
    // ⚠ END-OF-RAIL RELEASE — also decided before preventDefault.
    //
    // `accumulate` already knew there is "no detent to leave through at the
    // ends", but it learned that AFTER the event had been consumed, so the wheel
    // was swallowed with nothing to do. Measured on the portfolio hero: parked at
    // the last stop, 30 consecutive wheel events were ALL preventDefault-ed and
    // the page's scroll position never moved off 0 — the visitor could not reach
    // the prose below by scrolling, ever.
    //
    // Past the end of the rail the scene has nothing further to show in that
    // direction, so the wheel belongs to the PAGE. Returning before
    // preventDefault is what hands it back.
    const rawDelta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    // ⚠ Ignore events with no meaningful VERTICAL component. A horizontal-only
    // wheel (deltaX set, deltaY exactly 0) would otherwise be classified as
    // BACKWARD by `rawDelta > 0 ? 1 : -1` and — now that the detent defaults to
    // 0 — immediately start a backward scrub. Sub-pixel trackpad noise did the
    // same. The rail owns the vertical axis only; anything else is not ours.
    if (Math.abs(rawDelta) < MIN_WHEEL_DELTA_PX) return;
    const dir: 1 | -1 = rawDelta > 0 ? 1 : -1;
    if (this._state !== "traveling" && this.atRailEnd(dir)) {
      if (this.acc > 0) {
        this.acc = 0;
        this.onAccumulatorCb?.(0, this.accDir);
      }
      // ⚠ THE EXIT DETENT (author's ruling 2026-08-03, symmetric with touch):
      // continued FORWARD scroll at the tour's end is held for ~320px — one
      // flick, three notches — then the release fires, the consumer disengages,
      // and the SAME motion flows into the page (the crossing event is not
      // consumed, and every event after it reaches the page natively). One
      // door, identical on wheel and finger, judged by the dry run.
      // Backward at the FIRST stop is not a door — it releases to the page
      // immediately, or a scene embedded mid-page would trap upward scrolling
      // behind a detent that never disengages (disengage is forward-only).
      if (dir === 1 && this.holdAtEnd && this.captureEnabled && this.travelEnabled) {
        this.noteEndRelease(dir, Math.abs(rawDelta));
        // The callback may have disengaged us synchronously (capture off) —
        // let THIS event through so the flick continues into page scroll.
        if (!this.captureEnabled) return;
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    // The detent swallows scroll while the arrival settle plays: scrubbing
    // would cancel the settle and strand the camera off the authored view,
    // and the forced beat keeps fast scrolling from blowing through stops.
    if (this.cameraRail.settling) return;
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    if (this._state === "traveling") {
      this.scrub(delta / this.wheelPxPerProgress);
    } else {
      this.accumulate(Math.abs(delta), delta > 0 ? 1 : -1);
    }
  };

  // ─── Touch ────────────────────────────────────────────────

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.shouldClaimTouch(e)) return;
    if (this.gesture) return; // single-gesture policy while touring
    e.stopPropagation();
    this.gesture = {
      id: e.pointerId,
      axis: "pending",
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
    };
  };

  private onPointerMove = (e: PointerEvent): void => {
    const g = this.gesture;
    if (!g || e.pointerId !== g.id) return;
    if (!this.shouldClaimTouch(e)) return;
    e.stopPropagation();

    if (g.axis === "pending") {
      const tx = e.clientX - g.startX;
      const ty = e.clientY - g.startY;
      if (Math.hypot(tx, ty) < 10) return;
      g.axis = Math.abs(ty) >= Math.abs(tx) ? "vertical" : "horizontal";
    }

    const dx = e.clientX - g.lastX;
    const dy = e.clientY - g.lastY;
    g.lastX = e.clientX;
    g.lastY = e.clientY;

    if (g.axis === "vertical") {
      if (this.cameraRail.settling) return; // detent beat — see onWheel
      if (this._state === "traveling") {
        // swipe up = move forward, mirroring page-scroll direction
        this.scrub(-dy / this.touchPxPerProgress);
      } else if (Math.abs(dy) >= MIN_WHEEL_DELTA_PX) {
        // ⚠ Same guard as the wheel, and for the same reason: `dy === 0`
        // sign-classifies as BACKWARD, and with the detent defaulting to 0 that
        // starts a backward scrub from a move that had no vertical component at
        // all. Touch hits this constantly — a finger held still after a swipe
        // keeps emitting same-Y pointermoves, so it is the common case, not an
        // edge case.
        this.accumulate(Math.abs(dy), dy < 0 ? 1 : -1);
      }
    } else {
      // ⚠ This path writes the camera DIRECTLY and therefore bypasses
      // `controls.enableRotate` entirely — disabling rotate does not disable
      // this. `locked` must gate it explicitly or a locked stop still yaws
      // under a horizontal thumb drag.
      // Capture is also checked here, not only in shouldClaimTouch: capture can be
      // switched off MID-gesture, and this path writes the camera directly.
      if (!this.orbitAllowed || !this.captureEnabled) return;
      const st = this.cameraSystem.getState();
      st.yaw -= dx * this.yawDegPerPx;
      this.cameraSystem.setState(st);
    }
  };

  private onPointerEnd = (e: PointerEvent): void => {
    const g = this.gesture;
    if (!g || e.pointerId !== g.id) return;
    this.gesture = null;
    if (this.shouldClaimTouch(e)) e.stopPropagation();
  };

  private shouldClaimTouch(e: PointerEvent): boolean {
    // ⚠ Only decline when BOTH switches are off. Declining merely because travel
    // is off would break `free`, where travel is off but the thumb must still
    // reach OrbitControls — and `free` already routes touch there by sitting in
    // the "explore" state, which the check below declines anyway. It is `locked`
    // (both off) that must hand the gesture back to the page rather than
    // stopPropagation it into nothing.
    if (!this.captureEnabled) return false; // disengaged: the page owns the thumb
    if (!this.travelEnabled && !this.orbitAllowed) return false;
    return (
      !this.disposed &&
      e.pointerType === "touch" &&
      this._state !== "explore" &&
      (e.target === this.canvas || this.gesture?.id === e.pointerId)
    );
  }

  // ─── Mechanics ────────────────────────────────────────────

  /** Accumulate input spent AT a rail end and report the release once it is
   *  deliberate (~320px — one flick, three wheel notches). Shared by wheel and
   *  touch: the exit door is the same gesture on both, per the author's
   *  2026-08-03 symmetry ruling. */
  private noteEndRelease(direction: 1 | -1, px: number): void {
    if (direction !== this.endAccDir) {
      this.endAcc = 0;
      this.endAccDir = direction;
    }
    this.endAcc += px;
    if (this.endAcc >= this.endReleaseThresholdPx) {
      this.endAcc = 0;
      this.onEndReleaseCb?.(direction);
    }
  }

  /**
   * Advance progress with detent capture: a scrub step never jumps
   * through a stop — it lands exactly on it, which is what triggers
   * CameraRail's at-stop detection (|p − stop| < 0.001) and therefore
   * the settle → arrival → dock chain. Without this, coarse wheel
   * steps overshoot stop positions and detents never fire.
   */
  private scrub(deltaProgress: number): void {
    const rail = this.cameraRail;
    const from = rail.progress;
    let to = Math.max(0, Math.min(1, from + deltaProgress));
    const n = rail.stopCount;
    if (n >= 2) {
      const eps = 1e-6;
      if (deltaProgress > 0) {
        for (let i = 0; i < n; i++) {
          const sp = i / (n - 1);
          if (from < sp - eps && to >= sp - eps) {
            to = sp;
            break;
          }
        }
      } else {
        for (let i = n - 1; i >= 0; i--) {
          const sp = i / (n - 1);
          if (from > sp + eps && to <= sp + eps) {
            to = sp;
            break;
          }
        }
      }
    }
    rail.setProgress(to);
  }

  private accumulate(px: number, direction: 1 | -1): void {
    // The travel-off switch. Zero the accumulator and report it so a half-filled
    // leave-intent indicator cannot freeze on screen.
    if (!this.travelEnabled) {
      // Zero and report unconditionally: a half-filled leave-intent indicator
      // must never be left frozen on screen when the mechanism behind it is off.
      this.acc = 0;
      this.onAccumulatorCb?.(0, direction);
      return;
    }
    // No detent to leave through at the ends. `onWheel` checks this BEFORE
    // consuming the event so the wheel reaches the page; this remains the guard
    // for the TOUCH path, which routes here directly.
    if (this.atRailEnd(direction)) {
      if (this.acc > 0) {
        this.acc = 0;
        this.onAccumulatorCb?.(0, direction);
      }
      // ⚠ Touch is the ONE place the release is reported. The canvas carries
      // `touch-action: none` while engaged, so there is no native page scroll
      // to fall back on: without this, a visitor engaged at the final stop on a
      // phone has NO way out by dragging. ~320px of sustained drag = intent.
      this.noteEndRelease(direction, px);
      return;
    }
    const rail = this.cameraRail;
    if (direction !== this.accDir) {
      this.acc = 0;
      this.accDir = direction;
    }
    this.acc += px;
    if (this.acc >= this.detentThresholdPx) {
      this.acc = 0;
      this.onAccumulatorCb?.(0, direction);
      // ⚠ REMOVED 2026-08-02 — reduced motion used to cutToStop() here, which is
      // why scrolling teleported between stops instead of travelling.
      //
      // Two reasons it was wrong. The travel IS the tour: cutting deletes the
      // spatial relationship between viewpoints, which is the whole product.
      // And this path is SCROLL-DRIVEN — the visitor sets the pace and can stop
      // at any instant, which is the form of motion reduced-motion guidance
      // treats as safe; the rule targets autoplaying and parallax motion the
      // visitor cannot control. Programmatic navigation, which the visitor does
      // NOT pace, still softens via planTravel's slower flight.
      this.setState("traveling");
      this.scrub(direction * 0.015); // nudge off the detent so travel visibly begins
    } else {
      this.onAccumulatorCb?.(this.accumulatorFill, direction);
    }
  }
}
