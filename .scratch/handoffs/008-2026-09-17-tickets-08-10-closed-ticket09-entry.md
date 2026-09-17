# Handoff 008 — Tickets 08 + 10 closed; next: TICKET 09 (SiteRuntime re-typing + the embed set)

2026-09-17. Written for a COLD session with no memory of this one. Goal of the
next session: **TICKET 09** (`.scratch/phase-2-backend/issues/09-siteruntime-
retyping.md`) — the big one. Ticket 09 starts on the owner's explicit go, not
on this document. Handoff 007 remains the record for tickets 05–07; 006 for
03/04; 005 for 01/02.

## STATE

| What | Commit(s) |
|---|---|
| Tickets 01–07 | per handoffs 005/006/007 (`d9022b6` … `cf4a680`) |
| Ticket 08: §A5 load/reveal/ready contract in the rebuilt SplatLoader | `06fe819` + `cd46e05` (targeted astra-review follow-up, comment-only) + `84154b9` (asymmetry ruling restated by path) |
| Ticket 10: D22 second half — CameraSystem dead fields | `9892799` |

**Frontier:** 09 (unblocked: 01, 04, 08 done). 11 and 12 need 07 + 09; 13 needs
11 + 12. One ticket at a time; unlocked ≠ authorized.

**Vendored digests unchanged** since ticket 02 (`0da00b78…` GaussianSplatMesh.js
· `e9e90b69…` CountingSort.js · `f65f9222…` GaussianSplatUtils.js; FORK.md).

## WHAT NOW EXISTS (paths + contracts)

**Loader (ticket 08), `src/core/SplatLoader.ts`:** `loadSplat(options):
SplatHandle` — pin option names kept, `backend` added (doc 06 D25); holds the
ONE reveal/progress policy (reveal = seam's paint-observed ready on both load
paths; `onProgress` = true completed-work fraction, strictly increasing, < 1,
then exactly one 1 immediately before `onLoad`; `onError` before or after
reveal, never followed by `onLoad`, includes dispose-before-reveal
`handle-disposed`); S5 contradiction warning computed BEFORE `backend.load()`;
pin 180° flip / quaternion / position / scale applied to `handle.object`;
`loadSplatAsync` refuses by name (`load-splat-async-refused`) and is NOT
barrel-exported (D19 precedent). Barrel exports `loadSplat` + `SplatLoadOptions`.

