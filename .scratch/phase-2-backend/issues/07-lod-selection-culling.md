# 07 — LOD traversal, selection, and culling

**Status:** done
**Blocked by:** 06 — page residency.

**What to build:** the hero shows the right splats at the right detail as the
camera moves — LOD tree traversal per camera into a selected set, carried to the
GPU via `center.w` flags with a SELECTION-AWARE `setBinNode` bin function (the
spike audit confirmed the spike's ignores `center.w`; deselected splats must
collapse out of draw order, not just out of the vertex node), plus frustum culling
driven by page AABBs. Owns selection-change invalidation. Second fork patch.

Standing rules bind (spec.md).

- [x] Selected splat count at a pinned test pose is identical across five trials
      (any variance is a bug), both backends.
- [x] Rendered output at the pinned pose is pixel-stable across trials of the same
      regime; if strict stability is unachievable, the measured diff band is
      recorded, never passed silently.
- [x] A selection change with the camera motionless updates visible draw order —
      demonstrated (spike criterion 10), not asserted.
- [x] Turning culling off restores the pre-ticket frame content exactly (culling
      changes cost, never content).
- [x] FORK.md titled patch entry in the same change; H-FORK re-run stays
      pixel-identical with the new features off.

## Comments

**Swap point from ticket 06 (owner ruling S2, 2026-09-03):** ticket 06's
residency takes its priority ORDER from a `ChunkPriority` interface
(ordered wanted chunks → protected set = the first `pages` of them; the
rest evictable oldest-first; admission gate = protected ∩ missing). 06
implements it as static chunk-index order; THIS ticket replaces that
ordering with the LOD traversal's wanted order (the spike's
`touchedList`), not the mechanism. AC4's pose-driven half (revisiting a
pose restores the same selection/residency) re-runs here.

**Owner rulings taken at ticket start (2026-09-12), six design stops + one
scope statement:**
- **H-FORK scope (confirmed assumption):** AC5's identity is judged on
  splat-lab's MONOLITHIC path, which the selection patch never touches. The
  paged mesh always carries the patch, so "features off" there means
  all-resident selected — never byte-identical binning. Recorded so
  H-FORK's meaning cannot drift.
- **S1 deselection = reserved last bin + public `instanceCount` cull.**
  Deselected splats (and empty capacity slots) sort into bin BIN_COUNT-1
  and the geometry's `instanceCount` is set to the selected count, so they
  never enter the vertex shader — a DECLARED DIVERGENCE FROM THE SPIKE
  (whose vertex-node cull produced degenerate quads), not from upstream:
  the vendored JS stays frozen and the bin function is data through the
  sort's own `setBinNode` door. Cost, stated: 4095 depth bins instead of
  4096 — negligible.
