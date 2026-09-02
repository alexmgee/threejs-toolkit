/**
 * Queued decode-worker pool (ticket 05) — promoted from the spike's single
 * worker with its one-decode gate to `size` long-lived workers, each holding
 * exactly one job at a time; excess jobs wait in a FIFO queue.
 *
 * Pool size — owner ruling S1 (2026-09-02, ticket 05 Comments):
 * DECODE_POOL_SIZE = 4, spec-inherited (doc 03 §A3 ← Spark's
 * `SplatWorker.ts:100` `maxWorkers = 4`, itself underived). Parameterized on
 * the constructor; `jobs` records every finished job's busy window so a
 * future default change is a one-line ruling with data.
 *
 * The workers are pool-agnostic (`rad-worker.ts`): request bytes are
 * TRANSFERRED in and come back on the result (or on the failure message),
 * so the caller's byte cache survives the zero-copy round trip. This module
 * never imports the worker — it takes a factory — so the inline-worker
 * boundary rules (.dependency-cruiser.cjs) stay intact.
 *
 * Workers are NOT terminated per decode (decode-lab's single-shot pattern
 * is explicitly not the template here — external audit 2026-08-27).
 */
import { errorDetail } from "./RadFetcher.js";
import { SplatBackendError } from "./SplatBackend.js";
import type { DecodeRequest, DecodeResult } from "./rad-worker.js";

/** Owner ruling S1 — see the module comment. */
export const DECODE_POOL_SIZE = 4;

export interface DecodeJobRecord {
  index: number;
  worker: number;
  /** Main-thread performance.now() at postMessage. */
  dispatchedAt: number;
  /** Main-thread performance.now() at the reply. */
  completedAt: number;
  /** Worker-side decode time (0 on failure). */
  decodeMs: number;
  /** Worker-side decode interval, epoch ms (0/0 on failure) — the
   *  utilization evidence measured INSIDE the workers. */
  decodeStart: number;
  decodeEnd: number;
  ok: boolean;
}

export interface DecodePoolOptions {
  createWorker: () => Worker;
  /** Default DECODE_POOL_SIZE. */
  size?: number;
}

/** A chunk the decoder refused. Deterministic on the same bytes, so never
 *  retried (owner ruling S3). `bytes` are the request bytes, transferred
 *  back so the caller's cache survives. */
export class DecodeFailedError extends SplatBackendError {
  readonly index: number;
  readonly bytes: ArrayBuffer;

  constructor(index: number, detail: string, bytes: ArrayBuffer) {
    super("decode-failed", `chunk ${index}: ${detail}`);
    this.index = index;
    this.bytes = bytes;
  }
}

interface Job {
  index: number;
  bytes: ArrayBuffer;
  resolve: (result: DecodeResult) => void;
  reject: (error: SplatBackendError) => void;
}

interface Slot {
  id: number;
  worker: Worker;
  job: Job | null;
  dispatchedAt: number;
}

type WorkerReply =
  | DecodeResult
  | { index: number; error: string; bytes: ArrayBuffer; fatal?: boolean };

export class DecodePool {
  readonly size: number;
  /** Every finished job, in completion order — the utilization evidence. */
  readonly jobs: DecodeJobRecord[] = [];
  /** High-water mark of the wait queue. */
  queuedMax = 0;

  private readonly slots: Slot[] = [];
  private readonly queue: Job[] = [];
  private disposed = false;
  /** Set on the first worker-level failure (WASM init/trap or an uncaught
   *  worker error). A broken pool rejects everything — queued, in-flight,
   *  and every later decode() — with the SAME error, so a caller sees one
   *  systemic failure fast instead of a stream of per-chunk ones. No
   *  silent worker respawn: a durably broken environment would otherwise
   *  loop forever (built-in review, 2026-09-02). The owner recreates the
   *  pool if it wants to try again. */
  private brokenBy: SplatBackendError | null = null;

  constructor(options: DecodePoolOptions) {
    const size = options.size ?? DECODE_POOL_SIZE;
    if (!Number.isInteger(size) || size < 1) {
      throw new SplatBackendError(
        "invalid-pool-size",
        `decode pool size must be a positive integer, got ${size}`,
      );
    }
    this.size = size;
    try {
      for (let id = 0; id < size; id++) {
        const slot: Slot = { id, worker: options.createWorker(), job: null, dispatchedAt: 0 };
        this.wire(slot);
        this.slots.push(slot);
      }
    } catch (error) {
      // A factory that throws on the Nth worker must not leak the N-1
      // already-created ones (adversarial review, 2026-09-02).
      for (const slot of this.slots) slot.worker.terminate();
      this.slots.length = 0;
      throw error;
    }
  }

  /** The worker-level failure that broke this pool, or null while healthy. */
  get broken(): SplatBackendError | null {
    return this.brokenBy;
  }

