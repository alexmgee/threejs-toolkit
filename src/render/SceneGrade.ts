/**
 * SceneGrade — post-processing color grade for ThreeSplatScene
 *
 * PORT of sparkjs-toolkit's SceneGrade (EffectComposer, WebGL-only) onto
 * three's node render pipeline + TSL, so the grade runs on BOTH backends
 * (ticket 10, the Phase 1 GATE). The pass order is preserved: scene render
 * -> output transform (tone map + sRGB) -> grade in DISPLAY space -> SMAA.
 * `renderOutput()` replaces OutputPass; `smaa()` (SMAANode) replaces
 * SMAAPass; the GLSL grade shader is re-expressed as an eager TSL graph
 * with the same math, uniform for uniform.
 *
 * Wraps a ThreeSplatScene render only while enabled, via the facade's
 * `renderOverride` hook (SparkScene's contract, owner-approved Option A).
 * Disabled mode restores the facade's built-in render path and does not
 * construct the pipeline unless grading has been enabled at least once.
 *
 * Declared adaptations from the sparkjs original (ticket 10 Comments hold
 * the full inventory):
 * - SparkScene -> ThreeSplatScene; `clock.elapsedTime` -> `getElapsed()`.
 * - `spark.encodeLinear` flips dropped — no Spark splat layer exists; the
 *   node pipeline's `renderOutput()` owns the shared-space transform.
 * - `syncComposerSize` machinery dropped — PassNode self-sizes from the
 *   renderer's drawing buffer every frame (PassNode.js:801-805).
 * - The LUT branch is a `mix()` against a `lutEnabled` 0/1 uniform over a
 *   placeholder 2x2x2 identity texture, instead of a GLSL `if` — avoids
 *   rebuilding the node graph when a LUT loads or clears.
 *
 * NO depth-dependent passes (DoF / SSAO) — deliberate, as in the original;
 * depth of field is the splat layer's own concern (Phase 5 optics).
 */

