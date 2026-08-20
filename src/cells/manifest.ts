import { polygonsOverlap } from "./geometry";
import type {
  AbsoluteCountThreshold,
  AssignmentSettings,
  Cell,
  CellCameras,
  CellsManifest,
  CompositionSection,
  JsonValue,
  ManifestFrame,
  ManifestSource,
  Ownership,
  PlanningSection,
  Sha256Digest,
  SourceFiles,
  SplitSection,
  TrainingSection,
  Vec2,
  Vec3,
} from "./types";

export type ManifestErrorCode =
  | "ABSOLUTE_ARTIFACT_PATH"
  | "INVALID_HASH_RESULT"
  | "INVALID_JSON"
  | "INVALID_MANIFEST"
  | "MISSING_FAR_FIELD_PARAM"
  | "OVERLAPPING_FOOTPRINT_INTERIORS"
  | "STALE_DATASET_HASH"
  | "STALE_UPSTREAM_HASH";

export type JcsErrorCode =
  | "INVALID_UNICODE"
  | "NON_FINITE_NUMBER"
  | "UNSUPPORTED_JCS_VALUE";

export class ManifestError extends Error {
  readonly code: ManifestErrorCode;

  constructor(code: ManifestErrorCode, message: string) {
    super(message);
    this.name = "ManifestError";
    this.code = code;
  }
}

export class JcsError extends Error {
  readonly code: JcsErrorCode;

  constructor(code: JcsErrorCode, message: string) {
    super(message);
    this.name = "JcsError";
    this.code = code;
  }
}

export type HashResult = string | ArrayBuffer | Uint8Array;
export type ManifestHashFunction = (bytes: Uint8Array) => HashResult | Promise<HashResult>;

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SOURCE_SHA256_PATTERN = /^[0-9a-f]{64}$/;

function assertValidUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        throw new JcsError("INVALID_UNICODE", "JCS strings must not contain lone surrogates");
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new JcsError("INVALID_UNICODE", "JCS strings must not contain lone surrogates");
    }
  }
}

