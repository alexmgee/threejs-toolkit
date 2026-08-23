/**
 * MediaLayer — image and muted-inline video planes inside the splat scene graph.
 *
 * Media failures are decorative failures: each failed desired item warns once
 * and leaves the rest of the scene untouched.
 */

import * as THREE from "three";
import type { SiteMedia } from "../site/SiteConfig";
import type { BlockBinding } from "../text/TextModel";

interface MediaSlot {
  root: THREE.Mesh | null;
  loadedKey: string | null;
  token: symbol | null;
  loadingKey: string | null;
  loadingVideo: HTMLVideoElement | null;
  latest: SiteMedia;
  failedKey: string | null;
  playPending: boolean;
  playWarningLogged: boolean;
}

const DEG_TO_RAD = Math.PI / 180;

/**
 * Is this media item visible right now?
 *
 * ⚠ THE STOP LEG must stay in step with `TextSystem.isPresent`. It used to read
 * `activeAnnotationId === null &&` — selecting any marker suppressed every
 * stop-bound item — and ticket 17 turned that from a rule into the author's
 * `settings.blocks.hideStopContent`, OFF by default. Both predicates carry the
 * same switch: change one alone and a marker click hides stop-bound MEDIA while
 * the matching text stays on screen, which reads as a rendering bug and is
 * nearly impossible to trace back to here.
 *
 * ⚠ THE ANNOTATION LEG IS NOT the retired binding-to-a-marker, and ticket 17
 * deliberately leaves it alone. Blocks stopped being bound to markers; MEDIA
 * did not. `SiteMedia.binding` happens to reuse the `BlockBinding` TYPE
 * (SiteConfig.ts), so a type-driven or grep-driven sweep of
 * `binding.annotations` will try to eat this line — and media visibility is one
 * of only two things selection still drives, so eating it removes the very
 * capability the ticket set out to protect.
 *
 * `hideStopContent` is OPTIONAL and defaults to today's behaviour, because this
 * is a public export (`src/index.ts`) and a required fifth parameter would
 * break every consuming site that calls it.
 */
export function isMediaBindingPresent(
  binding: BlockBinding,
  activeStopId: string | null,
  activeAnnotationId: string | null,
  progress: number,
  hideStopContent = false,
): boolean {
  return binding.always === true
    || (!(hideStopContent && activeAnnotationId !== null)
      && activeStopId !== null && binding.stops?.includes(activeStopId) === true)
    || (activeAnnotationId !== null
      && binding.annotations?.includes(activeAnnotationId) === true)
    || (binding.range !== undefined
      && progress >= binding.range.from
      && progress <= binding.range.to);
}

export class MediaLayer {
  private scene: THREE.Scene | null = null;
  private textureLoader = new THREE.TextureLoader();
  private slots = new Map<string, MediaSlot>();
  private visibleIds = new Set<string>();
  private maxAnisotropy = 1;
  private disposed = false;

  attach(target: { scene: THREE.Scene }): void {
    if (this.disposed) return;
    if (this.scene === target.scene) return;

    const previousScene = this.scene;
    if (previousScene) {
      for (const slot of this.slots.values()) {
        if (slot.root) previousScene.remove(slot.root);
      }
    }

    this.scene = target.scene;
    // ADAPTED (ticket 09, the doc 04 sanctioned fix, declared): the optional
    // chain sat on `renderer` only — `renderer.capabilities` does not exist
    // on WebGPURenderer, so attaching with the facade's renderer THREW.
    // Chain moved onto `capabilities`; facade attaches (the WebGPURenderer
    // class on BOTH its backends) get anisotropy 1.
    const renderer = (target as {
      renderer?: { capabilities?: { getMaxAnisotropy(): number } };
    }).renderer;
    this.maxAnisotropy = renderer?.capabilities?.getMaxAnisotropy() ?? 1;
    for (const slot of this.slots.values()) {
      if (slot.root) this.scene.add(slot.root);
    }
  }

  getObject(id: string): THREE.Object3D | null {
    return this.slots.get(id)?.root ?? null;
  }

  /** Reconcile media by id; unchanged kind/url items are patched in place. */
  setMedia(media: SiteMedia[]): void {
    if (this.disposed) return;
    if (!this.scene) {
      throw new Error("MediaLayer: attach() must be called before setMedia().");
    }

    const incoming = new Set(media.map((item) => item.id));
    for (const [id, slot] of this.slots) {
      if (incoming.has(id)) continue;
      this.cancelLoad(slot);
      this.disposeSlotRoot(slot);
      this.slots.delete(id);
    }

    for (const item of media) this.reconcileMedia(item);
  }

  /** Which ids are currently visible. Called on stop / selection / progress change. */
  setVisible(ids: ReadonlySet<string>): void {
    if (this.disposed) return;
    this.visibleIds = new Set(ids);
    for (const [id, slot] of this.slots) {
      this.syncVisibility(id, slot);
    }
  }

