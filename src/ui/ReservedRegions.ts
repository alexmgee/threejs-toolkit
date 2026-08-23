/**
 * ReservedRegions — where the engagement chrome is, so no panel is drawn on it
 *
 * The rule (author, 2026-08-09, after two withdrawn forms — see ticket 06):
 * NOTHING THE AUTHOR DID NOT PLACE COVERS THE SWITCH OR THE MODE WORDS. Every
 * panel names its own slot and the toolkit obeys it, over the chrome if that is
 * what was named; what remains to guard is geometry nobody chose — the
 * full-width bar the narrow-screen collapse imposes (a DEFAULT since ticket 17,
 * so with it switched off there is no imposed bar and this contract simply does
 * not fire), and the editorial columns
 * a stop's copy is migrated into. There is no author-versus-toolkit test in this
 * module: the caller decides whether to ask at all.
 *
 * Two halves:
 *
 *   THE REGISTRY. The chrome publishes its rectangles; whoever lays out a panel
 *   reads them. Scoped per embedded scene, because two <splat-site> elements on
 *   one page each own a switch and neither should push the other's panels about.
 *
 *   THE CHOOSER. Pure geometry: given the boxes a panel could occupy, in
 *   preference order, return one that no reserved region covers — by taking a
 *   clear alternative where one exists, and otherwise by narrowing the box until
 *   it clears.
 *
 *   ⚠ Every production caller passes exactly ONE candidate today. Since every
 *   panel names its own slot (ticket 06), the only geometry left to guard is the
 *   full-width bar the narrow-screen collapse imposes — when it happens at all,
 *   which since ticket 17 is the author's call — and a bar spans both
 *   corners by construction — there is no alternative to offer, only width to
 *   give up. The multi-candidate path is exercised only by lm-check §6. Kept
 *   because it is what makes the single-candidate case a special case of one
 *   rule rather than a rule of its own; delete it if a second caller never
 *   appears.
 *
 * PURE module — no DOM types, ever, and `scope` is a bare object key. That is
 * what lets lm-check §6 assert the whole contract on real numbers headlessly,
 * leaving the browser seam to prove only that a real switch and a real panel
 * report rectangles this module then keeps apart.
 *
 * Why a registry at all, rather than moving the seeded literal to the clear
 * corner: that corner is clear by luck. Handoff 001 §6b says as much — "left is
 * coincidentally clear". Nothing holds it clear. Published geometry survives the
 * chrome moving; a literal silently stops being true.
 */

/** An axis-aligned rectangle, in whatever one coordinate space a caller uses
 *  throughout (the runtime uses viewport pixels, as `getBoundingClientRect`
 *  reports them). Field names match DOMRect so a measured rect needs no
 *  translation to become one of these. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** One box a panel could occupy. `slot` is opaque here — the text model's
 *  "left" | "right" | "bottom" travels through untouched, which keeps this
 *  module free of any dependency on the text model. */
export interface PanelCandidate<S extends string = string> {
  slot: S;
  box: Rect;
}

export interface PanelChoice<S extends string = string> {
  slot: S;
  box: Rect;
  /** True when the box had to give up width to clear a reserved region — the
   *  caller writes a different inset for a narrowed box than for a whole one. */
  narrowed: boolean;
}

/**
 * Do two rectangles share any area?
 *
 * STRICT: a shared edge is not an overlap. Load-bearing — narrowing lands a box
 * exactly on a reserved rectangle's edge, and under a non-strict test that
 * result would report as still colliding.
 */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** Does any reserved region cover part of this box? */
export function coversAny(box: Rect, reserved: readonly Rect[]): boolean {
  return reserved.some((region) => rectsIntersect(box, region));
}

/**
 * Breathing room every consumer leaves around the chrome.
 *
 * Lives here, not in one consumer, because two of them subtract these regions —
 * the panel lane and the editorial-columns obstacle list — and the two must
 * agree, or text abuts the switch in one place and clears it in the other.
 * Applied by callers rather than baked into the published rectangles, so the
 * registry keeps reporting where the chrome literally is and the chooser stays
 * exactly testable.
 */
export const CHROME_GAP = 12;

/** Grow a rectangle by `by` on every side — the caller's breathing room, kept
 *  out of the geometry itself so the chooser stays exactly testable. */
export function inflate(rect: Rect, by: number): Rect {
  return {
    left: rect.left - by,
    top: rect.top - by,
    right: rect.right + by,
    bottom: rect.bottom + by,
  };
}

/**
 * The widest horizontal run of `band` that no reserved region covers.
 *
 * Only regions that reach the band's OWN ROWS are obstacles: a rectangle above
 * or below it constrains nothing, however close it looks horizontally. That is
 * what reduces this to one dimension — sort the surviving obstacles by their
 * left edge, sweep, and keep the largest gap.
 *
 * Returns null when the obstacles leave no room at all.
 */
