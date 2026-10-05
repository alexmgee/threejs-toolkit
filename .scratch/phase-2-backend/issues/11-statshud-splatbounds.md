# 11 — StatsHUD + SplatBounds fed from backend counters

**Status:** done
**Blocked by:** 07 — LOD/selection (selected counts exist); 09 — SiteRuntime
(the consumers run in the real runtime).

**What to build:** the on-screen stats and the scene's reported bounds tell the
truth about a streaming scene — total/resident/selected counts and
resident-aware bounds. Owner ruling: percentile clamping stays Phase 4 (doc
04:144); bounds here are verified against ground truth, not smoothed.

Standing rules bind (spec.md).

- [x] StatsHUD's numbers track an independent read of the pager's public counters
      across a load + eviction cycle, both backends.
- [x] `bounds()` on a partially resident hero equals the independent union of the
      resident pages' extents at each sampled moment (bounds may legitimately
      EXPAND as outlying pages arrive — no "tightens" assumption).
- [x] No consumer reaches past the seam for any counter (boundary lint green).

## Comments

**Order check at start (owner-requested, 2026-09-17).** Doc 04 sets no order inside Phase 2; the
spec's ticket map does: `11 (07, 09) · 12 (07, 09) · 13 (11, 12)`, and each ticket's Blocked-by
line matches it. Tickets 01–10 are `done`, so 11 and 12 are both unlocked and independent: the pin's
StatsHUD and SplatBounds import no diagnostics code, and the seam already carries `counts()` and
`bounds()` (`SplatBackend.ts:100-101`, implemented `ThreeGsBackend.ts:1411`, `:1428`). 13 waits on
both. PLAN.md's derived view agrees.

**Inherited and binding (owner, 2026-09-17):** SplatBounds is a DELETE-AND-REPLACE of the D30 stub;
StatsHUD and SplatBounds are copied at pin `fd67153` via `git show` and re-typed onto backend
counters — `counts()` and `bounds()` are the seam's only truth; bounds are tested against the
independent resident-page union (they legitimately EXPAND as outlying pages arrive, never
"tighten"); percentile clamping stays Phase 4 (doc 04:144); the two barrel names return per Stop 13's
deferred list.

