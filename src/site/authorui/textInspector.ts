/**
 * textInspector.ts — the text block AND named-style Inspectable (D10/D11).
 *
 * Owns the frozen text-inspector anatomy: header (editable label ·
 * space/presentation badges · style dropdown) → essentials strip (family,
 * weight, size, leading, tracking, align, color) → nine domain groups →
 * binding summary. The scope selector / variant editor (P7c) extends the same
 * object without reshaping it.
 *
 * P8a generalizes the whole build over an `EditTarget`: the SAME controls edit
 * either a block (base scope = `block.overrides`, variant scope =
 * `block.variants[i].layer`) or a named style (base = `style.base`, variant =
 * `style.variants[i].layer`). A style displays as the cascade a synthetic
 * wearer of ONLY that style resolves to, so the panel never drifts from what
 * the engine renders for its wearers.
 *
 * Every control displays the RESOLVED value (via the engine's own `resolve()`)
 * and writes SPARSELY to the scoped layer — only the changed field, only on
 * edit, then `ctx.onChange("text")` (never `structural`, so the caret
 * survives).
 */

import type { Object3D } from "three";
import { resolve } from "../../text/StyleResolver";
import type {
  CapabilitySet,
  Resolved,
  ResolveContext,
  StyleVariant,
  TextBlock,
  TextStyle,
  TypeStyleLayer,
  VariantCondition,
} from "../../text/TextModel";
import type {
  ControlTier,
  Inspectable,
  InspectorControl,
  InspectorGroup,
  PlacementTool,
} from "../authorPanelTypes";
import type {
  ColumnsPlacement,
  FreePlacement,
  PanelPlacement,
  ScreenRectNorm,
  WorldPlacement,
} from "../../text/TextModel";
import { PANEL_SLOTS } from "../../text/TextModel";
import {
  chip,
  el,
  field,
  gizmoBar,
  iconBtn,
  sectionLabel,
  slider,
  switchToggle,
  textBtn,
} from "./primitives";
import { renderControl } from "./inspector";
import type { AuthorTabCtx } from "./tabContext";

export interface TextInspectorDeps {
  getSurface: (id: string) => HTMLElement | Object3D | null;
  capabilitiesFor: (block: TextBlock) => CapabilitySet;
  /** AuthorPanel drives the on-surface outline; select/deselect route here. */
  setHighlight: (id: string | null) => void;
  containerSize: () => { w: number; h: number };
  /** Apply the P8c context simulator's overrides to the inspector's DISPLAY
   *  resolve context (identity when nothing is simulated). Panel-owned. */
  simContext: (base: ResolveContext) => ResolveContext;
  /** On-canvas placement tools for this block (P8d) — gizmo (world) / rect
   *  (free / columns). Empty when the consumer wires no editors. */
  placementTools: (block: TextBlock) => PlacementTool[];
  /** Sync the live block AND rerender the inspector, preserving style-select
   *  focus — a style change reshapes the resolved cascade the essentials show. */
  restyled: () => void;
  /** Per-panel-instance inspector UI state (DD0) — the open sub-tab and each
   *  target's open cascade scope. Instance-owned so two embeds never share. */
  uiState: InspectorUiState;
}

const WEIGHTS: Array<[number, string]> = [
  [100, "Thin"],
  [200, "Extra Light"],
  [300, "Light"],
  [400, "Regular"],
  [500, "Medium"],
  [600, "Semibold"],
  [700, "Bold"],
  [800, "Extra Bold"],
  [900, "Black"],
];

const ALIGN_OPTIONS = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
  { value: "justify", label: "Justify" },
];

/** Named weights within a family's wght axis range (all of them when the family
 *  has no wght axis / is unknown), always keeping at least one option. */
function weightOptions(range: [number, number] | undefined): { value: string; label: string }[] {
  const within = range
    ? WEIGHTS.filter(([value]) => value >= range[0] && value <= range[1])
    : WEIGHTS;
  const list = within.length > 0 ? within : WEIGHTS;
  return list.map(([value, name]) => ({ value: String(value), label: `${name} (${value})` }));
}

const PRESENTATION_LABEL: Record<TextBlock["presentation"], string> = {
  panel: "Panel",
  free: "Free",
  columns: "Columns",
  splat: "Splat",
  plane: "Plane",
};

// ─── Edit target (P8a) ────────────────────────────────────
// The entity the inspector edits. A block writes its overrides/variants; a
// named style writes its base/variants — every control, tier dot, clear
// button and compound merge runs off this seam instead of a block directly.
export type EditTarget =
  | { kind: "block"; block: TextBlock }
  | { kind: "style"; style: TextStyle };

function targetKey(target: EditTarget): string {
  return target.kind === "block" ? `block:${target.block.id}` : `style:${target.style.id}`;
}

/** A style displays as what a block wearing ONLY it would resolve to (the
 *  resolver walks the basedOn chain). Never rendered — presentation is moot. */
function syntheticWearer(style: TextStyle): TextBlock {
  return {
    id: `__style-preview:${style.id}`,
    content: "",
    space: "screen",
    presentation: "panel",
    styleId: style.id,
    binding: {},
    placement: { slot: "right" },
  };
}

// ─── Cascade scope (P7c) ──────────────────────────────────
// Which layer the controls edit — Base (block.overrides / style.base) or a
// variant's layer.
type Scope = "base" | number;

/** Per-AuthorPanel-instance inspector UI state (DD0). `activeGroupId` is the
 *  open domain sub-tab; `activeScope` maps each edit target (block/style) to
 *  its open cascade scope. Both survive the inspector's frequent rerenders
 *  (clear / scope switch / restyle / font set) but are INSTANCE-owned (threaded
 *  through `TextInspectorDeps`) so two embeds never share sub-tab or scope
 *  selection — the previous module-global `activeScope`/`expandedGroups` bled
 *  across panels (the two-embed acceptance is unpassable otherwise). */
export interface InspectorUiState {
  activeGroupId: string;
  activeScope: Map<string, Scope>;
}

export function createInspectorUiState(): InspectorUiState {
  return { activeGroupId: "character", activeScope: new Map() };
}

/** Build the `activeScope` map key for an edit target — mirrors `targetKey`
 *  (`block:<id>` / `style:<id>`) so the reset hook can forget a deleted
 *  entity's scope without importing the internal helper. */
export function inspectorScopeKey(kind: EditTarget["kind"], id: string): string {
  return `${kind}:${id}`;
}

const VARIANT_TYPES: { value: string; label: string }[] = [
  { value: "minWidth", label: "≥ width" },
  { value: "maxWidth", label: "≤ width" },
  { value: "minHeight", label: "≥ height" },
  { value: "maxHeight", label: "≤ height" },
  { value: "hover", label: "On hover" },
  { value: "selected", label: "When selected" },
  { value: "stop", label: "At a stop" },
];

/** The selectable entity for a text block. `placementTools()` is the P8d stub;
 *  select/deselect are the surface-highlight hooks. */
export function createTextInspectable(
  block: TextBlock,
  ctx: AuthorTabCtx,
  deps: TextInspectorDeps,
): Inspectable {
  return {
    kind: "text",
    id: block.id,
    label: displayLabel(block),
    groups: () => buildTextInspector({ kind: "block", block }, ctx, deps).domainGroups,
    placementTools: (): PlacementTool[] => deps.placementTools(block),
    select: () => deps.setHighlight(block.id),
    deselect: () => deps.setHighlight(null),
  };
}

/** The selectable entity for a named style. No single surface exists to
 *  highlight (every wearer renders it), so the highlight hooks are no-ops. */
export function createStyleInspectable(
  style: TextStyle,
  ctx: AuthorTabCtx,
  deps: TextInspectorDeps,
): Inspectable {
  return {
    kind: "style",
    id: style.id,
    label: style.name,
    groups: () => buildTextInspector({ kind: "style", style }, ctx, deps).domainGroups,
    placementTools: (): PlacementTool[] => [],
    select: () => {},
    deselect: () => {},
  };
}

/** Build the inspect-mode header + body for a text block. AuthorPanel mounts
 *  `header` in the fixed inspector-header region and `body` in the scroll area. */
export function renderTextInspector(
  block: TextBlock,
  ctx: AuthorTabCtx,
  deps: TextInspectorDeps,
): { header: HTMLElement; body: HTMLElement } {
  return renderInspector({ kind: "block", block }, ctx, deps);
}

/** Build the inspect-mode header + body for a named style — the SAME inspector
 *  component, scoped to `style.base` (variant scopes list the style's own
 *  variants). Editing restyles every wearer live via onChange("text") → sync. */
export function renderStyleInspector(
  style: TextStyle,
  ctx: AuthorTabCtx,
  deps: TextInspectorDeps,
): { header: HTMLElement; body: HTMLElement } {
  return renderInspector({ kind: "style", style }, ctx, deps);
}

function renderInspector(
  target: EditTarget,
  ctx: AuthorTabCtx,
  deps: TextInspectorDeps,
): { header: HTMLElement; body: HTMLElement } {
  const { essentialsControls, essentialsRow, domainGroups, scopeBar } = buildTextInspector(target, ctx, deps);
  const tierLabels = target.kind === "style" ? STYLE_TIER_LABEL : undefined;
  const essentials = el("div", { className: "ap-essentials" }, [
    ...essentialsControls.map((control) => renderControl(control, tierLabels)),
    // Align + Color side by side (DD2) — two ordinary controls sharing a row.
    el("div", { className: "ap-essentials-row" },
      essentialsRow.map((control) => renderControl(control, tierLabels))),
  ]);
  const groups = renderGroupTabs(domainGroups, deps.uiState, tierLabels);
  const placement = target.kind === "block" ? renderPlacement(target.block, ctx, deps) : null;

  // Build the header first so the content editor can update its derived label
  // placeholder in place (no rerender) as the block's words are typed (DD3).
  const header = target.kind === "block"
    ? renderHeader(target.block, ctx, deps)
    : renderStyleHeader(target.style, ctx);
  const contentEditor = target.kind === "block"
    ? renderContentEditor(target.block, ctx, header.querySelector<HTMLInputElement>(".ap-inspector-label"))
    : null;

  const body = el("div", { className: "ap-stack ap-inspector-body" }, [
    contentEditor,
    scopeBar,
    essentials,
    placement,
    groups,
    target.kind === "block"
      ? bindingSummary(target.block, ctx)
      : wornBySummary(target.style, ctx),
  ]);

  return { header, body };
}

/** Tier-dot wording for a STYLE target: "override" means the style's own base
 *  set the field; "style" means it came from the basedOn chain. */
const STYLE_TIER_LABEL: Record<ControlTier, string> = {
  token: "From typography token",
  style: "From the basedOn chain",
  variant: "From a variant",
  override: "Set by this style",
  none: "Not set",
};

interface TextInspectorBuild {
  essentialsControls: InspectorControl[];
  /** Align + Color — rendered side by side in one merged row (DD2). */
  essentialsRow: InspectorControl[];
  domainGroups: InspectorGroup[];
  scopeBar: HTMLElement;
}