  /** Queue one chunk for decode. `bytes` are transferred to the worker and
   *  returned on the result (`result.bytes`) or on DecodeFailedError. */
  decode(index: number, bytes: ArrayBuffer): Promise<DecodeResult> {
    return new Promise<DecodeResult>((resolve, reject) => {
      if (this.disposed) {
        reject(new SplatBackendError("pool-disposed", `chunk ${index}: pool disposed`));
        return;
      }
      if (this.brokenBy !== null) {
        reject(this.brokenBy);
        return;
      }
      this.queue.push({ index, bytes, resolve, reject });
      if (this.queue.length > this.queuedMax) this.queuedMax = this.queue.length;
      this.pump();
    });
  }

  /** Terminates every worker; queued and in-flight jobs reject
   *  `pool-disposed` (their bytes are lost with the worker). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.slots) {
      slot.worker.terminate();
      const job = slot.job;
      slot.job = null;
      if (job !== null) {
        job.reject(new SplatBackendError("pool-disposed", `chunk ${job.index}: pool disposed mid-decode`));
      }
    }
    for (const job of this.queue.splice(0)) {
      job.reject(new SplatBackendError("pool-disposed", `chunk ${job.index}: pool disposed`));
    }
  }

  /** First worker-level failure: remember it, terminate everything, and
   *  reject every outstanding job with it (fail-fast, one cause). */
  private breakPool(error: SplatBackendError): void {
    if (this.brokenBy !== null) return;
    this.brokenBy = error;
    for (const slot of this.slots) {
      slot.worker.onmessage = null;
      slot.worker.onerror = null;
      slot.worker.terminate();
      const job = slot.job;
      slot.job = null;
      if (job !== null) {
        this.jobs.push({ index: job.index, worker: slot.id, dispatchedAt: slot.dispatchedAt, completedAt: performance.now(), decodeMs: 0, decodeStart: 0, decodeEnd: 0, ok: false });
        job.reject(error);
      }
    }
    for (const job of this.queue.splice(0)) job.reject(error);
  }

  private pump(): void {
    if (this.brokenBy !== null) return;
    for (const slot of this.slots) {
      if (slot.job !== null) continue;
      const job = this.queue.shift();
      if (job === undefined) return;
      slot.job = job;
      slot.dispatchedAt = performance.now();
      const request: DecodeRequest = { index: job.index, bytes: job.bytes };
      try {
        slot.worker.postMessage(request, [job.bytes]);
      } catch (error) {
        // A synchronous postMessage failure (e.g. an already-detached
        // buffer -> DataCloneError) must free the slot and settle the job,
        // or the slot is occupied forever and the queue behind it never
        // drains (adversarial review, 2026-09-02).
        slot.job = null;
        job.reject(new SplatBackendError(
          "decode-dispatch-failed",
          `chunk ${job.index}: could not post to worker ${slot.id} — ${errorDetail(error)}`,
        ));
      }
    }
  }

  private wire(slot: Slot): void {
    slot.worker.onmessage = (ev: MessageEvent<WorkerReply>) => {
      const job = slot.job;
      slot.job = null;
      const completedAt = performance.now();
      if (job === null) return; // reply after dispose/replacement — nothing to settle
      const reply = ev.data;
      if (reply.index !== job.index) {
        this.jobs.push({ index: job.index, worker: slot.id, dispatchedAt: slot.dispatchedAt, completedAt, decodeMs: 0, decodeStart: 0, decodeEnd: 0, ok: false });
        job.reject(new SplatBackendError(
          "decode-protocol-error",
          `worker ${slot.id} replied for chunk ${reply.index} while decoding chunk ${job.index}`,
        ));
      } else if ("error" in reply) {
        this.jobs.push({ index: job.index, worker: slot.id, dispatchedAt: slot.dispatchedAt, completedAt, decodeMs: 0, decodeStart: 0, decodeEnd: 0, ok: false });
        if (reply.fatal === true) {
          // Worker-level failure (WASM init, or a trap that poisoned the
          // instance) — NOT a property of the bytes. Breaks the whole pool
          // so the pager fails fast instead of reporting every later chunk
          // as deterministically undecodable.
          const error = new SplatBackendError(
            "decode-worker-error",
            `worker ${slot.id} cannot decode (chunk ${job.index}): ${reply.error}`,
          );
          job.reject(error);
          this.breakPool(error);
          return;
        } else {
          job.reject(new DecodeFailedError(job.index, reply.error, reply.bytes));
        }
      } else {
        this.jobs.push({ index: job.index, worker: slot.id, dispatchedAt: slot.dispatchedAt, completedAt, decodeMs: reply.decodeMs, decodeStart: reply.decodeStart, decodeEnd: reply.decodeEnd, ok: true });
        job.resolve(reply);
      }
      this.pump();
    };
    slot.worker.onerror = (ev: ErrorEvent) => {
      // An uncaught worker error (script/WASM load failure, a throw outside
      // the message handler) is a worker-level failure: break the pool.
      if (this.disposed) return;
      this.breakPool(new SplatBackendError(
        "decode-worker-error",
        `worker ${slot.id} crashed${slot.job !== null ? ` while decoding chunk ${slot.job.index}` : ""}: ${ev.message}`,
      ));
    };
  }
}
