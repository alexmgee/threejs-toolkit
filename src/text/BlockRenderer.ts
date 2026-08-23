import type { Camera, Scene } from "three";
import type { FontRegistry } from "./FontRegistry";
import type {
  CapabilitySet,
  ResolveContext,
  Resolved,
  TextBlock,
  TypeStyleLayer,
} from "./TextModel";
import type { ScreenRect } from "../ui/ObstacleLayout";

export type { CapabilitySet } from "./TextModel";

export interface TextHost {
  container: HTMLElement;
  layer: HTMLElement;
  scene?: Scene;
  /** Required by world lanes to billboard toward the viewer each frame. */
  camera?: Camera;
  registry: FontRegistry;
  getObstacleRects?: () => ScreenRect[];
  onLinkActivate?: (detail: {
    href: string;
    blockId: string;
    runIndex: number | null;
    kind: "fragment" | "external";
  }) => boolean;
  isDuplicatedBlock: (id: string) => boolean;
  /**
   * The site-wide narrow-screen collapse default (ticket 17, Rule D), as a
   * GETTER rather than a value: the author panel mutates the site object the
   * runtime holds, so a boolean captured when the host was built would make the
   * switch look dead until a page reload.
   *
   * Optional, and absent means `true` — today's phone rendering. `TextHost` is
   * a public export with a fixed required shape, so a required field here would
   * break every consuming site that builds one.
   *
   * This is the ONLY channel by which site settings reach a lane; nothing else
   * in the repo passes site data down here.
   */
  collapseOnNarrow?: () => boolean;
}

export interface BlockRenderer {
  mount(block: TextBlock, resolved: Resolved, host: TextHost): void;
  update(resolved: Resolved, ctx: ResolveContext): void;
  /** Optional per-frame hook (called from TextSystem.update) for lanes whose layout depends on
   *  live camera/obstacle geometry (ColumnsLane). DOM/panel/free lanes omit it. */
  tick?(): void;
  /** Optional fade hook for lanes whose surface has no CSS opacity or material to
   *  drive (gaussian splats), or that own shared chrome (panel). When present,
   *  TextSystem routes fades through it. `interactive` is false the moment a
   *  fade-out STARTS — chrome must release pointer events immediately (legacy
   *  hide() semantics), not when the fade lands. */
  setOpacity?(opacity: number, interactive?: boolean): void;
  /** Hand the lane the CURRENT block object before update(). Consumers may replace
   *  block objects instead of mutating (immutable state) — a lane that keeps its
   *  mount-time reference silently freezes on stale placement. */
  setBlock?(block: TextBlock): void;
  capabilities(): CapabilitySet;
  dispose(): void;
}

/** Strip unsupported fields once, before a renderer sees the resolved style. */
export function applyCapabilities(resolved: Resolved, caps: CapabilitySet): Resolved {
  const layer: TypeStyleLayer = { ...resolved.layer };
  const tiers = { ...resolved.tiers };
  // Excluding the baseline grid must also undo its derivation: the resolver rewrote
  // lineHeightPx to the grid pitch, so restore the pre-grid value it recorded.
  if (caps.excluded.baselineGridPx !== undefined && resolved.preGridLineHeight !== undefined) {
    if (resolved.preGridLineHeight.value === undefined) delete layer.lineHeightPx;
    else layer.lineHeightPx = resolved.preGridLineHeight.value;
    if (resolved.preGridLineHeight.tier === undefined) delete tiers.lineHeightPx;
    else tiers.lineHeightPx = resolved.preGridLineHeight.tier;
  }
  for (const key of Object.keys(caps.excluded) as Array<keyof TypeStyleLayer>) {
    delete layer[key];
    delete tiers[key];
  }
  return { layer, tiers };
}

const reducedMotionQuery = typeof matchMedia === "function"
  ? matchMedia("(prefers-reduced-motion: reduce)")
  : null;

/** One motion gate for lane-internal animations — TextSystem fades and variant
 *  ranges already snap; lanes must consult the same signal, not invent their own. */
export function prefersReducedMotion(): boolean {
  return reducedMotionQuery?.matches ?? false;
}

/** Flatten block content to render text — ONE home; every lane consumes this,
 *  and PlaneLane's raster signature must match what the others display. */
export function contentText(block: TextBlock): string {
  return typeof block.content === "string"
    ? block.content
    : block.content.map((run) => run.text).join("");
}

