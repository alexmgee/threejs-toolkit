/**
 * RuleAuthoring — the pure edit vocabulary behind the Rules pane (ticket 10)
 *
 * The pane is DOM; this is not. Every mutation an author can make through a
 * rule card — add, reorder or delete a card, add/change/remove an effect,
 * toggle a condition chip, choose a lifetime or a takeover override — is a
 * function here. That is what lets lm-check §10 assert the round trip the
 * ticket asks for (what the pane commits IS what the resolver consumes) at the
 * same headless seam it already tests the resolver at; a closure living inside
 * a click handler could not be asserted at all.
 *
 * PURE module, the same contract RuleModel and RuleResolver carry: no DOM, no
 * camera, no Spark. Every vocabulary is READ from RuleModel rather than
 * restated, so a new entry in a leg reaches the authoring surface for free —
 * ADR-0001's growth rule, authoring side.
 *
 * ── The incompleteness model ─────────────────────────────
 * A half-authored rule has no representation in the schema: pre-flight refuses
 * an empty `do`, a `show-blocks` naming no blocks, a `set-flag` with no name.
 * Rather than inventing a "blank but valid" seed per kind (eight special cases,
 * each of them data the author did not write), the pane keeps a WORKING list
 * that may hold incomplete cards and commits only the ones pre-flight accepts —
 * `committableRules` below. One concept covers every kind, and the reason a
 * card is not saved yet is pre-flight's own author-facing sentence, not a
 * second vocabulary of required fields that could drift from the first.
 */

import {
  KNOWN_MODES,
  KNOWN_TRIGGERS,
  validateAnnotationRules,
  type AnnotationRule,
  type EffectLifetime,
  type RuleBlockRef,
  type RuleEffect,
  type RuleWhen,
  type SequencePose,
  type SequenceTerminal,
  type SequenceWaypoint,
} from "./RuleModel";

// ─── Rule cards ───────────────────────────────────────────

/**
 * A fresh card: the only trigger v1 has, and no effects yet.
 *
 * Deliberately incomplete — see the incompleteness model above. The card exists
 * in the pane immediately (so it can be ordered and conditioned) and reaches
 * `annotation.rules` when it has an effect that pre-flight accepts.
 */
export function newRule(): AnnotationRule {
  return { on: KNOWN_TRIGGERS[0], do: [] };
}

/** Move the card at `index` by `delta` places. Returns a NEW array; a move off
 *  either end returns an unchanged copy, so a button at the end of the list is
 *  inert rather than wrapping the card round to the other side (priority is the
 *  point of the order — wrapping would silently invert it). */
export function moveRule(
  rules: readonly AnnotationRule[],
  index: number,
  delta: number,
): AnnotationRule[] {
  const next = [...rules];
  const target = index + delta;
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next;
  const [card] = next.splice(index, 1);
  next.splice(target, 0, card);
  return next;
}

/**
 * One card with its keys in the order the schema reads them: trigger, then
 * conditions, then effects.
 *
 * Purely about the FILE. A card is built up field by field, so `when` lands
 * wherever the author happened to add a chip, and an exported site.json would
 * read `on, do, when` on one rule and `on, when, do` on the next. Site configs
 * here are hand-edited too, and a rule reads as a sentence — when this happens,
 * if that holds, do this.
 */
export function canonicalRule(rule: AnnotationRule): AnnotationRule {
  return rule.when === undefined
    ? { on: rule.on, do: rule.do }
    : { on: rule.on, when: rule.when, do: rule.do };
}

/** Drop one entry, returning a NEW array. Shared by the three ordered lists a
 *  rule card owns (its cards, an effect's rows, a sequence's waypoints) so
 *  "remove" means one thing everywhere. */
export function removeAt<T>(list: readonly T[], index: number): T[] {
  const next = [...list];
  if (index >= 0 && index < next.length) next.splice(index, 1);
  return next;
}

/** Replace one entry, returning a NEW array. */
export function replaceAt<T>(list: readonly T[], index: number, value: T): T[] {
  const next = [...list];
  if (index >= 0 && index < next.length) next[index] = value;
  return next;
}

