/**
 * SplatBackend seam — PLACEHOLDER (stays until Phase 2, D18).
 *
 * doc 02: this directory and src/vendor/ are the only places permitted to
 * import the fork. Everything else reaches forked code through here.
 *
 * Options shape is backend-owned, never derived from vendor (owner ruling 2,
 * ticket 02 Comments, 2026-08-20 — the rationale lives there).
 */
export type { GaussianSplatMesh } from "../vendor/three-gs/GaussianSplatMesh.js";

// Real Phase 2 module (ticket 02): the embed entry carries the inline decode
// worker through this export (D14 variant A). The placeholder types below
// still die with ticket 03's seam; this export stays.
// TICKET-03 GUARD: never blanket re-export this barrel from src/index.ts —
// ./decode's `?worker&inline` import is ~200 kB of untree-shakeable base64,
// and the LIBRARY consumer wants the URL-constructed worker, not the inline
// one. The lib barrel must pick names, excluding ./decode.
export { createDecodeWorker, type DecodeRequest, type DecodeResult } from "./decode";

export interface BackendMeshOptions {
  /** Fixed splat capacity; the pager uploads pages into it (guard contract: doc 03 §F). */
  capacity?: number;
  /** Page budget resolved at runtime from real device limits (ADR 0003). */
  pages?: number;
}
