/** A normalized screen rectangle in viewport fractions (0..1), with a top-left origin. */
export interface ScreenRectNorm {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TypeStyleLayer {
  /** 1 · Character / micro */
  fontFamily?: string;
  weight?: number;
  width?: number;
  slant?: number;
  italic?: boolean;
  opticalSize?: number | "auto";
  axes?: Record<string, number>;
  sizePx?: number;
  lineHeight?: number;
  lineHeightPx?: number;
  trackingEm?: number;
  wordSpacingEm?: number;
  transform?: "none" | "uppercase" | "lowercase" | "capitalize";
  underline?: boolean;
  strikethrough?: boolean;
  underlineOffsetPx?: number;
  decorationThicknessPx?: number;
  decorationColor?: string;
  decorationStyle?: "solid" | "double" | "dotted" | "dashed" | "wavy";
  baselineShiftPx?: number;
  color?: string;
  shadow?: string;

  /** 2 · Paragraph / macro */
  measureCh?: number;
  measurePx?: number;
  align?: "left" | "center" | "right" | "justify";
  lastLineAlign?: "auto" | "left" | "center" | "right" | "justify";
  spaceBeforePx?: number;
  spaceAfterPx?: number;
  indentFirstLinePx?: number;
  indentLeftPx?: number;
  indentRightPx?: number;
  textWrap?: "wrap" | "balance" | "pretty";
  lineBreak?: "auto" | "loose" | "normal" | "strict";
  hyphens?: boolean;
  hangingPunctuation?: boolean;
  orphans?: number;
  widows?: number;
  initialLetter?: { lines: number; raise?: number };

  /** 3 · OpenType features */
  ligatures?: "none" | "common" | "all";
  numeralStyle?: "lining" | "oldstyle";
  numeralSpacing?: "proportional" | "tabular";
  fractions?: boolean;
  slashedZero?: boolean;
  ordinals?: boolean;
  caps?: "normal" | "small-caps" | "all-small-caps" | "petite-caps" | "unicase" | "titling-caps";
  stylisticSets?: number[];
  characterVariants?: number[];
  swash?: boolean;
  contextualAlternates?: boolean;
  kerning?: boolean;
  positionVariant?: "normal" | "super" | "sub";

  /** 4 · Rhythm */
  baselineGridPx?: number;
  leadingTrim?: "none" | "both" | "start" | "end";

  /** 5 · Columns & frame (in-block) */
  columnCount?: number;
  columnWidthPx?: number;
  columnGapPx?: number;
  columnRule?: { widthPx: number; style: "solid" | "dotted" | "dashed"; color: string };
  columnSpanFirst?: boolean;
  frameVerticalAlign?: "top" | "center" | "bottom" | "justify";
  autoSize?: "none" | "height" | "both";

  /** 6 · Wrap & spatial flow */
  wrapMarginPx?: number;
  wrapShape?: {
    shape: "rect" | "circle";
    rect: ScreenRectNorm;
    marginPx?: number;
    float: "left" | "right";
  };

  /** 7 · H&J detail */
  textJustify?: "auto" | "inter-word" | "inter-character";
  hyphenateLimitChars?: [number, number, number];

  /** 8 · Keeps & breaks */
  breakInside?: "auto" | "avoid";
  breakBefore?: "auto" | "column";

