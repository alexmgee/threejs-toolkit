/**
 * RuleModel — schema + pre-flight validation for annotation rules
 *
 * The live-marker system (D31): an annotation may carry an ordered list of
 * rules — `on` (trigger) + `when` (conditions) + `do` (effects) — evaluated
 * first-match-wins at trigger time. Per ADR-0001 every leg is a flat,
 * enumerable vocabulary stored as plain data in site.json; growth is new
 * entries in a leg, never an expression grammar.
 *
 * This module is PURE data logic — no DOM, camera, or Spark imports — so the
 * lm-check script asserts over it headlessly and SiteConfig's pre-flight can
 * reject bad authoring at load, in the author's face rather than a visitor's
 * browser.
 *
 * Current vocabulary: trigger `activate`, conditions `state` + `stop` + `flag` +
 * `visited`, effects `show-blocks` + `set-flag` + `play-audio` +
 * `camera-sequence` + `engage` + `allow` + `deny` + `custom`.
 * Anything outside a vocabulary
 * is REJECTED at load, never ignored — a condition the resolver cannot evaluate
 * would silently degrade to "always match", which is the worst failure
 * available: invisible, and inverted.
 */

import { VISITED_PREFIX } from "./SceneMemory";
// TYPE-only: `Channels` imports this module for the registry below, so a value
// import here would close a runtime cycle. Type imports erase, so this does not.
import type { EffectChannel } from "./Channels";

/** The trigger vocabulary — the single source RuleTrigger derives from, so the
 *  validated list and the type can never drift as entries grow (ADR-0001). */
export const KNOWN_TRIGGERS = ["activate"] as const;

export type RuleTrigger = (typeof KNOWN_TRIGGERS)[number];

/** The engagement vocabulary, as conditions see it. This is the single source
 *  for BOTH the validated list and SiteRuntime's `EngagementState`, so a
 *  condition can never name a state the runtime cannot be in. */
export const KNOWN_STATES = ["disengaged", "tour", "explore"] as const;

export type RuleEngagementState = (typeof KNOWN_STATES)[number];

/** A MODE: an engagement state the visitor can be offered. Every state except
 *  the frozen frame, which is nobody's to grant — it is where locking lands you,
 *  the universal safe landing, and it is always available. */
export type SceneMode = Exclude<RuleEngagementState, "disengaged">;

/** The mode vocabulary, DERIVED from the engagement one rather than written a
 *  second time: a state added above becomes a lockable mode here automatically,
 *  so the two can never disagree about what exists. Order is the mode row's own,
 *  which is what makes "the first door the visitor can see" a real answer
 *  (`entryMode`, ModeLocks). */
export const KNOWN_MODES: readonly SceneMode[] = KNOWN_STATES.filter(
  (state): state is SceneMode => state !== "disengaged",
);

/**
 * A `when` clause: the declarative test carried by a rule (when does it fire)
 * or by an annotation's presence (when does its marker exist at all).
 *
 * Legs AND together — every leg present must hold. Within one leg, a list is an
 * OR ("in tour or explore"). An absent leg is not a test, so an absent or empty
 * `when` matches everything.
 */
export interface RuleWhen {
  /** Engagement state(s) this applies in. */
  state?: RuleEngagementState | RuleEngagementState[];
  /** Stop id(s) the visitor must currently be AT.
   *
   *  "At" is the runtime's existing active-stop notion — the one stop-bound
   *  text and media already use — not a claim about where the camera is
   *  pointing: a stop becomes active on arrival and stays active until the rail
   *  departs, which means the composed frozen frame counts as being at the
   *  first stop, and a visitor who switches to explore keeps the stop they
   *  entered from until they travel again. Travelling between stops is not "at"
   *  any stop and matches nothing.
   *
   *  Author's note: to mean "at this stop, during the tour", AND a `state`
   *  condition — that is what the AND is for. */
  stop?: string | string[];
  /** Authored flag(s) that must be set in scene memory — written by a `set-flag`
   *  effect earlier in the visit, and gone again on reload.
   *
   *  Reserved: a flag name may not start with `visited:`. Those records are
   *  written by the runtime, and the `visited` leg below is how you ask about
   *  them — it gets a reference check this leg cannot have. */
  flag?: string | string[];
  /** Annotation id(s) whose marker must have been ACTIVATED this visit. Reads
   *  the automatic `visited:<id>` records, so it means "the visitor clicked (or
   *  Entered) this marker" — not "this marker is present", and not "the visitor
   *  looked at it".
   *
   *  A marker's own activation is recorded AFTER its rules resolve, so a rule on
   *  the marker itself sees its own first click as not-yet-visited — which is
   *  what makes "different the first time" authorable with a positive-only
   *  condition vocabulary. */
  visited?: string | string[];
}

/** Typed against RuleWhen so a key that isn't a real condition leg is a compile
 *  error; each new condition leg adds its entry here (ADR-0001 growth rule).
 *
 *  EXPORTED for the Rules pane (ticket 10), which iterates it to build one chip
 *  editor per leg. That is what makes "a new condition leg appears in the
 *  authoring UI" automatic rather than a second edit someone can forget. */
export const KNOWN_CONDITION_KEYS: readonly (keyof RuleWhen)[] = ["state", "stop", "flag", "visited"];

/**
 * The seed spec for a display effect's default template block — the "standard
 * output" an author gets before touching anything (story 29).
 *
 * Read ONCE, at load, by the seeder: it decides what block to create at the
 * reserved id when nothing is there yet. It is not consulted again. The block
 * that results owns its own space and placement from then on, which is what
 * lets the author move, restyle, or replace it with the ordinary text tooling
 * (story 30) without the rule quietly overriding them.
 */
