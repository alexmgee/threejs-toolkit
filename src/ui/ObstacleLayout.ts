/**
 * ObstacleLayout — Route Pretext text columns around screen-space rects
 *
 * Original toolkit geometry (interval carving per line band) + a
 * cursor-based column layout over Pretext's layoutNextLine + a pooled
 * absolute-positioned DOM renderer. The published Pretext package does
 * not export its demo helpers (0.0.8 removed the ./demos/* subpath),
 * so the geometry here is written from scratch against the same
 * behavior the upstream wrap-geometry/dynamic-layout demos exhibit.
 *
 * Update model (plan ADR-7): callers recompute projection + layout every
 * frame while an obstacle section is active and call LinePool.commit —
 * the pool diffs against the previous commit (1px quantized) and touches
 * the DOM only when a positioned line actually changed. Idle frames cost
 * zero DOM writes.
 *
 * Authored-camera assumption: obstacle sections are designed so the
 * obstacle stays in front of the camera (rail-pinned sections).
 * projectBox3ToScreen returns null when any corner lands at or behind
 * the camera plane; callers treat null as "no obstacle" and the text
 * degrades to plain column flow rather than guessing.
 *
 * The geometry functions are pure and unit-testable without a browser.
 */

import * as THREE from "three";
import { layoutNextLine, type LayoutCursor, type PreparedTextWithSegments } from "@chenglou/pretext";

// ─── Types ────────────────────────────────────────────────

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Interval {
  left: number;
  right: number;
}

export interface ColumnRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PositionedLine {
  x: number;
  y: number;
  width: number;
  text: string;
}

export interface PositionedLineFragment {
  itemIndex: number;
  text: string;
  gapBefore: number;
  occupiedWidth: number;
  href?: string;
  blockId: string;
  runIndex: number | null;
}

export interface ObstacleColumnOptions {
  /** Blocked-interval expansion left/right of an obstacle (default: lineHeightPx * 0.8) */
  horizontalPadding?: number;
  /** Blocked-interval expansion above/below an obstacle (default: lineHeightPx * 0.25) */
  verticalPadding?: number;
  /** Which slot receives the line when several remain (default: "widest") */
  slotPick?: "widest" | "leftmost" | "rightmost";
  /** Slots narrower than this are dropped (default: 24) */
  minSlotWidth?: number;
}

/** Start-of-text cursor for layoutObstacleColumn chains. */
export const START_CURSOR: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };

// ─── Screen projection ────────────────────────────────────

const _corner = new THREE.Vector3();
const _boxCorners = Array.from({ length: 8 }, () => new THREE.Vector3());

/**
 * Project world-space obstacle corners to a screen-space rect (CSS px,
 * top-left origin). Returns null when any corner projects at or behind
 * the camera plane (NDC z > 1 after projection) or is non-finite —
 * callers treat that as "no obstacle".
 */
export function projectCornersToScreen(
  corners: readonly THREE.Vector3[],
  camera: THREE.Camera,
  viewportWidth: number,
  viewportHeight: number,
): ScreenRect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const corner of corners) {
    _corner.copy(corner).project(camera);
    if (
      !Number.isFinite(_corner.x) ||
      !Number.isFinite(_corner.y) ||
      !Number.isFinite(_corner.z) ||
      _corner.z > 1
    ) {
      return null;
    }
    const sx = (_corner.x * 0.5 + 0.5) * viewportWidth;
    const sy = (-_corner.y * 0.5 + 0.5) * viewportHeight;
    minX = Math.min(minX, sx);
    minY = Math.min(minY, sy);
    maxX = Math.max(maxX, sx);
    maxY = Math.max(maxY, sy);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Project a world-space Box3 to a screen-space rect (CSS px, top-left
 * origin). Preserves the original Box3 corner order and null semantics.
 */
export function projectBox3ToScreen(
  box: THREE.Box3,
  camera: THREE.Camera,
  viewportWidth: number,
  viewportHeight: number,
): ScreenRect | null {
  let i = 0;
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        _boxCorners[i++].set(x, y, z);
      }
    }
  }
  return projectCornersToScreen(_boxCorners, camera, viewportWidth, viewportHeight);
}

// ─── Interval carving ─────────────────────────────────────

/**
 * Rects overlapping the horizontal band [bandTop, bandBottom], expanded
 * by padding, as blocked x-intervals.
 */
export function rectIntervalsForBand(
  rects: ScreenRect[],
  bandTop: number,
  bandBottom: number,
  horizontalPadding: number,
  verticalPadding: number,
): Interval[] {
  const blocked: Interval[] = [];
  for (const rect of rects) {
    const top = rect.y - verticalPadding;
    const bottom = rect.y + rect.height + verticalPadding;
    if (bottom <= bandTop || top >= bandBottom) continue;
    blocked.push({
      left: rect.x - horizontalPadding,
      right: rect.x + rect.width + horizontalPadding,
    });
  }
  return blocked;
}

