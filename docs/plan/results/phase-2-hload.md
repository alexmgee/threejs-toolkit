# Phase 2 results — H-LOAD re-run on the production runtime (ticket 13 · ADR 0001 · ADR 0003)

Status: **TRIALS COMPLETE — RESULTS OPEN** (2026-09-25). Five clean cold-cache trials per
configuration in each set: visitor default 20 valid of 20 attempts, telemetry opt-in 20 of 20 —
none hidden, none contaminated, none re-run. One timing REGRESSION — named by the same-day control
as OUR CODE and broken down (§ Diagnostics; its decision a stop) — and the other open items (§ Open items)
must be settled before Phase 2 closes (ticket 13 AC2).

*2026-09-26:* stops V1-V4 ruled (ticket 13) — the regression is NAMED, its fix a post-Phase-2 ticket
(V1 a); criterion 4's number is 2.01 % (V2 a). The owner's eye check of D16's picture pair found a
VISIBLE quality gap, with ours captured at full quality (§ D16's picture pair).

Environment: Windows 11 · NVIDIA GeForce RTX 3090 Ti (WebGPU adapter `nvidia` / `ampere`) ·
Google Chrome 154.0.8037.57 — the owner's, a visible tab driven read-only through Claude-in-Chrome
(doc 06 D36 addendum item 11) · the Vite 6.4.3 dev server `toolkit-dev` (ruling H7) · three.js
0.185.1 + the vendored addon · the product as committed at `70dbd22` (no uncommitted change under
`src/`) · hero `lab-sh1-sparsity.rad` through `examples/site-lab/sites/lab.site.json`'s content.

Regimes and sets: as Phase 0 (ADR 0003) — the **derived default** (122 pages) and the constrained
**`?pages=32`**, set through the harness's load hook and asserted from the backend's own budget
report in every trial (ruling H1); each on WebGPU and on the WebGL2 fallback (`?webgl=1` hides
`navigator.gpu`). The **visitor default** set is the product as a visitor gets it — telemetry off
(`src/embed/SiteRuntime.ts:2357-2373`) — and is the counted set. The **telemetry opt-in** set is
the same content plus the site's own `settings.telemetry` switch, under its own configuration names
(`-telemetry`), never mixed into the visitor medians (doc 06 D36 addendum item 11).

Instrument: `examples/hload/` — `main.ts` (932 lines, sha256
`663bcf685164e92a95104b1f8e95c136bc93ec64c1c4c68fa8c3dda0fce22e1f`) and `index.html` (37 lines,
sha256 `8ecc354adb2ddc49af4a5197e435ccef7361f233d2efb41a8481bd55ef4c9516`): the spike's trial
machine (LOAD → STABILITY → DRAG → RESTORE, `spikes/native-rad/src/measure.ts`) around the
`<splat-site>` element. Its eight checks C1-C8 were each shown failing on a planted fault before any
counted trial ran (ticket 13). Metric definitions and methods: doc 06 D36 and its addendum.

Data: every table below is generated from Chrome's harness store `threejs-toolkit-hload-trials-v1`
— 40 records, 60,703 characters, sha256
`189f117b5f1ae2dc001e24937a688edcb33c377f767381a00080dffdaa4be39c` — by
`.collab-logs/t13-hload-tables.js` (git-ignored), an aggregation written independently of the
harness's own `report()`. The two agree on every median and maximum, and the page fetched this file
back and confirmed each generated table appears in it byte for byte. The 40 raw records themselves
sit beside this file as `phase-2-hload-trials.json` (60,703 bytes, moved out of Chrome byte-exact);
its sha256 recomputed over the repo copy equals the fingerprint above (ruling S5, 2026-09-25).

## Declared caveats on the bar comparison

1. **Window size.** The spike's trial window is unrecorded (ruling H3: nothing survives). These
   trials render a fixed 1280x720 box at pixel ratio 1 — canvas `1280x720@1` in all 40; the Chrome
   window's inner size was 1278x1270 in the first trial and 1278x1214 after, and the box does not
   depend on it. Selection at a pose depends on the drawing buffer (ticket 13 Q2: 17,713 at ratio
   1.5 against 12,189 at 1). *Measured 2026-09-25 (§ Same-day control):* at 1280x720 the spike
   itself selects 603,256 and 2,314,382 — production's figures exactly — so the selection
   difference from the bar is the window size, not the code.
2. **Near plane** 0.1 (the element) against the spike's 0.01 (ruling H2).
3. **Browser.** The bar was measured in the Claude app's built-in pane (`phase-0.md:76`; handoff
   002:35), whose build `phase-0.md:8` records only as "Chrome". These trials ran in Chrome
   154.0.8037.57 with the owner's extensions; at least one extension runs script on this origin
   (its storage key is present there).
4. **Host.** The full element, not the spike's bare loader page (ruling Q1b): the element's own boot
   work is inside every timing.
