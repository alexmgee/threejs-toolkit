/**
 * RuleResolver — the pure decision seam for annotation rules
 *
 * (context, rule list) → the matched rule or NO_MATCH. Ordered list, evaluated
 * top-down, first match wins. This is seam 1 of the live-marker testing
 * strategy: every wrong-decision bug (ordering, condition ANDing, floor
 * fallback) concentrates here, where lm-check asserts it headlessly.
 *
 * PURE module — no DOM, camera, or Spark imports, ever. The runtime feeds it a
 * frozen context snapshot and acts on the returned rule; this module never
 * causes effects itself.
 */

import type { AnnotationRule, RuleEngagementState, RuleTrigger, RuleWhen } from "./RuleModel";
import { visitedFlag } from "./SceneMemory";

/** The situation conditions are evaluated against, snapshotted by the runtime.
 *  Presence resolution uses this alone — a marker's existence is a fact about
 *  the moment, with no triggering event behind it. */
export interface WhenContext {
  engagement: RuleEngagementState;
  /** The active stop, or null while travelling between stops. This is the
   *  runtime's existing active-stop value (shared with stop-bound text and
   *  media), so it survives a switch into explore and covers the frozen frame's
   *  composed stop — see `RuleWhen.stop`. Null is deliberately not a stop: a
   *  condition must not fire mid-flight, when the visitor is nowhere in
   *  particular. */
  stop: string | null;
  /** Scene memory as it stands: automatic `visited:<id>` activation records plus
   *  authored flags, in one namespace.
   *
   *  A SNAPSHOT, not the live store — `SceneMemory` replaces it on every write
   *  rather than mutating, so a context already handed to this module describes
   *  one moment and keeps describing it. */
  memory: ReadonlySet<string>;
}

/** A WhenContext plus the event that fired — what `resolveRule` needs. */
export interface RuleContext extends WhenContext {
  trigger: RuleTrigger;
}

/** Returned when no rule matches. A named sentinel rather than null: the
 *  no-match branch is the floor path (ticket 02 routes it to the annotation's
 *  copy), and that meaning should be unmistakable at every call site. */
export const NO_MATCH: unique symbol = Symbol("no-match");

/** One condition leg against one context value. An absent leg is not a test;
 *  a leg naming values tests membership, so a single value and a list are the
 *  same question asked of one or several answers. */
function legMatches(leg: string | readonly string[] | undefined, value: string | null): boolean {
  if (leg === undefined) return true;
  if (value === null) return false;
  return typeof leg === "string" ? leg === value : leg.includes(value);
}

/** One memory leg. The context value is a SET rather than a single value, so
 *  membership runs the other way round from `legMatches` — but the leg's own
 *  semantics are identical: absent is not a test, and a list is an OR.
 *
 *  `key` maps an authored name to its store key, which is what keeps `visited`
 *  ("marker m1 was activated") distinct from `flag` ("the author set m1"): they
 *  read the same store through different namespaces. */
function memoryLegMatches(
  leg: string | readonly string[] | undefined,
  flags: ReadonlySet<string>,
  key: (name: string) => string,
): boolean {
  if (leg === undefined) return true;
  if (typeof leg === "string") return flags.has(key(leg));
  return leg.some((name) => flags.has(key(name)));
}

/** Authored flags are stored under their own name. Named rather than inlined so
 *  it reads as the counterpart of `visitedFlag`, not as an accident. */
const authoredFlag = (name: string): string => name;

/**
 * Does this `when` clause hold in this context? Legs AND together; an absent
 * or empty clause is unconditional. Shared by rule matching and by an
 * annotation's presence — one vocabulary, one evaluator, so a condition can
 * never mean two different things depending on where it was written.
 */
export function matchesWhen(when: RuleWhen | undefined, context: WhenContext): boolean {
  if (when === undefined) return true;
  return legMatches(when.state, context.engagement)
    && legMatches(when.stop, context.stop)
    && memoryLegMatches(when.flag, context.memory, authoredFlag)
    && memoryLegMatches(when.visited, context.memory, visitedFlag);
}

export function resolveRule(
  context: RuleContext,
  rules: readonly AnnotationRule[],
): AnnotationRule | typeof NO_MATCH {
  for (const rule of rules) {
    if (rule.on !== context.trigger) continue;
    if (!matchesWhen(rule.when, context)) continue;
    return rule;
  }
  return NO_MATCH;
}