function canonicalize(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new JcsError("NON_FINITE_NUMBER", "JCS cannot serialize non-finite numbers");
    }
    return String(value);
  }
  if (typeof value === "string") {
    assertValidUnicode(value);
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new JcsError("UNSUPPORTED_JCS_VALUE", `JCS cannot serialize ${typeof value}`);
  }
  if (ancestors.has(value)) {
    throw new JcsError("UNSUPPORTED_JCS_VALUE", "JCS cannot serialize cyclic values");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) {
          throw new JcsError("UNSUPPORTED_JCS_VALUE", "JCS cannot serialize sparse arrays");
        }
        items.push(canonicalize(value[index], ancestors));
      }
      return `[${items.join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new JcsError("UNSUPPORTED_JCS_VALUE", "JCS accepts plain JSON objects only");
    }

    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => {
        assertValidUnicode(key);
        return `${JSON.stringify(key)}:${canonicalize(record[key], ancestors)}`;
      });
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

/** RFC 8785 JSON Canonicalization Scheme serialization. */
export function jcsCanonicalize(value: unknown): string {
  return canonicalize(value, new Set());
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

function normalizeHashResult(result: HashResult): Sha256Digest {
  if (typeof result === "string") {
    const normalized = result.toLowerCase();
    if (SOURCE_SHA256_PATTERN.test(normalized)) return `sha256:${normalized}`;
    if (SHA256_PATTERN.test(normalized)) return normalized as Sha256Digest;
  } else {
    const bytes = result instanceof Uint8Array ? result : new Uint8Array(result);
    if (bytes.byteLength === 32) return `sha256:${bytesToHex(bytes)}`;
  }
  throw new ManifestError("INVALID_HASH_RESULT", "Hash function must return a 32-byte or SHA-256 hex digest");
}

async function hashBytes(bytes: Uint8Array, hash: ManifestHashFunction): Promise<Sha256Digest> {
  return normalizeHashResult(await hash(bytes));
}

export async function hashJcs(value: unknown, hash: ManifestHashFunction): Promise<Sha256Digest> {
  return hashBytes(new TextEncoder().encode(jcsCanonicalize(value)), hash);
}

export async function hashSection(
  section: PlanningSection | SplitSection | TrainingSection | CompositionSection,
  hash: ManifestHashFunction,
): Promise<Sha256Digest> {
  return hashJcs(section, hash);
}

export async function hashSourceFiles(
  files: SourceFiles,
  hash: ManifestHashFunction,
): Promise<Sha256Digest> {
  return hashBytes(new TextEncoder().encode(files.map((file) => file.sha256).join("")), hash);
}

function fail(message: string): never {
  throw new ManifestError("INVALID_MANIFEST", message);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string") return fail(`${path} must be a string`);
  return value;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") return fail(`${path} must be a boolean`);
  return value;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail(`${path} must be a finite number`);
  }
  return value;
}

function nonNegativeNumber(value: unknown, path: string): number {
  const number = finiteNumber(value, path);
  if (number < 0) return fail(`${path} must be non-negative`);
  return number;
}

function nonNegativeInteger(value: unknown, path: string): number {
  const number = nonNegativeNumber(value, path);
  if (!Number.isInteger(number)) return fail(`${path} must be an integer`);
  return number;
}

function arrayValue(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) return fail(`${path} must be an array`);
  return value;
}

function vec2(value: unknown, path: string): Vec2 {
  const values = arrayValue(value, path);
  if (values.length !== 2) return fail(`${path} must have two coordinates`);
  return [finiteNumber(values[0], `${path}[0]`), finiteNumber(values[1], `${path}[1]`)];
}

function vec3(value: unknown, path: string): Vec3 {
  const values = arrayValue(value, path);
  if (values.length !== 3) return fail(`${path} must have three coordinates`);
  return [
    finiteNumber(values[0], `${path}[0]`),
    finiteNumber(values[1], `${path}[1]`),
    finiteNumber(values[2], `${path}[2]`),
  ];
}

function hashDigest(value: unknown, path: string): Sha256Digest {
  const digest = stringValue(value, path);
  if (!SHA256_PATTERN.test(digest)) return fail(`${path} must be a lowercase sha256: digest`);
  return digest as Sha256Digest;
}

function sourceHash(value: unknown, path: string): string {
  const digest = stringValue(value, path);
  if (!SOURCE_SHA256_PATTERN.test(digest)) return fail(`${path} must be a lowercase SHA-256 hex digest`);
  return digest;
}

function isAbsoluteArtifactPath(path: string): boolean {
  return (
    path.startsWith("/") ||
    path.startsWith("\\") ||
    /^[a-zA-Z]:[\\/]/.test(path) ||
    /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(path)
  );
}

function artifactPath(value: unknown, path: string): string {
  const locator = stringValue(value, path);
  if (isAbsoluteArtifactPath(locator)) {
    throw new ManifestError("ABSOLUTE_ARTIFACT_PATH", `${path} must be manifest-relative`);
  }
  return locator;
}

function stringArray(value: unknown, path: string): string[] {
  return arrayValue(value, path).map((entry, index) => stringValue(entry, `${path}[${index}]`));
}

function validateJsonValue(value: unknown, path: string): JsonValue {
  try {
    jcsCanonicalize(value);
  } catch (error) {
    if (error instanceof JcsError) return fail(`${path} is not a JSON value: ${error.message}`);
    throw error;
  }
  return value as JsonValue;
}

function validateFrame(value: unknown): ManifestFrame {
  const frame = record(value, "frame");
  const basis = record(frame.groundBasis, "frame.groundBasis");
  return {
    up: vec3(frame.up, "frame.up"),
    groundBasis: {
      origin: vec3(basis.origin, "frame.groundBasis.origin"),
      u: vec3(basis.u, "frame.groundBasis.u"),
      v: vec3(basis.v, "frame.groundBasis.v"),
    },
  };
}

function validateSource(value: unknown): ManifestSource {
  const source = record(value, "source");
  const rawFiles = arrayValue(source.files, "source.files");
  if (rawFiles.length !== 3) return fail("source.files must contain cameras, images, and points3D");
  const expectedRoles = ["cameras", "images", "points3D"] as const;
  const files = rawFiles.map((value, index) => {
    const file = record(value, `source.files[${index}]`);
    const role = stringValue(file.role, `source.files[${index}].role`);
    if (role !== expectedRoles[index]) {
      return fail(`source.files[${index}].role must be ${expectedRoles[index]}`);
    }
    return {
      role,
      name: artifactPath(file.name, `source.files[${index}].name`),
      format: stringValue(file.format, `source.files[${index}].format`),
      sha256: sourceHash(file.sha256, `source.files[${index}].sha256`),
    };
  }) as SourceFiles;

  return {
    colmapPath: artifactPath(source.colmapPath, "source.colmapPath"),
    imagesPath: artifactPath(source.imagesPath, "source.imagesPath"),
    imageCount: nonNegativeInteger(source.imageCount, "source.imageCount"),
    pointCount: nonNegativeInteger(source.pointCount, "source.pointCount"),
    files,
    datasetHash: hashDigest(source.datasetHash, "source.datasetHash"),
  };
}

function validateOwnership(value: unknown, path: string): Ownership {
  const ownership = record(value, path);
  if (ownership.rule !== "interior-then-nearest") return fail(`${path}.rule is unsupported`);
  if (ownership.tieBreak !== "lowest-cell-id") return fail(`${path}.tieBreak is unsupported`);
  return {
    rule: "interior-then-nearest",
    tieBreak: "lowest-cell-id",
    exteriorOwner: stringValue(ownership.exteriorOwner, `${path}.exteriorOwner`),
    exteriorCutoff: nonNegativeNumber(ownership.exteriorCutoff, `${path}.exteriorCutoff`),
  };
}

function validateOverlap(value: unknown, path: string): { fraction: number } {
  const overlap = record(value, path);
  return { fraction: nonNegativeNumber(overlap.fraction, `${path}.fraction`) };
}

/**
 * Reject keys this validator does not model.
 *
 * Validation here REBUILDS each section from a fixed set of fields, so an
 * unmodelled key is silently dropped from the normalised output — while the
 * Python CLI hashes the RAW dict (`scene_cells/split.py:26`,
 * `scene_cells/manifest.py:344`). The two then disagree on `planningHash` and a
 * valid manifest is rejected with STALE_UPSTREAM_HASH. That is precisely the
 * bug `planning.settings.assignment` caused before it was modelled here, so on
 * these sections an unknown key fails loudly rather than corrupting a hash.
 *
 * NOT applied to `split` yet: the Python splitter writes
 * `split.cells[].imageFiles`, which `SplitCell` does not model, so a strict
 * check there would reject real post-split manifests. Model that field first.
 */
function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return fail(`${path} has an unsupported key: ${key}`);
  }
}

function validateAssignmentThreshold(value: unknown, path: string): AbsoluteCountThreshold {
  const threshold = record(value, path);
  rejectUnknownKeys(threshold, ["mode", "value"], path);
  if (threshold.mode !== "absoluteCount") return fail(`${path}.mode must be absoluteCount`);
  return {
    mode: "absoluteCount",
    value: nonNegativeNumber(threshold.value, `${path}.value`),
  };
}

function validateAssignment(value: unknown, path: string): AssignmentSettings {
  const assignment = record(value, path);
  rejectUnknownKeys(assignment, ["visibility", "default", "perSensor", "guaranteeCoverage"], path);
  if (assignment.visibility !== "tracks" && assignment.visibility !== "frustum") {
    return fail(`${path}.visibility must be tracks or frustum`);
  }
  const rawPerSensor = record(assignment.perSensor, `${path}.perSensor`);
  const perSensor: AssignmentSettings["perSensor"] = {};
  for (const [sensor, threshold] of Object.entries(rawPerSensor)) {
    perSensor[sensor] = validateAssignmentThreshold(threshold, `${path}.perSensor.${sensor}`);
  }
  const validated: AssignmentSettings = {
    visibility: assignment.visibility,
    default: validateAssignmentThreshold(assignment.default, `${path}.default`),
    perSensor,
  };
  if (assignment.guaranteeCoverage !== undefined) {
    validated.guaranteeCoverage = booleanValue(
      assignment.guaranteeCoverage,
      `${path}.guaranteeCoverage`,
    );
  }
  return validated;
}

function validateCameras(value: unknown, path: string): CellCameras {
  const cameras = record(value, path);
  const rawReasons = record(cameras.reasons, `${path}.reasons`);
  const reasons: Record<string, string> = {};
  for (const [image, reason] of Object.entries(rawReasons)) {
    reasons[image] = stringValue(reason, `${path}.reasons.${image}`);
  }
  return {
    assigned: stringArray(cameras.assigned, `${path}.assigned`),
    reasons,
    manualOverrides: arrayValue(cameras.manualOverrides, `${path}.manualOverrides`).map((entry, index) =>
      validateJsonValue(entry, `${path}.manualOverrides[${index}]`),
    ),
  };
}

function validateCell(value: unknown, index: number): Cell {
  const path = `planning.cells[${index}]`;
  const cell = record(value, path);
  const base = {
    id: stringValue(cell.id, `${path}.id`),
    overlap: validateOverlap(cell.overlap, `${path}.overlap`),
    cameras: validateCameras(cell.cameras, `${path}.cameras`),
    seedPoints: {
      count: nonNegativeInteger(record(cell.seedPoints, `${path}.seedPoints`).count, `${path}.seedPoints.count`),
    },
  };

  if (cell.kind === "footprint") {
    const polygon2d = arrayValue(cell.polygon2d, `${path}.polygon2d`).map((point, pointIndex) =>
      vec2(point, `${path}.polygon2d[${pointIndex}]`),
    );
    if (polygon2d.length < 3) return fail(`${path}.polygon2d must contain at least three vertices`);
    const heightRange = arrayValue(cell.heightRange, `${path}.heightRange`);
    if (heightRange.length !== 2) return fail(`${path}.heightRange must contain two values`);
    const low = finiteNumber(heightRange[0], `${path}.heightRange[0]`);
    const high = finiteNumber(heightRange[1], `${path}.heightRange[1]`);
    if (low >= high) return fail(`${path}.heightRange must be increasing`);
    return { ...base, kind: "footprint", polygon2d, heightRange: [low, high] };
  }

  if (cell.kind === "volume") {
    const box = record(cell.box, `${path}.box`);
    const size = vec3(box.size, `${path}.box.size`);
    if (size.some((dimension) => dimension <= 0)) return fail(`${path}.box.size must be positive`);
    return {
      ...base,
      kind: "volume",
      box: {
        center: vec3(box.center, `${path}.box.center`),
        size,
        rotationDeg: vec3(box.rotationDeg, `${path}.box.rotationDeg`),
      },
      precedence: finiteNumber(cell.precedence, `${path}.precedence`),
    };
  }

  return fail(`${path}.kind must be footprint or volume`);
}

function validatePlanning(value: unknown): PlanningSection {
  const planning = record(value, "planning");
  const settings = record(planning.settings, "planning.settings");
  rejectUnknownKeys(
    settings,
    ["defaultOverlap", "cropFeather", "farField", "trainer", "assignment"],
    "planning.settings",
  );
  const assignment = settings.assignment === undefined
    ? undefined
    : validateAssignment(settings.assignment, "planning.settings.assignment");
  if (
    settings.farField === null ||
    typeof settings.farField !== "object" ||
    Array.isArray(settings.farField)
  ) {
    throw new ManifestError(
      "MISSING_FAR_FIELD_PARAM",
      "planning.settings.farField requires policy and backgroundCellId",
    );
  }
  const farField = record(settings.farField, "planning.settings.farField");
  if (!("policy" in farField) || !("backgroundCellId" in farField)) {
    throw new ManifestError(
      "MISSING_FAR_FIELD_PARAM",
      "planning.settings.farField requires policy and backgroundCellId",
    );
  }
  if (farField.policy !== "dedicated-cell") return fail("planning.settings.farField.policy is unsupported");
  const trainer = record(settings.trainer, "planning.settings.trainer");
  if (trainer.centralize !== "off") return fail("planning.settings.trainer.centralize must be off");
  const cells = arrayValue(planning.cells, "planning.cells").map(validateCell);
  const ids = new Set<string>();
  for (const cell of cells) {
    if (ids.has(cell.id)) return fail(`planning.cells contains duplicate id ${cell.id}`);
    ids.add(cell.id);
  }

  const footprintCells = cells.filter((cell) => cell.kind === "footprint");
  for (let first = 0; first < footprintCells.length; first += 1) {
    for (let second = first + 1; second < footprintCells.length; second += 1) {
      if (polygonsOverlap(footprintCells[first].polygon2d, footprintCells[second].polygon2d)) {
        throw new ManifestError(
          "OVERLAPPING_FOOTPRINT_INTERIORS",
          `Footprint interiors overlap: ${footprintCells[first].id} and ${footprintCells[second].id}`,
        );
      }
    }
  }

  const ownership = validateOwnership(planning.ownership, "planning.ownership");
  const backgroundCellId = stringValue(
    farField.backgroundCellId,
    "planning.settings.farField.backgroundCellId",
  );
  if (!ids.has(backgroundCellId)) return fail("far-field backgroundCellId must reference a planning cell");
  if (!ids.has(ownership.exteriorOwner)) return fail("ownership.exteriorOwner must reference a planning cell");

  return {
    settings: {
      defaultOverlap: validateOverlap(settings.defaultOverlap, "planning.settings.defaultOverlap"),
      cropFeather: nonNegativeNumber(settings.cropFeather, "planning.settings.cropFeather"),
      farField: { policy: "dedicated-cell", backgroundCellId },
      trainer: { centralize: "off" },
      ...(assignment === undefined ? {} : { assignment }),
    },
    ownership,
    cells,
  };
}

function validateSplit(value: unknown): SplitSection {
  const split = record(value, "split");
  const rawCells = record(split.cells, "split.cells");
  const cells: SplitSection["cells"] = {};
  for (const [id, rawCell] of Object.entries(rawCells)) {
    const cell = record(rawCell, `split.cells.${id}`);
    cells[id] = {
      path: artifactPath(cell.path, `split.cells.${id}.path`),
      datasetHash: hashDigest(cell.datasetHash, `split.cells.${id}.datasetHash`),
    };
  }
  return { planningHash: hashDigest(split.planningHash, "split.planningHash"), cells };
}

function validateTraining(value: unknown): TrainingSection {
  const training = record(value, "training");
  const rawCells = record(training.cells, "training.cells");
  const cells: TrainingSection["cells"] = {};
  for (const [id, rawCell] of Object.entries(rawCells)) {
    const cell = record(rawCell, `training.cells.${id}`);
    const completed = booleanValue(cell.completed, `training.cells.${id}.completed`);
    if (completed && cell.outputHash === undefined) {
      return fail(`training.cells.${id}.outputHash is required when completed`);
    }
    cells[id] = {
      output: artifactPath(cell.output, `training.cells.${id}.output`),
      command: stringValue(cell.command, `training.cells.${id}.command`),
      completed,
      ...(cell.outputHash === undefined
        ? {}
        : { outputHash: hashDigest(cell.outputHash, `training.cells.${id}.outputHash`) }),
    };
  }
  return { splitHash: hashDigest(training.splitHash, "training.splitHash"), cells };
}

function validateComposition(value: unknown, planningOwnership: Ownership): CompositionSection {
  const composition = record(value, "composition");
  const ownership = validateOwnership(composition.ownership, "composition.ownership");
  if (jcsCanonicalize(ownership) !== jcsCanonicalize(planningOwnership)) {
    return fail("composition.ownership must copy planning.ownership verbatim");
  }

  const rawCells = record(composition.cells, "composition.cells");
  const cells: CompositionSection["cells"] = {};
  for (const [id, rawCell] of Object.entries(rawCells)) {
    const cell = record(rawCell, `composition.cells.${id}`);
    cells[id] = {
      cropped: artifactPath(cell.cropped, `composition.cells.${id}.cropped`),
      croppedHash: hashDigest(cell.croppedHash, `composition.cells.${id}.croppedHash`),
      kept: nonNegativeInteger(cell.kept, `composition.cells.${id}.kept`),
      dropped: nonNegativeInteger(cell.dropped, `composition.cells.${id}.dropped`),
    };
  }

  const rawVerify = record(composition.verify, "composition.verify");
  const rawPairs = record(rawVerify.pairs, "composition.verify.pairs");
  const pairs: CompositionSection["verify"]["pairs"] = {};
  for (const [id, rawPair] of Object.entries(rawPairs)) {
    const pair = record(rawPair, `composition.verify.pairs.${id}`);
    pairs[id] = {
      median: nonNegativeNumber(pair.median, `composition.verify.pairs.${id}.median`),
      p90: nonNegativeNumber(pair.p90, `composition.verify.pairs.${id}.p90`),
      samplesA: nonNegativeInteger(pair.samplesA, `composition.verify.pairs.${id}.samplesA`),
      samplesB: nonNegativeInteger(pair.samplesB, `composition.verify.pairs.${id}.samplesB`),
    };
  }

  let bake: CompositionSection["bake"];
  if (composition.bake !== undefined) {
    const rawBake = record(composition.bake, "composition.bake");
    bake = {
      path: artifactPath(rawBake.path, "composition.bake.path"),
      hash: hashDigest(rawBake.hash, "composition.bake.hash"),
      propertyList: stringArray(rawBake.propertyList, "composition.bake.propertyList"),
      partial: booleanValue(rawBake.partial, "composition.bake.partial"),
    };
  }

  return {
    trainingHash: hashDigest(composition.trainingHash, "composition.trainingHash"),
    ownership,
    cropFeather: nonNegativeNumber(composition.cropFeather, "composition.cropFeather"),
    partial: booleanValue(composition.partial, "composition.partial"),
    omittedCells: stringArray(composition.omittedCells, "composition.omittedCells"),
    cells,
    verify: { passed: booleanValue(rawVerify.passed, "composition.verify.passed"), pairs },
    ...(bake === undefined ? {} : { bake }),
  };
}

function validateStructure(value: unknown): CellsManifest {
  const manifest = record(value, "manifest");
  if (manifest.version !== 2) return fail("manifest.version must be 2");
  const planning = validatePlanning(manifest.planning);
  const split = manifest.split === undefined ? undefined : validateSplit(manifest.split);
  const training = manifest.training === undefined ? undefined : validateTraining(manifest.training);
  const composition =
    manifest.composition === undefined
      ? undefined
      : validateComposition(manifest.composition, planning.ownership);
  if (training !== undefined && split === undefined) return fail("training requires split");
  if (composition !== undefined && training === undefined) return fail("composition requires training");

  return {
    version: 2,
    frame: validateFrame(manifest.frame),
    source: validateSource(manifest.source),
    planning,
    ...(split === undefined ? {} : { split }),
    ...(training === undefined ? {} : { training }),
    ...(composition === undefined ? {} : { composition }),
  };
}

export function parseManifest(serialized: string): CellsManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new ManifestError("INVALID_JSON", `Invalid cells.json${detail}`);
  }
  return validateStructure(parsed);
}

export function serializeManifest(manifest: CellsManifest): string {
  return jcsCanonicalize(validateStructure(manifest));
}

export async function validateManifest(
  value: unknown,
  hash: ManifestHashFunction,
): Promise<CellsManifest> {
  const manifest = validateStructure(value);
  const datasetHash = await hashSourceFiles(manifest.source.files, hash);
  if (datasetHash !== manifest.source.datasetHash) {
    throw new ManifestError("STALE_DATASET_HASH", "source.datasetHash does not match source.files");
  }
  if (manifest.split !== undefined) {
    const expected = await hashSection(manifest.planning, hash);
    if (manifest.split.planningHash !== expected) {
      throw new ManifestError("STALE_UPSTREAM_HASH", "split.planningHash does not match planning");
    }
  }
  if (manifest.training !== undefined && manifest.split !== undefined) {
    const expected = await hashSection(manifest.split, hash);
    if (manifest.training.splitHash !== expected) {
      throw new ManifestError("STALE_UPSTREAM_HASH", "training.splitHash does not match split");
    }
  }
  if (manifest.composition !== undefined && manifest.training !== undefined) {
    const expected = await hashSection(manifest.training, hash);
    if (manifest.composition.trainingHash !== expected) {
      throw new ManifestError("STALE_UPSTREAM_HASH", "composition.trainingHash does not match training");
    }
  }
  return manifest;
}