/**
 * Subtract blocked intervals from a base interval; drop remaining slots
 * narrower than minSlotWidth (default 24 — sliver columns are unreadable).
 */
export function subtractIntervals(
  base: Interval,
  blocked: Interval[],
  minSlotWidth = 24,
): Interval[] {
  const relevant = blocked
    .filter((b) => b.right > base.left && b.left < base.right)
    .sort((a, b) => a.left - b.left);

  const slots: Interval[] = [];
  let cursor = base.left;
  for (const b of relevant) {
    if (b.left > cursor) {
      slots.push({ left: cursor, right: Math.min(b.left, base.right) });
    }
    cursor = Math.max(cursor, b.right);
    if (cursor >= base.right) break;
  }
  if (cursor < base.right) {
    slots.push({ left: cursor, right: base.right });
  }
  return slots.filter((s) => s.right - s.left >= minSlotWidth);
}

// ─── Column layout ────────────────────────────────────────

/**
 * Fill a column region band by band, carving each band around the
 * obstacles and placing one Pretext line per band. Returns positioned
 * lines and the cursor where text ran out of region — feed it to the
 * next column for continuous flow. Bands with no usable slot skip a
 * line height and continue.
 */
export function layoutObstacleColumn(
  prepared: PreparedTextWithSegments,
  start: LayoutCursor,
  region: ColumnRegion,
  lineHeightPx: number,
  obstacles: ScreenRect[],
  options: ObstacleColumnOptions = {},
): { lines: PositionedLine[]; cursor: LayoutCursor } {
  const {
    horizontalPadding = lineHeightPx * 0.8,
    verticalPadding = lineHeightPx * 0.25,
    slotPick = "widest",
    minSlotWidth = 24,
  } = options;

  const lines: PositionedLine[] = [];
  let cursor = start;
  const base: Interval = { left: region.x, right: region.x + region.width };

  for (
    let bandTop = region.y;
    bandTop + lineHeightPx <= region.y + region.height;
    bandTop += lineHeightPx
  ) {
    const blocked = rectIntervalsForBand(
      obstacles,
      bandTop,
      bandTop + lineHeightPx,
      horizontalPadding,
      verticalPadding,
    );
    const slots = subtractIntervals(base, blocked, minSlotWidth);
    if (slots.length === 0) continue;

    let slot = slots[0];
    if (slotPick === "widest") {
      for (const s of slots) {
        if (s.right - s.left > slot.right - slot.left) slot = s;
      }
    } else if (slotPick === "rightmost") {
      slot = slots[slots.length - 1];
    }

    const line = layoutNextLine(prepared, cursor, slot.right - slot.left);
    if (line === null) break; // text exhausted
    lines.push({ x: slot.left, y: bandTop, width: line.width, text: line.text });
    cursor = line.end;
  }

  return { lines, cursor };
}

// ─── Pooled DOM renderer ──────────────────────────────────

export interface LinePoolOptions {
  /** Font shorthand applied to every span (named families only) */
  font: string;
  lineHeightPx: number;
  className?: string;
  onLinkActivate?: (detail: {
    href: string;
    blockId: string;
    runIndex: number | null;
    kind: "fragment" | "external";
  }) => boolean;
}

/**
 * Pooled absolute-positioned <span> renderer for PositionedLine[] (the
 * upstream dynamic-layout syncPool pattern). commit() diffs against the
 * previous frame with 1px position quantization and returns whether the
 * DOM was actually touched.
 */
export class LinePool {
  private container: HTMLElement;
  private options: LinePoolOptions;
  private spans: HTMLSpanElement[] = [];
  private fragmentSpans: HTMLSpanElement[][] = [];
  private prev: PositionedLine[] = [];
  private prevFragments: ReadonlyArray<ReadonlyArray<PositionedLineFragment>> | undefined;
  private prevVisible = 0;

  constructor(container: HTMLElement, options: LinePoolOptions) {
    this.container = container;
    this.options = options;
  }

  /** Render lines; returns true if the DOM was modified. */
  commit(
    lines: PositionedLine[],
    fragments?: ReadonlyArray<ReadonlyArray<PositionedLineFragment>>,
  ): boolean {
    if (this.equalsPrev(lines, fragments)) return false;

    while (this.spans.length < lines.length) {
      const span = document.createElement("span");
      if (this.options.className) span.className = this.options.className;
      Object.assign(span.style, {
        position: "absolute",
        left: "0",
        top: "0",
        whiteSpace: "pre",
        font: this.options.font,
        lineHeight: `${this.options.lineHeightPx}px`,
      });
      this.container.appendChild(span);
      this.spans.push(span);
      this.fragmentSpans.push([]);
    }

    for (let i = 0; i < lines.length; i++) {
      const span = this.spans[i];
      const line = lines[i];
      const lineFragments = fragments?.[i];
      if (lineFragments === undefined) {
        if (this.fragmentSpans[i].length > 0 || span.textContent !== line.text) {
          span.textContent = line.text;
        }
        this.fragmentSpans[i] = [];
      } else {
        this.commitFragments(span, i, lineFragments);
      }
      span.style.transform = `translate(${Math.round(line.x)}px, ${Math.round(line.y)}px)`;
      if (i >= this.prevVisible) span.style.display = "";
    }
    for (let i = lines.length; i < this.prevVisible; i++) {
      this.spans[i].style.display = "none";
    }

    this.prev = lines.map((l) => ({ ...l }));
    this.prevFragments = fragments?.map((line) => line.map((fragment) => ({ ...fragment })));
    this.prevVisible = lines.length;
    return true;
  }

