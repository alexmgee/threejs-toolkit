/**
 * SiteRuntime — the instance-owned boot of the data-driven site pipeline
 *
 * This is the single wiring of a SiteConfig — scenes, rail stops, text
 * blocks/styles, obstacle volumes, annotations, props, grade, locative
 * headline — that both the `portfolio-lab` example (a thin shim) and the
 * `<splat-site>` Web Component (SplatSiteElement) call into. Everything is
 * parameterized (container, config, author flag, asset base) and owned by a
 * returned handle with a complete `dispose()`, so it runs correctly inside a
 * Shadow DOM and tears down without leaks.
 *
 * It is deliberately NOT in src/core — it's an integrated application preset
 * (portfolio chrome, locative themes, author tooling), not a composable
 * primitive. Only `defineSplatSite()` is barrel-exported; this stays internal.
 *
 * Author mode opens the SiteAuthorPanel for editing the site live.
 *
 * RE-TYPED for threejs-toolkit (Phase 2 ticket 09; every edit is an owner
 * ruling recorded in the ticket's Comments; doc 06 D24-D29): scenes load and
 * are disposed through the SplatBackend seam on ThreeSplatScene instead of
 * Spark; the pin's reveal gate is replaced by the loader's reveal/progress
 * callbacks; features this backend does not have yet are skipped and
 * announced once, in author mode, each with a named owner.
 */

import * as THREE from "three";
// Ticket 09 Stop 15 (doc 06 D29): three's WebGPU line classes. The classic
// LineMaterial is a ShaderMaterial the node library has no mapping for, so on
// BOTH backends it logs `Material "LineMaterial" is not compatible.` and gets a
// plain node material instead (measured). LineSegmentsGeometry is shared.
import { LineSegments2 } from "three/examples/jsm/lines/webgpu/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { Line2NodeMaterial } from "three/webgpu";
import { ThreeSplatScene } from "../core/ThreeSplatScene";
import { loadSplat } from "../core/SplatLoader";
import { ThreeGsBackend } from "../backend/ThreeGsBackend";
import { formatFromName, type SplatHandle } from "../backend/SplatBackend";
import { createDecodeWorker } from "../backend/decode-url";
import { CameraSystem, NEAR_PICK_FUZZ, type CameraState, type OrbitLimits } from "../core/CameraSystem";
import { CameraRail, type RailStop } from "../core/CameraRail";
import { ScrollRail } from "../core/ScrollRail";
import { LoadingUI } from "../core/LoadingUI";
import { Annotations } from "../ui/Annotations";
import {
  CHROME_GAP,
  inflate,
  publishReservedRegion,
  reservedRegions,
  type Rect as ReservedRect,
} from "../ui/ReservedRegions";
import { resolveRule, matchesWhen, NO_MATCH, type WhenContext } from "../rules/RuleResolver";
import type { CameraSequenceEffect, RuleEffect, RuleEngagementState, SceneMode } from "../rules/RuleModel";
import { applyModeEffect, entryMode, initialOffered, offeredModes, type ModeState } from "../rules/ModeLocks";
import {
  DEFAULT_FRAME_RADIUS,
  MIN_FRAME_RADIUS,
  resolveSequence,
  type FlightPlan,
} from "../rules/CameraChannel";
import { SceneMemory, visitedFlag } from "../rules/SceneMemory";
import {
  dismissAll,
  EMPTY_DISPLAY_CHANNEL,
  endOnTravel,
  endOrphanedClaims,
  endStaleWhile,
  showBlocks,
  shownBlockIds,
  type DisplayChannelState,
} from "../rules/DisplayChannel";
import {
  EMPTY_AUDIO_CHANNEL,
  playAudio,
  stopAudio,
  type AudioChannelState,
} from "../rules/AudioChannel";
import { HandlerRegistry, type CustomHandler } from "../rules/HandlerRegistry";
import { AudioPlayer } from "../render/AudioPlayer";
import { wireLoadTelemetry, type SiteTelemetryOptions } from "./diagWiring";
import { SplatHighlight } from "../interact/SplatHighlight";
import { PropLayer } from "../render/PropLayer";
import { MediaLayer, isMediaBindingPresent } from "../render/MediaLayer";
import { SceneGrade } from "../render/SceneGrade";
import {
  projectCornersToScreen,
  type ScreenRect,
} from "../ui/ObstacleLayout";
import { FontRegistry } from "../text/FontRegistry";
import { TextSystem } from "../text/TextSystem";
import type {
  ColumnsPlacement,
  TextBlock,
  WorldPlacement,
} from "../text/TextModel";
import type { EditorialRegionEditor as EditorialRegionEditorInstance } from "../ui/EditorialRegionEditor";
import {
  DEFAULT_FONT_STACK,
  measureTextHeight,
  whenFontsReady,
} from "../ui/TextLayout";
import {
  resolveTypography,
  typographyCssVars,
} from "../ui/Typography";
import { GeoContext, type PlaceInfo } from "../locative/GeoContext";
import { bearingDistance } from "../locative/GeoAnchor";
import { computeSplatBounds } from "../core/SplatBounds";
import {
  conjuredCopyBlock,
  normalizeSiteConfig,
  type ScreenRectNorm,
  type SiteAnnotation,
  type SiteConfig,
  type SiteStop,
} from "../site/SiteConfig";
import type {
  FrameTarget,
  PlacementMode,
  PlacementTool,
  SiteAuthorPanelConfig,
  SiteChangeKind,
} from "../site/authorPanelTypes";
import type {
  LiftedDetection,
  SeedWorldTransform,
} from "../site/HotspotSeeder";
import type {
  AuthorGizmo as AuthorGizmoInstance,
  AuthorGizmoTarget,
} from "../site/AuthorGizmo";
import type { AuthorPanel as AuthorPanelInstance } from "../site/AuthorPanel";

/** A splat scene loaded from `site.scenes`. Re-typed (doc 06 D28): the pin's
 *  member names are kept for source compatibility (D12). `mesh` is the object
 *  the backend hands over (a group holding the splat mesh), `handle` is the
 *  seam handle that owns it, and `paged` is decided by the file format. */
export interface LoadedScene {
  id: string;
  mesh: THREE.Object3D;
  handle: SplatHandle;
  paged: boolean;
  visible: boolean;
}

export interface SiteRuntimeOptions {
  /** Element the canvas + overlays mount into. Must already be attached to its
   *  document/shadow root, so root-aware style installs resolve correctly. */
  container: HTMLElement;
  /** Raw (un-normalized) site config. Must be JSON-cloneable: it is deep-cloned
   *  (structuredClone) before normalize — which mutates — so the caller's object
   *  and repeated boots stay independent. Functions/symbols/proxies will throw
   *  DataCloneError; pass plain data. */
  rawSite: unknown;
  /** Enable the author panel + on-canvas authoring tools. */
  author?: boolean;
  /** URL params for author seeding (`seed`/`seedTransform`). Embeds default to
   *  empty; the portfolio shim passes `window.location.search`. */
  urlParams?: URLSearchParams;
  /** URL the site config itself came from. Site-authored asset URLs (scenes,
   *  props, LUT, fonts) resolve against THIS, not the host document — without it
   *  a relative `"url": "./hero.rad"` in a CDN-hosted site.json would be fetched
   *  from the embedding page's directory. */
  assetBaseUrl?: string;
  /** FontRegistry base URL for the toolkit's bundled families (default: the
   *  portfolio asset path). External hosts must point this at their own copy. */
  fontBaseUrl?: string;
  /** Keyboard-fly arming (see KeyboardFlyConfig.activation): "always" for
   *  full-page sites (default — the historical behavior), "engaged" for embeds
   *  (keys live only while the canvas has focus; click/tap/Tab engages). */
  keyboardActivation?: "always" | "engaged";
  /** Author-mode "Load JSON" — the host reboots the whole scene from a pasted
   *  config string (raw-config reboot, carrying the current asset base). Absent
   *  → the panel shows no Load affordance. Rejects on invalid JSON WITHOUT
   *  disrupting the running scene. */
  loadSite?: (json: string) => void | Promise<void>;
  /** Load-telemetry configuration (spec §3.1). VISITOR sites default OFF (the
   *  probe is a measurement tool with no visitor value and its per-frame
   *  observation taxes the load); author mode defaults ON. Opt a visitor site in
   *  with `telemetry: true` here or under `settings.telemetry`. This TypeScript
   *  surface wins field-by-field over the Site JSON on conflict. */
  telemetry?: Readonly<SiteTelemetryOptions>;
  /** Rule handlers a `custom` effect may name — ADR-0001's single escape hatch,
   *  so bespoke behavior lives as typed code in the consuming site while
   *  site.json stays data (story 38). Seeds the registry at mount; more can be
   *  added later through `registerRuleHandler` on the handle (or on
   *  `<splat-site>`, which re-seeds this on every re-mount).
   *
   *  What is registered HERE is also what pre-flight checks `custom` effects
   *  against: a name nobody registered warns at load and throws at dispatch. */
  handlers?: Readonly<Record<string, CustomHandler<SiteRuntimeHandle>>>;

  // ─── Observers (P2) ──────────────────────────────────────
  // Ready / stop / hotspot all happen inside this closure's wiring; an embedding
  // element cannot observe them from outside without scraping DOM or patching
  // controllers, so the runtime hands them out through these narrow hooks.

  /** The scenes have actually streamed in and the loading overlay hid — what a
   *  host means by "ready". NOT merely "boot returned". Fires at most once. */
  onReady?: (detail: SiteReadyDetail) => void;
  /** A scene failed to load. Fires at most once per runtime; when the failure
   *  precedes readiness, `whenReady` rejects with the same error, so a dead
   *  splat URL can't hang readiness forever. (A paged scene can flip visible
   *  before its load promise rejects — then this fires AFTER onReady.) */
  onLoadError?: (error: unknown) => void;
  /** Load progress 0..1 for a host loading indicator, reported (throttled) until
   *  the scenes reveal, ending at exactly 1. Monotonic — never goes backwards. */
  onLoadProgress?: (progress: number) => void;
  /** The DOCKED/active stop changed (rail arrival), deduplicated by the stop's
   *  stable id (not index — author edits re-index stops, and a different stop
   *  landing on the same index must still announce).
   *  NOTE: rail arrival also fires when a pointer cancels the orientation
   *  settle — this means "this stop became active", NOT "the camera reached
   *  its authored orientation exactly". */
  onStopChanged?: (detail: SiteStopDetail) => void;
  /** An annotation marker was clicked. */
  onHotspotClick?: (detail: SiteHotspotDetail) => void;
  /** Fires whenever the active annotation changes, INCLUDING deselection
   *  (`{ id: null }`). `onHotspotClick` cannot express this — it fires on the
   *  toggle-off click too, carrying the id that was just DISMISSED. */
  onSelectionChanged?: (detail: SiteSelectionDetail) => void;
  /** Notify the host that a link inside site text was activated. The runtime
   *  never navigates and never touches `location`; the element turns this into
   *  the cancelable `linkactivate` event and the connected router performs the
   *  navigation. Returns true if something handled it. Consumed by Task 4's
   *  run-aware link rendering; declared here so the seam is frozen. */
  onLinkActivate?: (detail: SiteLinkActivateDetail) => boolean;
  /** Input ownership changed (Plan 25 §12). Announced LAST, after every switch
   *  has landed, so a listener observing the runtime sees a settled state. */
  onEngagementChanged?: (detail: { state: EngagementState }) => void;
  /** Scene memory changed (D31) — a marker was activated, or a rule set a flag.
   *  Every write comes through one funnel, so a host listening here sees every
   *  change; nothing mutates the store behind its back. Announced after the
   *  runtime has settled (markers rebuilt), same contract as
   *  `onEngagementChanged`. */
  onMemoryChanged?: (detail: SiteMemoryDetail) => void;
}

/** Stops carry a normalize-assigned stable `id`; labels are author-mutable, so
 *  consumers should key off `id` and only display `label`. Details are frozen
 *  at creation — the same object reaches multiple consumers. */
export interface SiteStopDetail {
  readonly index: number;
  readonly id: string;
  readonly label: string;
}

export interface SiteHotspotDetail {
  readonly id: string;
}

/** The active object (annotation) changed — including to nothing. */
export interface SiteSelectionDetail {
  readonly id: string | null;
}

/** Scene memory changed (D31). Carries the WHOLE store rather than the increment
 *  — a host that wants the delta can diff against what it last saw, while one
 *  that only wants the current state (the common case) needs no bookkeeping.
 *  Sorted for a stable read, and frozen: the same object reaches multiple
 *  consumers, including DOM listeners that run before the bridge relay. */
export interface SiteMemoryDetail {
  /** Every flag set this visit: authored flag names plus `visited:<id>` records
   *  for markers the visitor has activated. Empty until the first activation. */
  readonly flags: readonly string[];
}

/** A link inside site text was activated. `runIndex` is null for a block-level
 *  href (and for world blocks, which resolve clicks at block granularity). */
export interface SiteLinkActivateDetail {
  readonly href: string;
  readonly blockId: string;
  readonly runIndex: number | null;
  readonly kind: "fragment" | "external";
}

export interface SiteReadyDetail {
  readonly name: string;
  /** The stop the tour opens on, if the site has any. */
  readonly initialStop: SiteStopDetail | null;
  /** Number of stops — a host driving navigation needs the valid index range
   *  (`goToStop` rejects out-of-range rather than clamping). */
  readonly stopCount: number;
}

export interface SiteRuntimeHandle {
  readonly site: SiteConfig;
  /** Typed ThreeSplatScene; the name is kept for source compatibility (doc 06 D28). */
  readonly sparkScene: ThreeSplatScene;
  readonly cameraSystem: CameraSystem;
  readonly cameraRail: CameraRail;
  readonly loadedScenes: readonly LoadedScene[];
  readonly annotations: Annotations;
  readonly propLayer: PropLayer;
  readonly mediaLayer: MediaLayer;
  readonly sceneGrade: SceneGrade;
  readonly splatHighlight: SplatHighlight;
  readonly textSystem: TextSystem;
  readonly fontRegistry: FontRegistry;
  readonly geo: GeoContext;
  readonly scrollRail: ScrollRail | null;
  readonly authorGizmo: AuthorGizmoInstance | null;
  readonly authorPanel: AuthorPanelInstance | null;
  /** Resolves once author UI has mounted (or immediately when author=false). */
  readonly authorReady: Promise<void>;
  /** Resolves when the scenes have streamed in (the `onReady` moment) — for
   *  consumers that attach late and would otherwise miss the callback. Rejects
   *  with the load error, or an AbortError if disposed before ready. It is
   *  internally observed, so ignoring it never yields an unhandled rejection. */
  readonly whenReady: Promise<SiteReadyDetail>;
  goToStop(index: number): void;
  /** Resolve a stop id to its index, or -1 when unknown. */
  stopIndexById(id: string): number;
  /** The inverse of `stopIndexById` — index → the stop's stable id and label,
   *  or null when out of range. The router needs this direction for its
   *  invalid-target fallback, its no-op arrival announcement, and its timeout
   *  reconciliation, none of which can name a stop from an index otherwise. */
  stopByIndex(index: number): SiteStopDetail | null;
  /** Register (or replace) a rule handler a `custom` effect may name — the
   *  ADR-0001 escape hatch, after mount. Registering here does NOT retroactively
   *  silence the load-time warning for an unregistered name; only the `handlers`
   *  mount option is checked at load. */
  registerRuleHandler(name: string, fn: CustomHandler<SiteRuntimeHandle>): void;
  unregisterRuleHandler(name: string): void;
  /** Select an object (annotation) by id. Does NOT move the camera in P1 —
   *  travel on selection is P4 (gate G5). Unknown ids are ignored. */
  goToObject(id: string): void;
  /** Clear the current selection. */
  clearSelection(): void;
  /** The active object (annotation) id, or null. */
  readonly selectedObject: string | null;
  /** Authoritative rail motion phase. "idle" is the ONLY value for which
   *  `cameraRail.currentStop` describes where the camera actually is —
   *  during travel it is still the SOURCE stop (CameraRail.ts:137-139, :375). */
  readonly motionState: "idle" | "traveling" | "settling";
  /** Halt in-flight rail motion so the reported stop becomes real. No-op when
   *  already idle. Used by the router's timeout reconciliation. */
  cancelMotion(): void;
  /** Ids whose lane DOM duplicates prose already present in the host HTML —
   *  rendered `aria-hidden` with non-focusable links (spec §8: one copy, not
   *  two). The HOST is the sole authority; this is never inferred. */
  setDuplicatedBlockIds(ids: ReadonlySet<string>): void;
  rebuildAnnotations(): void;
  rebuildObstacleHelpers(): void;
  rebuildObstacleBoxes(): void;
  pickPoint(): Promise<[number, number, number] | null>;
  /** Who currently owns input (Plan 25 §12). Starts "disengaged". */
  readonly engagement: EngagementState;
  setEngagement(next: EngagementState): void;
  /** Element to focus when the scene disengages (the host's engage toggle). */
  setEngageFocusTarget(el: HTMLElement | null): void;
  /** Called instead of selection when the scene is clicked while disengaged. */
  setDisengagedClickHook(fn: (() => void) | null): void;
  /** Move focus to the runtime's engage toggle. Never changes engagement. */
  focusEngageToggle(): void;
  /** Play the attention pulse on the engage toggle. Never changes engagement. */
  pulseEngageToggle(): void;
  /** Tear down the render loop, GL, listeners, observers, and DOM chrome. */
  dispose(): void;
}

/** Resolve every site-authored asset URL against the site config's OWN url rather
 *  than the host document. Without this a `"url": "./hero.rad"` inside a site.json
 *  fetched from a CDN is requested from the EMBEDDING page's directory and 404s —
 *  the core portability bug for `<splat-site src="https://cdn.example/site.json">`.
 *  Already-absolute URLs pass through untouched (new URL ignores the base). */
export function resolveSiteAssets(site: SiteConfig, base: string | undefined): void {
  if (!base) return;
  const abs = (url: string): string => {
    try {
      return new URL(url, base).href;
    } catch {
      return url; // never let a malformed/data: URL throw the whole boot
    }
  };
  for (const scene of site.scenes) {
    if (scene.url) scene.url = abs(scene.url);
    for (const prop of scene.props ?? []) {
      if (prop.url) prop.url = abs(prop.url);
    }
  }
  const grade = site.settings?.grade;
  if (grade?.lutUrl) grade.lutUrl = abs(grade.lutUrl);
  // Site-authored faces carry their own URLs, which FontRegistry uses verbatim
  // (only its STABLE families get the fontBaseUrl prefix), so this is safe.
  for (const face of site.settings?.fonts ?? []) {
    if (face.url) face.url = abs(face.url);
    if (face.italicUrl) face.italicUrl = abs(face.italicUrl);
  }
  for (const item of site.media ?? []) {
    if (item.url) item.url = abs(item.url);
  }
  // Sounds are site-authored assets like any other: a relative "./narration.mp3"
  // in a CDN-hosted site.json must resolve against THAT config's directory, not
  // the embedding page's.
  for (const sound of site.audio ?? []) {
    if (sound.url) sound.url = abs(sound.url);
  }
}

// ─── explore policy (Plan 24 Task 3 / spec §5.5) ──────────

/** Derived orbit bounds for `explore: "bounded"`. FROZEN — authoring them would
 *  be a schema change and belongs to a later plan. Centred on the stop's authored
 *  pose, so "bounded" always means "look around FROM HERE". */
const BOUNDED_YAW_DEG = 35; // ± around stop.camera.yaw
const BOUNDED_PITCH_DEG = 20; // ± around stop.camera.pitch, clamped to [-85, 85]
const BOUNDED_DISTANCE_FACTOR = 0.5; // min = d*(1-f), max = d*(1+f)

/** Bounds in the SITE's units — degrees for yaw/pitch, world units for distance.
 *  Conversion to OrbitControls' radian azimuth happens at the application point,
 *  so the frozen numbers stay readable and directly assertable. */
export interface ExploreBounds {
  yawMin: number;
  yawMax: number;
  pitchMin: number;
  pitchMax: number;
  distMin: number;
  distMax: number;
}

export interface ExplorePolicy {
  /** Does INPUT drive the rail (programmatic navigation is never gated). */
  travel: boolean;
  /** May the visitor look around at all. */
  orbit: boolean;
  /** Hand the rail its own "explore" state — this is what routes touch to
   *  OrbitControls. Only `"free"` does this. */
  explore: boolean;
  /** Non-null only for `"bounded"`. */
  bounds: ExploreBounds | null;
}

export function normalizeExploreDeprecation(stops: SiteStop[]): SiteStop[] {
  let normalized = stops;
  for (let index = 0; index < stops.length; index++) {
    const stop = stops[index];
    if (stop.explore !== "free") continue;
    if (normalized === stops) normalized = [...stops];
    const { explore: _deprecatedExplore, ...rest } = stop;
    normalized[index] = rest;
  }
  return normalized;
}

/**
 * Map a stop's `explore` value to the two independent switches (spec §5.5).
 * PURE — no DOM, no controls, no side effects.
 *
 * `"free"` means explore OWNERSHIP, not merely "travel off". Arrival calls
 * `scrollRail.dock()` BEFORE `applyStop`, and `dock()` → `applyRotatePolicy()`
 * disables rotate on coarse pointers. If `free` only turned travel off and
 * suppressed touch claiming, a touch visitor would get NEITHER rail NOR orbit —
 * free-look would be dead on phones, the exact platform §5.5 cares about. So
 * `free` transitions the rail into its existing `"explore"` state, which already
 * declines to claim touch and re-enables rotate.
 */
// ─── Reduced-motion travel plan (Plan 24 Task 7 / spec §5.7) ───

/** What a stop navigation does. PURE.
 *
 *  ⚠ ELIMINATED 2026-08-03: this function no longer consults the OS
 *  reduced-motion preference AT ALL. History, so nobody reintroduces it
 *  half-way: the 2026-07-22 spec substituted a discrete CUT under reduced
 *  motion; on 2026-08-02 that became a 1.8×-slower flight; on 2026-08-03 the
 *  author ruled the whole mechanism out — the flag is set by OS performance
 *  profiles as often as by people who need it, so gating the tour's content on
 *  it punishes the wrong visitors, and a slowed remnant is exactly the kind of
 *  half-measure that breeds "why is it slow on my machine" bugs. Author's
 *  standing rule: an accessibility travel mode returns ONLY as an explicit
 *  visitor-facing opt-in control, or not at all. `cut` stays in the union
 *  because `cutToStop` remains public API and such an opt-in would use it;
 *  `planTravel` never returns it. */
export type TravelPlan =
  | { mode: "flight"; durationSec: number }
  | { mode: "cut" };

export const DEFAULT_TRAVEL_SEC = 2.2;

export function planTravel(authoredSec: number | undefined): TravelPlan {
  return { mode: "flight", durationSec: authoredSec ?? DEFAULT_TRAVEL_SEC };
}

// ─── Docked-idle render throttle (Plan 24 Task 7) — FROZEN, not authorable ───

export const IDLE_THROTTLE_DELAY_MS = 15000; // no qualifying input for this long
export const IDLE_THROTTLE_FPS = 10; // → 100 ms minimum inter-frame interval

/** The reset events, frozen as a list so the self-check can iterate it and a
 *  forgotten event fails loudly. "navigate" is any programmatic command. */
export const THROTTLE_RESET_EVENTS = [
  "pointerdown", "pointermove", "wheel", "keydown", "touchstart", "scroll",
  "visibilitychange", "navigate",
] as const;

export interface ThrottleInputs {
  docked: boolean;
  railIdle: boolean;
  allVisible: boolean;
  authorMode: boolean;
  idleMs: number;
}

