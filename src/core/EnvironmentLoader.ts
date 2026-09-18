/**
 * EnvironmentLoader — HDR/EXR environment maps and cubemap skyboxes
 *
 * Loads environment maps using Three.js loaders and PMREMGenerator.
 * Sets both scene.background (skybox) and scene.environment (IBL lighting).
 *
 * ADAPTED (ticket 08, declared in the ticket's Comments — NOT a type-swap
 * port, per the corrected AC):
 * - SparkScene -> ThreeSplatScene (the `sparkScene` field NAME is kept:
 *   it is public API consumed by Phase 2's SiteRuntime copy).
 *   CORRECTED 2026-09-17 (doc 06 D28): that reason was wrong — the pin's
 *   SiteRuntime never constructs EnvironmentLoader. The key's consumers are
 *   SceneComposer, CropTool and DebugPanel (Phase 3) and example pages. The
 *   name is kept on D12 (strict source compatibility).
 * - PMREMGenerator comes from three/webgpu, not core three — the core
 *   class calls WebGL-only renderer methods; the node generator serves
 *   BOTH the WebGPU backend and the facade's WebGL2 fallback.
 * - `load()` awaits `scene.ready` before any PMREM work (the node
 *   generator throws before backend init; the Async variants are
 *   deprecated since r181), and awaits compileEquirectangularShader
 *   (async on the node generator).
 * - Restore contract: the facade freezes canvas alpha at construction and
 *   does not retain the original background, so THIS class captures
 *   `scene.background` at ITS OWN construction; setShowBackground(false),
 *   clear(), and a load({showBackground:false}) restore that captured
 *   background instead of null.
 * - Lifetime (adversarial review, 2026-08-22): load() calls are serialized
 *   (last requested wins, no texture leak); dispose() is guarded across
 *   load()'s awaits; the PMREM RenderTarget is disposed with its texture.
 */

import * as THREE from "three";
import { PMREMGenerator } from "three/webgpu";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import type { ThreeSplatScene } from "./ThreeSplatScene";

// ─── Types ───────────────────────────────────────────────────────

export interface EnvironmentOptions {
  /** URL to an HDR (.hdr) environment map */
  hdrUrl?: string;
  /** URL to an EXR (.exr) environment map */
  exrUrl?: string;
  /** URLs for 6-face cubemap: [px, nx, py, ny, pz, nz] */
  cubeMapUrls?: [string, string, string, string, string, string];
  /** Show environment as scene background (default: true) */
  showBackground?: boolean;
  /** Background blur amount 0-1 (default: 0) */
  backgroundBlur?: number;
  /** Background intensity (default: 1) */
  backgroundIntensity?: number;
  /** Rotation around Y axis in degrees (default: 0) */
  rotation?: number;
}

export interface EnvironmentConfig {
  sparkScene: ThreeSplatScene;
}

// ─── EnvironmentLoader ───────────────────────────────────────────

export class EnvironmentLoader {
  readonly sparkScene: ThreeSplatScene;
  private envTexture: THREE.Texture | null = null;
  private envRenderTarget: ReturnType<PMREMGenerator["fromEquirectangular"]> | null = null;
  private pmremGenerator: PMREMGenerator | null = null;
  private showBackground = true;
  private disposed = false;
  /** Serializes load() calls: overlapping loads resolve in request order,
   *  so the LAST requested environment wins and no texture leaks. */
  private loadChain: Promise<unknown> = Promise.resolve();
  /** The facade-constructed background, captured at construction (before
   *  any overwrite); restored by setShowBackground(false)/clear(). */
  private readonly originalBackground: THREE.Scene["background"];

  constructor(config: EnvironmentConfig) {
    this.sparkScene = config.sparkScene;
    this.originalBackground = config.sparkScene.scene.background;
  }

  /**
   * Load an environment map and apply it to the scene.
   * Supports HDR, EXR, and cubemap formats.
   */
  async load(options: EnvironmentOptions): Promise<THREE.Texture> {
    // Serialize: overlapping calls run in request order (last wins, no leak).
    const run = this.loadChain.then(() => this.doLoad(options));
    this.loadChain = run.catch(() => {});
    return run;
  }

