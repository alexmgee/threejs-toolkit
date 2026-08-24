import { defineConfig } from "vite";
import { resolve } from "path";

/**
 * LIBRARY build — the barrel packaged as a consumable ES module (Phase 2
 * ticket 02: the first honest packaging run; the gate's page build never
 * bundles the barrel).
 *
 * three is EXTERNAL: a library ships against the consumer's three (the
 * consuming sites already depend on 0.185.1); bundling a private copy would
 * double the scene graph and break instanceof across the boundary. The
 * vendored fork (src/vendor/three-gs) is INTERNAL — it is this library's
 * private capability, not a consumer dependency.
 *
 * package.json deliberately does NOT set "sideEffects": false — the barrel's
 * first import is src/core/colorSpace.ts, a side-effect module (sRGB working
 * space opt-in). If sideEffects pruning is ever added, colorSpace.ts must be
 * exempted and the [17,17,51] fingerprint re-checked (ticket 11 caveat).
 */
export default defineConfig({
  resolve: {
    alias: [{ find: "@toolkit", replacement: resolve(__dirname, "src") }],
  },
  build: {
    target: "esnext",
    outDir: "dist-lib",
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      fileName: () => "threejs-toolkit.js",
    },
    rollupOptions: {
      external: [/^three(\/|$)/],
    },
  },
});
