# 11 — StatsHUD + SplatBounds fed from backend counters

**Status:** ready-for-agent
**Blocked by:** 07 — LOD/selection (selected counts exist); 09 — SiteRuntime
(the consumers run in the real runtime).

**What to build:** the on-screen stats and the scene's reported bounds tell the
truth about a streaming scene — total/resident/selected counts and
resident-aware bounds. Owner ruling: percentile clamping stays Phase 4 (doc
04:144); bounds here are verified against ground truth, not smoothed.

Standing rules bind (spec.md).

- [ ] StatsHUD's numbers track an independent read of the pager's public counters
      across a load + eviction cycle, both backends.
- [ ] `bounds()` on a partially resident hero equals the independent union of the
      resident pages' extents at each sampled moment (bounds may legitimately
      EXPAND as outlying pages arrive — no "tightens" assumption).
- [ ] No consumer reaches past the seam for any counter (boundary lint green).
