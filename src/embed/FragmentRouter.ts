/**
 * FragmentRouter — host-side URL routing for `<splat-site>`.
 *
 * P0 established the inversion: static HTML is the canonical page and the embed
 * is removable enhancement. P1 keeps it intact by keeping `location` HOST-owned.
 * The element never reads or writes global state; it exposes only a typed command
 * API (`goToStopById` / `goToObject` / `clearSelection`) and typed events
 * (`stopchanged` / `selectionchanged` / `linkactivate`). This module is the host's
 * half — an exported, reusable helper that translates between the two.
 *
 * Everything below the parser implements the plan's frozen navigation state
 * machine (3 states · 12 lifecycle transitions · a 5-branch `begin()` classifier ·
 * a 5-row retirement table · 7 cross-cutting rules). Its governing invariant:
 *
 *     every path from a single user action performs AT MOST ONE history write
 *     and AT MOST ONE announcement.
 *
 * Six verified facts make a naive router wrong, and each is load-bearing here:
 *  1. `onTransition` clears the annotation on DEPARTURE (SiteRuntime.ts:540-543),
 *     before any arrival — so a latch cleared by "any selection event" clears early.
 *     Hence navigation TOKENS, retired only by their own terminal signal.
 *  2. One history traversal can fire `popstate` AND `hashchange` — two signals,
 *     one navigation. Hence `lastConsumedHref`, which outlives token retirement.
 *  3. `reportStop` deduplicates by id (SiteRuntime.ts:512-517) and
 *     `CameraRail.goToStop` returns immediately when `stops.length < 2`
 *     (CameraRail.ts:193-194) — a VALID command can emit no event at all. Hence C4.
 *  4. Host anchors natively scroll, moving the hero off-screen before the camera
 *     has gone anywhere. Hence R1's eligible-click interception.
 *  5. `CameraRail.currentStop` is only reassigned at animation completion
 *     (CameraRail.ts:137-139, :375) — during flight it is the SOURCE index, so
 *     index equality is NEVER arrival evidence. Hence `motionState`.
 *  6. A reboot opens a fresh per-load `whenReady` and increments `loadId`
 *     (SplatSiteElement.ts:617-628) — a router awaiting the FIRST promise is dead
 *     after a retry. Hence per-load re-arming (N0/R4).
 *
 * And two more:
 *  7. `connectedCallback` → `boot()` emits `loadstart` BEFORE its first `await`
 *     (SplatSiteElement.ts:370-374, :629), and `defineSplatSite()` upgrades the
 *     already-parsed element synchronously. A router that only listens for FUTURE
 *     `loadstart` events misses load 1 entirely. Hence A0 arms from the element's
 *     CURRENT state.
 *  8. A load can fail before `whenReady` ever resolves, while the router is still
 *     `idle`. Hence NL2 is reachable from any state, not only from a pending token.
 */

import type { SplatSiteElement, SplatSiteStopDetail } from "./SplatSiteElement";

// ─── The pure half ────────────────────────────────────────

/** A target parsed from a URL fragment. `object` is parsed for FORWARD
 *  COMPATIBILITY only — the P1 router ignores it and lets the browser handle
 *  `#object:` as an ordinary in-page anchor (spec §10 row 10 puts object URLs
 *  in P4). P4 flips one branch in the router; this parser does not change. */
export type RouteTarget =
  | { readonly kind: "stop"; readonly id: string }
  | { readonly kind: "object"; readonly id: string };

/** The kinds the router acts on in P1. */
export const ROUTED_KINDS: ReadonlySet<RouteTarget["kind"]> = new Set(["stop"]);

/**
 * Parse `#stop:{id}` / `#object:{id}`. PURE — no `location`, no DOM.
 * Returns null for an empty hash, an unknown prefix, or an empty id.
 * The id is `decodeURIComponent`-ed; a malformed escape yields null rather
 * than throwing (a bad URL must never break boot).
 */
