/**
 * .rad container header — spikes/native-rad/FORMAT.md is the byte authority;
 * this mirrors spark-lib rad.rs:1361-1379 (decode_rad_header).
 */
import { SplatBackendError } from "./SplatBackend.js";

export interface RadChunkRange {
  offset: number; // relative to chunksStart
  bytes: number;
  base?: number;
  count?: number;
}

export interface RadHeaderInfo {
  count: number;
  maxSh: number;
  lodTree: boolean;
  chunkSize: number;
  allChunkBytes: number;
  chunksStart: number;
  chunks: RadChunkRange[];
  splatEncoding: Record<string, unknown> | undefined;
  /** 8 + headerLength — the byte count a header fetch must cover. */
  headerEnd: number;
}

const RAD_MAGIC = 0x30444152; // 'RAD0'

export const roundup8 = (n: number): number => (n + 7) & ~7;

type RadHeaderJson = {
  version: unknown;
  type: unknown;
  count: unknown;
  maxSh?: unknown;
  lodTree?: unknown;
  chunkSize?: unknown;
  allChunkBytes?: unknown;
  chunks: unknown;
  splatEncoding?: Record<string, unknown>;
};

/** Reads magic + headerLength from the first 8 bytes only. Throws
 *  `rad-header-short` (< 8 bytes) or `rad-bad-magic`. Returns 8 + headerLength. */
export function readRadHeaderEnd(bytes: ArrayBuffer): number {
  if (bytes.byteLength < 8) {
    throw new SplatBackendError(
      "rad-header-short",
      `header needs 8 bytes, got ${bytes.byteLength}`,
    );
  }
  const dv = new DataView(bytes);
  const magic = dv.getUint32(0, true);
  if (magic !== RAD_MAGIC) {
    throw new SplatBackendError("rad-bad-magic", `bad RAD0 magic 0x${magic.toString(16)}`);
  }
  const headerLength = dv.getUint32(4, true);
  return 8 + headerLength;
}

/** Parse the header from the first bytes of the file (fetch enough; 64 KB is ample — the hero's is 8,128 B). */
export function parseRadHeader(bytes: ArrayBuffer): RadHeaderInfo {
  const headerEnd = readRadHeaderEnd(bytes);
  if (bytes.byteLength < headerEnd) {
    throw new SplatBackendError(
      "rad-header-short",
      `header needs ${headerEnd} bytes, got ${bytes.byteLength}`,
    );
  }
  const headerLength = headerEnd - 8;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 8, headerLength)));
  } catch (err) {
    const detail = err instanceof Error ? err.message : "RAD header JSON is not valid";
    throw new SplatBackendError("rad-header-invalid", detail);
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new SplatBackendError("rad-header-invalid", "RAD header JSON is not an object");
  }
  const json = parsed as RadHeaderJson;
  if (json.version !== 1) {
    throw new SplatBackendError("rad-unsupported-version", `unsupported RAD version ${json.version}`);
  }
  if (json.type !== "gsplat") {
    throw new SplatBackendError("rad-unsupported-type", `unsupported RAD type ${json.type}`);
  }

  const count = Number(json.count);
  const chunkSize = Number(json.chunkSize ?? count);
  if (!Array.isArray(json.chunks)) {
    throw new SplatBackendError("rad-header-invalid", "RAD header chunks is not an array");
  }
  const chunks = json.chunks as RadChunkRange[];
  const expected = Math.ceil(count / chunkSize);
  if (chunks.length !== expected) {
    throw new SplatBackendError(
      "rad-chunk-count-mismatch",
      `chunk count mismatch: expected ${expected}, got ${chunks.length}`,
    );
  }
  return {
    count,
    maxSh: Number(json.maxSh ?? 0),
    lodTree: Boolean(json.lodTree ?? false),
    chunkSize,
    allChunkBytes: Number(json.allChunkBytes),
    chunksStart: 8 + roundup8(headerLength), // padded — rad.rs:1377
    chunks,
    splatEncoding: json.splatEncoding,
    headerEnd,
  };
}
