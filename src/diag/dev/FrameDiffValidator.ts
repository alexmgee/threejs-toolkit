import type { Camera, Scene, WebGLRenderer } from "three";
// ADAPTED (ticket 07, declared): renderer typing widened to accept the
// WebGPURenderer facade renderer (D22 precedent, type-only — the class
// uses only render() and domElement, present on both).
import type { WebGPURenderer } from "three/webgpu";
import type { LaggardMapResult } from "../LaggardMapper";

export interface FrameDiffPolicy {
  readonly version: string;
  readonly dwellMs: number;
  readonly perceptualThreshold: number;
  readonly downscaleWidth: number;
  readonly downscaleHeight: number;
  readonly minimumConvergedFrames: number;
  readonly ssimWindowSize: number;
}

export const DEFAULT_FRAME_DIFF_POLICY: Readonly<FrameDiffPolicy> = Object.freeze({
  version: "frame-diff-1",
  dwellMs: 2_000,
  perceptualThreshold: 0.02,
  downscaleWidth: 320,
  downscaleHeight: 180,
  minimumConvergedFrames: 3,
  ssimWindowSize: 8,
});

export interface FrameStableMask {
  readonly width: number;
  readonly height: number;
  /** One includes a pixel in calibration; zero masks it as intentionally unstable. */
  readonly values: Uint8Array;
}

export interface BlindedRegionNote {
  readonly regionId: string;
  readonly columnStart: number;
  readonly rowStart: number;
  readonly columnEnd: number;
  readonly rowEnd: number;
  readonly classification: "false_positive" | "false_negative";
  readonly blindedLabel?: string;
  readonly note?: string;
}

export interface FrameDiffValidatorOptions {
  readonly renderer: WebGLRenderer | WebGPURenderer;
  readonly scene: Scene;
  readonly camera: Camera;
  readonly isStableEpoch: (epochId: string) => boolean;
  readonly policy?: Readonly<FrameDiffPolicy>;
  readonly stableMask?: Readonly<FrameStableMask>;
}

export interface PerceptualHeatmap {
  readonly columns: number;
  readonly rows: number;
  readonly values: readonly number[];
}

export interface DwellCalibrationOutput {
  readonly selectedPolicyVersion: string;
  readonly selectedDwellMs: number;
  readonly selectedThreshold: number;
  readonly baselineFrameCount: number;
  readonly noiseFloor: number;
  readonly observedDifference: number;
  readonly aboveNoiseFloor: boolean;
  readonly recommendation: "retain_selected_policy" | "review_dwell_or_threshold";
}

export interface FrameDiffValidationResult {
  readonly epochId: string;
  readonly policy: Readonly<FrameDiffPolicy>;
  readonly repeatedBaseline: true;
  readonly stableMaskApplied: boolean;
  readonly ssimStyleDifference: number;
  readonly noiseFloor: number;
  readonly frameHeatmap: Readonly<PerceptualHeatmap>;
  readonly laggardHeatmap: Readonly<PerceptualHeatmap>;
  readonly blindedRegionNotes: readonly Readonly<BlindedRegionNote>[];
  readonly dwellCalibration: Readonly<DwellCalibrationOutput>;
}

interface CapturedFrame {
  readonly width: number;
  readonly height: number;
  readonly luminance: Float32Array;
}

/**
 * Development-only perceptual validator. It records an explicit calibration
 * result and never mutates a LoadRecord or production policy object.
 */
export class FrameDiffValidator {
  readonly policy: Readonly<FrameDiffPolicy>;

  private readonly baselines = new Map<string, CapturedFrame[]>();
  private readonly captureCanvas: HTMLCanvasElement;
  private readonly captureContext: CanvasRenderingContext2D;
  private readonly mask: Uint8Array | undefined;

  constructor(private readonly options: Readonly<FrameDiffValidatorOptions>) {
    this.policy = Object.freeze({ ...(options.policy ?? DEFAULT_FRAME_DIFF_POLICY) });
    validatePolicy(this.policy);
    this.captureCanvas = document.createElement("canvas");
    this.captureCanvas.width = this.policy.downscaleWidth;
    this.captureCanvas.height = this.policy.downscaleHeight;
    const context = this.captureCanvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("FrameDiffValidator requires a 2D capture context");
    this.captureContext = context;
    this.mask = normalizeMask(options.stableMask, this.policy.downscaleWidth, this.policy.downscaleHeight);
  }

  captureConvergedFrame(epochId: string): number {
    this.assertStableEpoch(epochId);
    const frames = this.baselines.get(epochId) ?? [];
    frames.push(this.captureAfterExplicitRender());
    this.baselines.set(epochId, frames);
    return frames.length;
  }

  clearEpoch(epochId: string): void {
    this.baselines.delete(epochId);
  }

