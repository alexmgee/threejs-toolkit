/**
 * SplatBackend seam — real surface (ticket 03).
 *
 * doc 02 design rule 2: this directory and src/vendor/ are the only places
 * permitted to import the fork. Everything else reaches forked code through
 * here — the only door.
 */

// Real Phase 2 module (ticket 02): the embed entry carries the inline decode
// worker through this export (D14 variant A). The D18 placeholder types are
// gone (ticket 03, delete-and-replace); this export stays.
// TICKET-03 GUARD: never blanket re-export this barrel from src/index.ts —
// ./decode's `?worker&inline` import is ~200 kB of untree-shakeable base64,
// and the LIBRARY consumer wants the URL-constructed worker, not the inline
// one. The lib barrel must pick names, excluding ./decode.
export { createDecodeWorker, type DecodeRequest, type DecodeResult } from "./decode";

export {
  HANDLE_BRAND,
  SplatBackendError,
  type LoadPhase,
  type LoadProgress,
  type SdfEdit,
  type SplatBackend,
  type SplatCounts,
  type SplatFormat,
  type SplatHandle,
  type SplatHit,
  type SplatOptics,
  type SplatSource,
} from "./SplatBackend.js";
export { ThreeGsBackend } from "./ThreeGsBackend.js";
// Ticket 05 — fetch + decode pool (none of these value-import the worker;
// the pool takes a worker factory, keeping the inline-worker rules intact).
export {
  parseRadHeader,
  readRadHeaderEnd,
  roundup8,
  type RadChunkRange,
  type RadHeaderInfo,
} from "./RadHeader.js";
export {
  HEADER_PROBE_BYTES,
  MAX_ATTEMPTS,
  RadFetcher,
  type ChunkUnavailable,
  type ChunkUnavailableReason,
  type FetchStats,
  type FetchedChunk,
  type RadFetcherOptions,
} from "./RadFetcher.js";
export {
  DECODE_POOL_SIZE,
  DecodeFailedError,
  DecodePool,
  type DecodeJobRecord,
  type DecodePoolOptions,
} from "./DecodePool.js";
export {
  RadPager,
  type RadLoadHooks,
  type RadLoadReport,
  type RadPagerOptions,
  type RadPagerProgress,
} from "./RadPager.js";
// Ticket 06 — page residency.
export {
  PagePool,
  indexOrder,
  type ChunkPriority,
  type PageBounds,
  type PagePoolOptions,
} from "./PagePool.js";
export type { PageBudget, PagerDiagnostics } from "./ThreeGsBackend.js";
