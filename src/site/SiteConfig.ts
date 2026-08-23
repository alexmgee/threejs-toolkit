/**
 * SiteConfig — Data schema for splat + Pretext site templates
 *
 * Everything a guided-tour site authors is data, not code: scenes,
 * rail stops with copy, in-scene splat text, obstacle volumes for
 * editorial layout, and world-anchored annotations. A site is one
 * JSON file consumed at boot (examples/portfolio-lab is the reference
 * consumer); making a new site means new JSON + new assets.
 *
 * The authoring loop is: run the site with ?author=1, edit through
 * the AuthorPanel, export the updated JSON, and drop it back into the
 * site directory. normalizeSiteConfig fills defaults so hand-written
 * or older files stay loadable.
 */

import type { CameraState } from "../core/CameraSystem";
import type { GeoAnchor } from "../locative/GeoAnchor";
import type { AnnotationMeta } from "./AnnotationMeta";
import {
  displayTemplatePrefix,
  validateAnnotationRules,
  validateModeLocks,
  type AnnotationRule,
  type DisplayTemplate,
  type RuleWhen,
  type SceneMode,
  type ShowBlocksEffect,
} from "../rules/RuleModel";
import {
  isScreenPresentation,
  PANEL_SLOTS,
  type BlockBinding,
  type EaseName,
  type TextBlock,
  type TextStyle,
  type SiteFontFace,
  type ScreenRectNorm,
  type WorldPlacement,
} from "../text/TextModel";

export type { ScreenRectNorm } from "../text/TextModel";
export type { AnnotationMeta } from "./AnnotationMeta";

// ─── Schema ───────────────────────────────────────────────

export interface SiteCopy {
  title?: string;
  body: string;
}

export interface SiteProp {
  id: string;
  /** Display name for authoring UI (falls back to id) */
  label?: string;
  /** .glb/.gltf URL (v1: uncompressed — no DRACO/KTX2) */
  url: string;
  position: [number, number, number];
  rotationDeg?: [number, number, number];
  /** Uniform scale (default: 1) */
  scale?: number;
  castShadow?: boolean;
}

export interface SiteMedia {
  id: string;
  kind: "image" | "video";
  url: string;
  position: [number, number, number];
  rotationDeg?: [number, number, number];
  size: [number, number];
  billboard?: "full" | "y" | "none";
  binding: BlockBinding;
}

/**
 * A sound a rule can play (D31 `play-audio`).
 *
 * Its OWN list rather than a `kind: "audio"` entry in `site.media`: media
 * entries are owned by the binding evaluator, which decides visibility
 * continuously from stops/annotations/progress. A rule-driven sound there would
 * have two owners disagreeing about when it plays — the collision ticket 05
 * refused for template blocks ("presence is the channel's job, never a
 * binding"). Binding-driven AMBIENT audio is a genuinely different feature and
 * would belong in `media`, where its regime already lives.
 *
 * Spatial playback is not in v1. When it arrives it joins this entry
 * (`position`, rolloff, cone) rather than the effect, so a sound stays one
 * authored thing however many rules play it.
 */
export interface SiteAudio {
  id: string;
  /** Resolved against the site.json's own base by `resolveSiteAssets`, like
   *  every other authored asset URL. */
  url: string;
  /** Playback volume, 0..1. Absent = full. */
  volume?: number;
}

export interface SiteScene {
  id: string;
  url: string;
  /** Stream a pre-built LOD .rad (registerPagedSplat is applied by the consumer) */
  paged?: boolean;
  /** Float32 precision — prevents striping on photogrammetry data (default: true) */
  extSplats?: boolean;
  position?: [number, number, number];
  /** Euler degrees with automatic 180° X-flip (COLMAP Y-down → Three.js Y-up) */
  eulerRotationDeg?: [number, number, number];
  quaternion?: [number, number, number, number];
  scale?: number;
  geoAnchor?: GeoAnchor;
  /** glTF props placed in the scene */
  props?: SiteProp[];
  /** Prop lighting rig intensities + directional azimuth/altitude in degrees; active only when props exist */
  propLighting?: { hemisphere?: number; directional?: number; directionDeg?: [number, number] };
}

export interface SiteStop {
  /** Stable id; normalize assigns "stop-<index>" when absent. */
  id?: string;
  label: string;
  camera: CameraState;
  /** Per-stop optics blended during rail travel; absent fields inherit the global/current value. */
  optics?: { fov?: number; focalDistance?: number; apertureAngle?: number };
  copy?: SiteCopy;
  /** "caption" (default): CaptionOverlay panel. "editorial": long-form columns routed around obstacles. */
  mode?: "caption" | "editorial";
  /** Long-form passage for editorial mode */
  editorialCopy?: string;
  /** Transition duration override in seconds */
  duration?: number;
  /** Travel/orbit policy (P1 enforces): "free" (fully stop the rail + orbit),
   *  "bounded" (orbit within limits, rail still leavable), "locked" (held on the view).
   *  Absent = today's behavior. */
  explore?: "free" | "bounded" | "locked";
}

export interface SiteSplatText {
  id: string;
  text: string;
  /** World position of the text block center */
  position: [number, number, number];
  /** Applied only when billboard is 'none' — billboarding overwrites rotation per frame. */
  rotationDeg?: [number, number, number];
  /** Em height in world units (default: 0.125). */
  size?: number;
  /** Unitless line-height multiplier (default: 1.2). */
  lineSpacing?: number;
  /** Wrap width in world units. Omitted or 0 means no wrap. */
  wrapWidth?: number;
  /** Raster resolution in px (default: 32); controls crispness, not size. */
  detail?: number;
  /** Font family list. */
  font?: string;
  /** @deprecated Input parse only. Migrated to size by normalizeSiteConfig. */
  scale?: number;
  /** @deprecated Input parse only. Migrated to detail by normalizeSiteConfig. */
  fontSize?: number;
  /** @deprecated Input parse only. Migrated to wrapWidth by normalizeSiteConfig. */
  maxWidthPx?: number;
  /** @deprecated Input parse only. Migrated to size by normalizeSiteConfig. */
  lineHeightWorld?: number;
  /** Hex color, e.g. "#ffffff" */
  color?: string;
  textAlign?: "left" | "center" | "right";
  billboard?: "full" | "y" | "none";
  dotRadius?: number;
}

export interface SiteObstacleBox {
  id: string;
  /** Display name for authoring UI (falls back to id) */
  label?: string;
  min: [number, number, number];
  max: [number, number, number];
  /** Euler XYZ degrees applied about the box center; min/max define the unrotated extents; absent = axis-aligned. */
  rotationDeg?: [number, number, number];
  /** Author-mode wireframe hex color (default: "#4ade80") */
  color?: string;
  /** Author-mode wireframe width in px (default: 1) */
  lineWidth?: number;
}

export interface SiteAnnotation {
  id: string;
  /** World-space anchor point */
  anchor: [number, number, number];
  /** Glow sphere world radius */
  radius?: number;
  /** Glow hex color */
  highlight?: string;
  copy: SiteCopy;
  /** Ordered rule cards (D31 live markers): first match wins at trigger time.
   *  Validated by pre-flight after block seeding; absent = copy-only behavior. */
  rules?: AnnotationRule[];
  /** Presence condition (D31): when this annotation's marker exists at all.
   *  Absent = always present. Where it does not hold the marker is not
   *  rendered, not tabbable, and cannot be activated — inertness is authored
   *  as absence, never as a dead visible marker. */
  presence?: RuleWhen;
  /** Provenance + trust data for machine-seeded annotations; absent on hand-authored ones. */
  meta?: AnnotationMeta;
}

