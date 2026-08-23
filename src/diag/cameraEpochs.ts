import { DEFAULT_CAMERA_EPOCH_POLICY } from "./policies";

export interface CameraEpochRuntimePolicy {
  readonly version: string;
  readonly stableEpochMinimumMs: number;
  readonly translationCameraToPivotRatio: number;
  readonly rotationDegrees: number;
  readonly verticalFovDegrees: number;
  readonly viewportCssPx: number;
  readonly viewportRatio: number;
  readonly dpr: number;
  readonly foveation: number;
  readonly consecutiveMotionObservations: number;
  readonly stabilityResumeMs: number;
  readonly stabilityMedianWindowMs: number;
  readonly stabilityThresholdRatio: number;
}

export interface CameraState {
  readonly position: readonly [number, number, number];
  readonly quaternion: readonly [number, number, number, number];
  readonly projectionMatrix: readonly number[];
  readonly verticalFovDegrees: number;
  readonly viewportWidthCssPx: number;
  readonly viewportHeightCssPx: number;
  readonly dpr: number;
  readonly foveation: Readonly<Record<string, number>>;
  readonly pivot?: readonly [number, number, number];
  readonly sceneBoundsCenter?: readonly [number, number, number];
}

export interface CameraStateProvider {
  readCameraState(atMs: number): Readonly<CameraState> | undefined;
}

export type CameraEpochPhase = "stable" | "motion";

export interface CameraEpochObservation {
  readonly epochId: string;
  readonly phase: CameraEpochPhase;
  readonly eventTimeMs: number;
  readonly anchor: Readonly<CameraState>;
  readonly motionConfirmed: boolean;
  readonly stabilityResumed: boolean;
  readonly stableDurationMs: number;
  readonly eligibleForConvergence: boolean;
  readonly insufficientStableObservation: boolean;
  readonly declaredGaps: readonly string[];
  readonly reasons: readonly string[];
}

interface TimedState {
  readonly atMs: number;
  readonly state: Readonly<CameraState>;
}

export class CameraEpochObserver {
  private previous: TimedState | undefined;
  private history: TimedState[] = [];
  private anchor: Readonly<CameraState> | undefined;
  private epochIdValue = "camera-epoch-0";
  private epochSequence = 0;
  private stableSinceMs: number | undefined;
  private lowSinceMs: number | undefined;
  private phaseValue: CameraEpochPhase = "stable";
  private consecutiveHigh = 0;
  private sawEligibleStableEpoch = false;

  constructor(private readonly policy: Readonly<CameraEpochRuntimePolicy> = DEFAULT_CAMERA_EPOCH_POLICY) {}

  observe(eventTimeMs: number, state: Readonly<CameraState>): Readonly<CameraEpochObservation> {
    const normalized = normalizeCameraState(state);
    const declaredGaps = normalized.pivot
      ? []
      : normalized.sceneBoundsCenter
        ? ["scene_bounds_center_pivot_fallback"]
        : ["camera_pivot_unavailable"];
    const current = normalized.pivot ? normalized : Object.freeze({
      ...normalized,
      pivot: normalized.sceneBoundsCenter,
    });

    if (!this.previous) {
      this.anchor = current;
      this.stableSinceMs = eventTimeMs;
      this.previous = { atMs: eventTimeMs, state: current };
      this.history = [this.previous];
      return this.result(eventTimeMs, false, false, declaredGaps, []);
    }

    const previousDeltas = cameraDeltas(this.previous.state, current);
    const highReasons = thresholdReasons(previousDeltas, current, this.policy, 1);
    let motionConfirmed = false;
    let stabilityResumed = false;

    if (this.phaseValue === "stable") {
      this.consecutiveHigh = highReasons.length > 0 ? this.consecutiveHigh + 1 : 0;
      if (this.consecutiveHigh >= this.policy.consecutiveMotionObservations) {
        this.phaseValue = "motion";
        this.stableSinceMs = undefined;
        this.lowSinceMs = undefined;
        this.consecutiveHigh = 0;
        motionConfirmed = true;
      }
    } else {
      const medianBaseline = rollingMedianState(this.history, eventTimeMs, this.policy.stabilityMedianWindowMs);
      const low = medianBaseline !== undefined
        && thresholdReasons(cameraDeltas(medianBaseline, current), current, this.policy, this.policy.stabilityThresholdRatio).length === 0;
      if (low) {
        this.lowSinceMs ??= eventTimeMs;
        if (eventTimeMs - this.lowSinceMs >= this.policy.stabilityResumeMs) {
          this.phaseValue = "stable";
          this.epochSequence += 1;
          this.epochIdValue = `camera-epoch-${this.epochSequence}`;
          this.anchor = current;
          this.stableSinceMs = eventTimeMs;
          this.lowSinceMs = undefined;
          stabilityResumed = true;
        }
      } else {
        this.lowSinceMs = undefined;
      }
    }

    this.previous = { atMs: eventTimeMs, state: current };
    this.history.push(this.previous);
    const cutoff = eventTimeMs - this.policy.stabilityMedianWindowMs;
    while (this.history.length > 1 && this.history[0].atMs < cutoff) this.history.shift();

    return this.result(eventTimeMs, motionConfirmed, stabilityResumed, declaredGaps, highReasons);
  }

  finish(): Readonly<{ insufficientStableObservation: boolean }> {
    return Object.freeze({ insufficientStableObservation: !this.sawEligibleStableEpoch });
  }