import * as THREE from "three/webgpu";
import {
  clamp,
  convertToTexture,
  distance,
  dot,
  float,
  fract,
  mix,
  pass,
  premultiplyAlpha,
  renderOutput,
  smoothstep,
  texture3D,
  uniform,
  unpremultiplyAlpha,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { smaa } from "three/examples/jsm/tsl/display/SMAANode.js";
import type { ThreeSplatScene } from "../core/ThreeSplatScene";
import type { SiteGradeSettings } from "../site/SiteConfig";

// ─── Types ────────────────────────────────────────────────

interface NormalizedGradeSettings {
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  vignette: number;
  grain: number;
  lutUrl?: string;
}

type GradeUniforms = ReturnType<typeof createGradeUniforms>;

interface PipelineState {
  pipeline: THREE.RenderPipeline;
  scenePass: ReturnType<typeof pass>;
  smaaNode: ReturnType<typeof smaa>;
  /** The RTT node materializing the graded frame for SMAA — held so its
   *  full-resolution render target can be freed (nothing else disposes it). */
  gradedTex: ReturnType<typeof convertToTexture>;
  uniforms: GradeUniforms;
  /** The 3D texture node the LUT sample reads — `.value` is swapped between
   *  the placeholder and a loaded LUT; the graph is never rebuilt. */
  lutNode: ReturnType<typeof texture3D>;
  /** Placeholder the lutNode holds while no LUT is loaded (never disposed
   *  until the pipeline goes). */
  lutPlaceholder: THREE.Data3DTexture;
}

// ─── SceneGrade ───────────────────────────────────────────

const DEFAULT_GRADE: NormalizedGradeSettings = {
  exposure: 1,
  contrast: 1,
  saturation: 1,
  temperature: 0,
  tint: 0,
  vignette: 0,
  grain: 0,
};

export class SceneGrade {
  private scene3: ThreeSplatScene | null = null;
  private pipelineState: PipelineState | null = null;
  private params: NormalizedGradeSettings = { ...DEFAULT_GRADE };
  private lutTexture: THREE.Data3DTexture | null = null;
  private lutUrl: string | undefined;
  private lutToken: symbol | null = null;
  private enabled = false;
  private disposed = false;
  private readonly renderCallback = () => this.render();

  /**
   * Attach to a ThreeSplatScene. The pipeline stays unbuilt until grading is
   * enabled, preserving the normal zero-overhead render path by default.
   */
  attach(scene3: ThreeSplatScene): void {
    if (this.disposed || this.scene3 === scene3) return;

    this.restoreScene();
    this.disposePipeline();
    this.scene3 = scene3;

    if (this.enabled) {
      this.enablePipeline();
    }
  }

  /**
   * Enable or disable the post-processing path.
   * Disabling removes the ThreeSplatScene render override.
   */
  setEnabled(enabled: boolean): void {
    if (this.disposed || this.enabled === enabled) return;

    this.enabled = enabled;
    if (enabled) {
      this.enablePipeline();
    } else {
      this.restoreScene();
    }
  }

  /**
   * Update grade uniforms and load or clear the optional .cube LUT.
   */
  update(params: SiteGradeSettings): void {
    if (this.disposed) return;

    this.params = normalizeGrade(params);
    this.applyUniforms();
    this.updateLut(this.params.lutUrl);
  }

  /** Lets authoring panels seed their bindings. */
  getParams(): SiteGradeSettings {
    return { enabled: this.enabled, ...this.params };
  }

  /**
   * Render one pipeline frame. Called by ThreeSplatScene through
   * renderOverride while grading is enabled.
   */
  render(): void {
    if (this.disposed || !this.scene3) return;

    const state = this.ensurePipeline();
    // Timer, not Clock: getElapsed(), never .elapsedTime (undefined — silent
    // NaN into the grain hash; ticket 10 Comments).
    state.uniforms.time.value = this.scene3.clock.getElapsed();
    state.pipeline.render();
  }

  /**
   * Restore ThreeSplatScene state and release pipeline, pass, and LUT
   * resources.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    this.restoreScene();
    this.disposePipeline();
    this.disposeLut();
    this.lutToken = null;
    this.scene3 = null;
  }

  private enablePipeline(): void {
    if (!this.scene3) return;

    this.ensurePipeline();
    this.scene3.renderOverride = this.renderCallback;
  }

  private ensurePipeline(): PipelineState {
    if (!this.scene3) {
      throw new Error("SceneGrade: attach() must be called before enabling or rendering.");
    }
    if (this.pipelineState) return this.pipelineState;

    const uniforms = createGradeUniforms();
    const lutPlaceholder = createPlaceholderLut();

    // Pass order preserved from the original composer:
    // RenderPass -> OutputPass -> grade (display space) -> SMAA.
    const scenePass = pass(this.scene3.scene, this.scene3.camera);
    // renderOutput() ends by PREMULTIPLYING alpha (RenderOutputNode.js:137)
    // — the reference's OutputPass emitted straight alpha, and the grade
    // math (offsets from contrast/grain) is only reference-equivalent on
    // straight RGB. Un-premultiply before grading, re-premultiply after
    // (adversarial-review finding, 2026-08-21; a=0 guarded upstream).
    // Opaque pixels are bit-identical either way.
    const display = unpremultiplyAlpha(renderOutput(scenePass));

    const exposed = display.rgb.mul(uniforms.exposure);
    // r *= 1+0.25*temperature; g *= 1-0.25*tint; b *= 1-0.25*temperature
    const balanced = exposed.mul(
      vec3(
        uniforms.temperature.mul(0.25).add(1),
        uniforms.tint.mul(-0.25).add(1),
        uniforms.temperature.mul(-0.25).add(1),
      ),
    );
    const luma = dot(balanced, vec3(0.2126, 0.7152, 0.0722));
    const saturated = mix(vec3(luma), balanced, uniforms.saturation);
    const contrasted = saturated.sub(0.5).mul(uniforms.contrast).add(0.5);
    const vignetted = contrasted.mul(
      float(1).sub(
        uniforms.vignette.mul(
          smoothstep(0.3, 0.75, distance(uv(), vec2(0.5, 0.5))),
        ),
      ),
    );
    const grained = vignetted.add(
      tslHash(uv(), uniforms.time).sub(0.5).mul(uniforms.grain.mul(0.15)),
    );
    // Texel-center remap as in the original (lutScale/lutOffset uniforms).
    const lutNode = texture3D(
      lutPlaceholder,
      clamp(grained, 0, 1).mul(uniforms.lutScale).add(uniforms.lutOffset),
      null,
    );
    const withLut = mix(grained, lutNode.rgb, uniforms.lutEnabled);
    const gradedOutput = premultiplyAlpha(
      vec4(clamp(withLut, 0, 1), display.a),
    );
    // Materialize the grade to a texture OURSELVES: smaa() would otherwise
    // call convertToTexture() internally on the raw vec4, allocating an
    // RTTNode whose full-resolution render target nothing can reach at
    // dispose time (RTTNode has no dispose(); SMAANode.dispose() skips its
    // input — adversarial-review finding, all three reviewers, 2026-08-21).
    // Holding the node here lets disposePipeline() free the target.
    const gradedTex = convertToTexture(gradedOutput);
    const smaaNode = smaa(gradedTex);

    const pipeline = new THREE.RenderPipeline(this.scene3.renderer, smaaNode);
    // renderOutput() above already applied tone mapping + sRGB (the grade
    // runs in display space, as the original's OutputPass ordering did);
    // the pipeline must not apply the transform a second time.
    pipeline.outputColorTransform = false;

    this.pipelineState = {
      pipeline,
      scenePass,
      smaaNode,
      gradedTex,
      uniforms,
      lutNode,
      lutPlaceholder,
    };
    this.applyUniforms();
    return this.pipelineState;
  }

  private applyUniforms(): void {
    const state = this.pipelineState;
    if (!state) return;

    const { uniforms } = state;
    uniforms.exposure.value = this.params.exposure;
    uniforms.contrast.value = this.params.contrast;
    uniforms.saturation.value = this.params.saturation;
    uniforms.temperature.value = this.params.temperature;
    uniforms.tint.value = this.params.tint;
    uniforms.vignette.value = this.params.vignette;
    uniforms.grain.value = this.params.grain;
    state.lutNode.value = this.lutTexture ?? state.lutPlaceholder;
    uniforms.lutEnabled.value = this.lutTexture ? 1 : 0;
    // Texel-center remap: a size-N LUT covers [0.5/N, 1-0.5/N] — without
    // this, edge values clamp into dead zones and the curve steepens.
    const lutSize = this.lutTexture?.image.width ?? 0;
    uniforms.lutScale.value = lutSize > 1 ? (lutSize - 1) / lutSize : 1;
    uniforms.lutOffset.value = lutSize > 1 ? 0.5 / lutSize : 0;
  }

  private updateLut(lutUrl: string | undefined): void {
    if (lutUrl === this.lutUrl) return;

    this.lutUrl = lutUrl;
    const token = Symbol(lutUrl ?? "no-lut");
    this.lutToken = token;
    this.disposeLut();
    this.applyUniforms();

    if (!lutUrl) return;

    void this.loadLut(lutUrl, token);
  }

  private async loadLut(lutUrl: string, token: symbol): Promise<void> {
    try {
      const response = await fetch(lutUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const texture = parseCubeLut(await response.text());
      if (this.disposed || this.lutToken !== token) {
        texture.dispose();
        return;
      }
      this.lutTexture = texture;
      this.applyUniforms();
    } catch (error) {
      if (this.disposed || this.lutToken !== token) return;
      console.warn(`[SceneGrade] failed to load LUT "${lutUrl}"`, error);
      this.disposeLut();
      this.applyUniforms();
    }
  }

  private restoreScene(): void {
    if (!this.scene3) return;

    // Ownership guard — part of the API contract (owner ruling, ticket 10):
    // only clear the override if this instance still owns it.
    if (this.scene3.renderOverride === this.renderCallback) {
      this.scene3.renderOverride = null;
    }
  }

  private disposePipeline(): void {
    if (!this.pipelineState) return;

    const { pipeline, scenePass, smaaNode, gradedTex, lutPlaceholder } =
      this.pipelineState;
    smaaNode.dispose();
    // RTTNode exposes its target publicly but has no dispose() of its own;
    // freeing the render target here is what recovers the full-resolution
    // GPU allocation (its small CPU-side NodeMaterial is private and stays
    // — declared residual).
    (gradedTex as unknown as { renderTarget?: { dispose(): void } })
      .renderTarget?.dispose();
    scenePass.dispose();
    pipeline.dispose();
    lutPlaceholder.dispose();
    this.pipelineState = null;
  }

  private disposeLut(): void {
    this.lutTexture?.dispose();
    this.lutTexture = null;
  }
}

// ─── Grade node helpers ───────────────────────────────────

function createGradeUniforms() {
  return {
    exposure: uniform(DEFAULT_GRADE.exposure),
    contrast: uniform(DEFAULT_GRADE.contrast),
    saturation: uniform(DEFAULT_GRADE.saturation),
    temperature: uniform(DEFAULT_GRADE.temperature),
    tint: uniform(DEFAULT_GRADE.tint),
    vignette: uniform(DEFAULT_GRADE.vignette),
    grain: uniform(DEFAULT_GRADE.grain),
    time: uniform(0),
    lutEnabled: uniform(0),
    lutScale: uniform(1),
    lutOffset: uniform(0),
  };
}

/**
 * TSL port of the original grain hash (same constants, same ops):
 *   p3 = fract(vec3(p.xyx) * vec3(443.8975, 397.2973, 491.1871));
 *   p3 += dot(p3, p3.yzx + 19.19 + t);
 *   return fract((p3.x + p3.y) * p3.z);
 */
function tslHash(
  p: ReturnType<typeof uv>,
  t: GradeUniforms["time"],
) {
  const p3 = fract(
    vec3(p.x, p.y, p.x).mul(vec3(443.8975, 397.2973, 491.1871)),
  );
  const p3b = p3.add(dot(p3, p3.yzx.add(float(19.19).add(t))));
  return fract(p3b.x.add(p3b.y).mul(p3b.z));
}

/**
 * 2x2x2 identity placeholder the LUT sampler binds while no LUT is loaded
 * (the sample result is discarded by mix() with lutEnabled = 0, but the
 * binding must always hold a valid 3D texture).
 */
function createPlaceholderLut(): THREE.Data3DTexture {
  const one = THREE.DataUtils.toHalfFloat(1);
  const zero = THREE.DataUtils.toHalfFloat(0);
  const data = new Uint16Array(2 * 2 * 2 * 4);
  for (let i = 0; i < 8; i++) {
    data[i * 4] = i & 1 ? one : zero; // r follows x
    data[i * 4 + 1] = i & 2 ? one : zero; // g follows y
    data[i * 4 + 2] = i & 4 ? one : zero; // b follows z
    data[i * 4 + 3] = one;
  }
  const texture = new THREE.Data3DTexture(data, 2, 2, 2);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.HalfFloatType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

// ─── LUT Parsing ──────────────────────────────────────────

function normalizeGrade(params: SiteGradeSettings): NormalizedGradeSettings {
  return {
    exposure: params.exposure ?? DEFAULT_GRADE.exposure,
    contrast: params.contrast ?? DEFAULT_GRADE.contrast,
    saturation: params.saturation ?? DEFAULT_GRADE.saturation,
    temperature: params.temperature ?? DEFAULT_GRADE.temperature,
    tint: params.tint ?? DEFAULT_GRADE.tint,
    vignette: params.vignette ?? DEFAULT_GRADE.vignette,
    grain: params.grain ?? DEFAULT_GRADE.grain,
    lutUrl: params.lutUrl,
  };
}

function parseCubeLut(source: string): THREE.Data3DTexture {
  let size = 0;
  const values: number[] = [];

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.split("#", 1)[0].trim();
    if (!line) continue;

    const parts = line.split(/\s+/);
    const keyword = parts[0].toUpperCase();
    if (keyword === "TITLE" || keyword === "DOMAIN_MIN" || keyword === "DOMAIN_MAX") {
      continue;
    }
    if (keyword === "LUT_3D_SIZE") {
      size = Number(parts[1]);
      continue;
    }
    if (keyword === "LUT_1D_SIZE") {
      throw new Error("1D .cube LUTs are not supported");
    }

    if (parts.length >= 3) {
      values.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
    }
  }

  if (!Number.isInteger(size) || size <= 1) {
    throw new Error(".cube LUT is missing a valid LUT_3D_SIZE");
  }

  const expectedValues = size * size * size * 3;
  if (values.length !== expectedValues) {
    throw new Error(`.cube LUT expected ${expectedValues} RGB values, found ${values.length}`);
  }
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error(".cube LUT contains non-numeric RGB values");
  }

  // RGBA16F: half-float is linear-filterable in core WebGL2; 32-bit float
  // needs OES_texture_float_linear and RGB float layouts are unreliable
  // across drivers (incomplete texture -> silent black sampling).
  const texels = size * size * size;
  const data = new Uint16Array(texels * 4);
  const one = THREE.DataUtils.toHalfFloat(1);
  for (let i = 0; i < texels; i++) {
    data[i * 4] = THREE.DataUtils.toHalfFloat(values[i * 3]);
    data[i * 4 + 1] = THREE.DataUtils.toHalfFloat(values[i * 3 + 1]);
    data[i * 4 + 2] = THREE.DataUtils.toHalfFloat(values[i * 3 + 2]);
    data[i * 4 + 3] = one;
  }
  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.HalfFloatType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