export interface SiteScrollSettings {
  /** Enable scroll-driven rail travel (default: true when stops ≥ 2) */
  enabled?: boolean;
  /** Sustained scroll px needed to leave a docked stop (default: 320) */
  detentThresholdPx?: number;
  /** Wheel px for a full 0→1 rail traversal (default: 4000) */
  wheelPxPerProgress?: number;
  /** Touch-drag px for a full 0→1 rail traversal (default: 2600) */
  touchPxPerProgress?: number;
}

export interface SiteGradeSettings {
  /** Enable post-processing color grade (default: false) */
  enabled?: boolean;
  /** Exposure multiplier (default: 1) */
  exposure?: number;
  /** Contrast multiplier (default: 1) */
  contrast?: number;
  /** Saturation multiplier (default: 1) */
  saturation?: number;
  /** Temperature bias, -1 cool to +1 warm (default: 0) */
  temperature?: number;
  /** Tint bias, -1 green to +1 magenta (default: 0) */
  tint?: number;
  /** Vignette strength, 0 none to 1 strong (default: 0) */
  vignette?: number;
  /** Film grain strength (default: 0) */
  grain?: number;
  /** Optional .cube LUT URL */
  lutUrl?: string;
}

export interface SiteTypographySettings {
  /** Named font stack for ALL text surfaces. Named families only (no system-ui — canvas/DOM resolve it differently; TextLayout throws). Default DEFAULT_FONT_STACK. */
  fontFamily?: string;
  /** Root/base font size in px for SCREEN text (caption/editorial). Default 16. */
  baseSizePx?: number;
  /** Modular type-scale ratio (title = base × ratio). Default 1.25. */
  scaleRatio?: number;
  /** Default body line-height multiplier. Default 1.5 (= 24px at base 16 — today's caption). */
  lineHeight?: number;
  /** Default measure (line length) in ch. Default 66 (Bringhurst/proportional-web). */
  measureCh?: number;
}

export interface SiteTextSettings {
  /** Default fade duration for text-block mount/unmount, ms. Default 300. */
  transitionMs?: number;
  /** Default fade curve. Default "linear". */
  transitionEase?: EaseName;
  /**
   * Do panels collapse into one full-width bar below the narrow-screen
   * breakpoint, whatever slot they named? Default `true` — today's phone
   * rendering, preserved (ticket 17, Rule D).
   *
   * A DEFAULT, not a rule: an author who switches it off keeps their authored
   * slots at every width, and owns the result — *"good design protect reading
   * on a phone; not rules"*. Overridden per panel by `PanelPlacement.collapse`;
   * where two blocks share a slot and disagree, one opt-out holds the whole
   * slot (ticket 17/D3), because a slot is ONE DOM panel.
   */
  collapseOnNarrow?: boolean;
}

/**
 * Site-wide defaults for the blocks channel (ticket 17).
 *
 * Both fields were RULES the toolkit enforced and no author could reach. They
 * are settings now, so the scene states its habit once and the author may say
 * otherwise. The channel itself no longer decides anything on its own.
 */
export interface SiteBlocksSettings {
  /**
   * When a marker shows content, is content shown by a DIFFERENT marker
   * removed? Default `true` — today's behaviour (ticket 17, Rule A).
   *
   * REMOVES, never "hides while": a hidden-while state would be a second
   * lifetime concept arriving by the back door (ticket 17/S4). Content from the
   * SAME marker is never evicted automatically — the author prevents that
   * collision, it is not a rule. Overridden per effect by
   * `ShowBlocksEffect.takeover`.
   */
  takeover?: boolean;
  /**
   * While a marker is selected, do stop-bound blocks yield? Default `false`
   * (ticket 17, Rule B).
   *
   * Off, because a marker's content and a stop's caption are different kinds
   * belonging to different things — one to what the visitor activated, one to
   * where the visitor is. The setting exists for the author who deliberately
   * puts a marker's panel in the stop caption's slot and wants the caption to
   * give way.
   */
  hideStopContent?: boolean;
}

export interface SiteCaptionSettings {
  /** Font family list. Default inherited from typography.fontFamily. */
  fontFamily?: string;
  /** Body font weight. Default 400. */
  weight?: number;
  /** Body font size in px. Default inherited from typography.baseSizePx. */
  bodySizePx?: number;
  /** Title font size in px. Default round(typography.baseSizePx × typography.scaleRatio). */
  titleSizePx?: number;
  /** Letter spacing in em. Default 0. */
  trackingEm?: number;
  /** Caption text color. Default "#ffffff". */
  color?: string;
  /** Body line-height multiplier. Default inherited from typography.lineHeight. */
  lineHeight?: number;
  /** Desktop side-panel measure in ch. Default inherited from typography.measureCh. */
  measureCh?: number;
  /** Body text alignment. Default "left"; captions may justify. */
  align?: "left" | "justify";
}

export interface SiteEditorialSettings {
  /** Ordered column regions. Absent or empty uses the legacy responsive pixel layout. */
  columns?: ScreenRectNorm[];
  /** Editorial font size in px. Default 15 (the legacy editorial constant). */
  fontSizePx?: number;
  /** Editorial line height in px. Default 22 (the legacy editorial constant). */
  lineHeightPx?: number;
  /** Minimum usable carved slot width in px. Default 140 (the legacy editorial constant). */
  minSlotWidthPx?: number;
}

export interface SiteSettings {
  /** Scene background color, hex (default: "#0c0c10") */
  background?: string;
  transitionDuration?: number;
  settleDuration?: number;
  fov?: number;
  scroll?: SiteScrollSettings;
  /** Post-processing color grade — consumed by SceneGrade */
  grade?: SiteGradeSettings;
  /** Shared defaults for text surfaces. */
  typography?: SiteTypographySettings;
  /** Registered font faces (curated picks + BYO). */
  fonts?: SiteFontFace[];
  /** Site-level caption typography overrides; omitted fields inherit. */
  caption?: SiteCaptionSettings;
  /** Text-block transition defaults (per-block transitionMs/transitionEase override)
   *  and the narrow-screen collapse default (per-panel `collapse` override). */
  text?: SiteTextSettings;
  /** Blocks-channel defaults: takeover and stop-content yielding (ticket 17).
   *  Unlike its neighbours this object is CLOSED — see `validateBlocksSettings`. */
  blocks?: SiteBlocksSettings;
  /** Site-level editorial regions and typography overrides; omitted fields use legacy defaults. */
  editorial?: SiteEditorialSettings;
  /** Modes this scene starts with LOCKED (D31 story 32) — a visitor is not
   *  offered them until a rule grants one with an `allow` or `engage` effect.
   *  Absent or empty is the ordinary scene: both doors open.
   *
   *  Only what is locked is written down, so the file cannot contradict itself
   *  about a mode's state. Pre-flight refuses a list that locks EVERY mode while
   *  no rule anywhere grants one back — that scene has no way into 3D at all. */
  lockedModes?: SceneMode[];
}

export interface SiteConfig {
  version: 1;
  name?: string;
  settings?: SiteSettings;
  scenes: SiteScene[];
  stops: SiteStop[];
  blocks: TextBlock[];
  styles: TextStyle[];
  /** @deprecated Input parse only. Migrated to world splat blocks by normalizeSiteConfig. */
  splatText?: SiteSplatText[];
  obstacles: SiteObstacleBox[];
  annotations: SiteAnnotation[];
  media?: SiteMedia[];
  /** Sounds `play-audio` rules may name (D31). */
  audio?: SiteAudio[];
}

// ─── Seeded-block helpers ─────────────────────────────────
// ONE home for the caption-block shape and the unbind-or-drop rule: the
// migration seeds with these, the author tabs upsert/delete with these — a
// shape or rule change in one place reaches every producer and consumer.