/** PURE decision: is this frame throttled, and does a skipped frame still run
 *  state updates (always yes — accumulator decay + orbit damping must live). */
export function throttleDecision(inputs: ThrottleInputs): { throttled: boolean; runUpdates: boolean } {
  const throttled =
    inputs.docked &&
    inputs.railIdle &&
    inputs.allVisible &&
    !inputs.authorMode &&
    inputs.idleMs >= IDLE_THROTTLE_DELAY_MS;
  return { throttled, runUpdates: true };
}

export function explorePolicy(
  explore: SiteStop["explore"] | undefined,
  camera?: CameraState,
): ExplorePolicy {
  // ⚠ D34 (author ruling, 2026-08-03 dry run) — SUPERSEDES §5.5's "neither" row.
  // `locked` freezes the FRAMING (no orbit, no zoom, no recenter) but scrolling
  // always continues the tour. A travel-dead stop stranded the visitor: the
  // wheel fell through to the page, the page scrolled the scene out of view, and
  // the visibility rule then disengaged — reported as "the tour just ended by
  // itself". Holding the view is the intent; holding the visitor is not.
  if (explore === "locked") return { travel: true, orbit: false, explore: false, bounds: null };
  if (explore === "bounded") {
    const bounds = camera
      ? {
          yawMin: camera.yaw - BOUNDED_YAW_DEG,
          yawMax: camera.yaw + BOUNDED_YAW_DEG,
          pitchMin: Math.max(-85, camera.pitch - BOUNDED_PITCH_DEG),
          pitchMax: Math.min(85, camera.pitch + BOUNDED_PITCH_DEG),
          distMin: camera.distance * (1 - BOUNDED_DISTANCE_FACTOR),
          distMax: camera.distance * (1 + BOUNDED_DISTANCE_FACTOR),
        }
      : null;
    return { travel: true, orbit: true, explore: false, bounds };
  }
  // Absent — today's behavior, unchanged.
  return { travel: true, orbit: true, explore: false, bounds: null };
}

// ─── Engagement (Plan 25 Task 1 / spec §12) ───────────────

/** Who owns input. "disengaged" is the DEFAULT: the page owns wheel, touch and
 *  keys until the visitor deliberately engages the scene.
 *
 *  Aliased to the rules module's vocabulary (not re-spelled) so a rule's `state`
 *  condition and the runtime's actual states are one list — a condition can
 *  never name a state the scene cannot be in, and adding a state to one side
 *  cannot leave the other behind. */
export type EngagementState = RuleEngagementState;

/** The §12 matrix row for one engagement state. Every switch the runtime flips
 *  lives here so the decision is testable without a DOM. */
export interface EngagementSwitches {
  captureEnabled: boolean;
  travelEnabled: boolean;
  zoom: boolean;
  rotate: boolean;
  /** false = forced off; true = restore the runtime's ORIGINAL enablePan. */
  pan: boolean;
  recenter: boolean;
  navTabbable: boolean;
  pillAllowed: boolean;
  /** Whether the per-stop `explore` policy applies at all. */
  applyStopPolicy: boolean;
}

/** PURE — no DOM, no controls, no side effects. */
export function engagementSwitches(state: EngagementState): EngagementSwitches {
  if (state === "tour") {
    return {
      captureEnabled: true,
      travelEnabled: true,
      // ⚠ Zoom stays OFF in tour. OrbitControls preventDefaults the wheel only
      // while zoom is enabled, so leaving it on would swallow the end-of-rail
      // wheel release that must reach the page. Ctrl/⌘-wheel re-arms it for one
      // event (the pinch path) — see the capture listener in the runtime.
      zoom: false,
      rotate: true,
      pan: false,
      recenter: true,
      navTabbable: true,
      pillAllowed: true,
      applyStopPolicy: true,
    };
  }
  if (state === "explore") {
    return {
      // The rail claims NOTHING in explore — OrbitControls takes wheel and touch
      // directly, and per-stop bounded/locked do not constrain free exploration.
      captureEnabled: false,
      travelEnabled: false,
      zoom: true,
      rotate: true,
      pan: true,
      recenter: true,
      navTabbable: true,
      pillAllowed: false,
      applyStopPolicy: false,
    };
  }
  return {
    captureEnabled: false,
    travelEnabled: false,
    zoom: false,
    rotate: false,
    pan: false,
    recenter: false,
    navTabbable: false,
    pillAllowed: false,
    applyStopPolicy: false,
  };
}

/** Module-scoped so an author-mode reboot (or an element re-src) does not repeat
 *  the deprecation notice — it is about the CONFIG, not about this boot. */
let warnedFreeDeprecation = false;

