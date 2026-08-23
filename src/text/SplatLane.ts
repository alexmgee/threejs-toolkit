import * as THREE from "three";
import { SplatTextMesh } from "../ui/SplatTextMesh";
import {
  applyCapabilities,
  contentText,
  type BlockRenderer,
  type TextHost,
} from "./BlockRenderer";
import type {
  CapabilitySet,
  ResolveContext,
  Resolved,
  TextBlock,
  TypeStyleLayer,
  WorldPlacement,
} from "./TextModel";

const TYPOGRAPHY_REASON =
  "gaussian text renders glyph dots — use a plane block for full typography";
const WEIGHT_STYLE_REASON =
  "Pretext's gaussian text has no weight/style slot — choose a weight-specific font family instead";
const MEASURE_CH_REASON =
  "the character-measure token is a screen reading-measure — set a world-unit wrap width instead";

interface MappedSplat {
  text: string;
  fontFamily: string;
  fontSize: number;
  lineHeightPx: number;
  lineHeightWorld: number;
  maxWidthPx: number | undefined;
  textAlign: "left" | "center" | "right" | undefined;
  color: string;
  dotRadius: number | undefined;
  billboard: "full" | "y" | "none" | undefined;
}


const justifyWarned = new Set<string>();

function textAlign(layer: TypeStyleLayer, blockId: string): MappedSplat["textAlign"] {
  if (layer.align === "justify") {
    // Gaussian text has no justification engine. Justified copy is left-set with
    // stretched spacing, so left is the honest degradation — never center.
    if (!justifyWarned.has(blockId)) {
      justifyWarned.add(blockId);
      console.warn(
        `SplatLane: block "${blockId}" asks for align "justify" — gaussian text cannot justify; rendering left-aligned.`,
      );
    }
    return "left";
  }
  return layer.align === "left" || layer.align === "center" || layer.align === "right"
    ? layer.align
    : undefined;
}

function mapSplat(
  block: TextBlock,
  layer: TypeStyleLayer,
  placement: WorldPlacement,
): MappedSplat {
  const ss = placement.supersample ?? 1;
  const sizePx = layer.sizePx ?? 32;
  const lineHeight = layer.lineHeight ?? 1.2;
  const fontFamily = layer.fontFamily ?? "sans-serif";
  const basePitchPx = layer.lineHeightPx ?? (lineHeight * sizePx);
  // Wrap comes ONLY from an explicit measurePx (authored in world units and divided by
  // worldPerPx). measureCh is capability-excluded here — see capabilities() — so it can never
  // reach this mapping; absent measurePx means no wrap, matching the legacy splat path.
  const measurePx = layer.measurePx;

  return {
    text: contentText(block),
    fontFamily,
    fontSize: Math.round(sizePx * ss),
    lineHeightPx: basePitchPx * ss,
    lineHeightWorld: basePitchPx * placement.worldPerPx,
    maxWidthPx: measurePx != null ? measurePx * ss : undefined,
    textAlign: textAlign(layer, block.id),
    color: layer.color ?? "#ffffff",
    dotRadius: placement.dotRadius,
    billboard: placement.billboard,
  };
}

/** Every geometry-affecting metric EXCEPT `text` (and `color`, which recolors
 *  in place). When these all match, a text change can go through the mesh's own
 *  `setText()` instead of a full teardown+rebuild (DD3). */
function metricsEqualIgnoringText(a: MappedSplat, b: MappedSplat): boolean {
  return a.fontFamily === b.fontFamily
    && a.fontSize === b.fontSize
    && a.lineHeightPx === b.lineHeightPx
    && a.lineHeightWorld === b.lineHeightWorld
    && a.maxWidthPx === b.maxWidthPx
    && a.textAlign === b.textAlign
    && a.dotRadius === b.dotRadius
    && a.billboard === b.billboard;
}

function sameMetrics(a: MappedSplat, b: MappedSplat): boolean {
  return a.text === b.text && metricsEqualIgnoringText(a, b);
}

export class SplatLane implements BlockRenderer {
  private block: TextBlock | null = null;
  private host: TextHost | null = null;
  private placement: WorldPlacement | null = null;
  private mesh: SplatTextMesh | null = null;
  private mapped: MappedSplat | null = null;

  get surface(): THREE.Object3D | null {
    return this.mesh?.object ?? null;
  }

  mount(block: TextBlock, resolved: Resolved, host: TextHost): void {
    const placement = block.placement as WorldPlacement;
    const supported = applyCapabilities(resolved, this.capabilities());
    const mapped = mapSplat(block, supported.layer, placement);

    this.block = block;
    this.host = host;
    this.placement = placement;
    this.mapped = mapped;
    this.mesh = this.createMesh(mapped, placement);
  }

  update(resolved: Resolved, _ctx: ResolveContext): void {
    if (!this.block || !this.placement || !this.mesh || !this.mapped) return;

    const placement = this.block.placement as WorldPlacement;
    const supported = applyCapabilities(resolved, this.capabilities());
    const mapped = mapSplat(this.block, supported.layer, placement);
    if (!sameMetrics(this.mapped, mapped)) {
      if (metricsEqualIgnoringText(this.mapped, mapped)) {
        // Content-only change (DD3): reuse the mesh's own text-update path
        // instead of tearing down + recreating every glyph splat — the
        // SplatTextMesh INSTANCE (and its scene-added object) survives; only the
        // inner splat mesh rebuilds. A simultaneous color change recolors in
        // place (also no teardown), matching the rebuild path's color handling.
        this.mesh.setText(mapped.text);
        if (mapped.color !== this.mapped.color) this.mesh.setColor(new THREE.Color(mapped.color));
      } else {
        this.removeMesh();
        this.mesh = this.createMesh(mapped, placement);
      }
    } else if (mapped.color !== this.mapped.color) {
      this.mesh.setColor(new THREE.Color(mapped.color));
    }

    this.placement = placement;
    this.mapped = mapped;
    this.applyTransform(this.mesh.object, placement);
  }

