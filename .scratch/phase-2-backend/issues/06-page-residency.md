# 06 — Page residency: budget, LRU, uploads, invalidations

**Status:** done
**Blocked by:** 05 — fetch + decode pool.

**What to build:** decoded pages become resident and visible under a device-classed
page budget with LRU eviction and partial-range buffer uploads. Owns the two
explicit invalidations review flagged as missing from every naive design — nothing
updates by itself: a page upload or selection change marks sort dirty
(`updateSort`), and SH is re-dispatched for pages arriving under a MOTIONLESS
camera. Owns completed-work progress (bytes fetched + pages decoded + pages
first-uploaded — monotonic by construction, NEVER residency).

Standing rules bind (spec.md). LOD selection is ticket 07 — in this slice
everything resident is shown.

- [x] Page budget derives from a device memory class at runtime and holds exactly
      at 32 under the `?pages=32` measurement regime; no allocation failure in
      either regime, both backends.
- [x] A page arriving under a motionless camera becomes visible, with sort and SH
      explicitly re-dispatched — the invalidation path shown, not assumed.
- [x] Progress is computed from completed work, monotonic through a full eviction
      cycle — sampled as a tripwire and satisfied by construction.
- [x] Revisiting the initial pose under `?pages=32` restores the same visible
      result (eviction correctness), both backends. (Owner ruling S3: THIS
      ticket proves the machinery half — evict, re-admit from cached bytes,
      pixels restored; the POSE-DRIVEN half re-runs in ticket 07 with the
      traversal.)

## Comments

