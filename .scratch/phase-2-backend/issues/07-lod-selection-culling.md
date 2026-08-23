# 07 — LOD traversal, selection, and culling

**Status:** ready-for-agent
**Blocked by:** 06 — page residency.

**What to build:** the hero shows the right splats at the right detail as the
camera moves — LOD tree traversal per camera into a selected set, carried to the
GPU via `center.w` flags with a SELECTION-AWARE `setBinNode` bin function (the
spike audit confirmed the spike's ignores `center.w`; deselected splats must
collapse out of draw order, not just out of the vertex node), plus frustum culling
driven by page AABBs. Owns selection-change invalidation. Second fork patch.

Standing rules bind (spec.md).

- [ ] Selected splat count at a pinned test pose is identical across five trials
      (any variance is a bug), both backends.
- [ ] Rendered output at the pinned pose is pixel-stable across trials of the same
      regime; if strict stability is unachievable, the measured diff band is
      recorded, never passed silently.
- [ ] A selection change with the camera motionless updates visible draw order —
      demonstrated (spike criterion 10), not asserted.
- [ ] Turning culling off restores the pre-ticket frame content exactly (culling
      changes cost, never content).
- [ ] FORK.md titled patch entry in the same change; H-FORK re-run stays
      pixel-identical with the new features off.