// ─── Effects ──────────────────────────────────────────────

/**
 * The initial terminal for a new camera sequence.
 *
 * The schema deliberately refuses to default this ("how the flight ends is
 * always authored") and hands the initial value to this ticket. `return` is the
 * non-destructive one: it glides back to the composed still, leaving the frozen
 * frame exactly as the author composed it, where `stay` re-photographs the
 * scene. An author who wants that says so.
 */
export const INITIAL_TERMINAL: SequenceTerminal = "return";

/**
 * A blank effect of one kind — right shape, no invented content.
 *
 * Reference-taking kinds (`show-blocks`, `play-audio`) and name-taking kinds
 * (`set-flag`, `custom`) start EMPTY and are therefore not committable until
 * the author fills them in. The mode verbs are the exception: `mode` has
 * exactly two legal values and no empty one, so the first mode in the row's own
 * order is taken — that is the order `entryMode` already calls "the first door
 * the visitor can see", not a preference of this module's.
 */
export function newEffect(kind: RuleEffect["kind"]): RuleEffect {
  switch (kind) {
    case "show-blocks":
      return { kind, blocks: [] };
    case "set-flag":
      return { kind, flag: "" };
    case "play-audio":
      return { kind, audio: "" };
    case "camera-sequence":
      return { kind, waypoints: [], terminal: INITIAL_TERMINAL };
    case "engage":
    case "allow":
    case "deny":
      return { kind, mode: KNOWN_MODES[0] };
    case "custom":
      return { kind, handler: "" };
  }
}

/** A blank waypoint: no destination yet, so the leg is incomplete until the
 *  author names one. `{}` rather than a seeded `stop` — a sequence silently
 *  flying somewhere nobody chose is worse than one that will not save. */
export function newWaypoint(): SequenceWaypoint {
  return {};
}

/** Which destination a waypoint names, or null while it names none. `pose` is
 *  authored by capture — `withWaypointPose` below (ticket 11), fed the live
 *  camera state by the pane's Capture buttons. */
export function waypointKind(waypoint: SequenceWaypoint): "stop" | "annotation" | "pose" | null {
  if (waypoint.stop !== undefined) return "stop";
  if (waypoint.annotation !== undefined) return "annotation";
  if (waypoint.pose !== undefined) return "pose";
  return null;
}

/** Point a waypoint at a stop or an annotation, clearing whatever it named
 *  before. Exactly-one-destination is a pre-flight rule, so switching the kind
 *  has to be a replacement, never an addition. `hold` survives — it is about
 *  the pause, not the place. */
export function withWaypointTarget(
  waypoint: SequenceWaypoint,
  kind: "stop" | "annotation",
  id: string,
): SequenceWaypoint {
  const next: SequenceWaypoint = {};
  if (id !== "") next[kind] = id;
  if (waypoint.hold !== undefined) next.hold = waypoint.hold;
  return next;
}

/**
 * Point a waypoint at a captured pose — "fly there, press capture" (ticket 11).
 *
 * The same replacement contract as `withWaypointTarget`: exactly-one-destination
 * is a pre-flight rule, so capturing over a stop or framing waypoint clears it,
 * and capturing over a pose waypoint is the RE-capture — update in place, order
 * kept. `hold` survives — it is about the pause, not the place.
 *
 * The pose is copied field by field rather than kept by reference: the caller
 * hands in a live camera state, and a shared object would let later camera
 * reads alias the authored data. Field order is the schema's own
 * (yaw/pitch/distance/pivot), so a captured pose serializes exactly as a
 * hand-written stop camera does.
 */
export function withWaypointPose(
  waypoint: SequenceWaypoint,
  pose: SequencePose,
): SequenceWaypoint {
  const next: SequenceWaypoint = {
    pose: {
      yaw: pose.yaw,
      pitch: pose.pitch,
      distance: pose.distance,
      pivot: { x: pose.pivot.x, y: pose.pivot.y, z: pose.pivot.z },
    },
  };
  if (waypoint.hold !== undefined) next.hold = waypoint.hold;
  return next;
}