  dispose(): void {
    for (const span of this.spans) span.remove();
    this.spans = [];
    this.fragmentSpans = [];
    this.prev = [];
    this.prevFragments = undefined;
    this.prevVisible = 0;
  }

  private commitFragments(
    lineSpan: HTMLSpanElement,
    lineIndex: number,
    fragments: ReadonlyArray<PositionedLineFragment>,
  ): void {
    let children = this.fragmentSpans[lineIndex];
    if (children.some((child) => child.parentElement !== lineSpan)) children = [];
    if (children.length === 0 && lineSpan.childNodes.length > 0) {
      lineSpan.textContent = "";
    }
    while (children.length < fragments.length) {
      const child = lineSpan.ownerDocument.createElement("span");
      Object.assign(child.style, {
        position: "absolute",
        top: "0",
        whiteSpace: "pre",
      });
      child.addEventListener("mousedown", (event) => {
        if (child.dataset.href !== undefined) event.preventDefault();
      });
      child.addEventListener("click", (event) => {
        const href = child.dataset.href;
        if (
          href === undefined
          || event.ctrlKey
          || event.metaKey
          || event.shiftKey
          || event.altKey
          || event.button !== 0
        ) {
          return;
        }
        const blockId = child.dataset.blockId;
        if (blockId === undefined) return;
        const rawRunIndex = child.dataset.runIndex;
        this.options.onLinkActivate?.({
          href,
          blockId,
          runIndex: rawRunIndex ? Number(rawRunIndex) : null,
          kind: href.startsWith("#") ? "fragment" : "external",
        });
      });
      lineSpan.appendChild(child);
      children.push(child);
    }
    this.fragmentSpans[lineIndex] = children;

    let left = 0;
    for (let i = 0; i < fragments.length; i++) {
      const child = children[i];
      const fragment = fragments[i];
      left += fragment.gapBefore;
      if (child.textContent !== fragment.text) child.textContent = fragment.text;
      child.style.left = `${left}px`;
      child.style.width = `${fragment.occupiedWidth}px`;
      child.style.display = "";
      if (fragment.href === undefined) {
        delete child.dataset.href;
        delete child.dataset.blockId;
        delete child.dataset.runIndex;
        child.removeAttribute("role");
        child.style.removeProperty("pointer-events");
        child.style.removeProperty("cursor");
      } else {
        child.dataset.href = fragment.href;
        child.dataset.blockId = fragment.blockId;
        child.dataset.runIndex = fragment.runIndex === null ? "" : String(fragment.runIndex);
        child.setAttribute("role", "presentation");
        child.style.pointerEvents = "auto";
        child.style.cursor = "pointer";
      }
      left += fragment.occupiedWidth;
    }
    for (let i = fragments.length; i < children.length; i++) {
      children[i].style.display = "none";
    }
  }

  private equalsPrev(
    lines: PositionedLine[],
    fragments?: ReadonlyArray<ReadonlyArray<PositionedLineFragment>>,
  ): boolean {
    if (lines.length !== this.prev.length) return false;
    if ((fragments === undefined) !== (this.prevFragments === undefined)) return false;
    for (let i = 0; i < lines.length; i++) {
      const a = lines[i];
      const b = this.prev[i];
      if (
        a.text !== b.text ||
        Math.round(a.x) !== Math.round(b.x) ||
        Math.round(a.y) !== Math.round(b.y)
      ) {
        return false;
      }
      if (fragments !== undefined) {
        const current = fragments[i] ?? [];
        const previous = this.prevFragments?.[i] ?? [];
        if (current.length !== previous.length) return false;
        for (let j = 0; j < current.length; j++) {
          const c = current[j];
          const p = previous[j];
          if (
            c.itemIndex !== p.itemIndex
            || c.text !== p.text
            || c.gapBefore !== p.gapBefore
            || c.occupiedWidth !== p.occupiedWidth
            || c.href !== p.href
            || c.blockId !== p.blockId
            || c.runIndex !== p.runIndex
          ) {
            return false;
          }
        }
      }
    }
    return true;
  }
}