  /** 9 · Specials */
  firstLine?: TypeStyleLayer;
}

export interface InlineRun {
  text: string;
  overrides?: TypeStyleLayer;
  /** Optional link. Screen lanes render as `<a href>` (P1); world lanes use the
   *  block-level href, not per-run (P1). Fragment links (`#stop:x`) → routing (P1). */
  href?: string;
}

export interface TextStyle {
  id: string;
  name: string;
  basedOn?: string;
  base: TypeStyleLayer;
  variants?: StyleVariant[];
}

export interface StyleVariant {
  when: VariantCondition;
  layer: TypeStyleLayer;
}

export type EaseName = "linear" | "ease-in" | "ease-out" | "ease-in-out";

export interface VariantCondition {
  minWidthPx?: number;
  maxWidthPx?: number;
  minHeightPx?: number;
  maxHeightPx?: number;
  state?: "hover" | "selected";
  stopId?: string;
  progress?: { from: number; to: number; ease?: EaseName };
  placeId?: string;
  distanceM?: { from: number; to: number; ease?: EaseName };
  tier?: "preset" | "precise";
}

export interface TextBlock {
  id: string;
  label?: string;
  content: string | InlineRun[];
  space: "screen" | "world";
  presentation: "panel" | "free" | "columns" | "splat" | "plane";
  styleId?: string;
  overrides?: TypeStyleLayer;
  variants?: StyleVariant[];
  binding: BlockBinding;
  transitionMs?: number;
  /** Fade curve for mount/unmount transitions; defaults to the site-wide setting, then "linear". */
  transitionEase?: EaseName;
  placement: BlockPlacement;
  /** Optional block-level link; a panel/free/columns block or world surface becomes one
   *  link target (P1 wires activation). */
  href?: string;
}

/** The presentations that render as screen-space DOM. THE single home — the
 *  migration's artifact recognition and the resize path both key on this set;
 *  a new screen lane added to one site but not the others turns normalize into
 *  a false-throw or freezes resize re-resolution for that lane. */
export function isScreenPresentation(presentation: TextBlock["presentation"]): boolean {
  return presentation === "panel" || presentation === "free" || presentation === "columns";
}

export interface BlockBinding {
  stops?: string[];
  /**
   * @deprecated Input parse only. Migrated to a `show-blocks` rule on the named
   * annotation by `normalizeSiteConfig`, which then deletes this leg — so no
   * loaded config carries one and nothing at runtime reads it.
   *
   * Kept because files on disk still have it: a block bound to a marker was one
   * of the two ways to show text on a click, and the runtime chose between them
   * by whether the marker had a matching rule — meaning adding a rule silently
   * switched off anything bound to that marker. One mechanism survives, the
   * marker's rules (ticket 17).
   *
   * ⚠ `SiteMedia.binding` reuses THIS type, and media bound to a marker is NOT
   * deprecated — it is one of only two things selection still drives. Do not
   * sweep both on the strength of the shared field name.
   */
  annotations?: string[];
  range?: { from: number; to: number };
  always?: boolean;
}

/** The slots a panel may name — the ACTUAL single source: the union below is
 *  derived from it, so pre-flight, the author UI's control, and the type cannot
 *  drift. Adding a slot means adding it here and nowhere else. */
export const PANEL_SLOTS = ["left", "right", "bottom"] as const;

export interface PanelPlacement {
  /**
   * Which slot this panel occupies. EVERY panel names one, and the toolkit
   * always obeys it — including over the engagement chrome, because the author
   * has final say and a scene may have no chrome at all (ticket 06).
   *
   * There is deliberately no "let the toolkit decide" value. `auto` existed for
   * a few hours in ticket 06 and was removed: a toolkit-chosen slot creates a
   * class of bug where two panels want one corner without either author saying
   * so. Nothing guesses, so nothing can guess wrong.
   */
  slot: (typeof PANEL_SLOTS)[number];
  order?: number;
  /**
   * Does this panel collapse into the full-width bar on a narrow screen?
   * Absent inherits `settings.text.collapseOnNarrow` (default `true`, today's
   * phone rendering). Ticket 17, Rule D.
   *
   * A slot is ONE DOM panel shared by every block docked there, so two blocks
   * in one slot cannot disagree: if ANY of them says `false`, the whole slot
   * keeps its authored position at every width (ticket 17/D3). Splitting an
   * author's composition into two panels to honour both answers would be a
   * worse lie than obeying the opt-out.
   */
  collapse?: boolean;
}

/**
 * Does a slot give up its authored position below the narrow-screen breakpoint?
 * (Ticket 17, Rule D.)
 *
 * `blockAnswers` is `PanelPlacement.collapse` for every block docked in the one
 * slot, in any order; `undefined` means that block expressed no opinion.
 *
 * Three tiers:
 *   1. Any explicit `false` holds the whole slot. A slot is ONE DOM panel shared
 *      by every block in it, so two blocks cannot each get their own answer —
 *      and splitting an author's composition into two panels to honour both
 *      would be a worse lie than obeying the refusal (D3).
 *   2. Otherwise any explicit `true` collapses it, even where the site says
 *      otherwise: a per-panel value overrides the site value in BOTH directions
 *      (author, 2026-08-15).
 *   3. Otherwise the site's habit — `settings.text.collapseOnNarrow`, itself
 *      defaulting to `true`, which is the rendering that shipped before this.
 *
 * Lives here rather than inside the lane for the same reason as
 * `placementIsAuthorChosen` below: it is decision-shaped, and seam 1 is where
 * this codebase puts decisions so they can be asserted without a browser.
 */
export function slotCollapsesOnNarrow(
  blockAnswers: readonly (boolean | undefined)[],
  siteDefault: boolean,
): boolean {
  if (blockAnswers.some((answer) => answer === false)) return false;
  if (blockAnswers.some((answer) => answer === true)) return true;
  return siteDefault;
}

/**
 * Is this panel's geometry the AUTHOR's, or imposed by the viewport?
 *
 * `collapsedToBar` is the ANSWER the narrow-screen collapse reached, not the
 * question — so this needs no new parameter for ticket 17. Since that ticket
 * the collapse is a setting rather than a rule, and where an author switched it
 * off the caller passes `false` and every slot reads as author-chosen, which is
 * exactly right: they chose it, at every width.
 *
 * When a collapse DOES happen, nobody chose the resulting full-width bar, so it
 * is kept clear of the engagement chrome like any other geometry nobody chose —
 * but `bottom` survives, because a full-width bar is what `bottom` MEANS.
 *
 * Lives here, in the pure model, rather than inside the lane: it is
 * decision-shaped, and seam 1 is where this codebase concentrates decisions so
 * they can be asserted headlessly.
 */
export function placementIsAuthorChosen(
  slot: PanelPlacement["slot"],
  collapsedToBar: boolean,
): boolean {
  return !collapsedToBar || slot === "bottom";
}

export interface FreePlacement {
  rect: ScreenRectNorm;
  anchor?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
}

export interface ColumnsPlacement {
  regions?: ScreenRectNorm[];
  minSlotWidthPx?: number;
}

export interface WorldPlacement {
  position: [number, number, number];
  rotationDeg?: [number, number, number];
  billboard?: "full" | "y" | "none";
  worldPerPx: number;
  supersample?: number;
  dotRadius?: number;
}

export type BlockPlacement = PanelPlacement | FreePlacement | ColumnsPlacement | WorldPlacement;

export interface SiteFontFace {
  family: string;
  url: string;
  italicUrl?: string;
  axes?: Record<string, [number, number]>;
  features?: string[];
  manual?: boolean;
}

export interface ResolveContext {
  containerW: number;
  containerH: number;
  activeStopId?: string;
  progress: number;
  /** Whether motion-based interpolation should collapse to discrete steps. */
  reducedMotion?: boolean;
  states?: ReadonlySet<"hover" | "selected">;
  placeId?: string;
  tier?: "preset" | "precise";
  distanceM?: number;
}

export interface CapabilitySet {
  excluded: Partial<Record<keyof TypeStyleLayer, string>>;
}

export type ControlTier = "token" | "style" | "variant" | "override";

export interface Resolved {
  layer: TypeStyleLayer;
  tiers: Partial<Record<keyof TypeStyleLayer, ControlTier>>;
  /** Pre-grid line pitch, recorded when baselineGridPx rewrote lineHeightPx so a
   *  lane that excludes the grid can undo the derivation, not just drop the field. */
  preGridLineHeight?: { value: number | undefined; tier: ControlTier | undefined };
}
