/**
 * SplatSiteElement — the <splat-site src="…" author> Web Component
 *
 * Boots the shared SiteRuntime from a fetched site.json into an encapsulated
 * Shadow DOM, and tears it down on disconnect. The runtime does all the wiring;
 * this element owns only the boundary: the shadow root, the chrome styles that
 * the host page's stylesheets can't reach, a fetch guarded by a generation
 * token (so a superseded `src` or a disconnect never boots a dead tree),
 * disposal, and the public event/command API.
 *
 * `defineSplatSite()` is the only public runtime surface (barrel-exported). It
 * is inert, idempotent, and SSR-safe: the element class extends HTMLElement, so
 * it is created only inside that call — in a browser — meaning importing the
 * toolkit barrel during server-side rendering never evaluates HTMLElement. The
 * types below are erased at runtime and so are always safe to import.
 *
 * NOTE: there is deliberately no `setScene()`. `site.scenes` are simultaneous
 * transformed LAYERS composing one world (per-scene transforms + props; stops,
 * blocks, obstacles and annotations are site-level with no scene binding; props
 * flatten across all scenes and locative distance always uses scenes[0]), so
 * there is no "active scene" to select. Mesh-only visibility would orphan every
 * one of those. Alternatives need an authorable visibility grammar first.
 */

import { createSiteRuntime, resolveSiteAssets, type SiteRuntimeHandle } from "./SiteRuntime";
import type { CustomHandler } from "../rules/HandlerRegistry";
import { normalizeSiteConfig } from "../site/SiteConfig";

// ─── Public types (erased — importing these is always SSR-safe) ───

export type SplatSiteReadyState = "loading" | "ready" | "error" | "disconnected";

/** A stop's stable `id` (normalize-assigned) plus its author-mutable `label` —
 *  key off `id`, display `label`. */
export interface SplatSiteStopDetail {
  readonly index: number;
  readonly id: string;
  readonly label: string;
}

export interface SplatSiteHotspotDetail {
  readonly id: string;
}

export interface SplatSiteSelectionDetail {
  /** The newly active object id, or null when selection was cleared. */
  readonly id: string | null;
}

export interface SplatSiteEngagementDetail {
  readonly engaged: boolean;
  readonly mode: "tour" | "explore" | null;
}

export interface SplatSiteMemoryDetail {
  /** Every scene-memory flag set this visit: authored flag names plus
   *  `visited:<id>` records for markers the visitor has activated. Sorted. */
  readonly flags: readonly string[];
}

export interface SplatSiteLinkActivateDetail {
  readonly href: string;
  readonly blockId: string;
  /** Index of the linked run, or null for a block-level href. */
  readonly runIndex: number | null;
  readonly kind: "fragment" | "external";
}

/**
 * A handler a `custom` rule effect can name (D31, story 38) — the single
 * ADR-0001 escape hatch, so bespoke behavior lives as typed code in the
 * consuming site project while site.json stays data.
 *
 * Receives the activating annotation's id, the moment the rule was resolved
 * against, and the site's own runtime handle — the same surface this element's
 * commands drive, so a handler can move the camera or select an object without
 * the toolkit having to anticipate it as an effect kind.
 */
export type SplatSiteRuleHandler = CustomHandler<SiteRuntimeHandle>;

export interface SplatSiteLoadStartDetail {
  readonly loadId: number;
  readonly src: string;
}

export interface SplatSiteReadyDetail {
  /** Monotonic per-load id — increments on every (re)boot. */
  readonly loadId: number;
  /** The FINAL url the config was fetched from (after any redirect). */
  readonly src: string;
  readonly name: string;
  readonly initialStop: SplatSiteStopDetail | null;
  /** Number of stops — the valid `goToStop` range is 0..stopCount-1. */
  readonly stopCount: number;
}

export interface SplatSiteLoadErrorDetail {
  readonly loadId: number;
  readonly src: string;
  readonly error: unknown;
}

export interface SplatSiteLoadProgressDetail {
  /** 0..1, monotonic, reaching exactly 1 at reveal. */
  readonly progress: number;
}

// ─── Cross-window bridge protocol (P2b) — erased types for parent pages ───
// The bridge is OPT-IN: it exists only when the element carries BOTH
// `bridge-origin` (the exact origin of the intended parent — never a wildcard)
// and `bridge-id` (host-assigned, unique per element — the envelope target).

/** Command envelope a parent posts to the frame containing the element. */
export interface SplatSiteBridgeCommand {
  readonly channel: "splat-site";
  readonly version: 1;
  /** Must equal the element's `bridge-id` — with several embeds in one frame,
   *  exactly one may act on a message. */
  readonly target: string;
  readonly command:
    | "goToStop"
    | "goToStopById"
    | "goToObject"
    | "clearSelection"
    | "getState";
  readonly args?: { readonly index?: number; readonly id?: string };
  /** Required, non-empty string (bounded) — echoed on the reply. */
  readonly requestId: string;
}

/** Everything the element posts back to the parent. */
export type SplatSiteBridgeMessage =
  | {
      readonly channel: "splat-site";
      readonly version: 1;
      readonly source: string;
      readonly kind: "event";
      readonly type: keyof SplatSiteEventMap;
      readonly detail: unknown;
      readonly loadId: number;
    }
  | {
      readonly channel: "splat-site";
      readonly version: 1;
      readonly source: string;
      readonly kind: "commandresult";
      readonly requestId: string;
      readonly ok: true;
      readonly result?: unknown;
    }
  | {
      readonly channel: "splat-site";
      readonly version: 1;
      readonly source: string;
      readonly kind: "commanderror";
      readonly requestId: string;
      readonly error: { readonly name: string; readonly message: string };
    };

