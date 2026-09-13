# Handoff 007 — Phase 2 pager chain COMPLETE (05/06/07); next: TICKET 08

2026-09-12. Written for a COLD session with no memory of this one. Goal of the
next session: **TICKET 08 — §A5 load/reveal/ready contract into the untouched
SplatSiteElement** (.scratch/phase-2-backend/issues/08-a5-contract-
splatsiteelement.md), runnable without re-deriving anything. Ticket 08 starts
on the owner's explicit go, not on this document. Handoff 006 remains the
record for tickets 03/04; handoff 005 for 01/02.

## STATE

| What | Commit(s) |
|---|---|
| Tickets 01–04 | per handoffs 005/006 (`d9022b6` … `c58c0d2`) |
| Ticket 05: RadPager fetch + 4-worker decode pool | `906a5b1` |
| Ticket 06: page residency (budget, priority-protected eviction, partial uploads, invalidations, paged `load("rad")`) | `986d9b7` + `26e4c30` (WebGPU evidence + sort-band drill) |
| Ticket 07: LOD traversal, selection, culling (fork patch 2) | `cf4a680` |

**The pager chain 05→06→07 is COMPLETE.** Frontier: **08 next** (owner-named),
10 (D22 CameraSystem micro) also unlocked; then 09 (needs 01/04/08), 11 and
12 (need 07/09), 13 (needs 11/12). One ticket at a time; unlocked ≠
authorized.

**Vendored digests still byte-identical to the ticket-02 baseline**
(`0da00b78…` GaussianSplatMesh.js · `e9e90b69…` CountingSort.js ·
`f65f9222…` GaussianSplatUtils.js; full hashes in FORK.md). Two fork
patches live as PURE .ts siblings under `src/vendor/three-gs/patches/`
(D20): `[dispose]`+`[capacity-guard]` (04), `[paged]` (06), `[selection]`
(07). Every internal surface each reaches is inventoried in FORK.md.

## WHAT NOW EXISTS (paths + contracts)

**Fetch + decode (ticket 05), `src/backend/`:**
- `RadHeader.ts` — `parseRadHeader`/`readRadHeaderEnd`; named refusals
  (`rad-bad-magic`, `rad-header-short`, `rad-unsupported-version/type`,
  `rad-chunk-count-mismatch`, `rad-header-invalid`). FORMAT.md
  (`spikes/native-rad/FORMAT.md`) stays the byte authority.
- `RadFetcher.ts` — prefetch-all Range requests; **206-or-die**: a 200 =
  whole-load `range-unsupported` (aborts every in-flight request);
  `MAX_ATTEMPTS = 3` IMMEDIATE (no backoff timer — Chrome's hidden-tab
  throttling; count anchored to `@smithy/core` 3.33.3 `DEFAULT_MAX_ATTEMPTS`,
  verified from the npm artifact); taxonomy: network/5xx/short-body retry,
  other non-206 terminal per chunk (`range-rejected`), decode errors
  terminal per chunk (deterministic bytes); `fetchImpl` is a TEST-ONLY
  seam. Header fetch loops remainder ranges until headerEnd.
- `DecodePool.ts` — `DECODE_POOL_SIZE = 4` (doc 03 A3 ← Spark
  `SplatWorker.ts:100`), one job per worker, bytes transferred in/out;
  worker-level failure (WASM init or a trap → `fatal` reply) BREAKS the
  pool (no self-heal; `broken` getter); `jobLimit` = asset chunk count.
- `RadPager.ts` — `load(hooks)` with `onHeader` / `admit` (admission gate)
  / `onChunk` / `onDeferred` / `onUnavailable`; **resolves with a shortfall
  report, never rejects for per-chunk failures**; rejects only whole-load
  (`range-unsupported`, `fetch-aborted`, header errors, pool failure);
  raw-byte cache of every landed chunk (06-S4; Phase 0 item 3 open);
  `decodeCached(index)` re-decodes; `hasCached`; live `progress` terms.
