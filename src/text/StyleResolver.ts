import type {
  ControlTier,
  EaseName,
  ResolveContext,
  Resolved,
  StyleVariant,
  TextBlock,
  TextStyle,
  TypeStyleLayer,
  VariantCondition,
} from "./TextModel";

interface TypographyTokens {
  fontFamily?: string;
  baseSizePx?: number;
  lineHeight?: number;
  measureCh?: number;
  scaleRatio?: number;
}

interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface OKLab {
  l: number;
  a: number;
  b: number;
  alpha: number;
}

const warnedCycles = new Set<string>();
const colorFields = new Set<keyof TypeStyleLayer>(["color", "decorationColor"]);

export function tokensToLayer(tokens?: TypographyTokens): TypeStyleLayer {
  const layer: TypeStyleLayer = {};
  if (tokens?.fontFamily !== undefined) layer.fontFamily = tokens.fontFamily;
  if (tokens?.baseSizePx !== undefined) layer.sizePx = tokens.baseSizePx;
  if (tokens?.lineHeight !== undefined) layer.lineHeight = tokens.lineHeight;
  if (tokens?.measureCh !== undefined) layer.measureCh = tokens.measureCh;
  return layer;
}

// The discrete (non-interpolated) condition gates, shared by matchesCondition
// and variantT so the two matchers can never disagree on width/height/state/
// stop/place/tier. Height is a discrete gate like width — never a range.
function matchesDiscrete(when: VariantCondition, ctx: ResolveContext): boolean {
  if (when.minWidthPx !== undefined && ctx.containerW < when.minWidthPx) return false;
  if (when.maxWidthPx !== undefined && ctx.containerW > when.maxWidthPx) return false;
  if (when.minHeightPx !== undefined && ctx.containerH < when.minHeightPx) return false;
  if (when.maxHeightPx !== undefined && ctx.containerH > when.maxHeightPx) return false;
  if (when.state !== undefined && !ctx.states?.has(when.state)) return false;
  if (when.stopId !== undefined && ctx.activeStopId !== when.stopId) return false;
  if (when.placeId !== undefined && ctx.placeId !== when.placeId) return false;
  if (when.tier !== undefined && ctx.tier !== when.tier) return false;
  return true;
}

export function matchesCondition(when: VariantCondition, ctx: ResolveContext): boolean {
  if (!matchesDiscrete(when, ctx)) return false;
  if (when.progress !== undefined && !inRange(ctx.progress, when.progress.from, when.progress.to)) return false;
  if (when.distanceM !== undefined && !inRange(ctx.distanceM, when.distanceM.from, when.distanceM.to)) return false;
  return true;
}

/** The basedOn chain ending at `id`, ancestor-first, cycle-safe. */
function chainOf(styles: TextStyle[], id: string): TextStyle[] {
  const byId = new Map(styles.map((style) => [style.id, style]));
  const chain: TextStyle[] = [];
  const path: string[] = [];
  const visiting = new Set<string>();

  const visit = (styleId: string): void => {
    const style = byId.get(styleId);
    if (!style) return;

    visiting.add(styleId);
    path.push(styleId);

    if (style.basedOn) {
      if (visiting.has(style.basedOn)) {
        warnCycle(path, style.basedOn);
      } else {
        visit(style.basedOn);
      }
    }

    chain.push(style);
    path.pop();
    visiting.delete(styleId);
  };

  visit(id);
  return chain;
}

export function flattenBasedOn(styles: TextStyle[], id: string): TypeStyleLayer[] {
  return chainOf(styles, id).map((style) => style.base);
}

export function resolve(
  block: TextBlock,
  styles: TextStyle[],
  tokens: TypographyTokens | undefined,
  ctx: ResolveContext,
): Resolved {
  const resolved: Resolved = { layer: {}, tiers: {} };
  mergeLayer(resolved, tokensToLayer(tokens), "token");

  const style = block.styleId === undefined ? undefined : styles.find((candidate) => candidate.id === block.styleId);
  if (style) {
    // Each style in the chain contributes base then its own variants, so an ancestor's
    // conditional layers survive inheritance; a descendant's base still wins over them.
    for (const ancestor of chainOf(styles, style.id)) {
      mergeLayer(resolved, ancestor.base, "style");
      for (const variant of ancestor.variants ?? []) applyVariant(resolved, variant, ctx);
    }
  }

  if (block.overrides) mergeLayer(resolved, block.overrides, "override");
  for (const variant of block.variants ?? []) applyVariant(resolved, variant, ctx);

  applyBaselineGrid(resolved);
  return resolved;
}

