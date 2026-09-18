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

## Comments

**Inherited from ticket 09 (owner ruling Stop 1, A2, 2026-09-17) — this ticket owns a
temporary note and a skipped call.** Ticket 09 lands the REAL `src/embed/diagWiring.ts`
(one declared line change: the Spark `SplatMesh` type import repointed at the backend's
type) with `diagWiring.stub.ts` byte-identical beside it; ticket 09 was the first ticket to
own the real file (plan-review gap, recorded in ticket 09's Comments). Because the real
file's paged-scene attach polls for a Spark `mesh.paged.pager` that this backend never has
(pin `diagWiring.ts:125-126`, `:228-237` — 200 ms polls for 30 s, then a silent give-up),
SiteRuntime SKIPS the pin's `loadTelemetry?.registerPagedScene(...)` call
(`fd67153:src/embed/SiteRuntime.ts:2389-2394`) and prints ONE named note in author mode
instead. **What this ticket's rewire replaces:** that skip and that note. The rewire
restores paged-scene registration against this backend's public pager counters and deletes
the note in the same change. A note that outlives the rewire fails this ticket — the same
class as AC3's silently self-disabled third state. The note's exact text and site are
recorded in ticket 09's Comments once built.

**Also inherited from ticket 09 (owner rulings, 2026-09-17):**
- **`markSceneFirstSplatReady` (Stop 5).** The pin called
  `loadTelemetry?.markSceneFirstSplatReady(entry.id, numSplats)` at a paged scene's first
  coarse splat, inside the reveal gate ticket 08 replaced (`fd67153:src/embed/SiteRuntime.ts:2518`,
  reading Spark's `numSplats`). Real telemetry ignores unregistered scenes (pin
  `diagWiring.ts:245-246`) and A2 registers none, so ticket 09 skips the call with the
  registration. This ticket restores it with the rewire, fed from the backend.
- **Throttle revisit (Stop 4f, doc 06 D29 item 1).** Ticket 09 carries the docked-idle render
  throttle with a seam-read refinement guard: a paged scene counts as still refining while
  `progress().fraction < 1`. Under a constrained page budget that fraction never reaches 1, so
  capped sites never throttle. The pin read "resident < wanted" from Spark pager internals; the
  equivalent signal here would pass through the diagnostics door this ticket shapes. This
  ticket NOTES whether its door makes a seam-legal "wanted" signal available; it does not
  build one. Ticket 13's idle-power / H-LOAD evidence decides whether that signal (T2) is ever
  warranted.