- `rad-worker.ts` gained `decodeStart`/`decodeEnd` epoch timestamps and the
  `fatal` flag (init failure / `WebAssembly.RuntimeError`). Crate
  `rad-three/src/lib.rs`: chunk-header arithmetic is CHECKED (a wasm32
  wrap-to-panic found by review; native test + browser drill).

**Residency (ticket 06):**
- `src/backend/PagePool.ts` — ADR 0003 budget `pages = min(P_limits,
  P_asset, override)`; priority-protected eviction: protected = first
  `pages` of `ChunkPriority.order()`, unprotected residents evict
  oldest-touched first; `insert/evict/touch`, per-page AABBs,
  `firstUploadedCount` (monotone, never residency). **`ChunkPriority` is the
  swap point — 07's traversal order is plugged in (`TraversalPriority` in
  ThreeGsBackend; index order only until the first traversal).**
- `src/vendor/three-gs/patches/paged.ts` `[paged]` — fixed capacity from a
  ZERO source geometry (unmodified constructor allocates at capacity; a
  zero row renders nothing); `uploadPage` writes storage arrays +
  `addUpdateRange` (partial path asserted race-free per render;
  `uploadPath` = partial | pbo-texture (WebGL2, by design) |
  full-fallback); `clearPage`; `invalidate()` resets `_sortInitialized` /
  `_sphericalHarmonicsInitialized`; `setBounds` keeps BOTH
  `splatGeometry.boundingSphere` (sort depth range) and the DRAW geometry's
  sphere (three's frustum test); `setSelection(slot, flags)` writes the
  `center.w` lane; `setDrawCount(n)` = `geometry.instanceCount`;
  `beforeRender` hook runs BEFORE the vendored onBeforeRender; `afterRender`
  flips ready.
- `ThreeGsBackend.ts` paged path — `load({url:*.rad})` needs
  `createDecodeWorker` (refusal `rad-needs-worker-factory`) and the
  renderer; options `pageBudgetOverride` (the `?pages=N` regime),
  `fetchImpl` (test-only), `lod` (07). Ready = first paint AFTER the first
  page with splats; **`no-pages-available`** when a settled load uploaded
  zero splats (06-S6); progress fraction = equal-weight mean of bytes /
  decoded / first-uploaded (06-S5; rises after ready; reveal thresholds are
  08's). `pagerDiagnostics(handle)` = the counter door (not the seam):
  budget, residency, upload path, `isResident/isCached/slotOf`,
  `evictChunk/admitChunk`, `lod.{…}` — ticket 12 owns its final shape.

**LOD (ticket 07):**
- `src/backend/LodTraversal.ts` — spike traversal promoted verbatim behind
  `ResidencyView`; `DEFAULT_LOD_TUNING` = Spark starting values via ADR
  0003's consequence (07-S3/S4): `maxSplats 2_500_000` (Spark desktop
  `defaultSplatTarget`), `lodScale 1`, `behindFoveate 0.2`, `coneFov0 90`,
  `coneFov 120`, `coneFoveate 0.4`; node size = encoder formula
  (`splat_encode.rs:480-491`); pageSize must be 65536 (paged index
  `slot<<16|local`), pageCount ≤ 0x7fff; `assumeAllSelected()` /
  `invalidateAll()` baselines; `maxResidentScale()` for the culling margin.
- `src/vendor/three-gs/patches/selection.ts` `[selection]` —
  `installSelectionSort(mesh)`: disposes the constructor's four compute
  nodes, rebuilds via the sort's own `setBinNode` door with w<0.5 →
  reserved bin `BIN_COUNT-1` (4095 depth bins — stated cost), replaces
  `_sortCPU` ON THE INSTANCE for WebGL2; mirrored constants
  `SORT_BIN_COUNT 4096`, `SORT_POSITION_THRESHOLD 0.0025`,
  `SORT_DIRECTION_THRESHOLD 0.9995` (GaussianSplatMesh.js:47-50). Declared
  divergence from the SPIKE (vertex-node cull) — never from upstream.
- Driver (`ThreeGsBackend.driveLod`, in `beforeRender`): pixelScaleLimit =
  `2·tan(fov/2)/drawingBufferHeight × lodRenderScale` (07-S2; Spark's
  `getDrawingBufferSize`); re-traverse when dirty or the camera moved past
  the mirrored sort thresholds measured in MESH-OBJECT space; writes
  changed slots, `setDrawCount(selected)`, priority swap +
  `refreshPriority`, `pool.touch` for wanted residents (spike fidelity),
  admissions of wanted-but-missing cached chunks (≤ pool size, ONE shared
  promise per chunk), `invalidate()`. Culling: `mesh.frustumCulled = true`
  + resident AABB sphere inflated by 2 × max resident scale (vendored
  kernel `r² > 4` cutoff). `counts().selected` = last render's draw count
  clamped to residency.

**Fixtures (dev server, `/@fs` hero; hero-dependent, gate-portable):**
- `examples/rad-lab/` **19/19** — Range-only (exact per-chunk ranges),
  4 workers concurrent (worker-side timestamps), pool-4 vs pool-1 SHA-256
  identical ×1098 arrays, chunk-0 golden, injected failure taxonomy,
  206-or-die drills, wasm32 crafted-header drill, broken-worker fail-fast,
  no unhandled rejections.
- `examples/pager-lab/` **26/26 × four regimes** (WebGPU/WebGL2 × default
  122 pages / `?pages=32`): budget derivation, residency = frontier's
  protected set (accounted 122/122 via `isCached`), motionless arrival
  visible, invalidation shown (sort+SH counters), progress monotone, partial
  path hit (pbo-texture on WebGL2), evict/re-admit (selection off) within
  band, selection-active, 5-trial deterministic count (786,819 at 32 pages
  on BOTH backends; 2,500,000 at 122 = the budget binds), 5-trial pixel
  band recorded (strict 0 on WebGL2), criterion 10 at render scale 64
  (frame changed 53–170 > band, exact selection restored), culling-off
  equality + culls-when-away (camera outside the resident sphere, no
  onBeforeRender while culled, exact restore), pose-revisit (32 pages:
  same selection back, strict pixels on WebGL2), selection-off draws all
  resident, H-LIFE ×10 exactly flat with SH live, no-pages-available,
  automatic oldest-unprotected eviction, no unhandled rejections.
- `examples/splat-lab/` **28/28** — the monolithic path; H-FORK identity
  is judged HERE (owner scope ruling 2026-09-12): the paged mesh always
  carries both patches, "features off" there = all-resident selected.

## TICKET 08 ENTRY BRIEF

- **Pin-copies**: `SplatSiteElement`, `FragmentRouter`, `register` (the
  R2-deferred Phase 1 embed set, doc 04:23) come in **byte-identical from
  sparkjs commit `fd67153` via `git show fd67153:<path> > <dest>`** — never
  from disk; hash the DESTINATION. `diagWiring.stub` rides ticket 09.
- **The A5 contract rides on 06's paged path**: `whenReady` (paint-observed
  after the first page), `progress()` (three-term mean, monotone by
  construction, rises after ready), `onReady` / `onLoadProgress` with
  sparkjs-IDENTICAL shapes — ticket 03's monolithic readiness is the other
  path of ONE contract; no duplicate definitions. The rebuilt
  **SplatLoader is owned here**, over the seam only (the `rad` handle needs
  `createDecodeWorker` — the embed passes `decode.ts`'s inline factory,
  pages a URL-constructed worker; the inline-worker cruiser rules bind).
