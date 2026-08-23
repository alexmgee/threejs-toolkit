# 11 — The trimmed API barrel

**What to build:** `src/index.ts` exporting every landed module under its
sparkjs-toolkit name — the API-parity barrel in its honest Phase 1 form.
The graph proves a full same-names barrel is impossible until Phase 4
(13 of its 65 sources are Phase 2/3/4 files), so this barrel is TRIMMED and
each later phase restores its names. Read `../spec.md` first.

**Blocked by:** 03, 04, 05, 06, 07, 08, 09, 10

**Status:** done

> AC added at ticket 03 close (owner-reviewed design, D-trail in ticket 03
> Comments): the barrel's FIRST import is `./core/colorSpace` — the
> toolkit's sRGB working-space opt-in is a side-effect module, and a
> consumer deep-importing only cells/ or text/ through the barrel must
> still get it before any THREE.Color construction.

- [x] Every module landed by tickets 03-10 is exported under the same name
      sparkjs-toolkit's barrel uses (51 exported sources + the colorSpace
      side-effect import; the scene export awaits the owner stop below;
      DisplayChannel exports its LANDED old-vintage surface — 4 pin-only
      names return with Phase 2's re-sync, declared in the file)
- [x] The 13 deferred sources are listed IN THE FILE with their returning
      phase (P2: SiteRuntime, diagWiring, SplatSiteElement, FragmentRouter,
      StatsHUD, SplatBounds, SplatLoader; P3: CropTool, SceneComposer,
      SplatHighlight, DebugPanel; P4: SplatExporter, SplatTextMesh) — so the
      trim is visible, not silent
- [x] **KNOWN STOP (repo rule 11):** sparkjs-toolkit's barrel exports
      `SparkScene`; this toolkit's class is `ThreeSplatScene`. Whether the
      barrel exports it under the old name (D12 strict source compatibility,
      H-API) or the new one is an owner decision — ASK before closing this
      ticket; do not pick a reading (OWNER RULED 2026-08-23, doc 06 D24:
      ThreeSplatScene under its OWN name, no alias — grounds in D24; the
      export shipped with the ruling)
- [x] `npm run check` green (exit 0); `python graph-check.py` passes
      (files: 119 | violations: 0 | unassigned: 0)

## Comments

**2026-08-23 (execution session):**

Built as `src/index.ts`, mirroring sparkjs's barrel at pin `fd67153` line
for line. FIRST import is `./core/colorSpace` (the owner-reviewed AC from
ticket 03 close). The 13 deferred sources are documented IN THE FILE with
their returning phases; the OWNER STOP is documented in the file header
too — NO scene export ships until ruled.

Declared divergences from the pin's barrel:
1. The `SparkScene` line is OMITTED pending the owner ruling (the file
   carries the stop marker).
2. The 13 deferred-source lines are omitted, each documented in-file.
   `ui/SplatTextMesh` is listed P4 with a note: the D19 stub exists
   in-tree for SplatLane's compile, but its barrel name returns with the
   Phase 4 rebuild — a throwing constructor is not a public API.
3. The DisplayChannel line exports the LANDED (ticket-04 vintage, D21
   third note) surface: showBlocks, shownBlockIds, EMPTY_DISPLAY_CHANNEL,
   DisplayChannelState, DisplayClaim. The pin's endOnTravel/dismissAll/
   endStaleWhile/endOrphanedClaims belong to the NEW DisplayChannel and
   return with Phase 2's re-sync (which the D21 note orders first).
   Declared in the file at the line.
4. `sideEffects` hazard check (handoff 003 wider context): package.json
   declares NO `sideEffects` field — bundlers therefore assume side
   effects and PRESERVE the colorSpace import. If a `"sideEffects":
   false` is ever added, `./src/core/colorSpace.ts` must be exempted or
   the sRGB opt-in silently tree-shakes away.

Counts: 52 unique source modules referenced (51 exported + colorSpace),
consistent with the ticket arithmetic (65 − 13 deferred − 1 scene export
pending). Gate green (exit 0, redirect-then-`$?`); graph-check
`files: 119 | violations: 0 | unassigned: 0`.

**2026-08-23 — adversarial review, Opus round:**
- Name parity: none — mechanical diff: sparkjs 337 names / 65 sources vs
  ours 252 / 51; the 85-name delta is EXACTLY SparkScene+SparkSceneConfig,
  the 4 declared DisplayChannel names, and the 13 deferred sources' names.
  Zero extra names, zero path or modifier mismatches. 51+13+1=65.
- colorSpace-first: none — first module request in the file; no
  sideEffects field so bundlers preserve it. Opus also CLEARED the
  split-singleton hazard it suspected (three vs three/webgpu
  ColorManagement): a runtime node check proved both entries share one
  object.
- Deferred inventory: none — all 13 match graph-check.py's phase
  assignments; only SplatTextMesh is in-tree, declared as the off-barrel
  D19 stub.
- CONFIRMED, DECLARED (the one finding): `npm run build` never compiles
  the barrel (it is a pages build; the barrel is the lib surface), so the
  sideEffects/tree-shaking note is verified REASONING, not build-proven —
  typecheck covers the barrel (tsconfig includes src), boundaries pass
  (135 modules, no cycles; nothing imports the barrel), graph-check 0/0.
  The bundling proof arrives with Phase 2's packaging work.

**2026-08-23 — gpt5.6-sol (high) round:** name parity none; deferred
inventory none; command claims none (it reproduced typecheck/boundaries/
builds read-only). Its ONE finding — "absent sideEffects metadata does not
prevent Rollup statement-level elimination of the colorSpace import" — was
REFUTED BY EXECUTION: a scratchpad lib-build bundling ONLY CameraRail from
the barrel (vite 6 / rollup, minify off, three externalized) emits
`ColorManagement.workingColorSpace = SRGBColorSpace` in the output
(grep count 1). Rollup's default moduleSideEffects preserves bare
side-effect imports, and the property write on an external module is not
eliminable. This also UPGRADES Opus's "bundling half unproven" caveat to
build-proven for the tree-shaking question specifically (the full lib
packaging remains Phase 2 work).

**2026-08-23 — grok-4.6 round:** none in all four categories. It
independently re-verified: export-by-export parity, first-import ESM
ordering (esbuild emit + native [[RequestedModules]] both source-order;
absent sideEffects ≠ false, bare imports kept — agreeing with the
execution-refutation of the codex claim), the 13-item inventory against
graph-check's phase map (noting register/diagWiring.stub are Phase 2 COPY
files, not barrel sources — correctly omitted), the 52/51/65 arithmetic,
graph-check 0/0, and boundaries (135 modules, 404 deps, clean).

**2026-08-23 — owner ruling received (D24):** ThreeSplatScene exports under
its own name, no alias; the scene-export line and header note shipped in
the barrel; grounds recorded in doc 06 D24. Ticket closed.
