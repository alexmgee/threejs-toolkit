/**
 * CaptionOverlay — Accessible DOM narration panel with Pretext-computed height
 *
 * Shows title/body copy over the scene canvas — driven by CameraRail's
 * onStopArrived (consumer wiring) or shown imperatively. The panel's
 * height is computed by Pretext (TextLayout.measureTextHeight), never
 * measured from the DOM: text metrics come from cached glyph widths, so
 * height changes animate to a known pixel target with no reflow reads
 * and no post-animation jump.
 *
 * Layout modes:
 *  - Bottom sheet (container narrower than mobileBreakpoint, or
 *    position: "bottom"): full-width minus margins, anchored bottom,
 *    capped at maxHeightVh with internal scroll.
 *  - Side panel (desktop, or position: "left"/"right"): fixed panelWidth,
 *    anchored to the chosen edge.
 *
 * The copy is real DOM text (selectable, SEO-visible, announced via
 * aria-live="polite"); Pretext only decides the box height. Both lanes
 * use the same font strings, so their line wrapping agrees — that
 * agreement is Pretext's core accuracy contract, verified in text-lab.
 *
 * Container-box widths come from a ResizeObserver entry's contentRect
 * (no forced-layout reads). Fonts are explicitly load()-ed before the
 * first measurement — see TextLayout.whenFontsReady for why fonts.ready
 * alone is not sufficient.
 */

import {
  DEFAULT_FONT_STACK,
  measureCharWidthPx,
  measureTextHeight,
  parseFontShorthand,
  whenFontsReady,
} from "./TextLayout";

// ─── Types ────────────────────────────────────────────────

export interface CaptionCopy {
  /** Optional heading shown above the body */
  title?: string;
  /** Narration body text */
  body: string;
}

export interface CaptionOverlayConfig {
  /** Same container the SparkScene canvas lives in. Forced to position:relative if static. */
  container: HTMLElement;
  /** Body font shorthand. Named families only. Default: `16px ${DEFAULT_FONT_STACK}` */
  font?: string;
  /** Title font shorthand (weight allowed — DOM lane supports it). Default: `600 20px ${DEFAULT_FONT_STACK}` */
  titleFont?: string;
  /** Body line height in px (default: 24) */
  lineHeightPx?: number;
  /** Title line height in px (default: 28) */
  titleLineHeightPx?: number;
  /** 'auto' = bottom sheet below breakpoint, side panel above (default: 'auto') */
  position?: "auto" | "bottom" | "left" | "right";
  /** Desktop side-panel width in px (default: 320) */
  panelWidth?: number;
  /** Mobile bottom-sheet max height as vh (default: 40) */
  maxHeightVh?: number;
  /** Container width below which bottom-sheet mode engages (default: 768) */
  mobileBreakpoint?: number;
  /** Stacking order — default 900, below LoadingUI's 1000 */
  zIndex?: number;
}

export interface CaptionTypographyStyle {
  font?: string;
  titleFont?: string;
  lineHeightPx?: number;
  /** Title line pitch in px. Should scale with the title font size. */
  titleLineHeightPx?: number;
  panelWidth?: number;
  align?: "left" | "justify";
  color?: string;
  letterSpacingEm?: number;
  measureCh?: number;
}

// ─── Layout constants (part of the height computation) ────

/** Panel horizontal padding — exported so width-deriving consumers stay in sync. */
export const PADDING_X = 20;
const PADDING_Y = 18;
/** Panel border width — part of the border-box math below (exported for consumers). */
export const BORDER_W = 1;
/** Default side-panel width in px when no measure override drives it. */
export const DEFAULT_PANEL_WIDTH = 320;
const TITLE_GAP = 12;
/** Bottom-sheet side/bottom margins */
const SHEET_MARGIN = 16;
/** Side-panel distance from container edges */
const PANEL_MARGIN = 24;
const TRANSITION = "height 200ms ease, opacity 200ms ease";

