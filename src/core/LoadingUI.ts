/**
 * LoadingUI — Minimal loading overlay for splat streaming
 *
 * Shows a progress bar while splats are loading/streaming.
 * Auto-hides when loading completes. Designed to be
 * non-intrusive and easily replaceable by site-specific UI.
 */

export interface LoadingUIConfig {
  /** Container to mount the loading overlay into */
  container: HTMLElement;
  /** Text to show during loading (default: "Loading...") */
  text?: string;
}

export class LoadingUI {
  private overlay: HTMLDivElement;
  private bar: HTMLDivElement;
  private label: HTMLDivElement;
  private progress = 0;
  private visible = true;

  constructor(config: LoadingUIConfig) {
    const { container, text = "Loading..." } = config;

    this.overlay = document.createElement("div");
    Object.assign(this.overlay.style, {
      position: "absolute",
      inset: "0",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0, 0, 0, 0.6)",
      color: "#fff",
      fontFamily: "system-ui, sans-serif",
      fontSize: "14px",
      zIndex: "1000",
      transition: "opacity 0.4s ease",
      pointerEvents: "none",
    });

    this.label = document.createElement("div");
    this.label.textContent = text;
    this.label.style.marginBottom = "12px";

    const track = document.createElement("div");
    Object.assign(track.style, {
      width: "200px",
      height: "4px",
      background: "rgba(255, 255, 255, 0.2)",
      borderRadius: "2px",
      overflow: "hidden",
    });

    this.bar = document.createElement("div");
    Object.assign(this.bar.style, {
      width: "0%",
      height: "100%",
      background: "#fff",
      borderRadius: "2px",
      transition: "width 0.15s ease",
    });

    track.appendChild(this.bar);
    this.overlay.appendChild(this.label);
    this.overlay.appendChild(track);

    // Container needs relative positioning for absolute overlay
    if (getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    container.appendChild(this.overlay);
  }

  /** Update progress (0-1) */
  setProgress(value: number): void {
    this.progress = Math.max(0, Math.min(1, value));
    this.bar.style.width = `${(this.progress * 100).toFixed(1)}%`;
    this.label.textContent = `Loading... ${(this.progress * 100).toFixed(0)}%`;
  }

  /** Hide the loading overlay with a fade */
  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.overlay.style.opacity = "0";
    setTimeout(() => this.overlay.remove(), 400);
  }

  /** Show the loading overlay */
  show(): void {
    if (this.visible) return;
    this.visible = true;
    this.overlay.style.opacity = "1";
  }

  /** Remove from DOM immediately */
  dispose(): void {
    this.overlay.remove();
  }
}
