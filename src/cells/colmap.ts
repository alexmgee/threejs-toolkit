export type ColmapFile = ArrayBuffer | Uint8Array;

export const INVALID_POINT3D_INDEX = 0xffffffff;
export const INVALID_POINT3D_ID = 0xffffffffffffffffn;

interface CameraModel {
  id: number;
  name: string;
  parameterCount: number;
}

const CAMERA_MODELS: readonly CameraModel[] = [
  { id: 0, name: "SIMPLE_PINHOLE", parameterCount: 3 },
  { id: 1, name: "PINHOLE", parameterCount: 4 },
  { id: 2, name: "SIMPLE_RADIAL", parameterCount: 4 },
  { id: 3, name: "RADIAL", parameterCount: 5 },
  { id: 4, name: "OPENCV", parameterCount: 8 },
  { id: 5, name: "OPENCV_FISHEYE", parameterCount: 8 },
  { id: 6, name: "FULL_OPENCV", parameterCount: 12 },
  { id: 7, name: "FOV", parameterCount: 5 },
  { id: 8, name: "SIMPLE_RADIAL_FISHEYE", parameterCount: 4 },
  { id: 9, name: "RADIAL_FISHEYE", parameterCount: 5 },
  { id: 10, name: "THIN_PRISM_FISHEYE", parameterCount: 12 },
  { id: 11, name: "RAD_TAN_THIN_PRISM_FISHEYE", parameterCount: 16 },
];

const CAMERA_MODEL_BY_ID = new Map(CAMERA_MODELS.map((model) => [model.id, model]));
const CAMERA_MODEL_BY_NAME = new Map(CAMERA_MODELS.map((model) => [model.name, model]));
const UINT32_LIMIT = 0x100000000;
const textDecoder = new TextDecoder();

export interface ColmapCameras {
  ids: Uint32Array;
  modelIds: Int32Array;
  modelNames: string[];
  widths: Uint32Array;
  heights: Uint32Array;
  parameterOffsets: Uint32Array;
  parameters: Float64Array;
}

export interface ColmapImages {
  ids: Uint32Array;
  cameraIds: Uint32Array;
  quaternions: Float64Array;
  translations: Float64Array;
  names: string[];
  point2DOffsets: Uint32Array;
  point2DXys: Float64Array;
  point3DIndices: Uint32Array;
}

export interface ColmapPoints3D {
  ids: BigUint64Array;
  positions: Float64Array;
  colors: Uint8Array;
  errors: Float64Array;
  trackOffsets: Uint32Array;
  trackImageIds: Uint32Array;
  trackPoint2DIdxs: Uint32Array;
}

export interface ColmapDataset {
  cameras: ColmapCameras;
  images: ColmapImages;
  points3D: ColmapPoints3D;
}

function bytesOf(file: ColmapFile): Uint8Array {
  return file instanceof Uint8Array ? file : new Uint8Array(file);
}

function checkedUint32(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value >= UINT32_LIMIT) {
    throw new RangeError(`${label} is outside uint32 range: ${value}`);
  }
  return value;
}

