import type { CameraState } from "../../core/CameraSystem";
import type { AnnotationRule } from "../../rules/RuleModel";
import type { SiteConfig } from "../SiteConfig";
import type {
  LiftedDetection,
  SeederKnobs,
} from "../HotspotSeeder";
import type {
  SiteAuthorPanelConfig,
  SiteChangeKind,
} from "../authorPanelTypes";

export interface AuthorTabCtx {
  site: SiteConfig;
  /** THIS panel's root element — scope DOM lookups through it, never through
   *  document (invisible inside a shadow root; wrong instance with two panels). */
  panelRoot: HTMLElement;
  onChange: (kind: SiteChangeKind) => void;
  structural: (kind: SiteChangeKind) => void;
  requestRerender: () => void;
  pickPoint: () => Promise<[number, number, number] | null>;
  getPlace?: () => Promise<{ lat: number; lon: number } | null>;
  hotspotSeed?: SiteAuthorPanelConfig["hotspotSeed"];
  authorGizmo?: SiteAuthorPanelConfig["authorGizmo"];
  fonts?: SiteAuthorPanelConfig["fonts"];
  textSystem?: SiteAuthorPanelConfig["textSystem"];
  getCameraState: () => CameraState;
  goToStop?: (index: number) => void;
  /** Open the block inspector for a block id (browse → inspect). */
  selectBlock: (id: string) => void;
  /** Open the SAME inspector scoped to a named style (P8a style manager). */
  selectStyle: (id: string) => void;
  /** Open the entity pane for an obstacle box (Plan 14 selection panes). */
  selectBox: (id: string) => void;
  /** Open the entity pane for a hotspot annotation (Plan 14). */
  selectHotspot: (id: string) => void;
  /** Open the entity pane for a tour stop (Plan 14). */
  selectStop: (id: string) => void;
  /** Open the entity pane for a glTF prop (Plan 14). */
  selectProp: (id: string) => void;
  /** Forget a deleted entity's persisted edit scope (DD0). Instance-owned by
   *  AuthorPanel — a block/style recreated under the same id opens at Base, not
   *  the deleted one's variant scope. */
  resetInspectorScope: (kind: "block" | "style", id: string) => void;
  seedState: {
    knobs: SeederKnobs;
    cache: LiftedDetection[] | null;
    loading: Promise<LiftedDetection[]> | null;
  };
  /** Per-panel fonts-browser state (P8b) — instance-owned so two panels never
   *  share a lazy-load latch or a BYO draft; `requestId` guards async fetch
   *  races (a slow first fetch must not overwrite a fast second one). */
  fontsState: {
    openedOnce: boolean;
    draft: FontDraft | null;
    requestId: number;
  };
  /** Per-panel-instance Rules-pane state (ticket 10), keyed by annotation id.
   *
   *  The working rule list may hold HALF-AUTHORED cards — a rule with no effect
   *  yet, a show-blocks with no blocks picked — which the config cannot
   *  represent, so it cannot live on the annotation. It has to survive the
   *  inspector's wholesale rebuilds (a gizmo attach, a context-simulator scrub)
   *  or an unfinished card would vanish under the author. Instance-owned so two
   *  embeds never share a draft, exactly like `fontsState` and the inspector's
   *  own UI state.
   *
   *  `committed` is the JSON the pane last WROTE to `annotation.rules`. A pane
   *  reuses its draft only while that still matches what is on the annotation;
   *  anything else (a Load JSON, an import) means the draft is stale and the
   *  pane re-reads from the config. */
  rulesState: Map<string, { working: AnnotationRule[]; committed: string; tab: string }>;
  /** Display-only annotation-list sort preference; never persisted. */
  annotationSortByConfidence: boolean;
  /** Write the annotation-list sort preference through to this panel instance. */
  setAnnotationSortByConfidence: (on: boolean) => void;
}

export interface FontDraft {
  family: string;
  url: string;
  italicUrl: string;
  axes: Record<string, [number, number]>;
  features: string;
  buffer: ArrayBuffer | null;
  note: string;
  /** File-sourced (blob URL) faces register live but are NOT exported — a dead
   *  blob URL would 404 on reload. */
  sessionOnly: boolean;
}
