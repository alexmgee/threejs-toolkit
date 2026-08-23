import type { ScreenRectNorm } from "../site/SiteConfig";

export interface EditorialRegionEditorConfig {
  container: HTMLElement;
  getColumns: () => ScreenRectNorm[] | undefined;
  getSize: () => { width: number; height: number };
  onCommit: () => void;
  minSizeNorm?: number;
  zIndex?: number;
  /** Box corner label. Defaults to the 1-based index (columns); a free
   *  single-rect editor passes a badge like "◳" to read as an anchor, not a
   *  column number (P8d D12). */
  boxLabel?: (index: number) => string;
}

type DragMode = "move" | "n" | "e" | "s" | "w" | "nw" | "ne" | "sw" | "se";

interface DragState {
  pointerId: number;
  captureTarget: HTMLElement;
  column: ScreenRectNorm;
  box: HTMLDivElement;
  mode: DragMode;
  startClientX: number;
  startClientY: number;
  startRect: ScreenRectNorm;
}

interface HandleSpec {
  mode: Exclude<DragMode, "move">;
  left: string;
  top: string;
  cursor: string;
}

const HANDLE_SPECS: HandleSpec[] = [
  { mode: "nw", left: "0%", top: "0%", cursor: "nwse-resize" },
  { mode: "n", left: "50%", top: "0%", cursor: "ns-resize" },
  { mode: "ne", left: "100%", top: "0%", cursor: "nesw-resize" },
  { mode: "e", left: "100%", top: "50%", cursor: "ew-resize" },
  { mode: "se", left: "100%", top: "100%", cursor: "nwse-resize" },
  { mode: "s", left: "50%", top: "100%", cursor: "ns-resize" },
  { mode: "sw", left: "0%", top: "100%", cursor: "nesw-resize" },
  { mode: "w", left: "0%", top: "50%", cursor: "ew-resize" },
];

/** Authoring-only, screen-space editor for normalized editorial column rectangles. */
export class EditorialRegionEditor {
  private root: HTMLDivElement;
  private minSizeNorm: number;
  private isActive = false;
  private drag: DragState | null = null;
  private disposed = false;

  constructor(private config: EditorialRegionEditorConfig) {
    this.minSizeNorm = clamp(config.minSizeNorm ?? 0.05, 0, 1);
    this.root = document.createElement("div");
    this.root.setAttribute("aria-hidden", "true");
    Object.assign(this.root.style, {
      position: "absolute",
      inset: "0",
      zIndex: String(config.zIndex ?? 720),
      display: "none",
      pointerEvents: "none",
    });
    config.container.appendChild(this.root);
  }

  get active(): boolean {
    return this.isActive;
  }

  setActive(active: boolean): void {
    if (this.disposed || active === this.isActive) return;
    this.isActive = active;
    this.root.style.display = active ? "block" : "none";
    if (!active) this.finishDrag(false);
  }

  refresh(): void {
    // Skip entirely when hidden: consumers call refresh() on every typography
    // change and container resize, and rebuilding the box/handle DOM for an
    // inactive (display:none) overlay is pure waste.
    if (this.disposed || !this.isActive) return;
    // Never rebuild MID-DRAG: refresh() is now also called on the "text" change
    // a numeric placement edit fires, and finishDrag(false) would REVERT the
    // in-progress pointer drag (an interleave the author can hit by editing a
    // numeric field while dragging on a second pointer) — consult finding C.
    if (this.drag) return;
    this.root.replaceChildren();

    const columns = this.config.getColumns() ?? [];
    const { width, height } = this.config.getSize();
    columns.forEach((column, index) => {
      const box = this.createBox(column, index);
      this.applyRect(box, column, width, height);
      this.root.appendChild(box);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.finishDrag(false);
    this.disposed = true;
    this.isActive = false;
    this.root.remove();
  }

  private createBox(column: ScreenRectNorm, index: number): HTMLDivElement {
    const box = document.createElement("div");
    box.dataset.regionIndex = String(index);
    Object.assign(box.style, {
      position: "absolute",
      boxSizing: "border-box",
      border: "1px solid rgba(126, 211, 255, 0.95)",
      background: "rgba(56, 162, 220, 0.1)",
      boxShadow: "0 0 0 1px rgba(0, 0, 0, 0.45), inset 0 0 18px rgba(56, 162, 220, 0.08)",
      cursor: "move",
      pointerEvents: "auto",
      touchAction: "none",
      userSelect: "none",
    });
    box.addEventListener("pointerdown", (event) => {
      this.startDrag(event, column, box, "move");
    });

    const label = document.createElement("div");
    label.textContent = this.config.boxLabel?.(index) ?? String(index + 1);
    Object.assign(label.style, {
      position: "absolute",
      top: "5px",
      left: "6px",
      padding: "1px 5px",
      borderRadius: "3px",
      background: "rgba(12, 22, 31, 0.78)",
      color: "#d9f3ff",
      font: "600 11px/16px sans-serif",
      pointerEvents: "none",
    });
    box.appendChild(label);

    for (const spec of HANDLE_SPECS) {
      const handle = document.createElement("div");
      handle.dataset.handle = spec.mode;
      Object.assign(handle.style, {
        position: "absolute",
        left: spec.left,
        top: spec.top,
        width: "10px",
        height: "10px",
        boxSizing: "border-box",
        border: "1px solid rgba(8, 25, 35, 0.9)",
        borderRadius: "2px",
        background: "#9be3ff",
        boxShadow: "0 1px 4px rgba(0, 0, 0, 0.55)",
        cursor: spec.cursor,
        pointerEvents: "auto",
        touchAction: "none",
        transform: "translate(-50%, -50%)",
      });
      handle.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        this.startDrag(event, column, box, spec.mode);
      });
      box.appendChild(handle);
    }

    return box;
  }