export function widestFreeSpan(
  band: Rect,
  reserved: readonly Rect[],
): { left: number; right: number } | null {
  const blockers = reserved
    .filter((region) => region.top < band.bottom && band.top < region.bottom)
    .map((region) => ({ left: region.left, right: region.right }))
    .sort((a, b) => a.left - b.left);

  let best: { left: number; right: number } | null = null;
  // The sweep's frontier: everything left of it is spoken for. It only ever
  // moves right, which is what merges overlapping obstacles (the switch and the
  // mode words overlap horizontally) without a separate merge pass.
  let cursor = band.left;
  const consider = (left: number, right: number): void => {
    if (right <= left) return;
    if (best === null || right - left > best.right - best.left) best = { left, right };
  };
  for (const blocker of blockers) {
    consider(cursor, Math.min(blocker.left, band.right));
    cursor = Math.max(cursor, blocker.right);
    if (cursor >= band.right) break;
  }
  consider(cursor, band.right);
  return best;
}

/**
 * Pick a box for a panel that no reserved region covers.
 *
 * `candidates` are in preference order — the slot the panel asked for first,
 * then any alternative the caller is willing to accept. The first one that is
 * already clear wins outright.
 *
 * Where none is clear, the FIRST candidate is narrowed into the widest run its
 * own rows leave free. It keeps its slot, its top, and its bottom: the author
 * chose width as the thing to give up.
 *
 * Where even that leaves nothing, the first candidate is returned exactly as
 * asked. A panel narrowed to nothing reads to a visitor as content that
 * vanished, which is a worse failure than content that overlaps.
 */
export function choosePanelBox<S extends string>(
  /** At least one, enforced by the type: the fallbacks below all reduce to "the
   *  first candidate", so an empty list has no answer to give. A precondition a
   *  caller can violate at runtime would fail as `undefined.box` deep inside. */
  candidates: readonly [PanelCandidate<S>, ...PanelCandidate<S>[]],
  reserved: readonly Rect[],
): PanelChoice<S> {
  for (const candidate of candidates) {
    if (!coversAny(candidate.box, reserved)) {
      return { slot: candidate.slot, box: candidate.box, narrowed: false };
    }
  }
  const first = candidates[0];
  const span = widestFreeSpan(first.box, reserved);
  if (span === null || span.right - span.left >= first.box.right - first.box.left) {
    return { slot: first.slot, box: first.box, narrowed: false };
  }
  return {
    slot: first.slot,
    box: { left: span.left, right: span.right, top: first.box.top, bottom: first.box.bottom },
    narrowed: true,
  };
}

/* ── The registry ────────────────────────────────────────────────────────── */

/** Anything with object identity: the runtime keys by the scene's container
 *  element, lm-check by a bare `{}`. Weak, so a torn-down scene's regions go
 *  with it and a runtime that forgets to withdraw leaks nothing. */
type Scope = object;

const regionsByScope = new WeakMap<Scope, Map<string, Rect>>();
const listenersByScope = new WeakMap<Scope, Set<() => void>>();

function sameRect(a: Rect, b: Rect): boolean {
  return a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;
}

/**
 * Declare where one piece of chrome is, or withdraw it with `null`.
 *
 * Keyed, so republishing replaces: the switch moves on every resize and on a
 * safe-area change, and a registry that appended would reserve its own history.
 *
 * Idempotent by value. The resize path republishes constantly, and waking every
 * panel in the scene for an unchanged rectangle would be a per-frame relayout.
 */
export function publishReservedRegion(scope: Scope, key: string, rect: Rect | null): void {
  const regions = regionsByScope.get(scope);
  if (rect === null) {
    if (regions === undefined || !regions.delete(key)) return;
    notify(scope);
    return;
  }
  const existing = regions?.get(key);
  if (existing !== undefined && sameRect(existing, rect)) return;
  // Copy: a caller handing over a live DOMRect-derived object must not be able
  // to mutate what the registry reports, or the idempotence check above compares
  // a value against itself and never notifies.
  const stored: Rect = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  if (regions === undefined) regionsByScope.set(scope, new Map([[key, stored]]));
  else regions.set(key, stored);
  notify(scope);
}

/** Every region currently reserved in this scene, in publication order. */
export function reservedRegions(scope: Scope): readonly Rect[] {
  const regions = regionsByScope.get(scope);
  return regions === undefined ? [] : [...regions.values()];
}

/**
 * Hear about changes to this scene's reserved regions.
 *
 * A panel is laid out once and then left alone; without this it would keep a
 * stale answer until something unrelated forced it to lay out again. Returns the
 * unsubscribe function.
 */
export function subscribeReservedRegions(scope: Scope, listener: () => void): () => void {
  let listeners = listenersByScope.get(scope);
  if (listeners === undefined) {
    listeners = new Set();
    listenersByScope.set(scope, listeners);
  }
  const owned = listeners;
  owned.add(listener);
  return () => {
    owned.delete(listener);
    if (owned.size === 0) listenersByScope.delete(scope);
  };
}

function notify(scope: Scope): void {
  const listeners = listenersByScope.get(scope);
  if (listeners === undefined) return;
  // Copy first: a listener that re-lays-out a panel may dispose it, and a
  // SlotManager unsubscribes as it goes.
  for (const listener of [...listeners]) listener();
}
