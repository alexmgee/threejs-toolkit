import {
  activateAnchorClick,
  applyCapabilities,
  blockHasLinks,
  contentSignature,
  domLaneCaps,
  renderContent,
  type BlockRenderer,
  type TextHost,
} from "./BlockRenderer";
import { applyLayer, clearLayer } from "./StyleToCss";
import type {
  CapabilitySet,
  FreePlacement,
  ResolveContext,
  Resolved,
  TextBlock,
  TypeStyleLayer,
} from "./TextModel";


function freePlacement(block: TextBlock): FreePlacement {
  return block.placement as FreePlacement;
}

export class FreeLane implements BlockRenderer {
  private block: TextBlock | null = null;
  private host: TextHost | null = null;
  private element: HTMLDivElement | null = null;
  private lastAppliedSignature = "";

  get surface(): HTMLElement | null {
    return this.element;
  }

  setBlock(block: TextBlock): void {
    this.block = block;
  }

  mount(block: TextBlock, resolved: Resolved, host: TextHost): void {
    this.block = block;
    this.host = host;
    const element = host.layer.ownerDocument.createElement("div");
    element.className = "sjt-free-block";
    const ariaHidden = host.isDuplicatedBlock(block.id);
    if (ariaHidden) element.setAttribute("aria-hidden", "true");
    renderContent(element, block, { ariaHidden });
    element.addEventListener("click", this.handleClick);
    element.style.position = "absolute";
    if (blockHasLinks(block)) element.style.pointerEvents = "auto";
    host.layer.appendChild(element);
    this.element = element;

    const supported = applyCapabilities(resolved, this.capabilities());
    const containerW = host.container.clientWidth;
    const containerH = host.container.clientHeight;
    this.place(containerW, containerH);
    applyLayer(element, supported.layer);
    this.honorAutoSize(supported.layer, containerW, containerH);
  }

  update(resolved: Resolved, ctx: ResolveContext): void {
    if (!this.element || !this.block) return;
    const ariaHidden = this.host?.isDuplicatedBlock(this.block.id) ?? false;
    const supported = applyCapabilities(resolved, this.capabilities());
    // Unchanged-output early-out — this runs per frame for progress-varied
    // blocks; the signature covers every input the body consumes.
    const signature = `${JSON.stringify(supported.layer)}|${JSON.stringify(this.block.placement)}`
      + `|${contentSignature(this.block)}|${ariaHidden}|${ctx.containerW}x${ctx.containerH}`;
    if (signature === this.lastAppliedSignature) return;
    this.lastAppliedSignature = signature;
    // NOT toggleAttribute: it sets an EMPTY-string attribute, and aria-hidden=""
    // is invalid ARIA — assistive tech does not treat it as hidden. Measured.
    if (ariaHidden) this.element.setAttribute("aria-hidden", "true");
    else this.element.removeAttribute("aria-hidden");
    this.element.style.pointerEvents = blockHasLinks(this.block) ? "auto" : "";
    renderContent(this.element, this.block, { ariaHidden });
    clearLayer(this.element);
    this.place(ctx.containerW, ctx.containerH);
    applyLayer(this.element, supported.layer);
    this.honorAutoSize(supported.layer, ctx.containerW, ctx.containerH);
  }

  capabilities(): CapabilitySet {
    return domLaneCaps(this.host ?? undefined);
  }

  dispose(): void {
    if (this.element) {
      this.element.removeEventListener("click", this.handleClick);
      clearLayer(this.element);
      this.element.remove();
    }
    this.element = null;
    this.block = null;
    this.host = null;
    this.lastAppliedSignature = "";
  }

  private readonly handleClick = (event: MouseEvent): void => {
    if (this.block) activateAnchorClick(event, this.block, this.host?.onLinkActivate);
  };

  private place(containerW: number, containerH: number): void {
    if (!this.element || !this.block) return;
    const { rect, anchor = "top-left" } = freePlacement(this.block);
    const x = rect.x * containerW;
    const y = rect.y * containerH;
    const width = rect.width * containerW;
    const height = rect.height * containerH;
    const right = containerW - x - width;
    const bottom = containerH - y - height;

    for (const property of ["left", "right", "top", "bottom", "transform"]) {
      this.element.style.removeProperty(property);
    }
    this.element.style.width = `${width}px`;
    this.element.style.height = `${height}px`;

    switch (anchor) {
      case "top-right":
        this.element.style.right = `${right}px`;
        this.element.style.top = `${y}px`;
        break;
      case "bottom-left":
        this.element.style.left = `${x}px`;
        this.element.style.bottom = `${bottom}px`;
        break;
      case "bottom-right":
        this.element.style.right = `${right}px`;
        this.element.style.bottom = `${bottom}px`;
        break;
      case "center":
        this.element.style.left = `${x + width / 2}px`;
        this.element.style.top = `${y + height / 2}px`;
        this.element.style.transform = "translate(-50%, -50%)";
        break;
      case "top-left":
      default:
        this.element.style.left = `${x}px`;
        this.element.style.top = `${y}px`;
        break;
    }
  }

  private honorAutoSize(layer: TypeStyleLayer, containerW: number, containerH: number): void {
    if (!this.element || !this.block) return;
    const { rect } = freePlacement(this.block);
    // The rect is the authored box; the measure is the typographic line length.
    // The narrower of the two wins — the box must never silently widen the measure.
    const rectW = `${rect.width * containerW}px`;
    const measure = layer.measurePx !== undefined
      ? `${layer.measurePx}px`
      : layer.measureCh !== undefined
        ? `${layer.measureCh}ch`
        : null;
    const boxW = measure === null ? rectW : `min(${rectW}, ${measure})`;
    this.element.style.maxWidth = "";
    switch (layer.autoSize ?? "none") {
      case "height":
        this.element.style.width = boxW;
        this.element.style.height = "auto";
        break;
      case "both":
        this.element.style.width = "max-content";
        if (measure !== null) this.element.style.maxWidth = boxW;
        this.element.style.height = "auto";
        break;
      case "none":
        this.element.style.width = boxW;
        this.element.style.height = `${rect.height * containerH}px`;
        break;
    }
  }
}
