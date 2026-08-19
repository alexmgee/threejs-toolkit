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