/** A block id guaranteed unique against the current block list. The bare
 *  `text-${Date.now()}` scheme collides on a same-millisecond double-click
 *  (two clicks resolve the same stamp) — a duplicate id collapses the
 *  TextSystem's id-keyed maps (one renderer for two blocks). */
export function uniqueBlockId(blocks: readonly TextBlock[], base = "text"): string {
  return uniqueEntityId(blocks.map((block) => block.id), base);
}

/** Collision-aware authored-entity id: `base-<stamp>`, counter-suffixed while taken.
 *  Selection and the prop layer key on ids, so a bare timestamp is not enough. */
export function uniqueEntityId(ids: readonly string[], base: string): string {
  const taken = new Set(ids);
  const stamp = Date.now().toString(36);
  let candidate = `${base}-${stamp}`;
  let counter = 2;
  while (taken.has(candidate)) candidate = `${base}-${stamp}-${counter++}`;
  return candidate;
}

export function seededCaptionBlock(
  kind: "title" | "body",
  id: string,
  content: string,
  binding: BlockBinding,
): TextBlock {
  return {
    id,
    content,
    space: "screen",
    presentation: "panel",
    styleId: kind === "title" ? "caption-title" : "caption-body",
    binding,
    // A real slot from the moment the panel exists (ticket 06). "left" is the
    // corner the engagement chrome does not occupy, so the standard output does
    // not open on top of the switch — but this is a STARTING VALUE the author
    // owns from here on, not a guard: change it and the toolkit obeys.
    placement: { slot: "left", order: kind === "title" ? 0 : 1 },
    transitionMs: 200,
  };
}

/** World scale for a seeded world template: the same world-units-per-pixel the
 *  author panel gives a hand-made world block, so a seeded payoff and an
 *  authored one are the same size out of the box. */
const TEMPLATE_WORLD_PER_PX = 0.125 / 32;

/**
 * ONE shape for "a box floating at a marker" (ticket 13): the world caption
 * plane, built here and nowhere else, whether a display template seeds it or
 * the copy floor conjures it — one function, so the two can never diverge by
 * a missed edit.
 *
 * The position is a COPY of the point handed in: an `at: "annotation"` template
 * (or the floor) sharing the annotation's own anchor array would move the
 * marker when the author drags the block. `billboard` is stated rather than
 * left to PlaneLane's `?? "full"` default: the standard output must not read
 * edge-on, and an author opening the inspector should find the knob set to
 * what they are looking at rather than blank.
 */
function worldCaptionBlock(
  id: string,
  content: string,
  position: readonly [number, number, number],
): TextBlock {
  return {
    id,
    content,
    space: "world",
    presentation: "plane",
    styleId: "caption-body",
    // EMPTY on purpose: the box is present because the display channel is
    // showing it, never because a binding matched.
    binding: {},
    placement: {
      position: [...position],
      worldPerPx: TEMPLATE_WORLD_PER_PX,
      billboard: "full",
    },
    transitionMs: 200,
  };
}

/**
 * The default template block a display effect seeds — "the standard output",
 * before the author touches anything (story 29).
 *
 * Shaped as the annotation's own caption block, in the place the effect asked
 * for: the author sees their own copy in the new position and edits from there,
 * rather than being handed a blank.
 *
 * The binding is EMPTY on purpose. A template block is present because the
 * display channel is showing it, never because a binding matched — a binding
 * would put the payoff on screen permanently, without any rule firing.
 */
export function seededDisplayTemplate(
  id: string,
  content: string,
  template: DisplayTemplate,
  anchor: [number, number, number],
): TextBlock {
  if (template.space === "screen") {
    // "left" for the same reason as a seeded caption: the corner the engagement
    // chrome does not occupy, as a starting value the author owns.
    return {
      id,
      content,
      space: "screen",
      presentation: "panel",
      styleId: "caption-body",
      binding: {},
      placement: { slot: "left", order: 1 },
      transitionMs: 200,
    };
  }
  return worldCaptionBlock(id, content, template.position ?? anchor);
}

/**
 * The id the copy floor's conjured box carries for one annotation (ticket 13).
 *
 * RESERVED: pre-flight refuses an authored block here (see normalizeSiteConfig),
 * because the conjured box never enters `site.blocks` — the runtime holds it and
 * hands it to the text system beside the authored blocks, so an authored block
 * at the same id would collide with it in every id-keyed map downstream.
 */
export function conjuredCopyId(annotationId: string): string {
  return `annotation-${annotationId}-copy`;
}

/**
 * The copy floor's conjured box (ticket 13): ONE world-anchored block holding
 * whichever of the marker's title and body the author wrote, title on its own
 * line (A1 — one box, one style; per-run styling reaches no renderer yet, so
 * the title keeping `caption-title` styling inside the box stays on file as a
 * wish, not a shape).
 *
 * The geometry is not invented — it is ticket 05's world template shape,
 * auto-derived: a COPY of the annotation's anchor (never the same array —
 * dragging the block must not move the marker), the seeded template's
 * world-per-px, `billboard: "full"` (A6 — constant apparent size is parked),
 * style `caption-body` with its derived measure. One shape for "a box floating
 * at a marker", whether a template seeded it or the floor conjured it.
 *
 * NEVER stored: not in `site.blocks`, not serialized — the author's doctrine is
 * "it goes in the box. the box contains the copy. they are one thing, not two"
 * (A4). The box derives from `annotation.copy` at show time; edit the copy and
 * the next show carries it.
 *
 * Returns null where there are no words to float — a floor with nothing to
 * show shows nothing.
 */
export function conjuredCopyBlock(annotation: SiteAnnotation): TextBlock | null {
  const title = annotation.copy?.title ?? "";
  const body = annotation.copy?.body ?? "";
  const content = title.length > 0 && body.length > 0 ? `${title}\n${body}` : title || body;
  if (content.length === 0) return null;
  return worldCaptionBlock(conjuredCopyId(annotation.id), content, annotation.anchor);
}

/** Remove `id` from every block's `key` binding; drop blocks whose ONLY reason
 *  to exist was that binding (no other bound entity, no always/range). */
export function unbindBlocksFrom(
  blocks: TextBlock[],
  key: "stops" | "annotations",
  id: string,
): void {
  const otherKey = key === "stops" ? "annotations" : "stops";
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    const bound = block.binding?.[key];
    if (!bound?.includes(id)) continue;
    const remaining = bound.filter((candidate) => candidate !== id);
    const binding = block.binding;
    if (remaining.length === 0 && binding.always !== true
      && binding.range === undefined && (binding[otherKey]?.length ?? 0) === 0) {
      blocks.splice(i, 1);
    } else {
      binding[key] = remaining;
    }
  }
}

// ─── Marker display, rule side (ticket 17) ────────────────
// The rule-shaped replacements for `unbindBlocksFrom(…, "annotations", …)`.
// Binding a block to a marker is retired, so every authoring path that used to
// write or read that leg has to speak in rules instead — including the author
// panel, which re-mints blocks at runtime and would otherwise create content
// that is invisible with no error anywhere.