/** The `getState` handshake result — lets a parent that attached late (missed
 *  `ready`) recover the current state. */
export interface SplatSiteBridgeState {
  readonly readyState: SplatSiteReadyState;
  readonly loadId: number;
  readonly src: string;
  readonly name: string | null;
  readonly stopCount: number | null;
  readonly currentStop: SplatSiteStopDetail | null;
  readonly engaged: boolean;
  readonly engagedMode: "tour" | "explore" | null;
}

export interface SplatSiteEventMap {
  /** A load began (initial boot, or a `src`/`author` change). */
  loadstart: CustomEvent<SplatSiteLoadStartDetail>;
  /** The scenes have streamed in and are on screen — the real "ready". */
  ready: CustomEvent<SplatSiteReadyDetail>;
  /** The config fetch, the config itself, or a scene failed to load. */
  loaderror: CustomEvent<SplatSiteLoadErrorDetail>;
  /** Load progress 0..1 for a host loading indicator, reported (throttled) until
   *  the scenes reveal, ending at exactly 1. Monotonic. */
  loadprogress: CustomEvent<SplatSiteLoadProgressDetail>;
  /** The docked/active stop changed. Fires on rail ARRIVAL, deduplicated.
   *  Means "this stop became active" — NOT "the camera reached its authored
   *  orientation exactly" (a pointer can cancel the orientation settle). */
  stopchanged: CustomEvent<SplatSiteStopDetail>;
  /** An annotation marker was clicked. */
  hotspotclick: CustomEvent<SplatSiteHotspotDetail>;
  /** The active object (annotation) changed — including to nothing (`id: null`).
   *  Unlike `hotspotclick`, this distinguishes select from deselect. */
  selectionchanged: CustomEvent<SplatSiteSelectionDetail>;
  engagementchange: CustomEvent<SplatSiteEngagementDetail>;
  /** Scene memory changed — a marker was activated, or a rule set a flag.
   *  Carries the whole store, so a host needs no bookkeeping to know the
   *  current state; diff against the last detail for the increment. Resets on
   *  reload (and on a reboot, which is a new visit). */
  memorychanged: CustomEvent<SplatSiteMemoryDetail>;
  /** A link inside site text was activated. CANCELABLE: the host may
   *  preventDefault() to take over. Otherwise the registered default (installed
   *  by `connectSiteRouting`) handles it. */
  linkactivate: CustomEvent<SplatSiteLinkActivateDetail>;
}

/** The `<splat-site>` element's public surface. The implementation class is not
 *  exported (it must not be constructed before `defineSplatSite()` registers the
 *  tag), so this erased interface is what consumers type against. */
