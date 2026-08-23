import {
  LinePool,
  START_CURSOR,
  layoutObstacleColumn,
  rectIntervalsForBand,
  subtractIntervals,
  type ColumnRegion,
  type PositionedLine,
  type PositionedLineFragment,
  type ScreenRect,
} from "../ui/ObstacleLayout";
import { getPrepared, whenFontsReady } from "../ui/TextLayout";
import {
  layoutNextRichInlineLineRange,
  materializeRichInlineLineRange,
  prepareRichInline,
  type PreparedRichInline,
  type RichInlineCursor,
} from "@chenglou/pretext/rich-inline";
import {
  activateAnchorClick,
  applyCapabilities,
  blockHasLinks,
  contentSignature,
  contentText,
  renderContent,
  runItems,
  type BlockRenderer,
  type TextHost,
} from "./BlockRenderer";
import type {
  CapabilitySet,
  ColumnsPlacement,
  ResolveContext,
  Resolved,
  TextBlock,
} from "./TextModel";

const EDITORIAL_MARGIN = 32;
const EDITORIAL_TOP = 72;
const EDITORIAL_GAP = 36;
const EDITORIAL_BREAKPOINT = 768;
const RICH_START_CURSOR: RichInlineCursor = {
  itemIndex: 0,
  segmentIndex: 0,
  graphemeIndex: 0,
};
const MIRROR_CLASS = "sjt-columns-link-mirror";
const styledMirrorRoots = new WeakSet<Document | ShadowRoot>();

function ensureMirrorStyle(element: HTMLElement): void {
  const root = element.getRootNode();
  const styleRoot = root instanceof ShadowRoot ? root : element.ownerDocument;
  if (styledMirrorRoots.has(styleRoot)) return;
  styledMirrorRoots.add(styleRoot);
  const style = element.ownerDocument.createElement("style");
  style.textContent =
    `.${MIRROR_CLASS}:focus-within { width: auto !important; height: auto !important; ` +
    `overflow: visible !important; clip-path: none !important; white-space: normal !important; ` +
    `left: 16px !important; top: 16px !important; padding: 8px !important; ` +
    `background: #fff !important; color: #000 !important; z-index: 1000 !important; }`;
  (styleRoot instanceof Document ? (styleRoot.head ?? styleRoot.documentElement) : styleRoot)
    .appendChild(style);
}

export class ColumnsLane implements BlockRenderer {
  private host: TextHost | null = null;
  private block: TextBlock | null = null;
  private element: HTMLDivElement | null = null;
  private screenReader: HTMLParagraphElement | null = null;
  private pool: LinePool | null = null;
  private prepared: ReturnType<typeof getPrepared> | null = null;
  private richPrepared: PreparedRichInline | null = null;
  private items: ReadonlyArray<{ text: string; href?: string }> = [];
  private hasLinks = false;
  private contentSig = "";
  private text = "";
  private placement: ColumnsPlacement | null = null;
  private font = "";
  private lineHeightPx = 22;
  private minSlotWidthPx = 140;
  private regions: ColumnsPlacement["regions"];
  private containerW = 0;
  private containerH = 0;
  private typographyVersion = 0;
  private layoutEpoch = 0;
  private lastLayoutKey = "";

  get surface(): HTMLElement | null {
    return this.element;
  }

  mount(block: TextBlock, resolved: Resolved, host: TextHost): void {
    this.host = host;
    this.block = block;
    this.text = contentText(block);
    this.contentSig = contentSignature(block);
    this.hasLinks = blockHasLinks(block);
    this.items = runItems(block);
    this.placement = block.placement as ColumnsPlacement;
    this.containerW = host.container.clientWidth;
    this.containerH = host.container.clientHeight;

    const supported = applyCapabilities(resolved, this.capabilities());
    const typography = this.typographyOf(supported);
    this.font = typography.font;
    this.lineHeightPx = typography.lineHeightPx;
    this.minSlotWidthPx = this.placement.minSlotWidthPx ?? 140;
    this.regions = this.placement.regions;

    const element = host.layer.ownerDocument.createElement("div");
    // The pooled line spans are a visual re-flow of the same copy — hide them from
    // assistive tech and expose the screen-reader mirror below instead, or the copy
    // is announced twice (once fragmented per line, once whole).
    element.setAttribute("aria-hidden", "true");
    Object.assign(element.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
    });
    host.layer.appendChild(element);
    this.element = element;
    this.applyPaint(supported.layer);

