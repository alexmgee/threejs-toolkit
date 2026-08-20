# Phase 1 — scaffold + COPY mass + renderer foundation

Ticketed 2026-08-19 from doc 04 Phase 1 (as amended). 11 tickets, cut by
COMPILE-CLOSED CLUSTER against the real import graph of sparkjs-toolkit/src
(117 files scanned; classification reproduced doc 01's 86/18/5/8 exactly;
zero closure violations in the published cut). Re-verify any change to the
cut with `python graph-check.py` in this directory.

## Owner rulings baked into these tickets (2026-08-19)

- **R1 / D16 DECIDED**: visual/behavioral comparison against sparkjs-toolkit
  CONTINUES (H-GRADE, H-VISUAL, H-PICK, H-EDIT, H-OPTICS as written). Number
  comparison stays retired (ADR 0003, decision 1 tightened same day).
- **R2**: the embed set defers to Phase 2 — SplatSiteElement, FragmentRouter,
  register, diagWiring.stub (4 of the 86 COPY files) plus SiteRuntime and
  diagWiring re-typing, plus StatsHUD, SplatBounds, SplatLoader. Phase 1
  copies 82 of the 86.
- **R3 / D19 DECIDED**: ui/SplatTextMesh ships as an API-preserving typed
  STUB in ticket 05; Phase 4 deletes-and-replaces it.
- **R4**: diag/SparkPagerAdapter.ts is carried through Phase 1 unmodified;
  Phase 2 deletes it (doc 03 section G).
- **R5 (2026-08-20)**: the COPY source is sparkjs-toolkit's **working tree as
  on disk**, not its last commit. Grounds: doc 01's inventory was scanned
  2026-08-14 from disk (the uncommitted changes there date from Aug 7, so
  every line count and import edge in the plan already includes them), and
  the Phase 0 Spark control ran the disk state — the last commit is a state
  the plan never measured. Every copying ticket (03–09) records the SHA-256
  of each file at copy time in its Comments: that pins the bytes even though
  a working tree can't be pinned by a commit hash. Rule 1 still binds in
  full — never write to sparkjs-toolkit.

## Standing rules (every ticket, every agent — restated because contexts start cold)

1. D:\Projects\sparkjs-toolkit is PERMANENTLY READ-ONLY. Copy from it; never
   write to it.
2. Never commit — the owner commits, explicitly, per instance.
3. `npm run check` (typecheck + lint:boundaries + both vite builds; builds
   folded in by owner ruling 2026-08-19, ticket 01) must be green at the end
   of every ticket. The boundary rules are architectural law (doc 02 rule 2).
4. No Spark NUMBER comparisons, ever (ADR 0003/D16). Visual comparison per D16.
5. COPY files land byte-identical (verify with diff); every deliberate
   divergence is declared in the ticket's Comments — an undeclared improvement
   is indistinguishable from a bug.
6. Placeholders are deleted-and-replaced, never left beside real code
   (D18/D19 pattern).
7. Verify before you claim: run the check, look at the output, then speak.
8. If a decision the plan docs do not settle unambiguously appears, STOP and
   ask the owner (repo rule 11). Ticket 11 contains one known such stop.

## Deferred out of Phase 1 (explicit, so nobody "helpfully" pulls them in)

- Phase 2: embed set (above) + StatsHUD + SplatBounds + SplatLoader;
  SparkPagerAdapter deletion; the SplatBackend seam (replaces the D18
  placeholder src/backend/index.ts); WASM worker bundling in vite configs.
- Phase 3: CropTool, SceneComposer, SplatHighlight, DebugPanel.
- Phase 4: SplatExporter, real SplatTextMesh (replaces the D19 stub).
- core/SparkScene.ts is never copied — ticket 03's ThreeSplatScene replaces it.

## Ticket map (blockers; frontier: 01 unlocks 02, 03, 04, 07 in parallel)

01 scaffold -> 02 fork | 03 scene | 04 foundation | 07 diag
04 -> 05 text+markers -> 06 author-ui
03+04 -> 08 periphery | 09 media-layer | 10 scene-grade (GATE)
all clusters -> 11 barrel