/** Set (or clear, with `undefined`) a waypoint's hold without disturbing its
 *  destination. Absent = 0, so clearing is how an author says "flow straight
 *  through" rather than writing a zero. */
export function withWaypointHold(
  waypoint: SequenceWaypoint,
  hold: number | undefined,
): SequenceWaypoint {
  const next: SequenceWaypoint = { ...waypoint };
  if (hold === undefined) delete next.hold;
  else next.hold = hold;
  return next;
}

// ─── Lifetime (ticket 13's pinned union, as the form offers it) ──

/**
 * The lifetime choices a display mini-form offers — one per representable value
 * of the pinned union, `default` being the ABSENT field.
 *
 * Absent and `{ until: "re-activation" }` behave identically and are offered
 * separately on purpose: both are states site.json can be in, ticket 13 pinned
 * absence as one that stays representable (§17a/I3), and a form that folded
 * them together would silently rewrite an author's explicit line on the next
 * commit — which is exactly the round-trip §10 forbids.
 */
export type LifetimeChoice =
  | "default"
  | "forever"
  | "until-re-activation"
  | "until-travel"
  | "until-dismiss"
  | "while";

/** Which choice an authored lifetime is showing. Anything outside the union
 *  cannot reach here — pre-flight rejects it at load — so the fallback is the
 *  default rather than a thrown error the author could not act on. */
export function lifetimeChoice(lifetime: EffectLifetime | undefined): LifetimeChoice {
  if (lifetime === undefined) return "default";
  if (lifetime === "forever") return "forever";
  if ("while" in lifetime) return "while";
  switch (lifetime.until) {
    case "re-activation": return "until-re-activation";
    case "travel": return "until-travel";
    case "dismiss": return "until-dismiss";
  }
}

/**
 * The lifetime a choice writes. `default` writes `undefined` — the caller
 * DELETES the field rather than storing the undefined, keeping absence a real
 * absence in the exported JSON.
 *
 * `while` carries the author's existing clause forward when there is one, so
 * flicking to `forever` and back does not silently discard the conditions they
 * wrote.
 */
export function lifetimeFor(
  choice: LifetimeChoice,
  existingWhile?: RuleWhen,
): EffectLifetime | undefined {
  switch (choice) {
    case "default": return undefined;
    case "forever": return "forever";
    case "until-re-activation": return { until: "re-activation" };
    case "until-travel": return { until: "travel" };
    case "until-dismiss": return { until: "dismiss" };
    case "while": return { while: existingWhile ?? {} };
  }
}

/** The stay-while clause an effect carries, or undefined when its lifetime is
 *  not a `while`. Lets the form keep a clause across a round trip through the
 *  other choices. */
export function lifetimeWhile(lifetime: EffectLifetime | undefined): RuleWhen | undefined {
  return lifetime !== undefined && lifetime !== "forever" && "while" in lifetime
    ? lifetime.while
    : undefined;
}

// ─── Takeover (ticket 17's per-effect override) ───────────

/** Three states, because the field has three: absent inherits the site setting,
 *  and the override beats it in BOTH directions. A two-state checkbox could not
 *  express "inherit" and would materialize a value the author never chose. */
export type TakeoverChoice = "inherit" | "on" | "off";

export function takeoverChoice(takeover: boolean | undefined): TakeoverChoice {
  if (takeover === undefined) return "inherit";
  return takeover ? "on" : "off";
}

export function takeoverFor(choice: TakeoverChoice): boolean | undefined {
  switch (choice) {
    case "inherit": return undefined;
    case "on": return true;
    case "off": return false;
  }
}

// ─── Condition legs ───────────────────────────────────────

/** One leg's authored values, as a list. An absent leg is not a test, so it
 *  reads as no values selected — which is exactly what the chip row shows. */
export function legValues(leg: string | readonly string[] | undefined): string[] {
  if (leg === undefined) return [];
  return typeof leg === "string" ? [leg] : [...leg];
}