export interface SplatSiteElement extends HTMLElement {
  /** Config URL. Changing it reboots the element. */
  src: string | null;
  /** Enable the author panel + on-canvas authoring tools. */
  author: boolean;
  /** Base URL of the toolkit's bundled font families on the host (the
   *  `font-base` attribute) — required for correct text layout off-origin. */
  fontBase: string | null;
  readonly readyState: SplatSiteReadyState;
  /** Monotonic id of the current load — pair events across a reboot. */
  readonly loadId: number;
  /** Resolves for the CURRENT load when `ready` fires — for consumers that
   *  attach late and would miss the event. Rejects with the load error, or an
   *  AbortError if superseded/disconnected. Internally observed, so ignoring it
   *  never produces an unhandled rejection. */
  readonly whenReady: Promise<SplatSiteReadyDetail>;
  /**
   * Navigate to a stop by index. Throws `InvalidStateError` unless
   * `readyState === "ready"`, and `RangeError` for a non-integer or
   * out-of-range index — commands are rejected, never buffered, and the rail's
   * silent clamp is deliberately not the public contract.
   */
  goToStop(index: number): void;
  /** Resolve a stop id to its index, or -1. Returns -1 while not ready — pair it
   *  with `readyState` to tell "unknown id" from "not ready yet". */
  stopIndexById(id: string): number;
  /** The inverse of `stopIndexById`: index → the stop's stable id and label, or
   *  null when out of range or not ready. Routing needs this direction to name
   *  its fallback stop, to announce a no-op arrival, and to reconcile a timeout. */
  stopByIndex(index: number): SplatSiteStopDetail | null;
  /** Navigate to a stop by its stable id. InvalidStateError / RangeError as goToStop. */
  goToStopById(id: string): void;
  /** Select an object (annotation) by id. Same error contract as `goToStop`:
   *  InvalidStateError when not ready, RangeError for an id that names no
   *  annotation. Does NOT move the camera in P1 — travel on selection is P4
   *  (gate G5). */
  goToObject(id: string): void;
  /** Clear the current selection. InvalidStateError unless ready. */
  clearSelection(): void;
  /** The active object id, or null. `null` while not ready. */
  readonly selectedObject: string | null;
  readonly engaged: boolean;
  readonly engagedMode: "tour" | "explore" | null;
  /** The current stop index, or -1 while not ready. ⚠ During travel this is the
   *  SOURCE stop (CameraRail.ts:137-139, :375) — it is NEVER arrival evidence.
   *  Read it only together with `motionState === "idle"`. */
  readonly currentStopIndex: number;
  /** Authoritative rail motion phase. "idle" is the ONLY value for which
   *  `currentStopIndex` describes where the camera actually is. */
  readonly motionState: "idle" | "traveling" | "settling";
  /** Halt in-flight rail motion so the reported stop becomes real. Used by the
   *  router's timeout reconciliation. No-op when already idle. */
  cancelMotion(): void;
  /** Move focus to the runtime's engage toggle. Silently ignored when not
   *  ready — focusing chrome that does not exist yet is not an error. Never
   *  changes engagement. */
  focusEngagementToggle(): void;
  /** Play the attention pulse on the runtime's engage toggle. Silently ignored
   *  when not ready. Never changes engagement. */
  pulseEngagementToggle(): void;
  /** Ids whose lane DOM duplicates prose already present in the host HTML.
   *  Those blocks render `aria-hidden="true"` with NON-FOCUSABLE links (spec §8:
   *  one copy, not two). ELEMENT-SCOPED: survives every reboot, so a retry
   *  re-applies it automatically. Settable at any time — before boot, while
   *  loading, or after ready. */
  duplicatedBlockIds: readonly string[];
  /**
   * Register (or replace) a rule handler a `custom` effect may name.
   *
   * ELEMENT-scoped: registered handlers survive a `src` change, a failed load's
   * retry, and a re-attach, and are re-seeded into every runtime this element
   * builds. Register BEFORE the scene loads where you can — that is when
   * pre-flight can warn you about a `custom` effect whose handler nobody
   * registered. A later registration still works; it just missed the check.
   */
  registerRuleHandler(name: string, fn: SplatSiteRuleHandler): void;
  unregisterRuleHandler(name: string): void;
  /** Install the default action for `linkactivate`. It runs only when no
   *  listener cancelled the event, and must return whether it handled the link —
   *  an unrouted `#object:` reports false so the anchor's native behavior stands.
   *  `connectSiteRouting` registers this; a host may register its own instead. */
  registerLinkDefault(fn: (detail: SplatSiteLinkActivateDetail) => boolean): void;
  /** Remove a previously registered default (no-op if it is not the current one). */
  unregisterLinkDefault(fn: (detail: SplatSiteLinkActivateDetail) => boolean): void;
  addEventListener<K extends keyof SplatSiteEventMap>(
    type: K,
    listener: (this: SplatSiteElement, ev: SplatSiteEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof SplatSiteEventMap>(
    type: K,
    listener: (this: SplatSiteElement, ev: SplatSiteEventMap[K]) => void,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare global {
  interface HTMLElementTagNameMap {
    // The library owns this tag, so document.querySelector("splat-site") is
    // typed. A collision with another package claiming it is real evidence of a
    // runtime ownership conflict, not merely intrusive typing.
    "splat-site": SplatSiteElement;
  }
}

/** Chrome the SiteRuntime's own DOM (nav bar, container) expects, scoped to the
 *  shadow root. The host page's stylesheets — including the toolkit's own
 *  examples/shared/sandbox-styles.css — cannot cross the shadow boundary, which
 *  is the whole point of the encapsulation, so these rules must live here. */
const CHROME_CSS = `
:host { display: block; position: relative; }
.splat-site-viewport { width: 100%; height: 100%; position: relative; overflow: hidden; }
.splat-site-viewport * { box-sizing: border-box; }
/* Keyboard-focus indication for the engaged canvas. INSET: the viewport's
   overflow:hidden would clip a default outward outline at all four edges,
   silently hiding the focus indicator from keyboard users.
   The hue is the engagement chrome's, not an accent: white, with a dark halo
   behind it so the ring survives a bright scene. A second inset outline is
   impossible, so the halo is an inset box-shadow sitting just inside the
   stroke. Reported as a "green square" in the dry run — the accent green is
   gone from this rule entirely. */
.splat-site-viewport canvas:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.95);
  outline-offset: -3px;
  box-shadow: inset 0 0 0 5px rgba(0, 0, 0, 0.35);
}
.splat-input-bar {
  position: absolute; top: 0; left: 0; z-index: 100;
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px;
  background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(8px);
  border-radius: 0 0 6px 0;
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 12px; color: #ccc;
}
.splat-input-bar button {
  padding: 4px 12px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px; color: rgba(255, 255, 255, 0.92);
  font-family: inherit; font-size: 12px; cursor: pointer;
}
.splat-input-bar button:hover { background: rgba(255, 255, 255, 0.22); }
.splat-input-bar .status {
  color: rgba(255, 255, 255, 0.92); white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; max-width: 200px;
}
`;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Observed here so a consumer who never awaits it sees no unhandled
  // rejection; awaiting consumers still receive the rejection themselves.
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

/**
 * Register the `<splat-site>` custom element. Inert until called, idempotent
 * (a second call is a no-op), and a no-op in non-browser (SSR) environments.
 */
export function defineSplatSite(): void {
  if (typeof customElements === "undefined" || typeof HTMLElement === "undefined") return;
  if (customElements.get("splat-site")) return;

  class SplatSiteElementImpl extends HTMLElement implements SplatSiteElement {
    static get observedAttributes(): string[] {
      return ["src", "author", "font-base", "bridge-origin", "bridge-id"];
    }

    private readonly viewport: HTMLDivElement;
    private runtime: SiteRuntimeHandle | null = null;
    /** Bumped on every (re)boot and teardown; a fetch or runtime callback whose
     *  generation is stale is discarded — guards a superseded `src`, a
     *  disconnect, and events from a runtime being replaced. */
    private generation = 0;
    private state: SplatSiteReadyState = "loading";
    private currentLoadId = 0;
    private currentSrc = "";
    // A config supplied via loadFromJson SUPERSEDES the src attribute: an
    // author/font-base attribute change must re-mount from THIS, not refetch the
    // stale src. Cleared when the src attribute changes (a new src wins).
    private loadedRaw: { rawSite: unknown; assetBaseUrl: string } | null = null;
    private ready: Deferred<SplatSiteReadyDetail> = deferred();
    private readySettled = false;
    /** Host-declared duplicate-prose block ids (spec §8). ELEMENT-scoped, not
     *  per-load: never cleared by `loadstart`, `loaderror`, a `src` change, or a
     *  disconnect, so a retry or re-attach re-applies it automatically. A
     *  runtime-scoped copy would silently lose it on exactly those paths. */
    private duplicatedIds: readonly string[] = [];
    /** Rule handlers a `custom` effect may name (D31, story 38). ELEMENT-scoped
     *  for the same reason as `duplicatedIds`: a site registers its handlers once
     *  at startup, and they must survive a `src` change, a retry, or a re-attach
     *  that builds a whole new runtime underneath. The element holds the
     *  authoritative map and re-seeds every mount from it. */
    private ruleHandlers = new Map<string, SplatSiteRuleHandler>();
    /** Registered by `connectSiteRouting`; runs only if no listener cancelled. */
    private linkDefault: ((detail: SplatSiteLinkActivateDetail) => boolean) | null = null;

    // ── Bridge state (P2b) ──
    /** The validated exact parent origin, or null = bridge off. */
    private bridgeOrigin: string | null = null;
    private bridgeId: string | null = null;
    /** Bumped on every bridge rewire — a reply captured under an old config
     *  must not be delivered under a new one (separate from `generation`,
     *  which tracks runtime loads; bridge attrs rewire WITHOUT a reboot). */
    private bridgeGeneration = 0;
    private bridgeListener: ((event: MessageEvent) => void) | null = null;
    /** State cache for the getState handshake (late parents missed `ready`). */
    private lastStop: SplatSiteStopDetail | null = null;
    private readyName: string | null = null;
    private readyStopCount: number | null = null;
    /** Last announced engagement, so a `loadstart` reset can be reported. A
     *  reboot silently returns the scene to disengaged; without this, a host
     *  subscribed to `engagementchange` would still believe it is engaged. */
    private lastEngaged = false;
    private lastEngagementMode: "tour" | "explore" | null = null;

    constructor() {
      super();
      const root = this.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = CHROME_CSS;
      root.appendChild(style);
      // Attach the viewport to the shadow root now, so the runtime's root-aware
      // style installs (getRootNode) resolve to this ShadowRoot, not the document.
      this.viewport = document.createElement("div");
      this.viewport.className = "splat-site-viewport";
      root.appendChild(this.viewport);
    }

    // ─── Public API ──────────────────────────────────────

    get src(): string | null {
      return this.getAttribute("src");
    }

    set src(value: string | null) {
      if (value === null) this.removeAttribute("src");
      else this.setAttribute("src", value);
    }

    get author(): boolean {
      return this.hasAttribute("author");
    }

    set author(value: boolean) {
      if (value) this.setAttribute("author", "");
      else this.removeAttribute("author");
    }

    get fontBase(): string | null {
      return this.getAttribute("font-base");
    }

    set fontBase(value: string | null) {
      if (value === null) this.removeAttribute("font-base");
      else this.setAttribute("font-base", value);
    }

    get readyState(): SplatSiteReadyState {
      return this.state;
    }

    get loadId(): number {
      return this.currentLoadId;
    }

    get whenReady(): Promise<SplatSiteReadyDetail> {
      return this.ready.promise;
    }

    goToStop(index: number): void {
      // Reject rather than buffer: a command queued during a reboot would land
      // on a DIFFERENT site whose stop count may not even contain the index.
      if (this.state !== "ready" || !this.runtime) {
        throw new DOMException(
          `<splat-site>.goToStop: element is not ready (readyState: "${this.state}")`,
          "InvalidStateError",
        );
      }
      const count = this.runtime.site.stops.length;
      if (!Number.isInteger(index) || index < 0 || index >= count) {
        throw new RangeError(
          `<splat-site>.goToStop: index ${index} is not an integer in range 0..${count - 1}`,
        );
      }
      this.runtime.goToStop(index);
    }

    /** Shared readiness gate — every command below rejects rather than buffers,
     *  for the same reason `goToStop` does: a command queued during a reboot
     *  would land on a DIFFERENT site. */
    private requireReady(method: string): SiteRuntimeHandle {
      if (this.state !== "ready" || !this.runtime) {
        throw new DOMException(
          `<splat-site>.${method}: element is not ready (readyState: "${this.state}")`,
          "InvalidStateError",
        );
      }
      return this.runtime;
    }

    stopIndexById(id: string): number {
      if (this.state !== "ready" || !this.runtime) return -1;
      return this.runtime.stopIndexById(id);
    }

    stopByIndex(index: number): SplatSiteStopDetail | null {
      if (this.state !== "ready" || !this.runtime) return null;
      return this.runtime.stopByIndex(index);
    }

    goToStopById(id: string): void {
      const runtime = this.requireReady("goToStopById");
      const index = runtime.stopIndexById(id);
      if (index === -1) {
        throw new RangeError(`<splat-site>.goToStopById: no stop with id "${id}"`);
      }
      runtime.goToStop(index);
    }

    goToObject(id: string): void {
      this.requireReady("goToObject").goToObject(id);
    }

    clearSelection(): void {
      this.requireReady("clearSelection").clearSelection();
    }

    get selectedObject(): string | null {
      if (this.state !== "ready" || !this.runtime) return null;
      return this.runtime.selectedObject;
    }

    get engaged(): boolean {
      if (this.state !== "ready" || !this.runtime) return false;
      return this.runtime.engagement !== "disengaged";
    }

    get engagedMode(): "tour" | "explore" | null {
      if (this.state !== "ready" || !this.runtime) return null;
      return this.runtime.engagement === "disengaged" ? null : this.runtime.engagement;
    }

    get currentStopIndex(): number {
      if (this.state !== "ready" || !this.runtime) return -1;
      return this.runtime.cameraRail.currentStop;
    }

    get motionState(): "idle" | "traveling" | "settling" {
      if (this.state !== "ready" || !this.runtime) return "idle";
      return this.runtime.motionState;
    }

    cancelMotion(): void {
      // Deliberately NOT gated on readiness: this is a "stop what you are doing"
      // command, and throwing when there is nothing to stop would make the
      // router's timeout reconciliation fail on the very path it exists for.
      this.runtime?.cancelMotion();
    }

    focusEngagementToggle(): void {
      if (this.state !== "ready" || !this.runtime) return;
      this.runtime.focusEngageToggle();
    }

    pulseEngagementToggle(): void {
      if (this.state !== "ready" || !this.runtime) return;
      this.runtime.pulseEngageToggle();
    }

    get duplicatedBlockIds(): readonly string[] {
      return this.duplicatedIds;
    }

    set duplicatedBlockIds(ids: readonly string[]) {
      this.duplicatedIds = [...ids];
      // Apply immediately when a runtime exists; a runtime created LATER picks it
      // up in mountRuntime, before the first text render.
      this.runtime?.setDuplicatedBlockIds(new Set(this.duplicatedIds));
    }

    registerLinkDefault(fn: (detail: SplatSiteLinkActivateDetail) => boolean): void {
      this.linkDefault = fn;
    }

    unregisterLinkDefault(fn: (detail: SplatSiteLinkActivateDetail) => boolean): void {
      if (this.linkDefault === fn) this.linkDefault = null;
    }

    registerRuleHandler(name: string, fn: SplatSiteRuleHandler): void {
      this.ruleHandlers.set(name, fn);
      // Applied to a live runtime too, so registering after the scene is up
      // works — it just missed the load-time check that would have caught a
      // typo'd name before a visitor did.
      this.runtime?.registerRuleHandler(name, fn);
    }

    unregisterRuleHandler(name: string): void {
      this.ruleHandlers.delete(name);
      this.runtime?.unregisterRuleHandler(name);
    }

    /**
     * Dispatch the cancelable `linkactivate` event, then run the registered
     * default IF nobody cancelled.
     *
     * The default must run AFTER `dispatchEvent` returns, never inside a
     * listener: a router that navigated from its own listener would be
     * order-dependent, so any host listener registered LATER could never cancel
     * it — contradicting the advertised takeover. Using `dispatchEvent`'s own
     * boolean return is what makes cancellation order-independent.
     *
     * Returns true when the activation was handled (by a canceling host or by
     * the default), false when nothing handled it — the caller then leaves the
     * anchor's native behavior alone.
     */
    activateLink(detail: SplatSiteLinkActivateDetail): boolean {
      // dispatchEvent returns false iff some listener called preventDefault().
      const notCancelled = this.dispatchEvent(
        new CustomEvent("linkactivate", { detail, cancelable: true }),
      );
      if (!notCancelled) return true; // a host took over; treat as handled
      if (this.linkDefault) return this.linkDefault(detail);
      return false;
    }

    // ─── Lifecycle ───────────────────────────────────────

    connectedCallback(): void {
      // Bridge first: events from the boot below (loadstart, an early ready)
      // must already relay to an opted-in parent.
      this.rewireBridge();
      void this.boot();
    }

    disconnectedCallback(): void {
      this.teardownBridge();
      this.teardown("disconnected");
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
      if (oldValue === newValue || !this.isConnected) return;
      if (name === "src") {
        // A new src supersedes any loaded-JSON config.
        this.loadedRaw = null;
        void this.boot();
      } else if (name === "author" || name === "font-base") {
        // Re-mount with the new attribute. If a config was loaded via
        // loadFromJson, re-mount from THAT (refetching src would silently revert
        // to the old site); otherwise the transactional src boot.
        if (this.loadedRaw) {
          this.mountFresh(this.loadedRaw.rawSite, this.loadedRaw.assetBaseUrl, "loaded JSON");
        } else {
          void this.boot();
        }
      } else if (name === "bridge-origin" || name === "bridge-id") {
        // Bridge config rewires WITHOUT rebooting the runtime — the scene does
        // not depend on it.
        this.rewireBridge();
      }
    }

    // ─── Internals ───────────────────────────────────────

    private settleReady(detail: SplatSiteReadyDetail): void {
      if (this.readySettled) return;
      this.readySettled = true;
      this.state = "ready";
      // Frozen: the same object goes to the promise AND the event — a listener
      // mutating it must not poison the other consumers (or a P2b relay).
      const frozen = Object.freeze(detail);
      this.ready.resolve(frozen);
      this.emit("ready", frozen);
    }

    private failReady(error: unknown): void {
      const detail: SplatSiteLoadErrorDetail = Object.freeze({
        loadId: this.currentLoadId,
        src: this.currentSrc,
        error,
      });
      // A paged scene can flip visible (→ ready) before its load promise
      // rejects: transition to "error" even then, but keep whenReady
      // historically resolved — the promise settled truthfully at the time.
      this.state = "error";
      if (!this.readySettled) {
        this.readySettled = true;
        this.ready.reject(error);
      }
      this.emit("loaderror", detail);
    }

    private emit<K extends keyof SplatSiteEventMap>(
      type: K,
      detail: SplatSiteEventMap[K] extends CustomEvent<infer D> ? D : never,
    ): void {
      // getState cache: a parent that attaches after `ready` recovers this.
      if (type === "loadstart") {
        this.lastStop = null;
        this.readyName = null;
        this.readyStopCount = null;
      } else if (type === "engagementchange") {
        const engagementDetail = detail as SplatSiteEngagementDetail;
        this.lastEngaged = engagementDetail.engaged;
        this.lastEngagementMode = engagementDetail.mode;
      } else if (type === "ready") {
        const ready = detail as SplatSiteReadyDetail;
        this.lastStop = ready.initialStop;
        this.readyName = ready.name;
        this.readyStopCount = ready.stopCount;
      } else if (type === "stopchanged") {
        this.lastStop = detail as SplatSiteStopDetail;
      }
      this.dispatchEvent(new CustomEvent(type, { detail }));
      this.bridgeSend({
        channel: "splat-site",
        version: 1,
        source: this.bridgeId ?? "",
        kind: "event",
        type,
        // loaderror's `error` is arbitrary (an Error doesn't structured-clone
        // consistently, and a stack string would leak cross-origin) — sanitize.
        detail: type === "loaderror"
          ? (() => {
              const e = detail as SplatSiteLoadErrorDetail;
              const err = e.error;
              return {
                loadId: e.loadId,
                src: e.src,
                error: err instanceof Error
                  ? { name: err.name, message: err.message }
                  : { name: "Error", message: String(err) },
              };
            })()
          : detail,
        loadId: this.currentLoadId,
      });
      // A reboot returns the scene to disengaged. Announce it AFTER the loadstart
      // itself, through this same path so the bridge relay carries it too —
      // otherwise a host subscribed to `engagementchange` keeps believing the
      // torn-down runtime is still engaged.
      if (type === "loadstart" && this.lastEngaged) {
        this.emit("engagementchange", Object.freeze({ engaged: false, mode: null }));
      }
    }

    // ─── Cross-window bridge (P2b) ───────────────────────
    // Opt-in, exact-origin, parent-only. Everything that fails the gauntlet is
    // IGNORED silently: replying (or even logging) would hand a hostile sender
    // an error oracle / log-flood primitive.

    private rewireBridge(): void {
      this.teardownBridge();
      const rawOrigin = this.getAttribute("bridge-origin");
      const id = this.getAttribute("bridge-id");
      if (!rawOrigin || !id) return; // bridge off — the default
      // Exact-origin discipline: the attribute must BE an origin (scheme +
      // host + port), not a URL with a path/credentials, not "*", not "null".
      let origin: string;
      try {
        const parsed = new URL(rawOrigin);
        if (rawOrigin !== parsed.origin || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
          throw new Error("not an exact http(s) origin");
        }
        origin = parsed.origin;
      } catch {
        // Misconfiguration is a DEVELOPER error — one warning, bridge stays off.
        console.warn(
          `[splat-site] bridge-origin "${rawOrigin}" is not an exact http(s) origin (e.g. "https://host.example"); bridge disabled`,
        );
        return;
      }
      // The bridge is only meaningful when the page containing this element is
      // itself framed by the configured parent; at top level, DOM consumers
      // already have the methods.
      if (window.parent === window) return;
      this.bridgeOrigin = origin;
      this.bridgeId = id;
      const bridgeGeneration = ++this.bridgeGeneration;
      this.bridgeListener = (event: MessageEvent) => {
        if (bridgeGeneration !== this.bridgeGeneration) return;
        this.onBridgeMessage(event);
      };
      window.addEventListener("message", this.bridgeListener);
    }

    private teardownBridge(): void {
      this.bridgeGeneration++;
      if (this.bridgeListener) {
        window.removeEventListener("message", this.bridgeListener);
        this.bridgeListener = null;
      }
      this.bridgeOrigin = null;
      this.bridgeId = null;
    }

    /** Outbound: exact configured origin, never "*" — and only when opted in. */
    private bridgeSend(payload: SplatSiteBridgeMessage): void {
      if (!this.bridgeOrigin || !this.bridgeId || window.parent === window) return;
      window.parent.postMessage(payload, this.bridgeOrigin);
    }

    private onBridgeMessage(event: MessageEvent): void {
      // THE GAUNTLET — every check must pass or the message is silently dropped.
      if (!this.bridgeOrigin || !this.bridgeId) return;
      if (window.parent === window) return;
      if (event.source !== window.parent) return;
      if (event.origin !== this.bridgeOrigin) return;
      const data = event.data as Record<string, unknown> | null;
      if (typeof data !== "object" || data === null || Array.isArray(data)) return;
      if (data.channel !== "splat-site" || data.version !== 1) return;
      if (data.target !== this.bridgeId) return;
      // requestId: required bounded non-empty string — echoing anything else
      // (an object, a port) could make the reply itself uncloneable.
      const requestId = data.requestId;
      if (typeof requestId !== "string" || requestId.length === 0 || requestId.length > 256) return;
      const command = data.command;

      // Passed the gauntlet: an AUTHORIZED sender now gets honest replies.
      // Captured, narrowed source: the parent's WindowProxy survives parent
      // navigation, and the exact targetOrigin is enforced at delivery — a
      // queued reply can never leak to a different origin in that window.
      const replyTo = event.source as Window;
      const reply = (message: SplatSiteBridgeMessage): void => {
        replyTo.postMessage(message, this.bridgeOrigin!);
      };
      const base = { channel: "splat-site" as const, version: 1 as const, source: this.bridgeId };

      // Args are read once, through the same shape guard every command shares.
      const rawArgs = data.args;
      const args = typeof rawArgs === "object" && rawArgs !== null && !Array.isArray(rawArgs)
        ? (rawArgs as Record<string, unknown>)
        : undefined;

      try {
        if (command === "goToStop") {
          // Same public method = same InvalidStateError/RangeError contract.
          this.goToStop(args?.index as number);
          reply({ ...base, kind: "commandresult", requestId, ok: true });
        } else if (command === "goToStopById" || command === "goToObject") {
          const id = args?.id;
          // Validate the ARGUMENT here so a non-string can never reach a method
          // whose contract is stated in terms of ids.
          if (typeof id !== "string" || id.length === 0) {
            throw new RangeError(`<splat-site>.${command}: args.id must be a non-empty string`);
          }
          if (command === "goToStopById") this.goToStopById(id);
          else this.goToObject(id);
          reply({ ...base, kind: "commandresult", requestId, ok: true });
        } else if (command === "clearSelection") {
          this.clearSelection();
          reply({ ...base, kind: "commandresult", requestId, ok: true });
        } else if (command === "getState") {
          const result: SplatSiteBridgeState = {
            readyState: this.state,
            loadId: this.currentLoadId,
            src: this.currentSrc,
            name: this.readyName,
            stopCount: this.readyStopCount,
            currentStop: this.lastStop,
            engaged: this.engaged,
            engagedMode: this.engagedMode,
          };
          reply({ ...base, kind: "commandresult", requestId, ok: true, result });
        } else {
          throw new DOMException(`unknown command "${String(command)}"`, "NotSupportedError");
        }
      } catch (error) {
        const err = error instanceof Error
          ? { name: error.name, message: error.message }
          : { name: "Error", message: String(error) };
        reply({ ...base, kind: "commanderror", requestId, error: err });
      }
    }

    private async boot(): Promise<void> {
      const src = this.getAttribute("src");
      if (!src) {
        // src was removed/emptied: the old runtime must not linger publicly
        // "ready" behind a src that no longer exists. Invalidate, dispose, and
        // go back to awaiting a source (whenReady stays pending until one comes).
        this.generation++;
        this.runtime?.dispose();
        this.runtime = null;
        if (!this.readySettled) {
          this.ready.reject(new DOMException("src removed", "AbortError"));
        }
        this.ready = deferred();
        this.readySettled = false;
        this.state = "loading";
        return;
      }
      const generation = ++this.generation;
      // A reboot keeps the OLD runtime's pixels until the new config lands, but
      // they must be INERT: readyState says "loading", so interactions there
      // would toggle panels and fire nothing (their events are generation-
      // dropped). Blur first so engaged-mode keys disarm too. Interactivity
      // returns only when a NEW runtime boots; after a failed reboot the stale
      // content stays inert under readyState "error" (set src to recover).
      if (this.runtime) {
        (this.shadowRoot?.activeElement as HTMLElement | null)?.blur?.();
        this.viewport.style.pointerEvents = "none";
      }
      // Supersede any readiness still pending from a previous load, then open a
      // fresh per-load deferred so `whenReady` always tracks the CURRENT load.
      if (!this.readySettled) {
        this.readySettled = true;
        this.ready.reject(new DOMException("Superseded by a newer load", "AbortError"));
      }
      this.ready = deferred();
      this.readySettled = false;
      this.state = "loading";
      this.currentLoadId += 1;
      this.currentSrc = src;
      const loadId = this.currentLoadId;
      this.emit("loadstart", { loadId, src });

      let rawSite: unknown;
      let assetBaseUrl: string;
      try {
        const response = await fetch(src);
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        // response.url is the FINAL url (after any redirect). The site's own
        // relative asset URLs must resolve against it, never the host page.
        assetBaseUrl = response.url || new URL(src, document.baseURI).href;
        rawSite = await response.json();
      } catch (error) {
        // Only surface a still-relevant failure (not one a newer boot superseded).
        if (generation === this.generation) {
          this.currentSrc = src;
          this.failReady(error);
          console.error(`[splat-site] failed to load "${src}"`, error);
        }
        return;
      }
      // A newer boot started, or we disconnected, while the fetch was in flight.
      if (generation !== this.generation || !this.isConnected) return;
      this.mountRuntime(rawSite, assetBaseUrl, loadId, generation, src);
    }

    /**
     * Replace the previous runtime with one built from an already-fetched raw
     * config. Shared by the src-fetch boot and the author "Load JSON" path.
     * NOTE: a SYNCHRONOUS createSiteRuntime failure still leaves no runtime; the
     * fetch (or the caller's own validation) is what protects against garbage.
     */
    private mountRuntime(
      rawSite: unknown,
      assetBaseUrl: string,
      loadId: number,
      generation: number,
      sourceLabel: string,
    ): void {
      this.currentSrc = assetBaseUrl;
      this.runtime?.dispose();
      this.runtime = null;
      this.viewport.style.pointerEvents = "";
      // Author "Load JSON" reboots must keep authoring on; the src-fetch boot
      // reads the author attribute. loadFromJson only runs while author is on.
      const authoring = this.hasAttribute("author");
      try {
        this.runtime = createSiteRuntime({
          container: this.viewport,
          rawSite,
          assetBaseUrl,
          author: authoring,
          fontBaseUrl: this.getAttribute("font-base") ?? undefined,
          keyboardActivation: "engaged",
          // Seeded as part of THIS mount rather than applied afterwards: what the
          // runtime is given here is what pre-flight checks `custom` effects
          // against, so a handler the host registered before boot gets the
          // load-time warning it exists for.
          handlers: Object.fromEntries(this.ruleHandlers),
          loadSite: authoring ? (json) => this.loadFromJson(json) : undefined,
          onReady: (detail) => {
            if (generation !== this.generation) return;
            this.settleReady({ loadId, src: assetBaseUrl, ...detail });
          },
          onLoadError: (error) => {
            if (generation !== this.generation) return;
            this.failReady(error);
          },
          onLoadProgress: (progress) => {
            if (generation !== this.generation) return;
            this.emit("loadprogress", { progress });
          },
          onStopChanged: (detail) => {
            if (generation !== this.generation) return;
            this.emit("stopchanged", detail);
          },
          onHotspotClick: (detail) => {
            if (generation !== this.generation) return;
            this.emit("hotspotclick", detail);
          },
          onSelectionChanged: (detail) => {
            if (generation !== this.generation) return;
            this.emit("selectionchanged", detail);
          },
          onEngagementChanged: (detail) => {
            if (generation !== this.generation) return;
            // Frozen: the detail is dispatched to DOM listeners BEFORE the bridge
            // relay reads it, so an unfrozen object lets a listener desync what
            // the parent window receives from what the page saw.
            this.emit("engagementchange", Object.freeze({
              engaged: detail.state !== "disengaged",
              mode: detail.state === "disengaged" ? null : detail.state,
            }));
          },
          onMemoryChanged: (detail) => {
            if (generation !== this.generation) return;
            // Already frozen by the runtime — the same detail reaches DOM
            // listeners and the bridge relay, so neither can desync the other.
            this.emit("memorychanged", detail);
          },
          onLinkActivate: (detail) => {
            if (generation !== this.generation) return false;
            return this.activateLink(detail);
          },
        });
        // Apply the host's duplicate-prose list as part of THIS mount, before the
        // first text render, so no frame shows the wrong accessibility state.
        if (this.duplicatedIds.length > 0) {
          this.runtime.setDuplicatedBlockIds(new Set(this.duplicatedIds));
        }
      } catch (error) {
        // A synchronous boot failure (invalid config, WebGL unavailable) must be
        // reported, not left to reject this fire-and-forget promise unobserved.
        this.runtime = null;
        this.failReady(error);
        console.error(`[splat-site] failed to start "${sourceLabel}"`, error);
      }
    }

    /**
     * Author "Load JSON": reboot the scene from a pasted config string WITHOUT a
     * fetch. Parse + normalize FIRST — a bad paste rejects and leaves the running
     * scene untouched; only a valid config replaces it. Relative asset URLs
     * resolve against the CURRENT site's base (carried in currentSrc), not a
     * blob or the host document. No `src` attribute change → no dead-blob reboot.
     */
    private async loadFromJson(json: string): Promise<void> {
      let rawSite: unknown;
      try {
        rawSite = JSON.parse(json);
      } catch {
        throw new Error("Invalid JSON — could not parse the pasted config.");
      }
      const assetBaseUrl = this.currentSrc || new URL(".", document.baseURI).href;
      // Pre-flight the THROWING config steps on a throwaway clone BEFORE anything
      // is disposed: a config normalize accepts but resolveSiteAssets rejects
      // (e.g. a non-array settings.fonts) must reject HERE — surfacing inline and
      // leaving the running scene alive — not throw post-dispose inside a
      // swallowed createSiteRuntime, killing the scene with no error.
      resolveSiteAssets(normalizeSiteConfig(structuredClone(rawSite)), assetBaseUrl);
      // Held so a later author/font-base change re-mounts from this, not src.
      this.loadedRaw = { rawSite, assetBaseUrl };
      this.mountFresh(rawSite, assetBaseUrl, "loaded JSON");
    }

    /** Bump the load generation, open a fresh readiness deferred, and mount a
     *  runtime from an already-validated raw config. Shared by loadFromJson and
     *  the author/font-base re-mount of a loaded config. */
    private mountFresh(rawSite: unknown, assetBaseUrl: string, sourceLabel: string): void {
      const generation = ++this.generation;
      if (!this.readySettled) {
        this.readySettled = true;
        this.ready.reject(new DOMException("Superseded by a newer load", "AbortError"));
      }
      this.ready = deferred();
      this.readySettled = false;
      this.state = "loading";
      this.currentLoadId += 1;
      const loadId = this.currentLoadId;
      this.emit("loadstart", { loadId, src: assetBaseUrl });
      // A loadstart listener can remove the element or change src, invalidating
      // this generation — mounting anyway would leak a runtime after teardown.
      if (generation !== this.generation || !this.isConnected) return;
      this.mountRuntime(rawSite, assetBaseUrl, loadId, generation, sourceLabel);
    }

    private teardown(state: SplatSiteReadyState): void {
      // Invalidate any in-flight fetch and runtime callbacks first, then dispose.
      this.generation++;
      this.runtime?.dispose();
      this.runtime = null;
      this.state = state;
      if (!this.readySettled) {
        this.readySettled = true;
        this.ready.reject(new DOMException("<splat-site> disconnected", "AbortError"));
      }
    }
  }

  customElements.define("splat-site", SplatSiteElementImpl);
}
