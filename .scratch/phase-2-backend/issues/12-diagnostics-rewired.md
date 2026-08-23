# 12 — Diagnostics rewired (§G); Spark-era instruments deleted for good

**Status:** ready-for-agent
**Blocked by:** 07 — the pager surface is complete; 09 — diagWiring.stub landed.

**What to build:** the diagnostics that produced the original tuning wins run
against our own pager's PUBLIC counters — no monkey-patching — and ~4,300 gross
lines of Spark-shaped instrumentation leave the tree (doc 03 §G; doc 04 "left
behind for good"; the SparkPagerAdapter deletion doc 04/handoff 004 name
explicitly).

Standing rules bind (spec.md).

- [ ] SparkPagerAdapter (1,362 lines) and the pager-internal halves of LoadProbe /
      diagWiring / LaggardMapper are deleted; gate green with no re-stub left
      behind; gross line count of the deletion recorded.
- [ ] NetworkObserver, LoadRecord, sinks, fixtures, and FrameDiffValidator produce
      a complete record of a real hero load, both backends.
- [ ] The CPU-budget denominator is fed from RadPager and shown non-zero on a real
      load, OR the budget feature is deleted — a silently self-disabled third
      state fails this ticket (§G trap).
- [ ] The deferred `phase7-runtime-consent` assertion un-defers with diagWiring and
      passes; the selfTest count is re-baselined and stated in Comments.
