/**
 * D19 STUB — API-preserving typed stub of sparkjs-toolkit's SplatTextMesh.
 *
 * The real class renders text as gaussian splats via Spark's textSplats and
 * SplatMesh — a Spark value-importer, rebuilt in Phase 4 (doc 03 section E)
 * on the vendored fork's mesh plus a new textSplatGeometry.ts. This stub
 * exists so `text/SplatLane.ts` compiles UNCHANGED (ticket 05 AC); its
 * constructor throws, so the splat-lane path fails loudly, never silently.
 * Tracked by doc 06 D19: Phase 4 DELETES this file and replaces it.
 *
 * The config interface and public member signatures below mirror
 * sparkjs-toolkit src/ui/SplatTextMesh.ts at pin fd67153 exactly.
 */
import type * as THREE from "three";

export interface SplatTextMeshConfig {
  text: string;
  /** Font FAMILY LIST ONLY — no weight/style prefix (stripped with a warning). */
  font?: string;
  /** Raster px (default: 32; ≥24 recommended if emoji present) */
  fontSize?: number;
  /** Wrap width in raster px. Infinity (default) = no wrap, "\n" respected. */
  maxWidthPx?: number;
  /** Raster line pitch in px (default: 1.2 × fontSize) */
  lineHeightPx?: number;
  /** World units per text line. Drives objectScale = lineHeightWorld / lineHeightPx. Default 0.15. */
  lineHeightWorld?: number;
  /** Recolor tint — changeable later via setColor with no rebuild (default: white) */
  color?: THREE.Color;
  /** Gsplat radius in raster-pixel units (default: 0.8) */
  dotRadius?: number;
  textAlign?: "left" | "center" | "right";
  billboard?: "full" | "y" | "none";
  /** World position of the text block CENTER (textSplats origin convention) */
  position?: [number, number, number];
  /** console.warn when the built mesh exceeds this splat count (default: 20000) */
  maxSplats?: number;
  /** Mount point for the visually-hidden a11y span (default: document.body) */
  ariaContainer?: HTMLElement;
}

const STUB_ERROR =
  "SplatTextMesh is a D19 stub: splat text is rebuilt in Phase 4 (doc 03 section E). " +
  "The splat text lane is unavailable in Phases 1-3.";

export class SplatTextMesh {
  /** Group added to the scene; never populated by the stub. */
  readonly object!: THREE.Object3D; // never assigned — the constructor throws first

  constructor(config: SplatTextMeshConfig) {
    void config;
    throw new Error(STUB_ERROR);
  }

  ready(): Promise<void> {
    throw new Error(STUB_ERROR);
  }

  get splatCount(): number {
    throw new Error(STUB_ERROR);
  }

  get buildCount(): number {
    throw new Error(STUB_ERROR);
  }

  setText(text: string): void {
    void text;
    throw new Error(STUB_ERROR);
  }

  setMaxWidth(px: number): void {
    void px;
    throw new Error(STUB_ERROR);
  }

  setColor(color: THREE.Color): void {
    void color;
    throw new Error(STUB_ERROR);
  }

  setOpacity(opacity: number): void {
    void opacity;
    throw new Error(STUB_ERROR);
  }

  update(camera: THREE.Camera): void {
    void camera;
    throw new Error(STUB_ERROR);
  }

  dispose(): void {
    throw new Error(STUB_ERROR);
  }
}
