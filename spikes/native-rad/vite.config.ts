import { defineConfig } from "vite";

// The 204 MB hero asset stays in sparkjs-toolkit (read-only sibling); we serve it
// through Vite's /@fs/ escape hatch rather than copying it. Vite's static server
// (sirv) honours HTTP Range requests, which the pager depends on — measure.ts
// asserts range-only fetching (H-LOAD criterion 2), so a regression here fails
// loudly rather than silently downloading the whole file.
const SPARK_ASSETS = "D:/Projects/sparkjs-toolkit/examples/assets";

export default defineConfig({
  server: {
    fs: {
      allow: [".", SPARK_ASSETS],
    },
  },
  worker: {
    format: "es",
  },
  build: {
    target: "esnext",
  },
  // three/webgpu + three/tsl resolve from the published 0.185.1 package.
  // The vendored addon (vendor/) is dev-branch r186 code — whether it compiles
  // against 0.185.1 core is exactly what `npm run smoke` establishes.
});
