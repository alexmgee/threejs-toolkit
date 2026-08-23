# 08 — Load/reveal/ready contract (§A5) into the untouched SplatSiteElement

**Status:** ready-for-agent
**Blocked by:** 03 — seam; 06 — residency + progress.

**What to build:** `<splat-site>` — pin-copied VERBATIM, together with the other
deferred Phase 1 embed copies (FragmentRouter and `register`; doc 04:23 lists all
four, `diagWiring.stub` rides ticket 09) — reveals a paged scene progressively and
fires `whenReady` / `onReady` / `onLoadProgress` with the same shapes as
sparkjs-toolkit, driven by the rebuilt SplatLoader over the seam. Owns PAGED
readiness (ticket 03 owns monolithic first-paint readiness — one contract, two
paths, no duplicate definitions).

Standing rules bind (spec.md): copies via `git show fd67153:<path>`; every
adaptation lives behind the seam, none in the copied element.

- [ ] SplatSiteElement, FragmentRouter, and register are byte-identical to the pin;
      SHAs in Comments, hashed on the destination tree.
- [ ] The event sequence and payload shapes on a fixture site.json match
      sparkjs-toolkit's on the same file (H-API row), both backends.
- [ ] Reveal fires on progress thresholds plus first-paint confirmation, never on a
      residency-derived number; forcing eviction mid-load does not un-reveal.
- [ ] A load with pages marked unavailable (ticket 05 semantics) still reveals and
      reports the shortfall — nothing wedges.
