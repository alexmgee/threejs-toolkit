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

export class RadPager {
  private pool: DecodePool | null = null;
  private loading = false;
  private disposed = false;
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

  /**
   * `onChunk` fires per decoded chunk in arrival order, with the request
   * bytes transferred back on `result.bytes` (the caller owns any cache).
   */
  async load(onChunk: (result: DecodeResult) => void): Promise<RadLoadReport> {
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
    const fetcher = new RadFetcher(this.url, header, fetchOptions);
    const pool = new DecodePool({
      createWorker: this.options.createWorker,
      size: this.options.poolSize,
    });
    this.pool = pool;

    const unavailable: ChunkUnavailable[] = [];
    const attempts = new Array<number>(header.chunks.length).fill(0);
    let decoded = 0;
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
          decodes.push(
            pool.decode(chunk.index, chunk.bytes).then(
              (result) => {
                decoded++;
                onChunk(result);
              },
              (error: unknown) => {
                if (error instanceof DecodeFailedError) {
                  unavailable.push({
                    index: error.index,
                    reason: "decode-failed",
                    // The fetch attempts that produced these bytes — a
                    // corrupt body behind two length-mismatch retries is
                    // attempts 3, not 1 (adversarial review, 2026-09-02).
                    attempts: chunk.attempts,
                    detail: error.message,
                  });
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
    return {
      header,
      decoded,
      unavailable,
      attempts,
      fetch: fetcher.stats,
      jobs: pool.jobs,
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
  }
}