export interface DisplayTemplate {
  /** Which half of the blocks channel the template lives in: a screen slot, or
   *  anchored in the world. Fixes the block's `space` at seed time. */
  space: "screen" | "world";
  /** World only: pin the template at the carrying annotation's own anchor —
   *  "back by the marker itself" (story 22) without the author copying
   *  coordinates by hand. Mutually exclusive with `position`. */
  at?: "annotation";
  /** World only: an authored point, seeded verbatim. Mutually exclusive with
   *  `at`. */
  position?: [number, number, number];
}

/** Keys a DisplayTemplate may carry, typed against it so a key that isn't a real
 *  seed field is a compile error (the ADR-0001 growth rule, template side). */
const KNOWN_TEMPLATE_KEYS: readonly (keyof DisplayTemplate)[] = ["space", "at", "position"];

const KNOWN_TEMPLATE_SPACES = ["screen", "world"] as const;

/**
 * The id namespace reserved for one annotation's display templates.
 *
 * Lives here rather than beside the other seeded-block ids in SiteConfig because
 * pre-flight has to enforce it and SiteConfig imports this module, not the
 * reverse. A templated effect must name an id in its OWN annotation's namespace:
 * that is what makes "this id belongs to a display template" decidable, both for
 * the collision guard at load and for an author reading site.json.
 */
export function displayTemplatePrefix(annotationId: string): string {
  return `annotation-${annotationId}-effect-`;
}

/** The discrete `until` endings a lifetime may name (ticket 13). The single
 *  source for the type and the pre-flight membership check, like every other
 *  leg vocabulary in this file. */
export const KNOWN_UNTIL_ENDINGS = ["re-activation", "travel", "dismiss"] as const;

export type LifetimeUntil = (typeof KNOWN_UNTIL_ENDINGS)[number];

/**
 * When shown content ends ON ITS OWN (ticket 13). Three authored forms, pinned
 * by the author ("all of the above"), mutually exclusive by the union itself:
 *
 * - `"forever"` — never ends on its own. Not immunity: takeover (where on) and
 *   the visitor's Escape still remove it, because neither is the content ending
 *   by itself.
 * - `{ until }` — one discrete ending. `re-activation`: activating the same
 *   marker again closes it. `travel`: gone on arrival at a stop. `dismiss`:
 *   nothing else ends it — only the visitor's Escape (A3).
 * - `{ while }` — a stay-while condition in the rule `when` vocabulary,
 *   re-evaluated as context changes (author decision 2026-08-11, for lifetime
 *   only — not a general opening of continuous data-binding).
 *
 * Absent = the default: behaves as `until: "re-activation"` — the same lifetime
 * the copy floor's conjured box carries, by the same mechanism, so a bare
 * marker and an effect stating nothing behave identically by construction.
 */
export type EffectLifetime =
  | "forever"
  | { until: LifetimeUntil }
  | { while: RuleWhen };

/** The unauthored default, applied where a claim is made — never materialized
 *  into the config ("absent" stays a representable state, §17a/I3). */
export const DEFAULT_LIFETIME: EffectLifetime = Object.freeze({ until: "re-activation" as const });

export interface ShowBlocksEffect {
  kind: "show-blocks";
  /** Ids of blocks to show. Any existing block is a legal target — the display
   *  channel shows the referenced ids directly, so unlike the tracer (which
   *  displayed them by selecting the annotation) there is no reason to require
   *  the annotation's own bound blocks. */
  blocks: string[];
  /** Present when this effect owns a seeded template block. Exactly one id in
   *  `blocks`, in this annotation's reserved namespace, and the seeder fills it
   *  if nothing is there yet. Absent on an effect that points at blocks the
   *  author already had — what ticket 10's block picker produces. */
  template?: DisplayTemplate;
  /** Does showing these blocks REMOVE content another annotation is showing?
   *  Absent inherits `settings.blocks.takeover` (default `true`). Ticket 17,
   *  Rule A — the site states its habit once and any single effect may say
   *  otherwise. Never touches content this SAME annotation is showing: one
   *  annotation's several effects each hold their own claim. */
  takeover?: boolean;
  /** When this effect's shown content ends on its own (ticket 13). Absent =
   *  `until: "re-activation"`. Governs SELF-ending only: takeover and Escape
   *  are not endings and are not shielded by any value here. */
  lifetime?: EffectLifetime;
}

export interface SetFlagEffect {
  kind: "set-flag";
  /** The flag name to record in scene memory. One name per effect — an author
   *  setting two flags writes two effects, which is also how the Rules pane's
   *  "flag name" mini-form is shaped (story 26).
   *
   *  May not start with `visited:`: that key space belongs to the runtime's
   *  automatic activation records, and an authored flag able to forge one would
   *  make every `visited` condition a claim rather than a fact. */
  flag: string;
}

export interface PlayAudioEffect {
  kind: "play-audio";
  /** Id of a sound in the site's `audio` list. A NAME, not a URL: naming it is
   *  what gives pre-flight a reference to check (the same check stops, blocks
   *  and annotations get), what lets several markers share one sound, and what
   *  keeps asset detail — url, volume, and later spatial placement — on the
   *  asset rather than smeared across every rule that plays it.
   *
   *  Deliberately NOT an entry in `site.media`: every media entry is owned by
   *  the binding evaluator, which decides visibility continuously. A rule-driven
   *  sound in that list would have two owners disagreeing about when it plays —
   *  the same collision ticket 05 refused for template blocks. Binding-driven
   *  AMBIENT audio is a different feature and would belong there. */
  audio: string;
}

/** An authored camera pose — the shape `stops[].camera` uses, and what ticket
 *  11's "fly there, press capture" writes. Named rather than inlined so the
 *  resolver and the player name the same type, not two structural twins. */