/** True when the block has at least one link (block-level or on any run). */
export function blockHasLinks(block: TextBlock): boolean {
  if (block.href !== undefined) return true;
  return typeof block.content !== "string"
    && block.content.some((run) => run.href !== undefined);
}

/** The block's runs as Pretext rich-inline items, in contentText order, each
 *  paired with its href. `itemIndex` from a laid-out fragment indexes THIS array
 *  — no character offsets are involved. */
export function runItems(block: TextBlock): ReadonlyArray<{ text: string; href?: string }> {
  return typeof block.content === "string"
    ? [{ text: block.content, href: block.href }]
    : block.content.map((run) => ({ text: run.text, href: run.href }));
}

/** Signature fragment covering everything the run-aware path consumes. */
export function contentSignature(block: TextBlock): string {
  return typeof block.content === "string"
    ? `s|${block.href ?? ""}|${block.content}`
    : `r|${block.href ?? ""}|${block.content.map((r) => `${r.href ?? ""}\u0000${r.text}`).join("\u0001")}`;
}

const warnedNestedLinkBlocks = new Set<string>();

function createLink(
  doc: Document,
  href: string,
  text: string,
  runIndex: number | null,
  ariaHidden: boolean,
): HTMLAnchorElement {
  const anchor = doc.createElement("a");
  anchor.href = href;
  anchor.textContent = text;
  anchor.dataset.sjtRunIndex = runIndex === null ? "" : String(runIndex);
  if (!href.startsWith("#")) anchor.rel = "noopener noreferrer";
  if (ariaHidden) anchor.tabIndex = -1;
  return anchor;
}

/**
 * Render block content into `element`, emitting real `<a href>` per linked run.
 * Panel/Free lanes only (Columns uses this for its semantic mirror). Clears and
 * rebuilds while retaining a single text node for the no-link path.
 */
export function renderContent(
  element: HTMLElement,
  block: TextBlock,
  opts: { ariaHidden?: boolean } = {},
): void {
  element.replaceChildren();
  const ariaHidden = opts.ariaHidden === true;
  const doc = element.ownerDocument;
  const text = contentText(block);

  if (block.href !== undefined) {
    if (
      typeof block.content !== "string"
      && block.content.some((run) => run.href !== undefined)
      && !warnedNestedLinkBlocks.has(block.id)
    ) {
      warnedNestedLinkBlocks.add(block.id);
      console.warn(
        `Text block "${block.id}" has both a block href and run hrefs; the block href takes precedence.`,
      );
    }
    element.appendChild(createLink(doc, block.href, text, null, ariaHidden));
    return;
  }

  if (typeof block.content === "string" || !blockHasLinks(block)) {
    element.appendChild(doc.createTextNode(text));
    return;
  }

  block.content.forEach((run, runIndex) => {
    element.appendChild(
      run.href === undefined
        ? doc.createTextNode(run.text)
        : createLink(doc, run.href, run.text, runIndex, ariaHidden),
    );
  });
}

/** Apply the frozen native-anchor interception rule to a delegated click. */
export function activateAnchorClick(
  event: MouseEvent,
  block: TextBlock,
  onLinkActivate?: TextHost["onLinkActivate"],
): void {
  if (
    event.ctrlKey
    || event.metaKey
    || event.shiftKey
    || event.altKey
    || event.button !== 0
  ) {
    return;
  }
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest("a");
  if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank") return;
  const href = anchor.getAttribute("href");
  if (href === null) return;
  const rawRunIndex = anchor.dataset.sjtRunIndex;
  const handled = onLinkActivate?.({
    href,
    blockId: block.id,
    runIndex: rawRunIndex ? Number(rawRunIndex) : null,
    kind: href.startsWith("#") ? "fragment" : "external",
  }) ?? false;
  if (handled) event.preventDefault();
}

/** Capability table shared by the panel, free, and plane DOM lanes. */
export function domLaneCaps(_host?: TextHost): CapabilitySet {
  const excluded: CapabilitySet["excluded"] = {
    wrapMarginPx: "columns lane only",
    columnSpanFirst:
      "block content renders as a single text node — there is no first child element to span; multi-paragraph content is not implemented",
  };
  if (typeof CSS === "undefined" || !CSS.supports("text-box-trim", "trim-both")) {
    excluded.leadingTrim = "browser does not support text-box-trim";
  }
  return { excluded };
}
