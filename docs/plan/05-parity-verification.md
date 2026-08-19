# 05 — Parity verification

How we prove threejs-toolkit equals sparkjs-toolkit, phase by phase. The sibling repo
is what makes this strong: the reference implementation is always alive next door,
running the same content. **Every harness that still compares against
sparkjs-toolkit compares against it executing, never against remembered or
documented behavior** — see the amendment below for which no longer compare at all.

> **Amendment 2026-08-16 (ADR 0003):** performance and selection METRICS are no
> longer scored against sparkjs-toolkit. The owner's ruling: the toolkits are
> separate products; each optimizes against itself. H-LOAD below is rewritten as
> an absolute-baseline instrument; Spark figures (e.g. the historical 2.3 s hero
> reveal) may appear as context, never as pass/fail. One visual-parity item IS
> re-scoped by this amendment: old H-LOAD criterion 4 (FrameDiffValidator vs the
> Spark control) becomes a self-stability check below — whether a
> Spark-visual-diff returns at Phase 1 is part of doc 06 D16. The remaining
> visual/behavioral parity harnesses (H-VISUAL, H-PICK, H-EDIT…) are NOT yet
> re-scoped; settling their status is also D16, due before Phase 1 review.

## Ground rules

1. **Measured, side-by-side, same machine, same asset, same camera pose.** Cold cache
   for load tests (devtools cache disabled + versioned URLs).
2. **Artifacts or it didn't happen.** Each run leaves numbers + screenshots in
   `docs/plan/results/`. Adjectives ("looks right", "feels fast") close nothing.
3. **Known constant differences are subtracted, not explained away ad hoc.** A
   maintained list (below) of *expected* deltas; any unexplained residual is a bug
   until characterized.
4. **Both backends, always.** WebGPU and forceWebGL are separate rows in every table.
   A parity pass on WebGPU alone is half a pass.
5. **Hidden-tab discipline** (project lesson carried over): visual verification needs
   a visible pane; screenshots force frames; ResizeObserver/IO don't fire hidden.

## Expected-difference register (start set; grows only with evidence)

| Difference | Why constant | Where it shows |
|---|---|---|
| No striping ever, 4× memory | three stores float32; Spark packs float16 (`extSplats` dance dies) | H-VISUAL clean; H-LOAD memory row high |
| SH banding possible | 8-bit quantized SH vs Spark precision | glossy fixtures |
| Splat edge falloff detail | different kernel constants; the fork still carries upstream's 1024 px radius cap (`MAX_SCREEN_SPACE_SPLAT_SIZE`), NOT Spark's 512 — matching it is Phase 5 work (doc 03 §D, doc 04 Phase 5) | pixel-diff tolerance band, widened until the cap is matched |
| Overlap popping | no cross-mesh sort (accepted regression §H) | H-COMPOSE overlap fixture only |

## The harnesses

