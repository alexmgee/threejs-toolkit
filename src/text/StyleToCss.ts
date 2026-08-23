import type { TypeStyleLayer } from "./TextModel";

export const UID_ATTR = "data-sjt-uid";
const WRAP_CLASS = "sjt-wrap";

let nextUid = 1;
const elementUids = new WeakMap<HTMLElement, string>();
const appliedProperties = new WeakMap<HTMLElement, Set<string>>();

/** Per-root generated-rule state. The shadow-DOM boundary blocks a <style> in
 *  the main document head from reaching shadow descendants, so each root
 *  (Document or ShadowRoot) owns its own <style> and uid→rules registry. This
 *  also makes multiple hosts on one page independent, and a discarded shadow
 *  root GCs its entry (and the <style> inside it) for free. */
interface RootStyleState {
  style: HTMLStyleElement;
  rules: Map<string, string[]>;
}
const rootStyleStates = new WeakMap<Document | ShadowRoot, RootStyleState>();

/** The root each element's rules were actually INSTALLED into, recorded at write
 *  time. Cleanup must use this rather than re-deriving: a detached element (lanes
 *  remove the node before clearing) no longer reports its former ShadowRoot, so
 *  re-deriving routes the clear to the document and orphans the rule in the shadow
 *  stylesheet forever — and materializes a spurious document-root state. */
const elementRoots = new WeakMap<HTMLElement, Document | ShadowRoot>();

/** Cross-realm-safe ShadowRoot test — `instanceof` compares against the current
 *  global's constructor, so a root from another window/iframe would fail it. */
function isShadowRoot(node: Node): node is ShadowRoot {
  return node.nodeType === Node.DOCUMENT_FRAGMENT_NODE
    && (node as ShadowRoot).host !== undefined;
}

/** The style root an element's generated rules must be written to: its ShadowRoot
 *  when shadow-hosted, else its owning Document. Valid only while ATTACHED — use
 *  the recorded install root (elementRoots) for reads and clears. */
function styleRootOf(el: HTMLElement): Document | ShadowRoot {
  const root = el.getRootNode();
  return isShadowRoot(root) ? root : el.ownerDocument;
}

function uidFor(el: HTMLElement): string {
  let uid = elementUids.get(el);
  if (!uid) {
    uid = String(nextUid++);
    elementUids.set(el, uid);
  }
  el.setAttribute(UID_ATTR, uid);
  return uid;
}

function ensureRootStyle(root: Document | ShadowRoot): RootStyleState {
  let state = rootStyleStates.get(root);
  if (!state) {
    const ownerDoc = isShadowRoot(root) ? root.ownerDocument : root;
    const style = ownerDoc.createElement("style");
    style.setAttribute("data-sjt-style-rules", "");
    const mount = isShadowRoot(root) ? root : (root.head ?? root.documentElement);
    mount.appendChild(style);
    state = { style, rules: new Map() };
    rootStyleStates.set(root, state);
  }
  return state;
}

function flushRules(root: Document | ShadowRoot, uid: string, rules: string[]): void {
  // Never materialize a root's <style> just to clear a rule that was never there.
  if (rules.length === 0 && !rootStyleStates.has(root)) return;
  const state = ensureRootStyle(root);
  if (rules.length > 0) state.rules.set(uid, rules);
  else state.rules.delete(uid);
  state.style.textContent = [...state.rules.values()].flat().join("\n");
}

function setCss(el: HTMLElement, property: string, value: string): void {
  el.style.setProperty(property, value);
  let properties = appliedProperties.get(el);
  if (!properties) {
    properties = new Set();
    appliedProperties.set(el, properties);
  }
  properties.add(property);
}

