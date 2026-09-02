/**
 * rad-lab — RadPager fetch + 4-worker decode pool fixture (ticket 05).
 *
 * Range-fetches and decodes the golden .rad asset through RadPager /
 * RadFetcher / DecodePool, asserting fetch taxonomy, pool parallelism,
 * checksum stability, and failure injection paths.
 *
 * DEV hook: window.__radLab { done } — await done for { passed, failed }.
 */

import { RadPager } from "@toolkit/backend/RadPager";
import type { RadLoadReport } from "@toolkit/backend/RadPager";
import { RadFetcher, isAbortError } from "@toolkit/backend/RadFetcher";
import { parseRadHeader } from "@toolkit/backend/RadHeader";
import type { RadHeaderInfo } from "@toolkit/backend/RadHeader";
import { SplatBackendError } from "@toolkit/backend/SplatBackend";
import type { DecodeResult } from "@toolkit/backend/rad-worker";
import {
  evidenceSelfCheck,
  maxConcurrentBusy,
  sha256View,
  sumBusyMs,
  sumView,
  unionBusyMs,
} from "./evidence";

const ASSET = "/@fs/D:/Projects/sparkjs-toolkit/examples/assets/lab-sh1-sparsity.rad";

const EXPECTED_CHUNK0: Record<ChecksumKey, string> = {
  center: "9f411115",
  covariance: "c35b272a",
  color: "21867ad1",
  sh1Words: "50b88b76",
  alpha: "bf16b679",
  scale: "9cea90d3",
  quat: "d7c2391c",
  childCount: "89e7d9c2",
  childStart: "a2362cb7",
};

const CHECKSUM_KEYS = [
  "center",
  "covariance",
  "color",
  "sh1Words",
  "alpha",
  "scale",
  "quat",
  "childCount",
  "childStart",
] as const;

type ChecksumKey = (typeof CHECKSUM_KEYS)[number];
type ChunkSums = Record<ChecksumKey, string>;

const out = document.getElementById("out")!;
let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, detail: string): void {
  const div = document.createElement("div");
  div.className = `assertion ${condition ? "pass" : "fail"}`;
  div.textContent = `${condition ? "PASS" : "FAIL"} — ${name}: ${detail}`;
  out.appendChild(div);
  console.log(`rad-lab ${condition ? "PASS" : "FAIL"} ${name} — ${detail}`);
  if (condition) {
    passed++;
  } else {
    failed++;
  }
}

function finishSummary(): void {
  const heading = document.createElement("h2");
  heading.className = failed === 0 ? "pass" : "fail";
  heading.textContent = `rad-lab: ${passed} passed, ${failed} failed`;
  out.appendChild(heading);
  console.log(`rad-lab RESULT ${passed} passed, ${failed} failed`);
}

function createWorker(): Worker {
  return new Worker(new URL("@toolkit/backend/rad-worker.ts", import.meta.url), {
    type: "module",
  });
}

function getRangeHeader(init?: RequestInit): string | null {
  if (!init?.headers) return null;
  const headers = init.headers;
  if (headers instanceof Headers) return headers.get("Range");
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      if (key.toLowerCase() === "range") return value;
    }
    return null;
  }
  const record = headers as Record<string, string>;
  return record.Range ?? record.range ?? null;
}

function parseRangeStart(rangeHeader: string | null): number | null {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d+)/.exec(rangeHeader);
  return match ? Number(match[1]) : null;
}

function chunkIndexFromRangeStart(start: number, header: RadHeaderInfo): number | null {
  for (let i = 0; i < header.chunks.length; i++) {
    if (header.chunksStart + header.chunks[i].offset === start) return i;
  }
  return null;
}

interface RequestRecord {
  rangeHeader: string | null;
  status: number;
}

function createRecordingFetch(
  delegate: typeof fetch = fetch,
): { fetchImpl: typeof fetch; records: RequestRecord[] } {
  const records: RequestRecord[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const rangeHeader = getRangeHeader(init);
    const response = await delegate(input, init);
    records.push({ rangeHeader, status: response.status });
    return response;
  };
  return { fetchImpl, records };
}

/** FNV-1a per array — used for the chunk-0 golden pin ONLY (decode-lab's
 *  pinned values are FNV-1a); the field list is CHECKSUM_KEYS, once. */
