import {
  BORDER_W,
  DEFAULT_PANEL_WIDTH,
  PADDING_X,
} from "../ui/CaptionOverlay";
import { measureCharWidthPx } from "../ui/TextLayout";
import {
  activateAnchorClick,
  applyCapabilities,
  blockHasLinks,
  contentSignature,
  domLaneCaps,
  prefersReducedMotion,
  renderContent,
  type BlockRenderer,
  type TextHost,
} from "./BlockRenderer";
import {
  CHROME_GAP,
  choosePanelBox,
  inflate,
  reservedRegions,
  subscribeReservedRegions,
} from "../ui/ReservedRegions";
import type { PanelCandidate, PanelChoice, Rect } from "../ui/ReservedRegions";
import { applyLayer, clearLayer } from "./StyleToCss";
import { placementIsAuthorChosen, slotCollapsesOnNarrow } from "./TextModel";
import type {
  CapabilitySet,
  PanelPlacement,
  ResolveContext,
  Resolved,
  TextBlock,
  TypeStyleLayer,
} from "./TextModel";

const PADDING_Y = 18;
const SHEET_MARGIN = 16;
const PANEL_MARGIN = 24;
const MOBILE_BREAKPOINT = 768;
const MAX_HEIGHT_VH = 40;
// Height only: block fades are JS-driven per frame (TextSystem), and the panel's
// aggregate opacity follows them directly — a CSS opacity transition would smear
// against those writes.
const TRANSITION = "height 200ms ease";
const PANEL_CLASS = "sjt-panel-lane";

type PanelSlot = PanelPlacement["slot"];
type PanelMode = "bottom" | "side";

interface SlotBlock {
  element: HTMLElement;
  order?: number;
  sequence: number;
  layer: TypeStyleLayer;
  /** This block's own answer to the narrow-screen collapse, if it gave one
   *  (`PanelPlacement.collapse`). Undefined means "no opinion — use the site's".
   *  Held per BLOCK although the decision is per SLOT, because a slot is one DOM
   *  panel shared by several blocks and they may disagree; `collapsesOnNarrow`
   *  is where the disagreement is resolved. */
  collapse?: boolean;
}

const styledRoots = new WeakSet<Document | ShadowRoot>();

/** The style root a shadow-hosted panel must install into (its ShadowRoot),
 *  else the owning Document — a <style> in the main document head can't reach
 *  shadow descendants. Falls back to ownerDocument when detached. */
function panelStyleRoot(el: HTMLElement): Document | ShadowRoot {
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root : el.ownerDocument;
}

function ensurePanelStyle(root: Document | ShadowRoot): void {
  if (styledRoots.has(root)) return;
  styledRoots.add(root);
  const ownerDoc = root instanceof Document ? root : root.ownerDocument!;
  const style = ownerDoc.createElement("style");
  style.setAttribute("data-sjt-panel-lane", "");
  style.textContent =
    `.${PANEL_CLASS} { overflow-y: auto; scrollbar-width: none; }\n` +
    `.${PANEL_CLASS}::-webkit-scrollbar { display: none; }`;
  const mount = root instanceof Document ? (root.head ?? root.documentElement) : root;
  mount.appendChild(style);
}


function contentLayer(layer: TypeStyleLayer): TypeStyleLayer {
  const stripped = { ...layer };
  delete stripped.measureCh;
  delete stripped.measurePx;
  if (stripped.autoSize === "both") stripped.autoSize = "height";
  return stripped;
}

class SlotManager {
  private readonly panel: HTMLDivElement;
  private readonly blocks: SlotBlock[] = [];
  private readonly blockOpacities = new Map<HTMLElement, { opacity: number; interactive: boolean }>();
  private readonly unsubscribeRegions: () => void;
  /** The last geometry actually written, so a re-layout that reaches the same
   *  answer costs no style writes. Deliberately excludes the panel's height: the
   *  chooser's OUTPUT is in the key, so a height that changed the answer changes
   *  the key too, while a height that did not cannot churn it. */
  private lastLayoutKey = "";
  private nextSequence = 0;
  private capturedHeight: number | null = null;
  private animationVersion = 0;
  private disposed = false;

