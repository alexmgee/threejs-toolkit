import type { VisibilityPhase } from "./events";
import { weightedDelta } from "./convergence";

export type LifecycleEvent =
  | { readonly type: "visibilitychange"; readonly eventTimeMs: number; readonly visible: boolean }
  | { readonly type: "focus"; readonly eventTimeMs: number }
  | { readonly type: "blur"; readonly eventTimeMs: number }
  | { readonly type: "freeze"; readonly eventTimeMs: number }
  | { readonly type: "resume"; readonly eventTimeMs: number }
  | { readonly type: "pagehide"; readonly eventTimeMs: number; readonly persisted: boolean }
  | { readonly type: "pageshow"; readonly eventTimeMs: number; readonly persisted: boolean };

export interface LifecycleTransition {
  readonly previousPhase: VisibilityPhase;
  readonly phase: VisibilityPhase;
  readonly event: LifecycleEvent;
  readonly elapsedDurationMs: number;
  readonly foregroundVisibleDurationMs: number;
  readonly breaksComparability: boolean;
  readonly shouldCheckpoint: boolean;
  readonly shouldPause: boolean;
  readonly shouldResume: boolean;
  readonly reconciled: boolean;
  readonly nonPersistedExit: boolean;
  readonly suspendedAtMs?: number;
}

export interface VisibilitySnapshot {
  readonly phase: VisibilityPhase;
  readonly elapsedDurationMs: number;
  readonly foregroundVisibleDurationMs: number;
  readonly nonComparableSpans: readonly Readonly<{ startMs: number; endMs: number; reason: string }>[];
  readonly suspendedAtMs?: number;
  readonly nonPersistedExit: boolean;
}

export class VisibilityObserver {
  private phaseValue: VisibilityPhase;
  private readonly startedAtMs: number;
  private previousEventTimeMs: number;
  private foregroundVisibleDurationMs = 0;
  private hiddenSpanStartMs: number | undefined;
  private suspendedAtMs: number | undefined;
  private visible: boolean;
  private focused: boolean;
  private nonPersistedExitValue = false;
  private readonly nonComparableSpans: Array<{ startMs: number; endMs: number; reason: string }> = [];

  constructor(startedAtMs: number, initiallyVisible = true, initiallyFocused = true) {
    this.startedAtMs = startedAtMs;
    this.previousEventTimeMs = startedAtMs;
    this.visible = initiallyVisible;
    this.focused = initiallyFocused;
    this.phaseValue = initiallyVisible
      ? (initiallyFocused ? "foreground_visible" : "foreground_blurred")
      : "hidden";
    if (!initiallyVisible) this.hiddenSpanStartMs = startedAtMs;
  }

  get phase(): VisibilityPhase {
    return this.phaseValue;
  }

  handle(event: Readonly<LifecycleEvent>): Readonly<LifecycleTransition> {
    const previousPhase = this.phaseValue;
    const atMs = Math.max(this.previousEventTimeMs, event.eventTimeMs);
    if (previousPhase === "foreground_visible") {
      this.foregroundVisibleDurationMs += weightedDelta(this.previousEventTimeMs, atMs);
    }
    this.previousEventTimeMs = atMs;

    let shouldCheckpoint = false;
    let shouldPause = false;
    let shouldResume = false;
    let reconciled = false;
    let transitionSuspendedAtMs = this.suspendedAtMs;

    switch (event.type) {
      case "visibilitychange":
        this.visible = event.visible;
        if (event.visible) {
          this.closeNonComparableSpan(atMs, "hidden");
          this.phaseValue = this.focused ? "foreground_visible" : "foreground_blurred";
        } else {
          this.openNonComparableSpan(atMs);
          this.phaseValue = "hidden";
        }
        break;
      case "focus":
        this.focused = true;
        if (this.phaseValue === "foreground_blurred") this.phaseValue = "foreground_visible";
        break;
      case "blur":
        this.focused = false;
        if (this.phaseValue === "foreground_visible") this.phaseValue = "foreground_blurred";
        break;
      case "freeze":
        this.openNonComparableSpan(atMs);
        this.phaseValue = "frozen";
        shouldPause = true;
        break;
      case "resume":
        this.closeNonComparableSpan(atMs, "frozen");
        this.phaseValue = this.visible ? (this.focused ? "foreground_visible" : "foreground_blurred") : "hidden";
        shouldResume = true;
        break;
      case "pagehide":
        this.openNonComparableSpan(atMs);
        if (event.persisted) {
          this.phaseValue = "suspended";
          this.suspendedAtMs = atMs;
          transitionSuspendedAtMs = atMs;
          shouldCheckpoint = true;
          shouldPause = true;
        } else {
          this.phaseValue = "hidden";
          this.nonPersistedExitValue = true;
        }
        break;
      case "pageshow":
        if (event.persisted && this.suspendedAtMs !== undefined) {
          transitionSuspendedAtMs = this.suspendedAtMs;
          this.closeNonComparableSpan(atMs, "suspension");
          this.phaseValue = this.visible ? (this.focused ? "foreground_visible" : "foreground_blurred") : "hidden";
          shouldResume = true;
          reconciled = true;
        }
        break;
    }

    return Object.freeze({
      previousPhase,
      phase: this.phaseValue,
      event,
      elapsedDurationMs: Math.max(0, atMs - this.startedAtMs),
      foregroundVisibleDurationMs: this.foregroundVisibleDurationMs,
      breaksComparability: isNonComparable(previousPhase) || isNonComparable(this.phaseValue),
      shouldCheckpoint,
      shouldPause,
      shouldResume,
      reconciled,
      nonPersistedExit: this.nonPersistedExitValue,
      ...(transitionSuspendedAtMs === undefined ? {} : { suspendedAtMs: transitionSuspendedAtMs }),
    });
  }

  snapshot(atMs = this.previousEventTimeMs): Readonly<VisibilitySnapshot> {
    const boundedAtMs = Math.max(this.previousEventTimeMs, atMs);
    const foreground = this.foregroundVisibleDurationMs
      + (this.phaseValue === "foreground_visible" ? weightedDelta(this.previousEventTimeMs, boundedAtMs) : 0);
    const spans = [...this.nonComparableSpans];
    if (this.hiddenSpanStartMs !== undefined) {
      spans.push({ startMs: this.hiddenSpanStartMs, endMs: boundedAtMs, reason: "open_non_comparable_interval" });
    }
    return Object.freeze({
      phase: this.phaseValue,
      elapsedDurationMs: Math.max(0, boundedAtMs - this.startedAtMs),
      foregroundVisibleDurationMs: foreground,
      nonComparableSpans: Object.freeze(spans.map((span) => Object.freeze({ ...span }))),
      ...(this.suspendedAtMs === undefined ? {} : { suspendedAtMs: this.suspendedAtMs }),
      nonPersistedExit: this.nonPersistedExitValue,
    });
  }

  private openNonComparableSpan(atMs: number): void {
    this.hiddenSpanStartMs ??= atMs;
  }

  private closeNonComparableSpan(atMs: number, reason: string): void {
    if (this.hiddenSpanStartMs === undefined) return;
    this.nonComparableSpans.push({ startMs: this.hiddenSpanStartMs, endMs: atMs, reason });
    this.hiddenSpanStartMs = undefined;
    this.suspendedAtMs = undefined;
  }
}

function isNonComparable(phase: VisibilityPhase): boolean {
  return phase === "hidden" || phase === "frozen" || phase === "suspended";
}