export function createSiteRuntime(options: SiteRuntimeOptions): SiteRuntimeHandle {
const { container, author: authorMode = false } = options;
const urlParams = options.urlParams ?? new URLSearchParams();
/** Rule handlers the consuming site registered (ADR-0001's escape hatch).
 *  Seeded from the mount option; `registerRuleHandler` on the handle (and
 *  through it on `<splat-site>`) adds to it while the scene runs.
 *
 *  Built HERE, before anything else, because pre-flight reads it below: what
 *  this registry holds at load IS the definition of "registered", and deriving
 *  that from `options.handlers` a second time would let the check and the
 *  dispatcher drift apart on the day seeding stops being a plain copy. */
const ruleHandlers = new HandlerRegistry<SiteRuntimeHandle>(options.handlers ?? {});

// The handlers registered at THIS mount are what "registered at load" means
// (D31): pre-flight warns about a `custom` effect naming anything else. A
// handler registered later still works — it just missed the check that would
// have caught the typo before a visitor did.
const site: SiteConfig = normalizeSiteConfig(structuredClone(options.rawSite), {
  registeredHandlers: ruleHandlers.names,
});
const normalizedStops = normalizeExploreDeprecation(site.stops);
if (normalizedStops !== site.stops && !warnedFreeDeprecation) {
  warnedFreeDeprecation = true;
  console.warn(
    `[splat-site] explore:"free" is deprecated — the visitor's Explore toggle replaces it; treat as default.`,
  );
}
site.stops = normalizedStops;
resolveSiteAssets(site, options.assetBaseUrl);
// FontRegistry concatenates `${baseUrl}${file}` for its bundled families, so a
// base without a trailing slash silently yields "…fontsFraunces.woff2".
const fontBaseUrl = (() => {
  const base = options.fontBaseUrl ?? "/examples/assets/fonts/";
  return base.endsWith("/") ? base : `${base}/`;
})();
let typography = resolveTypography(site.settings?.typography);
const settings = site.settings ?? {};
const DEFAULT_FOV = settings.fov ?? 60;
const DEFAULT_DOF_APERTURE_ANGLE = 0;
let disposed = false;
let authorPanelRef: AuthorPanelInstance | null = null;

/** Features this backend does not have yet are announced ONCE per runtime,
 *  to authors only — a warning on every normal visitor load is a broken
 *  warning (ticket 08 S5's test). Each note names its owner (ticket 09
 *  rulings: Stop 1 A2 → ticket 12, Stop 2 → Phase 3, Stop 4e → Phase 5,
 *  Stop 8 → Phase 4). */
const authorNotesShown = new Set<string>();
function authorNote(key: string, message: string): void {
  if (!authorMode || authorNotesShown.has(key)) return;
  authorNotesShown.add(key);
  console.warn(`[SiteRuntime] ${message}`);
}

// ─── Panel-change coalescing (Plan 13 DD2) ────────────────
// Every scene effect for an authored edit funnels through handlePanelChange.
// Coalesce them: a burst of same-kind edits in one frame collapses to a single
// applyPanelChange. State lives at runtime scope so dispose() can cancel it and
// the obstacle gizmo's onCommit (defined outside the author closure) can enqueue.
// applyPanelChangeRef is wired once the author panel mounts; before that (or in
// viewer mode) the scheduler is inert.
let applyPanelChangeRef: ((kind: SiteChangeKind) => void) | null = null;
const pendingPanelKinds = new Set<SiteChangeKind>();
let panelFlushRaf = 0; // rAF ids are > 0, so 0 means "none scheduled"
let panelFlushTimer: ReturnType<typeof setTimeout> | null = null;
let panelVisibilityListenerAdded = false;

function cancelPanelFlush(): void {
  if (panelFlushRaf) {
    cancelAnimationFrame(panelFlushRaf);
    panelFlushRaf = 0;
  }
  if (panelFlushTimer !== null) {
    clearTimeout(panelFlushTimer);
    panelFlushTimer = null;
  }
}

function flushPanelChanges(): void {
  // Snapshot + clear + cancel the handle BEFORE invoking any effect: a callback
  // that re-enqueues a kind must survive this flush and schedule a fresh one.
  cancelPanelFlush();
  const batch = [...pendingPanelKinds];
  pendingPanelKinds.clear();
  if (disposed) return;
  const apply = applyPanelChangeRef;
  if (!apply) return;
  // Isolate each kind: one effect that throws must not drop the rest of the batch.
  for (const kind of batch) {
    try {
      apply(kind);
    } catch (error) {
      console.error(`[SiteRuntime] panel change effect "${kind}" failed`, error);
    }
  }
}

function schedulePanelFlush(): void {
  if (disposed || panelFlushRaf || panelFlushTimer !== null) return;
  // Register the visibility listener lazily, on first real use — added eagerly at
  // runtime creation it would leak if construction throws before a handle (hence
  // dispose) exists. By the first flush schedule, the runtime is live.
  if (!panelVisibilityListenerAdded) {
    document.addEventListener("visibilitychange", onPanelVisibilityChange);
    panelVisibilityListenerAdded = true;
  }
  // rAF is throttled/suspended in a backgrounded tab, so fall back to a timer
  // while hidden — otherwise a queued effect would strand until the tab returns.
  if (document.hidden) {
    panelFlushTimer = setTimeout(flushPanelChanges, 0);
  } else {
    panelFlushRaf = requestAnimationFrame(flushPanelChanges);
  }
}

function enqueuePanelChange(kind: SiteChangeKind): void {
  // Guard disposed FIRST: a late async callback (e.g. a font load resolving after
  // teardown) must not repopulate the drained set.
  if (disposed) return;
  pendingPanelKinds.add(kind);
  schedulePanelFlush();
}

// A pending rAF never fires once the tab hides, so flush queued effects on the
// hide transition — an edit made just before backgrounding must still apply.
const onPanelVisibilityChange = (): void => {
  if (document.hidden) flushPanelChanges();
};

// ─── Readiness (P2) ───────────────────────────────────────
// One settle-once deferred: resolved when the scenes stream in, rejected by a
// scene-load failure or by disposal-before-ready. Without the reject paths a
// dead splat URL would hang `whenReady` (and the overlay) forever.
let readySettled = false;
let resolveReady!: (detail: SiteReadyDetail) => void;
let rejectReady!: (error: unknown) => void;
const whenReady = new Promise<SiteReadyDetail>((resolve, reject) => {
  resolveReady = resolve;
  rejectReady = reject;
});
// Observe it here so a caller who never awaits whenReady sees no unhandled
// rejection; awaiting callers still receive the rejection themselves.
void whenReady.catch(() => {});

function stopDetail(index: number): SiteStopDetail | null {
  const stop = site.stops[index];
  if (!stop) return null;
  // Frozen: the same object reaches multiple consumers (promise + callback +
  // events) — one listener mutating a detail must not poison the others.
  return Object.freeze({ index, id: stop.id ?? `stop-${index}`, label: stop.label });
}

function settleReady(): void {
  if (readySettled) return;
  readySettled = true;
  const detail: SiteReadyDetail = Object.freeze({
    name: site.name ?? "untitled-site",
    initialStop: stopDetail(cameraRail.currentStop) ?? stopDetail(0),
    stopCount: site.stops.length,
  });
  // D21 ORDERING: the toggle becomes usable BEFORE readiness is announced. The
  // element emits "ready" synchronously inside onReady, and a listener that calls
  // focusEngagementToggle() from it would otherwise find a disabled button.
  engageToggle.disabled = false;
  engageTrack.classList.remove("splat-engage-loading");
  // Author mode engages itself. §12's "engagement is a visitor act" governs
  // VISITORS; an author is already committed to manipulating the scene, so
  // making them arm it first is friction with no upside. Tour vs Explore stays
  // the only open question. Fires BEFORE onReady so a ready listener already
  // observes the engaged state.
  if (authorMode && engagement === "disengaged") setEngagement("tour");
  resolveReady(detail);
  options.onReady?.(detail);
}

/** onLoadError fires at most once per runtime — a multi-scene site with several
 *  dead URLs must not report each rejection separately. */
let loadErrorFired = false;

function failReady(error: unknown): void {
  if (loadErrorFired) return;
  loadErrorFired = true;
  if (!readySettled) {
    readySettled = true;
    rejectReady(error);
  }
  options.onLoadError?.(error);
}

function roundRotationDeg(value: number): number {
  return Math.round(value * 10) / 10;
}

function setCleanRotationDeg(
  target: { rotationDeg?: [number, number, number] },
  rotationDeg: [number, number, number],
): void {
  if (rotationDeg.every((value) => Math.abs(value) <= 0.05)) {
    delete target.rotationDeg;
    return;
  }
  target.rotationDeg = rotationDeg.map(roundRotationDeg) as [number, number, number];
}

function setObjectRotationDeg(object: THREE.Object3D, rotationDeg?: [number, number, number]): void {
  const value = rotationDeg ?? [0, 0, 0];
  object.rotation.set(
    THREE.MathUtils.degToRad(value[0]),
    THREE.MathUtils.degToRad(value[1]),
    THREE.MathUtils.degToRad(value[2]),
    "XYZ",
  );
}

function uniformScaleFromVector(scale: [number, number, number], current: number): number {
  let next = scale[0];
  let bestDelta = Math.abs(scale[0] - current);
  for (let i = 1; i < 3; i++) {
    const delta = Math.abs(scale[i] - current);
    if (delta <= bestDelta) continue;
    bestDelta = delta;
    next = scale[i];
  }
  return Math.max(0.01, next);
}

// ─── Scene / camera / overlay ─────────────────────────────

for (const [key, value] of Object.entries(typographyCssVars(typography))) {
  container.style.setProperty(key, value);
}

const sparkScene = new ThreeSplatScene({
  container,
  fov: DEFAULT_FOV,
  cameraPosition: [0, 1, 7],
  background: new THREE.Color(settings.background ?? "#0c0c10").getHex(),
});
// The seam instance every scene loads and is disposed through (doc 06 D25).
// Its decode worker comes from the URL-constructed default, which the embed
// build swaps for the inline worker at config time (ticket 09 Stop 9, D14);
// it waits for the renderer's init itself (Stop 10).
const splatBackend = new ThreeGsBackend({ renderer: sparkScene.renderer, createDecodeWorker });

const fontRegistry = new FontRegistry({
  baseUrl: fontBaseUrl,
  fonts: site.settings?.fonts,
});
const textSystem = new TextSystem({
  site,
  host: container,
  scene: sparkScene.scene,
  camera: sparkScene.camera,
  registry: fontRegistry,
  onLinkActivate: options.onLinkActivate,
  getObstacleRects: () => {
    const rects: ScreenRect[] = [];
    for (const corners of obstacleBoxes) {
      const rect = projectCornersToScreen(corners, sparkScene.camera, containerW, containerH);
      if (rect) rects.push(rect);
    }
    // The engagement chrome is an obstacle to editorial columns for the same
    // reason it is to a panel: a stop's copy is migrated into a columns block by
    // the toolkit, so nobody chose to run that text under the switch. Columns
    // FLOW around an obstacle rather than being repositioned, so this adds a
    // hole — it never overrides an authored column region. Reserved regions are
    // already container-relative, which is the frame ScreenRect speaks.
    // Same CHROME_GAP the panel lane leaves, from the same home: without it,
    // column text abuts the switch exactly while a panel clears it by 12px.
    for (const region of reservedRegions(container)) {
      const padded = inflate(region, CHROME_GAP);
      rects.push({
        x: padded.left,
        y: padded.top,
        width: padded.right - padded.left,
        height: padded.bottom - padded.top,
      });
    }
    return rects;
  },
});

function applyRailOptics(optics: NonNullable<RailStop["optics"]> = {}): void {
  const nextFov = optics.fov ?? DEFAULT_FOV;
  if (sparkScene.camera.fov !== nextFov) {
    sparkScene.camera.fov = nextFov;
    sparkScene.camera.updateProjectionMatrix();
  }

  // Default DoF is effectively off: apertureAngle 0. This backend renders no
  // depth of field until Phase 5 (its setOptics refuses by name, and this runs
  // every travel frame), so the Spark optics writes are skipped and a stop that
  // asks for DoF is announced once, to authors (ticket 09 Stop 4e; doc 06 D29).
  const nextApertureAngle = optics.apertureAngle ?? DEFAULT_DOF_APERTURE_ANGLE;
  if (nextApertureAngle > DEFAULT_DOF_APERTURE_ANGLE) {
    authorNote(
      "optics",
      `rail depth of field (apertureAngle ${nextApertureAngle}) is not rendered — optics arrive in Phase 5; fov still applies`,
    );
  }
}

const cameraSystem = new CameraSystem({
  camera: sparkScene.camera,
  canvas: sparkScene.canvas,
  scene: sparkScene.scene,
  renderer: sparkScene.renderer,
  minDistance: 0.3,
  maxDistance: 200,
  enableRecenter: true,
  keyboardFly: { activation: options.keyboardActivation ?? "always" },
});

const propLayer = new PropLayer();
propLayer.attach(sparkScene);

const mediaLayer = new MediaLayer();
mediaLayer.attach(sparkScene);

const sceneGrade = new SceneGrade();
sceneGrade.attach(sparkScene);
sceneGrade.update(settings.grade!);
sceneGrade.setEnabled(settings.grade?.enabled ?? false);

// ─── Rail from site.stops ─────────────────────────────────

function toRailStops(stops: SiteStop[]): RailStop[] {
  return stops.map((s) => ({
    label: s.label,
    camera: s.camera,
    optics: s.optics,
    duration: s.duration,
    meta: { site: s },
  }));
}

/** Last stop ID reported through onStopChanged — arrival at the already-active
 *  stop (e.g. a cancelled settle re-docking) must not re-announce it. Keyed by
 *  the stable id, NOT the index: an author edit re-indexes stops, so a
 *  different stop can land on the same index (delete stop 1 while docked at
 *  index 2 → the former stop-3 re-docks AT index 2) and an index key would
 *  swallow that genuinely-changed stop. */
let reportedStopId: string | null = null;

/** Announce the docked stop if it genuinely changed (by stable id). Called from
 *  rail arrivals AND from structural stop edits that bypass the rail (the ≤1-stop
 *  author-edit path never fires onStopArrived, which would leave a host's
 *  stop/count state stale forever). */
function reportStop(index: number): void {
  const detail = stopDetail(index);
  if (detail && detail.id !== reportedStopId) {
    reportedStopId = detail.id;
    options.onStopChanged?.(detail);
  }
}

/** What the display channel is showing (D31). Written only by
 *  `applyDisplayChannel`, so the text system and this value cannot disagree.
 *  The channel records which ANNOTATION showed what (ticket 17), so selection
 *  and the channel are now independent: selecting a marker no longer takes any
 *  surface away from anything. */
let displayChannel: DisplayChannelState = EMPTY_DISPLAY_CHANNEL;

/** The copy floor's conjured boxes (ticket 13), keyed by annotation id. NEVER
 *  in `site.blocks` and never serialized — the box derives from the
 *  annotation's copy ("they are one thing, not two", A4); the text system is
 *  handed these beside the authored blocks. An entry exists from the marker's
 *  first floor activation on; whether it is VISIBLE is the display channel's
 *  claim, exactly like a seeded template block. */
const conjuredBlocks = new Map<string, TextBlock>();

/** Does the site really have this block? Pre-flight guarantees every referenced
 *  id exists; an id that somehow does not is dropped by the channel rather than
 *  throwing, because throwing here would kill the click and take the rest of
 *  the rule's effects with it. Conjured floor boxes count: the floor shows them
 *  through the same channel path every authored effect uses. */
function blockExists(id: string): boolean {
  if (site.blocks.some((block) => block.id === id)) return true;
  for (const block of conjuredBlocks.values()) if (block.id === id) return true;
  return false;
}

/**
 * The copy floor (ticket 13): a marker with copy and no matching rule floats
 * that copy in ONE world-anchored box at the marker. The SAME mechanism as any
 * display effect — a claim on the channel under the default lifetime
 * (`until: "re-activation"`) — so the toggle, travel survival, takeover and
 * Escape all behave identically for a bare marker and a rule-authored effect
 * with an omitted lifetime, by construction rather than by two codepaths
 * coinciding. A matched rule never reaches this.
 *
 * The box is re-derived on every show, so copy edited between shows floats
 * fresh; `refreshConjuredCopy` keeps an OPEN box honest under author edits.
 */
/** Re-derive one annotation's conjured box, REUSING the existing object when
 *  neither the words nor the anchor moved — `setConjuredBlocks` guards by
 *  object identity, so reuse is what makes an unchanged pass free. Returns the
 *  live box, or null (entry dropped) when the annotation is gone or wordless. */
function conjureFor(annotation: SiteAnnotation | undefined, annotationId: string): TextBlock | null {
  const next = annotation ? conjuredCopyBlock(annotation) : null;
  if (next === null) {
    conjuredBlocks.delete(annotationId);
    return null;
  }
  const existing = conjuredBlocks.get(annotationId);
  if (existing && existing.content === next.content
    && JSON.stringify(existing.placement) === JSON.stringify(next.placement)) {
    return existing;
  }
  conjuredBlocks.set(annotationId, next);
  return next;
}

function showConjuredCopy(annotationId: string): void {
  const annotation = site.annotations.find((candidate) => candidate.id === annotationId);
  if (!annotation) return;
  const block = conjureFor(annotation, annotationId);
  // No words to float: a floor with nothing to show shows nothing — and evicts
  // nothing, because takeover is a property of showing.
  if (block === null) return;
  textSystem.setConjuredBlocks([...conjuredBlocks.values()]);
  applyDisplayChannel(showBlocks(displayChannel, annotationId, [block.id], blockExists, {
    // The floor states nothing itself, so both knobs are the defaults: the
    // site's takeover habit, and the default lifetime.
    takeover: site.settings?.blocks?.takeover ?? true,
    context: whenContext(),
  }));
}

/** Re-derive every conjured box from its annotation's current copy and anchor —
 *  the author-edit path (copy typed in the inspector, a re-anchor pick). A box
 *  whose annotation lost its words or its existence is dropped; its claim, if
 *  any, then names a block nothing has, which the channel and text system both
 *  already treat as absent. Unchanged boxes keep their objects, so the setter's
 *  identity guard makes a no-change pass free. */
function refreshConjuredCopy(): void {
  for (const annotationId of [...conjuredBlocks.keys()]) {
    conjureFor(
      site.annotations.find((candidate) => candidate.id === annotationId),
      annotationId,
    );
  }
  textSystem.setConjuredBlocks([...conjuredBlocks.values()]);
}

/** Which annotation shows this block? The block→marker locator that
 *  `binding.annotations[0]` used to be, re-sourced from the rules now that
 *  binding-to-a-marker is retired (ticket 17).
 *
 *  First match, because the answer is used to pick somewhere to FLY — a block
 *  shown by two markers has two right answers and either will do, whereas
 *  returning nothing leaves the author panel's Frame button silently dead. */
function annotationShowing(blockId: string): string | undefined {
  for (const annotation of site.annotations) {
    for (const rule of annotation.rules ?? []) {
      for (const effect of rule.do) {
        if (effect.kind === "show-blocks" && effect.blocks.includes(blockId)) return annotation.id;
      }
    }
  }
  return undefined;
}

/** Hand a new channel state to the text system. Guarded by identity, which the
 *  channel makes meaningful: it returns the same state when nothing changed, so
 *  a repeat click cannot restart a fade. */
function applyDisplayChannel(next: DisplayChannelState): void {
  if (next === displayChannel) return;
  displayChannel = next;
  textSystem.setShownBlockIds(shownBlockIds(next));
}

/**
 * The SINGLE funnel for annotation activation. Every path that changes the
 * active annotation goes through here so no path can bypass the notifier — a
 * host observing selection must see deselection too, which `onHotspotClick`
 * cannot express (it fires on the toggle-off click carrying the DISMISSED id).
 *
 * The same-value guard mirrors `TextSystem.setActiveAnnotation`'s own, so a
 * repeated call announces nothing.
 *
 * ⚠ Note for the router: the departure clear inside `onTransition` announces
 * `{ id: null }` BEFORE any arrival. That is correct and required — and it is
 * exactly why routing uses navigation tokens rather than a latch: a selection
 * event is never a navigation terminal signal.
 */
function setSelection(id: string | null): void {
  if (textSystem.activeAnnotation === id) return;
  textSystem.setActiveAnnotation(id);
  // Selecting a marker used to CLEAR the screen half of the channel (Rule C).
  // Deleted outright in ticket 17 — no default, no setting. It evicted panels
  // an author had deliberately put in slots that never touch, and the case it
  // was written for (a marker's copy being a screen panel that shared one
  // surface with a display effect) is not the model any more: the channel is
  // keyed by owner, and `takeover` is the one thing that removes content.
  refreshMediaVisibility();
  options.onSelectionChanged?.({ id });
}

/** The stop the visitor is docked at, or null while travelling between stops.
 *  Written only by `setActiveStop` (arrival sets it, departure clears it) and
 *  read by every subsystem that varies with the docked stop: text, media, and —
 *  since D31 — rule and presence conditions. Named for the fact, not for one
 *  consumer, now that there are three. */
let activeStopId: string | null = null;

/** The visit's scene memory (D31) — the third context leg, and the only one the
 *  VISITOR writes. Owned by the runtime and never persisted, so it resets on
 *  reload by construction: a new runtime is a new store, and nothing reads or
 *  writes storage (v1 boundary; persistence is the spec's v2 ledger item 5).
 *
 *  `record` is the single write funnel, so this listener sees every change:
 *  markers rebuild first (a flag can decide presence), then the host hears —
 *  the `onEngagementChanged` contract, so a listener never observes a
 *  half-applied runtime. */
const sceneMemory = new SceneMemory({
  onChange: (flags) => {
    // Memory is a context leg, so every write re-evaluates stay-while claims
    // (ticket 13). Pull-based against the claims live right now — there is no
    // watcher to go stale, so a displaced or dismissed while-payoff cannot
    // resurrect from here.
    applyDisplayChannel(endStaleWhile(displayChannel, whenContext()));
    refreshAnnotationPresence();
    options.onMemoryChanged?.(Object.freeze({ flags: Object.freeze([...flags].sort()) }));
  },
});

/** What the audio channel is playing (D31). Single occupancy — the counterpart
 *  of `displayChannel`, and deliberately NOT subdivided: one sound at a time. */
let audioChannel: AudioChannelState = EMPTY_AUDIO_CHANNEL;

/** The one output device. A sound letting go — finished, or failed and never
 *  going to start — FREES the channel, which is what makes it claimable again:
 *  `playAudio` returns the same state by identity for a sound already playing,
 *  so without this a finished or broken sound could never be claimed twice. */
const audioPlayer = new AudioPlayer({
  onReleased: (audioId) => {
    if (audioChannel.playing !== audioId) return;
    audioChannel = stopAudio(audioChannel);
  },
});

/** This runtime's own handle, so a `custom` handler can drive the scene through
 *  the same public surface a host page uses. Assigned at the END of
 *  construction — the handle does not exist until everything it exposes does —
 *  and only ever read from a visitor action, which is necessarily later. */
let runtimeHandle: SiteRuntimeHandle | null = null;

let mediaProgress = 0;
let visibleMediaIds = new Set<string>();

function setActiveStop(id: string | null): void {
  // Arrival is a dock at a stop the visitor was not already at: an animated
  // travel departs first (departure nulls the stop per frame, docking writes
  // one), but a CUT — reduced motion, or any programmatic dock — goes straight
  // from stop to stop with no departure frame, and it is a travel all the
  // same. The `until: "travel"` ending fires HERE — "gone on arrival" (ticket
  // 13), the moment the old plain-copy panel used to close — so content rides
  // along during the flight and ends when the visitor lands. What does NOT
  // fire it: departure itself, and a same-stop re-dock with no departure (a
  // cancelled settle re-announcing the stop it never left). Boot's first dock
  // does pass through; the channel is empty then, so it ends nothing.
  const changed = id !== activeStopId;
  const arrived = id !== null && changed;
  activeStopId = id;
  textSystem.setActiveStop(id);
  refreshMediaVisibility();
  if (arrived) applyDisplayChannel(endOnTravel(displayChannel));
  // The docked stop is a context leg, so a CHANGE re-evaluates stay-while
  // claims (ticket 13): a `while: { stop: … }` payoff ends the moment the rail
  // departs, because travelling is not "at" any stop. Guarded on the change —
  // rail departure fires this per frame with an unchanged null, where the stop
  // leg cannot have moved (the other legs have their own funnels).
  if (changed) applyDisplayChannel(endStaleWhile(displayChannel, whenContext()));
  // A stop condition can change which markers exist (D31 presence), so arrival
  // and departure are presence-context changes. Guarded inside — an unchanged
  // presence set rebuilds nothing, which matters because departure fires this
  // per frame while travelling.
  refreshAnnotationPresence();
}

function refreshMediaVisibility(progress = mediaProgress): void {
  mediaProgress = progress;
  const next = new Set<string>();
  for (const item of site.media ?? []) {
    if (isMediaBindingPresent(
      item.binding,
      activeStopId,
      textSystem.activeAnnotation,
      mediaProgress,
      // Read at USE TIME so the author panel's switch is live (ticket 17/I2),
      // and read here rather than inside the predicate so that predicate stays
      // pure and independently assertable.
      site.settings?.blocks?.hideStopContent ?? false,
    )) {
      next.add(item.id);
    }
  }
  if (
    next.size === visibleMediaIds.size
    && [...next].every((id) => visibleMediaIds.has(id))
  ) {
    return;
  }
  visibleMediaIds = next;
  mediaLayer.setVisible(next);
}

/** The orbit bounds the site booted with, captured once so a `bounded` stop can
 *  narrow them and any other stop can put them back. Without this a single
 *  bounded stop would permanently narrow the rest of the site, because the
 *  original values live only inside OrbitControls.
 *
 *  ⚠ Captured HERE, at init, not lazily at the first policy application. The
 *  lazy capture meant `resetOrbitLimitsForTravel()` (below) had nothing to write
 *  until some stop policy had already run, so the very first flight out of a
 *  bounded stop could not be un-clamped. The CameraSystem exists by this point
 *  (constructed above), and nothing has narrowed its limits yet, so this reads
 *  the true boot values. */
const defaultOrbitLimits: OrbitLimits = cameraSystem.getOrbitLimits();

/**
 * FIX 1 — orbit limits are STOP-SCOPED, not site-scoped.
 *
 * A `bounded` stop narrows OrbitControls' azimuth/pitch/distance on ARRIVAL, and
 * OrbitControls re-clamps every frame in `update()`. Nothing used to lift those
 * limits when the camera left, so a flight or scrub OUT of a bounded stop was
 * fighting the previous stop's cage the whole way: broken/nondeterministic
 * paths, arrivals short of the authored camera, and the "second Next finally
 * reaches the real location" symptom.
 *
 * Every departure therefore calls this first. Arrival re-applies the destination
 * stop's policy through applyStop → applyExplorePolicy, so the cage only ever
 * exists while the camera is actually parked inside it.
 */
function resetOrbitLimitsForTravel(): void {
  cameraSystem.setOrbitLimits(defaultOrbitLimits);
}

// ─── Engagement state (Plan 25 §12) ───────────────────────
// One owner, one funnel. The page owns all input until the visitor engages.

/** Leave-detent (px) applied while docked at a LOCKED stop — one flick, three
 *  wheel notches, matching the tour's end-of-rail exit door exactly. */
const LOCKED_STOP_DETENT_PX = 320;
/** Leave-detent for EVERY other stop (author, 2026-08-03 D41: "we should have
 *  it for every stop, even if it's usually zero. let's start with 240px or
 *  something small") — two wheel notches of intent before travel resumes, with
 *  the stop-title underline and leave pill as its fill. A site may still author
 *  `scroll.detentThresholdPx` to raise, lower, or zero it. */
const DEFAULT_STOP_DETENT_PX = 240;

let engagement: EngagementState = "disengaged";

// ─── Mode locks (D31 ticket 09) ───────────────────────────
// Progressive freedom. What is OFFERED starts as the site's locks and is edited
// for the rest of the visit by `allow`/`deny`/`engage` effects. Everything that
// shows or enters a mode reads `offeredNow()`; nothing reads the raw set except
// the transition itself, which is what keeps the author override in one place.

/** VISITOR TRUTH — what a visitor would be offered, locks and effects included.
 *  Author mode overrides what is READ from it (`offeredNow`), never what is
 *  written to it, so an author editing a gated scene can still be shown what
 *  their visitor would meet. */
let offeredModeSet: ReadonlySet<SceneMode> = initialOffered(site.settings?.lockedModes);

/** The mode decision's inputs, gathered from the three live values. */
function modeState(): ModeState {
  return { offered: offeredModeSet, engagement, authorMode };
}

/** The modes on offer as any surface must ask — author override applied. */
function offeredNow(): ReadonlySet<SceneMode> {
  return offeredModes(modeState());
}

/** Captured once, before any switch runs: "pan: true" means RESTORE THIS, not
 *  "force true" — an embed that booted with pan off must never gain it. */
const originalEnablePan = cameraSystem.controls.enablePan;
/** The canvas' ENGAGED touch-action, captured as it was set (SparkScene writes
 *  "none" at SparkScene.ts:155 so OrbitControls owns the thumb). Disengaged
 *  restores "auto" — otherwise native vertical page scroll is impossible over
 *  the canvas on touch, and the visitor cannot scroll past the scene at all. */
const engagedTouchAction = sparkScene.canvas.style.touchAction;
let engageFocusTarget: HTMLElement | null = null;
let onDisengagedSceneClick: (() => void) | null = null;

/**
 * Apply a stop's `explore` policy (spec §5.5).
 *
 * ⚠ ENGAGEMENT: per-stop policy is a TOUR concept. Disengaged means the page owns
 * input, and explore means the visitor overrode the stop deliberately — in both
 * this is a no-op, which also resolves the dock()-ordering hazard below for
 * everything except tour.
 *
 * ⚠ ORDERING: this must run AFTER `scrollRail.dock()`. Arrival calls `dock()`
 * first, and `dock()` → `setState("docked")` → `applyRotatePolicy()` would
 * overwrite the policy if the order were reversed. `applyStop` is called from
 * `onStopArrived` after `dock()`, so applying it here is correct by construction.
 */
function applyExplorePolicy(siteStop: SiteStop | undefined, applyLimits = true): void {
  if (engagement !== "tour") return;
  const policy = explorePolicy(siteStop?.explore, siteStop?.camera);
  scrollRail?.setTravelEnabled(policy.travel);
  scrollRail?.setOrbitAllowed(policy.orbit);
  // ARRIVAL BUFFER at a locked stop (author, re-test 2026-08-03): a locked
  // framing should "lock the scroll into place temporarily". `locked` is the one
  // policy row with orbit:false, so that predicate names it — the same one used
  // for recenter below. The door is the same size as the tour's end-of-rail exit
  // (one flick, three wheel notches) and the leave-intent pill is its visual
  // fill; `pillAllowed` is true in tour, so the affordance actually shows.
  // Every other stop takes the site's configured value, default 240 (D41).
  scrollRail?.setDetentThresholdPx(
    policy.orbit ? (scrollSettings.detentThresholdPx ?? DEFAULT_STOP_DETENT_PX) : LOCKED_STOP_DETENT_PX,
  );
  // A stop that declares permanent (`free`) explore forces the rail into
  // "explore" here so travel/orbit land correctly even though nothing on the
  // sub-toggle changed engagement mode.
  if (policy.explore) scrollRail?.setExplore(true);
  // Recenter obeys the stop in tour: a `locked` stop is "held on this view", and
  // a double-click that re-pivots it is not held. `locked` is the one row with
  // neither switch, so the row itself names it — no second source of truth.
  //
  // ⚠ FIX 2 (D34): `locked` now travels, so "neither switch" no longer names it.
  // `orbit: false` is the one field unique to the locked row, so that is the
  // predicate now — recenter stays disabled for exactly locked, as before.
  const lockedStop = !policy.orbit;
  cameraSystem.setRecenterEnabled(!lockedStop);
  // FIX 3 — re-entering tour from explore applies FLAGS but not LIMITS: the
  // camera is wherever the visitor left it, and clamping it to the docked stop's
  // bounded cage on the flip is a visible jerk the author explicitly ruled out
  // (D4: "the flip should show nothing"). The camera merges back onto the path
  // at the next scroll, and the next ARRIVAL re-applies limits normally.
  if (!applyLimits) return;
  if (policy.bounds) {
    const DEG2RAD = Math.PI / 180;
    cameraSystem.setOrbitLimits({
      minPitch: policy.bounds.pitchMin,
      maxPitch: policy.bounds.pitchMax,
      minDistance: policy.bounds.distMin,
      maxDistance: policy.bounds.distMax,
      // The site's yaw and OrbitControls' azimuth are the same angle: both are
      // atan2(offset.x, offset.z) — CameraSystem.getState() and THREE's
      // Spherical. So this is a unit conversion, not a frame conversion.
      // ⚠ INVARIANT: that equivalence holds only for a Y-up camera, because
      // OrbitControls first rotates the offset into the camera's `up` frame.
      // Nothing in this toolkit writes `camera.up` (verified by grep — the sole
      // reference reads it, in CameraSystem's fly-vector maths), so it stays
      // THREE's default (0,1,0). A future change that tilts `up` must transform
      // these bounds instead of passing them through.
      // Bounds outside ±180° are fine: OrbitControls normalizes min/max itself
      // and handles the wrapped case, so a stop authored at yaw 240 works.
      minAzimuth: policy.bounds.yawMin * DEG2RAD,
      maxAzimuth: policy.bounds.yawMax * DEG2RAD,
    });
  } else {
    cameraSystem.setOrbitLimits(defaultOrbitLimits);
  }
}

function applyStop(index: number, siteStop: SiteStop): void {
  // Docking is a standstill at an authored pose — record it as the composed
  // still NOW rather than leaving it for the next flight's capture, which can
  // be refused (a scrub between now and then). Orbiting done after arrival is
  // still picked up: the capture at a flight start from rest overwrites this.
  // Also clears any tainted mid-air rest a halted flight left behind.
  stillPose = cameraSystem.getState();
  invalidRestPose = null;
  setActiveStop(site.stops[index]?.id ?? null);
  // Arriving at a stop replaces whatever annotation panel was open (legacy overlay.hide()).
  setSelection(null);
  applyExplorePolicy(siteStop);
  updateNav(index, siteStop.label);
  reportStop(index);
}

const cameraRail = new CameraRail({
  cameraSystem,
  canvas: sparkScene.canvas,
  stops: toRailStops(site.stops),
  transitionDuration: settings.transitionDuration ?? 2.2,
  settleDuration: settings.settleDuration ?? 0.6,
  onStopArrived: (index, stop) => {
    scrollRail?.dock(); // arrival is the detent
    applyStop(index, stop.meta!.site as SiteStop);
  },
  // Departure hides stop-bound text (legacy fade-out-on-departure, finding #17);
  // the same-value guard in setActiveStop makes the per-frame firing cheap.
  onTransition: () => {
    setActiveStop(null);
    setSelection(null);
  },
  onOptics: applyRailOptics,
});

// ─── Nav UI (top center — clear of the mobile bottom sheet) ──

/** ONE motion policy for every stop navigation. Anything that moves the camera
 *  to a stop on a visitor's command must go through here, or surfaces drift
 *  apart — the in-scene prev/next once flew at the default duration while prose
 *  links and the element API honoured reduced motion. */
function travelToStop(index: number): void {
  // FIX 1c — the single programmatic-navigation funnel (prev/next, element API,
  // router). Lift the docked stop's orbit cage before the flight starts, or
  // OrbitControls clamps the camera every frame of a flight that is leaving it.
  resetOrbitLimitsForTravel();
  const clamped = Math.max(0, Math.min(site.stops.length - 1, index));
  const plan = planTravel(cameraRail.resolvedDuration(clamped));
  if (plan.mode === "cut") cameraRail.cutToStop(clamped);
  else cameraRail.goToStop(clamped, plan.durationSec);
}

const navBar = document.createElement("div");
navBar.className = "splat-input-bar";
navBar.style.left = "50%";
navBar.style.transform = "translateX(-50%)";
navBar.style.width = "auto";
navBar.style.borderRadius = "0 0 6px 6px";

const prevBtn = document.createElement("button");
prevBtn.id = "prevStop";
prevBtn.textContent = "← Prev";
// Route through the same motion policy as every other navigation: calling
// cameraRail.prev() directly skipped planTravel, so these two buttons flew at
// the default duration while prose links and the API honoured reduced motion.
prevBtn.addEventListener("click", () => travelToStop(cameraRail.currentStop - 1));

const stopLabel = document.createElement("span");
stopLabel.className = "status";
stopLabel.style.minWidth = "110px";
stopLabel.style.textAlign = "center";
// Leave-intent made visible AT the stop title (author, 2026-08-03 re-test H1:
// wants the buffer "as a value somewhere… even if it's something minor up
// beneath the stop title"). A slim underline that fills with the accumulator —
// white, per the no-accent chrome language. Driven from onAccumulator below.
stopLabel.style.position = "relative";
// The label TEXT lives in its own span so updateNav can rewrite it without
// destroying siblings — `stopLabel.textContent = …` would delete the underline
// (the same child-wipe that once ate the engage switch's knob).
const stopText = document.createElement("span");
stopLabel.appendChild(stopText);
const stopFill = document.createElement("span");
stopFill.setAttribute("aria-hidden", "true");
Object.assign(stopFill.style, {
  position: "absolute",
  left: "0",
  bottom: "-3px",
  height: "2px",
  width: "0%",
  background: "rgba(255, 255, 255, 0.9)",
  borderRadius: "1px",
  opacity: "0",
  pointerEvents: "none",
});
stopLabel.appendChild(stopFill);

const nextBtn = document.createElement("button");
nextBtn.id = "nextStop";
nextBtn.textContent = "Next →";
nextBtn.addEventListener("click", () => travelToStop(cameraRail.currentStop + 1));

navBar.appendChild(prevBtn);
navBar.appendChild(stopLabel);
navBar.appendChild(nextBtn);
container.appendChild(navBar);

function updateNav(index: number, label: string): void {
  stopText.textContent = `${index + 1}/${site.stops.length} · ${label}`;
  edgeTicks.forEach((tick, i) => {
    tick.style.background = i === index ? "#4ade80" : "#3a3a42";
  });
}
// ─── Scroll travel (ScrollRail) ───────────────────────────
// Desktop: wheel scrubs the rail; at stops a sustained-scroll detent
// (leave pill) must fill before travel resumes. Mobile: vertical swipe
// travels, horizontal swipe nudges yaw, and the explore chip hands the
// thumb to OrbitControls. Ctrl+wheel / trackpad pinch still zooms.

const scrollSettings = settings.scroll ?? {};
const scrollEnabled = (scrollSettings.enabled ?? true) && site.stops.length >= 2;

// Edge progress rail — the visible body of the scroll axis
const edgeTrack = document.createElement("div");
Object.assign(edgeTrack.style, {
  position: "absolute",
  right: "12px",
  top: "18%",
  height: "64%",
  width: "3px",
  background: "rgba(255, 255, 255, 0.14)",
  borderRadius: "2px",
  zIndex: "750",
});
const edgeFill = document.createElement("div");
Object.assign(edgeFill.style, {
  position: "absolute",
  top: "0",
  width: "100%",
  height: "0%",
  background: "#4ade80",
  borderRadius: "2px",
});
edgeTrack.appendChild(edgeFill);
const edgeTicks: HTMLButtonElement[] = site.stops.map((stop, i) => {
  const tick = document.createElement("button");
  tick.type = "button";
  tick.setAttribute("aria-label", `Go to ${stop.label}`);
  Object.assign(tick.style, {
    position: "absolute",
    left: "-4px",
    top: `calc(${(i / Math.max(1, site.stops.length - 1)) * 100}% - 5px)`,
    width: "11px",
    height: "11px",
    borderRadius: "50%",
    border: "2px solid rgba(255, 255, 255, 0.6)",
    background: "#3a3a42",
    padding: "0",
    cursor: "pointer",
  });
  tick.addEventListener("click", () => cameraRail.goToStop(i));
  edgeTrack.appendChild(tick);
  return tick;
});

// Leave pill — the detent affordance
const leavePill = document.createElement("div");
Object.assign(leavePill.style, {
  position: "absolute",
  left: "50%",
  bottom: "18px",
  transform: "translateX(-50%)",
  display: "flex",
  alignItems: "center",
  gap: "8px",
  background: "rgba(18, 18, 23, 0.9)",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  borderRadius: "999px",
  padding: "6px 14px",
  color: "#d5d5dc",
  fontSize: "12px",
  fontFamily: "'SF Mono', 'Fira Code', monospace",
  opacity: "0",
  transition: "opacity 150ms ease",
  zIndex: "950",
  pointerEvents: "none",
});
const pillRing = document.createElement("span");
Object.assign(pillRing.style, {
  width: "14px",
  height: "14px",
  borderRadius: "50%",
  background: "conic-gradient(#4ade80 0deg, rgba(255,255,255,0.18) 0deg)",
});
const pillLabel = document.createElement("span");
pillLabel.textContent = "keep scrolling to continue";
leavePill.appendChild(pillRing);
leavePill.appendChild(pillLabel);

let scrollRail: ScrollRail | null = null;

if (scrollEnabled) {
  scrollRail = new ScrollRail({
    cameraRail,
    cameraSystem,
    canvas: sparkScene.canvas,
    container,
    detentThresholdPx: scrollSettings.detentThresholdPx ?? DEFAULT_STOP_DETENT_PX,
    // Authors get no exit detent: the release callback below never disengages
    // them, so a held wheel at the end would just swallow their scroll forever.
    holdAtEnd: !authorMode,
    wheelPxPerProgress: scrollSettings.wheelPxPerProgress,
    touchPxPerProgress: scrollSettings.touchPxPerProgress,
    onStateChange: (state) => {
      if (state === "traveling") {
        // FIX 1b — input-driven departure. The docked stop's bounded cage must
        // not clamp the scrub that is leaving it.
        resetOrbitLimitsForTravel();
        setActiveStop(null);
        setSelection(null);
      }
    },
    onAccumulator: (fill, direction) => {
      // While disengaged the pill is forced hidden regardless of what the rail
      // reports — no affordance for a mechanism the visitor does not own.
      const allowed = engagementSwitches(engagement).pillAllowed;
      leavePill.style.opacity = allowed && fill > 0.02 ? "1" : "0";
      pillRing.style.background = `conic-gradient(#4ade80 ${Math.round(fill * 360)}deg, rgba(255,255,255,0.18) 0deg)`;
      pillLabel.textContent =
        direction > 0 ? "keep scrolling to continue" : "keep scrolling to go back";
      // The stop-title underline mirrors the same fill (H1 request).
      stopFill.style.width = `${Math.round(fill * 100)}%`;
      stopFill.style.opacity = allowed && fill > 0.02 ? "1" : "0";
    },
    // D19 — the ~320px exit detent at the tour's end, SYMMETRIC on wheel and
    // touch (author's ruling 2026-08-03): one more deliberate flick past the
    // last stop disengages, and the same motion then flows into the page.
    // Backward (-1) never disengages — scrolling up past the first stop is the
    // visibility observer's case.
    onEndRelease: (direction) => {
      // Author mode never auto-disengages: an author is not a visitor, and
      // being ejected mid-edit each time the rail hits its end is pure friction.
      if (authorMode) return;
      if (direction === 1 && engagement === "tour") setEngagement("disengaged");
    },
  });
  container.appendChild(edgeTrack);
  container.appendChild(leavePill);
}

if (site.stops.length > 0) {
  updateNav(0, site.stops[0].label);
}

// ─── Engagement funnel (Plan 25 §12) ──────────────────────

/** Land one matrix row on every subsystem. Never announces — `setEngagement`
 *  owns the announcement, so init can apply the default row silently. */
function applySwitches(state: EngagementState): void {
  const s = engagementSwitches(state);
  const controls = cameraSystem.controls;
  // (The boot bounds are captured at init — see `defaultOrbitLimits` — so this
  // no longer needs a lazy capture of its own.)
  scrollRail?.setCaptureEnabled(s.captureEnabled);
  scrollRail?.setTravelEnabled(s.travelEnabled);
  scrollRail?.setExplore(state === "explore");
  controls.enableZoom = s.zoom;
  controls.enableRotate = s.rotate;
  controls.enablePan = s.pan ? originalEnablePan : false;
  cameraSystem.setRecenterEnabled(s.recenter);
  const engaged = state !== "disengaged";
  // Touch: give the page back its native vertical scroll over the canvas.
  sparkScene.canvas.style.touchAction = engaged ? engagedTouchAction : "auto";
  // Keyboard: CameraSystem makes the canvas focusable permanently, so a Tab onto
  // a disengaged canvas followed by W would fly it. -1 keeps it programmatically
  // focusable (which engaging uses) while removing it from the tab order.
  sparkScene.canvas.tabIndex = engaged ? 0 : -1;
  cameraSystem.setInputEnabled(engaged);
  if (!s.applyStopPolicy) cameraSystem.setOrbitLimits(defaultOrbitLimits);
  const tabIndex = s.navTabbable ? 0 : -1;
  prevBtn.tabIndex = tabIndex;
  nextBtn.tabIndex = tabIndex;
  for (const tick of edgeTicks) tick.tabIndex = tabIndex;
  // Markers are NOT touched here any more. Under visible = live (D31) every
  // visible marker is activatable in every engagement state, so it keeps its tab
  // stop unconditionally (D30 superseded) — the old engagement-gated
  // `annotations.setTabbable` toggle is retired, not conditioned. Marker tab
  // stops now live entirely in native <button> semantics (see Annotations.add).
  if (!s.pillAllowed) leavePill.style.opacity = "0";
}

/**
 * The SINGLE funnel for engagement, mirroring `setSelection`: guard-if-unchanged
 * → subsystem writes → dependent UI → announce LAST.
 */
function setEngagement(next: EngagementState): void {
  if (engagement === next) return;
  // Mode locks (ticket 09) are enforced in the FUNNEL, not just on the chrome
  // that offers them. A mode the visit has not been offered is not a state this
  // scene can be in — otherwise a second path in (the host's own
  // `setEngagement`) would leave the mode row greying a word it also shows as
  // pressed, which is the inconsistent-state class ticket 05 found in
  // `goToObject`. "disengaged" is never checked: the frozen frame is the
  // universal safe landing and is always available.
  //
  // An `engage` effect reaches here having ALREADY granted its mode, so it
  // passes by construction; author mode passes because it is offered everything.
  if (next !== "disengaged" && !offeredNow().has(next)) {
    console.warn(
      `[splat-site] refusing to engage "${next}" — this visit has not been offered that mode `
      + `(locked at load, or withdrawn by a "deny" effect). Grant it with an "allow" or "engage" rule first.`,
    );
    return;
  }
  const previous = engagement;
  engagement = next;
  // An engagement change mid-flight halts the flight where it is: the visitor
  // took a different door (the switch, Escape, the D19 off-screen release), and
  // a camera that kept flying under a state that now owns input differently
  // would be motion nobody asked the new state for. The flight never changes
  // engagement (that is this function's callers' act, ticket 09's included);
  // engagement changing simply outranks the flight.
  haltSequence();
  applySwitches(next);
  // Per-stop travel/orbit/bounds are a tour concept, and applyExplorePolicy
  // self-gates on `engagement`, so this can only land in tour.
  // FIX 3 — flags only on the flip; the camera must not move at all (a locked
  // stop still re-locks the controls, a bounded one just does not re-cage them).
  if (next === "tour") applyExplorePolicy(site.stops[cameraRail.currentStop], false);
  if (next === "disengaged") {
    // Only when there is still a switch to land on. With every mode withdrawn
    // the switch is gone (see `refreshEngagementChrome`), and focusing a hidden
    // element silently drops focus to the body — worse than leaving it on the
    // marker the visitor just activated, which is where a `deny` landing comes
    // from. Read from the mode state rather than the DOM: the chrome is
    // refreshed further down this same function, so the element's own hidden
    // flag is still describing the previous moment here.
    if (entryMode(offeredNow()) !== null) engageFocusTarget?.focus({ preventScroll: true });
  } else if (previous === "disengaged") {
    sparkScene.canvas.focus({ preventScroll: true });
  }
  refreshEngagementChrome();
  // Engagement is a context leg, so the flip re-evaluates stay-while claims
  // (ticket 13): a `while: { state: "tour" }` payoff ends when the visitor
  // leaves the tour. Before the presence refresh, for the same reason it is
  // before the announce — a listener must never observe a half-applied runtime.
  applyDisplayChannel(endStaleWhile(displayChannel, whenContext()));
  // A state condition can change which markers exist (D31 presence). Guarded
  // inside: a site with no presence conditions rebuilds nothing here.
  refreshAnnotationPresence();
  options.onEngagementChanged?.({ state: next });
}

/**
 * Tour pinch-zoom re-arm. `enableZoom` stays false in tour so an end-of-rail
 * wheel reaches the PAGE; this hands zoom back for exactly one ctrl/⌘ wheel
 * event (which is how browsers report a trackpad pinch). ScrollRail passes
 * ctrl/meta wheel through, and OrbitControls' own handler runs after this
 * capture-phase listener, so it sees zoom enabled and preventDefaults the
 * browser's page zoom itself.
 */
const onEngagementWheel = (e: WheelEvent): void => {
  if (engagement !== "tour" || !(e.ctrlKey || e.metaKey)) return;
  const controls = cameraSystem.controls;
  // ⚠ The browser's own ctrl-wheel page zoom is a DEFAULT ACTION, and this is
  // the first listener the event reaches. Cancel it here rather than relying on
  // OrbitControls to do it downstream: if anything ever prevents that handler
  // from running, the failure mode is the whole PAGE zooming under the visitor,
  // which is far worse than a pinch that does nothing. (This listener is
  // therefore non-passive — a passive one cannot preventDefault at all.)
  e.preventDefault();
  if (controls.enableZoom) return;
  controls.enableZoom = true;
  disarmEngagementZoom();
};
/**
 * ⚠ ROOT CAUSE, measured 2026-08-03 — do NOT put this back in a microtask.
 *
 * This disarm used to be `queueMicrotask(...)`, which made the whole re-arm a
 * no-op for real input. For a UA-dispatched (trusted) event the JS stack is
 * empty between listeners, so a microtask checkpoint runs BETWEEN them; for a
 * scripted `dispatchEvent` the stack is not empty, so microtasks wait until the
 * whole dispatch finishes. Measured in the rig, same page, same browser:
 *   UA-dispatched     → "A, microtask, B"
 *   script-dispatched → "A, B, microtask"
 * So under a real trackpad the microtask set `enableZoom = false` again BEFORE
 * OrbitControls' own canvas listener ran; it saw zoom disabled, returned without
 * preventDefault, and the browser zoomed the page. Every scripted check passed,
 * which is exactly why this survived.
 *
 * The disarm therefore rides a BUBBLE-phase listener on the container: the
 * canvas is a descendant, so it is guaranteed to run after OrbitControls' own
 * target-phase handler, and it is scoped to this one event rather than to a
 * timing guess. The timer is only a safety net for the case where something
 * stops propagation before the event climbs back out.
 */
let disarmZoomTimer: ReturnType<typeof setTimeout> | null = null;
function disarmEngagementZoom(): void {
  if (disarmZoomTimer !== null) clearTimeout(disarmZoomTimer);
  disarmZoomTimer = setTimeout(applyEngagementZoomDisarm, 0);
}
function applyEngagementZoomDisarm(): void {
  if (disarmZoomTimer !== null) {
    clearTimeout(disarmZoomTimer);
    disarmZoomTimer = null;
  }
  if (engagement === "tour") cameraSystem.controls.enableZoom = false;
}
const onEngagementWheelBubble = (): void => {
  applyEngagementZoomDisarm();
};
container.addEventListener("wheel", onEngagementWheel, { capture: true, passive: false });
container.addEventListener("wheel", onEngagementWheelBubble);

/** Escape, two duties in a fixed order (ticket 13/A3). The FIRST press clears
 *  every piece of visitor-activated content — all display claims, whatever
 *  their authored lifetime (`forever` and `until: "dismiss"` included: a
 *  visitor ending something is not that content ending on its own), plus the
 *  selection, which is what visitor-activated media hangs off. It never
 *  reaches content the visitor did not open: stop captions, editorial,
 *  always-on and progress-bound text are binding-driven, not claims, and
 *  belong to where the visitor is. Content dismissal works in EVERY engagement
 *  state — frozen markers are live, so their boxes must close without
 *  engaging. The SECOND press releases input back to the page, as before. That
 *  two-press cost is a stated consequence of sharing the key, not a bug.
 *  Listening on the container means this only fires when focus is already
 *  inside the scene. */
const onEngagementKeyDown = (e: KeyboardEvent): void => {
  if (e.key !== "Escape") return;
  // "Was anything open?" is read off the transition's IDENTITY, never off the
  // claims array's shape — the channel's contract is that an ending with
  // nothing to end returns the same state object.
  const dismissed = dismissAll(displayChannel);
  if (dismissed !== displayChannel || textSystem.activeAnnotation !== null) {
    e.stopPropagation();
    applyDisplayChannel(dismissed);
    // Routed through setSelection so media clears and the host still hears it.
    setSelection(null);
    return;
  }
  if (engagement === "disengaged") return;
  e.stopPropagation();
  setEngagement("disengaged");
};
container.addEventListener("keydown", onEngagementKeyDown);

/** A click on a disengaged scene selects nothing — it invites engagement. */
const onEngagementCanvasClick = (): void => {
  if (engagement !== "disengaged") return;
  onDisengagedSceneClick?.();
};
sparkScene.canvas.addEventListener("click", onEngagementCanvasClick);

/** D19 — a scene scrolled mostly off screen cannot keep owning input. */
const engagementObserver = new IntersectionObserver(
  (entries) => {
    const entry = entries[entries.length - 1];
    if (!entry) return;
    // ⚠ Author mode is NOT exempt here, though it is exempt from the end-of-rail
    // release. Those are different risks: being ejected at the rail's end is
    // pure friction for an author, but keeping wheel and WASD ownership while
    // the scene is scrolled off screen is the invisible-input hazard §12 exists
    // to kill, and an author is as capable of driving an unseen camera as
    // anyone. Exempting this was over-reach; it is deliberately not exempted.
    if (entry.intersectionRatio < 0.4) {
      // A frozen-frame flight is deliberately NOT halted here (author,
      // 2026-08-10, superseding the spec's "the visibility backstop still
      // applies"): a disengaged watcher holds no input through any door, so an
      // unseen flight endangers nothing — it finishes on its own terms and the
      // visitor scrolls back to a completed picture, never a mid-air freeze.
      // The backstop guards INPUT, and input rides the engaged release below
      // (setEngagement halts any flight as part of the flip).
      if (engagement !== "disengaged") setEngagement("disengaged");
    }
  },
  { threshold: [0.4] },
);
engagementObserver.observe(container);

// ─── Engagement toggle chrome (Plan 25 §13) ───────────────
// One always-visible affordance to enter/leave engagement, plus a Tour|Explore
// sub-toggle that only exists while engaged. Replaces the old coarse-pointer-only
// "Explore scene" chip — this toggle covers every pointer type.

const engagementStyle = document.createElement("style");
engagementStyle.textContent = `
/* The focus ring follows the same two-stroke logic as the switch itself: white
 * for dark scenes, a dark halo behind it for light ones. No accent hue — the
 * engaged state deliberately carries none, and a green ring here would
 * reintroduce it for keyboard users only. */
.splat-engage-toggle:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.95);
  outline-offset: 2px;
  border-radius: 999px;
  box-shadow: 0 0 0 5px rgba(0, 0, 0, 0.55);
}
/* Outward again: the sub-toggle no longer sets overflow:hidden (there is no
 * pill left to clip a fill to), so nothing eats the ring. */
.splat-engage-segment:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.95);
  outline-offset: 2px;
  border-radius: 3px;
}
.splat-engage-toggle:disabled {
  cursor: default;
}
/* D21: the loading state must read WITHOUT motion. The pulse animation below is
 * gated on prefers-reduced-motion, so this static dim carries the same
 * loading-vs-ready information for visitors who opt out of animation. When the
 * animation does run it overrides this value for its duration. */
.splat-engage-loading {
  opacity: 0.45;
}
/* The resting colours live HERE, not in an inline style: an inline background
 * outranks every selector, which would silently defeat the [aria-pressed="true"]
 * rules below and leave the engaged state with no colour change at all. */
/* Every part of this switch is WHITE at an alpha, so over a light part of the
 * scene it composites toward the backdrop and disappears — measured 1.09:1 rest
 * and 1.14:1 between states against a bright wall, well under §12's 3:1 floor.
 * A soft grey falloff radiating from the white line is the fix — NOT a hard
 * outline, which read as a drawn border rather than as depth. It fades over
 * ~12px so there is no visible edge to it, while still giving the white stroke
 * something darker to sit against wherever the scene behind is bright. */
.splat-engage-track {
  background: rgba(255, 255, 255, 0.15);
  border: 2px solid rgba(255, 255, 255, 0.35);
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.4), 0 0 12px rgba(0, 0, 0, 0.22);
}
/* Ghosted, not solid: the knob is the same white as everything else, just
 * carried at a higher alpha than the track it sits in (0.55 vs 0.15/0.22) so it
 * reads as denser rather than as a separate opaque object. Its own hairline is
 * what keeps it findable on a bright backdrop, where a translucent white knob
 * and a translucent white track would otherwise wash out together (1.11:1). */
.splat-engage-knob {
  background: rgba(255, 255, 255, 0.385);
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.4), 0 0 12px rgba(0, 0, 0, 0.22);
}
/* Tour|Explore — the "ghost pill". Selection is weight and brightness only, no
 * fill. The ::after reserves each segment's BOLD width at all times, so going
 * active cannot reflow the pill and shuffle the segments sideways. */
/* N3: no pill at all — the container is just a 110px-wide justification frame. */
.splat-engage-subtoggle {
  background: transparent;
}
/* A7 — the sleeping switch says what it is when you reach for it. Occupies the
 * EXACT slot the Tour/Explore row uses (same right/bottom anchor, same centring
 * transform, same 16px mono at weight 700), because the two are the same line of
 * text at two different moments: "Activate Scene" while the scene sleeps, the
 * mode row once it is awake. They can never be visible at once — the mode row
 * only exists while engaged, and refreshEngagementChrome drops this the instant
 * that happens.
 * Both display values live HERE, never inline (this is inside a template
 * literal — no backticks): an inline display would outrank
 * the state class and the hint would be stuck in whichever state it was born in
 * (the lesson this codebase has now learned three times). */
.splat-engage-hint {
  display: none;
  position: absolute;
  right: calc(75px + env(safe-area-inset-right, 0px));
  transform: translateX(50%);
  bottom: calc(86px + env(safe-area-inset-bottom, 0px));
  white-space: nowrap;
  z-index: 960;
  padding: 4px 0;
  font-size: 16px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.98);
  /* white text over an unknown scene needs its own dark ground */
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.75);
  pointer-events: none;
}
.splat-engage-hint.splat-engage-hint-on {
  display: block;
}
.splat-engage-segment {
  display: inline-block;
  background: transparent;
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
  font-weight: 400;
  /* white text over an unknown scene needs its own dark ground */
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.75);
}
.splat-engage-segment[aria-pressed="true"] {
  color: rgba(255, 255, 255, 0.98);
  font-weight: 700;
}
/* A LOCKED mode (ticket 09): the word stays legible enough to read as a place
 * the scene can take you, but visibly out of reach — freedom the visitor can
 * see expanding when a marker grants it. Dimmer than the ordinary inactive
 * word, which is 0.45. */
.splat-engage-segment:disabled {
  color: rgba(255, 255, 255, 0.2);
  cursor: default;
}
/* Reserves each segment's BOLD width at all times, so going active cannot
 * reflow the row. MUST stay a block, not a flex item — hence the segment is
 * inline-block rather than flex. */
.splat-engage-segment::after {
  content: attr(data-label);
  display: block;
  height: 0;
  overflow: hidden;
  visibility: hidden;
  font-weight: 700;
  pointer-events: none;
}
/* Engaged: the circle travels, and the ring around it thickens and brightens.
 * The extra thickness is a box-shadow rather than a wider border so the track's
 * box never changes size — a border-width change would nudge the knob. */
.splat-engage-toggle[aria-pressed="true"] .splat-engage-knob {
  transform: translateX(50px);
}
.splat-engage-toggle[aria-pressed="true"] .splat-engage-track {
  border-color: rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.55), 0 0 6px 2px rgba(0, 0, 0, 0.35);
  background: rgba(255, 255, 255, 0.22);
}
/* D9 — a click on the disengaged scene flashes that same ring, brighter still.
 * Declared OUTSIDE the reduced-motion block so it is a visible static state for
 * visitors who opt out of animation; the keyframes below merely animate it. */
.splat-engage-toggle.splat-engage-pulse .splat-engage-track {
  border-color: rgba(255, 255, 255, 0.95);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.35), 0 0 8px 3px rgba(0, 0, 0, 0.3);
}
@media (prefers-reduced-motion: no-preference) {
  .splat-engage-knob { transition: transform 200ms ease; }
  .splat-engage-track { transition: border-color 180ms ease, box-shadow 180ms ease, background 180ms ease; }
  /* the dark hairline is carried through every stop — without it the animation
   * would drop the light-backdrop stroke for its whole 600ms */
  @keyframes splat-engage-pulse {
    0% { box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.7), 0 0 4px rgba(0, 0, 0, 0.4); }
    55% { box-shadow: 0 0 0 10px rgba(255, 255, 255, 0), 0 0 4px rgba(0, 0, 0, 0.4); }
    100% { box-shadow: 0 0 0 0 rgba(255, 255, 255, 0), 0 0 4px rgba(0, 0, 0, 0.4); }
  }
  .splat-engage-toggle.splat-engage-pulse .splat-engage-track { animation: splat-engage-pulse 600ms ease; }
  @keyframes splat-engage-loading-pulse {
    0%, 100% { opacity: 0.35; }
    50% { opacity: 0.65; }
  }
  .splat-engage-loading { animation: splat-engage-loading-pulse 1400ms ease-in-out infinite; }
}
`;
container.appendChild(engagementStyle);

// D22: a compact switch (track + sliding knob) — a recognizable on/off shape
// rather than a set of words. The words re-home as a label revealed on
// hover/focus/pulse (CSS above), not shown by default.
const engageToggle = document.createElement("button");
engageToggle.type = "button";
engageToggle.className = "splat-engage-toggle";
// D21: the toggle only becomes usable once the scenes have actually streamed
// in (settleReady, below) — not merely once the runtime has booted.
engageToggle.disabled = true;
Object.assign(engageToggle.style, {
  position: "absolute",
  right: "calc(12px + env(safe-area-inset-right, 0px))",
  bottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
  zIndex: "960",
  display: "flex",
  alignItems: "center",
  gap: "12px",
  padding: "8px",
  background: "transparent",
  border: "none",
  cursor: "pointer",
});

const engageTrack = document.createElement("span");
engageTrack.className = "splat-engage-track splat-engage-loading";
Object.assign(engageTrack.style, {
  position: "relative",
  flex: "none",
  width: "110px",
  height: "60px",
  borderRadius: "999px",
  // border lives in the stylesheet, NOT here — an inline border would outrank
  // the engaged/pulse rules that brighten it.
});
const engageKnob = document.createElement("span");
engageKnob.className = "splat-engage-knob";
Object.assign(engageKnob.style, {
  position: "absolute",
  top: "6px",
  left: "6px",
  width: "44px",
  height: "44px",
  borderRadius: "50%",
});
engageTrack.appendChild(engageKnob);

// No STANDING label: the switch shape is the whole affordance, and its state is
// carried by the knob's travel plus the ring. The accessible name comes from
// aria-label (set in refreshEngagementChrome); pointer and keyboard users get
// the words on hover/focus-visible instead, from the hint element below.
engageToggle.appendChild(engageTrack);
engageToggle.addEventListener("click", () => {
  if (engagement !== "disengaged") {
    setEngagement("disengaged");
    return;
  }
  // The switch opens the first door on offer — tour normally, explore in a scene
  // that locked tour. Null is unreachable from a click (the switch is not shown
  // at all when nothing is offered), and refusing rather than assuming keeps it
  // that way if a future path ever shows it early.
  const entry = entryMode(offeredNow());
  if (entry !== null) setEngagement(entry);
});
/** Fallback timer for the pulse class. Under prefers-reduced-motion the keyframes
 *  never run, so `animationend` never fires and the class — with the label it
 *  reveals — would stick forever. */
let pulseFallbackTimer: ReturnType<typeof setTimeout> | null = null;
function clearPulse(): void {
  if (pulseFallbackTimer !== null) {
    clearTimeout(pulseFallbackTimer);
    pulseFallbackTimer = null;
  }
  engageToggle.classList.remove("splat-engage-pulse");
}
engageToggle.addEventListener("animationend", (e) => {
  if (e.animationName === "splat-engage-pulse") clearPulse();
});
container.appendChild(engageToggle);

// A7 — the invitation text for the sleeping switch. `aria-hidden` and
// pointer-events:none: it is decoration for the eye only, the toggle's
// accessible name already says the same thing, and it must never eat the click
// that is heading for the switch underneath it.
const engageHint = document.createElement("div");
engageHint.className = "splat-engage-hint";
engageHint.setAttribute("aria-hidden", "true");
engageHint.textContent = "Activate Scene";
container.appendChild(engageHint);

let engageHintHover = false;
let engageHintFocus = false;
function refreshEngageHint(): void {
  // Only while the scene sleeps: once engaged, the Tour/Explore row owns this
  // slot and two lines of text would stack on top of each other.
  const show = engagement === "disengaged" && (engageHintHover || engageHintFocus);
  engageHint.classList.toggle("splat-engage-hint-on", show);
}
engageToggle.addEventListener("mouseenter", () => {
  engageHintHover = true;
  refreshEngageHint();
});
engageToggle.addEventListener("mouseleave", () => {
  engageHintHover = false;
  refreshEngageHint();
});
engageToggle.addEventListener("focusin", () => {
  // :focus-visible, not plain focus — a pointer user who just clicked the switch
  // already knows what it does, and the hint would linger under their cursor.
  engageHintFocus = engageToggle.matches(":focus-visible");
  refreshEngageHint();
});
engageToggle.addEventListener("focusout", () => {
  engageHintFocus = false;
  refreshEngageHint();
});

const engageSubToggle = document.createElement("div");
Object.assign(engageSubToggle.style, {
  position: "absolute",
  // Centred ON THE SWITCH by its centre, not by an edge — at 16px the two words
  // are wider than the switch itself, so a fixed 110px box would clip or bias
  // them. The switch's centre is 20px (its right inset) + 55px (half its width)
  // = 75px from the container's right edge; anchoring `right` there and shifting
  // back by half this row's own width centres it at ANY width.
  right: "calc(75px + env(safe-area-inset-right, 0px))",
  transform: "translateX(50%)",
  // 86px puts the text line exactly 10px above the switch: the track's top edge
  // is at 80px (12 inset + 8 padding + 60 track) and the segment adds 4px of
  // padding below its text — 86 + 4 - 80 = 10.
  bottom: "calc(86px + env(safe-area-inset-bottom, 0px))",
  boxSizing: "border-box",
  // Variant G: weight alone carries the state — no marker, so nothing can push
  // the words off-centre (docs/mockups/25-mode-placement.html measured every
  // marker treatment; a leading dot biased the ink +5.0px right).
  display: "flex",
  justifyContent: "center",
  gap: "16.5px",
  alignItems: "center",
  whiteSpace: "nowrap",
  zIndex: "960",
  // Ghost pill: a hairline edge and no fill, so the control reads as part of
  // the scene rather than a chip stuck on top of it. Its border/background live
  // in the stylesheet (see .splat-engage-subtoggle) — never inline.
});
engageSubToggle.className = "splat-engage-subtoggle";
// D13 defect fix: `hidden` alone is not enough — an explicit inline
// `display` (set below and in refreshEngagementChrome) always wins over the
// UA `[hidden] { display: none }` rule, so both must be kept in sync.
engageSubToggle.hidden = true;
engageSubToggle.style.display = "none";

function makeEngageSegment(label: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "splat-engage-segment";
  btn.textContent = label;
  // Feeds the ::after width reservation so bolding the active segment cannot
  // reflow the row.
  btn.dataset.label = label;
  // Colours are NOT set here — they live in the stylesheet so the
  // [aria-pressed="true"] rules can win. An inline background would outrank
  // them, which is exactly how the main switch's engaged state was lost once.
  //
  // The CURSOR moved to the stylesheet for the same reason (ticket 09): a
  // locked word must not offer a pointing hand, and an inline `cursor` outranks
  // the `:disabled` rule that says so — the very trap the note above warns about.
  Object.assign(btn.style, {
    border: "none",
    // No flex sizing: each word takes its natural width and the container's
    // space-between pins the outer edges to the switch's 110px span.
    padding: "4px 0",
    fontSize: "16px",
    fontFamily: "'SF Mono', 'Fira Code', monospace",
  });
  return btn;
}
const tourSegment = makeEngageSegment("Tour");
const exploreSegment = makeEngageSegment("Explore");
/** The two words, paired with the mode each selects — so greying, pressing and
 *  selecting all walk the same list and cannot disagree about which is which. */
const modeSegments: readonly (readonly [SceneMode, HTMLButtonElement])[] = [
  ["tour", tourSegment],
  ["explore", exploreSegment],
];
for (const [mode, segment] of modeSegments) {
  segment.addEventListener("click", () => {
    // D13 defense-in-depth: entry is exactly one control (the main toggle) — the
    // sub-toggle must no-op while disengaged even if something else left it
    // visible. A locked word is `disabled` and cannot fire this at all; the
    // check stands anyway, on the same principle.
    if (engagement === "disengaged") return;
    if (!offeredNow().has(mode)) return;
    setEngagement(mode);
  });
}
engageSubToggle.appendChild(tourSegment);
engageSubToggle.appendChild(exploreSegment);
container.appendChild(engageSubToggle);

function refreshEngagementChrome(): void {
  const engaged = engagement !== "disengaged";
  // Mode locks (ticket 09). Everything below derives from the offered set: which
  // words are selectable, and whether there is a switch at all.
  const onOffer = offeredNow();
  // AUTHOR AMENDMENT (2026-08-10), superseding the spec's v1 "the switch is
  // present and functional at all times": a switch with nowhere to go is not
  // shown. With every mode locked the only way in is a marker whose rule grants
  // one, and the switch reappears the instant one does. Both the attribute and
  // the inline display are set, the same D13 pairing the mode row keeps — an
  // inline `display` outranks the UA `[hidden]` rule.
  const switchPresent = entryMode(onOffer) !== null;
  engageToggle.hidden = !switchPresent;
  engageToggle.style.display = switchPresent ? "flex" : "none";
  // A switch is named for what it CONTROLS, not for the action taken on it —
  // the way a light switch reads "Porch light", not "Turn on porch light".
  // aria-pressed already carries on/off, so a state-changing name would say the
  // same thing twice and read oddly ("Leave scene, pressed"). One constant name.
  // A7: the name now matches the visible invitation word-for-word. No `title` —
  // a native tooltip would double up with the hint the switch already shows on
  // hover, in a different font, a beat later, in a different place.
  const label = "Activate scene";
  engageToggle.setAttribute("aria-pressed", String(engaged));
  engageToggle.setAttribute("aria-label", label);
  // Engaged: the mode row takes this slot, so the hint goes regardless of hover.
  refreshEngageHint();
  engageSubToggle.hidden = !engaged;
  engageSubToggle.style.display = engaged ? "flex" : "none";
  // aria-pressed and `disabled` are the ONLY things set here — the stylesheet
  // derives the active/inactive/locked appearance from them.
  for (const [mode, segment] of modeSegments) {
    segment.setAttribute("aria-pressed", String(engagement === mode));
    // A locked word greys and cannot be selected. Native `disabled` rather than
    // `aria-disabled`: it takes the word out of the tab order and out of reach
    // of a click in one move, and assistive tech announces it as unavailable
    // without any bespoke work — the spec's stated accessibility floor.
    segment.disabled = !onOffer.has(mode);
  }
  publishEngagementChrome();
}

/* ── Reserved regions (ticket 06) ─────────────────────────────────────────
 *
 * The rule the author settled on 2026-08-09: A PANEL NEVER COVERS THE SWITCH OR
 * THE MODE WORDS — whoever placed it. The chrome's only duty is to say where it
 * is; PanelLane reads that and keeps out. Nothing here knows what a panel is.
 *
 * The registry is keyed on `container`, which is also the text system's host, so
 * two scenes on one page reserve independently.
 */

/**
 * A laid-out element's rectangle, or null when it has no box to reserve.
 *
 * CONTAINER-RELATIVE, not viewport-relative. Both sides of the comparison have
 * to stand still: the chrome is published on resize and on engagement change,
 * while a panel measures itself whenever it re-lays-out, and page scroll moves
 * this whole element through the viewport without firing either. Viewport
 * coordinates therefore drift apart by the scroll delta between the two
 * measurements — measured, and it put a caption straight over the switch after
 * a 400px scroll. Relative to the container, scrolling changes nothing.
 */
function chromeRect(element: HTMLElement): ReservedRect | null {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const base = container.getBoundingClientRect();
  return {
    left: rect.left - base.left,
    top: rect.top - base.top,
    right: rect.right - base.left,
    bottom: rect.bottom - base.top,
  };
}

/**
 * A chrome element's rectangle, INCLUDING while it is hidden.
 *
 * The author's call for the mode row: it reserves its space whether or not the
 * words are on screen, so a panel placed in the frozen frame is not covered the
 * instant the visitor engages, and nothing jumps when they do. Ticket 09's
 * hideable SWITCH is the identical situation — a panel placed while every mode
 * is locked must not be covered the instant a marker grants one — so it takes
 * the same treatment rather than a second rule.
 *
 * `display: none` has no rectangle at all, so a hidden element is measured
 * through a single layout pass — laid out, not painted, restored before anything
 * can see it. Both the attribute and the inline display must be handled: the
 * inline one outranks the UA `[hidden]` rule (the same pairing
 * refreshEngagementChrome keeps in sync).
 */
function chromeRectEvenWhenHidden(element: HTMLElement): ReservedRect | null {
  if (element.style.display !== "none") return chromeRect(element);
  const visibility = element.style.visibility;
  element.style.visibility = "hidden";
  element.style.display = "flex";
  const rect = chromeRect(element);
  element.style.display = "none";
  element.style.visibility = visibility;
  return rect;
}

function publishEngagementChrome(): void {
  publishReservedRegion(container, "engage-switch", chromeRectEvenWhenHidden(engageToggle));
  publishReservedRegion(container, "engage-mode-row", chromeRectEvenWhenHidden(engageSubToggle));
}

refreshEngagementChrome();

/** D9 — a click on the disengaged scene invites engagement; pulse the toggle
 *  (and reveal its label) so the visitor's eye is drawn to how. */
function pulseEngageToggle(): void {
  // Nothing to draw the eye to when there is no switch (ticket 09): with every
  // mode locked the answer to "how do I wake this?" is a marker, not the
  // chrome, and animating a `display: none` element would leave the class stuck
  // on — `animationend` never fires, so only the fallback timer would clear it.
  if (engageToggle.hidden) return;
  clearPulse(); // also resets the fallback timer, so a repeat pulse gets a full one
  void engageToggle.offsetWidth; // restart the animation on a repeat click
  engageToggle.classList.add("splat-engage-pulse");
  pulseFallbackTimer = setTimeout(clearPulse, 700); // > the 600ms keyframe
}
engageFocusTarget = engageToggle;
onDisengagedSceneClick = pulseEngageToggle;

// ─── Scenes from site.scenes ──────────────────────────────

// Load telemetry (Phase 7): observes beside the load path, never steers it.
// Site JSON may mirror the options under settings.telemetry; TS options win
// field-by-field. Returns undefined when disabled or consent is not granted —
// every use below is optional-chained, so "no telemetry" is a plain no-op.
//
// OPT-IN on the VISITOR site (default `telemetry: false`); AUTHOR mode keeps it
// on. A Firefox profile of the lab hero (2026-08-07) showed the telemetry probe's
// snapshot-observation cascade dominating the load's main thread — and because
// LOD refinement only advances on rendered frames, that main-thread tax directly
// starves the detail fill-in. It is a measurement tool with no visitor value, so
// the visitor load must not pay for it; author mode (a dev context) still wants
// its console/local diagnostics, so we only force-off when NOT authoring. The
// underlying re-entrancy that made the cascade pathological is fixed in
// LoadProbe.runOptionalObservation, so opt-in/author telemetry is now bounded.
// A site/host can still override either way via settings.telemetry / options.
// The diag self-test wires wireLoadTelemetry directly with explicit options and
// is unaffected by this default.
const telemetryOptions: Readonly<SiteTelemetryOptions> = {
  ...(authorMode ? {} : { telemetry: false }),
  ...((settings as Record<string, unknown>).telemetry as Readonly<SiteTelemetryOptions> | undefined ?? {}),
  ...(options.telemetry ?? {}),
};
const loadTelemetry = wireLoadTelemetry({
  options: telemetryOptions,
  authorMode,
  readCameraState: () => ({
    position: sparkScene.camera.position.toArray() as [number, number, number],
    quaternion: sparkScene.camera.quaternion.toArray() as [number, number, number, number],
    projectionMatrix: sparkScene.camera.projectionMatrix.toArray(),
    verticalFovDegrees: sparkScene.camera.fov,
    viewportWidthCssPx: containerW,
    viewportHeightCssPx: containerH,
    dpr: window.devicePixelRatio,
    foveation: {},
    pivot: cameraSystem.controls.target.toArray() as [number, number, number],
  }),
});

const loading = new LoadingUI({ container, text: "Streaming capture…" });

const loadedScenes: LoadedScene[] = [];
/** Scenes the backend refused on the spot — each one can never reveal. */
let scenesRefused = 0;

for (const def of site.scenes) {
  // Scenes load through the seam (doc 06 D25). The file format decides paging;
  // an authored `paged` passes through and warns only when it contradicts the
  // format (ticket 08 S5; D28). Reveal, progress and failure arrive through the
  // loader's callbacks (ticket 08 S1-S3) — they replace Spark's `initialized` /
  // `getRadMeta` failure signals and the pin's reveal gate. Spark's
  // `registerPagedSplat` pager-stall fix is gone: this pager fetches the whole
  // file by design (ticket 09 Stop 4d).
  let handle: SplatHandle;
  try {
    handle = loadSplat({
      url: def.url,
      backend: splatBackend,
      paged: def.paged,
      extSplats: def.extSplats ?? true,
      position: def.position,
      eulerRotationDeg: def.eulerRotationDeg,
      quaternion: def.quaternion,
      scale: def.scale,
      onProgress: (progress) => {
        sceneProgress.set(entry, progress);
        reportLoadProgress();
      },
      onLoad: () => {
        entry.visible = true;
        onSceneRevealed();
      },
      onError: (error) => {
        // Includes dispose-before-reveal (handle-disposed) — guarded as the pin did.
        if (disposed) return;
        failReady(error);
      },
    });
  } catch (error) {
    // The backend refuses some sources ON THE SPOT (ticket 08: .spz, .splat, an
    // unknown extension), and by now the renderer, rail DOM and listeners exist —
    // a throw out of construction would leave them with no owner. The refusal
    // fails the load through failReady instead, the pin's own load-error path,
    // one microtask later so that, like every pin load failure, it arrives after
    // construction has returned. A refused scene never reveals, so the site
    // never reports all-visible (review finding 1, owner ruling 2026-09-17;
    // ticket 08's refuse-immediately rule is unchanged).
    scenesRefused++;
    queueMicrotask(() => {
      if (disposed) return;
      failReady(error);
    });
    continue;
  }
  const entry: LoadedScene = {
    id: def.id,
    paged: formatFromName(def.url) === "rad",
    visible: false,
    mesh: handle.object,
    handle,
  };
  sparkScene.scene.add(entry.mesh);
  if (entry.paged) {
    // Telemetry registration is skipped until ticket 12 rewires telemetry onto
    // the backend's public counters: the pin's adapter polls for a Spark
    // `mesh.paged.pager` this backend never has, then gives up silently after
    // 30 s (ticket 09 Stop 1, A2 — ticket 12 owns removing this note).
    authorNote(
      "telemetry",
      `load telemetry does not register paged scene "${def.id}" — its adapter observes Spark's pager, which this backend does not have; ticket 12 rewires it onto the backend's public counters`,
    );
  }
  loadedScenes.push(entry);
}

function refreshProps(): Promise<void> {
  propLayer.setLighting(site.scenes.find((scene) => scene.propLighting)?.propLighting);
  return propLayer
    .setProps(site.scenes.flatMap((scene) => scene.props ?? []).filter((prop) => prop.url))
    .catch((error: unknown) => {
      console.error("[PropLayer] failed to load props", error);
    });
}

void refreshProps();

function refreshMedia(): void {
  mediaLayer.setMedia((site.media ?? []).filter((item) => item.url));
  refreshMediaVisibility();
}

refreshMedia();

// ─── Site load progress + readiness (ticket 09 Stop 5, P1) ───
// Replaces the pin's reveal gate (fd67153 :2432-2606; its constants are a
// reference only, doc 06 D26). Each scene's loader reports its true
// completed-work fraction and reveals at the seam's paint-observed ready
// (ticket 08 S1). Site progress is the slowest scene across ALL scenes (a
// revealed scene counts 1) — the pin's own "overall = the slowest scene", now
// covering non-paged scenes — reported only when it rises, then exactly one 1
// when the last scene reveals, immediately before ready. Declared divergences
// (doc 06 D29): no 80 ms report interval, no idle 1s before ready on sites
// without a paged scene, no double 1.
const sceneProgress = new Map<LoadedScene, number>();
let reportedLoadProgress = 0;

let allVisible = false;

function reportLoadProgress(): void {
  if (allVisible) return;
  let overall = 1;
  for (const entry of loadedScenes) {
    const p = entry.visible ? 1 : (sceneProgress.get(entry) ?? 0);
    if (p < overall) overall = p;
  }
  // The single 1 belongs to the last reveal (onSceneRevealed).
  if (overall >= 1 || overall <= reportedLoadProgress) return;
  reportedLoadProgress = overall;
  options.onLoadProgress?.(overall);
}

function onSceneRevealed(): void {
  if (allVisible) return;
  // A refused scene never reveals (see the scene loop), exactly like a pin scene
  // whose load failed: the site stays short of all-visible.
  if (scenesRefused > 0 || !loadedScenes.every((entry) => entry.visible)) {
    reportLoadProgress();
    return;
  }
  allVisible = true;
  loading.hide();
  options.onLoadProgress?.(1);
  // The coordinator reveal event is THIS moment: all scenes visible, overlay
  // dropped — not any single scene's first splat. (The pin's per-scene
  // markSceneFirstSplatReady is skipped with A2; ticket 12 restores it.)
  loadTelemetry?.markAllScenesVisible();
  // THE ready moment: the scenes are actually on screen, not merely booted.
  settleReady();
}

const EDITORIAL_MARGIN = 32;
const EDITORIAL_TOP = 72; // clears the nav bar
const EDITORIAL_GAP = 36;
const EDITORIAL_BREAKPOINT = 768;

let containerW = container.clientWidth;
let containerH = container.clientHeight;
let activeEditorialRegionEditor: EditorialRegionEditorInstance | null = null;
// The block the on-canvas screen-rect editor currently targets (P8d) — a
// columns block (edits regions) or a free block (edits the single rect). The
// editor's getColumns reads through this so ONE editor serves every block.
let placementBlock: TextBlock | null = null;
// The world block the AuthorGizmo is attached to, if any (P8d), and in which
// mode — tracked so a billboard change that invalidates rotate can reconcile
// the live gizmo (detach a now-invalid rotate handle), not just grey the UI.
let gizmoBlockId: string | null = null;
let gizmoMode: PlacementMode | null = null;

/** Seed a columns block's regions from the current live layout so activating
 *  the editor produces NO visual jump (matches the two-column / single-column
 *  breakpoint the lane itself uses). */
function seedColumnsFor(block: TextBlock): void {
  // Guard against a zero/degenerate container (hidden tab, or before the first
  // ResizeObserver tick): dividing by it would write Infinity/NaN into the
  // columns, which serialize to null on export and render broken forever.
  if (containerW <= 0 || containerH <= 0) return;
  const usableH = containerH - EDITORIAL_TOP - EDITORIAL_MARGIN;
  const colW = containerW < EDITORIAL_BREAKPOINT
    ? containerW - 2 * EDITORIAL_MARGIN
    : (containerW - 2 * EDITORIAL_MARGIN - EDITORIAL_GAP) / 2;
  // A too-narrow/short container yields negative column dimensions, which
  // serialize to null on export and render broken forever — skip the seed and
  // let the author add regions manually (consult finding E).
  if (colW <= 0 || usableH <= 0) return;
  const rects: ScreenRect[] = containerW < EDITORIAL_BREAKPOINT
    ? [{ x: EDITORIAL_MARGIN, y: EDITORIAL_TOP, width: colW, height: usableH }]
    : [
        { x: EDITORIAL_MARGIN, y: EDITORIAL_TOP, width: colW, height: usableH },
        {
          x: EDITORIAL_MARGIN + colW + EDITORIAL_GAP,
          y: EDITORIAL_TOP,
          width: colW,
          height: usableH,
        },
      ];
  (block.placement as { regions?: ScreenRectNorm[] }).regions = rects.map((rect) => ({
    x: rect.x / containerW,
    y: rect.y / containerH,
    width: rect.width / containerW,
    height: rect.height / containerH,
  }));
}

/** The normalized rects the on-canvas editor edits for the active block: a
 *  columns block's regions array, or a free block's single rect wrapped in a
 *  one-element array (the editor mutates the rect object in place). */
function placementRects(): ScreenRectNorm[] | undefined {
  const block = placementBlock;
  if (!block) return undefined;
  if (block.presentation === "columns") {
    return (block.placement as ColumnsPlacement).regions;
  }
  if (block.presentation === "free") {
    const rect = (block.placement as { rect?: ScreenRectNorm }).rect;
    return rect ? [rect] : undefined;
  }
  return undefined;
}

const containerResizeObserver = new ResizeObserver((entries) => {
  const rect = entries[entries.length - 1]?.contentRect;
  if (rect) {
    containerW = rect.width;
    containerH = rect.height;
    activeEditorialRegionEditor?.refresh();
    // Both chrome rectangles are inset from the container's edges, so every one
    // of them moves with it. This also carries the FIRST real publication: at
    // construction the container usually has no size yet, so the boot-time call
    // reserves nothing and this observer's initial fire supplies the geometry.
    publishEngagementChrome();
  }
});
containerResizeObserver.observe(container);

let obstacleBoxes: THREE.Vector3[][] = [];
function obstacleWorldCorners(box: SiteConfig["obstacles"][number]): THREE.Vector3[] {
  const center = new THREE.Vector3(
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  );
  const half = new THREE.Vector3(
    (box.max[0] - box.min[0]) / 2,
    (box.max[1] - box.min[1]) / 2,
    (box.max[2] - box.min[2]) / 2,
  );
  const rotationDeg = box.rotationDeg ?? [0, 0, 0];
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(rotationDeg[0]),
    THREE.MathUtils.degToRad(rotationDeg[1]),
    THREE.MathUtils.degToRad(rotationDeg[2]),
    "XYZ",
  );
  const corners: THREE.Vector3[] = [];
  for (const x of [-half.x, half.x]) {
    for (const y of [-half.y, half.y]) {
      for (const z of [-half.z, half.z]) {
        corners.push(new THREE.Vector3(x, y, z).applyEuler(euler).add(center));
      }
    }
  }
  return corners;
}