export function parseFragment(hash: string): RouteTarget | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw === "") return null;
  const sep = raw.indexOf(":");
  if (sep <= 0) return null;
  const kind = raw.slice(0, sep);
  if (kind !== "stop" && kind !== "object") return null;
  let id: string;
  try {
    id = decodeURIComponent(raw.slice(sep + 1));
  } catch {
    return null;
  }
  if (id === "") return null;
  return { kind, id };
}

/** Inverse of `parseFragment`. Always emits a leading `#`. */
export function formatFragment(target: RouteTarget): string {
  return `#${target.kind}:${encodeURIComponent(target.id)}`;
}

// ─── Public options / handle ──────────────────────────────

export interface SiteRoutingOptions {
  /** Only the PRIMARY connection reads or writes `location`. Exactly one per
   *  Window — a second primary THROWS (D3, review #22). Default true. */
  primary?: boolean;
  /** Announce arrivals to assistive tech (spec §8: on arrival, not per frame). */
  announce?: (message: string) => void;
  /** Called for a fragment that names no routable target, after the fallback. */
  onInvalidTarget?: (target: RouteTarget | null) => void;
  /** Move focus on arrival. Called only for user-initiated navigations —
   *  never for the initial resolution (that would yank focus on page load). */
  onArrivalFocus?: (target: RouteTarget) => void;
  /** D17 — fired when the INITIAL route resolution landed on a routed target
   *  (the cold deep link: a visitor arrived with `#stop:…` already in the URL).
   *  Fires exactly once per resolved initial navigation and interacts with
   *  neither history nor announcements. Hosts use it to draw attention to the
   *  engagement affordance without stealing focus on page load. */
  onColdArrival?: (target: RouteTarget) => void;
  /** Terminal-signal watchdog, ms. Default 8000. */
  arrivalTimeoutMs?: number;
  /** Ids of blocks whose text duplicates prose already in the host HTML.
   *  Their lane DOM renders `aria-hidden="true"` with NON-FOCUSABLE links
   *  (spec §8: one copy, not two). Default: none — nothing is hidden unless
   *  the host says so. Pure sugar: this assigns the element property of the
   *  same name once at connect, which is the single authority. */
  duplicatedBlockIds?: readonly string[];
}

export interface SiteRoutingResult {
  /** False only when the load failed. Reveal MUST gate on this (review-2 #6). */
  readonly ok: boolean;
  /** True when a routable target was actually navigated to; false for a
   *  deferred kind (C2), an empty hash (C1), or a reconciled timeout (N12). */
  readonly routed: boolean;
  readonly error?: unknown;
}

export interface SiteRoutingHandle {
  /** The resolution result for the CURRENT load. A getter, not a fixed promise —
   *  every `loadstart` installs a fresh one, so a retry re-routes and re-reveals
   *  (N0/R4). Never rejects. */
  readonly firstResolution: Promise<SiteRoutingResult>;
  /** Public navigation entrypoint — the only way source "api" is produced.
   *  Used by the link seam (`registerLinkDefault`) and by any host that wants to
   *  drive routing itself. */
  navigate(target: RouteTarget): void;
  /** Detach every listener and release the primary claim. Idempotent. */
  dispose(): void;
}

// ─── One primary per Window, ENFORCED (D3 / review #22) ───
// Module-level, so a deterministic failure replaces caller discipline.
const PRIMARY_CLAIMS = new WeakSet<Window>();

// ─── Internals ────────────────────────────────────────────

type NavSource = "initial" | "history" | "anchor" | "api" | "manual";

type NavState =
  | { name: "idle" }
  | {
      name: "navigating";
      token: number;
      target: RouteTarget;
      source: NavSource;
      deadline: number;
      normalized: boolean;
    }
  | { name: "reconciling"; token: number };

/** What `begin()` was handed. `parseFragment` collapses "empty hash" and
 *  "unparseable hash" both to null, but C1 and C3 treat them completely
 *  differently — an empty hash is terminal with ZERO writes, an unparseable one
 *  normalizes to stop 0. So the caller classifies and the distinction is carried
 *  in the type rather than re-derived. */
type BeginInput =
  | { kind: "empty" }
  | { kind: "unparseable" }
  | { kind: "target"; target: RouteTarget };

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Classify `location.hash` for `begin()`. */
function classifyHash(hash: string): BeginInput {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw === "") return { kind: "empty" };
  const target = parseFragment(hash);
  return target === null ? { kind: "unparseable" } : { kind: "target", target };
}

