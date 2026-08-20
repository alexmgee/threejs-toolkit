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

**Status:** ready-for-agent

> D21 RULED (2026-08-20, doc 06): guard lifted. sparkjs-toolkit is committed
> and clean (drift in `59b65cf`, golden rebaseline `862b9eb`); Phase 2's
> re-sync input is the ticket-04-SHA-inventory-vs-`59b65cf` diff.

- [ ] Every COPY file byte-identical; the three-only files carry only their
      doc 01 renderer adaptations, each declared in Comments
- [ ] **D19 stub**: `ui/SplatTextMesh` lands as an API-preserving typed STUB
      whose constructor throws with an explicit "rebuilt in Phase 4 (doc 03
      section E)" error — so `text/SplatLane.ts` compiles UNCHANGED. The stub
      is tracked by doc 06 D19: Phase 4 deletes-and-replaces it
- [ ] The text fixture (from sparkjs-toolkit examples) runs its non-splat
      lanes; the splat-lane path fails loudly with the stub's error, not
      silently
- [ ] `npm run check` green
