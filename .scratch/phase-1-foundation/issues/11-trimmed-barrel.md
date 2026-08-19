# 11 — The trimmed API barrel

**What to build:** `src/index.ts` exporting every landed module under its
sparkjs-toolkit name — the API-parity barrel in its honest Phase 1 form.
The graph proves a full same-names barrel is impossible until Phase 4
(13 of its 65 sources are Phase 2/3/4 files), so this barrel is TRIMMED and
each later phase restores its names. Read `../spec.md` first.

**Blocked by:** 03, 04, 05, 06, 07, 08, 09, 10

**Status:** ready-for-agent

- [ ] Every module landed by tickets 03-10 is exported under the same name
      sparkjs-toolkit's barrel uses
- [ ] The 13 deferred sources are listed IN THE FILE with their returning
      phase (P2: SiteRuntime, diagWiring, SplatSiteElement, FragmentRouter,
      StatsHUD, SplatBounds, SplatLoader; P3: CropTool, SceneComposer,
      SplatHighlight, DebugPanel; P4: SplatExporter, SplatTextMesh) — so the
      trim is visible, not silent
- [ ] **KNOWN STOP (repo rule 11):** sparkjs-toolkit's barrel exports
      `SparkScene`; this toolkit's class is `ThreeSplatScene`. Whether the
      barrel exports it under the old name (D12 strict source compatibility,
      H-API) or the new one is an owner decision — ASK before closing this
      ticket; do not pick a reading
- [ ] `npm run check` green; `python ../graph-check.py` passes