/**
 * Scrollbars must not consume layout width: a classic scrollbar shrinks the
 * text wrap width below the measured width, adding lines and creating a
 * self-sustaining overflow loop. Scrolling still works (touch/wheel/keys) —
 * the bar is just zero-width. Injected once per document.
 */
const PANEL_CLASS = "sjt-caption-panel";
let styleInjected = false;
function ensurePanelStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement("style");
  style.setAttribute("data-sjt-caption", "");
  style.textContent =
    `.${PANEL_CLASS} { overflow-y: auto; scrollbar-width: none; }\n` +
    `.${PANEL_CLASS}::-webkit-scrollbar { display: none; }`;
  document.head.appendChild(style);
}

// ─── CaptionOverlay ───────────────────────────────────────

export class CaptionOverlay {
  private container: HTMLElement;
  private panel: HTMLDivElement;
  private titleEl: HTMLHeadingElement;
  private bodyEl: HTMLParagraphElement;

  private font: string;
  private titleFont: string;
  private lineHeightPx: number;
  private titleLineHeightPx: number;
  private position: "auto" | "bottom" | "left" | "right";
  private panelWidth: number;
  private letterSpacingEm = 0;
  private maxHeightVh: number;
  private mobileBreakpoint: number;

  private resizeObserver: ResizeObserver;
  private containerWidth: number;
  private mode: "bottom" | "side" | null = null;

  private readyPromise: Promise<void>;
  private fontsReady = false;
  private pendingCopy: CaptionCopy | null = null;
  private currentCopy: CaptionCopy | null = null;
  private _visible = false;
  private disposed = false;
  private typographyVersion = 0;

