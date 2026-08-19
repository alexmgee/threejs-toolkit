# Phase 0 results — H-LOAD baseline (ADR 0001 · ADR 0003)

Status: **PHASE 0 CLOSED** (2026-08-16) — 5 clean cold-cache trials per
configuration (hidden-pane-contaminated attempts auto-discarded and re-run);
both reviews run and all findings applied; a follow-up stale-claim sweep across
every doc this session touched run and applied. See §Review trail.

Environment: Windows 11 · RTX 3090 Ti 24 GB · Chrome (WebGPU + forceWebGL) ·
three.js 0.185.1 (published) + vendored dev-branch addon · hero
`lab-sh1-sparsity.rad` (213,727,632 B · 7,935,358 splats · 122 chunks · maxSh 1).

Regimes (ADR 0003): **derived default** = `min(P_limits, P_asset)` → 122 pages
on this machine (128-page default-limit cap, 122-chunk asset); **eviction
regime** = `?pages=32`.

## Verified by execution, 2026-08-16 (pre-trial)

| criterion | evidence |
|---|---|
| 2 — range-only fetch | 122/122 chunks landed as 206 responses, 213,719,504 B exact (`allChunkBytes`), `rangeVerified` asserted in RadFetcher (non-206 throws); re-verified with cache-buster URLs |
| 3 — deterministic selection | steady selection at the test pose reproduced exactly across independent page loads and backends. Pre-trial spot values at `?pages=32` were 630,097 (before the Y-flip landed) and 603,256 (after), both taken mid-load; the trial table's 729,351 is the true steady-state figure and supersedes them. Traversal is pure CPU, backend-independent |
| 6 — budget respected | pool refuses over-budget inserts by construction; 122-page allocation succeeds under DEFAULT WebGPU limits (122 MiB per vec4 buffer < 128 MiB cap, live-measured device limits) |
| 7 (machinery) — eviction + restore | `?pages=32`: 35 chunks decoded into 32 pages (evictions occurred), priority-protection converges to admissible-missing = 0; full deselect→reselect GPU round-trip verified on BOTH backends |
| 9/10 (machinery) — explicit invalidation | pages arriving under a motionless camera appear (selection grows, sort + SH re-dispatched via `invalidate()`); verified headless via probe |
| partial-upload path | ranged `writeBuffer`/`bufferSubData` consumption proven deterministically (controlled upload → render → ranges consumed) on WebGPU; WebGL PBO texture path requires `pbo.needsUpdate` (fork handles it); race-free accumulation watchdog guards regressions |
| WebGL2 fallback | full pipeline works: identical selection, deselect/reselect round-trip, SH1 byte-view re-derivation after `setupPBO` array replacement |
| orientation | 180° X-flip applied, matching sparkjs-toolkit's `eulerRotationDeg` path (SplatLoader.ts:81-88 — conditional, not universal; lab.site.json authors `[0,0,0]`, which arms it); owner visually confirmed the pre-fix render was upside down |

## Trial table (5 clean cold-cache trials per configuration, medians; 2026-08-16)

| config | first-pixel (ms) | full-quality (ms) | steady (ms) | steady selected | pixel-stable | drag p95 frame (ms) | longest task max (ms) | peak JS heap max (MB) |
|---|---|---|---|---|---|---|---|---|
| webgpu-default (122 pages) | 1,828 | 48,027 | =full-quality | 2,500,000 (all 5 trials) | within-trial ✓ / across-trial varies† | 743 | 775 | 3,912 |
| webgpu-pages32 | 1,043 | n/a (by design) | 3,055 | 729,351 (all 5 trials) | within-trial ✓ / across-trial varies† | 146 | 185 | 1,296 |
| webgl-default (122 pages) | 1,423 | 75,127 | =full-quality | 2,500,000 (all 5 trials) | ✓ single hash across ALL trials | 817 | 1,017 | 2,887 |
| webgl-pages32 | 598 | n/a (by design) | 4,349 | 729,351 (all 5 trials) | within-trial ✓ / 2 hashes across 5 trials‡ | 182 | 206 | 1,306 |

All configs, all trials: range-only fetch ✓ · restore-after-drag matches steady
selection exactly (criterion 7, count half) ✓ · progress tripwire quiet (8) ✓ ·
selection grew under motionless camera (9/10) ✓ · partial-upload watchdog never
fired ✓ · allocation succeeded at budget (6) ✓ · window size consistent across
trials ✓.

