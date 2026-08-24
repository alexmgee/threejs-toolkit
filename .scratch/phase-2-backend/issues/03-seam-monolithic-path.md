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

## Comments

**Note from ticket 02 (2026-08-23, citation corrected same day by review),
binding on this ticket's PLY loader:** raw 3DGS `.ply` stores opacity as
LOGITS — Spark's PLY reader applies the sigmoid at load:
`reference/spark/src/ply.ts:553-555`, `op = 1/(1+exp(-opacity))` (no clamp).
Do NOT copy ply.ts:673 — that is the INVERSE (write-side logit for
injectRgba) despite its "sigmoid" comment; applying it at load turns
opacity 2 into NaN. The `.rad` container is linear-alpha (doc 03 A1,
corrected); the read-side sigmoid belongs HERE, applied exactly once.