/** Block ids this annotation's rules display. */
export function blocksShownByAnnotation(annotation: SiteAnnotation): string[] {
  const ids: string[] = [];
  for (const rule of annotation.rules ?? []) {
    for (const effect of rule.do) {
      if (effect.kind !== "show-blocks") continue;
      for (const id of effect.blocks) if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/**
 * Make this annotation display `blockId` when activated.
 *
 * ⚠ STANDBY since ticket 13: its production caller (`upsertAnnotationBlock`,
 * the panel path that minted copy blocks) was retired by A5, so nothing in the
 * shipped toolkit calls this today. It stays because ticket 10's Rules pane is
 * the next authoring surface that wires a block into a marker's rules, and the
 * shadow-prevention contract below (pinned by lm-check §17e) is exactly what
 * that path must not get wrong.
 *
 * Folded into an EXISTING unconditional activate rule where there is one, rather
 * than appended as a new rule. First match wins, so a new rule after an
 * unconditional one could never fire — the author would type a title, see
 * nothing, and have no error to go on. That is the same silent-invisibility this
 * ticket set out to remove, so the authoring path must not reintroduce it.
 *
 * Conditional rules are skipped: folding copy into one would make the copy
 * conditional, which is not what typing a title asks for.
 */
export function showBlockFromAnnotation(annotation: SiteAnnotation, blockId: string): void {
  const rules = (annotation.rules ??= []);
  for (const rule of rules) {
    // Conditional rules are skipped: folding copy into one would make the copy
    // conditional, which is not what typing a title asks for.
    if (rule.on !== "activate" || rule.when !== undefined) continue;
    // The FIRST unconditional activate rule is the one a click always reaches,
    // so this is where the copy has to go — whether or not it already shows
    // something.
    const effect = rule.do.find(
      (candidate): candidate is ShowBlocksEffect => candidate.kind === "show-blocks",
    );
    if (effect === undefined) {
      // ⚠ It matches first but shows nothing — a play-audio-only marker, say.
      // Appending a NEW rule here would put it behind this one, where first-match
      // resolution guarantees it can never fire: the author types a title, sees
      // nothing, and gets no error anywhere. That is the exact failure ticket 17
      // exists to remove, so give THIS rule the effect instead.
      rule.do.push({ kind: "show-blocks", blocks: [blockId] });
    } else if (!effect.blocks.includes(blockId)) {
      effect.blocks.push(blockId);
    }
    return;
  }
  // No unconditional rule at all: nothing can shadow an appended one.
  rules.push({ on: "activate", do: [{ kind: "show-blocks", blocks: [blockId] }] });
}

/**
 * Stop every annotation from displaying `blockId`, dropping effects and then
 * rules that are left with nothing to do.
 *
 * Deleting a block used to be a splice and nothing more, because a binding lived
 * on the block and died with it. A rule lives on the ANNOTATION and outlives it:
 * the next load throws "references unknown block id", and in the meantime the
 * channel can hold a claim naming a block that no longer exists.
 */
export function stopShowingBlock(annotations: readonly SiteAnnotation[], blockId: string): void {
  for (const annotation of annotations) {
    const rules = annotation.rules;
    if (!Array.isArray(rules)) continue;
    for (let r = rules.length - 1; r >= 0; r -= 1) {
      const effects = rules[r].do;
      for (let e = effects.length - 1; e >= 0; e -= 1) {
        const effect = effects[e];
        if (effect.kind !== "show-blocks") continue;
        const remaining = effect.blocks.filter((id) => id !== blockId);
        if (remaining.length === effect.blocks.length) continue;
        // An effect naming nothing is not a legal effect (pre-flight refuses an
        // empty `blocks`), so it goes rather than being emptied.
        if (remaining.length === 0) effects.splice(e, 1);
        else effect.blocks = remaining;
      }
      // ...but a rule keeps its place while it still has other effects to run.
      if (effects.length === 0) rules.splice(r, 1);
    }
    if (rules.length === 0) delete annotation.rules;
  }
}

// ─── Settings pre-flight (ticket 17) ──────────────────────

/** Keys `settings.blocks` may carry, typed against the interface so a key that
 *  isn't a real field is a COMPILE error — the same shape as `KNOWN_CONDITION_KEYS`
 *  and `KNOWN_TEMPLATE_KEYS` in RuleModel, which is where this pattern comes from.
 *  (Not ADR-0001's growth rule: that one is about rule LEGS — a new trigger kind,
 *  condition field or effect kind — and says nothing about settings.) */
const KNOWN_BLOCKS_SETTINGS_KEYS: readonly (keyof SiteBlocksSettings)[] = [
  "takeover",
  "hideStopContent",
];

/** Refuse a value that is present but not a boolean. Absent always passes:
 *  every setting here defaults AT THE READ, so "not written down" is a real and
 *  meaningful state, not a hole to fill. */
function requireOptionalBoolean(at: string, value: unknown): void {
  if (value === undefined || typeof value === "boolean") return;
  throw new Error(`SiteConfig: ${at} must be true or false (got ${JSON.stringify(value)})`);
}

/**
 * Pre-flight for `settings.blocks` — the ticket-17 blocks-channel defaults.
 *
 * Shaped after `validateModeLocks`: pure, `unknown`-typed, called from the tail
 * of normalize, and living in the module that owns the vocabulary it checks.
 *
 * This is the ONE settings object in the file that REFUSES an unknown key, and
 * it can only be this one: `settings.blocks` is brand new, so no file that
 * loads today can carry anything in it. Its neighbours cannot be closed after
 * the fact — `settings` legitimately carries legacy keys that normalize accepts
 * and deletes (`caption`, `editorial`), and `settings.text` has been permissive
 * since it shipped, so a whitelist there would retroactively refuse files that
 * load right now. A misspelled `takover` would otherwise sit in the file
 * looking authoritative while the channel used the default (ADR-0001: rejected
 * at load, never ignored).
 */
export function validateBlocksSettings(blocks: unknown): void {
  if (blocks === undefined) return;
  if (typeof blocks !== "object" || blocks === null || Array.isArray(blocks)) {
    throw new Error(
      `SiteConfig: settings.blocks must be an object — known keys: ${KNOWN_BLOCKS_SETTINGS_KEYS.join(", ")}`,
    );
  }
  const record = blocks as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(KNOWN_BLOCKS_SETTINGS_KEYS as readonly string[]).includes(key)) {
      throw new Error(
        `SiteConfig: settings.blocks has unknown key "${key}"`
        + ` — known keys: ${KNOWN_BLOCKS_SETTINGS_KEYS.join(", ")}`,
      );
    }
  }
  requireOptionalBoolean("settings.blocks.takeover", record.takeover);
  requireOptionalBoolean("settings.blocks.hideStopContent", record.hideStopContent);
}

/**
 * Pre-flight for `settings.text.collapseOnNarrow` (ticket 17, Rule D).
 *
 * Deliberately NOT a whitelist over `settings.text`: that object predates this
 * ticket and closing it now would refuse files that load today (see
 * `validateBlocksSettings`). Only the one new field is checked.
 */
export function validateTextSettings(text: unknown): void {
  if (text === undefined || typeof text !== "object" || text === null) return;
  requireOptionalBoolean(
    "settings.text.collapseOnNarrow",
    (text as Record<string, unknown>).collapseOnNarrow,
  );
}

// ─── Normalization ────────────────────────────────────────

/**
 * Fill defaults and coerce a parsed JSON value into a SiteConfig.
 * Throws with a descriptive message on structurally invalid input.
 */
export function normalizeSiteConfig(
  input: unknown,
  opts: {
    requireExplicitStopIds?: boolean;
    /** Rule-handler names the consuming site has registered (D31 `custom`).
     *  A `custom` effect naming something absent here WARNS — the scene still
     *  loads, and dispatch is where it becomes an error. ABSENT means the caller
     *  has no registry information at all, so nothing is warned about: only a
     *  caller that really knows its handlers can say a name is missing. */
    registeredHandlers?: readonly string[];
  } = {},
): SiteConfig {
  if (typeof input !== "object" || input === null) {
    throw new Error("SiteConfig: input is not an object");
  }
  const raw = input as Partial<SiteConfig>;
  if (!Array.isArray(raw.scenes) || raw.scenes.length === 0) {
    throw new Error("SiteConfig: at least one scene is required");
  }
  if (!Array.isArray(raw.stops)) {
    throw new Error("SiteConfig: stops must be an array");
  }
  const stopIds = new Set<string>();
  for (const stop of raw.stops) {
    if (stop.id === undefined) continue;
    if (stopIds.has(stop.id)) {
      throw new Error(
        `SiteConfig: duplicate stop id "${stop.id}" — stop ids must be unique (bindings, variants, and seeded block ids all key on them)`,
      );
    }
    stopIds.add(stop.id);
  }
  if (opts.requireExplicitStopIds) {
    for (const [i, stop] of raw.stops.entries()) {
      if (stop.id === undefined) throw new Error(
        `SiteConfig: stop at index ${i} ("${stop.label}") has no explicit id — publishable configs require explicit stop ids (a generated id shifts on reorder, breaking public URLs)`);
    }
  }
  for (const [index, stop] of raw.stops.entries()) {
    if (stop.id === undefined) {
      let n = index;
      while (stopIds.has(`stop-${n}`)) n++;
      stop.id = `stop-${n}`;
      stopIds.add(stop.id);
    }
    const cam = (stop as SiteStop).camera as CameraState | undefined;
    if (
      !cam ||
      typeof cam.yaw !== "number" ||
      typeof cam.pitch !== "number" ||
      typeof cam.distance !== "number" ||
      typeof cam.pivot?.x !== "number"
    ) {
      throw new Error(
        `SiteConfig: stop "${(stop as SiteStop).label ?? "?"}" is missing a valid camera state`,
      );
    }
  }
  // Prop ids must be unique ACROSS scenes, not just within one: PropLayer keys a
  // single global slot map by id, so two same-id props (even in different scenes)
  // silently reconcile into one live root — editing one moves the other.
  const propIds = new Set<string>();
  for (const scene of raw.scenes) {
    if (!scene.props) continue;
    for (const prop of scene.props) {
      if (propIds.has(prop.id)) {
        throw new Error(
          `SiteConfig: duplicate prop id "${prop.id}" — prop ids must be unique across all scenes (the prop layer and selection key on them)`,
        );
      }
      propIds.add(prop.id);
      prop.scale ??= 1;
      prop.rotationDeg ??= [0, 0, 0];
    }
  }
  const obstacleIds = new Set<string>();
  for (const box of raw.obstacles ?? []) {
    if (obstacleIds.has(box.id)) {
      throw new Error(
        `SiteConfig: duplicate obstacle id "${box.id}" — obstacle ids must be unique (selection keys on them)`,
      );
    }
    obstacleIds.add(box.id);
  }
  const annotationIds = new Set<string>();
  for (const annotation of raw.annotations ?? []) {
    if (annotationIds.has(annotation.id)) {
      throw new Error(
        `SiteConfig: duplicate annotation id "${annotation.id}" — annotation ids must be unique (bindings and seeded block ids key on them)`,
      );
    }
    annotationIds.add(annotation.id);
  }
  const mediaIds = new Set<string>();
  for (const m of raw.media ?? []) {
    if (mediaIds.has(m.id)) throw new Error(`SiteConfig: duplicate media id "${m.id}" — media ids must be unique`);
    mediaIds.add(m.id);
  }
  // The audio list (D31). Validated HERE rather than beside the rules because a
  // malformed sound is why the rule referencing it fails — reporting the rule
  // first would point the author at the symptom.
  if (raw.audio !== undefined && !Array.isArray(raw.audio)) {
    throw new Error("SiteConfig: audio must be an array of sounds");
  }
  const audioIds = new Set<string>();
  for (const sound of raw.audio ?? []) {
    if (typeof sound !== "object" || sound === null) {
      throw new Error("SiteConfig: every audio entry must be an object with an id and a url");
    }
    if (typeof sound.id !== "string" || sound.id === "") {
      throw new Error("SiteConfig: every audio entry needs a non-empty string id — rules play a sound by name");
    }
    if (audioIds.has(sound.id)) {
      throw new Error(`SiteConfig: duplicate audio id "${sound.id}" — audio ids must be unique`);
    }
    audioIds.add(sound.id);
    if (typeof sound.url !== "string" || sound.url === "") {
      throw new Error(`SiteConfig: audio "${sound.id}" needs a non-empty url`);
    }
    // Range-checked rather than clamped: a volume of 11 is a typo, and silently
    // playing it at 1 would hide the mistake from the author who wrote it.
    if (sound.volume !== undefined
      && (typeof sound.volume !== "number" || !Number.isFinite(sound.volume)
        || sound.volume < 0 || sound.volume > 1)) {
      throw new Error(`SiteConfig: audio "${sound.id}" volume must be a number from 0 to 1`);
    }
  }
  const splatText = raw.splatText ?? [];
  const splatTextIds = new Set<string>();
  for (const item of splatText) {
    if (splatTextIds.has(item.id)) {
      // Without this, two same-id items with equal text but different positions
      // would silently collapse through the already-migrated signature skip.
      throw new Error(
        `SiteConfig: duplicate splatText id "${item.id}" — splatText ids must be unique`,
      );
    }
    splatTextIds.add(item.id);
  }
  for (const item of splatText) {
    const hadSize = item.size != null;
    item.detail ??= item.fontSize ?? 32;
    item.size ??= ((item.lineHeightWorld ?? 0.15) / 1.2) * (item.scale ?? 1);
    // The ??= above only folds a legacy `scale` in when it derives `size` from
    // scratch. If `size` was already authored but a stray `scale` is also
    // present (a hand-edited/transitional file), fold it here too — otherwise
    // the `delete item.scale` below drops the multiplier silently.
    if (hadSize && item.scale != null) item.size *= item.scale;
    item.lineSpacing ??= 1.2;
    item.wrapWidth ??= item.maxWidthPx == null
      ? undefined
      : (item.maxWidthPx * (item.lineHeightWorld ?? 0.15) * (item.scale ?? 1)) /
        (1.2 * (item.fontSize ?? 32));
    delete item.fontSize;
    delete item.lineHeightWorld;
    delete item.maxWidthPx;
    delete item.scale;
  }
  const styles = raw.styles ?? [];
  // Style ids must be unique: resolve() looks styles up with find() (first
  // match) while chainOf builds a Map (last match wins) — duplicates make the
  // renderer and the basedOn walker disagree, and every id-keyed authoring
  // surface (style manager, inspector selection) breaks with them. Keep the
  // FIRST occurrence (matching find()) and drop the rest.
  for (let i = styles.length - 1; i >= 0; i -= 1) {
    const first = styles.findIndex((candidate) => candidate.id === styles[i].id);
    if (first !== i) {
      console.warn(`SiteConfig: dropping duplicate style id "${styles[i].id}" (first definition wins)`);
      styles.splice(i, 1);
    }
  }
  if (!styles.some((style) => style.id === "body")) {
    styles.push({ id: "body", name: "Body", base: {} });
  }
  const blocks = raw.blocks ?? [];
  const styleIds = new Set(styles.map((style) => style.id));
  for (const block of blocks) {
    if (block.styleId && !styleIds.has(block.styleId)) {
      console.warn(
        `SiteConfig: block "${block.id}" references unknown style "${block.styleId}"`,
      );
    }
    // Renderer choice is presentation-driven; space is bookkeeping that other
    // paths (resize, raycast targets) key on. Derive it when absent and refuse
    // a contradiction — a "world panel" mounts as DOM yet is skipped elsewhere.
    const expectedSpace = block.presentation === "splat" || block.presentation === "plane"
      ? "world"
      : "screen";
    (block as { space?: string }).space ??= expectedSpace;
    if (block.space !== expectedSpace) {
      throw new Error(
        `SiteConfig: block "${block.id}" has space "${block.space}" but presentation "${block.presentation}" requires "${expectedSpace}"`,
      );
    }
    const placement = block.placement as unknown;
    const isObject = typeof placement === "object" && placement !== null;
    const placementRecord = isObject ? placement as Record<string, unknown> : {};
    if (block.presentation === "free") {
      // A malformed rect is not a style disagreement — it multiplies into NaN
      // geometry downstream (FreeLane sizes the element from these numbers).
      const rect = placementRecord.rect as Record<string, unknown> | undefined;
      const finite = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value);
      if (!rect || !finite(rect.x) || !finite(rect.y) || !finite(rect.width) || !finite(rect.height)) {
        throw new Error(
          `SiteConfig: free block "${block.id}" needs placement.rect with finite x/y/width/height numbers`,
        );
      }
    }
    // A panel names ONE OF THE KNOWN SLOTS (ticket 06). Not merely "a string":
    // every panel carries a slot the toolkit obeys, so an absent or misspelled
    // one has no answer — and the check that used to accept any string is what
    // would let a hand-written file, or a file exported during `auto`'s brief
    // life, reintroduce an unplaced panel through the back door.
    if (block.presentation === "panel"
      && !PANEL_SLOTS.some((slot) => slot === placementRecord.slot)) {
      throw new Error(
        `SiteConfig: panel block "${block.id}" needs placement.slot — one of ${PANEL_SLOTS.join(", ")}`
        + ` (got ${JSON.stringify(placementRecord.slot)})`,
      );
    }
    // The per-panel narrow-screen override (ticket 17, Rule D). Checked here
    // rather than in a settings validator because this is the only walk that
    // holds a block id for the message. Refused rather than coerced: `"false"`
    // read as truthy would keep collapsing a panel the author opted out of, and
    // the symptom only appears on a phone.
    if (placementRecord.collapse !== undefined && typeof placementRecord.collapse !== "boolean") {
      throw new Error(
        `SiteConfig: block "${block.id}" placement.collapse must be true or false`
        + ` (got ${JSON.stringify(placementRecord.collapse)})`,
      );
    }
    const placementMatches = block.presentation === "panel"
      // Already guaranteed by the PANEL_SLOTS check above — kept as `true` rather
      // than a second, weaker test that could only ever disagree with it.
      ? true
      : block.presentation === "free"
        ? typeof placementRecord.rect === "object" && placementRecord.rect !== null
        : block.presentation === "columns"
          ? isObject &&
            !("slot" in placementRecord) &&
            !("rect" in placementRecord) &&
            !("position" in placementRecord) &&
            !("worldPerPx" in placementRecord) &&
            (placementRecord.regions === undefined || Array.isArray(placementRecord.regions))
          : block.presentation === "splat" || block.presentation === "plane"
            ? Array.isArray(placementRecord.position) &&
              typeof placementRecord.worldPerPx === "number"
            : false;
    if (!placementMatches) {
      console.warn(
        `SiteConfig: block "${block.id}" presentation "${block.presentation}" has incompatible placement`,
      );
    }
  }
  for (const style of styles) {
    if (style.basedOn && !styleIds.has(style.basedOn)) {
      console.warn(
        `SiteConfig: style "${style.id}" is based on unknown style "${style.basedOn}"`,
      );
    }
  }
  const settings = raw.settings ?? {};
  // keep in sync with TextLayout.DEFAULT_FONT_STACK; do not pull UI/Pretext into this bundle.
  const DEFAULT_STACK = '"DM Sans", Helvetica, Arial, sans-serif';
  settings.typography = {
    fontFamily: DEFAULT_STACK,
    baseSizePx: 16,
    scaleRatio: 1.25,
    lineHeight: 1.5,
    measureCh: 66,
    ...settings.typography,
  };
  const tokens = settings.typography;
  const cap = settings.caption;
  const titleSize = cap?.titleSizePx ?? Math.round(tokens.baseSizePx! * tokens.scaleRatio!);
  if (!styles.some((style) => style.id === "caption-body")) {
    // Pitch is DERIVED (unitless lineHeight × size), never baked to px — baking
    // orphaned the pitch from every later size change and shadowed the
    // typography token forever (review finding 8).
    const base: TextStyle["base"] = {
      color: cap?.color ?? "#ffffff",
      measurePx: 278,
    };
    if (cap?.lineHeight !== undefined) base.lineHeight = cap.lineHeight;
    if (cap?.weight !== undefined) base.weight = cap.weight;
    if (cap?.bodySizePx !== undefined) base.sizePx = cap.bodySizePx;
    if (cap?.trackingEm !== undefined) base.trackingEm = cap.trackingEm;
    if (cap?.fontFamily !== undefined) base.fontFamily = cap.fontFamily;
    if (cap?.align !== undefined) base.align = cap.align;
    if (cap?.measureCh !== undefined) {
      base.measureCh = cap.measureCh;
      delete base.measurePx;
    }
    styles.push({
      id: "caption-body",
      name: "Caption Body",
      basedOn: "body",
      base,
    });
  }
  if (!styles.some((style) => style.id === "caption-title")) {
    styles.push({
      id: "caption-title",
      name: "Caption Title",
      basedOn: "caption-body",
      base: {
        weight: 600,
        sizePx: titleSize,
        // Derived pitch: legacy recomputed round(titleSize × 1.4) on every size
        // change — unitless keeps that behavior live as the slider moves.
        lineHeight: 1.4,
        spaceAfterPx: 12,
      },
    });
  }
  const ed = settings.editorial;
  if (!styles.some((style) => style.id === "editorial")) {
    const base: TextStyle["base"] = { sizePx: 15, lineHeightPx: 22 };
    if (ed?.fontSizePx !== undefined) base.sizePx = ed.fontSizePx;
    if (ed?.lineHeightPx !== undefined) base.lineHeightPx = ed.lineHeightPx;
    styles.push({ id: "editorial", name: "Editorial", basedOn: "body", base });
  }
  /** Flattened text of a block — runs are supported content and render flattened. */
  const blockText = (candidate: TextBlock): string =>
    typeof candidate.content === "string"
      ? candidate.content
      : candidate.content.map((run) => run.text).join("");
  // A reserved-id holder counts as "this entity's migrated copy" only when it
  // looks like what the migration creates: a screen-text block bound to the
  // entity. Binding alone is not proof — a world/splat block bound to it must
  // not cause the legacy copy to be deleted unseeded.
  const isSeededCopyArtifact = (
    candidate: TextBlock,
    bindingKey: "stops" | "annotations",
    id: string,
  ): boolean =>
    candidate.space === "screen"
    && isScreenPresentation(candidate.presentation)
    && candidate.binding?.[bindingKey]?.includes(id) === true;
  const isMigratedTextArtifact = (candidate: TextBlock, sid: string): boolean =>
    isSeededCopyArtifact(candidate, "stops", sid);
  for (const stop of raw.stops) {
    const sid = stop.id!;
    const editorialId = `editorial-${sid}`;
    const existingEditorial = blocks.find((block) => block.id === editorialId);
    if (existingEditorial && !isMigratedTextArtifact(existingEditorial, sid)) {
      throw new Error(
        `SiteConfig: block id "${editorialId}" is reserved for stop "${sid}" editorial copy but is used by an unrelated block`,
      );
    }
    // A caption-mode stop's copy belongs to the CAPTION loop — an editorial block
    // bound to this stop must never cause the copy to be deleted unseeded.
    if (stop.mode !== "editorial") continue;
    if (existingEditorial) {
      const authored = stop.copy?.body ?? stop.editorialCopy;
      // Compare FLATTENED text: runs are supported block content and render flattened.
      if (typeof authored === "string" && authored.length > 0
        && blockText(existingEditorial) !== authored) {
        throw new Error(
          `SiteConfig: stop "${sid}" carries editorial copy that conflicts with existing block "${editorialId}" — remove the legacy copy or the block`,
        );
      }
    } else {
      const placement: Record<string, unknown> = {};
      // Clone per stop: sharing one regions array aliases edits across every
      // editorial block in-session, then silently diverges after a JSON round-trip.
      if (ed?.columns && ed.columns.length > 0) {
        placement.regions = ed.columns.map((column) => ({ ...column }));
      }
      if (ed?.minSlotWidthPx !== undefined && ed.minSlotWidthPx !== 140) {
        placement.minSlotWidthPx = ed.minSlotWidthPx;
      }
      blocks.push({
        id: editorialId,
        content: stop.copy?.body ?? stop.editorialCopy ?? "",
        space: "screen",
        presentation: "columns",
        styleId: "editorial",
        binding: { stops: [sid] },
        placement,
      } as TextBlock);
    }
    delete stop.copy;
    delete stop.editorialCopy;
    delete stop.mode;
  }
  delete settings.editorial;
  if (!styles.some((style) => style.id === "splat-text")) {
    styles.push({
      id: "splat-text",
      name: "Splat Text",
      basedOn: "body",
      base: { sizePx: 32, lineHeight: 1.2 },
    });
  }
  for (const item of splatText) {
    const size = item.size ?? 0.125;
    const detail = item.detail ?? 32;
    const lineSpacing = item.lineSpacing ?? 1.2;
    const existingSplat = blocks.find((block) => block.id === item.id);
    if (existingSplat) {
      // Only the full migration signature (world splat, always binding, SAME text)
      // counts as "this item was already migrated". Normalize strips splatText from
      // its output, so a collision here is always a hand-edited file — and a holder
      // with different text is two conflicting sources of truth, not a duplicate.
      // Refuse instead of silently losing either text.
      if (existingSplat.space === "world"
        && existingSplat.presentation === "splat"
        && existingSplat.binding?.always === true
        && existingSplat.content === item.text) continue;
      throw new Error(
        `SiteConfig: splatText item "${item.id}" collides with an existing "${existingSplat.presentation}" block of the same id`,
      );
    }
    const overrides: TextStyle["base"] = {};
    if (detail !== 32) overrides.sizePx = detail;
    if (lineSpacing !== 1.2) overrides.lineHeight = lineSpacing;
    if (item.font !== undefined) overrides.fontFamily = item.font;
    if (item.color !== undefined) overrides.color = item.color;
    if (item.textAlign !== undefined) overrides.align = item.textAlign;
    if (item.wrapWidth !== undefined && item.wrapWidth > 0) {
      overrides.measurePx = (item.wrapWidth * detail) / size;
    }
    const placement: WorldPlacement = {
      position: item.position,
      worldPerPx: size / detail,
    };
    if (item.rotationDeg !== undefined) placement.rotationDeg = item.rotationDeg;
    if (item.billboard !== undefined) placement.billboard = item.billboard;
    if (item.dotRadius !== undefined) placement.dotRadius = item.dotRadius;
    const block: TextBlock = {
      id: item.id,
      content: item.text,
      space: "world",
      presentation: "splat",
      styleId: "splat-text",
      binding: { always: true },
      placement,
    };
    if (Object.keys(overrides).length > 0) block.overrides = overrides;
    blocks.push(block);
  }
  for (const stop of raw.stops) {
    if (stop.mode === "editorial" || !stop.copy) continue;
    const sid = stop.id!;
    const copy = stop.copy;
    const titleId = `stop-${sid}-title`;
    const bodyId = `stop-${sid}-body`;
    // "Already migrated" is recognized by the migration-artifact shape (screen-text
    // presentation + binding to this stop), not by id alone — a foreign block
    // squatting on a reserved id must not cause the copy to be deleted below
    // without ever being seeded.
    for (const [reservedId, authored] of [[titleId, copy.title], [bodyId, copy.body]] as const) {
      const holder = blocks.find((block) => block.id === reservedId);
      if (!holder) continue;
      if (!isMigratedTextArtifact(holder, sid)) {
        throw new Error(
          `SiteConfig: block id "${reservedId}" is reserved for stop "${sid}" caption copy but is used by an unrelated block`,
        );
      }
      // Normalize deletes stop.copy at migration, so copy coexisting with a
      // recognized block is a hand edit — two sources of truth. Same policy as
      // editorial: refuse instead of silently preferring either.
      if (typeof authored === "string" && authored.length > 0 && blockText(holder) !== authored) {
        throw new Error(
          `SiteConfig: stop "${sid}" carries caption copy that conflicts with existing block "${reservedId}" — remove the legacy copy or the block`,
        );
      }
    }
    if (typeof copy.title === "string" && copy.title.length > 0
      && !blocks.some((block) => block.id === titleId)) {
      blocks.push(seededCaptionBlock("title", titleId, copy.title, { stops: [sid] }));
    }
    if (!blocks.some((block) => block.id === bodyId)) {
      blocks.push(seededCaptionBlock("body", bodyId, copy.body, { stops: [sid] }));
    }
    delete stop.copy;
  }
  // Annotation copy is NOT materialized as blocks any more (ticket 13). The
  // load-time seeding that minted `annotation-<id>-title/-body` screen panels —
  // the edge-panel default the author called "altogether terrible" — is gone,
  // along with the recognizer that told those artifacts from squatters. copy
  // stays on the annotation: markers need it for accessible names, and the copy
  // floor floats it in a conjured world box at activation (`conjuredCopyBlock`).
  // The old ids are ordinary block ids now; leftover panels in files written
  // before this are ordinary authored blocks, shown by whatever rules name them
  // (the binding→rule conversion below still covers the pre-17 shape).
  //
  // What IS reserved is the conjured box's own id: it never enters this list,
  // so an authored block there would collide with it in every id-keyed map the
  // moment that marker's floor fired — silently, in the text system. Refused at
  // load like every other reserved id.
  for (const annotation of raw.annotations ?? []) {
    const conjuredId = conjuredCopyId(annotation.id);
    if (blocks.some((block) => block.id === conjuredId)) {
      throw new Error(
        `SiteConfig: block id "${conjuredId}" is reserved for annotation "${annotation.id}"'s floating copy (the toolkit conjures that box at activation) — rename the block`,
      );
    }
  }
  // Display-effect templates (D31). Seeded AFTER the copy blocks, so a template
  // can mirror the annotation's copy, and BEFORE the rule pre-flight at the
  // bottom, which is what checks that every referenced block exists.
  //
  // This pass acts ONLY on an already-well-formed seed spec and silently skips
  // anything else: rules are still unvalidated here, and validateAnnotationRules
  // reports a malformed one with a message naming the offending piece. The one
  // thing it refuses itself is the collision — a reserved id already held by an
  // unrelated block. Seeding on top of that would merge two authors' content
  // into one block; leaving it would point the effect at a stranger's block.
  //
  // ⚠ The guards below are LOOSER than validateTemplate's contract on purpose —
  // they only have to be tight enough not to crash. A spec this pass accepts and
  // the validator rejects (a world template naming both `at` and `position`, say)
  // gets a block built and then thrown away with the whole config, because the
  // validation call at the bottom is unconditional. Move that call, or make it
  // conditional, and this pass needs the validator's exclusivity checks too.
  const isPoint = (value: unknown): value is [number, number, number] =>
    Array.isArray(value) && value.length === 3
    && value.every((n) => typeof n === "number" && Number.isFinite(n));
  /** A reserved id is legitimately a display template only when nothing BINDS
   *  the block there — a template's presence is the display channel's job. A
   *  bound block on that id is somebody's ordinary content (same recognition
   *  rule as the seeded-copy guard, keyed on what makes the artifact). */
  const isTemplateHolder = (candidate: TextBlock): boolean => {
    const binding = candidate.binding as BlockBinding | undefined;
    return binding?.always !== true
      && (binding?.stops?.length ?? 0) === 0
      && (binding?.annotations?.length ?? 0) === 0
      && binding?.range === undefined;
  };
  for (const annotation of raw.annotations ?? []) {
    const prefix = displayTemplatePrefix(annotation.id);
    const rules: unknown[] = Array.isArray(annotation.rules) ? annotation.rules : [];
    for (const rule of rules) {
      const effects = (rule as { do?: unknown } | null)?.do;
      if (!Array.isArray(effects)) continue;
      for (const effect of effects as unknown[]) {
        if (typeof effect !== "object" || effect === null) continue;
        const record = effect as Record<string, unknown>;
        if (record.kind !== "show-blocks") continue;
        const template = record.template as DisplayTemplate | undefined;
        if (typeof template !== "object" || template === null) continue;
        if (template.space !== "screen" && template.space !== "world") continue;
        const anchor = template.position ?? annotation.anchor;
        if (template.space === "world" && !isPoint(anchor)) continue;
        const ids = record.blocks;
        if (!Array.isArray(ids) || ids.length !== 1 || typeof ids[0] !== "string") continue;
        const id = ids[0] as string;
        if (!id.startsWith(prefix) || id.length === prefix.length) continue;
        const holder = blocks.find((block) => block.id === id);
        if (holder) {
          if (!isTemplateHolder(holder)) {
            throw new Error(
              `SiteConfig: block id "${id}" is reserved for annotation "${annotation.id}" display effects but is used by an unrelated block`,
            );
          }
          // The author's own template, already adjusted/restyled/replaced.
          // Seeding is a fill-the-empty-slot job, never an overwrite.
          continue;
        }
        blocks.push(seededDisplayTemplate(
          id,
          annotation.copy?.body ?? "",
          template,
          anchor as [number, number, number],
        ));
      }
    }
  }
  // ─── Retire binding-to-a-marker (ticket 17) ──────────────
  //
  // Two mechanisms used to show text when a marker was clicked: a block could be
  // BOUND to the annotation, or a rule on the annotation could name the block.
  // The runtime picked between them by whether the marker had a matching rule —
  // so adding a rule to a marker silently switched off anything bound to it,
  // with no warning anywhere. Nobody designed that; it fell out of one `if`.
  //
  // One mechanism survives: the marker's rules. Every binding becomes a rule
  // here, at load, so a file written the old way keeps working and the runtime
  // has only one thing to consult.
  //
  // ⚠ ONE RULE PER ANNOTATION, NOT ONE PER BLOCK. Seeding above creates TWO
  // blocks for an annotation with copy (title and body) and `resolveRule`
  // returns the FIRST match. One unconditional rule per block would therefore
  // mean the title's rule always matched and the body's rule was never reached —
  // every marker in the site would silently lose its body copy, while every
  // count- and leg-based check still passed. Collecting the ids and appending
  // ONE effect naming them together is also the behaviour-preserving transform,
  // because the binding showed title and body simultaneously.
  //
  // ⚠ APPENDED, never prepended. First match wins, so appending reproduces
  // today's behaviour exactly: a marker whose earlier rule already matched never
  // showed its bound blocks, and that earlier rule still shadows this one; a
  // marker whose rules all missed fell through to its copy, and now this rule is
  // what matches. It also keeps positional rule indices valid for anything that
  // asserts rule order.
  //
  // ⚠ POSITION. After the STOP-caption seeding, or it misses the blocks the
  // toolkit itself just minted (annotation-copy seeding is gone — ticket 13 —
  // so stop captions are the seeded blocks that remain). After the
  // display-template pass, because that pass
  // identifies a template partly BY the absence of every binding leg — running
  // first would let a hand-authored annotation-bound block at an effect id be
  // silently adopted as somebody's template. Before the duplicate-id check and
  // before `validateAnnotationRules`, so the rules appended here are validated
  // like any other.
  //
  // ⚠ SCOPE: `blocks` only. `site.media` entries carry a binding of the SAME
  // TYPE with the same `annotations` leg, and media binding to a marker is NOT
  // retired — it is one of the two things selection still drives. Sweeping it in
  // would break the capability this ticket set out to protect.
  {
    const annotationsById = new Map(
      (raw.annotations ?? []).map((annotation) => [annotation.id, annotation]),
    );
    /** Block ids each annotation must now show, in block order. */
    const converted = new Map<string, string[]>();
    for (const block of blocks) {
      const bound = block.binding?.annotations;
      if (!Array.isArray(bound) || bound.length === 0) continue;
      for (const aid of bound) {
        // Nothing reference-checked this leg before, so a file naming an
        // annotation that does not exist loads fine today — and the transform
        // has no annotation to append a rule to. Refuse, naming both, which is
        // what every other reference check in this function does. Silently
        // dropping the leg would delete the author's content with no message.
        if (!annotationsById.has(aid)) {
          throw new Error(
            `SiteConfig: block "${block.id}" is bound to unknown annotation "${aid}"`
            + ` — a block may only be bound to an annotation the site has`,
          );
        }
        const ids = converted.get(aid);
        if (ids) ids.push(block.id);
        else converted.set(aid, [block.id]);
      }
      delete block.binding.annotations;
    }
    for (const [aid, blockIds] of converted) {
      const annotation = annotationsById.get(aid)!;
      const rules = (annotation.rules ??= []);
      rules.push({ on: "activate", do: [{ kind: "show-blocks", blocks: blockIds }] });
    }
  }
  delete settings.caption;
  settings.grade = {
    enabled: false,
    exposure: 1,
    contrast: 1,
    saturation: 1,
    temperature: 0,
    tint: 0,
    vignette: 0,
    grain: 0,
    ...settings.grade,
  };
  // After ALL seeding: block ids must be unique — TextSystem keys every mounted/
  // pending map by id and resolves via first-match, so a duplicate means one
  // block never renders and the other churns through dispose/remount every sync.
  const blockIds = new Set<string>();
  for (const block of blocks) {
    if (blockIds.has(block.id)) {
      throw new Error(`SiteConfig: duplicate block id "${block.id}" — block ids must be unique`);
    }
    blockIds.add(block.id);
  }
  // Annotation rules validate AFTER all seeding: a template block a rule
  // references exists only once the template pass above has run (marker copy is
  // no longer seeded at all — ticket 13). Stops come through for the condition
  // vocabulary's reference integrity — a rule or presence clause may only name
  // a stop the site actually has.
  validateAnnotationRules(raw.annotations ?? [], blocks, raw.stops ?? [], {
    audio: raw.audio ?? [],
    registeredHandlers: opts.registeredHandlers,
  });
  // Locks AFTER the rules: the locked-start check reads every rule's effects
  // looking for a grant, and it may only trust their shapes once the pass above
  // has vouched for them.
  validateModeLocks(settings.lockedModes, raw.annotations ?? []);
  // The ticket-17 settings, checked here for the same reason every other
  // vocabulary check runs at the tail: one place an author can point at when
  // a load is refused. Order among these three does not matter — they read
  // disjoint objects and none depends on seeding.
  validateBlocksSettings(settings.blocks);
  validateTextSettings(settings.text);
  return {
    version: 1,
    name: raw.name ?? "untitled-site",
    settings,
    scenes: raw.scenes,
    stops: raw.stops,
    blocks,
    styles,
    obstacles: raw.obstacles ?? [],
    annotations: raw.annotations ?? [],
    ...(raw.media !== undefined ? { media: raw.media } : {}),
    ...(raw.audio !== undefined ? { audio: raw.audio } : {}),
  };
}

// ─── Serialization ────────────────────────────────────────

export function serializeSiteConfig(site: SiteConfig): string {
  return JSON.stringify(site, null, 2) + "\n";
}

/** Trigger a browser download of the site as JSON. */
export function downloadSiteConfig(site: SiteConfig, filename = "site.json"): void {
  const blob = new Blob([serializeSiteConfig(site)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
