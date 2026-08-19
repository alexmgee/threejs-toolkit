/**
 * SplatBackend seam — PLACEHOLDER.
 *
 * doc 02: this directory and src/vendor/ are the only places permitted to
 * import the fork. Everything else reaches forked code through here.
 */
import type { ForkedSplatMeshOptions } from "../vendor/three-gs";

export interface BackendMeshOptions extends ForkedSplatMeshOptions {
  /** Page budget resolved at runtime from real device limits (ADR 0003). */
  pages?: number;
}
