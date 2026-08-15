/**
 * .rad container header — FORMAT.md is the authority; this mirrors
 * spark-lib rad.rs:1361-1379 (decode_rad_header).
 */

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
}

const RAD_MAGIC = 0x30444152; // 'RAD0'

export const roundup8 = (n: number): number => (n + 7) & ~7;

/** Parse the header from the first bytes of the file (fetch enough; 64 KB is ample — the hero's is 8,128 B). */
export function parseRadHeader(bytes: ArrayBuffer): RadHeaderInfo {
  const dv = new DataView(bytes);
  const magic = dv.getUint32(0, true);
  if (magic !== RAD_MAGIC) {
    throw new Error(`bad RAD0 magic 0x${magic.toString(16)}`);
  }
  const headerLength = dv.getUint32(4, true);
  if (bytes.byteLength < 8 + headerLength) {
    throw new Error(`header needs ${8 + headerLength} bytes, got ${bytes.byteLength}`);
  }
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 8, headerLength)));
  if (json.version !== 1) throw new Error(`unsupported RAD version ${json.version}`);
  if (json.type !== "gsplat") throw new Error(`unsupported RAD type ${json.type}`);

  const count = Number(json.count);
  const chunkSize = Number(json.chunkSize ?? count);
  const chunks = json.chunks as RadChunkRange[];
  const expected = Math.ceil(count / chunkSize);
  if (chunks.length !== expected) {
    throw new Error(`chunk count mismatch: expected ${expected}, got ${chunks.length}`);
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
  };
}