export interface SequencePose {
  yaw: number;
  pitch: number;
  distance: number;
  pivot: { x: number; y: number; z: number };
}

/**
 * One leg of a camera sequence: where the camera goes, and how long it rests
 * there before moving on.
 *
 * Exactly one of `stop` / `annotation` / `pose` names the destination:
 * - `stop`: the stop's authored camera, verbatim — the same pose the rail docks
 *   at, so a sequence can quote the tour without restating coordinates.
 * - `annotation`: frame that marker (bring its anchor on screen at a fitting
 *   distance, keeping the current viewing angle — the same framing a selection
 *   uses). Named rather than posed so the waypoint follows the marker when the
 *   author moves it.
 * - `pose`: an authored camera state, the shape `stops[].camera` uses — which is
 *   also what ticket 11's "fly there, press capture" writes.
 */
export interface SequenceWaypoint {
  /** Id of a stop whose authored camera is the destination. */
  stop?: string;
  /** Id of an annotation to frame. */
  annotation?: string;
  /** An authored camera state (same shape as a stop's `camera`). */
  pose?: SequencePose;
  /** Seconds to rest at this waypoint before the next leg. Absent = 0 — the
   *  sequence flows straight through. Seconds, not ms, matching the other
   *  authored camera timing (`stops[].duration`). */
  hold?: number;
}

/** Keys a SequenceWaypoint may carry, typed against it so a key that isn't a
 *  real waypoint field is a compile error (the ADR-0001 growth rule). */
const KNOWN_WAYPOINT_KEYS: readonly (keyof SequenceWaypoint)[] = ["stop", "annotation", "pose", "hold"];

/** The two ways a sequence may end (GLOSSARY.md, Effect / spec stories 6–7):
 *  `return` glides back to the composed still; `stay` leaves the camera at the
 *  last waypoint — the frozen frame is now a different photograph. Equal
 *  citizens: neither is a default, the author always writes one. */
export const KNOWN_SEQUENCE_TERMINALS = ["return", "stay"] as const;

export type SequenceTerminal = (typeof KNOWN_SEQUENCE_TERMINALS)[number];

export interface CameraSequenceEffect {
  kind: "camera-sequence";
  /** The legs, flown in order. Non-empty — a sequence that goes nowhere is an
   *  authoring mistake, not a no-op. */
  waypoints: SequenceWaypoint[];
  /** REQUIRED — how the flight ends. Deliberately not defaulted: the spec makes
   *  `return` and `stay` equal citizens with no prescribed default (the
   *  inspector's initial value is ticket 10's concern, not the schema's). */
  terminal: SequenceTerminal;
}

/**
 * Flip the scene into a mode — the marker as a second door.
 *
 * Legal under the engagement invariant because the activating click is a VISITOR
 * act: the scene is never engaged by anything but a person deciding to engage it.
 *
 * It also GRANTS the mode on the way through. Pre-flight counts an `engage` as a
 * path into a fully locked scene exactly like an `allow` (see
 * `validateModeLocks`), so "engaged in a mode the mode row still greys" is not a
 * state this vocabulary can reach.
 */
export interface EngageEffect {
  kind: "engage";
  mode: SceneMode;
}

/** Offer a mode for the rest of this visit — its word lights up in the mode row
 *  and becomes selectable. Granting is not entering: the visitor still walks
 *  through the door themselves, which is the whole reason this is a separate
 *  verb from `engage`. */
export interface AllowEffect {
  kind: "allow";
  mode: SceneMode;
}

/** Withdraw a mode for the rest of this visit — its word greys and can no longer
 *  be selected. Denying the visitor's CURRENT mode disengages them to the frozen
 *  frame; restriction never strands anyone in a state they cannot leave. */
export interface DenyEffect {
  kind: "deny";
  mode: SceneMode;
}

/** The three effects that edit the offered-mode set. Named as a group because
 *  `ModeLocks` transitions on exactly this union — one door verb and two lock
 *  verbs — and nothing else in the vocabulary touches modes. */
export type ModeEffect = EngageEffect | AllowEffect | DenyEffect;

export interface CustomEffect {
  kind: "custom";
  /** Name of a handler the consuming site registered in TypeScript — the single
   *  ADR-0001 escape hatch. Unregistered at load: a warning, and the scene still
   *  runs (one unwired handler must not blank a visitor's whole scene).
   *  Unregistered at dispatch: a thrown error, never a silent no-op. */
  handler: string;
}

export type RuleEffect =
  | ShowBlocksEffect
  | SetFlagEffect
  | PlayAudioEffect
  | CameraSequenceEffect
  | ModeEffect
  | CustomEffect;

export interface AnnotationRule {
  /** The discrete event that wakes this rule. */
  on: RuleTrigger;
  /** Conditions that must hold for this rule to match. Absent = unconditional,
   *  which in an ordered list means it shadows every rule below it. */
  when?: RuleWhen;
  /** Effects run when this rule matches. */
  do: RuleEffect[];
}

/**
 * Everything the system needs to know about one effect kind that is not its
 * runtime behavior: which channels it occupies, and how to pre-flight its own
 * fields.
 *
 * The behavior deliberately stays out. Running an effect is impure — it touches
 * the text system, the audio device, the memory funnel — and this module is
 * pure by contract, so the runtime keeps its own switch. What that switch no
 * longer keeps is the LIST: it is exhaustively checked against this table, so
 * the two cannot disagree about which kinds exist.
 */
export interface EffectKindSpec {
  /** Which channels an effect of this kind occupies while it runs. Empty for
   *  `custom`: the toolkit cannot know what a registered handler does. */
  readonly channels: readonly EffectChannel[];
  /** Pre-flight for this kind's own fields. Throws on the first offence, with a
   *  message naming the offending piece — same contract as the rest of
   *  normalizeSiteConfig. May also warn without throwing. */
  validate(effect: Record<string, unknown>, context: EffectValidationContext): void;
}