/** Resolve once, then build both the always-open essentials strip and the nine
 *  collapsible D2 domain groups from the same layer/capability/write locals. */
function buildTextInspector(
  target: EditTarget,
  ctx: AuthorTabCtx,
  deps: TextInspectorDeps,
): TextInspectorBuild {
  const size = deps.containerSize();
  // DISPLAY context: the base context (P7a G1) with the P8c simulator's
  // overrides applied — width/progress/place/state scrubbing previews STYLE
  // resolution only; the live TextSystem and every layout path keep the real
  // context. WRITE decisions below deliberately use the LIVE context instead.
  const rctx: ResolveContext = deps.simContext({ containerW: size.w, containerH: size.h, progress: 0 });
  const styles = ctx.site.styles;
  const tokens = ctx.site.settings?.typography;
  const displayBlock = target.kind === "block" ? target.block : syntheticWearer(target.style);
  const resolved = resolve(displayBlock, styles, tokens, rctx);
  const layer = resolved.layer;
  // Variable-axis ranges of the RESOLVED family drive axis-aware control bounds
  // (weight options / width + optical-size slider ranges) — a picked BYO or
  // stable family exposes exactly its parsed ranges, not the generic defaults
  // (P8b battery: "slider bounds = parsed ranges").
  const familyMeta = ctx.fonts?.meta(layer.fontFamily ?? tokens?.fontFamily ?? "");
  const axisRange = (tag: string): [number, number] | undefined => familyMeta?.axes?.[tag];
  const excluded = target.kind === "block"
    ? deps.capabilitiesFor(target.block).excluded
    : styleExcluded(target.style, ctx, deps);

  // Resolve the edit scope (per-instance state), validating a stale variant index.
  const key = targetKey(target);
  const variantsOf = (): StyleVariant[] | undefined =>
    target.kind === "block" ? target.block.variants : target.style.variants;
  let scope: Scope = deps.uiState.activeScope.get(key) ?? "base";
  if (scope !== "base" && !variantsOf()?.[scope]) {
    scope = "base";
    deps.uiState.activeScope.set(key, "base");
  }
  // The layer the controls WRITE to; display always stays the resolved cascade.
  const scopedLayer = (create: boolean): TypeStyleLayer | undefined => {
    if (scope === "base") {
      if (target.kind === "style") return target.style.base;
      return create ? (target.block.overrides ??= {}) : target.block.overrides;
    }
    return variantsOf()?.[scope]?.layer;
  };
  const pruneBase = (): void => {
    // Block base overrides prune to nothing (sparse); a style's base is a
    // required schema object that stays {} when emptied, and variant layers
    // are explicit entities kept until their variant is deleted.
    if (target.kind !== "block") return;
    const block = target.block;
    if (scope === "base" && block.overrides && Object.keys(block.overrides).length === 0) {
      delete block.overrides;
    }
  };

  // For a style target the resolver reports both own-base and ancestor-base
  // fields as "style" (chainOf merges are indistinguishable) — remap fields the
  // style's OWN base sets to "override" ("Set by this style"): own base merges
  // after every ancestor's base AND variants, so when it sets a field it won,
  // unless one of the style's own variants applied on top (stays "variant").
  //
  // lineHeightPx needs grid-aware provenance (consult finding B): the baseline
  // grid post-pass SYNTHESIZES/rewrites resolved lineHeightPx after the merge,
  // so the displayed pitch is co-produced by the authored pitch AND the grid —
  // report whichever contributor ranks higher in the cascade, and let the
  // own-base check accept the grid/pitch source fields, not only a literal
  // lineHeightPx.
  const gridDerived = resolved.preGridLineHeight !== undefined;
  const tierOf = (field: keyof TypeStyleLayer): ControlTier => {
    let tier: ControlTier = resolved.tiers[field] ?? "none";
    if (field === "lineHeightPx" && gridDerived) {
      tier = maxTier(
        resolved.preGridLineHeight?.tier ?? "none",
        resolved.tiers.baselineGridPx ?? "none",
      );
    }
    if (target.kind === "style" && tier !== "variant") {
      const base = target.style.base;
      const ownSets = field === "lineHeightPx" && gridDerived
        ? base.lineHeightPx !== undefined || base.lineHeight !== undefined || base.baselineGridPx !== undefined
        : base[field] !== undefined;
      if (ownSets && tier !== "none") return "override";
    }
    return tier;
  };
  const write = (field: keyof TypeStyleLayer, value: TypeStyleLayer[keyof TypeStyleLayer] | undefined): void => {
    const scoped = scopedLayer(true);
    if (!scoped) return;
    if (value === undefined) delete scoped[field];
    else scoped[field] = value as never;
    pruneBase();
    // onChange (not structural): the essentials strip must not rerender mid-edit
    // or the focused input is replaced and the caret is lost (finding #1).
    ctx.onChange("text");
  };
  const clearField = (...fields: (keyof TypeStyleLayer)[]): void => {
    const scoped = scopedLayer(false);
    let changed = false;
    if (scoped) {
      for (const field of fields) {
        if (scoped[field] === undefined) continue;
        delete scoped[field];
        changed = true;
      }
      if (changed) pruneBase();
    }
    // Nothing set at this scope → a true no-op (don't churn the engine/UI).
    // Otherwise a discrete button action (no caret): sync the engine AND
    // rerender so the value falls back to inherited and the tier dot updates.
    if (!changed) return;
    ctx.onChange("text");
    ctx.requestRerender();
  };
  // Clear-to-inherited is always offered on an editable control (a standard
  // "reset" affordance): it deletes the field(s) from the SCOPED layer, so the
  // value falls back to the variant/style/token below it — a no-op when nothing
  // is set at this scope. (Presence can't be live-conditional without a
  // re-resolve, which a text edit deliberately avoids to keep the caret.)
  const clearable = (...fields: (keyof TypeStyleLayer)[]): (() => void) =>
    () => clearField(...fields);

  // The cascade STRICTLY BELOW the edited scope — the merge base for compound
  // fields. Filling untouched sub-values from the full resolved layer would copy
  // a matching HIGHER variant's sub-values backward into Base/an earlier scope
  // (silent cross-scope contamination — consult finding C).
  // Block: base inherits token+style; variant i adds overrides+variants[0..i-1].
  // Style: the cascade order is token → ancestors (base+variants each) → own
  // base → own variants, so "below" is expressed by re-resolving the synthetic
  // wearer against a styles array where the edited style is replaced by a copy
  // stripped of everything at-or-above the edited scope.
  let belowBlock: TextBlock;
  let belowStyles = styles;
  if (target.kind === "block") {
    belowBlock = scope === "base"
      ? { ...target.block, overrides: undefined, variants: undefined }
      : { ...target.block, variants: target.block.variants?.slice(0, scope) };
  } else {
    belowBlock = displayBlock;
    const replaced: TextStyle = scope === "base"
      ? { ...target.style, base: {}, variants: [] }
      : { ...target.style, variants: (target.style.variants ?? []).slice(0, scope) };
    belowStyles = styles.map((style) => (style.id === target.style.id ? replaced : style));
  }
  // The below-cascade for WRITE decisions (which leading field to write, and
  // the merge base for compound fields) resolves against the LIVE context,
  // never the P8c simulator: a write persists but the sim is transient, so a
  // sim-activated variant must not steer what an edit materializes (consult
  // finding B). Recomputed at edit time because the panel does not rebuild on
  // container resize, so a captured value can go stale between render and edit
  // (consult resize finding).
  const belowResolvedNow = (): Resolved => {
    const sizeNow = deps.containerSize();
    return resolve(belowBlock, belowStyles, tokens,
      { containerW: sizeNow.w, containerH: sizeNow.h, progress: 0 });
  };
  // The size a px-leading edit at THIS scope must multiply against: the size
  // that applies WHEN THE EDITED LAYER RENDERS — its OWN sizePx if it sets one,
  // else what it inherits from strictly below (live ctx). This is scope-aware:
  // a variant that owns sizePx uses that size (even while inactive in the live/
  // simulated preview — the persisted leading renders when the variant is on);
  // base uses its own or inherited size, never a sim-activated variant's size
  // (the P0 corruption). `layer.sizePx` above follows the P8c simulator and so
  // must NOT feed a persisted value (consult F6/P0 + the variant-scope follow-up).
  const scopeSizeNow = (): number =>
    scopedLayer(false)?.sizePx ?? belowResolvedNow().layer.sizePx ?? 16;
  // The AUTHORED absolute pitch at-or-below the edited scope — pre-grid, so a
  // grid-SYNTHESIZED resolved lineHeightPx cannot trick a leading edit into
  // materializing an absolute pitch nobody authored (consult findings A2/E).
  const authoredPxBelow = (res: Resolved): number | undefined =>
    res.preGridLineHeight !== undefined ? res.preGridLineHeight.value : res.layer.lineHeightPx;
  // Which field a leading edit must write to take effect at THIS scope: an
  // authored px at-or-below shadows any unitless write (the lanes consume
  // lineHeightPx when present), so match it; otherwise stay unitless so
  // leading keeps tracking size. A HIGHER scope's px deliberately does not
  // force px here — writing px at this scope would outlive the higher
  // variant's match window as an orphaned absolute pitch (consult finding A2).
  const leadingUsesPxNow = (): boolean =>
    scopedLayer(false)?.lineHeightPx !== undefined
    || authoredPxBelow(belowResolvedNow()) !== undefined;
  // Build-time snapshot for the disabledReason picker (which excluded string to
  // surface) — matches what a write would target, i.e. the live context.
  const leadingUsesPx = leadingUsesPxNow();

  const essentialsControls: InspectorControl[] = [
    {
      kind: "select",
      label: "Font",
      options: familyOptions(ctx),
      get: () => layer.fontFamily ?? ctx.site.settings?.typography?.fontFamily ?? "",
      // A font change reshapes the axis-aware bounds (weight options / width +
      // optical-size ranges) — rerender so those controls re-derive from the
      // new family's parsed axes, then REFOCUS the rebuilt Font <select> so
      // keyboard family-navigation keeps working (the P7a style-dropdown fix,
      // applied here too). requestRerender rebuilds synchronously, so the new
      // select exists by the time focus runs. A <select> has no caret to lose.
      set: (v) => {
        write("fontFamily", String(v));
        ctx.requestRerender();
        // The Font control is the first <select> in the essentials strip.
        // Scoped through THIS panel's root (like AuthorPanel.restyled): a global
        // document query finds nothing inside a shadow root, and with two
        // light-DOM panels it would focus the FIRST instance's select.
        ctx.panelRoot.querySelector<HTMLElement>(".ap-essentials .ap-ctrl select")?.focus();
      },
      tier: () => tierOf("fontFamily"),
      clear: clearable("fontFamily"),
      disabledReason: excluded.fontFamily,
    },
    {
      kind: "select",
      label: "Weight",
      // Offer only the named weights within the resolved family's wght axis
      // range (a family capped at 300–700 must not offer Thin/Black).
      options: weightOptions(axisRange("wght")),
      get: () => layer.weight ?? 400,
      set: (v) => write("weight", Number(v)),
      tier: () => tierOf("weight"),
      clear: clearable("weight"),
      disabledReason: excluded.weight,
    },
    {
      kind: "slider",
      label: "Size (px)",
      min: 8,
      max: 128,
      step: 1,
      get: () => layer.sizePx ?? 16,
      set: (v) => write("sizePx", roundTo(Number(v), 1)),
      tier: () => tierOf("sizePx"),
      clear: clearable("sizePx"),
      disabledReason: excluded.sizePx,
    },
  ];

  // Align + Color share ONE layout row (DD2) — TWO ordinary controls side by
  // side, each keeping its own tier dot / label / clear / disabled reason
  // (never one composite; the cascade/capability contracts stay per-control).
  // Line height + Tracking moved into the Character group (InDesign order).
  const essentialsRow: InspectorControl[] = [
    {
      kind: "segmented",
      label: "Align",
      options: ALIGN_OPTIONS,
      get: () => layer.align ?? "left",
      set: (v) => write("align", v as TypeStyleLayer["align"]),
      tier: () => tierOf("align"),
      clear: clearable("align"),
      disabledReason: excluded.align,
    },
    {
      kind: "color",
      label: "Color",
      get: () => layer.color ?? "#ffffff",
      set: (v) => write("color", String(v)),
      tier: () => tierOf("color"),
      clear: clearable("color"),
      disabledReason: excluded.color,
    },
  ];

  const slider = (
    field: keyof TypeStyleLayer,
    label: string,
    min: number,
    max: number,
    step: number,
    fallback: number,
  ): InspectorControl => ({
    kind: "slider",
    label,
    min,
    max,
    step,
    get: () => layer[field] ?? fallback,
    set: (v) => write(field, Number(v)),
    tier: () => tierOf(field),
    clear: clearable(field),
    disabledReason: excluded[field],
  });
  const select = <F extends keyof TypeStyleLayer>(
    field: F,
    label: string,
    values: readonly string[],
    fallback: string,
  ): InspectorControl => ({
    kind: "select",
    label,
    options: values.map((value) => ({ value, label: optionLabel(value) })),
    get: () => layer[field] ?? fallback,
    set: (v) => write(field, String(v) as TypeStyleLayer[F]),
    tier: () => tierOf(field),
    clear: clearable(field),
    disabledReason: excluded[field],
  });
  const segmented = <F extends keyof TypeStyleLayer>(
    field: F,
    label: string,
    values: readonly string[],
    fallback: string,
  ): InspectorControl => ({
    ...select(field, label, values, fallback),
    kind: "segmented",
  });
  const toggle = (field: keyof TypeStyleLayer, label: string): InspectorControl => ({
    kind: "toggle",
    label,
    get: () => layer[field] ?? false,
    set: (v) => write(field, Boolean(v)),
    tier: () => tierOf(field),
    clear: clearable(field),
    disabledReason: excluded[field],
  });
  const color = (field: keyof TypeStyleLayer, label: string, fallback: string): InspectorControl => ({
    kind: "color",
    label,
    get: () => layer[field] ?? fallback,
    set: (v) => write(field, String(v)),
    tier: () => tierOf(field),
    clear: clearable(field),
    disabledReason: excluded[field],
  });
  const text = (field: keyof TypeStyleLayer, label: string, fallback: string): InspectorControl => ({
    kind: "text",
    label,
    get: () => layer[field] ?? fallback,
    set: (v) => write(field, String(v)),
    tier: () => tierOf(field),
    clear: clearable(field),
    disabledReason: excluded[field],
  });
  const featureListControl = (
    field: "stylisticSets" | "characterVariants",
    label: string,
    max: number,
  ): InspectorControl => ({
    kind: "text",
    label,
    get: () => (layer[field] ?? []).join(", "),
    clear: clearable(field),
    set: (v) => {
      // Bound to the valid OpenType range (ss01–ss20 / cv01–cv99): a value that
      // pads to 3 digits yields a 5-char tag ("ss100") which invalidates the
      // whole font-feature-settings declaration and loses the good tags with it.
      const values = [...new Set(String(v)
        .trim()
        .split(/[,\s]+/)
        .map(Number)
        .filter((value) => Number.isInteger(value) && value >= 1 && value <= max))];
      write(field, values.length > 0 ? values : undefined);
    },
    tier: () => tierOf(field),
    disabledReason: excluded[field],
  });

  // Compound MERGE base: the scoped layer's own value, else what the scope
  // inherits from below — never a higher scope. (Display/get uses the resolved
  // `layer` so the control still shows what actually renders.) Below-values
  // re-resolve at edit time — same staleness class as the leading field.
  const currentInitialLetter = () => scopedLayer(false)?.initialLetter ?? belowResolvedNow().layer.initialLetter;
  const currentColumnRule = () => scopedLayer(false)?.columnRule ?? belowResolvedNow().layer.columnRule;
  const mergedColumnRule = () => {
    const current = currentColumnRule();
    return {
      widthPx: current?.widthPx ?? 1,
      style: current?.style ?? "solid" as const,
      color: current?.color ?? "#888888",
    };
  };
  const currentWrapShape = () => scopedLayer(false)?.wrapShape ?? belowResolvedNow().layer.wrapShape;
  const mergedWrapShape = () => {
    const current = currentWrapShape();
    return {
      shape: current?.shape ?? "rect" as const,
      rect: current?.rect ?? { x: 0.1, y: 0.1, width: 0.3, height: 0.3 },
      marginPx: current?.marginPx ?? 0,
      float: current?.float ?? "left" as const,
    };
  };
  const currentFirstLine = () => scopedLayer(false)?.firstLine ?? belowResolvedNow().layer.firstLine;
  const writeFirstLine = <F extends keyof TypeStyleLayer>(field: F, value: TypeStyleLayer[F] | undefined): void => {
    const merged: TypeStyleLayer = { ...currentFirstLine() };
    if (value === undefined) delete merged[field];
    else merged[field] = value as never;
    write("firstLine", Object.keys(merged).length > 0 ? merged : undefined);
  };

  const domainGroups: InspectorGroup[] = [
    {
      id: "character",
      label: "Character",
      collapsed: true,
      controls: [
        // Line height + Tracking lead the Character group (InDesign order, DD2)
        // — moved verbatim from the essentials strip; writes are byte-identical.
        {
          kind: "slider",
          label: "Line height",
          min: 0.8,
          max: 3,
          step: 0.05,
          get: () => resolvedLeading(layer),
          set: (v) => {
            // Write the field the edit can actually take effect through at THIS
            // scope (leadingUsesPx): an authored absolute pitch at-or-below (e.g.
            // editorial columns' lineHeightPx) must be matched in px or the
            // unitless edit is silently shadowed; everything else stays unitless
            // so leading tracks size. The FULL resolved layer deliberately does
            // not decide — a higher variant's px or a grid-synthesized px would
            // materialize an absolute base pitch nobody authored (consult A2/E).
            const mult = Number(v);
            // Recomputed at edit time — a container resize between render and
            // edit can flip which field is correct (the panel does not rebuild
            // on resize).
            if (leadingUsesPxNow()) {
              // Multiply by the SCOPE-AWARE size, NOT the display `layer.sizePx`
              // (which follows the P8c simulator) — else a sim-activated size
              // variant bakes a wrong absolute pitch into the persisted config
              // (consult F6). The px-vs-unitless DECISION is already live above.
              write("lineHeightPx", roundTo(mult * scopeSizeNow(), 2));
            } else {
              write("lineHeight", roundTo(mult, 3));
            }
          },
          tier: () => tierOf(layer.lineHeightPx !== undefined ? "lineHeightPx" : "lineHeight"),
          clear: clearable("lineHeight", "lineHeightPx"),
          disabledReason: leadingUsesPx ? excluded.lineHeightPx : excluded.lineHeight,
        },
        {
          kind: "slider",
          label: "Tracking (em)",
          min: -0.1,
          max: 0.5,
          step: 0.005,
          get: () => layer.trackingEm ?? 0,
          set: (v) => write("trackingEm", roundTo(Number(v), 3)),
          tier: () => tierOf("trackingEm"),
          clear: clearable("trackingEm"),
          disabledReason: excluded.trackingEm,
        },
        // Width / optical size clamp to the resolved family's parsed axis range
        // when it exposes one, else the generic defaults (P8b axis-aware bounds).
        slider("width", "Width (%)", axisRange("wdth")?.[0] ?? 50, axisRange("wdth")?.[1] ?? 200, 1, 100),
        slider("slant", "Slant (°)", axisRange("slnt")?.[0] ?? -15, axisRange("slnt")?.[1] ?? 0, 1, 0),
        toggle("italic", "Italic"),
        {
          // Numeric optical size bounded by the family's opsz axis when present
          // (the "auto" sentinel, unused by any demo block, shows the resolved
          // size and is overwritten by a numeric edit).
          kind: "slider",
          label: "Optical size",
          min: axisRange("opsz")?.[0] ?? 6,
          max: axisRange("opsz")?.[1] ?? 72,
          step: 1,
          get: () => typeof layer.opticalSize === "number" ? layer.opticalSize : (layer.sizePx ?? 16),
          set: (v) => write("opticalSize", Number(v)),
          tier: () => tierOf("opticalSize"),
          clear: clearable("opticalSize"),
          disabledReason: excluded.opticalSize,
        },
        slider("wordSpacingEm", "Word spacing (em)", -0.2, 1, 0.01, 0),
        select("transform", "Text case", ["none", "uppercase", "lowercase", "capitalize"], "none"),
        toggle("underline", "Underline"),
        toggle("strikethrough", "Strikethrough"),
        slider("underlineOffsetPx", "Underline offset (px)", -5, 10, 0.5, 0),
        slider("decorationThicknessPx", "Decoration thickness (px)", 0, 8, 0.5, 1),
        color("decorationColor", "Decoration color", "#ffffff"),
        select("decorationStyle", "Decoration style", ["solid", "double", "dotted", "dashed", "wavy"], "solid"),
        slider("baselineShiftPx", "Baseline shift (px)", -10, 10, 0.5, 0),
        text("shadow", "Text shadow (CSS)", ""),
      ],
    },
    {
      id: "paragraph",
      label: "Paragraph",
      collapsed: true,
      controls: [
        slider("measureCh", "Line width (ch)", 10, 120, 1, 66),
        slider("measurePx", "Line width (px)", 100, 1200, 10, 400),
        select("lastLineAlign", "Last line", ["auto", "left", "center", "right", "justify"], "auto"),
        slider("spaceBeforePx", "Space before (px)", 0, 64, 1, 0),
        slider("spaceAfterPx", "Space after (px)", 0, 64, 1, 0),
        slider("indentFirstLinePx", "First-line indent (px)", 0, 96, 1, 0),
        slider("indentLeftPx", "Left indent (px)", 0, 96, 1, 0),
        slider("indentRightPx", "Right indent (px)", 0, 96, 1, 0),
        segmented("textWrap", "Text wrap", ["wrap", "balance", "pretty"], "wrap"),
        select("lineBreak", "Line break", ["auto", "loose", "normal", "strict"], "auto"),
        toggle("hyphens", "Hyphenate"),
        toggle("hangingPunctuation", "Hanging punctuation"),
        slider("orphans", "Orphans", 1, 5, 1, 2),
        slider("widows", "Widows", 1, 5, 1, 2),
        {
          kind: "slider",
          label: "Drop-cap lines",
          min: 0,
          max: 5,
          step: 1,
          get: () => layer.initialLetter?.lines ?? 0,
          set: (v) => {
            const lines = Number(v);
            write("initialLetter", lines <= 0
              ? undefined
              : { lines, raise: currentInitialLetter()?.raise });
          },
          tier: () => tierOf("initialLetter"),
          clear: clearable("initialLetter"),
          disabledReason: excluded.initialLetter,
        },
        {
          kind: "slider",
          label: "Drop-cap raise",
          min: 0,
          max: 5,
          step: 1,
          get: () => layer.initialLetter?.raise ?? 0,
          set: (v) => write("initialLetter", {
            lines: currentInitialLetter()?.lines ?? 1,
            raise: Number(v),
          }),
          tier: () => tierOf("initialLetter"),
          clear: clearable("initialLetter"),
          disabledReason: excluded.initialLetter,
        },
      ],
    },
    {
      id: "opentype",
      label: "OpenType",
      collapsed: true,
      controls: [
        select("ligatures", "Ligatures", ["none", "common", "all"], "common"),
        segmented("numeralStyle", "Figures", ["lining", "oldstyle"], "lining"),
        segmented("numeralSpacing", "Figure spacing", ["proportional", "tabular"], "proportional"),
        toggle("fractions", "Fractions"),
        toggle("slashedZero", "Slashed zero"),
        toggle("ordinals", "Ordinals"),
        select("caps", "Caps", ["normal", "small-caps", "all-small-caps", "petite-caps", "unicase", "titling-caps"], "normal"),
        featureListControl("stylisticSets", "Stylistic sets", 20),
        featureListControl("characterVariants", "Character variants", 99),
        toggle("swash", "Swash"),
        toggle("contextualAlternates", "Contextual alternates"),
        toggle("kerning", "Kerning"),
        segmented("positionVariant", "Position", ["normal", "super", "sub"], "normal"),
      ],
    },
    {
      id: "rhythm",
      label: "Rhythm",
      collapsed: true,
      controls: [
        {
          // 0 means "no grid" — writing baselineGridPx:0 poisons the resolver's
          // ceil(pitch/grid)*grid to NaN (StyleResolver applyBaselineGrid), so
          // clear the field at the slider floor instead of storing 0.
          kind: "slider",
          label: "Baseline grid (px)",
          min: 0,
          max: 32,
          step: 1,
          get: () => layer.baselineGridPx ?? 0,
          set: (v) => {
            const grid = Number(v);
            write("baselineGridPx", grid > 0 ? grid : undefined);
          },
          tier: () => tierOf("baselineGridPx"),
          clear: clearable("baselineGridPx"),
          disabledReason: excluded.baselineGridPx,
        },
        select("leadingTrim", "Leading trim", ["none", "both", "start", "end"], "none"),
      ],
    },
    {
      id: "columns",
      label: "Columns & frame",
      collapsed: true,
      controls: [
        slider("columnCount", "Columns", 1, 6, 1, 1),
        slider("columnWidthPx", "Column width (px)", 40, 600, 10, 240),
        slider("columnGapPx", "Column gap (px)", 0, 96, 1, 24),
        {
          kind: "slider",
          label: "Rule width (px)",
          min: 0,
          max: 8,
          step: 0.5,
          get: () => layer.columnRule?.widthPx ?? 1,
          set: (v) => write("columnRule", { ...mergedColumnRule(), widthPx: Number(v) }),
          tier: () => tierOf("columnRule"),
          clear: clearable("columnRule"),
          disabledReason: excluded.columnRule,
        },
        {
          kind: "select",
          label: "Rule style",
          options: ["solid", "dotted", "dashed"].map((value) => ({ value, label: optionLabel(value) })),
          get: () => layer.columnRule?.style ?? "solid",
          set: (v) => write("columnRule", {
            ...mergedColumnRule(),
            style: String(v) as NonNullable<TypeStyleLayer["columnRule"]>["style"],
          }),
          tier: () => tierOf("columnRule"),
          clear: clearable("columnRule"),
          disabledReason: excluded.columnRule,
        },
        {
          kind: "color",
          label: "Rule color",
          get: () => layer.columnRule?.color ?? "#888888",
          set: (v) => write("columnRule", { ...mergedColumnRule(), color: String(v) }),
          tier: () => tierOf("columnRule"),
          clear: clearable("columnRule"),
          disabledReason: excluded.columnRule,
        },
        toggle("columnSpanFirst", "First element spans columns"),
        // "justify" distributes multi-line/column content; on a single-text-node
        // free/panel block it has no gaps to distribute (a CSS no-op, not a
        // per-value capability the lane caps express) — offered by design.
        select("frameVerticalAlign", "Vertical align", ["top", "center", "bottom", "justify"], "top"),
        select("autoSize", "Auto-size", ["none", "height", "both"], "none"),
      ],
    },
    {
      id: "wrap",
      label: "Wrap & flow",
      collapsed: true,
      controls: [
        slider("wrapMarginPx", "Wrap margin (px)", 0, 96, 1, 0),
        {
          kind: "segmented",
          label: "Wrap shape",
          options: ["rect", "circle"].map((value) => ({ value, label: optionLabel(value) })),
          get: () => layer.wrapShape?.shape ?? "rect",
          set: (v) => write("wrapShape", {
            ...mergedWrapShape(),
            shape: String(v) as NonNullable<TypeStyleLayer["wrapShape"]>["shape"],
          }),
          tier: () => tierOf("wrapShape"),
          clear: clearable("wrapShape"),
          disabledReason: excluded.wrapShape,
        },
        {
          kind: "segmented",
          label: "Wrap float",
          options: ["left", "right"].map((value) => ({ value, label: optionLabel(value) })),
          get: () => layer.wrapShape?.float ?? "left",
          set: (v) => write("wrapShape", {
            ...mergedWrapShape(),
            float: String(v) as NonNullable<TypeStyleLayer["wrapShape"]>["float"],
          }),
          tier: () => tierOf("wrapShape"),
          clear: clearable("wrapShape"),
          disabledReason: excluded.wrapShape,
        },
        {
          kind: "slider",
          label: "Wrap margin (shape, px)",
          min: 0,
          max: 96,
          step: 1,
          get: () => layer.wrapShape?.marginPx ?? 0,
          set: (v) => write("wrapShape", { ...mergedWrapShape(), marginPx: Number(v) }),
          tier: () => tierOf("wrapShape"),
          clear: clearable("wrapShape"),
          disabledReason: excluded.wrapShape,
        },
        {
          kind: "text",
          label: "Wrap rect (x y w h, 0–1)",
          get: () => {
            const rect = layer.wrapShape?.rect ?? mergedWrapShape().rect;
            return [rect.x, rect.y, rect.width, rect.height].join(" ");
          },
          set: (v) => {
            const parts = String(v).trim().split(/\s+/).map(Number);
            if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part) || part < 0 || part > 1)) return;
            // The rect must stay INSIDE the normalized box — an x+width (or
            // y+height) over 1 denormalizes to a negative CSS margin that
            // escapes the layout.
            if (parts[0] + parts[2] > 1 || parts[1] + parts[3] > 1) return;
            write("wrapShape", {
              ...mergedWrapShape(),
              rect: { x: parts[0], y: parts[1], width: parts[2], height: parts[3] },
            });
          },
          tier: () => tierOf("wrapShape"),
          clear: clearable("wrapShape"),
          disabledReason: excluded.wrapShape,
        },
      ],
    },
    {
      id: "justification",
      label: "Justification",
      collapsed: true,
      controls: [
        select("textJustify", "Justify method", ["auto", "inter-word", "inter-character"], "auto"),
        {
          kind: "vector",
          label: "Hyphenation limits (total, before, after)",
          get: () => layer.hyphenateLimitChars ?? [5, 2, 2],
          set: (v) => {
            // CSS hyphenate-limit-chars takes INTEGERS ≥1; a fractional value
            // emits invalid CSS the browser silently drops (the edit no-ops).
            const values = v as [unknown, unknown, unknown];
            write("hyphenateLimitChars", [0, 1, 2].map((i) =>
              Math.max(1, Math.round(Number(values[i])))) as [number, number, number]);
          },
          tier: () => tierOf("hyphenateLimitChars"),
          clear: clearable("hyphenateLimitChars"),
          disabledReason: excluded.hyphenateLimitChars,
        },
      ],
    },
    {
      id: "breaks",
      label: "Keeps & breaks",
      collapsed: true,
      controls: [
        segmented("breakInside", "Break inside", ["auto", "avoid"], "auto"),
        segmented("breakBefore", "Break before", ["auto", "column"], "auto"),
      ],
    },
    {
      id: "firstline",
      label: "First line",
      collapsed: true,
      controls: [
        // ::first-line INHERITS from the parent, so an unset sub-field displays
        // the parent's RESOLVED value (not a hardcoded default) — the control
        // must not misreport the rendered first-line styling.
        {
          kind: "color",
          label: "First-line color",
          get: () => layer.firstLine?.color ?? layer.color ?? "#ffffff",
          set: (v) => writeFirstLine("color", String(v)),
          tier: () => tierOf("firstLine"),
          clear: clearable("firstLine"),
          disabledReason: excluded.firstLine,
        },
        {
          kind: "slider",
          label: "First-line size (px)",
          min: 8,
          max: 128,
          step: 1,
          get: () => layer.firstLine?.sizePx ?? layer.sizePx ?? 16,
          set: (v) => writeFirstLine("sizePx", Number(v)),
          tier: () => tierOf("firstLine"),
          clear: clearable("firstLine"),
          disabledReason: excluded.firstLine,
        },
        {
          kind: "select",
          label: "First-line weight",
          options: WEIGHTS.map(([value, name]) => ({ value: String(value), label: `${name} (${value})` })),
          get: () => layer.firstLine?.weight ?? layer.weight ?? 400,
          set: (v) => writeFirstLine("weight", Number(v)),
          tier: () => tierOf("firstLine"),
          clear: clearable("firstLine"),
          disabledReason: excluded.firstLine,
        },
      ],
    },
  ];

  // Persist the scope selection to instance state WITHOUT a rerender — variant
  // add/dup/delete already fire `ctx.structural` (which rerenders); the scope
  // <select> path pairs commit with an explicit `ctx.requestRerender`.
  const commitScope = (next: Scope): void => {
    deps.uiState.activeScope.set(key, next);
  };
  const setScope = (next: Scope): void => {
    commitScope(next);
    // Pure UI change (no data mutation) — rerender the inspector so the controls
    // retarget the new scoped layer and their clear buttons reflect it.
    ctx.requestRerender();
  };
  const scopeBar = renderScopeBar(target, ctx, scope, setScope, commitScope);

  return { essentialsControls, essentialsRow, domainGroups, scopeBar };
}

