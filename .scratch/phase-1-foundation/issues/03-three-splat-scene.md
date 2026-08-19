# 03 — ThreeSplatScene: a plain mesh scene on both backends

**What to build:** the scene facade that replaces SparkScene for this toolkit.
A plain three.js mesh scene renders under it on WebGPU AND on the forceWebGL
fallback — Phase 1 exit criterion (b). Read `../spec.md` first.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] WebGPURenderer constructed behind the sync-facade + ready-promise pattern
      (doc 04 Phase 1 item 3); `workingColorSpace = SRGBColorSpace`
- [ ] Tone-mapping and background choices match SparkScene's (read them from
      sparkjs-toolkit `src/core/SparkScene.ts` — reference only, never modify);
      any deliberate divergence is declared in Comments
- [ ] A plain mesh scene demo renders on BOTH backends, verified by screenshot
      or readback (hidden-pane discipline: doc 05 ground rule 5)
- [ ] No splat code, no pager code — that is Phase 2
- [ ] `npm run check` green