  constructor(
    private readonly host: TextHost,
    private readonly slot: PanelSlot,
    private readonly onDispose: () => void,
  ) {
    const doc = host.layer.ownerDocument;
    ensurePanelStyle(panelStyleRoot(host.layer));

    this.panel = doc.createElement("div");
    this.panel.className = PANEL_CLASS;
    this.panel.setAttribute("aria-live", "polite");
    this.panel.setAttribute("aria-atomic", "true");
    this.panel.setAttribute("role", "region");
    this.panel.setAttribute("aria-label", "Scene caption");
    Object.assign(this.panel.style, {
      position: "absolute",
      boxSizing: "border-box",
      padding: `${PADDING_Y}px ${PADDING_X}px`,
      background: "rgba(12, 12, 16, 0.82)",
      backdropFilter: "blur(12px)",
      color: "#fff",
      borderRadius: "12px",
      border: `${BORDER_W}px solid rgba(255, 255, 255, 0.08)`,
      zIndex: "900",
      opacity: "1",
      pointerEvents: "auto",
      transition: TRANSITION,
    });
    this.panel.addEventListener("transitionend", this.handleTransitionEnd);
    host.layer.appendChild(this.panel);
    // The chrome can move without the panel's content changing — a resize, a
    // safe-area change on rotation. Without this the panel would keep whatever
    // answer it computed at mount until something unrelated re-laid it out.
    this.unsubscribeRegions = subscribeReservedRegions(host.container, () => {
      this.refreshLayout();
    });
  }

  addBlock(element: HTMLElement, order?: number, collapse?: boolean): void {
    this.beginLayoutChange();
    this.blocks.push({
      element,
      order,
      sequence: this.nextSequence++,
      layer: {},
      collapse,
    });
    this.panel.appendChild(element);
  }

  setBlockLayer(element: HTMLElement, layer: TypeStyleLayer): void {
    const entry = this.blocks.find((block) => block.element === element);
    if (entry) entry.layer = layer;
  }

  /** Update an already-docked block's collapse answer in place.
   *
   *  Needed because `addBlock` is the ONLY other way a record is written, and a
   *  block whose collapse changed while its SLOT did not never takes the
   *  remove/re-add path in `PanelLane.update` — so without this the reduction
   *  below would keep reading the value the block was mounted with, and the
   *  author's per-panel switch would appear to do nothing. */
  setBlockCollapse(element: HTMLElement, collapse: boolean | undefined): void {
    const entry = this.blocks.find((block) => block.element === element);
    if (entry) entry.collapse = collapse;
  }

  removeBlock(element: HTMLElement): boolean {
    this.beginLayoutChange();
    const index = this.blocks.findIndex((block) => block.element === element);
    if (index >= 0) this.blocks.splice(index, 1);
    this.blockOpacities.delete(element);
    element.remove();

    if (this.blocks.length === 0) {
      this.dispose();
      return true;
    }

    // The departed block must stop contributing NOW — waiting for the next fade
    // write leaves the dock wearing the migrated block's opacity/interactivity,
    // and stable remaining blocks may never write again.
    this.recomputeAggregate();
    this.refreshLayout();
    return false;
  }

  beginLayoutChange(): void {
    if (this.disposed || this.capturedHeight !== null) return;
    this.animationVersion++;
    this.capturedHeight = this.panel.getBoundingClientRect().height;
    this.panel.style.transition = "none";
    this.panel.style.height = `${this.capturedHeight}px`;
  }

  /** Chrome follows content: the panel's own opacity is the max of its blocks',
   *  and pointer events release the MOMENT every block is fading out — legacy
   *  CaptionOverlay.hide() released input at hide-start, not at fade-end. */
  setBlockOpacity(element: HTMLElement, opacity: number, interactive: boolean): void {
    if (this.disposed) return;
    this.blockOpacities.set(element, { opacity, interactive });
    this.recomputeAggregate();
  }

  private recomputeAggregate(): void {
    let max = 0;
    let anyInteractive = false;
    for (const value of this.blockOpacities.values()) {
      max = Math.max(max, value.opacity);
      anyInteractive ||= value.interactive;
    }
    this.panel.style.opacity = String(max);
    this.panel.style.pointerEvents = anyInteractive ? "auto" : "none";
  }

  refreshLayout(): void {
    if (this.disposed) return;
    if (this.capturedHeight === null) this.beginLayoutChange();
    this.sortBlocks();
    this.layOutPanel(this.resolveMode());
    this.animateHeight();
  }

  private resolveMode(): PanelMode {
    if (this.slot === "bottom") return "bottom";
    if (this.host.container.clientWidth >= MOBILE_BREAKPOINT) return "side";
    return this.collapsesOnNarrow() ? "bottom" : "side";
  }