  capabilities(): CapabilitySet {
    return {
      excluded: {
        measureCh: MEASURE_CH_REASON,
        weight: WEIGHT_STYLE_REASON,
        width: TYPOGRAPHY_REASON,
        slant: TYPOGRAPHY_REASON,
        italic: WEIGHT_STYLE_REASON,
        opticalSize: TYPOGRAPHY_REASON,
        axes: TYPOGRAPHY_REASON,
        trackingEm: TYPOGRAPHY_REASON,
        wordSpacingEm: TYPOGRAPHY_REASON,
        transform: TYPOGRAPHY_REASON,
        underline: TYPOGRAPHY_REASON,
        strikethrough: TYPOGRAPHY_REASON,
        underlineOffsetPx: TYPOGRAPHY_REASON,
        decorationThicknessPx: TYPOGRAPHY_REASON,
        decorationColor: TYPOGRAPHY_REASON,
        decorationStyle: TYPOGRAPHY_REASON,
        baselineShiftPx: TYPOGRAPHY_REASON,
        shadow: TYPOGRAPHY_REASON,
        lastLineAlign: TYPOGRAPHY_REASON,
        spaceBeforePx: TYPOGRAPHY_REASON,
        spaceAfterPx: TYPOGRAPHY_REASON,
        indentFirstLinePx: TYPOGRAPHY_REASON,
        indentLeftPx: TYPOGRAPHY_REASON,
        indentRightPx: TYPOGRAPHY_REASON,
        textWrap: TYPOGRAPHY_REASON,
        lineBreak: TYPOGRAPHY_REASON,
        hyphens: TYPOGRAPHY_REASON,
        hangingPunctuation: TYPOGRAPHY_REASON,
        orphans: TYPOGRAPHY_REASON,
        widows: TYPOGRAPHY_REASON,
        initialLetter: TYPOGRAPHY_REASON,
        ligatures: TYPOGRAPHY_REASON,
        numeralStyle: TYPOGRAPHY_REASON,
        numeralSpacing: TYPOGRAPHY_REASON,
        fractions: TYPOGRAPHY_REASON,
        slashedZero: TYPOGRAPHY_REASON,
        ordinals: TYPOGRAPHY_REASON,
        caps: TYPOGRAPHY_REASON,
        stylisticSets: TYPOGRAPHY_REASON,
        characterVariants: TYPOGRAPHY_REASON,
        swash: TYPOGRAPHY_REASON,
        contextualAlternates: TYPOGRAPHY_REASON,
        kerning: TYPOGRAPHY_REASON,
        positionVariant: TYPOGRAPHY_REASON,
        baselineGridPx: TYPOGRAPHY_REASON,
        leadingTrim: TYPOGRAPHY_REASON,
        columnCount: TYPOGRAPHY_REASON,
        columnWidthPx: TYPOGRAPHY_REASON,
        columnGapPx: TYPOGRAPHY_REASON,
        columnRule: TYPOGRAPHY_REASON,
        columnSpanFirst: TYPOGRAPHY_REASON,
        frameVerticalAlign: TYPOGRAPHY_REASON,
        autoSize: TYPOGRAPHY_REASON,
        wrapMarginPx: TYPOGRAPHY_REASON,
        wrapShape: TYPOGRAPHY_REASON,
        textJustify: TYPOGRAPHY_REASON,
        hyphenateLimitChars: TYPOGRAPHY_REASON,
        breakInside: TYPOGRAPHY_REASON,
        breakBefore: TYPOGRAPHY_REASON,
        firstLine: TYPOGRAPHY_REASON,
      },
    };
  }

  dispose(): void {
    this.removeMesh();
    this.block = null;
    this.host = null;
    this.placement = null;
    this.mapped = null;
  }

  tick(): void {
    const camera = this.host?.camera;
    if (camera && this.mesh) this.mesh.update(camera);
  }

  setOpacity(opacity: number): void {
    if (!this.mesh) return;
    this.mesh.setOpacity(opacity);
    this.mesh.object.visible = opacity > 0;
  }

  setBlock(block: TextBlock): void {
    this.block = block;
  }

  private createMesh(mapped: MappedSplat, placement: WorldPlacement): SplatTextMesh {
    const mesh = new SplatTextMesh({
      text: mapped.text,
      position: placement.position,
      font: mapped.fontFamily,
      fontSize: mapped.fontSize,
      maxWidthPx: mapped.maxWidthPx,
      lineHeightPx: mapped.lineHeightPx,
      lineHeightWorld: mapped.lineHeightWorld,
      color: new THREE.Color(mapped.color),
      dotRadius: mapped.dotRadius,
      textAlign: mapped.textAlign,
      billboard: mapped.billboard,
      ariaContainer: this.host?.layer,
    });
    this.applyTransform(mesh.object, placement);
    this.host?.scene?.add(mesh.object);
    return mesh;
  }

  private applyTransform(object: THREE.Object3D, placement: WorldPlacement): void {
    object.position.set(...placement.position);
    if (placement.billboard !== "none") return;
    const rotation = placement.rotationDeg;
    object.rotation.set(
      THREE.MathUtils.degToRad(rotation?.[0] ?? 0),
      THREE.MathUtils.degToRad(rotation?.[1] ?? 0),
      THREE.MathUtils.degToRad(rotation?.[2] ?? 0),
      "XYZ",
    );
  }

  private removeMesh(): void {
    if (!this.mesh) return;
    this.host?.scene?.remove(this.mesh.object);
    this.mesh.dispose();
    this.mesh = null;
  }
}