function rebuildObstacleBoxes(): void {
  obstacleBoxes = site.obstacles.map(obstacleWorldCorners);
}
rebuildObstacleBoxes();

// ─── Annotations from site.annotations ────────────────────
// Marker click routes copy into the caption panel.

/** The moment conditions are evaluated against, snapshotted fresh at every
 *  decision (D31). Every leg comes from a single funnel — `setEngagement`,
 *  `setActiveStop`, `sceneMemory.record` — so what a condition tests is exactly
 *  what the runtime is. The memory leg is a snapshot the store replaces rather
 *  than mutates, so a context outlives the moment it describes unchanged. */
function whenContext(): WhenContext {
  return { engagement, stop: activeStopId, memory: sceneMemory.flags };
}

// ─── Camera sequences (D31 ticket 08) ─────────────────────
// The scripted camera move: a resolved flight plan, flown one leg at a time
// through the ONE existing motion funnel (CameraSystem.frameTo) — no second
// animator. The player below is a state machine over frameTo's completion
// callback plus a frame-tick hold timer; it never writes the camera itself.

/** ms per leg of a sequence flight (and the glide home). Deliberately slower
 *  than selection framing's 600ms default: a scripted move is cinematic, a
 *  selection is a response to a click. Not authorable in v1 — no invented
 *  config surface. */
