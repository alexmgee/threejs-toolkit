# 08 — Scene periphery: environment, colmap, frustum, controls, props

**What to build:** the scene-adjacent renderer files working under
ThreeSplatScene on both backends. 5 files / ~1,705 lines.
Read `../spec.md` first.

**Files:** `core/EnvironmentLoader` (async PMREM on WebGPU — doc 01),
`core/ColmapData`, `core/FrustumRenderer`, `core/Controls`,
`render/PropLayer` (zero changes expected — doc 01 lists it for re-verification
only).

**Blocked by:** 03, 04

**Status:** ready-for-agent

- [ ] EnvironmentLoader's SparkScene import re-pointed to ThreeSplatScene; the
      PMREM path awaited (async on WebGPU) and an environment map loads on
      both backends. NOT a type-swap-only port (ticket 03 review, corrected):
      (a) PMREMGenerator must come from three/webgpu, not core three — the
      core class calls WebGL-only renderer methods; (b) the facade freezes
      canvas `alpha` at construction and does not retain the original
      background — adapt setShowBackground/clear()'s restore contract
      accordingly; (c) await `scene.ready` before PMREM work
- [ ] PropLayer lands byte-identical (zero changes) and a prop mesh renders in
      the plain scene on both backends
- [ ] ColmapData / FrustumRenderer / Controls carry only their doc 01 minor
      renderer-API adaptations, declared in Comments
- [ ] The rail fixture's inline bootstrap (examples/rail/main.ts) is REPLACED
      by ThreeSplatScene and the fixture re-verified on BOTH backends; the
      antialias/pixelRatio divergence notes in ticket 04's Comments are
      resolved at that moment (owner ruling 2026-08-20 at ticket 03 start,
      settling ticket 04's "ticket 03's or 08's business" either/or).
      NOTE (ticket 03 review): the repoint also flips the rail page into the
      toolkit's sRGB working space (importing ThreeSplatScene pulls
      core/colorSpace.ts; the page currently renders in three's default
      linear) — marker/background pixel values change vs any pre-repoint
      captures. Declare it; re-pin any recorded observations.
- [ ] `npm run check` green