/**
 * The authored form for a set of values: a bare string for one, an array for
 * several, and ABSENT for none.
 *
 * The single-value string is the house style every fixture is written in
 * (`"state": "disengaged"`), and preserving it is what keeps a commit from
 * rewriting an author's file into array noise on an unrelated edit.
 */
export function legFor(values: readonly string[]): string | string[] | undefined {
  if (values.length === 0) return undefined;
  if (values.length === 1) return values[0];
  return [...values];
}

/**
 * A `when` clause with one leg replaced. An emptied leg is REMOVED, and a
 * clause left with no legs at all becomes `undefined` — absent, not `{}`.
 *
 * That last step matters beyond tidiness: `when: {}` is legal and matches
 * everything, so a leftover empty object would read in the pane as "no
 * conditions" while sitting in the file as a real clause. Same value, one
 * spelling.
 */
export function withLeg(
  when: RuleWhen | undefined,
  key: keyof RuleWhen,
  values: readonly string[],
): RuleWhen | undefined {
  const next: RuleWhen = { ...when };
  const leg = legFor(values);
  if (leg === undefined) delete next[key];
  else next[key] = leg as never;
  return Object.keys(next).length === 0 ? undefined : next;
}

/** Toggle one value in one leg — the chip's own action. */
export function toggleLegValue(
  when: RuleWhen | undefined,
  key: keyof RuleWhen,
  value: string,
): RuleWhen | undefined {
  const current = legValues(when?.[key]);
  const next = current.includes(value)
    ? current.filter((entry) => entry !== value)
    : [...current, value];
  return withLeg(when, key, next);
}

// ─── The transaction ──────────────────────────────────────

/**
 * What pre-flight needs to judge a rule list: the site's reference sets. Passed
 * as plain shapes rather than a SiteConfig so this module stays pure and the
 * check is the SAME function `normalizeSiteConfig` runs at load — one validator,
 * so the pane can never accept something a reload would reject.
 */
export interface RuleSiteRefs {
  annotations: readonly { id: string; rules?: unknown; presence?: unknown }[];
  /** POST-seeding block list — the live `site.blocks` while authoring. */
  blocks: readonly RuleBlockRef[];
  stops: readonly { id?: string }[];
  audio?: readonly { id: string }[];
}

/** Run the real pre-flight over `refs` with one annotation's rules replaced by
 *  `draft`, and report the first offence as the author-facing sentence it threw
 *  (or null when the draft is good). The site is never mutated: the substitution
 *  happens in a shallow copy. */
export function preflightRules(
  refs: RuleSiteRefs,
  annotationId: string,
  draft: readonly AnnotationRule[],
): string | null {
  const annotations = refs.annotations.map((annotation) =>
    annotation.id === annotationId ? { ...annotation, rules: draft } : annotation,
  );
  try {
    validateAnnotationRules(annotations, refs.blocks, refs.stops, { audio: refs.audio });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Judge ONE card on its own — the "why isn't this saved yet" sentence a card
 * shows, or null when it is ready.
 *
 * Every OTHER annotation's rules and presence are stripped for the probe, so a
 * broken rule elsewhere in the site cannot make every card in this pane look
 * broken. The id sets are kept whole, because a `visited` condition or a
 * waypoint may legitimately name any marker in the site.
 */
export function probeRule(
  refs: RuleSiteRefs,
  annotationId: string,
  rule: AnnotationRule,
): string | null {
  const bare = refs.annotations.map((annotation) => ({ id: annotation.id }));
  return preflightRules({ ...refs, annotations: bare }, annotationId, [rule]);
}

/** The working list's committable projection, in order: the cards pre-flight
 *  accepts. An incomplete card holds its place in the pane and simply is not
 *  written — see the incompleteness model at the top of this file. */
export function committableRules(
  refs: RuleSiteRefs,
  annotationId: string,
  working: readonly AnnotationRule[],
): AnnotationRule[] {
  return working.filter((rule) => probeRule(refs, annotationId, rule) === null);
}
