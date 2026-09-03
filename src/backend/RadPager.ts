/**
 * RadPager — the streaming loader (doc 02 "RadPager"; doc 03 §A).
 *
 * Ticket 05 owns THIS slice: header → RadFetcher (prefetch-all Range
 * requests, bounded retry, chunks given up on by name) → DecodePool (four
 * queued workers). It ends at "decoded chunks exist, on time, or are
 * honestly given up on". Residency, uploads, and progress are ticket 06,
 * which also replaces ThreeGsBackend's `rad-refused` stub with this path.
 *
 * Completion contract — owner ruling S3 (2026-09-02): `load` RESOLVES with
 * a report once every chunk is decoded or unavailable — even when every
 * chunk is unavailable (whether that counts as failed at the seam is
 * tickets 06/08's reveal policy). It REJECTS only for whole-load failures:
 * header errors, `range-unsupported` (a 200 where 206 was expected),
 * `fetch-aborted`, or a pool failure that is not a per-chunk decode error.
 */
import { DecodeFailedError, DecodePool, type DecodeJobRecord } from "./DecodePool.js";
import {
  RadFetcher,
  linkAbortSignal,
  type ChunkUnavailable,
  type FetchStats,
  type RadFetcherOptions,
} from "./RadFetcher.js";
import { parseRadHeader, type RadHeaderInfo } from "./RadHeader.js";
import { SplatBackendError } from "./SplatBackend.js";
import type { DecodeResult } from "./rad-worker.js";

export interface RadLoadReport {
  header: RadHeaderInfo;
  decoded: number;
  /** Chunks fetched and cached but NOT decoded because the admission gate
   *  refused them (ticket 06 residency: outside the protected set). Sorted. */
  deferred: number[];
  /** Raw chunk bytes held in the pager's cache (owner ruling 06-S4; Phase 0
   *  optimization item 3 keeps this heap residency on the open list). */
  cachedBytes: number;
  /** Sorted by chunk index. */
  unavailable: ChunkUnavailable[];
  /** Per chunk index: attempts it took to land (0 = never landed). */
  attempts: number[];
  fetch: FetchStats;
  jobs: DecodeJobRecord[];
  poolSize: number;
  queuedMax: number;
  startedAt: number;
  finishedAt: number;
}

export interface RadPagerOptions extends RadFetcherOptions {
  createWorker: () => Worker;
  /** Default DECODE_POOL_SIZE (owner ruling S1). */
  poolSize?: number;
}

export interface RadLoadHooks {
  /** Fires once the header is parsed, before any chunk request — the
   *  caller sizes its residency (budget, capacity, mesh) here. */
  onHeader?: (header: RadHeaderInfo) => void;
  /** Admission gate (owner ruling 06-S2): a chunk answered `false` is
   *  fetched and cached but not decoded; `decodeCached` admits it later. */
  admit?: (index: number) => boolean;
  onChunk: (result: DecodeResult) => void;
  onDeferred?: (index: number) => void;
  /** Fires as each chunk is given up on (fetch exhausted / rejected /
   *  decode failed) — live, like onDeferred, not only in the final report
   *  (built-in review, 2026-09-03). */
  onUnavailable?: (unavailable: ChunkUnavailable) => void;
}

/** Live completed-work terms (owner ruling 06-S5 feeds progress from these). */
export interface RadPagerProgress {
  bytesLanded: number;
  allChunkBytes: number;
  decoded: number;
  chunkCount: number;
}

export class RadPager {
  private pool: DecodePool | null = null;
  private loading = false;
  private disposed = false;
  private header: RadHeaderInfo | null = null;
  private fetcher: RadFetcher | null = null;
  /** Unique chunks decoded at least once (the progress "decoded" term) —
   *  a deferred chunk's first decode through decodeCached counts; a
   *  re-decode after eviction does not (adversarial review, 2026-09-03). */
  private decodedCount = 0;
  private decodedOnce: Uint8Array = new Uint8Array(0);
  /** Raw chunk bytes, every chunk that ever landed (owner ruling 06-S4):
   *  the re-decode source after eviction. Bytes are TRANSFERRED to a worker
   *  for a decode and restored from the result — a chunk mid-decode is
   *  absent from the map until its result returns. */
  private readonly cache = new Map<number, ArrayBuffer>();
  /** dispose() aborts this — it covers the header fetch and every chunk
   *  request, so a dispose during the header phase cannot be followed by
   *  a pool being created (adversarial review, 2026-09-02). */
  private readonly abort: AbortController;

  constructor(
    private readonly url: string,
    private readonly options: RadPagerOptions,
  ) {
    this.abort = linkAbortSignal(options.signal);
  }

  /** Live completed-work terms; zeros before the header is known. */
  get progress(): RadPagerProgress {
    return {
      bytesLanded: this.fetcher?.stats.bytesLanded ?? 0,
      allChunkBytes: this.header?.allChunkBytes ?? 0,
      decoded: this.decodedCount,
      chunkCount: this.header?.chunks.length ?? 0,
    };
  }

  private markDecoded(index: number): void {
    if (index >= 0 && index < this.decodedOnce.length && this.decodedOnce[index] === 0) {
      this.decodedOnce[index] = 1;
      this.decodedCount++;
    }
  }

  /** Bytes currently held in the raw cache. */
  get cachedBytes(): number {
    let total = 0;
    for (const bytes of this.cache.values()) total += bytes.byteLength;
    return total;
  }

