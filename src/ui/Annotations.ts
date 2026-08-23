/**
 * Annotations — World-anchored DOM markers over a splat scene
 *
 * Each annotation is a world-space point with copy attached. A pooled
 * DOM button (dot) tracks the anchor's screen projection every frame;
 * clicking it fires onSelect — panel display is consumer wiring (the
 * portfolio-lab template routes copy into its CaptionOverlay).
 *
 * Occlusion: when a scene is provided, markers fade when something
 * sits between the camera and the anchor. Checks use raycasting (works
 * on paged .rad scenes — Spark's WASM raycast decodes GPU-side data on
 * demand), but raycasts are too costly for every-marker-every-frame:
 * checks run round-robin, one marker per occlusionEveryNFrames frames.
 *
 * Markers are real <button>s: keyboard-focusable, labelled from the
 * annotation title, clickable without any pointer gymnastics.
 */

import * as THREE from "three";

// ─── Types ────────────────────────────────────────────────

export interface AnnotationItem {
  id: string;
  /** World-space anchor point */
  anchor: [number, number, number];
  copy: { title?: string; body: string };
}

export interface AnnotationsConfig {
  /** Same container the scene canvas lives in (forced position:relative if static) */
  container: HTMLElement;
  camera: THREE.Camera;
  /** Scene for occlusion raycasts. Omit to disable occlusion fading. */
  scene?: THREE.Scene;
  onSelect?: (item: AnnotationItem) => void;
  /** One occlusion raycast is issued every N frames, round-robin across markers. 0 disables. (default: 8) */
  occlusionEveryNFrames?: number;
  /** Marker diameter in px (default: 16) */
  markerSize?: number;
  /** Stacking order — default 850, below CaptionOverlay's 900 */
  zIndex?: number;
  /** Authoring aid: render persistent annotation ids next to markers. */
  showIds?: boolean;
  /** Declutter overlapping annotation id pills (default: true). */
  declutterPills?: boolean;
}

interface Marker {
  item: AnnotationItem;
  el: HTMLButtonElement;
  idEl?: HTMLSpanElement;
  anchor: THREE.Vector3;
  occluded: boolean;
  hovered: boolean;
  focused: boolean;
  pillWidth: number;
  pillHeight: number;
}

interface PillRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

// ─── Annotations ──────────────────────────────────────────