const SEQUENCE_LEG_MS = 1500;

interface SequencePlayerState {
  plan: FlightPlan;
  /** Index of the waypoint currently being flown to or held at. */
  index: number;
  phase: "flying" | "holding" | "returning";
  /** Seconds left at the current waypoint (holding phase only). */
  holdRemaining: number;
  /** Guards stale frameTo callbacks: a redirect bumps the epoch, so the
   *  displaced flight's completion (fired synchronously by the replacing
   *  frameTo) is recognizably not this flight's. */
  epoch: number;
}

let sequencePlayer: SequencePlayerState | null = null;
let sequenceEpoch = 0;

/** The composed still — the pose a `return` terminal glides home to.
 *
 *  NEVER null: seeded right here with the boot pose (CameraRail's constructor
 *  has already set the camera to the first stop's authored composition, or the
 *  default view on a stopless site), so every visit has a home before its first
 *  click. From then on it tracks the last REST: re-captured when a flight
 *  starts from a standstill (which is what lets a visitor's own explore view be
 *  home — D4: their view IS the still), and re-recorded on every dock and on
 *  every flight that completes (a `stay` landing is how the frozen frame
 *  durably becomes a different photograph). Never a pose sampled mid-air, which
 *  nobody composed and nobody was left at. */
let stillPose: CameraState = cameraSystem.getState();