  /**
   * Re-decode a cached chunk (admission after deferral, or re-admission
   * after eviction — owner ruling 06-S4). The bytes leave the cache for the
   * decode and come back with the result. Rejects `chunk-not-cached`,
   * `pool-disposed`, or the pool's worker-level failure.
   */
  async decodeCached(index: number): Promise<DecodeResult> {
    const bytes = this.cache.get(index);
    if (bytes === undefined) {
      throw new SplatBackendError("chunk-not-cached", `chunk ${index} has no cached bytes`);
    }
    const pool = this.pool;
    if (pool === null) {
      throw new SplatBackendError("pool-disposed", `chunk ${index}: pager has no live pool`);
    }
    this.cache.delete(index);
    try {
      const result = await pool.decode(index, bytes);
      this.cache.set(index, result.bytes);
      this.markDecoded(index);
      return result;
    } catch (error) {
      if (error instanceof DecodeFailedError) this.cache.set(index, error.bytes);
      throw error;
    }
  }

  /**
   * `onChunk` fires per decoded chunk in arrival order; the request bytes
   * are back in the pager's cache before the callback runs (consumers must
   * not hold `result.bytes`). A bare function means `{ onChunk }`.
   */
  async load(
    hooksOrOnChunk: RadLoadHooks | ((result: DecodeResult) => void),
  ): Promise<RadLoadReport> {
    const hooks: RadLoadHooks =
      typeof hooksOrOnChunk === "function" ? { onChunk: hooksOrOnChunk } : hooksOrOnChunk;
    if (this.loading || this.pool !== null) {
      throw new SplatBackendError("pager-reused", "RadPager.load called twice — one load per pager");
    }
    this.loading = true;
    const startedAt = performance.now();
    const fetchOptions = { ...this.options, signal: this.abort.signal };
    const headerBytes = await RadFetcher.fetchHeader(this.url, fetchOptions);
    if (this.disposed) {
      throw new SplatBackendError("fetch-aborted", "pager disposed during header fetch");
    }
    const header = parseRadHeader(headerBytes);
    this.header = header;
    this.decodedOnce = new Uint8Array(header.chunks.length);
    hooks.onHeader?.(header);
    if (this.disposed) {
      throw new SplatBackendError("fetch-aborted", "pager disposed during header hook");
    }
    const fetcher = new RadFetcher(this.url, header, fetchOptions);
    this.fetcher = fetcher;
    const pool = new DecodePool({
      createWorker: this.options.createWorker,
      size: this.options.poolSize,
    });
    // Owner ruling 06-S7: the job log is bounded by the asset's chunk count.
    pool.jobLimit = header.chunks.length;
    this.pool = pool;

    const unavailable: ChunkUnavailable[] = [];
    const deferred: number[] = [];
    const attempts = new Array<number>(header.chunks.length).fill(0);
    const decodes: Promise<void>[] = [];
    // First pool-level failure (a broken worker). Fail FAST: abort the
    // fetches instead of downloading the rest of the asset for a decode
    // that can no longer happen, and surface THIS error — not the
    // fetch-aborted that the abort itself produces (built-in review,
    // 2026-09-02).
    let poolFailure: SplatBackendError | null = null;

    try {
      await fetcher.prefetchAll(
        (chunk) => {
          attempts[chunk.index] = chunk.attempts;
          if (hooks.admit !== undefined && !hooks.admit(chunk.index)) {
            this.cache.set(chunk.index, chunk.bytes);
            deferred.push(chunk.index);
            hooks.onDeferred?.(chunk.index);
            return;
          }
          decodes.push(
            pool.decode(chunk.index, chunk.bytes).then(
              (result) => {
                this.markDecoded(result.index);
                this.cache.set(result.index, result.bytes);
                hooks.onChunk(result);
              },
              (error: unknown) => {
                if (error instanceof DecodeFailedError) {
                  this.cache.set(error.index, error.bytes);
                  const given: ChunkUnavailable = {
                    index: error.index,
                    reason: "decode-failed",
                    // The fetch attempts that produced these bytes — a
                    // corrupt body behind two length-mismatch retries is
                    // attempts 3, not 1 (adversarial review, 2026-09-02).
                    attempts: chunk.attempts,
                    detail: error.message,
                  };
                  unavailable.push(given);
                  hooks.onUnavailable?.(given);
                  return;
                }
                if (poolFailure === null && error instanceof SplatBackendError) {
                  poolFailure = error;
                  this.abort.abort();
                }
                throw error;
              },
            ),
          );
        },
        (given) => {
          unavailable.push(given);
          hooks.onUnavailable?.(given);
        },
      );
      await Promise.all(decodes);
    } catch (error) {
      pool.dispose();
      this.pool = null;
      // dispose() just rejected every outstanding job with pool-disposed;
      // those rejections flow into `decodes` entries nothing has awaited
      // when prefetchAll was what threw — settle them all so none escapes
      // as an unhandled rejection (built-in review, 2026-09-02).
      await Promise.allSettled(decodes);
      throw poolFailure ?? error;
    }

    unavailable.sort((a, b) => a.index - b.index);
    deferred.sort((a, b) => a - b);
    return {
      header,
      decoded: this.decodedCount,
      deferred,
      cachedBytes: this.cachedBytes,
      unavailable,
      attempts,
      fetch: fetcher.stats,
      // A snapshot: the pool keeps appending for later re-decodes.
      jobs: pool.jobs.slice(),
      poolSize: pool.size,
      queuedMax: pool.queuedMax,
      startedAt,
      finishedAt: performance.now(),
    };
  }

  /** Terminates the decode workers. The pool outlives `load` on purpose —
   *  ticket 06 re-decodes evicted pages through it. */
  dispose(): void {
    this.disposed = true;
    this.abort.abort();
    this.pool?.dispose();
    this.pool = null;
    this.cache.clear();
  }
}