**Seam growth (ticket 08), `src/backend/SplatBackend.ts`:** `SplatSource` gains
optional `onProgress(LoadProgress)` / `onFailure(SplatBackendError)` observers
(doc 02 resolution note 2026-09-16; no new METHOD); `formatFromName` is the one
extension rule. `ThreeGsBackend`: every progress write routes through
`setProgress`; `fail()` notifies failed-phase progress → rejects → `onFailure`;
observers isolated with `reportError`; a decode pool broken AFTER settle fails
the handle (`decode-worker-error`); `markUnavailable` is the single site a
chunk joins the unavailable list — ONE warning at settle for the shortfall,
plus one named warning per chunk given up on after settle; re-admission
`decode-dispatch-failed` / `decode-protocol-error` mark the chunk unavailable
(load-pipeline decodes keep ticket 05's whole-load fail-fast — DESIGNED, by path).

**Camera (ticket 10), `src/core/CameraSystem.ts`:** `CameraSystemConfig.renderer`
(now OPTIONAL) and `.sparkRenderer` kept `@deprecated` and ignored (H-API
compile-unchanged); `scene` is assigned-never-read here — a doc 06 D22 Phase 3
item for the `backend.raycast()` decision.

**Fixtures (dev server; hero via `/@fs`):**
- `examples/loader-lab/` **31/31** × WebGPU/WebGL2 × default/`?pages=32` — reveal
  at seam ready, true fraction then one 1, eviction mid-load never un-reveals,
  shortfall reveals + one warning, all-unavailable fails by name, failure after
  reveal reaches onError, pool break after settle, post-settle given-up chunks
  (decode / dispatch / protocol) each one named warning, scripted-seam policy
  drills, S5 warnings, loadSplat shape.
- `examples/camera-lab/` **6/6** × WebGPU/WebGL2 — pre-edit baseline digests
  WebGPU `444a093d…e659`, WebGL2 `bc514b23…e764` reproduced exactly after the
  ticket-10 edit (camera numbers + 270 pixel samples).
- `examples/splat-lab/` 28/28 and `examples/pager-lab/` 26/26 re-run on the
  ticket-08 code (both backends).

## TICKET 09 ENTRY BRIEF

**Scope (the ticket's ACs, including what moved in):**
1. SiteRuntime re-typed at the pin (`fd67153:src/embed/SiteRuntime.ts`, 4,494
   lines): registration through the seam (`loadSplat`, handles), teardown through
   `backend.dispose(handle)` (pin teardown disposes each `entry.mesh.dispose()`
   in `dispose()`), the D24 rename (`SparkScene` → `ThreeSplatScene`). A real
   site.json drives load, navigation, teardown on both backends; H-LIFE at
   runtime scope (04→09 edge: dispose).
2. Latent semantic changes proven with runtime cases + passing controls
   (spec.md): (a) `normalizeSiteConfig` THROWS on an authored
   `annotation-<id>-copy` block id; (b) RuleModel THROWS on duplicate
   show-blocks effects; (c) authored `lifetime` runs for real (01→09 edge:
   DisplayChannel at the pin).
3. H-API consumer fixture compiles against both toolkits; records
   `SparkScene` → `ThreeSplatScene` as the expected D24 divergence.
4. Pin-copies byte-identical via `git show fd67153:<path> > <dest>`, hashed on
   the DESTINATION: `src/embed/diagWiring.stub.ts`, `SplatSiteElement.ts`,
   `FragmentRouter.ts`, `register.ts` (the last three MOVED from 08 by ruling
   08-S0).
5. The element's event sequence + payload shapes on a fixture site.json match
   sparkjs's on the same file, both backends — sparkjs side from a pinned-file
   snapshot of `fd67153` exported to a scratch dir (e.g. `git archive`),
   sparkjs untouched (moved from 08).
6. The embed build's entry switches to `src/embed/register.ts`; measure; then
   STOP — the OWNER sets the new size bound (`scripts/check-embed-size.mjs`:
   BOUND 262,144 B; "Raising the bound requires an owner ruling recorded in the
   ticket that raises it"). Today's embed = the decode-only scaffold
   (`vite.embed.config.ts` entry `src/backend/embed-entry.ts`, 216,527 B); D14
   (WASM inline, variant A) governs the product embed.

**Open questions the 09 session must bring to the owner as design stops
(rule 11 — none is settled by the ticket; all verified against the pin
2026-09-17):**
- **diagWiring chicken-and-egg:** SiteRuntime imports `wireLoadTelemetry` +
  `SiteTelemetryOptions` from `./diagWiring` (pin :70, used :2341-2346, :2389,
  :2518, :2602, :3409, :4297). The pinned `diagWiring.stub.ts` (25 lines)
  TYPE-imports `LoadTelemetryHandle` / `WireLoadTelemetryInput` from
  `./diagWiring` — so a byte-identical stub cannot typecheck without the real
  `diagWiring.ts` (624 lines, spark-type), whose §G rewire is ticket 12, which
  is blocked by 09. The same structure as 08-S0.
- **SiteRuntime's other absent imports:** `interact/SplatHighlight` (pin :71;
  constructed :3192, `setItems` :3225, `update` :3403, `dispose` :4325 — Phase 3
  §C edits) and `core/SplatBounds` (`computeSplatBounds` :98, used :3763 on a
  SplatMesh — ticket 11, which is blocked by 09).
- **SparkScene-only members** (doc 06 D24 lists them): `.spark` (CameraSystem
  literal `sparkRenderer: sparkScene.spark` :900 — the FIELD stays accepted per
  ticket 10, but the member does not exist on ThreeSplatScene; rail optics
  `applyRailOptics` :888 writes Spark's focalDistance/apertureAngle — the seam's
  `setOptics` is a named refusal until Phase 5; telemetry `renderer:
  sparkScene.spark` :2392), `.registerPagedSplat` (:2386), `.throttleGate`
  (:3455, cleared :4299) — whose `lodStillRefining()` (:3436-3452) reads
  pager residency (resident < wanted) and whose `allVisible` flips at reveal.
- **The pin's reveal gate is NOT carried** (ruling S1, doc 06 D26):
  `checkSceneVisibility` (:2432-2606) is replaced by the loader's
  `onProgress` / `onLoad` / `onError`. The pin reports OVERALL progress as the
  slowest paged scene (:2583-2594) and settles ready when every scene is
  visible (:2596-2605) — how per-scene loader callbacks combine for a
  multi-scene site is not ruled.
- **S5 warning noise (carried from 08):** SiteRuntime passes
  `paged: def.paged ?? false` (:2369, :2373), so every `.rad` scene omitting
  `paged` triggers the loader's contradiction warning — one noise review when
  the real site.json lands.
- **Author-mode picking** raycasts `sparkScene.scene.children` (:3507-3509);
  the seam's `raycast` is a named refusal until Phase 3 §B.

**Loader contract 09's runtime consumes — owner rulings carried VERBATIM from
ticket 08's Comments:**

- **S1 — reveal thresholds (deferred here by 06-S5): A, reveal = the seam's
  ready.** Report the true fraction until then, then exactly 1 once, monotone,
  never un-reveal. Grounds: doc 04's own Phase 2 text says the element
  "reveals progressively" — coarse-then-sharpen IS the stated intent; zero
  constants; one meaning of ready on both load paths; cannot hang under
  `?pages=32`, where the fraction tops out at 0.5082 (ticket 06 evidence — a
  fixed threshold above ~0.51 would never fire). The pin's 11-constant gate
  (`SiteRuntime.ts:2460-2476` + the 0.98 cap at `:2529`) is recorded in doc 06
  (D26) as the reference if a future PRODUCT decision wants the coarse moment
  hidden — that revisit needs its own evidence and ruling. REJECTED: B (load
  settled — a second ready moment; waits for all 213 MB under prefetch-all), C
  (traversal's wanted set — the pin's "pristine" in completed-work clothing;
  AC3), D (a tuned constant — no source).

- **S2 — partial shortfall (05-S3 → 06-S6): A.** A partial shortfall reveals
  normally with truthful counts and one console warning. The backend gap is
  fixed in the same stroke: a whole-load failure after first paint must reach
  the element as `loaderror` — `ThreeGsBackend.ts:742-761` currently flips
  phase to `failed` silently, the silent failure the named-refusal design
  forbids. No event-shape change, no doc 06 divergence. (The all-unavailable
  case stays 06-S6: `no-pages-available` fails the handle.) REJECTED: B (a
  degraded signal on the element — a divergence sparkjs has no equivalent of),
  C (shortfall-as-failure — needs an invented cutoff).

- **S3 — progress/failure notification: A, optional `onProgress` / `onFailure`
  callbacks on the load request** (`SplatSource`), plus `onError` on
  `SplatLoadOptions` for ticket 09's runtime. Evidence: the seam is pull-only —
  `progress()` returns a snapshot refreshed at fixed points
  (ThreeGsBackend.ts:699, :706, :731, :795, `fail()` at :277) and `whenReady`
  settles once, so a post-ready failure had no push path. Grounds: nothing
  polls, so it works in hidden tabs (the throttling trap, already priced); the
  fix sits at the exact site of the silent failure (`fail()`); no new seam
  METHOD — a request type growing is a doc 02 note, not an interface
  amendment. REJECTED: B (per-frame polling — hidden-tab failures would wait
  for tab focus, the throttling trap re-admitted by design, plus a per-frame
  check for the handle's whole life); C (a failure promise on the handle —
  violates the handle-shape ruling of 2026-08-29).

- **S4 — `loadSplatAsync`: A, refuses by name.** Evidence: the pin resolves
  on construction (`mesh.initialized`) and its one src caller, SceneComposer
  (`fd67153:src/core/SceneComposer.ts:102`), adds the mesh AFTER awaiting;
  this seam's ready is paint-observed and needs the object already in a
  rendered scene (SplatBackend.ts `whenReady` doc), so a promise handing over
  the handle only at reveal can never resolve. Its real semantics are settled
  by SceneComposer's own ticket (Phase 3), where an actual caller exists.
  REJECTED: B (resolve on construction — a second ready moment the seam does
  not define); C (a `parent` option — grows the options shape for a caller
  that does not exist yet).

- **S5 — `extSplats` / `lod` / `paged`: C, accepted; one named warning when a
  supplied value contradicts what the format decides** (`.rad` = paged + LOD;
  PLY = monolithic, no LOD; precision fixed). REJECTED: A (silently ignored —
  the silent behavior change the named-refusal philosophy forbids); B (refuse
  contradictions — would break every `.rad` site that omits `paged`, including
  the pin SiteRuntime's own default `paged: def.paged ?? false`
  (`SiteRuntime.ts:2373`), making the STANDARD case a refusal). **Carried to
  ticket 09:** when the real site.json lands, the warning's noise level gets
  one review — a warning that fires on every normal load is a broken warning.

- **Approved consequences of S1/S2:** `onLoad` = reveal on BOTH load paths —
  safe because the pin's SiteRuntime already ignored Spark's `onLoad` for
  paged meshes (`SiteRuntime.ts:2379-2381`, visibility set only
  `if (!entry.paged)`); a pre-reveal fraction of exactly 1 (PLY "constructing")
  is held back so the single 1 lands at reveal — monotone to exactly 1;
  `fileName` picks the format by extension (pin semantics); the backend prints
  the single shortfall warning, as the only layer holding the unavailable list.

- **F4 — A.** Keep the load-finish shortfall warning, and print one more NAMED
  warning each time a chunk is found unavailable after the load settled.
  Grounds: the S2 "one warning" ruling covered facts known at finish; a
  post-settle discovery is a new fact and the no-silent-failures rule says
  announce it; the count is bounded by the chunk count by construction (a
  given-up chunk is never retried). REJECTED: B (one warning per load — later
  shortfalls silent in the console), C (one warning at the first discovery —
  later ones silent).

- **Fold-in, same stroke:** the two rarer post-settle per-chunk worker-error
  paths recorded above (`decode-dispatch-failed`, `decode-protocol-error`)
  mark the chunk UNAVAILABLE, so it joins the list and F4-A's warning
  announces it — same silent-loss class, same fix shape, proven red first.

**Owner ruling (2026-09-17, restated — SUPERSEDES the "during load vs after settle" wording of the
asymmetry ruling above): the split is BY PATH, not by time.** Decode errors on the LOAD PIPELINE's
own decodes fail the whole load (ticket 05's pool-integrity fail-fast). Errors on a RE-ADMISSION
mark that one chunk unavailable whenever they happen, pre- or post-settle — folding into the
load-finish warning if the load is still running, announced by name if it has settled. Behaviour
stays exactly as built (commit 06fe819; comment corrected in cd46e05).

## EVIDENCE STANDARDS in force (007's, plus this session's)

- 007's carry forward: sort-band method on pixel drills; one fixture regime at a
  time; WebGPU adapter probed on a real page before quoting; TIME-bounded,
  timer-free waits; `npm run check:full` TRUE exit to a file.
- **Prove red first:** every new check is run against the unfixed code and
  shown to fail for its stated reason before the fix; mutation drills
  (break → red → restore from a byte backup, hash-verified) where a check's
  teeth are not otherwise shown.
- **Timing-independent drill preconditions:** pick targets from live state at
  drill time (not from what a load "usually" leaves); control the LOD driver
  with selection off rather than "no renders" (ThreeSplatScene's own animation
  loop renders); observe seam notifications by TAPPING them (pass-through
  backend), never by sampling between renders.
- **Synthetic input:** synthetic PointerEvents DO drive OrbitControls on Chrome
  152 (verified); a synthetic MouseEvent TRUNCATES clientX/clientY to integers —
  pin anything a click position depends on at integer page offsets.
- **Targeted reviews of partial diffs:** reconstruct the exact diff by
  reversing recorded patch-script string pairs; review material in
  `.collab-logs/`; hash all repo files before/after a read-only review.

## TRAPS (new this session)

1. **Python text-mode writes on Windows turn LF into CRLF.** `src/**` and
   `examples/**` are `-text` (bytes stored exactly), hand-written files there are
   LF, so a `write_text` patch produced whole-file churn (caught at staging;
   normalized in binary mode, gate re-run). Patch scripts: read/write BYTES.
   `src/core/CameraSystem.ts` is committed CRLF — edit with the Edit tool and
   check CR counts.
2. **Long heredocs break in the harness bash** (007 trap 8, hit again) — write
   scripts with the Write tool and run the file.
3. **A `grep -c $'\r$'` over `git show` output misreported line endings** —
   count raw CR bytes with `git cat-file blob <rev>:<path> | tr -cd '\r' | wc -c`.
4. **The toolkit-dev server died between sessions** (cause unknown) — check
   port 5173 before assuming a page failure is code.
5. **Sparse pixel grids can miss real motion** (camera-lab's 5×3 grid saw only
   the centre column) — assert that captures change when the pose changes.
6. **Anchoring an insert on a method's SIGNATURE lands the new member between the
   method's JSDoc and the method, so that JSDoc documents the new member** (review-found in
   08) — anchor inserts above the doc comment.

## PROCESS RULES

- **Reviewer selection: the agent-collaboration v2 registry's lane order governs**
  (`technical_review`: `astra-review` first — gpt-6-astra, high, codex exec
  read-only) — owner ruling 2026-09-17; a handoff never pins a reviewer. Read
  `registry.json` + `operations.md` fresh; probe the live Codex balance
  (`codex app-server` → `account/rateLimits/read`) and list codex processes
  before dispatch; confirm model/effort/sandbox from the run banner.
- Review order after green: adversarial FIRST, then built-in /code-review;
  reported separately; every finding re-verified with real commands.
- The OWNER commits — scoped per-run delegation only, staged list shown first,
  stop on any stray; commit messages carry NO credit/co-author lines (owner
  rule 6, whatever a harness template says).
- Rule-11 stops: options + evidence + recommendation, never a pick. No time
  estimates. Git explained in plain English. sparkjs-toolkit permanently
  read-only (pin `fd67153` via `git show`). D:\tmp never a scratchpad. Derived
  numbers only.

## WIDER CONTEXT (one line each)

- Decision ledger: doc 06 (D14/D16/D18/D20–D26) + tickets 05–08/10 Comments +
  PLAN.md `## decisions` (2026-09-13/16/17 rulings for 08 and 10).
- Ticket 08 moved AC1/AC2 + the embed-entry switch to 09 (ruling S0,
  2026-09-13); its commit message's "eight owner rulings" tally is loose — the
  ticket holds the exact list (owner: leave history as is).
- Ticket 10's D22 Phase 3 item: `CameraSystem.scene` — decide with
  `backend.raycast()` (doc 06 D22).
- 007's carried numbers for ticket 13 stand (traversal cost, index-order
  protection churn, WebGL2 O(pages²) load, raw-byte cache) — handoff 007.
- `examples/shared` extraction chip still open (assert harness, capture
  metering; loader-lab and camera-lab copy the harness again).
- `pagerDiagnostics` still carries residency mutators (`evictChunk`,
  `admitChunk`) — ticket 12 decides the door's final shape; loader-lab drills
  depend on them.
- Watch item 13: three pinned 0.185.1; r186 (SPZLoader, GaussianSplat rename)
  unpublished as last checked in handoff 007.
- Memory notes updated this session: review-order-after-green (registry-first
  reviewer); others as listed in handoff 007.