  /**
   * Below the breakpoint, does THIS SLOT give up its authored position?
   *
   * Used to be unconditional — every panel became one full-width bar whatever
   * slot it named. Ticket 17 makes it the author's call: *"It should all be up
   * to the author to make a broken phone layout if they want to … good design
   * protect reading on a phone; not rules."*
   *
   * The reduction itself is `slotCollapsesOnNarrow` in the pure model; this
   * method only gathers its two inputs. Both are read HERE, per layout, never
   * cached: the author panel mutates the same objects the runtime holds.
   */
  private collapsesOnNarrow(): boolean {
    return slotCollapsesOnNarrow(
      this.blocks.map((block) => block.collapse),
      this.host.collapseOnNarrow?.() ?? true,
    );
  }

  /**
   * Where this panel goes, given where the engagement chrome is.
   *
   * A named slot is obeyed. The one thing that can override it is the
   * narrow-screen collapse — and since ticket 17 that is a SETTING, not a rule:
   * where the author has switched it off the slot is obeyed at every width and
   * this function never reaches the chooser at all.
   *
   * When the collapse does happen, nobody chose the resulting full-width bar, so
   * it is narrowed clear of the engagement chrome (ticket 06). With the setting
   * off there is no imposed bar, so that contract simply does not fire — it is
   * unaffected in principle, and has nothing to narrow.
   */
  private choosePlacement(mode: PanelMode, container: Rect): PanelChoice<PanelSlot> {
    // The rendered height, so the box is the box the visitor sees. Falls back to
    // content height on the very first pass, before this panel has been laid out.
    const height = this.panel.getBoundingClientRect().height || this.panel.scrollHeight;
    const box: Rect = mode === "bottom"
      ? {
        left: container.left + SHEET_MARGIN,
        right: container.right - SHEET_MARGIN,
        bottom: container.bottom - SHEET_MARGIN,
        top: container.bottom - SHEET_MARGIN - height,
      }
      : (() => {
        const width = this.sidePanelWidth();
        const bottom = container.bottom - PANEL_MARGIN;
        const left = this.slot === "left"
          ? container.left + PANEL_MARGIN
          : container.right - PANEL_MARGIN - width;
        return { left, right: left + width, bottom, top: bottom - height };
      })();

    // The author's slot never meets the chooser at all. Passing it through and
    // receiving a "clear" answer would be the same thing by accident; refusing
    // to ask is what makes "the author has final say" true by construction.
    if (placementIsAuthorChosen(this.slot, mode === "bottom")) {
      return { slot: this.slot, box, narrowed: false };
    }
    // The imposed bar: one full-width box, so there is no slot to choose, only
    // width to give up. Narrowing is the author's chosen remedy over lifting it
    // or sending it to the top.
    return choosePanelBox(
      [{ slot: this.slot, box }],
      reservedRegions(this.host.container).map((region) => inflate(region, CHROME_GAP)),
    );
  }

  private layOutPanel(mode: PanelMode): void {
    // CONTAINER-RELATIVE, origin at the layer's top-left — the same frame the
    // chrome publishes in. Viewport coordinates would drift against the chrome's
    // by the page's scroll offset between the two measurements, which put a
    // caption straight over the switch after a 400px scroll.
    //
    // The LAYER's size, not the container's: the panel is positioned inside the
    // layer, so that is the box its insets are measured from. The layer is
    // `inset: 0` within the container, which makes the two identical — relying
    // on that silently would put any future container border between the answer
    // and the truth.
    const container: Rect = {
      left: 0,
      top: 0,
      right: this.host.layer.clientWidth,
      bottom: this.host.layer.clientHeight,
    };
    const { slot, box, narrowed } = this.choosePlacement(mode, container);
    const key = `${mode}|${slot}|${narrowed}|${Math.round(box.left)}|${Math.round(box.right)}`
      + `|${container.right}|${container.bottom}`;
    if (key === this.lastLayoutKey) return;
    this.lastLayoutKey = key;

    // Both horizontal insets, always — a chosen box states both its edges, and
    // pinning them is how a narrowed bar keeps the width the chooser gave it.
    // Height stays content-driven: only the horizontal extent is negotiable.
    const s = this.panel.style;
    s.left = `${Math.round(box.left)}px`;
    s.right = `${Math.round(container.right - box.right)}px`;
    s.bottom = `${Math.round(container.bottom - box.bottom)}px`;
    s.top = "auto";
    s.width = "auto";
    // The cap is the BAR's, and stays the bar's (ticket 17). A side panel has
    // never been capped, and a narrow screen does not change that — so a panel
    // whose author opted out of collapsing is uncapped at phone width and may
    // grow past the top of the container. That is the author's choice landing
    // exactly where they made it, which is the point of the ticket; capping it
    // here would be the removed rule creeping back in as a height limit.
    s.maxHeight = mode === "bottom" ? `${MAX_HEIGHT_VH}vh` : "none";
  }

