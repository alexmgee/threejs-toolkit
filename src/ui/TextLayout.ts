/**
 * TextLayout — Pretext bridge utilities
 *
 * Font-string parsing, Pretext↔textSplats unit conversion, and cached
 * measurement wrappers. The shared substrate for CaptionOverlay,
 * SplatTextMesh, and ObstacleLayout.
 *
 * Rules enforced here:
 *  - Fonts passed to Pretext must use named families — `system-ui` throws.
 *    Canvas and DOM resolve system-ui to different optical variants on
 *    macOS, breaking measurement parity (Pretext layout.ts "Limitations").
 *  - Text metrics come from Pretext only. Nothing in this pipeline may
 *    read DOM layout boxes (bounding rects / offset sizes) to measure text.
 *
 * textSplats interop notes (verified against reference/spark):
 *  - textSplats builds its canvas font as `${fontSize}px ${font}` — there
 *    is no slot for weight or style. Weighted shorthands are DOM-lane only.
 *  - textSplats lineHeight is a multiplier on fontBoundingBoxAscent +
 *    fontBoundingBoxDescent; lineHeightMultiplier() converts px to it.
 */

import {
  layout,
  layoutWithLines,
  prepareWithSegments,
  clearCache,
  type PreparedTextWithSegments,
  type PrepareOptions,
} from "@chenglou/pretext";

// ─── Types ────────────────────────────────────────────────

export interface ParsedFont {
  /** Weight/style prefix when the shorthand carried one (e.g. "700", "italic 600") */
  fontPrefix?: string;
  /** Font size in px */
  fontSize: number;
  /** Family list, quotes preserved (e.g. `"DM Sans", Helvetica, sans-serif`) */
  fontFamily: string;
}

/** Canonical named-font stack for toolkit text modules (site font: DM Sans). */
export const DEFAULT_FONT_STACK = '"DM Sans", Helvetica, Arial, sans-serif';

// ─── Font shorthand parsing ───────────────────────────────

// Optional lazy prefix (weight/style tokens), required <number>px, then family.
const FONT_SHORTHAND_RE = /^(?:(.+?)\s+)?(\d+(?:\.\d+)?)px\s+(.+)$/;

/**
 * Parse a CSS font shorthand of the form "[weight/style ]<size>px <family>".
 * Throws on unparseable input and on any `system-ui` family (measurement hazard).
 */
export function parseFontShorthand(font: string): ParsedFont {
  const match = FONT_SHORTHAND_RE.exec(font.trim());
  if (!match) {
    throw new Error(
      `TextLayout: cannot parse font shorthand "${font}" — expected "[weight/style ]<size>px <family>"`,
    );
  }
  const [, prefix, size, family] = match;
  if (/\bsystem-ui\b/i.test(family)) {
    throw new Error(
      `TextLayout: "system-ui" is not allowed in Pretext-measured fonts ("${font}") — ` +
        `use named families (canvas and DOM resolve system-ui differently on macOS)`,
    );
  }
  const parsed: ParsedFont = {
    fontSize: parseFloat(size),
    fontFamily: family.trim(),
  };
  if (prefix !== undefined && prefix.trim().length > 0) {
    parsed.fontPrefix = prefix.trim();
  }
  return parsed;
}

/** Reassemble a ParsedFont into a canvas/CSS font string. */
export function toFontString(parsed: ParsedFont, includePrefix = true): string {
  const prefix = includePrefix && parsed.fontPrefix ? `${parsed.fontPrefix} ` : "";
  return `${prefix}${parsed.fontSize}px ${parsed.fontFamily}`;
}

// ─── Font metrics (textSplats interop) ────────────────────

let measureCtx: CanvasRenderingContext2D | null = null;
const fontHeightCache = new Map<string, number>();

function getMeasureContext(): CanvasRenderingContext2D {
  if (!measureCtx) {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) throw new Error("TextLayout: failed to create 2D canvas context");
    measureCtx = ctx;
  }
  return measureCtx;
}

/**
 * fontBoundingBoxAscent + fontBoundingBoxDescent for a font, via one cached
 * canvas measureText("") per (fontSize, fontFamily). Mirrors the fontHeight
 * textSplats computes internally, so conversions stay exact.
 */