  validate(
    epochId: string,
    laggard: Readonly<LaggardMapResult>,
    blindedRegionNotes: readonly Readonly<BlindedRegionNote>[] = [],
  ): Readonly<FrameDiffValidationResult> {
    this.assertStableEpoch(epochId);
    const frames = this.baselines.get(epochId) ?? [];
    if (frames.length < this.policy.minimumConvergedFrames) {
      throw new Error(`FrameDiffValidator needs ${this.policy.minimumConvergedFrames} repeated converged frames; received ${frames.length}`);
    }
    const current = this.captureAfterExplicitRender();
    const reference = averageFrames(frames);
    const frameHeatmap = ssimHeatmap(current, reference, this.mask, this.policy.ssimWindowSize);
    const baselinePairDifferences = pairwiseDifferences(frames, this.mask, this.policy.ssimWindowSize);
    const noiseFloor = percentile(baselinePairDifferences, 0.95);
    const observedDifference = average(frameHeatmap.values);
    const aboveNoiseFloor = observedDifference > noiseFloor + this.policy.perceptualThreshold;
    const calibration: DwellCalibrationOutput = Object.freeze({
      selectedPolicyVersion: this.policy.version,
      selectedDwellMs: this.policy.dwellMs,
      selectedThreshold: this.policy.perceptualThreshold,
      baselineFrameCount: frames.length,
      noiseFloor,
      observedDifference,
      aboveNoiseFloor,
      recommendation: aboveNoiseFloor ? "review_dwell_or_threshold" : "retain_selected_policy",
    });
    return Object.freeze({
      epochId,
      policy: this.policy,
      repeatedBaseline: true,
      stableMaskApplied: this.mask !== undefined,
      ssimStyleDifference: observedDifference,
      noiseFloor,
      frameHeatmap,
      laggardHeatmap: laggardToHeatmap(laggard),
      blindedRegionNotes: Object.freeze(blindedRegionNotes.map((note) => Object.freeze({ ...note }))),
      dwellCalibration: calibration,
    });
  }

  renderSideBySide(result: Readonly<FrameDiffValidationResult>, container: HTMLElement): HTMLElement {
    const section = document.createElement("section");
    section.className = "frame-diff-comparison";
    const heading = document.createElement("h3");
    heading.textContent = `Frame validator — epoch ${result.epochId}`;
    section.append(heading);
    const row = document.createElement("div");
    row.style.display = "grid";
    row.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
    row.style.gap = "1rem";
    row.append(
      heatmapFigure("SSIM-style frame difference", result.frameHeatmap),
      heatmapFigure("LaggardMapper coarse-page likelihood", result.laggardHeatmap),
    );
    section.append(row);
    const calibration = document.createElement("pre");
    calibration.textContent = `dwell calibration=${JSON.stringify(result.dwellCalibration, null, 2)}`;
    section.append(calibration);
    if (result.blindedRegionNotes.length > 0) {
      const notes = document.createElement("pre");
      notes.textContent = `blinded region notes=${JSON.stringify(result.blindedRegionNotes, null, 2)}`;
      section.append(notes);
    }
    container.append(section);
    return section;
  }

  private assertStableEpoch(epochId: string): void {
    if (!epochId || !this.options.isStableEpoch(epochId)) {
      throw new Error("FrameDiffValidator captures are allowed only within the named stable camera epoch");
    }
  }

  private captureAfterExplicitRender(): CapturedFrame {
    // This synchronous render is intentional: rAF may be suspended in hidden tabs.
    this.options.renderer.render(this.options.scene, this.options.camera);
    this.captureContext.clearRect(0, 0, this.captureCanvas.width, this.captureCanvas.height);
    this.captureContext.drawImage(
      this.options.renderer.domElement,
      0,
      0,
      this.captureCanvas.width,
      this.captureCanvas.height,
    );
    const rgba = this.captureContext.getImageData(0, 0, this.captureCanvas.width, this.captureCanvas.height).data;
    const luminance = new Float32Array(this.captureCanvas.width * this.captureCanvas.height);
    for (let pixel = 0; pixel < luminance.length; pixel += 1) {
      const offset = pixel * 4;
      luminance[pixel] = (0.2126 * rgba[offset] + 0.7152 * rgba[offset + 1] + 0.0722 * rgba[offset + 2]) / 255;
    }
    return Object.freeze({ width: this.captureCanvas.width, height: this.captureCanvas.height, luminance });
  }
}