/** The one pose the still must NOT be captured from: where a flight was halted
 *  mid-air (flying or returning) by something other than the visitor — the
 *  visibility backstop, an engagement change, a rail takeover. Null means the
 *  camera's rest is trustworthy.
 *
 *  Cleared when the camera comes to a rest somebody chose: a flight completing,
 *  a hold-halt at its waypoint, docking at a stop, or the visitor seizing the
 *  camera from a live flight. It also clears ITSELF at capture time: if the
 *  camera has moved away from the recorded pose while at rest, only the
 *  visitor can have moved it, and their view is legitimate the instant they own
 *  it (D4). While it stands, `stillPose` keeps the last real composition. */
let invalidRestPose: CameraState | null = null;

/** Same view, within float noise — the test `invalidRestPose` clears itself
 *  by. Generous epsilon: any deliberate visitor gesture moves the camera far
 *  more than this. */
function samePose(a: CameraState, b: CameraState): boolean {
  const EPS = 1e-3;
  // Yaw compares on the circle: getState() normalizes through atan2, so a
  // sub-epsilon move across ±180° reads as ~360° linearly — which would let
  // essentially the same abandoned pose clear its own taint.
  const yawDelta = Math.abs(((a.yaw - b.yaw + 540) % 360) - 180);
  return yawDelta < EPS
    && Math.abs(a.pitch - b.pitch) < EPS
    && Math.abs(a.distance - b.distance) < EPS
    && Math.abs(a.pivot.x - b.pivot.x) < EPS
    && Math.abs(a.pivot.y - b.pivot.y) < EPS
    && Math.abs(a.pivot.z - b.pivot.z) < EPS;
}

/** Start (or redirect onto) a sequence flight. Last-wins on the camera:
 *  a flight already in the air is displaced from wherever it is — never queued,
 *  never cut (the new leg tweens from the current pose by construction). */
function startSequence(effect: CameraSequenceEffect): void {
  const plan = resolveSequence(effect, { stops: site.stops, annotations: site.annotations });
  // Every leg failed to resolve (site mutated under the rule, author mode).
  // A flight that could only glide home is not what anyone authored — skip.
  if (plan === null) return;
  // Read BEFORE the rail is cancelled: mid-travel the camera is somewhere on a
  // path between stops, which is as much a mid-air pose as a flight's is — and
  // cancelMotion would report the rail at rest a line later. `driving`, not
  // `idle`: the rail's mode word stays "scrubbing" until the next arrival even
  // when the camera has long stopped moving, and asking the stale word would
  // wrongly refuse a genuinely resting camera (a parked scrub, or a visitor who
  // switched to explore mid-scrub and orbited to their own view).
  const railAtRest = !cameraRail.driving;
  // The same yielding order selection framing uses, and it must precede the
  // capture: the rail gives up the camera before anything reads or tweens it.
  // ⚠ Cancelling a SETTLE announces arrival synchronously (the rail's own
  // contract), which runs applyStop, which records the current — half-settled —
  // pose as home. Nobody composed that pose, so a cancel-induced dock must not
  // move home: snapshot and restore around the cancel. A real dock still
  // re-homes; only this cancel's side effect is undone.
  const homeBefore = stillPose;
  const taintBefore = invalidRestPose;
  cameraRail.cancelMotion();
  if (!railAtRest) {
    stillPose = homeBefore;
    invalidRestPose = taintBefore;
  }
  // A redirect (a flight already in the air) never re-captures. At a rest, the
  // capture is refused only while the camera still sits EXACTLY where a halted
  // flight abandoned it — once it has moved at rest, only the visitor can have
  // moved it, so the pose is theirs and the taint clears itself (D4).
  if (sequencePlayer === null && railAtRest) {
    const current = cameraSystem.getState();
    if (invalidRestPose === null || !samePose(current, invalidRestPose)) {
      stillPose = current;
      invalidRestPose = null;
    }
  }
  sequenceEpoch += 1;
  sequencePlayer = { plan, index: 0, phase: "flying", holdRemaining: 0, epoch: sequenceEpoch };
  flySequenceLeg();
}

/** Launch the tween for the current waypoint. */
function flySequenceLeg(): void {
  const player = sequencePlayer;
  if (player === null) return;
  const leg = player.plan.waypoints[player.index];
  // A `frame` leg resolves to a pose at ARRIVAL time — framing keeps the
  // current viewing angle, which only exists now.
  const pose = leg.kind === "pose"
    ? leg.pose
    : framingPose(new THREE.Vector3(leg.center[0], leg.center[1], leg.center[2]), leg.radius);
  player.phase = "flying";
  const epoch = player.epoch;
  cameraSystem.frameTo(pose, SEQUENCE_LEG_MS, (arrived) => onSequenceLegComplete(epoch, arrived));
}

function onSequenceLegComplete(epoch: number, arrived: boolean): void {
  const player = sequencePlayer;
  // Stale: the flight this tween belonged to was redirected away from or ended.
  if (player === null || player.epoch !== epoch) return;
  // Not arrived and not superseded means another motion owner cancelled the
  // tween out from under a LIVE flight. Every such owner acts on a visitor's
  // gesture — the pointerdown cancel, a double-click recenter, a selection
  // framing — so the halt pose is one the visitor chose: bless it. This must
  // happen HERE, not in the takeover callback: the pointer path cancels the
  // tween (which lands in this branch and nulls the player) BEFORE the takeover
  // callback runs, so the callback's own seized-a-flight test reads false.
  if (!arrived) {
    haltSequence();
    invalidRestPose = null;
    return;
  }
  if (player.phase === "returning") {
    endSequence();
    return;
  }
  const leg = player.plan.waypoints[player.index];
  if (leg.holdSec > 0) {
    player.phase = "holding";
    player.holdRemaining = leg.holdSec;
    return;
  }
  advanceSequence();
}

/** Move to the next waypoint, or run the terminal clause. */
function advanceSequence(): void {
  const player = sequencePlayer;
  if (player === null) return;
  if (player.index + 1 < player.plan.waypoints.length) {
    player.index += 1;
    flySequenceLeg();
    return;
  }
  if (player.plan.terminal === "return") {
    // Glide home to the composed still — seeded at boot and never null, so a
    // `return` always has a home even when this flight's own capture was
    // refused (started mid-travel, or from a tainted rest).
    player.phase = "returning";
    const epoch = player.epoch;
    cameraSystem.frameTo(stillPose, SEQUENCE_LEG_MS, (arrived) => onSequenceLegComplete(epoch, arrived));
    return;
  }
  // `stay`: the camera rests at the final waypoint. The next flight's capture
  // records this pose as home — which is exactly how "the frozen frame is now
  // a different photograph" sticks, with no extra bookkeeping.
  endSequence();
}

/** Per-frame tick: run the hold timer, and yield to the rail if it took the
 *  camera (a tour scrub mid-flight writes the camera after the tween every
 *  frame — contesting it would fight; the visitor's scroll wins). */
function updateSequence(deltaTime: number): void {
  const player = sequencePlayer;
  if (player === null) return;
  // `driving`, not `!idle`: a stale "scrubbing" mode word (parked scrub, or a
  // scrub abandoned by switching to explore) writes nothing per frame and must
  // not kill every flight for the rest of the visit.
  if (cameraRail.driving) {
    haltSequence();
    return;
  }
  if (player.phase !== "holding") return;
  player.holdRemaining -= deltaTime;
  if (player.holdRemaining <= 0) advanceSequence();
}

/** The flight completed on its own terms: settled home on a `return`, or at the
 *  last waypoint on a `stay`. Either way the camera now RESTS at a pose someone
 *  composed, so it is RECORDED as the still immediately — not left for the next
 *  flight's capture, which can be refused (a scrub between now and then). For a
 *  `return` this re-records the pose it just glided to, a no-op; for a `stay`
 *  it is the write that makes "the frozen frame is now a different photograph"
 *  stick. */
function endSequence(): void {
  sequencePlayer = null;
  stillPose = cameraSystem.getState();
  invalidRestPose = null;
}

/** Halt an in-flight sequence WHERE IT IS — engagement changed, the scene left
 *  view, another owner took the camera, or teardown. No glide home: an aborted
 *  flight has no terms to complete on. */
function haltSequence(): void {
  const player = sequencePlayer;
  if (player === null) return;
  // Halted while flying or gliding home, the camera stops MID-AIR. That pose is
  // not the composed still and must never become it — record it as the tainted
  // rest, which stands until the camera visibly moves away from it or comes to
  // a rest somebody chose. Halted while holding, the camera rests at the
  // waypoint it was given, which is a pose an author chose — UNLESS the rail is
  // the reason for the halt, in which case the rail has already moved the
  // camera off that waypoint (it writes the camera earlier in the same frame),
  // and mid-travel is as much a non-rest as mid-air is.
  if (player.phase === "holding" && !cameraRail.driving) {
    stillPose = cameraSystem.getState();
    invalidRestPose = null;
  } else {
    invalidRestPose = cameraSystem.getState();
  }
  sequencePlayer = null;
  // Stop a leg still tweening. Its callback fires (false) and exits at the
  // null-player guard above — no recursion.
  cameraSystem.cancelFrameTo();
}

/** The visitor grabbed the camera. `frameTo`'s completion callback already
 *  covers a leg in the air, but a flight HOLDING at a waypoint has no tween to
 *  report — without this the timer would expire and fly on from under a visitor
 *  who had already taken the controls. Reported by the one place that qualifies
 *  camera input, so there is still a single motion funnel. */
cameraSystem.setUserTakeoverCallback(() => {
  // A press only launders a pose when it actually seized a live flight: the
  // visitor deliberately stopped the camera there, so where it halted is theirs
  // (D4). A bare tap on a scene whose flight was already halted mid-air by the
  // backstop changes nothing — the camera did not move, nobody composed, and
  // the tainted rest stands until a real gesture moves the camera off it (the
  // capture-time self-clear above).
  const seizedFlight = sequencePlayer !== null;
  haltSequence();
  if (seizedFlight) invalidRestPose = null;
});

/** Execute a matched rule's effects (D31 live markers).
 *  `show-blocks`: the display channel shows the referenced blocks directly,
 *  recorded as a claim owned by this annotation (ticket 17). Whether it removes
 *  ANOTHER annotation's content is the author's `takeover` setting, resolved
 *  here per effect. Showing blocks never changes engagement, and never changes
 *  selection.
 *  `set-flag`: routed through the memory funnel like every other write, so the
 *  effect cannot be a path that changes state unannounced. */
function runRuleEffects(
  effects: readonly RuleEffect[],
  annotationId: string,
  /** The snapshot the rule was RESOLVED against, threaded through so a `custom`
   *  handler and the conditions that let it run can never disagree about what
   *  was true. Deliberately not re-read per effect: effects on different
   *  channels are concurrent by model, so a memory read that depended on which
   *  effect ran first would contradict it. */
  context: WhenContext,
): void {
  for (const effect of effects) {
    switch (effect.kind) {
      case "show-blocks": {
        // Read at USE TIME, never hoisted: the author panel mutates this same
        // `site` object, so a value captured at construction would make the
        // author's switch look dead until a page reload.
        const takeover = effect.takeover ?? site.settings?.blocks?.takeover ?? true;
        // The toggle moved off selection and into the channel (ticket 13): a
        // re-activation is a live claim by this owner with these ids, and only
        // a claim under `until: "re-activation"` closes on it — so the default
        // blurb and a rule-authored effect behave identically by construction.
        //
        // The lifetime context is read FRESH here, not from the resolution
        // snapshot: the `visited:<id>` record lands before any effect runs,
        // and a `set-flag` earlier in this same rule has already gone through
        // the memory funnel — a stay-while condition must see both, or
        // `while: { flag: … }` beside the set-flag that establishes it would
        // refuse to show with no later context change to correct it. The
        // snapshot keeps its job for rule RESOLUTION and custom handlers.
        applyDisplayChannel(showBlocks(
          displayChannel,
          annotationId,
          effect.blocks,
          blockExists,
          { takeover, lifetime: effect.lifetime, context: whenContext() },
        ));
        break;
      }
      case "set-flag":
        sceneMemory.record(effect.flag);
        break;
      case "play-audio": {
        const sound = site.audio?.find((candidate) => candidate.id === effect.audio);
        // Pre-flight refuses an unknown id at load. If one somehow arrives here
        // it is DROPPED, not thrown on — throwing would kill the activation and
        // take the rest of the rule's effects with it, exactly as the blocks
        // channel reasons about a dangling block id.
        if (sound === undefined) break;
        const next = playAudio(audioChannel, sound.id);
        // Identity means this sound is already playing: a repeat activation.
        // Restarting it would be the audio equivalent of restarting a fade —
        // and the channel is freed when playback ends, so a finished sound is a
        // real change again and replays from the top.
        if (next === audioChannel) break;
        audioChannel = next;
        audioPlayer.play(sound.id, sound.url, sound.volume ?? 1);
        break;
      }
      case "camera-sequence":
        // Occupies the camera channel, and only that: a text popup or a sound
        // in the same rule (or a later one) runs beside the flight, and a
        // second sequence displaces it mid-air (last-wins, story 11).
        startSequence(effect);
        break;
      case "engage":
      case "allow":
      case "deny": {
        // Progressive freedom (ticket 09). One transition decides both halves —
        // what is offered afterwards, and where the visitor must be — so the
        // "granting mode X" and "entering mode X" halves of an `engage` can
        // never be applied out of order, and a `deny` of the visitor's current
        // mode always lands them at the frozen frame.
        const before = offeredModeSet;
        const transition = applyModeEffect(modeState(), effect);
        offeredModeSet = transition.offered;
        // Identity means nothing changed. Refresh FIRST when it did: the offered
        // set is what the mode row greys from and what decides whether there is
        // a switch at all, and `setEngagement` below no-ops when the effect only
        // widened or narrowed the offer without moving anyone.
        if (offeredModeSet !== before) refreshEngagementChrome();
        // The one funnel owns everything a state change implies — input
        // switches, presence re-resolution, the host announcement — and guards
        // itself if unchanged. The mode was granted above, so its own lock check
        // passes.
        setEngagement(transition.engagement);
        break;
      }
      case "custom":
        // The escape hatch occupies no channel, so it neither displaces nor is
        // displaced by anything — see `channelsOf`.
        try {
          if (runtimeHandle === null) {
            throw new Error("the runtime is not finished building — effects cannot run before it exists");
          }
          ruleHandlers.dispatch(effect.handler, { annotationId, context, runtime: runtimeHandle });
        } catch (error) {
          // Caught so one broken handler cannot swallow the rest of the rule's
          // effects — but never silenced. The message distinguishes the two
          // cases: "no handler registered" is the author's wiring, anything else
          // is the site developer's own stack.
          console.error(`[splat-site] custom effect "${effect.handler}" failed`, error);
        }
        break;
      default: {
        // Exhaustiveness, the impure half. `EFFECT_KINDS` forces a new effect
        // kind to DECLARE itself (channels + pre-flight); this forces it to DO
        // something. Without it a new kind would validate, load, and then
        // quietly do nothing when a visitor clicked — the worst failure
        // available, because it looks exactly like an unauthored marker.
        // Logged rather than thrown: an unreachable branch must not be the one
        // that kills an activation and takes the rest of the rule with it.
        const unhandled: never = effect;
        console.error("[splat-site] no behavior for effect kind", unhandled);
        break;
      }
    }
  }
}

const annotations = new Annotations({
  container,
  camera: sparkScene.camera,
  scene: sparkScene.scene,
  showIds: authorMode,
  // Marker click runs the annotation's rules and selects it (ticket 17: what a
  // marker shows comes from its rules alone — binding a block to a marker is
  // retired, and the conversion at load gives every marker with copy the rule
  // that shows it).
  onSelect: (item) => {
    // visible = live (D31 floor): every visible marker responds to activation in
    // EVERY engagement state — frozen, tour, or explore alike. The D9
    // switch-pulse is now bare-canvas only (`onEngagementCanvasClick`); a marker
    // click never pulses. Showing content is not an engagement act — the scene
    // stays where it is unless an authored effect (ticket 09) engages it.
    const annotation = site.annotations.find((candidate) => candidate.id === item.id);
    // Read BEFORE anything runs. Selection's OWN toggle only — the content
    // toggle moved onto the channel's claims (ticket 13), where it keys on the
    // shown content being live rather than on the marker being selected, so a
    // blurb that survived travel (which clears selection) still closes on the
    // next activation.
    const isReactivation = textSystem.activeAnnotation === item.id;
    // Snapshotted ONCE and kept: the resolver matches against it, and a `custom`
    // handler is handed the same object, so what let a rule fire and what the
    // handler sees are the same moment by construction.
    const context = whenContext();
    const rule = resolveRule({ trigger: "activate", ...context }, annotation?.rules ?? []);
    // Scene memory (D31): every activation records `visited:<id>` — the visitor's
    // history is a fact about clicking, not a reward for matching a rule, so an
    // unruled marker records too. AFTER the resolution above, which is what lets
    // a marker answer its own first click differently from every later one (a
    // `visited` rule on itself misses once, then matches). Recording before the
    // effects run means an effect acts on truthful memory.
    sceneMemory.record(visitedFlag(item.id));
    // Effects FIRST, then selection (ticket 17/I1, corrected). Selection is no
    // longer the no-match branch's private business: after the conversion nearly
    // every marker carries a matching rule, and selection is what drives media
    // visibility and the host's `selectionchanged` — both would die repo-wide if
    // it stayed inside the else.
    //
    // The ORDER is load-bearing in both directions. Selecting first would let an
    // `engage`/`deny` effect reach `setEngagement` → `refreshAnnotationPresence`
    // → the orphan clear below, announcing `{ id: null }` immediately after
    // `{ id: X }` — two events for one click. Selecting after, unguarded, would
    // strand a selection on a marker whose element the effects just removed,
    // which is precisely the state `goToObject` refuses. Hence: after, and only
    // if the marker is still there.
    if (rule !== NO_MATCH) {
      runRuleEffects(rule.do, item.id, context);
    } else {
      // The copy floor (ticket 13): no rule matched, so the marker's default
      // behavior is its copy, floating at the marker. Only NO_MATCH lands
      // here — a matched rule never falls through to the floor, even one that
      // shows nothing (a play-audio-only marker stays a play-audio-only
      // marker).
      showConjuredCopy(item.id);
    }
    if (presentAnnotationIds.has(item.id)) {
      setSelection(isReactivation ? null : item.id);
    }
    // A marker activation is a hotspot click in every state now that frozen
    // markers are live — notify the host uniformly (was engaged-only when frozen
    // markers were inert).
    options.onHotspotClick?.({ id: item.id });
  },
});

const splatHighlight = new SplatHighlight({
  scene: sparkScene.scene,
  camera: sparkScene.camera,
  canvas: sparkScene.canvas,
});

/** The annotations whose presence condition holds right now (D31). An
 *  annotation with no `presence` clause is always here; one whose clause fails
 *  is not built at all — no element, so nothing renders, nothing is tabbable,
 *  and nothing can be activated. Inertness is authored as absence, never as a
 *  dead visible marker. */
function presentAnnotations(): SiteAnnotation[] {
  const context = whenContext();
  return site.annotations.filter((annotation) => matchesWhen(annotation.presence, context));
}

/** Ids currently built as markers. The orphan check reads it, and `goToObject`
 *  consults it to refuse an annotation that has no marker right now. */
let presentAnnotationIds = new Set<string>();

/** The context the current marker set was resolved from. Presence is a pure
 *  function of the context, so an unchanged context cannot change the set —
 *  which is what lets `refreshAnnotationPresence` skip the scan. */
let presenceContext: WhenContext | null = null;

/** Rebuild the marker set from the current presence resolution. Cheap to repeat:
 *  `Annotations.setItems` reconciles by id, so an unchanged annotation keeps its
 *  element (and the visitor's focus with it). Author edits land here directly,
 *  because there the annotation LIST changed rather than the context. */
function rebuildAnnotations(present: SiteAnnotation[] = presentAnnotations()): void {
  presenceContext = whenContext();
  presentAnnotationIds = new Set(present.map((annotation) => annotation.id));
  annotations.setItems(present);
  splatHighlight.setItems(present);
  if (present.length > 0) {
    // Inert until Phase 3 (doc 06 D27; ticket 09 Stop 2): announced once, to authors.
    authorNote(
      "highlight",
      "marker hover glow is absent — SplatHighlight is an inert stub until Phase 3 rebuilds it on the edit layer (doc 06 D27)",
    );
  }
  // An absent marker leaves no panel behind: a selection whose annotation just
  // stopped existing would otherwise strand its copy on screen with nothing to
  // dismiss it. Routed through setSelection so the host still hears about it.
  if (textSystem.activeAnnotation !== null && !presentAnnotationIds.has(textSystem.activeAnnotation)) {
    setSelection(null);
  }
}

/** Re-resolve presence after an engagement or docked-stop change.
 *
 *  Guarded on the CONTEXT, not on the resulting set: `setActiveStop` has no
 *  same-value guard of its own and rail departure fires it on every frame of a
 *  flight, so an unguarded refresh would re-filter the annotation list once per
 *  frame for the whole flight.
 *
 *  The memory leg compares by IDENTITY, which is exact rather than approximate:
 *  `SceneMemory` replaces its snapshot on every real change and keeps the same
 *  one otherwise, so a differing reference means the store really differs. */
function refreshAnnotationPresence(): void {
  const context = whenContext();
  if (
    presenceContext !== null
    && presenceContext.engagement === context.engagement
    && presenceContext.stop === context.stop
    && presenceContext.memory === context.memory
  ) {
    return;
  }
  rebuildAnnotations();
}

rebuildAnnotations();

// ─── Locative headline + scene modulation (Phase 4) ───────
// Presets via ?place=name (no permission involved), CTA-gated precise
// mode via GeoContext.requestPrecise. The headline height is
// Pretext-measured so "Oslo" vs "Reykjavík" never shifts layout, and
// scene modulation (background + splat recolor) is inline site code
// against verified knobs, per plan ADR-4 — not a toolkit module.

const HEADLINE_FONT = `600 22px ${DEFAULT_FONT_STACK}`;
const HEADLINE_LINE = 28;
const HEADLINE_WIDTH = 360;

const PLACE_THEMES: Record<string, { background: string; tint: string }> = {
  omaha: { background: "#0c0c10", tint: "#ffffff" },
  tokyo: { background: "#120d18", tint: "#f0e6ff" },
  oslo: { background: "#0a0f16", tint: "#e3eeff" },
  reykjavik: { background: "#0a1214", tint: "#e2f7fb" },
};

