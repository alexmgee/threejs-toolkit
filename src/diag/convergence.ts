import type { TerminalOutcome } from "./events";
import { DEFAULT_CONVERGENCE_POLICY } from "./policies";

export interface ConvergenceRuntimePolicy {
  readonly version: string;
  readonly recentWindowMs: number;
  readonly stallWindowMs: number;
  readonly maxForegroundObservationMs: number;
  readonly candidateDwellMs: number;
  readonly maxObservationGapMs: number;
}

export type ConvergenceState = "observing" | "candidate" | TerminalOutcome;

export interface ConvergenceObservation {
  readonly eventTimeMs: number;
  readonly foregroundVisible: boolean;
  readonly stableCameraEpoch: boolean;
  readonly adapterValid: boolean;
  readonly requiredReadingsValid: boolean;
  readonly workingSetStable: boolean;
  readonly relevantOutstanding: boolean;
  readonly recentContradictoryEvent: boolean;
  readonly coarsePageLikelihood: number;
  readonly coarsePageThreshold: number;
  readonly validatedVisibleCoarseness: boolean;
  readonly qualifyingProgress: boolean;
}

export interface ConvergenceTransition {
  readonly state: ConvergenceState;
  readonly outcome?: TerminalOutcome;
  readonly candidateDwellMs: number;
  readonly foregroundObservationMs: number;
  readonly gapBrokeDwell: boolean;
  readonly provableStall: boolean;
}

export interface FinalEvidence {
  readonly adapterInvalidBeforeProof: boolean;
  readonly laterDependsOnPager: boolean;
  readonly convergedProven: boolean;
  readonly nonPersistedPageHide: boolean;
  readonly disposed: boolean;
  readonly endedHidden: boolean;
  readonly confirmedMotionInvalidatedCandidate: boolean;
  readonly laterQualified: boolean;
  readonly provableStall: boolean;
  readonly maximumWindowExpired: boolean;
}

export function resolveTerminal(evidence: Readonly<FinalEvidence>): TerminalOutcome {
  if (evidence.adapterInvalidBeforeProof && evidence.laterDependsOnPager) return "adapter_invalid";
  if (evidence.convergedProven) return "converged";
  if (evidence.nonPersistedPageHide || evidence.disposed) return "abandoned";
  if (evidence.endedHidden) return "hidden";
  if (evidence.confirmedMotionInvalidatedCandidate && !evidence.laterQualified) return "camera_invalidated";
  if (evidence.provableStall) return "stalled";
  if (evidence.maximumWindowExpired) return "timed_out";
  return "insufficient_stable_observation";
}

export function weightedDelta(previousMs: number, nextMs: number, maximumGapMs: number = DEFAULT_CONVERGENCE_POLICY.maxObservationGapMs): number {
  const gap = Math.max(0, nextMs - previousMs);
  return Math.min(gap, maximumGapMs);
}

export class ConvergenceObserver {
  private stateValue: ConvergenceState = "observing";
  private previousTimeMs: number | undefined;
  private candidateDwellMs = 0;
  private foregroundObservationMs = 0;
  private stallEvidenceMs = 0;
  private convergedProven = false;
  private provableStallValue = false;
  private maximumWindowExpiredValue = false;
  private candidateInvalidatedByMotionValue = false;
  private laterQualifiedValue = false;

  constructor(private readonly policy: Readonly<ConvergenceRuntimePolicy> = DEFAULT_CONVERGENCE_POLICY) {}

  get state(): ConvergenceState {
    return this.stateValue;
  }

  get evidence(): Readonly<Pick<FinalEvidence,
    "convergedProven" | "provableStall" | "maximumWindowExpired" |
    "confirmedMotionInvalidatedCandidate" | "laterQualified">> {
    return Object.freeze({
      convergedProven: this.convergedProven,
      provableStall: this.provableStallValue,
      maximumWindowExpired: this.maximumWindowExpiredValue,
      confirmedMotionInvalidatedCandidate: this.candidateInvalidatedByMotionValue,
      laterQualified: this.laterQualifiedValue,
    });
  }

  observe(observation: Readonly<ConvergenceObservation>): Readonly<ConvergenceTransition> {
    if (isTerminal(this.stateValue)) return this.transition(false);

    const previousTimeMs = this.previousTimeMs;
    const rawGap = previousTimeMs === undefined ? 0 : Math.max(0, observation.eventTimeMs - previousTimeMs);
    const boundedGap = previousTimeMs === undefined ? 0 : weightedDelta(previousTimeMs, observation.eventTimeMs, this.policy.maxObservationGapMs);
    const gapBrokeDwell = rawGap > this.policy.maxObservationGapMs;
    this.previousTimeMs = Math.max(previousTimeMs ?? observation.eventTimeMs, observation.eventTimeMs);

    if (observation.foregroundVisible) this.foregroundObservationMs += boundedGap;
    this.maximumWindowExpiredValue = this.foregroundObservationMs >= this.policy.maxForegroundObservationMs;

    const allCandidateConditions = observation.foregroundVisible
      && observation.stableCameraEpoch
      && observation.adapterValid
      && observation.requiredReadingsValid
      && observation.workingSetStable
      && !observation.relevantOutstanding
      && !observation.recentContradictoryEvent
      && Number.isFinite(observation.coarsePageLikelihood)
      && observation.coarsePageLikelihood < observation.coarsePageThreshold;

    if (this.stateValue === "candidate") {
      if (gapBrokeDwell || !allCandidateConditions) {
        this.stateValue = "observing";
        this.candidateDwellMs = 0;
      } else {
        this.candidateDwellMs += rawGap;
        if (this.candidateDwellMs >= this.policy.candidateDwellMs) {
          this.stateValue = "converged";
          this.convergedProven = true;
          this.laterQualifiedValue = this.candidateInvalidatedByMotionValue;
        }
      }
    } else if (allCandidateConditions) {
      this.stateValue = "candidate";
      this.candidateDwellMs = 0;
    }

    const stallPredicate = observation.foregroundVisible
      && observation.stableCameraEpoch
      && observation.adapterValid
      && observation.requiredReadingsValid
      && (observation.relevantOutstanding || observation.validatedVisibleCoarseness);
    if (!stallPredicate || observation.qualifyingProgress) {
      this.stallEvidenceMs = 0;
    } else {
      this.stallEvidenceMs += boundedGap;
    }
    this.provableStallValue = this.stallEvidenceMs >= this.policy.stallWindowMs;

    return this.transition(gapBrokeDwell);
  }

  breakDwellForHidden(): void {
    if (this.stateValue === "candidate") this.stateValue = "observing";
    this.candidateDwellMs = 0;
    this.stallEvidenceMs = 0;
    this.previousTimeMs = undefined;
  }

  invalidateCandidateForMotion(): void {
    if (this.stateValue === "candidate") this.candidateInvalidatedByMotionValue = true;
    if (!isTerminal(this.stateValue)) this.stateValue = "observing";
    this.candidateDwellMs = 0;
    this.stallEvidenceMs = 0;
  }

  private transition(gapBrokeDwell: boolean): Readonly<ConvergenceTransition> {
    return Object.freeze({
      state: this.stateValue,
      ...(isTerminal(this.stateValue) ? { outcome: this.stateValue } : {}),
      candidateDwellMs: this.candidateDwellMs,
      foregroundObservationMs: this.foregroundObservationMs,
      gapBrokeDwell,
      provableStall: this.provableStallValue,
    });
  }
}

function isTerminal(state: ConvergenceState): state is TerminalOutcome {
  return state !== "observing" && state !== "candidate";
}
