# 13 — Phase 2 exit: H-LOAD re-run, H-LIFE, real-site end-to-end

**Status:** done
**Blocked by:** 11, 12 (05–10 are transitive through them).

**What to build:** the evidence that closes Phase 2 — the production runtime
measured against the spike's own numbers, both backends, both regimes. A PURE
evidence ticket: it should discover nothing new; if it does, the GATE has done its
job (regression ⇒ the integration, not the concept, is at fault — find it before
anything stacks on top).

Standing rules bind (spec.md). No time estimates; absolute numbers only (no Spark
comparisons — the spike's own numbers are the bar).

- [x] H-LOAD's ten criteria re-run on the production runtime: five cold-cache
      trials per backend per regime, results written to a results doc under
      docs/plan/results/ as absolute numbers; the visual criterion carried as a
      picture check at the pinned pose (D16).
- [x] Production figures match or beat the spike's; any regression is diagnosed as
      an integration fault and NAMED before the phase closes.
- [x] H-LIFE ×10 on the full element with a real site.json — heap flat across
      cycles, scene-swap under a live element included.
- [x] Phase 0's carried-forward improvement items — including the MediaLayer
      `getMaxAnisotropy()` candidate (owner ruling at breakdown) — each answered
      with a number: improved, unchanged, or explicitly deferred with grounds.
- [x] Upstream watch list (doc 06) re-checked at the boundary, including
      `npm view three version` dated; anything landed answered with "delete our
      code" or a recorded reason not to.

## Comments

**`CONTEXT.md` stays absent — not a gap (owner, 2026-09-18, at ticket 11's second
stop).** The repo's CLAUDE.md names a root `CONTEXT.md` that does not exist; that is by
recorded design (`docs/agents/domain.md`: "There is no `CONTEXT.md` yet. Layout is
**single-context**."). The owner schedules `/domain-modeling` at the Phase 2 boundary,
which is where the file first gets written. Recorded here so the absence stops
resurfacing as a finding in the meantime.

**Handed over by ticket 12 (§G diagnostics rewire, 2026-09-20) — three things this
ticket now owns.**

1. **H-LOAD criterion 9's SH-output assertion — CHOOSE, do not inherit (owner ruling
   G7).** doc 05 criterion 9 defers "a direct SH-output assertion … to the production
   diag stack — recorded as a gap, not a pass". That stack NOW EXISTS: ticket 12 rewired
   it onto the backend's public counter door and proved it on a real paged load on both
   backends. The deferral's premise is therefore gone. This ticket decides
   build-or-re-record **with grounds** and records the decision; it must NOT inherit the
   deferral by default, which is the whole point of the ruling.
2. **`LOAD_RECORD_SEMANTICS_VERSION` is now `"2"` (doc 06 D35).** The record's versioning
   block dropped `sparkVersion` and `adapterVersion` — both fed only by the deleted
   `SparkPagerAdapter` — and gained `engineVersion`, fed from three's own `REVISION` at
   runtime. H-LOAD reads records under semantics 2; the bump is EXPECTED, not a surprise
   or a regression. Any record written before 2026-09-20 carries the old shape.
3. **Two of H-LOAD's four named production metrics are NOT emitted by the stack, and
   never were.** doc 05's H-LOAD line says the rewired diag stack instruments
   "navigation-start→first-pixel, →full-quality, longest main-thread block, peak JS
   heap". Measured exhaustively in ticket 12 before any deletion:
   - first-pixel and full-quality: derivable from the record (the first is now actually
     produced again, since SiteRuntime registers paged scenes and marks first-splat at
     the reveal — A2 closed, G4 wired);
   - **longest main-thread block: structurally unfed.** `longTasks` is declared and
     aggregated into the record's `probe_summary` (`LoadProbe.ts:347`, `:359-362`,
     `:526`), but NOTHING in the tree has ever set `longTaskDurationMs` — so it reports
     `0` on every record, a plausible number meaning "never measured";
     **SUPERSEDED 2026-09-24 (owner ruling R1, reconciliation stop below).** Fed since
     `70dbd22`: one `PerformanceObserver({ type: "longtask", buffered: true })` per runtime
     (`src/embed/diagWiring.ts:234-255`, forwarding at `:248`) →
     `PagerTelemetrySource.recordLongTask` (`src/diag/PagerTelemetrySource.ts:438`) →
     LoadProbe's `longTasks` aggregate (`src/diag/LoadProbe.ts:359-362`). Longest-block now
     compares with the spike (over a like-for-like span, ruling Q3); only peak heap cannot.
     The words above are kept so the record shows its own history; this item's closing
     sentence ("those two rows") now applies to peak heap alone.
   - **peak JS heap: no field in the record at all.**
   The only long-task observer and heap sampler in the repo are the spike's
   (`spikes/native-rad/src/measure.ts:185` and its 500 ms `performance.memory` poll),
   which produce its `longestTaskMs` / `peakJsHeapMB` rows. Feeding them is NEW
   production instrumentation rather than a Spark rewire, so ticket 12 raised it instead
   of absorbing it. **This ticket cannot compare "production figures" against the
   spike's on those two rows until they are fed** — see ticket 12's Comments for the
   options put to the owner.