  private sidePanelWidth(): number {
    const measures = this.blocks.flatMap((block) => {
      if (block.layer.measurePx !== undefined) return [block.layer.measurePx];
      if (block.layer.measureCh === undefined) return [];
      return [block.layer.measureCh * this.chWidth(block.element)];
    });
    if (measures.length === 0) return DEFAULT_PANEL_WIDTH;
    return Math.round(Math.max(...measures)) + 2 * PADDING_X + 2 * BORDER_W;
  }

  private chWidth(element: HTMLElement): number {
    const view = element.ownerDocument.defaultView;
    if (!view) return 0;
    const computed = view.getComputedStyle(element);
    const font = computed.font ||
      `${computed.fontStyle} ${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`;
    return measureCharWidthPx("0", font);
  }

  private sortBlocks(): void {
    this.blocks.sort((a, b) => {
      if (a.order === undefined && b.order === undefined) return a.sequence - b.sequence;
      if (a.order === undefined) return 1;
      if (b.order === undefined) return -1;
      return a.order - b.order || a.sequence - b.sequence;
    });
    for (const block of this.blocks) this.panel.appendChild(block.element);
  }

  private animateHeight(): void {
    const start = this.capturedHeight ?? this.panel.getBoundingClientRect().height;
    const version = this.animationVersion;
    this.capturedHeight = null;

    if (prefersReducedMotion()) {
      // Snap, matching the fade and variant policy — dock growth was the one
      // animation surface that never consulted the signal.
      this.panel.style.transition = "none";
      this.panel.style.height = "auto";
      return;
    }

    this.panel.style.height = "auto";
    const target = this.panel.scrollHeight;
    this.panel.style.height = `${start}px`;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (this.disposed || version !== this.animationVersion) return;
        this.panel.style.transition = TRANSITION;
        if (Math.abs(target - start) < 0.5) {
          this.panel.style.height = "auto";
        } else {
          this.panel.style.height = `${target}px`;
        }
      });
    });
  }

  private readonly handleTransitionEnd = (event: TransitionEvent): void => {
    if (event.target === this.panel && event.propertyName === "height") {
      this.panel.style.height = "auto";
    }
  };

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.animationVersion++;
    this.unsubscribeRegions();
    this.panel.removeEventListener("transitionend", this.handleTransitionEnd);
    this.panel.remove();
    this.onDispose();
  }
}

const slotManagers = new WeakMap<HTMLElement, Map<PanelSlot, SlotManager>>();

function managerFor(host: TextHost, slot: PanelSlot): SlotManager {
  let managers = slotManagers.get(host.layer);
  if (!managers) {
    managers = new Map();
    slotManagers.set(host.layer, managers);
  }

  let manager = managers.get(slot);
  if (!manager) {
    const ownedManagers = managers;
    manager = new SlotManager(host, slot, () => {
      ownedManagers.delete(slot);
      if (ownedManagers.size === 0) slotManagers.delete(host.layer);
    });
    managers.set(slot, manager);
  }
  return manager;
}

export class PanelLane implements BlockRenderer {
  private host: TextHost | null = null;
  private manager: SlotManager | null = null;
  private element: HTMLElement | null = null;
  private block: TextBlock | null = null;
  private slot: PanelSlot | null = null;
  private order: number | undefined;
  private lastAppliedSignature = "";

  get surface(): HTMLElement | null {
    return this.element;
  }

  /** Keep the placement source fresh — TextSystem hands the current block over
   *  on every sync so update() can see slot/order changes. */
  setBlock(block: TextBlock): void {
    this.block = block;
  }

  /** Section fade + panel aggregate: the shared chrome must fade with its
   *  content and release pointer events the moment its content starts hiding. */
  setOpacity(opacity: number, interactive = opacity > 0): void {
    if (!this.element) return;
    this.element.style.opacity = String(opacity);
    this.manager?.setBlockOpacity(this.element, opacity, interactive);
  }

