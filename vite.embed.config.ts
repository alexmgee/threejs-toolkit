import { defineConfig } from "vite";
import { resolve } from "path";

/**
 * Embed bundle build — the PRODUCT entry (ticket 09).
 *
 * Lib-builds src/embed/register.ts into ONE self-contained <splat-site> file
 * (sparkjs-toolkit's vite.embed.config.ts shape). History: until ticket 09
 * the entry was a decode-only scaffold, src/backend/embed-entry.ts (deleted
 * with the switch as the orphan it became); before that it was the backend
 * barrel, until ticket 03 gave the barrel runtime exports (ThreeGsBackend →
 * three/webgpu + vendored mesh) and ballooned embed.js 213 kB → ~1.1 MB.
 * scripts/check-embed-size.mjs guards the size; its bound is the owner's
 * (ticket 09).
 *
 * Self-contained by definition (sibling repo's reasoning, carried forward):
 * this config exists separately BECAUSE the main config becomes a multi-page
 * build and Rollup refuses `inlineDynamicImports` with multiple inputs —
 * while without it, dynamic imports and the three graph would emit a
 * shared-chunk forest a CMS user would have to copy around. `external: []`
 * is explicit: an external "three" would leave a bare import no browser can
 * resolve.
 *
 * WASM worker settings graduated from the Phase 0 spike with ticket 02
 * (`worker.format: "es"`, `build.target: "esnext"`). D14 RULED 2026-08-23
 * (doc 06): variant A — the embed carries the decode worker INLINE
 * (src/backend/decode.ts `?worker&inline`, reached through the Stop 9 swap
 * below), wasm as base64 inside the one file. Single-file self-containment
 * is the embed's contract; do not
 * split assets out of it without re-opening D14.
 */
export default defineConfig({
  resolve: {
    // Array form: the measurement entry is conditional and regex-keyed.
    // Bundle-budget measurement (pin fd67153 load-telemetry Phase 7, carried by
    // ticket 09 ruling Stop 1): TELEMETRY_MEASURE=off swaps the runtime's single
    // diagnostics import boundary for the stub at CONFIG time, so Rollup
    // statically eliminates the whole diagnostics graph in build B of the
    // two-build differential. Normal builds are unaffected.
    alias: [
      { find: "@toolkit", replacement: resolve(__dirname, "src") },
      // Ticket 09 Stop 9 — the config-time swap pattern again: SiteRuntime
      // imports the URL-constructed decode-worker factory (what pages and
      // library consumers want), and the EMBED build replaces that module with
      // the inline worker, so the bundle stays one self-contained file (D14).
      {
        find: /^\.\.\/backend\/decode-url$/,
        replacement: resolve(__dirname, "src/backend/decode.ts"),
      },
      ...(process.env.TELEMETRY_MEASURE === "off"
        ? [{
            find: /^\.\/diagWiring$/,
            replacement: resolve(__dirname, "src/embed/diagWiring.stub.ts"),
          }]
        : []),
    ],
  },
  worker: {
    format: "es",
  },
  build: {
    target: "esnext",
    outDir: "dist-embed",
    lib: {
      entry: resolve(__dirname, "src/embed/register.ts"),
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