**Facts found at start.** Pin `computeSplatBounds(mesh: SplatMesh, {targetSamples = 1000, world =
true, padFraction = 0.05})` SAMPLES every Nth centre, transforms each by `matrixWorld`, pads 5% of the
size, returns `null` with no readable splats (`fd67153:src/core/SplatBounds.ts`). Pin
`new StatsHUD({container, spark: SparkRenderer, splats?: SplatMesh | SplatMesh[], updateRate?,
visible?, position?})` prints `fps | drawn | lod-sel | src | trav | sort/lod | fetch`, every field but
fps read from Spark internals (`fd67153:src/core/StatsHUD.ts`). Pin callers: StatsHUD only in
`examples/all/main.ts:136` and `examples/path/main.ts:80` (`{ container, spark: sparkScene.spark,
splats: [splat] }`); `computeSplatBounds` in `examples/text-lab/main.ts:385` (`onLoad: (loaded) =>
computeSplatBounds(loaded)`, camera framing) and SiteRuntime's `sphereFromObject` (unreachable until
Phase 4, D30). Ours: the seam's `bounds()` is an OBJECT-space box of CENTRES — paged: the union of the
resident pages' extents (`PagePool.residentBounds`, each page's exact per-point box computed at insert,
centres not retained); PLY: exact per-point box of the positions; it refuses by name before
construction and with no page resident. `counts()` = `{ total, resident, selected }` (paged selected =
the last render's draw count, clamped to resident). `loadSplat`'s `onLoad` hands over the HANDLE, not
the backend. No lint rule covers counter consumers (`vendor-seam-only` guards vendor imports only).
The RAD header carries the total and per-chunk `count`s.

**Stop agenda — six points the sources leave open (owner rulings requested before any building):**
- **A — how `computeSplatBounds` reaches the seam.** `bounds(handle)` needs the backend AND the handle;
  the pin passes one mesh; doc 02's resolution note rejected an `objectOf()` method. Options: A1
  `computeSplatBounds(backend, handle, options?)` — explicit, no new surface, pin-style one-argument
  calls fail to compile (D24's loud edit); A2 keep `(mesh: Object3D, options?)` resolved through an
  object→(backend, handle) registry filled at load — pin call shape kept, hidden module state added;
  A3 accept both forms. Recommendation: A1.
- **B — world-space exactness.** Doc 03 says "exact world AABB computed per-point (never
  `Box3.applyMatrix4` — 8-corner only)"; with `bounds()` the only truth, a world box can only be the
  8-corner transform of the object-space box — exact for axis-aligned transforms (the loader's 180° X
  flip, translation, scale), a conservative SUPERSET under arbitrary rotation. Options: B1 8-corner,
  documented as conservative, doc 03's clause amended to match; B2 grow the seam to expose per-page
  boxes (tighter, still not per-point); B3 object-space only (changes the pin's `world = true`
  default). Recommendation: B1.
- **C — the pin's options under the seam.** `targetSamples` has no meaning once bounds are the exact
  resident union; `padFraction` (5%) compensated sampling undershoot. Options: C1 keep
  `SplatBoundsOptions` verbatim — `targetSamples` `@deprecated` and ignored (D22's precedent),
  `padFraction` default kept for consumer parity; C2 drop `targetSamples`; C3 default the pad to 0.
  Recommendation: C1.
- **D — StatsHUD's config and line.** Options: D1 `{ container, backend, handles?, updateRate?,
  visible?, position? }` and the line `fps | drawn: <selected> | resident: <resident> | src: <total>`
  summed over handles, the Spark-only fields (trav, sort/lod, fetch) dropped; D2 keep the names `spark`
  / `splats` re-typed to backend / handles (D28-style); D3 keep them `@deprecated` and add new ones.
  Recommendation: D1 (every call site is edited anyway — the argument types change).
- **E — AC3's lint rule scope.** A lint rule sees imports, not property reads. Options: E1 narrow —
  StatsHUD.ts and SplatBounds.ts may import only `SplatBackend.ts` from `src/backend/`; E2 broad — no
  `src/` file outside `src/backend/` imports backend internals; the door is `SplatBackend.ts`,
  `ThreeGsBackend.ts`, `decode.ts`, `decode-url.ts`, `index.ts` (today's imports already comply;
  examples stay open per D23 (a)), citing doc 02 design rule 2 extended by an amendment.
  Recommendation: E2.
- **F — text-lab's placeholder obstacle.** `examples/text-lab/main.ts:391` promises "Phase 2 swaps in
  loadSplat + computeSplatBounds"; no Phase 2 ticket owns it — the same class of gap as ticket 09's
  `diagWiring.ts`. Options: F1 this ticket performs the swap (the pin's canonical consumer); F2 record
  the gap and assign it elsewhere; F3 retire the promise (the placeholder stays, its comment
  corrected). Recommendation: F1 only if you want a second consumer proof here; otherwise F2.

**Fixture plan (stated assumptions, not stops):** one new lab page on the hero in the eviction regime,
both backends. AC2 — at sampled moments during load and around `evictChunk` / `admitChunk`, the
fixture decodes each resident chunk ITSELF (its own fetch + its own decode worker) and compares the
exact union of those centres to `bounds()`, with expansion allowed. AC1 — StatsHUD's displayed total
and resident against the RAD header's total and the sum of per-chunk header counts over resident
chunks; `selected` against `counts()` read at the same instant (the draw count has no other public
source). AC3 — the new lint rule, proven red on a planted internal import.

**Owner rulings on the stop agenda (2026-09-18).**
- **A — A1:** `computeSplatBounds(backend, handle, options?)`. Explicit, and the old one-argument
  call fails loudly at compile time (D24's principle). A2's hidden registry rejected as global mutable
  state wearing a convenience costume.
- **B — B1:** the world box is the 8-corner transform of the seam's box, documented; doc 03 amended
  with grounds — the "never 8-corner" line assumed per-point access; the seam-as-sole-truth ruling
  supersedes the mechanism while keeping the intent: exact where transforms are axis-aligned (the
  loader's actual flip / translate / scale), a CONSERVATIVE, never-smaller box under arbitrary rotation
  (the safe direction for camera framing). Revisit trigger recorded in the amendment: if
  arbitrarily-rotated splat scenes become real usage, B2's per-page seam growth is the recorded path,
  owned by whichever phase brings that usage.
- **C — C1:** `SplatBoundsOptions` unchanged; `targetSamples` `@deprecated` and ignored (D22
  precedent); the pad default kept — the pin's callers keep compiling and the pad's meaning survives
  although its original justification (sampling undershoot) died.
- **D — D1:** the honest config `{ container, backend, handles?, updateRate?, visible?, position? }`
  and the line `fps | drawn | resident | src`; a doc 06 entry records the field deletions (the
  Spark-only trav / sort / fetch fields) with the D15 caveat that consuming sites are unsurveyed — the
  same class as D24, a loud break with a one-line fix.
- **E — E2:** backend internals are reachable only through the five named doors (`SplatBackend.ts`,
  `ThreeGsBackend.ts`, `decode.ts`, `decode-url.ts`, `index.ts`); examples exempt per D23; doc 02 design
  rule 2 amended in place with a dated note. Proven both ways: a planted internal import from `src/`
  fails naming the rule; today's tree passes; the E1-narrow case (StatsHUD importing an internal) is
  covered by construction.
- **F — F1 (upgraded from the recommended F2):** this ticket swaps the text-lab placeholder —
  `computeSplatBounds` lands here, and its one real pin consumer pattern (camera framing) proves the A1
  signature serves an actual caller; a second consumer for free, a dangling promise retired; neither
  12 nor 13 is a build home for it. Cost accepted: text-lab re-runs on both backends.
- **Fixture plan approved as stated**, with one addition: AC1's `selected` check against `counts()` at
  the same instant is honest but self-referential — the drill's comment states that limit (the draw
  count has no independent public source; the check pins consistency, not truth). AC2's independent
  fetch + decode union is the real spine; AC3 red-first as planned.

**Fact-finding round (2026-09-18; read-only workflow — five slice readers + a completeness critic,
Claude subagents; both repos verified unchanged afterwards: our tree only the two record edits, sparkjs
`git status` / HEAD `fd67153` / `node_modules/.vite` metadata identical). Load-bearing claims re-verified
by Claude with direct reads:**
- `isSplatMesh` is set nowhere (src, examples, `node_modules/three/src`); the vendored mesh sets
  `isGaussianSplatMesh` (`GaussianSplatMesh.js:121`). `sphereFromObject` has two callers:
  `SiteRuntime.ts:3808` (a prop's glTF root) and `:3822` (a world-text surface — a PlaneLane quad; a
  splat-text block never yields one, the D19 stub throwing in mount). The branch is dead twice over.
- The pin's text-lab obstacle is `const OB_SPLAT_URL = "/examples/assets/moss.spz"` (pin `:337`) —
  refused on the spot here (`spz-refused`).
- `dispose()` deletes the handle's entry (`ThreeGsBackend.ts:1475`), so `counts()` / `bounds()` on a
  disposed handle throw `unknown-handle`.
- The hero's header, read through the dev server and hand-parsed: `magic 0x30444152, headerLength
  8120; count 7935358, chunkSize 65536, chunks 122; per-chunk keys base,bytes,count,offset — count and
  base present on all 122` (the derived `min(chunkSize, total − i·chunkSize)` sums to the same
  total, last chunk 5,502). A reader's doubt, raised from the pinned writer's source, is refuted for
  this asset.
- Doc 05:142-143: "Divergences allowed only via doc 06 entries" — so A1's signature change needs an
  entry too, beside ruling D1's.
- **Corrections to this ticket's own record above:** the pin has THREE StatsHUD callers
  (`examples/main.ts:116` was missed — my pathspec skipped top-level examples); and AC2's comparison is
  EXACT EQUALITY at each sampled moment — the resident union grows as outlying pages arrive and
  SHRINKS on eviction (`PagePool.residentBounds` after `evictChunk`), so the drill asserts no monotonic
  direction at all (what "no 'tightens' assumption" means; "expansion allowed" above meant the same).
- Settled by the rulings, not stops: both modules type their `backend` as the `SplatBackend`
  INTERFACE (so `pagerDiagnostics`, reachable through the `ThreeGsBackend.ts` door, is invisible to the
  type checker), and the E2 rule comment and doc 02 note state that residual as HONEST SCOPE (a lint
  sees imports, not property reads); the world box refreshes ancestors with
  `handle.object.updateWorldMatrix(true, false)` (the pin's `updateMatrixWorld(true)` does not);
  doc 06 gets D32 (StatsHUD, ruling D1) and D33 (`computeSplatBounds`, rulings A1/B1/C1, required by
  doc 05); the AC1 fixture parses the header with its own code, not `parseRadHeader`.
- Noticed, not touched: doc 06's D23 heading still says `OPEN (2026-08-20)` though spec.md:85 records
  its ruling; the `GLOSSARY.md` named in this repo's CLAUDE.md does not exist.

**Second stop agenda (owner rulings requested before building):**
- **S1 — SiteRuntime's call site under A1.** `computeSplatBounds(child)` (`SiteRuntime.ts:3710`)
  stops compiling. Options: E1 delete the dead branch and its import (`:3705-3713`, `:107`), the
  obligation to re-add splat-text framing with a real handle source recorded for Phase 4 (D19 / D33);
  E3 map the child to a `loadedScenes` handle (targets site scene groups the pin never framed; still
  unreachable); E4 test `isGaussianSplatMesh` and map through `child.parent` (leans on the group-holds-
  mesh structure, not contract). Recommendation: E1.
- **S2 — `computeSplatBounds` when the seam refuses.** Options: (a) `bounds-before-construct` and
  `no-resident-pages` → the pin's `null` ("no readable splat data yet"), `unknown-handle` propagates
  (a caller bug), an empty box → null; (b) every refusal propagates, return type `Box3` (contract
  change, in D33); (c) null for `no-resident-pages` only. Recommendation: (a).
- **S3 — text-lab's asset (the pin's `moss.spz` is refused).** Options: (a) `moss.ply` via `/@fs` — the
  pin's scene, ~170 MB, SH3, the first large or SH3 monolithic load here (cost and behaviour unmeasured);
  (b) the hero `.rad` via `/@fs` — proven on both backends, paged; framing once at `onLoad` as the pin
  does frames the first resident union; the pin's `quaternion: [1, 0, 0, 0]` is exactly the loader's
  180° X flip, so it is kept; (c) the 48-splat `fixture.ply` — cheap, not a real scene.
  Recommendation: (b). Text-lab has no PASS/FAIL harness; proposed pass criterion with any option: after
  reveal, the dev hook shows `bounds` non-null and equal to `computeSplatBounds(backend, handle)`, the
  camera framed at `distance = size.length()`, and the obstacle projection carving the text lines — on
  both backends.
- **S4 (smaller) — prove B1 in the lab too?** AC2 tests `bounds()`, not `computeSplatBounds`. Add:
  under the loader's flip, `computeSplatBounds(…, { padFraction: 0 })` equals the fixture's own world
  box of the decoded centres; under a non-axis rotation it is never smaller. Recommendation: yes.
- **S5 (smaller) — HUD number format.** Keep the pin's `(n/1000).toFixed(0)K` (AC1 then compares at
  1K resolution, which resolves any whole-chunk error — residency moves in 65,536-splat chunks or the
  5,502 tail) or print exact integers (a further divergence, into D32). Recommendation: keep K.
- **S6 (smaller) — StatsHUD with a disposed handle.** `counts()` throws `unknown-handle`; the pin's HUD
  never threw (optional chaining). Options: let it propagate (loud; the pin's callers recreate the HUD
  on scene change) or skip disposed handles (a silent state). Recommendation: propagate.

**Owner rulings on the second stop agenda (2026-09-18, verbatim).**
- **S1 — E1:** delete the dead branch and its import; record that Phase 4 re-adds splat-text framing
  with a real handle source.
- **S2 — (a):** null for not-built-yet and no-page-resident (the pin's documented "no readable data
  yet"); a disposed handle still throws. Null is an answer, throw is an accusation — keep the pin's
  distinction.
- **S3 — (b):** the hero .rad; the pin's quaternion [1,0,0,0] IS the loader's flip, so the scene
  definition survives honestly. Pass criterion as the agenda states it.
- **S4 — yes:** the lab proves B1 both ways — exact under the loader's flip at pad 0, never-smaller
  under a tilted rotation.
- **S5 —** keep the pin's K format; 1K resolution against a 65,536-splat chunk quantum catches any
  whole-chunk error with margin to spare.
- **S6 — throw;** a diagnostics HUD that silently skips a disposed handle lies by omission.
- **Plus:** fix doc 06's D23 heading in this ticket's doc pass (same stale-heading class as the D22
  catch). `GLOSSARY.md` stays absent — the owner schedules `/domain-modeling` at the Phase 2 boundary;
  noted in ticket 13's file so it stops resurfacing.
- **Scoped commit delegation for this ticket only:** commit after green `check:full` + both review
  rounds (registry-first; check Astra's trace for claimed-but-never-run verifications), staged list
  first, stop on anything stray.

**Build — steps 1 and 2 (2026-09-18).** Starting state re-verified first: HEAD `6239b94` on
`26c0c8a`, `git status --porcelain` empty; this ticket's Comments and PLAN.md as handoff 010
described; dev servers restarted (`toolkit-dev` on `[::1]:5173`, `sparkjs-pin-snapshot` on
`[::1]:5180`; sparkjs HEAD `fd67153`, its status unchanged by the start — four pre-existing owner
edits — and `node_modules/.vite/deps/_metadata.json` still `2026-09-17 18:32:44`, 5431 B); the
pane's WebGPU adapter probed on a real page: `nvidia` / `ampere`, pane `hidden`.
- **Step 1, docs.** Doc 03 Bounds paragraph amended in place (B1: 8-corner world box of the seam's
  box, the superseded clause quoted, exact for axis-aligned transforms with the Euler-flip precision
  note, conservative under rotation, the revisit trigger); doc 02 design rule 2 amended in place
  with a dated E2 note (the five doors, rule `backend-doors-only`, type-only imports included,
  examples exempt per D23 (a), HONEST SCOPE); doc 06 D32 (StatsHUD: config, deleted and re-meant
  fields, K format, the S6 throw, D15 caveat with the pin's three callers re-verified by
  `git grep "new StatsHUD" fd67153`) and D33 (`computeSplatBounds`: A1, B1 incl. the
  `handle.object` local-space dependency, C1, S2, S1), D19's Phase 4 framing addition (S1), D23's
  stale `OPEN` heading → RULED AND DONE with its ruling (spec.md "D23 reconciliation", owner
  2026-08-23, commit `5f30d27`; executed by Phase 2 ticket 03, `b9af209`). Ticket 13 notes that
  `GLOSSARY.md` stays absent until the owner's `/domain-modeling`. D30's discharge note waits for
  the deletion itself (step 3).
- **Step 2, lint rule E2 — red-first.** Baseline under the old config: EXIT 0, 185 modules / 585
  dependencies. PLANT FIRST, rule absent: a value import of `backend/PagePool` and a type-only
  import of `backend/LodTraversal` appended to `src/core/SplatLoader.ts` → EXIT 0, 587
  dependencies — the two edges exist and nothing names them (the gap). Rule
  `backend-doors-only` added (`.dependency-cruiser.cjs`, sha256 `703cc1b9e6e0…`) → EXIT 2:
  `error backend-doors-only: src/core/SplatLoader.ts → src/backend/PagePool.ts` and
  `… → src/backend/LodTraversal.ts` (the type-only edge caught too). Plant removed by restoring the
  saved original: sha256 `b1a9feea88ed…` before and after, `git diff` empty → EXIT 0, 185 modules /
  585 dependencies, with the rule live — while `examples/` keeps its real internal imports
  (rad-lab → `RadPager`, `RadFetcher`, `RadHeader`; loader-lab → `RadHeader`; decode-lab →
  `rad-worker` types), so the D23 (a) exemption is exercised, not assumed. Outputs:
  `.collab-logs/t11-cruise-{0-baseline,1-plant-norule,2-plant-rule,3-restored-rule}.txt`. The
  E1-narrow case (StatsHUD → an internal) is drilled at step 4, once StatsHUD exists.

**Build — steps 3, 4 and 5 (2026-09-18).** Each module was test-first: a probe of the RULED
semantics against a scripted seam, imported by the page from the dev server (so the file that runs
is the file hashed), run RED on the byte-identical pin copy — the unfixed state — then GREEN on the
re-typed file, then shown to catch targeted plants (each restored byte-identically, sha256
compared). RED and GREEN numbers below are all from the FINAL probe versions.
- **Step 3, SplatBounds (A1/B1/C1/S2).** The D30 stub (sha256 `e3f9f1e1…`) was overwritten by
  `git show fd67153:src/core/SplatBounds.ts` — destination sha256 `f71595de…` = the pin blob's.
  Probe `.collab-logs/t11-bounds-probe.js` (`221a3f7f…`; 14 checks: object/world boxes at pad 0,
  the default 5 % pad, `targetSamples` ignored, the quaternion flip exact, an ANCESTOR moved after
  the last matrix update, a tilt = the 8-corner box containing every transformed corner, a fresh box
  per call, the seam's own box never mutated — the scripted seam hands out its internal box by
  reference — and S2's five null/throw cases). RED on the pin copy: `4 passed, 10 failed` — every
  call returns null, because the pin reads `numSplats` off whatever it is handed; the 4 passes are
  the three null cases and the never-mutated check, trivially true when nothing is read. Re-typed
  (sha256 `8e77d3ef…`): `14 passed, 0 failed`. Plant "no `.clone()`" → 5 fail, among them
  `seam-box-never-mutated` (the seam's box rewritten to `[99,99,99]..`). Plant "the pin's
  `updateMatrixWorld(true)`" → exactly 1 fails, `ancestor-transform-refreshed`
  (`[-1,-5,-6]..[4,2,3]`: the flip alone, the moved parent ignored) — the fact-finding's claim about
  the pin's call, now measured. A1's loud break measured by `tsc` on the real caller:
  `src/embed/SiteRuntime.ts(3710,27): error TS2554: Expected 2-3 arguments, but got 1.` (the only
  error in the tree). D30 marked DISCHARGED.
- **Step 4, StatsHUD (D1/S5/S6) and the barrel.** `git show fd67153:src/core/StatsHUD.ts` into a new
  file — sha256 `0ba78610…` = the pin blob's. Probe `.collab-logs/t11-hud-probe.js` (`d4307443…`;
  9 checks). RED on the pin copy: `2 passed, 7 failed` — every refresh dereferences
  `this.spark.activeSplats` (TypeError; S6 fails too, since a TypeError is not the seam's named
  `unknown-handle`); the 2 passes are pin behaviours that read nothing (hidden, dispose). Re-typed
  (sha256 `8c748ddf…`): `9 passed, 0 failed` — `5 fps | drawn: 1206K | resident: 2163K | src: 8001K`
  summed over two handles, one handle as a bare value, `0K` ×3 with no handles, the K rounding
  (1,500 → `2K`, 5,502 → `6K`), the 10 Hz throttle, hidden reads nothing, S6's `unknown-handle`. My
  first probe could not tell "sum" from the pin's first-handle-only `break` (the second handle added
  48 splats, invisible at 1K resolution); fixed so the second handle moves every K value, then
  proven: plant "first handle only" → 2 fail — the sum line prints the first handle's
  `1200K / 2097K / 7935K`, and S6 goes silent because the disposed second handle is never read,
  exactly the lie by omission S6 forbids. Barrel: the pin's two lines return byte-identical to
  `fd67153:src/index.ts:11` and `:33` (full-line `grep -F -x`), at the pin's positions (after
  `CameraPath`, after `Annotations`); the deferred-sources header reads 7 of 13. The E1-narrow lint
  case drilled: StatsHUD → `backend/PagePool` planted → `error backend-doors-only:
  src/core/StatsHUD.ts → src/backend/PagePool.ts`; restored → EXIT 0, 186 modules / 589
  dependencies. D32/D33's loud breaks measured on the barrel with the pin's own call shapes
  (scratch consumer `.collab-logs/t11-hapi-probe/`, compiled against this toolkit only):
  `error TS2353: Object literal may only specify known properties, and 'spark' does not exist in
  type 'StatsHUDConfig'.` and `error TS2554: Expected 2-3 arguments, but got 1.` Not added to
  `examples/h-api/`, whose variants ticket 09's Stop 17 scoped to D24/D28.
- **Step 5, SiteRuntime (S1).** The dead `isSplatMesh` branch of `sphereFromObject` and the
  `computeSplatBounds` import deleted; the function's comment and the file header each state the
  ruled edit (sha256 `a2605b81…`, 8 insertions / 14 deletions). RED → GREEN on the compiler: the
  TS2554 above → `tsc EXIT=0`. Runtime re-proof is site-lab on both backends, after step 7.

**Build — step 6, text-lab swap (2026-09-18): BUILT per F1 + S3 (b), then STOPPED at its pass
criterion.** `examples/text-lab/main.ts` (sha256 `6171da5f…`, 64 insertions / 39 deletions): the
placeholder box is gone; the pin's obstacle code returns with the seam adaptations only —
`new ThreeGsBackend({ renderer: obScene.renderer, createDecodeWorker })`, `loadSplat({ url:
OB_SPLAT_URL, backend, extSplats: true, quaternion: [1, 0, 0, 0], onLoad })`, `computeSplatBounds(
backend, loaded)` framing once at reveal as the pin does, `obScene.scene.add(handle.object)`, the
pin's `bounds &&` guards restored; `OB_SPLAT_URL` is the hero `.rad` through `/@fs`; the dev hook
gains `backend` and `handle` (so the criterion's `computeSplatBounds(backend, handle)` is callable)
and `mesh` returns `handle.object`; a load failure is loud (`onError` → console.error, and the
status line reads `LOAD FAILED (<reason>)` instead of the pin's "none (fallback)"). `tsc EXIT=0`.
Not yet recorded against phase-1 ticket 05's divergence entries — that waits for the ruling below.

**Measured against the stated criterion** (hidden pane; frames pumped through the scene's own
`animate()`, the call rAF drives):
- **Bounds part holds where residency is quiescent.** WebGPU (`webgpu`, adapter nvidia/ampere): the
  hook's `bounds` equals a fresh `computeSplatBounds(backend, handle)` exactly — the reveal had
  landed with all 122 pages resident. WebGL2 (`webgl2-fallback`): the framed box is the FIRST
  resident union (`[-502.07, -60.28, -90.93]..[49.04, 334.55, 222.07]`, diagonal 746.7) and a later
  fresh call returns the full-extent box (`[-510.75, -178.42, -511.45]..[231.33, 340.18, 265.90]`),
  so `equal: false` — pages were admitted after reveal, exactly the ruled frame-once behaviour. The
  exact check at the reveal instant needs the verifier to own the frames (`setAnimationLoop(null)`,
  then pump): the pane is NOT frame-free this session — `renderCount` 48 → 51 in 1.5 s while
  `visibilityState` stayed `hidden` (≈2 Hz throttled frames), so throttled frames revealed the load
  before any pump.
- **Framing part FAILS on both backends.** The padded world box's diagonal is 1,193.27 (WebGPU;
  746.7 for WebGL2's first union); `obCamera.getState().distance` reads `49.99999999999998` — the
  pin's `maxDistance: 50` clamps `setState` (it writes the pose, then `controls.update()` clamps the
  radius), pivot exact (error 1.4e-14).
- **Carving part FAILS on both backends.** At 50 units from the centre the camera sits INSIDE the
  box; 4 of 8 corners project with NDC z > 1 (behind it), so `projectBox3ToScreen` returns null;
  after 70 pumped frames the status reads `commits: 0/60 frames · lines: 29 · obstacle: none
  (fallback)`.

**Why — the hero's exact extent is its floaters** (independent read: own header parse, own Range
fetches, 4 own decode workers from the `decode-url` door, all 122 chunks in 1,787 ms, every decoded
count = the header's; `.collab-logs/t11-hero-extent-probe.js`, `de8df8e7…`). Object-space
percentiles of all 7,935,358 centres: x 1st–99th −33.15…13.94, y −17.60…9.01, z −16.83…16.91
(bulk diagonal ≈ 64); 0.1st–99.9th x −87.24…30.23, y −21.29…27.62, z −42.43…44.73 (diagonal ≈ 155);
exact min…max x −477.02…197.60, y −316.60…154.84, z −230.57…476.12 (diagonal ≈ 1,085; ≈ 1,193 with
the 5 % pad). The outermost 0.2 % of centres make the box ≈ 17× the bulk's diagonal. The pin framed
with SAMPLED bounds (1,000 samples), whose undershoot happened to skip floaters; exact bounds —
correct for Phase 2 — cannot, and percentile clamping is Phase 4 (doc 04:144, ruled). Same read,
AC2 preview: 53 chunks resident at that instant, the seam's `bounds()` equalled the independently
decoded union in all six floats (it also equals the full 122-chunk union — the extremes sit in
resident chunks).

**Option (a) measured** (scratch replica of text-lab's exact obstacle wiring — same scene config,
`CameraSystem` limits, `loadSplat` call with the pin's quaternion, framing, projection — on
`moss.ply`, the pin's own scene; `.collab-logs/t11-moss-probe.js`, `642690be…`; the fixture was not
touched). `moss.ply` read directly: binary little-endian, 687,715 splats, 62 properties, SH degree 3
(45 `f_rest`, in the vendored degree table, not refused); exact box 0.971 × 0.259 × 0.845, diagonal
1.313, bulk (1st–99th) diagonal 1.113 — no floaters. Both backends: reveal 7,121 ms (WebGPU) /
6,368 ms (WebGL2), all 687,715 resident and selected, world box `[-0.7155, -0.1478,
-0.4328]..[0.3528, 0.1375, 0.4963]`, framed at `distance = size.length()` = 1.4443 exactly
(unclamped), equal at reveal, camera outside the box, projection non-null (`{x: -416.4, y: 306.6,
w: 765.5, h: 244.9}` in an 800 × 520 viewport). The carving itself was not run (text-lab not
switched).

**Third stop agenda — S7, text-lab's framing on the hero (owner ruling requested; step 7 waits
behind it in the recorded order):**
- **S7 — the hero's exact bounds defeat the pin's framing.** Options:
  (a) **switch the obstacle to `moss.ply`** — the pin's own scene and quaternion, measured above to
  meet the criterion's bounds and framing parts under the pin's unchanged constants on both
  backends (carving to be verified after the switch). Costs: a 170 MB SH3 monolithic PLY parsed
  per text-lab open (~7 s); text-lab stops being a PAGED consumer — computeSplatBounds on the paged
  hero stays proven by step 7's lab (AC2 + S4).
  (b-keep) **keep the hero and the pin's constants; amend the criterion** to its bounds part
  (non-null, and equal to `computeSplatBounds(backend, handle)` at the reveal instant under
  verifier-owned frames), recording framing and carving as NOT met on the hero until Phase 4's
  percentile clamping; text-lab shows "none (fallback)" meanwhile.
  (b-scale) **keep the hero; scale text-lab's camera to the asset at reveal** — `maxDistance` ≥
  `size.length()` (≈1,193) and the camera's `far` ≥ distance + half-diagonal (≈1,790, from 1,000) —
  the criterion passes literally, but the frame is a floater cloud with the subject ≈3.1° of the
  55° view, ≈5.6 % (bulk diagonal ≈ 64 at distance ≈ 1,193); a declared divergence from the pin's constants.
  Recommendation: (a) — it keeps text-lab the pin's scene and its framing a real consumer proof,
  while the paged path's proof lives in the lab built for it.
- **Stated for the record, not stops:** step 7's lab will be `examples/counters-lab/` (both modules
  read the seam's counters); S4's tilt is any non-axis rotation — the lab uses Euler `(0.3, 0.5,
  0.2)` on top of the flip and asserts the box is strictly larger on at least one axis, so the tilt
  is not vacuous; checks that need an exact instant own the frames (`setAnimationLoop(null)`) rather
  than trusting the pane to be frame-free.

**Owner ruling on the third stop — S7 (2026-09-19, verbatim).** "(a): text-lab switches to
moss.ply, superseding my S3-(b) ruling; record the supersession with its grounds (S3-(b) was made
before the floater measurement; exact bounds + this asset defeat framing by construction, and the
pin's own framing worked only by sampling undershoot — quote the 64 / 155 / 1,085-unit table).
Text-lab returns to being the pin's own scene in its closest loadable form; the paged-consumer
proof lives in step 7's counters-lab, where it belongs. The 170 MB per-open parse is an accepted
lab cost, noted." Conditions: (1) the carving check must actually run — the moss probe proved
reveal, framing and projection but NOT the text wrap; (2) moss.ply is the first SH degree-3 asset
through the monolithic path — note what that incidentally covers and assert dispose stays clean on
it in the same run, closing the degree > 1 gap at monolithic scope; (3) promote the percentile
insight to doc 04's Phase 4 bounds item, dated, as a framing REQUIREMENT. **b-keep rejected** (a lab
that displays its own fallback proves the fallback); **b-scale rejected** (a criterion passed
literally while the scene fills 5.6 % of frame is the vacuous-check trap with a camera).

**Build — step 6 closed (2026-09-19).** `examples/text-lab/main.ts` (sha256 `568ad5f9…`, 68
insertions / 39 deletions): `OB_SPLAT_URL` is now `moss.ply` through `/@fs`, with the supersession
and its grounds in the file's own comment; header and section notes follow. `tsc EXIT=0`.
Supersession recorded in phase-1 ticket 05's two declared-divergence entries (the placeholder
entry DISCHARGED, the placeholder-constants entry CLOSED, both dated), in PLAN.md `## decisions`,
and — condition 3 — as a dated paragraph on doc 04's Phase 4 bounds item: percentile clamping is a
framing REQUIREMENT, not polish, with the 64 / 155 / 1,085-unit table and the text-lab consequence.
- **Criterion, both backends** (frames owned by the check: `setAnimationLoop(null)`, then the
  scene's own `animate()`): `bounds` non-null and EQUAL to a fresh `computeSplatBounds(backend,
  handle)` (a different object, not the same box); world box `[-0.7155, -0.1478, -0.4328]..[0.3528,
  0.1375, 0.4963]`; camera distance `1.4442615208567264` === `size.length()` EXACTLY, pivot error 0,
  yaw 30 / pitch 12, camera outside the box; counts 687,715 total = resident = selected. On WebGPU
  the reveal landed on the check's own first pumped frame (`revealedBeforePump: false`); on WebGL2
  the pane's throttled frames got there first — harmless on a monolithic handle, whose bounds cannot
  drift.
- **Condition 1 — the carving RAN, in the fixture, on both backends.** Identical on WebGPU and
  WebGL2: status `obstacle: projected`; projected rect `{x 234.6, y 207.2, w 532.1, h 255}` in a
  1051 × 559 region whose two 485.5-wide columns it overlaps; 44 committed lines, 26 of them in the
  obstacle's vertical band, **0 overlapping it horizontally**, and all 26 narrowed below
  column-width − padding. The last two numbers are what keep it non-vacuous: lines are present in
  the band, and they are carved rather than merely placed elsewhere.
- **Condition 2 — SH degree 3 live, dispose clean.** Before this asset the monolithic path had only
  ever seen degree 0 (`examples/assets/splat-lab/fixture.ply` has no `f_rest`) and the paged path
  degree 1 (the hero's header: `maxSh: 1`), so moss.ply is the first degree > 1 ANYWHERE here. Live
  on the mesh: `sphericalHarmonicsDegree: 3` with `sphericalHarmonics1/2/3` storage buffers (words
  3 / 4 / 6) and `_sphericalHarmonicsInitialized: true` — on WebGPU through the compute dispatch,
  on WebGL2 through `webGLBuffersEnabled: true`, so both branches of the newly-live degree-3 path
  executed. Dispose, in the SAME page run, by the house union-counter method (splat-lab's nine
  `renderer.info.memory` keys, zero tolerance, each asserted present): dispose threw nothing; the
  handle was invalidated by name (`counts()` and `bounds()` → `SplatBackendError(unknown-handle)`)
  and the mesh detached; counters went WebGPU `storageAttributes=12 storageAttributesSize=96,312,868
  attributes=1 geometries=1 indexAttributes=1` → all nine zero, WebGL2 `textures=8
  texturesSize=82,567,168 …` → all nine zero (the PBO-texture path, as expected on that backend); a
  second load → dispose cycle of the same asset reproduced the loaded counters EXACTLY and returned
  to the same zeros (`loadedCountersMatch` and `countersFlatAcrossCycle` both true). No unhandled
  rejections; the only console errors are the D19 stub's two loud-by-design bench messages.

**Build — step 7, `examples/counters-lab/` (2026-09-19/20).** New page (`main.ts` sha256
`f69b5d23…`, 599 lines; `index.html` `9b50a610…`), added to `vite.config.ts`'s input map; the hero
in the eviction regime, `?pages=32` as this page's DEFAULT (a bare URL runs the regime its ACs
need) and `?webgl=1` for the fallback. It parses the container header with its OWN code (never
`parseRadHeader`), Range-fetches and decodes chunks with its OWN workers, and scores every sample
from that cache — chunk boxes are a pure function of the file. Each sample is ONE synchronous block
(resident sweep, `bounds()`, `counts()`, HUD refresh and read): residency only moves in
worker-message macrotasks, so nothing shifts mid-sample. The drills' comments state the two honest
limits: the resident SET is backend-reported (`isResident`), and AC1's `drawn` check is
self-referential (the draw count has no independent public source — it pins consistency, not
truth). Selection is OFF around the eviction samples so the LOD driver cannot heal them; a held
last-chunk fetch keeps the load unsettled for the mid-load samples; convergence runs with selection
back ON.
- **GREEN, both backends, 14/14:** WebGPU (twice — before the plants and again after the restore)
  and WebGL2. Nine sampled moments per run, with different residency trajectories each time
  (WebGPU 5 → 7 → 11 → 11 → 6 → 7 → 0 → 32 → 32, WebGL2 9 → 13 → 17 → 17 → 12 → 13 → 0 → 32 → 32,
  post-restore WebGPU 2 → 5 → 6 → 6 → 1 → 5 → 0 → 32 → 32), so nothing passes on a fixed timing.
  AC2: every seam box equals this fixture's own decoded union EXACTLY at all nine, the union moving
  both ways across them (no direction asserted). AC1: displayed `src` = 7935K (this fixture's header
  total) and displayed `resident` = the header's per-chunk sum over the resident chunks at every
  sample (WebGPU 328K → 459K → 721K → 721K → 393K → 459K → 0K → 2097K → 2097K). S4: under the flip
  at pad 0, `computeSplatBounds` equals this fixture's own PER-POINT world box exactly over
  2,097,152 transformed centres; under a (0.3, 0.5, 0.2) tilt on top of the flip the 8-corner box
  contains the per-point box AND is strictly larger on at least one axis. S2/S6 on real data: null
  before construct, null with no page resident (all 32 evicted), `unknown-handle` from BOTH
  computeSplatBounds and `StatsHUD.update` after dispose. Convergence: 32/32 pages = 2,097,152 of
  7,935,358 splats. Zero unhandled rejections.
- **RED-first, one planted run (WebGPU), four independent defects, five checks red, each
  attributable:** (i) paged bounds made GROW-ONLY in `residencyChanged` (`min()`/`max()` instead of
  `set()`) → AC2 red at `after evictChunk`, seam `[-477.02, -316.60, -207.84]..` against this
  fixture's `[-192.71, -84.31, -97.62]..` — the "never tightens" assumption the AC exists to forbid;
  (ii) HUD's `resident` summed from `counts().selected` → AC1 red (`drawn: 30K | resident: 30K`
  against the header's 131K); (iii) `computeSplatBounds` transforming only min and max instead of
  `Box3.applyMatrix4`'s 8 corners → S4-flip red with an INVERTED box (`[-477.02, +316.60,
  +230.57]..[197.60, -154.84, -476.12]`: the flip's negative scales swap min and max) and S4-tilt
  red (that box no longer contains the per-point box); (iv) `unknown-handle` added to
  `NO_DATA_YET` → the dispose check red (`computeSplatBounds threw ""` — it answered null while the
  HUD still threw). All three planted files restored byte-identically (sha256 before = after:
  `ThreeGsBackend.ts` `ba9cfd5d…` — unchanged by this ticket and diff-empty against HEAD,
  `StatsHUD.ts` `8c748ddf…`, `SplatBounds.ts` `8e77d3ef…`), and the post-restore WebGPU run is the
  14/14 above.
- **Corroboration, unplanned:** the crate's own golden test (`decodes_hero_chunk0`, run by
  `check:full`) prints `center bounds: [-477.01797, -316.6046, -207.84116] .. [23.988297, …]` —
  the same chunk-0 minimum x this fixture's independent JS decode found (`-477.017975`).

**Gate — `npm run check:full` EXIT=0 (TRUE exit, 2026-09-20).** Site build 209 modules (the
counters-lab page among them, 13.23 kB), embed build 125 modules, `embed-size OK: 3138779 bytes
(bound 3932160)`, crate tests 6 passed / 1 ignored then the golden run 7 passed, `tsc` clean,
`depcruise` clean at 187 modules / 599 dependencies with the new `backend-doors-only` rule live.
**Embed delta measured, not assumed:** the artifact is 3,138,779 B against ticket 09's recorded
3,138,621 B, so I isolated this ticket's own effect — rebuilding the embed with HEAD's
`SiteRuntime.ts` and nothing else changed gives 3,139,411 B, so THIS TICKET SHRINKS the embed by
632 B (the deleted `computeSplatBounds` import and dead branch, as expected); the +158 B against
ticket 09's figure is HEAD-side growth since that measurement (commit `26c0c8a`'s
dispose-after-failed-init fix), not this ticket's. My version restored and rebuilt: 3,138,779 B,
size check green.
**Labs re-run on both backends:** counters-lab 14/14 (above); text-lab's criterion met (step 6);
site-lab 12/12 on WebGPU and 12/12 on WebGL2 with the SiteRuntime edit in place — ticket 09's
baseline unchanged.

**Adversarial review round (2026-09-20) — `astra-review`, per the v2 registry's `technical_review`
lane order (primary; Astra did not author this work, so the lane's "choose another when Astra
authored it" clause does not apply).** Policy read fresh before dispatch
(`collaboration-model.md`, `registry.json`, `operations.md`, `plan-template.md`,
`docs/verification-matrix.md`). Identity from the run's OWN banner: codex-cli 0.153.3,
`gpt-6-astra`, reasoning effort high, sandbox read-only, approval never, session
`01a0bd37-b607-7740-9956-ba76ee10af56`. Admission: live `codex app-server` →
`account/rateLimits/read` = 30 % of the weekly window used, no paid credits (`balance "0"`,
`hasCredits:false`, plan prolite, `spendControlReached:false`) → remaining 70 ≥ reserve 20 +
allowance 5; pre-existing codex processes left alone; no rollout written in the prior 15 min. Run
05:08:59Z–05:16:41Z, `EXIT=0`, 127,421 tokens; meter 30 % → 32 % after (a 2-point move at 1-point
granularity, with other consumers possible). Material `.collab-logs/t11-review-material.diff`,
prompt `t11-review-prompt.md`, findings `astra-review-t11.md`, trace `astra-review-t11-err.log`.
**Scope: 3,527 of 3,529 hashed repo files byte-identical before/after; the only two differences are
my own post-review fixes** (`t11-hashes-before.txt` / `-after.txt`). **Read-scope excursion, recorded
honestly:** the declared scope was this repo plus the pin, and the worker additionally read its own
two skill files (`C:/Users/alexm/.agents/skills/{pocock-code-review,agent-collab}/SKILL.md`) and
five files of the policy repo `D:/Projects/agent-collaboration/` — the residual broad-read
capability of `ordinary_authorized`, used more widely than ticket 09's single excursion.
**Claimed-verification check (the standing Astra caveat): CLEAN this round.** Ticket 09's round
carried "reproduced in memory" / "verified by an in-memory replay" with no such execution in the
trace; this prompt forbade that phrasing, and every execution claim here has a matching command in
the trace — two `node` here-string runs (one transpiled MY fixture's eviction block and drove it
against a scripted one-upload-per-pump backend; one loaded the real `SplatBounds.ts` through the
TypeScript transpiler against real `three` r185), plus `tsc --noEmit`, dependency-cruiser,
`Get-FileHash` over the changed files and both `git show` pin reads. Two findings are tagged
"by reading" by the worker itself, honestly.

**Four findings, ALL CONFIRMED by my own verification, all fixed (red-first where a check
existed):**
1. **`src/core/SplatBounds.ts` — world box stale for a FROZEN object under a moved ancestor
   (MED). CONFIRMED by reading three 0.185.1** (`node_modules/three/src/core/Object3D.js:1214-1246`:
   `updateWorldMatrix` recomputes `matrixWorld` only `if (this.matrixWorldNeedsUpdate || force)`, and
   `matrixWorldNeedsUpdate` is set by `updateMatrix()`, which an object with
   `matrixAutoUpdate = false` never runs). Reproduced in OUR environment first: probe case
   `frozen-object-moved-ancestor` red at `[-1,-2,-3]..[4,5,6]` (the parent's x=10 ignored); fixed
   with `updateWorldMatrix(true, false, true)` — the forced refresh — and the probe is 15/15 green
   with the original ancestor case still passing. The pin's `updateMatrixWorld(true)` handles this
   case but not the moved-ancestor one; the forced call covers both. D33's wording updated.
2. **`examples/counters-lab/main.ts` — the eviction drill assumed five residents (MED). CONFIRMED
   by reading**, and the worker demonstrated the false failure by running my own extracted block
   against a scripted schedule (`eviction-took false … resident pages 4 → 0`). Fixed: the fixture
   now pumps until `EVICT_COUNT` pages are actually resident, asserts that precondition, and
   reports "evicted [...] of N resident".
3. **`examples/counters-lab/main.ts` — convergence compared against the REQUESTED override, not the
   backend's effective budget (MED). CONFIRMED by reading** (`budget = min(P_limits, P_asset,
   override)`), then demonstrated red-first in our own environment: with the pre-fix comparison
   restored as a plant, `?pages=123` on this 122-chunk asset failed an honestly-converged run —
   `FAIL — convergence: … 122/123 pages resident … = 7935358 of 7935358 splats`. Fixed to read
   `pagerDiagnostics().budget` for both the refill wait and the assertion; same URL now passes:
   `122/122 pages resident (budget source: device limit (bind 128 MiB / buf 256 MiB); requested
   ?pages=123)`. The plant was restored byte-identically before the green run.
4. **The S4 record and the fixture's own detail line claimed a tilt "on top of the flip" while the
   code REPLACED it (LOW). CONFIRMED by reading three** (`Object3D`'s `onRotationChange` →
   `quaternion.setFromEuler`, so assigning `rotation` overwrites the quaternion). The earlier runs'
   S4 tilt was therefore a pure (0.3, 0.5, 0.2) rotation, NOT composed with the loader's flip — the
   check stayed valid (any non-axis rotation proves the 8-corner box is never smaller) but the
   claim was false. Fixed by composing properly (`rotateX/Y/Z` multiply onto the flip), so the
   wording is now true; **this ticket's earlier S4 lines describe the uncomposed runs.**
**Clean categories reported by the worker:** StatsHUD, the boundary rule, SiteRuntime, the barrel,
text-lab — none.
**Re-verification after the fixes:** counters-lab 14/14 on WebGPU and 14/14 on WebGL2 (and 14/14 at
`?pages=123`); text-lab's criterion re-run on both backends (bounds equal at reveal, distance
exactly `size.length()`, obstacle projected, 26 of 44 lines in the band with 0 overlapping, SH3
initialized); bounds probe 15/15; `npm run check:full` EXIT=0 again, embed unchanged at 3,138,779 B.

**Built-in review round (`/code-review`, high, 2026-09-20) — reported SEPARATELY from the
adversarial round above.** Scope: the working-tree diff (the ticket's 14 tracked files plus the two
new ones). Two findings, both in this ticket's own new fixture, both CONFIRMED and fixed:
1. **`examples/counters-lab/main.ts:417` — the mid-load samples were never asserted to BE mid-load
   (MED, vacuity).** The three "mid-load" samples rested entirely on the held last-chunk fetch, and
   nothing checked that the hold bit. Proven by planting an offset-by-one matcher: the load settled
   before the first sample and the fixture still reported 14 passed — `load settled at each sample =
   [true, true, true]` — with every other check green. Fixed with a new check
   (`mid-load-samples-are-mid-load`: each mid-load sample unsettled and the held chunk not
   resident), which is red under that plant and green with the matcher restored.
2. **`examples/counters-lab/main.ts:431` — the eviction drill's count could exceed the effective
   budget (LOW).** A hard-coded five pages cannot be reached when the budget is smaller (`?pages=2`),
   so the new precondition wait would spin to the 120 s bound and crash the runner instead of
   failing a check. Fixed: `EVICT_COUNT = Math.min(5, pagerDiagnostics().budget.pages)`.
Nothing else in the diff produced a finding I believe is real: StatsHUD's throttle/aliasing and
dispose match the pin, SplatBounds' scratch vector is re-entrancy-safe (no awaits), the
`backend-doors-only` regex covers every module under `src/backend/` that is not one of the five
doors, the two barrel lines add no path to the inline decode worker (depcruise green), and
SiteRuntime's remaining `sphereFromObject` callers (a prop's glTF root, a PlaneLane quad) are
unaffected by the deleted branch.
**Final re-verification after both rounds:** counters-lab **15/15 on WebGPU and 15/15 on WebGL2**
(the new check included), bounds probe 15/15, text-lab's criterion green on both backends.
