/**
 * FrustumRenderer — Interactive COLMAP camera frustum visualization
 *
 * Renders camera frustums as wireframe pyramids using batched LineSegments
 * (single draw call). Supports click-to-select with photo overlay popup.
 *
 * Frustum shape is derived from actual camera intrinsics (fx, fy, cx, cy)
 * so each camera's frustum accurately reflects its field of view.
 */

import * as THREE from "three";
import {
  type ColmapData,
  type ColmapImage,
  type ColmapCamera,
  colmapPoseToThreeJS,
  colmapPoseRaw,
  getFocalLengths,
  getPrincipalPoint,
} from "./ColmapData";

// ─── Types ──────────────────────────────────────────────────────────

export interface FrustumRendererConfig {
  colmapData: ColmapData;
  /** Base URL prefix for photo loading — appended with image name */
  photoBaseUrl?: string;
  /** Explicit name→URL mapping (takes priority over photoBaseUrl) */
  photoUrlMap?: Map<string, string>;
  /** Frustum scale override (default: auto-computed from camera spread) */
  frustumScale?: number;
  /** Auto-compute scale from camera bounding diagonal (default: true) */
  autoScale?: boolean;
  /** Frustum wireframe color (default: 0x00cccc cyan) */
  frustumColor?: THREE.ColorRepresentation;
  /** Selected frustum highlight color (default: 0xffff00 yellow) */
  selectedColor?: THREE.ColorRepresentation;
  /** Show up-indicator triangle on frustums (default: true) */
  showUpIndicator?: boolean;
  /** Container element for photo overlay popup */
  overlayContainer?: HTMLElement;
  /** Use raw COLMAP world coordinates (no Y/Z flip).
   *  Set to true when the splat is loaded without eulerRotationDeg/quaternion.
   *  (default: true) */
  rawCoordinates?: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────

/** 10 line segments per camera: 4 pyramid edges + 4 base rect + 2 up-indicator */
const LINES_PER_CAMERA = 10;
const VERTS_PER_CAMERA = LINES_PER_CAMERA * 2;

// ─── FrustumRenderer ────────────────────────────────────────────────

export class FrustumRenderer {
  private group = new THREE.Group();
  private frustumLines: THREE.LineSegments | null = null;
  private selectedLines: THREE.LineSegments | null = null;

  private frustumMaterial: THREE.LineBasicMaterial;
  private selectedMaterial: THREE.LineBasicMaterial;

  private data: ColmapData;
  private photoBaseUrl: string;
  private photoUrlMap: Map<string, string>;
  private showUpIndicator: boolean;
  private autoScale: boolean;
  private _frustumScale: number;
  private rawCoordinates: boolean;

  // Click detection: map vertex index ranges to image IDs
  private imageIdToVertexRange = new Map<number, { start: number; count: number }>();
  private vertexRanges: { imageId: number; start: number; end: number }[] = [];
  private orderedImageIds: number[] = [];

  // Selection state
  private _selectedImageId: number | null = null;

  // Raycasting
  private raycaster = new THREE.Raycaster();
  private canvas: HTMLCanvasElement | null = null;
  private clickHandler: ((e: MouseEvent) => void) | null = null;

  // Photo overlay DOM
  private overlayContainer: HTMLElement | null;
  private overlay: HTMLDivElement | null = null;

  constructor(config: FrustumRendererConfig) {
    this.data = config.colmapData;
    this.photoBaseUrl = config.photoBaseUrl ?? "";
    this.photoUrlMap = config.photoUrlMap ?? new Map();
    this.showUpIndicator = config.showUpIndicator ?? true;
    this.autoScale = config.autoScale ?? true;
    this._frustumScale = config.frustumScale ?? 0;
    this.rawCoordinates = config.rawCoordinates ?? true;
    this.overlayContainer = config.overlayContainer ?? null;

    this.frustumMaterial = new THREE.LineBasicMaterial({
      color: config.frustumColor ?? 0x00cccc,
      depthTest: true,
      depthWrite: true,
    });

    this.selectedMaterial = new THREE.LineBasicMaterial({
      color: config.selectedColor ?? 0xffff00,
      depthTest: true,
      depthWrite: true,
      linewidth: 2,
    });

    this.group.name = "FrustumRenderer";
    this.buildGeometry();
  }

