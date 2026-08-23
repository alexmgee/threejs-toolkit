import * as THREE from "three";
import { applyBillboard } from "../ui/billboard";
import { measureCharWidthPx } from "../ui/TextLayout";
import {
  applyCapabilities,
  contentText,
  domLaneCaps,
  type BlockRenderer,
  type TextHost,
} from "./BlockRenderer";
import { faceDescriptors } from "./FontRegistry";
import { applyLayer, clearLayer, generatedRulesFor } from "./StyleToCss";
import type {
  CapabilitySet,
  ResolveContext,
  Resolved,
  TextBlock,
  TypeStyleLayer,
  WorldPlacement,
} from "./TextModel";

const RASTER_INTERVAL_MS = 100;
const warnedFaceFamilies = new Set<string>();

function faceWarningFor(family: string, known: boolean): string {
  return known
    ? `plane rasterizer: face binary for "${family}" could not be fetched — BYO URLs must allow CORS`
    : `plane rasterizer: no registered font family in "${family}" — glyphs will use a fallback font`;
}


// Keyed on the buffer object: font bytes never change between rasters, and a
// replaced face (registerFace) arrives as a NEW buffer — natural invalidation.
const base64Cache = new WeakMap<ArrayBuffer, string>();

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const cached = base64Cache.get(buffer);
  if (cached !== undefined) return cached;
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  const encoded = btoa(binary);
  base64Cache.set(buffer, encoded);
  return encoded;
}

function cssString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function contentBoxSize(node: HTMLElement): { width: number; height: number } {
  const rect = node.getBoundingClientRect();
  const style = getComputedStyle(node);
  return {
    width: rect.width
      - parseFloat(style.paddingLeft)
      - parseFloat(style.paddingRight)
      - parseFloat(style.borderLeftWidth)
      - parseFloat(style.borderRightWidth),
    height: rect.height
      - parseFloat(style.paddingTop)
      - parseFloat(style.paddingBottom)
      - parseFloat(style.borderTopWidth)
      - parseFloat(style.borderBottomWidth),
  };
}

export class PlaneLane implements BlockRenderer {
  private block: TextBlock | null = null;
  private host: TextHost | null = null;
  private placement: WorldPlacement | null = null;
  private mirror: HTMLDivElement | null = null;
  private contentNode: HTMLDivElement | null = null;
  private quad: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private texture: THREE.CanvasTexture | null = null;
  private pendingResolved: Resolved | null = null;
  private requestedSignature: string | null = null;
  private rasterTimer: ReturnType<typeof setTimeout> | null = null;
  private rasterVersion = 0;
  private lastRasterAt = 0;
  private contentW = 0;
  private contentH = 0;
  private geometryWorldPerPx = 0;
  private _rasterCount = 0;
  private _faceWarning: string | null = null;

  get surface(): THREE.Object3D | null {
    return this.quad;
  }

  get rasterCount(): number {
    return this._rasterCount;
  }

  get faceWarning(): string | null {
    return this._faceWarning;
  }

  mount(block: TextBlock, resolved: Resolved, host: TextHost): void {
    this.block = block;
    this.host = host;
    this.placement = block.placement as WorldPlacement;

    const mirror = host.layer.ownerDocument.createElement("div");
    Object.assign(mirror.style, {
      position: "absolute",
      width: "1px",
      height: "1px",
      overflow: "hidden",
      clipPath: "inset(50%)",
    });
    const node = host.layer.ownerDocument.createElement("div");
    mirror.appendChild(node);
    host.layer.appendChild(mirror);
    this.mirror = mirror;
    this.contentNode = node;

    const material = new THREE.MeshBasicMaterial({ transparent: true });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(0, 0), material);
    this.quad = quad;
    this.applyTransform(quad, this.placement);
    host.scene?.add(quad);