/** What a kind's pre-flight can consult. Bundled rather than passed as five
 *  loose arguments, so adding a reference set later touches one signature. */
export interface EffectValidationContext {
  /** Names the offending piece for the author, e.g. `annotation "x" rule 2`. */
  readonly at: string;
  /** The annotation carrying the rule — a display template's reserved id space
   *  is keyed on it. */
  readonly annotationId: string;
  readonly blockIds: ReadonlySet<string>;
  readonly audioIds: ReadonlySet<string>;
  /** The site's stop ids — what a sequence waypoint's `stop` may name. */
  readonly stopIds: ReadonlySet<string>;
  /** All annotation ids in the site — what a waypoint's `annotation` may name.
   *  The full set, not "seen so far": a waypoint may frame a marker declared
   *  later in the list. */
  readonly annotationIds: ReadonlySet<string>;
  /** Handler names the consuming site registered, or undefined when the caller
   *  has no registry information at all — which is NOT the same as none. */
  readonly registeredHandlers: ReadonlySet<string> | undefined;
  /** Template id → the effect that claims it, site-wide. */
  readonly claimedTemplates: Map<string, string>;
}

/**
 * THE effect-kind registry — one entry per kind, and the single place the set of
 * kinds is written down.
 *
 * Typed as a total `Record` over the union, so omitting a kind is a COMPILE
 * error rather than a silently unvalidated effect. Before this table the same
 * list lived in four places (a literal array, a validation cascade, the channel
 * switch, and the runtime's dispatch); a fifth kind meant four coordinated
 * edits with nothing to catch a missed one. Now it means one entry here, plus
 * the behavior in the runtime's switch, which its own exhaustiveness check
 * demands (ADR-0001's growth rule: new capability is new entries in a leg).
 */