// ─── Content editor (DD3) ─────────────────────────────────
// The block's actual words, always present at the TOP of the block inspector.
// A `string` block is editable live (onChange, no structural rerender — the
// caret survives); the header's derived label placeholder updates IN PLACE per
// keystroke so it never shows stale text while typing. A `runs[]` block shows a
// read-only flattened echo + a reason (run editing comes later); no destructive
// flatten of the styled runs. Styles have no content and get no content box.
function renderContentEditor(
  block: TextBlock,
  ctx: AuthorTabCtx,
  labelInput: HTMLInputElement | null,
): HTMLElement {
  const rows: HTMLElement[] = [sectionLabel("Content")];
  if (typeof block.content === "string") {
    const area = el("textarea", {
      className: "ap-input ap-textarea ap-content-editor",
      attrs: { rows: "3", spellcheck: "false", placeholder: "Block text…", "aria-label": "Block content" },
    }) as HTMLTextAreaElement;
    area.value = block.content;
    area.addEventListener("input", () => {
      block.content = area.value;
      // Keep the derived header label current WITHOUT a structural rerender
      // (which would replace the focused textarea and drop the caret): the
      // placeholder shows displayLabel only when no explicit label is set.
      if (labelInput && !block.label) labelInput.placeholder = displayLabel(block);
      ctx.onChange("text");
    });
    rows.push(area);
  } else {
    rows.push(el("div", { className: "ap-binding-value ap-content-echo", text: flatten(block.content) }));
    rows.push(el("div", { className: "ap-hint", text: "Styled runs — run editing comes later." }));
  }
  return el("div", { className: "ap-stack ap-content-block" }, rows);
}

