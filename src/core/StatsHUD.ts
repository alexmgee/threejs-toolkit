/**
 * StatsHUD — Lightweight performance overlay for threejs-toolkit
 *
 * Compact, always-visible performance readout independent from DebugPanel.
 * No Tweakpane dependency — can be used in production builds.
 *
 * Displays a single line of pipe-delimited stats, every count read from the
 * SplatBackend seam's `counts()` and summed over the given handles:
 * `60 fps | drawn: 1250K | resident: 2097K | src: 7935K`
 *
 * Rebuilt at pin fd67153 (Phase 2 ticket 11, doc 06 D32): the pin read Spark
 * internals (active splats, LOD selection, traversal time, sort flags, pager
 * fetchers), all gone. `drawn` is the handles' selected count (the last
 * render's draw count), `resident` their resident splats, `src` their totals.
 * A disposed handle throws (`unknown-handle`) — a diagnostics HUD that skipped
 * it would lie by omission (ruling S6).
 */

import type { SplatBackend, SplatHandle } from "../backend/SplatBackend";

// ─── Types ────────────────────────────────────────────────

export interface StatsHUDConfig {
  /** Container element to mount the HUD into */
  container: HTMLElement;
  /** The seam that owns the handles — the interface, so only its counters are reachable */
  backend: SplatBackend;
  /** Splat handle(s) whose counts are summed (default: none — every count reads 0K) */
  handles?: SplatHandle | SplatHandle[];
  /** Update frequency in Hz (default: 10) */
  updateRate?: number;
  /** Start visible (default: true) */
  visible?: boolean;
  /** Position within container (default: "top-left") */
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
}

// ─── Position CSS ─────────────────────────────────────────

const POSITION_STYLES: Record<string, Partial<CSSStyleDeclaration>> = {
  "top-left": { top: "8px", left: "8px" },
  "top-right": { top: "8px", right: "8px" },
  "bottom-left": { bottom: "8px", left: "8px" },
  "bottom-right": { bottom: "8px", right: "8px" },
};

// ─── StatsHUD ─────────────────────────────────────────────

export class StatsHUD {
  private element: HTMLDivElement;
  private backend: SplatBackend;
  private handles: SplatHandle[];
  private updateInterval: number;
  private accumulator = 0;
  private _visible: boolean;

  constructor(config: StatsHUDConfig) {
    this.backend = config.backend;
    this.handles = config.handles
      ? Array.isArray(config.handles) ? config.handles : [config.handles]
      : [];
    this.updateInterval = 1 / (config.updateRate ?? 10);
    this._visible = config.visible ?? true;

    // Create the HUD element
    this.element = document.createElement("div");
    Object.assign(this.element.style, {
      position: "absolute",
      zIndex: "50",
      padding: "4px 8px",
      background: "rgba(0, 0, 0, 0.7)",
      color: "#4ade80", // green-400
      fontSize: "10px",
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      lineHeight: "1.4",
      borderRadius: "4px",
      pointerEvents: "none",
      userSelect: "none",
      whiteSpace: "nowrap",
      ...POSITION_STYLES[config.position ?? "top-left"],
    });

    if (!this._visible) {
      this.element.style.display = "none";
    }

    config.container.appendChild(this.element);
  }

  // ─── Per-Frame Update ────────────────────────────────────

  /** Call every frame from the animation loop */
  update(deltaTime: number): void {
    if (!this._visible) return;

    this.accumulator += deltaTime;
    if (this.accumulator < this.updateInterval) return;
    this.accumulator = 0;

    const fps = deltaTime > 0 ? (1 / deltaTime).toFixed(0) : "—";

    // Seam counters summed over the handles. A disposed handle's
    // `unknown-handle` propagates — never skipped (ruling S6).
    let selected = 0;
    let resident = 0;
    let total = 0;
    for (const handle of this.handles) {
      const counts = this.backend.counts(handle);
      selected += counts.selected;
      resident += counts.resident;
      total += counts.total;
    }

    this.element.textContent = [
      `${fps} fps`,
      `drawn: ${(selected / 1000).toFixed(0)}K`,
      `resident: ${(resident / 1000).toFixed(0)}K`,
      `src: ${(total / 1000).toFixed(0)}K`,
    ].join(" | ");
  }

  // ─── Visibility ──────────────────────────────────────────

  show(): void {
    this._visible = true;
    this.element.style.display = "";
  }

  hide(): void {
    this._visible = false;
    this.element.style.display = "none";
  }

  toggle(): void {
    if (this._visible) this.hide();
    else this.show();
  }

  // ─── Cleanup ─────────────────────────────────────────────

  dispose(): void {
    this.element.remove();
  }
}
