# 05 — Text + markers cluster (carries the D19 SplatTextMesh stub)

**What to build:** the text layout/lane system and the marker/region DOM layer,
compile-closed given 04. The non-splat text path renders in the text fixture.
17 files / ~6,135 lines. Read `../spec.md` first.

**Files:** `text/BlockRenderer`, `text/PlaneLane`, `text/SplatLane`,
`text/TextSystem`, `text/ColumnsLane`, `text/FreeLane`, `text/PanelLane`,
`text/StyleResolver`, `text/StyleToCss`, `ui/ObstacleLayout`, `ui/TextLayout`,
`ui/billboard`, `ui/Annotations`, `ui/CaptionOverlay`,
`ui/EditorialRegionEditor`, `ui/ReservedRegions`, `ui/Typography`.
(PanelLane imports CaptionOverlay and ReservedRegions — that edge is why the
markers ride in this ticket.)

**Blocked by:** 04

**Status:** done

> D21 RULED (2026-08-20, doc 06): guard lifted. sparkjs-toolkit is committed
> and clean (drift in `59b65cf`, golden rebaseline `862b9eb`); Phase 2's
> re-sync input is the ticket-04-SHA-inventory-vs-`59b65cf` diff.

- [x] Every COPY file byte-identical; the three-only files carry only their
      doc 01 renderer adaptations, each declared in Comments (reality: ZERO
      renderer adaptations were needed — all 17 files compile unchanged;
      see Comments)
- [x] **D19 stub**: `ui/SplatTextMesh` lands as an API-preserving typed STUB
      whose constructor throws with an explicit "rebuilt in Phase 4 (doc 03
      section E)" error — so `text/SplatLane.ts` compiles UNCHANGED. The stub
      is tracked by doc 06 D19: Phase 4 deletes-and-replaces it