// ─── Header ───────────────────────────────────────────────

function renderHeader(block: TextBlock, ctx: AuthorTabCtx, deps: TextInspectorDeps): HTMLElement {
  const label = el("input", {
    className: "ap-input ap-inspector-label",
    type: "text",
    title: "Block label",
    attrs: { value: block.label ?? "", placeholder: displayLabel(block), "aria-label": "Block label" },
  }) as HTMLInputElement;
  label.addEventListener("input", () => {
    const value = label.value.trim();
    if (value) block.label = value;
    else delete block.label;
    // Keep the derived placeholder current WITHOUT a rerender (consult V #3):
    // clearing the label must fall the header back to the content-derived name,
    // not leave the old label as a stale placeholder. (When a label is set the
    // placeholder sits behind the input value, so recomputing is harmless.)
    label.placeholder = displayLabel(block);
    // onChange (not structural): keep the caret while typing the label.
    ctx.onChange("text");
  });

  const styleSelect = el("select", { className: "ap-input ap-select", title: "Style" }) as HTMLSelectElement;
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "— no style —";
  styleSelect.appendChild(none);
  for (const style of ctx.site.styles) {
    const option = document.createElement("option");
    option.value = style.id;
    option.textContent = style.name;
    styleSelect.appendChild(option);
  }
  styleSelect.value = block.styleId ?? "";
  styleSelect.addEventListener("change", () => {
    const value = styleSelect.value;
    if (value) block.styleId = value;
    else delete block.styleId;
    // A style change reshapes the whole resolved cascade — rerender the
    // inspector so every essentials control shows its new resolved value.
    // deps.restyled syncs the live block AND restores focus to the rebuilt
    // <select> so keyboard style-navigation keeps working.
    deps.restyled();
  });

  return el("div", { className: "ap-inspector-title" }, [
    label,
    el("div", { className: "ap-badges" }, [
      chip(block.space, "accent"),
      chip(PRESENTATION_LABEL[block.presentation]),
    ]),
    el("label", { className: "ap-field ap-inspector-style" }, [
      el("span", { className: "ap-field-label", text: "Style" }),
      styleSelect,
    ]),
  ]);
}