  private result(
    eventTimeMs: number,
    motionConfirmed: boolean,
    stabilityResumed: boolean,
    declaredGaps: readonly string[],
    reasons: readonly string[],
  ): Readonly<CameraEpochObservation> {
    const stableDurationMs = this.phaseValue === "stable" && this.stableSinceMs !== undefined
      ? Math.max(0, eventTimeMs - this.stableSinceMs)
      : 0;
    const eligibleForConvergence = stableDurationMs >= this.policy.stableEpochMinimumMs;
    this.sawEligibleStableEpoch ||= eligibleForConvergence;
    return Object.freeze({
      epochId: this.epochIdValue,
      phase: this.phaseValue,
      eventTimeMs,
      anchor: this.anchor ?? this.previous?.state ?? Object.freeze({} as CameraState),
      motionConfirmed,
      stabilityResumed,
      stableDurationMs,
      eligibleForConvergence,
      insufficientStableObservation: !this.sawEligibleStableEpoch,
      declaredGaps: Object.freeze([...declaredGaps]),
      reasons: Object.freeze([...reasons]),
    });
  }
}

interface CameraDeltas {
  readonly translation: number;
  readonly rotationDegrees: number;
  readonly verticalFovDegrees: number;
  readonly viewportWidthCssPx: number;
  readonly viewportHeightCssPx: number;
  readonly dpr: number;
  readonly foveation: number;
}

function cameraDeltas(from: Readonly<CameraState>, to: Readonly<CameraState>): CameraDeltas {
  return {
    translation: distance(from.position, to.position),
    rotationDegrees: quaternionAngleDegrees(from.quaternion, to.quaternion),
    verticalFovDegrees: Math.abs(from.verticalFovDegrees - to.verticalFovDegrees),
    viewportWidthCssPx: Math.abs(from.viewportWidthCssPx - to.viewportWidthCssPx),
    viewportHeightCssPx: Math.abs(from.viewportHeightCssPx - to.viewportHeightCssPx),
    dpr: Math.abs(from.dpr - to.dpr),
    foveation: maximumRecordDelta(from.foveation, to.foveation),
  };
}

function thresholdReasons(deltas: CameraDeltas, current: Readonly<CameraState>, policy: Readonly<CameraEpochRuntimePolicy>, ratio: number): string[] {
  const pivotDistance = current.pivot ? distance(current.position, current.pivot) : 0;
  const reasons: string[] = [];
  if (deltas.translation > pivotDistance * policy.translationCameraToPivotRatio * ratio) reasons.push("translation");
  if (deltas.rotationDegrees > policy.rotationDegrees * ratio) reasons.push("rotation");
  if (deltas.verticalFovDegrees > policy.verticalFovDegrees * ratio) reasons.push("vertical_fov");
  const widthThreshold = Math.min(policy.viewportCssPx, current.viewportWidthCssPx * policy.viewportRatio) * ratio;
  const heightThreshold = Math.min(policy.viewportCssPx, current.viewportHeightCssPx * policy.viewportRatio) * ratio;
  if (deltas.viewportWidthCssPx > widthThreshold || deltas.viewportHeightCssPx > heightThreshold) reasons.push("viewport");
  if (deltas.dpr > policy.dpr * ratio) reasons.push("dpr");
  if (deltas.foveation > policy.foveation * ratio) reasons.push("foveation");
  return reasons;
}

function rollingMedianState(history: readonly TimedState[], atMs: number, windowMs: number): Readonly<CameraState> | undefined {
  const preceding = history.filter((entry) => entry.atMs >= atMs - windowMs && entry.atMs < atMs).map((entry) => entry.state);
  if (preceding.length === 0) return undefined;
  const first = preceding[0];
  const foveationKeys = [...new Set(preceding.flatMap((state) => Object.keys(state.foveation)))];
  return Object.freeze({
    position: tuple3([0, 1, 2].map((index) => median(preceding.map((state) => state.position[index])))),
    quaternion: normalizeQuaternion(tuple4([0, 1, 2, 3].map((index) => median(preceding.map((state) => state.quaternion[index]))))),
    projectionMatrix: first.projectionMatrix,
    verticalFovDegrees: median(preceding.map((state) => state.verticalFovDegrees)),
    viewportWidthCssPx: median(preceding.map((state) => state.viewportWidthCssPx)),
    viewportHeightCssPx: median(preceding.map((state) => state.viewportHeightCssPx)),
    dpr: median(preceding.map((state) => state.dpr)),
    foveation: Object.freeze(Object.fromEntries(foveationKeys.map((key) => [key, median(preceding.map((state) => state.foveation[key] ?? 0))]))),
    pivot: first.pivot,
    sceneBoundsCenter: first.sceneBoundsCenter,
  });
}

function normalizeCameraState(state: Readonly<CameraState>): Readonly<CameraState> {
  return Object.freeze({ ...state, quaternion: normalizeQuaternion(state.quaternion), foveation: Object.freeze({ ...state.foveation }) });
}

function quaternionAngleDegrees(a: readonly number[], b: readonly number[]): number {
  const dot = Math.min(1, Math.abs(a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0)));
  return 2 * Math.acos(dot) * 180 / Math.PI;
}

function normalizeQuaternion(value: readonly number[]): readonly [number, number, number, number] {
  const length = Math.hypot(...value) || 1;
  return tuple4(value.map((component) => component / length));
}

function maximumRecordDelta(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let maximum = 0;
  for (const key of keys) maximum = Math.max(maximum, Math.abs((a[key] ?? 0) - (b[key] ?? 0)));
  return maximum;
}

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(...a.map((value, index) => value - (b[index] ?? 0)));
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function tuple3(value: readonly number[]): readonly [number, number, number] {
  return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0];
}

function tuple4(value: readonly number[]): readonly [number, number, number, number] {
  return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 1];
}