function inRange(value: number | undefined, from: number, to: number): boolean {
  return value !== undefined && from <= value && value <= to;
}

function warnCycle(path: string[], repeatedId: string): void {
  const start = path.indexOf(repeatedId);
  const cycle = path.slice(start);
  const rotations = cycle.map((_, index) => [...cycle.slice(index), ...cycle.slice(0, index)].join("->"));
  const key = rotations.sort()[0] ?? repeatedId;
  if (warnedCycles.has(key)) return;
  warnedCycles.add(key);
  console.warn(`Text style basedOn cycle detected (${[...cycle, repeatedId].join(" -> ")}); ignoring the offending basedOn.`);
}

function mergeLayer(resolved: Resolved, layer: TypeStyleLayer, tier: ControlTier): void {
  const target = resolved.layer as Record<keyof TypeStyleLayer, TypeStyleLayer[keyof TypeStyleLayer]>;
  for (const field of Object.keys(layer) as Array<keyof TypeStyleLayer>) {
    const value = layer[field];
    if (value === undefined) continue;
    target[field] = value;
    resolved.tiers[field] = tier;
  }
}

function applyVariant(resolved: Resolved, variant: StyleVariant, ctx: ResolveContext): void {
  const t = variantT(variant.when, ctx);
  if (t === false) return;
  if (t === undefined) {
    mergeLayer(resolved, variant.layer, "variant");
    return;
  }
  if (t <= 0) return;

  const interpolated: TypeStyleLayer = {};
  const output = interpolated as Record<keyof TypeStyleLayer, TypeStyleLayer[keyof TypeStyleLayer]>;
  for (const field of Object.keys(variant.layer) as Array<keyof TypeStyleLayer>) {
    const target = variant.layer[field];
    if (target === undefined) continue;
    const source = resolved.layer[field];

    if (typeof target === "number" && typeof source === "number") {
      output[field] = source + (target - source) * t;
    } else if (colorFields.has(field) && typeof target === "string" && typeof source === "string") {
      output[field] = interpolateColor(source, target, t);
    } else {
      output[field] = target;
    }
  }
  mergeLayer(resolved, interpolated, "variant");
}

function variantT(when: VariantCondition, ctx: ResolveContext): number | undefined | false {
  if (!matchesDiscrete(when, ctx)) return false;

  const rangeValues: number[] = [];
  if (when.progress !== undefined) {
    let value = rangeT(ctx.progress, when.progress.from, when.progress.to, when.progress.ease);
    if (value === false) return false;
    if (ctx.reducedMotion) value = value >= 0.5 ? 1 : 0;
    rangeValues.push(value);
  }
  if (when.distanceM !== undefined) {
    let value = rangeT(ctx.distanceM, when.distanceM.from, when.distanceM.to, when.distanceM.ease);
    if (value === false) return false;
    if (ctx.reducedMotion) value = value >= 0.5 ? 1 : 0;
    rangeValues.push(value);
  }
  return rangeValues.length === 0 ? undefined : Math.min(...rangeValues);
}

