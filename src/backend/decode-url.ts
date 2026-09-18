/**
 * Decode-worker factory, URL-constructed — the DEFAULT door SiteRuntime
 * imports (Phase 2 ticket 09, owner ruling Stop 9, 2026-09-17).
 *
 * Pages and library consumers get the worker as its own file, built from its
 * URL by their bundler. The embed build swaps this module for the inline
 * ./decode.ts at CONFIG time (vite.embed.config.ts — the config-time swap
 * pattern, ticket 09 Comments), so the single-file embed carries the worker
 * inline (D14). The swap depends on this module exporting the same names and
 * signatures as ./decode.ts.
 *
 * import.meta.url is standard JavaScript and allowed in src/ (the phase-1
 * constraint, amended 2026-09-17, keeps only import.meta.env / import.meta.hot
 * out). A URL is no module-graph edge, so the inline-worker boundary rules
 * are untouched.
 */

export type { DecodeRequest, DecodeResult } from "./rad-worker";

/** One decode worker (one request in flight per instance; callers schedule). */
export function createDecodeWorker(): Worker {
  return new Worker(new URL("./rad-worker.ts", import.meta.url), { type: "module" });
}