**Inherited from ticket 05 (owner rulings 2026-09-02):**
- This ticket REPLACES the `rad-refused` named refusal in ThreeGsBackend
  with the real paged path (correction to handoff 006, recorded in ticket
  05's Comments) — the fetch+decode slice arrives as `RadPager` +
  `DecodePool` + `RadFetcher` from 05.
- **SH-degree dispose gap (ticket 04 F7 residual) lands HERE:** once a paged
  mesh with SH bands is uploaded, place the assertion — dispose with SH
  bands + contribution buffer live, union counters exactly back to baseline.
- Reveal-policy question deferred from 05: whether a load with EVERY chunk
  unavailable counts as failed at the seam (05's pager resolves with the
  shortfall report either way).
- **DecodePool contract for reuse (ticket 05 built-in review, 2026-09-02):**
  `pool.jobs` is unbounded evidence — bound or snapshot it before session-
  length re-decode reuse; a pool whose `broken` getter is non-null has
  terminated its workers and rejects every decode with that error — the
  owner recreates it (no self-heal by design). A worker `fatal` reply
  (WASM init failure or a trap) is a pool failure, never a page failure.
**Owner rulings taken at ticket start (2026-09-03), seven design stops:**
- **S1 budget = ADR 0003's formula exactly:** `pages = min(P_limits, P_asset,
  override)`; P_limits on WebGPU from the created device's
  `maxStorageBufferBindingSize`/`maxBufferSize` through the ticket-04
  capacity guard (single limit check), on WebGL2 from `MAX_TEXTURE_SIZE`
  via the PBO page formula. The "device memory class" term stays RECORDED
  AS UNPINNED — its debt is mobile-class measurement data, not a divisor
  guess (B rejected on the standing rule against invented constants).
- **S2 eviction/admission = static chunk-index priority behind the SAME
  INTERFACE ticket 07's traversal will implement** (protect the first
  `pages` chunks of the priority order; unprotected residents evict
  oldest-first; chunks outside the protected set are fetched and cached but
  NOT decoded until admitted — the spike's admissibility gate). The
  ordering is the swap point (recorded in ticket 07): 07 replaces an
  ordering, not a mechanism. B (arrival-order LRU + decode-all) rejected:
  90 wasted decodes and residency decided by network timing.
- **S3 AC4 in this slice = the machinery proof:** under `?pages=32` evict a
  page, re-admit the same chunk from cached bytes, pixel readback at the
  pinned pose EXACTLY equal to the first render. The pose-driven half
  (revisiting a pose restores the same selection) RE-RUNS IN 07 — a
  deferred half-AC, stated in the AC text.
- **S4 re-decode source = cached raw bytes** (spike-proven). Phase 0
  optimization item 3 (the 213 MB heap residency of the raw cache) stays
  OPEN and cited; B (re-fetch the range on demand through the retry
  taxonomy) is the likely eventual answer for item 3 — adjacency noted.
- **S5 progress fraction = equal-weight mean of the three spec-named
  completed-work ratios** (bytes fetched / all chunk bytes, chunks decoded
  / chunks, pages first-uploaded / chunks). Grounds: the null weighting is
  the only non-invented choice, and it is the only reading that uses all
  three named terms. Each ratio is monotone by construction, so the mean
  is. Phase: fetching until the header parses; constructing until the
  first paint; ready after — fraction keeps rising after ready (correct and
  documented; reveal thresholds are ticket 08's).
- **S6 all-unavailable at the seam:** a load that completes with ZERO
  chunks ever uploaded FAILS the handle as `no-pages-available` (a mesh
  with no pages paints empty and would report ready — the exact silent
  blank the seam was designed against). Partial shortfall stays ready with
  truthful counts/progress.
- **S7 DecodePool job-log bound = the asset's chunk count**, derived from
  the header (set by the pager).
- **Assumptions approved:** the backend hands the object over UNROTATED —
  the 180° X-flip is SiteConfig's conditional `eulerRotationDeg` behavior
  (docs/plan/results/phase-0.md:27 trap; ticket 09's scope); the fixture
  applies it and cites the trap. The fixture reuses splat-lab's timer-free
  machinery and gates H-LIFE on the union counters with the hero's SH band
  live (the ticket-04 residual, re-assigned via 05).

**Build (2026-09-03).** New: `src/vendor/three-gs/patches/paged.ts` (the
`[paged]` sibling patch — fixed capacity from a zero geometry, page uploads
through the storage attributes with partial ranges, explicit invalidation,
race-free partial-path assertion; FORK.md entry inventories every internal
reached), `src/backend/PagePool.ts` (grok-4.6 from the frozen spec —
promoted from the spike minus traversal; verified line by line),
`examples/pager-lab/` (composer-2.5 from the spec; two defects fixed on
the artifact diff: counting wrappers dropped the renderer/camera args, and
the no-pages drill's 404 threshold let chunk 0 through — the hero's header
is 8,128 B; plus the PBO-aware partial-path assertion and an elapsed-time
wait guard). Edited: `RadPager` (load hooks: onHeader / admission gate /
onDeferred; raw-byte cache + `decodeCached`; live `progress`), `DecodePool`
(`jobLimit`), `ThreeGsBackend` (paged path, budget derivation,
`pagerDiagnostics` door, `createDecodeWorker` / `pageBudgetOverride` /
`fetchImpl` options), barrel, vite input. Spec + agent logs:
`.collab-logs/t06-*`.

**Vendored-mesh facts the patch rests on (verified in source this
session):** the constructor sizes every buffer from the source geometry's
`position` count; `_sortCPU` (WebGL2) reads `_positionAttribute` (the
source position array — kept as the CPU mirror); the WebGPU sort reads the
`centerRead` storage node on the GPU; `updateSort`/`updateSphericalHarmonics`
gate on `_sortInitialized`/`_sphericalHarmonicsInitialized`; three 0.185.1's
`setupPBO` texture layout is width = 2^ceil(log2(sqrt(n))), height =
ceil(n/width) — the ADR 0003 WebGL2 page formula, byte for byte; both
backends' `updateAttribute` consume `updateRanges` and clear them.

**Fixture evidence — WebGL2 fallback (`?webgl=1`), quoted from the page:**

Default regime: `pager-lab: 16 passed, 0 failed`.
- `budget-derived: budget={"pages":122,"pLimits":122,"pAsset":122,
  "override":null,"source":"device limit (MAX_TEXTURE_SIZE 16384)",
  "backend":"webgl2-fallback"}` — P_limits = P_asset = 122 on this GPU.
- `no-allocation-failure: phase=ready … loaded={… textures=6
  texturesSize=639631360}` (six PBO textures, 640 MB).
- `residency-within-budget: residentPages=122/122 deferred=0 unavailable=0
  refused=0`.
- `motionless-camera-visible: cameraUnchanged=true p11=[100,86,83,255]`.
- `invalidation-shown: backend=webgl2-fallback evict sort=1 sh=0; admit
  sort=1 sh=0` (SH is vertex-evaluated on the fallback — no compute
  dispatch by design; the WebGPU run must show sh≥1).
- `progress-monotonic: terms={"bytes":1,"decoded":1,"uploaded":1}
  fractionAtReady=0.360655737704918 finalFraction=1 samples=1085`.
- `partial-upload-path-hit: uploadPath=pbo-texture pushed=0 consumed=0
  pboUploads=610` — the recorded fallback characteristic: storage is read
  through PBO textures, whole-texture re-upload per page (5 attributes × 122
  pages = 610), no buffer ranges exist to consume.
- `counts-and-bounds: total=7935358 resident=7935358 selected=7935358
  bounds min=(-477.02,-316.60,-230.57) max=(197.60,154.84,476.12)`.
- `evict-readmit-pixel-identical: slot0=3 slotAfter=3` (all 10 sample
  points equal after evict → re-admit from cached bytes; the grid DID change
  while evicted).
- `dispose-cycles-gpu-flat-with-sh` ×3: after-dispose union counters exactly
  pre + metered capture delta each cycle (`textures 14/640679936B` = the
  main handle's 6 + capture leak 8); SH band live in every cycle (textures
  +6 per load). `heap-not-strictly-increasing: heaps=[2340432262,
  2553459319,2358002375]`. A first run's 3-sample series
  [2074653895, 2121572367, 2559515275] was strictly increasing; a 6-cycle
  console experiment at the full budget read 1646 → 1711 → 1073 MB after
  successive disposes (then the gate's wasm rebuild reloaded the page) —
  GC lag on ~1 GB loads, not retention; the fixture's 3-sample structural
  check stays as written (ticket 04's criterion) with this note.
- `dispose-main-restores-baseline0` (textures 8/1048576 = baseline0 +
  capture leak exactly), `disposed-handle-unknown`,
  `no-pages-available: whenReady rejects SplatBackendError(no-pages-
  available), phase=failed`, `no-unhandled-rejections: 0`.
- Load time in this regime: 29.4 s and 54.7 s (two runs, cold/warm disk) —
  the WebGL2 fallback re-runs the CPU counting sort over all 8M capacity
  slots on every invalidation (122 uploads × ~8M-entry sort). Recorded as
  fallback cost; the WebGPU path sorts on the GPU.

`?pages=32` regime: `pager-lab: 16 passed, 0 failed`.
- `budget-derived: {"pages":32,"pLimits":122,"pAsset":122,"override":32,
  "source":"override (32)"}` — holds exactly at 32.
- `residency-within-budget: residentPages=32/32 deferred=90 unavailable=0
  refused=0` (the 90 chunks outside the protected set were fetched and
  cached, never decoded — the admission gate).
- `progress-monotonic: terms={"bytes":1,"decoded":0.2623,"uploaded":0.2623}
  fractionAtReady=0.3607 finalFraction=0.5082 samples=1201` — exactly
  (1 + 32/122 + 32/122)/3; rises after ready; never decreases through the
  eviction regime.
- `counts-and-bounds: … resident=2097152` (32 × 65,536);
  `evict-readmit-pixel-identical: slot0=3 slotAfter=3`;
  `dispose-cycles-gpu-flat-with-sh` ×3 flat (`textures 14/168820736B`),
  heaps [947552456, 918751944, 871246052]; load 2.15 s; the rest as above.

**Named optimization item (ADR 0001: misses become items) — WebGL2
fallback load is O(pages²):** every page arrival invalidates, and on the
fallback the next render re-runs the CPU counting sort over the FULL
capacity (the vendored sort's count is fixed at construction) and
re-uploads every PBO texture WHOLE (`texSubImage2D` full width/height;
~640 MB at 122 pages); page arrivals (~250–450 ms apart) each get a render,
so the coalescing the flags allow never engages. 32 pages → 2.15 s; 122
pages → 29–55 s (3.8× pages, 13–25× time). Levers: invalidation cadence
during the constructing phase (a constant → owner stop), or a fork-side
sort over resident count / partial texture regions. Not changed in this
ticket; the WebGPU path sorts on the GPU with partial buffer ranges.

**Recorded for ticket 07/12 (built-in review):** `pagerDiagnostics` is a
counter door that also carries the two residency mutators
(`evictChunk`/`admitChunk`) — 07 should expose residency mutation as its
own surface and leave the door read-only; `refreshPriority()` is
O(chunks) per call with a fresh `order()` array — fine per load, revisit
before per-frame use.

**WebGPU runs (2026-09-12, the owner's real Chrome 152 via Claude-in-Chrome,
RTX 3090 Ti; `scene3.backend === "webgpu"` read from the page):** the
2026-09-03 blocker (no adapter in the harness pane) is cleared. On first
try the pixel drill failed by 9 and 2 channel units at two grid points.
Diagnosed, not tuned: a CONTROL of five plain re-renders with no mutation
was pixel-exact, a control of five re-SORTS alone (no eviction) moved the
same points by 1–11 — the GPU counting sort's within-bin order is
nondeterministic (doc 05 H-LOAD criterion 4's recorded mechanism; the
WebGL2 CPU sort is exact). The fixture now measures that band ITSELF each
run (sort-only control, five re-sorts) and requires the evict → re-admit
diff to lie inside it, evicts chunks in index order until the change
exceeds the band (at full residency one chunk moved 6 against a band of
13 — invisible), and asserts residency, not slot identity (multi-chunk
re-admits land in a permutation of the freed slots by design). A batch of
four concurrent fixture runs across two browsers hit the shared capture
helper's 5 s readback timeout on WebGPU; run one at a time they pass.

Default regime (122 pages): `pager-lab: 18 passed, 0 failed` —
`budget-derived: {"pages":122,"pLimits":122,"pAsset":122,"override":null,
"source":"device limit (bind 128 MiB / buf 256 MiB)","backend":"webgpu"}`
· `no-allocation-failure: … storageAttributes=10 storageAttributesSize=
799571968` · `invalidation-shown: backend=webgpu evict sort=1 sh=1; admit
sort=1 sh=1` (SH compute re-dispatched under the motionless camera) ·
`partial-upload-path-hit: uploadPath=partial pushed=610 consumed=605` ·
`evict-readmit-pixel-identical: evicted 4 chunk(s) [0,1,2,3], all resident
again=true (0 in their original slot); sort-only control band=7 over 5
re-sorts; evicted max diff=9 (above band); re-admit max diff=3 [p00=3,
p10=2] — within the measured band` · `dispose-cycles-gpu-flat-with-sh` ×10
exactly `storage 10/799571968B, textures 0/0B` (the ten storage
attributes: 4 vec4 + SH1 band + SH contribution + the sort's four) ·
heaps oscillating 2.30–2.71 GB · `dispose-main-restores-baseline0` to true
zero · `no-unhandled-rejections: 0`.

`?pages=32`: `pager-lab: 18 passed, 0 failed` — budget holds at 32
(`source":"override (32)"`), `residentPages=32/32 deferred=90`,
progress `(1 + 32/122 + 32/122)/3 = 0.5082` rising from 0.3607 at ready,
`partial pushed=160 consumed=155`, `evict-readmit-pixel-identical: evicted
1 chunk(s) [0] … band=1 … evicted max diff=60 … re-admit max diff=1
[p22=1] — within the measured band`, `automatic-eviction-oldest-
unprotected` full-pool refusal / freed slot / evict-into-slot all true,
H-LIFE ×10 flat at `storage 10/209747968B`, `no-unhandled-rejections: 0`.