    this.requestRaster(resolved, true);
  }

  update(resolved: Resolved, _ctx: ResolveContext): void {
    if (!this.block || !this.quad) return;
    const placement = this.block.placement as WorldPlacement;
    this.placement = placement;
    this.applyTransform(this.quad, placement);
    if (this.contentW > 0 && placement.worldPerPx !== this.geometryWorldPerPx) {
      this.setGeometry(this.contentW, this.contentH, placement.worldPerPx);
    }
    this.requestRaster(resolved);
  }

  setBlock(block: TextBlock): void {
    this.block = block;
  }

  tick(): void {
    const camera = this.host?.camera;
    if (camera && this.quad && this.placement) {
      applyBillboard(this.quad, camera, this.placement.billboard ?? "full");
    }
  }

  capabilities(): CapabilitySet {
    return domLaneCaps(this.host ?? undefined);
  }

  dispose(): void {
    this.rasterVersion++;
    if (this.rasterTimer !== null) clearTimeout(this.rasterTimer);
    this.rasterTimer = null;
    this.pendingResolved = null;
    if (this.quad) {
      this.host?.scene?.remove(this.quad);
      this.quad.geometry.dispose();
      this.quad.material.dispose();
    }
    this.texture?.dispose();
    // The last raster's generated rules stay registered until the NEXT raster's
    // opening clearLayer — which never comes after dispose. Clear here or the
    // module-level rule map and shared stylesheet grow per mount/dispose cycle.
    if (this.contentNode) clearLayer(this.contentNode);
    this.mirror?.remove();
    this.texture = null;
    this.quad = null;
    this.contentNode = null;
    this.mirror = null;
    this.block = null;
    this.host = null;
    this.placement = null;
  }

  private requestRaster(resolved: Resolved, immediate = false): void {
    if (!this.block || !this.placement) return;
    const supported = applyCapabilities(resolved, this.capabilities());
    const signature = JSON.stringify({
      text: contentText(this.block),
      layer: supported.layer,
      supersample: this.placement.supersample ?? 1,
    });
    if (signature === this.requestedSignature) return;

    this.requestedSignature = signature;
    this.pendingResolved = resolved;
    this.rasterVersion++;
    if (immediate) {
      if (this.rasterTimer !== null) clearTimeout(this.rasterTimer);
      this.rasterTimer = null;
      this.startPendingRaster();
    } else {
      this.schedulePendingRaster();
    }
  }

  private schedulePendingRaster(): void {
    if (this.rasterTimer !== null || !this.pendingResolved) return;
    const delay = Math.max(0, RASTER_INTERVAL_MS - (Date.now() - this.lastRasterAt));
    this.rasterTimer = setTimeout(() => {
      this.rasterTimer = null;
      this.startPendingRaster();
    }, delay);
  }

  private startPendingRaster(): void {
    const resolved = this.pendingResolved;
    if (!resolved) return;
    this.pendingResolved = null;
    const version = this.rasterVersion;
    this.lastRasterAt = Date.now();
    this._rasterCount++;
    void this.raster(resolved, version).finally(() => this.schedulePendingRaster());
  }

  private async raster(resolved: Resolved, version: number): Promise<void> {
    if (!this.block || !this.host || !this.placement || !this.contentNode || !this.quad) return;
    const supported = applyCapabilities(resolved, this.capabilities());
    const layer = supported.layer;
    const node = this.contentNode;
    clearLayer(node);
    node.style.display = "inline-block";
    node.style.whiteSpace = layer.measurePx === undefined && layer.measureCh === undefined
      ? "nowrap"
      : "";
    node.textContent = contentText(this.block);
    applyLayer(node, layer);
    if (layer.measurePx !== undefined) {
      node.style.width = `${layer.measurePx}px`;
    } else if (layer.measureCh !== undefined) {
      const sizePx = layer.sizePx ?? 16;
      const family = layer.fontFamily ?? "sans-serif";
      node.style.width = `${layer.measureCh * measureCharWidthPx("0", `${sizePx}px ${family}`)}px`;
    }

    const { width: contentW, height: contentH } = contentBoxSize(node);
    const placement = this.placement;
    const scale = (window.devicePixelRatio || 1) * (placement.supersample ?? 1);
    const width = Math.ceil(contentW * scale);
    const height = Math.ceil(contentH * scale);
    const fontFamily = layer.fontFamily ?? "sans-serif";
    const fontRules = await this.fontFaceRules(fontFamily, version);
    if (version !== this.rasterVersion || !this.quad || !this.host) return;

    const rules = [...fontRules, ...generatedRulesFor(node)].join("");
    // The serialized wrapper is a fresh context: the node inherits `lang` from the live document,
    // but that inheritance does NOT survive into the foreignObject. Without it `hyphens: auto`
    // silently stops firing inside the raster while every DOM lane still honours it (measured:
    // DOM 78px -> 234px hyphenated, raster unchanged). Carry the language across explicitly.
    const lang = node.closest("[lang]")?.getAttribute("lang")
      ?? node.ownerDocument.documentElement.lang;
    const langAttr = lang ? ` lang="${lang}"` : "";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${contentW} ${contentH}"><foreignObject width="${contentW}" height="${contentH}"><div xmlns="http://www.w3.org/1999/xhtml"${langAttr}><style>${rules}</style>${node.outerHTML}</div></foreignObject></svg>`;
    const image = new Image();
    let decodeFailed = false;
    await new Promise<void>((resolve) => {
      // onerror must settle too, or a failed SVG decode leaves this raster (and
      // its multi-MB closure) pending forever with the signature never retryable.
      // An explicit flag, not naturalWidth: a VALID zero-width raster (empty
      // content, measurePx 0) also reports naturalWidth 0 on success.
      image.onload = () => resolve();
      image.onerror = () => {
        decodeFailed = true;
        resolve();
      };
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
    if (version !== this.rasterVersion || !this.quad || !this.host) return;
    if (decodeFailed) {
      // Release the signature so a later identical request retries.
      this.requestedSignature = null;
      console.warn(`PlaneLane: SVG raster decode failed for block "${this.block?.id}"`);
      return;
    }

    const canvas = this.host.layer.ownerDocument.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(image, 0, 0, width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;

    this.texture?.dispose();
    this.texture = texture;
    this.quad.material.map = texture;
    this.quad.material.needsUpdate = true;
    this.contentW = contentW;
    this.contentH = contentH;
    const currentPlacement = this.placement;
    if (!currentPlacement) return;
    this.setGeometry(contentW, contentH, currentPlacement.worldPerPx);
    this.applyTransform(this.quad, currentPlacement);
  }

  private async fontFaceRules(family: string, version: number): Promise<string[]> {
    const known = this.host?.registry.meta(family) !== undefined;
    const resolved = await this.host!.registry.getFaceBuffers(family).catch(() => null);
    const meta = resolved?.meta;
    const faces = resolved?.faces ?? [];

    const missingFace = faces.length === 0 || (meta?.italicFile !== undefined && faces.length < 2);
    if (version === this.rasterVersion) {
      const warning = faceWarningFor(meta?.family ?? family, known);
      this._faceWarning = missingFace ? warning : null;
      if (missingFace && !warnedFaceFamilies.has(family)) {
        warnedFaceFamilies.add(family);
        console.warn(warning);
      }
    }

    if (!meta) return [];
    return faces.map(({ style, buffer }) => {
      // Same descriptor derivation the live FontFace registration uses — the
      // raster's embedded face must match the DOM face or plane text measures
      // against one configuration and renders in another.
      const face = faceDescriptors(meta, style);
      const descriptors = [
        `font-style:${style};`,
        face.weight ? `font-weight:${face.weight};` : "",
        face.stretch ? `font-stretch:${face.stretch};` : "",
      ].join("");
      // Named by the WINNING candidate's family: `family` may be a whole stack,
      // and a broken first entry may have fallen through to a later candidate —
      // the rule must carry the name the content CSS will actually match.
      return `@font-face{font-family:"${cssString(meta.family)}";src:url(data:font/woff2;base64,${arrayBufferToBase64(buffer)}) format("woff2");${descriptors}}`;
    });
  }

  private setGeometry(contentW: number, contentH: number, worldPerPx: number): void {
    if (!this.quad) return;
    const geometry = new THREE.PlaneGeometry(contentW * worldPerPx, contentH * worldPerPx);
    this.quad.geometry.dispose();
    this.quad.geometry = geometry;
    this.geometryWorldPerPx = worldPerPx;
  }

  private applyTransform(object: THREE.Object3D, placement: WorldPlacement): void {
    object.position.set(...placement.position);
    object.rotation.set(0, 0, 0, "XYZ");
    if (placement.billboard !== "none") return;
    const rotation = placement.rotationDeg;
    object.rotation.set(
      THREE.MathUtils.degToRad(rotation?.[0] ?? 0),
      THREE.MathUtils.degToRad(rotation?.[1] ?? 0),
      THREE.MathUtils.degToRad(rotation?.[2] ?? 0),
      "XYZ",
    );
  }
}
