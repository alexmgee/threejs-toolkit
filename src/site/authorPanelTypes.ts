import type { Object3D } from "three";
import type { CameraState } from "../core/CameraSystem";
import type { CapabilitySet, SiteFontFace, TextBlock } from "../text/TextModel";
import type { FontFamilyMeta } from "../text/FontRegistry";
import type {
  AnnotationMeta,
  SiteConfig,
  SiteAnnotation,
  SiteObstacleBox,
  SiteProp,
} from "./SiteConfig";
import type {
  LiftedDetection,
  SeedWorldTransform,
} from "./HotspotSeeder";

export type SiteChangeKind =
  | "meta"
  | "scenes"
  | "copy"
  | "stops"
  | "splatText"
  | "text"
  | "props"
  | "obstacles"
  | "annotations"
  | "typography"
  | "grade";

// ─── Inspector (D10) ──────────────────────────────────────
// The universal inspect-mode contract: a selected entity resolves to an
// Inspectable, whose controls the generic inspector.ts renders over
// primitives.ts. Text is the first (P7a) and, for now, only `kind`; the union
// grows in the follow-up plan. P7a fills the header + essentials strip; the
// nine domain groups (P7b) and the cascade machinery (P7c) extend the same types.

export interface Inspectable {
  kind: "text" | "style";
  id: string;
  label: string;
  groups(): InspectorGroup[];
  placementTools(): PlacementTool[];
  /** Scene/page highlight hooks — light up (or clear) the entity's surface. */
  select(): void;
  deselect(): void;
}

/**
 * The rendered lifecycle unit `AuthorPanel.renderInspect` holds, one per open
 * selection (Plan 14). The text/style path wraps its cascade `Inspectable` +
 * rendered parts into one of these; the entity panes (box/hotspot/stop/prop)
 * build it directly — they have no cascade, so they never touch
 * `InspectorGroup`/tier machinery. `select`/`deselect` are the highlight and
 * teardown hooks the panel calls when the pane mounts/unmounts.
 */
export interface InspectorPane {
  header: HTMLElement;
  body: HTMLElement;
  select(): void;
  deselect(): void;
}

/** What selecting an entity should bring on screen (Plan 14 auto-frame).
 *  Stops frame via the rail (resolved to an index at invocation time). */
export type FrameTarget =
  | { kind: "box" | "hotspot" | "prop" | "block"; id: string }
  | { kind: "stop"; id: string };

export interface InspectorGroup {
  id: string;
  label: string;
  controls: InspectorControl[];
  collapsed?: boolean;
}

export type ControlTier = "token" | "style" | "variant" | "override" | "none";

export interface InspectorControl {
  kind: "slider" | "select" | "toggle" | "color" | "segmented" | "text" | "textarea" | "vector";
  /** Plain language — "Line width (ch)" not "Measure" (QC baseline). */
  label: string;
  get(): unknown;
  set(v: unknown): void;
  /** Drives the tier dot (rendered from P7c). */
  tier(): ControlTier;
  /** One-click clear-to-inherited (wired from P7c). */
  clear?(): void;
  /** Capability greying — the SAME string the lane's `capabilities().excluded` carries. */
  disabledReason?: string;
  /** Sliders ALWAYS pair with a direct numeric entry (QC baseline). */
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
}

export type PlacementMode = "translate" | "scale" | "rotate";

/** A placement tool surfaced in the inspector (P8d). `gizmo` drives an
 *  `AuthorGizmo` in the scene (world blocks); `rect` toggles an on-canvas
 *  screen-rect editor (free rect / columns regions). Both expose live state
 *  so the inspector renders correctly across its frequent rerenders. */
export type PlacementTool =
  | {
      kind: "gizmo";
      label: string;
      modes: PlacementMode[];
      /** Modes shown but greyed with a reason (e.g. Rotate on a billboarded block). */
      disabledModes?: { mode: PlacementMode; reason: string }[];
      attach(mode: PlacementMode): void;
      detach(): void;
      isActive(): boolean;
    }
  | {
      kind: "rect";
      label: string;
      hint?: string;
      setActive(on: boolean): void;
      isActive(): boolean;
    };

