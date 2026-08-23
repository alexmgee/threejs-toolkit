import { DEFAULT_PRIVACY_POLICY, type PrivacyPolicy } from "./policies";

export type DeviceMemoryBucket = "≤2" | "4" | "8" | ">8" | "unknown";
export type LogicalCoreBucket = "≤2" | "4" | "6–8" | ">8" | "unknown";
export type ConnectionBucket = "slow-2g" | "2g" | "3g" | "4g" | "unknown";
export type GpuVendorClass = "amd" | "apple" | "arm" | "imagination" | "intel" | "nvidia" | "qualcomm" | "software" | "other" | "unknown";
export type GpuRendererClass = "discrete" | "integrated" | "mobile" | "software" | "other" | "unknown";
export type GpuCapabilityTier = "low" | "medium" | "high" | "unknown";

export interface GpuBucket {
  vendorClass: GpuVendorClass;
  rendererClass: GpuRendererClass;
  capabilityTier: GpuCapabilityTier;
}

export interface DprBucketPolicy {
  readonly version: string;
  readonly dprBucketStep: number;
  readonly dprCap: number;
}

export interface ViewportBucket {
  widthBandCssPx: number;
  heightBandCssPx: number;
}

export function sanitizeSceneId(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, DEFAULT_PRIVACY_POLICY.sceneIdMaxCharacters);
}

export function stripSceneUrl(raw: string, base?: string): string {
  const url = new URL(raw, base);
  return `${url.origin}${url.pathname}`;
}

export function bucketGpu(rawVendor: string | undefined, rawRenderer: string | undefined, capabilityTier: GpuCapabilityTier): GpuBucket {
  const combined = `${rawVendor ?? ""} ${rawRenderer ?? ""}`.toLowerCase();
  const vendorClass: GpuVendorClass =
    classifyToken(combined, "nvidia") ??
    classifyToken(combined, "intel") ??
    classifyToken(combined, "apple") ??
    classifyToken(combined, "qualcomm", "adreno") ??
    classifyToken(combined, "arm", "mali") ??
    classifyToken(combined, "imagination", "powervr") ??
    classifyToken(combined, "amd", "ati", "radeon") ??
    classifyToken(combined, "software", "swiftshader", "llvmpipe") ??
    (combined.trim() ? "other" : "unknown");
  const rendererClass: GpuRendererClass =
    /swiftshader|llvmpipe|software/.test(combined) ? "software" :
    /adreno|mali|powervr/.test(combined) ? "mobile" :
    /intel|apple/.test(combined) ? "integrated" :
    /nvidia|amd|ati|radeon/.test(combined) ? "discrete" :
    combined.trim() ? "other" : "unknown";
  return Object.freeze({ vendorClass, rendererClass, capabilityTier });
}

export function bucketDeviceMemory(gib: number | undefined, policy: PrivacyPolicy = DEFAULT_PRIVACY_POLICY): DeviceMemoryBucket {
  if (gib === undefined || !Number.isFinite(gib) || gib < 0) return "unknown";
  const [low, medium, high] = policy.deviceMemoryGiBUpperBounds;
  if (gib <= low) return "≤2";
  if (gib <= medium) return "4";
  if (gib <= high) return "8";
  return ">8";
}

export function bucketLogicalCores(cores: number | undefined, policy: PrivacyPolicy = DEFAULT_PRIVACY_POLICY): LogicalCoreBucket {
  if (cores === undefined || !Number.isFinite(cores) || cores < 0) return "unknown";
  const [low, medium, high] = policy.logicalCoreUpperBounds;
  if (cores <= low) return "≤2";
  if (cores <= medium) return "4";
  if (cores <= high) return "6–8";
  return ">8";
}

export function bucketDpr(dpr: number | undefined, policy: DprBucketPolicy): number | "unknown" {
  if (dpr === undefined || !Number.isFinite(dpr) || dpr < 0) return "unknown";
  const capped = Math.min(dpr, policy.dprCap);
  return Math.round(capped / policy.dprBucketStep) * policy.dprBucketStep;
}

export function bucketViewport(widthCssPx: number, heightCssPx: number, policy: PrivacyPolicy = DEFAULT_PRIVACY_POLICY): ViewportBucket {
  return Object.freeze({
    widthBandCssPx: bandLowerBound(widthCssPx, policy.viewportBandCssPx),
    heightBandCssPx: bandLowerBound(heightCssPx, policy.viewportBandCssPx),
  });
}

export function bucketConnection(effectiveType: string | undefined): ConnectionBucket {
  switch (effectiveType) {
    case "slow-2g":
    case "2g":
    case "3g":
    case "4g":
      return effectiveType;
    default:
      return "unknown";
  }
}

function classifyToken(value: string, result: GpuVendorClass, ...tokens: readonly string[]): GpuVendorClass | undefined {
  return [result, ...tokens].some((token) => value.includes(token)) ? result : undefined;
}

function bandLowerBound(value: number, bandSize: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value / bandSize) * bandSize;
}
