export const DEFAULT_CONVERGENCE_POLICY = Object.freeze({
  version: "1",
  recentWindowMs: 1_000,
  stallWindowMs: 10_000,
  maxForegroundObservationMs: 120_000,
  candidateDwellMs: 2_000,
  maxObservationGapMs: 500,
} as const);

export const DEFAULT_CAMERA_EPOCH_POLICY = Object.freeze({
  version: "1",
  stableEpochMinimumMs: 1_500,
  translationCameraToPivotRatio: 0.01,
  rotationDegrees: 1,
  verticalFovDegrees: 1,
  viewportCssPx: 2,
  viewportRatio: 0.01,
  dpr: 0.05,
  foveation: 0.02,
  consecutiveMotionObservations: 2,
  stabilityResumeMs: 500,
  stabilityMedianWindowMs: 500,
  stabilityThresholdRatio: 0.5,
} as const);

export const DEFAULT_SAMPLING_POLICY = Object.freeze({
  version: "1",
  optionalCpuMsPerRenderedFrame: 0.5,
  optionalCpuMsPerWindow: 50,
  foregroundWindowMs: 5_000,
} as const);

export const DEFAULT_SPATIAL_POLICY = Object.freeze({
  version: "1",
  gridColumns: 32,
  gridRows: 18,
} as const);

export const DEFAULT_RECORD_CAP_POLICY = Object.freeze({
  version: "1",
  rawBytes: 4 * 1024 * 1024,
  totalBytes: 8 * 1024 * 1024,
} as const);

export const DEFAULT_STORAGE_POLICY = Object.freeze({
  version: "1",
  maxRecords: 50,
  maxBytes: 25 * 1024 * 1024,
  memoryFallbackMaxRecords: 5,
  memoryFallbackMaxBytes: 5 * 1024 * 1024,
} as const);

export const DEFAULT_BEACON_POLICY = Object.freeze({
  version: "1",
  maxEnvelopeBytesExclusive: 48 * 1024,
} as const);

export const DEFAULT_PRIVACY_POLICY = Object.freeze({
  version: "1",
  sceneIdMaxCharacters: 64,
  deviceMemoryGiBUpperBounds: Object.freeze([2, 4, 8] as const),
  logicalCoreUpperBounds: Object.freeze([2, 4, 8] as const),
  dprBucketStep: 0.25,
  viewportBandCssPx: 200,
} as const);

export type ConvergencePolicy = Readonly<typeof DEFAULT_CONVERGENCE_POLICY>;
export type CameraEpochPolicy = Readonly<typeof DEFAULT_CAMERA_EPOCH_POLICY>;
export type SamplingPolicy = Readonly<typeof DEFAULT_SAMPLING_POLICY>;
export type SpatialPolicy = Readonly<typeof DEFAULT_SPATIAL_POLICY>;
export type RecordCapPolicy = Readonly<typeof DEFAULT_RECORD_CAP_POLICY>;
export type StoragePolicy = Readonly<typeof DEFAULT_STORAGE_POLICY>;
export type BeaconPolicy = Readonly<typeof DEFAULT_BEACON_POLICY>;
export type PrivacyPolicy = Readonly<typeof DEFAULT_PRIVACY_POLICY>;