function checksumsFromResult(result: DecodeResult): ChunkSums {
  const out = {} as ChunkSums;
  for (const key of CHECKSUM_KEYS) out[key] = sumView(result[key]);
  return out;
}

/** SHA-256 per array — the pool-4 vs pool-1 determinism proof (FNV-1a is
 *  the golden pin only; see evidence.ts). */
async function digestsFromResult(result: DecodeResult): Promise<ChunkSums> {
  const digests = await Promise.all(CHECKSUM_KEYS.map((key) => sha256View(result[key])));
  const out = {} as ChunkSums;
  CHECKSUM_KEYS.forEach((key, i) => { out[key] = digests[i]!; });
  return out;
}

function workerJobCounts(jobs: RadLoadReport["jobs"]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const job of jobs) {
    counts.set(job.worker, (counts.get(job.worker) ?? 0) + 1);
  }
  return counts;
}

function formatWorkerCounts(counts: Map<number, number>): string {
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([worker, count]) => `w${worker}=${count}`)
    .join(", ");
}

/** Worker-side decode intervals of the successful jobs. */
function decodeWindows(jobs: RadLoadReport["jobs"]): { dispatchedAt: number; completedAt: number }[] {
  return jobs
    .filter((job) => job.ok)
    .map((job) => ({ dispatchedAt: job.decodeStart, completedAt: job.decodeEnd }));
}

function decodePhaseWallMs(jobs: RadLoadReport["jobs"]): number {
  if (jobs.length === 0) return 0;
  const dispatched = Math.min(...jobs.map((job) => job.dispatchedAt));
  const completed = Math.max(...jobs.map((job) => job.completedAt));
  return completed - dispatched;
}

function printEvidence(
  label: string,
  records: RequestRecord[],
  report: RadLoadReport,
): void {
  const jobs = report.jobs;
  const decodeWallMs = decodePhaseWallMs(jobs);
  const sumDecodeMs = jobs.reduce((sum, job) => sum + job.decodeMs, 0);
  const workerCounts = workerJobCounts(jobs);
  const decodeWallSec = decodeWallMs / 1000;
  const chunksPerSec = decodeWallSec > 0 ? report.decoded / decodeWallSec : 0;
  const mbPerSec = decodeWallSec > 0 ? report.fetch.bytesLanded / decodeWallSec / 1e6 : 0;
  const totalLoadMs = report.finishedAt - report.startedAt;
  const prefix = label.length > 0 ? `rad-lab EVIDENCE ${label}` : "rad-lab EVIDENCE";

  console.log(
    `${prefix}
` +
      `  requests: ${records.length}
` +
      `  206: ${records.filter((record) => record.status === 206).length}
` +
      `  pool size: ${report.poolSize}
` +
      `  per-worker jobs: ${formatWorkerCounts(workerCounts)}
` +
      `  maxConcurrentBusy: ${maxConcurrentBusy(jobs)}
` +
      `  main-thread windows: sum ${sumBusyMs(jobs).toFixed(1)} / union ${unionBusyMs(jobs).toFixed(1)} ms
` +
      `  worker-side decode windows: maxConcurrent ${maxConcurrentBusy(decodeWindows(jobs))}, sum ${sumBusyMs(decodeWindows(jobs)).toFixed(1)} / union ${unionBusyMs(decodeWindows(jobs)).toFixed(1)} ms
` +
      `  sum decodeMs: ${sumDecodeMs.toFixed(1)}
` +
      `  decode-phase wall ms: ${decodeWallMs.toFixed(1)}
` +
      `  throughput: ${chunksPerSec.toFixed(1)} chunks/s, ${mbPerSec.toFixed(2)} MB/s
` +
      `  queuedMax: ${report.queuedMax}
` +
      `  total load ms: ${totalLoadMs.toFixed(1)}`,
  );
}

interface CompletionRecord {
  delegated: boolean;
  completionTime: number;
  error?: unknown;
  status?: number;
}


