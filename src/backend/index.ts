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

export interface BackendMeshOptions {
  /** Fixed splat capacity; the pager uploads pages into it (guard contract: doc 03 §F). */
  capacity?: number;
  /** Page budget resolved at runtime from real device limits (ADR 0003). */
  pages?: number;
}
