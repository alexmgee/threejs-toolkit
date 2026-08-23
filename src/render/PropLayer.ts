/**
 * PropLayer — glTF props inside the splat scene graph
 *
 * Loads uncompressed .glb/.gltf assets with GLTFLoader only. v1 does
 * not configure DRACOLoader or KTX2Loader, so compressed meshes/textures
 * should be transcoded before use.
 *
 * Occlusion uses the shared Three.js depth buffer: opaque meshes write
 * depth and Spark splats depth-test against it. Fidelity tracks splat
 * density/opacity, so meshes behind sparse or not-yet-streamed paged
 * regions can show through mid-stream; this is expected gaussian alpha
 * behavior, not a layer-order workaround.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { SiteProp } from "../site/SiteConfig";

// ─── Types ────────────────────────────────────────────────

export interface PropLayerAttachTarget {
  scene: THREE.Scene;
}

export interface PropLayerLightingConfig {
  hemisphere?: number;
  directional?: number;
  /** [azimuthDeg, altitudeDeg] */
  directionDeg?: [number, number];
}

interface NormalizedLightingConfig {
  hemisphere: number;
  directional: number;
  directionDeg: [number, number];
}

/**
 * Desired-state slot for one authored prop id. `setProps` reconciles the live
 * scene against the incoming config instead of clear-and-reload-all, so editing
 * a non-url field (transform, shadow) re-fetches ZERO glTF.
 *  - `root`/`loadedUrl`: the installed object and the url it was loaded from.
 *  - `token`/`loadingUrl`: an in-flight load's identity (token) and its url; the
 *    completion checks `token` so a superseded or deleted load never installs.
 *  - `latest`: the newest config seen for this id — applied on load completion so
 *    a transform edited mid-load still lands.
 *  - `loadPromise`: the in-flight load's promise, so a `setProps`/`addProp` that
 *    finds a matching load already running can await it (truthful "reconcile
 *    finished" semantics) instead of resolving early.
 */
interface PropSlot {
  root: THREE.Object3D | null;
  loadedUrl: string | null;
  token: symbol | null;
  loadingUrl: string | null;
  latest: SiteProp;
  loadPromise: Promise<void> | null;
}

// ─── PropLayer ────────────────────────────────────────────

const DEFAULT_LIGHTING: NormalizedLightingConfig = {
  hemisphere: 0.6,
  directional: 0.8,
  directionDeg: [45, 60],
};

const DEG_TO_RAD = Math.PI / 180;

export class PropLayer {
  private scene: THREE.Scene | null = null;
  private loader = new GLTFLoader();
  private slots = new Map<string, PropSlot>();
  private lighting: NormalizedLightingConfig = { ...DEFAULT_LIGHTING };

