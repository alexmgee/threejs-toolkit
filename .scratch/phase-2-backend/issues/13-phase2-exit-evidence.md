# 13 — Phase 2 exit: H-LOAD re-run, H-LIFE, real-site end-to-end

**Status:** ready-for-agent
**Blocked by:** 11, 12 (05–10 are transitive through them).

**What to build:** the evidence that closes Phase 2 — the production runtime
measured against the spike's own numbers, both backends, both regimes. A PURE
evidence ticket: it should discover nothing new; if it does, the GATE has done its
job (regression ⇒ the integration, not the concept, is at fault — find it before
anything stacks on top).

Standing rules bind (spec.md). No time estimates; absolute numbers only (no Spark
comparisons — the spike's own numbers are the bar).

- [ ] H-LOAD's ten criteria re-run on the production runtime: five cold-cache
      trials per backend per regime, results written to a results doc under
      docs/plan/results/ as absolute numbers; the visual criterion carried as a
      picture check at the pinned pose (D16).
- [ ] Production figures match or beat the spike's; any regression is diagnosed as
      an integration fault and NAMED before the phase closes.
- [ ] H-LIFE ×10 on the full element with a real site.json — heap flat across
      cycles, scene-swap under a live element included.
- [ ] Phase 0's carried-forward improvement items — including the MediaLayer
      `getMaxAnisotropy()` candidate (owner ruling at breakdown) — each answered
      with a number: improved, unchanged, or explicitly deferred with grounds.
- [ ] Upstream watch list (doc 06) re-checked at the boundary, including
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
the throttle roughly sixfold past anything the pin ever shipped.

**What this ticket decides, once, with measurements in hand:** whether the allowance should be
recalibrated against true rendered frames. Note the constant class — `optionalCpuMsPerRenderedFrame`
is a Spark-inherited STARTING VALUE (ADR 0003's class of unpinned constants), not a derived
one, so this is a calibration decision needing evidence, not a bug fix. A Firefox profile of
the lab hero (2026-08-07) is the reason the optional ladder exists at all; any recalibration
should be argued against that kind of measurement rather than against the ratio alone.
