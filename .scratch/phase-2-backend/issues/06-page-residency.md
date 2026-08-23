# 06 — Page residency: budget, LRU, uploads, invalidations

**Status:** ready-for-agent
**Blocked by:** 05 — fetch + decode pool.

**What to build:** decoded pages become resident and visible under a device-classed
page budget with LRU eviction and partial-range buffer uploads. Owns the two
explicit invalidations review flagged as missing from every naive design — nothing
updates by itself: a page upload or selection change marks sort dirty
(`updateSort`), and SH is re-dispatched for pages arriving under a MOTIONLESS
camera. Owns completed-work progress (bytes fetched + pages decoded + pages
first-uploaded — monotonic by construction, NEVER residency).

Standing rules bind (spec.md). LOD selection is ticket 07 — in this slice
everything resident is shown.

- [ ] Page budget derives from a device memory class at runtime and holds exactly
      at 32 under the `?pages=32` measurement regime; no allocation failure in
      either regime, both backends.
- [ ] A page arriving under a motionless camera becomes visible, with sort and SH
      explicitly re-dispatched — the invalidation path shown, not assumed.
- [ ] Progress is computed from completed work, monotonic through a full eviction
      cycle — sampled as a tripwire and satisfied by construction.
- [ ] Revisiting the initial pose under `?pages=32` restores the same visible
      result (eviction correctness), both backends.
