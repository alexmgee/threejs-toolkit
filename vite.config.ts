import { defineConfig } from "vite";
import { resolve } from "path";

/**
 * Main site build — SCAFFOLD ENTRY (ticket 01).
 *
 * The real entry is a multi-page examples/*.html build (sparkjs-toolkit's
 * shape). The current entry src/core/index.ts is DELETED BY TICKET 04 (its
 * placeholder-removal criterion) — ticket 04 must repoint this config when
 * it does so (owner ruling 2026-08-19; an AC on ticket 04 records it).
 * `npm run check` runs this build, so the breakage is loud, not silent.
 *
 * WASM worker bundling is explicitly DEFERRED to Phase 2 (owner ruling,
 * ticket 01). When the Rust/WASM decode worker lands, take the proven
 * worker settings from the Phase 0 spike: spikes/native-rad/vite.config.ts
 * (`worker.format: "es"`, `build.target: "esnext"`).
 */
export default defineConfig({
  resolve: {
    alias: [{ find: "@toolkit", replacement: resolve(__dirname, "src") }],
  },
  build: {
    lib: {
      entry: resolve(__dirname, "src/core/index.ts"),
      formats: ["es"],
      fileName: () => "core.js",
    },
  },
});
