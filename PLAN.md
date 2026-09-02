# threejs-toolkit

Gaussian-splat website toolkit on three.js native rendering (`GaussianSplatMesh` +
`WebGPURenderer`). Sibling of `sparkjs-toolkit` — same site model, different renderer.
**Phase 1 closed 2026-08-23.** **Phase 2 underway** (tickets 01–02 done; 03 is next).
Phase map and exit criteria live in `docs/plan/04-build-order.md`; ticket detail in
`.scratch/phase-2-backend/`.

## Keep the splat fork auditable {#vendor-fork}
tech: `src/vendor/three-gs/` — vendored GaussianSplatMesh addon; only `src/backend/` may import it
files: [src/vendor/three-gs/**]
needs: []
links: [backend-pager, scene-core]

- [x] Vendor fork at delta zero with FORK.md scaffold {#fork-delta-zero}
  by: phase-1 ticket 02
  tech: commit `e4aca4e`; `src/vendor/three-gs/{GaussianSplatMesh,CountingSort,GaussianSplatUtils}.js` byte-identical to spike vendor snapshot (`diff` empty); `FORK.md` governs divergence; seam rule holds with real fork
- [x] Add dispose() and capacity guard {#fork-dispose-capacity}
  by: claude
  from: roadmap
  tech: Phase 2 ticket 04; D20 proven as pure .ts sibling patches (vendored JS byte-identical, digests unchanged); patches/{dispose,capacity-guard}.ts; H-LIFE 10-cycle union-counter gate exactly flat both backends (28/28 splat-lab); over-capacity named refusal (16384 vs injected 256); embed-size tripwire in `check`, drilled both ways
- [ ] Add per-splat edit-mask lanes in fork {#fork-edit-masks}
  from: roadmap
  tech: Phase 3 §C route 2; `colorRead` compute path
- [ ] Add DoF optics uniforms in fork {#fork-optics}
  from: roadmap
  tech: Phase 5; Spark-congruent math, 512-radius cap

## Load and stream splats {#backend-pager}
tech: SplatBackend seam, RadPager, Rust/WASM decode worker
files: [src/backend/**, rad-three/**]
needs: [vendor-fork]
links: [scene-core, diagnostics, embed-site, fixtures]

- [x] Promote rad-three crate out of spike {#wasm-promote}
  by: claude
  tech: commit `1fb65d4`; `rad-three/` at repo root (copy-forward; spike untouched); `npm run build:wasm` → `cargo test --release` 2/2; golden `decodes_hero_chunk0` with packed-SH parity
- [x] Wire inline decode worker for embed (D14 variant A) {#decode-inline}
  by: claude
  tech: commit `1fb65d4`; `src/backend/decode.ts` — `createDecodeWorker` via `?worker&inline`; D14 variant A ruled; `dist-embed/embed.js` single file 213 kB / 93.75 kB gzip
- [x] Harden the WASM decoder against hostile chunks {#decoder-hardening}
  by: claude
  tech: commits `a1c076c` + `15f4211`; length+overflow guards on all 9 decoders (`checked_mul`), container-extent panic fixed, oversized count refused (owner ruling); golden test skip made visible, `check:full` gate; 6 crate tests
- [x] Load small SPZ/PLY through the real seam {#seam-monolithic}
  by: claude
  from: roadmap
  tech: ticket 03 — SplatBackend seam (full doc 02 interface, named refusals) + ThreeGsBackend PLY path; `examples/splat-lab/` 21/21 on WebGPU + webgl2-fallback, dev AND built; D18 placeholder deleted (doc 06 D18 CLOSED); PLY-only (SPZ named gap → watch item 13); embed kept at 213 kB via decode-only embed-entry
- [x] Fetch byte ranges and run four decode workers {#fetch-decode-pool}
  by: claude
  tech: ticket 05 — `src/backend/{RadHeader,RadFetcher,DecodePool,RadPager}.ts`; prefetch-all Range + 206-or-die, 3 immediate attempts then per-chunk unavailable, 4 queued workers (worker-side concurrency evidence), resolve-with-shortfall; `examples/rad-lab/` 19/19 on the real hero; crate chunk-header wrap panic (wasm32) found by review and fixed; `load("rad")` refusal stays until 06
- [ ] Manage page budget, LRU, and GPU uploads {#page-residency}
  from: roadmap
  tech: ticket 06; progress = completed work, never residency
- [ ] Traverse LOD tree and cull by selection {#lod-culling}
  from: roadmap
  tech: ticket 07; `center.w` flags + `setBinNode`; explicit sort/SH invalidation
- [ ] Answer raycast for resident splats {#picking}
  from: roadmap
  tech: Phase 3 §B; CPU vs GPU route chosen by measurement at phase entry

## Render the splat scene {#scene-core}
tech: ThreeSplatScene, cameras, rails, controls, COLMAP, environment
files: [src/core/**]
needs: [vendor-fork]
links: [render-stack, site-rules, fixtures, backend-pager]

- [x] ThreeSplatScene on WebGPU and WebGL {#three-splat-scene}
  by: phase-1 ticket 03
  tech: commit `04378f6`; `src/core/ThreeSplatScene.ts` + `core/colorSpace.ts` sRGB; `examples/scene/` readback-proven on default and `?webgl=1`
- [x] Foundation cluster — cameras, rails, controls, COLMAP {#foundation-cluster}
  by: phase-1 ticket 04
  tech: commit `f9f7b59`; 32 copy files at fd67153 pin; `core/CameraSystem.ts` adapted (spark-strip dead); `examples/rail/` fixture runs
- [x] EnvironmentLoader on three/webgpu PMREM {#environment-loader}
  by: phase-1 ticket 08
  tech: commit `782482e`; `core/EnvironmentLoader.ts` on `three/webgpu` PMREM; `examples/periphery/` env map both backends; `examples/rail/main.ts` repointed to ThreeSplatScene
- [ ] Finish CameraSystem dead-field cleanup (D22) {#d22-camerasystem}
  from: roadmap
  tech: ticket 10; construction literals + 2 dead fields
- [ ] Rebuild CropTool and SceneComposer on backend edits {#crop-composer}
  from: roadmap
  tech: Phase 3; CropTool preview, SceneComposer crop hydration
- [ ] Rewire DebugPanel optics folder {#debug-panel}
  from: roadmap
  tech: Phase 5; `setOptics` per rail stop

## Grade scenes and stack layers {#render-stack}
tech: SceneGrade TSL, MediaLayer, PropLayer, AudioPlayer
files: [src/render/**]
needs: [scene-core]
links: [fixtures]

- [x] SceneGrade on node PostProcessing + TSL (H-GRADE gate) {#scene-grade}
  by: phase-1 ticket 10
  tech: commit `a112253`; `render/SceneGrade.ts` on RenderPipeline+TSL; H-GRADE owner-approved 2026-08-22; evidence `docs/plan/results/ticket10-hgrade/` — grade-off SHA-identical; grade-on within 1 LSB except SMAA silhouettes
- [x] MediaLayer colour baseline re-measured, both backends {#media-layer}
  by: phase-1 ticket 09
  tech: commit `2a7d55e`; `render/MediaLayer.ts` capabilities-chain fix; absolute colour baseline both backends in `docs/plan/results/ticket09-color-baseline/`
- [x] PropLayer copied and attached to scene {#prop-layer}
  by: phase-1 ticket 08
  tech: commit `782482e`; `render/PropLayer.ts` byte-identical at pin; prop mesh renders in `examples/periphery/` both backends

## Place text and markers {#text-markers}
tech: TextSystem lanes, Pretext UI, marker overlays
files: [src/text/**, src/ui/**]
needs: []
links: [site-rules, fixtures]

- [x] Text system and marker UI copied at pin {#text-cluster}
  by: phase-1 ticket 05
  tech: commit `d744b02`; 17 copies at fd67153 byte-verified; D19 `ui/SplatTextMesh` API-preserving stub; `examples/text-lab/` non-splat path both backends
- [ ] Rebuild SplatTextMesh (D19 stub → real) {#splat-text-rebuild}
  from: roadmap
  tech: Phase 4; eight regions; `textSplatGeometry.ts`
- [ ] Wire recolor and opacity via setMeshColor {#mesh-color}
  from: roadmap
  tech: Phase 4; locative fades, text fades

## Author sites and drive rules {#site-rules}
tech: site.json model, author panel, rules engine, cells, locative
files: [src/site/**, src/rules/**, src/cells/**, src/locative/**]
needs: []
links: [text-markers, diagnostics, embed-site]

- [x] Author UI cluster — panel, gizmo, rules pane {#author-ui}
  by: phase-1 ticket 06
  tech: commit `8b621db`; 25 paths at fd67153 + ruled closure files (`RuleAuthoring`, `RuleModel`, `SiteConfig`); `examples/author/` panel + Rules pane runtime-proven
- [x] DisplayChannel re-synced to fd67153 {#displaychannel-resync}
  by: claude
  tech: commit `d9022b6`; `src/rules/DisplayChannel.ts` byte-identical to `git show fd67153:…` (sha256 `89c4a9c4…`); four barrel names restored; `examples/rules-lab/` before 2/7 trap → after 9/9; selfTest 20/20
- [ ] Re-type SiteRuntime for three backend {#siteruntime-retype}
  from: roadmap
  tech: ticket 09; registration :2221, teardown :4133; D24 rename; latent throw proofs
- [ ] Copy embed sources at pin (SplatSiteElement, register, …) {#embed-copy}
  from: roadmap
  tech: ticket 08; byte-identical to fd67153 via `git show`

## Watch loads and report problems {#diagnostics}
tech: LoadCoordinator, probes, sinks, SparkPagerAdapter (temporary)
files: [src/diag/**]
needs: [backend-pager]
links: [site-rules, embed-site, fixtures]

- [x] Diagnostic framework copied; selfTest 20/20 {#diag-framework}
  by: phase-1 ticket 07
  tech: commit `b9c9251`; 22 diag paths at fd67153 byte-verified; SparkPagerAdapter carried per R4; `examples/diag/` selfTest `20/20 PASS` in-browser
- [ ] Feed StatsHUD from backend counters {#statshud}
  from: roadmap
  tech: ticket 11; no seam bypass
- [ ] Feed SplatBounds from resident-page union {#splat-bounds}
  from: roadmap
  tech: ticket 11; independent union, not 8-corner applyMatrix4
- [ ] Rewire diagnostics off Spark pager (§G) {#diag-rewire}
  from: roadmap
  tech: ticket 12; delete SparkPagerAdapter (~1,362 lines) for good

## Ship splat sites in web pages {#embed-site}
tech: `<splat-site>` web component, SiteRuntime, FragmentRouter, embed builds
files: [src/embed/**, vite.embed.config.ts, dist-embed/**]
needs: [backend-pager, scene-core, site-rules, diagnostics]
links: [fixtures]

- [ ] Wire load/reveal/ready contract into SplatSiteElement {#a5-contract}
  from: roadmap
  tech: ticket 08; §A5; reveal on progress + first-paint, never residency
- [ ] Copy diagWiring.stub at pin {#diagwiring-copy}
  from: roadmap
  tech: ticket 09; SHA in Comments
- [ ] Drive real site.json end-to-end on both backends {#site-e2e}
  from: roadmap
  tech: ticket 13; load, navigation, teardown
- [ ] Switch alexgee.online dependency {#first-consumer}
  from: roadmap
  tech: Phase 6; D15 — first consuming site

## Exercise subsystems in sandboxes {#fixtures}
tech: Vite example pages — parity harness per subsystem
files: [examples/**, spikes/native-rad/**]
needs: []
links: [scene-core, render-stack, text-markers, site-rules, diagnostics, backend-pager]

- [x] Phase 1 fixtures runtime-proven (scene, grade, rail, media, …) {#phase1-fixtures}
  by: phase-1 tickets 03–10
  tech: nine fixtures in `vite.config.ts` input map (`rail`, `scene`, `grade`, `text-lab`, `periphery`, `diag`, `media`, `author`); each runtime-proven in its landing ticket Comments
- [x] rules-lab proves authored lifetime behaviour {#rules-lab}
  by: claude
  tech: commit `d9022b6`; `examples/rules-lab/` — before re-sync `2 passed, 7 failed` (trap demonstrated); after pin `9 passed, 0 failed`; includes `lifetime-ends-on-travel` + four barrel-name identity checks
- [x] decode-lab proves WASM chunk decode {#decode-lab}
  by: claude
  tech: commit `1fb65d4`; `examples/decode-lab/` — 9 output arrays pinned; `4 passed, 0 failed`; center=`9f411115`, sh1Words=`50b88b76`; renders nothing, so backend-independent (the earlier "on default and `?webgl=1`" read as backend coverage it never had)
- [ ] Record Phase 2 H-LOAD re-run on production runtime {#h-load-rerun}
  from: roadmap
  tech: ticket 13; five cold-cache trials per backend; match or beat spike
- [ ] Record H-LIFE load→dispose→load ×10 heap flat {#h-life}
  from: roadmap
  tech: ticket 13; full element with real site.json
- [ ] Trimmed public barrel restored as phases land {#trimmed-barrel}
  from: roadmap
  tech: ticket 11 phase-1 done (51 sources); 13 deferred names return per phase

## decisions

- **Ticket 05 rulings (owner, 2026-09-02):** decode pool size 4, spec-inherited (doc 03
  A3), constructor-parameterized, utilization recorded for a future data-backed change.
  Retry: 3 attempts total (anchor: `@smithy/core` 3.33.3 `DEFAULT_MAX_ATTEMPTS = 3`,
  verified from the npm artifact), IMMEDIATE — no backoff timer, because Chrome's
  hidden-tab timer throttling would wedge loads. Failure taxonomy: 200-where-206
  = whole-load `range-unsupported`; 5xx/network/short-body retry; 4xx and decode
  errors terminal per page; the load resolves with an unavailable-chunks report,
  never rejects. `load("rad")` stays a named refusal until ticket 06 (handoff 006
  corrected in the ticket). Injected `fetch` is the test-only failure seam.
  Determinism = pool-4 vs pool-1 on the promoted worker + chunk-0 golden checksums.
  SH-degree dispose gap re-assigned 04 → 06.
- **Ticket 04 rulings (owner, 2026-08-29):** D20's shape = PURE .ts sibling patches
  (`src/vendor/three-gs/patches/`) — vendored JS byte-identical, digests unchanged,
  H-FORK identity by construction; FORK.md entries must name every internal
  field/path a patch reaches and the re-diff gains a re-verify step for them.
  dispose() frees GPU buffers via the renderer's internal `_attributes.delete`
  (the path upstream's own geometry disposal uses) WITH a runtime existence
  assertion — absent/reshaped internals throw a named error, never silent.
  Capacity guard: pre-check `device.limits.maxStorageBufferBindingSize` on WebGPU;
  WebGL2 has no such limit — the SAME named error surfaces at allocation-failure
  time (catch-and-name, no invented threshold); injectable limit override is a
  documented TEST-ONLY seam. H-LIFE pass = renderer.info.memory EXACTLY at baseline
  after each of 10 cycles; JS heap recorded with one structural assertion (series
  not strictly increasing); each cycle proves the load happened (counts + pixel)
  before flatness counts.
- **Ticket 03 rulings (owner, 2026-08-29):** monolithic path is PLY-only this ticket —
  SPZ is a NAMED GAP tied to watch item 13 (r186 ships SPZLoader; import then, never
  vendor now); the `spz` branch of `load()` throws a named refusal citing that item.
  Fixture asset is GENERATED — deterministic committed script + committed small `.ply`
  with known-exact opacity logits so the sigmoid check is falsifiable in closed form.
  The seam declares the FULL doc 02 interface now; unimplemented methods throw named
  refusals citing their owning ticket (dispose→04 — REAL since ticket 04, raycast→Phase 3 §B, setEdits→Phase 3
  §C, setOptics→Phase 5).
- **D14 ruled 2026-08-23:** embed WASM inline (variant A) — single-file embed carries
  worker+WASM inside the bundle; pages build uses URL-constructed workers.
- **D24 ruled 2026-08-23:** `ThreeSplatScene` exports under its own name — no
  `SparkScene` barrel alias.
- **D19 ruled:** `SplatTextMesh` ships as API-preserving typed stub until Phase 4 rebuild.
- **ADR 0003:** performance metrics are absolute baselines for this toolkit — Spark
  numbers are context, never pass/fail comparators.
- **Copy vintage:** all sparkjs copies from commit `fd67153` via `git show`, never disk.
