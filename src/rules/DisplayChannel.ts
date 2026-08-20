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
 * Run a `show-blocks` effect against the channel.
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
 * `isReactivation` is true when the visitor clicked the marker that is already
 * selected. Then, if this owner already holds a claim showing exactly these
 * ids, that claim is REMOVED instead of re-shown — which is what makes a second
 * click close what the first click opened. Without it a repeat effect would be
 * an identity no-op and the content would be stuck on screen.
 */
export function showBlocks(
  state: DisplayChannelState,
  owner: string,
  blockIds: readonly string[],
  blockExists: (id: string) => boolean,
  opts: { readonly takeover: boolean; readonly isReactivation: boolean },
): DisplayChannelState {
  const kept = blockIds.filter(blockExists);
  if (kept.length === 0) return state;

  // Match on the IDS, not merely on the owner: an annotation with two display
  // effects holds two claims, and re-activating it must close the one this
  // effect opened rather than whichever happens to be first.
  const matchIndex = state.claims.findIndex(
    (claim) => claim.owner === owner && sameIds(claim.blocks, kept),
  );

  if (opts.isReactivation && matchIndex >= 0) {
    return { claims: state.claims.filter((_, index) => index !== matchIndex) };
  }

  const survivors = opts.takeover
    ? state.claims.filter((claim) => claim.owner === owner)
    : state.claims;
  const evicted = survivors.length !== state.claims.length;

  if (matchIndex >= 0) {
    // Already showing exactly this. If takeover removed nothing either, the
    // whole call changed nothing — return the same object.
    return evicted ? { claims: survivors } : state;
  }
  return { claims: [...survivors, { owner, blocks: kept }] };
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
