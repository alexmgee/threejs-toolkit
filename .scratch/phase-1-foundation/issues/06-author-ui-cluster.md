# 06 — Author UI cluster

**What to build:** the authoring panel and its inspector/tab family,
compile-closed given 04 and 05. The panel opens standalone against a
SiteConfig fixture. 23 files / ~8,085 lines. Read `../spec.md` first.

**Files:** all of `site/authorui/` (plus the `tokens.css` asset for the `?raw`
import), `site/AuthorPanel`, `site/AuthorGizmo`, `site/authorPanelTypes`.

**Blocked by:** 04, 05

**Status:** ready-for-agent

- [ ] Every COPY file byte-identical; `site/AuthorGizmo`, `site/authorPanelTypes`
      and `site/authorui/textInspector` (the three-only files) carry only their
      doc 01 adaptations ("three math/types only; near-COPY"), declared in
      Comments
- [ ] The `tokens.css` asset is copied and the `?raw` vite import resolves
- [ ] The author panel opens against a SiteConfig fixture and its tabs render
      (no scene required; SceneComposer wiring is Phase 3)
- [ ] `npm run check` green
