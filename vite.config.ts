import { defineConfig } from "vite";
import { resolve } from "path";

/**
 * Main site build — a PAGE build of the examples (sibling repo's shape),
 * repointed off the deleted src/core/index.ts scaffold entry by ticket 04.
 * The gate (`npm run check`) runs this build, so the fixtures compile on
 * every check run and breakage is loud.
 *
 * Ticket 11 adds src/index.ts (the barrel) but the site build stays a page
 * build — the barrel is the lib surface, not the site entry. Later tickets
 * add pages to the same input map.
 *
 * WASM worker bundling is explicitly DEFERRED to Phase 2 (owner ruling,
 * ticket 01). When the Rust/WASM decode worker lands, take the proven
 * worker settings from the Phase 0 spike: spikes/native-rad/vite.config.ts
 * (`worker.format: "es"`, `build.target: "esnext"`).
 */
export default defineConfig({
  server: {
    // Honor a harness-assigned port (launch.json autoPort) when present.
    // strictPort: fail loudly rather than silently binding port+1 — the
    // harness points the preview at the assigned port, and a silent
    // increment reproduces the wrong-app confusion autoPort exists to end.
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
  },
  resolve: {
    alias: [{ find: "@toolkit", replacement: resolve(__dirname, "src") }],
  },
  build: {
    rollupOptions: {
      input: {
        rail: resolve(__dirname, "examples/rail/index.html"),
        scene: resolve(__dirname, "examples/scene/index.html"),
        grade: resolve(__dirname, "examples/grade/index.html"),
        "text-lab": resolve(__dirname, "examples/text-lab/index.html"),
      },
    },
  },
});