/** Header for a style target: editable name + Style/based-on badges. No style
 *  dropdown (that is the block header's wearer picker) and no re-parent UI —
 *  delete is the only re-pointing operation (D11). */
function renderStyleHeader(style: TextStyle, ctx: AuthorTabCtx): HTMLElement {
  const name = el("input", {
    className: "ap-input ap-inspector-label",
    type: "text",
    title: "Style name",
    attrs: { value: style.name, placeholder: style.id, "aria-label": "Style name" },
  }) as HTMLInputElement;
  name.addEventListener("input", () => {
    // `name` is required by the schema — ignore an emptied field (mid-edit)
    // instead of writing "". onChange (not structural): keep the caret.
    const value = name.value.trim();
    if (!value) return;
    style.name = value;
    ctx.onChange("text");
  });

  const parent = style.basedOn === undefined
    ? undefined
    : ctx.site.styles.find((candidate) => candidate.id === style.basedOn);
  return el("div", { className: "ap-inspector-title" }, [
    name,
    el("div", { className: "ap-badges" }, [
      chip("Style", "accent"),
      chip(style.basedOn === undefined ? "root" : `based on ${parent?.name ?? style.basedOn}`),
    ]),
  ]);
}

// ─── Placement (P8d) ──────────────────────────────────────
// The "where" surface: on-canvas tools (gizmo for world blocks, screen-rect
// editor for free/columns) supplied by the consumer, plus numeric fields bound
// to the block's placement. Panel blocks get slot/order; free gets rect+anchor;
// columns get region rows; world gets the gizmo + billboard gating + readouts.

function renderPlacement(block: TextBlock, ctx: AuthorTabCtx, deps: TextInspectorDeps): HTMLElement {
  const rows: (HTMLElement | null)[] = [sectionLabel("Placement")];
  for (const tool of deps.placementTools(block)) rows.push(renderPlacementTool(tool, ctx));
  switch (block.presentation) {
    case "panel":
      rows.push(...panelPlacementFields(block, ctx));
      break;
    case "free":
      rows.push(...freePlacementFields(block, ctx));
      break;
    case "columns":
      rows.push(...columnsPlacementFields(block, ctx));
      break;
    case "splat":
    case "plane":
      rows.push(...worldPlacementFields(block, ctx));
      break;
  }
  return el("div", { className: "ap-stack ap-placement" }, rows);
}

function renderPlacementTool(tool: PlacementTool, ctx: AuthorTabCtx): HTMLElement {
  if (tool.kind === "gizmo") {
    return gizmoBar({
      modes: tool.modes,
      disabledModes: tool.disabledModes,
      active: tool.isActive(),
      // A rerender re-reads isActive() so the Deactivate button stays in sync;
      // switching modes re-attaches the same target in the new mode.
      onMode: (mode) => {
        tool.attach(mode);
        ctx.requestRerender();
      },
      onDeactivate: () => {
        tool.detach();
        ctx.requestRerender();
      },
    });
  }
  return field(tool.label, switchToggle(tool.isActive(), (on) => {
    tool.setActive(on);
    ctx.requestRerender();
  }), tool.hint);
}