const geo = new GeoContext();

const headlineWrap = document.createElement("div");
Object.assign(headlineWrap.style, {
  position: "absolute",
  top: "10px",
  // Clear of the author panel when both are open
  left: authorMode ? "330px" : "16px",
  zIndex: "740",
  color: "#fff",
  textShadow: "0 1px 6px rgba(0, 0, 0, 0.9)",
  pointerEvents: "none",
  maxWidth: `${HEADLINE_WIDTH}px`,
});
const headlineEl = document.createElement("div");
Object.assign(headlineEl.style, {
  font: HEADLINE_FONT,
  lineHeight: `${HEADLINE_LINE}px`,
  overflowWrap: "break-word",
});
const ctaBtn = document.createElement("button");
ctaBtn.type = "button";
ctaBtn.textContent = "See this page tuned to where you are";
Object.assign(ctaBtn.style, {
  marginTop: "4px",
  padding: "0",
  border: "none",
  background: "none",
  color: "rgba(255, 255, 255, 0.65)",
  font: `13px ${DEFAULT_FONT_STACK}`,
  textDecoration: "underline",
  cursor: "pointer",
  pointerEvents: "auto",
});
ctaBtn.addEventListener("click", () => {
  geo
    .requestPrecise()
    .then((place) => {
      console.log(`[locative] granted: tier=${place.tier} accuracy=${place.accuracy}m`);
    })
    .catch((err: Error) => {
      // Denial must not change the page — log for devs, nothing else
      console.debug(`[locative] precise declined: ${err.message}`);
    });
});
headlineWrap.appendChild(headlineEl);
headlineWrap.appendChild(ctaBtn);
container.appendChild(headlineWrap);

function headlineText(place: PlaceInfo): string {
  if (place.city) return `Somewhere near ${place.city}`;
  if (place.source === "gps") return "Somewhere near you";
  return "Somewhere on Earth";
}

function applyLocative(place: PlaceInfo): void {
  const activeScene = site.scenes[0];
  const distanceM = place.lat !== undefined
    && place.lon !== undefined
    && activeScene?.geoAnchor !== undefined
    ? bearingDistance(activeScene.geoAnchor, { lat: place.lat, lon: place.lon }).meters
    : undefined;
  textSystem.setPlace(
    place.presetName,
    place.source === "preset"
      ? "preset"
      : place.tier === "precise"
        ? "precise"
        : undefined,
    distanceM,
  );
  const text = headlineText(place);
  headlineEl.textContent = text;
  headlineEl.style.height = `${measureTextHeight(text, HEADLINE_FONT, HEADLINE_WIDTH, HEADLINE_LINE)}px`;
  const theme =
    (place.presetName && PLACE_THEMES[place.presetName]) || {
      background: settings.background ?? "#0c0c10",
      tint: "#ffffff",
    };
  sparkScene.scene.background = new THREE.Color(theme.background);
  // Splat recolor arrives in Phase 4 (backend.setMeshColor refuses until then).
  // White is a no-op by value and skips silently; any other tint is announced
  // once, to authors (ticket 09 Stop 8, R1; doc 06 D29).
  if (new THREE.Color(theme.tint).getHex() !== 0xffffff) {
    authorNote(
      "tint",
      `locative tint ${theme.tint} is not applied to the splats — recolor arrives in Phase 4; the background still changes`,
    );
  }
  // Once a GPS-derived place is active, the invitation has been answered
  ctaBtn.style.display = place.source === "gps" ? "none" : "";
}

geo.onChange(applyLocative);
void whenFontsReady(HEADLINE_FONT).then(
  () => {
    // Font readiness can resolve AFTER disconnect — applyLocative would then write
    // to a disposed text system / splat meshes (consult: async-after-disposal).
    if (disposed) return;
    geo.applyUrlOverride();
    applyLocative(geo.place);
  },
  () => {
    // A font that never loads must not surface as an unhandled rejection.
    // Narrowed to the font promise (ticket 09 Stop 8, K2; doc 06 D29): the pin's
    // catch-all also swallowed any throw from applyLocative — exactly the
    // mechanism that would have swallowed the tint loss.
  },
);

// ─── Caption boot ─────────────────────────────────────────

setActiveStop(site.stops[0]?.id ?? null);
// Boot is DISENGAGED (Plan 25 §12): the page owns wheel, touch and keys until the
// visitor engages, so the disengaged row is applied here explicitly rather than
// leaving travel/orbit/zoom enabled from construction. The first stop's `explore`
// policy is NOT applied at boot any more — it lands on the transition into tour
// (setEngagement → applyExplorePolicy), which is also the only state it means
// anything in.
applySwitches("disengaged");

// ─── Frame loop ───────────────────────────────────────────

sparkScene.setOnFrame((_time, deltaTime) => {
  cameraSystem.update(deltaTime);
  cameraRail.update(deltaTime);
  // AFTER both movers: the hold timer and the rail-yield check read what this
  // frame actually did to the camera, not what last frame did.
  updateSequence(deltaTime);
  // Text reads rail progress and the camera pose — it must run AFTER both move,
  // or every progress-driven style and billboard lags the camera by one frame.
  textSystem.setProgress(cameraRail.progress);
  refreshMediaVisibility(cameraRail.progress);
  textSystem.update(_time, deltaTime);
  mediaLayer.tick(sparkScene.camera);
  annotations.update();
  splatHighlight.update();
  if (scrollRail) {
    scrollRail.update(deltaTime);
    edgeFill.style.height = `${(cameraRail.progress * 100).toFixed(1)}%`;
  }
  loadTelemetry?.tick();
});

// ─── Docked-idle render throttle wiring (Plan 24 Task 7) ──
// The gate runs INSIDE ThreeSplatScene.animate (SparkScene's contract, carried —
// ticket 09 Stop 4f) after the state callbacks above, so a
// skipped frame still decays the leave accumulator and runs orbit damping.

let lastInputAt = performance.now();
let lastThrottledRenderAt = 0;
const noteInput = (): void => {
  lastInputAt = performance.now();
};
/** Reset targets for the DOM half of THROTTLE_RESET_EVENTS ("navigate" is the
 *  programmatic half, called below). Window-level capture: inputs anywhere on
 *  the page — including the host prose — mean the visitor is active. */
const throttleDomEvents = THROTTLE_RESET_EVENTS.filter((e) => e !== "navigate");
for (const eventName of throttleDomEvents) {
  window.addEventListener(eventName, noteInput, { capture: true, passive: true });
}
/** Programmatic navigation counts as input — commands resume full rate. */
function noteNavigate(): void {
  noteInput();
}

/** True while any paged scene may still be refining. The docked-idle render
 *  throttle MUST NOT engage then: refinement advances only on RENDERED frames
 *  (this backend's LOD driver runs in the paged mesh's pre-render hook, as
 *  Spark's driveLod did), so a throttled frame skips it. The throttle's
 *  `allVisible` condition flips at REVEAL, not at load-complete, and a passive
 *  viewer is already >15s idle by reveal, so without this guard the whole
 *  post-reveal detail tail crawls at 10fps (the pin's own documented bug).
 *  Re-typed (ticket 09 Stop 4f, T1; doc 06 D29): the pin read resident < wanted
 *  from Spark pager internals; here the seam's completed-work fraction stands
 *  in — a paged scene counts as refining until its fraction reaches 1. More
 *  conservative: under a constrained page budget the fraction never reaches 1,
 *  so a capped site never throttles. */
function lodStillRefining(): boolean {
  for (const entry of loadedScenes) {
    if (!entry.paged) continue;
    if (splatBackend.progress(entry.handle).fraction < 1) return true;
  }
  return false;
}

sparkScene.throttleGate = (timeMs) => {
  const decision = throttleDecision({
    docked: scrollRail ? scrollRail.state === "docked" : true,
    railIdle: cameraRail.idle,
    allVisible,
    authorMode,
    idleMs: performance.now() - lastInputAt,
  });
  if (!decision.throttled) return false;
  // Never throttle while the scene is still resolving detail — the throttle
  // would starve driveLod and freeze the coarse tail at 10fps (runs only on the
  // frames the throttle would otherwise skip, so it's free on normal frames).
  if (lodStillRefining()) return false;
  // Throttled ≠ frozen: render at IDLE_THROTTLE_FPS, skip the frames between.
  if (timeMs - lastThrottledRenderAt >= 1000 / IDLE_THROTTLE_FPS) {
    lastThrottledRenderAt = timeMs;
    return false;
  }
  return true;
};

// ─── Author mode (?author=1) ──────────────────────────────
// One-shot world-point picking: crosshair cursor, next non-drag click
// raycasts the scene (works on the paged hero via Spark's WASM
// raycast). Near-camera fuzz (< 0.5 units) is skipped when a farther
// hit exists.

let pickResolve: ((p: [number, number, number] | null) => void) | null = null;
let pickDownPos: { x: number; y: number } | null = null;

function pickPoint(): Promise<[number, number, number] | null> {
  pickResolve?.(null);
  // Splats answer no picks until Phase 3 §B (ticket 09 Stop 7, doc 06 D31): the
  // stock raycast only ever hit a template quad at the mesh's origin, so the
  // backend refuses it. Props, world text and other real geometry still answer.
  authorNote(
    "picking",
    "clicking the splat surface cannot place a point — splat picking arrives in Phase 3 §B; props and world text still answer picks",
  );
  sparkScene.canvas.style.cursor = "crosshair";
  return new Promise((resolve) => {
    pickResolve = resolve;
  });
}

const onPickPointerDown = (e: PointerEvent): void => {
  if (pickResolve) pickDownPos = { x: e.clientX, y: e.clientY };
};
const onPickPointerUp = (e: PointerEvent): void => {
  if (!pickResolve || !pickDownPos) return;
  const dragged =
    Math.hypot(e.clientX - pickDownPos.x, e.clientY - pickDownPos.y) > 5;
  pickDownPos = null;
  if (dragged) return; // orbit drag — keep waiting for a clean click
  const rect = sparkScene.canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, sparkScene.camera);
  const hits = raycaster.intersectObjects(sparkScene.scene.children, true);
  const hit = hits.find((h) => h.distance > NEAR_PICK_FUZZ) ?? hits[0];
  const resolve = pickResolve;
  pickResolve = null;
  sparkScene.canvas.style.cursor = "";
  resolve(hit ? [hit.point.x, hit.point.y, hit.point.z] : null);
};
sparkScene.canvas.addEventListener("pointerdown", onPickPointerDown);
sparkScene.canvas.addEventListener("pointerup", onPickPointerUp);

// Obstacle helpers — visible while authoring
let obstacleHelpers: LineSegments2[] = [];
let authorGizmo: AuthorGizmoInstance | null = null;
function disposeObstacleHelper(helper: LineSegments2): void {
  sparkScene.scene.remove(helper);
  helper.geometry.dispose();
  const material = helper.material;
  if (Array.isArray(material)) material.forEach((item) => item.dispose());
  else material.dispose();
}

// LineSegments2 (not LineSegments): WebGL caps LineBasicMaterial.linewidth at 1px,
// so the authored per-box `lineWidth` needs the expanded-triangle lines. On this
// renderer that is three's WebGPU pair (Line2NodeMaterial), which takes the same
// parameters and sizes itself from the renderer's viewport, so no resize plumbing
// is needed here either (ticket 09 Stop 15).
function rebuildObstacleHelpers(): void {
  for (const helper of obstacleHelpers) disposeObstacleHelper(helper);
  obstacleHelpers = site.obstacles.map((box) => {
    const center = new THREE.Vector3(
      (box.min[0] + box.max[0]) / 2,
      (box.min[1] + box.max[1]) / 2,
      (box.min[2] + box.max[2]) / 2,
    );
    const size = new THREE.Vector3(
      box.max[0] - box.min[0],
      box.max[1] - box.min[1],
      box.max[2] - box.min[2],
    );
    // Unit-box edges → LineSegmentsGeometry; both temporaries are ours to dispose.
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const edges = new THREE.EdgesGeometry(unitBox);
    const geometry = new LineSegmentsGeometry().fromEdgesGeometry(edges);
    unitBox.dispose();
    edges.dispose();
    const helper = new LineSegments2(geometry, new Line2NodeMaterial({
      color: new THREE.Color(box.color ?? "#4ade80").getHex(),
      linewidth: box.lineWidth ?? 1,
      worldUnits: false,
    }));
    // Never intercept scene picks: LineSegments2 raycasts generously in screen
    // space (linewidth-aware), so a thick helper would steal pickPoint/recenter
    // clicks from the splat surface behind it.
    helper.raycast = () => {};
    const rotationDeg = box.rotationDeg ?? [0, 0, 0];
    helper.position.copy(center);
    helper.scale.copy(size);
    helper.rotation.set(
      THREE.MathUtils.degToRad(rotationDeg[0]),
      THREE.MathUtils.degToRad(rotationDeg[1]),
      THREE.MathUtils.degToRad(rotationDeg[2]),
      "XYZ",
    );
    sparkScene.scene.add(helper);
    return helper;
  });
}

// Cheap per-drag-tick patch: rewrite one existing helper's transform from its box
// (no geometry recreation) — matches exactly what rebuildObstacleHelpers produces
// for that box. Used by the obstacle gizmo's live change so a drag doesn't
// dispose+recreate every LineSegments per frame.
function updateObstacleHelper(index: number): void {
  const helper = obstacleHelpers[index];
  const box = site.obstacles[index];
  if (!helper || !box) return;
  helper.position.set(
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  );
  helper.scale.set(
    box.max[0] - box.min[0],
    box.max[1] - box.min[1],
    box.max[2] - box.min[2],
  );
  const rotationDeg = box.rotationDeg ?? [0, 0, 0];
  helper.rotation.set(
    THREE.MathUtils.degToRad(rotationDeg[0]),
    THREE.MathUtils.degToRad(rotationDeg[1]),
    THREE.MathUtils.degToRad(rotationDeg[2]),
    "XYZ",
  );
}

function makeObstacleTarget(box: SiteConfig["obstacles"][number]): AuthorGizmoTarget {
  const center = (): [number, number, number] => [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
  const size = (): [number, number, number] => [
    Math.max(box.max[0] - box.min[0], 0.05),
    Math.max(box.max[1] - box.min[1], 0.05),
    Math.max(box.max[2] - box.min[2], 0.05),
  ];
  const setFromCenterAndSize = (
    nextCenter: [number, number, number],
    nextSize: [number, number, number],
  ) => {
    box.min = [
      nextCenter[0] - nextSize[0] / 2,
      nextCenter[1] - nextSize[1] / 2,
      nextCenter[2] - nextSize[2] / 2,
    ];
    box.max = [
      nextCenter[0] + nextSize[0] / 2,
      nextCenter[1] + nextSize[1] / 2,
      nextCenter[2] + nextSize[2] / 2,
    ];
  };

  return {
    modes: ["translate", "scale", "rotate"],
    getPosition: center,
    setPosition: (position) => setFromCenterAndSize(position, size()),
    getScale: size,
    setScale: (scale) =>
      setFromCenterAndSize(center(), [
        Math.max(scale[0], 0.05),
        Math.max(scale[1], 0.05),
        Math.max(scale[2], 0.05),
      ]),
    getRotationDeg: () => box.rotationDeg ?? [0, 0, 0],
    setRotationDeg: (rotationDeg) => setCleanRotationDeg(box, rotationDeg),
    onLiveChange: () => {
      // A structural obstacle edit (add/delete/reorder) enqueues a DEFERRED
      // "obstacles" rebuild; until it flushes, the parallel helper/corner arrays
      // are stale vs site.obstacles, so an index from indexOf would patch the
      // wrong entry. Reconcile that pending rebuild now to realign, then patch.
      if (pendingPanelKinds.has("obstacles")) {
        pendingPanelKinds.delete("obstacles");
        rebuildObstacleHelpers();
        rebuildObstacleBoxes();
      }
      // Resolve the box's live index by identity — it may have been deleted or
      // reordered while the gizmo was attached. Patch BOTH the visual helper AND
      // the avoidance rects, so text stops avoiding the stale box.
      const i = site.obstacles.indexOf(box);
      if (i < 0) return;
      updateObstacleHelper(i);
      obstacleBoxes[i] = obstacleWorldCorners(box);
    },
    // Commit lands one authoritative, coalesced full rebuild next frame.
    onCommit: () => enqueuePanelChange("obstacles"),
  };
}

function makeSplatTextTarget(
  block: TextBlock,
  onCommit: () => void,
): AuthorGizmoTarget {
  const liveObject = () =>
    textSystem.getBlockSurface(block.id) as THREE.Object3D | null;
  const placement = block.placement as WorldPlacement;
  const modes: Array<"translate" | "scale" | "rotate"> = ["translate", "scale"];
  if (placement.billboard === "none") modes.push("rotate");

  return {
    modes,
    getPosition: () => placement.position,
    setPosition: (position) => {
      placement.position = position;
      liveObject()?.position.set(...position);
    },
    getScale: () => {
      const object = liveObject();
      return object ? [object.scale.x, object.scale.y, object.scale.z] : [1, 1, 1];
    },
    setScale: (scale) => {
      const object = liveObject();
      if (!object) return;
      object.scale.setScalar(uniformScaleFromVector(scale, object.scale.x));
    },
    getRotationDeg: () => placement.rotationDeg ?? [0, 0, 0],
    setRotationDeg: (rotationDeg) => {
      if (placement.billboard !== "none") return;
      setCleanRotationDeg(placement, rotationDeg);
      const object = liveObject();
      if (object) setObjectRotationDeg(object, placement.rotationDeg);
    },
    onCommit: () => {
      const object = liveObject();
      if (object) {
        const factor = object.scale.x;
        placement.worldPerPx *= factor;
        object.scale.setScalar(1);
      }
      onCommit();
    },
  };
}

function makePropTarget(prop: NonNullable<SiteConfig["scenes"][number]["props"]>[number]): AuthorGizmoTarget {
  const liveObject = () => propLayer.getObject(prop.id);

  return {
    modes: ["translate", "scale", "rotate"],
    getPosition: () => prop.position,
    setPosition: (position) => {
      prop.position = position;
      const object = liveObject();
      object?.position.set(...position);
      object?.updateMatrixWorld(true);
    },
    getScale: () => {
      const scale = prop.scale ?? 1;
      return [scale, scale, scale];
    },
    setScale: (scale) => {
      prop.scale = uniformScaleFromVector(scale, prop.scale ?? 1);
      const object = liveObject();
      object?.scale.setScalar(prop.scale);
      object?.updateMatrixWorld(true);
    },
    getRotationDeg: () => prop.rotationDeg ?? [0, 0, 0],
    setRotationDeg: (rotationDeg) => {
      prop.rotationDeg = rotationDeg.map(roundRotationDeg) as [number, number, number];
      const object = liveObject();
      if (object) {
        setObjectRotationDeg(object, prop.rotationDeg);
        object.updateMatrixWorld(true);
      }
    },
    // A committed drag must land an authoritative coalesced reconcile — the
    // setters move the live object directly, so without this the config and the
    // reconciler's desired-state (Plan 13) could drift on a subsequent setProps.
    onCommit: () => enqueuePanelChange("props"),
  };
}

// ─── Selection framing (Plan 14 DD3/DD4) ──────────────────
// The SINGLE entry point for selection-driven camera motion: bounds framing
// cancels any rail motion first (the rail writes setState per frame AFTER
// CameraSystem updates — an un-arbitrated tween would silently lose), stops
// travel through the rail itself.

/** World bounding sphere of an object. SplatMesh has no BufferGeometry, so
 *  Box3.setFromObject misses splat extents — sample them via computeSplatBounds
 *  and union with any real-geometry descendants. Null when nothing measurable. */
function sphereFromObject(object: THREE.Object3D): { center: THREE.Vector3; radius: number } | null {
  const bounds = new THREE.Box3().setFromObject(object);
  object.traverse((child) => {
    // Duck-typed SplatMesh (value import would pull Spark into the graph here).
    if ((child as unknown as { isSplatMesh?: boolean }).isSplatMesh === true) {
      // The cast is gone with the Spark type: the stub takes an Object3D
      // (doc 06 D30); this branch is unreachable until Phase 4's splat text.
      const splatBounds = computeSplatBounds(child);
      if (splatBounds) bounds.union(splatBounds);
    }
  });
  if (bounds.isEmpty()) return null;
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) return null;
  return { center: sphere.center, radius: sphere.radius };
}

/** The pose that brings a sphere on screen fitting BOTH FoV axes; yaw/pitch
 *  kept from the current view (frame = bring on screen, not reorient). radius 0
 *  keeps the current distance (position-only framing). Shared by selection
 *  framing and by a sequence's `annotation` waypoints — one definition of what
 *  "frame that marker" means. */
function framingPose(center: THREE.Vector3, radius: number): CameraState {
  const current = cameraSystem.getState();
  let distance = current.distance;
  if (radius > 0) {
    const camera = sparkScene.camera;
    const vHalf = THREE.MathUtils.degToRad(camera.fov) / 2;
    const hHalf = Math.atan(Math.tan(vHalf) * Math.max(camera.aspect, 0.01));
    distance = (radius / Math.sin(Math.min(vHalf, hHalf))) * 1.2;
  }
  return {
    yaw: current.yaw,
    pitch: current.pitch,
    distance,
    pivot: { x: center.x, y: center.y, z: center.z },
  };
}

/** Tween to `framingPose` (selection framing). */
function frameSphere(center: THREE.Vector3, radius: number): void {
  cameraRail.cancelMotion();
  cameraSystem.frameTo(framingPose(center, radius));
}

function frameEntity(target: FrameTarget): void {
  if (disposed) return;
  // Selection framing takes the camera channel outright — a sequence HOLDING at
  // a waypoint has no active tween for cancelFrameTo to report on, so the halt
  // is explicit rather than left to the completion callback.
  haltSequence();
  // Cancel any in-flight bounds tween FIRST — the single arbiter for
  // selection-driven motion. A stop selection that starts rail travel must not
  // leave a prior box tween fighting it every frame (the tween writes the
  // camera before the rail does each update).
  cameraSystem.cancelFrameTo();
  switch (target.kind) {
    case "stop": {
      // Resolve the CURRENT index by id at invocation time — never a captured
      // index (stops reorder). ≥2 stops → real rail travel (optics blend + text
      // binding). Single stop → goToStop is a guarded no-op, so frame the
      // authored camera directly and apply its optics.
      const index = site.stops.findIndex((stop) => stop.id === target.id);
      if (index < 0) return;
      if (site.stops.length >= 2) {
        cameraRail.goToStop(index);
        return;
      }
      cameraRail.cancelMotion();
      cameraSystem.frameTo(site.stops[index].camera);
      applyRailOptics(site.stops[index].optics ?? {});
      return;
    }
    case "box": {
      const box = site.obstacles.find((candidate) => candidate.id === target.id);
      if (!box) return;
      const center = new THREE.Vector3(
        (box.min[0] + box.max[0]) / 2,
        (box.min[1] + box.max[1]) / 2,
        (box.min[2] + box.max[2]) / 2,
      );
      // Half the diagonal — rotation-invariant bounding sphere of the box.
      const radius = 0.5 * Math.hypot(
        box.max[0] - box.min[0],
        box.max[1] - box.min[1],
        box.max[2] - box.min[2],
      );
      frameSphere(center, radius);
      return;
    }
    case "hotspot": {
      const item = site.annotations.find((candidate) => candidate.id === target.id);
      if (!item) return;
      frameSphere(
        new THREE.Vector3(...item.anchor),
        Math.max(item.radius ?? DEFAULT_FRAME_RADIUS, MIN_FRAME_RADIUS),
      );
      return;
    }
    case "prop": {
      const prop = site.scenes
        .flatMap((scene) => scene.props ?? [])
        .find((candidate) => candidate.id === target.id);
      if (!prop) return;
      const object = propLayer.getObject(prop.id);
      const sphere = object ? sphereFromObject(object) : null;
      // Still loading / failed / unmeasurable → frame the authored position
      // at the current distance.
      if (sphere) frameSphere(sphere.center, sphere.radius);
      else frameSphere(new THREE.Vector3(...prop.position), 0);
      return;
    }
    case "block": {
      const block = site.blocks.find((candidate) => candidate.id === target.id);
      if (!block) return;
      if (block.space === "world") {
        // World splat/plane text → frame its 3D bounds.
        const surface = textSystem.getBlockSurface(block.id);
        const sphere = surface && surface instanceof THREE.Object3D
          ? sphereFromObject(surface)
          : null;
        if (sphere) {
          frameSphere(sphere.center, sphere.radius);
          return;
        }
        // Binding inactive at the current stop (no live surface) or an
        // unmeasurable splat surface → the authored placement, distance kept.
        const placement = block.placement as WorldPlacement;
        if (placement?.position) frameSphere(new THREE.Vector3(...placement.position), 0);
        return;
      }
      // Screen text (caption/editorial/panel) has no world position — bring it
      // into its VISIBLE context instead: travel to the stop it is bound to (or
      // frame a bound hotspot). "Always"/range/unbound text shows regardless of
      // camera, so there is nothing to move to.
      const stopId = block.binding?.stops?.[0];
      if (stopId) {
        frameEntity({ kind: "stop", id: stopId });
        return;
      }
      // Sourced from the RULES, not from a binding: after ticket 17 a block is
      // shown by a marker because that marker's rule names it, and reading the
      // retired binding leg here would leave this button silently dead.
      const annotationId = annotationShowing(block.id);
      if (annotationId) {
        frameEntity({ kind: "hotspot", id: annotationId });
      }
      return;
    }
  }
}

