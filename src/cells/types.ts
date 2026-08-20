export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export type Sha256Digest = `sha256:${string}`;
export type SourceSha256 = string;

export interface GroundBasis {
  origin: Vec3;
  u: Vec3;
  v: Vec3;
}

export interface ManifestFrame {
  up: Vec3;
  groundBasis: GroundBasis;
}

export type SourceFileRole = "cameras" | "images" | "points3D";

export interface SourceFile<Role extends SourceFileRole = SourceFileRole> {
  role: Role;
  name: string;
  format: string;
  sha256: SourceSha256;
}

export type SourceFiles = [
  SourceFile<"cameras">,
  SourceFile<"images">,
  SourceFile<"points3D">,
];

export interface ManifestSource {
  colmapPath: string;
  imagesPath: string;
  imageCount: number;
  pointCount: number;
  files: SourceFiles;
  datasetHash: Sha256Digest;
}

export interface CellOverlap {
  fraction: number;
}

export interface DedicatedCellFarField {
  policy: "dedicated-cell";
  backgroundCellId: string;
}

export type FarField = DedicatedCellFarField;

export interface TrainerSettings {
  centralize: "off";
}

export interface AbsoluteCountThreshold {
  mode: "absoluteCount";
  value: number;
}

export interface AssignmentSettings {
  visibility: "tracks" | "frustum";
  default: AbsoluteCountThreshold;
  perSensor: Record<string, AbsoluteCountThreshold>;
  guaranteeCoverage?: boolean;
}

export interface PlanningSettings {
  defaultOverlap: CellOverlap;
  cropFeather: number;
  farField: FarField;
  trainer: TrainerSettings;
  assignment?: AssignmentSettings;
}

export interface Ownership {
  rule: "interior-then-nearest";
  tieBreak: "lowest-cell-id";
  exteriorOwner: string;
  exteriorCutoff: number;
}

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface CellCameras {
  assigned: string[];
  reasons: Record<string, string>;
  manualOverrides: JsonValue[];
}

export interface SeedPoints {
  count: number;
}

interface CellBase {
  id: string;
  overlap: CellOverlap;
  cameras: CellCameras;
  seedPoints: SeedPoints;
}

export interface FootprintCell extends CellBase {
  kind: "footprint";
  polygon2d: Vec2[];
  heightRange: [number, number];
}

export interface VolumeCell extends CellBase {
  kind: "volume";
  box: {
    center: Vec3;
    size: Vec3;
    rotationDeg: Vec3;
  };
  precedence: number;
}

export type Cell = FootprintCell | VolumeCell;

export interface PlanningSection {
  settings: PlanningSettings;
  ownership: Ownership;
  cells: Cell[];
}

export interface SplitCell {
  path: string;
  datasetHash: Sha256Digest;
}

export interface SplitSection {
  planningHash: Sha256Digest;
  cells: Record<string, SplitCell>;
}

export interface TrainingCell {
  output: string;
  command: string;
  completed: boolean;
  outputHash?: Sha256Digest;
}

export interface TrainingSection {
  splitHash: Sha256Digest;
  cells: Record<string, TrainingCell>;
}

export interface CompositionCell {
  cropped: string;
  croppedHash: Sha256Digest;
  kept: number;
  dropped: number;
}

export interface VerificationPair {
  median: number;
  p90: number;
  samplesA: number;
  samplesB: number;
}

export interface CompositionVerification {
  passed: boolean;
  pairs: Record<string, VerificationPair>;
}

export interface BakeArtifact {
  path: string;
  hash: Sha256Digest;
  propertyList: string[];
  partial: boolean;
}

export interface CompositionSection {
  trainingHash: Sha256Digest;
  ownership: Ownership;
  cropFeather: number;
  partial: boolean;
  omittedCells: string[];
  cells: Record<string, CompositionCell>;
  verify: CompositionVerification;
  bake?: BakeArtifact;
}

export interface CellsManifest {
  version: 2;
  frame: ManifestFrame;
  source: ManifestSource;
  planning: PlanningSection;
  split?: SplitSection;
  training?: TrainingSection;
  composition?: CompositionSection;
}