  private async doLoad(options: EnvironmentOptions): Promise<THREE.Texture> {
    if (this.disposed) {
      throw new Error("EnvironmentLoader: load() after dispose()");
    }
    const {
      showBackground = true,
      backgroundBlur = 0,
      backgroundIntensity = 1,
      rotation = 0,
    } = options;

    this.showBackground = showBackground;

    // PMREM work requires an initialized backend (the node generator
    // throws otherwise) — the facade's ready settles after renderer.init().
    await this.sparkScene.ready;
    if (this.disposed) {
      throw new Error("EnvironmentLoader: disposed during load()");
    }

    // Ensure PMREMGenerator
    if (!this.pmremGenerator) {
      this.pmremGenerator = new PMREMGenerator(this.sparkScene.renderer);
      await this.pmremGenerator.compileEquirectangularShader();
      if (this.disposed) {
        throw new Error("EnvironmentLoader: disposed during load()");
      }
    }

    let envMap: THREE.Texture;

    if (options.hdrUrl) {
      envMap = await this.loadHdr(options.hdrUrl);
    } else if (options.exrUrl) {
      envMap = await this.loadExr(options.exrUrl);
    } else if (options.cubeMapUrls) {
      envMap = await this.loadCubeMap(options.cubeMapUrls);
    } else {
      throw new Error("EnvironmentLoader: No URL provided (hdrUrl, exrUrl, or cubeMapUrls)");
    }
    if (this.disposed) {
      envMap.dispose();
      throw new Error("EnvironmentLoader: disposed during load()");
    }

    // Generate prefiltered environment map (different API for cubemaps vs equirect)
    const pmremResult = envMap instanceof THREE.CubeTexture
      ? this.pmremGenerator!.fromCubemap(envMap)
      : this.pmremGenerator!.fromEquirectangular(envMap);
    const pmremTexture = pmremResult.texture;
    envMap.dispose();

    // Replace the previous environment only now, so the scene never points
    // at a disposed texture across the awaits above.
    this.disposeTextures();
    this.envTexture = pmremTexture;
    this.envRenderTarget = pmremResult;

    // Apply to scene
    const scene = this.sparkScene.scene;
    scene.environment = pmremTexture;

    if (showBackground) {
      scene.background = pmremTexture;
      scene.backgroundBlurriness = backgroundBlur;
      scene.backgroundIntensity = backgroundIntensity;
      scene.backgroundRotation.set(0, rotation * (Math.PI / 180), 0);
    } else {
      // The restore contract applies on this write path too: never leave
      // scene.background pointing at the just-disposed previous texture.
      scene.background = this.originalBackground;
    }

    return pmremTexture;
  }

  /**
   * Update background blur (0-1).
   */
  setBackgroundBlur(amount: number): void {
    this.sparkScene.scene.backgroundBlurriness = amount;
  }

  /**
   * Update background intensity.
   */
  setBackgroundIntensity(intensity: number): void {
    this.sparkScene.scene.backgroundIntensity = intensity;
  }

  /**
   * Update environment rotation around Y axis (degrees).
   */
  setRotation(degrees: number): void {
    this.sparkScene.scene.backgroundRotation.set(0, degrees * (Math.PI / 180), 0);
  }

  /**
   * Toggle background visibility without removing environment lighting.
   */
  setShowBackground(show: boolean): void {
    this.showBackground = show;
    const scene = this.sparkScene.scene;
    if (show && this.envTexture) {
      scene.background = this.envTexture;
    } else {
      scene.background = this.originalBackground;
    }
  }

  /**
   * Remove environment map and restore original background.
   */
  clear(): void {
    const scene = this.sparkScene.scene;
    scene.environment = null;
    scene.background = this.originalBackground;
    this.disposeTextures();
  }

  /**
   * Check if an environment is currently loaded.
   */
  get isLoaded(): boolean {
    return this.envTexture !== null;
  }

  /**
   * Dispose all resources.
   */
  dispose(): void {
    this.disposed = true;
    this.clear();
    if (this.pmremGenerator) {
      this.pmremGenerator.dispose();
      this.pmremGenerator = null;
    }
  }

  // ─── Private Loaders ─────────────────────────────────────────

  private loadHdr(url: string): Promise<THREE.DataTexture> {
    return new Promise((resolve, reject) => {
      new RGBELoader().load(
        url,
        (texture) => resolve(texture),
        undefined,
        (error) => reject(new Error(`Failed to load HDR: ${error}`))
      );
    });
  }

  private loadExr(url: string): Promise<THREE.DataTexture> {
    return new Promise((resolve, reject) => {
      new EXRLoader().load(
        url,
        (texture) => resolve(texture),
        undefined,
        (error) => reject(new Error(`Failed to load EXR: ${error}`))
      );
    });
  }

  private loadCubeMap(urls: [string, string, string, string, string, string]): Promise<THREE.CubeTexture> {
    return new Promise((resolve, reject) => {
      new THREE.CubeTextureLoader().load(
        urls,
        (texture) => resolve(texture),
        undefined,
        (error) => reject(new Error(`Failed to load cubemap: ${error}`))
      );
    });
  }

  private disposeTextures(): void {
    if (this.envTexture) {
      this.envTexture.dispose();
      this.envTexture = null;
    }
    if (this.envRenderTarget) {
      // The PMREM RenderTarget owns GPU attachments beyond its .texture —
      // dropping it undisposed leaked one target per load() at the pin.
      this.envRenderTarget.dispose();
      this.envRenderTarget = null;
    }
  }
}
