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
        // examples/ included since ticket 04 (owner ruling): fixtures may
        // import src entry surfaces but never vendor/three-gs internals.
        path: "^(src|examples)/",
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
        // examples/ included since ticket 04 (owner ruling): fixtures must
        // not reach into throwaway spike code either.
        path: "^(src|examples)/",
      },
      to: {
        path: "^spikes/",
      },
    },
    {
      name: "rad-worker-value-import-only-from-decode",
      comment:
        "Ticket 02 (D14 variant A) — companion to " +
        "lib-barrel-must-not-reach-inline-worker below, which an external " +
        "audit showed guards a FILENAME, not a mechanism: dependency-cruiser " +
        "STRIPS the `?worker&inline` query when resolving decode.ts's import, " +
        "and 16.10.4 matches resolved paths only (no raw-specifier matcher), " +
        "so the inline mechanism cannot be named directly. Pin it to ONE " +
        "address instead: src/backend/decode.ts is the only module allowed a " +
        "VALUE (non-type-only) dependency on src/backend/rad-worker.ts — " +
        "~200 KB of untree-shakeable base64 wasm hangs off that edge. " +
        "Type-only imports of the request/result types stay free (they erase; " +
        "examples/decode-lab/main.ts relies on it and builds its worker from " +
        "a URL, which is no dependency edge at all). HONEST SCOPE: this also " +
        "forbids a future non-inline `?worker` import of the same file — " +
        "deliberately, since a second door should be a config decision, not a " +
        "drive-by import; it does NOT catch an inline import of a DUPLICATED " +
        "worker source file.",
      severity: "error",
      from: {
        path: "^(src|examples)/",
        pathNot: "^src/backend/decode\\.ts$",
      },
      to: {
        path: "^src/backend/rad-worker\\.ts$",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "lib-barrel-must-not-reach-inline-worker",
      comment:
        "Ticket 02 (D14 variant A): src/backend/decode.ts imports the decode " +
        "worker `?worker&inline` — ~200 KB of untree-shakeable base64 wasm. " +
        "That is the EMBED bundle's door only. The library barrel " +
        "(src/index.ts) must never reach it, directly or transitively: a " +
        "blanket `export * from './backend'` would silently land the inline " +
        "worker in every dist-lib consumer, who want the URL-constructed " +
        "worker instead. Machine-checks the guard comment in " +
        "src/backend/index.ts.",
      severity: "error",
      from: {
        path: "^src/index\\.ts$",
      },
      to: {
        path: "^src/backend/decode\\.ts$",
        reachable: true,
      },
    },
    {
      name: "vendor-must-not-reach-src",
      comment:
        "Ticket 03 (owner D23 ruling, 2026-08-23, spec.md): the vendored " +
        "fork is a LEAF — src/vendor/three-gs/ may depend on npm packages " +
        "(three) but never on toolkit code. A vendor->src edge would make " +
        "fork internals load-bearing on toolkit modules, so a re-diff " +
        "against a new upstream release could silently change toolkit " +
        "behavior through the back door, defeating the bounded blast " +
        "radius vendor-seam-only exists to guarantee. If forked code needs " +
        "toolkit logic, the logic moves into src/backend/ and is passed " +
        "in — the dependency arrow always points vendor-ward.",
      severity: "error",
      from: {
        path: "^src/vendor/",
      },
      to: {
        path: "^src/",
        pathNot: "^src/vendor/",
      },
    },
    {
      name: "no-circular",
      comment:
        "Dependency cycles defeat the layering the module map describes and " +
        "make initialization order load-bearing. Extract the shared piece " +
        "into a module both sides can depend on. ONE scoped exception " +
        "(owner ruling, ticket 04): the upstream Channels <-> RuleModel pair " +
        "is exempt via pathNot below. WHY it is harmless: RuleModel's side " +
        "is `import type` (upstream's own comment, RuleModel.ts:25-27), so " +
        "the cycle exists only in the type graph — counted at all because " +
        "tsPreCompilationDeps:true (ticket 01, load-bearing for the seam " +
        "rule) deliberately counts type edges. Upstream's design, carried " +
        "byte-identical per spec rule 5. Scope note (honest): pathNot also " +
        "exempts degenerate SELF-imports of these two files — a known, " +
        "accepted residue (review finding, ticket 04). A future third file " +
        "joining the cycle is itself a `from` participant and still fails. " +
        "The companion rule below enforces the type-only premise.",
      severity: "error",
      from: {
        pathNot: "^src/rules/(Channels|RuleModel)\\.ts$",
      },
      to: {
        circular: true,
      },
    },
    {
      name: "rules-pair-cycle-must-stay-type-only",
      comment:
        "Companion tripwire to the no-circular exemption above — see its " +
        "note for the full WHY. Fires exactly when RuleModel -> Channels " +
        "stops being type-only, i.e. when the exemption's premise dies.",
      severity: "error",
      from: {
        path: "^src/rules/RuleModel\\.ts$",
      },
      to: {
        path: "^src/rules/Channels\\.ts$",
        circular: true,
        dependencyTypesNot: ["type-only"],
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
