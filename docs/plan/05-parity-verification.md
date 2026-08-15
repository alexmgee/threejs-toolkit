# 05 — Parity verification

How we prove threejs-toolkit equals sparkjs-toolkit, phase by phase. The sibling repo
is what makes this strong: the reference implementation is always alive next door,
running the same content. **Every harness compares against sparkjs-toolkit executing,
never against remembered or documented behavior.**

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
| Splat edge falloff detail | different kernel constants (radius cap 512 matched in fork) | pixel-diff tolerance band |
| Overlap popping | no cross-mesh sort (accepted regression §H) | H-COMPOSE overlap fixture only |

## The harnesses

### H-LOAD — the ten criteria (spike + Phase 2)
Five cold-cache trials per backend vs five Spark control trials, same harness. Pass =
ALL of:
1. median first acceptable render **no worse than the Spark control** (2.3 s today);
2. all splat payload requests are byte ranges — no monolithic fetch before reveal;
3. selected splat count at the test pose within **1%** of Spark control;
4. `FrameDiffValidator` passes at its existing threshold (if the threshold is
   unsuitable for stochastic within-bin ordering, result is **UNKNOWN**, not a pass —
   recalibrate first);
5. fallback p95 rendered-frame cost during the scripted camera drag no worse than the
   Spark control;
6. no storage-buffer allocation failure; page pool stays exactly at budget;
7. eviction correctness: revisiting the initial pose restores selected count + passes
   the same frame diff;
8. reported progress never decreases during eviction;
9. a page uploaded under a motionless camera receives valid SH contribution;
10. a page/selection change updates visible order without camera motion.
Instrumented by `measure.ts` (spike) then the rewired diag stack (production):
navigation-start→first-pixel, →full-quality, longest main-thread block, peak JS heap,
peak GPU memory.

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