function ssimHeatmap(
  sample: Readonly<CapturedFrame>,
  reference: Readonly<CapturedFrame>,
  mask: Uint8Array | undefined,
  windowSize: number,
): Readonly<PerceptualHeatmap> {
  if (sample.width !== reference.width || sample.height !== reference.height) throw new Error("Frame dimensions differ");
  const columns = Math.ceil(sample.width / windowSize);
  const rows = Math.ceil(sample.height / windowSize);
  const values: number[] = [];
  const c1 = 0.01 ** 2;
  const c2 = 0.03 ** 2;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const sampleValues: number[] = [];
      const referenceValues: number[] = [];
      for (let y = row * windowSize; y < Math.min(sample.height, (row + 1) * windowSize); y += 1) {
        for (let x = column * windowSize; x < Math.min(sample.width, (column + 1) * windowSize); x += 1) {
          const index = y * sample.width + x;
          if (mask && mask[index] === 0) continue;
          sampleValues.push(sample.luminance[index]);
          referenceValues.push(reference.luminance[index]);
        }
      }
      if (sampleValues.length === 0) {
        values.push(0);
        continue;
      }
      const meanSample = average(sampleValues);
      const meanReference = average(referenceValues);
      let varianceSample = 0;
      let varianceReference = 0;
      let covariance = 0;
      for (let index = 0; index < sampleValues.length; index += 1) {
        const sampleDelta = sampleValues[index] - meanSample;
        const referenceDelta = referenceValues[index] - meanReference;
        varianceSample += sampleDelta * sampleDelta;
        varianceReference += referenceDelta * referenceDelta;
        covariance += sampleDelta * referenceDelta;
      }
      const divisor = Math.max(1, sampleValues.length - 1);
      varianceSample /= divisor;
      varianceReference /= divisor;
      covariance /= divisor;
      const similarity = ((2 * meanSample * meanReference + c1) * (2 * covariance + c2))
        / ((meanSample ** 2 + meanReference ** 2 + c1) * (varianceSample + varianceReference + c2));
      values.push(clamp(1 - similarity, 0, 1));
    }
  }
  return Object.freeze({ columns, rows, values: Object.freeze(values) });
}

function averageFrames(frames: readonly Readonly<CapturedFrame>[]): CapturedFrame {
  const first = frames[0];
  const luminance = new Float32Array(first.luminance.length);
  for (const frame of frames) {
    if (frame.width !== first.width || frame.height !== first.height) throw new Error("Baseline frame dimensions differ");
    for (let index = 0; index < luminance.length; index += 1) luminance[index] += frame.luminance[index] / frames.length;
  }
  return Object.freeze({ width: first.width, height: first.height, luminance });
}

function pairwiseDifferences(frames: readonly Readonly<CapturedFrame>[], mask: Uint8Array | undefined, windowSize: number): number[] {
  const differences: number[] = [];
  for (let left = 0; left < frames.length; left += 1) {
    for (let right = left + 1; right < frames.length; right += 1) {
      differences.push(average(ssimHeatmap(frames[left], frames[right], mask, windowSize).values));
    }
  }
  return differences;
}

function laggardToHeatmap(laggard: Readonly<LaggardMapResult>): Readonly<PerceptualHeatmap> {
  const values = new Array<number>(laggard.gridColumns * laggard.gridRows).fill(0);
  for (const cell of laggard.cells) values[cell.row * laggard.gridColumns + cell.column] = clamp(cell.coarsePageLikelihood, 0, 1);
  return Object.freeze({ columns: laggard.gridColumns, rows: laggard.gridRows, values: Object.freeze(values) });
}

function heatmapFigure(label: string, heatmap: Readonly<PerceptualHeatmap>): HTMLElement {
  const figure = document.createElement("figure");
  const caption = document.createElement("figcaption");
  caption.textContent = label;
  const canvas = document.createElement("canvas");
  canvas.width = heatmap.columns;
  canvas.height = heatmap.rows;
  canvas.style.width = "100%";
  canvas.style.imageRendering = "pixelated";
  const context = canvas.getContext("2d");
  if (context) {
    const image = context.createImageData(heatmap.columns, heatmap.rows);
    heatmap.values.forEach((value, index) => {
      const color = heatColor(value);
      image.data[index * 4] = color[0];
      image.data[index * 4 + 1] = color[1];
      image.data[index * 4 + 2] = color[2];
      image.data[index * 4 + 3] = 255;
    });
    context.putImageData(image, 0, 0);
  }
  figure.append(caption, canvas);
  return figure;
}

function normalizeMask(mask: Readonly<FrameStableMask> | undefined, width: number, height: number): Uint8Array | undefined {
  if (!mask) return undefined;
  if (mask.width !== width || mask.height !== height || mask.values.length !== width * height) {
    throw new Error("Stable mask dimensions must match the downscaled capture dimensions");
  }
  return new Uint8Array(mask.values);
}

function validatePolicy(policy: Readonly<FrameDiffPolicy>): void {
  if (!policy.version || policy.dwellMs < 0 || policy.perceptualThreshold < 0 || policy.perceptualThreshold > 1) {
    throw new Error("FrameDiffValidator policy is invalid");
  }
  for (const value of [policy.downscaleWidth, policy.downscaleHeight, policy.minimumConvergedFrames, policy.ssimWindowSize]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error("FrameDiffValidator dimensions and counts must be positive integers");
  }
  if (policy.minimumConvergedFrames < 3) throw new Error("Noise-floor calibration requires at least three repeated converged frames");
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))];
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function heatColor(value: number): readonly [number, number, number] {
  const normalized = clamp(value, 0, 1);
  return [Math.round(255 * normalized), Math.round(180 * (1 - Math.abs(normalized * 2 - 1))), Math.round(255 * (1 - normalized))];
}
