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

## Comments

**Inherited from ticket 05 (owner rulings 2026-09-02):**
- This ticket REPLACES the `rad-refused` named refusal in ThreeGsBackend
  with the real paged path (correction to handoff 006, recorded in ticket
  05's Comments) — the fetch+decode slice arrives as `RadPager` +
  `DecodePool` + `RadFetcher` from 05.
- **SH-degree dispose gap (ticket 04 F7 residual) lands HERE:** once a paged
  mesh with SH bands is uploaded, place the assertion — dispose with SH
  bands + contribution buffer live, union counters exactly back to baseline.
- Reveal-policy question deferred from 05: whether a load with EVERY chunk
  unavailable counts as failed at the seam (05's pager resolves with the
  shortfall report either way).
- **DecodePool contract for reuse (ticket 05 built-in review, 2026-09-02):**
  `pool.jobs` is unbounded evidence — bound or snapshot it before session-
  length re-decode reuse; a pool whose `broken` getter is non-null has
  terminated its workers and rejects every decode with that error — the
  owner recreates it (no self-heal by design). A worker `fatal` reply
  (WASM init failure or a trap) is a pool failure, never a page failure.
