/**
 * Range-request fetcher (ticket 05; promoted from the Phase 0 spike's
 * RadFetcher with the failure semantics the spike lacked — doc 03 §A2).
 *
 * Policy carried verbatim from the tuned result: PREFETCH-ALL — every chunk
 * request is issued up front (kills wave-by-wave serialization); the
 * browser's connection pool provides the actual concurrency.
 *
 * 206-or-die (H-LOAD criterion 2): a 200 where 206 was expected means the
 * server ignores Range — every retry would download the whole file — so it
 * is a WHOLE-LOAD refusal (`range-unsupported`), aborting every in-flight
 * request; never a silent full-body download.
 *
 * Retry policy — owner ruling S2 (2026-09-02, ticket 05 Comments):
 * MAX_ATTEMPTS = 3 total, anchored to the most widely deployed published
 * default (`@smithy/core` 3.33.3 `DEFAULT_MAX_ATTEMPTS = 3`, verified from
 * the npm artifact). Retries are IMMEDIATE — no backoff timer, because any
 * timer wedges hidden-tab loads under Chrome's ~1/min intensive throttling
 * (handoff 006 trap 1), and zero delay is zero invented constants.
 *
 * Failure taxonomy — owner ruling S3: retryable = network error, 5xx,
 * byte-count mismatch on a 206; terminal per chunk with no retry = any
 * other non-206 status (404/403/416…); the chunk is then reported
 * UNAVAILABLE (index, reason, attempts, detail) and the load goes on —
 * pages are given up on honestly, never wedged.
 */
import { SplatBackendError } from "./SplatBackend.js";
import { readRadHeaderEnd, type RadHeaderInfo } from "./RadHeader.js";

/** Spark's first header probe size (reference SplatPager.ts:132). */
export const HEADER_PROBE_BYTES = 65536;
/** Owner ruling S2 — see the module comment. */
export const MAX_ATTEMPTS = 3;

export type ChunkUnavailableReason =
  | "range-network-error"
  | "range-server-error"
  | "range-length-mismatch"
  | "range-rejected";

export interface ChunkUnavailable {
  index: number;
  /** Fetch-layer reasons, `decode-failed` (the bytes do not decode), and the
   *  two per-job pool rejections a RE-ADMISSION can meet — before or after
   *  the load settled (ticket 08, owner ruling 2026-09-17). The load's own
   *  decodes never record these two: RadPager.load treats them as a
   *  whole-load pool failure (ticket 05 fail-fast). */
  reason: ChunkUnavailableReason | "decode-failed" | "decode-dispatch-failed" | "decode-protocol-error";
  attempts: number;
  detail: string;
}

export interface FetchedChunk {
  index: number;
  bytes: ArrayBuffer;
  /** Attempts it took to land this chunk (1 = first try). */
  attempts: number;
}

export interface FetchStats {
  /** Chunks requested (one per chunk, regardless of attempts). */
  requested: number;
  landed: number;
  bytesLanded: number;
  /** Re-issued requests across all chunks. */
  retries: number;
  unavailable: number;
}

export interface RadFetcherOptions {
  /** TEST-ONLY seam (owner ruling S5): replaces global fetch so fixtures
   *  can inject failures deterministically. Never set in production code. */
  fetchImpl?: typeof fetch;
  /** Default MAX_ATTEMPTS. */
  maxAttempts?: number;
  signal?: AbortSignal;
}

type Attempt =
  | { kind: "ok"; bytes: ArrayBuffer }
  | { kind: "retry"; reason: ChunkUnavailableReason; detail: string }
  | { kind: "terminal"; reason: ChunkUnavailableReason; detail: string }
  | { kind: "unsupported"; detail: string }
  | { kind: "aborted" };

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One Range request, classified. `expectedBytes` null = don't check the
 *  length (the header probe legitimately lands short on small files). */
