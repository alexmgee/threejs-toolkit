/**
 * CameraPath — Keyframe-based camera animation for SparkJS Toolkit
 *
 * Drives the CameraSystem through a sequence of keyframes, interpolating
 * yaw, pitch, distance, and pivot with configurable easing per segment.
 *
 * Workflow:
 *  1. Record keyframes with `recordKeyframe()` or add them manually
 *  2. Call `play()` to start playback from the first keyframe
 *  3. Call `update(dt)` every frame (in the animation loop)
 *  4. Serialize with `toJSON()` / `fromJSON()` for saving/loading paths
 */

import type { CameraSystem, CameraState } from "./CameraSystem";

// ─── Types ────────────────────────────────────────────────

/** A camera keyframe: a camera state plus a transition duration */
export interface CameraKeyframe extends CameraState {
  /** Duration in seconds to interpolate from the previous keyframe to this one.
   *  The first keyframe's duration is ignored (camera jumps there instantly). */
  duration: number;
}

/** Easing function: maps t in [0,1] to eased value in [0,1] */
export type EasingFn = (t: number) => number;

export interface CameraPathConfig {
  /** CameraSystem to drive during playback */
  cameraSystem: CameraSystem;
  /** Default easing function (default: cubic ease-out) */
  easing?: EasingFn;
  /** Callback when playback completes naturally (all segments finished) */
  onComplete?: () => void;
  /** Callback on each frame during playback — receives segment index and [0,1] progress */
  onProgress?: (segment: number, t: number) => void;
}

// ─── Default Easing ───────────────────────────────────────

/** Cubic ease-out: fast start, gentle deceleration */
const cubicEaseOut: EasingFn = (t: number) => 1 - Math.pow(1 - t, 3);

// ─── CameraPath ───────────────────────────────────────────

export class CameraPath {
  private cameraSystem: CameraSystem;
  private easing: EasingFn;
  private onCompleteCallback: (() => void) | null;
  private onProgressCallback: ((segment: number, t: number) => void) | null;

  // Keyframes
  private keyframes: CameraKeyframe[] = [];

  // Playback state
  private _playing = false;
  private segment = 0;
  private segmentElapsed = 0;
  private startYaw = 0;
  private startPitch = 0;
  private startDistance = 0;
  private startPivot = { x: 0, y: 0, z: 0 };

  get playing(): boolean {
    return this._playing;
  }

  get keyframeCount(): number {
    return this.keyframes.length;
  }

  get currentSegment(): number {
    return this.segment;
  }

  constructor(config: CameraPathConfig) {
    this.cameraSystem = config.cameraSystem;
    this.easing = config.easing ?? cubicEaseOut;
    this.onCompleteCallback = config.onComplete ?? null;
    this.onProgressCallback = config.onProgress ?? null;
  }

  // ─── Per-Frame Update ────────────────────────────────────

  /**
   * Call every frame from the animation loop.
   * Returns `true` if path is still playing, `false` if stopped/finished.
   */
  update(deltaTime: number): boolean {
    if (!this._playing) return false;

    const target = this.keyframes[this.segment + 1];
    if (!target) {
      this._playing = false;
      this.onCompleteCallback?.();
      return false;
    }

    this.segmentElapsed += deltaTime;
    const dur = target.duration || 2;
    const rawT = Math.min(this.segmentElapsed / dur, 1);
    const eased = this.easing(rawT);

    // Interpolate camera state
    const yaw = this.startYaw + (target.yaw - this.startYaw) * eased;
    const pitch = this.startPitch + (target.pitch - this.startPitch) * eased;
    const distance = this.startDistance + (target.distance - this.startDistance) * eased;
    const pivot = {
      x: this.startPivot.x + (target.pivot.x - this.startPivot.x) * eased,
      y: this.startPivot.y + (target.pivot.y - this.startPivot.y) * eased,
      z: this.startPivot.z + (target.pivot.z - this.startPivot.z) * eased,
    };

    this.cameraSystem.setState({ yaw, pitch, distance, pivot });
    this.onProgressCallback?.(this.segment, rawT);

    // Segment complete — advance
    if (rawT >= 1) {
      this.segment++;
      if (this.segment + 1 >= this.keyframes.length) {
        this._playing = false;
        this.onCompleteCallback?.();
        return false;
      }

      // Capture current state as the new start for the next segment
      this.segmentElapsed = 0;
      const state = this.cameraSystem.getState();
      this.startYaw = state.yaw;
      this.startPitch = state.pitch;
      this.startDistance = state.distance;
      this.startPivot = { ...state.pivot };
    }

    return true;
  }

  // ─── Keyframe Management ─────────────────────────────────

  /** Record the current camera state as a new keyframe */
  recordKeyframe(duration = 2): CameraKeyframe {
    const state = this.cameraSystem.getState();
    const keyframe: CameraKeyframe = {
      ...state,
      duration: this.keyframes.length === 0 ? 0 : duration,
    };
    this.keyframes.push(keyframe);
    return keyframe;
  }

  /** Add a keyframe manually */
  addKeyframe(keyframe: CameraKeyframe): void {
    this.keyframes.push({ ...keyframe });
  }

  /** Get all keyframes (returns a copy) */
  getKeyframes(): CameraKeyframe[] {
    return this.keyframes.map((kf) => ({ ...kf, pivot: { ...kf.pivot } }));
  }

  /** Replace all keyframes */
  setKeyframes(keyframes: CameraKeyframe[]): void {
    this.keyframes = keyframes.map((kf) => ({ ...kf, pivot: { ...kf.pivot } }));
    this.stop();
  }

  /** Update the duration of a specific keyframe by index */
  setKeyframeDuration(index: number, duration: number): void {
    if (this.keyframes[index]) {
      this.keyframes[index].duration = duration;
    }
  }

  /** Remove a keyframe by index */
  removeKeyframe(index: number): void {
    if (index >= 0 && index < this.keyframes.length) {
      this.keyframes.splice(index, 1);
    }
  }

  /** Clear all keyframes and stop playback */
  clear(): void {
    this.keyframes = [];
    this._playing = false;
  }

  // ─── Playback Control ────────────────────────────────────

  /** Start playback from the first keyframe. Requires >= 2 keyframes. */
  play(): boolean {
    if (this.keyframes.length < 2) return false;

    // Jump to first keyframe
    const first = this.keyframes[0];
    this.cameraSystem.setState(first);

    this.segment = 0;
    this.segmentElapsed = 0;
    this.startYaw = first.yaw;
    this.startPitch = first.pitch;
    this.startDistance = first.distance;
    this.startPivot = { ...first.pivot };
    this._playing = true;

    return true;
  }

  /** Stop playback at current position */
  stop(): void {
    this._playing = false;
  }

  // ─── Serialization ───────────────────────────────────────

  /** Serialize keyframes to JSON string */
  toJSON(): string {
    return JSON.stringify(this.keyframes, null, 2);
  }

  /** Deserialize and replace keyframes from JSON string */
  fromJSON(json: string): void {
    const parsed = JSON.parse(json) as CameraKeyframe[];
    this.setKeyframes(parsed);
  }

  // ─── Cleanup ─────────────────────────────────────────────

  dispose(): void {
    this._playing = false;
    this.keyframes = [];
  }
}