  constructor(config: CaptionOverlayConfig) {
    this.container = config.container;
    this.font = config.font ?? `16px ${DEFAULT_FONT_STACK}`;
    this.titleFont = config.titleFont ?? `600 20px ${DEFAULT_FONT_STACK}`;
    this.lineHeightPx = config.lineHeightPx ?? 24;
    this.titleLineHeightPx = config.titleLineHeightPx ?? 28;
    this.position = config.position ?? "auto";
    this.panelWidth = config.panelWidth ?? DEFAULT_PANEL_WIDTH;
    this.maxHeightVh = config.maxHeightVh ?? 40;
    this.mobileBreakpoint = config.mobileBreakpoint ?? 768;

    // Seed width like SparkScene's constructor does; the ResizeObserver
    // keeps it fresh from contentRect afterwards (no per-frame reads).
    this.containerWidth = this.container.clientWidth;

    ensurePanelStyle();

    // Panel — the aria-live region. Copy swaps announce title + body.
    this.panel = document.createElement("div");
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
      zIndex: String(config.zIndex ?? 900),
      opacity: "0",
      pointerEvents: "none",
      transition: TRANSITION,
    });

    this.titleEl = document.createElement("h2");
    Object.assign(this.titleEl.style, {
      margin: "0",
      font: this.titleFont,
      lineHeight: `${this.titleLineHeightPx}px`,
      overflowWrap: "break-word",
      display: "none",
    });

    this.bodyEl = document.createElement("p");
    Object.assign(this.bodyEl.style, {
      margin: "0",
      font: this.font,
      lineHeight: `${this.lineHeightPx}px`,
      overflowWrap: "break-word",
    });

    this.panel.appendChild(this.titleEl);
    this.panel.appendChild(this.bodyEl);

    // Container needs relative positioning for the absolute panel
    if (getComputedStyle(this.container).position === "static") {
      this.container.style.position = "relative";
    }
    this.container.appendChild(this.panel);

    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      this.containerWidth = entry.contentRect.width;
      if (this.fontsReady && this._visible && this.currentCopy) {
        this.render(this.currentCopy, true);
      }
    });
    this.resizeObserver.observe(this.container);

    // Explicitly request both faces — never the bare fonts.ready
    // (lazily-loaded webfonts would cache fallback widths otherwise).
    this.readyPromise = this.initFonts();
  }

  // ─── Public API ───────────────────────────────────────────

  /**
   * Resolves after whenFontsReady(font, titleFont) — faces explicitly
   * load()-ed. show() calls before this are queued, not dropped.
   */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  /** Apply new font inputs only after their faces are ready for Pretext measurement. */
  setTypography(style: CaptionTypographyStyle): void {
    const version = ++this.typographyVersion;
    const nextFont = style.font ?? this.font;
    const nextTitleFont = style.titleFont ?? this.titleFont;
    const fontsChanged = nextFont !== this.font || nextTitleFont !== this.titleFont;

    const apply = (): void => {
      if (this.disposed || version !== this.typographyVersion) return;

      if (style.font != null) {
        this.font = style.font;
        this.bodyEl.style.font = this.font;
      }
      if (style.titleFont != null) {
        this.titleFont = style.titleFont;
        this.titleEl.style.font = this.titleFont;
      }
      if (style.lineHeightPx != null) {
        this.lineHeightPx = style.lineHeightPx;
        this.bodyEl.style.lineHeight = `${this.lineHeightPx}px`;
      }
      if (style.titleLineHeightPx != null) {
        this.titleLineHeightPx = style.titleLineHeightPx;
        this.titleEl.style.lineHeight = `${this.titleLineHeightPx}px`;
      }
      if (style.color != null) {
        this.panel.style.color = style.color;
      }
      if (style.letterSpacingEm != null) {
        this.letterSpacingEm = style.letterSpacingEm;
        this.bodyEl.style.letterSpacing = `${this.letterSpacingEm}em`;
        this.titleEl.style.letterSpacing = `${this.letterSpacingEm}em`;
      }
      if (style.measureCh != null) {
        this.panelWidth =
          Math.round(measureCharWidthPx("0", this.font) * style.measureCh) +
          2 * PADDING_X +
          2 * BORDER_W;
        if (this.resolveMode() === "side") {
          this.panel.style.width = `${this.panelWidth}px`;
        }
      }
      if (style.panelWidth != null) {
        this.panelWidth = style.panelWidth;
        if (this.resolveMode() === "side") {
          this.panel.style.width = `${this.panelWidth}px`;
        }
      }
      // Guarded like every other field so a partial call (e.g. { color }) does
      // not silently reset a previously-set justify back to left.
      if (style.align != null) {
        this.bodyEl.style.textAlign = style.align;
      }

      if (this.fontsReady && this._visible && this.currentCopy) {
        this.render(this.currentCopy, true);
      }
    };

    // A change that does not touch the font strings (color / tracking / align /
    // measure) needs no font await — apply it synchronously and skip the
    // per-tick promise churn. Only sync when the current fonts are confirmed
    // loaded (this.fontsReady); at boot, or on a font change, await first.
    if (!fontsChanged && this.fontsReady) {
      apply();
    } else {
      void whenFontsReady(nextFont, nextTitleFont).then(apply);
    }
  }

  /** Show copy in the panel. Queued until ready() when fonts are still loading. */
  show(copy: CaptionCopy): void {
    if (this.disposed) return;
    if (!this.fontsReady) {
      this.pendingCopy = copy;
      return;
    }
    const firstShow = !this._visible;
    this.currentCopy = copy;
    this.render(copy, !firstShow);
    this._visible = true;
    this.panel.style.opacity = "1";
    this.panel.style.pointerEvents = "auto";
  }

  hide(): void {
    if (this.disposed || !this._visible) return;
    this._visible = false;
    this.panel.style.opacity = "0";
    this.panel.style.pointerEvents = "none";
  }

  get visible(): boolean {
    return this._visible;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.panel.remove();
    this.pendingCopy = null;
    this.currentCopy = null;
  }

  // ─── Private: fonts ───────────────────────────────────────

  private async initFonts(): Promise<void> {
    await whenFontsReady(this.font, this.titleFont);
    if (this.disposed) return;
    this.fontsReady = true;
    if (this.pendingCopy) {
      const queued = this.pendingCopy;
      this.pendingCopy = null;
      this.show(queued);
    }
  }

  // ─── Private: layout ──────────────────────────────────────

  private resolveMode(): "bottom" | "side" {
    if (this.position === "bottom") return "bottom";
    if (this.position === "left" || this.position === "right") return "side";
    return this.containerWidth < this.mobileBreakpoint ? "bottom" : "side";
  }

  private applyMode(mode: "bottom" | "side"): void {
    if (mode === this.mode) return;
    this.mode = mode;
    const s = this.panel.style;
    if (mode === "bottom") {
      s.left = `${SHEET_MARGIN}px`;
      s.right = `${SHEET_MARGIN}px`;
      s.bottom = `${SHEET_MARGIN}px`;
      s.top = "auto";
      s.width = "auto";
      s.maxHeight = `${this.maxHeightVh}vh`;
    } else {
      const side = this.position === "left" ? "left" : "right";
      s.left = side === "left" ? `${PANEL_MARGIN}px` : "auto";
      s.right = side === "right" ? `${PANEL_MARGIN}px` : "auto";
      s.bottom = `${PANEL_MARGIN}px`;
      s.top = "auto";
      s.width = `${this.panelWidth}px`;
      s.maxHeight = "none";
    }
  }

  /** Content width available to text — panel width minus padding and border (border-box). */
  private contentWidth(mode: "bottom" | "side"): number {
    const panelW =
      mode === "bottom"
        ? this.containerWidth - 2 * SHEET_MARGIN
        : this.panelWidth;
    return Math.max(0, panelW - 2 * PADDING_X - 2 * BORDER_W);
  }

  /**
   * Write copy into the DOM and set the Pretext-computed height.
   * When animate is false (first show), the height transition is
   * suppressed for one frame so the panel doesn't grow from 0.
   */
  private render(copy: CaptionCopy, animate: boolean): void {
    const mode = this.resolveMode();
    this.applyMode(mode);
    const width = this.contentWidth(mode);
    const bodyMeasureOptions = this.letterSpacingEm !== 0
      ? { letterSpacing: this.letterSpacingEm * parseFontShorthand(this.font).fontSize }
      : undefined;
    const titleMeasureOptions = this.letterSpacingEm !== 0
      ? { letterSpacing: this.letterSpacingEm * parseFontShorthand(this.titleFont).fontSize }
      : undefined;

    let titleHeight = 0;
    let gap = 0;
    if (copy.title !== undefined && copy.title.length > 0) {
      this.titleEl.style.display = "block";
      this.titleEl.textContent = copy.title;
      this.bodyEl.style.marginTop = `${TITLE_GAP}px`;
      titleHeight = measureTextHeight(
        copy.title,
        this.titleFont,
        width,
        this.titleLineHeightPx,
        titleMeasureOptions,
      );
      gap = TITLE_GAP;
    } else {
      this.titleEl.style.display = "none";
      this.titleEl.textContent = "";
      this.bodyEl.style.marginTop = "0";
    }
    this.bodyEl.textContent = copy.body;

    const bodyHeight = measureTextHeight(
      copy.body,
      this.font,
      width,
      this.lineHeightPx,
      bodyMeasureOptions,
    );
    const height = 2 * BORDER_W + 2 * PADDING_Y + titleHeight + gap + bodyHeight;
    this.setHeight(height, animate);
  }

  private setHeight(px: number, animate: boolean): void {
    if (animate) {
      this.panel.style.height = `${px}px`;
      return;
    }
    // Suppress the height transition without any forced-layout read:
    // narrow the transition to opacity-only, set the height, and restore
    // the full transition after the style has committed (double rAF).
    this.panel.style.transition = "opacity 200ms ease";
    this.panel.style.height = `${px}px`;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!this.disposed) this.panel.style.transition = TRANSITION;
      });
    });
  }
}
