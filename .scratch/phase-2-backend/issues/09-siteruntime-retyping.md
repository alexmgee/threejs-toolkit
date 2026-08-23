# 09 — SiteRuntime re-typing: registration, teardown, D24 rename

**Status:** ready-for-agent
**Blocked by:** 01 — DisplayChannel (this ticket lands the rules runtime's first
live consumer); 04 — dispose (teardown needs it); 08 — the element + contract.

**What to build:** the production runtime orchestrates a real site end to end on
the new backend: meshes register through the seam, teardown disposes through it,
and consumers name `ThreeSplatScene` rather than `SparkScene` (D24 — the loud
one-line edit). This is where the latent semantic changes finally meet a live
runtime — they must be PROVEN, not assumed. Owns the `diagWiring.stub` pin-copy.

Standing rules bind (spec.md). Owner ruling: MediaLayer anisotropy STAYS at parity
(1); `getMaxAnisotropy()` is recorded as a post-parity improvement candidate in
ticket 13's carried-forward list, not changed here.

- [ ] A real site.json drives SiteRuntime through load, navigation, and teardown on
      both backends; teardown leaves nothing resident (H-LIFE at runtime scope,
      numbers in Comments).
- [ ] Latent throw (a): an authored `annotation-<id>-copy` block id throws at
      `normalizeSiteConfig`, shown with a runtime case plus a passing control.
- [ ] Latent throw (b): duplicate show-blocks effects throw at RuleModel
      validation, shown with a runtime case plus a passing control.
- [ ] Authored `lifetime` behavior (ticket 01's re-sync) re-confirmed under the
      full runtime, both backends.
- [ ] H-API consumer fixture compiles against both toolkits and records the
      `SparkScene`→`ThreeSplatScene` divergence as expected (D24), not a failure.
- [ ] `diagWiring.stub` pin-copied; SHA in Comments.
