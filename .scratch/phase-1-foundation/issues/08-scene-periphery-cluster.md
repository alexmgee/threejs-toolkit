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
      both backends
- [ ] PropLayer lands byte-identical (zero changes) and a prop mesh renders in
      the plain scene on both backends
- [ ] ColmapData / FrustumRenderer / Controls carry only their doc 01 minor
      renderer-API adaptations, declared in Comments
- [ ] `npm run check` green
