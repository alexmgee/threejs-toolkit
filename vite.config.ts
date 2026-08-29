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
 * WASM worker bundling landed with Phase 2 ticket 02: the proven settings
 * from the Phase 0 spike (spikes/native-rad/vite.config.ts) graduate here —
 * `worker.format: "es"` + `build.target: "esnext"` — for the promoted
 * decode worker (src/backend/rad-worker.ts + rad-three/pkg).
 */
export default defineConfig({
  server: {
    // Honor a harness-assigned port (launch.json autoPort) when present.
    // strictPort: fail loudly rather than silently binding port+1 — the
    // harness points the preview at the assigned port, and a silent
    // increment reproduces the wrong-app confusion autoPort exists to end.
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
    fs: {
      // Serve the golden .rad asset from read-only sparkjs-toolkit through
      // /@fs (spike pattern) — vite's static server honors Range requests.
      allow: [".", "D:/Projects/sparkjs-toolkit/examples/assets"],
    },
  },
  worker: {
    format: "es",
  },
  resolve: {
    alias: [{ find: "@toolkit", replacement: resolve(__dirname, "src") }],
  },
  build: {
    target: "esnext",
    rollupOptions: {
      input: {
        rail: resolve(__dirname, "examples/rail/index.html"),
        scene: resolve(__dirname, "examples/scene/index.html"),
        grade: resolve(__dirname, "examples/grade/index.html"),
        "text-lab": resolve(__dirname, "examples/text-lab/index.html"),
        periphery: resolve(__dirname, "examples/periphery/index.html"),
        diag: resolve(__dirname, "examples/diag/index.html"),
        media: resolve(__dirname, "examples/media/index.html"),
        author: resolve(__dirname, "examples/author/index.html"),
        "rules-lab": resolve(__dirname, "examples/rules-lab/index.html"),
        "decode-lab": resolve(__dirname, "examples/decode-lab/index.html"),
        "splat-lab": resolve(__dirname, "examples/splat-lab/index.html"),
      },
    },
  },
});
