/**
 * Range-request fetcher with the prefetch-all policy that produced the
 * sparkjs-toolkit 34s→2.3s result: issue EVERY chunk request up front (kills
 * wave-by-wave serialization); the browser's connection pool provides the
 * actual concurrency. H-LOAD criterion 2 (range-only) is asserted here: any
 * non-206 response is a loud failure, never a silent whole-file download.
 */
import type { RadHeaderInfo } from "./RadHeader.js";

export interface FetchedChunk {
  index: number;
  bytes: ArrayBuffer;
}

export interface FetchStats {
  requested: number;
  landed: number;
  bytesLanded: number;
  rangeVerified: boolean;
}

export class RadFetcher {
  readonly stats: FetchStats = { requested: 0, landed: 0, bytesLanded: 0, rangeVerified: false };

  constructor(
    private readonly url: string,
    private readonly header: RadHeaderInfo,
  ) {}

  /** Fetch the header region only (first 64 KB). */
  static async fetchHeader(url: string): Promise<ArrayBuffer> {
    const res = await fetch(url, { headers: { Range: "bytes=0-65535" } });
    if (res.status !== 206) {
      throw new Error(`header fetch: expected 206 Partial Content, got ${res.status} — server lacks Range support`);
    }
    return res.arrayBuffer();
  }

  /**
   * Prefetch-all: fire every chunk request immediately; deliver each to
   * `onChunk` as it lands (arrival order, not index order).
   */
  prefetchAll(onChunk: (c: FetchedChunk) => void, onError: (i: number, e: unknown) => void): void {
    const { chunksStart, chunks } = this.header;
    for (let i = 0; i < chunks.length; i++) {
      const start = chunksStart + chunks[i].offset;
      const end = start + chunks[i].bytes - 1; // Range end is inclusive
      this.stats.requested++;
      fetch(this.url, { headers: { Range: `bytes=${start}-${end}` } })
        .then(async (res) => {
          if (res.status !== 206) {
            throw new Error(`chunk ${i}: expected 206, got ${res.status}`);
          }
          const bytes = await res.arrayBuffer();
          if (bytes.byteLength !== chunks[i].bytes) {
            throw new Error(`chunk ${i}: expected ${chunks[i].bytes} B, got ${bytes.byteLength}`);
          }
          this.stats.landed++;
          this.stats.bytesLanded += bytes.byteLength;
          this.stats.rangeVerified = true;
          onChunk({ index: i, bytes });
        })
        .catch((e) => onError(i, e));
    }
  }
}