export const EFFECT_KINDS: Readonly<Record<RuleEffect["kind"], EffectKindSpec>> = {
  "show-blocks": {
    channels: ["blocks"],
    validate(effect, { at, annotationId, blockIds, stopIds, annotationIds, claimedTemplates }) {
      const ids = effect.blocks;
      if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== "string")) {
        throw new Error(`SiteConfig: ${at} show-blocks needs a non-empty "blocks" array of block ids`);
      }
      // The per-effect takeover override (ticket 17). Refused rather than
      // coerced: `"false"` read as truthy would silently do the OPPOSITE of what
      // the author wrote, and the symptom — other markers' content vanishing —
      // looks like a channel bug rather than a typo in this line.
      const takeover = (effect as { takeover?: unknown }).takeover;
      if (takeover !== undefined && typeof takeover !== "boolean") {
        throw new Error(
          `SiteConfig: ${at} show-blocks "takeover" must be true or false (got ${JSON.stringify(takeover)})`,
        );
      }
      // The authored lifetime (ticket 13). Anything outside the union is
      // REJECTED at load, never ignored — an unevaluable lifetime would
      // silently degrade to the default, which reads to the author as "my
      // `until: travel` does nothing". Same doctrine as every other leg.
      if (effect.lifetime !== undefined) {
        validateLifetime(at, effect.lifetime, stopIds, annotationIds);
      }
      // The template BEFORE the references: a malformed seed spec is why the
      // block it should have created is missing, so reporting the reference
      // first would point the author at the symptom.
      if (effect.template !== undefined) {
        validateTemplate(at, effect.template, annotationId, ids as string[], claimedTemplates);
      }
      for (const id of ids as string[]) {
        if (!blockIds.has(id)) {
          throw new Error(
            `SiteConfig: ${at} references unknown block id "${id}" — show-blocks may only reference existing blocks`,
          );
        }
      }
    },
  },
  "set-flag": {
    channels: ["memory"],
    validate(effect, { at }) {
      const flag = effect.flag;
      if (typeof flag !== "string" || flag === "") {
        throw new Error(`SiteConfig: ${at} set-flag needs a non-empty "flag" name`);
      }
      // The reserved key space, effect side. An authored flag able to write a
      // `visited:` record would make every `visited` condition a claim rather
      // than a fact about what the visitor actually activated.
      if (flag.startsWith(VISITED_PREFIX)) {
        throw new Error(
          `SiteConfig: ${at} set-flag name "${flag}" may not start with "${VISITED_PREFIX}" — activation records are written by the runtime, not by rules`,
        );
      }
    },
  },
  "play-audio": {
    channels: ["audio"],
    validate(effect, { at, audioIds }) {
      const sound = effect.audio;
      if (typeof sound !== "string" || sound === "") {
        throw new Error(`SiteConfig: ${at} play-audio needs a non-empty "audio" id naming a sound in the site's audio list`);
      }
      // The same reference check stops, blocks and annotations get — and the
      // whole reason the sound is NAMED rather than inlined as a URL. A typo
      // here would otherwise present as a marker that plays nothing.
      if (!audioIds.has(sound)) {
        throw new Error(
          `SiteConfig: ${at} play-audio references unknown audio id "${sound}" — rules may only play sounds declared in the site's "audio" list`,
        );
      }
    },
  },
  "camera-sequence": {
    channels: ["camera"],
    validate(effect, { at, stopIds, annotationIds }) {
      const waypoints = effect.waypoints;
      if (!Array.isArray(waypoints) || waypoints.length === 0) {
        throw new Error(
          `SiteConfig: ${at} camera-sequence needs a non-empty "waypoints" array — a sequence that goes nowhere is a mistake, not a no-op`,
        );
      }
      // The terminal BEFORE the waypoints: a sequence with no ending is broken
      // as a whole, so reporting a leg-level typo first would point the author
      // at a symptom.
      const terminal = effect.terminal;
      if (typeof terminal !== "string" || !(KNOWN_SEQUENCE_TERMINALS as readonly string[]).includes(terminal)) {
        throw new Error(
          `SiteConfig: ${at} camera-sequence needs a "terminal" of ${KNOWN_SEQUENCE_TERMINALS.map((t) => `"${t}"`).join(" or ")} — how the flight ends is always authored, never defaulted`,
        );
      }
      for (const [index, waypoint] of (waypoints as unknown[]).entries()) {
        const leg = `${at} waypoint ${index + 1}`;
        if (typeof waypoint !== "object" || waypoint === null || Array.isArray(waypoint)) {
          throw new Error(`SiteConfig: ${leg} must be an object naming one destination`);
        }
        const record = waypoint as Record<string, unknown>;
        for (const key of Object.keys(record)) {
          if (!(KNOWN_WAYPOINT_KEYS as readonly string[]).includes(key)) {
            throw new Error(
              `SiteConfig: ${leg} has unknown key "${key}" — known keys: ${KNOWN_WAYPOINT_KEYS.join(", ")}`,
            );
          }
        }
        // Exactly one destination: two is an unanswerable question, none is a
        // hold with nowhere to hold.
        const named = ["stop", "annotation", "pose"].filter((key) => record[key] !== undefined);
        if (named.length !== 1) {
          throw new Error(
            `SiteConfig: ${leg} must name exactly one of "stop", "annotation", or "pose" — got ${named.length === 0 ? "none" : named.join(" + ")}`,
          );
        }
        // The same reference checks stops and annotations get everywhere else —
        // a typo here would otherwise present as a flight to nowhere.
        if (record.stop !== undefined) {
          if (typeof record.stop !== "string" || !stopIds.has(record.stop)) {
            throw new Error(
              `SiteConfig: ${leg} references unknown stop id "${String(record.stop)}" — waypoints may only name existing stops`,
            );
          }
        }
        if (record.annotation !== undefined) {
          if (typeof record.annotation !== "string" || !annotationIds.has(record.annotation)) {
            throw new Error(
              `SiteConfig: ${leg} references unknown annotation id "${String(record.annotation)}" — waypoints may only frame existing annotations`,
            );
          }
        }
        if (record.pose !== undefined && !isPose(record.pose)) {
          throw new Error(
            `SiteConfig: ${leg} "pose" must be a camera state — finite yaw, pitch, distance and a {x, y, z} pivot (the shape a stop's "camera" uses)`,
          );
        }
        if (record.hold !== undefined) {
          if (typeof record.hold !== "number" || !Number.isFinite(record.hold) || record.hold < 0) {
            throw new Error(`SiteConfig: ${leg} "hold" must be a finite number of seconds ≥ 0`);
          }
        }
      }
    },
  },
  // The three mode verbs share a channel and a validator: each names one mode,
  // and what they do with it is `ModeLocks`' business, not pre-flight's. The
  // spec's channel list has ONE "memory-modes" resource, so they occupy the same
  // channel `set-flag` does — and nothing else, which is what lets one rule
  // engage the scene and show its copy at the same time.
  engage: {
    channels: ["memory"],
    validate(effect, { at }) {
      validateModeField(at, "engage", effect.mode);
    },
  },
  allow: {
    channels: ["memory"],
    validate(effect, { at }) {
      validateModeField(at, "allow", effect.mode);
    },
  },
  deny: {
    channels: ["memory"],
    validate(effect, { at }) {
      validateModeField(at, "deny", effect.mode);
    },
  },
  custom: {
    // The ADR-0001 escape hatch occupies nothing the toolkit can name. A handler
    // is arbitrary site code, so any claim made on its behalf would be a guess —
    // and a wrong one would have two unrelated custom effects silently
    // cancelling each other.
    channels: [],
    validate(effect, { at, registeredHandlers }) {
      const handler = effect.handler;
      if (typeof handler !== "string" || handler === "") {
        throw new Error(`SiteConfig: ${at} custom needs a non-empty "handler" name registered by the consuming site`);
      }
      // WARN, never throw: the handler lives in the site's TypeScript, not in
      // site.json, so an unregistered name is a wiring mistake rather than a
      // broken config — and one unwired handler must not blank a visitor's
      // whole scene. Dispatch is where it becomes an error.
      //
      // `undefined` means the caller has no handler information at all (the
      // author panel's normalize, the element's throwaway pre-flight), which is
      // NOT the same as "no handlers exist" — guessing there would warn on
      // every load of a perfectly wired site.
      if (registeredHandlers !== undefined && !registeredHandlers.has(handler)) {
        console.warn(
          `SiteConfig: ${at} names custom handler "${handler}", which no one registered — `
          + `activating this marker will fail. Register it before the scene loads, or remove the effect.`,
        );
      }
    },
  },
};

/** DERIVED from the registry, never written twice: the list an unknown kind is
 *  checked against, and the one the author is shown — literally, since ticket
 *  10: the Rules pane's "Add effect" picker is built from this array, so a kind
 *  added to EFFECT_KINDS is authorable the moment it exists. */
export const KNOWN_EFFECT_KINDS = Object.keys(EFFECT_KINDS) as readonly RuleEffect["kind"][];

/** Minimal structural view of a text block for rule validation — matches
 *  TextModel's TextBlock without importing it (keeps this module import-free).
 *  Only the id is needed: any existing block is a legal display target, so
 *  validation asks whether a reference resolves, never what it is bound to. */
export interface RuleBlockRef {
  id: string;
}

/** Three finite numbers — a world point the seeder can hand to a placement
 *  without multiplying into NaN geometry downstream. */
function isPoint(value: unknown): value is [number, number, number] {
  return Array.isArray(value)
    && value.length === 3
    && value.every((n) => typeof n === "number" && Number.isFinite(n));
}

