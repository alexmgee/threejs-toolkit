# 10 — SceneGrade on node PostProcessing + TSL — THE PHASE GATE

**What to build:** colour grading (contrast/tint/vignette) rebuilt from
EffectComposer (WebGL-only) onto node PostProcessing + TSL — the largest
single adaptation of the phase (doc 01: 486 lines; doc 04: the GATE).
Exit is H-GRADE: side-by-side visual approval against sparkjs-toolkit —
a VISUAL comparison, which D16 (2026-08-19) explicitly preserves.
Read `../spec.md` first.

**Blocked by:** 03, 04

**Status:** ready-for-agent

- [ ] Contrast, tint and vignette each function on the WebGPU backend; the
      fallback path works or its divergence is declared loudly (doc 05 ground
      rule 4 — a WebGPU-only pass is half a pass)
- [ ] SparkScene import re-pointed to ThreeSplatScene; `SiteGradeSettings`
      public authoring surface preserved (doc 01 — not droppable)
- [ ] Upstream watch item 11 (WebGPU PostProcessing maturity) re-checked and
      its dated result recorded in doc 06 before deep work starts
- [ ] H-GRADE: screenshot series vs sparkjs-toolkit at pinned settings,
      approved by the OWNER — not self-assessed
- [ ] If visual parity proves unreachable: STOP; the doc 04 GATE opens and the
      owner decides grade-parity-later vs block — with the screenshot evidence
      in hand, per ADR 0001's miss-becomes-item principle
- [ ] `npm run check` green

## Comments

**2026-08-20 (recorded at ticket 03 close — contexts start cold):**
- ThreeSplatScene's `clock` is a THREE.Timer, NOT SparkScene's Clock: there
  is NO `elapsedTime` property (undefined — silent NaN propagation into
  time uniforms); use `getElapsed()`. `getElapsed()` counts from
  construction (includes backend-init time) — continuous, fine for time
  uniforms.
- `renderOverride` does NOT exist on ThreeSplatScene — SceneGrade's
  assignment sites must be adapted against the facade; the hook's design is
  this ticket's to propose (owner rules if it changes the facade surface).
- For pixel verification, GENERALIZE `capture()`/`captureSync()` from
  examples/scene/main.ts — do not rewrite them; they encode the hidden-pane
  rAF-fence finding, the timeout + finally target-restore discipline, and
  the same-task gl.readPixels fallback.
- Color caution: offscreen readback values are in the WORKING color space
  when the target skips output transform — [1,1,8] is linearized 0x111133,
  [17,17,51] is the sRGB value. Pin which space a recorded pixel is in.