function panelPlacementFields(block: TextBlock, ctx: AuthorTabCtx): HTMLElement[] {
  const placement = block.placement as PanelPlacement;
  const slotSelect = el("select", { className: "ap-input ap-select", ariaLabel: "Panel slot" }) as HTMLSelectElement;
  // Every panel names a slot and the toolkit obeys it, including over the
  // engagement chrome (ticket 06). There is deliberately no "let the toolkit
  // decide" entry — driven off PANEL_SLOTS so this control cannot drift from the
  // type or from pre-flight.
  for (const slot of PANEL_SLOTS) {
    const option = document.createElement("option");
    option.value = slot;
    option.textContent = slot.charAt(0).toUpperCase() + slot.slice(1);
    slotSelect.appendChild(option);
  }
  slotSelect.value = placement.slot;
  slotSelect.addEventListener("change", () => {
    placement.slot = slotSelect.value as PanelPlacement["slot"];
    ctx.onChange("text");
  });
  // The narrow-screen collapse, per panel (ticket 17, Rule D). THREE states, so
  // a select rather than a switch: a switch could not say "no opinion", and
  // without that the control would have to write a value into every panel it
  // touched — turning an inherited default into 72 authored ones.
  const collapseSelect = el("select", {
    className: "ap-input ap-select",
    ariaLabel: "Collapse on narrow screens",
  }) as HTMLSelectElement;
  for (const [value, label] of [
    ["", "Site default"],
    ["true", "Collapse to bar"],
    ["false", "Keep this slot"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    collapseSelect.appendChild(option);
  }
  collapseSelect.value = placement.collapse === undefined ? "" : String(placement.collapse);
  collapseSelect.addEventListener("change", () => {
    // DELETE rather than write `undefined`: the key must be absent from the
    // serialized file, not present-and-null, so a panel that never expressed an
    // opinion still reads as one.
    if (collapseSelect.value === "") delete placement.collapse;
    else placement.collapse = collapseSelect.value === "true";
    ctx.onChange("text");
  });
  return [
    field("Slot", slotSelect),
    field("Order", numberInput(placement.order ?? 0, (value) => {
      placement.order = value;
      ctx.onChange("text");
    }, "Panel order", { step: 1 })),
    field("On narrow", collapseSelect,
      "Below 768px. Where two panels share a slot and disagree, Keep this slot wins."),
  ];
}

function freePlacementFields(block: TextBlock, ctx: AuthorTabCtx): HTMLElement[] {
  const placement = block.placement as FreePlacement;
  const rect = placement.rect;
  const keys: (keyof ScreenRectNorm)[] = ["x", "y", "width", "height"];
  const rectRow = el("div", { className: "ap-actions" }, keys.map((key) =>
    normInput(rect[key], (value) => {
      rect[key] = value;
      ctx.onChange("text");
    }, `Rect ${key}`)));

  const anchorSelect = el("select", { className: "ap-input ap-select", ariaLabel: "Free anchor" }) as HTMLSelectElement;
  const anchors: NonNullable<FreePlacement["anchor"]>[] =
    ["top-left", "top-right", "bottom-left", "bottom-right", "center"];
  for (const anchor of anchors) {
    const option = document.createElement("option");
    option.value = anchor;
    option.textContent = anchor;
    anchorSelect.appendChild(option);
  }
  anchorSelect.value = placement.anchor ?? "top-left";
  anchorSelect.addEventListener("change", () => {
    placement.anchor = anchorSelect.value as FreePlacement["anchor"];
    ctx.onChange("text");
  });

  return [
    field("Rect (x y w h, 0–1)", rectRow),
    field("Anchor", anchorSelect),
  ];
}

function columnsPlacementFields(block: TextBlock, ctx: AuthorTabCtx): HTMLElement[] {
  const placement = block.placement as ColumnsPlacement;
  const regions = placement.regions ?? [];
  const rows: HTMLElement[] = [
    field("Min slot width (px)", numberInput(placement.minSlotWidthPx ?? 140, (value) => {
      placement.minSlotWidthPx = value;
      ctx.onChange("text");
    }, "Minimum slot width", { step: 1, min: 0 })),
    sectionLabel(`${regions.length} region${regions.length === 1 ? "" : "s"}`),
  ];
  regions.forEach((region, index) => {
    const keys: (keyof ScreenRectNorm)[] = ["x", "y", "width", "height"];
    rows.push(field(`Region ${index + 1}`, el("div", { className: "ap-actions" }, [
      ...keys.map((key) => normInput(region[key], (value) => {
        region[key] = value;
        ctx.onChange("text");
      }, `Region ${index + 1} ${key}`)),
      iconBtn("trash", {
        tone: "danger",
        title: `Remove region ${index + 1}`,
        onClick: () => {
          const live = (block.placement as ColumnsPlacement).regions;
          live?.splice(index, 1);
          if (live?.length === 0) delete (block.placement as ColumnsPlacement).regions;
          ctx.structural("text");
        },
      }),
    ])));
  });
  rows.push(el("div", { className: "ap-actions" }, [
    textBtn("plus", "Add region", {
      onClick: () => {
        const live = (block.placement as ColumnsPlacement);
        (live.regions ??= []).push({ x: 0.08, y: 0.12, width: 0.38, height: 0.76 });
        ctx.structural("text");
      },
    }),
  ]));
  return rows;
}

function worldPlacementFields(block: TextBlock, ctx: AuthorTabCtx): HTMLElement[] {
  const placement = block.placement as WorldPlacement;
  const billboardSelect = el("select", { className: "ap-input ap-select", ariaLabel: "Billboard" }) as HTMLSelectElement;
  const modes: NonNullable<WorldPlacement["billboard"]>[] = ["full", "y", "none"];
  for (const mode of modes) {
    const option = document.createElement("option");
    option.value = mode;
    option.textContent = mode === "full" ? "Full" : mode === "y" ? "Y-axis" : "None (fixed)";
    billboardSelect.appendChild(option);
  }
  billboardSelect.value = placement.billboard ?? "full";
  billboardSelect.addEventListener("change", () => {
    placement.billboard = billboardSelect.value as WorldPlacement["billboard"];
    // Billboard gates the gizmo's Rotate mode — rerender so the gizmo bar
    // reflects the new mode set; structural so the tools rebuild.
    ctx.structural("text");
  });

  const pos = placement.position;
  const rot = placement.rotationDeg ?? [0, 0, 0];
  const fields: HTMLElement[] = [
    field("Billboard", billboardSelect),
    // Focus/detail: the splat raster supersample (fontSize = sizePx × ss), the
    // frozen D10 Focus control — writing it rebuilds the glyph dots (D6/D10
    // place it and dotRadius under the block's placement, not its style).
    field("Focus (supersample ×)", numberInput(placement.supersample ?? 1, (value) => {
      placement.supersample = value;
      ctx.onChange("text");
    }, "Supersample", { step: 0.5, min: 0.25 })),
  ];
  if (block.presentation === "splat") {
    fields.push(field("Dot radius", numberInput(placement.dotRadius ?? 1, (value) => {
      placement.dotRadius = value;
      ctx.onChange("text");
    }, "Dot radius", { step: 0.05, min: 0.05 })));
  }
  fields.push(
    el("div", { className: "ap-field" }, [
      el("span", { className: "ap-field-label", text: "Position (x y z)" }),
      el("span", { className: "ap-binding-value", text: pos.map((v) => roundTo(v, 3)).join(", ") }),
    ]),
    el("div", { className: "ap-field" }, [
      el("span", { className: "ap-field-label", text: "Rotation (° x y z)" }),
      el("span", { className: "ap-binding-value", text: rot.map((v) => roundTo(v, 1)).join(", ") }),
    ]),
    el("div", { className: "ap-field" }, [
      el("span", { className: "ap-field-label", text: "World per px" }),
      el("span", { className: "ap-binding-value", text: String(roundTo(placement.worldPerPx, 6)) }),
    ]),
  );
  return fields;
}

/** A 0–1 clamped normalized input (rect coords). Mid-edit empty ≠ 0. */
function normInput(value: number, onValue: (value: number) => void, ariaLabel: string): HTMLInputElement {
  return el("input", {
    className: "ap-input ap-ctrl-number",
    type: "number",
    attrs: { "aria-label": ariaLabel, min: "0", max: "1", step: "0.01", value: String(roundTo(value, 4)) },
    onInput: (event) => {
      const raw = (event.currentTarget as HTMLInputElement).value;
      if (raw.trim() === "") return;
      const next = Number(raw);
      if (!Number.isFinite(next)) return;
      onValue(Math.min(1, Math.max(0, next)));
    },
  }) as HTMLInputElement;
}

/** A plain numeric input (no 0–1 clamp). Mid-edit empty ≠ 0. */
function numberInput(
  value: number,
  onValue: (value: number) => void,
  ariaLabel: string,
  opts: { step?: number; min?: number } = {},
): HTMLInputElement {
  const attrs: Record<string, string> = { "aria-label": ariaLabel, step: String(opts.step ?? 0.01), value: String(value) };
  if (opts.min !== undefined) attrs.min = String(opts.min);
  return el("input", {
    className: "ap-input ap-ctrl-number",
    type: "number",
    attrs,
    onInput: (event) => {
      const raw = (event.currentTarget as HTMLInputElement).value;
      if (raw.trim() === "") return;
      const next = Number(raw);
      if (!Number.isFinite(next)) return;
      onValue(opts.min !== undefined ? Math.max(opts.min, next) : next);
    },
  }) as HTMLInputElement;
}

// ─── Binding summary ──────────────────────────────────────

function bindingSummary(block: TextBlock, ctx: AuthorTabCtx): HTMLElement {
  return el("div", { className: "ap-field ap-binding-summary" }, [
    el("span", { className: "ap-field-label", text: "Shown" }),
    el("span", { className: "ap-binding-value", text: describeBinding(block, ctx) }),
  ]);
}

function describeBinding(block: TextBlock, ctx: AuthorTabCtx): string {
  const parts: string[] = [];
  const binding = block.binding;
  if (binding.always) parts.push("Always");
  for (const stopId of binding.stops ?? []) {
    parts.push(`Stop: ${ctx.site.stops.find((stop) => stop.id === stopId)?.label ?? stopId}`);
  }
  if (binding.range) parts.push(`Scroll ${trim(binding.range.from)}–${trim(binding.range.to)}`);
  // Markers are no longer a BINDING (ticket 17 retired that); a marker shows a
  // block because one of its rules says so. There used to be an `Annotation: …`
  // case here as well, which meant the panel had two sentences for one thing.
  //
  // ⚠ Gathered into `parts` rather than returned on its own. This function used
  // to return as soon as `parts` was non-empty, so a block bound to a stop AND
  // shown by a marker reported only the stop — the marker half was unreachable,
  // silently, for exactly the blocks whose display is hardest to reason about.
  const shownBy = ctx.site.annotations.filter((annotation) =>
    annotation.rules?.some((rule) =>
      rule.do.some((effect) => effect.kind === "show-blocks" && effect.blocks.includes(block.id))));
  if (shownBy.length > 0) {
    parts.push(`Display effect: ${shownBy.map((a) => a.copy?.title ?? a.id).join(", ")}`);
  }
  if (parts.length > 0) return parts.join(" · ");
  return "Never (no binding)";
}

// ─── Worn-by summary (style targets) ──────────────────────

/** True when `startId`'s basedOn chain (inclusive) contains `styleId`. */
export function styleChainIncludes(
  styles: TextStyle[],
  startId: string | undefined,
  styleId: string,
): boolean {
  const seen = new Set<string>();
  let current = startId;
  while (current !== undefined && !seen.has(current)) {
    if (current === styleId) return true;
    seen.add(current);
    current = styles.find((style) => style.id === current)?.basedOn;
  }
  return false;
}

function wornBySummary(style: TextStyle, ctx: AuthorTabCtx): HTMLElement {
  const direct = ctx.site.blocks.filter((block) => block.styleId === style.id);
  const inherited = ctx.site.blocks.filter((block) =>
    block.styleId !== style.id
    && styleChainIncludes(ctx.site.styles, block.styleId, style.id)).length;
  const parts: string[] = [];
  if (direct.length > 0) {
    parts.push(`${direct.length} block${direct.length === 1 ? "" : "s"}: ${direct.map(displayLabel).join(", ")}`);
  }
  if (inherited > 0) parts.push(`+${inherited} via based-on styles`);
  return el("div", { className: "ap-field ap-binding-summary" }, [
    el("span", { className: "ap-field-label", text: "Worn by" }),
    el("span", {
      className: "ap-binding-value",
      text: parts.length > 0 ? parts.join(" · ") : "No blocks wear this style",
    }),
  ]);
}

/** Capability greying for a style: a field greys only when EVERY block whose
 *  style chain includes this style excludes it (with that lane's own reason).
 *  A style is otherwise lane-agnostic — with no wearers nothing greys, and a
 *  field any wearer supports stays editable (the excluding lanes still strip
 *  it at apply, per the capability-honesty contract). */
function styleExcluded(
  style: TextStyle,
  ctx: AuthorTabCtx,
  deps: TextInspectorDeps,
): CapabilitySet["excluded"] {
  const wearers = ctx.site.blocks.filter((block) =>
    styleChainIncludes(ctx.site.styles, block.styleId, style.id));
  if (wearers.length === 0) return {};
  const sets = wearers.map((wearer) => deps.capabilitiesFor(wearer).excluded);
  const excluded: CapabilitySet["excluded"] = {};
  for (const field of Object.keys(sets[0]) as (keyof TypeStyleLayer)[]) {
    if (!sets.every((set) => set[field] !== undefined)) continue;
    // Mixed-lane wearers may exclude the same field for DIFFERENT reasons —
    // attributing wearer 0's wording to all of them would be false. Show the
    // shared reason when the lanes agree, otherwise every distinct one.
    const reasons = [...new Set(sets.map((set) => set[field] as string))];
    excluded[field] = reasons.join(" · ");
  }
  return excluded;
}

// ─── Scope bar + variant editor (P7c) ─────────────────────

function renderScopeBar(
  target: EditTarget,
  ctx: AuthorTabCtx,
  scope: Scope,
  setScope: (next: Scope) => void,
  commitScope: (next: Scope) => void,
): HTMLElement {
  const variants = (target.kind === "block" ? target.block.variants : target.style.variants) ?? [];
  // The variants list the ops mutate — created on the target on first add.
  const ensureVariants = (): StyleVariant[] =>
    target.kind === "block" ? (target.block.variants ??= []) : (target.style.variants ??= []);
  const dropVariants = (): void => {
    if (target.kind === "block") delete target.block.variants;
    else delete target.style.variants;
  };
  const scopeSelect = el("select", { className: "ap-input ap-select", ariaLabel: "Editing scope" }) as HTMLSelectElement;
  const base = document.createElement("option");
  base.value = "base";
  base.textContent = target.kind === "block" ? "Base (this block)" : "Base (this style)";
  scopeSelect.appendChild(base);
  variants.forEach((variant, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `Variant: ${variantLabel(variant.when, ctx)}`;
    scopeSelect.appendChild(option);
  });
  scopeSelect.value = scope === "base" ? "base" : String(scope);
  scopeSelect.addEventListener("change", () =>
    setScope(scopeSelect.value === "base" ? "base" : Number(scopeSelect.value)));

  const addSelect = el("select", { className: "ap-input ap-select", ariaLabel: "Add variant" }) as HTMLSelectElement;
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "+ Add variant…";
  addSelect.appendChild(placeholder);
  // A stop-conditioned variant is unreachable when the site has no stops
  // (activeStopId is never "") — don't offer to create a permanently-inactive
  // variant that the empty editor could not repair (consult finding D).
  const addableTypes = VARIANT_TYPES.filter((type) => type.value !== "stop" || ctx.site.stops.length > 0);
  for (const type of addableTypes) {
    const option = document.createElement("option");
    option.value = type.value;
    option.textContent = type.label;
    addSelect.appendChild(option);
  }
  addSelect.value = "";
  addSelect.addEventListener("change", () => {
    if (!addSelect.value) return;
    const list = ensureVariants();
    list.push(makeVariant(addSelect.value, ctx));
    commitScope(list.length - 1);
    ctx.structural("text");
  });

  const children: HTMLElement[] = [
    el("label", { className: "ap-field ap-scope-editing" }, [
      el("span", { className: "ap-field-label", text: "Editing" }),
      scopeSelect,
    ]),
    el("label", { className: "ap-field ap-scope-add" }, [
      el("span", { className: "ap-field-label", text: "Variants" }),
      addSelect,
    ]),
  ];

  if (scope !== "base" && variants[scope]) {
    const variant = variants[scope];
    children.push(el("div", { className: "ap-actions" }, [
      textBtn("plus", "Duplicate", {
        onClick: () => {
          const list = ensureVariants();
          list.splice(scope + 1, 0, JSON.parse(JSON.stringify(variant)) as StyleVariant);
          commitScope(scope + 1);
          ctx.structural("text");
        },
      }),
      textBtn("trash", "Delete variant", {
        tone: "danger",
        onClick: () => {
          const list = ensureVariants();
          list.splice(scope, 1);
          if (list.length === 0) dropVariants();
          commitScope("base");
          ctx.structural("text");
        },
      }),
    ]));
    children.push(renderConditionEditor(variant, ctx));
  }

  return el("div", { className: "ap-scope-bar" }, children);
}

function makeVariant(type: string, ctx: AuthorTabCtx): StyleVariant {
  switch (type) {
    case "maxWidth":
      return { when: { maxWidthPx: 767 }, layer: {} };
    case "minHeight":
      return { when: { minHeightPx: 600 }, layer: {} };
    case "maxHeight":
      return { when: { maxHeightPx: 599 }, layer: {} };
    case "hover":
      return { when: { state: "hover" }, layer: {} };
    case "selected":
      return { when: { state: "selected" }, layer: {} };
    case "stop":
      return { when: { stopId: ctx.site.stops[0]?.id ?? "" }, layer: {} };
    case "minWidth":
    default:
      return { when: { minWidthPx: 768 }, layer: {} };
  }
}

/** Add one condition part to an existing variant's `when`, choosing a default
 *  that keeps a same-axis band valid (min ≤ max) — adding the complementary
 *  bound seeds it from the existing bound rather than a fixed constant, so
 *  `{minHeightPx:600}` + "≤ height" cannot become the impossible H≥600 ∧ H≤599. */
function addConditionPart(when: VariantCondition, kind: string, ctx: AuthorTabCtx): void {
  switch (kind) {
    case "minWidth":
      when.minWidthPx = when.maxWidthPx ?? 768;
      break;
    case "maxWidth":
      when.maxWidthPx = when.minWidthPx ?? 767;
      break;
    case "minHeight":
      when.minHeightPx = when.maxHeightPx ?? 600;
      break;
    case "maxHeight":
      when.maxHeightPx = when.minHeightPx ?? 599;
      break;
    case "hover":
      when.state = "hover";
      break;
    case "selected":
      when.state = "selected";
      break;
    case "stop":
      when.stopId = ctx.site.stops[0]?.id ?? "";
      break;
  }
}

// One label per PRESENT condition, joined so a compound variant reads
// "≥ 800px · ≤ 400px tall". A single-condition variant produces the exact
// same string it did before compounds (order + wording preserved), so scope
// labels don't drift; an empty `when` reads "Always".
function variantLabel(when: VariantCondition, ctx: AuthorTabCtx): string {
  const parts: string[] = [];
  if (when.minWidthPx !== undefined) parts.push(`≥ ${when.minWidthPx}px`);
  if (when.maxWidthPx !== undefined) parts.push(`≤ ${when.maxWidthPx}px`);
  if (when.minHeightPx !== undefined) parts.push(`≥ ${when.minHeightPx}px tall`);
  if (when.maxHeightPx !== undefined) parts.push(`≤ ${when.maxHeightPx}px tall`);
  if (when.state) parts.push(when.state === "hover" ? "On hover" : "When selected");
  if (when.stopId !== undefined) {
    parts.push(`At ${ctx.site.stops.find((stop) => stop.id === when.stopId)?.label ?? when.stopId}`);
  }
  if (when.progress) parts.push(`Scroll ${when.progress.from}–${when.progress.to}`);
  if (when.placeId !== undefined) parts.push(`Place ${when.placeId}`);
  if (when.distanceM) parts.push(`Distance ${when.distanceM.from}–${when.distanceM.to}m`);
  if (when.tier) parts.push(`Tier ${when.tier}`);
  return parts.length > 0 ? parts.join(" · ") : "Always";
}

// A variant's `when` can AND several conditions; the editor renders a removable
// row for EVERY present key (so a progress/place/distance/tier condition can
// never hide behind the width/height/state/stop controls), and the "+ condition"
// select adds an ABSENT addable kind. Value edits stay onChange (caret kept);
// add/remove are structural (they change the row set → rerender).
function renderConditionEditor(variant: StyleVariant, ctx: AuthorTabCtx): HTMLElement {
  const when = variant.when;
  const rows: HTMLElement[] = [];
  const removeBtn = (onRemove: () => void): HTMLButtonElement =>
    el("button", {
      className: "ap-ctrl-clear",
      type: "button",
      title: "Remove condition",
      ariaLabel: "Remove condition",
      onClick: () => { onRemove(); ctx.structural("text"); },
    }, ["×"]) as HTMLButtonElement;
  const boundRow = (
    hint: string,
    get: () => number,
    set: (n: number) => void,
    remove: () => void,
  ): HTMLElement => {
    const input = el("input", {
      className: "ap-input",
      type: "number",
      attrs: { value: String(get()), step: "1", "aria-label": hint },
    }) as HTMLInputElement;
    input.addEventListener("input", () => {
      if (input.value.trim() === "") return;
      const px = Number(input.value);
      if (!Number.isFinite(px)) return;
      set(px);
      // onChange only (no rerender) so the field keeps its caret; the scope
      // label refreshes on the next structural rerender.
      ctx.onChange("text");
    });
    return el("div", { className: "ap-condition-row" }, [
      el("span", { className: "ap-hint", text: hint }), input, removeBtn(remove),
    ]);
  };
  const hintRow = (text: string, remove: () => void): HTMLElement =>
    el("div", { className: "ap-condition-row" }, [
      el("span", { className: "ap-hint", text }), removeBtn(remove),
    ]);

  if (when.minWidthPx !== undefined) {
    rows.push(boundRow("min width (px)", () => when.minWidthPx!, (n) => { when.minWidthPx = n; }, () => { delete when.minWidthPx; }));
  }
  if (when.maxWidthPx !== undefined) {
    rows.push(boundRow("max width (px)", () => when.maxWidthPx!, (n) => { when.maxWidthPx = n; }, () => { delete when.maxWidthPx; }));
  }
  if (when.minHeightPx !== undefined) {
    rows.push(boundRow("min height (px)", () => when.minHeightPx!, (n) => { when.minHeightPx = n; }, () => { delete when.minHeightPx; }));
  }
  if (when.maxHeightPx !== undefined) {
    rows.push(boundRow("max height (px)", () => when.maxHeightPx!, (n) => { when.maxHeightPx = n; }, () => { delete when.maxHeightPx; }));
  }
  if (when.state !== undefined) {
    rows.push(hintRow(when.state === "hover" ? "On hover" : "When selected", () => { delete when.state; }));
  }
  if (when.stopId !== undefined) {
    const select = el("select", { className: "ap-input ap-select", ariaLabel: "variant stop" }) as HTMLSelectElement;
    for (const stop of ctx.site.stops) {
      const option = document.createElement("option");
      option.value = stop.id ?? "";
      option.textContent = stop.label;
      select.appendChild(option);
    }
    select.value = when.stopId;
    select.addEventListener("change", () => {
      when.stopId = select.value;
      ctx.structural("text");
    });
    rows.push(el("div", { className: "ap-condition-row" }, [select, removeBtn(() => { delete when.stopId; })]));
  }
  // Non-addable legacy conditions — rendered read-only + removable so they are
  // never silently hidden (they have no creation UI, but must stay visible).
  if (when.progress !== undefined) {
    rows.push(hintRow(`Scroll ${when.progress.from}–${when.progress.to}`, () => { delete when.progress; }));
  }
  if (when.placeId !== undefined) {
    rows.push(hintRow(`Place ${when.placeId}`, () => { delete when.placeId; }));
  }
  if (when.distanceM !== undefined) {
    rows.push(hintRow(`Distance ${when.distanceM.from}–${when.distanceM.to}m`, () => { delete when.distanceM; }));
  }
  if (when.tier !== undefined) {
    rows.push(hintRow(`Tier ${when.tier}`, () => { delete when.tier; }));
  }

  const addable: { value: string; label: string }[] = [];
  if (when.minWidthPx === undefined) addable.push({ value: "minWidth", label: "≥ width" });
  if (when.maxWidthPx === undefined) addable.push({ value: "maxWidth", label: "≤ width" });
  if (when.minHeightPx === undefined) addable.push({ value: "minHeight", label: "≥ height" });
  if (when.maxHeightPx === undefined) addable.push({ value: "maxHeight", label: "≤ height" });
  if (when.state === undefined) {
    addable.push({ value: "hover", label: "On hover" });
    addable.push({ value: "selected", label: "When selected" });
  }
  if (when.stopId === undefined && ctx.site.stops.length > 0) {
    addable.push({ value: "stop", label: "At a stop" });
  }

  const children: (HTMLElement | string)[] = [el("span", { className: "ap-field-label", text: "When" }), ...rows];
  if (addable.length > 0) {
    const addSelect = el("select", { className: "ap-input ap-select", ariaLabel: "Add condition" }) as HTMLSelectElement;
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "+ condition";
    addSelect.appendChild(placeholder);
    for (const kind of addable) {
      const option = document.createElement("option");
      option.value = kind.value;
      option.textContent = kind.label;
      addSelect.appendChild(option);
    }
    addSelect.value = "";
    addSelect.addEventListener("change", () => {
      if (!addSelect.value) return;
      addConditionPart(when, addSelect.value, ctx);
      ctx.structural("text");
    });
    children.push(addSelect);
  }
  return el("div", { className: "ap-condition-editor" }, children);
}

// ─── Domain-group sub-tab bar (DD1) ───────────────────────
// The nine domain groups render as a fixed 2-row pill bar; each group has its
// own pane, and exactly ONE is visible at a time (no accordions, no
// scroll-hunting — hidden panes add no scroll height). A pill click just toggles
// which pane is visible: no rerender, no DOM teardown, so the bar keeps its
// keyboard focus AND every pane's inputs keep their in-progress values (a lazy
// rebuild would roll a mid-edit value back to the build-time snapshot).
// `activeGroupId` persists per panel instance across the inspector's own
// rerenders (clear / scope switch / restyle / font set).

// Short pill labels (full labels are the group.label, shown as the pill title).
const GROUP_PILL_LABEL: Record<string, string> = {
  character: "Character",
  paragraph: "Paragraph",
  opentype: "OpenType",
  rhythm: "Rhythm",
  columns: "Columns",
  wrap: "Wrap",
  justification: "Justify",
  breaks: "Keeps",
  firstline: "First line",
};

// Per-group pane hints — a LOCAL id→hint map (replaces the old index-based
// appendGroupHint), so no InspectorGroup/authorPanelTypes change (consult fold).
const GROUP_HINT: Record<string, string> = {
  character: "Variable-font axes: coming in the fonts browser.",
  firstline: "First-line styling — full options in a later phase.",
};

// The two pill rows (4 + 5) — the InDesign-panel grouping the user froze.
const GROUP_ROWS: string[][] = [
  ["character", "paragraph", "opentype", "rhythm"],
  ["columns", "wrap", "justification", "breaks", "firstline"],
];

// Monotonic sequence for the tabpanel's DOM id — NOT UI state (never read for
// behavior), only to keep `aria-controls`→panel unique when TWO embeds mount
// panels in ONE document (a shared literal id would collide, and getElementById
// would resolve the second panel's tabs to the first panel's pane).
let groupPaneSeq = 0;

/** Build the sub-tab bar + one pane per group (only the active one visible).
 *  `uiState.activeGroupId` selects the open group and persists across rerenders;
 *  a pill click toggles pane visibility (no rerender, no teardown), keeping bar
 *  DOM, focus, and every pane's input values intact (the focus + value contract). */
function renderGroupTabs(
  groups: InspectorGroup[],
  uiState: InspectorUiState,
  tierLabels: Record<ControlTier, string> | undefined,
): HTMLElement {
  const byId = new Map(groups.map((group) => [group.id, group]));
  // Defensive: an activeGroupId absent from the current set falls back to the
  // first group (and persists the correction).
  if (!byId.has(uiState.activeGroupId)) {
    uiState.activeGroupId = groups[0]?.id ?? "character";
  }

  const seq = ++groupPaneSeq;
  const paneIdFor = (id: string): string => `ap-group-pane-${seq}-${id}`;
  const pills = new Map<string, HTMLButtonElement>();
  const panes = new Map<string, HTMLElement>();

  // Build EVERY group's pane once (all controls) and toggle visibility on switch
  // — the input DOM persists, so a mid-edit value is NOT rolled back to the
  // build-time resolved snapshot when the group is revisited (consult #3), and
  // `get()` is never re-called on a pill switch. Hidden panes add no scroll
  // height, so the one-visible-pane scroll win is preserved. Each pill controls
  // its OWN tabpanel (standard ARIA tabs).
  const paneWrap = el("div", { className: "ap-stack ap-group-panes" });
  for (const group of groups) {
    const children: HTMLElement[] = group.controls.map((control) =>
      renderControl(control, tierLabels));
    const hint = GROUP_HINT[group.id];
    if (hint) children.push(el("div", { className: "ap-hint", text: hint }));
    const pane = el("div", {
      className: "ap-group-pane",
      role: "tabpanel",
      attrs: { id: paneIdFor(group.id), "aria-label": `${group.label} controls`, tabindex: "0" },
    }, [el("div", { className: "ap-stack" }, children)]);
    pane.hidden = group.id !== uiState.activeGroupId;
    panes.set(group.id, pane);
    paneWrap.appendChild(pane);
  }

  // Activate a group: persist it, restyle the pills (aria-selected + roving
  // tabindex), and reveal its pane. No rerender, no DOM teardown — the bar and
  // every pane's inputs survive intact.
  const activate = (groupId: string, focusPill: boolean): void => {
    uiState.activeGroupId = groupId;
    for (const [id, pill] of pills) {
      const on = id === groupId;
      pill.setAttribute("aria-selected", String(on));
      pill.tabIndex = on ? 0 : -1;
    }
    for (const [id, pane] of panes) pane.hidden = id !== groupId;
    if (focusPill) pills.get(groupId)?.focus();
  };

  const order = groups.map((group) => group.id);
  const moveFocus = (fromId: string, delta: number): void => {
    const index = order.indexOf(fromId);
    if (index < 0 || order.length === 0) return;
    activate(order[(index + delta + order.length) % order.length], true);
  };

  const rows = GROUP_ROWS.map((rowIds) => {
    const rowPills = rowIds
      .filter((id) => byId.has(id))
      .map((id) => {
        const group = byId.get(id)!;
        // A "fully excluded" group (every control greyed by the lane) shows
        // muted styling + the lane reason as title, but stays ACTIVATABLE
        // (the pane shows the greyed value echoes) — NOT aria-disabled.
        const excluded = group.controls.length > 0
          && group.controls.every((control) => control.disabledReason !== undefined);
        const reasons = excluded
          ? [...new Set(group.controls.map((control) => control.disabledReason as string))].join(" · ")
          : "";
        const selected = id === uiState.activeGroupId;
        const pill = el("button", {
          className: excluded ? "ap-subtab ap-subtab-muted" : "ap-subtab",
          type: "button",
          role: "tab",
          title: excluded ? reasons : group.label,
          ariaLabel: group.label,
          ariaSelected: selected,
          attrs: { tabindex: selected ? "0" : "-1", "aria-controls": paneIdFor(id) },
          // Focus the clicked pill (native for a real mouse click; also fixes a
          // programmatic click leaving focus on the previously-active pill —
          // consult #6).
          onClick: () => activate(id, true),
        }, [GROUP_PILL_LABEL[id] ?? group.label]);
        pill.addEventListener("keydown", (event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            event.preventDefault();
            moveFocus(id, 1);
          } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
            event.preventDefault();
            moveFocus(id, -1);
          }
        });
        pills.set(id, pill);
        return pill;
      });
    return el("div", { className: "ap-subtab-row", role: "presentation" }, rowPills);
  });

  const bar = el("div", {
    className: "ap-subtabs",
    role: "tablist",
    attrs: { "aria-label": "Type groups" },
  }, rows);
  return el("div", { className: "ap-stack ap-groups" }, [bar, paneWrap]);
}

