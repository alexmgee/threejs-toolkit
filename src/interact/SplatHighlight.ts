/**
 * D27 STUB — API-preserving INERT stub of sparkjs-toolkit's SplatHighlight
 * (doc 06 D27; Phase 2 ticket 09, owner ruling Stop 2, 2026-09-17).
 *
 * The real class is the marker hover glow: a Spark SplatEdit sphere near the
 * pointer (fd67153:src/interact/SplatHighlight.ts value-imports SplatEdit,
 * SplatEditRgbaBlendMode, SplatEditSdf, SplatEditSdfType) — rebuilt in Phase 3
 * on the edit layer (doc 03 §C, doc 04 Phase 3). SiteRuntime constructs it
 * UNCONDITIONALLY on every boot, so unlike D19's SplatTextMesh stub this one
 * does NOT throw: it does nothing. Hover glow is ABSENT until Phase 3 — a
 * declared divergence, announced by ONE named note in author mode, printed by
 * SiteRuntime (the pin API carries no author flag). SAME OBLIGATION AS D19:
 * Phase 3 DELETES this file and replaces it; never left beside real code.
 *
 * The two interfaces below are byte-identical to the pin (its lines 20-43);
 * the class keeps the pin's public members and signatures exactly.
 */

import type * as THREE from "three";

export interface HighlightItem {
  id: string;
  /** World-space anchor point */
  anchor: [number, number, number];
  /** Glow sphere world radius */
  radius?: number;
  /** Glow hex color */
  highlight?: string;
}

export interface SplatHighlightConfig {
  scene: THREE.Scene;
  camera: THREE.Camera;
  canvas: HTMLCanvasElement;
  /** Activation distance to projected anchor in px (default: 48) */
  thresholdPx?: number;
  /** Default glow sphere world radius (default: 0.6) */
  defaultRadius?: number;
  /** Default glow hex color (default: "#4ade80") */
  defaultColor?: string;
  /** 0..1 multiplier for ADD_RGBA color intensity (default: 0.6) */
  intensity?: number;
  onActiveChange?: (id: string | null) => void;
}

export class SplatHighlight {
  constructor(config: SplatHighlightConfig) {
    void config;
  }

  setItems(items: HighlightItem[]): void {
    void items;
  }

  update(): void {}

  setEnabled(on: boolean): void {
    void on;
  }

  /** Never active: nothing glows until Phase 3. */
  get activeId(): string | null {
    return null;
  }

  dispose(): void {}
}