- [x] The text fixture (from sparkjs-toolkit examples) runs its non-splat
      lanes; the splat-lane path fails loudly with the stub's error, not
      silently (reading declared in Comments: the fixture's non-splat
      SECTIONS — it exercises TextLayout/ObstacleLayout directly, not the
      text/*Lane classes, which have no fixture in sparkjs either)
- [x] `npm run check` green (exit 0, 2026-08-22, true exit code via
      redirect-then-`$?`)

## Comments

**2026-08-22 (execution session):**

**Copy vintage: sparkjs commit `fd67153`** (D21 SECOND AMENDMENT, doc 06,
ruled this session). Every file copied via `git show fd67153:<path>` — NEVER
from the disk working tree (the owner was actively editing sparkjs during
this ticket; 4 of the 17 files — PlaneLane, SplatLane, ColumnsLane,
FreeLane — hash DIFFERENTLY on disk than at the pin, so the discipline
demonstrably mattered). Each copy verified byte-identical against the pin
(`git show fd67153:<path> | diff - <dest>`, zero mismatches).

**SHA-256 at copy time (destination files, pin fd67153):**
```
3657448ae7e9ea9248cc06d186c92787c4d2e288cfa8cf4dc7e6fff6bb87db7a src/text/BlockRenderer.ts
c616c388b69fd42ec99453866b4d706b4e940701f1ce4cd288be654f3ceb1a75 src/text/PlaneLane.ts
7912ae9a8007a83a9080bd78057d8553196f1a98f62e63c029fcecad31a9a68a src/text/SplatLane.ts
e1a88567dd241d0af6c529b6e901bfe6cd7eae1ad78ac928c2be66779e88ed1b src/text/TextSystem.ts
049111426f2270a9598cb3db110e966d0f97499440afdea9fd81c3b3bf81b6dc src/text/ColumnsLane.ts
9bad90e9b9a4bcdb905571111aa8f1f4a29256a303c73ba0e1d8cd90340840a4 src/text/FreeLane.ts
b12e92efeec1c3a26bd6a1977e4238e1ed32bbea232405e7d9aaf7a3ee7e5f38 src/text/PanelLane.ts
5b2bc18224d9ed4ed7c82a9d89240e5f3234734dcb7c6b67fb343d8ff6523c60 src/text/StyleResolver.ts
839a010790a5453a2b5864bd8d20516ca8a78ecbb14411d3a3e15ce430573803 src/text/StyleToCss.ts
3a956114cb1126d688c4e5d2a8acc0df07f104dfa15807ad346bec84814b054d src/ui/ObstacleLayout.ts
77186eef9ec2c96e6479438b21cb6a3217b185b109949e33a59c5fc915d36445 src/ui/TextLayout.ts
fecdaacfe3953c9708717378f35ac81a626113710e88a96d0e47e9a5f270cc39 src/ui/billboard.ts
64d49ce0618ded770f791df2aad43143ba9220bff3d7ec68048001d7357d44fc src/ui/Annotations.ts
437ae3ef11921681538bca7615bd931ce5691144c7b53102ebef600fa2c8b09a src/ui/CaptionOverlay.ts
4a5b440e21fc53fdeeb4c281b02cb924e3c774d29078cb130dcfff4ff8265826 src/ui/EditorialRegionEditor.ts
a10cf5f9d5436e17ee9fe8d0881e89bba421f757459f6cb282439db64a2ba85e src/ui/ReservedRegions.ts
54fb571a96a943d97969b1dfd99b5c299d37f95a14081ee0cfc2d7ecf3182e66 src/ui/Typography.ts
```

**Zero renderer adaptations.** Doc 01 lists TextSystem/SplatLane/PlaneLane/
BlockRenderer as three-only ADAPT files and Annotations/ObstacleLayout/
billboard as "re-verified only" — in practice NONE of the 17 needed any
edit: they import only three math/types (backend-agnostic), relative
siblings, and `@chenglou/pretext`; no renderer construction anywhere.
All 17 land byte-identical. The gate was green on the first run after the
copies + stub with no file modified.

**Declared divergences / additions:**
1. `package.json` + lockfile: added `@chenglou/pretext@0.0.8` (exact pin,
   same version sparkjs pins) — required by ColumnsLane, ObstacleLayout,
   TextLayout. Without it nothing in the cluster compiles.
2. `src/ui/SplatTextMesh.ts` — the D19 STUB (NOT a copy; tracked by doc 06
   D19, Phase 4 deletes-and-replaces). Config interface and public member
   signatures mirror the pin's original exactly (verified against
   `git show fd67153:src/ui/SplatTextMesh.ts`); every member throws
   "SplatTextMesh is a D19 stub: splat text is rebuilt in Phase 4 (doc 03
   section E)…". `readonly object!` uses definite assignment — the
   constructor throws before any assignment.
3. `examples/text-lab/` — the text fixture, ADAPTED (examples/ fixtures are
   adaptations by design, owner ruling at ticket 04; R5 byte-identity binds
   src/ only). index.html copied verbatim from the pin. main.ts strip/add
   inventory:
   - SparkScene → ThreeSplatScene (both bench and obstacle scenes);
     `sparkRenderer` arg dropped from both CameraSystem constructions
     (optional param; no Spark mesh exists).
   - Splat Text Bench: `recreateSplatText()` wraps the SplatTextMesh
     construction in try/catch — on the stub's throw it nulls the mesh,
     writes the error to the bench status (error styling) and
     console.error, and the fixture keeps running. Original behavior
     (uncaught → bootObstacle never runs) would have silenced the rest of
     the page; the AC demands loud-not-fatal.
   - Editorial Obstacle View: Phase-2-deferred `loadSplat`/
     `computeSplatBounds` (embed set, spec "Deferred out of Phase 1")
     replaced by a placeholder `MeshNormalMaterial` box whose
     `Box3.setFromObject` bounds feed the SAME projectBox3ToScreen →
     layoutObstacleColumn → LinePool.commit path. Phase 2 swaps the
     placeholder for the real splat load. `OB_SPLAT_URL` dropped with it.
   - Original header's calibration tables trimmed (they document
     Spark-measured splat counts; they re-enter with the Phase 4 rebuild).
4. `vite.config.ts`: `text-lab` page added to the build input map (the
   pattern doc: "later tickets add pages to the same input map").

**AC reading declared:** "runs its non-splat lanes" = the fixture's
non-splat SECTIONS. sparkjs's text-lab exercises TextLayout, ObstacleLayout
and SplatTextMesh — it never instantiates the text/*Lane classes (no
sparkjs fixture does); those compile into the build (gate) and are
exercised by TextSystem consumers in later tickets.

**Runtime evidence (dev server, WebGPU backend confirmed via
`__textLab.bench.splatScene.backend === "webgpu"` for both scenes):**
- Font-parity bench: `8 lines · block height 192px`, 8 `.ptx-line` DOM
  nodes — Pretext wrap runs.
- Stub fails LOUDLY: console error `[text-lab] splat text bench
  unavailable: Error: SplatTextMesh is a D19 stub: splat text is rebuilt
  in Phase 4 (doc 03 section E)…` + same text in the bench status;
  `__textLab.splatText === null`; page continues (obstacle section boots).
- Obstacle view: placeholder box projects to a real screen rect
  ({x:325, y:204, w:476, h:185} at 1152×560); 32 lines committed (23 left
  column + 9 right); IN the obstacle's vertical band lines carve around
  it (left-column lines x=24 stopping short of x=325; right-segment line
  at x=818, past the obstacle's right edge 801; full-width lines above/
  below the band). Driven one frame manually through the live module
  instances + the fixture's own LinePool (vite-served `/src/ui/*.ts`
  imports) because the harness Browser pane was HIDDEN this session —
  document.visibilityState "hidden" pauses rAF (handoff 003 trap 7), so
  the fixture's own frame loop cannot tick and screenshots are
  unavailable headless. The loop code is byte-for-byte the pattern proven
  visible-pane in tickets 03/10.
- WebGL2 fallback path NOT runtime-exercised this ticket: the fixture has
  no backend toggle (the sparkjs original has none either) and the ticket
  ACs don't require one; doc 05 rule 4 (both backends) binds the H-grade
  parity harnesses, and this ticket carries none.

**2026-08-22 — adversarial review round (gpt5.6-sol high, grok-4.6, Opus
subagent, per the agent-collab recipes; every finding re-verified in-session
before acting):**
- CONFIRMED & FIXED (gpt5.6-sol #1): `#stStatus.error` had no CSS rule —
  the stub error rendered success-green. Added `#stStatus.error { color:
  #f87171; }` to index.html, which therefore now diverges from the pin by
  that one declared line (was verbatim).
- CONFIRMED & FIXED (gpt5.6-sol #3 / Opus #1): `distance: size.length() * 2`
  was an undeclared, underived multiplier over the original's
  `size.length()`. Reverted to `size.length()` — original framing formula,
  no magic constant.
- CONFIRMED & FIXED (Opus #3): neither scene observed `ThreeSplatScene.ready`
  — backend-init failure would have been fully silent (the facade swallows
  its own rejection by design). Added the sibling-fixture pattern
  (ready.then → backend console log; .catch → "INIT FAILED" in the section
  status + console.error) to both scenes.
- CONFIRMED & FIXED (Opus #4): no backend toggle, unlike both sibling
  fixtures. Added `?webgl=1` → `forceWebGL` on both scenes (repo pattern,
  examples/scene + examples/grade); WebGL2 fallback runtime evidence below.
- DECLARED, NOT CHANGED (Opus #2): the placeholder's constants —
  `BoxGeometry(1.6, 1.1, 0.9)`, `rotation.set(0.3, 0.5, 0)` — are arbitrary
  placeholder geometry (any solid of roughly unit scale serves; Phase 2
  replaces the whole block with the real splat load). The original's
  `bounds &&` guard in the boundsToggle handler is dropped because `bounds`
  is now non-null by construction. All three now declared here.
- ASSESSED, NOT CHANGED (gpt5.6-sol #2): changing a baked control
  (fontSize/lhw/billboard/weight) re-runs the throwing construction — one
  console.error per user interaction. That is the loud-by-design path, not
  spam (Opus traced every listener with splatText === null: all safe).
- Non-finding recorded for Phase 2/3 (Opus): the stub's `ready()` throws
  synchronously rather than returning a rejected promise — unreachable
  today (constructor throws first); matters only if a later phase softens
  the constructor.
- Post-fix runtime evidence: gate re-run green (exit 0); default load →
  `[text-lab] bench/obstacle ready, backend: webgpu`; `?webgl=1` →
  `backend: webgl2-fallback` on BOTH scenes with parity bench (8 lines)
  and the red stub error intact — the earlier "WebGL2 not exercised" gap
  is closed by the toggle.
- CONFIRMED & FIXED (grok-4.6, sole new finding): the pin's
  `<a class="back-link" href="../index.html">` back-link 404s here (no
  examples/index.html exists; every sibling fixture strips it). Removed —
  second declared index.html divergence. grok's other three categories:
  none (stub fidelity, D21 claims, vite/pretext all re-confirmed clean).