  private hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, DEFAULT_LIGHTING.hemisphere);
  private directionalLight = new THREE.DirectionalLight(0xffffff, DEFAULT_LIGHTING.directional);
  private lightsAttached = false;
  private disposed = false;

  constructor() {
    this.updateDirectionalLight();
  }

  attach(target: PropLayerAttachTarget): void {
    if (this.disposed) return;
    if (this.scene === target.scene) return;

    const previousScene = this.scene;
    if (previousScene) {
      if (this.lightsAttached) {
        previousScene.remove(this.hemisphereLight, this.directionalLight);
        this.lightsAttached = false;
      }
      for (const slot of this.slots.values()) {
        if (slot.root) previousScene.remove(slot.root);
      }
    }

    this.scene = target.scene;
    for (const slot of this.slots.values()) {
      if (slot.root) this.scene.add(slot.root);
    }
    this.syncLightingRig();
  }

  // ─── Props ──────────────────────────────────────────────

  getObject(id: string): THREE.Object3D | null {
    return this.slots.get(id)?.root ?? null;
  }

  /**
   * Add or replace a single prop, awaiting its load. Retained for the public
   * toolkit API; internally it is one reconcile step (in-place patch if the url
   * is already installed/loading, otherwise a load). Rejects if the load fails.
   */
  async addProp(prop: SiteProp): Promise<void> {
    if (this.disposed) return;
    if (!this.scene) {
      throw new Error("PropLayer: attach() must be called before addProp().");
    }
    const pending = this.reconcileProp(prop);
    this.syncLightingRig();
    await pending;
  }

  /** Remove a single prop by id, cancelling any in-flight load and disposing it. */
  removeProp(id: string): void {
    const slot = this.slots.get(id);
    if (!slot) return;
    slot.token = null; // cancel any in-flight load (completion self-rejects)
    slot.loadingUrl = null;
    slot.loadPromise = null;
    this.disposeSlotRoot(slot);
    this.slots.delete(id);
    this.syncLightingRig();
  }

  /**
   * Reconcile the live scene to the desired prop list. Unchanged-url props are
   * patched in place (no load); a changed/new url loads exactly that prop; a
   * removed id is disposed. Editing any non-url field triggers ZERO glTF fetches.
   * Resolves once every affected load settles; rejects if one fails.
   */
  async setProps(props: SiteProp[]): Promise<void> {
    if (this.disposed) return;
    if (!this.scene) {
      throw new Error("PropLayer: attach() must be called before setProps().");
    }

    // 1. Remove slots whose id is absent from the incoming list.
    const incoming = new Set(props.map((prop) => prop.id));
    for (const [id, slot] of this.slots) {
      if (incoming.has(id)) continue;
      slot.token = null; // cancel any in-flight load
      slot.loadingUrl = null;
      slot.loadPromise = null;
      this.disposeSlotRoot(slot);
      this.slots.delete(id);
    }

    // 2. Reconcile each incoming prop.
    const pending = props.map((prop) => this.reconcileProp(prop));

    // 3. Reconcile lighting once after the synchronous removals (loads that
    //    complete later call syncLightingRig again as roots appear).
    this.syncLightingRig();

    await Promise.all(pending);
  }

  /**
   * Reconcile ONE prop into its slot and return a promise that settles when its
   * load (if any) does. Same-url-installed → in-place patch (resolved). Same-url
   * already loading → await that in-flight load (so callers see a truthful
   * "reconcile finished"). Otherwise (re)load.
   */
  private reconcileProp(prop: SiteProp): Promise<void> {
    let slot = this.slots.get(prop.id);
    if (!slot) {
      slot = { root: null, loadedUrl: null, token: null, loadingUrl: null, latest: prop, loadPromise: null };
      this.slots.set(prop.id, slot);
    } else {
      slot.latest = prop;
    }

    if (slot.root && slot.loadedUrl === prop.url) {
      // Same url already installed → in-place patch, no load.
      syncPropInPlace(slot.root, prop);
      return Promise.resolve();
    }
    if (slot.token && slot.loadingUrl === prop.url) {
      // Same url already loading → await that load, which applies slot.latest
      // (now including this edit) on completion. Do NOT resolve early.
      return slot.loadPromise ?? Promise.resolve();
    }
    // No root, wrong loaded url, or loading a different url → (re)load.
    return this.loadProp(prop.id, prop.url);
  }

  private loadProp(id: string, url: string): Promise<void> {
    const slot = this.slots.get(id);
    if (!slot) return Promise.resolve();

    // Supersede any prior load and drop the stale root — its url changed, so it
    // no longer represents the desired state.
    this.disposeSlotRoot(slot);
    const token = Symbol(id);
    slot.token = token;
    slot.loadingUrl = url;

    const promise = this.loader.loadAsync(url).then(
      (gltf) => {
        const current = this.slots.get(id);
        // Reject if disposed, detached, deleted, or superseded by a newer load.
        if (this.disposed || !this.scene || !current || current.token !== token) {
          disposeObjectTree(gltf.scene);
          return;
        }
        const root = gltf.scene;
        current.root = root;
        current.loadedUrl = url;
        current.token = null;
        current.loadingUrl = null;
        current.loadPromise = null;
        this.scene.add(root);
        // Apply the LATEST config, not the url-captured prop, so a transform
        // edited while this load was in flight lands immediately.
        syncPropInPlace(root, current.latest);
        this.syncLightingRig();
      },
      (error: unknown) => {
        const current = this.slots.get(id);
        // Superseded / disposed / deleted → swallow (this load is irrelevant now).
        if (this.disposed || !current || current.token !== token) return;
        current.token = null;
        current.loadingUrl = null;
        current.loadPromise = null;
        // Propagate so callers awaiting setProps()/addProp() see the failure,
        // matching the pre-reconciler contract.
        throw error;
      },
    );
    slot.loadPromise = promise;
    return promise;
  }

  private disposeSlotRoot(slot: PropSlot): void {
    if (!slot.root) return;
    slot.root.parent?.remove(slot.root);
    disposeObjectTree(slot.root);
    slot.root = null;
    slot.loadedUrl = null;
  }

  // ─── Lighting ───────────────────────────────────────────

  setLighting(config?: PropLayerLightingConfig): void {
    this.lighting = normalizeLighting(config);
    this.hemisphereLight.intensity = this.lighting.hemisphere;
    this.directionalLight.intensity = this.lighting.directional;
    this.updateDirectionalLight();
    this.syncLightingRig();
  }

  private updateDirectionalLight(): void {
    const [azimuthDeg, altitudeDeg] = this.lighting.directionDeg;
    const azimuth = azimuthDeg * DEG_TO_RAD;
    const altitude = altitudeDeg * DEG_TO_RAD;
    const radiusAtAltitude = Math.cos(altitude);

    this.directionalLight.position.set(
      Math.sin(azimuth) * radiusAtAltitude,
      Math.sin(altitude),
      Math.cos(azimuth) * radiusAtAltitude,
    );
    this.directionalLight.position.multiplyScalar(10);
  }

  private hasRoots(): boolean {
    for (const slot of this.slots.values()) {
      if (slot.root) return true;
    }
    return false;
  }

  private syncLightingRig(): void {
    const shouldAttach = !!this.scene && this.hasRoots() && !this.disposed;

    if (shouldAttach && !this.lightsAttached) {
      this.scene!.add(this.hemisphereLight, this.directionalLight);
      this.lightsAttached = true;
    } else if (!shouldAttach && this.lightsAttached) {
      this.hemisphereLight.parent?.remove(this.hemisphereLight);
      this.directionalLight.parent?.remove(this.directionalLight);
      this.lightsAttached = false;
    }
  }

  // ─── Cleanup ─────────────────────────────────────────────

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.slots.values()) {
      slot.token = null; // cancel in-flight loads (completion self-rejects)
      this.disposeSlotRoot(slot);
    }
    this.slots.clear();
    this.syncLightingRig();
    this.scene = null;
  }
}