    const screenReader = host.layer.ownerDocument.createElement("p");
    Object.assign(screenReader.style, {
      position: "absolute",
      width: "1px",
      height: "1px",
      overflow: "hidden",
      clipPath: "inset(50%)",
      whiteSpace: "nowrap",
    });
    this.renderMirror(screenReader);
    // Sibling of the aria-hidden host (not a child) so it stays exposed — and, like the
    // legacy editorial mirror, it is not subject to the host's opacity fade.
    host.layer.appendChild(screenReader);
    this.screenReader = screenReader;
    screenReader.addEventListener("click", this.handleMirrorClick);

    this.pool = new LinePool(element, {
      font: this.font,
      lineHeightPx: this.lineHeightPx,
      onLinkActivate: host.onLinkActivate,
    });
    this.prepareLayoutSource();
    this.layout();
  }

  update(resolved: Resolved, ctx: ResolveContext): void {
    if (!this.element || !this.placement) return;
    this.containerW = ctx.containerW;
    this.containerH = ctx.containerH;

    const supported = applyCapabilities(resolved, this.capabilities());
    const { font, lineHeightPx } = this.typographyOf(supported);
    this.minSlotWidthPx = this.placement.minSlotWidthPx ?? 140;
    this.regions = this.placement.regions;
    this.applyPaint(supported.layer);

    if (font !== this.font || lineHeightPx !== this.lineHeightPx) {
      this.font = font;
      this.lineHeightPx = lineHeightPx;
      const version = ++this.typographyVersion;
      void this.rebuildTypography(version, font, lineHeightPx);
      return;
    }
    this.layout();
  }

  setBlock(block: TextBlock): void {
    this.block = block;
    this.placement = block.placement as ColumnsPlacement;
    // Content applies in place: re-prepare the layout source and keep the
    // screen-reader mirror true. getPrepared caches on (text, font), so an
    // unchanged sync costs one string compare.
    const text = contentText(block);
    const signature = contentSignature(block);
    if (signature !== this.contentSig) {
      this.text = text;
      this.contentSig = signature;
      this.hasLinks = blockHasLinks(block);
      this.items = runItems(block);
      if (this.font) this.prepareLayoutSource();
      this.layoutEpoch++;
    }
    this.renderMirror();
  }

  tick(): void {
    if (!this.host || (!this.prepared && !this.richPrepared)) return;
    this.layout();
  }

  capabilities(): CapabilitySet {
    // Supported: fontFamily, weight, italic, sizePx, lineHeight, lineHeightPx,
    // baselineGridPx (via the resolver's pitch derivation), color, shadow.
    // Everything else is declared here — this lane must never silently ignore
    // a property it cannot render.
    const MEASURE = "the canvas measurer cannot measure this property — lines would mis-wrap";
    const GEOMETRY = "column geometry comes from the authored regions and obstacle carving";
    const SPANS = "pooled line spans do not support decoration or pseudo-element styling";
    return {
      excluded: {
        align: "Editorial columns are carved around obstacles and never justify or re-align — text is ragged-left by contract.",
        hyphens: "Editorial columns do not hyphenate.",
        lastLineAlign: "Editorial columns keep every line ragged-left.",
        textJustify: "Editorial columns do not justify text.",
        textWrap: "Editorial columns use fixed layout-engine wrapping.",
        width: MEASURE,
        slant: MEASURE,
        opticalSize: MEASURE,
        axes: MEASURE,
        trackingEm: MEASURE,
        wordSpacingEm: MEASURE,
        transform: MEASURE,
        caps: MEASURE,
        ligatures: MEASURE,
        numeralStyle: MEASURE,
        numeralSpacing: MEASURE,
        fractions: MEASURE,
        slashedZero: MEASURE,
        ordinals: MEASURE,
        stylisticSets: MEASURE,
        characterVariants: MEASURE,
        swash: MEASURE,
        contextualAlternates: MEASURE,
        kerning: MEASURE,
        positionVariant: MEASURE,
        hyphenateLimitChars: MEASURE,
        measureCh: GEOMETRY,
        measurePx: GEOMETRY,
        spaceBeforePx: GEOMETRY,
        spaceAfterPx: GEOMETRY,
        indentFirstLinePx: GEOMETRY,
        indentLeftPx: GEOMETRY,
        indentRightPx: GEOMETRY,
        lineBreak: GEOMETRY,
        hangingPunctuation: GEOMETRY,
        orphans: GEOMETRY,
        widows: GEOMETRY,
        initialLetter: GEOMETRY,
        columnCount: GEOMETRY,
        columnWidthPx: GEOMETRY,
        columnGapPx: GEOMETRY,
        columnRule: GEOMETRY,
        columnSpanFirst: GEOMETRY,
        frameVerticalAlign: GEOMETRY,
        autoSize: GEOMETRY,
        wrapMarginPx: "obstacle margins are not implemented by the carving engine yet",
        wrapShape: GEOMETRY,
        breakInside: GEOMETRY,
        breakBefore: GEOMETRY,
        underline: SPANS,
        strikethrough: SPANS,
        underlineOffsetPx: SPANS,
        decorationThicknessPx: SPANS,
        decorationColor: SPANS,
        decorationStyle: SPANS,
        baselineShiftPx: SPANS,
        leadingTrim: SPANS,
        firstLine: SPANS,
      },
    };
  }

  dispose(): void {
    this.typographyVersion++;
    this.pool?.dispose();
    this.screenReader?.removeEventListener("click", this.handleMirrorClick);
    this.screenReader?.remove();
    this.element?.remove();
    this.pool = null;
    this.screenReader = null;
    this.element = null;
    this.host = null;
    this.block = null;
    this.prepared = null;
    this.richPrepared = null;
    this.placement = null;
  }

  /** Canvas font shorthand incl. weight/italic so measurement matches rendering. */
  private typographyOf(supported: Resolved): { font: string; lineHeightPx: number } {
    const layer = supported.layer;
    const fontSizePx = layer.sizePx ?? 15;
    const fontFamily = layer.fontFamily ?? "sans-serif";
    const prefix = `${layer.italic === true ? "italic " : ""}${layer.weight !== undefined ? `${layer.weight} ` : ""}`;
    let lineHeightPx = layer.lineHeightPx
      ?? (layer.lineHeight !== undefined ? layer.lineHeight * fontSizePx : 22);
    // The resolver snaps authored pitches to the grid, but it cannot see this lane's
    // fallback pitch — snap here too (idempotent on already-snapped values) so a
    // declared grid is honored on every path, or the capability claim is a lie.
    if (layer.baselineGridPx !== undefined) {
      lineHeightPx = Math.ceil(lineHeightPx / layer.baselineGridPx) * layer.baselineGridPx;
    }
    return { font: `${prefix}${fontSizePx}px ${fontFamily}`, lineHeightPx };
  }

  private applyPaint(layer: Resolved["layer"]): void {
    if (!this.element) return;
    this.element.style.color = layer.color ?? "#fff";
    this.element.style.textShadow = layer.shadow ?? "0 1px 6px rgba(0, 0, 0, 0.9)";
  }

  private async rebuildTypography(
    version: number,
    font: string,
    lineHeightPx: number,
  ): Promise<void> {
    await whenFontsReady(font);
    if (version !== this.typographyVersion || !this.element) return;
    this.pool?.dispose();
    this.pool = new LinePool(this.element, {
      font,
      lineHeightPx,
      onLinkActivate: this.host?.onLinkActivate,
    });
    this.prepareLayoutSource();
    this.layoutEpoch++;
    this.layout();
  }

  private layout(): void {
    if ((!this.prepared && !this.richPrepared) || !this.host || !this.pool) return;
    const obstacles = this.host.getObstacleRects?.() ?? [];
    // Dirty gate for the per-frame tick: re-carving costs a full line-fit over
    // the copy, and at a resting stop every input below is static. Obstacle
    // values are EXACT — rounding could strand a stale carve when a rect rests
    // sub-pixel across a word-fit threshold; a truly static scene still keys
    // identically, which is the whole win.
    const key = `${this.layoutEpoch}|${this.containerW}x${this.containerH}|${this.font}`
      + `|${this.lineHeightPx}|${this.minSlotWidthPx}|${JSON.stringify(this.regions ?? null)}`
      + `|${obstacles.map((r) => `${r.x},${r.y},${r.width},${r.height}`).join(";")}`;
    if (key === this.lastLayoutKey) return;
    this.lastLayoutKey = key;
    if (this.richPrepared) {
      this.layoutRich(obstacles);
      return;
    }
    if (!this.prepared) return;
    if (this.regions && this.regions.length > 0 && this.containerW >= EDITORIAL_BREAKPOINT) {
      let cursor = START_CURSOR;
      const lines: PositionedLine[] = [];
      for (const c of this.regions) {
        const region = {
          x: c.x * this.containerW,
          y: c.y * this.containerH,
          width: c.width * this.containerW,
          height: c.height * this.containerH,
        };
        const col = layoutObstacleColumn(
          this.prepared,
          cursor,
          region,
          this.lineHeightPx,
          obstacles,
          { minSlotWidth: this.minSlotWidthPx },
        );
        lines.push(...col.lines);
        cursor = col.cursor;
      }
      this.pool.commit(lines);
      return;
    }
    const usableH = this.containerH - EDITORIAL_TOP - EDITORIAL_MARGIN;
    if (this.containerW < EDITORIAL_BREAKPOINT) {
      const region = {
        x: EDITORIAL_MARGIN,
        y: EDITORIAL_TOP,
        width: this.containerW - 2 * EDITORIAL_MARGIN,
        height: usableH,
      };
      const single = layoutObstacleColumn(this.prepared, START_CURSOR, region, this.lineHeightPx, obstacles, {
        minSlotWidth: this.minSlotWidthPx,
      });
      this.pool.commit(single.lines);
      return;
    }
    const colW = (this.containerW - 2 * EDITORIAL_MARGIN - EDITORIAL_GAP) / 2;
    const left = layoutObstacleColumn(
      this.prepared,
      START_CURSOR,
      { x: EDITORIAL_MARGIN, y: EDITORIAL_TOP, width: colW, height: usableH },
      this.lineHeightPx,
      obstacles,
      { minSlotWidth: this.minSlotWidthPx },
    );
    const right = layoutObstacleColumn(
      this.prepared,
      left.cursor,
      { x: EDITORIAL_MARGIN + colW + EDITORIAL_GAP, y: EDITORIAL_TOP, width: colW, height: usableH },
      this.lineHeightPx,
      obstacles,
      { minSlotWidth: this.minSlotWidthPx },
    );
    this.pool.commit(left.lines.concat(right.lines));
  }

  private prepareLayoutSource(): void {
    if (this.hasLinks) {
      this.prepared = null;
      this.richPrepared = prepareRichInline(
        this.items.map((item) => ({ text: item.text, font: this.font })),
      );
    } else {
      this.richPrepared = null;
      this.prepared = getPrepared(this.text, this.font);
    }
  }

  private renderMirror(mirror = this.screenReader): void {
    if (!mirror || !this.block || !this.host) return;
    const ariaHidden = this.host.isDuplicatedBlock(this.block.id);
    // NOT toggleAttribute: it sets an EMPTY-string attribute, and aria-hidden=""
    // is invalid ARIA — assistive tech does not treat it as hidden. Measured.
    if (ariaHidden) mirror.setAttribute("aria-hidden", "true");
    else mirror.removeAttribute("aria-hidden");
    renderContent(mirror, this.block, { ariaHidden });
    if (this.hasLinks) {
      mirror.classList.add(MIRROR_CLASS);
      mirror.style.pointerEvents = "auto";
      ensureMirrorStyle(mirror);
    } else {
      mirror.classList.remove(MIRROR_CLASS);
      mirror.style.removeProperty("pointer-events");
    }
  }

  private readonly handleMirrorClick = (event: MouseEvent): void => {
    if (this.block) activateAnchorClick(event, this.block, this.host?.onLinkActivate);
  };

  private layoutRich(obstacles: ScreenRect[]): void {
    if (!this.richPrepared || !this.pool) return;
    if (this.regions && this.regions.length > 0 && this.containerW >= EDITORIAL_BREAKPOINT) {
      let cursor = RICH_START_CURSOR;
      const lines: PositionedLine[] = [];
      const fragments: PositionedLineFragment[][] = [];
      for (const c of this.regions) {
        const result = this.layoutRichColumn(
          cursor,
          {
            x: c.x * this.containerW,
            y: c.y * this.containerH,
            width: c.width * this.containerW,
            height: c.height * this.containerH,
          },
          obstacles,
        );
        lines.push(...result.lines);
        fragments.push(...result.fragments);
        cursor = result.cursor;
      }
      this.pool.commit(lines, fragments);
      return;
    }

    const usableH = this.containerH - EDITORIAL_TOP - EDITORIAL_MARGIN;
    if (this.containerW < EDITORIAL_BREAKPOINT) {
      const single = this.layoutRichColumn(
        RICH_START_CURSOR,
        {
          x: EDITORIAL_MARGIN,
          y: EDITORIAL_TOP,
          width: this.containerW - 2 * EDITORIAL_MARGIN,
          height: usableH,
        },
        obstacles,
      );
      this.pool.commit(single.lines, single.fragments);
      return;
    }

    const colW = (this.containerW - 2 * EDITORIAL_MARGIN - EDITORIAL_GAP) / 2;
    const left = this.layoutRichColumn(
      RICH_START_CURSOR,
      { x: EDITORIAL_MARGIN, y: EDITORIAL_TOP, width: colW, height: usableH },
      obstacles,
    );
    const right = this.layoutRichColumn(
      left.cursor,
      {
        x: EDITORIAL_MARGIN + colW + EDITORIAL_GAP,
        y: EDITORIAL_TOP,
        width: colW,
        height: usableH,
      },
      obstacles,
    );
    this.pool.commit(
      left.lines.concat(right.lines),
      left.fragments.concat(right.fragments),
    );
  }

  private layoutRichColumn(
    start: RichInlineCursor,
    region: ColumnRegion,
    obstacles: ScreenRect[],
  ): {
    lines: PositionedLine[];
    fragments: PositionedLineFragment[][];
    cursor: RichInlineCursor;
  } {
    const lines: PositionedLine[] = [];
    const fragments: PositionedLineFragment[][] = [];
    let cursor = start;
    const horizontalPadding = this.lineHeightPx * 0.8;
    const verticalPadding = this.lineHeightPx * 0.25;
    const base = { left: region.x, right: region.x + region.width };

    for (
      let bandTop = region.y;
      bandTop + this.lineHeightPx <= region.y + region.height;
      bandTop += this.lineHeightPx
    ) {
      const blocked = rectIntervalsForBand(
        obstacles,
        bandTop,
        bandTop + this.lineHeightPx,
        horizontalPadding,
        verticalPadding,
      );
      const slots = subtractIntervals(base, blocked, this.minSlotWidthPx);
      if (slots.length === 0) continue;
      let slot = slots[0];
      for (const candidate of slots) {
        if (candidate.right - candidate.left > slot.right - slot.left) slot = candidate;
      }

      const range = layoutNextRichInlineLineRange(
        this.richPrepared!,
        slot.right - slot.left,
        cursor,
      );
      if (range === null) break;
      const line = materializeRichInlineLineRange(this.richPrepared!, range);
      const positioned = line.fragments.map((fragment) => {
        const item = this.items[fragment.itemIndex];
        const href = this.block?.href ?? item?.href;
        return {
          ...fragment,
          href,
          blockId: this.block?.id ?? "",
          runIndex: this.block?.href === undefined ? fragment.itemIndex : null,
        };
      });
      lines.push({
        x: slot.left,
        y: bandTop,
        width: line.width,
        text: line.fragments.map((fragment) => fragment.text).join(""),
      });
      fragments.push(positioned);
      cursor = range.end;
    }

    return { lines, fragments, cursor };
  }
}
