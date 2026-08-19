/**
 * Architectural boundary rules — hand-written against doc 02.
 *
 * These encode module-map invariants that the type system cannot express.
 * Each rule cites the plan clause it enforces; do not relax one without
 * amending that clause first.
 */
module.exports = {
  forbidden: [
    {
      name: "vendor-seam-only",
      comment:
        "doc 02 design rule 2 — 'The seam is the only door': no file outside " +
        "src/backend/ and src/vendor/ may import from src/vendor/three-gs/. " +
        "This is what keeps the fork surface auditable: every use of forked " +
        "upstream code passes through the backend seam, so a re-diff against " +
        "a new three.js release has one bounded blast radius. Route the call " +
        "through src/backend/ instead.",
      severity: "error",
      from: {
        path: "^src/",
        pathNot: "^src/(backend|vendor)/",
      },
      to: {
        path: "^src/vendor/three-gs/",
      },
    },
    {
      name: "no-spike-imports",
      comment:
        "doc 02 module map — 'spikes/native-rad/ … throwaway; never imported " +
        "by src/'. The Phase 0 spike is measurement scaffolding with its own " +
        "pinned dependencies and no API contract; importing it into the " +
        "toolkit would make throwaway code load-bearing. Promote the code " +
        "into src/ (doc 04 Phase 2) rather than reaching into spikes/.",
      severity: "error",
      from: {
        path: "^src/",
      },
      to: {
        path: "^spikes/",
      },
    },
    {
      name: "no-circular",
      comment:
        "Dependency cycles defeat the layering the module map describes and " +
        "make initialization order load-bearing. Extract the shared piece " +
        "into a module both sides can depend on.",
      severity: "error",
      from: {},
      to: {
        circular: true,
      },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    // Type-only imports still cross the boundary architecturally, so resolve
    // pre-compilation dependencies too — otherwise `import type { … } from
    // '../vendor/three-gs/…'` would slip past the seam rule.
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".js", ".ts", ".d.ts"],
    },
    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
  },
};
