# 07 — Diagnostics framework cluster

**What to build:** the diagnostics framework — sinks, records, policies,
fixtures, FrameDiffValidator — with its own self-test running green. The whole
`diag/` directory is one compile-closed cluster (verified: nothing in diag/
imports outside diag/). 21 files / ~7,895 lines. Read `../spec.md` first.

**Files:** all of `diag/` — INCLUDING `diag/SparkPagerAdapter.ts`, carried
unmodified per owner ruling R4 (two Phase-1 files import it; doc 03 section G
schedules its deletion for Phase 2 — deleting early costs edits the plan
already assigned to Phase 2).

**Blocked by:** 01

**Status:** done

- [x] Every COPY file byte-identical; `diag/dev/FrameDiffValidator.ts` (the one
      three-only file) carries only its doc 01 adaptation — it becomes a
      load-bearing tool of this project (doc 05)
- [x] `diag/dev/selfTest.ts` executes in a browser page and passes
- [x] SparkPagerAdapter carries a Comments note: "carried per R4; Phase 2
      deletes (doc 03 section G)" — no code changes to it
- [x] `npm run check` green

## Comments

**2026-08-23 (execution session):**

**SparkPagerAdapter: carried per R4; Phase 2 deletes (doc 03 section G) —
no code changes to it.** (The file imports only `./events` types; it is
byte-identical to the pin like every other copy below.)

**Copy vintage: sparkjs commit `fd67153`** (D21 as twice amended). All 22
paths under src/diag/ (21 TS files + lab-load-001.json) copied via
`git show fd67153:<path>`, each verified byte-identical against the pin
(zero mismatches). diag/ has NOT drifted in sparkjs's working tree — the
destination hashes below equal the working-tree hashes, unlike the
text/core clusters.

**SHA-256 at copy time (destination files, pin fd67153; FrameDiffValidator's
hash is PRE-adaptation):**
```
cde4ef49d3ab7fb58d6be60488d457596d2a71d1a615b916f124aeb4c50ecd94 src/diag/LaggardMapper.ts
83d6252e5dcd6211426e6df46bc83bdf33d0d0e9441f94bc6d3903d6a310d2da src/diag/LoadCoordinator.ts
349e122926f276c9ee7aac45f9ddc9081c87027f18ece91a8f8125c8bc3e7c9c src/diag/LoadProbe.ts
839d81863c6a42235ba1e4489f00f8a3e86b6decc5bfcdaca8897414ffa1a45c src/diag/LoadRecord.ts
3b4e076460f59f28bc62dce1ecc8981133a8ca7ff992364de920a951a2f6873f src/diag/NetworkObserver.ts
55383b181bde0a563fdad0256fbd4537a0a75a9bd2a50d947b83fba7b993bfbd src/diag/SparkPagerAdapter.ts
efd39c7224e2243a3e409e351245e7f92b0060f5fe8f2a4a9d7f71b2b37f32fa src/diag/cameraEpochs.ts
61519143eda72d93c00cda60a1b3be42a6350231ce22e64cdf960e7bd473c83f src/diag/convergence.ts
54a17ccf50dce46711d4346c545a457ff2a876797901eddc4b7d1732f9738526 src/diag/dev/FrameDiffValidator.ts
b2f2d125acd37a6a94fd93999c34bbd1bc3bed1be572cbd20b9510dc040d8e06 src/diag/dev/reportUI.ts
bfb54bded2aa2ba7b241d68210b1c6ea4a94608068a0dc9f9f73af1b9d127c13 src/diag/dev/selfTest.ts
7ea0dae4f59ea7f5b06f047feb50f3fa6d7e09fbd465a6bb7eed8f85fd44c28a src/diag/events.ts
d5584ed3ab4742de43d3fed007470df5f422fc95128820b9d38d2ba0b50de8c7 src/diag/faultInjector.ts
350b4d05b61f778ad41e87386722d02645bbe2b6a09bb90200b933a128a7a0b3 src/diag/fixtures/fixtureTypes.ts
675c7bce6fd2510c002fb5ba0a4bd26b42c33682e8d76e831ec24d84b9b7efe3 src/diag/fixtures/lab-load-001.json
7410233d1c70f821c186ec849750104f62a4f72d5138e1551a7104aee7fc60b6 src/diag/policies.ts
a991f311455977b19f46258cdeeabdf02d903eb75e1d6929cab556545ee2b930 src/diag/privacy.ts
7f4901511e994a677b14947e927ce05b527afd7d253dfd12c293d845e08261b4 src/diag/sinkBeacon.ts
210a8a7c364cdc38b10aa9428431b2217d45be3062e66b45e2c940e6193a7859 src/diag/sinkConsole.ts
3152ceede07d0a367e51e0671c489221cde5ecaae9b448e7a91cb0f6184d44a0 src/diag/sinkStore.ts
bce2d0ad14c9f34bff116005cbf8c81d42d08bef5331e0520af2651c5d92c6d5 src/diag/sinks.ts
837e549fe4eba8b81acbd439fe1da9ea880f9ee301a0c6e816dc152e787c58e2 src/diag/visibility.ts
```

