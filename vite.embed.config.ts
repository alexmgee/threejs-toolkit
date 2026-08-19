import { defineConfig } from "vite";
import { resolve } from "path";

/**
 * Embed bundle build — SCAFFOLD ENTRY (ticket 01).
 *
 * The real entry is src/embed/register.ts producing a single self-contained
 * <splat-site> file (sparkjs-toolkit's vite.embed.config.ts shape) — the
 * embed set is DEFERRED to Phase 2 by owner ruling R2
 * (.scratch/phase-1-foundation/spec.md). Until then this lib-builds
 * src/backend/index.ts — an existing, compiling module — so the second
 * build path is proven without a placeholder entry.
 *
 * Self-contained by definition (sibling repo's reasoning, carried forward):
 * this config exists separately BECAUSE the main config becomes a multi-page
 * build and Rollup refuses `inlineDynamicImports` with multiple inputs —
 * while without it, dynamic imports and the three graph would emit a
 * shared-chunk forest a CMS user would have to copy around. `external: []`
 * is explicit: an external "three" would leave a bare import no browser can
 * resolve.
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
    outDir: "dist-embed",
    lib: {
      entry: resolve(__dirname, "src/backend/index.ts"),
      formats: ["es"],
      fileName: () => "embed.js",
    },
    rollupOptions: {
      external: [],
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
