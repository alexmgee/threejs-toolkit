# 12 — Diagnostics rewired (§G); Spark-era instruments deleted for good

**Status:** done *(corrected 2026-09-27 at ticket 13's close-out, owner-authorized: this line still read `ready-for-agent` after the ticket closed at commit `70dbd22` with every AC ticked)*
**Blocked by:** 07 — the pager surface is complete; 09 — diagWiring.stub landed.

**What to build:** the diagnostics that produced the original tuning wins run
against our own pager's PUBLIC counters — no monkey-patching — and ~4,300 gross
lines of Spark-shaped instrumentation leave the tree (doc 03 §G; doc 04 "left
behind for good"; the SparkPagerAdapter deletion doc 04/handoff 004 name
explicitly).

Standing rules bind (spec.md).

- [x] SparkPagerAdapter (1,362 lines) and the pager-internal halves of LoadProbe /
      diagWiring / LaggardMapper are deleted; gate green with no re-stub left
      behind; gross line count of the deletion recorded.
      2,271 gross (measured, not the inherited ~4,300) across four whole files and
      five diagWiring regions; LoadProbe and LaggardMapper had NO pager-internal
      half and are untouched (doc 03 §G corrected with the measurement and the why).
- [x] NetworkObserver, LoadRecord, sinks, fixtures, and FrameDiffValidator produce
      a complete record of a real hero load, both backends.
      site-lab 18/18 on WebGPU and WebGL2; the record carries pager_snapshot, decode
      and gpu_upload from our own counters. The committed Spark fixture is deleted
      (B1) and its successor named; FrameDiffValidator is untouched.
- [x] The CPU-budget denominator is fed from RadPager and shown non-zero on a real
      load, OR the budget feature is deleted — a silently self-disabled third
      state fails this ticket (§G trap).
      FED (G2a): 11 of 11 pager_snapshot events declared renderedFrame on a real load,
      both backends; selfTest's budget-denominator-advances fails if a future change
      stops feeding it (proven red by planting the pinned denominator).
- [x] The deferred `phase7-runtime-consent` assertion un-defers with diagWiring and
      passes; the selfTest count is re-baselined and stated in Comments.
      Evaluator in site-lab (G5): 16/16 there; examples/diag stays renderer-free at
      15/15 with phase7 deferred. Both baselines stated above and proven by execution.

## Comments

**Inherited from ticket 09 (owner ruling Stop 1, A2, 2026-09-17) — this ticket owns a
temporary note and a skipped call.** Ticket 09 lands the REAL `src/embed/diagWiring.ts`
(one declared line change: the Spark `SplatMesh` type import repointed at the backend's
type) with `diagWiring.stub.ts` byte-identical beside it; ticket 09 was the first ticket to
own the real file (plan-review gap, recorded in ticket 09's Comments). Because the real
file's paged-scene attach polls for a Spark `mesh.paged.pager` that this backend never has
(pin `diagWiring.ts:125-126`, `:228-237` — 200 ms polls for 30 s, then a silent give-up),
SiteRuntime SKIPS the pin's `loadTelemetry?.registerPagedScene(...)` call
(`fd67153:src/embed/SiteRuntime.ts:2389-2394`) and prints ONE named note in author mode
instead. **What this ticket's rewire replaces:** that skip and that note. The rewire
restores paged-scene registration against this backend's public pager counters and deletes
the note in the same change. A note that outlives the rewire fails this ticket — the same
class as AC3's silently self-disabled third state. The note's exact text and site are
recorded in ticket 09's Comments once built.

**Also inherited from ticket 09 (owner rulings, 2026-09-17):**
- **`markSceneFirstSplatReady` (Stop 5).** The pin called
  `loadTelemetry?.markSceneFirstSplatReady(entry.id, numSplats)` at a paged scene's first
  coarse splat, inside the reveal gate ticket 08 replaced (`fd67153:src/embed/SiteRuntime.ts:2518`,
  reading Spark's `numSplats`). Real telemetry ignores unregistered scenes (pin
  `diagWiring.ts:245-246`) and A2 registers none, so ticket 09 skips the call with the
  registration. This ticket restores it with the rewire, fed from the backend.
- **Throttle revisit (Stop 4f, doc 06 D29 item 1).** Ticket 09 carries the docked-idle render
  throttle with a seam-read refinement guard: a paged scene counts as still refining while
  `progress().fraction < 1`. Under a constrained page budget that fraction never reaches 1, so
  capped sites never throttle. The pin read "resident < wanted" from Spark pager internals; the
  equivalent signal here would pass through the diagnostics door this ticket shapes. This
  ticket NOTES whether its door makes a seam-legal "wanted" signal available; it does not
  build one. Ticket 13's idle-power / H-LOAD evidence decides whether that signal (T2) is ever
  warranted.

**Briefing — every inherited note collected from its recorded home (2026-09-20, before any
building).** Owner-requested sweep so none lapses silently. Sources swept: this file, phase-2
`spec.md`, phase-1 `spec.md` + ticket 07, doc 01/03 §G/04/05, doc 06, tickets 01/07/09/11/13,
handoffs 004/006/007/008/009/010, PLAN.md, and the code itself.

| # | Inherited note | Recorded home | What it obliges here |
|---|---|---|---|
| 1 | SparkPagerAdapter (1,362 lines) deleted for good | phase-1 `spec.md:20` (R4), phase-1 ticket 07 ACs, doc 03 §G, doc 04 Phase 2, handoff 004:156 | delete + prove nothing consumes it; its two in-tree importers are `diag/faultInjector.ts` and `diag/fixtures/fixtureTypes.ts`, plus `embed/diagWiring.ts` |
| 2 | Pager-internal halves of LoadProbe / diagWiring / LaggardMapper (~2,900 gross) | doc 03 §G, AC1 | a named deletion boundary per file, with the gross count recorded |
| 3 | A2: paged-scene registration restored, the author-mode note deleted | this file's Comments, ticket 09:103-111, `SiteRuntime.ts:2454-2461`, PLAN.md:300 | both in the same change; a surviving note fails the ticket |
| 4 | `markSceneFirstSplatReady` restored, fed from the backend | this file, ticket 09:347, `SiteRuntime.ts:2525` | re-wire the call the reveal-gate replacement dropped |
| 5 | Throttle revisit (4f / T1 → T2's seam signal) | this file, ticket 09:335, doc 06 D29 item 1 | this ticket NOTES whether its door can offer a seam-legal "wanted" signal; it does NOT build one; ticket 13's evidence decides |
| 6 | `pagerDiagnostics` residency mutators — the door's final shape | handoff 007:88-90 + 275-276, handoff 008:295-297, ticket 07:266 | **see the CONFLICT below** |
| 7 | CPU-budget denominator fed from RadPager, or the feature deleted | doc 03 §G trap, AC3 | no silently self-disabled third state |
| 8 | `phase7-runtime-consent` un-defers and passes; selfTest count re-baselined | AC4, ticket 01:57, phase-1 ticket 07:78-89 | needs an injected `phase7RuntimeEvaluator`; today's 20/20 excludes it |
| 9 | D14 / embed interaction: the embed carries the diagnostics graph until this ticket trims it | ticket 09:122 | re-measure the embed BOTH ways (normal + `TELEMETRY_MEASURE=off`) after the trim and record against the 3,932,160 B bound |
| 10 | H-LOAD consumes this stack's output | doc 03 §G "Verify", doc 05 H-LOAD instrumentation line | the rewired stack must still produce navigation→first-pixel, →full-quality, longest main-thread block, peak JS heap for ticket 13 |
| 11 | H-LOAD criterion 9's direct SH-output assertion "deferred to the production diag stack" | doc 05 criterion 9 | ownership unclear — see G7 |
| 12 | `pagerDiagnostics.lod` is the counter door §G rewires | ticket 07:266 | the LOD counters are part of the door's shape decision |
| 13 | Deletion standard: "its deletion is a feature" (DROP) | doc 01:15 | every deleted surface gets consumer-grep evidence + what replaces it (or why nothing does) |
| 14 | Diag fixtures re-proven; selfTest green by execution | AC2/AC4, phase-1 ticket 07 evidence | `examples/diag` re-run; the page already guards against a silently shrinking denominator |

**Notes collected that the brief did not list (brought, per instruction):** items 9, 10, 11, 12,
13, 14 above; plus two open task chips that are NOT part of this rewire — `decode-lab renders
green on a runner crash` (handoff 006:190, 007:273: `examples/decode-lab/main.ts` lacks
loader-lab's crash→FAIL path; it is the WASM decode fixture, outside §G) and the
`examples/shared` harness extraction (handoff 007:273, 008:293, 009:264). Neither falls inside
the diagnostics rewiring; both are reported, not silently absorbed.

**CONFLICT (stop) — the diagnostics door's final shape.** handoff 007:275-276 records "`pager
Diagnostics` carries residency mutators — **12 should make the door read-only**"; handoff
008:295-297 records "ticket 12 decides the door's final shape; **loader-lab drills depend on
them**". Measured today, three fixtures drive those mutators: counters-lab (`evictChunk` ×4,
`admitChunk` ×4, `setSelectionEnabled` ×2), loader-lab (×3, ×1, ×2, `markDirty` ×1), pager-lab
(×3, ×5, ×4, ×2, plus `setLodRenderScale` ×2 and `setCullingEnabled` ×2). A read-only door
deletes the mechanism behind ticket 11's AC2 eviction/admission samples, loader-lab's
eviction-mid-load drill and pager-lab's residency drills.

**Stop agenda — owner rulings requested before building (rule 11; the sources leave these open).**
- **G1 — the door's final shape (the CONFLICT above).** Options: (a) KEEP the mutators, declared a
  TEST-ONLY seam in the door's own doc comment, exactly as `fetchImpl` and
  `pageBudgetOverride` already are ("Never set in production code",
  `ThreeGsBackend.ts:222-236`) — zero fixture churn, the door stays one object; (b) SPLIT — a
  read-only `pagerDiagnostics` plus a separate test-only accessor (e.g. `pagerTestControls(handle)`)
  that the three labs re-point to — honours 007's "read-only" intent, costs ~12 call-site edits and
  a second door to keep honest; (c) READ-ONLY, drills deleted — matches 007 literally and loses
  ticket 11's AC2 eviction samples, loader-lab's eviction-mid-load drill and pager-lab's residency
  drills. Recommendation: (a) or (b); (c) trades proven coverage for tidiness.
- **G2 — AC3's either/or: feed the CPU budget, or delete the feature.** Evidence: the denominator is
  `renderedFrameTimes.length` and the allowance is
  `min(max(1, renderedFrames) × optionalCpuMsPerRenderedFrame, optionalCpuMsPerWindow)`
  (`LoadProbe.ts:465-469`); the ONLY production feeder of `renderedFrame: true` is
  `diagWiring.ts:618`, inside the adapter-event mapping — so deleting the adapter without a
  replacement leaves the denominator at 1 and the ladder silently self-disabling, which is exactly
  the state AC3 forbids. Options: (a) FEED it — emit the probe event from our own render path
  (`pagerDiagnostics.renders` and `ThreeSplatScene.renderCount` both already count rendered frames);
  the `budget-ladder` selfTest assertion and the `budget_action` / `budget_overrun` events survive;
  (b) DELETE the budget feature — the ladder, its two event types and its selfTest assertion go, and
  the selfTest baseline drops accordingly. Recommendation: (a): the instrument is one of the ones
  §G lists as surviving, and (b) removes a tripwire rather than a Spark dependency.
- **G3 — `registerPagedScene`'s input shape is an H-API surface.** `WireLoadTelemetryInput`,
  `RegisterPagedSceneInput`, `LoadTelemetryHandle` and friends are barrel-exported
  (`src/index.ts:154-164`), and doc 05 allows divergences only via doc 06 entries. The pin's input
  carries a Spark mesh whose `paged.pager` this backend never has. Options: (a) re-type the input to
  the seam pair (`backend` + `handle`), a loud compile break with a doc 06 entry, mirroring D32/D33;
  (b) keep the shape and have SiteRuntime pass a duck-typed adapter object built from the seam —
  no barrel break, but the type then lies about what it holds; (c) keep the pin's names and add the
  seam pair as new optional fields, accepting both. Recommendation: (a).
- **G4 — what feeds `markSceneFirstSplatReady`.** The pin called it at a paged scene's first coarse
  splat inside the reveal gate ticket 08 replaced, reading Spark's `numSplats`. Options: (a) at the
  loader's REVEAL (the seam's paint-observed ready — our definition of "first splat on screen",
  D26) with `counts().resident` as the number; (b) at the first page upload
  (`pagerDiagnostics.firstUploaded ≥ 1`), which is earlier but before anything is painted; (c) at
  the first render that draws a non-zero selection (`counts().selected > 0`). Recommendation: (a) —
  it is the one moment this toolkit already defines as "first splat visible", and it needs no new
  signal.
- **G5 — where `phase7-runtime-consent`'s evaluator lives.** Its sibling `consent-zero-construction`
  already proves the LoadProbe-level case (`selfTest.ts:760-791`); the deferred one is described as
  "SiteRuntime pending/denied zero-construction acceptance", i.e. the RUNTIME-level equivalent, and
  selfTest takes it as an injected `phase7RuntimeEvaluator`. Options: (a) the existing `examples/diag`
  page gains the evaluator by booting a real SiteRuntime with consent pending/denied — makes that
  page renderer-dependent, which phase-1 ticket 07 deliberately avoided (its note:
  "this page runs the renderer-free core"), so it would then owe a both-backends run; (b) the
  evaluator boots the runtime in `examples/site-lab` (already renderer-bound, already proves runtime
  behaviour on both backends) and the diag page keeps its renderer-free selfTest, with the phase7
  assertion evaluated there instead; (c) a telemetry-level evaluator without SiteRuntime — cheapest,
  but it re-proves the sibling assertion and would leave the runtime claim unproven. Recommendation:
  (b), with the selfTest count re-baselined where it runs.
- **G6 — the deletion boundary (~2,900 gross) for the "pager-internal halves".** Not obviously a
  ruling, but the biggest judgement in the ticket: which code inside LoadProbe (752), LaggardMapper
  (560) and diagWiring (624) is Spark-pager-internal versus renderer-agnostic framework doc 01 calls
  a survivor. Proposal: I bring the boundary as a file-by-file list with consumer-grep evidence and
  the gross count, for a yes/no BEFORE deleting, rather than deleting first and reporting after.
  Say if you would rather I just execute it against the §G description.
- **G7 — H-LOAD criterion 9's SH-output assertion.** doc 05 says a direct SH-output assertion is
  "deferred to the production diag stack — recorded as a gap, not a pass". Neither this ticket's ACs
  nor ticket 13's mention it. Options: (a) this ticket builds it now that the stack is being rewired;
  (b) ticket 13 records it as a standing gap, unchanged. Recommendation: (b) unless you want the
  assertion while the stack is open.

**OWNER RULINGS on G1–G7 (2026-09-20) — recorded before any building.** The agenda above is
unchanged; these are the answers to it, in its own order.

- **G1 — (a) KEEP the mutators, declared a TEST-ONLY SEAM.** They are "the same species as
  `fetchImpl` and `pageBudgetOverride`, which is the deciding precedent". Shape: **one door, two
  labeled halves** — the counters and `lod`'s read-only fields are the production half; the six
  mutators (`evictChunk`, `admitChunk`, `lod.setLodRenderScale`, `lod.setSelectionEnabled`,
  `lod.setCullingEnabled`, `lod.markDirty`) are documented test-only in the door's own JSDoc and
  here. *Precedent as measured:* `src/backend/ThreeGsBackend.ts:222-236` carries the phrase "Never
  set in production code" on `maxStorageBufferBindingSizeOverride` (:222-225) and `fetchImpl`
  (:234-236); `pageBudgetOverride` (:231-233) is documented as ADR 0003's `?pages=N` measurement
  regime without that phrase. The species argument holds for all three; the exact wording to copy
  is `fetchImpl`'s.
- **G1 supersession (owner, with grounds).** Handoff 007:275-276's "12 should make the door
  read-only" is **SUPERSEDED**. Grounds: it was written before the three fixtures existed and
  before ticket 11's AC2 grew roots into the mutators. Handoff 008:295-297 ("ticket 12 decides the
  door's final shape; loader-lab drills depend on them") is the surviving guidance, and this
  ruling is the decision it deferred here. The CONFLICT above is closed.
- **G2 — (a) FEED the denominator from our render path** (`pagerDiagnostics.renders` /
  `ThreeSplatScene.renderCount`), **red-first**: show the UNFED state self-disabling behind
  `max(1, renderedFrames)`'s plausible numbers first, then the fed state. **Plus a new standing
  guard the options did not contain:** selfTest asserts the denominator **ADVANCES** during a load,
  so an unfed regression can never again read as a legitimate one-frame window. (AC3's "silently
  self-disabled third state" was detectable only by reading `LoadProbe.ts:465-469`; after this it
  is detectable by running the selfTest.)
- **G3 — (a) RE-TYPE** the three barrel-exported telemetry input types to the seam pair
  (`backend` + `handle`); **doc 06 D34**, mirroring D32/D33's form.
- **G4 — (a) the loader's REVEAL with `counts().resident`.** Grounds given: it is "the moment this
  toolkit already DEFINES as first-splat-visible; no second definition."
- **G5 — (b) the phase7 evaluator runs in `examples/site-lab` against the real SiteRuntime**;
  the selfTest count is re-baselined there. `examples/diag` keeps its renderer-free selfTest.
- **G6 — YES to the checkpoint.** The file-by-file deletion boundary comes to the owner with
  consumer-grep evidence and the gross count for a yes/no **BEFORE** any deletion.
- **G7 — (b), sharpened.** Criterion 9's SH assertion stays ticket 13's, **with a note written into
  ticket 13's file that the production stack now exists**, so 13 chooses build-or-re-record **with
  grounds** and "never inherits the deferral by default."

**Carried conditions attached to the rulings (owner).**
- **(briefing #10) The embed re-measures BOTH ways after the trim** — normal build and
  `TELEMETRY_MEASURE=off` — recorded against the 3,932,160 B bound.
- **(briefing #11) After the rewiring, prove BY EXECUTION that the stack still emits every metric
  H-LOAD names** — navigation→first-pixel, →full-quality, longest main-thread block, peak JS heap —
  because ticket 13 consumes them.

**Order of work (owner).** G6's boundary list first, for the checkpoint; then build red-first.
Rule-11 stops continue to apply throughout. No time estimates.

**Commit delegation (owner, SCOPED TO THIS TICKET ONLY).** Granted once the ticket is green: gate
green → registry-first reviewer with the trace check → built-in `/code-review`, the two reported
separately. The staged list is shown first and anything stray stops the commit.

**G6 — THE DELETION BOUNDARY, file by file, for the owner's yes/no BEFORE anything is deleted
(2026-09-20).** Measured this session by direct read and consumer-grep; every count is from the
tree, not inherited. Nothing has been deleted.

**FIRST — the inherited figures do not survive arithmetic, and the boundary's SHAPE is different
from the one doc 03 §G describes.**

- doc 03 §G: "pager-internal halves of LoadProbe/diagWiring/LaggardMapper (**~2,900 gross**)" and
  "**~4,300 gross lines deleted**". But those three files total **1,936 lines whole**
  (752 + 624 + 560) — their *halves* cannot be 2,900, and 1,362 + 1,936 = 3,298, not 4,300. The
  figures appear to have been estimated, not counted.
- Measured, the two files §G names as carrying "pager-internal halves" carry **none**:
  `LoadProbe.ts` (752) has **2** pager mentions, both in comments (`:414`, `:509`), and imports
  nothing from Spark or the backend — it declares PORTS (`NetworkSourceFactory`,
  `SpatialMapperFactory`, `CameraStateProviderFactory`) and takes implementations by injection.
  `LaggardMapper.ts` (560) has **0** occurrences of spark/pager/chunk/SplatMesh — it consumes an
  abstract `SpatialPageEvidence` shape. **Both are survivors with 0 deleted lines**; they need a
  new feeder, not surgery. The Spark coupling was never inside the framework — it was concentrated
  in the *implementations* of LoadProbe's ports.
- Conversely, two files §G lists as SURVIVORS ("fixtures") are measured to be Spark-shaped and
  cannot survive the adapter: `faultInjector.ts` and `fixtures/fixtureTypes.ts` (see B1).
- **Measured gross deletion: 2,271 lines** (+ a 496,472 B fixture JSON if B1 takes it), against the
  inherited ~4,300. AC1 records the measured number; doc 03 §G's figures need a dated correction in
  this ticket's doc pass.

**THE BOUNDARY (delete).**

| file | region | lines | n | why it is Spark-internal |
|---|---|---|---|---|
| `src/diag/SparkPagerAdapter.ts` | WHOLE FILE | all | 1,362 | monkey-patches 4 private methods, pins 32 private names, `SUPPORTED_SPARK_VERSION = "2.1.0"` |
| `src/diag/faultInjector.ts` | WHOLE FILE | all | 375 | a MOCK SPARK PAGER (`MockPagerHarness` = `mesh.paged.pager`, `MockPagedSplats`, `MockSplatPager`); see B1 |
| `src/diag/fixtures/fixtureTypes.ts` | WHOLE FILE | all | 309 | schema of a RECORDED Spark session; its fingerprint keys are Spark's private member names; see B1 |
| `src/embed/diagWiring.ts` | header paragraphs | 8-16 | 9 | the `mesh.paged.pager` ordering rule + a stale pointer to a sandbox `examples/loadtest` that does not exist in this tree |
| `src/embed/diagWiring.ts` | adapter import block | 20-25 | 6 | `attachSparkPagerAdapter` + 3 adapter types |
| `src/embed/diagWiring.ts` | pager-wait constants | 125-126 | 2 | `PAGER_WAIT_INTERVAL_MS` / `PAGER_WAIT_TIMEOUT_MS` (200 ms × 30 s) |
| `src/embed/diagWiring.ts` | the poll closure | 224-240 | 17 | polls `mesh.paged.pager`, then silently gives up |
| `src/embed/diagWiring.ts` | `PagerNetworkSource` | 433-571 | 139 | the `NetworkSource` + spatial-evidence composite built over the adapter |
| `src/embed/diagWiring.ts` | `adapterEventToProbeEvent` | 573-624 | 52 | translates Spark's event shape into the generic probe vocabulary |
| | | **TOTAL** | **2,271** | |

Surgical, not whole-region: `buildSceneMetadata` (`:362-405`) loses its `adapter: SparkPagerAdapterHandle`
parameter and the seven fields it reads from `adapter.capabilities`; each is re-fed from the seam.

**CONSUMER-GREP EVIDENCE (nothing else reaches these).**

- `SparkPagerAdapter` — exactly **3** in-tree importers: `diag/faultInjector.ts`,
  `diag/fixtures/fixtureTypes.ts`, `embed/diagWiring.ts`. No example imports it; the barrel does
  not export it; the only other mentions in the tree are PLAN.md prose.
- `faultInjector` — **1** importer: `diag/dev/selfTest.ts` (`export *` at `:3` plus named at `:32`).
- `fixtureTypes` — **1** importer: `diag/dev/selfTest.ts` (`export *` at `:4` plus named at `:33`).
- `LaggardMapper` — 3 importers, **all survivors**: `dev/FrameDiffValidator.ts` (type only),
  `dev/selfTest.ts`, `embed/diagWiring.ts:351` (`spatialMapperFactory`).
- `diag/dev/selfTest` — **1** importer: `examples/diag/main.ts`, and only `runSelfTest` +
  `renderSelfTestResults`. `package.json` has no `exports` map, so the barrel `src/index.ts` is the
  whole public surface, and it exports **none** of the deleted names.
- `examples/` — **zero** direct imports of any deleted surface (grep over the whole directory).

**WHAT THIS COSTS IN selfTest — measured, not estimated.** Today's page, run in the browser this
session: `SELF-TEST: 20/20 PASS`, 21 assertions listed, `phase7-runtime-consent` DEFERRED. Six
assertions die with the adapter, one is surgical:

| assertion id | selfTest lines | fate |
|---|---|---|
| `fixture-schema` | 130-167 | dies (B1 decides whether it returns re-recorded) |
| `adapter-fingerprint-getter` | 168-207 | dies — proves the adapter survives Spark changing shape |
| `adapter-invalid-faults` | 208-228 | dies — 8 adapter-shaped faults |
| `adapter-missing-optional` | 229-241 | dies |
| `adapter-reordered` | 242-254 | dies |
| `request-ledger` | 255-291 | dies — its core claims are `ownHookWhileAttached` + `descriptorRestored`, i.e. the monkey-patch installs and cleanly un-installs. That pathology is what §G says is Spark-specific; there is no monkey-patch here to prove clean. |
| `store-bounds` | 629-686 | **SURVIVES, surgical** — its single `replayAdapterFault("storage_denial")` call (`:651`) is replaced; the fault's own `apply` only pushes the string `storage_denial:memory_fallback`, so nothing real is lost. |

**Re-baseline arithmetic (AC4).** 21 pushed − 6 deleted = **15 pushed**. On `examples/diag`
(renderer-free, phase7 not injected) that is **14 evaluated**; in `examples/site-lab` with G5's
injected `phase7RuntimeEvaluator` it is **15 evaluated**. Both numbers get stated in Comments and
proven by execution.

**THREE SUB-DECISIONS THE G6 QUESTION DID NOT ANTICIPATE — rulings requested (rule 11).**

- **B1 — `faultInjector` + `fixtureTypes` + `lab-load-001.json`.** §G lists "fixtures" among the
  survivors, but measured they are not re-feedable: `replayAdapterFault` builds a mock Spark pager
  and attaches the adapter for **all 11** faults (including the three that only push a string), and
  `lab-load-001.json` (496,472 B) is a *recording of a Spark session* whose fingerprint keys are
  `pagedMembers` / `pagerMembers` and whose `assetUrl` is `/examples/assets/teleport-lab1-hd.rad`.
  Options: **(a)** delete all three now; the committed-fixture instrument returns in a later ticket
  if wanted (smallest, and honest that we have no recording of our own pager); **(b)** delete the
  Spark schema and RE-RECORD a fixture from our own pager in this ticket — a new schema, a new
  capture, and `fixture-schema` comes back proving OUR record shape (most faithful to §G's
  "fixtures survive", largest addition to a ticket already deleting 2,271 lines); **(c)** keep the
  Spark JSON as a frozen historical artifact with a shrunken schema validator that no longer
  imports the adapter (keeps a green assertion, but it validates a recording of a renderer we no
  longer ship — a passing check that proves nothing about this toolkit). Recommendation: (a) or
  (b); I lean (a) with the re-record named as a follow-up, because AC2 already requires a complete
  record of a REAL hero load on both backends — that is live evidence, where the fixture is
  frozen evidence, and (b) doubles this ticket's new surface.
- **B2 — `sparkVersion` in the RECORD SCHEMA.** `LoadRecord.ts:22` declares
  `LoadRecordVersioning.sparkVersion: string`, fed at `diagWiring.ts:398` from the adapter. LoadRecord
  is a survivor, so the field outlives the adapter with nothing to put in it. Options: **(a)** rename
  to a backend-neutral name (e.g. `backendVersion`, carrying three's `REVISION` / our pinned
  0.185.1) — a record-schema change, so `LOAD_RECORD_SEMANTICS_VERSION` bumps 1 → 2 and ticket 13's
  H-LOAD consumes the new name; **(b)** keep the name and write three's version into it — no schema
  break, but every record says `sparkVersion` about a toolkit with no Spark in it; **(c)** drop the
  field — also a schema bump, and loses the renderer-version provenance that makes two records
  comparable. Recommendation: (a) — but it is a deliberate H-API/schema break and doc 05 wants it
  ruled and recorded (it would be a second doc 06 entry alongside G3's D34), so I am not choosing it.
- **B3 — two environment fields are stubbed in the production wiring.** `diagWiring.ts:394`
  hardcodes `rendererClass: "webgl"` and `:388` calls `bucketGpu(undefined, undefined, "unknown")`,
  so every record from a WebGPU run today claims "webgl" with an unknown GPU bucket. AC2 asks for a
  COMPLETE record of a real hero load on BOTH backends, which this defeats by construction. The
  seam knows the answer. This looks like a straightforward fix rather than a design choice, but the
  *vocabulary* is a choice: `"webgpu"` / `"webgl2"` (matches our backend names and doc 02) versus
  keeping the pin's coarser `"webgl"` class. Recommendation: fix it in this ticket with
  `"webgpu"` / `"webgl2"`, unless you would rather it stay stubbed and be ticket 13's problem.

**What replaces what (doc 01's deletion standard, item 13).**

| deleted | replaced by |
|---|---|
| `SparkPagerAdapter` (monkey-patching) | nothing — the pathology is gone; our pager has a public counter door (`pagerDiagnostics`), which is why §G says no adapter is needed |
| `PagerNetworkSource` | a new `NetworkSource` implementation over `pagerDiagnostics` + the existing `NetworkObserver` — same port, same `NetworkSnapshot` shape, same `SpatialPageEvidence` feed to `LaggardMapper` |
| `adapterEventToProbeEvent` | a snapshot-difference emitter producing the SAME generic probe events (`request_created`, `decode`, `gpu_upload`, `pager_snapshot`, `eviction`, …) — `events.ts`'s vocabulary is already renderer-neutral and survives untouched |
| the `mesh.paged.pager` poll | nothing — the seam hands us a live handle at registration; there is no private object to wait for |
| `faultInjector` / `fixtureTypes` | per B1 |
| 6 selfTest assertions | the adapter-robustness ones have no successor by design; the record-shape one per B1 |

**OWNER RULINGS on the G6 checkpoint and B1–B3 (2026-09-20).**

- **G6 — DELETE on the measured boundary** (2,271 gross; LoadProbe and LaggardMapper untouched),
  **and correct doc 03 §G's ~2,900 / ~4,300 figures** with a dated note citing the measurement and
  the WHY: "the coupling was dependency-injected into LoadProbe's ports, not structural — the
  estimate counted involvement as ownership." Grounds for rejecting the leave-the-figures option:
  "leaving known-wrong figures in the capability spec is the stale-claim class this project
  corrects on sight."
- **B1 — DELETE all three with the adapter** (`faultInjector.ts` 375, `fixtures/fixtureTypes.ts`
  309, `fixtures/lab-load-001.json` 496,472 B), **superseding doc 03 §G's "fixtures survive" line
  with grounds**: `replayAdapterFault` builds a mock SPARK pager for all 11 faults, and the 496 KB
  JSON is a recording of a Spark session keyed on `pagedMembers` / `pagerMembers` — "not re-feedable
  by construction". **Record the coverage successor honestly:** fault-path coverage for THIS
  pipeline lives in the labs' injection seams (loader-lab's fetch faults, counters-lab's plants,
  the worker-fault drills). Recorded-replay coverage of OUR pipeline would be a new recording of
  OUR sessions — "a named future item, not a reason to keep a Spark recording no code can feed."
- **B2 — RENAME, and BUMP the semantics version.** "The field does not survive its source as a
  fossil": rename `sparkVersion` to what it always meant — the engine that produced the record
  (e.g. `engineVersion` or `rendererVersion`) — fed from our real identity (three's revision plus
  this toolkit's), and bump `LOAD_RECORD_SEMANTICS_VERSION`. Grounds: "that versioning mechanism
  exists for exactly this moment; using it is the honest path, dodging it to avoid a bump would be
  schema drift by cowardice." Doc 06 entry **D35** recording the schema divergence, and **one line
  in ticket 13's file so H-LOAD reads the version bump as expected, not as a surprise.**
- **B3 — FIX IT in this ticket, red-first.** "It is AC2's own requirement wearing a bug costume."
  `rendererClass` feeds from the runtime's actual backend identity (`webgpu` | `webgl2-fallback` —
  the scene already knows); the GPU bucket feeds from what the platform genuinely exposes, with
  `"unknown"` only when truly unavailable. RED: a WebGPU run recording `rendererClass "webgl"` on
  today's code, quoted. GREEN: both backends producing correctly-labeled complete records.
- **Proceed instruction:** "delete on the boundary, then the rewiring per G1–G5, all red-first,
  conditions #10 and #11 standing."

**Flagged on the way in — `adapterVersion` is the SAME fossil class as `sparkVersion`, and B2 did
not name it (rule 11; to be ruled when the schema is touched, not decided here).**
`LoadRecordVersioning.adapterVersion` (`LoadRecord.ts:21`) is fed at `diagWiring.ts:397` from
`capabilities.adapterVersion`, which is the deleted adapter's own constant
`SPARK_PAGER_ADAPTER_VERSION = "spark-pager-2.1.0.1"` (`SparkPagerAdapter.ts:3`). When the
adapter goes, that field has no source either — the identical situation B2 rules on for
`sparkVersion`, inside the same interface, landing in the same D35 entry and the same
`LOAD_RECORD_SEMANTICS_VERSION` bump. Options when we get there: **(a)** apply B2's own principle —
`adapterVersion` always meant "the version of whatever observed the pager", so it carries the new
`pagerDiagnostics`-backed source's version; **(b)** drop the field, since with no monkey-patching
adapter the observer is no longer a separable component; **(c)** keep a literal. This is raised
now so it is not discovered mid-schema-change; it does not block the deletions, which are
independent of it.

**B3 RED — captured on today's code BEFORE any deletion (2026-09-20, `examples/site-lab/`,
WebGPU).** Captured first because the only harness that can make today's production wiring emit a
record (`faultInjector`'s mock pager, the one thing whose `mesh.paged.pager` satisfies the poll at
`diagWiring.ts:228`) is itself deleted by B1. Adapter probe on the page first:
`navigator.gpu.requestAdapter()` → present, `vendor: "nvidia"`, `architecture: "ampere"`. The page's
own check line in the same load: `PASS — real-site-ready: backend=webgpu (expected webgpu); ready in
1564 ms`. So the record below was produced in a run whose real backend is WebGPU.

Driven through the REAL production entry points — `wireLoadTelemetry(...)` then
`registerPagedScene({ mesh: harness.mesh, ... })`, consent `{ephemeral: granted, local: denied,
remote: denied}` — then `exportRecords()`. One record returned (`recordCount: 1`), wiring
`{attached: true, consent: "granted"}`. Quoted from that record:

    environment.rendererClass : "webgl"
    environment.gpuBucket     : {"vendorClass":"unknown","rendererClass":"unknown","capabilityTier":"unknown"}
    versioning.sparkVersion   : "2.1.0"
    versioning.adapterVersion : "spark-pager-2.1.0.1"
    versioning.probeVersion   : "1"
    versioning.schemaVersion  : "1"
    versioning.semanticsVersion : "1"
    versioning.toolkitVersion : "0.1.0"

**Reading:** on a WebGPU run, today's production wiring records the renderer as `"webgl"` and the
GPU as entirely `"unknown"` — B3's ruling ("AC2's own requirement wearing a bug costume") confirmed
by execution, not by reading the source. The same single record also carries both fossil version
fields in one place: `sparkVersion` (B2's subject) and `adapterVersion` (the sibling flagged above,
carrying the deleted adapter's own constant `SPARK_PAGER_ADAPTER_VERSION`).

**Honest note on the capture:** `sceneStatuses()` reported `adapterStatus: "invalid"` with reasons
`["fingerprint_mismatch", "Spark renderer is not an object"]`, because the call passed
`renderer: undefined` and the mock's shape is not the pinned Spark fingerprint. That does not touch
the fields under test — `buildSceneMetadata` ran and produced the record (recordCount 1) — but it
is recorded rather than trimmed, because the run is evidence and its imperfections belong with it.

**GREEN target (B3):** on both backends, `environment.rendererClass` equals the runtime's actual
backend identity (`"webgpu"` | `"webgl2-fallback"`, the vocabulary `ThreeSplatScene.backend`
already uses and site-lab already asserts) and the GPU bucket carries what the platform genuinely
exposes, with `"unknown"` only where it truly is.

**OWNER RULINGS on the three schema/API points the earlier rulings named but did not pin
(2026-09-20, rule-11 stop taken before building the replacement ports).**

- **G3's `backend` type — the NARROW DOOR INTERFACE.** Export
  `PagerDiagnosticsProvider { pagerDiagnostics(handle): PagerDiagnostics }` from
  `ThreeGsBackend.ts` (one of the five doors, "so `backend-doors-only` is satisfied by
  construction") and type the telemetry input `SplatBackend & PagerDiagnosticsProvider`. Grounds:
  "it keeps the H-API surface on interfaces (D32/D33's species), it states EXACTLY what telemetry
  needs beyond the seam — which is documentation as type — and it keeps LaggardMapper alive with
  per-page evidence." Rejected: the concrete class, which "would put a concrete class on the public
  API for the first time"; and `SplatBackend` alone, which "kills a §G survivor silently while
  type-checking clean, which is the worst failure mode this project knows."
- **B2's field name — `engineVersion`**, fed from **three's own `REVISION` constant at runtime**
  ("derived, never hardcoded — the value is the engine's own claim about itself"). Rejected:
  `rendererVersion`, because "`environment.rendererClass` already exists, and two 'renderer' fields
  answering different questions in one schema is a reader trap."
- **`adapterVersion` — DELETED in the same semantics bump.** "Its concept has no successor (there
  is no adapter; the ports are implemented directly), and a renamed fossil is still a fossil." One
  `LOAD_RECORD_SEMANTICS_VERSION` bump covers both changes; **D35 documents both, with today's RED
  record quoted as the before-state.** If ticket 13's record-reading ever wants a toolkit-identity
  field, "that's a new field with its own justification then — not a repurposed corpse now."
- **Proceed instruction:** "delete on the boundary, build the replacement ports, all red-first,
  conditions #10/#11 standing."

**Condition #11 cannot be met as worded — found before building, raised rather than absorbed
(2026-09-20).** The condition says "prove by execution that the stack STILL emits every metric
H-LOAD names". Measured exhaustively, the production stack does not emit two of the four today, so
there is no "still" to prove for them. doc 05's H-LOAD line reads "Instrumented by `measure.ts`
(spike) **then the rewired diag stack (production)**: navigation-start→first-pixel, →full-quality,
longest main-thread block, peak JS heap" — this ticket is the designated handover, which is why the
gap surfaces here.

| H-LOAD metric | in the production stack today | evidence |
|---|---|---|
| navigation→first-pixel | derivable from the `first_render_contribution` event, but SiteRuntime skips `registerPagedScene` (A2), so no record is produced at all on a real site load | ticket 09's A2 skip; today's RED capture needed `faultInjector`'s mock mesh to make ANY record appear |
| →full-quality | derivable from the convergence terminal (`convergedProven` / `resolveTerminal`) | `LoadProbe.ts:505-521` |
| longest main-thread block | **structurally unfed.** `longTasks` is declared (`:347`) and aggregated (`:359-362`) into the record's `probe_summary` block (`:526`), but **nothing in the entire tree ever SETS `longTaskDurationMs`** | exhaustive grep over all .ts/.js/.tsx/.mjs/.cjs outside node_modules: 4 hits, all in `LoadProbe.ts`, all consumers |
| peak JS heap | **absent from the record entirely** — no field, no sampler | exhaustive grep for `usedJSHeapSize` / `performance.memory`: only `examples/pager-lab`, `examples/site-lab`, `examples/splat-lab` (each for its own assertion) and the spike |

The only long-task observer and heap sampler in the repo are in the spike:
`spikes/native-rad/src/measure.ts:185` (`PerformanceObserver` on `"longtask"`, `buffered: true`) and
its 500 ms `performance.memory` poll, which together produce the spike's `longestTaskMs` and
`peakJsHeapMB` rows.

**Why this is the same class the owner has already ruled on twice.** `longTasks.maximumDurationMs`
reports `0` on every record — a plausible number that means "never measured", not "no long tasks".
That is AC3's "silently self-disabled" pathology and B3's "bug costume" exactly, one metric over.
But feeding it is NEW instrumentation (a `PerformanceObserver` and a heap sampler in the production
stack), not a rewire of Spark-shaped code — a scope expansion, so it is raised, not taken.

**Options (rule 11 — to be ruled when the rewire reaches condition #11's proof; it blocks nothing
before then).** **(a)** This ticket feeds both: a `longtask` PerformanceObserver emitting
`longTaskDurationMs` on its events, and a heap sampler adding a peak-heap field to the record —
completing doc 05's designated handover from `measure.ts` inside the ticket that performs it, at
the cost of new production instrumentation and a second record-schema addition in the same
semantics bump. **(b)** This ticket feeds neither and condition #11 is re-worded to what is true:
the rewired stack emits first-pixel and full-quality, and the other two are a NAMED GAP handed to
ticket 13 with this measurement quoted. **(c)** Feed the long-task observer only (it is a pure
event feeder that needs no schema change, since `longTasks` already exists in the record) and leave
peak heap to ticket 13 as a named gap needing a new field. Recommendation: (c) — it closes the
unfed-aggregate trap with no schema growth, while peak heap genuinely needs a new record field and
its own justification, which is the kind of thing the owner has just said should come "with its own
justification then, not a repurposed corpse now".

**BUILT (2026-09-20) — the rewire, red-first, with every ruling applied.**

**The deletion, as measured (AC1).** Four files removed whole, with their pre-deletion
sha256 prefixes and sizes recorded before `git rm`:

| path | lines | bytes | sha256 (16) |
|---|---|---|---|
| `src/diag/SparkPagerAdapter.ts` | 1,362 | 59,419 | `55383b181bde0a56` |
| `src/diag/faultInjector.ts` | 375 | 11,737 | `d5584ed3ab4742de` |
| `src/diag/fixtures/fixtureTypes.ts` | 309 | 14,095 | `350b4d05b61f778a` |
| `src/diag/fixtures/lab-load-001.json` | 19,787 | 496,472 | `675c7bce6fd2510c` |

plus five regions of `src/embed/diagWiring.ts` (225 lines: the header's ordering
paragraphs, the adapter import block, the pager-wait constants, the poll closure, and
the `PagerNetworkSource` composite with `adapterEventToProbeEvent`). **Gross: 2,271
lines**, exactly the boundary the owner approved — not the inherited ~4,300.
`src/diag/fixtures/` is gone entirely.

**CORRECTION to an earlier draft of this paragraph (made while reviewing my own diff).** It
claimed "LoadProbe.ts and LaggardMapper.ts have ZERO modifications". That is wrong for
LoadProbe: it gained **6 lines** — the `renderedFrames` field in the `probe_summary` derived
block, added so AC3's denominator is readable from the record. The accurate statement, which
is what the boundary actually claimed, is: **both files have ZERO DELETED lines** — neither
had the "pager-internal half" doc 03 §G attributes to them — and `LaggardMapper.ts` is
untouched entirely (`git diff HEAD --stat` shows no entry for it). The deletion boundary is
unaffected; the overstatement was mine and is corrected rather than left standing.

**What replaced it.** `src/diag/PagerTelemetrySource.ts` — a `NetworkSource` over
`pagerDiagnostics`, same port, same `NetworkSnapshot` shape, same `SpatialPageEvidence`
feed to `LaggardMapper`, and the same generic `events.ts` vocabulary the adapter used to
translate into. It only ever READS: no monkey-patching, no private names, no
fingerprint to invalidate. It declares four gaps of its own (per-request identity absent,
sampled transitions not instants, flat page topology, page-level render eligibility) so
a record never implies more than it measured.

**Red-first evidence, per ruling.**

- **G2 / AC3 — the denominator.** New selfTest assertion `budget-denominator-advances`.
  It cannot read the counter (a closure local), so it observes the ladder twice with
  identical optional cost: unfed → overruns, fed → within budget. RED PROVEN BY PLANT:
  `Math.max(1, renderedFrameTimes.length)` → `1` in `LoadProbe.ts` (the exact
  unfed-regression shape) took the page to `14/15 PASS` with the signature
  `fedStaysWithinBudget: false, denominatorChangesOutcome: false`; restored
  BYTE-IDENTICAL (sha256 `349e122926f276c9…` before and after, `sha256sum -c` OK).
  On a real load: `diag-cpu-budget-denominator-fed` in site-lab attaches a source to the
  live handle and counts — **11 of 11 `pager_snapshot` events declared `renderedFrame`
  while the pager's own counter moved 94 → 106 (WebGPU) and 8 → 20 (WebGL2)**. The
  denominator is also written into the record's `probe_summary` as `renderedFrames`.
- **B3 — the record names its renderer.** RED captured BEFORE any deletion (recorded
  above): `rendererClass: "webgl"` on a WebGPU run. GREEN: `"webgpu"` on the WebGPU run
  and `"webgl2-fallback"` on the WebGL2 run — the value CHANGES with the backend, so the
  check cannot pass by coincidence.
- **B2 + the sibling ruling — the fossils.** RED captured before deletion:
  `sparkVersion: "2.1.0"`, `adapterVersion: "spark-pager-2.1.0.1"`. GREEN, from a real
  load on both backends: `{"schemaVersion":"1","semanticsVersion":"2","probeVersion":"1",
  "engineVersion":"185","toolkitVersion":"0.1.0"}` — `engineVersion` equals three's own
  `REVISION` (asserted against the imported constant, not a literal), and the assertion
  checks both fossils are ABSENT rather than merely changed.
- **A2 + G4 — registration and first-splat.** The author-mode note at
  `SiteRuntime.ts:2454-2461` is deleted and `registerPagedScene` is called in the same
  change; `markSceneFirstSplatReady` fires at the loader's REVEAL with
  `counts(handle).resident`. Proven end-to-end: `siteruntime-registers-paged-scenes`
  shows the runtime's own wiring emitting a load-telemetry record on a real site load
  (a record cannot exist unless registration ran), on both backends.
- **G5 — phase7.** The evaluator lives in `examples/site-lab`, boots real runtimes with
  consent pending and granted, and compares: pending produces no record while the site
  still reveals; granted produces one. `SELF-TEST: 16/16 PASS` there;
  `examples/diag` stays renderer-free at **15/15** with phase7 deferred.
- **G1 — the door.** The six mutators are kept and each labeled TEST-ONLY at its own
  declaration, with the two-halves contract and the handoff-007 supersession written into
  the interface's own doc comment. Zero fixture churn: counters-lab, loader-lab and
  pager-lab were not touched.

**A BUG THIS TICKET INTRODUCED AND THE FIXTURE CAUGHT — recorded because the lesson is
the point.** Removing the pin's 30 s poll, I wrote that "there is nothing to wait for".
That was half true and the wrong half was load-bearing: Spark's PRIVATE pager is gone,
but a paged scene's state genuinely does not exist until its header lands. Measured on
the lab hero: `pagerDiagnostics` throws `not-paged` immediately after `load()` returns
and keeps throwing for **910 ms**. My source latched `doorClosed` on the first throw, so
it observed NOTHING for the entire load while every other part of the system still looked
healthy — the record was produced, events flowed from NetworkObserver, no error appeared
anywhere. site-lab caught it: `diag-record-produced-on-a-real-load` failed with the event
types naming only `resource_timing` / `tao_status` and no `pager_snapshot`. Fixed by
distinguishing the two refusals — `not-paged` is "not yet", `unknown-handle` is "gone for
good" — with the reasoning written into the method's contract. The stale header claim is
corrected in the file rather than left standing, and the distinction is recorded in D34
item 4.

**A second defect found the same way:** `probe_summary` is appended at `LoadProbe.ts:521`,
which is the block's ONLY call site and sits inside `finalize()`. `exportRecords()` is a
CHECKPOINT, so a checkpoint record legitimately has no `probe_summary` — my first AC3
assertion read `renderedFrames` from it and measured 0 for that reason, not because the
feed was broken. Diagnosed by direct measurement (a source attached to a live handle
emitted 5,658 `pager_snapshot` events, **every one** carrying `renderedFrame`, renders
1 → 5,659) rather than by guessing; the assertion was retargeted at the feeder, which is
the layer this ticket is responsible for, and the checkpoint's `renderedFrames=0` is
REPORTED in the assertion's own detail line instead of being quietly dropped. A
re-entrancy guard was added to `readSnapshot` in the same pass (emitting synchronously
re-enters LoadProbe's capture, which calls back in; LoadProbe guards its own side at
`:418` for the same reason).

**selfTest re-baseline (AC4).** 21 assertions → 16: six deleted with the adapter
(`fixture-schema`, `adapter-fingerprint-getter`, `adapter-invalid-faults`,
`adapter-missing-optional`, `adapter-reordered`, `request-ledger`), one added
(`budget-denominator-advances`). `store-bounds` survived surgically — its
`storageDenialSignal` key was a TAUTOLOGY (the fault's whole body pushed a string, and
the assertion compared that string to itself; it could not go red), and the real claim it
gestured at is asserted for real beside it by `deniedFallbackTier`, which reads the live
store's capabilities. **`examples/diag`: 15/15 PASS** (phase7 deferred there), and the
page now asserts its denominator as an explicit `EXPECTED_EVALUATED = 15` instead of
guarding one assertion's skip — a lost assertion fails loudly rather than shrinking a
green fraction. **`examples/site-lab`: 16/16** with the injected evaluator.

**Fixtures re-proven (AC2, both backends).** `examples/diag` 15/15. `examples/site-lab`
**18 passed, 0 failed on WebGPU AND on WebGL2** (12 pre-existing checks plus the six new
§G ones), each run on a page whose `navigator.gpu.requestAdapter()` was probed first
(nvidia / ampere) and whose own `real-site-ready` line names the backend under test.
The record from a real paged load carries `pager_snapshot`, `decode` and `gpu_upload`
events — the load's own residency, decode and upload transitions, from our counters.

**Embed re-measured BOTH ways (carried condition #10).**

| build | bytes | vs ticket 11 | headroom vs 3,932,160 B bound |
|---|---|---|---|
| telemetry-in (default) | 3,112,522 | **−26,257** | 819,638 |
| `TELEMETRY_MEASURE=off` | 3,016,613 | +224 | 915,547 |

The telemetry build SHRINKS by 26,257 B — the 1,362-line adapter leaving the graph. The
off build's +224 B can only come from `SiteRuntime.ts`: it is the one changed file that
survives into a graph the diagnostics modules are eliminated from, and the elimination is
verified in the artifact itself (`loadTelemetry:semanticsVersion` marker: 1 occurrence in
the telemetry build, **0** in the off build; `spark-pager` / `SparkPagerAdapter`: **0** in
both). gzip of the telemetry build: 803,101 B.

**`npm run check:full` GREEN (exit 0)**, `backend-doors-only` included — 184 modules,
607 dependencies cruised, no violations, so `PagerTelemetrySource`'s reach into
`ThreeGsBackend.ts` is legal through the door rather than by exception.

**Briefing item 5 answered (the throttle revisit, T1 → T2).** This ticket only had to
NOTE whether the door can offer a seam-legal "wanted" signal. **It can, and it already
does:** `pagerDiagnostics(handle).lod.wantedChunks` is the traversal's wanted set, with
`lod.admitting` / `lod.admittingChunks` beside it for in-flight admissions. So the pin's
"resident < wanted" test has a direct, public equivalent here — `wantedChunks.length`
against the resident count — with no new plumbing. **Not built** (the ruling and doc 06
D29 item 1 leave that to ticket 13's idle-power / H-LOAD evidence); recorded so ticket 13
decides with the signal's availability known rather than assumed.

**Condition #11 CLOSED per the owner's ruling (option (c)) — long-task feed BUILT, peak heap
handed to ticket 13 (2026-09-20).** The owner's ruling and its grounds are recorded above;
`gpuBucket` is settled beside it.

**RED, measured on this tree before the observer existed.** A real paged load with deliberate
130 ms main-thread blocks: **20 long tasks occurred (longest 626 ms), confirmed by an INDEPENDENT
`PerformanceObserver`**, and the record's 110 raw events carried `longTaskDurationMs` **0 times**.
The aggregate's own behaviour was then proven BOTH ways by driving `LoadProbe` directly: events
without the field give `{count: 0, totalDurationMs: 0, maximumDurationMs: 0}`; the same three
events carrying 80 / 310 / 150 give `{count: 3, totalDurationMs: 540, maximumDurationMs: 310}`.
So the aggregate always worked and nothing ever fed it — "longest main-thread block" reported 0 on
every record ever written by this stack.

**GREEN.** One `PerformanceObserver({type: "longtask", buffered: true})` per RUNTIME, in
`SiteTelemetry` beside the existing page-level listeners — not in the source, because a long task
is a property of the PAGE and two registered scenes must each see it once rather than twice
between them. Each entry is forwarded to every registered scene's `PagerTelemetrySource.
recordLongTask`, which emits an `overhead` / `long_task` event carrying `longTaskDurationMs`, the
field LoadProbe already aggregates. Unsupported browsers (Firefox, Safari) leave the aggregate at
its honest zero. Measured end-to-end on a real load: 11 long-task events in the record, longest
532 ms.

**ATTRIBUTION BUG found and fixed in the same pass.** `buffered: true` delivers the page's whole
history, so the first build attributed pre-registration blocks to every scene registered
afterwards — measured in the fixture as **178 attributed events against 9 that actually occurred,
and a "longest" of 1174 ms against 287**. A scene's record claims "longest block during THIS
load", so each scene now carries a `registeredAtMs` and entries that had already finished by then
are skipped. After the fix: 11 recorded against 10 observed independently, the extra one being the
block that spans registration (the independent observer is created later and misses it).

**The fixture check is DELIBERATELY NOT dependent on a long task occurring.** Measured
2026-09-20: `longtask` is in `PerformanceObserver.supportedEntryTypes` and `observe()` succeeds,
yet eight deliberate 130 ms blocks produced **ZERO** entries on one WebGL2 run of this hidden pane
while the same code produced ten on the WebGPU run, and fifteen on the next WebGL2 run. Long-task
REPORTING is environmental here. Requiring one would make the fixture flaky for a reason unrelated
to the code under test — it did fail exactly that way once, and the failure is recorded rather
than hidden. `diag-longest-main-thread-block-fed` therefore asserts what this ticket owns: the
emitter accepts a 137 ms block and refuses a 0 ms one, the emitted event carries
`longTaskDurationMs`, and **nothing the browser did report was dropped** (`recorded >=
independent`). A second defect surfaced while fixing that: the first version compared a FROZEN
record snapshot against a LIVE counter that kept incrementing, so it could fail for the passage of
time; both are now sampled at the same instant.

**Condition #11 re-worded to what is now true.** The rewired stack emits **first-pixel**
(SiteRuntime registers paged scenes again and marks first-splat at the reveal — A2 closed, G4
wired), **full-quality** (the convergence terminal), and **longest main-thread block** (fed here
for the first time). **Peak JS heap is a NAMED GAP handed to ticket 13** with this measurement
quoted: it has no field in the record and no sampler in the production stack, and never did; 13
samples heap with its own fixture instruments (the spike's own method) and decides whether the
production schema earns the field, with grounds, under its own semantics bump if so. Written into
ticket 13's file. **[CORRECTED 2026-09-24 (owner ruling R2, ticket 13's reconciliation stop): was
not written at the time; written 2026-09-24 — ticket 13 Comments, "Carried item — peak JS
heap", quoting this paragraph verbatim.]**

**`gpuBucket` stays all-`unknown` — RECORDED AS FAITHFUL, not as a defect (owner ruling).**
Verified against the pin rather than assumed: `fd67153:src/embed/diagWiring.ts:388` is
`bucketGpu(undefined, undefined, "unknown")`, byte-for-byte the call we carry, and the pin's ONLY
call with real values is `selfTest.ts:728`'s hardcoded `"NVIDIA"` literal in a test. All-unknown
is therefore the pin's own PRODUCTION PRIVACY POSTURE, never a regression this rewire introduced.
Feeding it is a fingerprinting-surface product decision reserved to the owner post-parity — never
a port improvement, and explicitly not something this ticket invents. AC2's "complete record on
both backends" is satisfied by a correct `rendererClass` — proven by a value that CHANGES with the
backend (`"webgpu"` / `"webgl2-fallback"`), not a constant that happens to match — beside an
honestly-unknown bucket.

**FINAL EVIDENCE after the long-task addition.**
- `examples/diag`: **SELF-TEST: 15/15 PASS** (16 assertions, phase7 deferred there).
- `examples/site-lab`: **19 passed, 0 failed on WebGPU AND on WebGL2** — 12 pre-existing checks
  plus the seven §G ones; selfTest **16/16** inside it with the injected phase7 evaluator.
- `npm run check:full`: **GREEN, exit 0**; `backend-doors-only` 184 modules / 607 dependencies,
  no violations.
- Embed re-measured BOTH ways (condition #10, FINAL TREE after the reviews and the rename):
  telemetry-in **3,117,066 B** (**−21,713 B** against ticket 11's 3,138,779, headroom 815,094)
  and `TELEMETRY_MEASURE=off` **3,016,613 B** (+224 B against 3,016,389, headroom 915,547);
  both under the 3,932,160 B bound. The telemetry build SHRINKS despite everything added,
  because the 1,362-line adapter left the graph. The elimination is verified in the artifacts
  themselves: the `loadTelemetry:semanticsVersion` marker appears **once** in the telemetry
  build and **zero** times in the off build; `spark-pager` appears **zero** times in both.

  **CORRECTION to an earlier draft of this line, and a pre-existing fact it uncovered.** The
  draft claimed neither artifact contains any `SparkPagerAdapter` string. The telemetry build
  now contains **two** — both inside COMMENTS I added this session (the citations of
  `fd67153:SparkPagerAdapter.ts:529` explaining the sampling cadence). No Spark CODE survives
  in either artifact. Checking why prose reaches a product bundle established something not
  previously recorded anywhere: **the embed build is UNMINIFIED, and always has been.**
  `vite.embed.config.ts` sets no `build.minify`, and the artifact carries **1,583 JSDoc
  blocks**, including from files this ticket never touched (`CameraRail`, `convergence.ts`,
  the vendored `paged.ts`) — so this is pre-existing behaviour, not something the rewire
  introduced. Consequence worth stating: every embed figure in tickets 09, 11 and 12 is an
  UNMINIFIED measurement. They are consistent with each other and with the bound, which was
  itself set against an unminified artifact, so nothing is invalidated — but a reader would
  reasonably assume otherwise. **Reported, NOT fixed**: turning on minification would change
  the product artifact and every recorded size baseline at once, which is nobody's business
  to do inside a diagnostics-rewire ticket. Named here for ticket 13 or whoever owns the
  embed's shipping form. **[CORRECTED 2026-09-24 (owner ruling R6, ticket 13's reconciliation
  stop): not ticket 13's — the embed's shipping form is the OWNER's item, decided at the
  Phase 2 boundary.]**

## Review rounds (2026-09-20) — reported SEPARATELY, never merged

### Round 1 — adversarial, `astra-review` (registry-first)

**Selection and admission.** v2 policy read fresh from `D:\Projects\agent-collaboration\`
(collaboration-model.md, registry.json, operations.md, plan-template.md,
docs/verification-matrix.md). `registry.json` lane `technical_review` → primary
**`astra-review`** (`gpt-6-astra`, runtime `codex-exec`, effort **high**, pool
`openai-agentic`, `policy_enabled: true`, status `bounded_active_trial`); fallbacks
`sol-review`, `opus-specialist` unused — the lane's "choose another configuration when Astra
authored the work" exclusion does not apply, since Claude authored this change. Admission
against a FRESH balance probe (`.collab-logs/t09-codex-balance-probe.cjs`,
2026-09-20T21:08:34Z): `codex` primary **44 % used** of the 7-day window → 56 % remaining,
against reserve 20 + allowance 5; `hasCredits: false`, `spendControlReached: false`, plan
`prolite`. **Admitted.** Runtime resolved before launch: `codex-cli 0.153.3`.
Access class **`ordinary_authorized`**, declared in the prompt with the read scope and a
no-writes boundary.

**A launch failure worth recording.** The first dispatch produced a 124-byte trace containing
a Windows interactive banner and no run. Cause: Git Bash's MSYS path conversion rewrote
`cmd.exe /c` into `cmd.exe C:/`, so cmd never received the flag and sat waiting on stdin.
Re-launched from PowerShell against the `.cmd` wrapper (whose `< prompt.md` redirect is
cmd-level, per the recipe) and it ran correctly. The hung session was killed, not left.

**FINDINGS: 2, both re-verified by me with real commands before any action.**

1. **CONFIRMED and OPEN — the CPU-budget denominator counts SAMPLES, not rendered frames.**
   The source sets `renderedFrame: true` once per SNAPSHOT, and `SiteTelemetry.tick` is
   throttled to 100 ms while rendering runs at frame rate, so the denominator undercounts by
   the frames-per-sample ratio. Astra's reproduction (in its trace, verbatim):
   `render-budget {"actualRenders":60,"flaggedEvents":10}`. **My own independent
   verification, on the REAL backend rather than a stubbed door** — a real paged load, six
   renders per sample, twenty samples: **120 frames actually drawn, 19 events flagged, an
   undercount factor of 6.32×**. The consequence is real: the allowance is
   `max(1, renderedFrames) × optionalCpuMsPerRenderedFrame`, so the optional ladder throttles
   roughly six times more aggressively than the policy's own per-rendered-frame semantics
   intend. **NOT a regression** — verified at the pin: `fd67153:src/diag/SparkPagerAdapter.ts:529`
   emits exactly one `pager_snapshot` per `readSnapshot`, the same cadence, so the undercount
   is inherited. **Raised to the owner rather than fixed** — see the open decision below.
   *CORRECTED 2026-09-26 (ticket 13, FINDING RSW-1 — owner ruling):* "roughly six times" above is
   the uncapped ratio. The tick samples at >= 100 ms (`src/embed/diagWiring.ts:131`) and the
   allowance is capped at 50 ms per 5,000 ms window (`src/diag/LoadProbe.ts:465-469`), so with
   rendering sustained the ladder is at most roughly twice as aggressive as per-frame counting
   would make it, and only above ~20 fps. The 6.32x itself stands as measured: six renders per
   sample, by design. *CORRECTED AGAIN 2026-09-27 (ticket 13, FINDING R1-F2 — owner close-out ruling 2):* "at most roughly twice as aggressive … and only above ~20 fps" is wrong as well — the second wrong version, and like the first it passed through the owner's rulings. Because the tick fires on the first render at least 100 ms after the last sample and times the next from it (`src/embed/diagWiring.ts:301-302`), above 10 fps it samples less often than every 100 ms: counting true frames would loosen the throttle — no effect at or below 10 fps, ~2x from 10-20 fps, up to ~3x just above 20 fps. Detail: ticket 13, R1-F2.
2. **CONFIRMED, ALREADY FIXED — historical deferrals treated as outstanding work.** The same
   defect the built-in round found and fixed (round 2, finding 2). Astra ran against a
   revision that had the `loadSettled` guard but not yet the deferred fix, and said so
   explicitly; it also correctly WITHDREW the initial-load stability finding once it saw that
   guard land. No further action.

**Conduct checks.** Trace check: every load-bearing execution claim has a matching
`command_execution` item with real output in `.collab-logs/t12-review-trace.jsonl` (18
completed command items; `render-budget`, `initial-load`, `settled-load`, the tsc pass and
the dependency-cruiser pass all present with their outputs). No "reproduced in memory" /
"in-memory replay" phrasing appeared — the prompt line the ticket-11 round found effective
was kept and again produced clean claims; where it used a stubbed backend it SAID so ("the
executed reproductions used the actual source with controlled backend counters"). It listed
its own NOT-RUN items honestly (`check:full`, browser/GPU execution, real long-task
delivery). **Read-scope excursion: NONE** — it reported one *attempted* access to
`C:\Users\alexm\.config\git\ignore` by git itself, denied by permissions with no contents
returned, and no access to `D:\Projects\sparkjs-toolkit`. **Write boundary honoured,
verified independently by hashing**: 294 files hashed before dispatch, 292 byte-identical
after, and the 2 that differ (`PagerTelemetrySource.ts`, `diagWiring.ts`) are my own
round-2 edits — the worker wrote nothing.

### Round 2 — built-in `/code-review` (high), Claude

Four findings, all confirmed by execution and fixed red-first.

1. **HIGH — the source reported a stable working set MID-LOAD.** `workingSetStable` /
   `relevantOutstanding` feed the convergence CANDIDATE condition directly
   (`convergence.ts:114-115`), i.e. the probe's licence to start calling a load converged.
   They were derived from `lod.admitting + deferred.length`, and **neither counts the initial
   fetch/decode/upload pipeline**, so between two chunk completions both read 0. Measured on
   the lab hero: **3 samples claimed a stable working set from 1190 ms against a load that
   settled at 1703 ms** — a ~513 ms window, wider on a slower network. Fixed by requiring the
   pager's own `loadSettled`.
2. **HIGH — and the first fix exposed a second, opposite defect.** With `loadSettled`
   required AND deferrals still counted, the source reported stable in **0 of 7157 samples
   even after the load settled** — convergence would have become unreachable. Cause:
   `PagedState.deferred` is a `readonly number[]` whose only writer is a `.push`
   (`ThreeGsBackend.ts:835`); it is never cleared, so it is a HISTORICAL LOG of declined
   chunks, not a queue. Counting it as outstanding work breaks precisely the `?pages=32`
   regime doc 05 criterion 1 singles out. Corrected to in-flight admissions only. Re-measured
   on both regimes: **default budget 0 false-stable / 2,779 correctly stable after settle
   (121 deferrals present); `?pages=32` 0 false-stable / 43,271 correctly stable (109
   deferrals)**.
3. **LOW — six imports orphaned by the deletion.** `NetworkObserver`, `NetworkSource`,
   `DisposableSource`, `CapturedProbeEvent`, `JsonValue`, `NetworkSnapshot` each occurred
   exactly once in `diagWiring.ts` — their own import line — after their only consumer, the
   deleted composite, went. `tsconfig` deliberately drops `noUnusedLocals` (owner ruling,
   `tsconfig.json:8`), so nothing would ever have reported them. Removed; the boundary lint's
   dependency count falls **607 → 605**, confirming the graph edge actually went.
4. **LOW — a comment that overstated its own mechanism.** The long-task observer's note
   claimed `buffered: true` catches blocks predating it; in the normal flow no scene is
   registered when buffered entries are delivered, so they are dropped (and the per-scene
   `registeredAtMs` filter would discard them anyway). Behaviour correct, comment wrong,
   comment corrected.

**And one correction to THIS TICKET's own record, found reviewing my own diff:** an earlier
paragraph above claimed "LoadProbe.ts and LaggardMapper.ts have ZERO modifications".
LoadProbe gained **6 lines** (the `renderedFrames` field). The boundary claim it was
reaching for — **zero DELETED lines in both**, LaggardMapper untouched entirely — is intact
and is what the paragraph now says.

**Re-proven on the FINAL tree, after both review rounds, all four round-2 fixes and the
denominator rename:** `npm run check:full` GREEN (exit 0); `examples/diag` **15/15**;
`examples/site-lab` **19 passed / 0 failed on WebGPU AND on WebGL2**, with
`probe_summary.renderedSampleWindows` reading through under its new name; boundary lint 184
modules / 605 dependencies, no violations. Both dev servers had to be restarted mid-session
(the desktop app stops them across a date boundary — the handoff's warning, observed again).

### OPEN DECISION carried out of the reviews (rule 11) — the denominator's MAGNITUDE

Round-1 finding 1 was confirmed, shown not to be a regression, and put to the owner rather
than settled here.

**RULED (owner, 2026-09-22) — pin-faithful semantics, honestly named.**
1. **The ladder's denominator STAYS what the pin ran:** sampled windows in which rendering
   occurred. "Silently switching to true frame counts would loosen the throttle ~6x past any
   behavior the pin ever shipped — a policy change wearing a bug fix's clothes."
2. **Fix the LABEL, not the policy.** The record field is renamed to what it counts —
   `probe_summary.renderedFrames` → **`renderedSampleWindows`** — with the semantics written
   at the aggregate and at the emission site. The `LOAD_RECORD_SEMANTICS_VERSION` 1 → 2 bump
   already riding this ticket covers it at no extra cost, and **doc 06 D35 grows one item
   (item 5)**. The policy constant `optionalCpuMsPerRenderedFrame` keeps its inherited name
   and value. **The G2 advance-assertion is unchanged** — it tests feed liveness, which is
   orthogonal to the unit.
3. **The measured ratio and the true-frames alternative are a POST-PARITY TUNING ITEM in
   ticket 13**, recorded there with the 6.32x measurement and its environment-dependence: the
   perFrame allowance is a Spark-inherited starting value (ADR 0003's unpinned-constant
   class), so recalibration is a decision for evidence, made once with ticket 13's
   measurements in hand, not per-ticket drift.

**PROVENANCE OF THIS FINDING, recorded as it happened (owner instruction).** `astra-review`
FOUND it — it is the one defect in this change that the built-in round and the author both
missed, and it came from the adversarial round doing exactly what it is for. **I confirmed it
independently on the REAL backend** rather than accepting the worker's stubbed-door
reproduction: 120 frames drawn against 19 flagged events, 6.32x, on a real paged load. **The
pin-check then proved it INHERITED** (`fd67153:src/diag/SparkPagerAdapter.ts:529` emits one
`pager_snapshot` per `readSnapshot`), which is what turned a potential policy change into a
one-paragraph naming ruling. Worker finds, verifier confirms with real tools, history
supplies the frame: that trail is why this cost a paragraph instead of a debugging session.

**sparkjs pin state at close — CHANGED since this session's baseline, and NOT by this
session (recorded 2026-09-22).** The standing rule is to compare sparkjs `git status`, HEAD
and `node_modules/.vite/deps/_metadata.json` before and after any pin run.

- **HEAD is still `fd67153`** — the pin itself is intact, and every copy rule still holds.
- Baseline taken 2026-09-20 at session start, and re-verified immediately after the one pin
  server start: `M .gitignore`, `M CLAUDE.md`, `?? AGENTS.md`, `?? PLAN.md`;
  `_metadata.json` `2026-09-17 18:32:44`, **5431 B**.
- Now: the same four PLUS `?? .scratch/handoffs/006-2026-09-21-catchup-pack.md`,
  `?? .scratch/handoffs/007-2026-09-21-compaction.md`, `?? docs/catchup/`; `_metadata.json`
  `2026-09-21 02:21:37`, **4693 B**.
- **Attribution:** everything new is dated 2026-09-21, a day this session was not running
  (it spans 09-20 → 09-22 with a gap), and the files are handoff/catchup documents plus a
  vite dep-cache rewrite — owner activity in that repo, not writes from here. This session
  made exactly one pin-server start (port 5180, 2026-09-20) and verified sparkjs byte-identical
  immediately afterwards. Recorded rather than glossed as "untouched", and **the next
  handoff's `_metadata.json` baseline should read `2026-09-21 02:21:37`, 4693 B**, not the
  older value.
