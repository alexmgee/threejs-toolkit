# 0002 — Composed splat objects stay disjoint; merge-at-load recovers static overlap

Date: 2026-08-15
Status: accepted

## Decision

threejs-toolkit accepts the upstream ceiling that overlapping splat objects blend
incorrectly (per-mesh private sorts; no cross-mesh ordering at any level). Response:

1. **Constrain now**: composed objects must remain spatially disjoint. SceneComposer
   warns when bounding regions intersect. The parity harness keeps an overlap fixture
   (H-COMPOSE) so the artifact stays visible, never theoretical.
2. **Merge-at-load later** (Phase 4+): a finalized static composition may be baked
   into one splat geometry at load — one mesh, one sort, correct blending. Costs
   accepted: per-object live manipulation ends after merge; per-object recolor rides
   the edit-mask lanes.
3. Unguarded overlap (ship the popping, author beware) was rejected as a trap.

## Context

Owner (2026-08-15): option (a)+(c) "is fine with me. ideally it won't ever be an issue
because I'll be combining those things somewhere else into one splat" — i.e. the
primary path is combining scenes upstream in the training/prep pipeline, making
in-toolkit overlap rare by workflow, not just by rule.

Watch item 7 (upstream global sorting) would dissolve this ADR; prefer deleting the
constraint over keeping it if that lands.