// Every load in this fixture runs under this listener: a pool disposed
// mid-load used to leave `pool-disposed` rejections nobody awaited
// (built-in review, 2026-09-02) — invisible to per-assertion checks, so it
// is asserted globally at the end.
let unhandledRejections = 0;
window.addEventListener("unhandledrejection", (ev) => {
  unhandledRejections++;
  console.error("rad-lab UNHANDLED REJECTION", ev.reason);
});

const done = (async () => {
  const selfCheck = evidenceSelfCheck();
  assert("evidence-self-check", selfCheck === null, selfCheck ?? "ok");

  const { fetchImpl: recordingFetchA, records: runARecords } = createRecordingFetch();
  const sums4: Record<number, ChunkSums> = {};
  const digests4: Record<number, Promise<ChunkSums>> = {};
  const pagerA = new RadPager(ASSET, {
    fetchImpl: recordingFetchA,
    createWorker,
    poolSize: 4,
  });
  const reportA = await pagerA.load((result) => {
    // FNV-1a only where it is compared against a pin (chunk 0); every
    // extra main-thread byte loop here delays the pool's next dispatch.
    if (result.index === 0) sums4[result.index] = checksumsFromResult(result);
    digests4[result.index] = digestsFromResult(result);
  });
  pagerA.dispose();

  const headerA = reportA.header;
  // Every request must be a Range request answered 206 AND the set of
  // ranges must be exactly the header probe plus one range per chunk
  // spanning precisely that chunk's bytes — a single whole-file Range
  // request sliced locally would otherwise satisfy "all Range, all 206"
  // (adversarial review, 2026-09-02).
  const allRange = runARecords.every(
    (record) => record.rangeHeader !== null && record.status === 206,
  );
  const expectedRanges = new Set<string>();
  expectedRanges.add(`bytes=0-${65536 - 1}`);
  for (const chunk of headerA.chunks) {
    const start = headerA.chunksStart + chunk.offset;
    expectedRanges.add(`bytes=${start}-${start + chunk.bytes - 1}`);
  }
  const seenRanges = new Set(runARecords.map((record) => record.rangeHeader ?? ""));
  const rangesExact =
    runARecords.length === headerA.chunks.length + 1 &&
    seenRanges.size === expectedRanges.size &&
    [...expectedRanges].every((range) => seenRanges.has(range));
  assert(
    "all-requests-range",
    allRange && rangesExact,
    `${runARecords.length} requests, all Range, all 206; ranges = header probe + ${headerA.chunks.length} exact per-chunk ranges (${rangesExact ? "exact" : "MISMATCH"})`,
  );

  assert(
    "all-chunks-decoded",
    reportA.decoded === headerA.chunks.length && reportA.unavailable.length === 0,
    `decoded=${reportA.decoded}/${headerA.chunks.length}, unavailable=${reportA.unavailable.length}, retries=${reportA.fetch.retries}`,
  );

  const workersA = new Set(reportA.jobs.map((job) => job.worker));
  assert(
    "pool-size-4",
    reportA.poolSize === 4 && workersA.size === 4,
    `poolSize=${reportA.poolSize}, distinct workers=${workersA.size}`,
  );

  const decodeWallA = decodePhaseWallMs(reportA.jobs);
  const sumDecodeMsA = reportA.jobs.reduce((sum, job) => sum + job.decodeMs, 0);
  const maxBusyA = maxConcurrentBusy(reportA.jobs);
  const workerCountsA = workerJobCounts(reportA.jobs);
  const decodeWallSecA = decodeWallA / 1000;
  const chunksPerSecA = decodeWallSecA > 0 ? reportA.decoded / decodeWallSecA : 0;
  const mbPerSecA =
    decodeWallSecA > 0 ? reportA.fetch.bytesLanded / decodeWallSecA / 1e6 : 0;
  // Parallelism proof: the four workers' busy windows overlap (maxBusy 4)
  // AND their aggregate busy time exceeds the union of those windows —
  // impossible without concurrent execution. NOT compared against the
  // decode-phase span: that span is FETCH-bound (chunks arrive over the
  // whole download while decode totals a few seconds), so aggregate decode
  // time can never exceed it — a criterion that could not pass was the
  // first cut's defect, caught live (2026-09-02).
  // Measured INSIDE the workers (epoch-ms decodeStart/decodeEnd): the
  // main-thread dispatch→reply windows would count fixture checksum time
  // and message queuing as "busy" (observed: 47 s of main-thread busy vs
  // 2.9 s of decode), and four outstanding jobs is true by construction.
  const decodeWindowsA = decodeWindows(reportA.jobs);
  const maxDecodeBusyA = maxConcurrentBusy(decodeWindowsA);
  const sumDecodeBusyA = sumBusyMs(decodeWindowsA);
  const unionDecodeBusyA = unionBusyMs(decodeWindowsA);
  assert(
    "four-workers-concurrent",
    maxBusyA === 4 && maxDecodeBusyA === 4 && sumDecodeBusyA > unionDecodeBusyA,
    `worker-side: maxConcurrent=${maxDecodeBusyA} sum=${sumDecodeBusyA.toFixed(1)} ms > union=${unionDecodeBusyA.toFixed(1)} ms (mean concurrency ${(sumDecodeBusyA / unionDecodeBusyA).toFixed(2)}; decode busy ${(100 * unionDecodeBusyA / decodeWallA).toFixed(0)}% of the ${decodeWallA.toFixed(0)} ms fetch-bound phase); main-thread outstanding max=${maxBusyA}; workers={${formatWorkerCounts(workerCountsA)}} throughput=${chunksPerSecA.toFixed(1)} chunks/s ${mbPerSecA.toFixed(2)} MB/s`,
  );

  const chunk0 = sums4[0];
  const chunk0Matches = CHECKSUM_KEYS.every((key) => chunk0[key] === EXPECTED_CHUNK0[key]);
  assert(
    "chunk0-matches-golden",
    chunk0Matches,
    chunk0Matches
      ? `chunk 0 matches decode-lab golden checksums (center=${chunk0.center})`
      : CHECKSUM_KEYS.filter((key) => chunk0[key] !== EXPECTED_CHUNK0[key])
          .map((key) => `${key}=${chunk0[key]} want ${EXPECTED_CHUNK0[key]}`)
          .join("; "),
  );

  printEvidence("", runARecords, reportA);

  const digests1: Record<number, Promise<ChunkSums>> = {};
  const pagerB = new RadPager(ASSET, {
    createWorker,
    poolSize: 1,
  });
  const reportB = await pagerB.load((result) => {
    digests1[result.index] = digestsFromResult(result);
  });
  pagerB.dispose();

  let comparedChunks = 0;
  let digestMismatches = 0;
  let digestsCompared = 0;
  for (let i = 0; i < headerA.chunks.length; i++) {
    comparedChunks++;
    const d4 = await digests4[i];
    const d1 = await digests1[i];
    for (const key of CHECKSUM_KEYS) {
      digestsCompared++;
      if (d4[key] !== d1[key] || d4[key].length !== 64) digestMismatches++;
    }
  }
  const workersB = new Set(reportB.jobs.map((job) => job.worker));
  assert(
    "pool-1-checksums-identical",
    digestMismatches === 0 && workersB.size === 1 && digestsCompared === headerA.chunks.length * 9,
    `compared ${comparedChunks} chunks x 9 arrays: SHA-256 mismatches=${digestMismatches} (of ${digestsCompared}), workers=${workersB.size}`,
  );

  printEvidence("pool1", [], reportB);

  const attemptCounts = new Map<number, number>();
  const nextAttempt = (chunkIndex: number): number => {
    const attempt = (attemptCounts.get(chunkIndex) ?? 0) + 1;
    attemptCounts.set(chunkIndex, attempt);
    return attempt;
  };

  const failureFetch: typeof fetch = async (input, init) => {
    const rangeHeader = getRangeHeader(init);
    const start = parseRangeStart(rangeHeader);
    if (start !== null) {
      const chunkIndex = chunkIndexFromRangeStart(start, headerA);
      if (chunkIndex !== null) {
        const attempt = nextAttempt(chunkIndex);
        if (chunkIndex === 3) {
          if (attempt <= 2) return new Response(null, { status: 503 });
          return fetch(input, init);
        }
        if (chunkIndex === 7) {
          return new Response(null, { status: 503 });
        }
        if (chunkIndex === 11) {
          return new Response(null, { status: 404 });
        }
        if (chunkIndex === 13) {
          const real = await fetch(input, init);
          const body = new Uint8Array(await real.arrayBuffer());
          const end = Math.min(8 + 64, body.length);
          for (let i = 8; i < end; i++) body[i] = 0;
          return new Response(body, { status: 206 });
        }
        if (chunkIndex === 19) {
          // Chunk-header wrap drill on the REAL wasm32 build: RADC magic +
          // meta length 0xFFFFFFFF, padded to the chunk's true length so
          // the fetcher's length check passes. The hardened crate must
          // refuse it with a returned Err (→ decode-failed, per-chunk);
          // the pre-fix crate PANICKED here (slice 8..7) — a trap the
          // worker now reports as fatal, which would reject this whole
          // load with decode-worker-error and turn the drill red.
          const real = await fetch(input, init);
          const body = new Uint8Array(await real.arrayBuffer());
          body.fill(0);
          body.set([0x52, 0x41, 0x44, 0x43], 0); // 'RADC'
          body.set([0xff, 0xff, 0xff, 0xff], 4); // meta length u32::MAX
          return new Response(body, { status: 206 });
        }
        if (chunkIndex === 17) {
          if (attempt === 1) {
            const real = await fetch(input, init);
            const body = new Uint8Array(await real.arrayBuffer());
            const half = body.slice(0, Math.floor(body.length / 2));
            return new Response(half, { status: 206 });
          }
          return fetch(input, init);
        }
      }
    }
    return fetch(input, init);
  };

  const decodedC = new Set<number>();
  const pagerC = new RadPager(ASSET, {
    fetchImpl: failureFetch,
    createWorker,
    poolSize: 4,
  });
  const reportC = await pagerC.load((result) => {
    decodedC.add(result.index);
  });
  pagerC.dispose();

  const unavailable7 = reportC.unavailable.find((entry) => entry.index === 7);
  // Pin the INJECTED retries exactly (chunk 3: 2, chunk 7: 2, chunk 17: 1);
  // real transient failures on the un-injected chunks are recovered by the
  // same path and reported, never forbidden — a warm fast run hit two
  // genuine ones and a total-count pin went red on the feature working
  // (caught live, 2026-09-02).
  const injectedRetries =
    (reportC.attempts[3]! - 1) + ((unavailable7?.attempts ?? 1) - 1) + (reportC.attempts[17]! - 1);
  const transientRetried = reportC.attempts
    .map((attempts, index) => ({ index, attempts }))
    .filter(({ index, attempts }) => attempts > 1 && index !== 3 && index !== 17 && index !== 7);
  assert(
    "retry-then-success",
    decodedC.has(3) && reportC.attempts[3] === 3 && injectedRetries === 5 && reportC.fetch.retries >= 5,
    `chunk3 decoded=${decodedC.has(3)} attempts=${reportC.attempts[3]}; injected retries=${injectedRetries} (want 5); total retries=${reportC.fetch.retries}; real transient retries recovered on chunks [${transientRetried.map((t) => `${t.index}:${t.attempts}`).join(", ")}]`,
  );

  assert(
    "retry-exhausted-unavailable",
    unavailable7?.reason === "range-server-error" && unavailable7.attempts === 3,
    unavailable7
      ? `chunk7 reason=${unavailable7.reason} attempts=${unavailable7.attempts}`
      : "chunk7 missing from unavailable",
  );

  const unavailable11 = reportC.unavailable.find((entry) => entry.index === 11);
  assert(
    "rejected-no-retry",
    unavailable11?.reason === "range-rejected" && unavailable11.attempts === 1,
    unavailable11
      ? `chunk11 reason=${unavailable11.reason} attempts=${unavailable11.attempts}`
      : "chunk11 missing from unavailable",
  );

  const unavailable13 = reportC.unavailable.find((entry) => entry.index === 13);
  assert(
    "decode-failed-no-retry",
    // attempts = the FETCH attempts that produced the corrupt bytes (usually
    // 1; a real transient on the inner fetch makes it 2 — still one decode).
    unavailable13?.reason === "decode-failed" &&
      unavailable13.attempts >= 1 &&
      unavailable13.attempts === reportC.attempts[13],
    unavailable13
      ? `chunk13 reason=${unavailable13.reason} attempts=${unavailable13.attempts} (fetch attempts ${reportC.attempts[13]}; decoded exactly once, never retried on the same bytes)`
      : "chunk13 missing from unavailable",
  );

  const unavailable19 = reportC.unavailable.find((entry) => entry.index === 19);
  assert(
    "hostile-meta-length-refused-not-trapped",
    unavailable19?.reason === "decode-failed" &&
      unavailable19.attempts >= 1 &&
      unavailable19.attempts === reportC.attempts[19] &&
      unavailable19.detail.includes("out of range"),
    unavailable19
      ? `chunk19 reason=${unavailable19.reason} attempts=${unavailable19.attempts} detail="${unavailable19.detail}" (load resolved — worker not poisoned)`
      : "chunk19 missing from unavailable (a trap would have rejected the whole load)",
  );

  const unavailableIndices = reportC.unavailable.map((entry) => entry.index).sort((a, b) => a - b);
  assert(
    "length-mismatch-retried",
    decodedC.has(17) &&
      unavailableIndices.length === 4 &&
      unavailableIndices[0] === 7 &&
      unavailableIndices[1] === 11 &&
      unavailableIndices[2] === 13 &&
      unavailableIndices[3] === 19 &&
      reportC.decoded === 118 &&
      reportC.attempts[17] === 2 &&
      reportC.attempts[3] === 3 &&
      reportC.attempts[0] === 1,
    `chunk17 decoded=${decodedC.has(17)} attempts=${reportC.attempts[17]} (chunk3 attempts=${reportC.attempts[3]}, chunk0=${reportC.attempts[0]}), unavailable=[${unavailableIndices.join(", ")}], decoded=${reportC.decoded} (want 118)`,
  );

  assert(
    "load-resolves-with-shortfall",
    reportC.decoded + reportC.unavailable.length === headerA.chunks.length,
    `decoded=${reportC.decoded} + unavailable=${reportC.unavailable.length} = ${reportC.decoded + reportC.unavailable.length} (want ${headerA.chunks.length})`,
  );

  let headerRejected = false;
  try {
    await RadFetcher.fetchHeader(ASSET, {
      fetchImpl: () =>
        Promise.resolve(new Response(new Uint8Array(16), { status: 200 })),
    });
  } catch (error) {
    headerRejected =
      error instanceof SplatBackendError && error.reason === "range-unsupported";
  }
  assert(
    "header-200-refused",
    headerRejected,
    headerRejected ? "fetchHeader rejected range-unsupported on status 200" : "expected range-unsupported rejection",
  );

  const completionRecords: CompletionRecord[] = [];
  let rejectionTime = 0;
  let chunkAbortReason = "";
  let decodedAfterRejection = 0;
  let decodedD = 0;

  const abortFetch: typeof fetch = async (input, init) => {
    const rangeHeader = getRangeHeader(init);
    const start = parseRangeStart(rangeHeader);
    const chunkIndex = start !== null ? chunkIndexFromRangeStart(start, headerA) : null;

    if (chunkIndex === 5) {
      completionRecords.push({ delegated: false, completionTime: performance.now(), status: 200 });
      return new Response(new Uint8Array(100), { status: 200 });
    }

    try {
      const response = await fetch(input, init);
      completionRecords.push({ delegated: true, completionTime: performance.now(), status: response.status });
      return response;
    } catch (error) {
      completionRecords.push({ delegated: true, completionTime: performance.now(), error });
      throw error;
    }
  };

  const pagerD = new RadPager(ASSET, {
    fetchImpl: abortFetch,
    createWorker,
    poolSize: 4,
  });
  try {
    await pagerD.load(() => {
      decodedD++;
      if (rejectionTime > 0) decodedAfterRejection++;
    });
  } catch (error) {
    rejectionTime = performance.now();
    chunkAbortReason =
      error instanceof SplatBackendError ? error.reason : String(error);
  } finally {
    pagerD.dispose();
  }

  // The proof that the 200 ABORTED the others: delegated requests that
  // rejected with AbortError must exist (≥ 1), every other chunk request
  // must have settled either as a 206 or as an abort (none pending, none
  // with another status), and no decode result may arrive after the
  // rejection. The earlier "no completion later than the rejection" form
  // was vacuous — prefetchAll settles every task before rejecting, so
  // nothing can ever be later (adversarial review, 2026-09-02). Removing
  // the fetcher's controller.abort() drives abortedCount to 0 → red.
  const delegated = completionRecords.filter((record) => record.delegated);
  const abortedCount = delegated.filter((record) => isAbortError(record.error)).length;
  const okCount = delegated.filter((record) => record.status === 206).length;
  const otherCount = delegated.length - abortedCount - okCount;
  const lateDelegated = completionRecords.filter(
    (record) =>
      record.delegated &&
      record.completionTime > rejectionTime &&
      !isAbortError(record.error),
  );
  assert(
    "chunk-200-aborts-load",
    chunkAbortReason === "range-unsupported" &&
      abortedCount >= 1 &&
      otherCount === 0 &&
      abortedCount + okCount === headerA.chunks.length - 1 + 1 &&
      decodedAfterRejection === 0 &&
      lateDelegated.length === 0,
    `reason=${chunkAbortReason}; delegated=${delegated.length} (header probe + ${headerA.chunks.length - 1} chunks): aborted=${abortedCount}, 206=${okCount}, other=${otherCount}; decoded before rejection=${decodedD}, after=${decodedAfterRejection}`,
  );

  // A worker that dies at load (script throws before onmessage) must break
  // the pool: the load REJECTS by name (decode-worker-error — not fetch-
  // aborted, not 122 decode-failed pages), and the fetch is aborted
  // promptly instead of downloading the rest of the asset (fail-fast;
  // built-in review, 2026-09-02).
  const brokenWorkerUrl = URL.createObjectURL(
    new Blob(["throw new Error('rad-lab: synthetic worker crash');"], { type: "text/javascript" }),
  );
  const { fetchImpl: recordingFetchE, records: runERecords } = createRecordingFetch();
  const abortedE = { count: 0 };
  const countingFetchE: typeof fetch = async (input, init) => {
    try {
      return await recordingFetchE(input, init);
    } catch (error) {
      if (isAbortError(error)) abortedE.count++;
      throw error;
    }
  };
  const pagerE = new RadPager(ASSET, {
    fetchImpl: countingFetchE,
    createWorker: () => new Worker(brokenWorkerUrl, { type: "module" }),
    poolSize: 4,
  });
  let brokenReason = "";
  let brokenDetail = "";
  const tE0 = performance.now();
  try {
    await pagerE.load(() => {});
  } catch (error) {
    brokenReason = error instanceof SplatBackendError ? error.reason : String(error);
    brokenDetail = error instanceof Error ? error.message : "";
  } finally {
    pagerE.dispose();
    URL.revokeObjectURL(brokenWorkerUrl);
  }
  const tE = performance.now() - tE0;
  assert(
    "broken-worker-fails-fast",
    brokenReason === "decode-worker-error" && abortedE.count >= 1,
    `load rejected SplatBackendError(${brokenReason}) "${brokenDetail}" after ${tE.toFixed(0)} ms; landed=${runERecords.length}, aborted fetches=${abortedE.count}`,
  );

  let badMagicThrown = false;
  try {
    parseRadHeader(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer);
  } catch (error) {
    badMagicThrown =
      error instanceof SplatBackendError && error.reason === "rad-bad-magic";
  }
  assert(
    "bad-magic-refused",
    badMagicThrown,
    badMagicThrown ? "parseRadHeader rejected rad-bad-magic" : "expected rad-bad-magic",
  );

  // Let any stray rejection surface before the global count is read.
  await new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(0);
  });
  assert(
    "no-unhandled-rejections",
    unhandledRejections === 0,
    `${unhandledRejections} unhandledrejection events across every load in this fixture`,
  );

  finishSummary();
  return { passed, failed };
})();

done.catch((err) => {
  const div = document.createElement("div");
  div.className = "assertion fail";
  div.textContent = `RAD-LAB RUNNER FAILED: ${err}`;
  out.appendChild(div);
  failed++;
  finishSummary();
  console.error("rad-lab runner failed", err);
});

declare global {
  interface Window {
    __radLab?: { done: Promise<{ passed: number; failed: number }> };
  }
}
window.__radLab = { done };
