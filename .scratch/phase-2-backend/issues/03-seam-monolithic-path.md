# 03 — SplatBackend seam + ThreeGsBackend + monolithic SPZ/PLY path

**Status:** ready-for-agent
**Blocked by:** None — can start immediately.

**What to build:** a small `.spz`/`.ply` scene loads and renders through the real
SplatBackend seam (doc 02 interface) on both backends — the first end-to-end splat
on the production runtime. The D18 backend placeholder is DELETED-AND-REPLACED,
never left beside real code. This ticket owns MONOLITHIC-path readiness
(`whenReady` resolves on first paint); paged readiness belongs to ticket 08 — the
two definitions must not be invented twice.

Standing rules bind (spec.md). Owner D23 ruling applies here: the seam becomes
load-bearing in this ticket.

- [ ] A fixture loads a small static asset via `backend.load()` and renders it on
      WebGPU and `?webgl=1`; screenshots at a pinned pose in Comments.
- [ ] `counts()` and `bounds()` match an independent CPU read of the same asset
      (bounds per-point, not 8-corner `applyMatrix4`).
- [ ] `whenReady()` resolves after first paint; `progress()` is monotonic across
      the load.
- [ ] Boundary guards (owner D23 ruling): the vendor→src / fork-internals rule is
      added to the boundary config and a deliberate violation fails the gate;
      src→examples and spikes-uncruised are recorded accepted-unguarded with
      reasons in Comments; examples→src/backend recorded open-by-design.
- [ ] The existing seam rule still holds: a deliberate outside-the-seam import of
      the fork fails the gate.
- [ ] The D18 placeholder's old exports are gone from the tree, not deprecated in
      place.
