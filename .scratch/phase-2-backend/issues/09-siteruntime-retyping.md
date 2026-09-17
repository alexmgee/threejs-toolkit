# 09 — SiteRuntime re-typing: registration, teardown, D24 rename

**Status:** ready-for-agent
**Blocked by:** 01 — DisplayChannel (this ticket lands the rules runtime's first
live consumer); 04 — dispose (teardown needs it); 08 — the load/reveal contract in the rebuilt
SplatLoader (the element itself lands HERE since ruling 08-S0).

**What to build:** the production runtime orchestrates a real site end to end on
the new backend: meshes register through the seam, teardown disposes through it,
and consumers name `ThreeSplatScene` rather than `SparkScene` (D24 — the loud
one-line edit). This is where the latent semantic changes finally meet a live
runtime — they must be PROVEN, not assumed. Owns the `diagWiring.stub` pin-copy
and — since owner ruling 08-S0 (2026-09-13) — the other three embed pin-copies
(SplatSiteElement, FragmentRouter, `register`), the element's H-API event proof,
and the embed-entry switch.

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
- [ ] SplatSiteElement, FragmentRouter, and register are byte-identical to the pin;
      SHAs in Comments, hashed on the destination tree. (MOVED from ticket 08 by
      owner ruling 08-S0, 2026-09-13.)
- [ ] The event sequence and payload shapes on a fixture site.json match
      sparkjs-toolkit's on the same file (H-API row), both backends — the sparkjs
      side from a pinned-file snapshot of `fd67153` exported to a scratch dir,
      sparkjs untouched. (MOVED from ticket 08 by owner ruling 08-S0.)
- [ ] The embed build's entry switches to `src/embed/register.ts`; the bundle size is
      measured and the work STOPS for the owner's new size bound — never raised by
      an agent. (MOVED from ticket 08 with ruling 08-S0.)

## Comments

**Inherited from ticket 08 (owner rulings 2026-09-13):**
- **S0 moved the embed set and the element's event proof here.** Evidence: the
  pinned element cannot run without SiteRuntime — `fd67153:src/embed/
  SplatSiteElement.ts:25` imports `createSiteRuntime`/`resolveSiteAssets`;
  `ready`/`loadprogress` fire only from runtime callbacks (`:1006-1017`);
  SiteRuntime owns the gate (`SiteRuntime.ts:748-769`, `:2432-2606`) and imports
  five files absent at 08's start (`core/SplatLoader`, `core/SparkScene`,
  `embed/diagWiring`, `interact/SplatHighlight`, `core/SplatBounds`).
- **One reveal/progress policy lives in ticket 08's rebuilt SplatLoader** (ruling
  S1: reveal = the seam's paint-observed ready; true fraction until reveal, then
  exactly 1 once). The pin's `checkSceneVisibility` gate (`:2432-2606`, 11
  constants, residency-read) is NOT carried as a second definition; doc 06 D26
  keeps it only as a reference for a future product revisit.
- **A whole-load failure after first paint reaches the loader's consumer as a
  named failure** (ruling S2, fixed in 08) — SiteRuntime routes it to
  `onLoadError`, which the element turns into `loaderror` (its existing
  failure-after-ready path, `SplatSiteElement.ts:705-720`).
- The conditional 180° X-flip is applied by the rebuilt SplatLoader (pin
  `SplatLoader.ts:81-88`); SiteRuntime passes `def.eulerRotationDeg` through as
  the pin does (correction to handoff 007 recorded in ticket 08).
