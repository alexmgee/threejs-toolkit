# 04 — Foundation cluster: domain base + camera + SiteConfig hub

**What to build:** the compile-closed foundation everything else stands on —
the renderer-agnostic domain model, the camera family, and the SiteConfig hub
(imported by 24 other files). 32 files / ~13,243 lines, graph-verified closed.
Read `../spec.md` first; re-verify closure with `python ../graph-check.py`
after any scope change.

**Files:** all of `cells/` (9), all of `rules/` (9 — Channels and RuleModel are
a cycle, land together), all of `locative/` (2), `site/AnnotationMeta`,
`text/TextModel`, `text/FontRegistry`, `core/LoadingUI`, `render/AudioPlayer`,
`core/CameraSystem` + `core/CameraPath` + `core/CameraRail` + `core/ScrollRail`,
`site/SiteConfig`, `site/HotspotSeeder`, `site/InteractionsImport`.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Every COPY file byte-identical to its sparkjs-toolkit source (`diff` empty)
- [ ] `core/CameraSystem.ts` is the one adapted file: its spark-value import is
      removed and the picking/recenter dependency left explicitly dead with a
      doc 03 section B citation (the seam returns as `backend.raycast()` in
      Phase 3); every other behavior untouched; the divergence declared in
      Comments
- [ ] The PLACEHOLDER `src/core/index.ts` is DELETED as the real core files
      land — never left beside them
- [ ] `vite.config.ts` is REPOINTED off `src/core/index.ts` when that file is
      deleted (owner ruling 2026-08-19, ticket 01) — the site build's scaffold
      entry dies with this ticket, and `npm run check` now runs both builds,
      so leaving it stale fails the gate loudly
- [ ] The camera-rail parity fixture (from sparkjs-toolkit examples) is copied
      and runs — it needs no splats
- [ ] `npm run check` green
