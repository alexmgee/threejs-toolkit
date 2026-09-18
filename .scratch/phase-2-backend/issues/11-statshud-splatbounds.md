# 11 — StatsHUD + SplatBounds fed from backend counters

**Status:** ready-for-agent
**Blocked by:** 07 — LOD/selection (selected counts exist); 09 — SiteRuntime
(the consumers run in the real runtime).

**What to build:** the on-screen stats and the scene's reported bounds tell the
truth about a streaming scene — total/resident/selected counts and
resident-aware bounds. Owner ruling: percentile clamping stays Phase 4 (doc
04:144); bounds here are verified against ground truth, not smoothed.

Standing rules bind (spec.md).

- [ ] StatsHUD's numbers track an independent read of the pager's public counters
      across a load + eviction cycle, both backends.
- [ ] `bounds()` on a partially resident hero equals the independent union of the
      resident pages' extents at each sampled moment (bounds may legitimately
      EXPAND as outlying pages arrive — no "tightens" assumption).
- [ ] No consumer reaches past the seam for any counter (boundary lint green).

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
  its ruling; the `CONTEXT.md` named in this repo's CLAUDE.md does not exist.

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