async function rangeRequest(
  fetchImpl: typeof fetch,
  url: string,
  start: number,
  end: number,
  expectedBytes: number | null,
  signal: AbortSignal,
): Promise<Attempt> {
  const range = `bytes=${start}-${end}`;
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { Range: range }, signal });
  } catch (error) {
    if (isAbortError(error)) return { kind: "aborted" };
    return {
      kind: "retry",
      reason: "range-network-error",
      detail: `${range}: ${errorDetail(error)}`,
    };
  }
  if (response.status === 200) {
    return {
      kind: "unsupported",
      detail: `${range}: got 200 — server ignores Range (206 required)`,
    };
  }
  if (response.status >= 500) {
    return {
      kind: "retry",
      reason: "range-server-error",
      detail: `${range}: status ${response.status}`,
    };
  }
  if (response.status !== 206) {
    return {
      kind: "terminal",
      reason: "range-rejected",
      detail: `${range}: status ${response.status}`,
    };
  }
  let bytes: ArrayBuffer;
  try {
    bytes = await response.arrayBuffer();
  } catch (error) {
    if (isAbortError(error)) return { kind: "aborted" };
    return {
      kind: "retry",
      reason: "range-network-error",
      detail: `${range}: body read failed — ${errorDetail(error)}`,
    };
  }
  if (expectedBytes !== null && bytes.byteLength !== expectedBytes) {
    return {
      kind: "retry",
      reason: "range-length-mismatch",
      detail: `${range}: expected ${expectedBytes} B, got ${bytes.byteLength}`,
    };
  }
  return { kind: "ok", bytes };
}

/** The attempt loop shared by header and chunk fetches. Resolves with the
 *  final outcome; a `retry` outcome here means attempts were exhausted. */
async function withRetries(
  attempt: () => Promise<Attempt>,
  maxAttempts: number,
  onRetry: () => void,
): Promise<{ outcome: Attempt; attempts: number }> {
  let last: Attempt = { kind: "aborted" };
  for (let n = 1; n <= maxAttempts; n++) {
    last = await attempt();
    if (last.kind !== "retry") return { outcome: last, attempts: n };
    if (n < maxAttempts) onRetry();
  }
  return { outcome: last, attempts: maxAttempts };
}

function resolveMaxAttempts(value: number | undefined): number {
  const max = value ?? MAX_ATTEMPTS;
  if (!Number.isInteger(max) || max < 1) {
    // maxAttempts 0 / NaN would make the attempt loop never run and every
    // chunk vanish without a callback (adversarial review, 2026-09-02).
    throw new SplatBackendError(
      "invalid-max-attempts",
      `maxAttempts must be a positive integer, got ${max}`,
    );
  }
  return max;
}

/** A child AbortController that follows `parent` (already-aborted parents
 *  abort it immediately). Shared with RadPager. */
