# 09 — SiteRuntime re-typing: registration, teardown, D24 rename

**Status:** done
**Blocked by:** 01 — DisplayChannel (this ticket lands the rules runtime's first
live consumer); 04 — dispose (teardown needs it); 08 — the load/reveal contract in the rebuilt
SplatLoader (the element itself lands HERE since ruling 08-S0).

**What to build:** the production runtime orchestrates a real site end to end on
the new backend: meshes register through the seam, teardown disposes through it,
and consumers name `ThreeSplatScene` rather than `SparkScene` (D24 — the loud
one-line edit). This is where the latent semantic changes finally meet a live
runtime — they must be PROVEN, not assumed. Owns the `diagWiring.stub` pin-copy
and — since owner ruling 08-S0 (2026-09-13) — the other three embed pin-copies
(SplatSiteElement, FragmentRouter, `register`), the element's H-API event proof,
and the embed-entry switch.

Standing rules bind (spec.md). Owner ruling: MediaLayer anisotropy STAYS at parity
(1); `getMaxAnisotropy()` is recorded as a post-parity improvement candidate in
ticket 13's carried-forward list, not changed here.

- [x] A real site.json drives SiteRuntime through load, navigation, and teardown on
      both backends; teardown leaves nothing resident (H-LIFE at runtime scope,
      numbers in Comments).
- [x] Latent throw (a): an authored `annotation-<id>-copy` block id throws at
      `normalizeSiteConfig`, shown with a runtime case plus a passing control.
- [x] Latent throw (b): duplicate show-blocks effects throw at RuleModel
      validation, shown with a runtime case plus a passing control.
- [x] Authored `lifetime` behavior (ticket 01's re-sync) re-confirmed under the
      full runtime, both backends.
- [x] H-API consumer fixture compiles against both toolkits and records the
      `SparkScene`→`ThreeSplatScene` divergence as expected (D24), not a failure.
- [x] `diagWiring.stub` pin-copied; SHA in Comments. (With ruling Stop 1, 2026-09-17: the
      REAL `diagWiring.ts` lands beside it with exactly one declared line change, the pin's
      `TELEMETRY_MEASURE` switch is carried, and the telemetry barrel names match the pin.)
- [x] SplatSiteElement, FragmentRouter, and register are byte-identical to the pin;
      SHAs in Comments, hashed on the destination tree. (MOVED from ticket 08 by
      owner ruling 08-S0, 2026-09-13.)
- [x] The event sequence and payload shapes on a fixture site.json match
      sparkjs-toolkit's on the same file (H-API row), both backends — the sparkjs
      side from a pinned-file snapshot of `fd67153` exported to a scratch dir,
      sparkjs untouched. (MOVED from ticket 08 by owner ruling 08-S0.)
- [x] The embed build's entry switches to `src/embed/register.ts`; the bundle size is
      measured and the work STOPS for the owner's new size bound — never raised by
      an agent. (MOVED from ticket 08 with ruling 08-S0.) Measured BOTH with and without
      telemetry through the pin's switch; both numbers go to the owner (ruling Stop 1).

## Comments

**Inherited from ticket 08 (owner rulings 2026-09-13):**
- **S0 moved the embed set and the element's event proof here.** Evidence: the
  pinned element cannot run without SiteRuntime — `fd67153:src/embed/
  SplatSiteElement.ts:25` imports `createSiteRuntime`/`resolveSiteAssets`;
  `ready`/`loadprogress` fire only from runtime callbacks (`:1006-1017`);
  SiteRuntime owns the gate (`SiteRuntime.ts:748-769`, `:2432-2606`) and imports
  five files absent at 08's start (`core/SplatLoader`, `core/SparkScene`,
  `embed/diagWiring`, `interact/SplatHighlight`, `core/SplatBounds`).
- **One reveal/progress policy lives in ticket 08's rebuilt SplatLoader** (ruling
  S1: reveal = the seam's paint-observed ready; true fraction until reveal, then
  exactly 1 once). The pin's `checkSceneVisibility` gate (`:2432-2606`, 11
  constants, residency-read) is NOT carried as a second definition; doc 06 D26
  keeps it only as a reference for a future product revisit.
- **A whole-load failure after first paint reaches the loader's consumer as a
  named failure** (ruling S2, fixed in 08) — SiteRuntime routes it to
  `onLoadError`, which the element turns into `loaderror` (its existing
  failure-after-ready path, `SplatSiteElement.ts:705-720`).
- The conditional 180° X-flip is applied by the rebuilt SplatLoader (pin
  `SplatLoader.ts:81-88`); SiteRuntime passes `def.eulerRotationDeg` through as
  the pin does (correction to handoff 007 recorded in ticket 08).

**Stop agenda at ticket start (2026-09-17).** Fifteen open points, each verified
against the pin: handoff 008's list (diagWiring, SplatHighlight, SplatBounds,
SparkScene-only members, multi-scene progress/ready, S5 noise, author picking) plus
eight found at start — tint (`entry.mesh.recolor`, pin :3358, vs `setMeshColor`'s
Phase 4 refusal; a throw there lands in the font `.catch(() => {})` at :3373),
decode-worker source, boot-order race (`rad-needs-renderer`,
ThreeGsBackend.ts:605), forcing WebGL2 through the byte-identical element, handle
naming (`sparkScene`, `LoadedScene.mesh`), barrel names, what "events match" means
under S1 plus how the sparkjs snapshot runs, and author-mode `LineMaterial` on the
WebGPU node library. Method: the five pinned embed files typechecked against this
repo's `src/` in a scratch copy (repo untouched), three waves with throwaway
stand-ins so the edit list comes from the compiler — 4 absent imports, the missing
`backend` option, 5 SparkScene-only members, 5 per-mesh Spark uses; three more pager
reads hide behind `as any` (:2500, :3448, :3762).

**Owner ruling, Stop 1 — diagWiring chicken-and-egg (2026-09-17): A with A2.**
- Ticket 09 lands the REAL `src/embed/diagWiring.ts`, pin-copied with ONE declared
  line change: the Spark type import (pin :19, `import type { SplatMesh } from
  "@sparkjsdev/spark";`) repointed at the backend's type. `diagWiring.stub.ts` lands
  beside it byte-identical. SiteRuntime imports `./diagWiring` exactly as the pin
  does. The pin's `TELEMETRY_MEASURE=off` switch (pin `vite.config.ts` and
  `vite.embed.config.ts`: alias `./diagWiring` → the stub) is carried. Barrel names
  are identical to the pin (`fd67153:src/index.ts:122-132`), including
  `LOAD_TELEMETRY_MARKER`, which only the real file defines.
