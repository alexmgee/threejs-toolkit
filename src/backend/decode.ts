/**
 * Decode-worker factory — the embed bundle's door to the WASM decoder
 * (Phase 2 ticket 02; D14 RULED 2026-08-23: variant A, everything inline).
 *
 * The `?worker&inline` import carries the worker — WASM included, as base64 —
 * INSIDE whatever bundle imports this module, keeping the embed single-file
 * self-contained (doc 06 D14 grounds). Pages that want cacheable assets
 * (the site build's fixtures) construct the worker from its URL instead;
 * this module is the embed path.
 *
 * Ticket 05 builds the 4-worker pool on top of this factory.
 */
import DecodeWorker from "./rad-worker?worker&inline";

export type { DecodeRequest, DecodeResult } from "./rad-worker";

/** One decode worker (one request in flight per instance; callers schedule). */
export function createDecodeWorker(): Worker {
  return new DecodeWorker();
}