  /** The Three.js group to add to your scene */
  get object(): THREE.Group {
    return this.group;
  }

  get cameraCount(): number {
    return this.data.images.size;
  }

  get frustumScale(): number {
    return this._frustumScale;
  }

  get selectedInfo(): { imageId: number; name: string; width: number; height: number } | null {
    if (this._selectedImageId === null) return null;
    const img = this.data.images.get(this._selectedImageId);
    if (!img) return null;
    const cam = this.data.cameras.get(img.cameraId);
    return {
      imageId: this._selectedImageId,
      name: img.name,
      width: cam?.width ?? 0,
      height: cam?.height ?? 0,
    };
  }

  // ─── Data & Rebuild ─────────────────────────────────────────────

  setData(data: ColmapData): void {
    this.data = data;
    this.clearSelection();
    this.buildGeometry();
  }

  setVisibility(visible: boolean): void {
    this.group.visible = visible;
    if (!visible) this.hideOverlay();
  }

  setFrustumScale(scale: number): void {
    this._frustumScale = scale;
    this.autoScale = false;
    this.buildGeometry();
    // Re-highlight if there was a selection
    if (this._selectedImageId !== null) {
      this.highlightCamera(this._selectedImageId);
    }
  }

  // ─── Click Binding ──────────────────────────────────────────────

  /**
   * Bind click-to-select to a canvas + camera pair.
   * Call this after adding the object to a scene with a known camera.
   */
  bindClick(canvas: HTMLCanvasElement, camera: THREE.Camera): void {
    this.unbindClick();
    this.canvas = canvas;

    this.clickHandler = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );

      this.raycaster.setFromCamera(mouse, camera);
      // Scale threshold with frustum size for reliable line picking
      this.raycaster.params.Line = { threshold: this._frustumScale * 0.15 };

      if (!this.frustumLines) return;
      const intersects = this.raycaster.intersectObject(this.frustumLines);

      if (intersects.length > 0) {
        const vertexIndex = intersects[0].index!;
        const imageId = this.vertexIndexToImageId(vertexIndex);
        if (imageId !== null) {
          this.selectCamera(imageId);
          return;
        }
      }

      // Clicked empty space — clear selection
      this.clearSelection();
    };