function rangeT(value: number | undefined, from: number, to: number, easeName?: EaseName): number | false {
  // Bounded window, matching inRange and BlockBinding.range: outside [from, to]
  // the variant does not apply at all. Inside, t ramps toward `to` — so exiting
  // past `to` steps from full styling to none; authors who want ramp-and-hold
  // extend `to` to the end of the traversal instead.
  if (value === undefined || to < from || value < from || value > to) return false;
  const linear = to === from ? 1 : clamp01((value - from) / (to - from));
  return applyEase(linear, easeName ?? "linear");
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Shared easing for variant ranges AND block fades — one home for the math. */
export function applyEase(t: number, name: EaseName): number {
  switch (name) {
    case "ease-in":
      return t * t;
    case "ease-out":
      return 1 - (1 - t) * (1 - t);
    case "ease-in-out":
      return t * t * (3 - 2 * t);
    case "linear":
      return t;
  }
}

function interpolateColor(from: string, to: string, t: number): string {
  const fromColor = parseColor(from);
  const toColor = parseColor(to);
  if (!fromColor || !toColor) return to;

  const a = srgbToOKLab(fromColor);
  const b = srgbToOKLab(toColor);
  return formatColor(oklabToSrgb({
    l: a.l + (b.l - a.l) * t,
    a: a.a + (b.a - a.a) * t,
    b: a.b + (b.b - a.b) * t,
    alpha: a.alpha + (b.alpha - a.alpha) * t,
  }));
}

function parseColor(value: string): Color | undefined {
  const text = value.trim().toLowerCase();
  if (text.startsWith("#")) return parseHexColor(text);

  const number = "([+-]?(?:\\d+\\.?\\d*|\\.\\d+))";
  const separator = "(?:\\s*,\\s*|\\s+)";
  const match = text.match(new RegExp(
    `^rgba?\\(\\s*${number}(%)?${separator}${number}(%)?${separator}${number}(%)?`
      + `(?:\\s*(?:,|/)\\s*${number}(%)?)?\\s*\\)$`,
  ));
  if (!match) return undefined;
  return {
    r: clamp01(Number(match[1]) / (match[2] ? 100 : 255)),
    g: clamp01(Number(match[3]) / (match[4] ? 100 : 255)),
    b: clamp01(Number(match[5]) / (match[6] ? 100 : 255)),
    a: match[7] === undefined ? 1 : clamp01(Number(match[7]) / (match[8] ? 100 : 1)),
  };
}

function parseHexColor(value: string): Color | undefined {
  const hex = value.slice(1);
  if (![3, 4, 6, 8].includes(hex.length) || !/^[0-9a-f]+$/.test(hex)) return undefined;
  const expanded = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join("") : hex;
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16) / 255,
    g: Number.parseInt(expanded.slice(2, 4), 16) / 255,
    b: Number.parseInt(expanded.slice(4, 6), 16) / 255,
    a: expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1,
  };
}

function srgbToOKLab(color: Color): OKLab {
  const r = srgbToLinear(color.r);
  const g = srgbToLinear(color.g);
  const b = srgbToLinear(color.b);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    alpha: color.a,
  };
}

function oklabToSrgb(color: OKLab): Color {
  const lRoot = color.l + 0.3963377774 * color.a + 0.2158037573 * color.b;
  const mRoot = color.l - 0.1055613458 * color.a - 0.0638541728 * color.b;
  const sRoot = color.l - 0.0894841775 * color.a - 1.291485548 * color.b;
  const l = lRoot * lRoot * lRoot;
  const m = mRoot * mRoot * mRoot;
  const s = sRoot * sRoot * sRoot;

  return {
    r: clamp01(linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    g: clamp01(linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    b: clamp01(linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
    a: clamp01(color.alpha),
  };
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  return value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
}

function formatColor(color: Color): string {
  const bytes = [color.r, color.g, color.b, color.a].map((channel) => Math.round(clamp01(channel) * 255));
  const hex = bytes.map((channel) => channel.toString(16).padStart(2, "0"));
  return `#${hex.slice(0, color.a < 1 ? 4 : 3).join("")}`;
}

function applyBaselineGrid(resolved: Resolved): void {
  const grid = resolved.layer.baselineGridPx;
  if (grid === undefined) return;

  const pitch = resolved.layer.lineHeightPx
    ?? (resolved.layer.lineHeight !== undefined && resolved.layer.sizePx !== undefined
      ? resolved.layer.lineHeight * resolved.layer.sizePx
      : undefined);
  if (pitch === undefined) return;

  resolved.preGridLineHeight = {
    value: resolved.layer.lineHeightPx,
    tier: resolved.tiers.lineHeightPx,
  };
  resolved.layer.lineHeightPx = Math.ceil(pitch / grid) * grid;
  resolved.tiers.lineHeightPx ??= resolved.tiers.baselineGridPx;
}