- **Reveal thresholds were explicitly deferred to 08 by the 06-S5 ruling**
  (fraction keeps rising after ready by design). Any threshold constant is a
  rule-11 design stop with options + evidence + recommendation.
- **MUST BE SETTLED HERE — the all-unavailable seam question**, deferred
  from **05-S3** (the pager RESOLVES with a shortfall report even when every
  chunk is unavailable) through 06 (`no-pages-available` fails a handle
  that uploaded zero splats): what a PARTIAL shortfall means for reveal /
  `onReady` (reveal with truthful counts? a named degraded state? the
  reveal policy line). Cite 05-S3 in the ruling.
- The Y-down hero: the 180° X-flip is SiteConfig's CONDITIONAL
  `eulerRotationDeg` behaviour (docs/plan/results/phase-0.md:27 trap;
  ticket 09's layer) — the backend hands the object over UNROTATED; the
  fixtures apply it. Do not "fix" an upside-down hero in 08.

## EVIDENCE STANDARDS now in force

- **Sort-band method**: the GPU counting sort's within-bin order is
  nondeterministic (1–17 channel units at fixed points). Every pixel
  comparison measures a SORT-ONLY control band per run (force
  `_sortInitialized=false`, render, capture, ×5); on WebGPU pixel bands are
  RECORDED and the deterministic content (counts, residency, slots) is
  judged; on WebGL2 (CPU sort) criteria are STRICT — band must be 0. Never
  compare one 5-sample noise max against another (a coin flip).
- **One fixture regime at a time**: four concurrent hero loads produced
  WebGPU readback timeouts and repeated "WebGL Device Lost", after which the
  harness pane refused any WebGL context until the app restarted.
- **WebGPU evidence via the connected Chrome (Claude-in-Chrome) path**; the
  harness pane's Chromium may have no adapter — probe
  `navigator.gpu.requestAdapter()` on a real page (a `chrome-error://` page
  reads null) and read `scene3.backend` before quoting anything.
- Fixture waits are TIME-bounded (`WAIT_BOUND_MS` = 10 × the measured cold
  load) and timer-free (MessageChannel); LOD convergence = no admission in
  flight + residency and selection unchanged across three samples.
- `npm run check:full` TRUE exit (redirect to file, echo $?); embed-size
  tripwire inside `check` (216,527 B vs 262,144 bound).

## CARRIED NUMBERS for ticket 13 (verbatim)

- Traversal on the main thread inside `onBeforeRender`: **~300 ms at 32
  pages, ~1.3 s at 122 pages** (1.54 s on the WebGL2 run) — doc 02's
  move-traversal-to-a-worker pointer, Phase 0 named item 1.
- Index-order protection before the first traversal (06-S2 fallback)
  decodes chunks 0..pages-1 that the sparse frontier then partly evicts:
  **11–20 page swaps and ~3.7–4.6 s settling** per fresh load at
  `?pages=32` (fixture prints `pager-lab CONVERGENCE …`). Candidate design
  stop: protect only the root before the first traversal.
- WebGL2 full-budget load is **O(pages²)** (full-capacity CPU sort +
  whole-texture PBO re-upload per page arrival): 32 pages ≈ 2 s, 122 pages
  ≈ 30–55 s. Owner-ruled deferred; 13's H-LOAD decides.
- Also: raw-byte cache = full asset in the JS heap (Phase 0 item 3;
  re-fetch is its likely answer); convergence fixed points changed with
  code (719,275 → 722,695 → 786,819 at DPR 1.25) — deterministic per
  version, history-dependent in principle.

## TRAPS (005/006's carry forward — vacuous-assertion check, sibling-fix
## question both ways, grep-can't-answer-math, cwd persistence, wasm-pack
## hooks, ties-to-even, hidden-pane visibilityState, timer throttling,
## capture-leak metering, counter blind spots, swallowed in-place writes,
## TRUE-exit discipline — plus this chain's)

1. **Hysteresis spaces must match the consumer**: the driver compared the
   camera's WORLD pose while the traversal runs in mesh-object space — a
   moving mesh/parent would never have re-traversed (review-found).
2. **Culling spheres cover FOOTPRINTS, not centers** (inflate by the
   kernel's 2σ × max scale) or culling changes content.
3. **A hidden mesh never gets the pre-render hook that would un-hide it** —
   why culling reads `frustumCulled` at the public API, not `visible`.
4. **Selection lanes written behind the traversal's back need a baseline
   reset** (`assumeAllSelected`) or wholly-deselected slots keep w=1 — this
   was the source of "random" pixel outliers before it was found.
5. **A drill the system can heal is blind**: with selection on, an evicted
   wanted page is re-admitted before the capture — run eviction drills with
   selection off, and pick drill chunks from the RESIDENT set.
6. **Composer / cursor-agent login has LAPSED** (`Error: Authentication
   required. Please run 'agent login'`); running cursor's login restores
   the lane. grok-4.6 carried both build lanes cleanly meanwhile
   (`--prompt-file`, frozen spec, artifact-verified). Park
   `.claude/settings.local.json` during any cursor-agent dispatch.
7. **agent-collaboration is v2 (2026-09-06)** — no per-dispatch CHANGELOG
   counter (history under `docs/history/pre-v2/`); dispatch outcomes go in
   the ticket; read `operations.md` + `registry.json` before dispatching.
8. Heredocs with long quoted text broke twice in the harness bash — write
   patch scripts to the scratchpad and run the file.

## PROCESS RULES (unchanged from 006)

- The OWNER commits — zero delegation on session start; per-run scoped
  grants only (staged list shown first, stop on any stray). Commit messages
  carry NO credit / co-author lines, whatever any harness template says
  (owner's standing rule 6).
- One ticket at a time; each start is an explicit owner go. Rule-11 stops:
  options + evidence + recommendation, never a pick (this chain's stops:
  05 S1–S6, 06 S1–S7, 07 S1–S6 — all in the tickets and PLAN `## decisions`).
- Review order after green: adversarial FIRST (gpt5.6-sol at HIGH,
  read-fenced, prompt + material in `.collab-logs/`), THEN built-in
  /code-review; reported separately; EVERY finding re-verified with real
  commands — confirm or refute, never absorb.
- No time estimates, ever. Git explained in plain English to the owner.
- sparkjs-toolkit PERMANENTLY read-only; vintage `fd67153` via
  `git show fd67153:<path> > dest`, never disk; hash the destination.
- D:\tmp is never a scratchpad. Derived numbers only — every constant traces
  to a spec, a vendored mirror, or an ADR-0003-cited Spark starting value.

## WIDER CONTEXT (one line each)

- Decision ledger: doc 06 (D14/D16/D18/D20/D21/D23/D24) + tickets 05/06/07
  Comments + PLAN.md `## decisions` (2026-09-02/03/12 rulings).
- Doc 03 §F fork list: `[dispose]`, `[capacity-guard]`, `[paged]`,
  `[selection]` landed; EditLayer (§C), optics (§D), maxPixelRadius (§D)
  remain; the spike's four titles are all promoted.
- Watch item 13: three pinned 0.185.1; r186 ships SPZLoader + the
  GaussianSplat rename — SPZ gap and FORK.md re-diff hang on it.
- `.claude/launch.json` machine-local (toolkit-dev, port 5173, strictPort);
  never kill 5173 if sparkjs dev holds it.
- Open task chips: decode-lab renders green on runner crash;
  examples/shared extraction (assert harness, xFrac, verdict CSS,
  yieldMacrotask, capture metering, the sort-band control); `pagerDiagnostics`
  carries residency mutators — 12 should make the door read-only.
- PLAN.md is a DERIVED VIEW — docs/plan/04-build-order.md sequences,
  .scratch/ tickets are the ledger; on conflict they win.
- Memory notes still accurate: challenge-arbitrary-constants,
  no-spark-comparison-metrics, adversarial-findings-are-claims,
  review-order-after-green, fixture-pins-vs-transients,
  browser-pane-webgpu-adapter, agent-collab-v2-no-dispatch-changelog.