    canvas.addEventListener("click", this.clickHandler);
  }

  unbindClick(): void {
    if (this.canvas && this.clickHandler) {
      this.canvas.removeEventListener("click", this.clickHandler);
    }
    this.canvas = null;
    this.clickHandler = null;
  }

  // ─── Selection ──────────────────────────────────────────────────

  selectCamera(imageId: number): void {
    this._selectedImageId = imageId;
    this.highlightCamera(imageId);
    this.showPhotoOverlay(imageId);
  }

  clearSelection(): void {
    this._selectedImageId = null;
    if (this.selectedLines) {
      this.selectedLines.visible = false;
    }
    this.hideOverlay();
  }

  // ─── Geometry Construction ──────────────────────────────────────

  private buildGeometry(): void {
    // Clean up previous geometry
    if (this.frustumLines) {
      this.group.remove(this.frustumLines);
      this.frustumLines.geometry.dispose();
      this.frustumLines = null;
    }
    if (this.selectedLines) {
      this.group.remove(this.selectedLines);
      this.selectedLines.geometry.dispose();
      this.selectedLines = null;
    }

    this.imageIdToVertexRange.clear();
    this.vertexRanges = [];
    this.orderedImageIds = [];

    const images = Array.from(this.data.images.values());
    if (images.length === 0) return;

    // Auto-compute scale from camera bounding diagonal
    if (this.autoScale && this._frustumScale <= 0) {
      this._frustumScale = this.computeAutoScale(images);
    }
    if (this._frustumScale <= 0) {
      this._frustumScale = 0.2; // fallback
    }

    const scale = this._frustumScale;
    const positions: number[] = [];

    // Temp vectors for frustum construction
    const origin = new THREE.Vector3();
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    const base = new THREE.Vector3();
    const tl = new THREE.Vector3();
    const tr = new THREE.Vector3();
    const bl = new THREE.Vector3();
    const br = new THREE.Vector3();
    const upTip = new THREE.Vector3();

    const pushLine = (a: THREE.Vector3, b: THREE.Vector3) => {
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    };

    for (const image of images) {
      const camera = this.data.cameras.get(image.cameraId);
      if (!camera) continue;

      const pose = this.rawCoordinates ? colmapPoseRaw(image) : colmapPoseToThreeJS(image);
      origin.copy(pose.position);

      // Derive local axes from quaternion
      forward.set(0, 0, -1).applyQuaternion(pose.quaternion);
      right.set(1, 0, 0).applyQuaternion(pose.quaternion);
      up.set(0, 1, 0).applyQuaternion(pose.quaternion);

      // Compute frustum half-extents from intrinsics
      const { fx, fy } = getFocalLengths(camera);
      const { cx, cy } = getPrincipalPoint(camera);
      const { width, height } = camera;

      // Normalized frustum corners at depth=1, then scale
      const depth = scale;
      const leftEdge = -cx / fx * depth;
      const rightEdge = (width - cx) / fx * depth;
      const topEdge = -cy / fy * depth;
      const bottomEdge = (height - cy) / fy * depth;

      // Base center
      base.copy(origin).addScaledVector(forward, depth);

      // Frustum corners in world space
      tl.copy(base).addScaledVector(right, leftEdge).addScaledVector(up, -topEdge);
      tr.copy(base).addScaledVector(right, rightEdge).addScaledVector(up, -topEdge);
      bl.copy(base).addScaledVector(right, leftEdge).addScaledVector(up, -bottomEdge);
      br.copy(base).addScaledVector(right, rightEdge).addScaledVector(up, -bottomEdge);

      // Track vertex range for this image
      const vertStart = positions.length / 3;

      // 4 pyramid edges
      pushLine(origin, tl);
      pushLine(origin, tr);
      pushLine(origin, bl);
      pushLine(origin, br);

      // 4 base rectangle edges
      pushLine(tl, tr);
      pushLine(tr, br);
      pushLine(br, bl);
      pushLine(bl, tl);

      // 2 up-indicator edges (triangle from TL-TR to tip above)
      if (this.showUpIndicator) {
        const upAmount = Math.abs(topEdge) * 0.4;
        upTip.copy(tl).lerp(tr, 0.5).addScaledVector(up, upAmount);
        pushLine(tl, upTip);
        pushLine(tr, upTip);
      } else {
        // Pad with degenerate lines to keep consistent vertex count
        pushLine(tl, tl);
        pushLine(tl, tl);
      }

      const vertEnd = positions.length / 3;
      this.imageIdToVertexRange.set(image.id, { start: vertStart, count: vertEnd - vertStart });
      this.vertexRanges.push({ imageId: image.id, start: vertStart, end: vertEnd });
      this.orderedImageIds.push(image.id);
    }

    if (positions.length === 0) return;

    // Build main frustum geometry
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    this.frustumLines = new THREE.LineSegments(geometry, this.frustumMaterial);
    this.frustumLines.name = "frustumLines";
    this.group.add(this.frustumLines);

    // Build selection highlight geometry (reuses same buffer size)
    const selGeometry = new THREE.BufferGeometry();
    selGeometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(VERTS_PER_CAMERA * 3), 3));
    this.selectedLines = new THREE.LineSegments(selGeometry, this.selectedMaterial);
    this.selectedLines.name = "selectedLines";
    this.selectedLines.visible = false;
    this.selectedLines.renderOrder = 1;
    this.group.add(this.selectedLines);
  }

  private computeAutoScale(images: ColmapImage[]): number {
    if (images.length < 2) return 0.2;

    // Compute bounding box of all camera positions
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

    for (const image of images) {
      const pose = this.rawCoordinates ? colmapPoseRaw(image) : colmapPoseToThreeJS(image);
      min.min(pose.position);
      max.max(pose.position);
    }

    const diagonal = min.distanceTo(max);
    // 3% of diagonal is a good default — visible but not overwhelming
    return Math.max(diagonal * 0.03, 0.05);
  }

  // ─── Hit Detection ──────────────────────────────────────────────

  private vertexIndexToImageId(vertexIndex: number): number | null {
    for (const range of this.vertexRanges) {
      if (vertexIndex >= range.start && vertexIndex < range.end) {
        return range.imageId;
      }
    }
    return null;
  }

  // ─── Selection Highlight ────────────────────────────────────────

  private highlightCamera(imageId: number): void {
    if (!this.selectedLines || !this.frustumLines) return;

    const range = this.imageIdToVertexRange.get(imageId);
    if (!range) return;

    // Copy selected camera vertices into the highlight geometry
    const srcPositions = this.frustumLines.geometry.getAttribute("position") as THREE.BufferAttribute;
    const dstPositions = this.selectedLines.geometry.getAttribute("position") as THREE.BufferAttribute;

    const vertsNeeded = range.count;
    // Resize if needed
    if (dstPositions.count < vertsNeeded) {
      const newAttr = new THREE.Float32BufferAttribute(new Float32Array(vertsNeeded * 3), 3);
      this.selectedLines.geometry.setAttribute("position", newAttr);
    }

    const dst = this.selectedLines.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < vertsNeeded; i++) {
      dst.setXYZ(
        i,
        srcPositions.getX(range.start + i),
        srcPositions.getY(range.start + i),
        srcPositions.getZ(range.start + i),
      );
    }
    dst.needsUpdate = true;

    // Set draw range to only render the copied vertices
    this.selectedLines.geometry.setDrawRange(0, vertsNeeded);
    this.selectedLines.visible = true;
  }

  // ─── Photo Overlay ──────────────────────────────────────────────

  private resolvePhotoUrl(imageName: string): string | null {
    const mapped = this.photoUrlMap.get(imageName);
    if (mapped) return mapped;
    if (this.photoBaseUrl) return this.photoBaseUrl + imageName;
    return null;
  }

  private showPhotoOverlay(imageId: number): void {
    const container = this.overlayContainer;
    if (!container) return;

    const image = this.data.images.get(imageId);
    if (!image) return;

    const camera = this.data.cameras.get(image.cameraId);
    const photoUrl = this.resolvePhotoUrl(image.name);

    this.hideOverlay();

    this.overlay = document.createElement("div");
    Object.assign(this.overlay.style, {
      position: "absolute",
      bottom: "16px",
      right: "16px",
      background: "rgba(0, 0, 0, 0.75)",
      backdropFilter: "blur(8px)",
      WebkitBackdropFilter: "blur(8px)",
      borderRadius: "8px",
      padding: "12px",
      color: "#e0e0e0",
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: "11px",
      lineHeight: "1.5",
      zIndex: "1001",
      cursor: "pointer",
      maxWidth: "320px",
      userSelect: "none",
      pointerEvents: "auto",
    });

    // Photo label
    let label = `<strong>${image.name}</strong>`;
    if (camera) {
      label += `<br><span style="color:#aaa">${camera.width} × ${camera.height} · ${camera.model}</span>`;
    }

    // Photo thumbnail
    if (photoUrl) {
      this.overlay.innerHTML =
        `<img src="${photoUrl}" style="width:100%;max-height:200px;object-fit:contain;border-radius:4px;margin-bottom:8px;display:block;" />` +
        label;
    } else {
      this.overlay.innerHTML = label;
    }

    // Click to dismiss
    this.overlay.addEventListener("click", () => this.clearSelection());

    container.appendChild(this.overlay);
  }

  private hideOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  // ─── Cleanup ────────────────────────────────────────────────────

  dispose(): void {
    this.unbindClick();
    this.hideOverlay();

    if (this.frustumLines) {
      this.frustumLines.geometry.dispose();
    }
    if (this.selectedLines) {
      this.selectedLines.geometry.dispose();
    }

    this.frustumMaterial.dispose();
    this.selectedMaterial.dispose();
    this.group.clear();
  }
}
