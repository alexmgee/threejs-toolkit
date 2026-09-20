# 12 — Diagnostics rewired (§G); Spark-era instruments deleted for good

**Status:** ready-for-agent
**Blocked by:** 07 — the pager surface is complete; 09 — diagWiring.stub landed.

**What to build:** the diagnostics that produced the original tuning wins run
against our own pager's PUBLIC counters — no monkey-patching — and ~4,300 gross
lines of Spark-shaped instrumentation leave the tree (doc 03 §G; doc 04 "left
behind for good"; the SparkPagerAdapter deletion doc 04/handoff 004 name
explicitly).

Standing rules bind (spec.md).

- [ ] SparkPagerAdapter (1,362 lines) and the pager-internal halves of LoadProbe /
      diagWiring / LaggardMapper are deleted; gate green with no re-stub left
      behind; gross line count of the deletion recorded.
- [ ] NetworkObserver, LoadRecord, sinks, fixtures, and FrameDiffValidator produce
      a complete record of a real hero load, both backends.
- [ ] The CPU-budget denominator is fed from RadPager and shown non-zero on a real
      load, OR the budget feature is deleted — a silently self-disabled third
      state fails this ticket (§G trap).
- [ ] The deferred `phase7-runtime-consent` assertion un-defers with diagWiring and
      passes; the selfTest count is re-baselined and stated in Comments.

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