function quoteAxis(tag: string): string {
  return `"${tag.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function variationSettings(layer: TypeStyleLayer): string | null {
  const settings = new Map<string, number>();
  if (layer.weight !== undefined) settings.set("wght", layer.weight);
  if (layer.width !== undefined) settings.set("wdth", layer.width);
  if (layer.slant !== undefined) settings.set("slnt", layer.slant);
  if (typeof layer.opticalSize === "number") settings.set("opsz", layer.opticalSize);
  for (const [tag, value] of Object.entries(layer.axes ?? {})) settings.set(tag, value);
  if (settings.size === 0) return null;
  return [...settings].map(([tag, value]) => `${quoteAxis(tag)} ${value}`).join(", ");
}

function ligatureValue(layer: TypeStyleLayer): string | null {
  const values: string[] = [];
  if (layer.ligatures === "none") {
    values.push("no-common-ligatures", "no-discretionary-ligatures", "no-historical-ligatures");
  } else if (layer.ligatures === "common") {
    values.push("common-ligatures", "no-discretionary-ligatures");
  } else if (layer.ligatures === "all") {
    values.push("common-ligatures", "discretionary-ligatures");
  }
  if (layer.contextualAlternates !== undefined) {
    values.push(layer.contextualAlternates ? "contextual" : "no-contextual");
  }
  return values.length > 0 ? values.join(" ") : null;
}

function numericVariantValue(layer: TypeStyleLayer): string | null {
  const values: string[] = [];
  if (layer.numeralStyle) values.push(`${layer.numeralStyle}-nums`);
  if (layer.numeralSpacing) values.push(`${layer.numeralSpacing}-nums`);
  if (layer.fractions) values.push("diagonal-fractions");
  if (layer.slashedZero) values.push("slashed-zero");
  if (layer.ordinals) values.push("ordinal");
  const explicitlyReset = layer.fractions === false
    || layer.slashedZero === false
    || layer.ordinals === false;
  if (values.length === 0 && explicitlyReset) return "normal";
  return values.length > 0 ? values.join(" ") : null;
}

function featureSettings(layer: TypeStyleLayer): string | null {
  const settings: string[] = [];
  for (const value of layer.stylisticSets ?? []) {
    settings.push(`${quoteAxis(`ss${String(value).padStart(2, "0")}`)} 1`);
  }
  for (const value of layer.characterVariants ?? []) {
    settings.push(`${quoteAxis(`cv${String(value).padStart(2, "0")}`)} 1`);
  }
  if (layer.swash !== undefined) settings.push(`${quoteAxis("swsh")} ${layer.swash ? 1 : 0}`);
  return settings.length > 0 ? settings.join(", ") : null;
}

function decorationLine(layer: TypeStyleLayer): string | null {
  if (layer.underline === undefined && layer.strikethrough === undefined) return null;
  const lines: string[] = [];
  if (layer.underline) lines.push("underline");
  if (layer.strikethrough) lines.push("line-through");
  return lines.length > 0 ? lines.join(" ") : "none";
}

function fontDeclarations(layer: TypeStyleLayer): string[] {
  const declarations: string[] = [];
  const add = (property: string, value: string | number | undefined): void => {
    if (value !== undefined) declarations.push(`${property}:${value}`);
  };

  add("font-family", layer.fontFamily);
  add("font-weight", layer.weight);
  if (layer.width !== undefined) add("font-stretch", `${layer.width}%`);
  if (layer.italic !== undefined || layer.slant !== undefined) {
    add("font-style", layer.italic || (layer.slant ?? 0) < 0 ? "italic" : "normal");
  }
  if (layer.opticalSize !== undefined) add("font-optical-sizing", layer.opticalSize === "auto" ? "auto" : "none");
  const variations = variationSettings(layer);
  if (variations) add("font-variation-settings", variations);
  if (layer.sizePx !== undefined) add("font-size", `${layer.sizePx}px`);
  if (layer.lineHeightPx !== undefined) add("line-height", `${layer.lineHeightPx}px`);
  else add("line-height", layer.lineHeight);
  return declarations;
}

function decorationDeclarations(layer: TypeStyleLayer): string[] {
  const declarations: string[] = [];
  const line = decorationLine(layer);
  if (line) declarations.push(`text-decoration-line:${line}`);
  if (layer.underlineOffsetPx !== undefined) declarations.push(`text-underline-offset:${layer.underlineOffsetPx}px`);
  if (layer.decorationThicknessPx !== undefined) declarations.push(`text-decoration-thickness:${layer.decorationThicknessPx}px`);
  if (layer.decorationColor !== undefined) declarations.push(`text-decoration-color:${layer.decorationColor}`);
  if (layer.decorationStyle !== undefined) declarations.push(`text-decoration-style:${layer.decorationStyle}`);
  return declarations;
}

function firstLineDeclarations(layer: TypeStyleLayer): string[] {
  const declarations = [...fontDeclarations(layer), ...decorationDeclarations(layer)];
  if (layer.color !== undefined) declarations.push(`color:${layer.color}`);
  // ::first-line also accepts spacing and shadow — dropping them silently made
  // an authored first-line shadow vanish with no signal.
  if (layer.trackingEm !== undefined) declarations.push(`letter-spacing:${layer.trackingEm}em`);
  if (layer.wordSpacingEm !== undefined) declarations.push(`word-spacing:${layer.wordSpacingEm}em`);
  if (layer.shadow !== undefined) declarations.push(`text-shadow:${layer.shadow}`);
  return declarations;
}

function applyOpenType(el: HTMLElement, layer: TypeStyleLayer): void {
  if (layer.caps !== undefined) setCss(el, "font-variant-caps", layer.caps);
  const numeric = numericVariantValue(layer);
  if (numeric) setCss(el, "font-variant-numeric", numeric);
  const ligatures = ligatureValue(layer);
  if (ligatures) setCss(el, "font-variant-ligatures", ligatures);
  if (layer.positionVariant !== undefined) setCss(el, "font-variant-position", layer.positionVariant);
  if (layer.kerning !== undefined) setCss(el, "font-kerning", layer.kerning ? "normal" : "none");
  const features = featureSettings(layer);
  if (features) setCss(el, "font-feature-settings", features);
}

function applyGeneratedRules(el: HTMLElement, layer: TypeStyleLayer): void {
  const uid = uidFor(el);
  const selector = `[${UID_ATTR}="${uid}"]`;
  const rules: string[] = [];

  if (layer.initialLetter) {
    const raise = layer.initialLetter.raise === undefined ? "" : ` ${layer.initialLetter.raise}`;
    rules.push(`${selector}::first-letter{initial-letter:${layer.initialLetter.lines}${raise}}`);
  }
  if (layer.firstLine) {
    const declarations = firstLineDeclarations(layer.firstLine);
    if (declarations.length > 0) rules.push(`${selector}::first-line{${declarations.join(";")}}`);
  }
  if (layer.columnSpanFirst) rules.push(`${selector} > :first-child{column-span:all}`);

  if (layer.wrapShape) {
    const wrap = el.ownerDocument.createElement("div");
    wrap.className = WRAP_CLASS;
    wrap.setAttribute("aria-hidden", "true");
    el.insertBefore(wrap, el.firstChild);

    const { rect, shape, float, marginPx } = layer.wrapShape;
    const declarations = [
      `float:${float}`,
      `width:${rect.width * 100}%`,
      `height:${rect.height * 100}%`,
      `shape-outside:${shape === "circle" ? "circle(50%)" : "inset(0)"}`,
      `shape-margin:${marginPx ?? 0}px`,
      `margin-top:${rect.y * 100}%`,
      float === "left"
        ? `margin-left:${rect.x * 100}%`
        : `margin-right:${(1 - rect.x - rect.width) * 100}%`,
      "pointer-events:none",
    ];
    rules.push(`${selector}>.${WRAP_CLASS}{${declarations.join(";")}}`);
  }

  // Record where these rules live, and drop them from a previous root first if the
  // element migrated between roots — otherwise the old root keeps a stale copy.
  const root = styleRootOf(el);
  const previous = elementRoots.get(el);
  if (previous && previous !== root) flushRules(previous, uid, []);
  elementRoots.set(el, root);
  flushRules(root, uid, rules);
}

/** Apply a resolved type-style layer to a DOM element. */
export function applyLayer(el: HTMLElement, layer: TypeStyleLayer): void {
  if (layer.fontFamily !== undefined) setCss(el, "font-family", layer.fontFamily);
  if (layer.weight !== undefined) setCss(el, "font-weight", String(layer.weight));
  if (layer.width !== undefined) setCss(el, "font-stretch", `${layer.width}%`);
  if (layer.italic !== undefined || layer.slant !== undefined) {
    setCss(el, "font-style", layer.italic || (layer.slant ?? 0) < 0 ? "italic" : "normal");
  }
  if (layer.opticalSize !== undefined) {
    setCss(el, "font-optical-sizing", layer.opticalSize === "auto" ? "auto" : "none");
  }
  const variations = variationSettings(layer);
  if (variations) setCss(el, "font-variation-settings", variations);
  if (layer.sizePx !== undefined) setCss(el, "font-size", `${layer.sizePx}px`);
  if (layer.lineHeightPx !== undefined) setCss(el, "line-height", `${layer.lineHeightPx}px`);
  else if (layer.lineHeight !== undefined) setCss(el, "line-height", String(layer.lineHeight));
  if (layer.trackingEm !== undefined) setCss(el, "letter-spacing", `${layer.trackingEm}em`);
  if (layer.wordSpacingEm !== undefined) setCss(el, "word-spacing", `${layer.wordSpacingEm}em`);
  if (layer.transform !== undefined) setCss(el, "text-transform", layer.transform);
  const line = decorationLine(layer);
  if (line) setCss(el, "text-decoration-line", line);
  if (layer.underlineOffsetPx !== undefined) setCss(el, "text-underline-offset", `${layer.underlineOffsetPx}px`);
  if (layer.decorationThicknessPx !== undefined) setCss(el, "text-decoration-thickness", `${layer.decorationThicknessPx}px`);
  if (layer.decorationColor !== undefined) setCss(el, "text-decoration-color", layer.decorationColor);
  if (layer.decorationStyle !== undefined) setCss(el, "text-decoration-style", layer.decorationStyle);
  if (layer.baselineShiftPx !== undefined) setCss(el, "vertical-align", `${layer.baselineShiftPx}px`);
  if (layer.color !== undefined) setCss(el, "color", layer.color);
  if (layer.shadow !== undefined) setCss(el, "text-shadow", layer.shadow);

  if (layer.measurePx !== undefined) setCss(el, "width", `${layer.measurePx}px`);
  else if (layer.measureCh !== undefined) setCss(el, "width", `${layer.measureCh}ch`);
  if (layer.align !== undefined) setCss(el, "text-align", layer.align);
  if (layer.lastLineAlign !== undefined) setCss(el, "text-align-last", layer.lastLineAlign);
  if (layer.spaceBeforePx !== undefined) setCss(el, "margin-block-start", `${layer.spaceBeforePx}px`);
  if (layer.spaceAfterPx !== undefined) setCss(el, "margin-block-end", `${layer.spaceAfterPx}px`);
  if (layer.indentFirstLinePx !== undefined) setCss(el, "text-indent", `${layer.indentFirstLinePx}px`);
  if (layer.indentLeftPx !== undefined) setCss(el, "padding-inline-start", `${layer.indentLeftPx}px`);
  if (layer.indentRightPx !== undefined) setCss(el, "padding-inline-end", `${layer.indentRightPx}px`);
  if (layer.textWrap !== undefined) setCss(el, "text-wrap", layer.textWrap);
  if (layer.lineBreak !== undefined) setCss(el, "line-break", layer.lineBreak);
  if (layer.hyphens !== undefined) setCss(el, "hyphens", layer.hyphens ? "auto" : "none");
  if (layer.hangingPunctuation !== undefined) {
    setCss(el, "hanging-punctuation", layer.hangingPunctuation ? "first last" : "none");
  }
  if (layer.orphans !== undefined) setCss(el, "orphans", String(layer.orphans));
  if (layer.widows !== undefined) setCss(el, "widows", String(layer.widows));

  applyOpenType(el, layer);

  if (layer.leadingTrim !== undefined
    && typeof CSS !== "undefined"
    && CSS.supports("text-box-trim", "trim-both")) {
    const trim = layer.leadingTrim === "both"
      ? "trim-both"
      : layer.leadingTrim === "start"
        ? "trim-start"
        : layer.leadingTrim === "end"
          ? "trim-end"
          : "none";
    setCss(el, "text-box-trim", trim);
    setCss(el, "text-box-edge", "cap alphabetic");
  }

  if (layer.columnCount !== undefined) setCss(el, "column-count", String(layer.columnCount));
  if (layer.columnWidthPx !== undefined) setCss(el, "column-width", `${layer.columnWidthPx}px`);
  if (layer.columnGapPx !== undefined) setCss(el, "column-gap", `${layer.columnGapPx}px`);
  if (layer.columnRule !== undefined) {
    setCss(el, "column-rule", `${layer.columnRule.widthPx}px ${layer.columnRule.style} ${layer.columnRule.color}`);
  }
  if (layer.frameVerticalAlign !== undefined) {
    const justify = {
      top: "flex-start",
      center: "center",
      bottom: "flex-end",
      justify: "space-between",
    }[layer.frameVerticalAlign];
    setCss(el, "display", "flex");
    setCss(el, "flex-direction", "column");
    setCss(el, "justify-content", justify);
  }
  if (layer.autoSize === "height") setCss(el, "height", "auto");
  else if (layer.autoSize === "both") {
    setCss(el, "width", "max-content");
    setCss(el, "height", "auto");
  }

  if (layer.textJustify !== undefined) setCss(el, "text-justify", layer.textJustify);
  if (layer.hyphenateLimitChars !== undefined) {
    setCss(el, "hyphenate-limit-chars", layer.hyphenateLimitChars.join(" "));
  }
  if (layer.breakInside !== undefined) setCss(el, "break-inside", layer.breakInside);
  if (layer.breakBefore !== undefined) setCss(el, "break-before", layer.breakBefore);

  // baselineGridPx is consumed by StyleResolver; wrapMarginPx belongs to the columns lane.
  applyGeneratedRules(el, layer);
}

/** Read the generated pseudo-element rules belonging to one styled element. */
export function generatedRulesFor(el: HTMLElement): string[] {
  const uid = elementUids.get(el);
  if (!uid) return [];
  const root = elementRoots.get(el) ?? styleRootOf(el);
  return [...(rootStyleStates.get(root)?.rules.get(uid) ?? [])];
}

/** Remove everything generated or applied by applyLayer without disturbing renderer positioning. */
export function clearLayer(el: HTMLElement): void {
  for (const property of appliedProperties.get(el) ?? []) el.style.removeProperty(property);
  appliedProperties.delete(el);

  for (const child of el.querySelectorAll(`:scope > .${WRAP_CLASS}`)) child.remove();
  const uid = elementUids.get(el);
  if (uid) {
    // Use the RECORDED install root, not getRootNode(): lanes detach the node
    // before clearing, and a detached element no longer reports its former
    // ShadowRoot — re-deriving would orphan the rule in the shadow stylesheet.
    flushRules(elementRoots.get(el) ?? styleRootOf(el), uid, []);
    elementRoots.delete(el);
  }
}