export interface SiteAuthorPanelConfig {
  /** Mutated in place — the working copy that export serializes */
  site: SiteConfig;
  /** Pane mount point (default: document.body) */
  container?: HTMLElement;
  getCameraState: () => CameraState;
  goToStop?: (index: number) => void;
  /**
   * One-shot world-point pick — resolve with a world position (typically
   * the next raycast hit on the canvas) or null to cancel.
   */
  pickPoint: () => Promise<[number, number, number] | null>;
  /**
   * Optional device-location provider for geo-anchor authoring —
   * resolve with { lat, lon } or null on denial/unavailable. Typically
   * wired to GeoContext.requestPrecise() by the consumer; the panel
   * never touches geolocation itself.
   */
  getPlace?: () => Promise<{ lat: number; lon: number } | null>;
  hotspotSeed?: {
    load: () => Promise<LiftedDetection[]>;
    worldTransform?: SeedWorldTransform | null;
    /** Provenance tag stamped onto annotations produced by Apply. Defaults to "owlv2-colmap". */
    source?: AnnotationMeta["source"];
  };
  /**
   * Bring an entity on screen when it is selected (Plan 14 auto-frame): bounds
   * framing for box/hotspot/prop/world-block (current yaw/pitch kept), rail
   * travel for stops. Absent → selection never moves the camera.
   */
  frameEntity?: (target: FrameTarget) => void;
  authorGizmo?: {
    attachObstacle: (
      box: SiteObstacleBox,
      mode: "translate" | "scale" | "rotate",
      /** Runs AFTER the target's own commit effect (which enqueues the change
       *  kind) — the pane uses it to refresh its number fields. */
      onCommitted?: () => void,
    ) => void;
    attachSplatText: (block: TextBlock, mode: "translate" | "scale" | "rotate") => void;
    attachProp: (
      prop: SiteProp,
      mode: "translate" | "scale" | "rotate",
      onCommitted?: () => void,
    ) => void;
    attachAnnotation?: (
      item: SiteAnnotation,
      mode: "translate" | "scale",
      onCommitted?: () => void,
    ) => void;
    detach: () => void;
    /** Transform space for translate/rotate handles (scale is always local).
     *  Persists across attaches until changed. */
    setSpace?: (space: "world" | "local") => void;
    /** Re-read the gizmo proxy from its target after a structural edit moved
     *  the attached entity (fit/re-center), so the next drag doesn't jump back. */
    resync?: () => void;
  };
  /**
   * On-canvas placement tools for the block inspector (P8d): the consumer owns
   * the `AuthorGizmo` (world blocks) and the screen-rect editor (free/columns)
   * and returns the right tools per block. `deactivate` turns off whatever is
   * active — the panel calls it on block switch and inspector close so a stale
   * overlay/gizmo never lingers on a no-longer-inspected block. Absent when the
   * consumer wires no placement editors (the inspector shows numeric fields
   * only).
   */
  placement?: {
    toolsFor: (block: TextBlock) => PlacementTool[];
    deactivate: () => void;
  };
  /**
   * Bridge to the live FontRegistry for the P8b fonts browser: the registered
   * family list, a per-family lazy loader (specimens fetch only when the
   * browser opens), and BYO registration. Absent when the consumer wires no
   * registry — the fonts browser is then omitted.
   */
  fonts?: {
    list: () => FontFamilyMeta[];
    /** The registered meta for a family name or CSS stack (variable-axis ranges
     *  drive axis-aware inspector control bounds). */
    meta: (family: string) => FontFamilyMeta | undefined;
    ensureLoaded: (family: string) => Promise<void>;
    register: (face: SiteFontFace, buffer?: ArrayBuffer) => void;
  };
  /**
   * Bridge to the live TextSystem for the block inspector: surface lookup
   * (selection highlight + author-mode click/hover picking) and per-lane
   * capabilities (the single source for control greying). Absent when the
   * consumer wires no text system — the inspector degrades to no highlight
   * and no greying rather than throwing.
   */
  textSystem?: {
    getBlockSurface: (id: string) => HTMLElement | Object3D | null;
    capabilitiesFor: (block: TextBlock) => CapabilitySet;
  };
  onChange: (kind: SiteChangeKind) => void;
  /** Author-mode "Load JSON": reboot the scene from a pasted config string.
   *  Absent → the panel shows no Load affordance. Rejects on invalid JSON. */
  loadSite?: (json: string) => void | Promise<void>;
}