// ─── Helpers ──────────────────────────────────────────────

function normalizeLighting(config?: PropLayerLightingConfig): NormalizedLightingConfig {
  return {
    hemisphere: config?.hemisphere ?? DEFAULT_LIGHTING.hemisphere,
    directional: config?.directional ?? DEFAULT_LIGHTING.directional,
    directionDeg: config?.directionDeg ?? DEFAULT_LIGHTING.directionDeg,
  };
}

function applyPropTransform(root: THREE.Object3D, prop: SiteProp): void {
  root.position.set(...prop.position);

  const rotationDeg = prop.rotationDeg ?? [0, 0, 0];
  root.rotation.set(
    rotationDeg[0] * DEG_TO_RAD,
    rotationDeg[1] * DEG_TO_RAD,
    rotationDeg[2] * DEG_TO_RAD,
    "XYZ",
  );

  root.scale.setScalar(prop.scale ?? 1);
  root.updateMatrixWorld(true);
}

/**
 * Patch an already-loaded prop root to match `prop` without touching the glTF.
 * castShadow is assigned in BOTH directions — the old add-only path could never
 * turn a shadow back off.
 */
function syncPropInPlace(root: THREE.Object3D, prop: SiteProp): void {
  applyPropTransform(root, prop);
  const castShadow = prop.castShadow === true;
  root.traverse((object) => {
    if (isMesh(object)) object.castShadow = castShadow;
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
    if (!disposedTextures.has(value)) {
      value.dispose();
      disposedTextures.add(value);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      disposeTextureValue(item, disposedTextures);
    }
  }
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true;
}
