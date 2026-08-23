/**
 * DisplayChannel — the blocks channel, as a pure store
 *
 * The channel records WHO is showing WHAT. Each entry is a claim: one
 * annotation, and the block ids one of its display effects put on screen
 * together. A visit's shown content is the union of the live claims.
 *
 * Nothing here removes anything on its own (ticket 17). The channel used to be
 * split into a screen half and a world half, each holding exactly one thing, so
 * a second panel silently displaced the first — a rule no author could reach.
 * That is gone. What survives is a DEFAULT the author states once and any
 * single effect may override: `takeover`, which REMOVES content shown by a
 * DIFFERENT annotation when this one shows its own. Content from the SAME
 * annotation is never evicted automatically; an annotation whose several
 * effects cover each other is a composition its author owns.
 *
 * When content ends ON ITS OWN is the claim's authored LIFETIME (ticket 13):
 * the default re-activation toggle, a discrete `until` ending, or a stay-while
 * condition. Each ending is an explicit transition below — the store itself
 * still decides nothing; the runtime tells it what happened.
 *
 * Overlap is therefore allowed, and it is the author's business — *"the purpose
 * of the toolkit is to ensure they can do that, as well as ensure they have the
 * means to avoid it."*
 *
 * PURE module — no DOM, camera, or Spark imports, ever. It sits at seam 1 with
 * the resolver and the memory store, so lm-check asserts the whole channel
 * contract headlessly; the runtime's only job is to feed it and to hand the
 * union to the text system.
 *
 * THE IDENTITY CONTRACT. A transition that changes nothing returns the SAME
 * state object. The runtime leans on it (`applyDisplayChannel` skips its work
 * on identity, so a repeat click cannot restart a fade), and breaking it has no
 * test failure and no visible symptom — `TextSystem.setShownBlockIds` guards by
 * set CONTENT, so a store returning a fresh object every call merely does
 * needless work, invisibly. lm-check §17b asserts it directly for that reason.
 */

import { DEFAULT_LIFETIME, type EffectLifetime, type RuleWhen } from "./RuleModel";
import { matchesWhen, type WhenContext } from "./RuleResolver";

/**
 * One annotation's live display: the ids a single `show-blocks` effect put up,
 * together, and who put them there.
 *
 * Keyed by OWNER rather than by space, because "whose content is this?" is the
 * only question eviction needs to answer. One annotation may hold SEVERAL
 * claims at once: a rule carries any number of effects and the runtime runs
 * them in sequence, so two `show-blocks` effects on one marker is ordinary
 * authoring — and collapsing them to one claim would be same-source eviction,
 * which the author explicitly withdrew.
 */
export interface DisplayClaim {
  /** The annotation whose effect showed these blocks. */
  readonly owner: string;
  /** Block ids shown together by ONE effect, in that effect's order. The order
   *  matters only for re-activation equality — see `showBlocks`. */
  readonly blocks: readonly string[];
  /** When this content ends ON ITS OWN (ticket 13) — the effect's authored
   *  lifetime, or the default (`until: "re-activation"`) where it stated none.
   *  Stored on the claim so every ending consults what the content was shown
   *  UNDER, never what a later edit to the rule says. Governs self-ending
   *  only: takeover and `dismissAll` remove claims whatever this holds. */
  readonly lifetime: EffectLifetime;
}

/** Does this lifetime end on the named discrete ending? The `forever` and
 *  `while` forms end on none of them. */
function endsOn(lifetime: EffectLifetime, ending: "re-activation" | "travel"): boolean {
  return typeof lifetime === "object" && "until" in lifetime && lifetime.until === ending;
}

/** The stay-while form's condition, or undefined for the other forms. */
function whileOf(lifetime: EffectLifetime): RuleWhen | undefined {
  return typeof lifetime === "object" && "while" in lifetime ? lifetime.while : undefined;
}

