# 13 — Phase 2 exit: H-LOAD re-run, H-LIFE, real-site end-to-end

**Status:** ready-for-agent
**Blocked by:** 11, 12 (05–10 are transitive through them).

**What to build:** the evidence that closes Phase 2 — the production runtime
measured against the spike's own numbers, both backends, both regimes. A PURE
evidence ticket: it should discover nothing new; if it does, the GATE has done its
job (regression ⇒ the integration, not the concept, is at fault — find it before
anything stacks on top).

Standing rules bind (spec.md). No time estimates; absolute numbers only (no Spark
comparisons — the spike's own numbers are the bar).

- [ ] H-LOAD's ten criteria re-run on the production runtime: five cold-cache
      trials per backend per regime, results written to a results doc under
      docs/plan/results/ as absolute numbers; the visual criterion carried as a
      picture check at the pinned pose (D16).
- [ ] Production figures match or beat the spike's; any regression is diagnosed as
      an integration fault and NAMED before the phase closes.
- [ ] H-LIFE ×10 on the full element with a real site.json — heap flat across
      cycles, scene-swap under a live element included.
- [ ] Phase 0's carried-forward improvement items — including the MediaLayer
      `getMaxAnisotropy()` candidate (owner ruling at breakdown) — each answered
      with a number: improved, unchanged, or explicitly deferred with grounds.
- [ ] Upstream watch list (doc 06) re-checked at the boundary, including
      `npm view three version` dated; anything landed answered with "delete our
      code" or a recorded reason not to.