Criterion 7, pixel half (restore hash ∈ steady hashes): ✓ webgl-default only —
the one structurally deterministic configuration. Misses elsewhere are the
documented nondeterminism mechanisms († GPU within-bin scatter; ‡ drag-driven
slot re-assignment in the constrained regime), with the restored SELECTION
identical in every case — content restored exactly, pixel order not guaranteed.

† GPU counting-sort scatter is nondeterministic within equal-depth bins, so
WebGPU frames are pixel-stable within a trial but hash differently across page
loads (criterion 4's "record the diff band" case). The WebGL CPU sort is fully
deterministic: one identical hash across all trials at full residency.
‡ In the constrained regime, page-slot assignment follows arrival order, so the
same 729,351 splats can occupy different slots across trials — the CPU sort is
deterministic given slots, but within-bin order follows splat index (slot-
dependent), yielding occasional cross-trial hash differences with identical
selection.

Readings:
- **Selection is exactly reproducible** everywhere (2,500,000 = the frame
  budget binding at full residency; 729,351 at 32 pages — identical across
  backends and trials). Criterion 3 could not be stronger.
- **First-pixel is fast** (0.7–1.8 s); **full-quality is slow** (48 s WebGPU /
  75 s WebGL): the single decode worker is the bottleneck for 122 chunks
  (~1.5 s of pure decode, but serialized behind per-page upload + traversal
  churn on arrival). Production's 4-worker pool (doc 04) is the named fix.
- **Drag frame cost is traversal-dominated** (743–817 ms p95 at 2.5M selection;
  146–182 ms at 730K) — the main-thread traversal item, now with its number.

Historical context only (never pass/fail — ADR 0003): Spark's tuned hero
first-pixel on this asset was 2.3 s.

Instrument: `spikes/native-rad/src/measure.ts` — per-page-load trial state
machine (LOAD → STABILITY → DRAG → RESTORE), results in localStorage,
`window.__measure.report()` aggregates. Requires a visible pane (rAF-driven;
doc 05 rule 5). DPR pinned to 1 in measure mode; window size recorded per
trial and cross-trial drift flagged in report().

Metric definitions and instrument honesty (per pocock review, fixes applied):
- **first-pixel** = first rendered frame with a non-empty selection (post-render
  proxy, not readback-verified — an in-band readback would stall the moment
  being timed). Doc 05 criterion 1 carries the same definition.
- **criterion 8** is satisfied by construction (progress = completed work, A5);
  the instrument's monotonicity sampling is a regression tripwire, not proof.
- **criterion 9** is verified via selection growth + the explicit invalidate()
  path; a direct SH-output assertion is a recorded gap (production diag stack).
- **criterion 7** reports both halves separately: selected-count restoration and
  restore-hash-vs-steady-hashes (GPU within-bin nondeterminism can miss the
  hash without error; see †).

Declared instrument additions beyond the handoff's task-6 list (unrequested,
serving the spec): `?measure=1&auto=1` self-sequencer with hidden-pane
contamination auto-discard/re-run; `steadyMs` (constrained regime's
load-completion analog); warm-fill decode scheduling.

## Phase 0 "free extras" (doc 04)

1. **Raycast absence: CONFIRMED empirically** (2026-08-16). With 603,256 splats
   rendered, 9 screen-space rays through the scene via `THREE.Raycaster` →
   **0 hits**; `mesh.raycast === THREE.Mesh.prototype.raycast` (stock path
   testing the 4-vertex placeholder quad; `geometry.position.count = 4`).
   Doc 03 §B's "three consumers silently dead" prediction holds.
2. **Picking-prototype timing (§B route choice): OPEN** — not built this
   session; carried to the Phase 3 entry work. Neither route (CPU ray-ellipsoid
   over retained attributes vs GPU ID-readback) has been timed yet.

## Named optimization items (misses become items, never stops — ADR 0001)

1. **Traversal cost on the main thread**: ~260 ms/traversal at `?pages=32`
   steady state (~480K heap ops; tree is ~42 % interior nodes). At 122 pages
   expect proportionally more. Production fix: move traversal into a worker
   (doc 02 architecture already points there). Measured after three rounds of
   optimization (dirty-slot selection buffers; leaf nodes bypass the heap,
   851K→482K pushes; Sets → flat flags).