/** A finite camera state — the shape `stops[].camera` uses, checked before the
 *  motion funnel is ever handed it. A NaN yaw would tween the camera into
 *  nowhere and stick it there. */
function isPose(value: unknown): value is SequencePose {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const pose = value as Record<string, unknown>;
  const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  if (!finite(pose.yaw) || !finite(pose.pitch) || !finite(pose.distance)) return false;
  const pivot = pose.pivot as Record<string, unknown> | undefined;
  return typeof pivot === "object" && pivot !== null
    && finite(pivot.x) && finite(pivot.y) && finite(pivot.z);
}

/** The mode vocabulary, as an author is shown it. */
const modeList = (): string => KNOWN_MODES.map((mode) => `"${mode}"`).join(" or ");

/**
 * Pre-flight for the `mode` field the three mode verbs share.
 *
 * `"disengaged"` is deliberately rejected alongside every other non-mode: it is a
 * real engagement state, so a hasty author might reach for it, but the frozen
 * frame is not something a scene can offer or withdraw — it is where withdrawal
 * lands you, and it is always available.
 */
function validateModeField(at: string, kind: string, mode: unknown): void {
  if (typeof mode !== "string" || !(KNOWN_MODES as readonly string[]).includes(mode)) {
    throw new Error(
      `SiteConfig: ${at} ${kind} needs a "mode" of ${modeList()} — got "${String(mode)}"`,
    );
  }
}

/**
 * Pre-flight for the scene's load-time locks (story 36).
 *
 * Two duties. The vocabulary: `settings.lockedModes` names modes and nothing
 * else, checked the same way every other leg is, because a mode name the runtime
 * cannot resolve would silently lock nothing.
 *
 * And the one the author asked for by name: a scene that starts with EVERY mode
 * locked and contains no rule anywhere granting one back has no path into 3D at
 * all. A visitor would meet a frozen frame with no switch (author, 2026-08-10:
 * the switch is present exactly while a mode is offered) and no marker able to
 * hand them one — shippable only by accident. A partial lock needs no grant: the
 * mode left open is itself the way in.
 *
 * Runs AFTER `validateAnnotationRules`, so every effect it walks is already known
 * to be well-formed and the scan can trust the shapes it reads.
 */
export function validateModeLocks(
  lockedModes: unknown,
  annotations: readonly { rules?: unknown }[],
): void {
  if (lockedModes === undefined) return;
  if (!Array.isArray(lockedModes)) {
    throw new Error(
      `SiteConfig: settings.lockedModes must be an array of mode names — known modes: ${KNOWN_MODES.join(", ")}`,
    );
  }
  for (const mode of lockedModes as unknown[]) {
    if (typeof mode !== "string" || !(KNOWN_MODES as readonly string[]).includes(mode)) {
      throw new Error(
        `SiteConfig: settings.lockedModes has unknown mode "${String(mode)}" — known modes: ${KNOWN_MODES.join(", ")}`,
      );
    }
  }
  const locked = new Set(lockedModes as string[]);
  // Anything less than a total lock leaves a door standing open.
  if (!KNOWN_MODES.every((mode) => locked.has(mode))) return;
  // `engage` counts as a grant exactly like `allow` — it hands the visitor the
  // mode as it takes them through it (see `EngageEffect`).
  const grants = (rules: unknown): boolean =>
    Array.isArray(rules)
    && rules.some((rule) =>
      Array.isArray((rule as { do?: unknown }).do)
      && ((rule as { do: unknown[] }).do).some((effect) => {
        const kind = (effect as { kind?: unknown }).kind;
        return kind === "engage" || kind === "allow";
      }));
  if (annotations.some((annotation) => grants(annotation.rules))) return;
  throw new Error(
    `SiteConfig: settings.lockedModes locks every mode (${KNOWN_MODES.join(", ")}) and no rule anywhere grants one back `
    + `with an "engage" or "allow" effect — the scene would have no way into 3D at all`,
  );
}

/**
 * Pre-flight for a display effect's template seed. Everything the seeder will
 * read, checked before it reads it: shape, vocabulary, the screen/world
 * discriminant's exclusivity, and the reserved id the template claims.
 *
 * `claimed` is threaded through every effect in the site so two effects cannot
 * name one template id — the second would silently inherit the first one's
 * block, and editing either would edit both.
 */