- **S2 projected-size threshold = derived from the camera each traversal**
  (`2·tan(fov/2) / renderHeight`, Spark's formula) × `lodRenderScale`, a
  constructor option defaulting to 1, the null value. Ticket 13's knob.
- **S3 splat budget = constructor option, starting value Spark's desktop
  2,500,000** (ADR 0003's "starting values, to be retuned" consequence);
  mobile classes recorded UNPINNED alongside 06-S1's memory-class debt.
  B (no cap) rejected on Phase 0's own 743 ms p95 drag cost at 2.5M.
- **S4 foveation weights = options with Spark's defaults** (behind 0.2,
  cone 90°→120°, cone weight 0.4), cited to the same ADR consequence.
- **S5 re-traversal hysteresis = the vendored sort's own motion thresholds**
  (`SORT_POSITION_THRESHOLD` 0.0025, `SORT_DIRECTION_THRESHOLD` 0.9995),
  mirrored constants inventoried in FORK.md like BIN_COUNT. Grounds: the
  same question the vendored code already answers (has the camera moved
  enough to matter), zero new numbers, traversal and sort re-trigger in
  step. If a drill shows visible pop before re-traversal, that is evidence
  for a design stop — never a silent retune.
- **S6:** full-pool refusal of a wanted chunk stands as 06 built it
  (retried on the next traversal); no new decision.
- Carried in: the WebGL2 O(pages²) load cost stays a NAMED OPTIMIZATION
  ITEM — ticket 13's H-LOAD evidence decides; not fixed here.

**Build (2026-09-12).** New: `src/backend/LodTraversal.ts` (grok-4.6 from
the frozen spec `.collab-logs/t07-spec.md` — the spike's traversal half
promoted verbatim behind a `ResidencyView` interface; verified line by
line against `spikes/native-rad/src/PagePool.ts`), `src/vendor/three-gs/
patches/selection.ts` (fork patch 2 — see FORK.md `[selection]`).
Edited: `ThreeGsBackend` (LOD driver in the paged mesh's pre-render hook:
object-space hysteresis on the vendored sort's mirrored thresholds,
selection writes for changed slots, draw count, priority swap +
`refreshPriority`, wanted-resident LRU touch (spike fidelity), admission
of wanted-but-missing cached chunks with one shared promise per chunk,
selection-change invalidation; frustum culling through
`frustumCulled = true` + the draw geometry's bounding sphere over the
resident AABB union inflated by the vendored kernel's 2-sigma footprint;
`pagerDiagnostics.lod` counters/controls; `counts().selected` = last
render's draw count clamped to residency), `paged.ts` (`setSelection`,
`setDrawCount`, `beforeRender`, sphere sync; dead position mirror
removed), `RadPager.hasCached`, `PagePool` untouched (the ordering swaps
in through `ChunkPriority` exactly as 06-S2 recorded), `examples/pager-lab/`
(grok-4.6 added the seven ticket-07 assertions from
`.collab-logs/t07-fixture-spec.md` after composer-2.5 failed to
authenticate — a Cursor CLI login expiry, coordinator-side, not a lane
failure; the coordinator then fixed convergence waiting, drill ordering
and criteria on the artifact).

**Interpretation recorded — culling mechanism:** doc 03 §F says the backend
"culls via `visible` from pager AABBs" and tags the item `[public-api]`.
A `visible=false` mesh gets no `onBeforeRender`, so the LOD driver could
never run to un-cull it; three's own per-frame frustum test
(`frustumCulled = true` against `geometry.boundingSphere` x matrixWorld —
Renderer.js ~3132) is the public-API form of the same intent, takes its
volume from the pager's resident-page AABB union, and un-culls by itself.
Both halves of AC4 are drilled (content equal with culling off; the mesh
culled with the camera outside the resident sphere facing away, no
traversal while culled, exact restore). If the letter of `visible` is
wanted instead, it is a one-line change plus a sentinel object.

**Observed properties (evidence, not defects):**
- Convergence is a chain: each admitted page re-traverses and may want the
  next; at `?pages=32` a fresh load converges in ~3.7-4.4 s with 11-20
  residency swaps after the load settles (the fixture prints
  `pager-lab CONVERGENCE spins=... elapsedMs=... residencyChanges=...`).
  Before the wanted-resident LRU touch was promoted from the spike the
  fixed point was 719,275 selected; with it 722,695; after the
  drawing-buffer-height fix (S2's formula uses physical pixels, DPR 1.25
  on this display) 786,819 — each deterministic across fresh loads for its
  code version. At 122 pages the frontier binds on the 2.5M splat budget
  exactly as Phase 0 recorded (`selected=2500000`, full quality).
  Traversal ~300-350 ms at 32 pages, ~1.26-1.29 s at 122 pages, on the
  main thread inside `onBeforeRender` (Phase 0 named item 1 — move to a
  worker — stands, now with 122-page numbers).
- Index-order protection before the first traversal (06-S2's fallback)
  decodes chunks 0..pages-1 that the sparse frontier then partly evicts —
  the source of the initial churn above (adversarial F6). Recorded as a
  candidate for a design stop (protect only the root before the first
  traversal vs. the current fallback) — ticket 13 has the numbers.
- The GPU counting sort's within-bin order is nondeterministic (06
  evidence); every pixel comparison in the fixture therefore measures a
  sort-only control band per run and, on WebGPU, RECORDS pixel bands while
  judging the deterministic content (selection counts, residency, slots);
  on the WebGL2 CPU sort pixel criteria are strict (band 0). A criterion of
  the form "5-sample noise max <= another 5-sample noise max" is a coin
  flip and was removed wherever it had crept in (doc 05 criterion 4).

**Adversarial review round (gpt5.6-sol, effort=high, read-only;
`.collab-logs/codex-review-t07.md`; every finding re-verified in source):
9 findings — 7 fixed, 1 recorded, 1 doc fix.**
- F1 HIGH CONFIRMED (fixed): `invalidateAll` zeroed the baseline, so slots
  WHOLLY deselected after a selection-off pass were reported unchanged and
  kept GPU lanes at 1 -> `assumeAllSelected()` sets the baseline to exactly
  what the off path wrote (1 for occupied rows), so the next diff rewrites
  every slot that differs. This was also the cause of the fixture's
  earlier pixel outliers (22 / 132 diffs).
- F2 LOW CONFIRMED (fixed): `slot << 16` is a signed shift — pageCount is
  refused above 0x7fff (`lod-page-count`), far beyond any device limit.
- F3 MED CONFIRMED (fixed): `counts().selected` clamped to residency
  (draw count is render-latched; residency can shrink between renders).
- F4 HIGH CONFIRMED (fixed): hysteresis compared the camera's WORLD pose
  while the traversal uses mesh-object space -> a moving mesh/parent never
  re-traversed; the comparison now uses the object-space pose.
- F5 MED CONFIRMED (fixed): S2's pixel term used CSS pixels; Spark's
  `renderSize` is `getDrawingBufferSize` — switched (changes the selected
  count at DPR != 1, recorded above).
- F6 MED CONFIRMED (recorded, see observed properties): index-order
  fallback churn.
- F7 HIGH CONFIRMED (fixed): the culling sphere covered centers only; a
  center just outside the frustum with a footprint overlapping it would be
  culled -> sphere inflated by 2 x the largest resident scale (the vendored
  kernel's r^2 > 4 cutoff = 2 sigma; FORK.md inventories the derivation).
- F8 MED CONFIRMED (fixed): criterion 10's drill never required a VISIBLE
  change — a live probe (WebGPU, 122 pages, band 9-16) measured render
  scale 4 -> diff 18, 16 -> 24, 64 -> 62, 256 -> 72, 1024 -> 65; the drill
  now uses scale 64 and requires the frame change to exceed the band.
- F9 LOW CONFIRMED (fixed): FORK.md's `[paged]` text still said selection
  was not promoted.

**Built-in /code-review round (high; two finder agents + coordinator
verification): 8 candidates — 3 fixed, 1 REFUTED, 4 recorded.**
- Dead per-page position-mirror copy in `paged.ts` (the [selection] CPU
  sort reads the center storage array) — CONFIRMED, removed; FORK.md
  inventory updated.
- `TraversalPriority` holder indirection — CONFIRMED, removed (the priority
  object goes straight into PagePool).
- REFUTED: "`invalidateSlot` leaves stale bits in the OTHER double buffer"
  — every path that sets a nonzero flag also sets that buffer's `written`
  bit for the slot (`traverse`, `invalidateSlot`, `assumeAllSelected`),
  and `traverse` clears exactly the slots whose `written` bit is set
  before reuse, so flags != 0 => written = 1 holds in both buffers and no
  stale nonzero flag can survive a swap.
- Recorded: `selectedCount`/`drawCount` both exposed (equal whenever
  selection is on; distinct only on the off path); `admitChunk` now
  resolves false for a not-cached chunk instead of rejecting (the S3
  boolean contract — intentional); the evict drill's resident list is
  captured once (selection is off, no residency drift); hot-path costs
  per traversal (`refreshPriority` O(chunks), `admissibleMissing`
  allocation, `maxResidentScale` O(pages)) — trivial next to the 300 ms+
  traversal; ticket 13 measures.

**Fixture evidence — final code, one run at a time, the owner's Chrome 152
via Claude-in-Chrome (WebGPU = RTX 3090 Ti; WebGL2 = `?webgl=1`), quoted
from `examples/pager-lab/`; `pager-lab: 26 passed, 0 failed` in ALL FOUR
regimes.** The seven ticket-07 assertions plus the 19 ticket-06 ones
(adjusted where LOD changes their meaning: residency follows the frontier;
`selected` is the frontier; the 06 evict/re-admit machinery drill runs
with selection off so the driver cannot heal it mid-drill).

WebGPU, `?pages=32`:
- `selection-active: selectedCount=786819 residentSplats=2097152
  fullQuality=false traversals=29 lastTraversalMs=269.7 wantedChunks.length=70
  stats={"expanded":603146,"leaves":758086,"heapPushes":603359,"heapMax":74643}`
- AC1 `selected-count-deterministic-5-trials: counts=[786819,786819,786819,
  786819,786819] cameraUnchanged=true`
- AC2 `pixel-stable-5-trials: per-trial max diffs vs trial 1=[0,5,4,9,5] →
  trial band=9; sort-only control band=6; selection identical across
  trials=true (WebGPU: band RECORDED — strict pixel stability unachievable
  by the vendored GPU sort's design)`
- AC3 / criterion 10 `selection-change-updates-draw-order-motionless:
  lodRenderScale 1→64→1: selected 786819 → 53712 → 786819 (restore
  converged in 324 ms, 0 residency changes); sort re-dispatched 2×; frame
  changed by 53 (> band 6 = visible) and returned to within 5`
- AC4 `culling-off-restores-content: maxDiff=0 … frustumCulled=false` ·
  `culling-culls-when-away: camera parked at z=3303 facing away:
  near-background=true, traversals before=41 after=41 (a culled mesh gets
  no onBeforeRender); restored exactly=true restore max diff=0`
- 06-AC4 pose half `pose-revisit-restores-selection: S0=786819
  selectedAtPose2=777906 selectedAfterReturn=786819 residentChunksAtPose2=32
  residentChunksAtReturn=32 … converged pose2=true return=true maxDiff=5
  sortBand=6 (pixel band RECORDED, selection judged)`
- `residency-within-budget: residentPages=32/32; wanted=70, protected=32 all
  resident=true; cached-not-resident=90 unavailable=0 refused=0 → accounted
  122/122` · `automatic-eviction-oldest-unprotected: full-pool admit(1)
  refused=true; evict(83)=true; admit(1) took slot 16=true; re-admit(83)=true
  evicted 1=true into slot 16=true` · `selection-off-draws-all-resident:
  off drawCount=2097152 … restored drawCount=786819` · `evict-readmit-
  pixel-identical: evicted [0,27] … evicted max diff=38 (above band 6);
  re-admit max diff=3` · H-LIFE ×10 exactly `storage 10/209747968B` with
  the SH band live · `no-unhandled-rejections: 0`.

WebGPU, default (122 pages):
- `selection-active: selectedCount=2500000 residentSplats=7935358
  fullQuality=true traversals=59 lastTraversalMs=1297 wantedChunks.length=122
  stats={"expanded":1889195,"leaves":2123103,"heapPushes":2251845,
  "heapMax":384827}` — the frontier binds on the 2.5M budget exactly as
  Phase 0 recorded.
- AC1 counts `[2500000 ×5]`; AC2 `diffs [0,6,8,6,11] → band 11; control
  band 6` (recorded); AC3 `2500000 → 107750 → 2500000 … frame changed by
  61 (> band 6) … within 6`; AC4 `culling-off maxDiff=0` / `culls-when-away
  traversals 71→71, restore diff 0`; H-LIFE ×10 exactly `storage
  10/799571968B`; `dispose-main-restores-baseline0` to zero.

WebGL2 fallback, `?pages=32` — STRICT (deterministic CPU sort):
- `selection-active: selectedCount=786819 … traversals=19 lastTraversalMs=
  338.7 wantedChunks.length=70` (same frontier as WebGPU — the traversal is
  backend-independent, H-LOAD criterion 3 across backends).
- AC1 `[786819 ×5]`; AC2 `diffs [0,0,0,0,0] → band 0; control band 0`;
  AC3 `786819 → 53712 → 786819 … frame changed by 170 (> band 0) …
  returned to within 0`; AC4 `culling-off maxDiff=0` / `culls-when-away
  traversals 31→31, restore diff 0`; pose half `maxDiff=0 (strict)`;
  `evict-readmit … re-admit max diff=0 (exact)`; H-LIFE ×10 exactly
  `textures 52/173801472B`; automatic eviction into slot 4.

WebGL2 fallback, default (122 pages): `pager-lab: 26 passed, 0 failed` — `selection-active: selectedCount=2500000 residentSplats=7935358 fullQuality=true traversals=39 lastTraversalMs=1543.7 wantedChunks.length=122` (same frontier as WebGPU); AC1 `[2500000 ×5]`; AC2 `diffs [0,0,0,0,0] → band 0` (strict); AC3 `2500000 → 107750 → 2500000 … frame changed by 157 (> band 0) … returned to within 0`; AC4 `culling-off maxDiff=0` / `culls-when-away traversals 51→51, restore diff 0`; `evict-readmit … re-admit max diff=0 (exact)`; H-LIFE ×10 exactly `textures 50/645398528B`; `dispose-main-restores-baseline0` = baseline + metered capture leak; `no-unhandled-rejections: 0`. WebGL2 full-budget loads stay slow (the 06 O(pages²) item, carried per the owner's ruling).

**Gate:** `npm run check:full` EXIT=0 on the final tree
(`.collab-logs/gate-t07-run3.log`): embed 216,527 B (unchanged — the LOD
driver is not in the embed entry), 159 modules / 482 deps cruised, crate
7/7 incl. golden. Vendored digests byte-identical (no .js touched). H-FORK
scope: splat-lab (monolithic path) `28 passed, 0 failed` on WebGL2 with
the pinned pixel values, unchanged by this ticket. rad-lab untouched.

**Status change: done — all five ACs met on BOTH backends in BOTH regimes
(2026-09-12).** Named items carried to ticket 13: main-thread traversal
cost (300 ms / 1.3 s), initial-protection churn (F6), WebGL2 O(pages²)
load (from 06). Open for ticket 12: `pagerDiagnostics.lod` is the counter
door §G rewires.