**POST-PARITY TUNING ITEM handed over by ticket 12 (owner ruling 2026-09-22) — the optional
budget's per-frame allowance.** `LoadProbe`'s optional-work allowance is
`min(max(1, renderedSampleWindows) * optionalCpuMsPerRenderedFrame, optionalCpuMsPerWindow)`.
Its denominator counts SAMPLE WINDOWS in which rendering occurred, not rendered frames —
measured at **120 frames drawn against 19 flagged events, 6.32x, on this machine** (the ratio
is environment-dependent: it is frames-per-snapshot, so it moves with frame rate and with
`SNAPSHOT_INTERVAL_MS`). Ticket 12 RENAMED the field to match what it counts (doc 06 D35 item
5) and deliberately did NOT change the policy: the sampling cadence is the pin's own
(`fd67153:src/diag/SparkPagerAdapter.ts:529`), so switching to true frame counts would loosen
the throttle roughly sixfold past anything the pin ever shipped. (**CORRECTED 2026-09-26, FINDING
RSW-1 — owner ruling:** at most roughly twofold, and only above ~20 fps, because the tick samples at
>= 100 ms and the per-window allowance is capped — the trace is in stop W1 below.) (**CORRECTED AGAIN 2026-09-27, FINDING R1-F2 — owner close-out ruling 2:** that is wrong as well, the second wrong version of this stake, and both went through the owner's rulings: counting true frames would loosen the throttle — no effect at or below 10 fps, ~2x from 10-20 fps, up to ~3x just above 20 fps — because the tick fires on the first render at least 100 ms after the last sample and times the next from it (`src/embed/diagWiring.ts:301-302`). Detail: R1-F2 APPLIED, at the end of these Comments.)

**What this ticket decides, once, with measurements in hand:** whether the allowance should be
recalibrated against true rendered frames. Note the constant class — `optionalCpuMsPerRenderedFrame`
is a Spark-inherited STARTING VALUE (ADR 0003's class of unpinned constants), not a derived
one, so this is a calibration decision needing evidence, not a bug fix. A Firefox profile of
the lab hero (2026-08-07) is the reason the optional ladder exists at all; any recalibration
should be argued against that kind of measurement rather than against the ratio alone.

**CLOSED for this ticket (2026-09-26, owner ruling W1 a): no retune in Phase 2.** Grounds: FINDING
RSW-1 shrinks the maximum effect to ~2x above 20 fps; the trials' drags ran at 2-10 fps, where a
retune changes nearly nothing; the owner's opt-in telemetry-price item (owner item 4) already
covers the whole cost. A retune happens later only against a profile, as a post-parity item. This
discharges doc 06 D35 item 5's deferral. (**CORRECTED 2026-09-27, FINDING R1-F2 — owner close-out ruling 2:** "~2x above 20 fps" is wrong — up to ~3x just above 20 fps, and ~2x already from 10-20 fps. The decision stands on its own grounds: the drags ran at 2-10 fps, where the ratio is exactly 1.0.)

**RECONCILIATION STOP (2026-09-24, opening this ticket — handoff 012). NOTHING BELOW IS
RULED YET; no trial has run and no gap is fixed. Every citation re-read this session.**
Start state verified: HEAD `07a8d5b`, tree clean; ports 5173/5180 free, no process; sparkjs
pin reading identical to handoff 012's (HEAD `fd67153`, same 7 status lines,
`_metadata.json` 2026-09-21 02:21:37 / 4693 B). Claude-in-Chrome connected (1 local
browser); built-in pane closed.

*(a) Record gaps.*
- **R1 / G-a — item 3's "longest main-thread block: structurally unfed" is stale.** Fed
  since `70dbd22`: observer `src/embed/diagWiring.ts:234-255` → `recordLongTask`
  `src/diag/PagerTelemetrySource.ts:438` → aggregate `src/diag/LoadProbe.ts:359-362`.
  Proposed fix: keep item 3's words, add a dated SUPERSEDED line under that bullet
  citing `70dbd22`. See R7 for the window difference this surfaced (**CORRECTED 2026-09-24:
  "R7" is Q3 below — the item was labelled Q3 when written; no R7 exists**).
- **R2 / G-b — the owner's peak-heap instruction is missing here.** Ticket 12:688-689 says
  "Written into ticket 13's file"; it was not (this file's only heap hits are AC3 and
  item 3's gap wording). Proposed fix: quote ticket 12:685-688 here verbatim as a dated
  carried item; add a dated correction line at ticket 12:688.
- **R3 / G-c — the T2 throttle revisit is not recorded here.** Doc 06 D29 item 1
  (`06-open-decisions.md:411-420`); ticket 12:630-636 answered availability
  (`pagerDiagnostics(handle).lod.wantedChunks`, not built). Proposed fix: a dated pointer
  item — this ticket decides T2 once, on its own evidence, as a stop.
- **R4 / G-d — AC4's list has no home. RECONSTRUCTION — A GUESS FOR THE OWNER TO CONFIRM.**
  Sources swept: every "ticket 13" mention in `.scratch/phase-2-backend`, `docs`,
  `PLAN.md`. Candidates: phase-0.md:117-134 items 1-5 (traversal on the main thread —
  re-measured ticket 07:120-123 at ~300-350 ms / 1.26-1.29 s; `covarianceB.zw` 8 %, D17
  OPEN; raw-bytes cache 213 MB; WebGL2 ~3x copies; SH1 saturation, accepted §H.3);
  `getMaxAnisotropy()` (spec.md:79-82, ticket 09:17-19); carried to 13 by ticket
  07:264-266 — initial-protection churn F6 (handoff 007:200-204), WebGL2 O(pages²) load
  (ticket 06:182-193); ticket 07:182-189 per-traversal hot-path costs ("ticket 13
  measures"); ticket 07:55 `lodRenderScale` ("Ticket 13's knob"); ticket 09:467-472 library
  bundle 721,358 → 929,227 B ("ticket 13 baseline material"); ticket 09:827 element-harness
  WebGL2 travel 90,145 ms against a 120 s bound (**CORRECTED 2026-09-24: the figure is at
  ticket 09:826-827**). Excluded: phase-0 free extra 2 (picking
  timing), recorded as carried to the Phase 3 entry (phase-0.md:111-113 — **CORRECTED
  2026-09-24: the item is at `phase-0.md:113-115`; "111-113" was this stop's miscitation,
  found by re-grepping before the rulings were written down**).
- **R5 / G-e — the Phase 2 re-sync audit.** The only mention is handoff 011:256. Doc 06 D21
  second amendment (`:199-201`) defines Phase 2's re-sync input "for each ticket" as its
  recorded copy-time SHAs vs `fd67153`; D21 FOURTH NOTE closes only the rules/site split.
  A grep for "re-sync|resync" across every tracked `.md` finds no all-cluster audit.
  The owner's session brief puts the audit in this ticket's agenda. Proposed fix: record
  it as this ticket's item, scoped per handoff 004:36-50: at-pin copies checked by
  byte identity against `git show fd67153:<path>`; ADAPTED files checked against their
  declared divergences; each drift either a cited controlled-drift case or a finding.
- **R6 / G-f — unminified embed: OWNER ITEM.** Ticket 12:730 says "Named here for ticket
  13"; the owner's framing supersedes it. Proposed fix: one line here saying it is not
  this ticket's, so a reader of ticket 12 does not pick it up.

*(b) Measurement questions.*
- **Q1 — hidden pane invalidates timings** (`spikes/native-rad/src/measure.ts:194-198`;
  production's own `LoadProbe` also tracks visibility and marks `endedHidden`). No
  production trial harness exists yet (no page sequences cold-cache trials; no
  Playwright/Puppeteer in the repo). Options: (A) Claude-in-Chrome, a visible tab in
  the owner's Chrome, I drive a new harness carrying the spike's contamination flag and
  auto-sequencer; (B) the owner opens that harness once with `auto=1` and leaves it, as
  in Phase 0; (C) the built-in pane made visible — unverified, needs a probe first;
  (D) the hidden pane, valid only for non-timing criteria. Sub-question Q1b: the harness
  host — the `<splat-site>` element on `examples/site-lab/sites/lab.site.json` (the
  hero) or the loader level (`loadSplat` + `ThreeSplatScene`, spike-shaped).
- **Q2 — selection-based first-pixel vs D26's reveal.** Spike: `performance.now()` on the
  first frame whose traversal `selectedCount > 0` (`spikes/native-rad/main.ts:455-457`).
  Production: ready fires in `afterRender` of the first render with `uploadedSplats > 0`
  (`src/backend/ThreeGsBackend.ts:819-825`), after that same render's `beforeRender`
  traversal (`:826-829` → `:1010-1045`). Both clocks are `performance.now()`. By code: reveal ≤
  selection-first-pixel, equal only if the reveal render's traversal selects ≥ 1 splat —
  NOT MEASURED. The ordering can be measured without wall-clock validity: own the frames,
  pump renders, and read uploaded / `lod.selectedCount` / phase at each render, on both
  backends and both regimes.
- **Q3 (new, found verifying R1) — the two long-task numbers cover different spans.** The
  spike counts every block from page start (`measure.ts:181-186`, observer at import).
  Production drops blocks that ended before the scene registered (`diagWiring.ts:246`,
  built after buffered history mis-attributed 178 events against 9 real). On the same run,
  production's figure is therefore ≤ the spike-method figure: a like-for-like
  comparison against the 775 / 185 / 1,017 / 206 ms bar needs the same span.

**OWNER RULINGS on the reconciliation stop (2026-09-24) — quoted verbatim.** The owner
re-checked ticket 12:685-689, `diagWiring.ts:246` and `measure.ts:194-198` before ruling.
(R4's "phase-0.md:111-113" repeats this stop's miscitation — the item is at
`phase-0.md:113-115`, corrected above; the ruling's substance is unaffected.)

> R1 (a): keep the original words, add a dated SUPERSEDED line citing 70dbd22 and the feed
> chain you traced (diagWiring.ts:234-255 → PagerTelemetrySource → LoadProbe). Grounds: the
> record must show its own history; longest-block now compares with the spike, only peak heap
> cannot.
>
> R2: quote ticket 12 lines 685-688 verbatim into ticket 13 as a dated item, and add a dated
> correction at ticket 12:688 ("was not written at the time; written 2026-09-24"). Grounds: the
> instruction's authority is its original wording; the false claim gets corrected in place,
> never silently.
>
> R3: add the dated pointer — ticket 13 decides T2 once, from its own evidence, as a rule-11
> stop, with lod.wantedChunks noted as the candidate signal per ticket 12:630-636.
>
> R4: your exhaustive reconstruction is CONFIRMED as the AC4 list — all of it: the five phase-0
> named items, getMaxAnisotropy, ticket 07's four (traversal cost, F6 churn, WebGL2 O(pages²),
> lodRenderScale), ticket 09's two (library bundle growth 721,358→929,227 B, element-harness
> 90,145 ms vs 120 s). Picking-route timing stays OUT (phase-0.md:111-113 assigns it to Phase
> 3's start). Record the list in ticket 13 with each item's source citation; each then gets a
> number and a verdict: improved / unchanged / deferred with grounds. Grounds: your sweep was
> exhaustive where the handoff's was reconstructive; the citations check out.
>
> R5: the re-sync audit is ticket 13's, with the handoff 004:36-50 scope exactly as you stated
> it — byte-identical vs git show fd67153:<path> for straight copies, declared-difference check
> for intentional changes, everything else a cited intended change or a finding. Record it as a
> dated item citing handoff 011:256 and D21's second amendment.
>
> R6: add the one-line disclaimer to ticket 13 AND a dated correction at ticket 12:730 — the
> embed's shipping form is the owner's item, decided at the Phase 2 boundary.
>
> Q1: A, Claude in Chrome, with B as the fallback exactly as you framed it. The harness copies
> the spike's contamination flag and auto-rerun; hidden or contaminated trials are discarded and
> repeated, never recorded. The owner knows a visible tab will appear in Chrome. Read-only
> driving: navigate and read, no account actions.
>
> Q1b: the element on lab.site.json. Grounds: AC1 says production runtime and doc 04's exit
> condition is the whole element; the loader level would re-measure the spike's shape, not the
> product.
>
> Q2: as recommended — the harness records the spike's selectedCount>0 definition in every
> trial so the bar comparison is like for like, with the D26 reveal timestamp recorded
> alongside. And YES, run the ordering check now (single-stepped frames, both backends, both
> regimes, uploaded pages + lod.selectedCount + phase after each render) — it is
> order-not-duration, hidden-pane valid, and it settles whether the two moments coincide with a
> measurement instead of a reading.
>
> Q3 (a): the harness also measures page-wide long tasks with the spike's exact method,
> reported alongside the production record's per-scene number. The production filter at
> diagWiring.ts:246 stays exactly as ticket 12 built it — correct for its purpose, unfair as a
> baseline comparator, same ruling shape as peak heap.

Where recorded: R1 in place under item 3 above; R2/R3/R4/R5/R6 as the carried items below; the
two ticket-12 corrections in place at ticket 12:688-689 and :730-731; Q1/Q1b/Q2/Q3 as doc 06
**D36**; a summary under PLAN.md `## decisions`.

**Carried item — peak JS heap: the owner's instruction, quoted verbatim from ticket 12:685-688
(written here 2026-09-24, ruling R2; ticket 12 corrected in place).** The quote runs sentence
to sentence inside those lines: it leaves out "for the first time)." (the close of line 685's
previous sentence) and "Written into ticket 13's file." (the false claim the correction
addresses).

> **Peak JS heap is a NAMED GAP handed to ticket 13** with this measurement
> quoted: it has no field in the record and no sampler in the production stack, and never did; 13
> samples heap with its own fixture instruments (the spike's own method) and decides whether the
> production schema earns the field, with grounds, under its own semantics bump if so.

The spike's method: `spikes/native-rad/src/measure.ts:188-192` — `setInterval(…, 500)` polling
`performance.memory.usedJSHeapSize`, keeping the max, reported as `peakJsHeapMB =
round(peak / 1048576)` (`:258`), `null` where `performance.memory` is absent (Chromium-only).

**DISCHARGED 2026-09-26 as decided-with-grounds (owner ruling W5 b): no field.** Grounds: a
Chrome-only API; page-scoped where the record is scene-scoped; the harness measured the heap in all
40 preserved trials (`docs/plan/results/phase-2-hload-trials.json`). `LOAD_RECORD_SEMANTICS_VERSION`
stays `"2"`.

**Carried item — the T2 docked-idle throttle signal (ruling R3, 2026-09-24).** Doc 06 D29
item 1 (`docs/plan/06-open-decisions.md:411-420`): the docked-idle throttle waits for
`progress().fraction === 1`, which tops out at 0.5082 under `?pages=32`, so capped sites never
throttle; "ticket 13's idle-power / H-LOAD evidence decides whether that signal (T2) is ever
warranted". This ticket decides T2 ONCE, from its own evidence, as a rule-11 stop. Candidate
signal, per ticket 12:630-636: `pagerDiagnostics(handle).lod.wantedChunks` (with
`lod.admitting` / `lod.admittingChunks` beside it) — seam-legal and already exposed, not built.

**DECIDED 2026-09-26 (owner ruling W2 b): recorded and deferred to a later power ticket, which opens
with this fact.** Capped sites are a REAL-DEVICE regime, not a test artifact: the product's own
formula (`webglPageLimit`, `src/backend/ThreeGsBackend.ts:494-519`) puts a WebGL2 device with
`MAX_TEXTURE_SIZE` 4,096 at 85 of the hero's 122 pages — COMPUTED, NOT MEASURED on such a device —
and a capped site never idle-throttles (doc 06 D29 item 1). The candidate signal stays
`lod.wantedChunks` with `lod.admitting` (ticket 12:630-637). Owner item 8.

**Carried item — AC4's carried-forward list, CONFIRMED by the owner (ruling R4, 2026-09-24).**
Each item gets a number and a verdict: improved / unchanged / deferred with grounds.

| # | item | source |
|---|---|---|
| AC4-1 | Traversal on the main thread (worker move) | `docs/plan/results/phase-0.md:119-124` (named item 1, ~260 ms at `?pages=32`); re-measured ticket 07:120-123 (~300-350 ms at 32 pages, ~1.26-1.29 s at 122) and re-carried at 07:264 |
| AC4-2 | `covarianceB.zw` dead lanes, 8 % of pool bytes | phase-0.md:125 (named item 2); doc 06 D17 (OPEN) |
| AC4-3 | Raw-bytes cache holds the whole asset (213 MB) | phase-0.md:126-127 (named item 3); handoff 007:208 |
| AC4-4 | WebGL2 fallback memory, ~3x storage copies | phase-0.md:128-131 (named item 4) |
| AC4-5 | SH1 saturation (hero sh1 max 1.505 clips ~12 %) | phase-0.md:132-134 (named item 5; accepted §H.3) |
| AC4-6 | MediaLayer `renderer.getMaxAnisotropy()` (parity is 1) | `.scratch/phase-2-backend/spec.md:79-82`; ticket 09:17-19 |
| AC4-7 | Traversal cost — per-traversal hot-path costs (`refreshPriority` O(chunks), `admissibleMissing` allocation, `maxResidentScale` O(pages)) | ticket 07:182-189 ("ticket 13 measures") |
| AC4-8 | F6 initial-protection churn (11-20 page swaps, ~3.7-4.6 s settling per fresh load at `?pages=32`) | ticket 07:124-128, :264-266; handoff 007:200-204 |
| AC4-9 | WebGL2 full-budget load, O(pages²) (32 pages 2.15 s; 122 pages 29-55 s) | ticket 06:182-192; carried ticket 07:71-72, :264-266 |
| AC4-10 | `lodRenderScale`, default 1 (the null value) | ticket 07:53-55 ("Ticket 13's knob") |
| AC4-11 | Library bundle 721,358 → 929,227 B, plus `rad-worker` 213.20 kB | ticket 09:467-470 ("ticket 13 baseline material") |
| AC4-12 | Element harness WebGL2 travel 90,145 ms against a 120 s bound | ticket 09:826-827; handoff 010:289 |

OUT: picking-route timing — `phase-0.md:113-115`, Phase 3's start.

**Carried item — the Phase 2 re-sync audit against `fd67153` (ruling R5, 2026-09-24).**
Sources: handoff 011:256 (its only prior mention) and doc 06 D21's second amendment
(`docs/plan/06-open-decisions.md:199-200`: "Phase 2's re-sync input for each ticket is the diff
between its recorded copy-time SHAs and `fd67153`"); D21's FOURTH NOTE closed only the
rules/site split. Scope, per handoff 004:36-50: (1) straight copies — byte-identical to
`git show fd67153:<path>`, always `git show`, never disk; (2) intentional changes (the adapted
files and declared adaptations) — checked against their declared differences; (3) everything
else — a cited, intended change or a FINDING.

**Not this ticket's (ruling R6, 2026-09-24): the embed's shipping form — the unminified
`dist-embed/embed.js` (ticket 12:721-731) — is the OWNER's item, decided at the Phase 2
boundary.**

**Q2 FRAME-ORDERING CHECK — DONE (2026-09-24, per ruling Q2). Result: in 16 of 16 natural runs
the D26 reveal render IS the spike's first-pixel render — the render that first finds an uploaded
page also has a non-empty traversal selection. They coincide BY CONSTRUCTION whenever a traversal
runs before the first chunk is decoded, and they PART when chunks land before any frame renders —
both halves measured (E1/E2 below), and the parting case is a FINDING against the backend's own
stated reveal intent (F1).**

*Method.* Probe `.collab-logs/t13-q2-ordering-probe.js` (git-ignored; sha256
`bc0e8a8d2971541782eae2d2114de9df2dc97f1c7d829b0ca37d860ec48d01e3`, 264 lines; its `cacheBust`
option was added between runs 14 and 15 and defaults off, so runs 1-14 executed the same code
path). Observation only — no source file changed. It wraps `ThreeGsBackend.prototype.load` to
learn which backend instance + handle the runtime created (the element keeps its backend
closure-local, `src/embed/SiteRuntime.ts:864`) and wraps the renderer's instance `render` only
to COUNT calls; both restored at teardown. Frames OWNED: after the scene's `ready`,
`setAnimationLoop(null)`; each step calls the scene's own rAF body `animate(now)`, flushes
microtasks (the loader's `onLoad` runs there; no macrotask, so no page can land mid-read), then
reads `progress().phase`, `pagerDiagnostics().firstUploaded` / `residentPages` /
`lod.selectedCount`. Steps paced ~16 ms apart with `MessageChannel` yields so page arrivals land
between renders, as at a visible tab's 60 Hz. Each run on a fresh page load of a bare
same-origin document (no toolkit module loaded beforehand, so `webgl` runs hide
`navigator.gpu` first, as `examples/site-lab/element.html` does).

*Environment (this session's own readings).* Built-in pane, Chrome 152.0.7977.130,
`visibilityState` "hidden", viewport 0x0; WebGPU adapter present (nvidia / ampere). Hidden-pane
validity is by the ruling (order, not duration). Guard: the traversal is skipped when the
drawing buffer's height is 0 (`src/backend/ThreeGsBackend.ts:988`, "hidden pane") — a zero
buffer would fake a "differ" — so every run records its drawing buffer: 512x256 in 14 runs,
768x384 in 2; never 0. Zero renders the probe did not drive after frames were owned, in every run.

*Hosts.* Element = `<splat-site>` on `examples/site-lab/sites/lab.site.json` (the harness host
per Q1b), default budget only: **the element cannot run `?pages=32`** — SiteRuntime builds its
backend as `new ThreeGsBackend({ renderer, createDecodeWorker })` with no budget option
(`SiteRuntime.ts:864`). So the constrained regime ran at the LOADER level (`loadSplat` +
`ThreeSplatScene`, `pageBudgetOverride: 32`, `createDecodeWorker` from `decode-url` as
SiteRuntime uses) with the camera set to the element's own pose at reveal (position
`[0, -1.04189, 5.90885]`, quaternion `[0.0871557, 0, 0, 0.9961947]`, fov 60, near 0.1, far 1000,
aspect 2 — stop 0 "overview" of lab.site.json). Bridge: the loader level at default budget
reproduces the element's reveal exactly (12,189 selected at pixel ratio 1 on both).

| run | host | backend | budget | cache | px ratio (buffer) | first upload / reveal / first selected (step) | at reveal: pages resident, selected |
|---|---|---|---|---|---|---|---|
| 1 | element | webgpu | 122 | not controlled | 1.5 (768x384) | 6 / 6 / 6 | 1, 17,713 |
| 2 | element | webgpu | 122 | not controlled | 1 (512x256) | 9 / 9 / 9 | 1, 12,189 |
| 3 | element | webgpu | 122 | not controlled | 1 | 6 / 6 / 6 | 1, 12,189 |
| 4 | element | webgl2-fallback | 122 | not controlled | 1 | 7 / 7 / 7 | 1, 12,189 |
| 5 | element | webgl2-fallback | 122 | not controlled | 1 | 5 / 5 / 5 | 1, 12,189 |
| 6 | element | webgl2-fallback | 122 | not controlled | 1 | 8 / 8 / 8 | 1, 12,189 |
| 7 | loader | webgpu | 122 | not controlled | 1 | 7 / 7 / 7 | 1, 12,189 |
| 8 | loader | webgpu | 32 (override) | not controlled | 1 | 4 / 4 / 4 | 1, 12,189 |
| 9 | loader | webgpu | 32 (override) | not controlled | 1 | 4 / 4 / 4 | 1, 12,189 |
| 10 | loader | webgpu | 32 (override) | not controlled | 1 | 5 / 5 / 5 | 1, 12,189 |
| 11 | loader | webgl2-fallback | 32 (override) | not controlled | 1 | 6 / 6 / 6 | 1, 12,189 |
| 12 | loader | webgl2-fallback | 32 (override) | not controlled | 1 | 5 / 5 / 5 | 1, 12,189 |
| 13 | loader | webgl2-fallback | 32 (override) | not controlled | 1 | 6 / 6 / 6 | 1, 12,189 |
| 14 | loader | webgl2-fallback | 122 | not controlled | 1 | 5 / 5 / 5 | 1, 12,189 |
| 15 | loader | webgpu | 122 | BUSTED | 1.5 (768x384) | 6 / 6 / 6 | 1, 17,713 |
| 16 | loader | webgl2-fallback | 122 | BUSTED | 1 | 5 / 5 / 5 | 1, 12,189 |

Budget read from the backend's own report every run (`budget.pages`, `budget.override`), never
assumed. Element runs: the element's `ready` event and `loadedScenes[0].visible` (set in
SiteRuntime's `onLoad`, right before `markSceneFirstSplatReady`, `SiteRuntime.ts:2419-2431`)
both landed in the reveal step; loader runs: `onLoad` in the reveal step. Cache-busted runs 15-16:
123 resource entries each (header + 122 chunks), all `206`, `transferSize` > 0 on every one (0
cache hits). The step before each reveal shows `firstUploaded` 0 (the reveal render is the
first render after the first upload).

*Reading.* By code, the reveal fires in `afterRender` of the first render with an uploaded page
(`ThreeGsBackend.ts:819-825`) and that same render's `beforeRender` runs a traversal the upload
marked dirty (`:962`); the measurement shows that traversal selects from the first page every
time, at this pose, on both backends, in both regimes, warm and cold. So the D26 timestamp and
the spike-definition timestamp differ only by the microtask gap after that render. The harness
still records both in every trial (ruling Q2) — a trial where they part would show it.
*Bounds of the claim:* one pose (the element's stop 0, the harness host's own); pixel ratios 1
and 1.5; the built-in pane. The reading above explains WHAT happened, not WHY it must — E1/E2
below measure the why.

*Found on the way — for the harness-design stop, NOT ruled:* (1) the element cannot run the
`?pages=32` regime (`SiteRuntime.ts:864`); (2) the selection at a fixed pose depends on the
drawing buffer — 17,713 at pixel ratio 1.5 vs 12,189 at 1, the same first page — because the
traversal's refinement threshold is per drawing-buffer pixel (`ThreeGsBackend.ts:983-990`); the
element takes the device pixel ratio (the pane itself reported 1.5 at first and 1 later), so
doc 05's "Measurement runs pin setPixelRatio(1) and a fixed window size" is not something the
element does on its own.

*Mechanism — E1/E2, measured the same session (probe grown to 295 lines, sha256
`0d45c363c3048f98f07cd54452d5a5203a5a0ba0d113af5c1a54a2d558faa396`: options `holdFirstChunkMs`
and `noRenderUntilMs`, per-step `r0` = chunk 0 resident, `deferred`, `wanted`; runs 1-16 used
the earlier version, whose code paths these options leave untouched when off).* Why chunk 0 was
the first page in all 16 runs, when `RadFetcher.prefetchAll` fires every chunk request at once
and delivers in ARRIVAL order (`src/backend/RadFetcher.ts:291-295`): admission is
`protected && not resident` (`src/backend/PagePool.ts:181-184`), the protected set is the first
`pageCount` chunks of the priority order (`:122-131`), and a traversal over an empty scene wants
only the root — "If chunk 0 is not resident: nothing selected, fullQuality false,
wantedChunks = [0]" (`src/backend/LodTraversal.ts:294-295`). So once ONE traversal has run, only
chunk 0 is admissible and every other arrival is deferred to the cache (`RadPager.ts:214-219`).
Both runs hold chunk 0's request — confirmed as fetch #2 `bytes=8128-1814167`, the first range
after the 8,128 B header (fetch #1 `bytes=0-65535`) — for 3,000 ms through the backend's
TEST-ONLY `fetchImpl` seam, at the loader level, default budget, the element's pose:

| run | backend | frames | first traversal | before the first upload | reveal render | first selected render |
|---|---|---|---|---|---|---|
| E1 | webgpu | pumped ~16 ms from the start | step 1 | wanted 1, deferred 121, nothing uploaded for ~3 s | step 104: chunk 0 resident, 17,713 selected | step 104 — **COINCIDE** |
| E1 | webgl2-fallback | pumped ~16 ms from the start | step 1 | wanted 1, deferred 121 | step 125: chunk 0 resident, 17,713 selected | step 125 — **COINCIDE** |
| E2 | webgpu | NONE for the first 2,500 ms | step 0 (the first render) | no traversal yet: static index order admitted all | step 0: 9 pages resident, chunk 0 NOT, **0 selected, 0 drawn** | step 84 (chunk 0 landed; 93,372) — **PART**, +84 renders |
| E2 | webgl2-fallback | NONE for the first 2,500 ms | step 0 | as above | step 0: 53 pages resident, chunk 0 NOT, **0 selected, 0 drawn** | step 18 (1,606,328) — **PART**, +18 renders |

(`deferred` is the historical log that only grows — ticket 12 — so E1's 121 is every non-root
chunk deferred once, not a queue depth.)

*Answer to Q2.* The moments coincide whenever a traversal runs before the first chunk is decoded
— true of a visible tab at frame rate with a non-zero canvas, and of every natural run here — and
part whenever pages land before any traversal and the root is not among them: a frame gap (a
background tab — the E2 model) or a zero-height drawing buffer (`ThreeGsBackend.ts:988` skips the
traversal and leaves it dirty). In the parting case the reveal is an EMPTY PAINT. The harness
records both moments in every trial (ruling Q2), so a trial where they part shows it.

**F1 — FINDING, NOT FIXED (for the owner): the D26 reveal can fire on a paint that draws zero
splats.** The backend's own comment states the intent: "Ready = the first paint AFTER the first
page upload (a mesh with no pages paints empty — that paint must not count)"
(`src/backend/ThreeGsBackend.ts:819-820`). With LOD selection, a mesh WITH pages can also paint
empty — E2 on both backends: `phase` "ready" with `lod.drawCount` 0. Consequences when it happens:
`whenReady` resolves, the element's `ready` event fires, the loader reports 1, and ticket 12's
`markSceneFirstSplatReady` (G4, wired to the reveal) records "first splat ready" — all before any
splat is drawn. Not a regression against the spike (which had no reveal) and not touched by the
harness comparison (the spike's own definition is the column). Whether D26's reveal should wait
for a non-empty draw is a product decision (ticket 08's contract, doc 06 D26) — raised at the
next stop, not decided here.

**HARNESS-DESIGN STOP (2026-09-24, after the Q2 check). NOTHING BUILT; no timing trial has run.
Every fact below was re-read or measured this session.**

*(A) What the harness is — fixed by the rulings and by the spike's own harness; listed so the
owner can object, not asked.*
1. A new fixture page `examples/hload/` (`index.html` + `main.ts`) in `vite.config.ts`'s input
   map, so the gate compiles it — the house fixture pattern.
2. Host: `<splat-site>` on lab.site.json's content (Q1b); trials in the owner's Chrome, a visible
   tab, driven read-only through Claude-in-Chrome (Q1); fallback B, the owner opens `?auto=1` once.
3. The spike harness's machine, copied from `spikes/native-rad/src/measure.ts`: LOAD → STABILITY
   (three 64x64 readback hashes, `:155-172`, `:325-339`) → DRAG (quarter orbit over 4 s,
   `:340-355`) → RESTORE (`:356-374`) → DONE; the contamination flag (`:194-198`); the
   auto-sequencer over the same four-config matrix in the same order (`:131-142`, `:274-292`),
   5 clean trials per config (`:110`) and the spike's own 60-attempt cap (`:111`); medians as
   `sorted[floor(n/2)]` (`:387`).
4. Instruments per D36: first-pixel on the spike's definition with the D26 reveal alongside;
   longest task page-wide with the spike's method (observer installed when the harness module
   loads, before the element boots) plus the record's per-scene figure; peak heap by the spike's
   500 ms poll.
5. Frames: the element's own animation loop runs untouched — timings are the product's. The
   harness observes through a wrapper on the renderer's instance `render`: its pose/drag writes
   happen immediately before each render, its reads immediately after.
6. Backend + handle through the Q2 probe's observation hook (wrap `ThreeGsBackend.prototype.load`,
   call through unchanged), exercised in all 20 probe runs this session; each trial asserts the
   captured backend owns `loadedScenes[0].handle`.
7. WebGL2 by hiding `navigator.gpu` before any toolkit module loads
   (`examples/site-lab/element.html`'s pattern); each trial records the backend it actually got
   (`runtime.sparkScene.backend`); a mismatch invalidates the trial.
8. Per-trial record: the spike's `TrialRecord` fields (`measure.ts:62-107`) wherever production
   has a source, plus the D26 reveal time, the record's per-scene longest task, the backend's
   budget report, the pixel ratio and drawing buffer, and a throttle-engaged flag.
9. Results doc `docs/plan/results/phase-2-hload.md`: absolute numbers, the spike's Phase 0 medians
   as the bar (ADR 0003), Spark's 2.3 s as historical context only.
10. Red-first per house rule: each harness check (contamination, backend mismatch, regime applied,
    throttle never engaged, the reveal/selection pair) shown failing on a planted state before any
    trial counts.

*(B) Decisions the sources leave open (rule 11).*
- **H1 — the `?pages=32` regime on the element.** SiteRuntime builds its backend with no budget
  option (`src/embed/SiteRuntime.ts:864`); the backend documents `pageBudgetOverride` as "ADR
  0003's `?pages=N` measurement regime" (`src/backend/ThreeGsBackend.ts:272-274`), read when the
  header lands (`:678`, via `derivePageBudget` at `:739`). (a) Harness-side, no product change:
  the load hook sets the instance's override before the first load; every trial asserts
  `budget.override === 32 && budget.pages === 32` from the backend's own report. Cost: test code
  writes a TS-private field (`:531`) — the kind of private reach ticket 12 kept out of production
  code. (b) Product seam: thread the override through `SiteRuntimeOptions` and the element. Cost:
  new public element surface (an H-API divergence needing a doc 06 entry) and a product change in
  a pure-evidence ticket. (c) Split hosts: element for default, loader level for `?pages=32` (as
  the Q2 check did). Cost: half the matrix measures the spike's shape, which Q1b's grounds reject.
  **Recommendation (a)** — the constrained regime is a measurement construct, not product
  behaviour, and the per-trial assertion proves the hook took effect.
- **H2 — test pose and drag path.** The spike: pose A (0,0,3) → origin, fov 60, near 0.01
  (`spikes/native-rad/main.ts:212-215`); drag `(3 sin θ, 0.3t, 3 cos θ)` looking at the origin
  over 4 s (`measure.ts:340-355`). The element boots at stop 0 (yaw 0, pitch −10, distance 6 —
  measured at reveal in the Q2 check), fov 60, near 0.1. `CameraSystem.setState({yaw, pitch,
  distance, pivot}, false)` places position and target directly
  (`src/core/CameraSystem.ts:811-829`); per frame only `cameraSystem.update` and an idle rail run
  (`SiteRuntime.ts:3347-3349`; rail Idle = "user has full control",
  `src/core/CameraRail.ts:444-446`). (a) The spike's pose and path through the element's public
  CameraSystem. (b) The element's own stop 0 and a drag by synthetic pointer input.
  **Recommendation (a)** — selection, traversal and sort cost all depend on pose, so only the
  bar's pose compares; the near-plane difference is declared.
- **H3 — canvas size and pixel ratio.** Doc 05: "Measurement runs pin `setPixelRatio(1)` and a
  fixed window size" (`docs/plan/05-parity-verification.md:95-96`; at `:100-101` since this ticket added five lines at `:89-93` — corrected 2026-09-27, RG-5). The spike pinned ratio 1
  (`main.ts:208`) and used the full visible window, size recorded per trial (`measure.ts:231-232`)
  but in NO document (whole-repo grep; phase-0.md gives none). The element takes the device ratio
  (1.5, then 1, in one pane this session) and the selection depends on drawing-buffer height
  (17,713 vs 12,189 at one pose, Q2 check). The scene applies its ratio once and its resize path
  calls only `setSize` (`src/core/ThreeSplatScene.ts:127-158`), so
  `runtime.sparkScene.renderer.setPixelRatio(1)` through the public handle holds. (a) Pin ratio 1
  + a fixed CSS box for the element, 1280x720 (the spike's own declared shape, `main.ts:62-63`),
  recorded per trial with drift flagged as the spike did. (b) Pin ratio 1 + a full-window element
  at whatever the Chrome window is, recorded per trial (the spike's practice). (c) First try to
  RECOVER the spike's real trial size: its raw records lived in the pane's localStorage for
  `localhost:5209` (`STORE_KEY`, `measure.ts:109`) — reading them needs the owner's OK (browser
  storage outside the repo's files, CLAUDE.md §12) and the spike's server started; they may be
  gone. **Recommendation (c) if allowed, else (a)** — a known, declared size beats an
  unrecorded one.
- **H4 — the docked-idle throttle during measured windows.** Renders drop to 10 fps once docked,
  rail idle, all revealed and 15 s without input (`SiteRuntime.ts:486-512`, gate `:3410-3429`),
  held off only while a paged scene still refines (`:3419-3422`); resets are window-level DOM
  events plus programmatic navigation (`:491-494`) — a harness `setState` resets nothing. Default
  regime: by DRAG (after full quality) the page is > 15 s idle → throttled; rAF still ticks and the
  skipped frames are nearly free, so the drag p95 would come out falsely LOW (**CORRECTED
  2026-09-24, owner ruling: in this harness a throttled drag reads falsely HIGH — it times render
  to render; plant C4 measured p95 1,265.8 ms over 5 drag frames — see the dated note under the
  H4 ruling**). `?pages=32` never
  throttles (D29 item 1). (a) Keep the throttle off in every measured window through the
  product's own reset path — a synthetic `pointermove` dispatched on `window` each harness frame
  (OrbitControls ignores a move without a pointerdown on its canvas) — and record
  `sparkScene.throttled` per frame to PROVE it never engaged; the throttle itself is judged under
  the T2 item. (b) Leave it on and record it. **Recommendation (a).**
- **H5 — full-quality and "steady".** Spike full-quality = the first frame whose traversal reports
  `fullQuality` with a non-empty selection (`main.ts:431-433`); production's traversal is the
  spike's port (`src/backend/LodTraversal.ts:286-296`), exposed as `lod.fullQuality`. Spike
  steady = all fetched, nothing admissible missing, decode idle, selection > 0, held 5 frames
  (`measure.ts:216-221`, `:309-322`); the door has neither "admissible missing" nor "decode idle",
  its nearest being ticket 12's `loadSettled && lod.admitting === 0` (`loadSettled` flips when
  the initial pipeline resolves, `ThreeGsBackend.ts:853-854`). (a) The spike's definitions through
  the door — full-quality via `lod.fullQuality`, steady via `loadSettled && lod.admitting === 0 &&
  selectedCount > 0` held 5 frames, declared as the production analog — with the record's
  convergence terminal alongside. (b) Both from the record's convergence terminal.
  **Recommendation (a)** — the shape of Q2 and Q3.
- **H6 — cold cache.** The spike busted the asset URL per trial (`main.ts:35-38`). The element
  reads its asset URL from site.json; `resolveSiteAssets` passes absolute URLs through
  (`SiteRuntime.ts:367-381`); lab.site.json holds exactly one URL (the hero); the Q2 cold runs
  proved `?cb=` gets fresh 206s. (a) Per trial, lab.site.json's content with the hero URL made
  absolute + `?cb=<nonce>`, given to the element as a `blob:` src, cold proven from resource timing
  (every chunk 206, `transferSize` > 0). (b) Accept Chrome's cache state. **Recommendation (a).**
- **H7 — dev server or built artifact.** The spike's trials ran on its Vite dev server (handoff
  002:33-38); the shipping embed's form is the owner's item (R6). (a) The dev server
  (`toolkit-dev`). (b) The built embed. **Recommendation (a)** — like-for-like with the bar, and
  no measuring of an artifact whose shipping form is undecided.
- **H8 — D16's picture check at the pinned pose.** D16 (`docs/plan/06-open-decisions.md:83-90`):
  criterion 4's self-stability hashes plus a visual diff against sparkjs-toolkit's render of the
  same pose at the Phase 2 re-run, never numbers. Ticket 09's element-events harness ran ONE file
  against both toolkits (the `@toolkit/index` alias) on 5173 and the pin snapshot on 5180. (a) A
  small shared picture page on that pattern: the element on lab.site.json, ratio 1, pose A through
  each side's CameraSystem, wait for steady (ours) / ready plus a settle (the pin), capture both
  canvases as images for the owner to compare side by side; pin before/after readings taken.
  (b) Claude-in-Chrome screenshots of both tabs. **Recommendation (a)**; not a timing trial.
- **F1 — the D26 empty-paint reveal (finding above).** (a) Record it now (a dated note on doc 06
  D26 and here), behaviour unchanged, revisited as a product decision after Phase 2. (b) Fix now:
  the reveal waits for a paint that DRAWS splats — a change to ticket 08's contract inside an
  evidence ticket, red-first against E2. **Recommendation (a)** — the harness does not depend on
  it (it measures the spike's definition), and the case needs a frame gap plus a late root chunk;
  AC2's standard is NAMED before the phase closes, which this is.

**OWNER RULINGS on the harness-design stop (2026-09-24) — quoted verbatim.** The owner re-checked
`SiteRuntime.ts:864`, `ThreeGsBackend.ts:819-825`, the throttle constants at
`SiteRuntime.ts:486-494` and `pageBudgetOverride` at `ThreeGsBackend.ts:274/678` before ruling.

> H1 (a): the harness sets the override through the same hook the probe used, and EVERY trial
> asserts the backend's own reported budget before counting. No product change — SiteRuntime's
> constructor stays as ticket 09 built it; whether the element ever earns a budget attribute is a
> post-parity product question, not this ticket's.
>
> H2 (a): the spike's pose (0,0,3) and quarter-orbit through the element's public camera system;
> the near-plane difference (0.1 vs 0.01) declared in the trial record and in the results table.
>
> H3: attempt (c) FIRST — you may read the built-in pane's saved browser storage for the spike
> page's own entries, read-only, and record verbatim what you find or that nothing survives. If
> recovered, use the spike's real size and cite the recovery. If gone, fall back to (a): pixel
> ratio pinned to 1 and a fixed 1280×720 box, with a declared caveat on the bar comparison that
> the spike's trial size is unrecorded — the caveat exists either way; a recovered value is the
> only thing that removes it.
>
> H4 (a): synthetic pointermove per harness frame through the element's own input path, AND the
> trial record carries the throttle state so every trial proves the 10fps regime never engaged.
> A planted check first: show a trial WITHOUT the synthetic input actually trips the throttle, so
> the guard is proven to bite.

*[Dated note beside H4, 2026-09-24 (owner ruling on the plant report): the stop behind this ruling
said a throttled drag would read falsely LOW. In this harness it reads falsely HIGH — the harness
times render to render, so a throttled drag's deltas are the >= 100 ms gaps between the frames
that did render (plant C4: p95 1,265.8 ms over 5 drag frames); "low" holds only for the spike's
per-tick timing. The guard's purpose is unchanged: a throttled trial is invalid either way.]*

> H5 (a), H6 (a), H7 (a), H8 (a) — all as recommended. For H8, the picture pair comes to the
> owner for the eye check, same as ticket 10.

*[Dated note beside H6, 2026-09-24 (owner ruling on the plant report) — the cold check's ACTUAL
mechanism, superseding the warm-cache plant with grounds.* The dev server answers
`Cache-Control: no-cache` with a WEAK ETag, so the backend's default fetch receives full 206
bodies on every load, and even a force-cache load found none of the 123 chunk ranges stored:
cold holds on this server by its own headers, and the per-trial `?cb=` cache-buster is
belt-and-braces. The check's mechanism is therefore: every hero entry a 206 whose body crossed
the network (`transferSize >= encodedBodySize > 0`) AND at least one entry per chunk plus the
header probe (`heroEntries >= budget.pAsset + 1`) — the count is what catches bytes that arrive
with no request at all (a service worker, an in-memory cache). The "warm HTTP cache" plant is
SUPERSEDED — that fault cannot occur here — by the plant that answers one chunk without a
request (C5).]*
>
> F1 (a): record, do not fix. Write it into ticket 13 as a named finding with the measured
> numbers (84 renders on WebGPU, 18 on WebGL2, the E2 regime that produces it) and the exact
> contradiction with ThreeGsBackend.ts:819-820's stated rule. It joins the unminified embed as an
> OWNER item for the Phase 2 boundary — background-tab loading is a real user regime, so this is
> a product decision, not a telemetry nit. Do not silently change the reveal semantics
> mid-evidence-ticket.
>
> Doc 05: yes — one dated pointer line to D36, no rewrite.

Where recorded: H1-H8 as doc 06 **D36 ADDENDUM**; F1 as a dated note on doc 06 **D26** and the
named finding below; doc 05's pointer under its H-LOAD instrumentation line; a summary under
PLAN.md `## decisions`.

**F1 — NAMED FINDING, OWNER ITEM for the Phase 2 boundary (ruled 2026-09-24: record, do not fix).
The D26 reveal can fire on a paint that draws ZERO splats.**
- *The rule it breaks:* `src/backend/ThreeGsBackend.ts:819-820` — "Ready = the first paint AFTER
  the first page upload (a mesh with no pages paints empty — that paint must not count)". Under LOD
  selection a mesh WITH pages can also paint empty, and that paint counts: the ready predicate
  tests UPLOADED splats (`paged.uploadedSplats === 0`, `:823`), while nothing is SELECTED — so
  nothing is drawn — until chunk 0, the tree root, is resident (`src/backend/LodTraversal.ts:294-295`).
- *The regime that produces it (E2):* chunk 0's request held 3,000 ms (the backend's TEST-ONLY
  `fetchImpl` seam) and NO frame rendered for the first 2,500 ms of the load — a background tab's
  frame gap. With no traversal before the arrivals, the static index order admits every chunk,
  so pages land before the root.
- *Measured:* WebGPU — reveal with 9 pages resident, chunk 0 absent, 0 selected, 0 drawn; the
  first render with a non-empty selection **84 renders later** (93,372 selected). WebGL2 — reveal
  with 53 pages resident, chunk 0 absent, 0 selected, 0 drawn; the first selected render **18
  renders later** (1,606,328 selected).
- *Consequences when it happens:* `whenReady` resolves, the element's `ready` event fires, the
  loader reports progress 1, and ticket 12's `markSceneFirstSplatReady` (G4, wired to the reveal)
  records "first splat ready" — all with nothing on screen.
- *Not seen in normal loads:* once a traversal has run, only the root is admissible, so the first
  page is the root by construction (16/16 natural runs; E1 on both backends).
- *Owner framing:* background-tab loading is a real user regime — a product decision, not a
  telemetry nit. The reveal semantics are NOT changed in this ticket.

**OWNER ITEMS FOR THE PHASE 2 BOUNDARY — recorded here, not this ticket's to act on.**
1. The embed's shipping form — `dist-embed/embed.js` is unminified (ticket 12:721-731; ruling R6).
2. F1 above — whether the D26 reveal waits for a drawn splat.
3. `CONTEXT.md` via the owner's `/domain-modeling` (top of these Comments).
4. The opt-in telemetry price (added 2026-09-25, owner ruling on the post-trials stop) — bounded
   and repeatable but not small: up to +32.7 % first-pixel and +538 MB median peak heap in the
   constrained regime (`docs/plan/results/phase-2-hload.md`, "The cost of telemetry"); the
   `renderedSampleWindows` retune stop cites the same numbers.
5. The first-pixel construction fix (added 2026-09-26, owner ruling V1 a) — its own post-Phase-2
   ticket, in (b)'s shape: a placeholder mesh plus empty full-size storage inside D20's rules. The
   numbers: the header hook 90.2 ms (`?pages=32`) and 310.8 ms (default); the construction 242.9
   against the spike's 14.1 ms at 32 pages and 897.0 against 36.9 ms at 122 (17x, 24x); an ESTIMATE
   of about 85 of the 132.2 ms and 298 of the 321.1 ms same-day gaps; about 47 ms unexplained; the
   chunk-0-bytes stage 269.5 / 692.7 ms (longest tasks 231 / 822 ms) unattributed. Detail: "V1 —
   NAMED" below.
6. r186 adoption (added 2026-09-26, owner ruling V3 a) — its own post-Phase-2 ticket: the four
   breaking changes as its known scope, the dispositions of watch items 13, 5 and 10, and the six
   stale "unpublished" lines as its doc corrections. Detail: "V3" below.
7. The H8 visual-parity gap (added 2026-09-26, the owner's D16 eye check) — at pose A the pin is
   clearly sharper; ours is softer, with painterly swirls and splat-blob artifacts in flat areas;
   ours was captured at full quality. Diagnosis in a later ticket. Detail: "H8 — NAMED" below.
8. T2, the idle-throttle signal for capped sites (added 2026-09-26, owner ruling W2 b) — a later
   power ticket, opening with the fact that capped sites are a real-device regime: a WebGL2 device
   with `MAX_TEXTURE_SIZE` 4,096 fits 85 of the hero's 122 pages (computed, not measured), and a
   capped site never idle-throttles. Detail: the carried T2 item above.

*Post-ticket small changes* — a labeled sublist, distinct from the numbered owner items
(owner ruling 2026-09-27, below in these Comments); each is its own small change after this
ticket's commit:
- Widen `evict-readmit-pixel-identical`'s noise band — FINDING PL-1 (the STOP message's
  "band-widening on the post-ticket list").
- Convert the RS-1 line endings — ruling V4 b ("V4" below).
- Re-place the idle-heap reading in `examples/site-lab/hlife.ts` — after the collection rounds and
  outside `performance.memory`'s ~50 ms refresh window (OBSERVATION IH-1; owner ruling 2026-09-27,
  below).
- Require every stop's arrival (the rail at rest) in `e2e-every-stop-and-back` — it passes on the
  announced order alone (`examples/site-lab/hlife.ts:547-551`) — FINDING R1-F1 / R2-1 (owner
  close-out ruling 1, 2026-09-27).
- Fix the `gpu-leak` plant keeping the last runtime alive (`plantGpuLeak`, `hlife.ts:337`: 6 of 9
  collected in both three-plant runs, 9 of 9 without it; the cause not isolated from the other two
  plants) — R2-4 (close-out ruling 3).
- Clear `obs.runtime` even when `dispose()` throws — the dispose wrapper has no try/finally
  (`hlife.ts:293-299`) — R2-5 (close-out ruling 3).
- Fix pager-lab's drill-scan bound: `chunk < pAsset - 1` skips the last chunk as well as the root
  (`examples/pager-lab/main.ts:1060`) — R2-6 (close-out ruling 3).
- Guard pager-lab's drill picks against fewer than two resident candidates
  (`pager-lab/main.ts:1065-1066`) — R2-7 (close-out ruling 3).

**H3 RECOVERY ATTEMPT — DONE (2026-09-24, per ruling H3): NOTHING SURVIVES; falling back to (a).**
Method, read-only: a Python `http.server` on port 5209 serving an EMPTY scratch folder (no spike
code ran, no page script could write storage — `document.scripts.length` 0), started from a
temporary `.claude/launch.json` entry that was removed afterwards (the file restored
byte-identical: sha256 `222aaee44aea5febd717db61ab55b2b6b39ab545433b42cd3b095998a9d18503`
before and after; `.claude/launch.json` is git-ignored, `.gitignore:10`). In the built-in pane,
one `localStorage` read per origin — the spike's `STORE_KEY` is `native-rad-spike-trials-v1`
(`spikes/native-rad/src/measure.ts:109`) — returned, verbatim:

    {"href":"http://localhost:5209/","keys":[],"localStorageKeyCount":0,"origin":"http://localhost:5209","scripts":0,"spikeKeyPresent":false,"spikeRawLength":null}
    {"keys":[],"localStorageKeyCount":0,"origin":"http://127.0.0.1:5209","scripts":0,"spikeKeyPresent":false}

(`127.0.0.1` is a separate storage origin, so both were read.) For context only: the toolkit's
own origin `http://localhost:5173` in the same pane also holds 0 keys — that says nothing about
whether the pane keeps storage across sessions, since nothing is known to have written there.
**Consequence (ruling H3):** pixel ratio pinned to 1 and a fixed 1280x720 box; the bar comparison
carries the declared caveat that the spike's trial window size is unrecorded.

**HARNESS BUILT; EVERY CHECK SHOWN RED ON A PLANTED FAULT (2026-09-24). No counted trial has run.**
- Files: `examples/hload/index.html` (37 lines, sha256
  `8ecc354adb2ddc49af4a5197e435ccef7361f233d2efb41a8481bd55ef4c9516`), `examples/hload/main.ts`
  (901 lines, sha256 `28c2aebfe5a09c47f2b3d67ab45d6684a40e08fbf98104aff3f65a462e7f9630`), and one
  `hload` line in `vite.config.ts`'s input map. `tsc --noEmit` exit 0; `depcruise src examples`
  "no dependency violations found (185 modules, 612 dependencies cruised)". The full gate runs at
  the ticket's end.
- Plant switches are URL parameters (`?plant=<name>`), not source edits: a planted run is stored
  with its plant name and never aggregated or counted, and the code under test is byte-identical
  between planted and unplanted runs.
- **Environment:** Claude-in-Chrome was connected at session start (`list_connected_browsers` → 1
  local browser) but returned `[]` when the plants began, so the plants ran in the built-in pane.
  The pane is hidden and delivered NO animation frames (a live element showed `renderCount` 0
  after 54 s), so frames were pumped with the house doctrine — the scene's own `animate(now)`,
  ~16 ms apart — and ONLY while the renderer had an animation loop set, which keeps the `part`
  plant's no-frame window real. Every pane record is therefore also "contaminated": that is C1's
  own red, and the unplanted control shows it as its ONLY reason.

| check | plant | result — the record's `invalidReasons` / value, verbatim |
|---|---|---|
| C1 contamination (`measure.ts:194-198`) | page hidden from the start — the unplanted control `v=pane-hidden-1`, `?pages=32` | `["contaminated (the page was hidden)"]` and nothing else: budget pages 32 / override 32, backend webgpu, 123 hero entries all 206 and transferred, pose error 1.1e-15, three identical hashes `73139f2b`, first-pixel in the reveal render |
| C2 backend (H1/Q1) | `expect-other` | `"backend webgpu != expected webgl2-fallback"` |
| C3 regime applied (H1) | `no-override`, `?pages=32` | `"budget pages=122 override=null (asked 32)"` |
| C4 throttle never engaged (H4) | `no-input`, default regime, held in STABILITY until the product's gate skipped a frame | `"idle throttle skipped 65 frame(s)"` |
| C5 cold (H6) | `warm` (revised — see below), `?pages=32` | `"not cold: 122 hero entries (expected >= 123), 0 non-206, 0 not transferred"` |
| C6 pose (H2) | `pose-limit` — distance 250 against the element's `maxDistance` 200 (`SiteRuntime.ts:929-930`) | `"pose error 5.000e+1 / min dot 1.000000"` |
| C7 reveal/selection pairing (Q2) | `part` — E2 on the element | `rendersRevealToFirstPixel` 62 (reveal 3,363 ms, first-pixel 5,623 ms); a recorded measurement, not a validity check |

- **C5's first design could not go red, and why (measured):** `warm` first meant "no
  cache-buster". Two plain-URL runs (`plant-warm-1`, `-2`) transferred all 123 bodies. The dev
  server answers `cache-control: no-cache` with a WEAK ETag (`W/"213727632-1786004876920"`); a
  repeated 16-byte range fetched with `cache: "force-cache"` came from cache (`transferSize` 0),
  but a force-cache run of the whole load (`plant-warm-3`) found none of the 123 chunk ranges
  stored. So a warm HTTP cache cannot reach a trial on this dev server — cold holds by the
  server's own headers, and the per-trial cache-buster is belt-and-braces. What CAN put unfetched
  bytes into a trial is a chunk answered without a request (a service worker, an in-memory
  cache), which leaves no resource entry at all — invisible to per-entry tests. The check was
  therefore strengthened (every chunk plus the header probe must leave an entry:
  `heroEntries >= budget.pAsset + 1`) and the plant revised to answer the first non-root chunk
  from memory (`plant-warm-4`, red above).
- **C6's direction half** cannot fail alone through the camera system — the camera always looks
  at its pivot, so any orientation fault there moves the position first, which C6 shows failing.
- **C7 reproduces F1 through the product element itself** (the Q2 E2 runs were loader-level).
- **CORRECTION to the harness-design stop's H4 (2026-09-24):** it said a throttled drag would
  read falsely LOW. That holds for the spike's per-tick deltas; this harness measures render to
  render, where a throttled drag reads HIGH — C4's run: drag p95 1,265.8 ms over 5 drag frames.
  Distorted either way, which is what the guard prevents; the ruling stands.
- **Found while building — for the stop below:** (1) the load record DOES NOT EXIST on the
  element by default: SiteRuntime sets `telemetry: false` for visitors unless author mode or a
  site/host opts in (`src/embed/SiteRuntime.ts:2357-2373`), and neither the element nor
  lab.site.json opts in — measured: `recordFound` 0 on every run, and the origin has no
  IndexedDB database at all (`indexedDB.databases()` → `[]`); (2) Claude-in-Chrome disconnected.
  A side note, not touched: the store sink's database is still named `sparkjs-load-telemetry-v1`
  (`src/diag/sinkStore.ts:47`).

**STOP (2026-09-24) — before any counted trial.**
- **Telemetry and the "alongside" figures.** Rulings Q3 (the record's per-scene longest task) and
  H5 (the record's convergence verdict) put production-record figures beside the spike-method
  comparators; the element produces no record under the visitor default. The default is off on
  purpose — "the telemetry probe's snapshot-observation cascade dominating the load's main thread
  ... directly starves the detail fill-in" (`SiteRuntime.ts:2357-2362`; a Firefox profile,
  2026-08-07 — the same comment adds that the cascade's re-entrancy is fixed, so opt-in
  telemetry is "now bounded", `:2363-2365`: bounded, not free); the site's own opt-in is `settings.telemetry` (`:2366`, `:2369-2373`). (a) The
  counted trials at the VISITOR default (telemetry off — the product as a visitor gets it); the
  record-side figures from a SEPARATE opt-in set (lab.site.json's content plus
  `settings.telemetry`), labelled as its own configuration; the opt-in set's timings also measure
  telemetry's own load cost, ours against ours. (b) Every trial opted in: each carries its record,
  but the timings then include a probe cost the visitor never pays. (c) No record-side figures in
  this ticket: Q3's and H5's "alongside" go unmet, and the renderedSampleWindows retune loses its
  evidence. **Recommendation (a)**, with the opt-in set at the same 5 x 4.
- **Chrome.** (a) The owner reconnects Claude-in-Chrome (the Claude side panel in Chrome,
  signed in with the same account) and I drive, per Q1. (b) Fallback B: the owner opens
  `http://localhost:5173/examples/hload/?auto=1` in a visible tab and leaves it; the page then
  needs to show its report on screen for copying (not built yet — a small addition).
  **Recommendation (a).**

**OWNER RULINGS on the blockers stop (2026-09-24) — quoted verbatim.** The owner re-checked
`SiteRuntime.ts:2357-2373` and that lab.site.json carries no telemetry key before ruling.

> Stop 1 (a), as recommended: the counted H-LOAD trials run at the VISITOR DEFAULT — telemetry
> off, the product as shipped, because the bar is what a visitor experiences and the pin's own
> posture is that visitors don't pay for measurement. A SEPARATE full 5×4 opt-in set
> (lab.site.json copy with settings.telemetry, labeled as its own configuration, never mixed into
> the visitor medians) supplies: the record figures for Q3 and H5's "alongside", the 6.32x retune
> evidence, and — report it explicitly — the measured cost of telemetry itself, visitor-default vs
> opt-in on the same criteria. That delta is the empirical check on the comment's claim that
> opt-in telemetry is "now bounded"; if it isn't bounded in the numbers, that's a finding.
>
> Stop 2 (a): the owner is reconnecting Claude in Chrome now. When the connection shows up,
> proceed with the trials there — visible tab, read-only driving, the contamination flag and
> auto-rerun discard anything that goes hidden. If Chrome is still not connected when you're
> ready to run, STOP and report rather than falling back on your own; the owner will decide
> fallback B explicitly.
>
> Also ruled, from your report: the H4 correction (throttled drags read falsely HIGH here, not
> low) goes into the record next to the original ruling as a dated note — the guard's purpose is
> unchanged (a throttled trial is invalid either way), but the record must not carry my wrong
> direction. Same for the cold-check redesign: record the dev server's no-cache/weak-ETag behavior
> and the request-count guard as the check's actual mechanism, superseding the warm-cache plant
> with grounds.
>
> Then run: the full visitor-default trial matrix (both backends, both regimes, the spike's
> 5-trial medians with hidden/contaminated discard and re-run), then the opt-in set, then bring the
> complete H-LOAD results table — ten criteria against the phase-0 bar, each with its number and
> verdict — as the next report. No record schema changes, no product changes, and the F1 regime
> stays record-only per the earlier ruling.

Where recorded: Stop 1 and 2 as doc 06 D36 addendum item 11; the H4 and H6 notes beside their
rulings above (ticket 13) and beside D36 addendum items 9 and 10; the stop's own "falsely LOW"
corrected in place with the wrong word kept; a summary under PLAN.md `## decisions`.

**OPT-IN SET BUILT; ITS CHECK SHOWN RED BOTH WAYS (2026-09-24/25, per ruling Stop 1).** `?telemetry=1`
= the opt-in set: lab.site.json's content plus the site's own `settings.telemetry` switch
(`SiteRuntime.ts:2366`, `:2371`), under its own configuration names (suffix `-telemetry`) and its
own 60-attempt cap, so it can never enter the visitor medians. New check C8 (sets never mix): an
opt-in trial must leave exactly ONE new finalized load record, a visitor-default trial NONE. Plant
`telemetry-flip` inverts the site switch against the configuration's claim. Harness now
`examples/hload/main.ts` 932 lines, sha256
`663bcf685164e92a95104b1f8e95c136bc93ec64c1c4c68fa8c3dda0fce22e1f` (`index.html` unchanged);
`tsc --noEmit` exit 0; depcruise "no dependency violations found (185 modules, 612 dependencies
cruised)". Runs in the built-in pane (pumped, hence also "contaminated"), verbatim:

| run | configuration | result |
|---|---|---|
| `plant-telemetry-flip-visitor` | `webgpu-pages32` (telemetry secretly ON) | `"1 new load record(s) on a visitor-default trial (expected 0)"` |
| `plant-telemetry-flip-optin` | `webgpu-pages32-telemetry` (telemetry secretly OFF) | `"0 new load record(s) on a telemetry opt-in trial (expected 1)"` |
| `optin-control-pane` (no plant) | `webgpu-pages32-telemetry` | C8 passes (`recordFound` 1); the record figures populate: `recordFirstSplatMs` 3,027 against the D26 reveal 3,026.9 ms (ticket 12's G4 wiring, as designed); `renderedSampleWindows` 17 against 58 renders; terminal outcome "abandoned", `convergedProven` false; long tasks 0 on both sides — the hidden pane does not report them reliably (ticket 12), one more reason counted trials need a visible tab |

**Dev server:** the app had stopped `toolkit-dev` (no listener on 5173, `preview_list` empty);
restarted — fresh process 2026-09-24 23:56:54, confirmed on the port; still up after the date
changed (checked 2026-09-25 00:00:17).

**BLOCKER — the Chrome tab is HIDDEN (2026-09-25).** Claude-in-Chrome reconnected
(`list_connected_browsers` → 1 local browser, in use). The visitor-default matrix was started
(`?auto=1`), and the harness tab reported `visibilityState: "hidden"`, `hasFocus()` false at 5 s,
41 s and 49 s into the first trial; its HUD froze in STABILITY ("steady at 7929 ms, selected
2314382") — a hidden tab gets no animation frames. That trial was contaminated by definition;
it was ended by navigating the tab to a bare page before its 240 s deadline, so NO record was
written and no counted trial exists. A browser window that is minimized, behind another window,
or showing a different tab reads as hidden; the trials need that Chrome window in front, the
harness tab selected, and nothing covering it, for the whole run.

**BLOCKER CLEARED; COUNTED H-LOAD TRIALS DONE (2026-09-25) — 40 of 40 valid, none re-run. Results:
`docs/plan/results/phase-2-hload.md`. STOP below before any further evidence item.**

*Start state, verified first:* `git status --short` = handoff 013's seven entries exactly;
`examples/hload/index.html` sha256 `8ecc354a…` (37 lines) and `main.ts` `663bcf68…` (932 lines) —
the recorded hashes, so the harness was trusted, not re-proven; the Q2 probe `0d45c363…` (295
lines); HEAD `dbd1888` holds the handoff alone. Dev server: node pid 23092, started 2026-09-24
23:56:54, this repo's own Vite (its command line). sparkjs pin before-reading identical to handoff
013's: HEAD `fd67153`, the same seven status lines, `_metadata.json` 2026-09-21 02:21:37 / 4693 B.

*Chrome:* `list_connected_browsers` → one local browser, in use. This session had no tab group, so
tab `152174406` was created and parked on a blank page. **CORRECTION to handoff 013's procedure
(its step 3 and ENVIRONMENT line):** `http://localhost:5173/q2-probe-host` cannot serve as the blank
page for the store check. The dev server answers it 404 with an EMPTY body (`Content-Length: 0`),
Chrome substitutes its own error page, and that document's `self.origin` is `"null"` — the store
read threw `SecurityError: Failed to read the 'localStorage' property from 'Window': Access is
denied for this document.`, and `navigator.gpu` is absent there (visibility reads still work). The
blank page is now `http://localhost:5173/examples/site-lab/sites/lab.site.json`, a static JSON
document: origin `http://localhost:5173`, secure, 0 scripts. The committed handoff stays as written;
the memory note is corrected.

*The run.* At GO (2026-09-25 05:58:57 UTC): connected; the blank page read `visibilityState`
"visible", `hasFocus()` true; the store `null`. Visitor-default set started with
`?auto=1&v=auto-start` → HUD `ALL TRIALS DONE — 20 valid records (20 attempts).` (read 06:08:37 UTC).
Opt-in set started 06:10:15 UTC with `?auto=1&telemetry=1&v=auto-optin-start` → the same line, 20
of 20 (read 06:18:26 UTC). No trial went hidden, none was contaminated or re-run, and the
harness-side abort never fired.

*Monitoring, and one irregularity.* Tool-side waits and rare single reads. One read — a regex count
over the stored records — ran during the DRAG of `webgl-default-telemetry` v=`1790316805898` (the
HUD read "— DRAG" at 06:13:45 UTC). That trial's drag p95, 644.9 ms, is the highest of its five
(next 639.2) and is not the median (633.8); recorded, not discarded. From then on progress came from
the tab's address alone (`tabs_context_mcp`, no page contact).

*Environment:* Chrome 154.0.8037.57; WebGPU adapter nvidia / ampere, "NVIDIA GeForce RTX 3090 Ti";
32 logical processors; device pixel ratio 1.5; the window's inner size 1278x1270 in the first trial
and 1278x1214 after (the harness box is a fixed 1280x720 — canvas `1280x720@1` in all 40); an
extension's storage key (`-walletlink:…`) present on the origin, so at least one extension runs
script on these pages.

*Data and tables.* Chrome's store holds 40 records, 60,703 characters, sha256
`189f117b5f1ae2dc001e24937a688edcb33c377f767381a00080dffdaa4be39c`. The script tool truncates its
results at about 1 KB, so the tables were generated in the page by `.collab-logs/t13-hload-tables.js`
(git-ignored; 261 lines, sha256 `a80c04b697cf900843ec6f054a5bcf660d13e75b6433174f42687dc3bb14a45a`)
— an aggregation written independently of the harness's `report()`, which agrees with it on every
median and maximum — and read back with the page-text tool. The results doc was then fetched from
the dev server and every generated table found in it byte for byte; a one-digit change in either of
two tables made the same test fail (both `false`). The raw records exist ONLY in Chrome's storage
(S5). Two of this session's own citations were wrong before they reached any file and are recorded
here corrected: the bar's rows are `phase-0.md:33-36` (not `:31-34`; the header is `:31`, not
`:29`), and "Keep the pane VISIBLE" is handoff 002:35 (not 33, as told to the owner in chat).

*Results — full tables and per-trial data in the doc:*
- **first-pixel:** webgpu-default 1,624.3 vs 1,828 beats; webgpu-pages32 766.4 vs 1,043 beats;
  webgl-default 1,413.5 vs 1,423 matches (2 of 5 trials over); **webgl-pages32 703.0 vs 598 —
  REGRESSION, 5 of 5 trials over (677.3-714.5)**.
- **full-quality** 17,728.4 vs 48,027 and 15,523.7 vs 75,127 — beats; constrained **steady**
  2,047.4 vs 3,055 and 1,902.0 vs 4,349 — beats.
- **drag p95, longest task, peak heap** beat the bar in all four configurations.
- **criteria 2, 6, 8, 9 (selection half), 10:** ✓ in 20/20. **7:** the bar's result (count half ✓
  everywhere; hash half ✓ on webgl-default only). **3:** identical across every trial and both
  backends, but 2,314,382 / 603,256 against the bar's 2,500,000 / 729,351. **4:** within-trial ✓
  20/20; several hashes across trials everywhere — webgl-default 5 where the bar had 1 — and no
  diff band measured.
- **Q2** held in 40/40 (`rendersRevealToFirstPixel` 0).
- **Telemetry cost:** +225.2 to +270.9 ms first-pixel in all four; about +30 % to first-pixel and
  steady at `?pages=32`, +39.8 / +60.6 ms drag p95 there; +75 to +538 MB median peak heap;
  repeatable, no runaway.
- **Record alongside:** all 20 `abandoned`, convergence proven 0/20 — the trials leave the probe
  little quiet time (policy dwell 2,000 ms, `src/diag/policies.ts:6`). Renders per sample window
  8.82-10.10 / 6.50-7.22 / 2.42-2.49 / 1.97-2.06 (WebGPU default / WebGL2 default / WebGPU
  `?pages=32` / WebGL2 `?pages=32`).
  (**CORRECTED 2026-09-26:** these divide the whole trial's renders by the record's flagged sample
  windows of its LAST 5 s — different spans, so they are not frames per sample window; see stop W1.)

**STOP (2026-09-25) — after the counted trials. Four open items block the table's close under AC2,
plus one storage question (CLAUDE.md §8). Nothing below is built or run.**

- **S1 — how to diagnose the REGRESSION** (webgl-pages32 first-pixel, +105.0 ms). Evidence: all
  five trials over; first-pixel is the reveal render (Q2 held); the same regime on WebGPU beats its
  bar by 276.6 ms and the WebGL2 default matches its bar; caveats 1, 3 and 4 (window, browser, host)
  can each move timings in unmeasured directions, and nothing in these trials separates environment
  from integration. (a) A same-environment control with the spike's own instrument: serve
  `spikes/native-rad` (its dev server, port 5209 — a launch entry to add) and run its `?measure=1`
  trials for webgl-pages32 in this Chrome with its viewport at 1280x720, five clean trials by its own
  rules. About 700 ms → environment, and the regression is named as such; about 600 ms →
  integration, and (b) follows. The spike's numbers serve as a diagnostic control only, never a new
  bar. Cost: the owner fronts the window again, and the spike renders its full window, so its
  viewport must be set for the run (the Chrome window resized, or the spike hosted in a fixed
  1280x720 frame — the mechanism proposed before building). (b) A first-pixel breakdown in
  production — navigation → module start → element connected → `backend.load` → header → chunk 0 →
  first upload → reveal — for webgl-pages32 and webgpu-pages32, as a harness addition behind a URL
  switch (the production record schema untouched). It names where production's time goes but cannot
  say where the spike's went (the bar has no breakdown). (c) Name it "cause undetermined" with the
  evidence so far — does not meet AC2's "diagnosed". **Recommendation (a), then (b) only if (a)
  points at integration.**
- **S2 — the selection difference** (criterion 3's figures, and the caveat on every "beats" in
  full-quality, drag and heap). Evidence: both sides cap a frame at 2,500,000
  (`src/backend/LodTraversal.ts:55`, `spikes/native-rad/src/PagePool.ts:30`), so ours is not
  budget-bound where the spike's was; the refinement threshold is per drawing-buffer pixel (Q2:
  17,713 vs 12,189 at ratios 1.5 and 1); `phase-0.md:21` records 603,256 as a pre-trial `?pages=32`
  spot value at an unrecorded size. (a) Fold into S1(a): the spike at 1280x720 reports its own steady
  selection — equal to ours means the traversals agree and the difference is the window (H3's
  caveat, then measured). (b) Production in a larger box until it reaches 2,500,000 / 729,351 — shows
  direction, not the spike's size. **Recommendation (a).**
- **S3 — WebGL2 default hashes vary across trials** (5 in 5; the bar: one across all,
  `phase-0.md:52-53`). A lead only: the bar's ‡ note names arrival-order slot assignment as a source
  of cross-trial hash differences in its constrained regime (`phase-0.md:54-58`), and production
  decodes with a pool of `DECODE_POOL_SIZE = 4` workers (`src/backend/DecodePool.ts:26`) where the
  spike had one (`:1-4`). (a) Read production's slot assignment against the spike's, then measure it:
  two production WebGL2-default loads with the slot-to-chunk mapping read through the door, showing
  different mappings under identical selection; and add the spike's webgl-default to S1(a)'s control
  to see whether it still yields one hash today. (b) Record the difference with the lead,
  undiagnosed. **Recommendation (a).**
- **S4 — criterion 4's diff band** (not measured: the harness keeps hashes, not pixels). The
  criterion says "record the measured diff band, never a silent pass" (doc 05); the bar recorded
  mechanisms (†, ‡), not a band. (a) Measure it: keep the 64x64 readback pixels for a few loads per
  configuration and report the band across trials (maximum channel difference, share of pixels
  differing), built together with H8's picture-pair capture, whose mechanism is still to be chosen
  (handoff 013's item 4), so one capture path serves both. (b) Record the gap at the bar's own
  standard, with D16's picture pair as the visual check. **Recommendation (a), built with H8's
  capture.**
- **S5 — the raw records** live only in Chrome's localStorage; Phase 0's were lost exactly this way
  (H3). (a) Copy them into the repo beside the doc (`docs/plan/results/phase-2-hload-trials.json`),
  the copy proven exact by its sha256 matching the store's (`189f117b…`). (b) Keep them in Chrome
  only; the doc's per-trial table carries the fields most likely to be needed. **Recommendation
  (a).**

**OWNER RULINGS on the post-trials stop (2026-09-25) — quoted verbatim.** The owner verified the
results doc before ruling ("the regression row, the selection figures and both fingerprints match
your report").

> Rulings on the five open items, plus the parallel-work question. The results doc verified here —
> the regression row, the selection figures and both fingerprints match your report.
>
> 1 (a), as recommended: run the spike's own measuring page in Chrome, same 1280x720 box at ratio 1,
> five trials, TODAY — a control, never a new bar, recorded as such. Decision rule stated before the
> run, in the record: spike reads ~700 ms → environment, the regression verdict becomes "environment
> drift, both stacks equally affected, bar re-dated"; spike reads ~600 ms → our code, and you then
> instrument our first-pixel path stage by stage on webgl-pages32 and bring the breakdown as a stop.
> The owner will front the window again when you're ready — announce it and wait for go.
>
> 2: the same control run answers it, as you said. If the spike at 1280x720 selects 2,314,382 /
> 603,256, the window-size explanation is PROVEN and the criterion-3 caveat becomes a footnote with
> the measurement; if it doesn't, that's a finding and a stop.
>
> 3 (a): read both codebases on decode-order determinism first (DECODE_POOL_SIZE 4 vs the spike's
> 1), then measure — one temporary run with the pool pinned to 1 worker via whatever existing seam
> allows it. If no seam exists, STOP and ask before adding one; do not modify product code for this
> without a ruling. If pool=1 yields one hash across trials, the mechanism is proven and recorded;
> the pin's own bar showed 1 hash, so this also answers whether criterion 4's "5 distinct" is our
> concurrency or something else.
>
> 4 (a): measure the cross-trial difference band with the same capture method as H8's picture pair,
> so criterion 4 gets a number instead of a hash count. Report the band; whether it passes is judged
> against the bar's own footnoted behavior, not a threshold invented now.
>
> 5 (a), emphatically — Phase 0 lost its raw records exactly this way: copy all 40 raw trial records
> out of Chrome's storage into the repo beside the results doc (docs/plan/results/, a name matching
> the doc's convention), with the stored fingerprint recomputed over the repo copy and shown equal.
> The doc already cites the fingerprint, so the copy is verifiable forever. This is trial evidence,
> not code — it belongs in the ticket's single commit like everything else.
>
> Telemetry cost: your reading is accepted and the table stands — bounded and repeatable, but not
> small (up to +33% first-pixel, +538 MB heap in the constrained regime). Add "opt-in telemetry
> price" to the owner-items list for the Phase 2 boundary alongside the embed, F1 and CONTEXT.md; the
> 6.32x retune stop later in this ticket should cite these same numbers.
>
> Parallel work: yes — start the r186 re-check (report-only, never touch the vendored files) and the
> re-sync audit against fd67153 (always git show, never the sparkjs disk) now; neither depends on the
> rulings above. Bring their findings in the same report as the control-run results.

Where recorded: here; doc 06 **D36 addendum item 12**; the opt-in telemetry price as owner item 4 in
the list above (dated); PLAN.md `## decisions` and tasks.

**CONTROL RUN — the plan and its decision rule, written down BEFORE the run (2026-09-25, rulings
1-2; the spike half of ruling 3).**
- *Instrument:* the spike's own measuring page, `spikes/native-rad` as committed at `e738ba6`
  (2026-08-19, the Phase 0 close — its only commit after the 2026-08-16 trials; the working tree has
  no spike change), served by its own Vite 6.4.3 dev server on port 5209, three 0.185.1. Hero URL
  per trial `/@fs/…/lab-sh1-sparsity.rad?v=<unique>` (the spike's cold-cache rule).
- *Size:* the spike renders its whole window and re-sizes and re-traverses on every window resize
  (`spikes/native-rad/main.ts:472-477`; "pixelScaleLimit depends on render height"); during the
  counted trials the Chrome page area changed height (1214 at GO, 1270 at the first trial's end, 1214
  from the second on), so resizing the Chrome window is NOT used. The spike page runs in a fixed
  1280x720 frame (border 0) inside a script-free document of the spike's own origin, so its window
  is 1280x720 whatever Chrome's bars do; measure mode pins pixel ratio 1 (`main.ts:208`). Every
  record carries the spike's own `windowW`/`windowH` as proof.
- *Trials:* manual mode (`?measure=1`, one trial per load, a fresh `v` each): **webgl-pages32 × 5
  clean** (ruling 1's control; ruling 2's constrained selection), then **webgl-default × 5 clean**
  (ruling 2's default selection; whether the spike still yields one hash today). A contaminated
  trial is re-run. Read with the spike's own `__measure.report()` and its per-trial records.
- *Decision rule, ruling 1 (the owner's words):* the spike's first-pixel median reads ~700 ms →
  "environment drift, both stacks equally affected, bar re-dated"; ~600 ms → our code, and the
  first-pixel path is instrumented stage by stage on webgl-pages32 and brought as a stop. Reference
  points: our five trials 677.3-714.5 ms (median 703.0); the bar 598. A median that is clearly
  neither — between the two — gets no verdict: it comes back as a stop with the numbers (rule 11).
- *Decision rule, ruling 2 (the owner's words):* the spike selecting 2,314,382 (default) and 603,256
  (`?pages=32`) PROVES the window-size explanation, and criterion 3's caveat becomes a footnote with
  the measurement; any other figure is a finding and a stop.
- *Recorded as a control:* the spike's numbers are never a new bar; the Phase 0 medians stay the bar
  unless ruling 1's environment branch re-dates it.

**Ruling 3 — the reading, done (2026-09-25): decode order in the two codebases.**
- *Both* give a decoded chunk the FIRST FREE slot (`src/backend/PagePool.ts:187-195`, the free-slot test at `:215`;
  `spikes/native-rad/src/PagePool.ts:167`, `:178`), so the order decodes
  complete decides which chunk occupies which slot; the bar's ‡ note ties within-bin order to splat
  index, i.e. to slots (`phase-0.md:54-58`).
- *The spike:* one worker, one decode at a time (`decodeBusy`), and the next chunk is chosen in
  PRIORITY order among chunks whose bytes have landed (`chooseChunk`,
  `spikes/native-rad/main.ts:301-311`); arrival order matters only in the free-page warm-fill branch.
- *Production:* each admitted chunk is submitted the moment its bytes ARRIVE (network order, via
  `prefetchAll`), to a pool of `DECODE_POOL_SIZE = 4` workers (`src/backend/DecodePool.ts:26`), and
  is inserted when ITS decode completes (`src/backend/RadPager.ts:213-227`); deferred chunks are
  re-admitted later, up to four in flight (`src/backend/ThreeGsBackend.ts:1071-1076`).
- *Prediction from the reading, stated before any measurement:* pinning the pool to one worker
  removes concurrency but keeps arrival-order submission, so hashes may STILL vary — the measurement
  would then say "arrival order, not concurrency".
- **No existing seam pins the pool.** `ThreeGsBackendOptions` has no pool option; the backend
  builds `new RadPager(url, { createWorker, signal, fetchImpl? })` with no `poolSize`
  (`ThreeGsBackend.ts:729-733`), though RadPager itself takes one (`RadPager.ts:53`); re-admission
  caps at the constant `DECODE_POOL_SIZE` (`:1076`). Per ruling 3: STOP before adding one — the
  options go to the owner with the control run's announcement.

**RAW RECORDS — DONE (2026-09-25, ruling S5).** All 40 records left Chrome byte-exact through a
loopback-only receiver (`::1:5299`, a script in the session scratchpad started from a temporary
`.claude/launch.json` entry — the file's original bytes, sha256 `222aaee4…`, are kept for exact
restoration): 60,703 bytes sent and received, the receiver's sha256 equal to the page's own. The
repo copy `docs/plan/results/phase-2-hload-trials.json` — 60,703 B, no CR, ASCII only, one line —
hashes to `189f117b5f1ae2dc001e24937a688edcb33c377f767381a00080dffdaa4be39c`, exactly the fingerprint
the results doc cites; 40 records, 40 valid, 8 configurations.

**r186 RE-CHECK — DONE, report-only (2026-09-25; AC5; the parallel-work ruling). No vendored file
touched: all three still hash to FORK.md's digests.**
- *Published.* `npm view three version` → `0.186.1` (checked 2026-09-25 07:12 UTC): `0.186.0`
  published 2026-09-08T19:25Z, `0.186.1` 2026-09-24T14:42Z. Stale since then, NOT edited here: doc 06
  watch item 13's "Checked 2026-08-19: NOT published", and the repo `CLAUDE.md` line "r186 is not
  published" (the owner's file).
- *Method* — FORK.md "Per-release re-diff procedure", report-only: the npm tarball
  `three-0.186.1.tgz` and the upstream files at `da05705` (inside the snapshot window) and at tag
  `r186` (`48dd7be`) fetched into the session scratchpad. The tag's addon files equal npm 0.186.1's.
- *Steps 2-3, per file.* `CountingSort.js` — byte-identical to r186 (`e9e90b69…`).
  `GaussianSplatUtils.js` — ours = upstream at the snapshot, byte for byte; r186 has 229 lines
  against our 406, the change being `cf613a3` (#34278: PLY parsing moved into
  `GaussianSplatPLYLoader`). `GaussianSplatMesh.js` → r186 `objects/GaussianSplat.js` (1,039 lines
  against 769): ours = upstream@`da05705` plus `[flatten-imports]` EXACTLY (the two specifier lines,
  FORK.md:82-86); upstream snapshot → r186 is `9a5e800`, `ef58888`, `97adf2e`, `3afdbd3`, `047f268`,
  `5d5ebcf` (FORK.md's drift list, all six), `919539e` (#34384) and `c550966` (#34284, raycasting) —
  each confirmed inside the r186 tag (GitHub compare "ahead"; two needed full hashes). Every hunk is
  attributable.
- *Step 3a, internal surfaces.* Every FORK.md-inventoried name persists in r186 except three
  reshapes: (1) colour storage — Float32 vec4 (bytes/255) becomes one packed RGBA8 `Uint32Array`
  word per splat (`3afdbd3`; `storage(colorAttribute, 'uint', count)`), so `[paged]`'s colour upload
  needs rework at adoption (a quarter of the colour memory upstream); (2) `_needsSort` is
  direction-only, in model-view space, and `SORT_POSITION_THRESHOLD` 0.0025 no longer exists
  (`9a5e800`) — `[selection]`'s mirrored hysteresis constants and this ticket's harness pose
  tolerance, which cites them, lose their upstream counterpart for position; (3) `computeBoundingBox`
  / `computeBoundingSphere` and frustum culling (`ef58888`) — the collision FORK.md flagged with the
  backend's pager-AABB culling. Core surfaces present in 0.186.1: `renderer._attributes` and
  `Attributes.delete`, `DualAttributeData`, `setupPBO` / `.pbo`, `backend.device`, `gl.deleteBuffer`.
- *Also broken at adoption:* `src/backend/ThreeGsBackend.ts:6-8` imports `SH_DEGREE_TO_COMPONENTS`,
  `createGaussianSplatGeometryFromPLYGeometry` and `getGaussianSplatPLYPropertyMapping` (used at
  `:443`, `:1338`, `:1362`, the monolithic PLY path); r186's utils no longer export them.
- *Watch list (doc 06 :764-818) against r186.* (**CORRECTED 2026-09-26, record gap RG-2:** the
  list moved when D36 item 12 and its follow-up were inserted — doc 06 :801-855 when the owner
  ruled — and moved again the same day with the notes added to D29, D35 and D36 on 2026-09-26: it
  is now doc 06 :889-943, item 13 at :921. The original citation is kept. Moved again 2026-09-27 by D36 item 12's fourth follow-up: doc 06 :1036-1090, item 13 at :1068. Moved again 2026-09-27 (close-out) by D36 item 12's eighth follow-up: doc 06 :1063-1117, item 13 at :1095.) FIRED: **13** (r186
  publishes; its tied SPZ gap can
  close — `examples/jsm/loaders/SPZLoader.js` ships); **5** (`raycast`, `c550966` — it loops EVERY
  splat on the CPU over the source geometry's position/covariance/colour arrays, which the paged mesh
  does not maintain: FORK.md:181-184, `patches/paged.ts:16`; unusable on the paged path as it stands,
  though doc 03 §B's premise "upstream has zero", `03-capability-specs.md:105`, is now false);
  **10** (`@types/three` 0.186.0, 2026-09-11, ships `GaussianSplat.d.ts`, `GaussianSplatUtils.d.ts`,
  `CountingSort.d.ts` and all five splat loaders). NOT fired: 1 (no `.rad`, paging or streaming),
  2 (no append/resize/capacity API), 3 (no public buffer access — the only new methods are the two
  bounds methods and `raycast`), 4 (no `dispose()`), 6 (no new hooks), 7 (no global sort), 8 (no
  worker in the addon), 9 (none of the five new loaders uses a worker; their `onProgress` is download
  progress), 12 (still `examples/jsm`; the rename landed as recorded). Item 11: `RenderPipeline` and
  `PostProcessing`'s deprecation are already in 0.185.1 and `SceneGrade` already uses
  `RenderPipeline` — nothing new. Item 14: Spark 2.2.0 (2026-09-11; the pin used 2.1.0) has no
  `WebGPURenderer` anywhere; `SplatPager` was already exported in 2.1.0 and 2.2.0 only narrows its
  declaration (readonly fields, internals dropped) — not fired. Item 15: not applicable.
- *Not on the watch list:* four more splat loaders ship — `SPLATLoader`, `KSPLATLoader`,
  `GaussianSplatPLYLoader`, `GLTFGaussianSplatLoaderExtension`.
- *AC5 wants each fired item answered "delete our code" or a recorded reason not to* — proposals go
  to the owner in the report.

**RE-SYNC AUDIT against `fd67153` — DONE (2026-09-25; ruling R5).** Stored blobs compared: ours at
HEAD `dbd1888` (no uncommitted `src/` change) against the pin through `git ls-tree` / `cat-file`,
never the sparkjs disk.
- 128 paths exist in both trees. **93 are byte-identical** — every shared file in `src/cells` (9),
  `src/rules` (10), `src/site` (29), `src/text` (11) and `src/locative` (2), plus 14 in `src/diag`,
  8 in `src/ui`, 4 in `src/core`, 4 in `src/embed`, 2 in `src/render`.
- 11 differ as each repo's own config and docs (`.gitattributes`, `.gitignore`, `CLAUDE.md`, three
  `docs/agents/*.md`, `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, and
  `vite.embed.config.ts` — written "in sparkjs-toolkit's vite.embed.config.ts shape" with its own
  history in its header, tickets 02/03/09 and D14) — not copies. The other 24 differing paths: 5
  example files and 19 `src/` files, all below. (Told to the owner in chat as "twelve" config/docs
  and "18" `src/` files — CORRECTED 2026-09-25: 11 and 19; 11 + 5 + 19 = 35.)
- **FINDING RS-1 — three `src/` COPY files differ from the pin ONLY in line endings:**
  `src/core/CameraPath.ts`, `CameraRail.ts` and `LoadingUI.ts` are stored CRLF where the pin stores
  LF; content identical. Their recorded copy-time SHAs ARE the pin's content as CRLF (e.g.
  CameraPath `0a38edb7…`), so they were copied from sparkjs's disk checkout (CRLF under autocrlf) and
  never changed. `src/core/CameraSystem.ts` (ADAPT) has the same origin — recorded `9de48f10…` = the
  pin as CRLF — plus its 24 declared content lines. The standard for COPY files is "byte-identical to
  `git show fd67153:<path>`"; these meet it in content, not in bytes. NOT fixed: the owner's call.
  (`examples/shared/sandbox-styles.css` is CRLF-only too, but the owner's ruling at phase-1 ticket 04
  — cited in the example headers — binds byte identity to the `src/` COPY files only.)
- *COPY-class files that differ in content, each matched to its ruling by reading the diff:*
  `diag/LoadRecord.ts` (semantics `"1"`→`"2"`, `engineVersion` — ticket 12, D35);
  `diag/LoadProbe.ts` (+`renderedSampleWindows`, 21 lines added, none removed — ticket 12 G2, D35
  item 5); `diag/dev/selfTest.ts` (−185/+112: the fixture and fault-replay tests removed with those
  files, B1; the denominator guard added, G2); `src/index.ts` (the trimmed barrel — every change cited
  in its own header: D24, the deferred sources by phase, tickets 09/11, D21, D28).
- *ADAPT / REBUILD / stub files (doc 01's classification), each declared:* `CameraSystem` (D22 plus
  the §B dead recenter — read in full), `MediaLayer` (ticket 09's declared fix — read in full),
  `FrameDiffValidator` (ticket 07's type widening — read in full), `EnvironmentLoader` (ticket 08's
  declared adaptation), `SplatHighlight` (the D27 inert stub), `SplatTextMesh` (the D19 stub),
  `SiteRuntime` (50 hunks; the 10 with no citation nearby each traced to tickets 03/08/09/11 — e.g.
  `pagedExtSplats` "DELETED — D24's zero-consumer evidence", ticket 09:317). Checked at DECLARATION
  level (file headers and tickets), NOT hunk by hunk: `SceneGrade` (48 hunks), `diagWiring` (27),
  `SplatLoader` (22), `SplatBounds` (16), `StatsHUD` (10), and the example pages `rail/` and
  `text-lab/` ("ADAPTED … by design", ticket 04's ruling). A mechanical scan found 312 hunks, 157 with
  a citation within 12 lines; the other 155 sit inside those whole-file declarations or are deletions
  under a file-level ruling.
- *One-sided files.* 9 pin-only `src/` files: `SparkScene` (rebuilt as `ThreeSplatScene`),
  `CropTool`, `SceneComposer`, `DebugPanel` (Phase 3) and `SplatExporter` (Phase 4) per the barrel's
  deferred-sources header; `SparkPagerAdapter`, `faultInjector`, `fixtures/fixtureTypes.ts`,
  `fixtures/lab-load-001.json` deleted by ticket 12 (B1, G6). 23 ours-only `src/` files are native
  (backend 12, the vendored fork 8, `ThreeSplatScene`, `colorSpace`, `PagerTelemetrySource`).

**STOP (2026-09-25) — ruling 3's seam, and ruling 4's capture method. Nothing built for either.**
- *Ruling 3 — no existing seam pins the decode pool* (reading above). (a) Add a TEST-ONLY
  `decodePoolSize` option to `ThreeGsBackendOptions` (the `fetchImpl` / capacity-override pattern):
  passed to RadPager's existing `poolSize`, capping `kickAdmissions`' limit, set through the harness's
  load hook as H1 sets the budget — a small product change, red-first. (b) No product change: record
  each WebGL2-default trial's chunk→slot map through the door's EXISTING read-only `slotOf(chunk)`,
  beside its hash and each chunk's arrival order (resource timing), in a git-ignored probe; the
  mechanism holds if hashes differ exactly when maps differ, and map-versus-arrival order says whether
  concurrency or network order drives it. (c) Canonicalize the map through the existing TEST-ONLY
  `evictChunk` / `admitChunk` at steady (evict all, re-admit in chunk order) and show one hash —
  exposed to the backend's own admissions interleaving. **Recommendation (b)** — it observes the
  mechanism directly with no new seam and answers the concurrency question the ruling asks; the
  reading predicts that (a)'s one-worker run alone may still vary, since arrival order does.
- *Ruling 4 — the capture method, never chosen (handoff 013's H8 item: "propose before building").*
  (A) In-page readback of the full 1280x720 drawing buffer at steady, pose A, through three's own
  render-target readback; the band across trials (largest channel difference, share of pixels that
  differ) computed in the page from repeat loads per configuration; H8's two canvases encoded as PNG in
  the page and moved out byte-exact through the same loopback receiver as the raw records, to a place
  the owner names (CLAUDE.md §8). (B) Claude-in-Chrome screenshots saved to disk — the displayed,
  DPR-scaled pixels: enough for an eye check, useless for a numeric band. **Recommendation (A)** — one
  capture path gives the band its numbers and H8 its images.

**CONTROL RUN — READY, not started (2026-09-25).** The spike's server runs on 5209 (a temporary
`native-rad-spike` launch entry; Vite 6.4.3 ready, no errors); the built-in pane's tab is parked on a
bare page. In Chrome, tab `152174406` is on the spike's origin with a script-free host holding a
fixed 1280x720 frame (border 0) whose window reads exactly 1280x720; the spike's store
`native-rad-spike-trials-v1` is empty. Added to the plan above, for the owner to object to before
"go": ONE uncounted warm-up load first (`v=warmup-1`, excluded from every figure), so the freshly
started server's first module transforms and Chrome's first fetch of the spike's modules do not land
inside a counted trial — our own trials ran against a long-running server.

**OWNER RULINGS at GO (2026-09-25) — quoted verbatim.**

> GO — with the warm-up load as you proposed (one uncounted load first; our own trials ran against
> a long-warm server, so the control must too). Both decisions:
>
> Item 3 (b), as recommended: no product change. Record the chunk-to-slot map from the diagnostics
> door in every WebGL2 trial, beside the trial's hash and the network arrival order. The mechanism is
> shown if hashes differ exactly when maps differ; the map-vs-arrival comparison then separates the
> two suspects (4-worker completion order vs network order). Your reading that a one-worker pool
> would still vary with arrival order is exactly why (a) wouldn't have isolated anything — record
> that grounds with the ruling.
>
> Item 4 (A), as recommended: in-page readback of the full 1280x720 picture, the difference band
> computed in the page, and the H8 picture pair saved as PNGs through the same byte-exact receiver.
> Folder: docs/plan/results/phase-2-hload-pictures/ — evidence beside the results doc and the raw
> records, part of the ticket's single commit. Record each PNG's sha256 next to it so the eye-check
> pair is fingerprinted like everything else.
>
> Run order as you laid out: warm-up (uncounted), 5 webgl-pages32 trials, 5 webgl-default trials,
> decision rules exactly as pre-written in the ticket — ~700 ms environment, ~600 ms our code with a
> stage-by-stage breakdown to follow as a stop, in-between comes back unverdicted. Selection figures
> either prove the window-size explanation (2,314,382 / 603,256) or become a finding.
>
> One report-only addition for the close-out findings: I verified independently that three
> 0.186.0/0.186.1 are published and 0.186.1 is the latest tag — the "addon not in any published
> release" lines in README.md and the docs are stale as of 2026-09-08. Record it as a finding with
> the dates; do not edit the README mid-ticket, it belongs with the r186 findings for the owner.
>
> After the control run: the full report — control verdicts on items 1 and 2, the slot-map evidence
> for item 3, the band and picture pair for item 4, and the complete r186 and re-sync findings held
> back until now. Stops where rulings are needed, as ever.

Grounds recorded with ruling 3(b), as the owner asked: option (a) — pinning the decode pool to one
worker through a new seam — would not have isolated anything, because production submits each chunk
the moment it ARRIVES (network order, `src/backend/RadPager.ts:213-227`); a one-worker pool removes
the concurrency but keeps arrival-order submission, so its hashes could still vary for the network's
reason. Where recorded: here; doc 06 D36 addendum item 12's follow-up note; PLAN.md.

**CONTROL RUN — DONE (2026-09-25 07:40-07:50 UTC). A control, never a new bar.** The spike's own
measuring page (`spikes/native-rad` at `e738ba6`, its Vite 6.4.3 dev server on 5209) ran in the
owner's Chrome, in a fixed 1280x720 frame inside a script-free host of the spike's own origin; every
record carries `window` 1280x720 and `pixelScaleHeight` 720; `visibilityState` "visible" at every
check; none contaminated; every trial range-only, 122/122 chunks. One uncounted warm-up
(`warmup-1`, excluded below), then `ctl-p32-1..5`, then `ctl-def-1..5`. The spike's store: 11
records, 8,135 characters, sha256 `2bcd46d782dfe76bff83929b0e53f857c728e7cc5e6831911bbb85c9d3a5bf26`.
Figures computed in the page from the stored values with the spike's median rule, warm-up excluded:

| config (spike, same-day control) | first-pixel median (trials) | full-quality / steady | selected | hashes across 5 | restore hash | drag p95 | longest task max | heap max |
|---|---|---|---|---|---|---|---|---|
| webgl-pages32 | 570.8 ms (487.7-599.6) | steady 3,396.4 ms | 603,256 (5/5) | 2 | 0/5 | 144.8 ms | 164 ms | 900 MB |
| webgl-default | 1,092.4 ms (1,055.6-1,169.7) | full-quality 54,163.3 ms | 2,314,382 (5/5) | 1 | 5/5 | 636.1 ms | 772 ms | 1,855 MB |

- **Verdict, ruling 1 — OUR CODE.** The spike reads 570.8 ms: "~600" by the pre-written rule (not
  between the reference points 598 and 703.0 — below both). Production's webgl-pages32 first-pixel,
  703.0 ms, is 132.2 ms slower than the spike in the same browser on the same day. Per the rule, our
  first-pixel path is next instrumented stage by stage on webgl-pages32 and the breakdown comes back
  as a stop.
- **Verdict, ruling 2 — PROVEN.** At 1280x720 the spike selects 603,256 (`?pages=32`) and 2,314,382
  (default) in every trial — production's figures exactly. The selection difference from the bar was
  the window size (H3's caveat, now measured); criterion 3's caveat becomes a footnote with this.
- **For ruling 3:** the spike's webgl-default still yields ONE hash across all five trials (and its
  restore hash matches 5/5), as in Phase 0 — so production's five distinct hashes are production's
  own behaviour, not the browser's. Its webgl-pages32 shows two hashes across five, as the bar's ‡
  note records.
- **FINDING C-1 — the environment moved the bar, and one "match" hides a gap.** The same-day spike is
  faster and lighter than its own Phase 0 figures: first-pixel 570.8 vs 598 (pages32) and 1,092.4 vs
  1,423 (default); full-quality 54,163.3 vs 75,127; heap 1,855 vs 2,887 MB (default). Against the
  SAME-DAY spike, production's webgl-default first-pixel (1,413.5) is **321.1 ms slower** — the
  table's "matches" against the Phase 0 bar hides it. Other same-day pairs (production vs spike):
  full-quality 15,523.7 vs 54,163.3; drag p95 635.6 vs 636.1 and 136.4 vs 144.8; longest task 765 vs
  772 and 156 vs 164; heap max 2,020 vs 1,855 (default, production +165 MB) and 842 vs 900 (pages32).
  Not resolved here: the control is never a new bar (ruling 1), and whether this changes any verdict
  is the owner's call. No same-day control exists for the WebGPU configurations. *Decided 2026-09-27 (owner close-out ruling 5):* the Phase 0 bar is kept, with this finding as a dated note — the WebGL2 default's "match" (1,413.5 against 1,423) is 321.1 ms behind the same-day spike (1,092.4); the control is never a new bar (ruling 1 stands); the bar's re-dating belongs to owner item 5. Also a dated Readings bullet in the results doc.

**CONTROL RECORDS PRESERVED (2026-09-25, S5's reasoning applied to the control):** the spike's 11
records left Chrome byte-exact through the receiver — `docs/plan/results/phase-2-hload-control-trials.json`,
8,135 B, sha256 recomputed over the repo copy = `2bcd46d7…` above. sparkjs after the spike server:
unchanged (HEAD `fd67153`, the same seven status lines, `_metadata.json` 2026-09-21 02:21:37 /
4693 B, the hero asset unchanged).

**INSTRUMENTS for rulings 1, S3 (b) and S4 (A) — BUILT and logic-tested (2026-09-25).** Git-ignored
and fingerprinted, on the Q2 probe's precedent; the harness stays byte-identical, since its bytes
produced the counted trials (the results doc cites them). Neither page changes product code.
- `.collab-logs/t13-diag.html` (sha256 `7120bf142d9e1340ddd472a77ebb3a213334127bad433debee3a332bbe699594`)
  + `.collab-logs/t13-diag.ts` (629 lines, `c40b39e650cf717f40aa0cf8544266db9cdd353093cc0b949332b287e969280c`):
  boots the element exactly as the harness does and ends at the harness's steady point. Records:
  stage timestamps (navigation, module start, element appended, runtime seen, scene ready, `load()`
  called, header request and body, chunk 0 request and body, chunk 0 decode post and reply, first
  render, first upload seen, reveal, first-pixel, element `ready`, full-quality, steady); the chunk →
  slot map through the door's read-only `slotOf`; the network arrival order (the backend's existing
  TEST-ONLY `fetchImpl` set to a PASS-THROUGH that timestamps each Range request and the moment its
  body is read); the insertion order at a full budget (no eviction, so slot order is insertion
  order); decode posts and replies per chunk (the page's `Worker` class wrapped — both messages carry
  `index`); the harness's own 64x64 hash three times; ONE full-frame capture read from the canvas in
  the same task as the steady render (PNG kept in IndexedDB). `?auto=1` runs webgl-pages32,
  webgl-default, webgpu-default, webgpu-pages32, five clean trials each, re-running any that was
  ever hidden; `?band=1` computes the band in the page; `?export=<v>&name=` posts one capture to the
  receiver.
- `.collab-logs/t13-h8.html` (`0493cebf76229f396018aa29d6ac7fe27c9b797d2e38d4551c03af2b3146eaf8`) +
  `.collab-logs/t13-h8.ts` (227 lines, `10c5ac2ff6ec336c934d312ca17dac667d78acdfac2a15f914e087d335148de2`)
  — H8's ONE shared page, copied byte-identical into the pin snapshot's root. Both sides: the element,
  the 1280x720 box, ratio 1, pose A before every render, the same capture function, the PNG POSTed
  to the receiver (sha256 compared). Ours captures at the harness's steady point through the door;
  the pin, which has no door, after `ready`, load progress 1 and a 5 s settle, capped at 60 s after
  `ready` — the record says which fired.
- *Logic tests in the built-in pane* (hidden, frames pumped — no timing from them is citable): every
  diag field populated at `?pages=32` on WebGL2 and on WebGPU (a 122-entry slot map with 32 resident,
  the arrival order of all 122 chunks, chunk 0's decode post and reply, 123 hero requests all 206,
  three identical hashes, a 1280x720 capture); a WebGPU canvas IS readable in the same task as its
  render (the capture opened and viewed: the lab scene at pose A); the export path is byte-exact
  (receiver sha256 equal); H8 captured on ours (WebGPU, steady, 2,314,382 selected) and on the pin
  (`ready` and load progress 1 both at 6,720 ms, captured at 12,227 ms), both viewed — the same pose.
  TWO faults found by testing and fixed, each re-tested on BOTH sides: (1) a LITERAL dynamic-import
  path made Vite fail to compile the page on the pin (HTTP 500, "Failed to resolve import"); (2) the
  first fix, a COMPUTED path, was rewritten by Vite to `…/ThreeGsBackend.ts?import` — a SECOND module
  instance, so the hook never reached the element's backend (measured: two module URLs, the
  element's copy unhooked, no capture after ~80 s of frames). The import is now hidden from Vite's
  analysis, so the browser asks for the plain URL: one module URL, the element's instance hooked,
  the ours capture fired; the pin side captured with the same final bytes. The pane images are test
  artifacts only — the pair is taken in Chrome, like the counted trials.
- sparkjs before the pin snapshot server (2026-09-25 03:07:14 local): unchanged from the session's
  first reading.

**OWNER RULING at the second GO (2026-09-25) — quoted verbatim.**

> GO. Run the session as you laid it out: the ~20 self-running diagnostic loads (WebGL2 pages32 for
> the breakdown, WebGL2 default for the slot maps, both WebGPU configurations for the band), then the
> three H8 picture captures (ours WebGPU, ours WebGL2, the pin).
>
> One addition to the breakdown's scope, from C-1's implication: the stage-by-stage first-pixel
> breakdown must cover BOTH WebGL2 configurations, not only pages32. Against the same-day spike,
> webgl-default is 321.1 ms behind (1,413.5 vs 1,092.4) — a larger same-day gap than the pages32
> regression's 132.2 ms. It only looked bar-matching because Phase 0's environment was slower. If the
> stages show one shared cause across both configurations, that's one finding, not two; if the causes
> differ, say so with the numbers.
>
> C-1 itself is recorded correctly as an owner-call finding — the bar's environment drift is real
> (the spike runs 321 ms faster today than in Phase 0's trials), and what to do about the bar's
> dating is decided at close-out, not now.
>
> After the session: the full report — the first-pixel stage breakdown as a stop with options if a
> culprit stage is found, the slot-map evidence for item 3 (maps vs hashes vs arrival order across
> the five default trials), the criterion-4 difference band with its number, the H8 picture pair with
> fingerprints for the owner's eye check, and the complete r186 and re-sync findings you've been
> holding. Stops where rulings are needed.

No instrument change was needed for the added scope: the diagnostic page records every stage in
every trial of both WebGL2 configurations. Where recorded: here; PLAN.md's breakdown task line.

**DIAGNOSTIC SESSION — DONE (2026-09-25, 08:19-08:30 UTC, the owner's Chrome, visible throughout).**
- *The 20 diagnostic trials:* `t13-diag.html?auto=1…` → `ALL DIAG TRIALS DONE — 20 clean records (20
  attempts).`, five per configuration, none hidden, none with an error. (Progress was followed by
  the tab's address; the address display lagged the page's own counter at the end, so the store is
  the record.) Raw records: `docs/plan/results/phase-2-hload-diagnostics.json` — 125,452 B, sha256
  `45e997e96769bef47ed6c5ff6ff7c777132491fd413d729c98ce86aa873038db`, moved out of Chrome byte-exact.
- *H8's pictures:* ours on WebGPU and WebGL2, the pin on the snapshot's server — see the results
  doc's table (sha256 each, also in `<name>.sha256` beside each PNG; `sha256sum -c` OK for all
  three). **A THIRD H8 FAULT, found in Chrome and fixed:** on the pin's server (5180) the page
  reported stack "ours" and never captured; its own request log showed the backend lookup went to
  `http://localhost:5173/src/backend/ThreeGsBackend.ts` — OUR server — though a console import of
  the same path on 5180 correctly failed (404). Reading, not proven: both servers are the same site
  (localhost), and the identical `new Function` source had been compiled on our page earlier in the
  same tab. Fixed whatever the mechanism: the import now takes an ABSOLUTE URL built from the page's
  own origin (final page `t13-h8.ts` sha256 `a15684a5…`, byte-identical in the snapshot); the pin
  re-captured with its lookup going to 5180 (404 → the pin branch), and BOTH ours captures re-taken
  with the same final bytes, so all three pictures come from one version. The pin's store shows two
  captures: the pin server's live reload re-ran the stuck page with the fixed code when the file was
  re-copied (08:27:48.999, sha256 `4e0c31e8…`), then the deliberate load (08:27:58.491,
  `21cb3b31…`, the kept picture — also byte-identical to the pane's earlier pin capture). Both are in
  `h8-capture-records-pin.json`; the pin's own picture is therefore not byte-identical across loads
  either.
- *Cleanup:* the receiver, the spike's server and the pin snapshot's server all stopped;
  `.claude/launch.json` restored to its original bytes (sha256 `222aaee4…`, three entries); sparkjs
  read the same after the pin's server as before it (HEAD `fd67153`, the same seven status lines,
  `_metadata.json` 2026-09-21 02:21:37 / 4693 B, the hero unchanged).
- *Evidence added to `docs/plan/results/`:* `phase-2-hload-diagnostics.json`, `phase-2-hload-band.json`
  (8,142 B, sha256 `9ea5dbdc73f944eb703d544febf94249d80876582e9eb9119833639a5f9cf41e`),
  `phase-2-hload-pictures/` (three PNGs, three `.sha256` files, the two capture-record files). The
  results doc's new tables are GENERATED from these files (`gen_diag_tables.py`, scratchpad) and were
  found in the doc verbatim; the page's own verifier re-confirmed the earlier six trial tables and the
  store fingerprint byte for byte after the doc was edited.

**RULING 1's BREAKDOWN — both WebGL2 configurations (the owner's widening), with WebGPU alongside.**
Full tables in the results doc § Diagnostics. The instrumented runs reproduce the counted first-pixel
medians (709.6 / 1,362.8 WebGL2 against 703.0 / 1,413.5; 778.6 / 1,568.2 WebGPU against 766.4 /
1,624.3). ONE SHARED CAUSE across both WebGL2 configurations — two stages dominate, both growing with
the page budget: the synchronous header hook (header body → chunk 0 requested: 90.2 → 310.8 ms, 32 →
122 pages) and chunk 0's body (269.5 → 692.7 ms; the main thread busy, longest task 231 / 822 ms).
The hook builds the paged mesh at full capacity through `createPagedMesh`
(`src/vendor/three-gs/patches/paged.ts:433-459`): zero-filled source arrays for every splat of the
capacity run through the UNMODIFIED vendored constructor — D20's route. The spike's fork builds the
same storage from empty arrays with a 1-splat stub (`spikes/native-rad/src/GaussianSplatMesh.fork.js:8-10`,
`:93-107`; `spikes/native-rad/main.ts:225-238`). **Measured side by side** (`.collab-logs/t13-bench.ts`,
one construction per fresh page load in the built-in pane, three runs each): production 242.9 ms
median at 32 pages (85.8 / 242.9 / 259.4) and 897.0 ms at 122 (819.3 / 897.0 / 927.5); the spike's
fork 14.1 ms (14.7 / 14.1 / 12.3) and 36.9 ms (39.7 / 36.9 / 24.7) — 17x and 24x. Estimate, labelled
as such: scaled into Chrome, the construction difference accounts for about 85 of the 132.2 ms
`?pages=32` gap and about 298 of the 321.1 ms default gap (C-1); about 47 ms at `?pages=32` stays
unattributed (the spike's own stages were not measured).

**RULING S3 (b) — the WebGL2 default's hashes, measured.** Across the five default trials: maps and
hashes differ in all 10 pairs (65-85 of 122 chunks in different slots); within each load the map is
fixed and the three hashes agree; slot order = decode-reply order in 5/5. Network order is not the
driver: all 121 non-root chunks were deferred and admitted in the traversal's priority order, up to
four at a time — the posted order is ~60 % inverted against arrival. What varies between loads is the
posted order itself (25-42 inversions pairwise) and the four workers' completion reordering (77-92
inversions within each load), together 49-80 inversions pairwise in the order that fixes the slots.
The spike admits one chunk at a time in lockstep with its traversals and gave one hash.

**RULING S4 (A) — criterion 4's band:** WebGL2 `?pages=32` 1.67 % of pixels differ between loads on
average, WebGL2 default 2.01 % (0.25 % by more than 8 levels), WebGPU `?pages=32` 43.3 %, WebGPU
default 72.4 % (mostly by a few levels; 1.03 % / 1.35 % by more than 32). Judged against the bar's
footnotes by the owner (the doc sets the readings out).

**FINDING R186-DOCS (owner-reported at the second GO, verified 2026-09-25):** lines that still say r186
is unpublished, stale since `0.186.0` (2026-09-08; `0.186.1` 2026-09-24): `README.md:9` ("the addon is
not in any published release yet"), `CLAUDE.md:8`, `docs/plan/00-charter.md:87`,
`docs/plan/04-build-order.md:71-73`, `docs/plan/06-open-decisions.md:836` (a dated check, superseded;
**at :924 since 2026-09-26**, moved by the notes added to doc 06 that day; **at :1071 since 2026-09-27**, moved by D36 item 12's fourth follow-up; **at :1098 since the close-out, 2026-09-27**, moved by its eighth follow-up),
`.scratch/phase-2-backend/spec.md:65`. Not edited — with the r186 findings, for the owner.

**STOP (2026-09-25) — four decisions. Nothing below is built.**
- **V1 — the first-pixel culprit (ruling 1's stop).** (a) Name it and carry the fix forward: the
  regression is the full-capacity mesh construction on D20's route (17x / 24x the spike's), recorded
  with these measurements; its fix goes on the post-Phase-2 optimization list beside AC4's items, and
  Phase 2 closes with it NAMED (AC2's standard), not fixed. (b) Fix it inside D20 now: a pure-`.ts`
  path that builds the vendored mesh from a small stub and then gives it capacity-sized storage from
  empty arrays — feasibility unproven (the storage is bound into material and compute nodes; the
  patches already rebuild the sort's), new product code in an evidence ticket, red-first against this
  stage, H-FORK re-run. (c) Reopen D20 for this one step: a `[capacity]` JS patch to the vendored
  constructor, as the spike's fork did — breaks the byte-frozen rule (owner, 2026-08-29) and FORK.md's
  digests. (d) Overlap rather than shrink: request chunks before building the mesh — hides network
  time, not main-thread cost, so on localhost it would recover little of this stage. **Recommendation
  (a)**; (b) is the likely fix, for its own ticket. Optional with any option: a spike-side stage
  measurement to attribute the ~47 ms `?pages=32` remainder.
- **V2 — criterion 4 at the WebGL2 default.** The bar's WebGL2 default was deterministic; ours differs
  in 2.01 % of pixels between loads, for the measured admission-concurrency reason. (a) Record the band
  as criterion 4's number and accept the nondeterminism as the price of concurrent admission with the
  four-worker pool (owner ruling 05-S1). (b) Make slot assignment deterministic when the budget holds
  every chunk (a chunk's slot = its index) — a small product change, after Phase 2. (c) Serialize
  admission like the spike — gives back the four-worker load speed (full-quality 15.5 s here against
  the spike's 54 s). **Recommendation (a)**, with (b) as an optional later item.
- **V3 — r186 (AC5: each fired item answered "delete our code" or a recorded reason not to).**
  (a) Adopt r186 in a dedicated ticket after Phase 2: the re-diff, the patch rework (colour packing,
  direction-only re-sort, the bounds/culling reconciliation), the monolithic PLY path moved onto
  `GaussianSplatPLYLoader`, `SPZLoader` imported, the new type declarations reconciled. (b) Adopt it
  inside Phase 2, before close — large, and mid-evidence. (c) Stay on 0.185.1 with the dev-branch
  snapshot — the drift keeps growing. **Recommendation (a)**, with the per-item answers: item 13 —
  delete our code at adoption (the SPZ named refusal, the rename); item 5 — a recorded reason not to
  delete §B yet (upstream raycast loops every splat over source arrays the paged mesh does not keep);
  item 10 — delete our reliance on `allowJs` inference at adoption. The stale "unpublished" lines
  (FINDING R186-DOCS) are corrected in the same ticket.
- **V4 — FINDING RS-1, the CRLF copies.** (a) Normalize `CameraPath.ts`, `CameraRail.ts` and
  `LoadingUI.ts` to LF so they are byte-identical to the pin (and `CameraSystem.ts`'s endings with
  them) — content-neutral, but a whole-file change that buries a real diff if mixed into this
  ticket's single commit. (b) Record it and normalize in its own small change later. **Recommendation
  (b).**
C-1 is recorded as the owner's close-out call (second GO), not a stop here.

**OWNER RULINGS on stops V1-V4, the H8 eye check and the two record gaps (2026-09-26) — quoted
verbatim.** The session's opening message, whole. Its H8 verdict comes from two independent
owner-side eye checks of the pair in the results doc's § D16's picture pair.

> Read .scratch/handoffs/014-2026-09-26-t13-verdicts-pending.md in full — the authoritative entry
> state — then verify the tree matches its inventory (23 status lines, dirty on purpose; every file
> waits for the ticket's single commit). The two hook-written compaction briefs in
> .scratch/handoffs/ (014/015-*-compaction.md) are NOT ticket work: never stage them, leave them
> untouched. Work only ticket 13. The owner's rulings on the V1-V4 agenda (embedded byte-identical
> in the handoff at lines 141-177) follow now — record them verbatim in ticket 13, doc 06 beside D36
> item 12, and PLAN.md before building anything.
>
> V1 (a): name it, don't fix it here. Record with the full measurements: the shared cause
> (full-capacity source-array construction through the byte-frozen vendored constructor, required by
> D20), the side-by-side (243 vs 14 ms at 32 pages, 897 vs 37 ms at 122), the estimate labeled as an
> estimate (~85 of 132.2 ms, ~298 of 321.1 ms), the ~47 ms remainder named as unexplained, and the
> chunk-0-bytes stage (270-690 ms, longest tasks 231/822 ms) named as unattributed. The fix is (b)'s
> shape — placeholder mesh plus empty full-size storage inside D20's rules — in its own post-Phase-2
> ticket; add it to the owner-items list with these numbers.
>
> V2 (a): record 2.01% as criterion 4's number, with the verdicts as presented — WebGPU variation is
> the bar's own † kind; WebGL2-pages32 is the ‡ kind, more frequent; WebGL2-default's cross-load
> variation is new behavior with a proven mechanism (slot = decode-completion order under 4-worker
> scheduling, not network order), accepted as the price of 3-5x faster full-quality loading. Record
> (b) and (c) as post-parity options with (c)'s cost quoted (54 s vs 15.5 s).
>
> V3 (a): r186 adoption is its own post-Phase-2 ticket. Record the per-item dispositions (item 13
> deletes the SPZ refusal at adoption; item 5 is a recorded reason to KEEP doc 03 §B; item 10 drops
> the JS type-guessing reliance at adoption), the four breaking changes as that ticket's known
> scope, and the six stale "unpublished" lines as its doc corrections — none edited now. Add r186
> adoption to the owner-items list.
>
> V4 (b): record RS-1 and convert the line endings in their own small change after this ticket. The
> audit (93 byte-identical, 24 traced, 11 native, zero unexplained) closes the re-sync item with a
> finding.
>
> H8 verdict, from BOTH owner-side eye checks (counsel and owner independently agree): a VISIBLE
> quality gap — the pin is clearly sharper; ours is softer with painterly swirls and visible
> splat-blob artifacts in flat areas (walls, window, jacket, wall photos). Before recording it as a
> parity finding, settle one question from the capture records you already hold: was our capture
> taken at refinement comparable to the pin's? Check our frame's refinement state at capture
> (counters, phase, time since ready) against full-quality, and the pin's same. If ours fired
> mid-refinement, re-take the affected captures waiting for the product's own full-quality signal,
> re-fingerprint, and the eye check repeats on the new pair — announce and wait for the owner's
> window. If ours WAS at full quality, record the gap as a named visual-parity owner finding
> (diagnosis belongs to a later ticket). Report which case it is with the counters.
>
> The two record gaps: RG-1 — re-run the t13-bench.ts benchmark once (3 rounds each case, minutes of
> work) and record whether today's figures reproduce the 17x/24x, together with today's file hash
> (eaaac034…) and a dated note that the original run's bytes are unprovable from records; that turns
> the gap into evidence. RG-2 — fix the drifted citation at ticket 13:1058 with a dated note (the
> watch list is now doc 06 :801-855).
>
> Then continue down the list per the handoff: the 6.32x retune stop (cite the telemetry-cost
> table), the T2 throttle stop, H-LIFE x10 element-level both backends, the real site.json
> end-to-end both backends — raise "which site.json counts as real" as a stop FIRST, as the handoff
> says — criterion 9 with grounds, peak-heap measurement then the schema stop, the AC4 12-item
> verdicts. Then check:full with a true exit code, both review rounds (astra-review registry-first
> per the recipe, then built-in /code-review) reported separately with every finding re-verified,
> and the single commit under the standing delegation: staged list first, stop on anything stray, no
> credit lines, plain-English git for the owner.

*Entry state, verified before anything was recorded (2026-09-26, 13:43 -05:00):* HEAD `6d9074b`
(handoff 014, which carries the handoff file alone); `git status --short --untracked-files=all` =
the handoff's 23 lines exactly; every recorded fingerprint re-computed equal — harness `8ecc354a…` /
`663bcf68…`, trials `189f117b…`, control `2bcd46d7…`, diagnostics `45e997e9…`, band `9ea5dbdc…`,
`sha256sum -c` OK for the three PNGs, `.claude/launch.json` `222aaee4…` (the results doc reads
`68c4d451…`, as the handoff read it); the V1-V4 block hashes to `4bde9e6f…` both at handoff 014
:141-177 and here; nothing listening on 5173, 5174, 5180, 5209 or 5299; no preview server running.

Where recorded: V1-V4 quoted verbatim again in doc 06 (D36 item 12's second follow-up) and in PLAN.md
`## decisions`; what each ruling records, in the sections below; owner items 5-7 added, dated, to the
list above; the H8 check and its finding below and in the results doc (§ D16's picture pair, plus
dated notes on its status line and open items 1, 3 and 4); RG-2 in place at the r186 re-check's
watch-list line, together with the R186-DOCS citation the same insert moved; RG-1 below;
`#h-load-rerun` un-stuck in PLAN.md.

**V1 — NAMED, NOT FIXED IN PHASE 2 (ruling V1 a): the first-pixel regression's cause, with the full
measurements.** AC2's standard: named before the phase closes.
- *The shared cause:* full-capacity source-array construction through the byte-frozen vendored
  constructor, required by D20 (doc 06 :128). The backend's header hook builds the paged mesh with
  `createPagedMesh` (`src/vendor/three-gs/patches/paged.ts:433-459`): a zero-filled source geometry
  of `capacity` splats — 2,097,152 at `?pages=32`, 7,995,392 at the default 122 pages — through the
  UNMODIFIED vendored `GaussianSplatMesh` constructor, its source arrays released afterwards. The
  spike's fork builds the same storage from empty arrays, fed a 1-splat stub
  (`spikes/native-rad/src/GaussianSplatMesh.fork.js:8-10`, `:93-107`;
  `spikes/native-rad/main.ts:225-238`). One cause across both WebGL2 configurations, in the header
  hook stage (header body → chunk 0 requested): 90.2 ms at `?pages=32`, 310.8 ms at the default
  (results doc § Diagnostics, the stage table).
- *The side by side* (`.collab-logs/t13-bench.ts`; one construction per fresh page load in the
  built-in pane, three runs each; relative only): production 242.9 ms against the spike's fork
  14.1 ms at 32 pages — 17x; 897.0 against 36.9 ms at 122 pages — 24x. The ruling quotes them
  rounded (243 vs 14, 897 vs 37). Re-run 2026-09-26: RG-1 below.
- *The estimate — an ESTIMATE, not a measurement:* the construction difference accounts for about
  85 of the 132.2 ms same-day `?pages=32` gap and about 298 of the 321.1 ms same-day default gap
  (finding C-1); the method is in the results doc § Diagnostics, under the construction table.
- *UNEXPLAINED:* the rest of the `?pages=32` gap, about 47 ms — the spike's own stages were never
  measured.
- *UNATTRIBUTED:* the chunk-0-bytes stage (chunk 0 request → body read), 269.5 ms at `?pages=32` and
  692.7 ms at the default, longest tasks 231.0 and 822.0 ms (the ruling's "270-690 ms, longest tasks
  231/822 ms", rounded) — far longer than a ~1.8 MB transfer over localhost, with the main thread
  busy while the body could be delivered. No cause is attributed to it here.
- *The fix — (b)'s shape, in its own post-Phase-2 ticket:* a placeholder mesh plus empty full-size
  storage, inside D20's rules (pure-`.ts` patches; the vendored JS stays byte-frozen). Owner item 5.

**V2 — CRITERION 4's NUMBER: 2.01 % (ruling V2 a).** The share of pixels that differ between loads
at the WebGL2 default: the mean over the 10 pairs of five loads; 0.25 % by more than 8 levels; the
largest difference 85 of 255 (results doc § Criterion 4). The verdicts, as presented and ruled:
- *WebGPU* — 72.4 % (default) and 43.3 % (`?pages=32`) of pixels differ, 1.35 % and 1.03 % by more
  than 32 levels: the bar's own † kind (stable within a load, different across loads).
- *WebGL2 `?pages=32`* — 1.67 %: the bar's ‡ kind, more frequent (five distinct frames in five; the
  spike two in five, in Phase 0 and in the same-day control).
- *WebGL2 default* — 2.01 %: NEW behaviour against the bar's single hash, with a PROVEN mechanism —
  a chunk's slot is the order its decode completes under four-worker scheduling, not network order
  (ruling S3 b's measurement, above) — ACCEPTED as the price of 3-5x faster full-quality loading:
  15,523.7 ms against the same-day spike's 54,163.3 (3.5x) and the bar's 75,127 (4.8x).
- *Post-parity options, recorded, not scheduled:* (b) deterministic slot assignment when the budget
  holds every chunk (a chunk's slot = its index) — a small product change; (c) serialized admission
  like the spike, at the cost of the four-worker speed — 54 s against 15.5 s: the spike, which admits
  one chunk at a time, reached full quality in 54,163.3 ms against our 15,523.7 ms, the same day in
  the same Chrome (the spike's figure, not a measurement of (c)).

**V3 — r186 ADOPTION IS ITS OWN POST-PHASE-2 TICKET (ruling V3 a).** AC5's answers for the three
watch items that fired (the r186 re-check above):
- *Item 13 — r186 publishes:* delete our code at adoption — the SPZ named refusal goes (watch item
  13's own note: SPZ then becomes a plain `three/addons/loaders/SPZLoader.js` import).
- *Item 5 — splat raycast:* a recorded reason to KEEP doc 03 §B — upstream's `raycast` (`c550966`)
  loops every splat on the CPU over the source geometry's arrays, which the paged mesh does not keep
  (FORK.md:181-184, `patches/paged.ts:16`).
- *Item 10 — the addon's TS declarations ship:* drop the reliance on JS type inference (`allowJs`
  JSDoc inference for the vendored addon) at adoption.
*That ticket's known scope — the four breaking changes:* (1) colour storage packed as one RGBA8
`Uint32Array` word per splat (`3afdbd3`) — `[paged]`'s colour upload reworked; (2) direction-only
re-sort, `SORT_POSITION_THRESHOLD` gone (`9a5e800`) — `[selection]`'s mirrored hysteresis constants
and this ticket's harness pose tolerance lose their upstream counterpart; (3) `computeBoundingBox` /
`computeBoundingSphere` and frustum culling (`ef58888`), reconciled with the pager-AABB culling;
(4) `src/backend/ThreeGsBackend.ts:6-8` imports three utils r186 removed — the monolithic PLY path
moves onto `GaussianSplatPLYLoader`. *Its doc corrections:* the six stale "unpublished" lines of
FINDING R186-DOCS — none edited now. Owner item 6.

**V4 — FINDING RS-1 RECORDED; the line endings convert in their own small change after this ticket
(ruling V4 b).** `src/core/CameraPath.ts`, `CameraRail.ts` and `LoadingUI.ts` — content identical
to the pin, stored CRLF where the pin stores LF — and `CameraSystem.ts`'s endings: untouched in this
ticket. **The re-sync item (ruling R5) CLOSES with this finding:** of 128 shared paths, 93
byte-identical, 24 traced to a declaration or ruling, 11 each repo's own config and docs (the
ruling's "11 native"), zero unexplained.

**H8 — THE REFINEMENT CHECK the owner asked for (2026-09-26): the second case — ours WAS at full
quality. No re-take.** From the capture records (`docs/plan/results/phase-2-hload-pictures/`,
`h8-capture-records-ours.json` records 3-4 and `h8-capture-records-pin.json` record 2 — the kept
pictures, matched by sha256), the code, and the 30 comparable loads on record:

| kept picture | stack / backend | ready (ms) | captured (ms) | capture − ready | condition at capture | selected at capture |
|---|---|---|---|---|---|---|
| `h8-ours-webgpu.png` (`b14bd881…`) | ours / webgpu | 1,362.9 | 17,264.6 | 15,901.7 ms | steady: `loadSettled`, `lod.admitting` 0, selected > 0, held 5 renders | 2,314,382 |
| `h8-ours-webgl2.png` (`4b7f1971…`) | ours / webgl2-fallback | 1,361.8 | 15,977.7 | 14,615.9 ms | the same | 2,314,382 |
| `h8-pin.png` (`21cb3b31…`) | pin / Spark (WebGLRenderer) | 3,918.0 (load progress 1 at 3,917.9) | 9,067.5 | 5,149.5 ms | `ready`, load progress 1, then a 5,000 ms settle | not readable — no door on the pin |

- *What the capture records do NOT hold:* the traversal's `lod.fullQuality` at the capture frame —
  the H8 page (`.collab-logs/t13-h8.ts`, `a15684a5…`, :191-207) waited for the harness's steady
  condition and never read the flag. The answer below comes from the code and from the other loads,
  not from a flag in these records.
- *The code — under the full budget, steady cannot hold short of full quality.* `fullQuality` is
  false only when chunk 0 is missing (then nothing is selected) or when a node the traversal wants to
  refine has a child chunk that is not resident (`src/backend/LodTraversal.ts:371-378`, `:419-427`).
  At the default budget the pool has a page for every chunk, so every wanted chunk is protected
  (`src/backend/PagePool.ts:125-133`) and every wanted-but-missing one admissible (`:171-184`); right
  after each traversal `kickAdmissions` starts every admissible chunk whose bytes are cached, which
  makes `lod.admitting` > 0 (`src/backend/ThreeGsBackend.ts:1029`, `:1074-1083`) — and `loadSettled`
  is set only after the pager's `load()` resolves, by which time every fetched chunk's bytes sit in
  its cache (`src/backend/RadPager.ts:212-259`: deferred bytes at `:217`, decoded bytes returned at
  `:226`), so a missing chunk is skipped only if it was given up as unavailable; every insertion
  re-arms the traversal (`ThreeGsBackend.ts:963`). So five consecutive renders with `loadSettled` and
  `admitting` 0 mean the last traversal wanted no missing chunk — full quality — unless a chunk had
  been given up, which draws the parent in place of its children (`LodTraversal.ts:419-427`) and so
  changes the count.
- *The count is the full-quality count:* 2,314,382 is the selection at pose A at 1280x720 in every
  one of the 20 counted default-regime trials (visitor and opt-in) and the 10 default-regime
  diagnostic loads — each taken after full quality — and the same-day spike's own.
- *Full quality comes first in every comparable load:* in all 30 default-regime loads on record that
  used this same steady condition (20 counted trials, 10 diagnostic loads), `lod.fullQuality` fired
  BEFORE steady held — 14.6 to 103.7 ms before (`phase-2-hload-trials.json` `fullQualityMs` /
  `steadyMs`; `phase-2-hload-diagnostics.json` `stages.fullQuality` / `stages.steady`). The captures'
  time since ready (15.9 s, 14.6 s) sits inside those loads' full-quality-after-reveal ranges (WebGPU
  11,758.1-21,545.7 ms, WebGL2 13,989.3-16,546.1 ms).
- *The pin's state at capture:* its `ready` is its reveal gate (`fd67153:src/embed/SiteRuntime.ts`,
  `checkSceneVisibility` — `gate.progress = 1` and `entry.visible = true` are set together, and the
  element's load progress reports 1 once every scene is visible). With `REVEAL_MODE` "auto" the gate
  opens when the pager has drained (resident ≥ wanted) and held stable for 1,500 ms — the only path
  for a light scene (≤ 48 wanted chunks) — or, for a heavier one, also when splat growth stays under
  6 % over 1,200 ms for 500 ms; a 20,000 ms backstop either way; never sooner than 1,500 ms after the
  first splat. Which path opened it, and whether the scene counted as light, is not recorded, and no
  counter was read on the pin. So "load progress 1" there means revealed, not finished streaming: the
  pin's refinement at capture is known only as "revealed, plus 5,149.5 ms".
- *Reading:* ours was not caught mid-refinement — the owner's second case, so the pair is not re-taken
  and the gap is recorded as a named finding below. Whether the two sides draw comparable splat counts
  at pose A is not known (no counter on the pin); that belongs to the diagnosis, a later ticket.

**H8 — NAMED VISUAL-PARITY FINDING, OWNER ITEM (2026-09-26; D16's eye check, two owner-side checks
agreeing): a VISIBLE quality gap at pose A.** The verdict, verbatim: "a VISIBLE quality gap — the pin
is clearly sharper; ours is softer with painterly swirls and visible splat-blob artifacts in flat
areas (walls, window, jacket, wall photos)." The pair: `h8-ours-webgpu.png` (`b14bd881…`) and
`h8-ours-webgl2.png` (`4b7f1971…`) against `h8-pin.png` (`21cb3b31…`), 1280x720 at pixel ratio 1,
pose A through each side's own CameraSystem; ours at full quality (the check above). NOT diagnosed:
the diagnosis belongs to a later ticket (owner ruling). Owner item 7.

**RG-1 — THE CONSTRUCTION BENCHMARK RE-RUN (2026-09-26, per the owner's ruling): the finding
reproduces — 18.8x and 19.9x today against the recorded 17x and 24x; the 24x itself does not.**
- *The instrument's bytes:* `.collab-logs/t13-bench.ts` — 42 lines, 2,246 B, sha256
  `eaaac0343a1d28f21402227303ec15ed0a667686a694955bdf7329dbbb4a71d8`, last modified 2026-09-25
  03:34:57 local — hashed immediately before today's run. *Dated note (2026-09-26):* whether these are
  the bytes that produced the recorded 242.9 / 14.1 / 897.0 / 36.9 ms is NOT provable from the records
  — the file was not fingerprinted when those numbers were taken (record gap RG-1, handoff 014).
  Today's figures below come from these bytes.
- *Method, as the original:* one construction per fresh page load in the built-in pane (Chrome
  152.0.7977.130, `visibilityState` "hidden"), on the bare page
  `http://localhost:5173/examples/site-lab/sites/lab.site.json`; `toolkit-dev` = node pid 23456,
  started 2026-09-26 14:00:08, this repo's own Vite (port → process verified). Three rounds of the four
  cases, the order varied: round 1 production-32, spike-32, production-122, spike-122; round 2
  spike-32, production-32, spike-122, production-122; round 3 production-122, spike-122,
  production-32, spike-32. Relative only — a hidden, lower-priority process.

| construction (runs in round order) | 32 pages (2,097,152 splats) | 122 pages (7,995,392 splats) |
|---|---|---|
| production `createPagedMesh`, today | 178.2, 288.2, 298.9 — median 288.2 ms | 999.8, 954.3, 954.1 — median 954.3 ms |
| spike fork `{ capacity }`, today | 25.6, 15.3, 15.0 — median 15.3 ms | 37.2, 96.0, 47.9 — median 47.9 ms |
| ratio today (recorded 2026-09-25) | 18.8x (17.2x) | 19.9x (24.3x) |

- *Reading:* the finding reproduces — production's full-capacity construction costs about 19-20x the
  spike's fork at both sizes, today, from fingerprinted bytes. The recorded 17x holds (18.8x); the
  recorded 24x does not reproduce as such (19.9x): the spike's 122-page median moved from 36.9 to
  47.9 ms and production's from 897.0 to 954.3, and the runs themselves spread that widely (spike at
  122 pages: 37.2-96.0 ms today, 24.7-39.7 recorded).
- *The V1 estimate, re-derived by the same method from today's medians (still an ESTIMATE):* about 85
  of the 132.2 ms (85.4) and about 295 of the 321.1 ms (295.2), against the recorded ~85 and ~298; the
  same method applied to the recorded medians returns 85.0 and 298.0, so the method was applied as
  the results doc describes it.

**STOP (2026-09-26) — five decisions, in the handoff's order. Nothing below is built. "W" labels
are this stop's own.**

- **W1 — the `renderedSampleWindows` retune (ticket 12's handover above; doc 06 D35 item 5): is
  the optional-work allowance recalibrated against true rendered frames?**
  *The telemetry-cost table, which the owner ruled this stop must cite* (results doc § The cost of
  telemetry, visitor default → opt-in): first-pixel +225.2 / +232.0 / +270.9 / +229.8 ms
  (webgpu-default / webgpu-pages32 / webgl-default / webgl-pages32; up to +32.7 %); full-quality
  +995.8 and +1,711.1 ms, steady +607.5 and +738.9 ms; drag p95 −31.2 / +39.8 / −1.8 / +60.6 ms;
  longest task −19 / +58 / +40 / +81 ms; median peak heap +158 / +337 / +75 / +538 MB. That table
  prices the WHOLE probe. The allowance governs only its OPTIONAL half
  (`src/diag/LoadProbe.ts:411-470`), and the harness kept neither the record's `probe_summary.cpu`
  (mandatory against optional ms) nor its `budgetActions` — so nothing on record says how much of
  the price is optional work, or whether the backoff ladder ever engaged.
  *The mechanism, read from the code:* the allowance is `min(max(1, N) × 0.5 ms, 50 ms)` per
  5,000 ms window, against the same window's optional CPU (`LoadProbe.ts:465-469`;
  `src/diag/policies.ts:26-31`), where N counts the flagged sample events of the last 5 s (pushed at
  `:364`, trimmed at `:624-629`). A sample is taken at most once per 100 ms, from the per-frame
  callback (`src/embed/diagWiring.ts:131`, `:298-310`; `src/embed/SiteRuntime.ts:3365`), plus the
  rarer samples an optional observation triggers on other events (`LoadProbe.ts:424`;
  `src/diag/PagerTelemetrySource.ts:321-332`). So below about 10 frames a second every rendered
  frame is its own flagged window, and counting true frames changes nothing; above it frames
  outnumber windows — but then the 50 ms cap binds. With rendering sustained through the whole
  window, sample windows allow at most about 25 ms (about 50 windows × 0.5) and true frames at most
  50 ms: at most TWOFOLD looser. Only a burst's first ~1.7 s at 60 fps (fewer than 100 frames in the
  window) approaches the 6.32x of ticket 12's designed measurement ("six renders per sample, twenty
  samples", ticket 12:768-770). In the counted trials each 4 s drag rendered 7 to 41 frames (about
  2 to 10 a second), at or below the sampling rate.
  *FINDING RSW-1 — "roughly sixfold" is the uncapped ratio.* Doc 06 D35 item 5 (:655-656), ticket
  12:770-773, this ticket's handover (:90-91) and the source comment at
  `src/diag/PagerTelemetrySource.ts:302-305` say true-frame counting would loosen the throttle
  "roughly sixfold"; with the cap, sustained rendering loosens it at most twofold, and only above
  about 20 frames a second. Not edited: owner-ruled text and a product comment — with this ruling. (**Dated note 2026-09-27, FINDING R1-F2 — owner close-out ruling 2, scope answer 2:** this arithmetic is where the error started. "About 50 windows" assumes a sample every 100 ms, but the tick fires on the first render at least 100 ms after the last sample and times the next from it (`src/embed/diagWiring.ts:301-302`), so a sample interval is a whole number of frames: at 21 fps three frames, 142.9 ms, 36 samples in the 5 s window — 18 ms against true frames' capped 50 ms, 2.78x, not "at most twofold"; and from 10 to 20 fps a sample falls on every second frame, ~2x, so not "only above about 20". Kept as sent. Detail: R1-F2 APPLIED, at the end of these Comments.)
  *Corrected in place today (this ticket's own claim):* the per-trial "renders per sample window"
  figures divide the harness's whole-trial render count by the record's last-5-s window count
  (post-trials record above; results doc § The load record's own figures).
  (a) No recalibration in Phase 2: the allowance keeps its sample-window unit, as named (D35 item
  5); RSW-1 corrected with dated notes where it stands; any retune becomes a post-parity tuning item
  whose entry is a profile-class measurement. (b) Recalibrate now to true frames under a new
  per-frame constant — no single constant reproduces today's allowance across frame rates (the
  frames-per-window ratio is 1 below about 10 fps and rises above it), so this is the policy change
  D35 item 5 declined as "a policy change wearing a bug fix's clothes", made without a profile.
  (c) Measure first: opt-in loads in the owner's Chrome that keep each record's `probe_summary.cpu`
  and `budgetActions` beside per-5-s render counts — the hero in both regimes, and a light scene
  above 20 fps — then choose (a) or (b). **Recommendation (a)**, with (c) as the post-parity item's
  entry measurement: at the frame rates the hero actually renders, a retune would change little.

- **W2 — T2, the docked-idle throttle signal (carried item, ruling R3; doc 06 D29 item 1).**
  *What holds today:* the throttle waits for `progress().fraction === 1`, so a load capped below its
  asset never throttles (0.5082 at `?pages=32`, ticket 06): a capped site renders at display rate for
  as long as it stays open and idle. The pin's guard read resident < wanted from Spark's pager
  internals (`fd67153:src/embed/SiteRuntime.ts:3444-3453`, per D29 item 1), so a capped pin site
  could throttle once its wanted set was resident.
  *Who is capped — computed with the product's own arithmetic, NOT measured on such a device:*
  production caps the budget at the device's limits (`src/backend/ThreeGsBackend.ts:629-682`). On the
  WebGL2 fallback the hero fits 122 of 122 pages at `MAX_TEXTURE_SIZE` 8,192 or more, 85 at 4,096
  and 21 at 2,048 (`webglPageLimit`, `:494-519`, ported line for line and run). So the
  never-throttles case reaches visitors on low-limit WebGL2 devices, not only the `?pages=32`
  measurement regime; this machine derives 122 on both backends.
  *What this ticket's evidence says about idle power: nothing.* The counted trials held the throttle
  off by design (the synthetic `pointermove`, D36 addendum item 9) and every valid trial passed C4;
  plant C4 showed only that the gate engages in the default regime (65 frames skipped).
  *The candidate signal* (ticket 12:630-637): `pagerDiagnostics(handle).lod.wantedChunks`, with
  `lod.admitting` / `lod.admittingChunks` — seam-legal and already exposed; not built.
  (a) Build T2 now: the refinement guard also releases when every wanted chunk is resident and
  nothing is admitting — a product change in an evidence ticket, red-first (a capped load that never
  throttles today, then does after 15 s idle), both backends. (b) Record and defer: capped sites
  never throttle, named with the computed device reach; T2 becomes a post-parity power item with its
  candidate signal named and an idle measurement as its entry. (c) Measure first: a docked,
  input-free capped load in a visible tab — renders per second and `throttled` over 30 s against the
  default regime's 10 fps — then (a) or (b). **Recommendation (b):** the behaviour is the
  conservative one D29 chose (never refinement-starving), nothing in this ticket measured idle power,
  and the signal is a product change; (c) would confirm by measurement what the code already says,
  not decide whether it is acceptable.

- **W3 — which site.json counts as "real" for H-LIFE ×10 and the end-to-end run, what "flat"
  means, and where both run.**
  *The candidates:* `examples/site-lab/sites/lab.site.json` and `lm-lifetime.site.json` are the PIN's
  own portfolio sites (`fd67153:examples/portfolio/…`) with exactly one line changed, the scene URL
  (ticket 09:504-509); the other five in-repo files are minimal test sites. All seven — and all
  fifteen of the pin's portfolio sites — hold ONE scene, so AC3's "scene-swap under a live element"
  can only be a new `src` on a connected element: it fetches the new site, disposes the old runtime
  and mounts the new one in the same viewport (`src/embed/SplatSiteElement.ts:670-676`, `:905-969`,
  `:986`).
  *What exists:* ticket 09's site-lab drove SiteRuntime on lab.site.json through load, reveal,
  navigation and teardown on both backends, with ten load→dispose cycles at RUNTIME scope — the
  renderer's counters back to baseline in every cycle, the JS heap "not strictly increasing"
  (`examples/site-lab/main.ts:470-495`); its element-events harness drove the ELEMENT on
  lab.site.json through `src`, `goToStop(2)` and the travel on both backends
  (`examples/site-lab/element.ts:110-142`). PLAN.md's `#site-e2e` is `[x]` on that evidence. Not yet
  shown: H-LIFE on the ELEMENT (×10, heap flat), a scene swap under a live element, the element
  through every stop to its disposal.
  *"Flat" is defined nowhere* (doc 04 :117 "memory flat"; AC3 "heap flat across cycles"), and no
  forced GC exists in a normal browser.
  *Where:* D36 item 11's Chrome-only rule was written for the counted timing trials; H-LIFE and the
  end-to-end run are not timing evidence, and the built-in pane has served every fixture with pumped
  frames. The heap reading is Chromium's `performance.memory` in both places.
  (a) lab.site.json is the real site, with lm-lifetime.site.json as the swap partner — both the
  pin's own. H-LIFE ×10 on ONE live `<splat-site>`: ten cycles alternating a src swap (lab ↔
  lm-lifetime) and a remove / re-append, each asserting the renderer's counters back to their
  baseline after the disposal (exact) and recording the JS heap after a drain; end to end, the
  element on lab.site.json — load, ready, every stop and back, disposal — on WebGPU and WebGL2; both
  in the owner's Chrome, one fronted session. (b) The same in the built-in pane with pumped frames
  (the site-lab and element-harness precedent): functional and heap evidence, no owner window; its
  WebGPU adapter probed first. (c) A two-scene site authored for this ticket (the hero plus the PLY
  fixture), so the swap happens inside one site — synthetic, so not "real" in doc 04's sense.
  *"Flat":* (i) counters exact, and the ten heap readings not strictly increasing, the whole series
  reported — site-lab's standard; (ii) as (i), plus the last reading within the spread of repeated
  idle readings measured first on the same page (a tolerance measured, not chosen).
  **Recommendation (a) with (i)**; (b) if the owner prefers not to front the window again.

- **W4 — criterion 9's direct SH-output assertion: build, or re-record WITH GROUNDS (ruling G7).**
  *Why only WebGPU can go stale:* on WebGL2 the vendored mesh evaluates SH per vertex on every draw
  (`src/vendor/three-gs/GaussianSplatMesh.js:176-178` selects `_sphericalHarmonicsVertexNode`
  there), so a page is evaluated the moment it is drawn — no stored output exists to go stale. On
  WebGPU the colours come from a contribution buffer written by a compute pass
  (`_precomputedSphericalHarmonicsVertexNode`), which `updateSphericalHarmonics` SKIPS while camera
  and mesh matrices are unchanged (`:207-220`) — criterion 9's case exactly; the backend re-arms it
  on every residency change (`src/backend/ThreeGsBackend.ts:959` → `patches/paged.ts:330-332` resets
  `_sphericalHarmonicsInitialized`).
  *Evidence at the bar's standard today:* the selection-growth half ✓ 20/20 (results doc, criterion
  9); pager-lab's `invalidation-shown` counts an SH compute DISPATCH after an evict and a re-admit
  under a fixed camera on WebGPU (`examples/pager-lab/main.ts:588-611`) — the dispatch, not its
  output.
  *Where the deferral pointed:* the stack ticket 12 built reads counters through the door and has no
  GPU-buffer readback, so "deferred to the production diag stack" named a place that cannot make a
  direct SH-output assertion as it stands.
  (a) Build it in pager-lab, WebGPU: under a motionless camera, admit a chunk into a slot another
  chunk has just vacated, render, read that slot's rows of the SH contribution buffer back (three's
  storage readback), then force a full SH recompute (the mesh's `_sphericalHarmonicsInitialized`
  reset, test-side) and read the rows again — same inputs, so they must be equal; red-first with a
  test-side plant that undoes the insert-time re-arm (setting the flag back after the admit), leaving
  the slot with the previous chunk's contributions; WebGL2 recorded exempt on the grounds above.
  (b) Re-record the gap with grounds: the dispatch-level check plus selection growth as the
  standard; the direct assertion carried to a post-parity fixture item. (c) A CPU reference: decode
  the chunk's SH1 words and evaluate the band on the CPU for the camera, compared with the readback —
  the strongest check, but it re-implements the shader's arithmetic in test code.
  **Recommendation (a):** it is the direct assertion G7 said must not be deferred by default,
  bounded to one fixture check, with no product change.

- **W5 — peak JS heap: does the production record earn a field? (the owner's instruction, quoted
  above from ticket 12:685-688; doc 06 D36 item 5).**
  *The measurement — the spike's method (500 ms `performance.memory` poll), all 40 counted trials:*
  visitor default max 2,071 / 897 / 2,020 / 842 MB (webgpu-default / webgpu-pages32 / webgl-default /
  webgl-pages32), medians 1,864 / 784 / 1,977 / 799 — every row under the bar's 3,912 / 1,296 / 2,887
  / 1,306; opt-in max 2,074 / 1,218 / 2,690 / 2,403, medians 2,022 / 1,121 / 2,052 / 1,337 (results
  doc, the trial tables and § The cost of telemetry).
  *What a field would carry:* `performance.memory` is non-standard and Chromium-only (`null`
  elsewhere, as in the spike's own column), quantized, and PAGE-wide — it counts the host page and
  every other embed, where the record is per scene (the span difference Q3 met for long tasks, in a
  stronger form). `performance.measureUserAgentSpecificMemory()` is standards-track but needs
  cross-origin isolation, which embedding sites rarely have. Doc 05's H-LOAD line names peak JS heap
  among the metrics "the rewired diag stack (production)" instruments
  (`docs/plan/05-parity-verification.md:87-88`).
  (a) Earn the field: `peakJsHeapMB` in `probe_summary`, from the probe's own 500 ms poll while the
  record is open, `null` where unsupported, under semantics 2 → 3 — red-first (the field absent), and
  a new timer inside opt-in telemetry (owner item 4's price). (b) No field: peak heap stays a fixture
  instrument, as measured here; doc 05's line gets a dated note that the heap is fixture-measured by
  ruling. (c) A field over `measureUserAgentSpecificMemory()` where isolation allows — `null` for
  most embeds. **Recommendation (b):** a Chromium-only, page-wide number does not describe one scene's
  load, and the need it serves is met by the fixture instrument that produced these 40 readings.

After the rulings, in the handoff's order: H-LIFE ×10 and the end-to-end run (W3), criterion 9 (W4),
the heap decision applied (W5), then AC4's 12 verdicts, then close-out.

**OWNER RULINGS on FINDING RSW-1 and stops W1-W5 (2026-09-26) — quoted verbatim.** The whole
message. The owner verified the source comment (`src/diag/PagerTelemetrySource.ts:299-306`) before
ruling. *Dated note 2026-09-27 (owner close-out ruling 2, FINDING R1-F2; scope answer 1):* the stakes quoted in the RSW-1 and W1 paragraphs below — "at most roughly twofold, and only above ~20 fps" and "~2x above 20 fps" — were Claude's arithmetic, and wrong: no effect at or below 10 fps, ~2x from 10-20 fps, up to ~3x just above 20 fps. The quote stays as the owner wrote it; W1's no-retune stands (the drags ran at 2-10 fps, where the ratio is exactly 1.0). Detail: R1-F2 APPLIED, at the end of these Comments.

> Rulings on W1-W5 and RSW-1. Verified here: the "roughly sixfold" comment at
> PagerTelemetrySource.ts:299-306, and your H8 three-line proof accepted — ours captured at full
> quality, the pin captured less refined and still sharper, the visual-parity finding stands as
> owner item 7 with diagnosis deferred.
>
> RSW-1: correct in ALL FOUR places with dated notes — doc 06 D35 item 5, ticket 12, ticket 13, AND
> the source comment at PagerTelemetrySource.ts:299-306. The comment is the one code edit
> authorized: comments that overstate are instrument-honesty defects, and this one defends a ruling
> of mine with wrong arithmetic. The correction preserves the ruling (window-counting is the pin's
> cadence, kept for parity) and replaces the stakes: "at most roughly twofold, and only above ~20
> fps, because the tick samples at >=100 ms and the per-window allowance is capped" — cite your
> trace. My D35 grounds carried the same overstatement; the dated note owns that.
>
> W1 (a): no retune in Phase 2. Grounds recorded: RSW-1 shrinks the maximum effect to ~2x above 20
> fps; the trials' drag regime ran at 2-10 fps where a retune changes nearly nothing; and the
> owner's telemetry-price item already covers the whole cost. Retune later only against a profile,
> as a post-parity item — record it as CLOSED for this ticket with these grounds, discharging the
> D35 item 5 deferral.
>
> W2 (b): record and defer to a later power ticket, WITH your new fact prominently recorded: capped
> sites are a real-device regime, not a test artifact — the product's own formula puts a
> 4,096-texture WebGL2 device at 85 of the hero's 122 pages, and a capped site never idle-throttles.
> Label the 85/122 as computed-not-measured. That fact is what the power ticket opens with.
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
> invalidate()/_sphericalHarmonicsInitialized plant), no product change. WebGL2 recomputing per-draw
> is recorded as the reason the check only needs to bite on WebGPU.
>
> W5 (b): no field. Grounds recorded: Chrome-only API, page-scoped where the record is scene-scoped,
> and the harness already measured heap in all 40 preserved trials. The named gap from ticket 12 is
> discharged as decided-with-grounds, not forgotten. The semantics version stays at 2.
>
> The renders-per-window correction you made to your own figures is exactly right — wrong values
> kept visible, dated corrections beside them.
>
> Proceed: record these rulings, apply RSW-1's four corrections, build W4's check red-first, then
> announce the W3 Chrome session. After it: criterion 9's verdict, the AC4 12-item verdicts, then
> check:full, both review rounds reported separately, and the single commit under the standing
> delegation.

**RSW-1 APPLIED — the four corrections, each dated (2026-09-26):**
- *Source comment* — `src/diag/PagerTelemetrySource.ts:302-306`, the one code edit the owner
  authorized: five lines rewritten as five, so the file keeps its 473 lines and no citation of it
  moves (`:321-332` and `:438` are cited in these Comments); comment lines stay within the file's
  79-character width; bytes written directly (LF, the path is `-text`). The ruling is preserved
  (the pin's cadence, "kept deliberately for parity") and the stakes replaced — "at most roughly
  twofold, and only above ~20 fps, because the tick samples at >=100 ms (diagWiring.ts:131) and the
  per-window allowance is capped (LoadProbe.ts:465-469)" — with the old value named ("CORRECTED from
  "roughly sixfold"") and W1's decision. File sha256 `e13e3af8…` (= HEAD blob `1979161d`) →
  `3616fde2…`. (**CORRECTED AGAIN 2026-09-27, FINDING R1-F2 — owner close-out ruling 2:** the stakes quoted in this bullet were wrong as well; lines 303-306 rewritten again, the file still 473 lines, `3616fde2…` → `e8933877…`. Detail: R1-F2 APPLIED, at the end of these Comments.)
- *Doc 06 D35 item 5* — a dated note after the item, owning the overstatement in the owner's own
  grounds, as ruled, and discharging the deferral (W1 a).
- *Ticket 12* — a dated note under finding 1 of its adversarial round; the 6.32x itself stands as
  measured (six renders per sample, by design).
- *Ticket 13* — a dated note in the handover at the top of these Comments.

Where recorded: RSW-1 and W1-W5 quoted verbatim again in doc 06 (D36 item 12's third follow-up) and in
PLAN.md `## decisions`; RSW-1 as above; W1 CLOSED under the carried retune item and in doc 06 D35 item
5; W2 under the carried T2 item, in doc 06 D29 item 1 and as owner item 8; W5 under the carried heap
item, in doc 06 D36 item 5 and in doc 05's metric line; W3 and W4 by the builds that follow; RG-2's and
R186-DOCS's doc 06 line numbers updated to the layout after today's notes; `#h-load-rerun` un-stuck
and `#sh-output-check` added in PLAN.md.

**W4 BUILT (2026-09-26, owner ruling W4 a): criterion 9's direct SH-output check —
`sh-output-fresh-after-admission` in `examples/pager-lab/main.ts`. No product change.**
- *Where, and why there:* inserted after every existing pixel drill (after
  `selection-off-draws-all-resident`, before the EVIDENCE log and the dispose cycles), so no
  earlier check ever runs on the slot layout the drill leaves behind. The diff against HEAD is ONE
  insertion hunk, +126 lines, no deletion: sha256 `bb5f6764…` (HEAD) → `8859e840…`. It was first
  written right after `invalidation-shown` and moved there after the A/B below.
- *What it asserts, WebGPU:* the page's own loop is held (`throttleGate`) so only the drill's
  renders run; two resident non-root chunks are evicted — A at the lowest slot, B at the highest —
  and B is admitted, taking the first free slot, A's; one render under the unchanged camera; that
  slot's rows of the SH contribution buffer are read back (R1, three's byte-range storage readback,
  one slot = 65,536 rows × 16 B); the pass is then forced (the flag reset) and the rows read again
  (R2). Same inputs, so R1 must equal R2 bit for bit — and R2 must differ from the slot's rows
  before the drill (R0, A's contributions), non-zero, with B landed in A's slot, the camera
  unchanged and A resident again once residency converges. *WebGL2:* the premise — no contribution
  buffer allocated and the per-vertex SH node in use (vendored `GaussianSplatMesh.js:176-178`,
  `:426-429`) — the reason, recorded as ruled, that the check only needs to bite on WebGPU.
- *Plants (URL only, never source):* `sh-rearm-held` (WebGPU) holds `_sphericalHarmonicsInitialized`
  at true through the drill, swallowing every re-arm — must fail; `sh-rearm-once` (WebGPU) undoes only
  the insertion's re-arm — green by design; `sh-premise` (WebGL2) puts the precomputed-SH node into
  the material — must fail.
- *Why the held plant, not the one the stop described:* the stop proposed "setting the flag back
  after the admit". The render after an insertion also runs the traversal, whose `invalidate()`
  re-arms the pass BEFORE it runs (`src/vendor/three-gs/patches/paged.ts:198-203`;
  `src/backend/ThreeGsBackend.ts:1046`), so a one-time undo is repaired within that render —
  measured, run 10 below: 1 SH pass on the admission render, the check green. The product has two
  independent re-arm paths; the fault that defeats both is the held flag.
- *Runs — the built-in pane (Chrome 152.0.7977.130, WebGPU adapter nvidia / ampere), frames driven by
  the page; logic evidence, never timing:*

| run | pager-lab bytes | regime / backend | plant | pager-lab | the new check |
|---|---|---|---|---|---|
| 1 | `4d099776…` (first position) | default / webgpu | sh-rearm-held | 25 passed, 2 failed | FAIL — 0 SH passes on the admission render; 196,608 of 262,144 words differ from the forced pass (the slot kept chunk 27's contributions) |
| 2 | `4d099776…` | default / webgpu | — | 26 passed, 1 failed | PASS — 1 pass; 0 of 262,144 differ; R0 vs R2 196,608 differ |
| 3 | `4d099776…` | `?pages=32` / webgpu | — | 26 passed, 1 failed | PASS — the same shape |
| 4 | HEAD `bb5f6764…` (A/B; the check absent) | `?pages=32` / webgpu | — | 26 passed, 0 failed | — |
| 5 | `f984f062…` (moved) | `?pages=32` / webgpu | sh-rearm-held | 26 passed, 1 failed | FAIL — 0 passes; 196,608 of 262,144 differ |
| 6 | `f984f062…` | `?pages=32` / webgpu | — | 27 passed, 0 failed | PASS — 1 pass; 0 differ; R0 vs R2 196,608 |
| 7 | `f984f062…` | default / webgpu | — | 26 passed, 1 failed | PASS — 1 pass; 0 differ |
| 8 | `f984f062…` | `?pages=32` / webgl2-fallback | — | 27 passed, 0 failed | PASS — buffer allocated false, per-vertex node in use true |
| 9 | `8859e840…` (final) | `?pages=32` / webgl2-fallback | sh-premise | 26 passed, 1 failed | FAIL — per-vertex SH node in use false |
| 10 | `8859e840…` | `?pages=32` / webgpu | sh-rearm-once | 27 passed, 0 failed | PASS by design — 1 SH pass on the admission render |
| 11 | `8859e840…` | default / webgl2-fallback | — | 27 passed, 0 failed | PASS — the premise holds |

  Every other failure in the table: run 1's second is the planted fault's echo below; runs 2, 3 and
  7's is FINDING PL-1.
- *The planted fault, caught twice:* run 1 also failed `partial-path-healthy-after-drills` (1,263
  pushed, 1,260 consumed). With the SH pass stopped, the three SH1-attribute ranges the drill pushed
  (two zeroing evictions, one admission) were never consumed — on WebGPU only the SH pass reads that
  attribute — so the backend's own upload watchdog tripped ("[paged] partial-update path NOT consumed
  by the renderer", logged inside the drill; `patches/paged.ts:404-418`, SH1 watched at `:421-424`).
  Unplanted, the path stayed healthy (run 2: 1,848 pushed, 1,848 consumed).
- **FINDING PL-1 — INHERITED, not fixed: `evict-readmit-pixel-identical` fails intermittently on
  WebGPU.** It compares ONE re-admit frame with the maximum of five consecutive re-sorts (the
  "sort-only control band"), while the GPU counting sort's within-bin nondeterminism, measured in the
  same runs by `pixel-stable-5-trials`, reaches further: trial bands 12, 7, 9, 8, 11 against control
  bands 4, 4, 5, 8, 8 (runs 1, 2, 3, 4, 7). Today it failed in runs 2, 3 and 7 (re-admit difference
  5, 8 and 10 against bands 4, 5 and 8) and passed in runs 1, 4, 5, 6 and 10; on WebGL2 its band is 0
  and it is exact (the CPU sort is deterministic). Run 7 settles attribution: in the moved check's
  bytes it runs BEFORE the inserted block, so every line executed up to it is HEAD's — the failure is
  the original check's own. Tickets 06 and 07 record it passing and no failure. Not fixed here (it is
  outside W4): for the owner, beside the fixtures' close-out runs, which it can fail on WebGPU.
- Criterion 9's verdict is written after the W3 session, as ruled.

**W3 PAGE BUILT (2026-09-26, owner ruling W3 a): `examples/site-lab/hlife.{html,ts}` — the
element-level H-LIFE ×10 and the end-to-end run. Logic-tested in the built-in pane; the Chrome
session NOT yet run (announced, waiting for the owner's go).**
- *Files:* `examples/site-lab/hlife.html` (31 lines, sha256 `28c14731…`) and `examples/site-lab/hlife.ts`
  (657 lines, sha256 `ee6e577c…`), in the existing site-lab folder beside the element harness (no new
  folder); one input line in `vite.config.ts` (`site-lab-hlife`) so the gate compiles the page, the
  hload pattern. The page's header states its method in full.
- *What it runs:* the element on lab.site.json end to end — `ready` with the site progress contract
  (ruling Stop 5 P1), then stops 1 → 2 → 0 by `goToStop`, each confirmed by `stopchanged` and the rail at
  rest; then ten cycles on the SAME live element alternating a `src` swap (lab ↔ lm-lifetime) with a
  remove / re-append, and a final removal — eleven runtimes, each torn down once. Per runtime: the
  renderer's counters at first observation (must all be 0), grown at steady, back to that baseline
  EXACTLY right after its `dispose()` returns (the window proven open, site-lab's method); the JS heap
  after a 200-yield drain at each steady point, judged by site-lab's not-strictly-increasing standard.
- *Choices made within the ruling, stated for the owner's objection before the go:* (1) every cycle's
  load runs to the H-LOAD harness's steady point before it is disposed, so each cycle disposes a
  complete load; (2) the heap is read at each steady point — swap cycles have no empty moment, so every
  reading is taken in the same state; (3) the counter baseline must be all zero (a baseline that holds
  nothing cannot hide a leak); (4) READOUTS after the final teardown, reported and not gated: the idle
  heap, and which runtimes, renderers and splat meshes the collector freed under allocation pressure
  (a FinalizationRegistry, which keeps nothing alive).
- *Logic runs — the built-in pane, frames pumped by the page (`?pump=1`); logic evidence, never timing:*

| run | page `hlife.ts` | backend | cycles / plant | result | reading |
|---|---|---|---|---|---|
| pane-logic-1 | first version | webgpu | 2 / — | 6 passed, 1 failed | backend blank — MY BUG: read before the renderer's async init; fixed (read at steady) |
| pane-plants-1 | `cb0ac001…` | webgpu | 2 / gpu-leak, skip-stop, expect-other | 4 passed, 3 failed | exactly the three planted checks: backend [webgpu ×3] against expected webgl2-fallback; stops announced [2, 0]; counters [000] — after each disposal 1 attribute (288 B), 1 geometry and 1 index attribute (144 B) remained: the planted box |
| pane-heap-plant | `cb0ac001…` | webgpu | 2 / heap-grow 256 MB | 6 passed, 1 failed | heap 1,679.4 → 1,836.1 → 2,110.4 MB, strictly increasing |
| pane-final-webgpu | `cb0ac001…` | webgpu | 2 / — | 7 passed, 0 failed | heap 1,423.5 / 1,306.1 / 1,311.7 |
| pane-final-webgl2 | `cb0ac001…` | webgl2-fallback | 2 / — | 5 passed, 2 failed | counters: every runtime 0 → 6 textures (639,631,360 B) → 0, but the baseline was read at 1 render call — MY GUARD was wrong (on WebGL2 one empty render precedes the observation and allocates nothing); fixed: the all-zero baseline. Heap 1,308.4 → 2,326.8 → 3,293.0 — see HL-1 |
| pane-webgl2-noretain | `296943dc…` | webgl2-fallback | 3 / — | 6 passed, 1 failed | counters [1111]; heap 1,307.8 → 2,321.4 → 3,293.1 → 3,316.3 |
| pane-webgl2-collect | `ee6e577c…` | webgl2-fallback | 1 / — | 6 passed, 1 failed | heap 1,245.6 → 2,319.8; READOUT: collected 0 of 6 |
| pane-final2-webgpu | `ee6e577c…` (final) | webgpu | 2 / — | 7 passed, 0 failed | heap 1,426.1 / 1,376.1 / 1,434.2; READOUT: idle heap 1,434.2 MB, collected 0 of 9 |

  Between the cb0ac001 and 296943dc versions the page also stopped holding its own references: the
  first versions kept every runtime handle and every backend reachable after disposal (the per-runtime
  records and the load list) — removed before any heap reading was read as evidence.

**CANDIDATE FINDING HL-1 (2026-09-26, for the owner; NOT diagnosed): a torn-down `<splat-site>` —
its runtime, renderer and splat mesh — is not garbage-collected.**
- *Measured without the page's harness:* in a bare same-origin document, a `<splat-site>` on
  lab.site.json loaded to ready (frames pumped from the console), then its runtime, renderer, splat mesh
  and the element itself registered with a FinalizationRegistry, the element removed and every page
  reference dropped. After allocation pressure and idle time — several major collections, the heap
  falling from 3,413.2 to 980.9 MB — NONE of the four was collected, while 5 of 5 unreachable control
  objects registered in the same document were, within about 10 s. Reproduced on WebGL2 and on WebGPU,
  and inside the page (0 of 6, 0 of 9 above).
- *What it costs:* on WebGL2, three keeps each storage texture's JS array on its texture object, so a
  retained runtime keeps them in the JS heap — the loaded-state heap rose about 1 GB per cycle over the
  first pane cycles (above). On WebGPU the storage lives on the GPU and IS freed — every runtime's
  counters return exactly to zero on both backends — so the heap readings stay flat there.
- *Ruled out, by reading:* the element's only global listener (the bridge — framed pages only, removed
  on disconnect, `src/embed/SplatSiteElement.ts:805-824`); SiteRuntime's window and visibility listeners;
  CameraSystem's window blur listener and TextSystem's media-query listener (each removed in its
  dispose); `window.__` globals (none in `src/`); console retention (every console line is a string).
- *Not known:* the retaining path. Not excluded: three.js internals (a device, context or animation
  loop that outlives `dispose()`), other subsystems, and the debugging attachment through which both
  browsers are driven. A heap snapshot's Retainers view after one teardown would name the holder.
- *STATUS (2026-09-27, owner ruling on STOP HF-1, below): still a CANDIDATE, its in-page evidence
  WITHDRAWN.* Grounds: the in-page readouts (0 of 6, 0 of 9) and the WebGL2 heap rising about 1 GB a
  cycle over the first cycles are explained by FINDING HF-1 — the page's own frame held runtime 0,
  the previous runtime and the last one; the prediction "6 of 15" came out exactly (below). Its only
  remaining support is the bare-page console experiment above, to be re-run once if the clean pane
  control shows the product keeping nothing. The text above is kept as written.
- *STATUS (2026-09-27, owner ruling on the plain-tab result, below): RULED OUT.* The evidence chain:
  (1) the in-page evidence (0 of 6, 0 of 9, the WebGL2 rise) WITHDRAWN under FINDING HF-1 — the
  page's own frame held three runtimes, shown by the prediction "6 of 15" coming out exactly; (2)
  the bare-page leg explained by my probe's own scope flaw — `bp-1` 8 of 9 with the element held by
  the probe's message handler, `bp-2` 9 of 9 with only that changed, its prediction written first;
  (3) on the fixed page (`112a179f…`) the pane frees 15 of 15 on both backends; (4) the owner's
  plain tab, no debugging attachment, WebGL2, reads collected 12 of 12 after 3 rounds
  (`plain-hl1-check-2`). The 2026-09-26 bare-page result (none of four) cannot be re-examined; its
  script is not recoverable. The text above is kept as written.

**OWNER RULINGS in the STOP message (2026-09-27 05:51:59 UTC) — the ruling sentences quoted
verbatim; recorded 2026-09-27.** The whole message is embedded byte-exact in handoff 015
(`.scratch/handoffs/015-2026-09-27-hlife-session-pending.md:222-234`, 4,506 bytes, sha256
`012420a7…` — re-hashed equal on 2026-09-27); the rest of it instructs that handoff. The rulings:
the HL-1 interpretation in both cases, the records path and the counted session's shape (the first
quote); W4's plant supersession, owned by the owner, and PL-1's disposition (the second, from the
message's list of what was built).

> Interpretation, already ruled: runtimes freed in the plain tab → HL-1 is the debugging connection,
> an instrument artifact, counted heap evidence from the owner's plain tab (fallback B); not freed →
> HL-1 is a real product finding, WebGL2's heap gate failure pre-explained, retainer-hunt diagnosis
> deferred to its own ticket. Then the counted session: WebGPU then WebGL2, stops 1→2→0, ten
> alternating src-swap and remove/re-add cycles, final removal, records to
> docs/plan/results/phase-2-hlife-records.json (ruled), fingerprint re-checked on the repo copy,
> owner's window fronted throughout, hidden runs redone.
>
> the W4 SH-output check (red on both branches — held-flag plant on WebGPU, sh-premise plant on
> WebGL2 — green both backends both regimes; the ruled single-re-arm plant SUPERSEDED because it
> cannot bite, owner owns that supersession; the sh-rearm-once green run as the proof), finding PL-1
> (evict-readmit inherited flake, 3-of-7 WebGPU, one pre-insertion failure proving inheritance; a
> PL-1 failure alone does not block close-out, tally reported, band-widening on the post-ticket
> list)

*Two of that message's figures CORRECTED (2026-09-27) — the wrong values kept visible:*
- *"3-of-7 WebGPU"* → **3 of 8.** It was my chat miscount, not a record's figure ("3 of 7" and
  "3-of-7" appear in none of this ticket, doc 05, doc 06, PLAN.md or the results doc — checked
  2026-09-27). The W4 runs table above has eight WebGPU pager-lab runs — 1, 2, 3, 4, 5, 6, 7 and 10;
  `evict-readmit-pixel-identical` failed in runs 2, 3 and 7 and passed in 1, 4, 5, 6 and 10 (FINDING
  PL-1 above).
- *"~27 status lines" and "the two hook-written compaction briefs"* → **29 lines and four briefs.**
  `git status --short --untracked-files=all` lists 29 lines (plain `git status --short` shows 21: it
  collapses each untracked folder to one line); the owner's PreCompact hook wrote `016-` and
  `017-2026-09-27-compaction.md` during the 2026-09-27 compactions, beside the two of 2026-09-26.
  None of the four is ticket work, and none is ever staged.

**OWNER ANSWERS to handoff 015's two unpinned points, and RG-3 APPROVED (the next session's opening
message, 2026-09-27) — quoted verbatim.**

> The two open points are answered now: (1) "the post-ticket list" lives in ticket 13's owner-items
> section, as a clearly-labeled "post-ticket small changes" sublist (currently: widen
> evict-readmit's noise band; convert the RS-1 line endings) — distinct from the numbered owner
> items. (2) If the owner's plain tab shows the runtimes freed, the counted heap evidence comes from
> plain-tab runs the owner starts by opening the URL; the page POSTs its records byte-exact to the
> 5299 receiver exactly as the H-LOAD raw records did, fingerprint re-checked on the repo copy — no
> debugging attachment touches those runs; the Claude-driven tab is used only for the parts that
> need driving, and each record states which tab kind produced it.
>
> SECOND, RG-3: approved — re-run the W3 page's deliberate-fault checks against the FINAL page bytes
> in the built-in pane (logic only) before any counted trial, and record that the reds reproduce on
> the fingerprinted bytes. A plant that has not been shown red on the exact bytes that will run has
> not been shown red.

Where recorded: here; the "post-ticket small changes" sublist under the owner items above (after
item 8); doc 06 D36 item 12's fourth follow-up; PLAN.md `## decisions`. Which HL-1 case applies is
decided by the owner's plain-tab READOUT, still to come. One mechanism in answer (2) is raised below
as STOP RR-1, not picked.

**STOP RR-1 (raised 2026-09-27, before RG-3) — how a plain-tab record reaches the repo, and where it
states its tab kind. Raised, not picked: the answer decides whether `hlife.ts` changes, and RG-3
must run on the bytes that will run.**
- *Facts, by reading (2026-09-27):* `hlife.ts` (`ee6e577c…`) has no network code — its record goes
  to the page (`#record`), the console and localStorage `t13-hlife-v1` only (`:612-632`) — and no
  record field names the tab kind: `run` (the `v` parameter), `mode` (pumped / own-loop) and
  `userAgent` are the nearest. The H-LOAD harness never POSTed either: its two `fetch` calls are
  load plants (`examples/hload/main.ts:288-314`); the 40 raw records left Chrome through a script I
  ran in the driven tab, which read the store, hashed the file body in the page and POSTed it (RAW
  RECORDS above). I know of no page-visible sign of the debugging attachment and have tested none,
  so as built the tab kind is a declaration made by whoever opens the URL.
- *(A) The page POSTs by itself:* a new URL parameter makes the page POST its own record to the
  receiver at the end of a run, and another stamps the tab kind into a new record field. New bytes —
  RG-3 then runs on them. The ruled path is ONE file: assembled from several per-run POSTs, it would
  be a file no page hashed (each record's own page hash would still hold).
- *(B) The H-LOAD route, no page change:* plain-tab runs write the store as they do now; once they
  read DONE, the driven tab opens the blank page (same profile, same origin), reads the store, picks
  the counted records by `run`, hashes the file body there, POSTs it and compares — it touches no
  run while it runs. The tab kind is stated in the `v` name handed to the owner (e.g.
  `plain-webgpu-1`, `driven-webgl2-1`) and again in the runs table.
- *Recommendation (B):* no new code in a measurement page; it is the route the H-LOAD records
  actually took; it gives the single ruled file byte-exact from a page; and one fingerprint
  (`ee6e577c…`) then covers RG-3, the owner's HL-1 check and every counted run.
- *My reading of the freed case, to confirm:* the page drives every stop and cycle itself, so no
  part of a run needs driving — every counted run on both backends would be a plain-tab run the
  owner opens, and the driven tab would only read the store and send the file.

**RR-1 RULED (owner, 2026-09-27): (B), and in the freed case every counted run is a plain-tab run.**
The owner answered two multiple-choice questions whose options I wrote; the chosen labels are quoted
verbatim, each with its option text as offered:

> "(B) Store route (Recommended)" — No page change. Plain-tab runs save to the browser store as now;
> after they read DONE, my driven tab reads the store and sends one file, the route H-LOAD actually
> took. hlife.ts stays at ee6e577c, so RG-3, your HL-1 check and every counted run share one
> fingerprint. Tab kind is written into the run name (e.g. plain-webgpu-1) and the runs table.
>
> "Yes, all plain-tab" — Every counted run on both backends is a plain-tab run you start by opening
> the URL; my driven tab never touches a run and only sends the records afterwards.

What follows from it: `hlife.ts` stays at `ee6e577c…`, so RG-3 runs on those bytes; the counted
records leave the owner's Chrome by the H-LOAD route, one file to the ruled path; every record's tab
kind is stated in its `run` name — `plain-…` for runs the owner opens, `driven-…` for runs driven
through the extension (the not-freed case, as planned) — and again in the runs table. Where
recorded: here; doc 06 D36 item 12's fourth follow-up; PLAN.md `## decisions`.

**RG-3 DONE (2026-09-27, owner-approved): the W3 page's plants re-run on the FINAL bytes — every
planted check went red again.** `hlife.ts` sha256
`ee6e577c26cef7760840192c9e310d6d230bcada5edef012a4d8652586c4af2c`, `hlife.html` `28c14731…`, both
hashed before and after the runs. The built-in pane (Chrome 152.0.7977.130; its WebGPU adapter
probed first, nvidia / ampere; hidden), frames pumped by the page (`?pump=1`): logic evidence, never
timing. Two cycles per run, as in the original plant runs; a fourth run repeats the first (below).

| run | page `hlife.ts` | backend | cycles / plant | result | reading | record sha256 (chars) |
|---|---|---|---|---|---|---|
| rg3-plants-webgpu | `ee6e577c…` (final) | webgpu | 2 / gpu-leak, skip-stop, expect-other | 3 passed, 4 failed | the three planted checks: backend [webgpu ×3] against the expected webgl2-fallback; stops announced [2, 0]; counters [000] — after each disposal 1 attribute (288 B), 1 geometry and 1 index attribute (144 B) left, the planted box. ALSO RED, unplanted: heap 1,301.8 → 1,302.2 → 1,421.4 MB | `faf1bc78…` (5,659) |
| rg3-heap-webgpu | `ee6e577c…` | webgpu | 2 / heap-grow 256 MB | 6 passed, 1 failed | the planted check only: heap 1,604.8 → 1,833.9 → 2,071.8 MB | `7af97f45…` (4,947) |
| rg3-plants-webgl2 | `ee6e577c…` | webgl2-fallback | 2 / gpu-leak, skip-stop, expect-other | 3 passed, 4 failed | the three planted checks: backend [webgl2-fallback ×3] against the flipped expectation webgpu; stops [2, 0]; counters [000] — every baseline all-zero at 1 render call, loaded 6 textures (639,631,360 B), after each disposal the planted box (1 attribute 288 B, 1 geometry, 1 index attribute 72 B). Also red: heap 1,283.5 → 2,325.1 → 3,285.5 MB, HL-1's WebGL2 growth as in pane-webgl2-noretain | `57ba4f02…` (5,686) |
| rg3-plants-webgpu-2 | `ee6e577c…` | webgpu | 2 / as rg3-plants-webgpu | 3 passed, 4 failed | the same three planted reds; ALSO RED again, unplanted: heap 1,309.4 → 1,322.4 → 1,328.0 MB | `467b01bc…` (5,751) |

- *The reds reproduce, each on its own check:* `expect-other` → `backend-as-expected` and
  `skip-stop` → `e2e-every-stop-and-back` on both backends; `gpu-leak` →
  `hlife-counters-back-to-baseline-exactly` on both — on WebGL2 with every baseline all-zero at one
  render call, the case the final guard was changed for; `heap-grow` →
  `hlife-heap-not-strictly-increasing` on WebGPU, where HL-1 does not grow the heap. In every run
  `e2e-ready-and-progress`, `hlife-every-cycle-ready-and-steady` and `visible-throughout` passed,
  with 0 page errors.
- *NOT as on the earlier bytes — an unplanted red:* the three-plant run on WebGPU also failed
  `hlife-heap-not-strictly-increasing` in 2 of 2 runs, where `pane-plants-1` on `cb0ac001…` failed
  exactly its three planted checks. On the same final bytes the unplanted WebGPU run
  `pane-final2-webgpu` passed it (1,426.1 / 1,376.1 / 1,434.2). Cause NOT established; two
  candidates, neither tested: the `gpu-leak` plant's box, material and compiled pipeline kept alive
  with every runtime HL-1 retains (a plant reaching a neighbouring check); or chance — with
  `cycles=2` the check judges three readings, the pane's unplanted WebGPU readings move by 5.6 to
  117.4 MB between steady points (the W3 runs table above), and three independent, identically
  distributed readings rise strictly one time in six (an assumption, not a measurement). The counted
  runs carry no plant and judge eleven readings. On WebGL2 the extra heap red is HL-1's growth.
- *Readouts, all four runs:* collected 0 of 9 after 40 pressure rounds; and the idle-heap readout
  equals the last steady reading TO THE BYTE (run 1: 1,490,492,669 B both), so it shows no change
  after the teardown — not investigated. The readout is ungated, and the ruled HL-1 interpretation
  rests on the collection count, not on it.
- *Records:* the pane's own store (`t13-hlife-v1`, these 4 records), not copied into the repo —
  logic evidence, like every pane run above; each record's page-printed sha256 is in the table.

**OWNER RULINGS and the owner's plain-tab HL-1 result (2026-09-27, the owner's GO message) — quoted
verbatim; the READOUT and DONE lines exactly as pasted.**

> GO. My plain-tab result follows at the end of this message (READOUT and DONE lines pasted
> verbatim).
>
> Ruling on the unplanted memory red in the RG-3 fault runs: it does NOT block the counted session.
> Grounds: the counted runs plant nothing, so the retained-plant-objects candidate cannot apply to
> them, and they judge eleven readings where the fault runs judged three against ~117 MB pane noise.
> Keep it recorded as an open observation with both untested candidates; if the counted runs' own
> heap series shows the same shape unplanted, it graduates to a finding and comes back as a stop.
>
> Also record, as a small named observation: the idle-heap readout equaling the last steady reading
> to the byte is suspicious enough to note (a readout that cannot move is a gauge that may not be
> connected) — you flagged it honestly; it goes in the record as unexplained, not relied upon, and
> HL-1's interpretation stays on the collected count as ruled.
>
> Then interpret my plain-tab result per the recorded rule (freed → instrument artifact, all counted
> runs plain-tab with the driven tab as store-courier only; not freed → real product finding, WebGL2
> heap failure pre-explained), and run the counted session accordingly: WebGPU then WebGL2, stops
> 1→2→0, ten alternating src-swap and remove/re-add cycles, final removal, records to
> docs/plan/results/phase-2-hlife-records.json via the store route, fingerprints re-checked on the
> repo copy, every record naming its tab kind. Announce anything that goes hidden and redo it.
>
> My plain-tab result:
>
> ```text
> READOUT — after teardown: idle heap 3135.1 MB; collected 3 of 12 (runtimes, renderers, splat meshes) after 40 pressure round(s); NOT collected: runtime 0, renderer 0, mesh 0, runtime 2, renderer 2, mesh 2, runtime 3, renderer 3, mesh 3
> DONE — 7 passed, 0 failed
> ```

**OPEN OBSERVATION MR-1 (named 2026-09-27, owner ruling above) — the unplanted memory red in RG-3's
three-plant WebGPU runs.** 2 of 2 runs (figures in the RG-3 table above). It does not block the
counted session. Both candidates stay untested: the `gpu-leak` plant's objects kept alive with
retained runtimes, or chance on three readings. If the counted runs' own heap series shows the same
shape unplanted, it graduates to a finding and comes back as a stop.

**OBSERVATION IH-1 (named 2026-09-27, owner ruling above) — the idle-heap readout cannot move.** It
equals the last steady reading to the byte in every run whose record was read for it: the four RG-3
runs, the owner's two plain-tab records and `frame-test-webgpu-c4` below (1,473,260,960 B both);
`pane-final2-webgpu` agrees to 0.1 MB. Unexplained; not relied upon; HL-1's interpretation stays on
the collected count, as ruled.

**THE PLAIN-TAB RESULT (2026-09-27) — PARTIAL: 3 of 12 collected. Neither branch of the recorded
rule covers it (handoff 015, resume step 4: a partial result is a stop).** The store was read by the
driven tab as courier only (the blank page, read-only, the tab then closed):
- *Two records in `t13-hlife-v1`:* `run-1790489730812` (2026-09-27T06:17:07.960Z) and
  `plain-hl1-check` (07:08:06.280Z). Both own-loop, webgl2-fallback, 3 cycles, 7 passed / 0 failed,
  `visible` throughout, 0 page errors, window 1894×1270 at ratio 1.5. The first record does not
  state its tab kind (its name is the page's default); this session had made no Chrome call at
  06:17Z, and handoff 015 records the previous session's only one at 2026-09-26 20:55 UTC. Nothing
  was deleted from the store.
- *The same pattern in both:* runtime 1 collected with its renderer and mesh; runtimes 0, 2 and 3
  not. Heap → 1,331.1 / 2,319.0 / 3,445.0 / 3,135.1 MB (`plain-hl1-check`) and 1,333.2 / 2,323.1 /
  3,447.2 / 3,267.5 MB: about +1 GB per load, then a fall at the fourth reading — which is why the
  heap check passed.

**FINDING HF-1 (2026-09-27) — MY FOURTH HARNESS FAULT in the W3 page: `hlife.ts` itself still names
three runtimes while its READOUT runs.**
- *By reading:* the READOUT runs inside the page's own async function (`:381-633`; the readout from
  `:476`), whose suspended frame still holds `firstRuntime` (`:399`, runtime 0) and the last loop
  pass's `previousRuntime` (`:438`, the runtime that pass tore down) and `runtime` (`:448`, the last
  runtime). The header's "The harness keeps NO reference to a runtime after its disposal" (`:36`) is
  wrong for these three. That a finished loop's block-scoped bindings stay reachable in a suspended
  async function is an engine detail I have NOT verified in V8's source; the run below is the
  evidence.
- *The element does not hold them:* both teardown paths null its reference right after `dispose()`
  (`src/embed/SplatSiteElement.ts:986-987`, a swap; `:1115-1116`, a removal).
- *The prediction, written down and told to the owner BEFORE the run:* with `cycles=4`, collected 6
  of 15 — runtimes 1 and 2 with their renderers and meshes — and NOT collected 0, 3 and 4; 0 of 15
  would mean the driven, pumped pane retains more than the plain tab. *The run* —
  `frame-test-webgpu-c4`, the built-in pane (driven, pumped, hidden, WebGPU), final bytes
  `ee6e577c…`: "collected 6 of 15 (runtimes, renderers, splat meshes) after 40 pressure round(s);
  NOT collected: runtime 0, renderer 0, mesh 0, runtime 3, renderer 3, mesh 3, runtime 4, renderer
  4, mesh 4" — EXACTLY as predicted. 7 passed, 0 failed; counters [11111]; heap 1,394.4 / 1,345.9 /
  1,370.3 / 1,328.1 / 1,405.0 MB; record sha256
  `617deaaf28346985e2220e78fa96661e4db3572f03bc3060ed0a628b64a518b8` (6,517 chars).
- *When the prediction was written (dated note 2026-09-27, the owner's prediction-first standard):*
  it preceded the run in the conversation only — in my message to the owner, sent before the run was
  started; it entered this ticket after the run, whose record is dated 2026-09-27T07:22:46.166Z at
  its end. From HF-1's ruling on, predictions are written here first, each with its time, before the
  run.
- *What it explains:* every in-page "0 collected" — at 1 or 2 cycles the frame names every runtime
  (0 of 6 once, 0 of 9 five times); the plain tab's 3 of 12, where only runtime 1 is unnamed; and
  the WebGL2 heap levelling near 3.3 GB after two cycles instead of climbing (`pane-webgl2-noretain`
  1,307.8 → 2,321.4 → 3,293.1 → 3,316.3; the plain tab above), because runtime 0 and the previous
  runtime are held beside the live one. And the driven, pumped pane freed what the plain tab frees —
  runtime 1 (torn down by a swap) and runtime 2 (by a removal) — so in THESE runs neither the
  debugging attachment nor the teardown path made the difference.
- *What it does not explain:* HL-1's bare-page experiment (— a `<splat-site>` driven from the
  console in a bare document, element removed, references dropped: none of the four collected). Not
  re-run; its console route is not examined here.
- *Consequences:* the recorded HL-1 rule assumed the READOUT measures the product; on these bytes it
  measures the product plus three references of my page. The heap readings carry the same fault —
  runtime 0 and the previous runtime are held at every steady point, about 1 GB each on WebGL2. The
  counter check is not affected: the counters are read from each renderer and return to zero on
  disposal whoever holds the objects.

**STOP HF-1 (2026-09-27) — raised before any counted run; the counted session is NOT started. Not
self-resolved: which evidence the ruled session produces is the owner's call.**
- *(A) Fix the page, then re-prove it:* the runtimes leave the page's own frame — `firstRuntime`
  used only to observe runtime 0, each cycle and the final teardown in helper functions whose
  variables end when they return, the READOUT after them — and the header corrected. No product
  change. New bytes, so: RG-3's four plants shown red again on them; a pane control whose READOUT is
  then evidence of what the product itself keeps; the owner's plain-tab HL-1 check again,
  interpreted by the recorded rule; then the counted session.
- *(B) Run the counted session on `ee6e577c…` as it is, HF-1 declared:* the counters stand; the heap
  series and the READOUT are known to include my page's references.
- *Recommendation (A):* the heap series and the collected count are the evidence the ruling rests
  on, and on these bytes both measure my page. The fix is inside the page only.
- *HL-1's status, proposed, the owner's call:* it stays a CANDIDATE, with its in-page evidence
  withdrawn as explained by HF-1; its remaining support is the bare-page experiment, until the fixed
  page runs in the owner's plain tab.

**OWNER RULING on STOP HF-1 (2026-09-27) — quoted verbatim; the whole message.** Where recorded:
here; HL-1's status note under the finding; the timing note under HF-1; doc 06 D36 item 12's sixth
follow-up; PLAN.md `## decisions`.

> Ruling on STOP HF-1: (A), as recommended. Fix the page so its main function names no runtime
> (small helper functions), correct the lying header at hlife.ts:36 — a header that claims "no
> references" while three variables hold runtimes is the same instrument-honesty defect as a gauge
> that cannot move — then the full re-proof in your stated order: (1) RG-3's four faults shown red
> on the NEW fingerprinted bytes, (2) a pane control whose READOUT then measures what the PRODUCT
> keeps, (3) the owner repeats the plain-tab HL-1 check on the new bytes, interpreted by the
> recorded rule (now with the partial case covered: state before the run what counts as freed, not
> freed, and partial on the fixed page, so no result arrives uninterpretable again), (4) the counted
> session.
>
> HL-1's status: accepted as proposed — it stays a candidate with its in-page evidence WITHDRAWN as
> explained by HF-1, recorded that way with the withdrawal's grounds, its only remaining support the
> bare-page console experiment. If step (2)'s pane control on clean bytes shows the product
> retaining nothing, re-run the bare-page experiment once before ruling HL-1 out entirely — a
> candidate should die on a measurement, not on a suspicion that its last leg was also contaminated.
>
> The prediction-first test (writing "6 of 15" down before running it) is the standard for
> cause-confirmation from here on; the record should show the prediction preceded the run.
>
> MR-1 and IH-1 dispositions stand as recorded. On IH-1 specifically: with HF-1 known, check once on
> the fixed bytes whether the idle readout moves when it should (the page held ~3 GB of runtimes —
> an idle reading identical to the byte across teardown was consistent with your page pinning the
> heap; if it still never moves on clean bytes, that is its own small finding about the readout's
> wiring).
>
> Then, per the standing order: the counted session, criterion 9's verdict, the AC4 12-item
> verdicts, check:full, both review rounds reported separately, the single commit.

**HF-1 FIXED (2026-09-27 02:41:19 -05:00, owner ruling A): the run's frame names no runtime.**
`examples/site-lab/hlife.ts` `ee6e577c…` →
`112a179fe30f05b011618019c285edededdce9e0f2d575bb16fde7f2c872be23` (687 lines, 29,248 B, LF),
written once. Four edits and nothing else — reversing them rebuilds `ee6e577c…` byte for byte
(27,633 B; checked, a copy kept in the session scratchpad only):
- *The header* (`:36-43`) no longer claims what was false: it says how the run keeps no runtime, and
  carries a dated CORRECTED note naming the earlier false claim.
- *`mountFirst`* observes runtime 0 and returns only its record, so `firstRuntime` is gone.
- *`runCycle`* does one swap or remove / re-append and observes the next runtime to its steady
  point; its `previousRuntime` and `runtime` end when it returns. The heap is read by the run AFTER
  it returns (`measureHeap(result.next)`), because until then its frame still names the runtime it
  tore down.
- *The run* keeps the same order, checks, notes and record; `mark` became `const` (it is no longer
  reassigned). No product file touched. `npx tsc --noEmit` exit 0 (`tsconfig.json:24` includes
  `examples/**/*.ts`).

**PREDICTIONS for the re-proof — written here at 2026-09-27 02:42:39 -0500, BEFORE any run on the
fixed bytes (owner's prediction-first standard).** All pane runs: the built-in pane, `?pump=1`,
logic only.
- *RG-3 on `112a179f…` (step 1), two cycles each, as before:* `rg3b-plants-webgpu` and
  `rg3b-plants-webgl2` (`gpu-leak,skip-stop,expect-other`) fail `backend-as-expected`,
  `e2e-every-stop-and-back` and `hlife-counters-back-to-baseline-exactly`; `rg3b-heap-webgpu`
  (`heap-grow`, 256 MB) fails `hlife-heap-not-strictly-increasing`. The heap check in the
  three-plant runs is NOT predicted (MR-1 stays open). If the product keeps nothing, every READOUT
  reads **collected 9 of 9**: no plant adds a page reference to a runtime.
- *The pane control (step 2), four cycles, no plant:* `ctl-webgpu-c4` and `ctl-webgl2-c4` read 7
  passed, 0 failed, counters [11111], and **collected 15 of 15** — if the product (and the pane's
  driving) keeps nothing. Any object not collected is then held by the product or the pane, not by
  this page. On WebGL2 each steady reading stays within 500 MB of the first (no step of about 1 GB
  per retained runtime, as `pane-webgl2-noretain` showed under HF-1); a reading above that means
  either a runtime is kept or the collector had not yet run, and the collected count tells which.
- *IH-1 on the fixed bytes:* the idle readout STILL equals the last steady reading to the byte.
  Suspected cause, from my recollection of Chromium's `performance.memory` (Blink's `MemoryInfo`),
  NOT verified: the values are cached and refreshed at most once per 50 ms, and the idle read comes
  within 50 ms of the last steady read (one teardown and 201 macrotask yields). If so, it is a
  finding about the readout's wiring, not about the page's references.
- *The direct probe of that cause (the pane, the blank JSON page, no toolkit code):* read A;
  allocate and hold about 256 MB; read B in the same task — **B equals A to the byte**; wait at
  least 100 ms; read C — **C exceeds A by more than 200 MB**; read D in the same task as C — **D
  equals C**. B differing from A refutes the 50 ms cache.
- *The bare-page re-run (HL-1's last leg; only if both controls read 15 of 15), once, WebGL2:* a
  `<splat-site>` on lab.site.json in the blank JSON document, driven from the pane's console with
  every reference kept inside one finished async function and only numbers returned; its runtime,
  renderer, splat mesh and the element registered, plus 5 unreachable controls; the element removed.
  **4 of 4 collected, and 5 of 5 controls** — if the product and that console route keep nothing.
  Fewer than 4 with 5 of 5 controls leaves HL-1 alive on a measurement.
- *The owner's plain-tab check (step 3):* its freed / not freed / partial rule is written here after
  the pane control and before the owner runs it.
- *Added PREDICTION, written at 2026-09-27 02:52:35 -0500, after rg3b-plants-webgpu and
  rg3b-heap-webgpu and BEFORE rg3b-plants-webgl2:* rg3b-plants-webgpu read collected 6 of 9 (the
  last runtime, 2, not collected) where 9 of 9 was predicted; rg3b-heap-webgpu read 9 of 9 as
  predicted. Candidate: the `gpu-leak` plant renders into the last runtime from the page just before
  the final teardown. If that is what keeps it, rg3b-plants-webgl2 (the same plants) reads **6 of 9
  with runtime 2, renderer 2 and mesh 2 not collected**; 9 of 9 counts against it. The control
  predictions above (no plant, 15 of 15) are unchanged.
- *Probe 1's outcome, recorded before probe 2 is run:* A 726,910,233; B 994,945,347 (B differs from
  A, so my written clause "B equals A" FAILED as written) — but 83.1 ms passed between A and B, the
  allocation itself being slow, longer than the 50 ms suspected, so this clause could not tell a
  cache from none: a fault in my probe's design (the prediction did not bound that time). C − A
  255.6 MB at 233.8 ms (as predicted); D equals C, 0.1 ms apart with nothing allocated between —
  which shows nothing either way. The cause stays unconfirmed.
- *PROBE 2 PREDICTION, written at 2026-09-27 03:00:53 -0500, BEFORE it runs (the pane, the blank
  JSON page):* 200 steps, each allocating 1 MB of on-heap numbers (kept) and spinning 2 ms, then
  reading `performance.memory.usedJSHeapSize`. If the value is cached for 50 ms, it changes about
  **8-10 times, and never twice within 45 ms**; without a cache it changes at most steps (well over
  50 changes, about 2 ms apart). Either result is recorded; the idle readout's other wiring fact
  stands regardless: `hlife.ts` reads the idle heap right after the teardown, BEFORE the collection
  rounds, so it cannot show a torn-down runtime's memory being freed.
- *Recorded before the next run — probe 2 CONFIRMED its prediction:* 8 changes in 434.7 ms, gaps
  51.7 / 51.6 / 51.6 / 51.9 / 52.2 / 52.0 / 50.0 / 50.1 ms, none within 45 ms, each step about 24-25
  MB: `performance.memory` refreshes at most once per about 50 ms in this Chromium. And the controls
  read 15 of 15 on both backends, so the bare-page re-run was made: `bp-1`, WebGL2
  (`webgl2-fallback` confirmed), ready at 18.9 s, 300 pumped frames after it, then runtime,
  renderer, splat mesh, element and 5 controls registered and the element removed. Result after 40
  pressure rounds (10.1 s): **8 of 9 — runtime, renderer, mesh and all 5 controls collected; the
  ELEMENT not collected.** My prediction (4 of 4) FAILED on the element.
- *PREDICTION for one corrected re-run `bp-2`, written at 2026-09-27 03:04:26 -0500, BEFORE it
  runs:* by reading my own probe, `bp-1` had HF-1's fault in another form: every closure made in its
  one async function shares that function's scope object; `pump` uses `el`, so `el` lives in that
  shared scope; the message channel's `onmessage` handler was made in the same function, and a
  started port with a listener is kept alive by the browser (my understanding, not verified) — so
  that handler can hold `el`. `rt` is used by no closure, and the runtime WAS freed. `bp-2` changes
  only that: the yield helper is made outside the function that names the element. If my probe was
  the holder, `bp-2` reads **4 of 4 and 5 of 5 controls**; the element still not collected means
  something else holds it. The owner asked for ONE re-run; this second one exists only to remove my
  probe's own fault, and is reported as such.

**RE-PROOF RESULTS on `112a179f…` (2026-09-27, recorded at 2026-09-27 03:07:20 -0500) — each against
its prediction written above before it ran (02:42:39 -05:00; the added ones at 02:52:35, 03:00:53
and 03:04:26).** The built-in pane (Chrome 152.0.7977.130, nvidia / ampere), pumped, logic only;
record times are the runs' ends, in UTC, all after 07:42:39Z.

| run | ended (UTC) | backend | cycles / plant | result | READOUT | heap at each steady point (MB) | against the prediction | record sha256 (chars) |
|---|---|---|---|---|---|---|---|---|
| rg3b-plants-webgpu | 07:45:56 | webgpu | 2 / gpu-leak, skip-stop, expect-other | 4 passed, 3 failed — exactly the three planted checks | collected 6 of 9; NOT runtime 2, renderer 2, mesh 2 | 1,344.3 / 1,401.9 / 1,328.2 | reds as predicted; READOUT "9 of 9" FAILED | `a935268a…` (5,617) |
| rg3b-heap-webgpu | 07:51:10 | webgpu | 2 / heap-grow 256 MB | 6 passed, 1 failed — the planted check | 9 of 9 after 3 rounds | 1,594.4 / 1,982.1 / 2,114.8 | as predicted | `a8b160f1…` (4,885) |
| rg3b-plants-webgl2 | 07:53:52 | webgl2-fallback | 2 / gpu-leak, skip-stop, expect-other | 3 passed, 4 failed — the three planted checks (baselines all-zero at 1 render call) and the heap check | collected 6 of 9; NOT runtime 2, renderer 2, mesh 2 | 1,283.9 / 2,295.8 / 2,325.7 | reds as predicted; "9 of 9" FAILED; the added prediction (6 of 9, runtime 2) HELD | `4e1beb94…` (5,646) |
| ctl-webgpu-c4 | 07:56:55 | webgpu | 4 / — | 7 passed, 0 failed; counters [11111] | **15 of 15** after 3 rounds | 1,322.7 / 1,393.9 / 1,394.9 / 1,360.1 / 1,378.0 | as predicted | `93bfb19a…` (6,486) |
| ctl-webgl2-c4 | 07:59:12 | webgl2-fallback | 4 / — | 7 passed, 0 failed; counters [11111] | **15 of 15** after 3 rounds | 1,262.8 / 2,325.8 / 2,341.8 / 2,323.7 / 2,299.7 | 15 of 15 as predicted; the heap-level clause ("within 500 MB of the first") FAILED | `e3a386e0…` (6,492) |

- *Step 1 DONE:* every planted fault went red on the new bytes, on both backends. MR-1 did not recur
  in the one three-plant WebGPU run (its heap check passed).
- *Step 2 DONE:* with the page naming no runtime, the pane frees every runtime, renderer and splat
  mesh on both backends — 15 of 15 twice, within 3 pressure rounds. Everything not collected before
  HF-1's fix is accounted for by the page's own references.
- *The last runtime kept in the three-plant runs* (2 of 2; the added prediction held): a side effect
  of that plant set. `gpu-leak`, which renders into the last runtime from the page just before the
  teardown, is the most plausible member; it is not isolated from the other two. The counted runs
  carry no plant.
- *The WebGL2 heap plateau:* from the second steady point on, about one extra runtime's worth (~1
  GB) is present, NOT growing (2,325.8 → 2,299.7), and every runtime is collected by the end. So at
  a steady point the previous runtime's memory is either garbage the collector has not reached or
  held briefly — not distinguished. The series passes the ruled standard (not strictly increasing).
- *IH-1 — EXPLAINED, the owner's check on the fixed bytes:* the idle readout equalled the last
  steady reading to the byte in 4 of these 5 runs and moved by 70,076 B in `ctl-webgl2-c4`. Probe 2
  confirmed, prediction first, that `performance.memory` refreshes at most once per ~50 ms here; and
  the page reads the idle heap right after the teardown, BEFORE the collection rounds (`hlife.ts`
  idle read, then the pressure loop). So the gauge is connected but (a) rate-limited — a read within
  50 ms of the last repeats it — and (b) placed before any collection, so it cannot show freed
  memory. A small finding about the readout's wiring, as framed. NOT fixed: the readout is ungated
  and relied on by nothing, and a fix changes the page bytes again — the owner's call.
- *HL-1's last leg, measured:* `bp-1` read 8 of 9 (the element not collected) and `bp-2`, with only
  my probe's fault removed, read **9 of 9 — runtime, renderer, splat mesh, element and 5 of 5
  controls**, collected before any pressure round; its prediction held, so in `bp-1` my probe held
  the element. On measurement, in the pane, the product keeps nothing. Proposed, the owner's call:
  HL-1 is ruled OUT if the owner's plain-tab check (step 3) reads 12 of 12. The original bare-page
  result (none of four, 2026-09-26) cannot be re-examined: its console script was in the previous
  session's scratchpad; whether it had the same fault is not known.

**STEP 3 RULE — the owner's plain-tab check on `112a179f…`, stated at 2026-09-27 03:07:20 -0500,
BEFORE it runs (owner ruling on STOP HF-1: the partial case covered).** URL
`http://localhost:5173/examples/site-lab/hlife.html?webgl=1&cycles=3&v=plain-hl1-check-2` in an
ordinary tab with no debugging attachment; 12 objects watched (runtimes 0-3, their renderers and
splat meshes), none named by the page after its teardown.
- *FREED = collected 12 of 12* → the recorded rule's freed branch: every counted run is a plain-tab
  run the owner opens, and the driven tab only reads the store and sends the file; and HL-1 ruled
  out (proposed above).
- *NOT FREED = 0 of 12* → the recorded rule's not-freed branch: a real product finding — the plain
  tab keeps what the pane frees — with the WebGL2 heap failure pre-explained and the retainer hunt
  its own ticket; the counted runs driven as planned.
- *PARTIAL = 1 to 11 of 12* → treated as NOT FREED: on these bytes the page names no runtime, so
  whatever is kept is kept by the product or the browser; the pattern (which objects, by teardown
  cause) recorded; the counted runs driven as planned.
- *Not interpreted either way:* the page's heap check in this 3-cycle run (four readings, and on
  WebGL2 a plateau after the first, so a strict rise happens about one time in six by chance — an
  assumption) and the idle readout (IH-1). A page error, another check failing or a hidden moment is
  reported before any interpretation.
- *My prediction:* 12 of 12. And if the owner's `hlife.html` tab was still open at 02:41:19 -05:00,
  Vite's reload re-ran it once on the new bytes; any record named `plain-hl1-check` after that time
  is that re-run and is left out.

**OWNER GO and rulings on the fixed page's plain-tab result (2026-09-27) — quoted verbatim, the
whole message; the READOUT and DONE lines exactly as pasted.**

> GO — my plain-tab result on the fixed page is at the end of this message, to be interpreted by the
> recorded rule (12/12 freed → all counted runs plain-tab with your driven tab as courier; 0/12 →
> real product finding, driven runs as planned; partial → treated as not freed, pattern recorded).
>
> Two rulings folded in:
>
> IH-1: leave the readout unchanged, exactly as you reasoned — nothing relies on it, and re-touching
> the page would force another re-proof cycle for a gauge that is now understood. Record it as a
> wiring finding (reading taken inside the ~50 ms performance.memory refresh window, before cleanup)
> with the probe evidence, and add "re-place the idle-heap reading" to the post-ticket small-changes
> list.
>
> HL-1 rule-out: accepted as proposed — if my result reads 12 of 12, HL-1 is RULED OUT, recorded
> with its full evidence chain (in-page evidence withdrawn under HF-1; bare-page leg explained by
> the probe's own scope flaw, bp-2 clean with prediction-first; plain tab clean on fixed bytes).
> Anything other than 12 of 12 and it stays a candidate with the new pattern recorded, and the
> counted runs proceed under the partial=not-freed rule.
>
> Your second bare-page run despite my "once" was right, and the record shows why it was right: the
> first run's instrument was the thing being tested, and you changed only the flawed part with the
> prediction written first. That supersession is noted as proper.
>
> Then the counted session per the standing order — WebGPU then WebGL2, stops 1→2→0, ten alternating
> src-swap and remove/re-add cycles, final removal, records to
> docs/plan/results/phase-2-hlife-records.json via the store route, fingerprints re-checked on the
> repo copy, every record naming its tab kind, hidden runs redone. After it: criterion 9's verdict,
> the AC4 12-item verdicts, check:full, both review rounds reported separately, the single commit.
>
> My plain-tab result:
>
> ```text
> READOUT — after teardown: idle heap 2260.7 MB; collected 12 of 12 (runtimes, renderers, splat meshes) after 3 pressure round(s)
> DONE — 7 passed, 0 failed
> ```

**THE PLAIN-TAB CHECK ON THE FIXED PAGE — FREED, 12 of 12 (read by the driven tab as courier only,
2026-09-27 04:07:42 -0500).** The store `t13-hlife-v1` holds four records:
- `run-1790489730812` (06:17:07Z) and `plain-hl1-check` (07:08:06Z) — the old bytes, recorded above.
- `plain-hl1-check` (07:42:47Z) — the rerun Vite's reload made when the fixed page was saved at
  02:41:19 -05:00 (07:41:19Z), as flagged before it was known; LEFT OUT, as announced.
- `plain-hl1-check-2` (09:05:08Z) — THE CHECK: own-loop, webgl2-fallback, 3 cycles, 7 passed, 0
  failed, `visible` throughout, 0 page errors, Chrome 154, 1894×1270 at ratio 1.5; heap 1,278.3 /
  2,319.0 / 2,319.3 / 2,260.7 MB (the pane's plateau shape); **collected 12 of 12 after 3 rounds,
  nothing left**; the idle readout equal to the last reading (IH-1). My prediction (12 of 12) held.
  By the recorded rule: FREED.

**OBSERVATION IH-1 — RECORDED AS A WIRING FINDING (owner ruling above).** `hlife.ts` takes its
idle-heap reading inside `performance.memory`'s ~50 ms refresh window after the last steady reading,
and before any cleanup: probe 2 (prediction first) saw 8 changes in 434.7 ms, gaps 50.0-52.2 ms,
none within 45 ms; the reading equalled the last steady one to the byte in every run read for it
except `ctl-webgl2-c4` (+70,076 B). Left unchanged; "re-place the idle-heap reading" is on the
post-ticket small-changes list.

**The second bare-page run (`bp-2`), made despite the owner's "once" — noted by the owner as a
proper supersession** (quoted above): the first run's instrument was what was being tested, and only
its flawed part changed, the prediction written first.

**THE COUNTED SESSION — the freed branch: every counted run is a plain-tab run the owner opens; the
driven tab only reads the store and sends the file.** Page `112a179f…`, re-hashed on disk and as
served before the runs.
- *Run 1, WebGPU:* `http://localhost:5173/examples/site-lab/hlife.html?v=plain-webgpu-1`. *Run 2,
  WebGL2, after run 1 reads DONE:* `…/hlife.html?webgl=1&v=plain-webgl2-1`. No `pump`; `cycles` at
  its default, 10: ready with the progress contract, stops 1 → 2 → 0, ten cycles alternating a src
  swap and a remove / re-append, the final removal — eleven runtimes.
- *Tab kind:* in each record's `run` name, `plain-…`, and again in the runs table.
- *Hidden runs redone:* a run whose `visible-throughout` fails is discarded and redone under the
  next number (`plain-webgpu-2`, …). A run that fails for another reason is reported before any
  interpretation.
- *The records file:* the counted, valid records only — one per backend, as the H-LOAD file held its
  40 valid records; any discarded run is listed in the runs table, not in the file. The body is
  built and hashed in the driven tab on the blank JSON page, POSTed to the loopback receiver on 5299
  (started from a temporary launch entry; `.claude/launch.json` restored to `222aaee4…` after), the
  receiver's byte count and sha256 compared, the file copied to
  `docs/plan/results/phase-2-hlife-records.json` and re-hashed there; each record's own digest,
  recomputed from the store, kept beside the file's.
- *No served file is edited while a run is open* (Vite's reload re-runs an open page).

**THE COUNTED SESSION — DONE (2026-09-27, recorded at 2026-09-27 05:11:24 -0500): H-LIFE ×10 and the
end-to-end run on the whole element, both backends, in the owner's plain tab; 7 of 7 checks passing
on each; no run hidden, none redone.** Page `112a179f…` (on disk and as served, `?raw` hashed equal,
before the runs). Dev server pid 27944, started by this session at 04:57:57 -05:00 after the app
stopped the previous one (pid 37600) at 04:38:18 — the app's record: "stopped by the app"; its log
ends with Vite's ready lines and no error; why, not known. The owner's first run 1 attempt met the
stopped server and left no record (the store was read before the rerun).

| run | tab kind | ended (UTC) | backend | result | stops announced | heap at each steady point (MB) | READOUT | record sha256 (chars) |
|---|---|---|---|---|---|---|---|---|
| plain-webgpu-1 | plain, opened by the owner | 10:02:29 | webgpu ×11 | 7 passed, 0 failed | [1, 2, 0] (each reached in about 3 s) | 1,356.7 / 1,426.7 / 1,424.0 / 1,423.9 / 2,020.5 / 1,435.5 / 1,376.9 / 1,435.6 / 2,021.3 / 1,377.8 / 1,424.9 | collected 33 of 33 after 3 rounds | `3e7badcca1db952216ace03f9a56004304643a35938d2f9bdae0100be5a672e8` (11,121) |
| plain-webgl2-1 | plain, opened by the owner | 10:08:17 | webgl2-fallback ×11 | 7 passed, 0 failed | [1, 2, 0] | 1,331.0 / 2,319.0 / 2,287.2 / 2,315.7 / 2,255.1 / 2,325.1 / 2,321.7 / 2,293.4 / 2,255.7 / 2,223.7 / 2,222.9 | collected 33 of 33 after 3 rounds | `28762c2f3109e9f7004a0aba005b072aa552b15ba2120d79f18a08f5d132dcd6` (11,337) |

- *The seven checks, each passing on both:* `backend-as-expected`; `e2e-ready-and-progress` (ready
  with 3 stops, initial `overview`; the progress contract, 2 reports ending in exactly one 1);
  `e2e-every-stop-and-back`; `hlife-counters-back-to-baseline-exactly` (11 runtimes, each torn down
  once, every baseline all-zero and back to it exactly — on WebGL2 each baseline read after its one
  empty render); `hlife-heap-not-strictly-increasing`; `hlife-every-cycle-ready-and-steady` (0 load
  errors, 0 page errors); `visible-throughout` (visible from the first read, no change). Both runs:
  own loop, no plant, 10 cycles, Chrome 154, 1894×1270 at ratio 1.5.
- *Against AC3's wording* ("H-LIFE ×10 on the full element with a real site.json — heap flat across
  cycles, scene-swap under a live element included"): ten cycles on one live element, five of them
  src swaps, on the pin's two portfolio sites; the heap judged by the ruled standard, not strictly
  increasing (W3 a), and met on both backends. On WebGL2 the level after the first reading is about
  1 GB higher and then flat — the plateau the pane showed (one extra runtime's worth at a steady
  point, everything collected at the end). The AC's box is ticked at close-out, with the other
  verdicts.
- *MR-1:* neither counted heap series rises strictly, so its shape did not appear unplanted; it does
  NOT graduate and stays an open observation of the fault runs.
- *Observed, not interpreted:* WebGPU's two readings near 2.0 GB fall on the two "re-add, lab"
  cycles (4 and 8); the other nine are 1,356.7-1,435.6. The idle readout equalled the last reading
  in both runs (IH-1).
- *The records file* `docs/plan/results/phase-2-hlife-records.json`: the two counted records, WebGPU
  first, one line, 22,461 characters (20 of them 3-byte arrows and dashes). Built and hashed in the
  driven tab on the blank JSON page; POSTed to the loopback receiver — rebuilt from handoff 015's
  description as `receiver.py` in the session scratchpad, writing `received-<name>` beside itself
  (no folder created), bound to `::1:5299`, started from a temporary launch entry `t13-receiver`
  (pid 14452). Page and receiver: **22,501 B, sha256
  `180678f2467bf3cea57a647a92b64ce8088ee14a417243820b23bb370d35dbd4`**; the repo copy re-hashed
  equal, no line break. Each record's digest recomputed in the page and again by Python from the
  repo copy — equal, as in the table. Receiver stopped; `.claude/launch.json` restored byte for byte
  (`222aaee4…`). The store's four other records stay in the owner's browser; nothing deleted.

**THE CLOSE-OUT FIXTURE RUNS, part 1 — pager-lab on its final bytes (2026-09-27, recorded at
2026-09-27 05:35:37 -0500).** `examples/pager-lab/main.ts` `8859e840…` on disk and as served (`?raw`
hashed equal). The built-in pane (Chrome 152.0.7977.130; WebGPU adapter nvidia / ampere, probed
first), frames driven by the page: logic evidence, never timing. Why these runs first: W4's WebGPU
held-flag plant had been shown red on `4d099776…` and `f984f062…` only, and no unplanted WebGPU run
existed on `8859e840…` — by the owner's RG-3 standard, not yet shown red on the bytes that will
ship.

| run | regime / backend | plant | pager-lab | `sh-output-fresh-after-admission` |
|---|---|---|---|---|
| cf-1 | default / webgpu | sh-rearm-held | 25 passed, 2 failed | **FAIL as planted** — SH passes on the admission render 0; R1 vs R2 (forced pass) 196,608 of 262,144 words differ; chunk 56 admitted into chunk 8's slot 1. The other failure: PL-1 (re-admit 7 against a band of 6) |
| cf-2 | default / webgpu | — | 27 passed, 0 failed | PASS — 1 SH pass; 0 of 262,144 differ; R0 vs R2 196,608 differ |
| cf-3 | `?pages=32` / webgpu | — | 27 passed, 0 failed | PASS — 1 SH pass; 0 of 262,144 differ |
| cf-4 | default / webgl2-fallback | — | 27 passed, 0 failed | PASS — the premise: no contribution buffer, per-vertex SH node in use |
| cf-5 | `?pages=32` / webgl2-fallback | — | 27 passed, 0 failed | PASS — the premise holds |

- *PL-1's tally, as ruled (a failure alone does not block close-out):* on WebGPU it failed in cf-1
  and passed in cf-2 and cf-3 — 1 of 3 today; across this ticket 4 of 11 WebGPU pager-lab runs (runs
  2, 3, 7 and cf-1). cf-1's plant cannot reach it: `evict-readmit-pixel-identical` runs before the
  SH drill. On WebGL2 it passed in all 5 runs of this ticket (band 0, exact).
- *The watchdog echo is gone in the final position:* the held plant tripped
  `partial-path-healthy-after-drills` only in run 1, on the first position's bytes; cf-1, like run
  5, failed only the planted check and PL-1.

**CRITERION 9 — VERDICT (2026-09-27; the W4 check is its instrument, as ruled): ✓, BOTH halves.**
Doc 05: "a page uploaded under a motionless camera becomes visible with sort + SH explicitly
re-dispatched (verified via selection growth + the invalidate() path; a direct SH-output assertion
is deferred to the production diag stack — recorded as a gap, not a pass)".
- *The selection-growth half:* ✓ in 20/20 counted H-LOAD trials (results doc, criterion 9's row).
- *The SH-output half, the direct assertion:* `sh-output-fresh-after-admission` on the bytes that
  ship. It goes RED when the fault it guards is planted (cf-1: the pass held off, the slot kept the
  previous chunk's colours), GREEN unplanted on WebGPU in both regimes (cf-2, cf-3: the admission
  render ran the pass, and its output equals a forced recompute bit for bit), and on WebGL2 the
  recorded premise holds in both regimes (cf-4, cf-5), the premise's own plant red on these bytes
  (run 9, above).
- *The gap doc 05 recorded is CLOSED.* The assertion lives in pager-lab, not in the production diag
  stack the deferral named: that stack reads counters and has no GPU-buffer readback (the W4 stop's
  grounds), and the owner ruled the fixture (W4 a). Recorded beside doc 05's criterion 9 and the
  results doc's generated row, which is left as generated.

**RECORD GAP RG-5 — found and corrected (2026-09-27).** This ticket's H3 stop cited doc 05 `:95-96`
for "Measurement runs pin `setPixelRatio(1)` and a fixed window size"; that was right at HEAD, and
the five lines this ticket added at `:89-93` moved it to `:100-101`. Corrected in place above, the
old number kept. The note added beside criterion 9 today extends an existing line, so no doc 05 line
moves; the other doc 05 citation here (`:87-88`) is before the insertion and still right.

**AC4 — THE TWELVE VERDICTS (2026-09-27, recorded at 2026-09-27 05:49:41 -0500): each a number and
improved / unchanged / deferred with grounds.** The list is the owner-confirmed one above (ruling
R4). Every number was taken fresh this session (handoff 015: earlier pane readings were never
written down). Sources: the 40 counted H-LOAD records (`phase-2-hload-trials.json`, `189f117b…`);
the counted H-LIFE records (`phase-2-hlife-records.json`, `180678f2…`); the backend's own counters
read at steady in the pane (counts only — never timing); pager-lab's own convergence lines; a fresh
`npm run build:lib`. **The deferrals are PROPOSED, for the owner's confirmation at close-out.** **CONFIRMED 2026-09-27 (owner close-out ruling 4):** "the proposed deferrals are CONFIRMED as recorded in the ticket's table." R2-8 stays recorded as the caveat on AC4-1 and AC4-7's traversal counts (ruling 3; round 2's table, below).

| # | item | the number today (how measured) | the carried figure | verdict (grounds) |
|---|---|---|---|---|
| AC4-1 | Traversal on the main thread | per-traversal cost in the 40 counted H-LOAD trials (the backend's own `lod.lastTraversalMs`, sampled at each new traversal, `hload/main.ts:551`; median of per-trial means, 5 trials each): **76.5 ms** webgpu-pages32, **78.2** webgl-pages32, **302.2** webgpu-default, **308.4** webgl-default; max 115.0 / 116.1 / 670.6 / 616.6 | Phase 0 ~260 ms at 32 pages (the spike's traversal); ticket 07 ~300-350 ms at 32, ~1.26-1.29 s at 122 | **IMPROVED** in number (at 32 pages 76.5 against ~260 and 300-350; at 122 about 302 against 1.26-1.29 s) — not like for like: the spike measured its own traversal, ticket 07's environment is not recorded, and a trial's mean covers every traversal of the load. Still on the main thread: the worker move is **deferred** — proposed grounds: the longest main-thread task beats the bar in every configuration (results doc), so the move is post-parity work |
| AC4-2 | `covarianceB.zw` dead lanes | **8 of 100 bytes per splat = 8.0 %**: the renderer's own counter holds 799,571,968 B for 7,995,392 splats (122 × 65,536; the counted WebGPU record, every runtime) = 100 B a splat plus 32,768 B, and `covarianceB` fills 2 of its 4 lanes (`GaussianSplatMesh.js:382-383`) | 8 % (phase-0.md:125; doc 06 D17) | **UNCHANGED** — the vendored layout, its files at FORK.md's digests (re-hashed today). **Deferred**, proposed grounds: D17 is OPEN, and reclaiming the lanes is a fork patch to a byte-frozen file (D20) or an upstream change |
| AC4-3 | Raw-bytes cache holds the whole asset | **213,719,504 B** held at steady in BOTH regimes — `pagerDiagnostics(...).cachedBytes` read in the pane (WebGPU; default and `pageBudgetOverride` 32, only 32 pages resident), equal to the asset's `allChunkBytes` (phase-0.md:20); by reading, the cache has no bound (`RadPager.ts:152-231` set on arrival and after decode, cleared only on dispose, `:297`) | all 213 MB (phase-0.md:126-127) | **UNCHANGED**. **Deferred**, proposed grounds: an LRU bound or range re-fetch changes the retry semantics (doc 03 §A2) — a design decision, not a Phase 2 parity item; peak heap beats the bar in every configuration |
| AC4-4 | WebGL2 fallback memory | three's own counters for each loaded WebGL2 runtime of the hero: **6 textures, 639,631,360 B** (all 11 runtimes of the counted WebGL2 run, identical); the JS arrays the textures keep: about **0.99 GB** — the step from the first steady heap to the plateau, 1,331.0 → 2,319.0 MB, one extra runtime's arrays present | ≈ 1.8 GiB GPU + ~0.85 GiB heap at 122 pages (phase-0.md:128-131) | **UNCHANGED** in kind — the fork's fallback path, byte-frozen. The GPU figures do not compare: three's counter counts textures, not the buffer and transform-feedback copies. **Deferred**, proposed grounds: a smaller fallback class budget is a product decision the formula already allows; WebGL2 peak heap beats its bar (2,020 against 2,887 MB) |
| AC4-5 | SH1 saturation | **1.505** hero sh1 max, **~12 %** of the range clipped — the same asset (`allChunkBytes` 213,719,504 B, read today) through the same ±1 8-bit packing (the vendored files at FORK.md's digests) | the same (phase-0.md:132-134) | **UNCHANGED** by construction — accepted (§H.3) as the named cause of any banding; nothing to decide in Phase 2 |
| AC4-6 | MediaLayer `getMaxAnisotropy()` | **1** — production renders through `WebGPURenderer` on both backends, which has no `renderer.capabilities`, so `maxAnisotropy` keeps its default (`MediaLayer.ts:71`, `:94`; by reading) | parity 1 (spec.md:79-82; ticket 09:17-19) | **UNCHANGED**, **deferred** by the owner's ruling (post-parity). Found by reading: the call as written cannot reach `WebGPURenderer`, so the post-parity item needs a route that works there — not checked which |
| AC4-7 | Per-traversal hot-path costs | no per-function timing exists in the production counters; the whole traversal bounds them: **76.5 / 302.2 ms** per traversal (AC4-1) | "trivial next to the 300 ms+ traversal; ticket 13 measures" (ticket 07:182-189) | **Deferred**, proposed grounds: separating them needs a profiler pass or new instrumentation; they sit inside the traversal the worker move (AC4-1) would take off the main thread |
| AC4-8 | F6 initial-protection churn | **10-17 residency changes per fresh load at 32 pages** on WebGPU (36 loads across three pager-lab runs today, pager-lab's own `CONVERGENCE … residencyChanges=` line, `pager-lab/main.ts:441` — ticket 07's measure on its fixture); WebGL2 7-9 (12 loads). Settling in the counted trials: steady **2,047.4 ms** (WebGPU) and **1,902.0** (WebGL2) medians at 32 pages. (An element-level count in the pane, the element's own first stop, gave 25 — a different pose.) | 11-20 swaps, ~3.7-4.6 s settling (ticket 07:111-113, :124-128) | **UNCHANGED** in kind — the swap count sits in ticket 07's range; the settling times are not like for like (pumped pane then, counted Chrome now). **Deferred**, proposed grounds: the design stop ticket 07 named (protect only the root before the first traversal) was never raised; constrained steady beats the bar (2,047.4 against 3,055; 1,902.0 against 4,349) |
| AC4-9 | WebGL2 full-budget load, O(pages²) | counted trials: webgl-default full quality **15,523.7 ms** (median); webgl-pages32 steady **1,902.0 ms** | 32 pages 2.15 s; 122 pages 29-55 s (ticket 06:182-192) | **IMPROVED** in number (15.5 s against 29-55 s; 1.9 against 2.15 s) — not attributed: the mechanism (a full-capacity CPU sort and whole-texture re-uploads per arrival) was not re-examined; also beats the bar (15,523.7 against 75,127 ms) |
| AC4-10 | `lodRenderScale` | **1** — read from the door at steady in both regimes today | 1, the null value; "ticket 13's knob" (ticket 07:53-55) | **UNCHANGED**. **Deferred**, proposed grounds: at 1 the selection matches the spike's exactly at 1280×720 (603,256 and 2,314,382, the same-day control) — parity is the Phase 2 bar; turning the knob trades picture quality for speed, a post-parity product decision |
| AC4-11 | Library bundle | `npm run build:lib` today: `dist-lib/threejs-toolkit.js` **911,009 B**, `dist-lib/assets/rad-worker-CuUp7t4N.js` **213,203 B** (213.20 kB, the same file name) | 721,358 → 929,227 B, plus the worker 213.20 kB (ticket 09:467-470) | **IMPROVED** by 18,218 B against 929,227 (not attributed); still 189,651 B over the pre-barrel 721,358 (the barrel restore is by design); the worker unchanged. **Deferred**, proposed grounds: no size budget exists for the library build; the shipping form is owner item 1 |
| AC4-12 | Element harness WebGL2 travel | **51,196 ms** against the 120,000 ms bound — `examples/site-lab/element.html?webgl=1` in the pane today, 6 passed, 0 failed, `webgl2-fallback` | 90,145 ms against 120 s (ticket 09:826-827) | **IMPROVED** — a margin of 68.8 s against 29.9 s; not attributed; a pumped-harness margin, never product timing |

- *In sum:* improved in number — 1, 9, 11, 12; unchanged — 2, 3, 4, 5, 6, 8, 10; no fresh number
  separable — 7 (bounded by 1). Proposed deferrals with grounds — 1's worker move, 2, 3, 4, 6 (by
  the owner's earlier ruling), 7, 8, 10, 11. None is a regression against the Phase 0 bar.
- *Out, as ruled:* picking-route timing (phase-0.md:113-115, Phase 3's start).

**THE GATE — GREEN on the final tree (2026-09-27).**
- *`npm run check:full` — true exit code 0* (05:49:56 → 05:50:17 -05:00; log in the session scratchpad):
  both builds; `embed-size OK: 3117066 bytes (bound 3932160)` (unminified, owner item 1 — the same
  figure as ticket 12's telemetry-in embed); `test:crate` 6 passed, 1 ignored; `tsc --noEmit` clean;
  `lint:boundaries` "no dependency violations found (186 modules, 615 dependencies cruised)";
  `test:crate:golden` 7 passed, 0 failed. The tree unchanged by it (build outputs git-ignored).
- *The fixtures by execution, both backends* (the built-in pane, frames driven by the pages; logic
  evidence): pager-lab on its final bytes — cf-1..cf-5 above (the held plant red as planted; 27
  passed, 0 failed in all four unplanted runs, both regimes, both backends); `examples/diag` SELF-TEST
  15/15 PASS; `examples/site-lab` 19 passed, 0 failed on WebGPU (`backend=webgpu`) and on WebGL2
  (`backend=webgl2-fallback`); `examples/site-lab/element.html?webgl=1` 6 passed, 0 failed; the counted
  H-LIFE runs 7 of 7 on each backend (the owner's plain tab). Chosen to cover what this ticket's diff
  touches: pager-lab (W4's check), diag and site-lab (`PagerTelemetrySource.ts`, a comment-only change),
  hload and hlife (the counted runs).
- *PL-1's tally at close-out:* 4 of 11 WebGPU pager-lab runs across the ticket (1 of 3 today);
  WebGL2 0 of 5 — reported, not blocking, as ruled.

**REVIEW ROUND 1 — registry-first adversarial round (2026-09-27, recorded at 2026-09-27 06:09:47
-0500).** Policy read fresh via the `agent-collab` skill (`D:\Projects\agent-collaboration\`:
collaboration-model.md, registry.json, operations.md, plan-template.md,
docs/verification-matrix.md). Lane `technical_review` → primary `astra-review` (`gpt-6-astra`,
`codex-exec`, effort high; Astra did not author this work). Admission on a fresh balance probe
(05:57 -05:00): the Codex weekly window 8 % used, plan `prolite`, no paid credits, spend control not
reached — above reserve 20 + allowance 5. Concurrent consumers listed: a Codex Desktop app-server
(pid 25196, running since 2026-09-26 16:47); rollouts modified in the last 30 min: 0 (names and
times only — a read outside the repo, disclosed to the owner). Access class `ordinary_authorized`,
read scope and no-writes boundary in the prompt (`.collab-logs/t13-review-prompt.md`); wrapper
`.collab-logs/t13-review-run.cmd` (identical to ticket 12's apart from the ticket number), launched
from PowerShell; codex-cli 0.153.3; 05:58:52 → 06:05:40 -05:00; thread
`01a0e284-8cf8-7480-be97-50a2b6a77bfd`.
- *Scope, verified:* 320 repo files hashed before and after — 320 identical, none added or removed;
  25 completed commands in the JSONL trace, none write-like; the read-scope statement: none outside
  the repo, one denied git read of the user's global ignore file, no contents.
- *Trace-check:* both load-bearing outputs are in the trace exactly as reported (command 21:
  `pass:true` with three `never` arrivals; command 22: ratios 1.98 at 16 fps and 2.78 at 21 fps).
- *R1-F1 (P2) — CONFIRMED, by reading:* `e2e-every-stop-and-back` (`hlife.ts:548`) passes on
  `JSON.stringify(announced) === "[1,2,0]"` alone; `arrived.ok` feeds only the detail text. The
  ruled "rail at rest" half is waited for, never asserted, and no RG-3 plant covers it. NEW code
  (this ticket's page), not inherited. The counted evidence stands on its records: both counted runs
  show every arrival reached (2,951-3,211 ms, no `never`). *Ruled 2026-09-27 (close-out ruling 1, (b)):* the fix goes on the post-ticket small-changes list; the committed page stays the bytes the counted runs used.
- *R1-F2 (P2) — CONFIRMED, by an independent model of the code* (`diagWiring.ts:301-302` resets the
  clock to the sampled render; `SiteRuntime.ts:3365` ticks once per render;
  `PagerTelemetrySource.ts:307`; `LoadProbe.ts:465-469`, `:628`): counting true frames would loosen
  the throttle 1.0× at or below 10 fps, about 2.0× from just above 10 to 20 fps, up to about 2.8-3×
  just above 20 fps (2.78 at 21), and 2.0-2.6× above that. RSW-1's "at most roughly twofold, and
  only above ~20 fps" — in the source comment (`PagerTelemetrySource.ts:302-306`), doc 06's D35
  note, ticket 12's note and this ticket — is wrong on both counts; my arithmetic, carried into the
  ruling's wording. The pin's cadence is INHERITED and kept by ruling; W1's no-retune stands on its
  own grounds (the drag regime ran at 2-10 fps, where the ratio is exactly 1.0). Not corrected: the
  wording is the owner's ruling. *Ruled 2026-09-27 (close-out ruling 2): YES — corrected with dated notes, the old wording kept visible (R1-F2 APPLIED, at the end of these Comments).*

**REVIEW ROUND 2 — the built-in `/code-review` (high), Claude, on the same tree (2026-09-27).**
Eight findings; the recipe runs no verify pass, so each was re-verified afterwards:
| # | where | claim | re-verified |
|---|---|---|---|
| R2-1 | `hlife.ts:548` | the stop check ignores the arrival | CONFIRMED (= R1-F1) |
| R2-2 | `PagerTelemetrySource.ts:302` | the throttle bound in the comment is wrong | CONFIRMED (= R1-F2) |
| R2-3 | `hlife.ts` idle read | the idle-heap readout sits inside the ~50 ms refresh window, before collection | CONFIRMED (= IH-1, probe 2; ruled: unchanged, a post-ticket small change) |
| R2-4 | `hlife.ts:336` plant | the `gpu-leak` plant keeps the last runtime alive | CONFIRMED as data (6 of 9 in both three-plant runs, 9 of 9 without it); the cause not isolated from the other two plants |
| R2-5 | `hlife.ts:291-298` | a throwing `dispose()` skips `obs.runtime = null`, so the page would keep it | CONFIRMED by reading (no try/finally); never triggered in any run on record |
| R2-6 | `pager-lab/main.ts` drill scan | `chunk < pAsset - 1` also skips the last chunk, not only the root | CONFIRMED by reading (`pAsset` = `header.chunks.length`, `ThreeGsBackend.ts:642`); narrows the candidates, the drill stays valid |
| R2-7 | `pager-lab/main.ts` drill picks | no guard for fewer than two candidate chunks | CONFIRMED by reading as an edge case; every real run had many resident chunks |
| R2-8 | `hload/main.ts:550` | one traversal sampled per render; extra traversals between renders would be dropped | PLAUSIBLE, not confirmed: the traversal runs in the mesh's `onBeforeRender` (`ThreeGsBackend.ts:969-1048`), at most once per render, but the harness's own hash renders (`hload/main.ts:466-478`) may add traversals between sampled renders; the records cannot say. A caveat on AC4-1/AC4-7's counts, not their means' order of magnitude |

Nothing was fixed: every finding goes to the owner for a ruling. Any change to `hlife.ts`,
`pager-lab/main.ts` or `hload/main.ts` changes bytes the counted or fixture evidence ran on. *Ruled 2026-09-27 (close-out rulings 1-3):* R2-1 (= R1-F1) and R2-4 to R2-7 go on the post-ticket small-changes list; R2-2 (= R1-F2) corrected; R2-3 (= IH-1) was already there; R2-8 stays the caveat on AC4-1 and AC4-7's traversal counts.

**CLOSE-OUT STOP (2026-09-27, sent 11:10:14 UTC) — the six decisions put to the owner, VERBATIM.** They were sent in the conversation and NOT written here at the time (a record gap, closed now): transcribed byte-exact from this session's own transcript at 2026-09-27 13:44:32 -0500. The block between the markers is 9 lines, 1,382 B, sha256 `e208d380b06924d08bb2986d571310d7f8e3e2cfae9ec9e8b326b6ffddf8a671` (each line with its newline). The owner's rulings on them arrive in the next session.

<!-- BEGIN verbatim: close-out decisions, 2026-09-27 -->
**Decisions I need from you:**
1. **R1-F1, the stop check.**
   - **(b) Recommended:** put the fix on the post-ticket small-changes list. The committed page then stays exactly the bytes the counted runs used, and the records already show every arrival.
   - **(a)** Fix it now: new page bytes, so the deliberate faults have to be shown red again, and the committed page would no longer match the bytes the counted runs used.
2. **R1-F2, the RSW-1 wording.** I recommend correcting it now in all four places (the source comment and three records), with dated notes and the old wording kept visible. The comment keeps its five-line length and behaviour doesn't change; `check:full` would be re-run afterwards. It's your ruling's wording, so I'm not changing it without your say.
3. **The other round-2 findings (R2-4 to R2-7):** post-ticket harness fixes; R2-8 stays recorded as a caveat. Recommended.
4. **AC4:** confirm the proposed deferrals. The numbers and grounds are in ticket 13's AC4 table.
5. **C-1, the bar's dating.** My recommendation: keep the Phase 0 bar, with C-1 as a dated note that WebGL2-default's "match" is 321.1 ms behind today's spike. Your ruling 1 says the control is never a new bar, and the fix is already owner item 5.
6. **The four hook briefs** (`.scratch/handoffs/014`–`017-…-compaction.md`): they won't be committed. Should they stay as they are?
<!-- END verbatim -->

*The commit preview shown to the owner with it* (`git status --short --untracked-files=all`, the four hook briefs left out; nothing staged) — 26 files, 8 modified and 18 new:

```text
 M .scratch/phase-2-backend/issues/12-diagnostics-rewired.md
 M .scratch/phase-2-backend/issues/13-phase2-exit-evidence.md
 M PLAN.md
 M docs/plan/05-parity-verification.md
 M docs/plan/06-open-decisions.md
 M examples/pager-lab/main.ts
 M src/diag/PagerTelemetrySource.ts
 M vite.config.ts
?? docs/plan/results/phase-2-hlife-records.json
?? docs/plan/results/phase-2-hload-band.json
?? docs/plan/results/phase-2-hload-control-trials.json
?? docs/plan/results/phase-2-hload-diagnostics.json
?? docs/plan/results/phase-2-hload-pictures/h8-capture-records-ours.json
?? docs/plan/results/phase-2-hload-pictures/h8-capture-records-pin.json
?? docs/plan/results/phase-2-hload-pictures/h8-ours-webgl2.png
?? docs/plan/results/phase-2-hload-pictures/h8-ours-webgl2.png.sha256
?? docs/plan/results/phase-2-hload-pictures/h8-ours-webgpu.png
?? docs/plan/results/phase-2-hload-pictures/h8-ours-webgpu.png.sha256
?? docs/plan/results/phase-2-hload-pictures/h8-pin.png
?? docs/plan/results/phase-2-hload-pictures/h8-pin.png.sha256
?? docs/plan/results/phase-2-hload-trials.json
?? docs/plan/results/phase-2-hload.md
?? examples/hload/index.html
?? examples/hload/main.ts
?? examples/site-lab/hlife.html
?? examples/site-lab/hlife.ts
```

Left out, never staged — the owner's PreCompact hook briefs, not ticket work:

```text
?? .scratch/handoffs/014-2026-09-26-compaction.md
?? .scratch/handoffs/015-2026-09-26-compaction.md
?? .scratch/handoffs/016-2026-09-27-compaction.md
?? .scratch/handoffs/017-2026-09-27-compaction.md
```

**OWNER RULINGS on the close-out decisions (2026-09-27; received at the start of this session,
recorded at 2026-09-27 16:06 -0500) — quoted verbatim, the whole message.** Where recorded: here; doc 06 D36 item
12's eighth follow-up; PLAN.md `## decisions`. The block between the markers is 17 lines,
2,656 B, sha256 `f04d0d9fc19a9ee843fedee061b63d3776eb78e5a050fd41f9d1755bd659e123` (each line with its newline). The line numbers the message
cites are as they stood when it was written; CLOSE-OUT APPLIED, below, says where they moved.

<!-- BEGIN verbatim: close-out rulings, 2026-09-27 -->
Read .scratch/handoffs/016-2026-09-28-t13-close-out.md in full — the authoritative entry state — then verify the tree matches its inventory (22 plain status lines after the handoff commit; the four hook-written compaction briefs are never staged). Work only ticket 13's close-out. Last commit 3efdae9. The owner's six rulings on the decisions block (ticket 13:2785-2793, sha256 e208d380…) follow — record them verbatim first, in ticket 13, doc 06, PLAN.md.

1. R1-F1 (b): the stop-check fix goes on the post-ticket small-changes list. The committed page stays byte-identical to what the counted runs used, and the records already show every arrival reaching rest (2,951-3,211 ms).

2. R1-F2: YES — correct the RSW-1 wording now, in the six spots you located (source comment + the record notes; the owner's verbatim ruling quotes are never edited — dated notes beside them). New wording per your verified model: no effect at or below 10 fps, ~2x from 10-20 fps, up to ~3x just above 20 fps. Old wording kept visible, dated notes, the source comment keeps its five-line length so no citations shift. The record notes that this is the SECOND correction of the same comment and that both wrong versions passed through the owner's rulings — the W1 no-retune decision itself stands because the trials ran at 2-10 fps where the ratio is exactly 1.0. Re-run check:full after.

3. R2-4 through R2-7: post-ticket harness fixes on the small-changes list. R2-8 stays recorded as the caveat on AC4-1 and AC4-7's traversal counts.

4. AC4: the proposed deferrals are CONFIRMED as recorded in the ticket's table.

5. C-1: keep the Phase 0 bar, with the dated note that WebGL2-default's "match" is 321.1 ms behind the same-day spike. The control is never a new bar (ruling 1 stands); the bar's re-dating belongs to owner item 5.

6. The four hook briefs stay exactly as they are — untouched, uncommitted, never staged.

Also authorized: flip ticket 12's status line from ready-for-agent to done with a dated note citing 70dbd22 (the gap you flagged) — it is record hygiene inside an already-modified file, part of this commit.

Then close out in the handoff's order: tick ticket 13's ACs and set Status: done; re-run npm run check:full and report the true exit code; show me the staged file list — the 26 files per the preview at ticket 13:2796-2825 plus any lines these rulings just touched, the four hook briefs excluded, stop on anything stray — and after showing it, commit under the standing delegation with a message in the established style. No credit lines of any kind. Explain the git output in plain English — the owner does not use git.
<!-- END verbatim -->

**Two scope answers on ruling 2 (2026-09-27, asked before any R1-F2 edit) — the owner's choices,
verbatim.** The ruling left two points open, so they were asked, not resolved:
- *Asked:* whether each verbatim quote of the RSW-1 / W1 ruling that carries the wrong stakes — this
  ticket's "OWNER RULINGS on FINDING RSW-1 and stops W1-W5", doc 06 D36 item 12's third follow-up,
  PLAN.md's decision of 2026-09-26 — gets a dated note beside it, outside the quote. *Chosen:* "Yes,
  note beside each (Recommended)" — "One dated note beside each of the three quotes, added by
  extending an existing line so no cited line number moves. The quotes themselves are untouched."
- *Asked:* whether stop W1's own RSW-1 arithmetic — the trace and *FINDING RSW-1* in the W stop, a
  seventh place the handoff's six did not list — gets a dated note too. *Chosen:* "Yes, dated note
  there too (Recommended)" — "Keep the stop text as sent, and add a dated note beside it, extending
  an existing line, that names the missed clock reset and points to R1-F2."

**CLOSE-OUT APPLIED (2026-09-27, recorded at 2026-09-27 16:14 -0500) — each ruling, what was done, and where.** Written
by scripts that write bytes and assert every anchor by line number and exact content before writing
(session scratchpad: `step1_record.py`, `step2_apply.py`, `step3_close.py`).
- *Ruling 1 (R1-F1, (b)) and ruling 3 (R2-4 to R2-7):* five items on the post-ticket small-changes
  sublist, `:683-694` — the only lines inserted into this ticket above its end. Every later line moved
  by 12: the decisions block the message cites as `:2785-2793` is now `:2797-2805`, the commit
  preview `:2796-2825` now `:2808-2837`. Citations of this ticket's lines outside the handoffs: none
  live (searched; the only hits were a git-ignored review log and the owner's RG-2 quote at `:1527`,
  "ticket 13:1058", which stays as written). R1-F1, R1-F2 and round 2 each carry a dated ruling note
  (`:2766`, `:2776`, `:2792`). The pages stay the bytes the counted and fixture runs used —
  `hlife.ts` `112a179f…`, `pager-lab/main.ts` `8859e840…`, `hload/main.ts` `663bcf68…`.
- *Ruling 2 (R1-F2) — R1-F2 APPLIED.* **The model, re-checked before any edit:** a simulation of the
  code (`rsw-model.js`, sha256 `66286f93924ed0f2976fef61ef212ceaa0cad2ae061b74a79a92f326b4c61210`, session scratchpad) — the tick fires on the first
  render at least 100 ms after the last sample and times the next from it (`diagWiring.ts:298-302`),
  each flagged sample is pushed at `LoadProbe.ts:364` and trimmed at `:628`, the allowance is
  `min(max(1, n) × 0.5, 50)` ms per 5,000 ms (`LoadProbe.ts:465-469`, `policies.ts:28-30`). The
  ratio of the true-frame allowance to today's: exactly 1.00 at 2, 5, 8 and 10 fps; 1.96-2.03 at
  10.5-20; 2.86 at 20.5 and 2.78-2.86 at 21; 2.44-2.50 at 24; 2.17-2.22 at 27; 2.00-2.63 at 30; 2.56
  at 30.5; 1.96-2.38 from 35 to 51; 2.00-2.33 at 60; 2.00-2.13 at 120; 2.08 at 144. The owner's
  wording ("no effect at or below 10 fps, ~2x from 10-20 fps, up to ~3x just above 20 fps") holds as
  a bound. **The source comment**, `src/diag/PagerTelemetrySource.ts:302-306`, five lines as five:
  line 302 unchanged, 303-306 rewritten; the file keeps 473 lines, LF, no line over 78 characters;
  sha256 `3616fde2…` → `e893387797f1e1c6fb069076cc42c17f1871b6dcc5a5408c364ba7609b28cb99`. The five lines before (the RSW-1 version of 2026-09-26):

```ts
    // `readSnapshot`), kept deliberately for parity. Counting true frames
    // would loosen the throttle at most roughly twofold, and only above ~20
    // fps, because the tick samples at >=100 ms (diagWiring.ts:131) and the
    // per-window allowance is capped (LoadProbe.ts:465-469). CORRECTED from
    // "roughly sixfold" 2026-09-26 (ticket 13 RSW-1); W1 a: no Phase 2 retune.
```

  and after:

```ts
    // `readSnapshot`), kept deliberately for parity. Counting true frames
    // would loosen the throttle: no effect at or below 10 fps, ~2x from 10-20
    // fps, up to ~3x just above 20 fps (samples are renders >=100 ms apart,
    // diagWiring.ts:301-302; the allowance is capped, LoadProbe.ts:465-469).
    // CORRECTED from "at most roughly twofold" 2026-09-27 (ticket 13 R1-F2).
```

  Against HEAD's blob (`1979161d`) the ticket's whole change to this file is these five comment
  lines (`git diff --stat`: 5 insertions, 5 deletions). One thing left the comment for space: RSW-1's
  "W1 a: no Phase 2 retune" — the owner's wording is longer than the phrase it replaces, and five
  lines of at most 79 characters could not carry both; W1 stays recorded beside every correction
  below. **The dated notes, old wording kept visible:** this ticket `:93` (the handover note), `:106`
  (W1's restated grounds), `:1747` (stop W1's own trace — scope answer 2), `:1882` (beside the
  verbatim W rulings — scope answer 1), `:1941` (the RSW-1 APPLIED block), `:2776` (the finding,
  ruled); doc 06 `:681` (D35 item 5's note) and `:843` (beside the third follow-up's quote); ticket
  12 `:781`; PLAN.md `:439` (beside the quote in the 2026-09-26 decision). The three verbatim quotes
  still read as the owner wrote them — the stakes lines at this ticket `:1893` / `:1897`, doc 06
  `:849` / `:853`, PLAN.md `:444` / `:448`, each re-read after the edits. **This is the SECOND
  correction of the same stake, and both wrong versions passed through the owner's rulings:**
  "roughly sixfold" (ticket 12, 2026-09-22 — the uncapped ratio; D35 item 5's grounds) and "at most
  roughly twofold, and only above ~20 fps" (RSW-1, 2026-09-26 — the cap applied, but as if a sample
  fell every 100 ms; the RSW-1 and W1 rulings). Both were Claude's arithmetic. **W1's no-retune
  decision stands:** the counted drags ran at 2-10 fps, where the ratio is exactly 1.0. The change is
  comment-only, so behaviour is unchanged and the fixture runs under THE GATE above stand;
  `check:full` re-ran on the final tree (below).
- *Ruling 3, R2-8:* the caveat on AC4-1 and AC4-7's traversal counts, beside the AC4 table (`:2705`)
  and in round 2's ruled note (`:2792`).
- *Ruling 4:* AC4's deferrals CONFIRMED beside the table (`:2705`); PLAN.md `#ac4-verdicts` `[x]`.
- *Ruling 5:* C-1 decided beside the finding (`:1290`); the results doc's dated Readings bullet
  (`docs/plan/results/phase-2-hload.md:149-152`) and a pointer in its C-1 bullet (`:254`); the
  generated criteria table untouched.
- *Ruling 6:* the four hook briefs untouched — re-hashed after the gate: `6768b409…`, `4b686e35…`,
  `cfcdf4da…`, `687a0c03…`, as in handoff 016's table; never staged.
- *Ticket 12:* its status line reads `done`, with a dated note citing `70dbd22` (ticket 12 `:3`).
- *Recorded verbatim first* (step 1): here (`:2848`), doc 06 D36 item 12's eighth follow-up (`:1028`,
  27 lines inserted; the watch list moved to `:1063-1117`, item 13 to `:1095`, its dated check to
  `:1098` — this ticket's two citations of them re-pointed, `:1122` and `:1436`), PLAN.md
  `## decisions` (`:265`).

**THE GATE — close-out re-run on the final tree (2026-09-27).** `npm run check:full` — **true exit
code 0** (16:11:13 → 16:11:31 -05:00; log in the session scratchpad): both builds; `embed-size OK:
3117066 bytes (bound 3932160)`, the figure of the first gate run; `test:crate` 6 passed, 1 ignored;
`tsc --noEmit` printed nothing; `lint:boundaries` "no dependency violations found (186 modules, 615
dependencies cruised)"; `test:crate:golden` 7 passed, 0 failed. The tree's status list unchanged by it
(30 lines; build outputs git-ignored). Since the first gate run the only change under `src/` or
`examples/` is `PagerTelemetrySource.ts`'s comment, so the fixture runs recorded there stand.

**Status change: done — all five ACs met (2026-09-27, closed on the owner's close-out rulings).**
- *AC1 — H-LOAD's ten criteria, five cold-cache trials per backend per regime:* 40 of 40 counted
  trials (`:856`); the results doc `docs/plan/results/phase-2-hload.md` and its criteria table; the
  raw records `phase-2-hload-trials.json` (`189f117b…`, `:1080`); the visual criterion as the H8
  picture pair at the pinned pose (`:1624`, `:1675`; `docs/plan/results/phase-2-hload-pictures/`).
- *AC2 — match or beat the spike, any regression NAMED:* one regression, WebGL2 `?pages=32`
  first-pixel, NAMED as an integration fault — the header hook's full-capacity mesh construction
  (V1, `:1554`; its fix is owner item 5); C-1's bar question decided (ruling 5, `:1290`); criterion 9
  ✓ both halves (`:2677`).
- *AC3 — H-LIFE ×10 on the full element with a real site.json:* THE COUNTED SESSION (`:2610`), 7 of
  7 checks on each backend, records `phase-2-hlife-records.json` (`180678f2…`).
- *AC4 — Phase 0's carried items, each with a number:* the twelve verdicts (`:2699`), the deferrals
  confirmed (ruling 4).
- *AC5 — the upstream watch list at the boundary, `npm view three version` dated:* the r186 re-check
  (`:1088`; `0.186.1`, checked 2026-09-25 07:12 UTC), its adoption ruled its own ticket (V3 a, owner
  item 6), R186-DOCS (`:1432`).
What follows the commit: the owner items for the Phase 2 boundary (`:648-672`) and the post-ticket
small changes (`:674-694`).