  /** Apply authored billboard policy after the camera has moved. */
  tick(camera: THREE.Camera): void {
    if (this.disposed) return;
    for (const slot of this.slots.values()) {
      const root = slot.root;
      if (!root || !root.visible) continue;
      const billboard = slot.latest.billboard ?? "none";
      if (billboard === "full") {
        root.quaternion.copy(camera.quaternion);
        root.updateMatrixWorld(true);
      } else if (billboard === "y") {
        const dx = camera.position.x - root.position.x;
        const dz = camera.position.z - root.position.z;
        root.rotation.set(0, Math.atan2(dx, dz), 0, "XYZ");
        root.updateMatrixWorld(true);
      }
    }
  }

  private reconcileMedia(item: SiteMedia): void {
    const key = `${item.kind}\0${item.url}`;
    let slot = this.slots.get(item.id);
    if (!slot) {
      slot = {
        root: null,
        loadedKey: null,
        token: null,
        loadingKey: null,
        loadingVideo: null,
        latest: item,
        failedKey: null,
        playPending: false,
        playWarningLogged: false,
      };
      this.slots.set(item.id, slot);
    } else {
      slot.latest = item;
    }

    if (slot.root && slot.loadedKey === key) {
      syncMediaInPlace(slot.root, item);
      this.syncVisibility(item.id, slot);
      return;
    }
    if ((slot.token && slot.loadingKey === key) || slot.failedKey === key) return;
    this.loadMedia(item.id, key, item);
  }

  private loadMedia(id: string, key: string, item: SiteMedia): void {
    const slot = this.slots.get(id);
    if (!slot) return;

    this.cancelLoad(slot);
    this.disposeSlotRoot(slot);
    const token = Symbol(id);
    slot.token = token;
    slot.loadingKey = key;
    slot.failedKey = null;
    slot.playWarningLogged = false;

    if (item.kind === "image") {
      void this.textureLoader.loadAsync(item.url).then(
        (texture) => this.installTexture(id, key, token, texture),
        (error: unknown) => this.handleLoadFailure(id, key, token, error),
      );
      return;
    }

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.loop = true;
    video.preload = "metadata";
    video.setAttribute("playsinline", "");
    video.src = item.url;
    slot.loadingVideo = video;
    void waitForVideoMetadata(video).then(
      () => {
        const current = this.slots.get(id);
        if (this.disposed || !this.scene || !current || current.token !== token) {
          cleanupVideo(video);
          return;
        }
        current.loadingVideo = null;
        const texture = new THREE.VideoTexture(video);
        this.installTexture(id, key, token, texture);
      },
      (error: unknown) => {
        cleanupVideo(video);
        this.handleLoadFailure(id, key, token, error);
      },
    );
    video.load();
  }

  private installTexture(
    id: string,
    key: string,
    token: symbol,
    tex: THREE.Texture,
  ): void {
    const current = this.slots.get(id);
    if (this.disposed || !this.scene || !current || current.token !== token) {
      disposeTexture(tex, new Set());
      return;
    }

    tex.colorSpace = THREE.SRGBColorSpace;
    if (tex instanceof THREE.VideoTexture) {
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
    } else {
      tex.generateMipmaps = true;
      tex.anisotropy = this.maxAnisotropy;
    }

    // Winner of the 5a occlusion gate (Candidate A). Evidence 2026-07-31:
    //   pose A (yaw 0, pitch 0, dist 3): centre pixel [36,37,59] — the poster's own
    //     2D-decoded centre is [39,38,59], per-channel diff [3,1,0] (exact match);
    //   pose B (yaw 180): centre pixel [0,0,0], per-channel diff vs A [36,37,59] > 24
    //     — the plane is occluded by the splat pass.
    // toneMapped:false + SRGBColorSpace is what made the colour match exact — vary
    // neither. VideoTexture instead sets generateMipmaps:false, minFilter:Linear.
    const material = new THREE.MeshBasicMaterial({
      map: tex, transparent: false, depthWrite: true, depthTest: true,
      side: THREE.DoubleSide, toneMapped: false, alphaTest: 0, opacity: 1,
    });
    // Shared texture setup (image): tex.colorSpace = THREE.SRGBColorSpace;
    // tex.generateMipmaps = true; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const latest = current.latest;
    const root = new THREE.Mesh(
      new THREE.PlaneGeometry(latest.size[0], latest.size[1]),
      material,
    );
    current.root = root;
    current.loadedKey = key;
    current.token = null;
    current.loadingKey = null;
    current.failedKey = null;
    this.scene.add(root);
    syncMediaInPlace(root, latest);
    this.syncVisibility(id, current);
  }

  private handleLoadFailure(id: string, key: string, token: symbol, error: unknown): void {
    const current = this.slots.get(id);
    if (this.disposed || !current || current.token !== token) return;
    current.token = null;
    current.loadingKey = null;
    current.loadingVideo = null;
    current.failedKey = key;
    console.warn(`[MediaLayer] failed to load media "${id}"`, error);
  }