  mount(block: TextBlock, resolved: Resolved, host: TextHost): void {
    this.host = host;
    this.block = block;
    const placement = block.placement as PanelPlacement;
    const element = host.layer.ownerDocument.createElement("section");
    element.className = "sjt-panel-block";
    const ariaHidden = host.isDuplicatedBlock(block.id);
    if (ariaHidden) element.setAttribute("aria-hidden", "true");
    renderContent(element, block, { ariaHidden });
    element.addEventListener("click", this.handleClick);
    element.style.overflowWrap = "break-word";
    if (blockHasLinks(block)) element.style.pointerEvents = "auto";

    const supported = applyCapabilities(resolved, this.capabilities());
    // Attach BEFORE applyLayer (matching FreeLane): StyleToCss routes generated
    // ::first-line / ::first-letter / wrap rules to the element's root
    // (getRootNode), and inside a Shadow DOM a still-detached element resolves to
    // the document — the rule would then be written to document.head and never
    // reach the shadow-hosted element.
    const manager = managerFor(host, placement.slot);
    manager.addBlock(element, placement.order, placement.collapse);
    applyLayer(element, contentLayer(supported.layer));
    manager.setBlockLayer(element, supported.layer);
    manager.refreshLayout();

    this.manager = manager;
    this.element = element;
    this.slot = placement.slot;
    this.order = placement.order;
  }

  update(resolved: Resolved, ctx: ResolveContext): void {
    if (!this.element || !this.manager) return;
    const placement = this.block?.placement as PanelPlacement | undefined;
    const ariaHidden = this.block
      ? (this.host?.isDuplicatedBlock(this.block.id) ?? false)
      : false;
    const supported = applyCapabilities(resolved, this.capabilities());
    // Unchanged-output early-out: this path runs per frame for progress-varied
    // blocks, and the full body costs two forced reflows + a CSS rewrite +
    // re-appending every slot child. The signature covers every input below.
    // Reduced-motion is a signature input: animateHeight branches on it, and an
    // otherwise-identical update after an OS toggle must reach the snap path.
    // ⚠ The collapse input is the RESOLVED site-wide value, not `placement
    // .collapse`. Flipping the site-wide switch changes no per-block input, so a
    // signature built from the placement alone is identical before and after —
    // this function returns here, `refreshLayout()` is never reached, and the
    // author's switch appears to do nothing at all. Same bug class as slot and
    // order already being in this key.
    const collapseInput = `${placement?.collapse}|${this.host?.collapseOnNarrow?.() ?? true}`;
    const signature = `${JSON.stringify(supported.layer)}|${placement?.slot}|${placement?.order}`
      + `|${this.block ? contentSignature(this.block) : ""}|${ariaHidden}`
      + `|${ctx.containerW}|${prefersReducedMotion()}|${collapseInput}`;
    if (signature === this.lastAppliedSignature) return;
    this.lastAppliedSignature = signature;
    // Content applies IN PLACE (legacy CaptionOverlay parity) — remounting on
    // content restarted the fade and panel animation per authoring keystroke.
    if (this.block) {
      // NOT toggleAttribute: it sets an EMPTY-string attribute, and aria-hidden=""
    // is invalid ARIA — assistive tech does not treat it as hidden. Measured.
    if (ariaHidden) this.element.setAttribute("aria-hidden", "true");
    else this.element.removeAttribute("aria-hidden");
      this.element.style.pointerEvents = blockHasLinks(this.block) ? "auto" : "";
      renderContent(this.element, this.block, { ariaHidden });
    }
    // A slot or order change is a dock migration, not a style refresh — move the
    // element to its new SlotManager before restyling.
    if (this.host && placement
      && (placement.slot !== this.slot || placement.order !== this.order)) {
      this.manager.removeBlock(this.element);
      const manager = managerFor(this.host, placement.slot);
      manager.addBlock(this.element, placement.order, placement.collapse);
      this.manager = manager;
      this.slot = placement.slot;
      this.order = placement.order;
    } else if (placement) {
      // Same slot, so the branch above did not run and the manager still holds
      // the value this block was MOUNTED with. Push the current one in, or a
      // collapse edit made without moving the panel never reaches the reduction.
      this.manager.setBlockCollapse(this.element, placement.collapse);
    }
    this.manager.beginLayoutChange();
    clearLayer(this.element);
    applyLayer(this.element, contentLayer(supported.layer));
    this.manager.setBlockLayer(this.element, supported.layer);
    this.manager.refreshLayout();
  }

  capabilities(): CapabilitySet {
    return domLaneCaps(this.host ?? undefined);
  }

  dispose(): void {
    this.element?.removeEventListener("click", this.handleClick);
    if (this.element && this.manager) this.manager.removeBlock(this.element);
    if (this.element) clearLayer(this.element);
    this.element = null;
    this.manager = null;
    this.host = null;
    this.block = null;
    this.slot = null;
    this.order = undefined;
    this.lastAppliedSignature = "";
  }

  private readonly handleClick = (event: MouseEvent): void => {
    if (this.block) activateAnchorClick(event, this.block, this.host?.onLinkActivate);
  };
}