**Adaptations — FrameDiffValidator ONLY (the doc 01 three-only file):**
renderer typing widened `WebGLRenderer` → `WebGLRenderer | WebGPURenderer`
(type-only import from three/webgpu; D22 precedent). The class touches only
`render()` and `domElement`, present on both renderers. Every other file is
byte-identical.

**Runner page (new, examples/diag/):** the sparkjs runner
(examples/loadtest) also wires Spark meshes + embed/diagWiring — Phase 2
scope — so this page runs the renderer-free core: `runSelfTest` with the
copied lab-load-001 fixture, results rendered by the copied
renderSelfTestResults and machine lines printed to console.
`phase7-runtime-consent` stays at its built-in "deferred" status (its
evaluator is diagWiring's, Phase 2); deferred assertions are excluded from
the evaluated count by selfTest itself. vite.config.ts gains the diag page.

**Runtime evidence (browser execution, dev hook readback):**
`{"passed":true,"summaryLine":"SELF-TEST: 20/20 PASS"}` — all 20 evaluated
assertions pass (fixture-schema, adapter fingerprint/faults/optional/
reordered, request-ledger, terminal-precedence, camera-hysteresis,
bfcache-lifecycle, budget-ladder, weighted-gap, laggard-mapper,
network-ambiguity, utf8-boundary, sink-fanout, store-bounds, beacon-cases,
privacy, consent-zero-construction, coordinator);
phase7-runtime-consent:deferred. `npm run check` green (exit 0,
redirect-then-`$?`).

**2026-08-23 — adversarial review, Opus round (each finding re-verified
before acting):**
- DECLARED, NOT CHANGED (#1): with the widened type, FrameDiffValidator's
  `renderer.render()` THROWS on a WebGPURenderer whose backend is not yet
  initialized (Renderer.js precondition; WebGLRenderer has none). CALLER
  CONTRACT: construct it with an initialized renderer — in this toolkit
  that means after `ThreeSplatScene.ready` settles. Handling init inside
  the class would exceed the one counted doc 01 adaptation.
- DECLARED, NOT CHANGED (#2): capture fidelity caveat on WebGPU — a bare
  `new WebGPURenderer()` defaults alpha:true/premultiplied (opposite of
  WebGLRenderer), which zeroes uncovered-pixel luminance and un-premultiplies
  semi-transparent pixels in the drawImage/getImageData path, feeding
  noiseFloor/ssimStyleDifference. The facade constructs its renderer with
  alpha tied to background (ThreeSplatScene contract), which is how this
  tool will be fed in practice; recorded here for doc 05 harness authors.
- CONFIRMED & FIXED (#3): the report was invisible (sandbox-styles: #111
  bg, no color, overflow hidden; none of .panel/.assertion/.pass/.fail/.skip
  styled) — a FAIL was indistinguishable from a PASS by eye. Page CSS added
  (scroll restored, pass green / fail red / skip grey); re-verified: green
  "pass" heading rgb(74,222,128), 21 styled rows.
- CONFIRMED & FIXED (#4): a throw inside the runner left #out blank —
  done.catch now renders "SELF-TEST RUNNER FAILED: …" in fail styling.
- CONFIRMED & FIXED (#5): the vacuous-pass vector — an undefined fixture
  turns "20/20" into a green "19/19" (assertFixture returns skipped;
  selfTest excludes skips from the denominator). Runner now throws if the
  fixture import is undefined OR the fixture-schema assertion reports
  skipped.
- CONFIRMED & FIXED (#6): hook doc comment promised {results, done};
  code exposes {done} — comment corrected.
- CONFIRMED & FIXED (#7): dropped the inert eslint-disable directive (no
  ESLint config exists in this repo; the gate is typecheck+boundaries+build).
- Ticket factual claims: none — Opus re-verified all 22 SHAs against the
  pin's blobs, byte-identity, the no-drift claim (pin == working tree for
  all of diag/), the 21+json count, and the 21-assertion inventory with
  phase7 deferred by default.
- Post-fix: gate green (exit 0); page re-run `{"passed":true,"summary":
  "SELF-TEST: 20/20 PASS","evaluated":20}` with styled report.

**2026-08-23 — gpt5.6-sol (high) round:** one finding — the uninitialized-
WebGPURenderer render() throw — duplicate of Opus #1, already declared as
the caller contract above. Runner page: none. Factual claims: none.

**2026-08-23 — grok-4.6 round:** none in all three categories (ran against
the post-fix tree; independently re-verified the SHA table, byte-identity,
sparkjs no-drift, the JSON-import equivalence to the loadtest runner's
fetch path, and that deferred statuses cannot inflate the 20/20 score).