  private startDrag(
    event: PointerEvent,
    column: ScreenRectNorm,
    box: HTMLDivElement,
    mode: DragMode,
  ): void {
    if (!this.isActive || this.disposed) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    this.finishDrag(false);
    event.preventDefault();
    const captureTarget = event.currentTarget as HTMLElement;
    captureTarget.setPointerCapture(event.pointerId);
    captureTarget.addEventListener("pointermove", this.handlePointerMove);
    captureTarget.addEventListener("pointerup", this.handlePointerUp);
    captureTarget.addEventListener("pointercancel", this.handlePointerCancel);
    this.drag = {
      pointerId: event.pointerId,
      captureTarget,
      column,
      box,
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRect: { ...column },
    };
  }

  private handlePointerMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { width, height } = this.config.getSize();
    if (width <= 0 || height <= 0) return;

    event.preventDefault();
    const dx = (event.clientX - drag.startClientX) / width;
    const dy = (event.clientY - drag.startClientY) / height;
    const next = this.dragRect(drag.startRect, drag.mode, dx, dy);
    Object.assign(drag.column, next);
    this.applyRect(drag.box, drag.column, width, height);
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    this.finishDrag(true);
  };

  private handlePointerCancel = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    this.finishDrag(false);
  };

  private finishDrag(commit: boolean): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    drag.captureTarget.removeEventListener("pointermove", this.handlePointerMove);
    drag.captureTarget.removeEventListener("pointerup", this.handlePointerUp);
    drag.captureTarget.removeEventListener("pointercancel", this.handlePointerCancel);
    if (drag.captureTarget.hasPointerCapture(drag.pointerId)) {
      drag.captureTarget.releasePointerCapture(drag.pointerId);
    }
    if (commit) {
      if (!this.disposed) this.config.onCommit();
    } else {
      // Abandoned drag (pointercancel, deactivate, or a resize-triggered
      // refresh mid-drag): handlePointerMove mutated the live config rect in
      // place, so revert it to the pre-drag geometry — otherwise the config
      // (and any export) keeps half-dragged, uncommitted values while the
      // panel's numeric inputs still show the pre-drag numbers.
      Object.assign(drag.column, drag.startRect);
      const { width, height } = this.config.getSize();
      this.applyRect(drag.box, drag.column, width, height);
    }
  }

  private dragRect(
    start: ScreenRectNorm,
    mode: DragMode,
    dx: number,
    dy: number,
  ): ScreenRectNorm {
    const min = this.minSizeNorm;
    if (mode === "move") {
      const width = clamp(start.width, min, 1);
      const height = clamp(start.height, min, 1);
      return {
        x: clamp(start.x + dx, 0, 1 - width),
        y: clamp(start.y + dy, 0, 1 - height),
        width,
        height,
      };
    }

    let x: number;
    let width: number;
    if (mode.includes("w")) {
      const right = clamp(start.x + start.width, min, 1);
      x = clamp(start.x + dx, 0, right - min);
      width = right - x;
    } else if (mode.includes("e")) {
      x = clamp(start.x, 0, 1 - min);
      const right = clamp(start.x + start.width + dx, x + min, 1);
      width = right - x;
    } else {
      width = clamp(start.width, min, 1);
      x = clamp(start.x, 0, 1 - width);
    }

    let y: number;
    let height: number;
    if (mode.includes("n")) {
      const bottom = clamp(start.y + start.height, min, 1);
      y = clamp(start.y + dy, 0, bottom - min);
      height = bottom - y;
    } else if (mode.includes("s")) {
      y = clamp(start.y, 0, 1 - min);
      const bottom = clamp(start.y + start.height + dy, y + min, 1);
      height = bottom - y;
    } else {
      height = clamp(start.height, min, 1);
      y = clamp(start.y, 0, 1 - height);
    }

    return { x, y, width, height };
  }

  private applyRect(
    box: HTMLDivElement,
    rect: ScreenRectNorm,
    width: number,
    height: number,
  ): void {
    box.style.left = `${rect.x * width}px`;
    box.style.top = `${rect.y * height}px`;
    box.style.width = `${rect.width * width}px`;
    box.style.height = `${rect.height * height}px`;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
