# 10 — SceneGrade on node PostProcessing + TSL — THE PHASE GATE

**What to build:** colour grading (contrast/tint/vignette) rebuilt from
EffectComposer (WebGL-only) onto node PostProcessing + TSL — the largest
single adaptation of the phase (doc 01: 486 lines; doc 04: the GATE).
Exit is H-GRADE: side-by-side visual approval against sparkjs-toolkit —
a VISUAL comparison, which D16 (2026-08-19) explicitly preserves.
Read `../spec.md` first.

**Blocked by:** 03, 04

**Status:** done

- [x] Contrast, tint and vignette each function on the WebGPU backend; the
      fallback path works or its divergence is declared loudly (doc 05 ground
      rule 4 — a WebGPU-only pass is half a pass) — BOTH backends verified by
      readback; the two backends agree within 1 LSB on every pixel
      (docs/plan/results/ticket10-hgrade/)
- [x] SparkScene import re-pointed to ThreeSplatScene; `SiteGradeSettings`
      public authoring surface preserved (doc 01 — not droppable)
- [x] Upstream watch item 11 (WebGPU PostProcessing maturity) re-checked and
      its dated result recorded in doc 06 before deep work starts (2026-08-21
      entry; note: `PostProcessing` was renamed `RenderPipeline` in r183 —
      the port uses `RenderPipeline`)
- [x] H-GRADE: screenshot series vs sparkjs-toolkit at pinned settings,
      approved by the OWNER — not self-assessed (OWNER RULING, made
      2026-08-22 on evidence stamped 2026-08-21: APPROVED — "grade-off
      SHA-identical across all three paths and grade-on within 1 LSB except
      SMAA silhouettes is parity"; evidence in
      docs/plan/results/ticket10-hgrade/. DATE CORRECTION 2026-08-22: this
      ruling was first recorded as "dated 2026-08-20" on the owner's
      erroneous instruction; the evidence README is stamped 2026-08-21 and
      the ruling itself was made 2026-08-22. The same wrong date persists in
      commit a112253's message, which is history and stands.)
- [x] If visual parity proves unreachable: STOP; the doc 04 GATE opens and the
      owner decides grade-parity-later vs block — with the screenshot evidence
      in hand, per ADR 0001's miss-becomes-item principle (NOT TRIGGERED:
      parity reached — grade-off frames SHA-identical across toolkits;
      grade-on differs only on SMAA silhouette pixels, 0.125 % of the frame)
- [x] `npm run check` green (exit 0, 2026-08-21)

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

**2026-08-21 (implementation session):**
- Owner ruled Option A for the render hook: `renderOverride: (() => void) |
  null` ported verbatim to ThreeSplatScene (SparkScene.ts:113/:299), one
  branch in animate(); the disable path's `===` ownership guard carried as
  API contract. Option B (PostProcessing-native slot) REJECTED as
  pre-emptive design — would need its own D-number post-parity.
- Declared adaptations in src/render/SceneGrade.ts (all owner-sanctioned):
  (1) SparkScene -> ThreeSplatScene types/imports; `clock.elapsedTime` ->
  `clock.getElapsed()`. (2) `spark.encodeLinear` flips DROPPED — no Spark
  splat layer exists; `renderOutput()` owns the shared-space transform.
  (3) `syncComposerSize` machinery DROPPED — PassNode self-sizes from the
  renderer's drawing buffer every frame (PassNode.js:801-805). Additional
  declared divergences: (4) built on `RenderPipeline` (r183 rename;
  `PostProcessing` is a deprecated warning-emitting shim in 0.185).
  (5) The LUT branch is a mix() against a lutEnabled 0/1 uniform over a
  2x2x2 identity placeholder texture instead of a GLSL `if` — avoids node-
  graph rebuilds on LUT load/clear. (6) SMAAPass -> SMAANode (`smaa()` from
  examples/jsm/tsl/display). Pass ORDER preserved: render -> output
  transform -> grade in display space -> SMAA.
- Capture GENERALIZED per instruction: examples/shared/capture.ts now holds
  the capture()/captureSync() pair (all disciplines carried verbatim);
  examples/scene/main.ts repointed to it; examples/grade/ added (pinned
  settings; `?grade=0` control, `?webgl=1` backend switch) and registered
  in vite.config.ts inputs.
- Color-space caution RESOLVED BY MEASUREMENT: readbacks are display sRGB
  on every path tested — the ungraded offscreen control reads [17,17,51]
  on both backends, never linearized [1,1,8].
- TDD note: no test runner exists in this repo (deps: three/vite/tsc/
  depcruise only); the ticket's verification standard (pixel readback +
  H-GRADE) served as the test seam. No test tooling introduced.
- "Multiple instances of Three.js" console warning observed ONCE on the
  grade page's very first dev load, never again (including fresh loads on
  both backends): vite dep-optimizer churn on first discovery of the
  SMAANode import, not a structural dual-import (SMAANode imports only
  three/webgpu + three/tsl — verified). FORK.md's Phase 2 alias note is
  unaffected.
- H-GRADE evidence in docs/plan/results/ticket10-hgrade/ (README.md +
  6 readback PNGs + composite). sparkjs side ran from ITS OWN repo/dev
  server (port 5180, portfolio-lab, fixture injected via console at
  runtime; repo untouched). .claude/launch.json gained a machine-local
  `sparkjs-dev` entry (gitignored).
- Adversarial review round (gpt5.6-sol high + grok-4.6 + Opus subagent on
  the diff; every finding re-verified against three's source in-session;
  logs in .collab-logs/). FIXED: (1) SMAA input RTTNode render-target leak
  on dispose/HMR — grade now materialized via convertToTexture() held in
  state and its target freed in disposePipeline() (RTTNode's private
  NodeMaterial is a declared small residual); (2) grade ran on
  PREMULTIPLIED rgb (renderOutput premultiplies; the reference's
  OutputPass emitted straight alpha) — now unpremultiply -> grade ->
  premultiply, opaque pixels bit-identical (re-verified: all readback
  values unchanged on both backends post-fix); (3) facade's forced first
  frame bypassed renderOverride — now honors it (SparkScene could not race
  this, sync init; ours can — declared divergence-correcting adaptation);
  (4) capture(): renderFrame() throw before readback no longer leaks the
  render target. DOCUMENTED, not fixed: composed-path captures are not
  resolution-faithful to the offscreen W x H (PassNode sizes from the live
  drawing buffer) and px() bounds discipline is the sample-point author's
  duty — both now in capture.ts's header; renderOverride ASSIGNMENT stays
  last-writer-wins (upstream parity), facade JSDoc clarified. Post-fix:
  typecheck 0, npm run check exit 0, pixels unchanged.