// ─── Helpers ──────────────────────────────────────────────

function optionLabel(value: string): string {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function displayLabel(block: TextBlock): string {
  if (block.label) return block.label;
  const text = flatten(block.content).trim().replace(/\s+/g, " ");
  if (text) return text.length > 44 ? `${text.slice(0, 41)}…` : text;
  return `${PRESENTATION_LABEL[block.presentation]} block`;
}

function flatten(content: TextBlock["content"]): string {
  return typeof content === "string" ? content : content.map((run) => run.text).join("");
}

function resolvedLeading(layer: TypeStyleLayer): number {
  // lineHeightPx wins in the lanes when present (ColumnsLane), so the displayed
  // multiplier must reflect the ACTUAL pitch, not a shadowed unitless value.
  if (layer.lineHeightPx !== undefined) {
    return roundTo(layer.lineHeightPx / (layer.sizePx ?? 16), 3);
  }
  if (layer.lineHeight !== undefined) return layer.lineHeight;
  return 1.2;
}

function familyOptions(ctx: AuthorTabCtx): { value: string; label: string }[] {
  const families = new Map<string, string>();
  const token = ctx.site.settings?.typography?.fontFamily;
  if (token) families.set(token, familyLabel(token));
  for (const face of ctx.site.settings?.fonts ?? []) {
    if (!families.has(face.family)) families.set(face.family, face.family);
  }
  // Every registered family (curated stable + BYO) is pickable — TextSystem
  // loadFont ensureLoad's whatever a block resolves to, so a picked stable
  // family loads on use (P8b). Absent registry (no fonts DI) → token + BYO only.
  for (const meta of ctx.fonts?.list() ?? []) {
    if (!families.has(meta.family)) families.set(meta.family, meta.family);
  }
  return [...families].map(([value, label]) => ({ value, label }));
}

/** A font stack ("DM Sans", Helvetica…) shows its first family in the picker. */
function familyLabel(family: string): string {
  const first = family.split(",")[0]?.trim().replace(/^["']|["']$/g, "");
  return first || family;
}

/** Cascade MERGE order, not CSS-style specificity: block variants merge AFTER
 *  block overrides (resolve(): token → style chain → overrides → variants),
 *  and a style's own variants merge after its own base — so "variant" is the
 *  last word in both target kinds (consult finding: an override-beats-variant
 *  rank lies whenever a matching variant grid snaps an override pitch).
 *  Known limit: tiers carry no chain POSITION, so an ancestor's variant vs a
 *  descendant's base (both mid-chain) cannot be ordered from tiers alone —
 *  acceptable for a provenance hint. */
const TIER_RANK: Record<ControlTier, number> = {
  none: 0,
  token: 1,
  style: 2,
  override: 3,
  variant: 4,
};

/** The later-merged cascade contributor — used for grid-derived lineHeightPx,
 *  whose displayed value is co-produced by the authored pitch AND the grid. */
function maxTier(a: ControlTier, b: ControlTier): ControlTier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function trim(value: number): string {
  return String(Number(value.toFixed(2)));
}
