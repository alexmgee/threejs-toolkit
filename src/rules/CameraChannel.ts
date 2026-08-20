/**
 * CameraChannel — resolving what the camera flies (D31 camera sequences)
 *
 * The camera is single-occupancy like audio: one flight owns it. A second
 * camera-sequence effect takes it over MID-FLIGHT — last legitimate claimant
 * wins, the camera is redirected from wherever it is, never queued and never
 * cut. A non-camera effect (a text popup, a sound) occupies a different channel
 * and leaves the flight running; that concurrency is `channelsOf`'s declaration,
 * not this module's.
 *
 * Unlike `DisplayChannel` and `AudioChannel` this module keeps NO state: which
 * flight is in the air, and where in it the camera is, is the runtime's sequence
 * player — the one thing that also knows where the camera actually is. A second
 * store beside it could only disagree with it.
 *
 * This module decides WHAT the camera should be flying, never flies it: the
 * runtime's sequence player reads the plan and drives every leg through the one
 * existing motion funnel (`CameraSystem.frameTo`) — one motion policy, no
 * second animator. What is resolved here is everything that can be resolved
 * from authored data alone:
 *   - a `stop` waypoint is that stop's authored camera, verbatim;
 *   - a `pose` waypoint is itself;
 *   - an `annotation` waypoint stays a FRAMING TARGET (anchor + radius), because
 *     framing keeps the current viewing angle — a fact about the moment of
 *     arrival, which only the player knows.
 *
 * PURE module — no DOM, camera, or Spark imports, ever, so lm-check exercises
 * resolution headlessly.
 */

import type {
  CameraSequenceEffect,
  SequencePose,
  SequenceTerminal,
  SequenceWaypoint,
} from "./RuleModel";

/** The authored pose shape, re-exported from the schema that owns it — this
 *  module resolves waypoints INTO poses, so a consumer of the plan needs the
 *  type without reaching past it. `RuleModel` is pure too, so importing it keeps
 *  this module's purity contract. */
export type { SequencePose };

/** One resolved leg: either a full pose, or a framing target the player turns
 *  into a pose at arrival time (center brought on screen at a fitting distance,
 *  current viewing angle kept — the same framing a selection uses). */
export type ResolvedWaypoint =
  | { readonly kind: "pose"; readonly pose: SequencePose; readonly holdSec: number }
  | {
      readonly kind: "frame";
      readonly center: readonly [number, number, number];
      readonly radius: number;
      readonly holdSec: number;
    };

/** A flight the player can fly: the resolved legs, in order, and how it ends. */
export interface FlightPlan {
  readonly waypoints: readonly ResolvedWaypoint[];
  readonly terminal: SequenceTerminal;
}

/** What `resolveSequence` needs to know about the site — structural views, so
 *  the module needs no SiteConfig import. */
export interface SequenceRefs {
  stops: readonly { id?: string; camera: SequencePose }[];
  annotations: readonly { id: string; anchor: readonly [number, number, number]; radius?: number }[];
}

/** Fallback framing radius for an annotation with none authored, and the floor
 *  every framing radius is clamped to. Exported because `frameEntity`'s
 *  annotation case applies the SAME pair — a sequence and a click must frame one
 *  marker identically, which two copies of the numbers cannot guarantee. */
export const DEFAULT_FRAME_RADIUS = 0.6;
export const MIN_FRAME_RADIUS = 0.25;

/**
 * Resolve one authored waypoint against the site. Returns null for a dangling
 * reference — pre-flight refuses those at load, so by the time a visitor clicks
 * a null here means the site mutated underneath the rule (author mode deleting
 * a stop); the caller DROPS the leg rather than flying to nowhere, the same
 * doctrine as a dangling block id in the display channel.
 */
export function resolveWaypoint(waypoint: SequenceWaypoint, refs: SequenceRefs): ResolvedWaypoint | null {
  const holdSec = waypoint.hold ?? 0;
  if (waypoint.pose !== undefined) {
    return { kind: "pose", pose: waypoint.pose, holdSec };
  }
  if (waypoint.stop !== undefined) {
    const stop = refs.stops.find((candidate) => candidate.id === waypoint.stop);
    if (stop === undefined) return null;
    return { kind: "pose", pose: stop.camera, holdSec };
  }
  if (waypoint.annotation !== undefined) {
    const annotation = refs.annotations.find((candidate) => candidate.id === waypoint.annotation);
    if (annotation === undefined) return null;
    return {
      kind: "frame",
      center: annotation.anchor,
      radius: Math.max(annotation.radius ?? DEFAULT_FRAME_RADIUS, MIN_FRAME_RADIUS),
      holdSec,
    };
  }
  // Pre-flight guarantees exactly one destination; a waypoint with none is the
  // same "site mutated underneath" case as a dangling reference.
  return null;
}

/**
 * Resolve a whole sequence into a flyable plan. Legs that no longer resolve are
 * dropped; a sequence with NO surviving legs returns null and the caller does
 * not fly at all (a flight that only returns home is not what anyone authored).
 */
export function resolveSequence(effect: CameraSequenceEffect, refs: SequenceRefs): FlightPlan | null {
  const waypoints = effect.waypoints
    .map((waypoint) => resolveWaypoint(waypoint, refs))
    .filter((leg): leg is ResolvedWaypoint => leg !== null);
  if (waypoints.length === 0) return null;
  return { waypoints, terminal: effect.terminal };
}