function sameTarget(a: RouteTarget, b: RouteTarget): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/**
 * Connect a `<splat-site>` element to the host page's URL.
 *
 * The returned handle's `firstResolution` is what a host gates its reveal on —
 * and it must gate on `ok === true`, or a failed load re-adds the "live" class
 * after the error listener removed it (R3).
 */
export function connectSiteRouting(
  element: SplatSiteElement,
  opts: SiteRoutingOptions = {},
): SiteRoutingHandle {
  const primary = opts.primary ?? true;
  const timeoutMs = opts.arrivalTimeoutMs ?? 8000;

  if (primary) {
    if (PRIMARY_CLAIMS.has(window)) {
      throw new Error(
        "connectSiteRouting: a primary routing connection already exists for this window — pass { primary: false } for additional embeds",
      );
    }
    PRIMARY_CLAIMS.add(window);
  }

  // R5: a non-primary connection wires events and the command API and performs
  // ZERO location reads and ZERO history writes. Every "primary" guard below is
  // what makes that true rather than merely documented.

  let disposed = false;
  let state: NavState = { name: "idle" };
  let tokenSeq = 0;
  /** Was the in-flight anchor navigation activated by keyboard (click detail 0)?
   *  Decides whether the arrival moves focus — see the arrival block. */
  let anchorWasKeyboard = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  /** Records the location string each traversal already consumed, so a paired
   *  popstate+hashchange cannot reissue after the token retired (fact 2).
   *  Keyed on the FULL href, not the parsed target — it must outlive retirement. */
  let lastConsumedHref: string | null = null;

  /** The load this router is armed for. Set at CONNECT from the element's current
   *  loadId (fact 7), then re-armed on every `loadstart` (fact 6). */
  let armedLoadId: number | null = null;

  /** Mirror of the runtime's `reportedStopId` (SiteRuntime.ts:506-518), kept in
   *  step because the router observes every `stopchanged` the runtime emits.
   *  It is what makes C4 exact — see `willBeSilent` below. Reset by N0, because
   *  a reboot builds a fresh runtime whose own `reportedStopId` starts null. */
  let lastReportedStopId: string | null = null;

  /** Per-load; N0 replaces it so a retry re-resolves and re-reveals (R4). */
  let resolution = deferred<SiteRoutingResult>();
  let resolutionSettled = false;

  function settle(result: SiteRoutingResult): void {
    if (resolutionSettled) return;
    resolutionSettled = true;
    resolution.resolve(result);
  }

  /** Only the INITIAL token's outcome settles `firstResolution`; a later
   *  anchor/history navigation must not re-settle (or, after N0, mis-settle) it. */
  function settleIfInitial(source: NavSource, result: SiteRoutingResult): void {
    if (source === "initial") settle(result);
  }

  function freshResolution(): void {
    resolution = deferred<SiteRoutingResult>();
    resolutionSettled = false;
  }

  // ─── History writes (primary only) ──────────────────────

  /**
   * Every router-owned write also re-bases the traversal guard.
   *
   * Two bugs are prevented at once, and they pull in opposite directions:
   *
   *  - Leaving the guard STALE discards a legitimate Back. Consider:
   *    Back to #stop:overview (guard := overview) → anchor click pushes
   *    #stop:workbench → Back to #stop:overview. Without re-basing, that Back's
   *    href still equals the guard and N2′ swallows it.
   *  - Clearing the guard to NULL breaks C3. `replaceState` does not fire
   *    `hashchange`, but a traversal's own queued `hashchange` still arrives
   *    AFTER C3 rewrote the URL; with a null guard it would re-enter `begin`
   *    against the normalized hash and issue a SECOND command.
   *
   * Re-basing to the URL we just wrote satisfies both: the pending paired event
   * matches and is suppressed, while any later traversal to a different URL
   * still passes.
   */
  function noteOwnWrite(): void {
    lastConsumedHref = location.href;
  }

  function replaceFragment(fragment: string): void {
    if (!primary) return;
    history.replaceState(history.state, "", fragment);
    noteOwnWrite();
  }

  function pushFragment(fragment: string): void {
    if (!primary) return;
    history.pushState(history.state, "", fragment);
    noteOwnWrite();
  }

  function announce(message: string): void {
    opts.announce?.(message);
  }

  // ─── Token lifecycle ────────────────────────────────────

  function clearWatchdog(): void {
    if (watchdog !== null) {
      clearTimeout(watchdog);
      watchdog = null;
    }
  }

  /** Drop a pending token with NO history write and NO announcement. Used by
   *  N0 (reboot), NL2 (failure) and N7 (supersede) — all three are cases where
   *  the navigation did not happen and must leave no trace. */
  function abandonToken(): void {
    clearWatchdog();
    state = { name: "idle" };
  }

  function armWatchdog(token: number): void {
    clearWatchdog();
    watchdog = setTimeout(() => {
      // N9 — navigating, now > deadline → reconciling.
      if (disposed) return;
      if (state.name !== "navigating" || state.token !== token) return;
      reconcile(state);
    }, timeoutMs);
  }

  /**
   * N12 — reconcile a timed-out navigation to OBSERVED state.
   *
   * A wedged runtime is not an arrival, so this never synthesizes success: no
   * push, no arrival announcement. And it must cancel motion BEFORE reading,
   * because mid-flight `currentStopIndex` is still the SOURCE stop (fact 5) —
   * replacing to it would label a wedged in-between pose with the name of a stop
   * the camera already left.
   */
  function reconcile(pending: Extract<NavState, { name: "navigating" }>): void {
    clearWatchdog();
    state = { name: "reconciling", token: pending.token };

    element.cancelMotion();

    // Idle is not a nicety here — it is the precondition for the read being
    // meaningful at all. If motion could not be halted, `currentStopIndex` is
    // still the SOURCE stop, so writing it would label a wedged in-between pose
    // with the name of a stop the camera already left. Better an untouched URL
    // than a confidently wrong one, so on a failed cancel we write NOTHING.
    const observed = element.motionState === "idle"
      ? element.stopByIndex(element.currentStopIndex)
      : null;
    if (observed) {
      replaceFragment(formatFragment({ kind: "stop", id: observed.id }));
    }

    // Exactly ONE warning, whichever branch ran.
    console.warn(
      observed
        ? `[splat-site routing] navigation to "${pending.target.id}" produced no arrival within ${timeoutMs}ms; URL reconciled to "${observed.id}" and no arrival was announced`
        : `[splat-site routing] navigation to "${pending.target.id}" produced no arrival within ${timeoutMs}ms; motion could not be confirmed idle (motionState: "${element.motionState}"), so the URL was left untouched and no arrival was announced`,
    );
    state = { name: "idle" };
    settleIfInitial(pending.source, { ok: true, routed: false });
  }

  /**
   * N8 — the SINGLE write/announce point for an owned navigation.
   *
   * Part 3's retirement table, verbatim:
   *   normalized=true  (C3 already wrote) → no write · announce · focus unless initial
   *   false + initial                     → one replaceState (R2) · announce · NEVER focus
   *   false + history                     → no write (browser already moved) · announce · focus
   *   false + anchor/api                  → one pushState · announce · focus
   *   false + manual                      → one replaceState · announce · no focus
   */
  function retire(
    pending: Extract<NavState, { name: "navigating" }>,
    detail: SplatSiteStopDetail,
  ): void {
    clearWatchdog();
    state = { name: "idle" };

    if (!pending.normalized) {
      const fragment = formatFragment(pending.target);
      if (pending.source === "initial" || pending.source === "manual") {
        replaceFragment(fragment);
      } else if (pending.source === "anchor" || pending.source === "api") {
        pushFragment(fragment);
      }
      // "history": the browser already moved the URL — writing again duplicates.
    }

    announce(detail.label);

    // Focus on user-initiated arrivals only. The initial resolution must never
    // steal focus on page load; a manual (scroll-rail) arrival is not a gesture.
    if (pending.source !== "initial" && pending.source !== "manual") {
      // D18 — R1 suppressed the anchor's native jump, so the scene may still be
      // off-screen when focus lands on it. Bring it into view first. `"nearest"`
      // is the general rule: an already-visible scene costs nothing. Engagement
      // is NOT touched — scrolling is not a gesture of intent.
      element.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "nearest",
      });
      // ⚠ Moving focus is for KEYBOARD-activated prose links only (§12: "focus
      // after a keyboard-activated prose navigation goes to the entry toggle").
      // A MOUSE click must not: the host points this at the engage toggle, and
      // taking focus off the canvas silently kills WASD for an engaged visitor
      // who merely clicked a link. Scrolling into view still happens for both —
      // that is D18's general rule, independent of input device.
      if (pending.source !== "anchor" || anchorWasKeyboard) {
        opts.onArrivalFocus?.(pending.target);
      }
    }

    // D17 — the cold deep link. Announced and settled like any other arrival;
    // this hook adds no history write and no announcement of its own.
    if (pending.source === "initial") {
      // F3 — the browser's NATIVE fragment scroll has already yanked the page to
      // whichever prose section carries this id (host pages give their sections
      // the same `stop:x` ids), so by the time the scene resolves it is off
      // screen. D17's invitation — a disengaged scene with a pulsing switch — is
      // meaningless where nobody can see it, so the cold arrival brings the
      // scene back. Instantly ("auto"): this is page load, not a gesture, and a
      // smooth scroll would animate from wherever the native jump dumped us.
      element.scrollIntoView({ behavior: "auto", block: "nearest" });
      opts.onColdArrival?.(pending.target);
    }

    settleIfInitial(pending.source, { ok: true, routed: true });
  }

  // ─── Part 2 — begin(): classify, then act ───────────────

  function begin(input: BeginInput, source: NavSource, normalized = false): void {
    if (disposed) return;

    // N7 supersede — AND the termination half of C1/C2/C3.
    //
    // Every re-entry into `begin` while a token is in flight abandons it, silently:
    // no history write, no announcement. That is N7 for a different target, and it
    // is also what makes C1 and C2 genuinely TERMINAL — a surviving token would
    // later retire and push a fragment the visitor had just cleared. It equally
    // covers C3's unparseable path, whose delegated call would otherwise find the
    // old token still installed and let it retire with its ORIGINAL source,
    // producing a second history write on top of C3's own.
    //
    // The one exception is a repeat of the navigation already under way: that is
    // not a new action, so it must not restart the deadline or re-command. It is
    // excluded when normalizing, because C3's delegation must re-install the token
    // with `normalized: true` to suppress the retirement write.
    //
    // NEVER consult currentStopIndex here; the camera is still heading elsewhere
    // (fact 5).
    if (state.name === "navigating") {
      if (input.kind === "target" && !normalized && sameTarget(state.target, input.target)) {
        return;
      }
      abandonToken();
    }

    // C1 — empty/absent hash. TERMINAL, ZERO writes, zero announcements.
    if (input.kind === "empty") {
      settleIfInitial(source, { ok: true, routed: false });
      return;
    }

    // C2 — a parsed-but-DEFERRED kind (`#object:` — spec §10 row 10 → P4).
    // "Ignored" means ignored, not invalid: no command, no history, no announce,
    // no onInvalidTarget. Native anchor behavior stands, so `#object:drone`
    // behaves in P1 exactly as it did in P0.
    if (input.kind === "target" && !ROUTED_KINDS.has(input.target.kind)) {
      settleIfInitial(source, { ok: true, routed: false });
      return;
    }

    // Commands are rejected while not ready, never buffered — and id resolution
    // is meaningless then (stopIndexById returns -1 for "unknown" AND for "not
    // ready", so treating it as invalid here would normalize a perfectly good
    // fragment away). NL1 re-reads the live hash on ready, so nothing is lost.
    if (element.readyState !== "ready") return;

    const index = input.kind === "target" ? element.stopIndexById(input.target.id) : -1;

    // C3 — unparseable hash, or a stop id that names nothing. Normalize ONCE,
    // then DELEGATE: the delegated branch owns the command and the announcement,
    // and `normalized: true` suppresses its retirement write so the total stays
    // at exactly one write and one announcement.
    if (input.kind === "unparseable" || index === -1) {
      const first = element.stopByIndex(0);
      if (!first) {
        // A site with no stops has nothing to fall back to.
        opts.onInvalidTarget?.(input.kind === "target" ? input.target : null);
        settleIfInitial(source, { ok: true, routed: false });
        return;
      }
      const fallback: RouteTarget = { kind: "stop", id: first.id };
      replaceFragment(formatFragment(fallback));
      opts.onInvalidTarget?.(input.kind === "target" ? input.target : null);
      begin({ kind: "target", target: fallback }, source, true);
      return;
    }

    const target = (input as { kind: "target"; target: RouteTarget }).target;

    // R7 — INSTALL THE TOKEN BEFORE ISSUING THE COMMAND. ALWAYS.
    // `cutToStop` fires `stopchanged` SYNCHRONOUSLY inside the command call.
    // (Reduced motion no longer routes here — it flies slower now, see
    // planTravel — but cutToStop is still public API and still reachable, so
    // this invariant stands.) With the token installed afterward,
    // that arrival would land while the machine is still `idle`, be mistaken for
    // an unowned arrival (N11 — wrong write, wrong semantics), and the real token
    // would then sit until the watchdog. This order is FIXED; do not reorder it.
    const token = ++tokenSeq;
    const pending: Extract<NavState, { name: "navigating" }> = {
      name: "navigating",
      token,
      target,
      source,
      deadline: Date.now() + timeoutMs,
      normalized,
    };
    state = pending;
    armWatchdog(token);

    // C4 — the command will emit NO `stopchanged`, so nothing would ever retire
    // the token and it must be retired synchronously instead (which is simply N8
    // running re-entrantly on an already-installed token).
    //
    // The predicate is about EVENT EMISSION, not about camera position, and the
    // difference is not academic — it was measured. Emission fails in exactly two
    // ways (fact 3):
    //   · `CameraRail.goToStop` returns immediately when `stops.length < 2`
    //     (CameraRail.ts:193-194), so the rail never moves and never arrives;
    //   · `reportStop` deduplicates by stable id (SiteRuntime.ts:512-517), so an
    //     arrival at the stop already announced emits nothing.
    //
    // ⚠ The tempting proxy `index === currentStopIndex && motionState === "idle"`
    // is WRONG, and shipping it produced a real double-write: on a cold visit to
    // `#stop:nope`, C3 normalizes to stop 0 — where the camera already is, at rest
    // — so the proxy claims silence, yet `goToStop(0)` still enters `Animating`,
    // completes a frame later and fires a genuine arrival. Having already retired,
    // the machine is `idle`, so N11 reads that arrival as UNOWNED and writes and
    // announces a second time. Observed: two replaceStates, two announcements.
    //
    // `stopByIndex(1) === null` is how "fewer than two stops" is asked without a
    // separate stop-count accessor.
    const willBeSilent = element.stopByIndex(1) === null || lastReportedStopId === target.id;

    try {
      element.goToStopById(target.id);
    } catch (error) {
      // A command rejected after the readiness check (a reboot raced us) is not
      // an arrival. Drop the token silently rather than stranding it.
      abandonToken();
      console.warn(`[splat-site routing] goToStopById("${target.id}") was rejected`, error);
      settleIfInitial(source, { ok: true, routed: false });
      return;
    }

    if (willBeSilent && state.name === "navigating" && state.token === token) {
      const detail = element.stopByIndex(index) ?? { index, id: target.id, label: target.id };
      retire(pending, detail);
    }
  }

  // ─── Part 1 — lifecycle transitions ─────────────────────

  /** N1 — resolve the CURRENT hash as the initial navigation. */
  function runInitialResolution(): void {
    if (disposed) return;
    if (!primary) {
      // R5: a non-primary connection never reads location. It is "resolved"
      // immediately so a host gating a reveal on it still works.
      settle({ ok: true, routed: false });
      return;
    }
    begin(classifyHash(location.hash), "initial");
  }

  /** NL1/NL2 — attach to ONE load's readiness. The captured id is what makes a
   *  superseded promise's rejection (AbortError) harmless: N0 has already moved
   *  `armedLoadId`, so the stale settlement is dropped here. */
  function attachToLoad(loadId: number): void {
    element.whenReady.then(
      (detail) => {
        if (disposed || detail.loadId !== armedLoadId) return;
        runInitialResolution();
      },
      (error) => {
        if (disposed || loadId !== armedLoadId) return;
        // NL2 — reachable from ANY state including idle (fact 8): a cold failure
        // happens before any token exists, and `firstResolution` must still settle.
        abandonToken();
        settle({ ok: false, routed: false, error });
      },
    );
  }

  /** N0 — a new load began. Re-arm everything per `loadId` (R4). */
  const onLoadStart = (event: Event): void => {
    if (disposed) return;
    const detail = (event as CustomEvent<{ loadId: number }>).detail;
    armedLoadId = detail.loadId;
    lastConsumedHref = null;
    // A reboot builds a fresh runtime whose `reportedStopId` starts null, so the
    // mirror must start null too or C4 would claim silence for a stop the NEW
    // runtime has never announced.
    lastReportedStopId = null;
    abandonToken(); // silently — no history, no announce
    freshResolution();
    attachToLoad(detail.loadId);
  };

  /** NL2 — an explicit load failure for the armed load. */
  const onLoadError = (event: Event): void => {
    if (disposed) return;
    const detail = (event as CustomEvent<{ loadId: number; error: unknown }>).detail;
    if (detail.loadId !== armedLoadId) return;
    abandonToken();
    settle({ ok: false, routed: false, error: detail.error });
  };

  /**
   * N8 (owned arrival) and N11 (unowned arrival).
   *
   * Terminal evidence for a token is an ARRIVAL — a `stopchanged` whose id equals
   * the target's. Nothing else: in particular not `selectionchanged` (fact 1),
   * and never `currentStopIndex` equality (fact 5).
   */
  const onStopChanged = (event: Event): void => {
    if (disposed) return;
    const detail = (event as CustomEvent<SplatSiteStopDetail>).detail;
    // Keep the dedup mirror in step BEFORE branching: C4's silence predicate
    // depends on it, and it must be true whether the arrival was owned or not.
    lastReportedStopId = detail.id;

    if (state.name === "navigating") {
      if (detail.id === state.target.id) retire(state, detail);
      // An arrival that is not ours leaves the token pending — the camera is
      // still on its way, and only its own arrival retires it.
      return;
    }

    // N11 — an UNOWNED arrival: a scroll-rail arrival, a manual prev/next, or a
    // host `goToStop`. Exactly one replaceState + exactly one announcement.
    //
    // Why replaceState and not pushState (spec §5.2: "History records semantic
    // arrivals only, never camera samples"): a rail arrival IS semantic, so the
    // URL must reflect it — but the visitor performed no navigation GESTURE, so
    // a Back entry would make Back mean "undo my scrolling", which §7's
    // rail/waypoint model does not intend.
    if (state.name === "idle" && primary) {
      replaceFragment(formatFragment({ kind: "stop", id: detail.id }));
      announce(detail.label);
    }
  };

  /** N2 / N2′ — one navigation may fire popstate AND hashchange. */
  const onLocationChanged = (): void => {
    if (disposed || !primary) return;
    // N2′ — the paired second event of one traversal (fact 2). The guard is the
    // FULL href, which outlives token retirement; a `pendingNav`-only guard fails
    // precisely when the first event retired synchronously.
    if (location.href === lastConsumedHref) return;
    lastConsumedHref = location.href;
    begin(classifyHash(location.hash), "history");
  };

  /**
   * R1 — anchor interception, capture phase on the host document.
   *
   * Handled ONLY when every condition holds: left button, no modifier, not
   * `target="_blank"`, same-document, `href` starts with `#`, and `parseFragment`
   * yields a ROUTED kind that resolves to a real stop. Everything else is
   * untouched — including `#object:drone` — so every link's no-JS behavior is
   * preserved byte-for-byte when the router is absent.
   */
  const onDocumentClick = (event: Event): void => {
    if (disposed || !primary) return;
    const ev = event as MouseEvent;
    if (ev.defaultPrevented) return;
    if (ev.button !== 0) return;
    if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return;

    const anchor = ev
      .composedPath()
      .find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
    if (!anchor) return;
    if (anchor.target !== "" && anchor.target !== "_self") return;
    if (anchor.hasAttribute("download")) return;

    const href = anchor.getAttribute("href");
    if (href === null || !href.startsWith("#")) return;

    const target = parseFragment(href);
    // Only ROUTED kinds are intercepted. A deferred `#object:` must fall through
    // to native behavior, or D2's deferral is violated.
    if (!target || !ROUTED_KINDS.has(target.kind)) return;
    if (element.readyState !== "ready") return;
    if (element.stopIndexById(target.id) === -1) return;

    // A keyboard-activated click reports detail 0; a real pointer click reports
    // 1+. Recorded here because the arrival — where focus is decided — cannot
    // see the originating event.
    anchorWasKeyboard = ev.detail === 0;
    // This is what stops the native scroll from yanking the hero off-screen.
    ev.preventDefault();
    begin({ kind: "target", target }, "anchor");
  };

  /** R6 — the public entrypoint, and the only way source "api" is produced. */
  function navigate(target: RouteTarget): void {
    begin({ kind: "target", target }, "api");
  }

  // ─── R6 / Step 3.5 — register the link default action ───
  // REGISTER a default; do NOT listen for `linkactivate`. The element owns the
  // default action and runs it after `dispatchEvent` returns, so a host listener
  // registered at ANY time can still cancel it.
  const linkDefault = (detail: {
    href: string;
    kind: "fragment" | "external";
  }): boolean => {
    if (disposed) return false;
    if (detail.kind === "fragment") {
      const target = parseFragment(detail.href);
      // Only ROUTED kinds are intercepted — a deferred `#object:` reports
      // "not handled" so the screen-lane anchor's native jump stands.
      if (target && ROUTED_KINDS.has(target.kind)) {
        navigate(target);
        return true;
      }
      return false;
    }
    // World blocks have no anchor and therefore no default action of their own.
    window.location.assign(detail.href);
    return true;
  };

  // ─── A0 — arm from the element's CURRENT load, not a future event ───

  element.addEventListener("loadstart", onLoadStart);
  element.addEventListener("loaderror", onLoadError);
  element.addEventListener("stopchanged", onStopChanged);
  if (primary) {
    window.addEventListener("popstate", onLocationChanged);
    window.addEventListener("hashchange", onLocationChanged);
    document.addEventListener("click", onDocumentClick, true);
  }
  element.registerLinkDefault(linkDefault);

  if (opts.duplicatedBlockIds !== undefined) {
    // Sugar over the element property, which is the single authority.
    element.duplicatedBlockIds = opts.duplicatedBlockIds;
  }

  armedLoadId = element.loadId;
  switch (element.readyState) {
    case "ready":
      runInitialResolution();
      break;
    case "loading":
      attachToLoad(element.loadId);
      break;
    case "error":
      settle({ ok: false, routed: false, error: new Error("element is in an error state") });
      break;
    case "disconnected":
      // Stay idle and wait for `loadstart` (N0).
      break;
  }

  return {
    get firstResolution(): Promise<SiteRoutingResult> {
      return resolution.promise;
    },
    navigate,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      clearWatchdog();
      element.removeEventListener("loadstart", onLoadStart);
      element.removeEventListener("loaderror", onLoadError);
      element.removeEventListener("stopchanged", onStopChanged);
      if (primary) {
        window.removeEventListener("popstate", onLocationChanged);
        window.removeEventListener("hashchange", onLocationChanged);
        document.removeEventListener("click", onDocumentClick, true);
        PRIMARY_CLAIMS.delete(window);
      }
      element.unregisterLinkDefault(linkDefault);
      // A host awaiting a resolution that can no longer arrive must not hang.
      settle({ ok: false, routed: false, error: new Error("routing disposed") });
    },
  };
}