export interface DisplayChannelState {
  /** The live claims. Order between DIFFERENT owners carries no meaning and
   *  nothing reads it: the runtime converts this to a set of ids immediately
   *  and the text system compares membership only. Do not build an ordering
   *  contract here — there is no consumer for one. */
  readonly claims: readonly DisplayClaim[];
}

/** Nothing shown. The state a visit starts in, and what a runtime resets to.
 *  FROZEN: this is a shared module-level object exported publicly, so every
 *  runtime on the page starts from this one instance and a mutation through it
 *  would poison every mount. */
export const EMPTY_DISPLAY_CHANNEL: DisplayChannelState = Object.freeze({
  claims: Object.freeze([] as readonly DisplayClaim[]),
});

/** Same ids in the same order — the test behind re-activation equality. */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * Run a `show-blocks` effect against the channel — always an ACTIVATION of
 * `owner`, because `activate` is the only trigger the vocabulary has.
 *
 * `blockExists` answers whether the site really has a block; an id it rejects
 * is DROPPED rather than thrown on. Pre-flight is what refuses a dangling
 * reference at load — by the time a visitor clicks, throwing would kill the
 * activation and take the rest of the rule's effects with it.
 *
 * `takeover` is the resolved value for THIS effect: the effect's own
 * `takeover`, else the site's `settings.blocks.takeover`, else `true`. It
 * removes claims held by OTHER owners. It never touches this owner's claims.
 *
 * `lifetime` is the effect's authored lifetime; absent = the default
 * (`until: "re-activation"`). THE TOGGLE (ticket 13) lives here, keyed on the
 * LIVE CLAIM's stored lifetime, never on selection: a re-activation of the
 * same marker whose effect's shown content is live under `until:
 * "re-activation"` REMOVES that claim instead of re-showing it. Content live
 * under any other lifetime is left exactly as it stands (an identity no-op) —
 * "nothing else ends this one" is what the other forms mean.
 *
 * `context` is the moment of the activation. A `while` lifetime is evaluated
 * against it at show time: a condition that does not hold shows nothing — and
 * evicts nothing, because takeover is a property of showing. "Stays while X"
 * cannot begin while not-X.
 */
export function showBlocks(
  state: DisplayChannelState,
  owner: string,
  blockIds: readonly string[],
  blockExists: (id: string) => boolean,
  opts: { readonly takeover: boolean; readonly lifetime?: EffectLifetime; readonly context: WhenContext },
): DisplayChannelState {
  const kept = blockIds.filter(blockExists);
  if (kept.length === 0) return state;

  // Match on the IDS, not merely on the owner: an annotation with two display
  // effects holds two claims, and re-activating it must close the one this
  // effect opened rather than whichever happens to be first.
  const matchIndex = state.claims.findIndex(
    (claim) => claim.owner === owner && sameIds(claim.blocks, kept),
  );

  if (matchIndex >= 0 && endsOn(state.claims[matchIndex].lifetime, "re-activation")) {
    return { claims: state.claims.filter((_, index) => index !== matchIndex) };
  }

  const lifetime = opts.lifetime ?? DEFAULT_LIFETIME;
  const stayWhile = whileOf(lifetime);
  if (matchIndex < 0 && stayWhile !== undefined && !matchesWhen(stayWhile, opts.context)) {
    return state;
  }

  const survivors = opts.takeover
    ? state.claims.filter((claim) => claim.owner === owner)
    : state.claims;
  const evicted = survivors.length !== state.claims.length;

  if (matchIndex >= 0) {
    // Already showing exactly this, under a lifetime re-activation does not
    // end. If takeover removed nothing either, the whole call changed nothing
    // — return the same object.
    return evicted ? { claims: survivors } : state;
  }
  // The claim's lifetime is a show-time SNAPSHOT, never a live reference into
  // the rule: the author panel edits rule objects in place, and a claim whose
  // ending changed retroactively would contradict what the content was shown
  // under. The frozen default needs no copy; authored objects get one.
  const stored = typeof lifetime === "string" || lifetime === DEFAULT_LIFETIME
    ? lifetime
    : (JSON.parse(JSON.stringify(lifetime)) as EffectLifetime);
  return { claims: [...survivors, { owner, blocks: kept, lifetime: stored }] };
}

/**
 * The travel ending (ticket 13): arrival at a stop removes every claim shown
 * under `until: "travel"`. Only that lifetime — the ticket's observed defect
 * was two identical-looking boxes behaving oppositely on arrival, and the fix
 * is that what travel ends is now AUTHORED, not a property of which mechanism
 * happened to show the box. Identity when nothing was live under it.
 */
export function endOnTravel(state: DisplayChannelState): DisplayChannelState {
  if (state.claims.length === 0) return state;
  const claims = state.claims.filter((claim) => !endsOn(claim.lifetime, "travel"));
  return claims.length === state.claims.length ? state : { claims };
}

/**
 * The visitor's dismissal — Escape (ticket 13/A3). Clears EVERY claim whatever
 * its lifetime, `forever` and `dismiss` included: lifetime is about content
 * ending on its own, and a visitor pressing a key is not that. Everything on
 * this channel is visitor-activated by construction (`activate` is the only
 * trigger), so there is nothing here Escape must not reach — stop captions and
 * editorial text are binding-driven and never claims. Identity when empty.
 */
export function dismissAll(state: DisplayChannelState): DisplayChannelState {
  return state.claims.length === 0 ? state : { claims: [] };
}

/**
 * Author-mode hygiene: remove claims that can no longer render anything —
 * the owner annotation is gone, or every block the claim names is gone. Not a
 * lifetime — a visitor can never reach either state (annotations and blocks
 * are authored data); the author panel can, by deleting a marker or emptying
 * its copy while the content is live. An orphaned claim renders nothing but
 * still reads as "something is open" to every identity-keyed consumer: the
 * next Escape would dismiss nothing visible and still swallow the press, and —
 * worse — a claim left behind by an emptied-then-retyped copy would make the
 * marker's next activation TOGGLE-CLOSE the phantom instead of opening the
 * box, a click that visibly does nothing. A claim keeping at least one live
 * block stays: it is still showing that block, and the ordinary endings own
 * it. Identity when nothing is orphaned.
 */
export function endOrphanedClaims(
  state: DisplayChannelState,
  refs: {
    readonly ownerExists: (annotationId: string) => boolean;
    readonly blockExists: (blockId: string) => boolean;
  },
): DisplayChannelState {
  if (state.claims.length === 0) return state;
  const claims = state.claims.filter(
    (claim) => refs.ownerExists(claim.owner) && claim.blocks.some(refs.blockExists),
  );
  return claims.length === state.claims.length ? state : { claims };
}

/**
 * Re-evaluate every stay-while claim against a fresh context, removing those
 * whose condition stopped holding. The runtime calls this from each context
 * funnel (engagement change, stop change, memory write) — PULL-based, against
 * the claims that are live right now, so there is no watcher to go stale: a
 * claim that was displaced or dismissed is simply not here to resurrect.
 * Removal is an ENDING, not a suspension — the condition flipping back does
 * not bring the content back; a new activation does. Identity when nothing
 * changed.
 */
export function endStaleWhile(
  state: DisplayChannelState,
  context: WhenContext,
): DisplayChannelState {
  if (state.claims.length === 0) return state;
  const claims = state.claims.filter((claim) => {
    const stayWhile = whileOf(claim.lifetime);
    return stayWhile === undefined || matchesWhen(stayWhile, context);
  });
  return claims.length === state.claims.length ? state : { claims };
}

/** Everything the channel is showing, as the text system wants it: one set of
 *  ids, claims united. The channel keeps them apart to decide eviction; the
 *  renderer only needs to know what is on. */
export function shownBlockIds(state: DisplayChannelState): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const claim of state.claims) {
    for (const id of claim.blocks) ids.add(id);
  }
  return ids;
}