export function fontHeightPx(fontSize: number, fontFamily: string): number {
  const key = `${fontSize}px ${fontFamily}`;
  const cached = fontHeightCache.get(key);
  if (cached !== undefined) return cached;

  const ctx = getMeasureContext();
  ctx.font = key;
  const metrics = ctx.measureText("");
  const height = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
  fontHeightCache.set(key, height);
  return height;
}

/**
 * Canvas-measured width of one character for a complete CSS font shorthand.
 * Deliberately UNCACHED: this is called only at author-panel render time and
 * on caption typography changes (never per-frame), and a cache measured before
 * the webfont face loads would poison every later read. Measuring fresh means
 * the value always reflects whatever face is loaded at call time.
 */
export function measureCharWidthPx(char: string, font: string): number {
  const ctx = getMeasureContext();
  ctx.font = font;
  return ctx.measureText(char).width;
}

/**
 * Convert a Pretext px lineHeight to the textSplats lineHeight multiplier:
 * multiplier = lineHeightPx / (fontBoundingBoxAscent + fontBoundingBoxDescent).
 */
export function lineHeightMultiplier(
  fontSize: number,
  fontFamily: string,
  lineHeightPx: number,
): number {
  return lineHeightPx / fontHeightPx(fontSize, fontFamily);
}

// ─── Cached preparation + measurement ─────────────────────

const preparedCache = new Map<string, PreparedTextWithSegments>();
const warnedFonts = new Set<string>();

/**
 * Cached PreparedTextWithSegments for (text, font, options). The prepared
 * result is width-independent — lay it out at any width via layout APIs.
 */
export function getPrepared(
  text: string,
  font: string,
  options?: PrepareOptions,
): PreparedTextWithSegments {
  parseFontShorthand(font); // named-font guard + shape validation

  // Stale-measurement guard: a registered-but-unloaded webfont (lazy loading —
  // faces load on first use, so fonts.ready alone can resolve before the face
  // is even requested) makes canvas measure the fallback font while the DOM
  // later swaps to the real one. fonts.check() is false exactly in that state.
  if (!warnedFonts.has(font) && typeof document !== "undefined" && document.fonts !== undefined) {
    warnedFonts.add(font);
    try {
      if (!document.fonts.check(font)) {
        console.warn(
          `TextLayout: "${font}" contains webfont faces that are not loaded yet — ` +
            `measurements will use fallback fonts and are cached. ` +
            `Gate the first layout on whenFontsReady("${font}").`,
        );
      }
    } catch {
      // fonts.check can throw on exotic-but-valid strings; the guard is advisory only
    }
  }

  const key = `${font}::${options ? JSON.stringify(options) : ""}::${text}`;
  const cached = preparedCache.get(key);
  if (cached !== undefined) return cached;

  const prepared = prepareWithSegments(text, font, options);
  preparedCache.set(key, prepared);
  return prepared;
}

/** Wrap text at maxWidthPx; returns the wrapped line strings. */
export function wrapLines(
  text: string,
  font: string,
  maxWidthPx: number,
  options?: PrepareOptions,
): string[] {
  const prepared = getPrepared(text, font, options);
  const { lines } = layoutWithLines(prepared, maxWidthPx, 1);
  return lines.map((line) => line.text);
}

/** Block height in px for text at a width — the panel-sizing primitive. */
export function measureTextHeight(
  text: string,
  font: string,
  maxWidthPx: number,
  lineHeightPx: number,
  options?: PrepareOptions,
): number {
  const prepared = getPrepared(text, font, options);
  return layout(prepared, maxWidthPx, lineHeightPx).height;
}

// ─── Lifecycle ────────────────────────────────────────────

/**
 * Resolves when the given fonts are actually loaded.
 *
 * Pass the font shorthands you are about to measure (e.g. `16px ${DEFAULT_FONT_STACK}`).
 * Each is explicitly requested via document.fonts.load() — this matters: webfonts
 * load lazily on first use, so awaiting document.fonts.ready alone can resolve
 * before the face was ever requested, and Pretext would measure (and cache) the
 * fallback font's widths.
 */
export async function whenFontsReady(...fonts: string[]): Promise<void> {
  if (fonts.length > 0) {
    await Promise.all(fonts.map((font) => document.fonts.load(font)));
  }
  await document.fonts.ready;
}

/** Clear this module's caches and Pretext's internal caches. */
export function clearTextLayoutCache(): void {
  preparedCache.clear();
  fontHeightCache.clear();
  warnedFonts.clear();
  clearCache();
}