2. **covarianceB.zw dead lanes**: 8 % of pool bytes (doc 06 D17).
3. **Raw-bytes cache**: all 213 MB retained in JS heap for eviction re-decode;
   production wants an LRU bound or range re-fetch (doc 03 §A2 retry semantics).
4. **WebGL2 fallback memory**: ~3× storage copies (buffer + TF dual + PBO
   texture) + `DataTexture` retains the JS array; at 122 pages ≈ 1.8 GiB GPU +
   ~0.85 GiB heap. Fallback may deserve its own smaller class budget (formula
   supports it); min-spec (2048 max texture) caps at 21 pages (SH1-limited).
5. **SH1 saturation**: hero sh1 max 1.505 clips ~12 % of range in the addon's
   ±1 8-bit packing (accepted §H.3; recorded here so banding reports have a
   named cause).

## Declared divergences (never silent — session rule)

- **No Spark-comparison metrics** (owner directive 2026-08-16, ADR 0003).
- **Foveation + 2.5M frame budget constants** borrowed from Spark as starting
  values; ours to retune.
- **Eviction policy**: priority-protection (protect top-budget of traversal
  priority; evict others oldest-first) — Spark-shaped, not Spark-identical.
- **Probe-path caveat**: offscreen 96×96 RenderTarget probes under-read
  coverage vs the real canvas (0.749 vs 0.996 — splat sizing at tiny render
  targets); probes compare only against probes, canvas against canvas.

## Review trail

- Built-in `/code-review` (high): 10 verified findings, all fixed same-session
  (stale camera matrix; selection-ownership split; Infinity aspect; unguarded
  resize; fork w-lane identity; index/base assertion; traversal + decode-copy
  efficiency; doc amendment inconsistency; dead code).
- `/pocock-code-review` against amended doc 05: RAN 2026-08-16, both axes.
  Standards: 4 hard findings (README contradicting ADR 0003; a stale
  "ADR 0003 pending" claim; an uncited fixed-byte constant; results-doc number
  drift) + smell judgement calls. Spec: 5 missing/partial (doc 04's two free
  extras; unfixed window size; criterion 7's pixel half unevaluated; criterion 9
  proxy-only; criterion 8 unfalsifiable as instrumented), 2 further claims
  refuted on coordinator verification (the LOD `expansion` formula is faithful
  to `splat_encode.rs:480-491`; the fixed-byte constant was derivable, just
  uncited). All findings applied same-session; the metric-honesty wording above
  and the free-extras section below are its output.
- Pool-sizing decision: four-mission research + gpt5.6-xhigh adversarial
  review (`.collab-logs/`, machine-local), distilled into ADR 0003.
- **Stale-claim sweep** (2026-08-18, after the owner spot-checked two bad claims
  in a session summary): every checkable claim in each file this session touched,
  re-verified against actual repo state, candidates adversarially re-checked.
  Confirmed and fixed: doc 04 never received its ADR 0003 amendment (it still
  specified "five Spark control trials" and a "fixed 32-page pool" as Phase 0's
  spec — the single most misleading survivor, since a Phase 2 session reads it as
  the spike's contract); doc 05's expected-difference register claimed the fork
  matched Spark's 512 px radius cap when it still carries upstream's 1024;
  doc 05 claimed peak GPU memory was instrumented when it is modelled, not
  measured; criterion 1 didn't note that full-quality is unreachable by design in
  the constrained regime; doc 04's Phase 3 assumed Phase 0 had chosen a picking
  route, its Phase 5 cited a decision label that doesn't exist (D10, not Q11), and
  its Phase 6 had the site-switch order backwards vs D15; `PagePool.progress`
  claimed a cap that contradicts A5; `FORMAT.md` pointed at the wrong file for
  Spark's LOD selection (it is Rust `lod_tree.rs`, not TS `SplatPager.ts`); the
  X-flip was documented as universal when it is conditional on `eulerRotationDeg`;
  and this doc's own status block still said closure pended the review.
  **Coverage gap:** the sweep's verification pass ran out of session budget with
  22 candidates unverified; those were adjudicated by hand instead (the fixes
  above include them), so the sweep is complete in outcome but its automated
  second opinion covered only part of the set.