5. **Drag p95** is `sorted[floor(0.95 n)]` of render-to-render gaps (`examples/hload/main.ts:674-675`;
   the spike's rule, `measure.ts:241-243`). With 7-9 drag frames in the default regime that is the
   slowest frame — as it was for the spike.
6. **Longest task and peak heap** are the MAX across the five trials, as the bar's columns are
   (`phase-0.md:31`). Longest task is page-wide from module load (the spike's method, ruling Q3);
   peak heap is the spike's 500 ms `performance.memory` poll.

## Trial table — visitor default (5 clean cold-cache trials per configuration, medians; 2026-09-25)

| config | first-pixel (ms) | full-quality (ms) | steady (ms) | steady selected | pixel-stable (3 hashes per trial) | drag p95 (ms) [frames] | longest task max (ms) | peak JS heap max (MB) |
|---|---|---|---|---|---|---|---|---|
| webgpu-default (5 trials) | 1,624.3 | 17,728.4 | 17,747.0 | 2,314,382 (all 5) | within 5/5 · 5 distinct across trials | 603.2 [8–9] | 715 | 2,071 |
| webgpu-pages32 (5 trials) | 766.4 | n/a (by design) | 2,047.4 | 603,256 (all 5) | within 5/5 · 5 distinct across trials | 112.3 [40–41] | 131 | 897 |
| webgl-default (5 trials) | 1,413.5 | 15,523.7 | 15,560.9 | 2,314,382 (all 5) | within 5/5 · 5 distinct across trials | 635.6 [8] | 765 | 2,020 |
| webgl-pages32 (5 trials) | 703.0 | n/a (by design) | 1,902.0 | 603,256 (all 5) | within 5/5 · 4 distinct across trials | 136.4 [34–35] | 156 | 842 |

## The ten criteria against the Phase 0 bar — each with its number and verdict

The bar is `phase-0.md:33-36`. Timing verdicts: **beats** = all five trials under the bar;
**matches** = the median under the bar with some trials over it; **REGRESSION** = the median over
the bar.

| # | criterion (doc 05) | config | measured | Phase 0 bar | verdict |
|---|---|---|---|---|---|
| 1 | first-pixel, median | webgpu-default | 1,624.3 ms (trials 1,596.3–1,675.7) | 1,828 ms | beats — all 5 trials under the bar |
| 1 | first-pixel, median | webgpu-pages32 | 766.4 ms (trials 690.1–875.0) | 1,043 ms | beats — all 5 trials under the bar |
| 1 | first-pixel, median | webgl-default | 1,413.5 ms (trials 1,383.2–1,540.6) | 1,423 ms | matches — median under the bar; 2 of 5 trials over it |
| 1 | first-pixel, median | webgl-pages32 | 703.0 ms (trials 677.3–714.5) | 598 ms | **REGRESSION** — median over the bar; 5 of 5 trials over it |
| 1 | full-quality, median (default regime only) | webgpu-default | 17,728.4 ms (trials 16,472.1–18,117.6) | 48,027 ms | beats — all 5 trials under the bar |
| 1 | full-quality, median (default regime only) | webgl-default | 15,523.7 ms (trials 15,402.8–18,086.7) | 75,127 ms | beats — all 5 trials under the bar |
| 1 | full-quality | webgpu-pages32 | n/a — never reached in 5/5 trials | n/a (by design) | as designed |
| 1 | full-quality | webgl-pages32 | n/a — never reached in 5/5 trials | n/a (by design) | as designed |
| 1 | steady, median (the constrained regime's load-completion analog) | webgpu-pages32 | 2,047.4 ms (trials 1,881.6–2,153.8) | 3,055 ms | beats — all 5 trials under the bar |
| 1 | steady, median (the constrained regime's load-completion analog) | webgl-pages32 | 1,902.0 ms (trials 1,868.9–1,937.1) | 4,349 ms | beats — all 5 trials under the bar |
| 2 | payload requests are byte ranges; cold cache | all 4 | 123 hero requests per trial, every one a 206 whose body crossed the network, in 20/20 trials | 122/122 chunks as 206 | ✓ |
| 3 | selected count at the test pose, identical across trials | webgpu-default + webgl-default | 2,314,382 in 10/10 trials, both backends | 2,500,000 | ✓ identical across trials and backends — the figure differs from the bar's (open item 2) |
| 3 | selected count at the test pose, identical across trials | webgpu-pages32 + webgl-pages32 | 603,256 in 10/10 trials, both backends | 729,351 | ✓ identical across trials and backends — the figure differs from the bar's (open item 2) |
| 4 | pixel-stable across trials (64x64 readback hash) | webgpu-default | within-trial identical 5/5; 5 distinct hashes across 5 trials | within-trial ✓ / across-trial varies† | within ✓; across: diff band NOT measured (hashes only) — a gap, not a pass |
| 4 | pixel-stable across trials (64x64 readback hash) | webgpu-pages32 | within-trial identical 5/5; 5 distinct hashes across 5 trials | within-trial ✓ / across-trial varies† | within ✓; across: diff band NOT measured (hashes only) — a gap, not a pass |
| 4 | pixel-stable across trials (64x64 readback hash) | webgl-default | within-trial identical 5/5; 5 distinct hashes across 5 trials | ✓ single hash across ALL trials | within ✓; across: diff band NOT measured (hashes only) — a gap, not a pass — differs from the bar's single hash (open item 3) |
| 4 | pixel-stable across trials (64x64 readback hash) | webgl-pages32 | within-trial identical 5/5; 4 distinct hashes across 5 trials | within-trial ✓ / 2 hashes across 5 trials‡ | within ✓; across: diff band NOT measured (hashes only) — a gap, not a pass |
| 5 | drag p95 rendered-frame cost, median | webgpu-default | 603.2 ms (trials 579.2–613.2) | 743 ms | beats — all 5 trials under the bar |
| 5 | drag p95 rendered-frame cost, median | webgpu-pages32 | 112.3 ms (trials 108.4–118.2) | 146 ms | beats — all 5 trials under the bar |
| 5 | drag p95 rendered-frame cost, median | webgl-default | 635.6 ms (trials 612.9–643.1) | 817 ms | beats — all 5 trials under the bar |
| 5 | drag p95 rendered-frame cost, median | webgl-pages32 | 136.4 ms (trials 135.1–145.4) | 182 ms | beats — all 5 trials under the bar |
| 6 | no allocation failure; pool exactly at budget | all 4 | webgpu-default: capacity 7,995,392 = 122 × 65,536, resident at steady 122; webgpu-pages32: capacity 2,097,152 = 32 × 65,536, resident at steady 32; webgl-default: capacity 7,995,392 = 122 × 65,536, resident at steady 122; webgl-pages32: capacity 2,097,152 = 32 × 65,536, resident at steady 32; WebGPU device errors 0 | allocation succeeded at budget | ✓ (WebGL2 has no device-error channel — there the evidence is the load completing at budget) |
| 7 | revisit restores the selection (count half) and passes the pixel check (hash half) | webgpu-default | selection 5/5; hash 0/5 | selection ✓; hash ✗ (documented nondeterminism) | count half ✓; hash half ✗ 5/5 — same result as the bar |
| 7 | revisit restores the selection (count half) and passes the pixel check (hash half) | webgpu-pages32 | selection 5/5; hash 0/5 | selection ✓; hash ✗ (documented nondeterminism) | count half ✓; hash half ✗ 5/5 — same result as the bar |
| 7 | revisit restores the selection (count half) and passes the pixel check (hash half) | webgl-default | selection 5/5; hash 5/5 | selection ✓; hash ✓ | count half ✓; hash half ✓ — same result as the bar |
| 7 | revisit restores the selection (count half) and passes the pixel check (hash half) | webgl-pages32 | selection 5/5; hash 0/5 | selection ✓; hash ✗ (documented nondeterminism) | count half ✓; hash half ✗ 5/5 — same result as the bar |
| 8 | progress never decreases (tripwire) | all 4 | quiet in 20/20 trials | quiet | ✓ — satisfied by construction (A5); the sampling is a tripwire |
| 9 | a page uploaded under a motionless camera becomes visible | all 4 | selection grew under the motionless camera in 20/20 trials | ✓ (selection growth + invalidate()) | ✓ selection-growth half; the SH-output assertion is decided separately (G7) |
| 10 | visible order updates without camera motion | all 4 | the same selection growth under a motionless camera, 20/20 | ✓ (same evidence) | ✓ at the bar's evidence standard |
| — | longest main-thread task, max (page-wide, the spike's method) | webgpu-default | 715 ms (trials 593–715) | 775 ms | beats — the max of all trials is under the bar |
| — | longest main-thread task, max (page-wide, the spike's method) | webgpu-pages32 | 131 ms (trials 121–131) | 185 ms | beats — the max of all trials is under the bar |
| — | longest main-thread task, max (page-wide, the spike's method) | webgl-default | 765 ms (trials 731–765) | 1,017 ms | beats — the max of all trials is under the bar |
| — | longest main-thread task, max (page-wide, the spike's method) | webgl-pages32 | 156 ms (trials 143–156) | 206 ms | beats — the max of all trials is under the bar |
| — | peak JS heap, max (500 ms performance.memory poll) | webgpu-default | 2,071 MB (trials 1,817–2,071) | 3,912 MB | beats — the max of all trials is under the bar |
| — | peak JS heap, max (500 ms performance.memory poll) | webgpu-pages32 | 897 MB (trials 749–897) | 1,296 MB | beats — the max of all trials is under the bar |
| — | peak JS heap, max (500 ms performance.memory poll) | webgl-default | 2,020 MB (trials 1,908–2,020) | 2,887 MB | beats — the max of all trials is under the bar |
| — | peak JS heap, max (500 ms performance.memory poll) | webgl-pages32 | 842 MB (trials 748–842) | 1,306 MB | beats — the max of all trials is under the bar |

† and ‡ are the bar's own footnotes (`phase-0.md:50-58`). Historical context only, never pass/fail
(ADR 0003): Spark's tuned hero first-pixel on this asset was 2.3 s (`phase-0.md:71-72`).

Readings:
- **One regression, in one configuration:** WebGL2 at `?pages=32`, first-pixel 703.0 ms against
  598 ms, every trial over the bar. The same regime on WebGPU beats its bar (766.4 against 1,043);
  the WebGL2 default matches its bar (1,413.5 against 1,423). Open item 1.
- **Loading finished far sooner where the spike was slowest:** full-quality 17,728.4 ms against
  48,027 on WebGPU and 15,523.7 against 75,127 on WebGL2; constrained steady 2,047.4 against 3,055
  and 1,902.0 against 4,349. Phase 0 named the fix it expected here ("Production's 4-worker pool
  (doc 04) is the named fix", `phase-0.md`'s readings); these trials do not isolate that cause.
- **Every drag, longest-task and heap row beats the bar**, subject to open item 2: the steady
  selection here is 7.4 % (default) and 17.3 % (constrained) smaller than the bar's, so part of
  these gains may be less work rather than faster work. *2026-09-25, same-day control:* that is the
  window size (open item 2, settled), and the browser moved the spike too (finding C-1) — against
  the same-day spike on WebGL2, drag p95 and longest task come out equal, and the default heap is
  165 MB higher.
- **Criterion 4 is not fully evidenced:** within-trial stability holds in 20/20 trials, but every
  configuration shows several hashes across trials and the harness keeps 64x64 hashes, not pixels,
  so the diff band the criterion asks for is not measured (open item 4). The WebGL2 default differs
  from the bar's single hash (open item 3).
- **Q2 held in all 40 counted trials:** the D26 reveal render was the spike's first-pixel render
  every time (`rendersRevealToFirstPixel` 0 in every record).
- *2026-09-27 — criterion 9's SH-output half, DECIDED (ruling W4 a):* the generated row above says
  that half "is decided separately (G7)". It is now evidenced by pager-lab's direct check
  `sh-output-fresh-after-admission` on its final bytes (`8859e840…`): red under its planted fault on
  WebGPU, green unplanted on WebGPU in both regimes, the recorded premise holding on WebGL2.
  Criterion 9 ✓, both halves (ticket 13).
- *2026-09-27 — the bar's dating, DECIDED (close-out ruling 5):* the Phase 0 bar is kept. Finding
  C-1 stands beside it as a dated note: the WebGL2 default's "match" (1,413.5 against 1,423 ms) is
  321.1 ms behind the same-day spike (1,092.4 ms, 2026-09-25). The control is never a new bar
  (ruling 1 stands); the bar's re-dating belongs to owner item 5 (ticket 13).

## Telemetry opt-in set (5 trials per configuration, medians; never in the visitor medians)

| config | first-pixel (ms) | full-quality (ms) | steady (ms) | steady selected | pixel-stable (3 hashes per trial) | drag p95 (ms) [frames] | longest task max (ms) | peak JS heap max (MB) |
|---|---|---|---|---|---|---|---|---|
| webgpu-default-telemetry (5 trials) | 1,849.5 | 18,724.2 | 18,799.6 | 2,314,382 (all 5) | within 5/5 · 5 distinct across trials | 572.0 [8–9] | 696 | 2,074 |
| webgpu-pages32-telemetry (5 trials) | 998.4 | n/a (by design) | 2,654.9 | 603,256 (all 5) | within 5/5 · 5 distinct across trials | 152.1 [34–35] | 189 | 1,218 |
| webgl-default-telemetry (5 trials) | 1,684.4 | 17,234.8 | 17,323.8 | 2,314,382 (all 5) | within 5/5 · 5 distinct across trials | 633.8 [7–9] | 805 | 2,690 |
| webgl-pages32-telemetry (5 trials) | 932.8 | n/a (by design) | 2,640.9 | 603,256 (all 5) | within 5/5 · 5 distinct across trials | 197.0 [27–29] | 237 | 2,403 |

### The cost of telemetry — visitor default → opt-in, same criteria

| config | first-pixel median (ms) | full-quality / steady median (ms) | drag p95 median (ms) | longest task max (ms) | peak heap median (MB) | peak heap max (MB) |
|---|---|---|---|---|---|---|
| webgpu-default | 1,624.3 → 1,849.5 (+225.2, +13.9 %) | FQ 17,728.4 → 18,724.2 (+995.8, +5.6 %) | 603.2 → 572.0 (−31.2, −5.2 %) | 715 → 696 (−19, −2.7 %) | 1,864 → 2,022 (+158, +8.5 %) | 2,071 → 2,074 (+3, +0.1 %) |
| webgpu-pages32 | 766.4 → 998.4 (+232.0, +30.3 %) | steady 2,047.4 → 2,654.9 (+607.5, +29.7 %) | 112.3 → 152.1 (+39.8, +35.4 %) | 131 → 189 (+58, +44.3 %) | 784 → 1,121 (+337, +43.0 %) | 897 → 1,218 (+321, +35.8 %) |
| webgl-default | 1,413.5 → 1,684.4 (+270.9, +19.2 %) | FQ 15,523.7 → 17,234.8 (+1,711.1, +11.0 %) | 635.6 → 633.8 (−1.8, −0.3 %) | 765 → 805 (+40, +5.2 %) | 1,977 → 2,052 (+75, +3.8 %) | 2,020 → 2,690 (+670, +33.2 %) |
| webgl-pages32 | 703.0 → 932.8 (+229.8, +32.7 %) | steady 1,902.0 → 2,640.9 (+738.9, +38.8 %) | 136.4 → 197.0 (+60.6, +44.4 %) | 156 → 237 (+81, +51.9 %) | 799 → 1,337 (+538, +67.3 %) | 842 → 2,403 (+1,561, +185.4 %) |

Reading — the empirical check on the source comment's "opt-in/author telemetry is now bounded"
(`src/embed/SiteRuntime.ts:2364-2365`), which it attributes to the re-entrancy fix in
`LoadProbe.runOptionalObservation`:
- **Repeatable, not runaway.** All 20 opt-in trials completed load, drag and restore; first-pixel
  moved by +225.2 to +270.9 ms in every configuration.
- **Not free.** In the constrained regime telemetry adds about 30 % to first-pixel and to steady,
  35-44 % to the drag p95 (+39.8 and +60.6 ms), and 43-67 % to the median peak heap. In the default
  regime, where each frame's traversal (~300 ms average, per-trial table) dominates, the drag cost is
  not measurable (−31.2, −1.8 ms) while full-quality moves +5.6 % and +11.0 %.
- **Two single-trial heap outliers** carry the max column: 2,403 MB (the first `webgl-pages32`
  opt-in trial; the other four 1,173-1,402) and 2,690 MB (one `webgl-default` opt-in trial; the
  other four 2,052-2,059).
- **Runtime work, not dev-server module loading:** telemetry's code is imported statically (the only
  dynamic imports in `src/embed/` are the author tools, `SiteRuntime.ts:3868-3870`), so both sets
  load the same modules.
- **Ruled (owner, 2026-09-25):** the reading stands — bounded and repeatable, not small. The opt-in
  telemetry price is an owner item for the Phase 2 boundary, beside the embed, F1 and `CONTEXT.md`;
  the `renderedSampleWindows` retune stop cites these numbers.

### The load record's own figures, alongside (rulings Q3 and H5)

| config | record found | first-splat (record) vs reveal, median (ms) | longest task: record per-scene vs page-wide, max (ms) | terminal outcome | convergence proven | renders per sample window (per trial) |
|---|---|---|---|---|---|---|
| webgpu-default-telemetry | 5/5 | 1,849.7 vs 1,849.5 | 696 vs 696 | abandoned | 0/5 | 9.45, 10.00, 9.27, 10.10, 8.82 |
| webgpu-pages32-telemetry | 5/5 | 998.5 vs 998.4 | 189 vs 189 | abandoned | 0/5 | 2.49, 2.42, 2.46, 2.47, 2.47 |
| webgl-default-telemetry | 5/5 | 1,684.5 vs 1,684.4 | 805 vs 805 | abandoned | 0/5 | 6.56, 7.11, 7.11, 6.50, 7.22 |
| webgl-pages32-telemetry | 5/5 | 933.0 vs 932.8 | 237 vs 237 | abandoned | 0/5 | 2.06, 2.00, 1.97, 2.03, 1.97 |

- The record's `scene_first_splat_ready` lands at the reveal, as ticket 12's G4 wired it.
- The record's per-scene longest task equals the page-wide figure in every one of the 20 opt-in
  trials (per-trial table): in each, the longest task came after the scene registered, so Q3's
  span difference changed nothing here.
- **No record proved convergence** — all 20 finalized `abandoned` with `convergedProven` false.
  The policy needs a 2,000 ms candidate dwell with observations at most 500 ms apart
  (`src/diag/policies.ts:3-7`); the harness starts its drag three readback hashes after its own
  steady point and, after the restore, removes the element five steady renders and one readback
  later (`examples/hload/main.ts:577-621`, removal at `:681`), and disposal finalizes as
  `abandoned` (`src/diag/LoadProbe.ts:568-571`, `src/diag/convergence.ts:55`). These trials leave
  the probe little quiet time: the convergence column is no evidence either way about production
  convergence.
- **Renders per sample window** — the `renderedSampleWindows` item (doc 06 D35 item 5; ticket 12
  measured 6.32x): 8.82-10.10 (WebGPU default), 6.50-7.22 (WebGL2 default), 2.42-2.49 (WebGPU
  `?pages=32`), 1.97-2.06 (WebGL2 `?pages=32`). The ratio is not one number; the retune is decided at
  its own stop (ticket 13).
  *CORRECTED 2026-09-26:* these figures — and the table's last column — divide the harness's
  WHOLE-TRIAL render count (`examples/hload/main.ts:526`) by the record's `renderedSampleWindows`,
  which counts only the flagged sample windows of the LAST 5 s before finalization
  (`src/diag/LoadProbe.ts:624-629`, read at `:546`). Different spans: they are NOT frames per
  sample window, and the trials did not record renders per 5-s window. The values stay above as
  published (ticket 13, stop W1).

## Same-day control (2026-09-25) — the spike in the same Chrome, at 1280x720

A CONTROL, never a new bar (doc 06 D36 addendum item 12, ruling 1). The spike's own measuring page
(`spikes/native-rad` at `e738ba6`, its own Vite 6.4.3 dev server) ran in the owner's Chrome inside a
fixed 1280x720 frame — every record carries `window` 1280x720 and `pixelScaleHeight` 720 — after one
uncounted warm-up load; none hidden or contaminated; every trial range-only, 122/122 chunks. Its
decision rule was written into ticket 13 before the run. Raw records: `phase-2-hload-control-trials.json`
beside this file (11 records including the warm-up; sha256
`2bcd46d782dfe76bff83929b0e53f857c728e7cc5e6831911bbb85c9d3a5bf26`, recomputed over the repo copy).
Figures computed in the page with the spike's median rule, warm-up excluded:

| config (spike, same-day) | first-pixel median (trials) | full-quality / steady | selected | hashes across 5 | restore hash | drag p95 | longest task max | heap max |
|---|---|---|---|---|---|---|---|---|
| webgl-pages32 | 570.8 ms (487.7-599.6) | steady 3,396.4 ms | 603,256 (5/5) | 2 | 0/5 | 144.8 ms | 164 ms | 900 MB |
| webgl-default | 1,092.4 ms (1,055.6-1,169.7) | full-quality 54,163.3 ms | 2,314,382 (5/5) | 1 | 5/5 | 636.1 ms | 772 ms | 1,855 MB |

- **Ruling 1's verdict — OUR CODE.** The spike reads 570.8 ms, "~600" by the pre-written rule;
  production's 703.0 ms is 132.2 ms slower in the same browser on the same day. Next: a
  stage-by-stage breakdown of our first-pixel path on webgl-pages32, brought back as a stop.
- **Ruling 2's verdict — PROVEN.** At 1280x720 the spike selects 603,256 and 2,314,382 in every
  trial, production's figures exactly: the selection difference from the bar is the window size.
- **The spike's WebGL2 default still yields ONE hash across all five trials** (restore 5/5), as in
  Phase 0 — production's five distinct hashes are production's own behaviour, not the browser's.
- **Finding C-1 — the environment moved the bar.** The same-day spike is faster and lighter than its
  own Phase 0 figures (first-pixel 570.8 against 598 and 1,092.4 against 1,423; full-quality
  54,163.3 against 75,127; default heap 1,855 against 2,887 MB). Against the SAME-DAY spike,
  production's webgl-default first-pixel (1,413.5) is 321.1 ms slower — the "matches" against the
  Phase 0 bar hides it. The other same-day pairs, production against spike: full-quality 15,523.7
  against 54,163.3; drag p95 635.6 against 636.1 and 136.4 against 144.8; longest task 765 against
  772 and 156 against 164; heap max 2,020 against 1,855 (default) and 842 against 900 (`?pages=32`).
  No same-day control exists for the WebGPU configurations. How this bears on the verdicts is the
  owner's call. *Decided 2026-09-27 (ticket 13, close-out ruling 5): the Phase 0 bar is kept, this finding a dated note — Readings, above.*

## Diagnostics (2026-09-25) — where first-pixel goes, why WebGL2 pictures differ, criterion 4's band, D16's picture pair

Instrument (git-ignored, fingerprinted in ticket 13): `.collab-logs/t13-diag.{html,ts}` boots the
element exactly as the harness does and records every stage below, the chunk-to-slot map (the door's
read-only `slotOf`), the network arrival order (the backend's existing TEST-ONLY `fetchImpl` as a
pass-through), decode posts and replies (the page's `Worker` class wrapped), the harness's own hash
and one full-frame capture at the harness's steady point — no product code changed. Twenty trials in
the owner's Chrome, five per configuration, 20 clean of 20 attempts (2026-09-25, 08:19-08:24 UTC).
Raw records: `phase-2-hload-diagnostics.json` (sha256
`45e997e96769bef47ed6c5ff6ff7c777132491fd413d729c98ce86aa873038db`); the band's per-pair detail:
`phase-2-hload-band.json` (sha256 `9ea5dbdc73f944eb703d544febf94249d80876582e9eb9119833639a5f9cf41e`).
Every table in this section is generated from those files.

### First-pixel, stage by stage (ruling 1, widened to both WebGL2 configurations at the second GO)

| stage, median of 5 (ms) | webgl-pages32 | webgl-default | webgpu-pages32 | webgpu-default |
|---|---|---|---|---|
| navigation → HTML received | 13.6 | 13.4 | 13.6 | 13.7 |
| HTML → module graph loaded and evaluated | 120.6 | 122.7 | 157.3 | 233.3 |
| module start → `backend.load()` called | 4.9 | 4.5 | 5.0 | 4.4 |
| `load()` → header requested (renderer init) | 6.6 | 7.4 | 36.0 | 35.7 |
| header request → header body | 8.9 | 7.8 | 3.8 | 2.0 |
| **header body → chunk 0 requested** (the header hook) | 90.2 | 310.8 | 135.2 | 495.5 |
| **chunk 0 request → body read** | 269.5 | 692.7 | 262.3 | 754.6 |
| chunk 0 decode (posted → reply) | 116.7 | 28.7 | 119.7 | 29.1 |
| decode reply → first upload drawn | 65.1 | 176.9 | 17.1 | 13.9 |
| first-pixel (trials) | **709.6** (645.3–720.7; reveal = first-pixel 5/5) | **1,362.8** (1,341.7–1,447.0; reveal = first-pixel 5/5) | **778.6** (653.1–1,118.7; reveal = first-pixel 5/5) | **1,568.2** (1,490.5–1,735.1; reveal = first-pixel 5/5) |
| longest task, max | 231.0 | 822.0 | 215.0 | 730.0 |

The instrumented runs reproduce the counted first-pixel medians (709.6 against 703.0 and 1,362.8
against 1,413.5 on WebGL2; 778.6 against 766.4 and 1,568.2 against 1,624.3 on WebGPU).

- **One shared cause across both WebGL2 configurations.** Two stages dominate, and both grow with
  the page budget: the header hook (90.2 → 310.8 ms from 32 to 122 pages) and chunk 0's body
  (269.5 → 692.7 ms — far longer than a ~1.8 MB transfer over localhost; the main thread is busy
  when the body could be delivered, its longest task 231 and 822 ms).
- **What the header hook does.** It builds the paged mesh at full capacity — `createPagedMesh`
  (`src/vendor/three-gs/patches/paged.ts:433-459`): a zero-filled source geometry of `capacity`
  splats (7,995,392 at 122 pages) run through the UNMODIFIED vendored constructor, its source
  arrays released afterwards — the route D20's pure-`.ts` patches take (the vendored JS stays
  byte-frozen; FORK.md `[paged]`). The spike's fork allocates the same storage from empty arrays,
  fed a 1-splat stub (`spikes/native-rad/src/GaussianSplatMesh.fork.js:8-10`, `:93-107`;
  `spikes/native-rad/main.ts:225-238`).
- **The two constructions, measured side by side** (`.collab-logs/t13-bench.ts`; one construction
  per fresh page load in the built-in pane, three runs each — a hidden, lower-priority process, so
  compare the two rows, not their absolute times with Chrome's):

| construction | 32 pages (2,097,152 splats) | 122 pages (7,995,392 splats) |
|---|---|---|
| production `createPagedMesh` | 85.8, 242.9, 259.4 — median 242.9 ms | 819.3, 897.0, 927.5 — median 897.0 ms |
| spike fork `{ capacity }` | 14.7, 14.1, 12.3 — median 14.1 ms | 39.7, 36.9, 24.7 — median 36.9 ms |

  Production's construction costs 17x (32 pages) and 24x (122 pages) the spike's. *An estimate,
  not a measurement:* if the spike's construction scaled into Chrome as production's did (Chrome's
  hook stage over the pane's construction), it would take about 5 and 13 ms there, leaving about 85
  and 298 ms of the Chrome stage as the difference — against same-day gaps of 132.2 and 321.1 ms.
  The rest of the `?pages=32` gap (about 47 ms by that estimate) is not attributed: the spike's own
  stages were not measured. What to do about it is a stop (ticket 13).
  *Re-run 2026-09-26 from fingerprinted bytes (`t13-bench.ts` sha256 `eaaac034…`; ticket 13, RG-1):*
  288.2 against 15.3 ms at 32 pages (18.8x) and 954.3 against 47.9 ms at 122 (19.9x); the estimate
  re-derived the same way: about 85 and 295 ms. Whether the bytes behind the table above were the
  same is not provable from the records.

### Why the WebGL2 default's pictures differ between loads (ruling S3 b)

| trial | hash (harness, 3 of 3) | full-frame hash | chunks deferred | posted → replied inversions (of 7,381) | slot order = reply order | posted order vs arrival order (inversions) |
|---|---|---|---|---|---|---|
| `diag-1790324368480` | `893412f3` (3 identical) | `7bedca4e` | 121 of 121 | 85 | yes | 4401 |
| `diag-1790324386407` | `9f431c67` (3 identical) | `0578f3c8` | 121 of 121 | 77 | yes | 4477 |
| `diag-1790324404537` | `351cc5e3` (3 identical) | `9b3cd682` | 121 of 121 | 87 | yes | 4539 |
| `diag-1790324422124` | `e846d0e5` (3 identical) | `58ac8208` | 121 of 121 | 92 | yes | 4403 |
| `diag-1790324439700` | `6028ef61` (3 identical) | `42e0aa71` | 121 of 121 | 87 | yes | 4455 |

Across the 10 pairs: maps equal in 0, hashes equal in 0; chunks in different slots 65–85 of 122; posted orders differ by 25–42 inversions, replied orders by 49–80.

- **The chain, measured.** A chunk's slot is the order its decode came back (slot order = reply
  order in 5 of 5 — the first free slot, `src/backend/PagePool.ts:187-195`, `:215`), and the
  pictures follow the maps: in all 10 pairs both differ, and within each load the map is fixed and
  all three hashes agree. No two loads shared a map, so "equal maps give equal pictures" was not
  observed directly.
- **Neither of the two suspects alone, and network order not at all.** All 121 non-root chunks were
  deferred — their bytes arrived before the traversal wanted them — and admitted later in the
  traversal's priority order, up to four at a time (`src/backend/ThreeGsBackend.ts:1071-1076`); the
  order chunks were POSTED to decode is about 60 % inverted against their arrival order. Two things
  vary between loads: the posted order itself (admission follows the traversal, whose timing
  against the frames varies) and the four workers' reordering of completions within each load,
  which widens it.
- The spike decodes one chunk at a time, choosing the next in priority order after each completes
  (`spikes/native-rad/main.ts:301-311`), and still yields ONE hash across five loads today
  (§ Same-day control).

### Criterion 4 — the cross-trial difference band (ruling S4 A)

| config (5 loads, 10 pairs) | distinct frames | Δ 0 | Δ 1–2 | Δ 3–8 | Δ 9–32 | Δ 33–128 | Δ 129–255 | largest Δ | mean Δ per pixel, median pair (max) |
|---|---|---|---|---|---|---|---|---|---|
| webgl-pages32 | 5 of 5 | 98.33 % | 0.75 % | 0.45 % | 0.42 % | 0.04 % | 0.00 % | 100 | 0.021 (0.277) |
| webgl-default | 5 of 5 | 97.99 % | 1.22 % | 0.54 % | 0.23 % | 0.02 % | 0.00 % | 85 | 0.115 (0.149) |
| webgpu-pages32 | 5 of 5 | 56.74 % | 20.61 % | 14.30 % | 7.32 % | 1.03 % | 0.00 % | 211 | 2.579 (2.909) |
| webgpu-default | 5 of 5 | 27.56 % | 33.11 % | 26.46 % | 11.52 % | 1.35 % | 0.00 % | 180 | 4.048 (4.354) |

Full 1280x720 frames read from the canvas in the same task as the steady render; every pair of the
five loads compared per pixel (the largest channel difference, 0-255). Read against the bar's own
footnoted behaviour (`phase-0.md:50-58`) — the verdict is the owner's:
- **WebGPU** (†: "pixel-stable within a trial but hash differently across page loads"): the same
  kind — stable within each load; across loads most pixels move by a few levels (72.4 % and 43.3 %
  differ; 1.35 % and 1.03 % by more than 32).
- **WebGL2 `?pages=32`** (‡: "occasional cross-trial hash differences with identical selection"):
  the same kind, more often — five distinct frames in five (the spike: two in five, in Phase 0 and
  today); 1.67 % of pixels differ on average.
- **WebGL2 default** (the bar: "one identical hash across all trials at full residency"):
  DIFFERENT — five distinct frames; 2.01 % of pixels differ on average, 0.25 % by more than 8
  levels. The mechanism is the one above.

### D16's picture pair — for the owner's eye check (ruling H8 a; capture method S4 A)

| picture | bytes | sha256 (also in `<name>.sha256` beside it) | stack / backend | captured when |
|---|---|---|---|---|
| `h8-ours-webgpu.png` | 1,840,252 | `b14bd88151099bc128fdc70c48841c02c909f3fcd08e4af1c73a0897c89cc5b4` | ours / webgpu, ratio 1, 1280x720 | steady: loadSettled, lod.admitting 0, selected > 0, held 5 renders; 2,314,382 selected |
| `h8-ours-webgl2.png` | 1,842,012 | `4b7f1971966df15572c7c5f7a8faff231075f5253b1db6ed27ed7397724569e3` | ours / webgl2-fallback, ratio 1, 1280x720 | steady: loadSettled, lod.admitting 0, selected > 0, held 5 renders; 2,314,382 selected |
| `h8-pin.png` | 1,907,484 | `21cb3b311562804205f43386fe3f5ec8beaadab47a8297c148f04de62a1e7e09` | pin / spark (WebGLRenderer), ratio 1, 1280x720 | ready, load progress 1, then a 5000 ms settle; ready at 3918 ms, captured at 9068 ms |

One shared page (`.collab-logs/t13-h8.{html,ts}`, byte-identical on both servers; three faults
found by testing and fixed, ticket 13): the element on lab.site.json's content, 1280x720, pixel
ratio 1, pose A through each side's own CameraSystem, one capture from the canvas right after the
render that drew it — ours at the harness's steady point, the pin after `ready`, load progress 1
and a 5 s settle. Numbers never; the check is visual (D16). sparkjs read the same before and after
the pin's server ran (ticket 13).

*The owner's eye check (2026-09-26) — verbatim, two owner-side checks agreeing:* "a VISIBLE quality
gap — the pin is clearly sharper; ours is softer with painterly swirls and visible splat-blob
artifacts in flat areas (walls, window, jacket, wall photos)." *Checked first, at the owner's
request — was ours caught mid-refinement? No:* under the full budget the steady condition cannot
hold short of the traversal's full quality; ours selected 2,314,382 at capture, the full-quality
selection at this pose; and in all 30 default-regime loads on record that used the same condition,
full quality came 14.6-103.7 ms before steady. The capture records themselves hold no full-quality
flag. The pin's "`ready`, load progress 1" marks its reveal gate, not finished streaming
(`fd67153:src/embed/SiteRuntime.ts`). → A NAMED VISUAL-PARITY FINDING and an owner item; its
diagnosis belongs to a later ticket (ticket 13).

## Open items — to be NAMED before Phase 2 closes (AC2)

1. **REGRESSION — WebGL2 `?pages=32` first-pixel**, 703.0 ms (trials 677.3-714.5) against 598 ms.
   *Named 2026-09-25 by the same-day control:* OUR CODE — the spike reads 570.8 ms in the same
   browser. *Broken down 2026-09-25 (§ Diagnostics):* one shared cause across both WebGL2
   configurations — the header hook's full-capacity mesh construction on D20's route, 17x and 24x
   the spike's — which also carries most of finding C-1's 321.1 ms gap at the WebGL2 default. The
   decision is a stop (ticket 13). *Ruled 2026-09-26 (V1 a):* NAMED, not fixed in Phase 2 — the fix,
   a placeholder mesh plus empty full-size storage inside D20's rules, in its own post-Phase-2
   ticket; about 47 ms of the `?pages=32` gap unexplained, and the chunk-0-bytes stage (269.5 /
   692.7 ms) unattributed (ticket 13).
2. ~~**The steady selection differs from the bar's**~~ *Settled 2026-09-25 (same-day control):* the
   window size — the spike at 1280x720 selects 603,256 and 2,314,382, production's figures exactly.
   (Both sides cap a frame at 2,500,000 splats, `src/backend/LodTraversal.ts:55`,
   `spikes/native-rad/src/PagePool.ts:30`; the refinement threshold is per drawing-buffer pixel.)
3. **WebGL2 default hashes vary across trials** (5 distinct in 5) where the bar had one hash across
   all trials ("The WebGL CPU sort is fully deterministic", `phase-0.md:52-53`); the same-day spike
   still yields one. Within-trial stability and the restore hash both hold, 5/5. *Measured
   2026-09-25 (§ Diagnostics):* the pictures follow the chunk-to-slot maps, and the maps vary with
   the admission order and the four decode workers' completion order — not the network order.
   *Ruled 2026-09-26 (V2 a):* accepted — new behaviour with a proven mechanism, the price of 3-5x
   faster full-quality loading; deterministic slots (b) and serialized admission (c) are recorded
   as post-parity options (ticket 13).
4. **Criterion 4's diff band is not measured.** The harness stores 64x64 hashes, not pixels; the
   criterion asks for the measured band when strict stability is unachievable, "never a silent
   pass" (doc 05). *Measured 2026-09-25 (§ Diagnostics):* WebGL2 2.01 % / 1.67 % of pixels differ
   across loads, WebGPU 72.4 % / 43.3 % (mostly by a few levels); judged against the bar's footnotes
   by the owner. *Ruled 2026-09-26 (V2 a):* criterion 4's number is **2.01 %** (the WebGL2 default);
   WebGPU's variation is the bar's † kind and WebGL2 `?pages=32`'s its ‡ kind, more frequent
   (ticket 13).

## Irregularities, recorded

- One progress read (a regex count over the stored records) ran during the DRAG of
  `webgl-default-telemetry` v=`1790316805898`. That trial's drag p95, 644.9 ms, is the highest of
  its configuration's five (next 639.2) and is not the median (633.8). From then on progress was
  read from the tab's address only.
- The Chrome window's inner height changed between the first and second visitor trials (1270 →
  1214 CSS px); the canvas was `1280x720@1` in all 40.

## Per-trial data (all 40 counted trials, in run order)

| config | v | first-pixel | reveal | full-quality | steady | selected | steady hash | restore hash ∈ steady | drag p95 [frames] | longest task (record) | heap MB | traversals n / avg / max ms | renders / sample windows | window |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| webgpu-default | start | 1,620.6 | 1,620.6 | 18,117.6 | 18,143.6 | 2,314,382 | dfd95183 | ✗ | 603.2 [8] | 606 | 2,071 | 71 / 286.5 / 568.5 | 92 / — | 1278x1270 |
| webgpu-default | 1790315980130 | 1,650.1 | 1,650.1 | 17,943.9 | 17,960.4 | 2,314,382 | b921d496 | ✗ | 613.2 [8] | 715 | 1,861 | 68 / 302.2 / 670.6 | 101 / — | 1278x1214 |
| webgpu-default | 1790316014892 | 1,675.7 | 1,675.7 | 17,288.6 | 17,303.2 | 2,314,382 | 8feb323f | ✗ | 603.9 [8] | 597 | 1,864 | 61 / 316.1 / 559.6 | 113 / — | 1278x1214 |
| webgpu-default | 1790316048437 | 1,596.3 | 1,596.3 | 16,472.1 | 16,499.7 | 2,314,382 | 43b2e3d1 | ✗ | 579.2 [9] | 593 | 1,817 | 58 / 326.2 / 557.9 | 112 / — | 1278x1214 |
| webgpu-default | 1790316081567 | 1,624.3 | 1,624.3 | 17,728.4 | 17,747.0 | 2,314,382 | 0dfdcb6f | ✗ | 588.3 [8] | 603 | 1,864 | 69 / 288.4 / 566.7 | 103 / — | 1278x1214 |
| webgpu-pages32 | 1790316115576 | 875.0 | 875.0 | — | 2,153.8 | 603,256 | bb938d75 | ✗ | 108.6 [41] | 131 | 749 | 71 / 74.9 / 100.0 | 103 / — | 1278x1214 |
| webgpu-pages32 | 1790316134152 | 798.7 | 798.7 | — | 2,120.0 | 603,256 | e269715f | ✗ | 116.9 [40] | 125 | 791 | 67 / 76.6 / 104.3 | 105 / — | 1278x1214 |
| webgpu-pages32 | 1790316152481 | 730.1 | 730.1 | — | 1,881.6 | 603,256 | 9c9c7bbc | ✗ | 108.4 [41] | 130 | 767 | 63 / 78.9 / 112.4 | 110 / — | 1278x1214 |
| webgpu-pages32 | 1790316170577 | 690.1 | 690.1 | — | 1,985.2 | 603,256 | 9262ddf4 | ✗ | 118.2 [40] | 121 | 897 | 69 / 76.5 / 107.1 | 108 / — | 1278x1214 |
| webgpu-pages32 | 1790316188947 | 766.4 | 766.4 | — | 2,047.4 | 603,256 | 4787634d | ✗ | 112.3 [40] | 128 | 784 | 68 / 75.8 / 115.0 | 108 / — | 1278x1214 |
| webgl-default | 1790316207296 | 1,469.8 | 1,469.8 | 15,523.7 | 15,560.9 | 2,314,382 | 1add6851 | ✓ | 643.1 [8] | 731 | 1,934 | 42 / 308.4 / 556.8 | 63 / — | 1278x1214 |
| webgl-default | 1790316239548 | 1,413.5 | 1,413.5 | 15,402.8 | 15,437.0 | 2,314,382 | e357a01a | ✓ | 639.2 [8] | 765 | 2,019 | 42 / 304.2 / 588.5 | 68 / — | 1278x1214 |
| webgl-default | 1790316271580 | 1,383.2 | 1,383.2 | 15,411.4 | 15,446.9 | 2,314,382 | 77a51d7d | ✓ | 633.5 [8] | 733 | 2,020 | 42 / 304.5 / 558.1 | 68 / — | 1278x1214 |
| webgl-default | 1790316303637 | 1,411.8 | 1,411.8 | 15,697.8 | 15,737.9 | 2,314,382 | ba4a5e82 | ✓ | 635.6 [8] | 761 | 1,977 | 42 / 315.9 / 616.6 | 64 / — | 1278x1214 |
| webgl-default | 1790316336219 | 1,540.6 | 1,540.6 | 18,086.7 | 18,122.0 | 2,314,382 | 50b08b69 | ✓ | 612.9 [8] | 755 | 1,908 | 42 / 338.6 / 574.2 | 70 / — | 1278x1214 |
| webgl-pages32 | 1790316371014 | 714.5 | 714.5 | — | 1,937.1 | 603,256 | 2383eac1 | ✗ | 135.1 [35] | 150 | 748 | 53 / 78.2 / 108.0 | 69 / — | 1278x1214 |
| webgl-pages32 | 1790316389340 | 677.3 | 677.3 | — | 1,868.9 | 603,256 | ec74ed3f | ✗ | 136.3 [35] | 143 | 799 | 53 / 77.7 / 100.3 | 69 / — | 1278x1214 |
| webgl-pages32 | 1790316407548 | 704.6 | 704.6 | — | 1,932.6 | 603,256 | 1885dd28 | ✗ | 136.4 [35] | 156 | 757 | 53 / 78.2 / 101.7 | 71 / — | 1278x1214 |
| webgl-pages32 | 1790316425823 | 703.0 | 703.0 | — | 1,899.1 | 603,256 | d49e5bdd | ✗ | 140.8 [35] | 144 | 842 | 53 / 78.5 / 116.1 | 71 / — | 1278x1214 |
| webgl-pages32 | 1790316444113 | 699.8 | 699.8 | — | 1,902.0 | 603,256 | d49e5bdd | ✗ | 145.4 [34] | 146 | 826 | 52 / 78.6 / 110.1 | 69 / — | 1278x1214 |
| webgpu-default-telemetry | optin-start | 1,567.7 | 1,567.7 | 19,874.5 | 19,951.0 | 2,314,382 | 3ae57a20 | ✗ | 570.9 [8] | 696 (696) | 2,074 | 66 / 298.3 / 641.0 | 104 / 11 | 1278x1214 |
| webgpu-default-telemetry | 1790316640258 | 1,841.8 | 1,841.8 | 18,799.8 | 18,891.5 | 2,314,382 | ab7567a9 | ✗ | 584.6 [8] | 689 (689) | 2,022 | 68 / 271.0 / 594.4 | 100 / 10 | 1278x1214 |
| webgpu-default-telemetry | 1790316665597 | 1,867.4 | 1,867.4 | 18,657.4 | 18,701.2 | 2,314,382 | b0b0c108 | ✗ | 567.3 [8] | 619 (619) | 2,057 | 69 / 263.7 / 526.5 | 102 / 11 | 1278x1214 |
| webgpu-default-telemetry | 1790316690730 | 1,897.8 | 1,897.8 | 13,655.9 | 13,734.6 | 2,314,382 | 52eabe0f | ✗ | 572.0 [8] | 628 (628) | 1,985 | 44 / 312.6 / 541.6 | 101 / 10 | 1278x1214 |
| webgpu-default-telemetry | 1790316710902 | 1,849.5 | 1,849.5 | 18,724.2 | 18,799.6 | 2,314,382 | 97b41cae | ✗ | 576.9 [9] | 620 (620) | 1,987 | 69 / 265.1 / 528.7 | 97 / 11 | 1278x1214 |
| webgpu-pages32-telemetry | 1790316736139 | 1,141.6 | 1,141.6 | — | 2,585.7 | 603,256 | 1ef7463e | ✗ | 142.8 [35] | 180 (180) | 1,118 | 61 / 71.5 / 105.0 | 97 / 39 | 1278x1214 |
| webgpu-pages32-telemetry | 1790316745250 | 998.4 | 998.4 | — | 2,688.6 | 603,256 | 82b253a6 | ✗ | 152.1 [34] | 186 (186) | 1,047 | 62 / 73.1 / 106.1 | 92 / 38 | 1278x1214 |
| webgpu-pages32-telemetry | 1790316754565 | 992.1 | 992.1 | — | 2,733.7 | 603,256 | b7e8af2a | ✗ | 155.2 [34] | 148 (148) | 1,218 | 62 / 73.0 / 95.8 | 91 / 37 | 1278x1214 |
| webgpu-pages32-telemetry | 1790316763831 | 995.8 | 995.8 | — | 2,121.3 | 603,256 | 2a43a58a | ✗ | 142.1 [35] | 176 (176) | 1,218 | 54 / 74.6 / 101.9 | 94 / 38 | 1278x1214 |
| webgpu-pages32-telemetry | 1790316772458 | 1,017.6 | 1,017.6 | — | 2,654.9 | 603,256 | ebc4eca3 | ✗ | 158.8 [35] | 189 (189) | 1,121 | 62 / 73.5 / 103.8 | 94 / 38 | 1278x1214 |
| webgl-default-telemetry | 1790316781691 | 1,743.5 | 1,743.5 | 17,211.2 | 17,314.9 | 2,314,382 | 694e17b8 | ✓ | 629.2 [8] | 770 (770) | 2,052 | 42 / 293.2 / 536.7 | 59 / 9 | 1278x1214 |
| webgl-default-telemetry | 1790316805898 | 1,654.2 | 1,654.2 | 17,169.1 | 17,252.0 | 2,314,382 | addbe3f5 | ✓ | 644.9 [7] | 778 (778) | 2,690 | 41 / 293.6 / 547.1 | 64 / 9 | 1278x1214 |
| webgl-default-telemetry | 1790316829551 | 1,690.0 | 1,690.0 | 17,761.2 | 17,830.9 | 2,314,382 | 517b7224 | ✓ | 639.2 [7] | 784 (784) | 2,052 | 41 / 302.9 / 544.1 | 64 / 9 | 1278x1214 |
| webgl-default-telemetry | 1790316853765 | 1,675.8 | 1,675.8 | 17,234.8 | 17,323.8 | 2,314,382 | c2ca5179 | ✓ | 633.8 [8] | 778 (778) | 2,052 | 41 / 294.7 / 551.8 | 65 / 10 | 1278x1214 |
| webgl-default-telemetry | 1790316877466 | 1,684.4 | 1,684.4 | 17,260.9 | 17,345.5 | 2,314,382 | fe47d98e | ✓ | 619.5 [9] | 805 (805) | 2,059 | 42 / 297.0 / 582.4 | 65 / 9 | 1278x1214 |
| webgl-pages32-telemetry | 1790316901670 | 873.9 | 873.9 | — | 2,664.4 | 603,256 | a327f270 | ✗ | 220.2 [27] | 227 (227) | 2,403 | 46 / 81.4 / 118.1 | 64 / 31 | 1278x1214 |
| webgl-pages32-telemetry | 1790316911151 | 932.8 | 932.8 | — | 2,640.9 | 603,256 | 0edd4b6b | ✗ | 197.0 [29] | 237 (237) | 1,402 | 48 / 78.0 / 108.7 | 66 / 33 | 1278x1214 |
| webgl-pages32-telemetry | 1790316920605 | 950.7 | 950.7 | — | 2,721.4 | 603,256 | 59e8dfdf | ✗ | 205.3 [27] | 218 (218) | 1,337 | 46 / 82.4 / 113.1 | 63 / 32 | 1278x1214 |
| webgl-pages32-telemetry | 1790316930010 | 933.7 | 933.7 | — | 2,636.2 | 603,256 | 89e96e1d | ✗ | 189.1 [28] | 232 (232) | 1,178 | 47 / 80.0 / 114.3 | 65 / 32 | 1278x1214 |
| webgl-pages32-telemetry | 1790316939452 | 923.0 | 923.0 | — | 2,630.7 | 603,256 | 73d593ef | ✗ | 195.3 [27] | 229 (229) | 1,173 | 46 / 82.3 / 114.0 | 63 / 32 | 1278x1214 |