function checkedLength(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${label} is too large to represent safely: ${value}`);
  }
  const result = Number(value);
  if (result >= UINT32_LIMIT) {
    throw new RangeError(`${label} exceeds typed-array uint32 indexing: ${value}`);
  }
  return result;
}

function checkedPointCount(value: number): void {
  if (value >= UINT32_LIMIT) {
    throw new RangeError("COLMAP contains more than 2^32-1 distinct point3D ids");
  }
}

function isSpace(value: number): boolean {
  return value === 32 || value === 9 || value === 13;
}

function isRecordLine(bytes: Uint8Array, start: number, end: number): boolean {
  while (start < end && isSpace(bytes[start])) start += 1;
  return start < end && bytes[start] !== 35;
}

function visitLines(
  bytes: Uint8Array,
  visitor: (start: number, end: number) => void,
): void {
  let start = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 10) continue;
    const end = index > start && bytes[index - 1] === 13 ? index - 1 : index;
    visitor(start, end);
    start = index + 1;
  }
  if (start < bytes.length) visitor(start, bytes.length);
}

class AsciiTokens {
  private bytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
  private position = 0;
  private end = 0;

  reset(bytes: Uint8Array, start: number, end: number): void {
    this.bytes = bytes;
    this.position = start;
    this.end = end;
  }

  hasNext(): boolean {
    this.skipSpaces();
    return this.position < this.end;
  }

  countRemaining(): number {
    let count = 0;
    while (this.hasNext()) {
      this.skipToken();
      count += 1;
    }
    return count;
  }

  uint(label: string): number {
    const [start, end] = this.token(label);
    let value = 0;
    for (let index = start; index < end; index += 1) {
      const digit = this.bytes[index] - 48;
      if (digit < 0 || digit > 9) throw new SyntaxError(`Invalid ${label}`);
      value = value * 10 + digit;
      if (!Number.isSafeInteger(value)) throw new RangeError(`${label} is not a safe integer`);
    }
    return value;
  }

  int(label: string): number {
    const [start, end] = this.token(label);
    let index = start;
    let sign = 1;
    if (this.bytes[index] === 45) {
      sign = -1;
      index += 1;
    } else if (this.bytes[index] === 43) {
      index += 1;
    }
    if (index === end) throw new SyntaxError(`Invalid ${label}`);
    let value = 0;
    for (; index < end; index += 1) {
      const digit = this.bytes[index] - 48;
      if (digit < 0 || digit > 9) throw new SyntaxError(`Invalid ${label}`);
      value = value * 10 + digit;
      if (!Number.isSafeInteger(value)) throw new RangeError(`${label} is not a safe integer`);
    }
    return sign * value;
  }

  uint64(label: string): bigint {
    const [start, end] = this.token(label);
    const value = BigInt(textDecoder.decode(this.bytes.subarray(start, end)));
    if (value < 0n || value > INVALID_POINT3D_ID) {
      throw new RangeError(`${label} is outside uint64 range: ${value}`);
    }
    return value;
  }

  number(label: string): number {
    const [start, end] = this.token(label);
    const value = Number(textDecoder.decode(this.bytes.subarray(start, end)));
    if (Number.isNaN(value)) throw new SyntaxError(`Invalid ${label}`);
    return value;
  }

  remainder(): [number, number] {
    this.skipSpaces();
    let end = this.end;
    while (end > this.position && isSpace(this.bytes[end - 1])) end -= 1;
    const result: [number, number] = [this.position, end];
    this.position = this.end;
    return result;
  }

  private skipSpaces(): void {
    while (this.position < this.end && isSpace(this.bytes[this.position])) this.position += 1;
  }

  private skipToken(): void {
    while (this.position < this.end && !isSpace(this.bytes[this.position])) this.position += 1;
  }

  private token(label: string): [number, number] {
    this.skipSpaces();
    if (this.position >= this.end) throw new SyntaxError(`Missing ${label}`);
    const start = this.position;
    this.skipToken();
    return [start, this.position];
  }
}

function parseCamerasText(file: ColmapFile): ColmapCameras {
  const bytes = bytesOf(file);
  const tokens = new AsciiTokens();
  const ids: number[] = [];
  const modelIds: number[] = [];
  const modelNames: string[] = [];
  const widths: number[] = [];
  const heights: number[] = [];
  const parameters: number[] = [];
  const parameterOffsets = [0];
  const seenIds = new Set<number>();
  visitLines(bytes, (start, end) => {
    if (!isRecordLine(bytes, start, end)) return;
    let cursor = start;
    const spans: Array<[number, number]> = [];
    while (cursor < end) {
      while (cursor < end && isSpace(bytes[cursor])) cursor += 1;
      if (cursor >= end) break;
      const tokenStart = cursor;
      while (cursor < end && !isSpace(bytes[cursor])) cursor += 1;
      spans.push([tokenStart, cursor]);
    }
    if (spans.length < 4) throw new SyntaxError("Incomplete COLMAP camera record");
    const parseSpanUint = (span: [number, number], label: string): number => {
      tokens.reset(bytes, span[0], span[1]);
      return tokens.uint(label);
    };
    const id = checkedUint32(parseSpanUint(spans[0], "camera id"), "camera id");
    if (seenIds.has(id)) throw new RangeError(`Duplicate COLMAP camera id: ${id}`);
    seenIds.add(id);
    const modelName = textDecoder.decode(bytes.subarray(spans[1][0], spans[1][1]));
    const model = CAMERA_MODEL_BY_NAME.get(modelName);
    if (!model) throw new RangeError(`Unsupported COLMAP camera model: ${modelName}`);
    if (spans.length !== 4 + model.parameterCount) {
      throw new SyntaxError(`Camera ${id} has the wrong number of ${modelName} parameters`);
    }

    ids.push(id);
    modelIds.push(model.id);
    modelNames.push(model.name);
    widths.push(checkedUint32(parseSpanUint(spans[2], "camera width"), "camera width"));
    heights.push(checkedUint32(parseSpanUint(spans[3], "camera height"), "camera height"));
    for (let index = 4; index < spans.length; index += 1) {
      tokens.reset(bytes, spans[index][0], spans[index][1]);
      parameters.push(tokens.number("camera parameter"));
    }
    parameterOffsets.push(parameters.length);
  });

  return {
    ids: Uint32Array.from(ids),
    modelIds: Int32Array.from(modelIds),
    modelNames,
    widths: Uint32Array.from(widths),
    heights: Uint32Array.from(heights),
    parameterOffsets: Uint32Array.from(parameterOffsets),
    parameters: Float64Array.from(parameters),
  };
}

interface ParsedPoints3D {
  points: ColmapPoints3D;
  indexById: Map<bigint, number>;
}

function countPointsText(bytes: Uint8Array): { pointCount: number; trackCount: number } {
  let pointCount = 0;
  let trackCount = 0;
  visitLines(bytes, (start, end) => {
    if (!isRecordLine(bytes, start, end)) return;
    let cursor = start;
    let tokenCount = 0;
    while (cursor < end) {
      while (cursor < end && isSpace(bytes[cursor])) cursor += 1;
      if (cursor >= end) break;
      tokenCount += 1;
      while (cursor < end && !isSpace(bytes[cursor])) cursor += 1;
    }
    if (tokenCount < 8 || (tokenCount - 8) % 2 !== 0) {
      throw new SyntaxError("Malformed COLMAP point3D track");
    }
    pointCount += 1;
    checkedPointCount(pointCount);
    trackCount += (tokenCount - 8) / 2;
    if (trackCount >= UINT32_LIMIT) {
      throw new RangeError("COLMAP point3D tracks exceed uint32 CSR indexing");
    }
  });
  return { pointCount, trackCount };
}

function parsePoints3DText(file: ColmapFile): ParsedPoints3D {
  const bytes = bytesOf(file);
  const { pointCount, trackCount } = countPointsText(bytes);
  const ids = new BigUint64Array(pointCount);
  const positions = new Float64Array(pointCount * 3);
  const colors = new Uint8Array(pointCount * 3);
  const errors = new Float64Array(pointCount);
  const trackOffsets = new Uint32Array(pointCount + 1);
  const trackImageIds = new Uint32Array(trackCount);
  const trackPoint2DIdxs = new Uint32Array(trackCount);
  const indexById = new Map<bigint, number>();
  const tokens = new AsciiTokens();
  let pointIndex = 0;
  let trackIndex = 0;

  visitLines(bytes, (start, end) => {
    if (!isRecordLine(bytes, start, end)) return;
    tokens.reset(bytes, start, end);
    const id = tokens.uint64("point3D id");
    if (id === INVALID_POINT3D_ID) throw new RangeError("The invalid marker cannot be a point3D id");
    if (indexById.has(id)) throw new RangeError(`Duplicate COLMAP point3D id: ${id}`);
    ids[pointIndex] = id;
    indexById.set(id, pointIndex);
    const base = pointIndex * 3;
    positions[base] = tokens.number("point3D x");
    positions[base + 1] = tokens.number("point3D y");
    positions[base + 2] = tokens.number("point3D z");
    for (let channel = 0; channel < 3; channel += 1) {
      const value = tokens.uint("point3D color");
      if (value > 255) throw new RangeError(`point3D color is outside uint8 range: ${value}`);
      colors[base + channel] = value;
    }
    errors[pointIndex] = tokens.number("point3D error");
    trackOffsets[pointIndex] = trackIndex;
    while (tokens.hasNext()) {
      trackImageIds[trackIndex] = checkedUint32(tokens.uint("track image id"), "track image id");
      trackPoint2DIdxs[trackIndex] = checkedUint32(
        tokens.uint("track point2D index"),
        "track point2D index",
      );
      trackIndex += 1;
    }
    pointIndex += 1;
  });
  trackOffsets[pointCount] = trackIndex;

  return {
    points: { ids, positions, colors, errors, trackOffsets, trackImageIds, trackPoint2DIdxs },
    indexById,
  };
}

function visitImageEntries(
  bytes: Uint8Array,
  pose: (start: number, end: number) => void,
  observations: (start: number, end: number) => void,
): void {
  let waitingForObservations = false;
  visitLines(bytes, (start, end) => {
    if (waitingForObservations) {
      observations(start, end);
      waitingForObservations = false;
      return;
    }
    if (!isRecordLine(bytes, start, end)) return;
    pose(start, end);
    waitingForObservations = true;
  });
  if (waitingForObservations) {
    throw new SyntaxError("COLMAP image pose is missing its positional points2D line");
  }
}

function countImagesText(bytes: Uint8Array): { imageCount: number; observationCount: number } {
  const tokens = new AsciiTokens();
  let imageCount = 0;
  let observationCount = 0;
  visitImageEntries(
    bytes,
    () => {
      imageCount += 1;
      if (imageCount >= UINT32_LIMIT) throw new RangeError("COLMAP has too many images");
    },
    (start, end) => {
      tokens.reset(bytes, start, end);
      const count = tokens.countRemaining();
      if (count % 3 !== 0) throw new SyntaxError("Malformed COLMAP points2D line");
      observationCount += count / 3;
      if (observationCount >= UINT32_LIMIT) {
        throw new RangeError("COLMAP observations exceed uint32 CSR indexing");
      }
    },
  );
  return { imageCount, observationCount };
}

function parseImagesText(
  file: ColmapFile,
  pointIndexById: ReadonlyMap<bigint, number>,
): ColmapImages {
  const bytes = bytesOf(file);
  const { imageCount, observationCount } = countImagesText(bytes);
  const ids = new Uint32Array(imageCount);
  const cameraIds = new Uint32Array(imageCount);
  const quaternions = new Float64Array(imageCount * 4);
  const translations = new Float64Array(imageCount * 3);
  const names = new Array<string>(imageCount);
  const point2DOffsets = new Uint32Array(imageCount + 1);
  const point2DXys = new Float64Array(observationCount * 2);
  const point3DIndices = new Uint32Array(observationCount);
  const tokens = new AsciiTokens();
  const seenIds = new Set<number>();
  let imageIndex = 0;
  let observationIndex = 0;

  visitImageEntries(
    bytes,
    (start, end) => {
      tokens.reset(bytes, start, end);
      const id = checkedUint32(tokens.uint("image id"), "image id");
      if (seenIds.has(id)) throw new RangeError(`Duplicate COLMAP image id: ${id}`);
      seenIds.add(id);
      ids[imageIndex] = id;
      const quaternionBase = imageIndex * 4;
      for (let value = 0; value < 4; value += 1) {
        quaternions[quaternionBase + value] = tokens.number("image quaternion");
      }
      const translationBase = imageIndex * 3;
      for (let value = 0; value < 3; value += 1) {
        translations[translationBase + value] = tokens.number("image translation");
      }
      cameraIds[imageIndex] = checkedUint32(tokens.uint("image camera id"), "image camera id");
      const [nameStart, nameEnd] = tokens.remainder();
      if (nameStart === nameEnd) throw new SyntaxError(`Image ${id} has an empty name`);
      names[imageIndex] = textDecoder.decode(bytes.subarray(nameStart, nameEnd));
      point2DOffsets[imageIndex] = observationIndex;
    },
    (start, end) => {
      tokens.reset(bytes, start, end);
      while (tokens.hasNext()) {
        const coordinateBase = observationIndex * 2;
        point2DXys[coordinateBase] = tokens.number("point2D x");
        point2DXys[coordinateBase + 1] = tokens.number("point2D y");
        const externalId = tokens.uint64("point2D point3D id");
        if (externalId === INVALID_POINT3D_ID) {
          point3DIndices[observationIndex] = INVALID_POINT3D_INDEX;
        } else {
          const denseIndex = pointIndexById.get(externalId);
          if (denseIndex === undefined) {
            throw new RangeError(`Image references unknown point3D id: ${externalId}`);
          }
          point3DIndices[observationIndex] = denseIndex;
        }
        observationIndex += 1;
      }
      imageIndex += 1;
    },
  );
  point2DOffsets[imageCount] = observationIndex;

  return {
    ids,
    cameraIds,
    quaternions,
    translations,
    names,
    point2DOffsets,
    point2DXys,
    point3DIndices,
  };
}

class BinaryCursor {
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  position = 0;

  constructor(file: ColmapFile) {
    this.bytes = bytesOf(file);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
  }

  get length(): number {
    return this.view.byteLength;
  }

  uint8(): number {
    const value = this.view.getUint8(this.position);
    this.position += 1;
    return value;
  }

  uint32(): number {
    const value = this.view.getUint32(this.position, true);
    this.position += 4;
    return value;
  }

  int32(): number {
    const value = this.view.getInt32(this.position, true);
    this.position += 4;
    return value;
  }

  uint64(): bigint {
    const value = this.view.getBigUint64(this.position, true);
    this.position += 8;
    return value;
  }

  float64(): number {
    const value = this.view.getFloat64(this.position, true);
    this.position += 8;
    return value;
  }

  string(): string {
    const start = this.position;
    while (this.position < this.length && this.bytes[this.position] !== 0) this.position += 1;
    if (this.position === this.length) throw new SyntaxError("Unterminated string in COLMAP binary");
    const result = textDecoder.decode(this.bytes.subarray(start, this.position));
    this.position += 1;
    return result;
  }

  skip(byteCount: number): void {
    this.position += byteCount;
    if (this.position > this.length) throw new RangeError("Truncated COLMAP binary file");
  }

  done(label: string): void {
    if (this.position !== this.length) {
      throw new SyntaxError(`${label} contains trailing bytes`);
    }
  }
}

function parseCamerasBinary(file: ColmapFile): ColmapCameras {
  const cursor = new BinaryCursor(file);
  const count = checkedLength(cursor.uint64(), "camera count");
  const ids = new Uint32Array(count);
  const modelIds = new Int32Array(count);
  const modelNames = new Array<string>(count);
  const widths = new Uint32Array(count);
  const heights = new Uint32Array(count);
  const parameterOffsets = new Uint32Array(count + 1);
  const parameters: number[] = [];
  const seenIds = new Set<number>();

  for (let index = 0; index < count; index += 1) {
    const id = cursor.uint32();
    if (seenIds.has(id)) throw new RangeError(`Duplicate COLMAP camera id: ${id}`);
    seenIds.add(id);
    const modelId = cursor.int32();
    const model = CAMERA_MODEL_BY_ID.get(modelId);
    if (!model) throw new RangeError(`Unsupported COLMAP camera model id: ${modelId}`);
    ids[index] = id;
    modelIds[index] = modelId;
    modelNames[index] = model.name;
    widths[index] = checkedUint32(checkedLength(cursor.uint64(), "camera width"), "camera width");
    heights[index] = checkedUint32(
      checkedLength(cursor.uint64(), "camera height"),
      "camera height",
    );
    parameterOffsets[index] = parameters.length;
    for (let parameter = 0; parameter < model.parameterCount; parameter += 1) {
      parameters.push(cursor.float64());
    }
  }
  parameterOffsets[count] = parameters.length;
  cursor.done("cameras.bin");
  return {
    ids,
    modelIds,
    modelNames,
    widths,
    heights,
    parameterOffsets,
    parameters: Float64Array.from(parameters),
  };
}

function scanPoints3DBinary(file: ColmapFile): { pointCount: number; trackCount: number } {
  const cursor = new BinaryCursor(file);
  const pointCount = checkedLength(cursor.uint64(), "point3D count");
  checkedPointCount(pointCount);
  let trackCount = 0;
  for (let index = 0; index < pointCount; index += 1) {
    cursor.skip(8 + 24 + 3 + 8);
    const count = checkedLength(cursor.uint64(), "point3D track length");
    trackCount += count;
    if (trackCount >= UINT32_LIMIT) {
      throw new RangeError("COLMAP point3D tracks exceed uint32 CSR indexing");
    }
    cursor.skip(count * 8);
  }
  cursor.done("points3D.bin");
  return { pointCount, trackCount };
}

function parsePoints3DBinary(file: ColmapFile): ParsedPoints3D {
  const { pointCount, trackCount } = scanPoints3DBinary(file);
  const cursor = new BinaryCursor(file);
  cursor.uint64();
  const ids = new BigUint64Array(pointCount);
  const positions = new Float64Array(pointCount * 3);
  const colors = new Uint8Array(pointCount * 3);
  const errors = new Float64Array(pointCount);
  const trackOffsets = new Uint32Array(pointCount + 1);
  const trackImageIds = new Uint32Array(trackCount);
  const trackPoint2DIdxs = new Uint32Array(trackCount);
  const indexById = new Map<bigint, number>();
  let trackIndex = 0;

  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const id = cursor.uint64();
    if (id === INVALID_POINT3D_ID) throw new RangeError("The invalid marker cannot be a point3D id");
    if (indexById.has(id)) throw new RangeError(`Duplicate COLMAP point3D id: ${id}`);
    ids[pointIndex] = id;
    indexById.set(id, pointIndex);
    const base = pointIndex * 3;
    positions[base] = cursor.float64();
    positions[base + 1] = cursor.float64();
    positions[base + 2] = cursor.float64();
    colors[base] = cursor.uint8();
    colors[base + 1] = cursor.uint8();
    colors[base + 2] = cursor.uint8();
    errors[pointIndex] = cursor.float64();
    trackOffsets[pointIndex] = trackIndex;
    const count = checkedLength(cursor.uint64(), "point3D track length");
    for (let track = 0; track < count; track += 1) {
      trackImageIds[trackIndex] = cursor.uint32();
      trackPoint2DIdxs[trackIndex] = cursor.uint32();
      trackIndex += 1;
    }
  }
  trackOffsets[pointCount] = trackIndex;
  cursor.done("points3D.bin");
  return {
    points: { ids, positions, colors, errors, trackOffsets, trackImageIds, trackPoint2DIdxs },
    indexById,
  };
}

function scanImagesBinary(file: ColmapFile): { imageCount: number; observationCount: number } {
  const cursor = new BinaryCursor(file);
  const imageCount = checkedLength(cursor.uint64(), "image count");
  let observationCount = 0;
  for (let index = 0; index < imageCount; index += 1) {
    cursor.skip(4 + 56 + 4);
    cursor.string();
    const count = checkedLength(cursor.uint64(), "points2D count");
    observationCount += count;
    if (observationCount >= UINT32_LIMIT) {
      throw new RangeError("COLMAP observations exceed uint32 CSR indexing");
    }
    cursor.skip(count * 24);
  }
  cursor.done("images.bin");
  return { imageCount, observationCount };
}

function parseImagesBinary(
  file: ColmapFile,
  pointIndexById: ReadonlyMap<bigint, number>,
): ColmapImages {
  const { imageCount, observationCount } = scanImagesBinary(file);
  const cursor = new BinaryCursor(file);
  cursor.uint64();
  const ids = new Uint32Array(imageCount);
  const cameraIds = new Uint32Array(imageCount);
  const quaternions = new Float64Array(imageCount * 4);
  const translations = new Float64Array(imageCount * 3);
  const names = new Array<string>(imageCount);
  const point2DOffsets = new Uint32Array(imageCount + 1);
  const point2DXys = new Float64Array(observationCount * 2);
  const point3DIndices = new Uint32Array(observationCount);
  const seenIds = new Set<number>();
  let observationIndex = 0;

  for (let imageIndex = 0; imageIndex < imageCount; imageIndex += 1) {
    const id = cursor.uint32();
    if (seenIds.has(id)) throw new RangeError(`Duplicate COLMAP image id: ${id}`);
    seenIds.add(id);
    ids[imageIndex] = id;
    const quaternionBase = imageIndex * 4;
    for (let value = 0; value < 4; value += 1) quaternions[quaternionBase + value] = cursor.float64();
    const translationBase = imageIndex * 3;
    for (let value = 0; value < 3; value += 1) translations[translationBase + value] = cursor.float64();
    cameraIds[imageIndex] = cursor.uint32();
    names[imageIndex] = cursor.string();
    point2DOffsets[imageIndex] = observationIndex;
    const count = checkedLength(cursor.uint64(), "points2D count");
    for (let observation = 0; observation < count; observation += 1) {
      const coordinateBase = observationIndex * 2;
      point2DXys[coordinateBase] = cursor.float64();
      point2DXys[coordinateBase + 1] = cursor.float64();
      const externalId = cursor.uint64();
      if (externalId === INVALID_POINT3D_ID) {
        point3DIndices[observationIndex] = INVALID_POINT3D_INDEX;
      } else {
        const denseIndex = pointIndexById.get(externalId);
        if (denseIndex === undefined) {
          throw new RangeError(`Image references unknown point3D id: ${externalId}`);
        }
        point3DIndices[observationIndex] = denseIndex;
      }
      observationIndex += 1;
    }
  }
  point2DOffsets[imageCount] = observationIndex;
  cursor.done("images.bin");
  return {
    ids,
    cameraIds,
    quaternions,
    translations,
    names,
    point2DOffsets,
    point2DXys,
    point3DIndices,
  };
}

function validateDataset(dataset: ColmapDataset): void {
  const cameraIds = new Set(dataset.cameras.ids);
  const imageIndexById = new Map<number, number>();
  for (let index = 0; index < dataset.images.ids.length; index += 1) {
    const imageId = dataset.images.ids[index];
    imageIndexById.set(imageId, index);
    if (!cameraIds.has(dataset.images.cameraIds[index])) {
      throw new RangeError(`Image ${imageId} references an unknown camera`);
    }
  }

  const points = dataset.points3D;
  for (let pointIndex = 0; pointIndex < points.ids.length; pointIndex += 1) {
    for (
      let trackIndex = points.trackOffsets[pointIndex];
      trackIndex < points.trackOffsets[pointIndex + 1];
      trackIndex += 1
    ) {
      const imageId = points.trackImageIds[trackIndex];
      const imageIndex = imageIndexById.get(imageId);
      if (imageIndex === undefined) {
        throw new RangeError(`point3D ${points.ids[pointIndex]} tracks an unknown image ${imageId}`);
      }
      const point2DIndex = points.trackPoint2DIdxs[trackIndex];
      const observationIndex = dataset.images.point2DOffsets[imageIndex] + point2DIndex;
      if (observationIndex >= dataset.images.point2DOffsets[imageIndex + 1]) {
        throw new RangeError(`point3D ${points.ids[pointIndex]} has an invalid point2D track index`);
      }
      if (dataset.images.point3DIndices[observationIndex] !== pointIndex) {
        throw new RangeError(`point3D ${points.ids[pointIndex]} has an inconsistent image track`);
      }
    }
  }
}

export function parseColmapText(
  camerasFile: ColmapFile,
  imagesFile: ColmapFile,
  points3DFile: ColmapFile,
): ColmapDataset {
  const parsedPoints = parsePoints3DText(points3DFile);
  const dataset: ColmapDataset = {
    cameras: parseCamerasText(camerasFile),
    images: parseImagesText(imagesFile, parsedPoints.indexById),
    points3D: parsedPoints.points,
  };
  validateDataset(dataset);
  return dataset;
}

export function parseColmapBinary(
  camerasFile: ColmapFile,
  imagesFile: ColmapFile,
  points3DFile: ColmapFile,
): ColmapDataset {
  const parsedPoints = parsePoints3DBinary(points3DFile);
  const dataset: ColmapDataset = {
    cameras: parseCamerasBinary(camerasFile),
    images: parseImagesBinary(imagesFile, parsedPoints.indexById),
    points3D: parsedPoints.points,
  };
  validateDataset(dataset);
  return dataset;
}