function validateTemplate(
  at: string,
  template: unknown,
  annotationId: string,
  blockIds: readonly string[],
  claimed: Map<string, string>,
): void {
  if (typeof template !== "object" || template === null || Array.isArray(template)) {
    throw new Error(`SiteConfig: ${at} show-blocks "template" must be an object describing where to seed the block`);
  }
  const record = template as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(KNOWN_TEMPLATE_KEYS as readonly string[]).includes(key)) {
      throw new Error(
        `SiteConfig: ${at} template has unknown key "${key}" — known keys: ${KNOWN_TEMPLATE_KEYS.join(", ")}`,
      );
    }
  }
  const space = record.space;
  if (typeof space !== "string" || !(KNOWN_TEMPLATE_SPACES as readonly string[]).includes(space)) {
    throw new Error(
      `SiteConfig: ${at} template has unknown space "${String(space)}" — known spaces: ${KNOWN_TEMPLATE_SPACES.join(", ")}`,
    );
  }
  if (space === "screen") {
    if (record.at !== undefined || record.position !== undefined) {
      throw new Error(
        `SiteConfig: ${at} template space "screen" takes no world anchor — drop "at"/"position", or seed it into space "world"`,
      );
    }
  } else {
    const hasAt = record.at !== undefined;
    const hasPoint = record.position !== undefined;
    // Exactly one: two anchors is an unanswerable question, none is no anchor
    // at all — and a world block without a position renders at the origin,
    // which reads to the author as "my payoff vanished".
    if (hasAt === hasPoint) {
      throw new Error(
        `SiteConfig: ${at} world template needs exactly one of "at": "annotation" or a "position" point`,
      );
    }
    if (hasAt && record.at !== "annotation") {
      throw new Error(
        `SiteConfig: ${at} template "at" must be "annotation" — the only world anchor a template can name`,
      );
    }
    if (hasPoint && !isPoint(record.position)) {
      throw new Error(`SiteConfig: ${at} template "position" must be three finite numbers`);
    }
  }
  // One template seeds one block, so "which of these ids is the template" must
  // have an answer. Several blocks at once is authored by picking them, without
  // a template.
  if (blockIds.length !== 1) {
    throw new Error(
      `SiteConfig: ${at} seeds a template, so it must name exactly one block — the template's own id`,
    );
  }
  const id = blockIds[0];
  const prefix = displayTemplatePrefix(annotationId);
  if (!id.startsWith(prefix) || id.length === prefix.length) {
    throw new Error(
      `SiteConfig: ${at} template id "${id}" is outside the ids reserved for this annotation's display effects — name it "${prefix}<n>"`,
    );
  }
  const owner = claimed.get(id);
  if (owner !== undefined) {
    throw new Error(
      `SiteConfig: ${at} claims template id "${id}", already claimed by ${owner} — one template block per display effect`,
    );
  }
  claimed.set(id, at);
}

/** The lifetime vocabulary, as an author is shown it — one string for every
 *  refusal, so the message always carries the whole union. */
const lifetimeForms = (): string =>
  `"forever", { "until": ${KNOWN_UNTIL_ENDINGS.map((e) => `"${e}"`).join(" | ")} }, or { "while": <conditions> }`;

/**
 * Pre-flight for a display effect's `lifetime` (ticket 13). Exactly the pinned
 * union and nothing else: one form at a time (the union is mutually exclusive
 * by construction, so an object naming both `until` and `while` is refused),
 * `until` a member of the ending vocabulary, and `while` a `when` clause the
 * resolver could actually evaluate — checked by the SAME validator rules and
 * presence use, so a stay-while condition can never mean something a rule
 * condition does not.
 */
function validateLifetime(
  at: string,
  lifetime: unknown,
  stopIds: ReadonlySet<string>,
  annotationIds: ReadonlySet<string>,
): void {
  if (lifetime === "forever") return;
  if (typeof lifetime === "string") {
    throw new Error(
      `SiteConfig: ${at} lifetime "${lifetime}" is not a known form — write ${lifetimeForms()}`,
    );
  }
  if (typeof lifetime !== "object" || lifetime === null || Array.isArray(lifetime)) {
    throw new Error(`SiteConfig: ${at} lifetime must be ${lifetimeForms()}`);
  }
  const record = lifetime as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || (keys[0] !== "until" && keys[0] !== "while")) {
    throw new Error(
      `SiteConfig: ${at} lifetime must name exactly one of "until" or "while" — got ${JSON.stringify(keys)}; write ${lifetimeForms()}`,
    );
  }
  if (keys[0] === "until") {
    const until = record.until;
    if (typeof until !== "string" || !(KNOWN_UNTIL_ENDINGS as readonly string[]).includes(until)) {
      throw new Error(
        `SiteConfig: ${at} lifetime has unknown ending "${String(until)}" — known endings: ${KNOWN_UNTIL_ENDINGS.join(", ")}`,
      );
    }
    return;
  }
  validateWhen(`${at} lifetime "while"`, record.while, stopIds, annotationIds);
}

/**
 * Pre-flight for one `when` clause — the shared condition validator for rules
 * and for annotation presence. Rejects anything the resolver could not
 * evaluate: a wrong shape, an unknown leg, an unknown state, a stop id no stop
 * actually has, or a `visited` naming an annotation the site does not contain.
 * `at` names the offending piece for the author.
 */
function validateWhen(
  at: string,
  when: unknown,
  stopIds: ReadonlySet<string>,
  annotationIds: ReadonlySet<string>,
): void {
  if (typeof when !== "object" || when === null || Array.isArray(when)) {
    throw new Error(`SiteConfig: ${at} "when" must be an object of conditions`);
  }
  for (const [key, value] of Object.entries(when as Record<string, unknown>)) {
    if (!(KNOWN_CONDITION_KEYS as readonly string[]).includes(key)) {
      throw new Error(
        `SiteConfig: ${at} has unknown condition "${key}" — known conditions: ${KNOWN_CONDITION_KEYS.join(", ")}`,
      );
    }
    const values = Array.isArray(value) ? value : [value];
    if (values.length === 0) {
      throw new Error(`SiteConfig: ${at} condition "${key}" is an empty list — remove it, or name a value`);
    }
    for (const entry of values) {
      if (typeof entry !== "string") {
        throw new Error(`SiteConfig: ${at} condition "${key}" must be a string or list of strings`);
      }
      if (key === "state" && !(KNOWN_STATES as readonly string[]).includes(entry)) {
        throw new Error(
          `SiteConfig: ${at} condition "state" has unknown value "${entry}" — known states: ${KNOWN_STATES.join(", ")}`,
        );
      }
      if (key === "stop" && !stopIds.has(entry)) {
        throw new Error(
          `SiteConfig: ${at} condition "stop" references unknown stop id "${entry}" — conditions may only name existing stops`,
        );
      }
      // A `visited` names an annotation, so it gets the same reference check
      // stops get: a typo'd marker id would otherwise be a condition that can
      // never hold, which reads to the author as "my rule is broken".
      if (key === "visited" && !annotationIds.has(entry)) {
        throw new Error(
          `SiteConfig: ${at} condition "visited" references unknown annotation id "${entry}" — conditions may only name existing annotations`,
        );
      }
      // The reserved key space, condition side. `flag` cannot be reference
      // checked (author flags are free-form), so letting it reach into the
      // runtime's records would quietly forfeit the check above.
      if (key === "flag" && entry.startsWith(VISITED_PREFIX)) {
        throw new Error(
          `SiteConfig: ${at} condition "flag" may not start with "${VISITED_PREFIX}" — that key space belongs to activation records; ask with the "visited" condition instead`,
        );
      }
    }
  }
}

