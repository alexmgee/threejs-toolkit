/**
 * ModeLocks — which modes are on offer, and what a mode effect does to that (D31)
 *
 * Progressive freedom. A scene may start with tour, explore, or both locked; a
 * marker's rule can hand one over (`allow`), take one back (`deny`), or walk the
 * visitor straight through a door (`engage`). What is offered is a fact about
 * THIS VISIT — it resets on reload with everything else, because the load config
 * is the only thing that outlives a visit.
 *
 * The one decision that is not additive: denying the visitor's CURRENT mode
 * lands them at the frozen frame. That is the universal safe landing — the state
 * every visitor starts in, the one that needs no permission, and the only one a
 * restriction can never strand them outside of.
 *
 * Author mode ignores all locks (story 33). Deliberately expressed as an
 * OVERRIDE at the reading edge (`offeredModes`) rather than by refusing to write
 * the locks: the underlying set keeps recording exactly what a visitor would be
 * left with, which is what ticket 10's preview affordance needs to read. An
 * author who never sees the visitor's truth cannot check their own gating.
 *
 * PURE module — no DOM, camera, or Spark imports, ever, so lm-check asserts every
 * transition headlessly. The runtime holds the resulting set and derives its
 * chrome from it; nothing here knows a switch exists.
 */

import { KNOWN_MODES, type ModeEffect, type RuleEngagementState, type SceneMode } from "./RuleModel";

/** Re-exported from the schema that owns it — a consumer transitioning modes
 *  needs the type without reaching past this module. */
export type { SceneMode };

/** Every mode, the set author mode always sees. Built once: it never changes,
 *  and handing out one shared reference keeps the "same set means nothing
 *  changed" test below meaningful for an author too. */
const ALL_MODES: ReadonlySet<SceneMode> = new Set(KNOWN_MODES);

/** Everything a mode decision depends on. Bundled rather than passed loose so a
 *  caller cannot supply the offered set and forget the author flag — which would
 *  read as "the author is locked out" and be a very quiet bug. */
export interface ModeState {
  /** The modes this visit has been offered — the load config's locks as edited
   *  by every `allow`/`deny`/`engage` so far. VISITOR TRUTH: author mode
   *  overrides what is read from it, never what is written to it. */
  readonly offered: ReadonlySet<SceneMode>;
  /** Who owns input right now. Needed because denying the mode the visitor is
   *  currently IN is the one mode effect that moves them. */
  readonly engagement: RuleEngagementState;
  /** Author mode ignores all locks. */
  readonly authorMode: boolean;
}

/** What a mode effect leaves behind: the new offered set, and where the visitor
 *  must now be. */
export interface ModeTransition {
  /** The offered set after the effect — the same reference when nothing
   *  changed, the signal the blocks and audio channels already use, so a caller
   *  can skip rebuilding chrome on a no-op. */
  readonly offered: ReadonlySet<SceneMode>;
  /** Where the visitor must be after this effect. Unchanged unless the effect
   *  was an `engage` (which enters its mode) or a `deny` that took away the mode
   *  they were in (which returns them to the frozen frame). */
  readonly engagement: RuleEngagementState;
}

/**
 * The offered set a visit STARTS with: every mode the site did not lock.
 *
 * An absent or empty lock list is the ordinary scene — both doors open, nothing
 * for the author to have written.
 */
export function initialOffered(lockedModes: readonly SceneMode[] | undefined): ReadonlySet<SceneMode> {
  if (lockedModes === undefined || lockedModes.length === 0) return ALL_MODES;
  const locked = new Set<SceneMode>(lockedModes);
  return new Set(KNOWN_MODES.filter((mode) => !locked.has(mode)));
}

/**
 * The modes on offer right now, as anything that shows or selects one must ask.
 *
 * THE author override lives here and only here: in author mode every mode is
 * offered regardless of what the locks say, so no load config and no `deny` can
 * shut an author out of the scene they are editing.
 */
export function offeredModes(state: ModeState): ReadonlySet<SceneMode> {
  return state.authorMode ? ALL_MODES : state.offered;
}

/**
 * Which door the switch opens: the first offered mode in the mode row's own
 * order, so the switch always enters the leftmost word a visitor can read as
 * available.
 *
 * NULL when nothing is offered — and that answer is load-bearing beyond the
 * switch's destination. The author settled on 2026-08-10 that a switch with
 * nowhere to go is not shown at all: with every mode locked the only way into 3D
 * is a marker whose rule grants one, and the switch reappears the moment one
 * does. (This supersedes the spec's original v1 "the switch is always present"
 * guarantee, and pulls v2 ledger item 6 forward for exactly this case.)
 */
export function entryMode(offered: ReadonlySet<SceneMode>): SceneMode | null {
  return KNOWN_MODES.find((mode) => offered.has(mode)) ?? null;
}

/**
 * Apply one mode effect. THE transition seam — every change to what is offered,
 * and every mode change a lock forces, is decided here and nowhere else.
 *
 * `engage` grants its mode as it enters it, so the visitor is never left inside a
 * mode the row still greys. `allow` grants without entering — walking through
 * the door stays the visitor's own act, which is why they are two verbs. `deny`
 * withdraws, and if it took the mode the visitor was in, the transition lands
 * them back at the frozen frame.
 */
export function applyModeEffect(state: ModeState, effect: ModeEffect): ModeTransition {
  const has = state.offered.has(effect.mode);
  const changed = effect.kind === "deny" ? has : !has;
  let offered = state.offered;
  if (changed) {
    const next = new Set(state.offered);
    if (effect.kind === "deny") next.delete(effect.mode);
    else next.add(effect.mode);
    offered = next;
  }
  // `engage` is the only verb that moves the visitor deliberately; the other two
  // move them only as a consequence of losing the ground under their feet.
  let engagement = effect.kind === "engage" ? effect.mode : state.engagement;
  // The safe landing, checked against what is EFFECTIVELY offered so an author
  // is never ejected by a lock they are exempt from.
  const onOffer = offeredModes({ ...state, offered });
  if (engagement !== "disengaged" && !onOffer.has(engagement)) engagement = "disengaged";
  return { offered, engagement };
}
