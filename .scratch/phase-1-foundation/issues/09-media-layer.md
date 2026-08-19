# 09 — MediaLayer: fix the capabilities throw, re-measure the colour baseline

**What to build:** image/video planes render in-scene on both backends, and
the colour baseline is measured fresh under the new global colour space —
Phase 1 exit criterion (c). Read `../spec.md` first.

**Blocked by:** 04 (compiles), 03 (the measurement needs a running scene)

**Status:** ready-for-agent

- [ ] The throwing bug fixed: `renderer.capabilities` does not exist on
      WebGPURenderer and the optional chain sits on the wrong object (doc 01,
      MediaLayer lines ~67-70) — fix the chain, declare the change in Comments
- [ ] Media planes render under ThreeSplatScene on BOTH backends
- [ ] The colour baseline is RE-MEASURED (not inherited): readback numbers
      recorded in `docs/plan/results/` as this toolkit's own baseline —
      an absolute record per ADR 0003, not a comparison
- [ ] `npm run check` green