  private syncVisibility(id: string, slot: MediaSlot): void {
    if (!slot.root) return;
    const visible = this.visibleIds.has(id);
    slot.root.visible = visible;
    const video = videoFromMesh(slot.root);
    if (!video) return;
    if (!visible) {
      video.pause();
      return;
    }
    if (slot.playPending || !video.paused) return;
    slot.playPending = true;
    void video.play().then(
      () => {
        slot.playPending = false;
      },
      (error: unknown) => {
        slot.playPending = false;
        if (slot.playWarningLogged || this.disposed || slot.root?.visible !== true) return;
        slot.playWarningLogged = true;
        console.warn(`[MediaLayer] video play() rejected for "${id}"`, error);
      },
    );
  }

  private cancelLoad(slot: MediaSlot): void {
    slot.token = null;
    slot.loadingKey = null;
    if (slot.loadingVideo) {
      cleanupVideo(slot.loadingVideo);
      slot.loadingVideo = null;
    }
  }

  private disposeSlotRoot(slot: MediaSlot): void {
    if (!slot.root) return;
    slot.root.parent?.remove(slot.root);
    disposeObjectTree(slot.root);
    slot.root = null;
    slot.loadedKey = null;
    slot.playPending = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.slots.values()) {
      this.cancelLoad(slot);
      this.disposeSlotRoot(slot);
    }
    this.slots.clear();
    this.visibleIds.clear();
    this.scene = null;
  }
}

function applyMediaTransform(root: THREE.Object3D, media: SiteMedia): void {
  root.position.set(...media.position);

  const rotationDeg = media.rotationDeg ?? [0, 0, 0];
  root.rotation.set(
    rotationDeg[0] * DEG_TO_RAD,
    rotationDeg[1] * DEG_TO_RAD,
    rotationDeg[2] * DEG_TO_RAD,
    "XYZ",
  );

  root.scale.setScalar(1);
  root.updateMatrixWorld(true);
}

function syncMediaInPlace(root: THREE.Mesh, media: SiteMedia): void {
  applyMediaTransform(root, media);
  const geometry = root.geometry as THREE.PlaneGeometry;
  const width = geometry.parameters.width;
  const height = geometry.parameters.height;
  if (width !== media.size[0] || height !== media.size[1]) {
    root.geometry = new THREE.PlaneGeometry(media.size[0], media.size[1]);
    geometry.dispose();
  }
}

function waitForVideoMetadata(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
      video.removeEventListener("abort", onAbort);
    };
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(video.error ?? new Error(`Failed to load video "${video.currentSrc || video.src}"`));
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Video load aborted", "AbortError"));
    };
    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("error", onError);
    video.addEventListener("abort", onAbort);
  });
}

function disposeObjectTree(root: THREE.Object3D): void {
  const disposedGeometries = new Set<THREE.BufferGeometry>();
  const disposedMaterials = new Set<THREE.Material>();
  const disposedTextures = new Set<THREE.Texture>();

  root.traverse((object) => {
    if (!isMesh(object)) return;
    const geometry = object.geometry;
    if (geometry && !disposedGeometries.has(geometry)) {
      geometry.dispose();
      disposedGeometries.add(geometry);
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      disposeMaterial(material, disposedMaterials, disposedTextures);
    }
  });
}

function disposeMaterial(
  material: THREE.Material,
  disposedMaterials: Set<THREE.Material>,
  disposedTextures: Set<THREE.Texture>,
): void {
  if (disposedMaterials.has(material)) return;
  for (const value of Object.values(material as unknown as Record<string, unknown>)) {
    disposeTextureValue(value, disposedTextures);
  }
  material.dispose();
  disposedMaterials.add(material);
}

function disposeTextureValue(value: unknown, disposedTextures: Set<THREE.Texture>): void {
  if (value instanceof THREE.Texture) {
    disposeTexture(value, disposedTextures);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) disposeTextureValue(item, disposedTextures);
  }
}

function disposeTexture(texture: THREE.Texture, disposedTextures: Set<THREE.Texture>): void {
  if (disposedTextures.has(texture)) return;
  if (texture instanceof THREE.VideoTexture && texture.image instanceof HTMLVideoElement) {
    cleanupVideo(texture.image);
  }
  texture.dispose();
  disposedTextures.add(texture);
}

function cleanupVideo(video: HTMLVideoElement): void {
  video.pause();
  video.removeAttribute("src");
  video.load();
}

function videoFromMesh(root: THREE.Mesh): HTMLVideoElement | null {
  const materials = Array.isArray(root.material) ? root.material : [root.material];
  for (const material of materials) {
    const map = (material as THREE.MeshBasicMaterial).map;
    if (map instanceof THREE.VideoTexture && map.image instanceof HTMLVideoElement) {
      return map.image;
    }
  }
  return null;
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true;
}