export function linkAbortSignal(parent: AbortSignal | undefined): AbortController {
  const controller = new AbortController();
  if (parent !== undefined) {
    if (parent.aborted) controller.abort();
    else parent.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller;
}

export class RadFetcher {
  readonly stats: FetchStats = {
    requested: 0,
    landed: 0,
    bytesLanded: 0,
    retries: 0,
    unavailable: 0,
  };

  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;
  private readonly signal: AbortSignal | undefined;

  constructor(
    private readonly url: string,
    private readonly header: RadHeaderInfo,
    options: RadFetcherOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxAttempts = resolveMaxAttempts(options.maxAttempts);
    this.signal = options.signal;
  }

  /**
   * Range-fetches the header region: probe bytes=0-65535 (206-or-die), read
   * headerEnd from the first 8 bytes, then range-fetch the remainder until
   * headerEnd is covered. A server may legitimately serve FEWER bytes than
   * a range asks for (RFC 9110 §14.4 — the Content-Range says what came),
   * so a short probe is never taken to mean a short file: each remainder
   * request must make progress, and one that lands zero bytes means the
   * file ends before its own headerEnd -> `rad-header-short` (adversarial
   * review, 2026-09-02). Rejects with a named SplatBackendError — header
   * failure is a whole-load failure (owner ruling S3).
   */
  static async fetchHeader(
    url: string,
    options: RadFetcherOptions = {},
  ): Promise<ArrayBuffer> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const maxAttempts = resolveMaxAttempts(options.maxAttempts);
    const controller = linkAbortSignal(options.signal);

    let got = await RadFetcher.headerRange(
      fetchImpl, url, 0, HEADER_PROBE_BYTES - 1, maxAttempts, controller.signal, "header probe",
    );
    const headerEnd = readRadHeaderEnd(got);
    while (got.byteLength < headerEnd) {
      const rest = await RadFetcher.headerRange(
        fetchImpl, url, got.byteLength, headerEnd - 1, maxAttempts, controller.signal, "header remainder",
      );
      if (rest.byteLength === 0) {
        throw new SplatBackendError(
          "rad-header-short",
          `header needs ${headerEnd} bytes, file ends at ${got.byteLength}`,
        );
      }
      const joined = new Uint8Array(got.byteLength + rest.byteLength);
      joined.set(new Uint8Array(got), 0);
      joined.set(new Uint8Array(rest), got.byteLength);
      got = joined.buffer;
    }
    return got;
  }

  private static async headerRange(
    fetchImpl: typeof fetch,
    url: string,
    start: number,
    end: number,
    maxAttempts: number,
    signal: AbortSignal,
    what: string,
  ): Promise<ArrayBuffer> {
    const { outcome, attempts } = await withRetries(
      () => rangeRequest(fetchImpl, url, start, end, null, signal),
      maxAttempts,
      () => {},
    );
    switch (outcome.kind) {
      case "ok":
        return outcome.bytes;
      case "unsupported":
        throw new SplatBackendError("range-unsupported", `${what}: ${outcome.detail}`);
      case "aborted":
        throw new SplatBackendError("fetch-aborted", `${what} aborted`);
      case "terminal":
      case "retry":
        throw new SplatBackendError(
          outcome.reason,
          `${what} failed after ${attempts} attempt(s): ${outcome.detail}`,
        );
    }
  }

  /**
   * Prefetch-all: fire every chunk request immediately; deliver each to
   * `onChunk` as it lands (arrival order, not index order); report each
   * given-up chunk to `onUnavailable`. Resolves once every chunk has landed
   * or been given up on. Rejects ONLY for whole-load failures:
   * `range-unsupported` (a 200 — all in-flight requests aborted) or
   * `fetch-aborted` (the caller's signal fired).
   */
  async prefetchAll(
    onChunk: (chunk: FetchedChunk) => void,
    onUnavailable: (unavailable: ChunkUnavailable) => void,
  ): Promise<void> {
    const { chunksStart, chunks } = this.header;
    const controller = linkAbortSignal(this.signal);
    let fatal: SplatBackendError | null = null;

    const tasks = chunks.map(async (chunk, index) => {
      const start = chunksStart + chunk.offset;
      const end = start + chunk.bytes - 1; // Range end is inclusive
      this.stats.requested++;
      const { outcome, attempts } = await withRetries(
        () => rangeRequest(this.fetchImpl, this.url, start, end, chunk.bytes, controller.signal),
        this.maxAttempts,
        () => {
          this.stats.retries++;
        },
      );
      switch (outcome.kind) {
        case "ok":
          this.stats.landed++;
          this.stats.bytesLanded += outcome.bytes.byteLength;
          onChunk({ index, bytes: outcome.bytes, attempts });
          return;
        case "unsupported":
          if (fatal === null) {
            fatal = new SplatBackendError(
              "range-unsupported",
              `chunk ${index} ${outcome.detail}`,
            );
          }
          controller.abort();
          return;
        case "aborted":
          return;
        case "terminal":
        case "retry":
          this.stats.unavailable++;
          onUnavailable({
            index,
            reason: outcome.reason,
            attempts,
            detail: outcome.detail,
          });
          return;
      }
    });
    await Promise.all(tasks);
    if (fatal !== null) throw fatal;
    if (this.signal?.aborted) {
      throw new SplatBackendError("fetch-aborted", "prefetch aborted by caller");
    }
  }
}