### H-LOAD — the ten criteria (spike + Phase 2; amended 2026-08-16, ADR 0003)
Five cold-cache trials per backend, two regimes: the **derived default** (pool =
`min(P_limits, P_asset)`; 122 pages for the hero on this machine) and the
**constrained eviction regime** (`?pages=32`). All numbers are absolute records —
this toolkit's own baseline (ADR 0001); no Spark control trials run.
1. median navigation→first-pixel **recorded** per backend and regime, and
   →full-quality recorded for the **derived-default regime only** — full quality
   is structurally unreachable in the constrained `?pages=32` regime, where some
   wanted chunk is always non-resident, so those rows record "n/a (by design)"
   rather than a missing measurement. (first-pixel = first rendered frame with a
   non-empty selection — a post-render proxy, not readback-verified: an in-band
   readback would stall the very moment being timed; historical context only:
   Spark's tuned hero reveal was 2.3 s);
2. all splat payload requests are byte ranges — no monolithic fetch before reveal;
3. selected splat count at the test pose **recorded** and identical across trials
   (the traversal is deterministic at a fixed pose; any variance is a bug);
4. rendered output at the test pose is **pixel-stable across trials** of the same
   regime (readback screenshot diff; within-bin sort order may reorder equal-depth
   splats — if that makes strict stability unachievable, record the measured diff
   band, never a silent pass);
5. fallback p95 rendered-frame cost during the scripted camera drag **recorded**;
6. no storage-buffer allocation failure; the pool stays exactly at its configured
   budget in both regimes;
7. eviction correctness (`?pages=32` regime): revisiting the initial pose restores
   the same selected count and passes the same pixel-stability check;
8. reported progress is derived from completed work, never residency (A5), so
   decrease during eviction is structurally impossible; the instrument still
   samples it through the eviction regime as a regression tripwire — this
   criterion is satisfied by construction, not by test, and says so;
9. a page uploaded under a motionless camera becomes visible with sort + SH
   explicitly re-dispatched (verified via selection growth + the invalidate()
   path; a direct SH-output assertion is deferred to the production diag
   stack — recorded as a gap, not a pass);
10. a page/selection change updates visible order without camera motion.
Instrumented by `measure.ts` (spike) then the rewired diag stack (production):
navigation-start→first-pixel, →full-quality, longest main-thread block, peak JS heap.
**Peak GPU memory is NOT measured** — no browser API reports it; `measure.ts` records
`gpuPoolBytes`, an analytic model of the WebGPU pool's allocation layout
(`capacity × GPU_BYTES_PER_SPLAT + GPU_FIXED_BYTES`, each term named at its
definition). It models the WebGPU path only; the WebGL fallback's ~3× copies are not
included. Treat it as a derived figure, never as a measurement.

Measurement runs pin `setPixelRatio(1)` and a fixed window size so logical and
drawing-buffer sizes agree across trials.

### H-VISUAL — rendering parity (every phase)
Fixture scenes (small static SPZ; paged hero; glossy SH worst case) rendered by both
toolkits at pinned poses; screenshot pixel-diff with the expected-difference register
applied. WebGPU frame capture is async (no preserveDrawingBuffer) — capture via
readback after completion, not toDataURL habits.

### H-PICK — picking parity (Phase 3)
Scripted clicks at N screen points on both toolkits; compare hit/miss and hit world
position within tolerance; per-pick latency budget compatible with double-click UX on
the hero. Covers all three consumers (recenter, author pick, composer select).

### H-EDIT — glow/crop parity (Phase 3)
Marker-hover glow fixture: screenshot series (hover on/off) diffed vs sparkjs-toolkit,
both backends (fallback included — the edit must not silently skip there). Crop:
GPU preview vs CPU-filter ground truth (the CPU filter is the oracle — it's shared
math); plus additive-blend parity per Spark's `rgba + sdfRgba` contract.

### H-COMPOSE — composition (Phases 2–3)
Multi-object scene: disjoint arrangement must pass H-VISUAL; the overlap fixture
*documents* the popping artifact for explicit owner sign-off (accepted regression,
not a silent surprise).

### H-ASSET — export/text (Phase 4)
Export: load reference asset → export SPZ → re-import → H-VISUAL against the
original; scale/quat round-trip error reported numerically (preserve-at-decode
should make it ~exact; 8-bit color delta reported, owner-accepted per Q9).
Text: splat-text fixture vs sparkjs-toolkit rendering of the same block.

### H-OPTICS — DoF (Phase 5)
Authored rail stop with optics; focus ramp (near/mid/far) screenshot series vs
sparkjs-toolkit; `setOptics(null)` must be pixel-identical to fork-off baseline.

### H-LIFE — lifecycle/memory (Phase 2 onward, re-run every phase)
load→dispose→load ×10: JS heap and GPU memory return to baseline each cycle (the
upstream demo leaks; our dispose must provably not). Scene-swap under a live element.

### H-FORK — fork integrity (every vendor change; every upstream re-diff)
With every fork feature disabled, vendored output is pixel-identical to unmodified
upstream on the fixture set. This is the test that keeps the fork honest and makes
release re-diffs mechanical.

### H-API — public contract (Phase 2 onward)
The barrel exports the same names; `<splat-site>` fires the same events with the same
payload shapes on the same fixture site.json; TypeScript consumers compile against
either toolkit unchanged (a tiny consumer fixture compiled against both). Divergences
allowed only via doc 06 entries.

## Device matrix (Phase 6, and cheaply at each gate)

| Row | Backend | Note |
|---|---|---|
| Desktop 3090 Ti | WebGPU | the dev baseline |
| Desktop 3090 Ti | forceWebGL | fallback truth on strong hardware |
| One real Android | WebGPU or fallback (as it lands) | mid-class truth |
| iOS Safari | fallback | weight decided by Q4/Q6; remember the iOS 96-page thrash lesson from Spark tuning — watch for its analog |