WebGL2 fallback on the same final fixture code (2026-09-12, the owner's
Chrome 152 via `?webgl=1` — the harness pane's Chromium disabled WebGL for
the session after repeated "WebGL Device Lost" events under GPU pressure
from concurrent runs; `isContextLost() === true`, then `getContext` null):
default regime `18 passed, 0 failed` — `budget … "device limit
(MAX_TEXTURE_SIZE 16384)"`, `uploadPath=pbo-texture pboUploads=610`,
`evict-readmit-pixel-identical: evicted 1 chunk(s) [0] … band=0 …
evicted max diff=4 (above band); re-admit max diff=0 (exact)`, H-LIFE ×10
exactly `textures 24/641990656B` (main handle 6 + the shared capture
module's metered timeout leak), heaps oscillating 2.76–6.15 GB, `no-
unhandled-rejections: 0`; `?pages=32` `18 passed, 0 failed` — `evicted
max diff=50 … re-admit max diff=0 (exact)`, `automatic-eviction-oldest-
unprotected` all true, H-LIFE ×10 flat at `textures 24/170131456B`.
One WebGL2 default attempt in a tab that had just carried a 2.3 GB
WebGPU run hit `THREE.WebGLProgram: Shader Error 0 - VALIDATE_STATUS
false` then "WebGL Device Lost" right after load (nothing drew); a fresh
tab passed 18/18 — recorded as GPU-process pressure, not reproduced.
Fixture runs are ONE AT A TIME from here: four concurrent runs hit the
shared capture helper's 5 s WebGPU readback timeout and the pane's context
loss. Gate `npm run check:full` EXIT=0 on the final tree
(`.collab-logs/gate-t06-run4.log`; embed 216,527 B).

**Status change: done — all four ACs met on BOTH backends in BOTH regimes
(WebGL2 2026-09-03/12, WebGPU 2026-09-12; evidence above). AC4's
pose-driven half re-runs in ticket 07 per ruling S3.**