- Evidence (scratch typecheck, 2026-09-17): pin copies alone →
  `src/embed/diagWiring.stub.ts(8,66): error TS2307: Cannot find module
  './diagWiring'`; with the real file verbatim, its only error →
  `src/embed/diagWiring.ts(19,32): error TS2307: Cannot find module
  '@sparkjsdev/spark'`; with that one line repointed at the backend's type →
  `E3: total errors=15, in diagWiring*=0` (the 15 are all SiteRuntime's). Every other
  diagWiring import (SparkPagerAdapter, LoadProbe, sinks, …) is already in-tree from
  Phase 1 ticket 07. At the pin the stub is the measurement ALTERNATE — normal builds
  ship the real file.
- **A2:** until ticket 12, SiteRuntime does NOT register paged scenes with load
  telemetry — the real file would poll for a Spark `mesh.paged.pager` every 200 ms
  for 30 s and then give up silently (pin diagWiring.ts:125-126, :228-237), and this
  backend's object never has one. Instead it prints ONE named note in author mode
  (reading: once per runtime, at the first paged scene whose registration is
  skipped). Ticket 12's file records the note and the skip as what its rewire
  replaces, so the note has a named owner.
- REJECTED: B (stub as default + a hand-written types placeholder — inverts the pin's
  wiring, makes the stub's own header false, creates the placeholder ticket 12's AC1
  forbids leaving, reports author-mode consent as "disabled" for the wrong reason);
  C (move the pair to ticket 12 — SiteRuntime's telemetry lines out in 09 and back in
  12, plus a ticket re-cut).
- **Ownership gap closed by this ruling:** no ticket previously owned the real
  `diagWiring.ts`. The Phase 2 breakdown review asked only for the STUB's pin-copy to
  get an owner (`.collab-logs/codex-plan-review.md:11`); `.scratch/phase-1-foundation/
  graph-check.py:72` places `embed/diagWiring.ts` in Phase 2, but no ticket's ACs
  landed it, while ticket 12's AC1 deletes "the pager-internal halves of …
  diagWiring" as though it were already in-tree.
- **D14 interaction (recorded with this ruling):** with the real file as the default,
  the embed carries the diagnostics graph until ticket 12 trims it, as the pin's
  normal build does. The embed measurement therefore runs BOTH ways through the pin's
  switch (normal build and `TELEMETRY_MEASURE=off`), and both numbers go to the owner
  with the size-bound question. D14 itself (WASM inline, single file) holds either way.
- **A2 reading CONFIRMED by the owner (2026-09-17):** one named note per runtime, at the
  first paged scene whose telemetry registration is skipped.

**The config-time swap pattern (named by owner ruling, 2026-09-17).** One checked-in
DEFAULT module that typechecks and works for every consumer, plus one regex alias in a
Vite config that replaces it for one build at CONFIG time, so that build never contains
the default's graph. Used twice here: (1) telemetry — `./diagWiring` →
`diagWiring.stub.ts` when `TELEMETRY_MEASURE=off` (the pin's mechanism, both Vite configs,
opt-in; Stop 1); (2) decode-worker source — SiteRuntime's URL-constructed factory module →
the inline `src/backend/decode.ts` in `vite.embed.config.ts`, always (Stop 9). Properties
that make it safe: default and replacement export the same names and signatures; the alias
regex matches the importer's exact specifier; tsc and dependency-cruiser see only the
default, so the replacement must itself be an in-tree, checked file (both replacements are).

**Owner ruling, Stop 9 — decode-worker source (2026-09-17): B.**
- SiteRuntime imports its worker factory from one small checked-in module whose default
  builds the worker from its URL; `vite.embed.config.ts` swaps it for the inline
  `src/backend/decode.ts` at config time (pattern above).
- Keeps D14 — scratch build of the same entry both ways: swapped → one `embed.js` of
  216,529 B with the WASM inline; unswapped → `embed.js` 193 B + a separate
  `assets/rad-worker-BkjUMr4R.js` 215,803 B. Keeps the ticket-02 barrel guard
  (`lib-barrel-must-not-reach-inline-worker`). Keeps every consumer working with zero extra
  calls — the byte-identical element and `register.ts` pass no factory
  (`fd67153:src/embed/SplatSiteElement.ts:993-1030`), so the choice can only live in
  SiteRuntime.
- REJECTED: A (SiteRuntime imports the inline factory — the barrel lint fails once the pin's
  `createSiteRuntime` / `defineSplatSite` barrel names return, forcing an H-API break or the
  guard's reversal); C (a refusing default with a swap per config — sites compiling `src/`
  with their own Vite get `.rad` refusals); D (a wrapper embed entry plus a setter —
  contradicts this ticket's entry wording, adds module-level mutable state, library users
  must call the setter). A `SiteRuntimeOptions` field alone was never viable: the element
  cannot pass it.
- **Constraint AMENDED by the same ruling:** phase-1's "src/ stays import.meta-free"
  NARROWS to Vite-specific surfaces (`import.meta.env`, `import.meta.hot`). Grounds: the
  original concern was Vite type pollution (`examples/vite-env.d.ts` references
  `vite/client` program-wide); `import.meta.url` is standard JavaScript, proven to
  typecheck with `"types": []` (scratch tsc on the URL module with no Vite types: exit 0);
  `src/` already depends on Vite at `decode.ts`'s `?worker&inline` import. Recorded where
  the constraint lives: the `examples/vite-env.d.ts` comment and a dated note in
  `.scratch/phase-1-foundation/issues/04-foundation-cluster.md`.

**Owner ruling, Stop 10 — boot-order race (2026-09-17): A.**
- The backend awaits the renderer's own init promise before reading device limits, on BOTH
  load paths (three's `renderer.init()` returns the same promise once started —
  `Renderer.js:767-773`); a failed init fails the handle by name.
- Evidence at the stop (browser pane, dev server, hero loaded right after constructing the
  scene, as the pin's SiteRuntime does): WebGPU `onError rad-needs-renderer "WebGPU device
  limits unavailable — was the renderer initialized?"` at 9.2 ms and 6.1 ms (2 of 2); forced
  WebGL2 initialized first both times (scene ready at 20.2 / 21.8 ms) — timing luck, not
  design.
- The same fix closes the PLY path's SILENTLY SKIPPED WebGPU capacity pre-check, found by
  reading at the stop (`ThreeGsBackend.ts:1225-1238`: a missing limit skips
  `assertStorageWithinLimit` without a word — the silent case ticket 04's guard exists to
  prevent). It is named in the fix's evidence.
- Cost accepted by the owner and non-negotiable: loader-lab, pager-lab and splat-lab re-run
  on both backends after the change.
- Note on the stop's WebGL2 runs: they then neither revealed nor failed within 20 s because
  the pane was hidden (`visibilityState: "hidden"`, `rafFramesIn1s: 0` — a paint-observed
  reveal cannot fire); a control that awaited `ready` first timed out identically, so that
  was not the race.
- REJECTED: B (SiteRuntime waits for `ready` — `loadedScenes` is empty when
  `createSiteRuntime` returns, which pin consumers read, e.g.
  `fd67153:examples/embed/frame.html:52`; every other backend consumer must remember the
  same wait, as loader-lab does by hand at `main.ts:325`, so the trap stays armed).

**Owner ruling, Stop 11 — WebGL2 through the element (2026-09-17): A.**
- The fixture hides `navigator.gpu` before boot and asserts, via the runtime handle, the
  backend it got. Zero product surface; the element stays byte-identical.
- Evidence at the stop (no painting needed): control → `sceneBackend "webgpu"`,
  `isWebGPUBackend true`; `navigator.gpu` hidden first → `sceneBackend "webgl2-fallback"`,
  `isWebGLBackend true`, `hasGlContext true`, and three's
  `THREE.WebGPURenderer: WebGPU is not available, running under WebGL2 backend.`
- **Deliberately DIFFERENT coverage, not a substitute.** This exercises three's AUTOMATIC
  fallback — the backend swapped inside `init`, the exact path a WebGPU-less visitor takes —
  which no earlier fixture covered: every earlier fixture forced WebGL2 at CONSTRUCTION
  (`forceWebGL` via `?webgl=1`). Construction-time forcing stays covered by those fixtures.
- REJECTED: B (`SiteRuntimeOptions.forceWebGL` — the element cannot pass it); C (a site.json
  renderer setting — authorable product surface); D (a test-only global in production code).

**Owner ruling, Stop 2 — SplatHighlight (2026-09-17): A with A1.**
- An INERT stub at `src/interact/SplatHighlight.ts` with the pin's exact API
  (`HighlightItem`, `SplatHighlightConfig`, constructor, `setItems`, `update`, `setEnabled`,
  `activeId`, `dispose` — `fd67153:src/interact/SplatHighlight.ts`), no glow; one named
  note in author mode; doc 06 entry D27 carrying the Phase 3 delete-and-replace obligation
  (D19's pattern).
- A1 over A2 on S5's own test: a warning that fires on every normal visitor load is a
  broken warning; the missing glow is announced where the person who can act on it — the
  author — lives.
- Evidence: the pin file value-imports Spark (`SplatEdit`, `SplatEditRgbaBlendMode`,
  `SplatEditSdf`, `SplatEditSdfType`, :10-15); SiteRuntime constructs it unconditionally
  (:3192), calls `setItems` (:3225), `update` every frame (:3403), `dispose` (:4325), and
  exposes it on the handle (:282); the glow is visitor-facing and authored
  (`SiteAnnotation.radius` / `.highlight`, edited in `hotspotInspector.ts:45`, :143-147).
- REJECTED: B (D19-exact throwing stub — SiteRuntime constructs it unconditionally, so it
  kills every boot: D19's pattern applied without D19's conditions); C (drop it from
  SiteRuntime — the handle type diverges now and SiteRuntime churns again in Phase 3).
- The pin API carries no author flag, so the author-mode note is printed by SiteRuntime,
  which knows the mode; the stub itself stays silent. The note's trigger goes to the owner
  for confirmation before SiteRuntime is built.

**Build — Stop 10 (2026-09-17).**
- `src/backend/ThreeGsBackend.ts`: new private `awaitRendererInit(state)`. It awaits the
  renderer's own `init()` promise when the renderer has one; a rejection fails the handle
  `renderer-init-failed` (message carries the cause); a dispose during the wait lands as
  `handle-disposed`; a renderer without `init()` is unchanged. Called (a) at the START of
  `runRadPipeline`, before RadPager is built — the page budget reads device limits inside
  RadPager's SYNCHRONOUS `onHeader` hook (`RadPager.ts:187`), so the header fetch is the
  last point that precedes the read, and RadPager's hook contract stays untouched; (b) in
  `runPlyPipeline` immediately before the capacity pre-check's limit read, so PLY fetch
  timing is unchanged.
- Four drills added to `examples/loader-lab/`, proven red first on the unfixed backend
  (sha256 `e359dac5…`; for the WebGL2 red run the unfixed file was restored byte-identically
  from backup, and the fixed file `1f34bbaa…` was restored and hash-verified before every
  green run):
  - `ply-limit-read-waits-for-renderer-init` — a renderer stand-in whose device appears only
    when the drill resolves init; every `backend.device` read records whether init had
    completed; a 1-byte stand-in limit (any value below the fixture's storage need) makes the
    pre-check's run visible. RED (WebGPU): `init() calls=0; while init pending:
    phase=constructing, device-limit reads=1; after init: reads=1 (init complete at each:
    [false]); onError=[]` — **the silently skipped PLY capacity pre-check found by reading at
    the stop, shown live.** GREEN: `init() calls=1; while init pending: phase=constructing,
    device-limit reads=0; after init: reads=1 (init complete at each: [true]);
    onError=["over-capacity"]`.
  - `ply-renderer-init-failure-named` — RED `onError=[], onLoad=0, seam phase=constructing`;
    GREEN `onError=["renderer-init-failed"], onLoad=0, seam phase=failed`.
  - `rad-load-before-renderer-init-derives-budget` — a REAL `WebGPURenderer` nobody
    initialized; chunk ranges are refused, so reaching `no-pages-available` proves the budget
    was derived. RED WebGPU `renderer initialized at load=false;
    onError=["rad-needs-renderer"]; budget: pagerDiagnostics threw not-paged`; RED WebGL2
    `onError=["rad-pipeline-failed"]` (finding below). GREEN WebGPU default `renderer
    initialized at load=false; onError=["no-pages-available"]; budget: 122 pages — device
    limit (bind 128 MiB / buf 256 MiB)`; WebGL2 default `122 pages — device limit
    (MAX_TEXTURE_SIZE 16384)`.
  - `rad-renderer-init-failure-named` — RED `onError=["rad-needs-renderer"], fetches issued=1,
    seam phase=failed`; GREEN `onError=["renderer-init-failed"], fetches issued=0, seam
    phase=failed` (the header request itself waits).
  - Both red runs (WebGPU default, WebGL2 default): all four FAIL; every check that ran
    before them PASS.
- **Regression re-runs on the fixed backend (owner-mandated cost; in-app browser pane, dev
  server, WebGPU adapter probed non-null on a real page, one run at a time):**
  - loader-lab **35 passed, 0 failed** in all four regimes (31 prior + 4 new): WebGPU
    default, WebGPU `?pages=32`, WebGL2 default, WebGL2 `?pages=32`; each
    `no-unhandled-rejections: 0`.
  - splat-lab **28 passed, 0 failed** on WebGPU and on WebGL2.
  - pager-lab **26 passed, 0 failed** on WebGPU default (`dispose-cycles-gpu-flat-with-sh:
    cycle 0: heap 2917384501, storage 10/799571968B, textures 0/0B; cycle 1: … storage
    10/799571968B …` — the ticket-08 figure) and on WebGL2 `?pages=32`
    (`budget … "source":"override (32)","backend":"webgl2-fallback"`;
    `dispose-cycles-gpu-flat-with-sh: cycle 0: heap 1035753818, storage 0/0B, textures
    52/173801472B; cycle 1: … textures 52/173801472B …`).
- **Finding while proving red — NOT changed (outside the ruling), recorded for the owner:**
  on the WebGL2 fallback three sets `WebGLBackend.gl = null` before init
  (`WebGLBackend.js:110`), but `derivePageBudget`'s named guard tests `gl === undefined`, so
  an uninitialized WebGL2 renderer died as the generic `rad-pipeline-failed: rad pipeline
  failed — Cannot read properties of null (reading 'getParameter')` instead of the named
  `rad-needs-renderer`. The Stop 10 wait makes this unreachable for a three renderer (init
  sets `gl`).

**Landed — Stop 1, Stop 2 and Stop 9 pieces (2026-09-17; SHAs hashed on the destination):**
- `src/embed/diagWiring.stub.ts` `fcd0a4e7fd5f7de866f87cd3891c0e139e03fda2ea600ebc97952004d67490b2`
  — byte-identical to `fd67153:src/embed/diagWiring.stub.ts` (same sha256 on the pin blob).
- `src/embed/diagWiring.ts` `3cfaa0b48f7aff5607373f1f96fefd10313459cedef834a8bacaf47b7a9abf29`
  — `diff` against the pin blob (`0ebd0a24…`) shows exactly one line, 19:
  `import type { SplatHandle as SplatMesh } from "../backend/SplatBackend";` (keeps the
  file's own `SplatMesh` name, so no other line moves). The pin's telemetry barrel block
  (`fd67153:src/index.ts:119-132`) is copied verbatim into `src/index.ts` before
  `LoadCoordinator`; the deferred-sources header drops diagWiring (12 of the original 13
  remain). The `TELEMETRY_MEASURE=off` alias is in `vite.config.ts` and
  `vite.embed.config.ts` in the pin's form.
- `src/interact/SplatHighlight.ts` `9816c303d117e403aa2c87a9ee27d129aee5577c49b1dceaf00b6c1d898ddb67`
  — inert D27 stub; its lines 21-44 are byte-identical to
  `fd67153:src/interact/SplatHighlight.ts:20-43` (`cmp` clean: `HighlightItem`,
  `SplatHighlightConfig`); the class keeps the pin's public members (constructor,
  `setItems`, `update`, `setEnabled`, `activeId`, `dispose`) and does nothing.
- `src/backend/decode-url.ts` `d4bc2516840efcdee1803866cae3cf1c05f14bbb275027d70d7bb9095844cce8`
  — the URL-constructed default, same exports as `decode.ts`. Dev proof: a backend given
  this factory on a fresh WebGPU renderer created 4 workers and decoded and uploaded the
  hero's first 4 pages in 586 ms (`decodedTerm 0.0328, firstUploaded 4`, no error). The
  embed-config swap lands with the embed-entry switch, where it can be measured.
- Gate pieces on this tree: `tsc --noEmit` EXIT=0; dependency-cruiser `no dependency
  violations found (166 modules, 512 dependencies cruised)`. Full `check:full` runs at close.

**Owner rulings at the third stop (2026-09-17).**
- **Stop 2 note trigger CONFIRMED:** one note per runtime, author mode only, the first time
  the highlight receives a non-empty marker list.
- **WebGL2 budget guard — FIX:** `derivePageBudget`'s check becomes `gl == null`, covering
  both `undefined` and three's `null`-before-init, so an uninitialized WebGL2 renderer refuses
  as `rad-needs-renderer`, not a TypeError. Corrected for the named-refusal contract, NOT for a
  live path: Stop 10 makes it unreachable in normal flow. Pinned by a unit-level probe, not a
  browser drill.
- **Stop 4 — SparkScene-only members, all as recommended:**
  - 4a `pagedExtSplats: true` (pin :839) DELETED — D24's zero-consumer evidence
    (`SparkSceneConfig` is written down by no consumer).
  - 4b `sparkRenderer: sparkScene.spark` (:900) DELETED — ticket 10's own ruling (optional,
    deprecated, ignored); `renderer` stays.
  - 4c telemetry `renderer: sparkScene.spark` (:2392) — nothing to rule; it sits inside the
    registration A2 skips.
  - 4d `registerPagedSplat` (:2386) DELETED — its body only feeds Spark's `tickPagerFix`
    (pager wiring + fetcher kick-start, pin `SparkScene.ts:271-275`, :323+); our pager fetches
    the whole file by design.
  - 4e rail DoF (:887-892) — the Spark optics writes are SKIPPED, `fov` still applies, ONE
    author-mode note the first time a stop asks for aperture > 0 (`onOptics` fires every travel
    frame, `CameraRail.ts:834-841`, and `setOptics` refuses until Phase 5). Phase 5 owns optics.
  - **4f docked-idle throttle — T1**, its limitation RECORDED as a declared divergence (doc 06
    D29): `ThreeSplatScene` carries the pin's `throttleGate` plus read-only `renderCount` /
    `throttled` (pin `SparkScene.ts:279-319`); SiteRuntime's refinement guard reads the seam — a
    paged scene is still refining while `progress().fraction < 1`. Under a constrained page
    budget the paged fraction never reaches 1 (0.5082 under `?pages=32`, ticket 06), so capped
    sites never throttle: more conservative than the pin, never refinement-starving, zero
    constants. REVISIT OWNER: ticket 12 (it owns the diagnostics door T2's signal would need)
    notes it; ticket 13's idle-power / H-LOAD evidence decides whether T2's seam signal is ever
    warranted. T4 REJECTED BY NAME: a gate without the refinement guard is the pin's own
    documented bug (`:3433-3443` — "the whole post-reveal detail tail crawls at 10fps").
- **Stop 5 — multi-scene progress: P1.** Site progress is the slowest scene across ALL scenes
  (a revealed scene counts 1), reported only when it rises, exactly one 1 at the last reveal;
  ready stays pin-identical (every scene revealed → loading hidden → 1 →
  `markAllScenesVisible` → `settleReady`, pin :2596-2605). The two pin quirks are deliberately
  NOT reproduced (declared divergences, doc 06 D29): (a) idle 1-spam on sites with no paged
  scene — the report loop skips non-paged scenes, so `overall` stays 1 and is reported every
  80 ms before ready (pin :2585-2594); (b) the double 1 — when the last scene reveals, the
  throttled report can send 1 and the ready branch sends 1 again (pin :2585-2599).
  `markSceneFirstSplatReady` (:2518) joins ticket 12's inherited note (real telemetry ignores
  unregistered scenes, pin `diagWiring.ts:245-246`, and A2 registers none).
- **Stop 8 — tint: R1 + K2.** White tints skip silently (a no-op by value); a non-white tint
  skips with ONE author-mode note; Phase 4's `setMeshColor` owns the real tint. K2 narrows the
  pin's `.catch(() => {})` after `whenFontsReady(...).then(...)` (:3365-3375) to the font
  promise's own rejection — a declared divergence in failure VISIBILITY only. Grounds: the
  pin's catch-all is exactly the mechanism that would have swallowed the tint loss.
- **Stop 12 — handle naming: N2.** Keep the names, re-type honestly: `sparkScene:
  ThreeSplatScene`; `LoadedScene.mesh` is the handle's `Object3D`; a new `handle: SplatHandle`
  beside them. Doc 06 D28 cites D12 and the EnvironmentLoader precedent, and corrects that
  precedent's stale reason in passing (the pin's SiteRuntime never constructs EnvironmentLoader
  — corrected in `src/core/EnvironmentLoader.ts`'s header and phase-1 ticket 08's Comments).
  `LoadedScene.paged` derives from the file format; an authored `def.paged` is passed through,
  accepted and warned per S5 when it contradicts.

**Build — WebGL2 budget guard (2026-09-17).** `ThreeGsBackend.derivePageBudget`: `gl ===
undefined` → `gl == null`, with the note that Stop 10 makes it unreachable in normal flow
(ThreeGsBackend.ts sha256 now `164f0a6a…`). Unit-level probe
(`.collab-logs/t09-webgl-guard-probe.ts`, sha256 `9ce3ac72…`): the repo's real ThreeGsBackend
bundled with esbuild (three external) and run in Node, calling `derivePageBudget` directly with
a stand-in WebGL2 backend. RED on the unfixed guard (exit 1):
`gl === null (three's WebGLBackend before init): TypeError — Cannot read properties of null
(reading 'getParameter')` · `gl absent (undefined): SplatBackendError(rad-needs-renderer) — WebGL2
backend exposes no gl context for MAX_TEXTURE_SIZE`. GREEN after (exit 0): both lines
`SplatBackendError(rad-needs-renderer) — …`; `probe RESULT: both refuse by name
(rad-needs-renderer)`. tsc EXIT=0.

**Build — the embed set and the re-typed SiteRuntime (2026-09-17). NOT yet runtime-proven:
Stop 3 is open, and the two compile errors it owns are deliberately left in place.**
- Pin copies, sha256 hashed on the destination, each equal to the pin blob:
  `src/embed/SplatSiteElement.ts` `773a619b93e0b546da616102c34dd4fa0e719dd4d4ea75f3bb93f3ff09c014ef`,
  `src/embed/FragmentRouter.ts` `770abf78f5dba7088d9461d1e61e38ca56fbd6d6eb3cec19f1371affae8b7f67`,
  `src/embed/register.ts` `eaf181afc553e83ee11d6f21202f0fdb395a9f8b6607b10cda534208e56f5dcc`.
- `src/embed/SiteRuntime.ts` (interim sha256 `02ddcc09…`): the pin blob plus 19 ruled edits,
  each an exact, count-asserted byte replacement — header; imports (D24 rename, loader, seam,
  `decode-url`); `LoadedScene` and the handle's `sparkScene` type (D28); a one-note-per-runtime
  `authorNote` helper (author mode only, `console.warn("[SiteRuntime] …")`) plus the DoF focal
  constant it orphaned; the `SparkOptics` type it orphaned; `ThreeSplatScene` + `ThreeGsBackend`
  construction (4a); rail optics (4e); CameraSystem `sparkRenderer` (4b); the scene loop (D25,
  paged from the format, S5 passthrough, A2 note, 4d); the reveal gate → site progress + ready
  (Stop 5); the highlight note (Stop 2); tint (Stop 8 R1); the boot catch (K2); the frame loop's
  gate poll; the throttle comment and `lodStillRefining` (4f); teardown through
  `splatBackend.dispose`.
- `src/core/ThreeSplatScene.ts`: `throttleGate` / `renderCount` / `throttled` carried (4f).
  Regression: camera-lab reproduces ticket 10's baselines exactly, 6 passed each — WebGPU
  `CAPTURE backend=webgpu sha256=444a093df755f516b7ae7c69e27d330f6c3f52a540ddfa705f10c244188ae659`,
  WebGL2 `CAPTURE backend=webgl2-fallback sha256=bc514b236e53f2380e9981f8a6e96be3b1b9379153bea43085faeb46f896e764`.
- `tsc --noEmit` on this tree reports exactly the two Stop 3 errors —
  `src/embed/SiteRuntime.ts(103,36): error TS2307: Cannot find module '../core/SplatBounds'` and
  `src/embed/SiteRuntime.ts(3674,66): error TS2304: Cannot find name 'SplatMesh'`. The
  byte-identical element, router and register compile against the re-typed runtime.

**Owner rulings at the fourth stop (2026-09-17).**
- **Stop 3 — SplatBounds: A.** A typed stub at `src/core/SplatBounds.ts` with the pin's API
  (`SplatBoundsOptions` verbatim, `computeSplatBounds` with the mesh parameter widened),
  returning `null` — the pin's own documented no-bounds outcome (`fd67153:src/core/SplatBounds.ts:12-14`)
  — on a branch nothing can reach until Phase 4's splat text exists (`sphereFromObject` is called
  only for props, pin :3860, and world-text surfaces, :3874; the `isSplatMesh` duck-type is never
  true of the vendored mesh, which sets `isGaussianSplatMesh`, `GaussianSplatMesh.js:121`; D19's
  throwing SplatTextMesh stub keeps splat text from existing). Doc 06 entry carries ticket 11's
  delete-and-replace obligation, citing the D19/D27 pattern. SiteRuntime's lost
  `as unknown as SplatMesh` cast joins this ticket's edit inventory.
- **Stop 7 — author picking: P-A.** The backend neutralizes three's stock raycast on its own
  splat meshes — no hits until Phase 3 §B lands real picking behind `backend.raycast` — plus ONE
  author-mode note at the first `pickPoint`. Fixed where the wrong answer is produced (same
  grounds as Stop 10). Evidence at the stop (browser, camera 3 units from the origin, 9 rays, both
  backends): `ply: counts {total 48} rays 9, hits 10`; `rad: counts {total 7935358} rays 9,
  hits 10`; control box 2 hits; per-hit `obj GaussianSplatMesh … ndc [-0.5,0.5] → point
  [-1.155,0.866,0]` while the PLY's splat bounds are `[-3.225,-0.225,0]..[3.225,0.225,0]`;
  geometry `InstancedBufferGeometry, position count 4, index 6, bbox [-2,-2,0]..[2,2,0]` — three's
  stock raycast ignores instancing and tests the one template quad at each mesh's origin, so the
  pin's `pickPoint` (first hit past the fuzz, :3510) returned PHANTOM points to the hotspot, box
  and prop inspectors. Red-first drill: a ray through the origin hits before the fix, not after.
- **Phase 0 record correction (owner-ordered with Stop 7):** `docs/plan/results/phase-0.md`'s
  free-extra 1 ("Raycast absence: CONFIRMED empirically … 9 rays → 0 hits") gets a dated note —
  the claim held only for rays that MISS the 4-vertex placeholder quad at a mesh's origin; rays
  through it hit. The CONFIRMED status narrows to that scope. Its own small commit, like the
  earlier record fixes.
- **Stop 13 — barrel: B-A.** The pin's three embed blocks (`fd67153:src/index.ts:84-117`) return
  verbatim; the deferred-sources header keeps StatsHUD + SplatBounds (ticket 11) and the Phase 3/4
  names. Scratch evidence at the stop (current repo src + a throwaway SplatBounds stand-in): tsc
  EXIT=0 and dependency-cruiser `no dependency violations found (154 modules, 501 dependencies
  cruised)`; the mutation (SiteRuntime importing `../backend/decode` instead of `decode-url`) fires
  `error lib-barrel-must-not-reach-inline-worker: src/index.ts → src/backend/decode.ts`, EXIT=1 —
  to be re-proven once on the real tree before commit. The library bundle's growth is MEASURED and
  recorded as ticket 13 baseline material, not a decision here.
- **Stop 15 — obstacle outlines: L-A**, on the terms offered: proven in the REAL fixture with a
  clean module graph, red first (the classic `THREE.NodeBuilder: Material "LineMaterial" is not
  compatible.` on both backends), green = no error plus outline pixels present. If three's WebGPU
  line pair fails for real, it returns as a stop with the evidence; L-B (plain `LineSegments` +
  `LineBasicMaterial`, 1 px) is the NAMED alternative, never a silent substitution.
- **Standing requirement (owner, across the ticket):** the backend has been touched twice (Stop 10,
  Stop 7 P-A), so loader-lab, pager-lab and splat-lab re-run once more on the FINAL tree, both
  backends, before the commit — the post-Stop-10 runs do not cover P-A.

**Build — Stops 3, 7, 13 (2026-09-17).**
- **Stop 3:** `src/core/SplatBounds.ts` (sha256
  `e3f9f1e1407ee5aa1d4b66750a88d8142b42f8806099dbd2d49db690fa0efa48`) — D30 stub;
  `SplatBoundsOptions` copied byte-identically from the pin's lines 25-32, `computeSplatBounds`
  widened to `THREE.Object3D` and returning `null`. SiteRuntime's `as unknown as SplatMesh` cast is
  gone (the 20th ruled edit). `tsc --noEmit` EXIT=0 — the tree compiles for the first time.
- **Stop 7:** `ThreeGsBackend.refuseStockRaycast(mesh)` sets `mesh.raycast = () => {}` on BOTH
  paths (after `installSelectionSort` for the paged mesh, after construction for PLY); SiteRuntime's
  `pickPoint` prints the author-mode note (the 21st edit). Other raycast users checked while
  ruling: `TextSystem` raycasts only its own world surfaces (`TextSystem.ts:823`), and
  `CameraSystem` never raycasts the scene — its splat pick is dead since Phase 1 and it takes the
  view-plane fallback (`CameraSystem.ts:762-788`), so today the phantom hits reached only the
  author picker. New loader-lab drill `splat-meshes-answer-no-raycast-hits` (9 rays per object
  through the origin, both formats, with a plain-box control that must be hit; no paint needed).
  RED on the unfixed backend (WebGPU default): `ply: mesh attached=true, hits=12; rad: mesh
  attached=true, hits=12; plain-box control hits=2`. GREEN after: `ply: … hits=0; rad: … hits=0;
  plain-box control hits=2` — loader-lab **36 passed, 0 failed** (WebGPU default).
- **Stop 13:** the pin's three embed blocks (`fd67153:src/index.ts:84-117`, 34 lines) inserted
  verbatim before the diagnostics section; deferred-sources header now 9 of the original 13.
  `src/index.ts` sha256 `00e45244d06c482f1db52c5155d401fc0e4684d94d6a0ea056789c533af6335a`. On the
  REAL tree: `tsc` EXIT=0 and dependency-cruiser `no dependency violations found (174 modules, 569
  dependencies cruised)`; the guard's teeth re-proven here — mutating SiteRuntime's import to
  `../backend/decode` gives `error lib-barrel-must-not-reach-inline-worker: src/index.ts →
  src/backend/decode.ts` (EXIT=1), and the restored file is byte-identical (sha256 `b39cf0b5…`)
  with the lint green again.
- **Library bundle measured for ticket 13 (not a decision here):** `npm run build:lib`
  `dist-lib/threejs-toolkit.js` **721,358 B before the barrel restore → 929,227 B after**
  (+207,869 B, +28.8%), plus a separate `dist-lib/assets/rad-worker-CuUp7t4N.js` at **213.20 kB** —
  the URL-constructed worker Stop 9 intends for library consumers, emitted as its own file rather
  than inlined. Observed in the same build (recorded, not acted on): Rollup warns that
  `EditorialRegionEditor`, `AuthorPanel` and `AuthorGizmo` are dynamically imported by SiteRuntime
  but statically exported by the barrel, so the author-UI chunks cannot split out of the library
  bundle.

**Owner rulings at the fifth stop (2026-09-17).**
- **Stop 16 — H-LIFE at runtime scope: H1, hardened.** Counters are read on the runtime's OWN
  renderer, synchronously after `dispose()` returns — the window in which the backend has freed
  its buffers and the renderer's own teardown (which RESETS `info`, three `Renderer.js:2533-2545`)
  is still a microtask away. The drill must ASSERT that window rather than lean on it, and fail
  loudly if the ordering ever changes. Ticket 13 keeps the element-level H-LIFE ×10 unchanged.
- **Stop 14 — element event proof: E1 then E3.** The evidence of record is the LIVE two-sided run
  (event types, order, payload shapes; values compared only where D29 does not sanction
  divergence; both raw streams quoted verbatim). The recorded pin sequence is then stored as a
  dated fixture file with provenance (commit `fd67153`, capture date, the exact site.json),
  labelled a repeat-run convenience and never the evidence of record. The sparkjs side is a
  `git archive` export plus a `node_modules` junction, read-only, sparkjs untouched — with the
  versions-match precondition already checked: the pin's `package.json` asks for
  `@sparkjsdev/spark 2.1.0` and `three ^0.180.0`, and the installed tree has spark 2.1.0 and
  three 0.180.0.
- **Stop 17 — H-API consumer fixture: C1.** One consumer file, two scratch tsconfigs, two
  variants: the shared-surface variant must compile against BOTH toolkits, and the scene-naming
  variant must FAIL here and compile at the pin, recording D24's predicted divergence as a measured
  outcome. Both tsc outputs quoted. CORRECTED 2026-09-17 (review finding 5, owner): this ruling block
  as first recorded said "compile here and FAIL there" — the reversal was in the ruling block itself;
  the fixture was built correctly per D24.
- **Stop 6 — no advance ruling:** report the measured warning count.

**Build — `examples/site-lab/` (2026-09-17).** The production runtime driving real site.json
files. `?webgl=1` hides `navigator.gpu` in the page BEFORE any toolkit module loads (ruling
Stop 11), so three's own fallback selects WebGL2 inside `renderer.init()` — proven by the run's
own first line. Frames are pumped explicitly at a fixed step (reveal is paint-observed and a
hidden pane runs no animation frames); waits are time-bounded and timer-free.
- Fixture sites: `lab.site.json` and `lm-lifetime.site.json` are the PIN's own portfolio sites
  (`fd67153:examples/portfolio/…`) with exactly one line changed — the scene URL repointed at the
  hero through `/@fs`, a path BOTH dev servers serve (ours by `vite.config.ts` `fs.allow`,
  sparkjs's because it is inside its own root), so one identical file can drive both toolkits in
  Stop 14. `diff` against the pin shows that single line. The four throw/control sites and
  `obstacle.site.json` are ours, minimal, named for what they prove.
- **Results — 11 passed, 0 failed on BOTH backends** (WebGPU, and WebGL2 through the
  `navigator.gpu` route). Quoted from the runs:
  - `latent-throw-annotation-copy-block-id: authored block "annotation-marker-copy" → "SiteConfig:
    block id "annotation-marker-copy" is reserved for annotation "marker"'s floating copy (the
    toolkit conjures that box at activation) — rename the block"; control (block "marker-notes",
    same site otherwise) → ok` (AC2).
  - `latent-throw-duplicate-show-blocks: … → "SiteConfig: annotation "marker" rule 1 has two
    show-blocks effects naming exactly the same blocks — the second would close what the first
    opened; one effect shows them together"; control (one effect) → ok` (AC3).
  - `real-site-ready: backend=webgpu (expected webgpu); ready in 3010 ms:
    {"name":"portfolio-lab-p0-scaffold","initialStop":{"index":0,"id":"overview","label":"Overview"},"stopCount":3};
    scenes=1 paged=true visible=true; onLoadError=0` · WebGL2: `backend=webgl2-fallback (expected
    webgl2-fallback); ready in 2637 ms` (AC1 load; Stop 11's route).
  - `site-progress-contract: 2 report(s) [0.3388, 1.0000]; strictly rising below 1=true; exactly
    one 1 and it is last=true` on both backends (ruling Stop 5, P1).
  - **Stop 6 ANSWERED:** `s5-warning-noise-on-the-real-site: 0 contract warning(s) across the
    whole load: []` on both backends — the pin's own site authors `paged: true` + `extSplats:
    true`, which the format agrees with, so the S5 warning never fires on a normal load.
  - `navigation-announces-arrival: goToStop(2) → stopchanged {"index":2,"id":"shelf","label":"The
    shelf"}; rail currentStop=2; motionState=idle; stopIndexById("workbench")=1` (AC1 navigation).
  - **Stop 16 H1:** `teardown-frees-through-the-seam: measuring window open (renderer not yet
    disposed)=true; baseline storage 0/0B, attributes 0, geometries 0, textures 0/0B → loaded
    storage 10/799571968B, attributes 1, geometries 1, textures 0/0B → after dispose storage
    0/0B, attributes 0, geometries 0, textures 0/0B; grew=true back to baseline=true;
    backend.dispose calls=1 for 1 scene handle(s)=true; canvas attached true → false; mesh
    children 1 → 0` (WebGPU); WebGL2 the same shape with `textures 6/639631360B` when loaded.
    The window is asserted, not assumed: the fixture wraps the runtime's `renderer.dispose` and
    the drill fails if that flag is set when the counters are read.
  - `runtime-h-life-10-cycles: every cycle's renderer back to its pre-load counters (window open
    each time)=true [1111111111]; heaps=[…] strictly increasing=false` on both backends (AC1
    H-LIFE at runtime scope).
  - **AC4:** `authored-lifetime-runs-under-the-runtime: 8 of 8 annotation markers found by label;
    activating them showed poster=true keepsake=true; after travelling to stop 1 — poster
    (lifetime until travel) mounted=false, keepsake (until dismiss, the control) mounted=true` on
    both backends. The keepsake is the control that tells "lifetime honoured" apart from "travel
    cleared everything" — the trap ticket 01 closed.
  - **Stop 15, red first on BOTH backends then green:** RED (the pin's classic pair restored
    byte-for-byte for the run) `1 outline object(s), material LineMaterial; "not compatible"
    errors while rendering=1 ["THREE.NodeBuilder: Material "LineMaterial" is not compatible."];
    removing the outline changes 27 of 527 sampled pixels` (WebGPU) and `… changes 266 of 527
    sampled pixels` (WebGL2 — the substituted node material floods the frame). GREEN
    `material Line2NodeMaterial; "not compatible" errors while rendering=0 []; removing the
    outline changes 27 of 527 (WebGPU) / 10 of 527 (WebGL2) sampled pixels, at the authored colour
    [74,222,128]`. The classic-pair file was restored from backup and hash-verified
    (`a114327a…`) before the green runs.
  - `no-unhandled-rejections: 0` on both backends.
**AC5 — the element's events vs sparkjs (2026-09-17; ruling Stop 14, E1 then E3).**
- Method: ONE harness file (`examples/site-lab/element.ts`) run unchanged on both toolkits — it
  imports only `defineSplatSite` from `@toolkit/index`, an alias both repos define, and drives the
  element through its public attribute/command API. The sparkjs side is a `git archive fd67153`
  export plus a `node_modules` junction (read-only; sparkjs untouched, `git status` unchanged
  throughout), served by a HARNESS-ONLY config added beside the export, which stays byte-identical.
  Versions-match precondition (checked before the run): the pin's `package.json` asks for
  `@sparkjsdev/spark 2.1.0` and `three ^0.180.0`; the junctioned tree has spark 2.1.0, three
  0.180.0. Both sides load the SAME `sites/lab.site.json` (sha256 equal on both, verified).
- **Harness finding, recorded:** the snapshot first lived in the session scratchpad on C: and its
  dev server 404'd the hero at `/@fs/D:/…` while serving its own C: paths — vite's raw-fs
  middleware does not serve across drives (measured both ways). The snapshot moved to
  `.collab-logs/sparkjs-pin` (gitignored, on D:) and the hero then served 206.
- **LIVE two-sided run — the evidence of record.**
  - sparkjs (pin, `http://localhost:5180`): sequence `loadstart, loadprogress ×23, ready,
    stopchanged`; shapes `{loadstart:"{loadId:number,src:string}", loadprogress:"{progress:number}",
    ready:"{initialStop:object,loadId:number,name:string,src:string,stopCount:number}",
    stopchanged:"{id:string,index:number,label:string}"}`; ready `{loadId:1,
    name:"portfolio-lab-p0-scaffold", initialStop:{index:0,id:"overview",label:"Overview"},
    stopCount:3}`; stopchanged `[{index:2,id:"shelf",label:"The shelf"}]`; loadprogress 23 values,
    monotone, first 0, last 1, **two of them 1**.
  - ours (`http://localhost:5173`, WebGPU): sequence `loadstart, loadprogress ×2, ready,
    stopchanged`; the SAME shapes; the SAME ready and stopchanged values (only `src` differs, being
    each side's own origin); loadprogress `[0.3388, 1]` — one 1.
  - **The pin's DOUBLE 1 is now measured, not just read** (doc 06 D29 item 2 predicted it from
    `:2585-2599`): the throttled report and the ready branch both send 1.
- **Checks (the same five run on BOTH sides, comparing only what the rulings sanction):** event
  types in order, payload shapes, ready payload (minus origin-dependent `src`), stopchanged
  payload, and loadprogress monotone ending at 1 with values NOT compared. Results:
  **ours WebGPU 5 passed 0 failed · ours WebGL2 5/5 (`[0.3388, 1]`, ready in 1602 ms) · the pin
  itself 5/5** (22 loadprogress reports that run against 23 recorded — the count varies per run,
  which is exactly why counts are not compared).
- **E3:** `examples/site-lab/pin-element-events.json` stores the pin sequence with provenance
  (commit `fd67153`, captured 2026-09-17, the exact site.json and how it was served) and is
  labelled in the file itself as a repeat-run CONVENIENCE, never the evidence of record.

**AC6 — the H-API consumer fixture (ruling Stop 17, C1).** One consumer file compiled against both
toolkits with two scratch tsconfigs differing only in where `@toolkit/*` points; each program
includes that toolkit's own ambient `css.d.ts` (the first attempt omitted it and failed identically
on both sides — a harness artifact, fixed, not a result).
- `examples/h-api/shared-surface.ts` — boots the element and runtime, routes through
  `parseFragment`/`formatFragment`, and reads the two members D28 re-typed but did not rename
  (`handle.sparkScene.scene.children`, `LoadedScene.mesh.position`, `.visible`):
  `shared surface vs THIS toolkit: tsc EXIT=0` · `shared surface vs sparkjs pin fd67153: tsc EXIT=0`.
- `examples/h-api/scene-naming.ts` — names the scene by module path, as all 16 pin consumers do:
  `scene naming vs THIS toolkit: tsc EXIT=2` with
  `examples/h-api/scene-naming.ts(15,28): error TS2307: Cannot find module '@toolkit/core/SparkScene'
  or its corresponding type declarations.` · `scene naming vs sparkjs pin fd67153: tsc EXIT=0`.
  **That failing compile is D24's predicted divergence, measured** — the expected result, not a
  defect. `tsconfig.json` excludes this one file from the repo program, with the reason in place.

**The embed entry switch and its MEASUREMENTS (AC8; the bound is the owner's).**
- `vite.embed.config.ts`: entry switched from the decode-only scaffold to `src/embed/register.ts`,
  and the Stop 9 config-time swap added (`../backend/decode-url` → the inline `src/backend/decode.ts`),
  so the product embed carries the worker inline per D14.
- Measured, both builds single-file (`dist-embed/` contains only `embed.js` — D14's
  self-containment holds):
  | build | raw | gzip |
  |---|---:|---:|
  | product embed (telemetry in, the pin's default) | **3,138,621 B** | 806,083 B |
  | `TELEMETRY_MEASURE=off` (the stub selected) | **3,016,389 B** | 774,453 B |
  | difference the diagnostics graph costs | 122,232 B | 31,630 B |
  The switch works as the pin intends: `loadTelemetry:semanticsVersion` is present in the first
  build and absent in the second.
- The tripwire's bound is still **262,144 B** (`scripts/check-embed-size.mjs`), so `npm run check`
  fails on `check:embed-size` until the owner sets a new one. **STOPPED here as the AC requires —
  never raised by an agent.**

**Owner ruling — the embed size bound (2026-09-17): 3,932,160 B (3.75 MiB).**
- Scope: the PRODUCT embed exactly as the gate builds it — telemetry in, the pin's default
  configuration (`npm run build:embed`, `TELEMETRY_MEASURE` unset). That is the build
  `check:embed-size` guards.
- Grounds (the owner's): ~25% headroom over today's 3,138,621 B, matching the original bound's
  ~21% proportion and its binary-round convention. Derived this session: 3,932,160 =
  3.75 × 1,048,576 = 15 × 262,144 (the original 256 KiB unit); 3,932,160 / 3,138,621 = 1.2528
  (793,539 B of slack); the original bound 262,144 / 215,915 = 1.2141.
- Reference anchor, MEASURED (owner ruling on the anchor note, 2026-09-17 — replaces the ruling's
  first "~6 MB → ~52%" grounds, whose figure came from an unmeasured config comment,
  `fd67153:vite.embed.config.ts:37`, "The single file is ~6MB with Three+Spark inlined"): the only
  sibling embed on disk, `../sparkjs-toolkit/dist-embed/splat-site.js`, is 6,954,269 B (built
  2026-08-22 01:24, before the pin's last two commits `c050cc5` 01:39 and `fd67153` 02:14, so not the
  pin's own build), and the sibling's `docs/plans/PROGRESS.md` records "ONE 6.58MB ES file" at its P3
  acceptance → the product embed sits at ~45-48% of reference (3,138,621 / 6,954,269 = 0.451;
  3,138,621 / 6,580,000 = 0.477). The bound stands on the headroom, unchanged.
- **The baseline any future raise is measured against — today's numbers, verbatim:**
  | build | raw | gzip |
  |---|---:|---:|
  | product embed (telemetry in, the pin's default) | 3,138,621 B | 806,083 B |
  | `TELEMETRY_MEASURE=off` (the stub selected) | 3,016,389 B | 774,453 B |
  | difference the diagnostics graph costs | 122,232 B | 31,630 B |
  gzip column method, reproduced this session from the same bytes: Python `gzip.compress(data)`
  at its default level 9 → 806,083 B and 774,453 B exactly (.NET `GZipStream` SmallestSize also
  gives 806,083). Vite's own build report prints the same bytes as `gzip: 806.53 kB` /
  `774.68 kB` (zlib level 6) — compare any future gzip figure like with like.
- Raising the bound again requires an owner ruling recorded in the ticket that raises it (the
  tripwire's own rule, unchanged).

**Build — the tripwire at the ruled bound, drilled (2026-09-17).** `scripts/check-embed-size.mjs`:
`BOUND = 3932160`; header rewritten (the product-embed baseline built telemetry-in, the
15 × 256 KiB derivation, ticket 09 as the ruling's home; the ticket 02/03 history and the raise
rule kept). Plants were built through overlay configs in `.collab-logs/` (`t09-plant-*.config.ts`)
that import the real `vite.embed.config.ts` unchanged — no repo file was edited for the drill.
- P1, ticket 04's precedent plant (embed entry → the library barrel `src/index.ts`): `embed-size
  OK: 3256433 bytes (bound 3932160)`, EXIT=0. **The ticket 03 failure class no longer trips the
  gate:** the product embed already carries nearly the whole library graph, so the barrel adds
  117,812 B (+3.8%).
- P2, a bundle-graph regression (the product entry plus `export * from "three/webgpu"`, defeating
  three's tree-shaking): `embed-size OK: 3462755 bytes (bound 3932160)`, EXIT=0 (+324,134 B,
  +10.3%).
- P3, a build-config regression (`build.minify: false`): `embed-size: D:\Projects\threejs-toolkit\dist-embed\embed.js
  is 4819438 bytes, bound is 3932160`, **EXIT=1 — red.**
- The ruled number itself, on synthetic artifacts: exactly 3,932,160 B → `embed-size OK: 3932160
  bytes (bound 3932160)` EXIT=0; 3,932,161 B → `… is 3932161 bytes, bound is 3932160` EXIT=1.
- Missing artifact → `embed-size: missing artifact … — size tripwire cannot run (a missing
  artifact must fail the gate, never silently pass)` EXIT=1.
- Restored (real config, real build): `embed-size OK: 3138621 bytes (bound 3932160)` EXIT=0; the
  artifact is byte-identical to the one measured before the ruling (sha256 `2f8f7d39…`, `cmp`
  clean against `.collab-logs/t09-embed-with-telemetry.js`), telemetry marker present. The
  `TELEMETRY_MEASURE=off` build re-measured the same way: 3,016,389 B raw, 774,453 B gzip, marker
  absent.
- What the gate catches at this bound, from these numbers: growth above 793,539 B (+25.3%) over
  the product embed. P1's and P2's classes pass under it; P3's class trips it.

**Gate at close (2026-09-17): `npm run check:full` EXIT=0** (true exit, redirected to
`.collab-logs/t09-check-full.log`, code written to `t09-check-full.exit`): build:site built;
build:embed `dist-embed/embed.js 3,138.62 kB`; `embed-size OK: 3138621 bytes (bound 3932160)`;
test:crate `6 passed; 0 failed; 1 ignored`; `tsc --noEmit` no output; lint:boundaries `no dependency
violations found (186 modules, 586 dependencies cruised)`; test:crate:golden `7 passed; 0 failed;
0 ignored` with `decodes_hero_chunk0 ... ok` (`interior nodes in chunk0: 27317`).

**Adversarial review round (2026-09-17 local / 2026-09-18 UTC) — `astra-review` per the v2 registry's
`technical_review` lane order.** Identity from the run's own banner: codex-cli 0.153.3,
`gpt-6-astra`, reasoning effort high, sandbox read-only, approval never, session
`01a0b1fe-a32a-7531-8c9f-71bb60465e5c`. Access class `ordinary_authorized` (the owner's session
instruction); declared read scope this repo plus the pin via `git show`; the residual broad-read
capability was used once — it read its own skill file `C:/Users/alexm/.agents/skills/pocock-code-review/SKILL.md`.
Admission: live `codex app-server` → `account/rateLimits/read` reading 56% of the weekly window
used, no paid credits (`balance "0"`) → remaining 44 ≥ reserve 20 + allowance 5; three
pre-existing codex processes left alone, no rollout written in the prior 10 min. Run
00:50:50Z–00:54:07Z, `EXIT=0`, 80,369 tokens, 15 tool calls, all reads (two Python pin-identity
checks — the first hit git's dubious-ownership refusal under the sandbox user and was retried
with a per-invocation `-c safe.directory`; no config written); **293 repo files hash-identical
before/after**; meter 57% after (a 1-point move; a pre-existing app-server process was alive, so
not strictly attributable). Material `.collab-logs/t09-review-material.diff`, prompt
`t09-review-prompt.md`, output `astra-review-t09.md`, trace `astra-review-t09-err.log`, hashes
`t09-review-hashes-{before,after}.txt`, balance `t09-balance-{before,after}.txt`.
Findings (claims), each re-verified by Claude:
1. HIGH `src/embed/SiteRuntime.ts:2401` — a synchronous load refusal leaks the half-built runtime.
   **CONFIRMED by code trace:** `ThreeGsBackend.load` throws synchronously for `.spz`, `.splat` and
   an unknown extension (`:505-515`, ticket 08's designed on-the-spot refusal); the scene loop
   (`:2393`) runs after the renderer (`:853`), the backend (`:863`), CameraSystem (`:923`), the rail
   DOM and the container listeners exist, with no try/finally; config validation (`:638`, `:649`)
   precedes all of it, so only backend refusals land here; the element's catch
   (`SplatSiteElement.ts:1056-1061`) reports `loaderror` and nulls `runtime` — nothing to dispose.
   Broader than claimed: ONE `.spz`/`.splat` scene suffices; an earlier `.rad` scene's fetch and
   decode continue ownerless; the next boot's `runtime?.dispose()` sees null, so stale canvas and
   nav DOM stack up in the element. Unreachable in the pin (its `loadSplat` has no `throw`; Spark
   fails asynchronously).
2. MED `src/core/ThreeSplatScene.ts:262` — dispose after a failed init fires `unhandledrejection`.
   **CONFIRMED by code trace:** three's `Renderer.dispose()` always ends with an unawaited
   `setAnimationLoop(null)`, which is async and awaits `init()` — the stored rejected `_initPromise`
   after a failed init; the facade's comment ("a documented no-op while uninitialized") is wrong on
   this point. **PRE-EXISTING:** all 22 `dispose()` lines are commit `04378f6` (ticket 03), outside
   this ticket's diff; needs BOTH backends to fail init. The reviewer's "reproduced in memory" was
   not executed (trace).
3. MED `examples/site-lab/main.ts:457` — the Stop 15 drill can pass with the classic material.
   **CONFIRMED as timing-dependent:** three logs `is not compatible` once per render-object build
   (`NodeBuilder.js:3145`, cached after); `rebuildObstacleHelpers` runs when the author modules
   resolve (`SiteRuntime.ts:3842`), independent of reveal; `errorMark` is taken after the ready-wait
   pump, which renders the outline if the author imports resolve before `fixture.ply` reveals — the
   one error then precedes the mark, and the pixel signal is present either way (27 of 527 changed
   in the WebGPU red run). The recorded red runs were genuine; that race was won.
4. MED `examples/site-lab/element.ts:134` — the event comparison drops repetition counts for every
   type. **CONFIRMED by an executed replay** (Claude's; the reviewer's replay was not executed): the
   check logic against the real pin record passes 5/5 on a stream with doubled `loadstart` and
   doubled `ready`; the control (doubled `stopchanged`) fails check 4.
5. LOW this ticket, Stop 17 (the ruling block above) — **CONFIRMED contradiction:** the recorded
   text says the scene-naming variant "must compile here and FAIL there"; the fixture (imports
   `@toolkit/core/SparkScene`), its header and the AC6 evidence all do the reverse. Which reading the
   ruling meant is the owner's.
Categories the reviewer reported clean: backend changes, config swaps, size/API comparisons.

**Built-in /code-review round (high; one careful diff pass in the same session AFTER the
adversarial round — not blind to it, so the five above are not repeated here): 3 findings, each
CONFIRMED by reading.**
- MED `examples/site-lab/element.ts:113` — the element harness records and asserts no backend; "ours
  WebGPU 5/5 · ours WebGL2 5/5" rests on the `?webgl=1` URL parameter, while ruling Stop 11 says the
  fixture asserts, via the runtime handle, the backend it got.
- LOW `examples/loader-lab/main.ts:788` — `splat-meshes-answer-no-raycast-hits` does not require the
  splat mesh to have attached (printed at `:775` only), so zero hits can mean no mesh.
- LOW `vite.embed.config.ts:9-14` — the header body still says the build lib-builds
  `src/backend/embed-entry.ts`; that file is now referenced by nothing (orphaned by the entry switch).
Checked and ruled out in the pass: zero-scene sites (rejected at `SiteConfig.ts:761` before the
runtime exists); the swap specifiers (one importer each, exact match; the stub's import is
type-only); a backend-level worker leak (workers live per `DecodePool`, terminated with the handle);
the throttle hook (line-identical to the pin's `SparkScene.ts:279-319`); `awaitRendererInit`'s
dispose/failure ordering.

**Reviews NOT green — 8 confirmed findings await owner rulings; nothing committed.**

**Owner rulings on the review findings (2026-09-17) — all eight fixed as recommended, each
red-first.**
- **1 (HIGH):** catch the per-scene refusal and route it through `failReady`, the pin's own
  load-error path, so the element always receives a disposable runtime; ticket 08's
  refuse-immediately loader rule stays untouched. Proven with a failing `.spz` drill first.
- **2 (MED):** a SEPARATE small commit — it is ticket 03's code: dispose after a failed init must not
  throw unhandled; its own red-first probe (both backends failing is the trigger); committed
  independently AFTER the ticket 09 commit, like the earlier record fixes.
- **3 (MED):** the error count starts before boot; Stop 15's terms unchanged; red then green re-proven
  on both backends.
- **4 (MED):** event counts compared for every type except `loadprogress` (the one D29 sanctions).
- **5 (LOW):** CONFIRMED as the owner's error — the Stop 17 ruling block reversed the directions; the
  fixture is correct per D24 (scene-naming FAILS here, compiles at the pin). The ticket text is
  corrected and the ruling block noted as the source.
- **B1:** record and assert `runtime.sparkScene.backend`; re-run together with finding 4's fix.
- **B2:** mesh-attached joins the raycast drill's pass condition.
- **B3:** approved including the delete — `src/backend/embed-entry.ts` is an orphan the entry switch
  created (removing orphans one's own change created is the standing rule); the header is fixed in
  the same stroke.
- **Anchor:** the ~52% grounds are replaced with the measured figures (sibling on disk 6,954,269 B,
  its log 6.58 MB → product at ~45-48%), noting the original figure came from an unmeasured config
  comment. The bound stands on headroom, unchanged.
- **Sequence:** fixes red-first → affected labs re-run on both backends → `check:full` → a targeted
  adversarial pass over the fix diff only → two staged lists and commits under the scoped delegation
  once green (`docs/plan/results/phase-0.md` alone, then the ticket) → finding 2's fix as its own
  third commit.

**Owner ruling, element-harness travel (2026-09-17): the harness drives the rail.** Found while
executing B1/finding 4: the harness's pump only RENDERS, and rail travel advances on animation
frames, which a hidden page never gets — the first red run stalled on travel (`travelMs: 120000`,
no `stopchanged`), muddying the planted reds; Claude-in-Chrome was not connected. Ruled: the pump
also calls `runtime.cameraRail.update(1/60)`, with a comment stating why (pane-independence per the
house fixture doctrine, as site-lab already does); the same file is copied to the pin snapshot so
both sides run the identical harness; the finding-4/B1 red is re-run and must fail CLEANLY with
travel completing; then the three greens — ours WebGPU, ours WebGL2 (backend asserted per B1), and
the pin on 5180 against the same sanctioned checks.

**Build — the review fixes, red first (2026-09-17; in-app browser pane, WebGPU adapter probed
non-null on a real page — NVIDIA Ampere, Chrome 152; pane hidden throughout, one run at a time).**
Each red state was planted by count-asserted byte replacement with the file backed up first, and
restored by copy with its sha256 verified (`.collab-logs/t09-plants*.py`; `SiteRuntime.ts` back to the
inventoried `a114327a…` before the fix went in).
- **1 — `SiteRuntime.ts`:** the scene loop's `loadSplat` call sits in a try; a synchronous refusal
  bumps `scenesRefused`, queues `failReady` one microtask later (guarded by `disposed`, like
  `onError`) and continues; `onSceneRevealed` stays short of all-visible while any scene was refused.
  New site-lab drill `refused-scene-fails-the-load-and-stays-disposable` (a valid `fixture.ply` scene,
  then a `.spz` one). RED, unfixed runtime, WebGPU and WebGL2: `createSiteRuntime THREW "spz-refused:
  SPZ refused — three 0.185.1 ships no SPZLoader (doc 06 watch item 13, r186)" — no runtime to dispose;
  left behind in the host: canvas=true, 8 element(s)`. GREEN WebGPU: `runtime returned; onLoadError at
  return=0, after=1 ("spz-refused"); scenes owned=1 (the valid one visible=true); ready=null;
  progress=[]; dispose: window open=true, storage 0/0B, attributes 0, geometries 0, textures 0/0B →
  storage 8/36224B, attributes 1, geometries 1, textures 0/0B → storage 0/0B, attributes 0,
  geometries 0, textures 0/0B, backend.dispose calls=1 for the owned handle=true; canvas attached
  true → false`; WebGL2 the same with `textures 5/3264B` loaded.
- **3 — site-lab `main.ts`:** `errorMark` before boot. RED (the pin's classic line pair planted, its
  three lines textually identical to `fd67153`'s), both backends: `1 outline object(s), material
  LineMaterial; "not compatible" errors while rendering=1 ["THREE.NodeBuilder: Material
  \"LineMaterial\" is not compatible."]; removing the outline changes 266 of 527 sampled pixels`.
  GREEN: `material Line2NodeMaterial; "not compatible" errors while rendering=0 []; removing the
  outline changes 27 of 527` (WebGPU) / `10 of 527` (WebGL2).
- **4 + B1 + the rail pump — `element.ts`:** the first red run, before the rail pump, stalled on
  travel (`travelMs: 120000`, no `stopchanged`) — the reason for the ruling above. Red re-run (a
  doubled `ready` record + the `navigator.gpu` switch disabled, ours at `?webgl=1`): `element-events: 4
  passed, 2 failed` — `FAIL backend the run actually got …: WebGPURenderer, backend webgpu (this URL
  asks for webgl2-fallback)`; `FAIL event types and counts in order …:
  [["loadstart",1],["loadprogress","not compared"],["ready",2],["stopchanged",1]] vs pin
  [["loadstart",1],["loadprogress","not compared"],["ready",1],["stopchanged",1]]`; travel completed
  (16,748 ms) and `stopchanged [{"index":2,"id":"shelf","label":"The shelf"}]` PASS. GREEN, the identical
  harness on both sides (sha256 equal in the snapshot): ours WebGPU **6 passed, 0 failed**
  (`WebGPURenderer, backend webgpu`; ready 2,789 ms; travel 10,974 ms); ours WebGL2 **6/6**
  (`WebGPURenderer, backend webgl2-fallback`; ready 3,237 ms; travel 90,145 ms — inside the harness's
  120 s bound but not by much: each pumped step renders the hero on WebGL2); the pin on 5180 **6/6**
  (`WebGLRenderer, backend webgl (the pin's SparkScene is WebGL-only)`; ready 4,802 ms; travel 15 ms —
  wall time for the same 1/60 s rail steps, the pin's pumped render being nearly free in a hidden
  pane; `CameraRail.ts` is content-identical on both sides). Sequences: ours `loadstart, loadprogress
  ×2, ready, stopchanged` (`[0.3388, 1]`); the pin `loadstart, loadprogress ×5, ready, stopchanged`
  (`[0, 0.2761, 0.4851, 1, 1]` — its double 1 once more).
- **B2 — loader-lab:** RED (the drill's wait disabled, so the rays run before either mesh can attach):
  `35 passed, 1 failed` — `ply: mesh attached=false, hits=0; rad: mesh attached=false, hits=0;
  plain-box control hits=2` (the old pass condition held here). GREEN **36 passed, 0 failed** on WebGPU
  (`renderer backend=webgpu`) and WebGL2 (`renderer backend=webgl2-fallback`), `mesh attached=true`
  for both formats.
- **Site-lab GREEN, all drills:** **12 passed, 0 failed** on WebGPU and on WebGL2
  (`backend=webgl2-fallback (expected webgl2-fallback)`), `no-unhandled-rejections: 0` on both.
- **B3:** header rewritten; `src/backend/embed-entry.ts` deleted — no code, config or lint rule still
  referenced it (the remaining mentions are dated records).
- **Tripwire header:** one precision edit — the 3,138,621 B baseline is now dated "when the bound was
  ruled"; the product embed after fix 1 is 3,138,816 B (+195 B).
- **Pin snapshot hygiene:** the previous session's snapshot server (still running, PID 28236) had
  written Vite's dependency cache into `D:/Projects/sparkjs-toolkit/node_modules/.vite` through the
  `node_modules` junction (metadata mtime 2026-09-17 18:32:44, the minute the junction was made — a
  generated, gitignored cache; left as is). The harness-only config now pins `cacheDir` inside the
  snapshot (the server reloaded on the edit); across this session's pin run the sparkjs metadata stayed
  byte-for-byte put (mtime and size equal before/after) and sparkjs `git status` and HEAD were unchanged.
- **Gate on the fixed tree:** `npm run check:full` EXIT=0 (`.collab-logs/t09-check-full-2.log`): embed
  3,138,816 B OK under 3,932,160; lint `185 modules, 585 dependencies cruised`, no violations (one module
  fewer: the orphan); crate 6 + golden 7 incl. `decodes_hero_chunk0`.

**Targeted adversarial pass over the fix diff only (2026-09-18 UTC) — `astra-review`, banner-confirmed
gpt-6-astra / high / read-only, session `01a0b23f-1acb-7a71-ab68-b0563bd93486`; material
`.collab-logs/t09-fix-review-material.diff` (every "before" side sha256-verified against the pre-review
inventory), prompt `t09-fix-review-prompt.md`, output `astra-review-t09-fixes.md`: 0 findings in all five
categories** ("F1 runtime — none … F1/F3 drills — none … F4/B1/rail pump — none … B2/B3/header — none
… Ticket passages — none"; it re-derived the anchor at 45.13% and 47.70%). 14 tool calls, all reads, no
code executed; 292 repo files hash-identical before/after; 45,871 tokens; meter 63% → 64% of the weekly
window with a concurrent Codex desktop session active, so not attributable; no paid credits. Finding 2
takes no separate dispatch: the ruled sequence authorizes this pass over the ticket's fix diff only.

**Regression re-runs on the FINAL tree (owner's standing requirement — the backend was touched
twice, Stop 10 and Stop 7 P-A; in-app browser pane, dev server, one run at a time):**
loader-lab **36 passed, 0 failed** on WebGPU and on WebGL2 (`renderer backend=webgl2-fallback`) ·
splat-lab **28 passed, 0 failed** on WebGPU and on WebGL2 · pager-lab **26 passed, 0 failed** on
WebGPU default and on WebGL2 `?pages=32` (`budget … "source":"override (32)","backend":"webgl2-fallback"`;
`dispose-cycles-gpu-flat-with-sh: cycle 0: … textures 52/173801472B; cycle 1: … textures
52/173801472B …`). Observed while waiting, recorded so it is not re-diagnosed: pager-lab's cycles
slow markedly while the pane is hidden (each cycle's pixel readback waits out its timeout), and
`performance.getEntriesByType("resource")` caps at 250 entries — an empty tail there is a buffer
artifact, not evidence that fetching stopped.

- Instrument corrections made while building (each found by a failing drill, not by inspection):
  the pump now awaits `sparkScene.ready` before rendering (the sync facade throws by name if
  `render()` precedes init); the marker check counts by LABEL because the runtime's own chrome
  renders round buttons too (10 buttons, 8 markers); the outline pixel proof samples a 31×17 grid
  because three points missed a 3 px line and reported a false "no change".

**Status change: done — all nine ACs met (2026-09-17).** Evidence per AC in the blocks above; the
review fixes are green on every side the rulings require. Finding 2 (ThreeSplatScene, ticket 03's code)
follows as its own commit after this ticket's, by ruling.

**Finding 2 — ThreeSplatScene dispose after a failed init (2026-09-17; its own commit AFTER this
ticket's, by owner ruling; the code is phase-1 ticket 03's, which carries a dated pointer here).**
- Fix (`src/core/ThreeSplatScene.ts` `dispose()`): the deferred teardown is `ready.then(() =>
  renderer.dispose(), () => {})` — three's `Renderer.dispose()` runs only after a successful init. It
  is not a no-op while uninitialized: it skips its internals but still ends with the async
  `setAnimationLoop(null)`, which awaits `init()` again — the stored rejected promise — unobserved.
  A failed init left nothing to free. The comment's "documented no-op" claim is corrected.
- Red-first probe (`.collab-logs/t09-f2-probe/`, served by the dev server; BOTH backends fail before
  any module loads — `navigator.gpu` hidden so three falls back, and `getContext("webgl2")` returns
  null so the fallback fails too), with a success-path CONTROL in the same run (both backends
  restored, a working scene disposed, its `renderer.dispose` counted) so a "fix" that never disposed
  could not pass. RED on the committed code: `initFailed: true, initError: "Cannot read properties of
  null (reading 'getSupportedExtensions')", unhandledBeforeDispose: 0, unhandledAfterDispose: 1,
  reasons: ["Cannot read properties of null (reading 'getSupportedExtensions')"]`; control `backend
  webgpu, init ok, rendererDisposeCallsAtReturn 0 → after 1, unhandled 0`. GREEN after the fix: the
  same init failure, `unhandledAfterDispose: 0, reasons: []`, the control unchanged (`0 → 1`, `0`
  unhandled) — `verdict: GREEN`.
- Affected fixtures: the scene-level `dispose()` calls in the other labs are HMR teardown hooks no
  drill runs; site-lab is the fixture that asserts runtime teardown (Stop 16's window, 10 H-LIFE
  cycles, no unhandled rejections) — **12 passed, 0 failed** on WebGPU and on WebGL2
  (`backend=webgl2-fallback`), `measuring window open (renderer not yet disposed)=true`, H-LIFE
  `[1111111111]`, `no-unhandled-rejections: 0`.
- Gate: `npm run check:full` EXIT=0 (`.collab-logs/t09-f2-check-full.log`; embed 3,138,830 B OK under
  3,932,160; crate 6 + golden 7; lint 185 modules / 585 dependencies). No separate adversarial
  dispatch: the ruled sequence authorized the targeted pass over the ticket's fix diff only.