const authorReady: Promise<void> = authorMode
  ? Promise.all([
    import("../site/AuthorPanel"),
    import("../site/AuthorGizmo"),
    import("../ui/EditorialRegionEditor"),
  ]).then(async ([{ AuthorPanel }, { AuthorGizmo }, { EditorialRegionEditor }]) => {
    // The dynamic import can resolve after disconnect — never mount onto a
    // torn-down runtime (consult finding: async continuation after disposal).
    if (disposed) return;
    rebuildObstacleHelpers();
    authorGizmo = new AuthorGizmo({
      scene: sparkScene.scene,
      camera: sparkScene.camera,
      domElement: sparkScene.canvas,
      orbitControls: cameraSystem.controls,
    });
    const seedUrl = urlParams.get("seed");
    const seedTransformUrl = urlParams.get("seedTransform");
    let seedWorldTransform: SeedWorldTransform | null = null;
    if (seedTransformUrl) {
      const response = await fetch(seedTransformUrl);
      if (!response.ok) {
        throw new Error(`Failed to load seedTransform: ${response.status} ${response.statusText}`);
      }
      const rawTransform = (await response.json()) as { R_rows: number[][]; t: number[] };
      seedWorldTransform = { R: rawTransform.R_rows, t: rawTransform.t };
    }
    // Re-check AFTER the await: a caller can dispose during the seedTransform
    // fetch, and mounting the panel/editor onto a dead runtime leaks both.
    if (disposed) return;
    const editorialRegionEditor = authorMode
      ? new EditorialRegionEditor({
          container,
          getColumns: placementRects,
          getSize: () => ({ width: containerW, height: containerH }),
          // A free block is a single rect, not a numbered column — badge it as an
          // anchor box rather than "1" (D12); columns keep their 1-based number.
          boxLabel: (index) =>
            placementBlock?.presentation === "free" ? "◳" : String(index + 1),
          // A committed drag must re-drive the TEXT lane, not only redraw the
          // panel: FreeLane has no per-frame tick (re-places on sync only) and
          // ColumnsLane re-reads its regions array on update() — a panel-only
          // refresh leaves the rendered text stationary (consult finding B).
          onCommit: () => {
            handlePanelChange("text");
            panel.refresh();
          },
        })
      : null;
    activeEditorialRegionEditor = editorialRegionEditor;
    // The actual scene effect for a change kind. Invoked ONLY via the coalescing
    // scheduler (flushPanelChanges), at most once per kind per frame.
    const applyPanelChange = (kind: SiteChangeKind): void => {
      switch (kind) {
        case "stops": {
          const current = cameraRail.currentStop;
          cameraRail.setStops(toRailStops(site.stops));
          if (site.stops.length > 1) {
            cameraRail.goToStop(Math.min(current, site.stops.length - 1), 0.01);
          } else {
            // goToStop is skipped here and setStops never fires onStopArrived,
            // so rebind the text system explicitly or it stays on a deleted stop.
            setActiveStop(site.stops[0]?.id ?? null);
            // …and announce the change to observers for the same reason — the
            // rail will never applyStop, so a host's stop state would go stale.
            if (site.stops.length === 1) reportStop(0);
          }
          // Stop add/delete/move mutates blocks and bindings too — the text
          // system must see it, or deleted stops leave their panels mounted.
          textSystem.sync();
          break;
        }
        case "splatText":
          textSystem.sync();
          break;
        case "text":
          // Copy typed in the hotspot inspector reaches an OPEN conjured box
          // here (ticket 13): the box derives from `annotation.copy`, and the
          // copy is no longer mirrored into any block for edits to land on.
          // Refresh FIRST, so the orphan sweep below judges block existence
          // against the new conjured set — copy emptied while its box is open
          // must take the claim with it, or the phantom swallows the marker's
          // next activation.
          refreshConjuredCopy();
          applyDisplayChannel(endOrphanedClaims(displayChannel, {
            ownerExists: (owner) => site.annotations.some((annotation) => annotation.id === owner),
            blockExists,
          }));
          textSystem.sync();
          // Keep the on-canvas rect overlay aligned with numeric placement
          // edits made in the inspector while it is active (self-guards on
          // !active). onCommit already covers drag edits.
          editorialRegionEditor?.refresh();
          break;
        case "typography": {
          typography = resolveTypography(site.settings?.typography);
          for (const [key, value] of Object.entries(typographyCssVars(typography))) {
            container.style.setProperty(key, value);
          }
          textSystem.sync();
          editorialRegionEditor?.refresh(); // self-guards on !active
          break;
        }
        case "props":
          void refreshProps();
          break;
        case "annotations":
          rebuildAnnotations();
          // A replaced/deleted annotation must not stay selected — its blocks are gone.
          if (textSystem.activeAnnotation !== null
            && !site.annotations.some((annotation) => annotation.id === textSystem.activeAnnotation)) {
            setSelection(null);
          }
          // A re-anchored marker's conjured box follows it (the box copies the
          // anchor, so nothing else would move it), and a deleted marker's box
          // is dropped (ticket 13). A deleted marker's live CLAIMS go too —
          // orphaned, they render nothing but still read as "something is
          // open", which would swallow the next Escape press. Refresh first,
          // so the sweep judges block existence against the new conjured set.
          refreshConjuredCopy();
          applyDisplayChannel(endOrphanedClaims(displayChannel, {
            ownerExists: (owner) => site.annotations.some((annotation) => annotation.id === owner),
            blockExists,
          }));
          // Annotation add/delete mutates their bound blocks too.
          textSystem.sync();
          break;
        case "obstacles":
          rebuildObstacleHelpers();
          rebuildObstacleBoxes();
          break;
        case "grade": {
          const g = site.settings?.grade;
          if (g) {
            sceneGrade.update(g);
            sceneGrade.setEnabled(!!g.enabled);
          }
          break;
        }
        // "copy" flows through shared references; "meta"/"scenes" need
        // nothing (geoAnchor is pure data — no runtime visual yet)
      }
    };
    // Wire the effect into the runtime-scope scheduler, then expose the coalescing
    // entry point under the name every caller (panel onChange + the direct commit
    // callers) already uses. site.* is still mutated synchronously in the tab
    // handlers; only this scene effect defers ≤1 frame.
    applyPanelChangeRef = applyPanelChange;
    const handlePanelChange = enqueuePanelChange;
    function makeAnnotationTarget(item: SiteConfig["annotations"][number]): AuthorGizmoTarget {
      return {
        modes: ["translate", "scale"],
        getPosition: () => item.anchor,
        setPosition: (position) => {
          item.anchor = position;
        },
        getScale: () => {
          const radius = item.radius ?? 0.6;
          return [radius, radius, radius];
        },
        setScale: (scale) => {
          item.radius = uniformScaleFromVector(scale, item.radius ?? 0.6);
        },
        onLiveChange: () => rebuildAnnotations(),
        onCommit: () => handlePanelChange("annotations"),
      };
    }
    const panelConfig: SiteAuthorPanelConfig = {
      site,
      container,
      getCameraState: () => cameraSystem.getState(),
      goToStop: (i) => cameraRail.goToStop(i),
      pickPoint,
      // Geo-anchor authoring: reuse the page's GeoContext. Button click
      // is the user gesture requestPrecise needs; denial resolves null
      // so the panel changes nothing.
      getPlace: () =>
        geo
          .requestPrecise()
          .then((place) =>
            place.lat !== undefined && place.lon !== undefined
              ? { lat: place.lat, lon: place.lon }
              : null,
          )
          .catch(() => null),
      hotspotSeed: seedUrl
        ? {
            load: () =>
              fetch(seedUrl).then((response) => {
                if (!response.ok) {
                  throw new Error(`Failed to load seed: ${response.status} ${response.statusText}`);
                }
                return response.json() as Promise<LiftedDetection[]>;
              }),
            worldTransform: seedWorldTransform,
          }
        : undefined,
      authorGizmo: {
        // makeObstacleTarget is reused VERBATIM (its onCommit already enqueues
        // the coalesced rebuild + its live-patch realigns pending arrays);
        // onCommitted only APPENDS the pane's own refresh after that effect.
        attachObstacle: (box, mode, onCommitted) => {
          const target = makeObstacleTarget(box);
          if (onCommitted) {
            const base = target.onCommit;
            target.onCommit = () => {
              base?.();
              onCommitted();
            };
          }
          authorGizmo?.attach(target, mode);
        },
        attachSplatText: (block, mode) =>
          authorGizmo?.attach(makeSplatTextTarget(block, () => {
            handlePanelChange("splatText");
            panel.refresh();
          }), mode),
        attachProp: (prop, mode, onCommitted) => {
          const target = makePropTarget(prop);
          if (onCommitted) {
            const base = target.onCommit;
            target.onCommit = () => {
              base?.();
              onCommitted();
            };
          }
          authorGizmo?.attach(target, mode);
        },
        attachAnnotation: (item, mode, onCommitted) => {
          const target = makeAnnotationTarget(item);
          if (onCommitted) {
            const base = target.onCommit;
            target.onCommit = () => {
              base?.();
              onCommitted();
            };
          }
          authorGizmo?.attach(target, mode);
        },
        detach: () => authorGizmo?.detach(),
        setSpace: (space) => authorGizmo?.setSpace(space),
        resync: () => authorGizmo?.resync(),
      },
      // On-canvas placement tools (P8d): the world gizmo and the screen-rect
      // editor, scoped to the inspected block. deactivate turns everything off
      // (block switch / inspector close) so no overlay lingers.
      placement: {
        toolsFor: (block) => placementToolsFor(block),
        deactivate: () => {
          editorialRegionEditor?.setActive(false);
          placementBlock = null;
          authorGizmo?.detach();
          gizmoBlockId = null;
          gizmoMode = null;
        },
      },
      // Fonts browser bridge (P8b): the registered family list, per-family lazy
      // load (specimens fetch on browser-open only), and BYO registration.
      fonts: {
        list: () => fontRegistry.list(),
        meta: (family) => fontRegistry.meta(family),
        ensureLoaded: (family) => fontRegistry.ensureLoaded(family),
        register: (face, buffer) => {
          fontRegistry.registerFace(face, buffer);
        },
      },
      // Inspector bridge: block-surface lookup (selection highlight + author-mode
      // picking) and per-lane capabilities (single source for control greying).
      textSystem: {
        getBlockSurface: (id) => textSystem.getBlockSurface(id),
        capabilitiesFor: (block) => textSystem.capabilitiesFor(block),
      },
      onChange: handlePanelChange,
      frameEntity,
      loadSite: options.loadSite,
    };
    function placementToolsFor(block: TextBlock): PlacementTool[] {
      if (block.presentation === "splat" || block.presentation === "plane") {
        if (!authorGizmo) return [];
        const gizmo = authorGizmo;
        const world = block.placement as WorldPlacement;
        const rotatable = (world.billboard ?? "full") === "none";
        // Reconcile a live gizmo whose mode the current billboard no longer
        // allows (rotate on a now-billboarded block): detach it so no inert
        // rotate handle lingers on canvas (consult finding G). Runs on every
        // rebuild, including the structural rerender a billboard change fires.
        if (gizmoBlockId === block.id && gizmoMode === "rotate" && !rotatable) {
          gizmo.detach();
          gizmoBlockId = null;
          gizmoMode = null;
        }
        return [{
          kind: "gizmo",
          label: "Transform",
          modes: rotatable
            ? ["translate", "scale", "rotate"]
            : ["translate", "scale"],
          disabledModes: rotatable
            ? []
            : [{ mode: "rotate", reason: "Rotate is available only when Billboard is None." }],
          attach: (mode) => {
            gizmo.attach(makeSplatTextTarget(block, () => {
              handlePanelChange("text");
              panel.refresh();
            }), mode);
            gizmoBlockId = block.id;
            gizmoMode = mode;
          },
          detach: () => {
            gizmo.detach();
            gizmoBlockId = null;
            gizmoMode = null;
          },
          isActive: () => gizmoBlockId === block.id,
        }];
      }
      if (!editorialRegionEditor) return [];
      const editor = editorialRegionEditor;
      if (block.presentation === "columns") {
        return [{
          kind: "rect",
          label: "Edit column regions",
          hint: "Drag the on-canvas boxes; edits reflow the columns next frame.",
          setActive: (on) => {
            if (on) {
              placementBlock = block;
              const seeded = !(block.placement as ColumnsPlacement).regions?.length;
              if (seeded) seedColumnsFor(block);
              editor.setActive(true);
              editor.refresh();
              // Seeding replaces placement.regions with a NEW array; sync so the
              // columns lane adopts it (setBlock keeps a stale reference until
              // update() re-reads) — consult finding B.
              if (seeded) handlePanelChange("text");
            } else {
              editor.setActive(false);
              if (placementBlock === block) placementBlock = null;
            }
          },
          isActive: () => editor.active && placementBlock === block,
        }];
      }
      if (block.presentation === "free") {
        return [{
          kind: "rect",
          label: "Edit rectangle",
          hint: "Drag the on-canvas box; numeric fields stay in sync.",
          setActive: (on) => {
            if (on) {
              placementBlock = block;
              editor.setActive(true);
              editor.refresh();
            } else {
              editor.setActive(false);
              if (placementBlock === block) placementBlock = null;
            }
          },
          isActive: () => editor.active && placementBlock === block,
        }];
      }
      return [];
    }
    const panel = new AuthorPanel(panelConfig);
    authorPanelRef = panel;
  })
  : Promise.resolve();
// Keep authorReady rejectable for callers that await it, but observe it here so a
// failed dynamic import / seedTransform never becomes an unhandled rejection.
void authorReady.catch((error: unknown) => {
  if (!disposed) console.error("[SiteRuntime] author init failed", error);
});

// ─── Teardown ─────────────────────────────────────────────
// Dispose in ownership order (consult): stop the frame callback, then dispose
// UI / controllers / grade / meshes, then SparkScene (GL + canvas) LAST. The
// whole method runs synchronously, so no animation frame interleaves; async
// continuations self-guard on `disposed`, so nothing new mounts afterward.

function dispose(): void {
  if (disposed) return;
  disposed = true;

  // Never leave whenReady pending: a consumer awaiting a runtime that is torn
  // down before its scenes stream gets an AbortError, not an eternal promise.
  if (!readySettled) {
    readySettled = true;
    rejectReady(new DOMException("SiteRuntime disposed before ready", "AbortError"));
  }

  loadTelemetry?.dispose();
  sparkScene.setOnFrame(null);
  sparkScene.throttleGate = null;
  for (const eventName of throttleDomEvents) {
    window.removeEventListener(eventName, noteInput, { capture: true });
  }

  // Stop the coalescing scheduler: cancel any pending flush, drop queued kinds,
  // and detach the visibility listener (if it was ever added) so nothing fires
  // post-teardown.
  cancelPanelFlush();
  pendingPanelKinds.clear();
  if (panelVisibilityListenerAdded) {
    document.removeEventListener("visibilitychange", onPanelVisibilityChange);
    panelVisibilityListenerAdded = false;
  }

  authorPanelRef?.dispose();
  authorGizmo?.dispose();
  activeEditorialRegionEditor?.dispose();

  sparkScene.canvas.removeEventListener("pointerdown", onPickPointerDown);
  sparkScene.canvas.removeEventListener("pointerup", onPickPointerUp);
  pickResolve?.(null);
  pickResolve = null;

  geo.dispose();
  textSystem.dispose();
  splatHighlight.dispose();
  annotations.dispose();

  scrollRail?.dispose();
  cameraRail.dispose();
  // Drop the takeover subscription before the camera system goes down, so a
  // last pointerdown cannot reach a torn-down closure.
  cameraSystem.setUserTakeoverCallback(null);
  cameraSystem.dispose();

  sceneGrade.dispose();
  mediaLayer.dispose();
  // A disposed scene must not keep talking: the element outlives this closure
  // and would otherwise play on through a re-mount into the next scene.
  audioPlayer.dispose();
  audioChannel = EMPTY_AUDIO_CHANNEL;
  // Nor keep flying: halt any sequence before the camera system goes down
  // (cameraSystem.dispose would fire the pending leg's callback anyway, but an
  // explicit halt does not depend on that ordering).
  haltSequence();
  propLayer.dispose();

  // The backend's handles own the splat buffers — the renderer's dispose does
  // not free them; the seam does (ticket 04 dispose, through ticket 09).
  for (const entry of loadedScenes) {
    sparkScene.scene.remove(entry.mesh);
    splatBackend.dispose(entry.handle);
  }
  for (const helper of obstacleHelpers) disposeObstacleHelper(helper);
  obstacleHelpers = [];

  containerResizeObserver.disconnect();
  // Withdraw before the chrome goes: a container reused by a second runtime
  // would otherwise start life reserving rectangles for a switch that is gone.
  publishReservedRegion(container, "engage-switch", null);
  publishReservedRegion(container, "engage-mode-row", null);
  engagementObserver.disconnect();
  if (pulseFallbackTimer !== null) {
    clearTimeout(pulseFallbackTimer);
    pulseFallbackTimer = null;
  }
  container.removeEventListener("wheel", onEngagementWheel, { capture: true });
  container.removeEventListener("wheel", onEngagementWheelBubble);
  if (disarmZoomTimer !== null) {
    clearTimeout(disarmZoomTimer);
    disarmZoomTimer = null;
  }
  container.removeEventListener("keydown", onEngagementKeyDown);
  sparkScene.canvas.removeEventListener("click", onEngagementCanvasClick);
  engageFocusTarget = null;
  onDisengagedSceneClick = null;
  loading.dispose();

  // Runtime-owned DOM chrome appended to the container.
  navBar.remove();
  edgeTrack.remove();
  leavePill.remove();
  headlineWrap.remove();
  engageToggle.remove();
  engageHint.remove();
  engageSubToggle.remove();
  engagementStyle.remove();

  // GL context + canvas last.
  sparkScene.dispose();
}

const handle: SiteRuntimeHandle = {
  site,
  sparkScene,
  cameraSystem,
  cameraRail,
  loadedScenes,
  annotations,
  propLayer,
  mediaLayer,
  sceneGrade,
  splatHighlight,
  textSystem,
  fontRegistry,
  geo,
  get scrollRail() {
    return scrollRail;
  },
  get authorGizmo() {
    return authorGizmo;
  },
  get authorPanel() {
    return authorPanelRef;
  },
  authorReady,
  whenReady,
  // Reduced motion now flies SLOWER rather than cutting (see planTravel) — a
  // teleport destroyed the spatial relationship a tour exists to convey.
  // planTravel stays the single decision point for programmatic navigation.
  goToStop: (index: number) => {
    noteNavigate(); // a programmatic command resumes full render rate
    travelToStop(index);
  },
  stopIndexById: (id: string) => site.stops.findIndex((stop) => stop.id === id),
  stopByIndex: (index: number) => stopDetail(index),
  goToObject: (id: string) => {
    // Validate against the site's own annotations, and REJECT rather than ignore:
    // silently accepting an id that names nothing would blank the panel and
    // report success for a selection that never happened. Throwing also keeps
    // this consistent with `goToStopById`, whose contract is RangeError for a
    // bad argument.
    if (!site.annotations.some((annotation) => annotation.id === id)) {
      throw new RangeError(`goToObject: no annotation with id "${id}"`);
    }
    // Presence (D31) is part of the same contract: an annotation whose clause
    // does not hold right now has no marker, so selecting it would strand its
    // copy on screen with nothing to dismiss it — and the presence refresh
    // could not clean it up, because from its side nothing changed. Rejected
    // separately from the unknown-id case: the id is real, the moment isn't.
    if (!presentAnnotationIds.has(id)) {
      throw new RangeError(
        `goToObject: annotation "${id}" is not present in the current context (its presence condition does not hold)`,
      );
    }
    setSelection(id);
  },
  clearSelection: () => setSelection(null),
  get selectedObject() {
    return textSystem.activeAnnotation;
  },
  get motionState(): "idle" | "traveling" | "settling" {
    // Derived from CameraRail's EXISTING public getters (CameraRail.ts:146-159);
    // the private RailMode enum stays private and the rail needs no change.
    // Settling is checked first: it is a distinct phase, not a kind of travel.
    if (cameraRail.settling) return "settling";
    if (cameraRail.transitioning) return "traveling";
    return "idle";
  },
  cancelMotion: () => cameraRail.cancelMotion(),
  get engagement() {
    return engagement;
  },
  setEngagement,
  setEngageFocusTarget: (el: HTMLElement | null) => {
    engageFocusTarget = el;
  },
  setDisengagedClickHook: (fn: (() => void) | null) => {
    onDisengagedSceneClick = fn;
  },
  focusEngageToggle: () => {
    // preventScroll: the router smooth-scrolls the scene into view first, and a
    // plain focus() would replace that with the browser's instant focus scroll.
    engageToggle.focus({ preventScroll: true });
  },
  pulseEngageToggle,
  // The ELEMENT holds the authoritative list (element-scoped, so it survives a
  // reboot) and re-applies it on every mount; TextSystem is the only consumer,
  // so a second copy here would be unread state.
  setDuplicatedBlockIds: (ids: ReadonlySet<string>) => textSystem.setDuplicatedBlockIds(ids),
  registerRuleHandler: (name: string, fn: CustomHandler<SiteRuntimeHandle>) => {
    ruleHandlers.register(name, fn);
  },
  unregisterRuleHandler: (name: string) => ruleHandlers.unregister(name),
  rebuildAnnotations,
  rebuildObstacleHelpers,
  rebuildObstacleBoxes,
  pickPoint,
  dispose,
};
// The deferred reference a `custom` effect dispatches with. Set here because the
// handle cannot exist before the things it exposes do; read only from a visitor
// action, which is necessarily after this line.
runtimeHandle = handle;
return handle;
}