/**
 * Pre-flight for the D31 authoring surface on annotations — the rule list and
 * the presence clause, both of which speak the same condition vocabulary:
 * structural shape, vocabulary membership, and reference integrity against the
 * site's stops, its annotations, and its (post-seeding) block list. Throws with
 * a descriptive message on the first offence — same contract as the rest of
 * normalizeSiteConfig.
 */
export function validateAnnotationRules(
  annotations: readonly { id: string; rules?: unknown; presence?: unknown }[],
  blocks: readonly RuleBlockRef[],
  /** Ids are optional in the schema because normalizeSiteConfig backfills them
   *  ("stop-<n>") before this runs; an id still missing here belongs to a stop
   *  nothing can name, so a condition naming it is correctly rejected. */
  stops: readonly { id?: string }[],
  refs: {
    /** The site's declared sounds — what a `play-audio` effect may name. */
    audio?: readonly { id: string }[];
    /** Handler names the consuming site has registered. ABSENT means "the caller
     *  has no handler information", which is not the same as an empty list: only
     *  a caller that really knows its registry can say a name is missing. */
    registeredHandlers?: readonly string[];
  } = {},
): void {
  const blockIds = new Set(blocks.map((block) => block.id));
  const audioIds = new Set((refs.audio ?? []).map((sound) => sound.id));
  const registeredHandlers = refs.registeredHandlers === undefined
    ? undefined
    : new Set(refs.registeredHandlers);
  /** template id → the effect that claims it, site-wide. */
  const claimedTemplates = new Map<string, string>();
  const stopIds = new Set(
    stops.map((stop) => stop.id).filter((id): id is string => id !== undefined),
  );
  // The full set up front, not "annotations seen so far": a rule may name a
  // marker declared later in the list, and a visitor's click order has nothing
  // to do with authoring order.
  const annotationIds = new Set(annotations.map((annotation) => annotation.id));
  for (const annotation of annotations) {
    const where = `annotation "${annotation.id}"`;
    if (annotation.presence !== undefined) {
      validateWhen(`${where} presence`, annotation.presence, stopIds, annotationIds);
    }
    if (annotation.rules === undefined) continue;
    if (!Array.isArray(annotation.rules)) {
      throw new Error(`SiteConfig: ${where} rules must be an array of rule objects`);
    }
    for (const [index, rule] of (annotation.rules as unknown[]).entries()) {
      const at = `${where} rule ${index + 1}`;
      if (typeof rule !== "object" || rule === null) {
        throw new Error(`SiteConfig: ${at} must be an object`);
      }
      const record = rule as Record<string, unknown>;
      if (typeof record.on !== "string" || !(KNOWN_TRIGGERS as readonly string[]).includes(record.on)) {
        throw new Error(
          `SiteConfig: ${at} has unknown trigger "${String(record.on)}" — known triggers: ${KNOWN_TRIGGERS.join(", ")}`,
        );
      }
      if (record.when !== undefined) {
        validateWhen(at, record.when, stopIds, annotationIds);
      }
      if (!Array.isArray(record.do) || record.do.length === 0) {
        throw new Error(`SiteConfig: ${at} needs a non-empty "do" array of effects`);
      }
      // Two show-blocks effects in ONE rule naming exactly the same ids are
      // refused (ticket 13): the re-activation toggle keys on a live claim, so
      // the second effect of the pair would CLOSE what the first just opened —
      // the rule's first activation would visibly do nothing. The pair is
      // authoring nonsense in every model (one claim shows the ids already);
      // rejected at load, never silently cancelled (ADR-0001).
      {
        const seenShowLists = new Set<string>();
        for (const effect of record.do as unknown[]) {
          const candidate = effect as Record<string, unknown> | null;
          if (candidate?.kind !== "show-blocks" || !Array.isArray(candidate.blocks)) continue;
          // NUL-joined: no block id can contain it, so two distinct lists can
          // never collide into one key.
          const key = (candidate.blocks as unknown[]).join("\u0000");
          if (seenShowLists.has(key)) {
            throw new Error(
              `SiteConfig: ${at} has two show-blocks effects naming exactly the same blocks — the second would close what the first opened; one effect shows them together`,
            );
          }
          seenShowLists.add(key);
        }
      }
      for (const effect of record.do as unknown[]) {
        if (typeof effect !== "object" || effect === null) {
          throw new Error(`SiteConfig: ${at} has an effect that is not an object`);
        }
        const kind = (effect as Record<string, unknown>).kind;
        if (typeof kind !== "string" || !(KNOWN_EFFECT_KINDS as readonly string[]).includes(kind)) {
          throw new Error(
            `SiteConfig: ${at} has unknown effect kind "${String(kind)}" — known kinds: ${KNOWN_EFFECT_KINDS.join(", ")}`,
          );
        }
        // Dispatch through the registry. The membership check above has already
        // established that `kind` names a real entry, so the lookup cannot miss.
        EFFECT_KINDS[kind as RuleEffect["kind"]].validate(effect as Record<string, unknown>, {
          at,
          annotationId: annotation.id,
          blockIds,
          audioIds,
          stopIds,
          annotationIds,
          registeredHandlers,
          claimedTemplates,
        });
      }
    }
  }
}