const _projected = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class Annotations {
  private container: HTMLElement;
  private camera: THREE.Camera;
  private scene: THREE.Scene | null;
  private onSelect: ((item: AnnotationItem) => void) | null;
  private occlusionEveryNFrames: number;
  private markerSize: number;
  private zIndex: number;
  private showIds: boolean;
  private declutterPills: boolean;

  private markers: Marker[] = [];
  private raycaster = new THREE.Raycaster();
  private frame = 0;
  private occlusionCursor = 0;
  private resizeObserver: ResizeObserver;
  private width = 0;
  private height = 0;
  private disposed = false;

  constructor(config: AnnotationsConfig) {
    this.container = config.container;
    this.camera = config.camera;
    this.scene = config.scene ?? null;
    this.onSelect = config.onSelect ?? null;
    this.occlusionEveryNFrames = config.occlusionEveryNFrames ?? 8;
    this.markerSize = config.markerSize ?? 16;
    this.zIndex = config.zIndex ?? 850;
    this.showIds = config.showIds ?? false;
    this.declutterPills = config.declutterPills ?? true;

    if (getComputedStyle(this.container).position === "static") {
      this.container.style.position = "relative";
    }
    this.width = this.container.clientWidth;
    this.height = this.container.clientHeight;
    this.resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1]?.contentRect;
      if (rect) {
        this.width = rect.width;
        this.height = rect.height;
      }
      this.measurePills();
    });
    this.resizeObserver.observe(this.container);
  }

  // ─── Items ────────────────────────────────────────────────

  /**
   * Reconcile the marker set against `items`, KEYED BY ID — an id present in
   * both keeps its existing element.
   *
   * ⚠ Not a clear-and-rebuild. Markers are real focusable <button>s, and
   * annotation presence (D31) re-runs this on engagement changes and stop
   * arrivals, so recreating an unchanged marker would blur whatever the
   * keyboard visitor had focused, mid-tour, for a change that had nothing to do
   * with their marker.
   *
   * A surviving element is never MOVED either — relocating a node within its own
   * parent drops focus just as removal does. Authored order is still honoured,
   * because a NEW marker is inserted at its authored slot rather than appended:
   * only the brand-new node travels, so tab order matches the annotation list
   * without ever putting a focused marker at risk.
   */
  setItems(items: AnnotationItem[]): void {
    const incoming = new Set(items.map((item) => item.id));
    for (let index = this.markers.length - 1; index >= 0; index--) {
      if (!incoming.has(this.markers[index].item.id)) {
        this.markers[index].el.remove();
        this.markers[index].idEl?.remove();
        this.markers.splice(index, 1);
      }
    }
    const surviving = new Map(this.markers.map((marker) => [marker.item.id, marker]));
    // Rebuilt in item order: `markers` drives the occlusion round-robin and the
    // pill declutter, neither of which should depend on arrival history.
    this.markers = items.map((item, index) => {
      const existing = surviving.get(item.id);
      if (existing !== undefined) {
        this.refresh(existing, item);
        return existing;
      }
      const marker = this.create(item);
      // create() appended; slide it back to its authored slot, ahead of the next
      // annotation that already has an element. Survivors keep their relative
      // order, so inserting each newcomer before its first surviving successor
      // reproduces the authored order exactly — and moves nothing but the node
      // just created, which nobody can be focused on yet.
      for (let later = index + 1; later < items.length; later++) {
        const successor = surviving.get(items[later].id);
        if (successor === undefined) continue;
        this.container.insertBefore(marker.el, successor.el);
        if (marker.idEl) this.container.insertBefore(marker.idEl, successor.el);
        break;
      }
      return marker;
    });
    this.occlusionCursor = 0;
  }

  add(item: AnnotationItem): void {
    this.markers.push(this.create(item));
  }

  /** Build one marker's DOM and state. Does NOT enrol it in `markers` — that is
   *  the caller's job, because `setItems` rebuilds that list in item order. */
  private create(item: AnnotationItem): Marker {
    const el = document.createElement("button");
    el.type = "button";
    // visible = live (D31/D30): every visible marker is an activatable control in
    // every engagement state, so it holds a real tab stop unconditionally. Native
    // <button> tab semantics also drop it from the tab order for free while it is
    // display:none (behind the camera or offscreen). There is no engagement-gated
    // tabbability toggle any more — inertness is authored by hiding, never by a
    // dead visible marker.
    el.tabIndex = 0;
    Object.assign(el.style, {
      position: "absolute",
      left: "0",
      top: "0",
      width: `${this.markerSize}px`,
      height: `${this.markerSize}px`,
      borderRadius: "50%",
      border: "2px solid rgba(255, 255, 255, 0.9)",
      background: "rgba(74, 222, 128, 0.55)",
      boxShadow: "0 0 8px rgba(0, 0, 0, 0.5)",
      padding: "0",
      cursor: "pointer",
      zIndex: String(this.zIndex),
      display: "none",
      transition: "opacity 200ms ease",
    });
    // Reads `marker.item`, NOT the captured `item`: a surviving element is
    // re-pointed at an edited item by `refresh`, and a handler closed over the
    // original would keep reporting the copy the author already changed.
    el.addEventListener("click", () => this.onSelect?.(marker.item));
    this.container.appendChild(el);
    let idEl: HTMLSpanElement | undefined;
    if (this.showIds) {
      idEl = document.createElement("span");
      Object.assign(idEl.style, {
        position: "absolute",
        left: "0",
        top: "0",
        padding: "2px 5px",
        borderRadius: "999px",
        background: "rgba(18, 18, 23, 0.78)",
        color: "rgba(255, 255, 255, 0.82)",
        fontSize: "11px",
        lineHeight: "13px",
        fontFamily: "'SF Mono', 'Fira Code', monospace",
        pointerEvents: "none",
        zIndex: String(this.zIndex + 1),
        display: "none",
        transition: "opacity 200ms ease",
        whiteSpace: "nowrap",
      });
      this.container.appendChild(idEl);
    }
    const marker: Marker = {
      item,
      el,
      idEl,
      anchor: new THREE.Vector3(),
      occluded: false,
      hovered: false,
      focused: false,
      pillWidth: 0,
      pillHeight: 0,
    };
    el.addEventListener("pointerenter", () => { marker.hovered = true; });
    el.addEventListener("pointerleave", () => { marker.hovered = false; });
    el.addEventListener("focus", () => { marker.focused = true; });
    el.addEventListener("blur", () => { marker.focused = false; });
    // Everything item-derived comes from `refresh`, never from a second copy of
    // the same writes — see its docstring.
    this.refresh(marker, item);
    return marker;
  }

  /**
   * Write everything an element renders FROM ITS ITEM. The single place those
   * writes live: `create` calls it too, so a new marker and a reused one can
   * never render differently.
   *
   * ⚠ Any future item-derived property belongs HERE, not in `create`. A write
   * that exists only in `create` works on a fresh marker and silently does
   * nothing on a reused one — a bug that surfaces only after a presence toggle
   * or an author edit, which is the hardest place to notice it.
   */
  private refresh(marker: Marker, item: AnnotationItem): void {
    marker.item = item;
    marker.anchor.set(...item.anchor);
    marker.el.setAttribute("aria-label", item.copy.title ?? item.copy.body.slice(0, 40));
    if (marker.idEl && marker.idEl.textContent !== item.id) {
      marker.idEl.textContent = item.id;
      this.measurePill(marker);
    }
  }

  remove(id: string): void {
    const index = this.markers.findIndex((m) => m.item.id === id);
    if (index >= 0) {
      this.markers[index].el.remove();
      this.markers[index].idEl?.remove();
      this.markers.splice(index, 1);
    }
  }

  clear(): void {
    for (const marker of this.markers) {
      marker.el.remove();
      marker.idEl?.remove();
    }
    this.markers = [];
    this.occlusionCursor = 0;
  }

  get count(): number {
    return this.markers.length;
  }

  // ─── Per-frame update ─────────────────────────────────────

  update(): void {
    if (this.disposed) return;
    this.frame++;

    // Round-robin occlusion: one raycast per N frames
    if (
      this.scene &&
      this.occlusionEveryNFrames > 0 &&
      this.markers.length > 0 &&
      this.frame % this.occlusionEveryNFrames === 0
    ) {
      this.occlusionCursor = (this.occlusionCursor + 1) % this.markers.length;
      this.checkOcclusion(this.markers[this.occlusionCursor]);
    }

    const visiblePills: Array<{
      marker: Marker;
      rect: PillRect;
      distanceSq: number;
    }> = [];
    if (this.showIds && this.declutterPills) {
      this.camera.getWorldPosition(_camPos);
    }

    for (const marker of this.markers) {
      _projected.copy(marker.anchor).project(this.camera);
      const behind = _projected.z > 1 || !Number.isFinite(_projected.z);
      const x = (_projected.x * 0.5 + 0.5) * this.width;
      const y = (-_projected.y * 0.5 + 0.5) * this.height;
      const offscreen = x < 0 || x > this.width || y < 0 || y > this.height;

      if (behind || offscreen) {
        marker.el.style.display = "none";
        if (marker.idEl) marker.idEl.style.display = "none";
        continue;
      }
      marker.el.style.display = "block";
      marker.el.style.transform =
        `translate(${(x - this.markerSize / 2).toFixed(1)}px, ${(y - this.markerSize / 2).toFixed(1)}px)`;
      marker.el.style.opacity = marker.occluded ? "0.25" : "1";
      if (marker.idEl) {
        marker.idEl.style.display = "block";
        const pillX = x + this.markerSize / 2 + 5;
        const pillY = y - this.markerSize / 2 - 2;
        marker.idEl.style.transform =
          `translate(${pillX.toFixed(1)}px, ${pillY.toFixed(1)}px)`;
        marker.idEl.style.opacity = marker.occluded ? "0.25" : "1";
        if (this.declutterPills) {
          visiblePills.push({
            marker,
            rect: {
              left: pillX,
              top: pillY,
              right: pillX + marker.pillWidth,
              bottom: pillY + marker.pillHeight,
              width: marker.pillWidth,
              height: marker.pillHeight,
            },
            distanceSq: marker.anchor.distanceToSquared(_camPos),
          });
        }
      }
    }

    if (this.declutterPills) {
      visiblePills.sort((a, b) => a.distanceSq - b.distanceSq);
      const accepted: PillRect[] = [];
      for (const pill of visiblePills) {
        const exempt = pill.marker.hovered || pill.marker.focused;
        const suppressed = !exempt && accepted.some((rect) => {
          const intersectionWidth = Math.max(
            0,
            Math.min(pill.rect.right, rect.right) - Math.max(pill.rect.left, rect.left),
          );
          const intersectionHeight = Math.max(
            0,
            Math.min(pill.rect.bottom, rect.bottom) - Math.max(pill.rect.top, rect.top),
          );
          const intersectionArea = intersectionWidth * intersectionHeight;
          const minArea = Math.min(
            pill.rect.width * pill.rect.height,
            rect.width * rect.height,
          );
          const centerX = (pill.rect.left + pill.rect.right) / 2;
          const centerY = (pill.rect.top + pill.rect.bottom) / 2;
          const centerInside = centerX >= rect.left && centerX <= rect.right
            && centerY >= rect.top && centerY <= rect.bottom;
          return intersectionArea / minArea > 0.55 || centerInside;
        });
        if (suppressed) {
          pill.marker.idEl!.style.display = "none";
        } else {
          pill.marker.idEl!.style.display = "block";
          accepted.push(pill.rect);
        }
      }
    }
  }

  private measurePills(): void {
    for (const marker of this.markers) this.measurePill(marker);
  }

  private measurePill(marker: Marker): void {
    if (!marker.idEl) return;
    const visibility = marker.idEl.style.visibility;
    const display = marker.idEl.style.display;
    marker.idEl.style.visibility = "hidden";
    marker.idEl.style.display = "block";
    marker.pillWidth = marker.idEl.offsetWidth;
    marker.pillHeight = marker.idEl.offsetHeight;
    marker.idEl.style.visibility = visibility;
    marker.idEl.style.display = display;
  }

  private checkOcclusion(marker: Marker): void {
    if (!this.scene) return;
    this.camera.getWorldPosition(_camPos);
    _dir.copy(marker.anchor).sub(_camPos);
    const distance = _dir.length();
    if (distance <= 1e-6) {
      marker.occluded = false;
      return;
    }
    _dir.divideScalar(distance);
    this.raycaster.set(_camPos, _dir);
    this.raycaster.near = 0;
    // Only hits meaningfully closer than the anchor count as occluders
    this.raycaster.far = distance - Math.max(0.05, distance * 0.02);
    const hits = this.raycaster.intersectObjects(this.scene.children, true);
    marker.occluded = hits.length > 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    this.resizeObserver.disconnect();
  }
}
