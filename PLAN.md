# threejs-toolkit

Gaussian-splat website toolkit on three.js native rendering (`GaussianSplatMesh` +
`WebGPURenderer`). Sibling of `sparkjs-toolkit` — same site model, different renderer.
**Phase 1 closed 2026-08-23.** **Phase 2:** tickets 01–13 done (ticket 13, the exit evidence, closed 2026-09-27); eight owner items for the Phase 2 boundary open (ticket 13).
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
- [x] Re-check the fork against three r186 {#r186-recheck}
  by: claude
  from: roadmap
  tech: ticket 13 AC5, doc 06 watch items 12-13; FORK.md "Per-release re-diff procedure" + drift list; `npm view three version` dated; report only — the vendored files are never touched — done 2026-09-25: r186 IS published (0.186.0 on 2026-09-08, 0.186.1 on 2026-09-24); CountingSort identical, the other two attributable hunk by hunk; three patch surfaces reshape (colour packing, direction-only re-sort, bounds/culling); watch items 5, 10, 13 fired (ticket 13)

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
- [x] Manage page budget, LRU, and GPU uploads {#page-residency}
  by: claude
  tech: ticket 06 — `patches/paged.ts` sibling patch (fixed capacity, partial uploads, invalidation), `src/backend/PagePool.ts` (priority-protected residency, admission gate — ChunkPriority is 07's swap point), paged `load("rad")` path + `pagerDiagnostics`; `examples/pager-lab/` 18/18 on WebGPU and WebGL2 in both regimes (10 H-LIFE cycles, SH band live); GPU sort within-bin nondeterminism measured per run as the pixel-drill band
- [x] Traverse LOD tree and cull by selection {#lod-culling}
  by: claude
  tech: ticket 07 — `src/backend/LodTraversal.ts` (spike traversal promoted; ChunkPriority swap), fork patch 2 `patches/selection.ts` (selection-aware sort via setBinNode + reserved bin + instanceCount cull), LOD driver in ThreeGsBackend (object-space hysteresis on the vendored sort thresholds, admissions, selection-change invalidation), frustum culling from the resident AABB sphere; `examples/pager-lab/` 26/26 on WebGPU and WebGL2 in both regimes
- [x] Wait for the renderer before reading device limits {#renderer-init-wait}
  by: claude
  from: roadmap
  tech: ticket 09 Stop 10 — ThreeGsBackend awaits `renderer.init()` before the page budget (.rad) and the capacity pre-check (PLY); a failed init fails the handle by name; loader-lab, pager-lab, splat-lab re-run both backends
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
- [x] Finish CameraSystem dead-field cleanup (D22) {#d22-camerasystem}
  by: claude
  tech: ticket 10 — `renderer`/`sparkRenderer` kept `@deprecated` and ignored, `renderer` optional (H-API compile-unchanged); `examples/camera-lab/` pre-edit baseline = post-edit capture (camera numbers + 270 pixel samples, synthetic pointer orbit + dblclick recenter) on WebGPU and WebGL2
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
- [x] Re-type SiteRuntime for three backend {#siteruntime-retype}
  by: claude
  from: roadmap
  tech: ticket 09; registration :2221, teardown :4133; D24 rename; latent throw proofs
- [x] Copy embed sources at pin (SplatSiteElement, register, …) {#embed-copy}
  by: claude
  from: roadmap
  tech: ticket 09 (moved from 08 by ruling 08-S0); byte-identical to fd67153 via `git show`

## Watch loads and report problems {#diagnostics}
tech: LoadCoordinator, probes, sinks, PagerTelemetrySource over the backend's counter door
files: [src/diag/**]
needs: [backend-pager]
links: [site-rules, embed-site, fixtures]

- [x] Diagnostic framework copied; selfTest 20/20 {#diag-framework}
  by: phase-1 ticket 07
  tech: commit `b9c9251`; 22 diag paths at fd67153 byte-verified; SparkPagerAdapter carried per R4; `examples/diag/` selfTest `20/20 PASS` in-browser
- [x] Feed StatsHUD from backend counters {#statshud}
  by: claude
  from: roadmap
  tech: ticket 11; `{ container, backend, handles? }` and `fps | drawn | resident | src` summed over handles (D32), K format kept, a disposed handle throws; counters-lab 15/15 both backends against an independent header read; no seam bypass (`backend-doors-only` lint)
- [x] Feed SplatBounds from resident-page union {#splat-bounds}
  by: claude
  from: roadmap
  tech: ticket 11; `computeSplatBounds(backend, handle)` over the seam's `bounds()`, world box by forced 8-corner transform (ruling B1, D33); exact against the fixture's own decoded union at 9 sampled moments and its per-point world box under the flip
- [x] Rewire diagnostics off Spark pager (§G) {#diag-rewire}
  by: claude
  from: roadmap
  tech: ticket 12; SparkPagerAdapter + faultInjector + the Spark fixture deleted (2,271 gross measured, not the inherited ~4,300 — LoadProbe and LaggardMapper had no pager-internal half); new `PagerTelemetrySource` reads the counter door; CPU denominator fed and renamed `renderedSampleWindows` for what it counts (D35 item 5), with a selfTest guard proven red by plant; long-task feed added, peak heap deferred to 13; records name their real backend and engine (D35, semantics 1→2); A2 registration and G4 first-splat restored; two review rounds landed (1 adversarial finding + 4 built-in, all confirmed and fixed); site-lab 19/19 on both backends, diag 15/15; embed shrinks 21,713 B

## Ship splat sites in web pages {#embed-site}
tech: `<splat-site>` web component, SiteRuntime, FragmentRouter, embed builds
files: [src/embed/**, vite.embed.config.ts, dist-embed/**]
needs: [backend-pager, scene-core, site-rules, diagnostics]
links: [fixtures]

- [x] Reveal scenes progressively through the rebuilt splat loader {#a5-contract}
  by: claude
  tech: ticket 08 — `src/core/SplatLoader.ts` (one reveal/progress policy: reveal = seam ready, D26; true fraction then exactly one 1; onError before or after reveal; loadSplatAsync refused), `SplatSource` onProgress/onFailure observers (whenever the backend fails the handle, including after first paint), named shortfall warnings at settle and per chunk after; `examples/loader-lab/` 31/31 on WebGPU and WebGL2 in both regimes
- [x] Prove `<splat-site>` fires the same events as sparkjs {#element-events}
  by: claude
  from: roadmap
  tech: ticket 09 (moved from 08 by ruling 08-S0); H-API row on a fixture site.json, both backends
- [x] Copy diagWiring.stub at pin {#diagwiring-copy}
  by: claude
  from: roadmap
  tech: ticket 09; stub byte-identical + real diagWiring.ts with one declared line (Stop 1); SHAs in Comments
- [x] Drive real site.json end-to-end on both backends {#site-e2e}
  by: claude
  from: roadmap
  tech: ticket 09 `examples/site-lab/` 11/11 on WebGPU and WebGL2 (the pin's own lab + lm-lifetime sites, one URL line repointed): load/reveal/ready, site progress (Stop 5 P1), navigation, teardown through the seam with the renderer's own counters (Stop 16 H1), 10 cycles, both latent throws with controls, authored lifetime with its control, author outlines (Stop 15); ticket 13 still owns the H-LOAD re-run and element-level H-LIFE — reopened 2026-09-26: doc 04's exit names the WHOLE ELEMENT; ruled W3 a — the element on lab.site.json through every stop and back, both backends, in the owner's Chrome (`examples/site-lab/hlife.*`) — done 2026-09-27: the whole element on lab.site.json, ready, stops 1→2→0 and back, on WebGPU and WebGL2 in the owner's plain tab (ticket 13)
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
- [x] counters-lab proves the HUD and bounds against an independent decode {#counters-lab}
  by: claude
  tech: ticket 11; `examples/counters-lab/` on the hero at `?pages=32` — own header parse, own Range fetches, own decode workers; 9 synchronous samples across load, eviction, admission, nothing-resident and convergence; 15/15 on WebGPU and WebGL2, five planted defects each caught
- [x] Record Phase 2 H-LOAD re-run on production runtime {#h-load-rerun}
  by: claude
  from: roadmap
  tech: ticket 13; five cold-cache trials per backend; match or beat spike — trials done 2026-09-25 (visitor 20/20, opt-in 20/20), results in `docs/plan/results/phase-2-hload.md`; STUCK on the owner's rulings S1-S5: webgl-pages32 first-pixel 703.0 vs 598 ms is a regression to diagnose and name (AC2), plus the selection, WebGL2-hash and diff-band items and where the raw records live — updated 2026-09-25: all measured; now STUCK on stops V1-V4 (first-pixel culprit, the WebGL2-default band, r186 adoption, the CRLF copies) — updated 2026-09-26: V1-V4 ruled and recorded (the regression NAMED, its construction fix and r186 adoption each their own ticket after Phase 2; criterion 4's number 2.01 %); the owner's eye check of the H8 pair found a visible quality gap with ours at full quality — a named finding; continuing with the remaining evidence — updated 2026-09-26: now STUCK on stops W1-W5 (the optional-budget retune, the idle-throttle signal for capped sites, which site.json counts as real and what "flat" means, criterion 9's SH check, a heap field in the record) — updated 2026-09-26: W1-W5 ruled (no retune in Phase 2; T2 to a later power ticket; element-level H-LIFE and the end-to-end run in the owner's Chrome; the direct SH-output check built; no heap field) — done 2026-09-27: ticket 13 closed, all five ACs met on the owner's close-out rulings; results in `docs/plan/results/phase-2-hload.md`
- [x] Build the H-LOAD trial page {#hload-harness}
  by: claude
  from: agent
  tech: ticket 13 rulings H1-H8 + D36 item 11; `examples/hload/` built — the element on `lab.site.json`, the spike's trial machine, the visitor-default and telemetry opt-in sets; all 8 checks (C1-C8) shown red on planted faults (built-in pane); the counted sets ran 2026-09-25 in the owner's fronted Chrome tab — 40 of 40 valid, none re-run (the hidden first attempt of 2026-09-24 was discarded, handoff 013)
- [x] Check whether the reveal frame is also the first frame with splats selected {#reveal-vs-selection}
  by: claude
  tech: ticket 13 ruling Q2 — YES, same render in 16 of 16 runs (element default 6/6, loader `?pages=32` 6/6, loader default bridge 2/2, cold-cache 2/2; both backends); single-stepped renders reading uploaded pages, `lod.selectedCount` and phase; the element cannot run `?pages=32` (`SiteRuntime.ts:864`), so that regime ran at the loader level at the element's pose
- [x] Check that a page loaded under a still camera gets its colours recomputed {#sh-output-check}
  by: claude
  from: roadmap
  tech: ticket 13 ruling W4 a; `examples/pager-lab/` reads back a slot's SH contribution rows after an admission under a motionless camera and compares them with a forced recompute; red-first by undoing the insert-time `_sphericalHarmonicsInitialized` re-arm; WebGPU only (WebGL2 evaluates SH per draw) — done 2026-09-26: red on both branches first, then green on WebGPU and WebGL2 in both regimes (built-in pane); found on the way, not fixed: an existing pager-lab check (`evict-readmit-pixel-identical`) fails now and then on WebGPU (finding PL-1, ticket 13); criterion 9's verdict 2026-09-27: met on both halves — the planted fault red and the unplanted check green on the final bytes, both backends (ticket 13)
- [x] Record H-LIFE load→dispose→load ×10 heap flat {#h-life}
  by: claude
  from: roadmap
  tech: ticket 13; full element with real site.json — ruled W3 a (2026-09-26): the pin's own portfolio sites (lab + lm-lifetime), ten cycles on one live element alternating src swaps with remove/re-add, counters back to baseline exactly, heap by site-lab's standard, in the owner's Chrome with the end-to-end run; page built and logic-tested (`examples/site-lab/hlife.*`); found on the way: candidate finding HL-1, a torn-down element is not garbage-collected (ticket 13); RG-3 done 2026-09-27: every deliberate fault shown red again on the final page bytes, both backends (built-in pane) — the three-fault run on WebGPU also tripped the memory check it does not plant, twice, cause not established (ticket 13); the owner's plain-tab check freed 3 of 12 (partial) and the page was found holding three runtimes itself (finding HF-1) — counted runs stopped, the owner's call (ticket 13); ruled (A) 2026-09-27: page fixed and re-proved before the counted runs; HL-1's in-page evidence withdrawn (ticket 13); page fixed 2026-09-27 (112a179f): deliberate faults red again on both backends, the pane frees every runtime (15 of 15 on each backend), HL-1's bare-page leg freed 4 of 4 once my own probe's fault was removed — the owner's plain-tab check next, its freed / not freed / partial rule written first (ticket 13); the owner's plain tab freed 12 of 12 on the fixed page — HL-1 ruled out; the counted runs are plain-tab runs the owner opens (ticket 13); done 2026-09-27: both backends in the owner's plain tab, 7 of 7 checks passing each, counters back to zero after all 11 teardowns, the memory level not climbing, all 33 objects freed; records in docs/plan/results/phase-2-hlife-records.json (ticket 13)
- [x] Answer each of Phase 0's twelve carried improvement items with a number {#ac4-verdicts}
  by: claude
  from: roadmap
  tech: ticket 13 AC4; the owner-confirmed list (ruling R4, ticket 13 AC4-1..12); each item a number and improved / unchanged / deferred with grounds, from the 40 counted H-LOAD records, the counted H-LIFE records, the backend's own counters read at steady, and a fresh library build — verdicts written 2026-09-27 (improved 4, unchanged 7, one bounded by another; no regression); the deferrals are proposed and wait for the owner's confirmation at close-out (ticket 13) — confirmed 2026-09-27 (owner close-out ruling 4)
- [x] Run the spike in today's Chrome as a control for the H-LOAD bar {#spike-control}
  by: claude
  from: roadmap
  tech: ticket 13 rulings S1-S2, doc 06 D36 item 12; `spikes/native-rad` at `e738ba6` on its own server (5209) in a fixed 1280x720 frame, webgl-pages32 × 5 + webgl-default × 5; decision rule recorded before the run; never a new bar — done 2026-09-25: spike 570.8 ms (our code), selections 603,256 / 2,314,382 (window size proven); finding C-1: the environment moved the spike's own figures
- [x] Find where our first splat loses time against the spike {#first-pixel-breakdown}
  by: claude
  from: roadmap
  tech: ticket 13 ruling 1 (control: spike 570.8 ms vs ours 703.0 at webgl-pages32); stage-by-stage breakdown of navigation → first-pixel on our element, brought back as a stop — widened 2026-09-25 (owner): BOTH WebGL2 configurations, since webgl-default is 321.1 ms behind the same-day spike — done: one shared cause, the header hook's full-capacity mesh construction on D20's route (17x / 24x the spike's, measured); what to do is stop V1
- [x] Show why WebGL2 pictures differ between identical loads {#decode-order-hash}
  by: claude
  from: roadmap
  tech: ticket 13 ruling S3 — reading done (spike decodes in priority order on one worker, production in arrival order on 4; both take the first free slot); ruled (b) 2026-09-25: no product change — the door's chunk-to-slot map beside each trial's hash and the network arrival order — done: pictures follow the maps; the maps vary with admission order and the four workers' completion order, not network order
- [x] Measure how much the trial pictures differ between trials {#diff-band}
  by: claude
  from: roadmap
  tech: ticket 13 ruling S4; the same capture as D16's picture pair (H8), whose mechanism is proposed before building; judged against the bar's own footnoted behaviour — ruled (A) 2026-09-25: in-page full-frame readback, band computed in the page, H8's PNGs into `docs/plan/results/phase-2-hload-pictures/` with sha256 — done: WebGL2 1.67 % / 2.01 % of pixels differ between loads, WebGPU 43.3 % / 72.4 %; the H8 pair awaits the owner's eye; the WebGL2-default verdict is stop V2
- [x] Keep the raw H-LOAD trial records in the repo {#hload-raw-records}
  by: claude
  from: roadmap
  tech: ticket 13 ruling S5; all 40 records from Chrome's store into `docs/plan/results/`, the store's sha256 `189f117b…` recomputed over the repo copy and shown equal — done 2026-09-25: `docs/plan/results/phase-2-hload-trials.json`, 60,703 B, sha256 equal, moved out of Chrome byte-exact through a loopback receiver
- [x] Audit the Phase 2 copies against the sparkjs pin {#resync-audit}
  by: claude
  from: roadmap
  tech: ticket 13 ruling R5 (handoff 004:36-50 scope); straight copies byte-identical to `git show fd67153:<path>`, adapted files against their declared differences, the rest a cited change or a finding; never the sparkjs disk — done 2026-09-25: 93 of 128 shared paths byte-identical, every content difference declared or ruled; finding RS-1, three src/ COPY files differ from the pin only in line endings (ticket 13)
- [x] Fix the four small faults in the H-LIFE page {#hlife-small-fixes}
  by: claude
  from: roadmap
  tech: ticket 13's post-ticket list (R1-F1, IH-1, R2-4, R2-5); `examples/site-lab/hlife.ts` — every arrival must reach rest, the idle heap read after collection and outside the 50 ms window, the `gpu-leak` plant as a texture, `obs.runtime` cleared in a finally; a new `restless` plant; every plant red again on the new bytes — STUCK 2026-10-05 on stop SC-2: in today's pane the last runtime stays uncollected with or without any plant, so R2-4 cannot be shown fixed there (ticket 13) — unblocked 2026-10-09 (owner ruling: keep the change, prove R2-4 in the owner's plain tab; the pane's behaviour is observation LR-1) — done 2026-10-09: commit `decac02`; R2-4 proven in the owner's plain tab (collected 9 of 9); every plant red again on the new bytes; unplanted 7 of 7 on both backends
- [x] Guard pager-lab's colour-recompute drill against too few chunks {#drill-guard}
  by: claude
  from: roadmap
  tech: ticket 13 R2-6, R2-7; the drill's scan reaches the last chunk; fewer than two candidates fails by name; a new `drill-one-candidate` plant — done 2026-10-09: commit `38a0bdd`; the three drill plants red, the drill green unplanted on both backends
- [x] Stop the evict/re-admit check failing on sort noise {#pl1-band}
  by: claude
  from: roadmap
  tech: ticket 13 FINDING PL-1; band = the larger of the run's own and 10 on WebGPU, from 4,400 measured draws; a new `readmit-lost` plant — done 2026-10-09: commit `7e1dc0a`; `readmit-lost` red at band 10, every other plant red, unplanted 27 of 27 on both backends and both WebGPU regimes
- [x] Judge a re-admitted picture by its closest re-sort, not one frame {#pl1-closest-frame}
  by: claude
  from: roadmap
  tech: ticket 13 STOP SC-6 ruling (b); `evict-readmit-pixel-identical` passes when min(re-admit frame, 5 forced re-sorts) <= max(band, 10); the derivation records that capture() renders offscreen and that frame 1 = frame 2 in 200 of 200 cycles — STUCK 2026-10-23 on stop SC-7: the `readmit-lost` plant went green, because the drill certifies an eviction from one frame and a noise spike certified a sub-noise eviction (ticket 13) — ruled (a) 2026-10-23: the eviction side uses the same six-frame standard — done 2026-10-23: commit `36f84e0`; `readmit-lost` red in both regimes, all four plants red, unplanted 27 of 27 on both backends in both regimes
- [x] Keep recorded hashes valid in a fresh copy of the repo {#fresh-copy-bytes}
  by: claude
  from: roadmap
  tech: ticket 13 RS-1 (ruling V4 b) and the close-out line-ending leftover; `.gitattributes` `-text` on `docs/**`, `.scratch/**`, `PLAN.md`; `src/core/{CameraPath,CameraRail,LoadingUI,CameraSystem}.ts` to LF — done 2026-10-09: commit `a0bdc49`; after it, 86 of 86 covered files check out byte-identical in a fresh copy, the sidecars pass `sha256sum -c`
- [ ] Trimmed public barrel restored as phases land {#trimmed-barrel}
  from: roadmap
  tech: phase-1 ticket 11 done (51 sources); Phase 2 ticket 09 returned the four embed names and ticket 11 the two counter names (StatsHUD, computeSplatBounds) — 7 of the original 13 still deferred, each returning with its phase

## decisions

- **pager-lab's evict/re-admit comparison changed (owner, 2026-10-23; ticket 13, STOP SC-6),
  superseding SC-1's band rule:** the check passes when the closest of six frames — the re-admit
  frame and five re-sorts of the re-admitted state — is within the larger of the run's own band and
  10. A real loss stays in every re-sorted frame; noise only sometimes pushes one frame high.
  Measured: the floor-plus-band rule still false-failed 3 of 600 cycles; this one 0 of 600.

- **The post-ticket small changes ruled (owner, 2026-10-05; ticket 13, STOP SC-1):** five commits,
  one per change, the records last. Recorded hashes must survive a fresh copy of the repo:
  `docs/**`, `.scratch/**` and `PLAN.md` keep their exact bytes (`-text`, the rule `src/**` and
  `examples/**` already follow), and the RS-1 copies are converted to the pin's LF bytes.
  pager-lab's evict/re-admit check uses the larger of the run's own sort band and a measured floor
  of 10 on WebGPU (WebGL2 stays exact); the measurement's raw numbers live in `docs/plan/results/`.
  The H-LIFE page's `gpu-leak` plant uploads a texture instead of drawing a mesh — three's shared
  `modelWorldMatrix` node kept the last drawn mesh, and through it the last runtime. Three new URL
  plants, so every new failure path is shown red on the exact bytes that run.
- **Ticket 13's close-out decisions ruled (owner, 2026-09-27) — quoted verbatim below:** the ticket
  closes. The H-LIFE page's stop check and four small harness faults found in review become small
  changes after this ticket's commit, so the committed pages stay the exact bytes the counted runs
  used; the size of the optional-budget effect, wrongly stated twice, is corrected everywhere it
  stands, with dated notes and the old words kept visible — and, by two answers the owner gave the
  same session, a dated note also goes beside each quote of the owner's earlier ruling that carried
  the wrong words, and beside the stop where the arithmetic first went wrong; the twelve
  improvement-item deferrals are confirmed; the Phase 0 bar stays, with a dated note that one of its
  "matches" is 321.1 ms behind the same-day spike; the four hook briefs stay untouched and are never
  committed; ticket 12's stale status line is flipped to done (doc 06 **D36 item 12**, eighth
  follow-up; ticket 13).
  > 1. R1-F1 (b): the stop-check fix goes on the post-ticket small-changes list. The committed page stays byte-identical to what the counted runs used, and the records already show every arrival reaching rest (2,951-3,211 ms).
  >
  > 2. R1-F2: YES — correct the RSW-1 wording now, in the six spots you located (source comment + the record notes; the owner's verbatim ruling quotes are never edited — dated notes beside them). New wording per your verified model: no effect at or below 10 fps, ~2x from 10-20 fps, up to ~3x just above 20 fps. Old wording kept visible, dated notes, the source comment keeps its five-line length so no citations shift. The record notes that this is the SECOND correction of the same comment and that both wrong versions passed through the owner's rulings — the W1 no-retune decision itself stands because the trials ran at 2-10 fps where the ratio is exactly 1.0. Re-run check:full after.
  >
  > 3. R2-4 through R2-7: post-ticket harness fixes on the small-changes list. R2-8 stays recorded as the caveat on AC4-1 and AC4-7's traversal counts.
  >
  > 4. AC4: the proposed deferrals are CONFIRMED as recorded in the ticket's table.
  >
  > 5. C-1: keep the Phase 0 bar, with the dated note that WebGL2-default's "match" is 321.1 ms behind the same-day spike. The control is never a new bar (ruling 1 stands); the bar's re-dating belongs to owner item 5.
  >
  > 6. The four hook briefs stay exactly as they are — untouched, uncommitted, never staged.
  >
  > Also authorized: flip ticket 12's status line from ready-for-agent to done with a dated note citing 70dbd22 (the gap you flagged) — it is record hygiene inside an already-modified file, part of this commit.

- **Ticket 13's GO on the fixed page (owner, 2026-09-27) — quoted verbatim below:** the owner's
  plain-tab check freed all 12 of the torn-down objects, so the suspected leak HL-1 is ruled out and
  every counted run is one the owner opens in a plain tab, with Claude's tab only carrying the
  records; the after-teardown memory figure is left as it is and recorded as mis-placed (moving it
  joins the post-ticket small changes); the second bare-page run is accepted (doc 06 **D36 item
  12**, seventh follow-up; ticket 13).
  > IH-1: leave the readout unchanged, exactly as you reasoned — nothing relies on it, and
  > re-touching the page would force another re-proof cycle for a gauge that is now understood.
  > Record it as a wiring finding (reading taken inside the ~50 ms performance.memory refresh
  > window, before cleanup) with the probe evidence, and add "re-place the idle-heap reading" to the
  > post-ticket small-changes list.
  >
  > HL-1 rule-out: accepted as proposed — if my result reads 12 of 12, HL-1 is RULED OUT, recorded
  > with its full evidence chain (in-page evidence withdrawn under HF-1; bare-page leg explained by
  > the probe's own scope flaw, bp-2 clean with prediction-first; plain tab clean on fixed bytes).
  > Anything other than 12 of 12 and it stays a candidate with the new pattern recorded, and the
  > counted runs proceed under the partial=not-freed rule.
  >
  > Your second bare-page run despite my "once" was right, and the record shows why it was right:
  > the first run's instrument was the thing being tested, and you changed only the flawed part with
  > the prediction written first. That supersession is noted as proper.
  >
  > READOUT — after teardown: idle heap 2260.7 MB; collected 12 of 12 (runtimes, renderers, splat
  > meshes) after 3 pressure round(s)
  >
  > DONE — 7 passed, 0 failed

- **Ticket 13's STOP HF-1 ruled (owner, 2026-09-27) — quoted verbatim below:** the H-LIFE page is
  fixed so its own code holds no torn-down runtime, and its header's false claim is corrected; then,
  in order: the deliberate faults re-shown on the new page, a browser-pane control that shows what
  the product itself keeps, the owner's plain-tab check again (with freed / not freed / partial
  defined before it runs), and the counted runs. The suspected memory leak HL-1 stays a candidate
  with its in-page evidence withdrawn. A cause is confirmed only by a prediction written down before
  the run (doc 06 **D36 item 12**, sixth follow-up; ticket 13).
  > Ruling on STOP HF-1: (A), as recommended. Fix the page so its main function names no runtime
  > (small helper functions), correct the lying header at hlife.ts:36 — a header that claims "no
  > references" while three variables hold runtimes is the same instrument-honesty defect as a gauge
  > that cannot move — then the full re-proof in your stated order: (1) RG-3's four faults shown red
  > on the NEW fingerprinted bytes, (2) a pane control whose READOUT then measures what the PRODUCT
  > keeps, (3) the owner repeats the plain-tab HL-1 check on the new bytes, interpreted by the
  > recorded rule (now with the partial case covered: state before the run what counts as freed, not
  > freed, and partial on the fixed page, so no result arrives uninterpretable again), (4) the
  > counted session.
  >
  > HL-1's status: accepted as proposed — it stays a candidate with its in-page evidence WITHDRAWN
  > as explained by HF-1, recorded that way with the withdrawal's grounds, its only remaining
  > support the bare-page console experiment. If step (2)'s pane control on clean bytes shows the
  > product retaining nothing, re-run the bare-page experiment once before ruling HL-1 out entirely
  > — a candidate should die on a measurement, not on a suspicion that its last leg was also
  > contaminated.
  >
  > The prediction-first test (writing "6 of 15" down before running it) is the standard for
  > cause-confirmation from here on; the record should show the prediction preceded the run.
  >
  > MR-1 and IH-1 dispositions stand as recorded. On IH-1 specifically: with HF-1 known, check once
  > on the fixed bytes whether the idle readout moves when it should (the page held ~3 GB of
  > runtimes — an idle reading identical to the byte across teardown was consistent with your page
  > pinning the heap; if it still never moves on clean bytes, that is its own small finding about
  > the readout's wiring).
  >
  > Then, per the standing order: the counted session, criterion 9's verdict, the AC4 12-item
  > verdicts, check:full, both review rounds reported separately, the single commit.

- **Ticket 13's GO message (owner, 2026-09-27) — quoted verbatim below:** the memory check that
  tripped in the deliberate-fault runs without being planted does not hold up the counted runs and
  stays an open observation (MR-1); the after-teardown memory figure that never moves is noted as
  unexplained and not relied upon (IH-1); the owner's plain-tab check freed 3 of 12 — a partial
  result neither branch of the rule covers — and the page itself turned out to hold three of the
  runtimes (finding HF-1), so the counted runs wait for the owner's call on STOP HF-1 (doc 06 **D36
  item 12**, fifth follow-up; ticket 13).
  > Ruling on the unplanted memory red in the RG-3 fault runs: it does NOT block the counted
  > session. Grounds: the counted runs plant nothing, so the retained-plant-objects candidate cannot
  > apply to them, and they judge eleven readings where the fault runs judged three against ~117 MB
  > pane noise. Keep it recorded as an open observation with both untested candidates; if the
  > counted runs' own heap series shows the same shape unplanted, it graduates to a finding and
  > comes back as a stop.
  >
  > Also record, as a small named observation: the idle-heap readout equaling the last steady
  > reading to the byte is suspicious enough to note (a readout that cannot move is a gauge that may
  > not be connected) — you flagged it honestly; it goes in the record as unexplained, not relied
  > upon, and HL-1's interpretation stays on the collected count as ruled.
  >
  > Then interpret my plain-tab result per the recorded rule (freed → instrument artifact, all
  > counted runs plain-tab with the driven tab as store-courier only; not freed → real product
  > finding, WebGL2 heap failure pre-explained), and run the counted session accordingly: WebGPU
  > then WebGL2, stops 1→2→0, ten alternating src-swap and remove/re-add cycles, final removal,
  > records to docs/plan/results/phase-2-hlife-records.json via the store route, fingerprints
  > re-checked on the repo copy, every record naming its tab kind. Announce anything that goes
  > hidden and redo it.
  >
  > READOUT — after teardown: idle heap 3135.1 MB; collected 3 of 12 (runtimes, renderers, splat
  > meshes) after 40 pressure round(s); NOT collected: runtime 0, renderer 0, mesh 0, runtime 2,
  > renderer 2, mesh 2, runtime 3, renderer 3, mesh 3
  >
  > DONE — 7 passed, 0 failed

- **Ticket 13's H-LIFE rulings from the STOP message and the next session's opening (owner,
  2026-09-27) — quoted verbatim below:** if the whole element's torn-down runtimes are freed in a
  plain browser tab, the leak seen so far came from the debugging connection and the counted memory
  evidence comes from plain-tab runs; if not, it is a real product finding and hunting its cause
  gets its own ticket; the run records go to `docs/plan/results/phase-2-hlife-records.json`; an
  occasional failure of one pager-lab picture check (PL-1) does not block close-out, and widening
  its noise band joins a new "post-ticket small changes" list with the line-ending conversion; the
  colour check's first-named deliberate fault is replaced because it cannot fail, and the owner owns
  that change; the new page's deliberate faults are re-run on its final bytes before any counted run
  (doc 06 **D36 item 12**, fourth follow-up; ticket 13 corrects two figures — 3 of 8 WebGPU runs,
  and 29 status lines with four hook briefs).
  > Interpretation, already ruled: runtimes freed in the plain tab → HL-1 is the debugging
  > connection, an instrument artifact, counted heap evidence from the owner's plain tab (fallback
  > B); not freed → HL-1 is a real product finding, WebGL2's heap gate failure pre-explained,
  > retainer-hunt diagnosis deferred to its own ticket. Then the counted session: WebGPU then
  > WebGL2, stops 1→2→0, ten alternating src-swap and remove/re-add cycles, final removal, records
  > to docs/plan/results/phase-2-hlife-records.json (ruled), fingerprint re-checked on the repo
  > copy, owner's window fronted throughout, hidden runs redone.
  >
  > the W4 SH-output check (red on both branches — held-flag plant on WebGPU, sh-premise plant on
  > WebGL2 — green both backends both regimes; the ruled single-re-arm plant SUPERSEDED because it
  > cannot bite, owner owns that supersession; the sh-rearm-once green run as the proof), finding
  > PL-1 (evict-readmit inherited flake, 3-of-7 WebGPU, one pre-insertion failure proving
  > inheritance; a PL-1 failure alone does not block close-out, tally reported, band-widening on the
  > post-ticket list)
  >
  > The two open points are answered now: (1) "the post-ticket list" lives in ticket 13's
  > owner-items section, as a clearly-labeled "post-ticket small changes" sublist (currently: widen
  > evict-readmit's noise band; convert the RS-1 line endings) — distinct from the numbered owner
  > items. (2) If the owner's plain tab shows the runtimes freed, the counted heap evidence comes
  > from plain-tab runs the owner starts by opening the URL; the page POSTs its records byte-exact
  > to the 5299 receiver exactly as the H-LOAD raw records did, fingerprint re-checked on the repo
  > copy — no debugging attachment touches those runs; the Claude-driven tab is used only for the
  > parts that need driving, and each record states which tab kind produced it.
  >
  > SECOND, RG-3: approved — re-run the W3 page's deliberate-fault checks against the FINAL page
  > bytes in the built-in pane (logic only) before any counted trial, and record that the reds
  > reproduce on the fingerprinted bytes. A plant that has not been shown red on the exact bytes
  > that will run has not been shown red.
  Ruled the same day on the stop that followed (RR-1): the records leave the owner's browser the way
  the load-trial records did, so the new page does not change; and if the runtimes are freed, every
  counted run is one the owner opens in a plain tab (ticket 13). The chosen answers, verbatim:
  > (B) Store route (Recommended)
  >
  > Yes, all plain-tab

- **Ticket 13 stops W1-W5 and finding RSW-1 ruled (owner, 2026-09-26) — quoted verbatim below:**
  the optional-work budget is not retuned in Phase 2, and the overstated "sixfold" is corrected
  in all four places it stood, including one source comment (the only code edit); the idle-throttle
  signal for capped sites goes to a later power ticket, which starts from the fact that real
  low-limit WebGL2 devices are capped (85 of the hero's 122 pages at a 4,096 texture limit —
  computed, not measured); the whole-element memory and end-to-end runs use the pin's two portfolio
  sites in the owner's Chrome; criterion 9 gets a direct check of the recomputed colours; the load
  record gets no heap field (doc 06 **D36 item 12**, third follow-up). *Dated note, 2026-09-27 (close-out ruling 2):* the size of the effect quoted below — "at most roughly twofold, and only above ~20 fps" and "~2x above 20 fps" — was Claude's arithmetic, and it was wrong: no effect at or below 10 fps, ~2x from 10-20 fps, up to ~3x just above 20 fps. The quote stays as the owner wrote it; the no-retune decision stands, because the trials ran at 2-10 fps, where there is no effect.
  > RSW-1: correct in ALL FOUR places with dated notes — doc 06 D35 item 5, ticket 12, ticket 13,
  > AND the source comment at PagerTelemetrySource.ts:299-306. The comment is the one code edit
  > authorized: comments that overstate are instrument-honesty defects, and this one defends a
  > ruling of mine with wrong arithmetic. The correction preserves the ruling (window-counting is
  > the pin's cadence, kept for parity) and replaces the stakes: "at most roughly twofold, and only
  > above ~20 fps, because the tick samples at >=100 ms and the per-window allowance is capped" —
  > cite your trace. My D35 grounds carried the same overstatement; the dated note owns that.
  >
  > W1 (a): no retune in Phase 2. Grounds recorded: RSW-1 shrinks the maximum effect to ~2x above 20
  > fps; the trials' drag regime ran at 2-10 fps where a retune changes nearly nothing; and the
  > owner's telemetry-price item already covers the whole cost. Retune later only against a profile,
  > as a post-parity item — record it as CLOSED for this ticket with these grounds, discharging the
  > D35 item 5 deferral.
  >
  > W2 (b): record and defer to a later power ticket, WITH your new fact prominently recorded:
  > capped sites are a real-device regime, not a test artifact — the product's own formula puts a
  > 4,096-texture WebGL2 device at 85 of the hero's 122 pages, and a capped site never
  > idle-throttles. Label the 85/122 as computed-not-measured. That fact is what the power ticket
  > opens with.
  >
  > W3 (a): lab.site.json + lm-lifetime.site.json, swap partner as recommended — they are the pin's
  > own portfolio sites, which is as "real" as this repo can get without shipping assets, and the
  > src-swap is the product's actual swap mechanism. H-LIFE x10 on one live element alternating src
  > swaps with remove/re-add, counters back to baseline EXACTLY, heap reported against site-lab's
  > existing not-strictly-increasing standard — no new tolerance invented. End-to-end through every
  > stop on both backends. In the owner's Chrome, one window session — announce when ready and wait
  > for go.
  >
  > W4 (a): the direct SH-output check in pager-lab, shown failing on a planted fault first (your
  > invalidate()/_sphericalHarmonicsInitialized plant), no product change. WebGL2 recomputing
  > per-draw is recorded as the reason the check only needs to bite on WebGPU.
  >
  > W5 (b): no field. Grounds recorded: Chrome-only API, page-scoped where the record is
  > scene-scoped, and the harness already measured heap in all 40 preserved trials. The named gap
  > from ticket 12 is discharged as decided-with-grounds, not forgotten. The semantics version stays
  > at 2.

- **Ticket 13 stops V1-V4 ruled (owner, 2026-09-26) — quoted verbatim below:** the first-pixel
  regression is NAMED, and its fix (building the mesh without the full-size construction) gets
  its own ticket after Phase 2; criterion 4's number is 2.01 % of pixels; adopting three r186 is
  its own ticket after Phase 2; the three copies with Windows line endings are converted in
  their own small change after this ticket (doc 06 **D36 item 12**, second follow-up). Also on
  2026-09-26: the owner's eye check of the H8 picture pair found a VISIBLE quality gap — the
  pin clearly sharper — and ours was captured at full quality, so it is a named finding and an
  owner item; its diagnosis belongs to a later ticket.
  > V1 (a): name it, don't fix it here. Record with the full measurements: the shared cause
  > (full-capacity source-array construction through the byte-frozen vendored constructor, required
  > by D20), the side-by-side (243 vs 14 ms at 32 pages, 897 vs 37 ms at 122), the estimate labeled
  > as an estimate (~85 of 132.2 ms, ~298 of 321.1 ms), the ~47 ms remainder named as unexplained,
  > and the chunk-0-bytes stage (270-690 ms, longest tasks 231/822 ms) named as unattributed. The
  > fix is (b)'s shape — placeholder mesh plus empty full-size storage inside D20's rules — in its
  > own post-Phase-2 ticket; add it to the owner-items list with these numbers.
  >
  > V2 (a): record 2.01% as criterion 4's number, with the verdicts as presented — WebGPU variation
  > is the bar's own † kind; WebGL2-pages32 is the ‡ kind, more frequent; WebGL2-default's
  > cross-load variation is new behavior with a proven mechanism (slot = decode-completion order
  > under 4-worker scheduling, not network order), accepted as the price of 3-5x faster full-quality
  > loading. Record (b) and (c) as post-parity options with (c)'s cost quoted (54 s vs 15.5 s).
  >
  > V3 (a): r186 adoption is its own post-Phase-2 ticket. Record the per-item dispositions (item 13
  > deletes the SPZ refusal at adoption; item 5 is a recorded reason to KEEP doc 03 §B; item 10
  > drops the JS type-guessing reliance at adoption), the four breaking changes as that ticket's
  > known scope, and the six stale "unpublished" lines as its doc corrections — none edited now. Add
  > r186 adoption to the owner-items list.
  >
  > V4 (b): record RS-1 and convert the line endings in their own small change after this ticket.
  > The audit (93 byte-identical, 24 traced, 11 native, zero unexplained) closes the re-sync item
  > with a finding.

- **Ticket 13 control run and item rulings (owner, 2026-09-25):** the same-day spike control read
  570.8 ms at WebGL2 `?pages=32` first-pixel — so the 703.0 ms regression is OUR CODE, and a
  stage-by-stage breakdown of our first-pixel path comes back as a stop; at 1280x720 the spike
  selects exactly our figures, PROVING the window-size explanation. The WebGL2 hash question is
  measured with no product change (the diagnostics door's chunk-to-slot map beside each hash and
  the network arrival order — a one-worker pool would still submit in arrival order, so it could
  not have isolated anything). Criterion 4's band and the H8 picture pair use in-page full-frame
  readback, the PNGs kept in `docs/plan/results/phase-2-hload-pictures/` with their sha256 (doc 06
  **D36 addendum item 12**, follow-up).

- **Ticket 13 results rulings (owner, 2026-09-25):** the one timing regression (WebGL2
  `?pages=32` first-pixel, 703.0 against the bar's 598 ms) is diagnosed by a same-day CONTROL
  run of the spike's own measuring page in Chrome at 1280x720 — never a new bar — with its
  decision rule written down first (spike ~700 ms → environment drift, bar re-dated; ~600 ms →
  our code, instrumented stage by stage); the same run settles whether the window size explains
  the selection difference; the WebGL2 cross-trial hashes get a code reading, then a one-worker
  decode run only through an existing seam (none exists → a stop); criterion 4's difference band
  is measured with D16's picture-pair capture; all 40 raw trial records are copied into
  `docs/plan/results/` with their fingerprint shown equal; the opt-in telemetry price joins the
  Phase 2 owner items; the r186 re-check and the re-sync audit start in parallel (doc 06 **D36
  addendum item 12**).

- **Ticket 13 blocker rulings (owner, 2026-09-24):** the counted H-LOAD trials run at the VISITOR
  default — telemetry off, the product as shipped — because the bar is what a visitor experiences;
  a separate full opt-in set (the site's own `settings.telemetry`), never mixed into the visitor
  medians, supplies the load record's figures, the evidence for the optional-budget retune, and the
  measured cost of telemetry itself, checking the code's claim that opt-in telemetry is "now
  bounded" (doc 06 **D36 addendum item 11**). Trials run only in the owner's Chrome; if it is not
  connected, the session stops and reports. The throttle-direction and cold-check corrections are
  recorded as dated notes beside their original rulings.

- **Ticket 13 harness rulings (owner, 2026-09-24):** the H-LOAD trial page `examples/hload/` hosts
  the element on `lab.site.json`; the `?pages=32` regime is set through the probe's observation
  hook with EVERY trial asserting the backend's own reported budget, and no product change (H1);
  the spike's pose (0,0,3) and quarter-orbit through the element's public camera system, the
  near-plane difference declared (H2); the spike's real window size recovered read-only from the
  built-in pane's storage if it survives, else pixel ratio 1 and a fixed 1280x720 box, the
  unrecorded-size caveat declared either way (H3); a synthetic pointermove per frame keeps the
  10 fps idle throttle off and every trial proves it never engaged, the guard shown biting first
  (H4); the spike's full-quality and steady definitions, per-trial cold cache, the dev server, and
  D16's picture pair for the owner's eye (H5-H8). Doc 06 **D36 addendum**. The D26 empty-paint
  reveal (F1) is RECORDED, NOT FIXED — an owner item for the Phase 2 boundary beside the
  unminified embed, because background-tab loading is a real user regime (doc 06 D26 note).

- **Ticket 13 reconciliation rulings (owner, 2026-09-24):** the record gaps are fixed IN PLACE
  with dated notes, never silently: ticket 13's stale "longest block unfed" line is kept and
  marked SUPERSEDED (fed since `70dbd22`), and ticket 12's two overclaims — the heap instruction
  "written into ticket 13" and the embed "named for ticket 13" — are corrected where they stand
  (R1, R2, R6). Ticket 13 now carries the owner's peak-heap instruction verbatim (R2); the T2
  throttle decision as its own stop, with `lod.wantedChunks` as the candidate signal (R3); a
  12-item AC4 list from an exhaustive sweep — the five Phase 0 named items, `getMaxAnisotropy()`,
  ticket 07's four and ticket 09's two, each to get a number and a verdict, with picking-route
  timing left to Phase 3 (R4); and the Phase 2 re-sync audit against `fd67153` (R5). The embed's
  shipping form stays the OWNER's item (R6). How H-LOAD is measured is doc 06 **D36**: trials in
  the owner's Chrome through a visible tab, with the spike's discard-and-rerun of hidden trials
  (fallback: the owner runs the harness); hosted on the `<splat-site>` element with the hero's
  `lab.site.json`; first-pixel on the spike's selection definition with the D26 reveal beside
  it; long tasks measured page-wide with the spike's method beside the record's per-scene
  figure (Q1, Q1b, Q2, Q3).

- **Ticket 12 rulings (owner, 2026-09-20):** the diagnostics door KEEPS its six residency /
  LOD mutators, declared a TEST-ONLY SEAM in the door's own doc comment — the same species as
  the backend's `fetchImpl` and `pageBudgetOverride` — so one door carries two labeled halves:
  read-only counters for production, mutators for fixtures only (G1). This SUPERSEDES handoff
  007's "make the door read-only", which was written before the three fixtures existed and
  before ticket 11's AC2 grew roots into the mutators (grounds recorded in ticket 12). The
  CPU-budget denominator is FED from our own render path rather than the feature deleted, shown
  red-first self-disabling while unfed, and selfTest now asserts the denominator ADVANCES during
  a load so an unfed regression can never again read as a legitimate one-frame window (G2). The
  barrel-exported telemetry input types are RE-TYPED to the seam pair — a loud compile break
  with doc 06 **D34**, mirroring D32/D33 (G3). `markSceneFirstSplatReady` fires at the loader's
  REVEAL with `counts().resident`, the moment this toolkit already defines as first-splat-
  visible — no second definition (G4). The `phase7-runtime-consent` evaluator runs in
  `examples/site-lab` against the real SiteRuntime with the selfTest count re-baselined there,
  and `examples/diag` stays renderer-free (G5). The ~2,900-line deletion boundary comes to the
  owner file-by-file with consumer-grep evidence and the gross count for a yes/no BEFORE
  anything is deleted (G6). H-LOAD criterion 9's SH-output assertion stays ticket 13's, with a
  note in 13 that the production stack now exists, so 13 chooses build-or-re-record with grounds
  instead of inheriting the deferral (G7). Carried: the embed is re-measured BOTH ways after the
  trim against the 3,932,160 B bound, and the rewired stack proves BY EXECUTION that it still
  emits H-LOAD's four named metrics for ticket 13.

- **Ticket 11 third-stop ruling — S7 (owner, 2026-09-19):** text-lab's obstacle is `moss.ply`,
  SUPERSEDING the S3-(b) hero ruling, which was made before the floater measurement: the hero's
  exact bounds defeat the pin's framing by construction (centre-spread diagonals — middle 98 %
  ≈ 64, middle 99.8 % ≈ 155, exact ≈ 1,085 units: floaters set 94 % of the box), and the pin's own
  framing worked only through sampling undershoot. Text-lab returns to the pin's own scene in its
  closest loadable form; the paged-consumer proof lives in step 7's counters-lab. Conditions: the
  fixture's own carving run on both backends; moss.ply is the first SH degree-3 asset through the
  monolithic path, so that run also notes the newly-live SH3 branch and asserts a clean dispose
  (closing the degree > 1 gap at monolithic scope); doc 04's Phase 4 bounds item gets a dated line
  making percentile clamping a framing REQUIREMENT, not polish. Rejected: keeping the hero with a
  cut criterion (a lab that displays its own fallback proves the fallback) and scaling the camera
  to the floaters (a criterion passed literally while the scene fills 5.6 % of frame is the
  vacuous-check trap with a camera). The 170 MB per-open parse is an accepted lab cost.

- **Ticket 11 second-stop rulings (owner, 2026-09-18):** SiteRuntime's dead splat branch in
  `sphereFromObject` and its import are deleted; Phase 4 re-adds splat-text framing with a real handle
  source (S1). `computeSplatBounds` returns null before construction and with no page resident — the
  pin's "no readable data yet" — while a disposed handle still throws (S2). Text-lab's obstacle is the
  hero `.rad`, the pin's `[1, 0, 0, 0]` quaternion kept as the loader's own flip (S3). The new lab
  proves the 8-corner world box both ways — exact under the flip at pad 0, never smaller under a tilt
  (S4). The HUD keeps the pin's K format (S5) and throws on a disposed handle (S6). Doc 06's D23
  heading is fixed in this ticket's doc pass; `GLOSSARY.md` stays absent until the owner's
  `/domain-modeling` at the Phase 2 boundary (noted in ticket 13).

- **Ticket 11 rulings (owner, 2026-09-18):** `computeSplatBounds(backend, handle, options?)` (A1, the
  one-argument pin call breaks loudly); world bounds = the 8-corner transform of the seam's box, doc 03
  amended (exact for axis-aligned transforms, conservative under arbitrary rotation; per-page seam
  growth is the recorded revisit path); `SplatBoundsOptions` unchanged with `targetSamples` deprecated
  and ignored; StatsHUD takes `{ container, backend, handles? }` and shows fps | drawn | resident |
  src, the Spark-only fields deleted (doc 06 entry, D15 caveat); a broad lint rule makes backend
  internals reachable only through five named doors (doc 02 rule 2 amended; examples exempt); the
  text-lab placeholder obstacle is swapped for loadSplat + computeSplatBounds in this ticket.

- **Ticket 09 review rulings (owner, 2026-09-17):** all eight confirmed findings fixed as
  recommended, red-first — a scene the backend refuses on the spot fails the load through
  `failReady` and the element still gets a disposable runtime; the outline drill counts errors from
  boot; the element proof compares event counts (except `loadprogress`) and asserts the backend it
  ran on; the raycast drill requires the mesh to have attached; the orphaned
  `src/backend/embed-entry.ts` is deleted; the Stop 17 text is corrected. ThreeSplatScene's
  dispose-after-failed-init fix (ticket 03's code) lands as its own commit after ticket 09's. The
  size bound's anchor is re-grounded on measured figures; the bound itself is unchanged.

- **Ticket 09 fourth/fifth-stop rulings and the embed size bound (owner, 2026-09-17):** Stop 3 —
  typed `SplatBounds` stub returning the pin's documented `null` (doc 06 D30; ticket 11 deletes it).
  Stop 7 — the backend refuses three's stock raycast on splat meshes (it hit a phantom template
  quad) until Phase 3 §B, with one author-mode note at the first `pickPoint` (D31; phase-0.md's
  raycast-absence claim narrowed). Stop 13 — the pin's three embed barrel blocks return verbatim.
  Stop 15 — author obstacle outlines on three's WebGPU line pair (`Line2NodeMaterial`; D29 item 5).
  Stop 16 — runtime-scope H-LIFE read synchronously after dispose, the window asserted. Stop 14 —
  the live two-sided run is the element's evidence of record; the stored pin record is a
  convenience. Stop 17 — C1, one consumer file, two scratch tsconfigs, two variants. Stop 6 — no
  advance ruling; 0 contract warnings measured. Embed size bound: 3,932,160 B (3.75 MiB =
  15 × 256 KiB) for the product embed, telemetry in — ~25% over the measured 3,138,621 B; grounds
  and the baseline for any future raise are in ticket 09.

- **Ticket 09 third-stop rulings (owner, 2026-09-17):** WebGL2 budget guard fixed to `gl == null`
  (named-refusal contract; unreachable in normal flow since Stop 10; unit probe). Stop 4 —
  `pagedExtSplats`, `sparkRenderer`, `registerPagedSplat` deleted; rail DoF skipped with one
  author-mode note; docked-idle throttle carried (T1) with a seam-read guard that never throttles
  capped sites (doc 06 D29; ticket 12 notes, ticket 13's evidence decides T2). Stop 5 — site
  progress = slowest scene across all scenes, one 1 at the last reveal; pin's 1-spam and double 1
  not reproduced (D29). Stop 8 — white tint no-op, non-white one author-mode note, boot catch
  narrowed to font failures (D29). Stop 12 — handle keeps `sparkScene`/`mesh` names, re-typed, new
  `handle` field, `paged` from the file format (doc 06 D28, D12; EnvironmentLoader's stale reason
  corrected).

- **Ticket 09 Stops 9/10/11/2 rulings (owner, 2026-09-17):** Stop 9 — SiteRuntime imports a
  checked-in URL-constructed worker factory; `vite.embed.config.ts` swaps it for the inline
  `decode.ts` (the "config-time swap pattern", now used twice with telemetry); phase-1's
  "src/ import.meta-free" narrows to `import.meta.env`/`.hot`. Stop 10 — the backend awaits the
  renderer's init before reading device limits on both load paths (a failed init fails the handle
  by name; also closes the silently skipped PLY pre-check); loader-lab, pager-lab and splat-lab
  re-run on both backends. Stop 11 — the element fixture hides `navigator.gpu` to reach WebGL2
  through three's automatic fallback: deliberately different coverage from `forceWebGL`, not a
  substitute. Stop 2 — inert `SplatHighlight` stub with the pin's API, one author-mode note,
  doc 06 D27 (Phase 3 deletes and replaces it, D19's obligation).

- **Ticket 09 Stop 1 ruling (owner, 2026-09-17):** ticket 09 lands the REAL `diagWiring.ts`
  (one declared line: the Spark type import repointed at the backend's type — scratch typecheck
  shows zero diagWiring errors after it) with the stub byte-identical beside it, the pin's
  `TELEMETRY_MEASURE` switch, and barrel names identical to the pin incl. `LOAD_TELEMETRY_MARKER`.
  Until ticket 12, SiteRuntime skips paged-scene telemetry registration and prints ONE named
  author-mode note; ticket 12 owns removing both. Closes the plan-review gap (no ticket owned the
  real file). The embed is measured with and without telemetry; both numbers go to the owner with
  the size-bound question.

- **Ticket 08 rulings (owner, 2026-09-13):** S0 — the §A5 contract is built UNDER
  the runtime: the rebuilt SplatLoader holds the one reveal/progress policy (loader-level
  page); the three embed pin-copies, the element's event proof and the embed-entry switch
  move to ticket 09 (the pinned element cannot run without SiteRuntime). S1 — reveal = the
  seam's paint-observed ready; true fraction until then, exactly 1 once; the pin's
  11-constant gate is a reference only (doc 06 D26). S2 — partial shortfall reveals with
  truthful counts + one console warning; a whole-load failure after first paint must
  surface as a named failure (backend gap fixed here). `loadSplat` keeps name/options,
  gains `backend`, returns the handle (D25); the loader applies the pin's conditional
  180° flip — corrects the "X-flip is SiteConfig's, ticket 09" line below. Embed size
  bound: measured in 09, set by the owner.
- **Ticket 10 rulings (owner, 2026-09-17):** CameraSystemConfig's dead `renderer` and `sparkRenderer`
  stay, `@deprecated` and ignored, `renderer` made optional (H-API compile-unchanged: all 10 pin
  call sites pass `renderer`); `scene` left as-is and recorded in doc 06 for Phase 3's
  `backend.raycast()` decision; proof = dedicated `examples/camera-lab/`, pre-edit baseline, exact
  match after (camera numbers + pixels, both backends), synthetic pointers verified before choosing
  the orbit drive.
- **Ticket 08 asymmetry ruling restated (owner, 2026-09-17):** split BY PATH — load-pipeline decode
  errors fail the whole load; re-admission errors mark one chunk unavailable, pre- or post-settle.
- **Ticket 08 third-stop rulings (owner, 2026-09-17):** a chunk found unavailable AFTER the
  load settled gets its own named warning (the load-finish warning stays); post-settle
  `decode-dispatch-failed` / `decode-protocol-error` mark the chunk unavailable instead of
  silently dropping its bytes. Reviewer selection: the agent-collaboration v2 registry's lane
  order governs (astra-review first) — handoffs are dated snapshots, never standing pins.
- **Ticket 08 second-stop rulings (owner, 2026-09-16):** S3 — progress and failure reach
  the loader through optional `onProgress`/`onFailure` callbacks on the load request (no
  polling, no new seam method; `onError` on the loader options for 09). S4 — `loadSplatAsync`
  refuses by name until SceneComposer's Phase 3 ticket has a real caller. S5 — `extSplats`/
  `lod`/`paged` accepted with one named warning on a contradiction; noise level reviewed
  once in 09. `onLoad` = reveal on both paths; a pre-reveal 1.0 is held for reveal.
- **Ticket 07 rulings (owner, 2026-09-12):** deselection = reserved last sort bin +
  public `instanceCount` cull (declared divergence from the spike's vertex-node cull;
  vendored JS frozen; 4095 depth bins). LOD threshold derived from the camera ×
  `lodRenderScale` (default 1). Splat budget option, Spark's 2.5M desktop start; mobile
  classes unpinned. Foveation = Spark defaults as options (ADR 0003 starting values).
  Re-traversal hysteresis = the vendored sort's own motion thresholds, mirrored.
  H-FORK identity judged on the monolithic path only.
- **Ticket 06 rulings (owner, 2026-09-03):** budget = ADR 0003 formula exactly (device
  limits → capacity guard on WebGPU, MAX_TEXTURE_SIZE formula on WebGL2, asset, override);
  "device memory class" stays unpinned pending mobile measurement. Eviction: static
  chunk-index priority + admission gate behind the interface ticket 07's traversal
  swaps into. AC4 here = evict/re-admit/pixel-identical machinery proof; the
  pose-driven half re-runs in 07. Re-decode from cached raw bytes (Phase 0 item 3 open;
  re-fetch is its likely answer). Progress = equal-weight mean of bytes/decoded/
  first-uploaded ratios (null weighting; all three spec terms); fraction rises after
  paint-observed ready. Zero pages uploaded → `no-pages-available`. Job-log bound =
  chunk count. Object handed over unrotated (X-flip is SiteConfig's, ticket 09).
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
