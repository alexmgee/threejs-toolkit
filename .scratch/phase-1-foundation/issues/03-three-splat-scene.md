# 03 — ThreeSplatScene: a plain mesh scene on both backends

**What to build:** the scene facade that replaces SparkScene for this toolkit.
A plain three.js mesh scene renders under it on WebGPU AND on the forceWebGL
fallback — Phase 1 exit criterion (b). Read `../spec.md` first.

**Blocked by:** 01

**Status:** done

- [x] WebGPURenderer constructed behind the sync-facade + ready-promise pattern
      (doc 04 Phase 1 item 3); `workingColorSpace = SRGBColorSpace`
- [x] Tone-mapping and background choices match SparkScene's (read them from
      sparkjs-toolkit `src/core/SparkScene.ts` — reference only, never modify);
      any deliberate divergence is declared in Comments
- [x] A plain mesh scene demo renders on BOTH backends, verified by screenshot
      or readback (hidden-pane discipline: doc 05 ground rule 5)
- [x] No splat code, no pager code — that is Phase 2
- [x] CameraSystem's `renderer` typing widened as a declared adaptation,
      citing D22, without touching the two-hunk spark-strip (owner-added AC,
      2026-08-20, at ticket start — D22's typing half assigned here)
- [x] `npm run check` green

## Comments

**2026-08-20 — owner rulings taken before building (repo rule 11):**
1. D22 typing AC added to this ticket by owner instruction at start (recorded
   above); widen only — the dead-fields/construction-literals half of D22
   stays OPEN in doc 06.
2. Rail-fixture bootstrap repoint assigned to ticket 08 (explicit AC added
   there), settling ticket 04's "03 or 08" either/or in writing.

**2026-08-20 — divergences declared (spec rule 5):**
- src/core/ThreeSplatScene.ts is NEW (the SparkScene replacement, doc 02).
  Parity choices mirrored from SparkScene (reference-read only): background
  semantics (null = transparent via alpha), antialias:false, device-capped
  pixel ratio (1.5 mobile / 2.0 desktop), NO tone-mapping override
  (SparkScene sets none — 0 grep hits), touch-action none + context-menu
  suppression, ResizeObserver sizing. Declared divergences from SparkScene:
  (a) THREE.WebGPURenderer (both backends) behind the sync-facade +
  ready-promise pattern, first frame rendered before ready resolves;
  (b) workingColorSpace = SRGBColorSpace set explicitly (doc 04 mandate;
  SparkScene leaves the default because Spark works in sRGB internally);
  (c) THREE.Timer instead of deprecated THREE.Clock (0.185 warns per load);
  (d) plain render() after await init() instead of deprecated renderAsync;
  (e) guarded-seed + RO sizing (ticket 04 rail lesson); (f) SparkScene's
  dimensionPolling / renderOverride / throttleGate and every splat/pager
  member are ABSENT until their phases (no splat code — AC 4).
- src/core/CameraSystem.ts: ONE line widened per the D22 AC —
  `renderer: THREE.WebGLRenderer` → `| WebGPURenderer` via type-only import,
  comment citing D22. The two-hunk spark-strip untouched (re-verifiable:
  diff vs source shows exactly three hunks now — the two ticket-04 hunks
  plus this typed widen).
- examples/scene/{index.html,main.ts} NEW demo page (examples/ adaptation
  zone): deterministic unlit geometry (red box center, green sphere x=-3,
  yellow box x=+3, background 0x111133), ?webgl=1 backend switch (spike's
  proven pattern), DEV-only hook (__sceneDemo: scene3, capture, step).
  vite input map gains the page.

**2026-08-20 — verification evidence (execution, both backends — Phase 1
exit criterion (b)):**
- WebGPU: capture() renders into an offscreen target and reads back
  asynchronously (doc 05 H-VISUAL discipline). Samples [r,g,b,a]:
  center [255,0,0,255] (red box), left [0,255,0,255] (green sphere),
  right [255,255,0,255] (yellow box), corner [1,1,8,255] *(SUPERSEDED —
  this value was the bug fingerprint: linearized because the sRGB working
  space had not applied; post-fix value is [17,17,51,255], see the review
  block below. Kept for the record, do NOT cite as expected)*. backend field: "webgpu"; navigator.gpu present.
- WebGL2 fallback (?webgl=1): backend field "webgl2-fallback"; async
  readback CANNOT settle in this harness (see finding below), so
  verification used synchronous gl.readPixels *(the corner value in this
  block predates the workingColorSpace fix — post-fix value is
  [17,17,51,255] on BOTH backends, see FINAL evidence)* on the canvas context in the
  same task as a manual render: center [255,0,0,255], left [0,255,0,255],
  right [255,255,0,255] (at the aspect-1 sample positions 0.067/0.933W —
  the projection math independently confirms sample placement), corner
  [1,1,8,255]. Identical scene, identical pixel evidence on both backends.
- UPSTREAM FINDING (verified at line level): on the WebGL2 fallback,
  readRenderTargetPixelsAsync polls its GPU fence via requestAnimationFrame
  (three.webgpu.js:68900) — in a hidden/never-compositing pane the promise
  never settles. WebGPU readback rides device-queue callbacks and works
  hidden. Documented in the demo; harness verification uses the sync path.
- SELF-CAUGHT during verification: capture() originally left its render
  target bound when the readback hung, silently redirecting later renders —
  fixed with try/finally (never leave the target bound).
- Gate (superseded figures updated at close): npm run check TRUE exit 0 —
  typecheck + boundaries 46 modules / 65 deps (colorSpace.ts joined the
  graph in the review rounds) + both builds; rail and scene pages share
  split chunks (three.core split, not duplicated — grok-measured).

**2026-08-20 — adversarial review pass (Opus + gpt5.6 high + grok-4.6; every
claim re-verified before acting; fixes applied and re-verified):**
- CRITICAL (all three reviewers; Opus proved by execution): the
  workingColorSpace write sat in the constructor AFTER `new
  THREE.Color(background)` — the mandate never applied to the background
  (the original corner pixel [1,1,8] was the linearized fingerprint) and a
  second instance would get different colors (global mutated between
  constructions). FIXED: hoisted to module scope (set before any Color
  anywhere; importing the module IS the toolkit's sRGB opt-in, declared in
  the module comment). Re-verified in pixels: corner now [17,17,51] =
  0x111133 in sRGB, BOTH backends.
- dispose()-before-ready race (Opus/codex/grok): three's Renderer.dispose()
  is a no-op while uninitialized, and the ready continuation would render
  onto a removed canvas. FIXED: continuation early-returns on `disposed`;
  dispose defers renderer.dispose() until `ready` settles when init is
  pending.
- ready-rejection unhandledrejection for consumers who never await (Opus/
  grok): FIXED — internal `.catch(() => {})` tail; rejection stays
  observable on `ready` itself.
- API narrowings vs SparkScene, undeclared (Opus): FIXED types —
  setOnFrame(cb | null) (clearing restored), pixelRatio number | null.
  DECLARED as deliberate: preserveDrawingBuffer absent (doc 05: readback,
  not preserveDrawingBuffer habits); renderCount/throttled instrumentation
  absent until the browser rig needs it; `clock` is a Timer, NOT Clock —
  no `elapsedTime` property (use getElapsed()); renderOverride absent —
  **BOTH owed to ticket 10** (SceneGrade reads clock.elapsedTime and
  assigns renderOverride; its adaptation must map them — recorded here so
  ticket 10 doesn't hit it cold).
- capture() could never release the bound render target when the fallback
  readback hangs (codex; finally can't run on an eternal await): FIXED —
  5s timeout race rejects, finally restores. capture() also serialized
  (in-flight reuse; grok). Known cosmetic transient documented: the live
  animation loop renders the same scene into the bound RT during capture
  awaits — content-identical, readback unaffected, on-screen canvas
  freezes for the capture's duration.
- "Artifacts or it didn't happen" (codex, doc 05 rule 2): the synchronous
  fallback verification is now TRACKED CODE — captureSync() in the demo
  (same-task gl.readPixels, sample positions derived from the LIVE camera
  aspect), used for the recorded fallback evidence.
- FINAL evidence, both backends, tracked paths: webgpu via capture():
  center [255,0,0,255], left [0,255,0,255], right [255,255,0,255],
  corner [17,17,51,255]. webgl2-fallback via captureSync(): identical four
  samples. CameraSystem diff vs source: EXACTLY three hunks (ticket 04's
  two + the D22 widen) — reviewer-verified twice.
- Reviewer note for ticket 08, CORRECTED by the second review round: the
  earlier "only via `.scene`, type swap only" claim was FALSE.
  EnvironmentLoader also takes `.renderer` — `new THREE.PMREMGenerator(
  renderer)` with CORE three's PMREMGenerator, which is WebGL-only
  (getActiveCubeFace etc. don't exist on WebGPURenderer). The port must
  import PMREMGenerator from three/webgpu (its own class) and await
  `ready` before PMREM work. Also: the facade freezes `alpha` from the
  construction-time background and does not retain the original background
  value — EnvironmentLoader's setShowBackground/clear() restore contract
  must handle that in the adaptation.

**2026-08-20 — built-in review round (5 finder angles completed on Fable, 5
re-run down-roster after a capacity limit; fixes applied):**
- workingColorSpace moved to a dedicated side-effect module
  (src/core/colorSpace.ts) imported first by the facade — the opt-in was
  coupled to importing the ThreeSplatScene class specifically, so a cells/-
  or text/-only deep import would silently run linear. Ticket 11 gained the
  "barrel imports colorSpace first" AC; the module comment records the
  honest ordering limit (only importers are ordered). Verified: the
  assignment lives in the scene page chunk only today — the rail page still
  renders linear, so ticket 08's repoint AC now declares the flip.
- First-frame delta spike fixed (Timer counts from construction; the first
  onFrame delta was the whole backend-init duration — one clock.update()
  before the loop starts resets the origin). getElapsed() still includes
  init time (continuous — fine for time uniforms, declared). onFrame is
  silent between construction and ready (subsumed by the ready pattern,
  now declared explicitly).
- `backend` is now a getter over a private field (was a mutable public
  field on an otherwise readonly surface; dispose's init-settled logic and
  Phase 2 dispatch must not be corruptible by an external write).
- dispose teardown collapsed to ONE deferred path (ready always settles;
  two branches invited future edits missing one).
- Ticket 10's file now carries its own Comments block with the Timer/
  renderOverride debts, the capture-generalization pointer, and the
  linear-vs-sRGB readback caution (contexts start cold — the notes were
  only here before).
- Demo: projection math single-homed (xFrac(worldX, aspect) + CAMERA_Z/FOV
  consts — doCapture's hardcoded 0.28/0.72 would have silently missed
  after any camera/fov edit); one full-rect readback with one timeout
  (was 4 raced per-pixel reads, worst-case 20s of bound-target time);
  capture/doCapture collapsed; orphaned doc comments merged; DEV-hook
  rationale comment added.
- CameraSystem's D22 comment trimmed to citation+pointer (status lives in
  doc 06); facade header trimmed to pointer (ticket Comments are the
  single divergence home — rail convention). Doc 01's SparkScene row
  updated (the pre-init renderAsync escape-hatch idea was dropped —
  deprecated in 0.185); doc 06 D22 splice cleaned (stale present-tense).
- Considered and rejected: instanceof WebGPUBackend for backend detection
  (the duck-type flag is three's own pattern and survives duplicate-three
  bundles); editing sandbox-styles.css for the bottom-bar idiom (the css
  is a declared byte-copy; the inline override is source-fixture parity).

**2026-08-20 — second review round (Opus re-run after the Fable capacity
limit; fixes applied):**
- Facade aspect seed guarded (w>0 && h>0 ? w/h : 1) — the `|| 1` idiom let
  width>0/height=0 produce Infinity, the exact rail-fixture lesson the
  facade itself quoted but didn't apply.
- dispose(): setAnimationLoop's returned promise is now caught (it awaits
  init when uninitialized — disposing after a failed init would fire
  unhandledrejection past the ready tail); onFrameCallback cleared on
  dispose (retention).
- Declared parity notes (no code change): onFrame's `time` argument is the
  rAF page-origin timestamp (NOT scene-relative, NOT from `clock`) —
  byte-parity with SparkScene's animate; pixelRatio is applied once at
  construction and not re-derived on DPR change — SparkScene parity.
- EnvironmentLoader claim corrected (see the amended reviewer note above)
  and ticket 08's AC strengthened: PMREMGenerator from three/webgpu, alpha/
  background retention caveat, ready-await.

**2026-08-20 — final review round (grok-4.6 conventions + Opus angles A/D/E;
all record gaps closed at close):**
- Declared divergence (was missing from the list): `clock.connect(document)`
  at construction + `disconnect()` in dispose — without it, Timer does NOT
  zero its delta across page-hidden gaps, so the first delta after
  tab-return would be the whole hidden duration (the init-spike bug's
  sibling; Opus-verified in Timer.js source).
- Facade: aspect seed guarded against the width>0/height=0 Infinity edge;
  dispose catches setAnimationLoop's async rejection and clears the
  onFrame callback.
- Demo hardening (all Opus-verified against three's source): W=256 is
  LOAD-BEARING (WebGPU pads readback rows to 256 bytes — guarded with a
  runtime check); all samples at y=H/2 because readback ROW ORDER differs
  between backends (GL bottom-up, WebGPU top-down — only vertically
  symmetric rows are backend-independent); timeout timer cleared; the
  render target is deliberately LEAKED on the hung-readback path (disposing
  it would race the outstanding copy); captureSync refuses to run while a
  capture() is in flight; xFrac clamped (off-frame samples read the frame
  edge instead of a false-failure zero buffer); HMR dispose handler added.
- **OPEN OWNER ITEM (recorded here per the colorSpace.ts KNOWN HAZARD
  comment): the doc 04 sRGB working-space mandate vs three's classic-
  renderer support matrix.** Proven by execution: with workingColorSpace =
  SRGBColorSpace, three 0.185 THROWS (TypeError in _getUnpackColorSpace)
  if `renderer.outputColorSpace` is assigned on a classic WebGLRenderer —
  ColorManagement defines no workingColorSpaceConfig for sRGB.
  WebGPURenderer (the toolkit's path) is unaffected; nothing in this repo
  assigns that setter today; the rail fixture's classic WebGLRenderer dies
  at the ticket 08 repoint anyway. Owner call: accept as a documented
  constraint (never assign outputColorSpace on classic renderers) or
  revisit the mandate. The AC tick stands on the WebGPU path's correctness.
- Deferred with rationale: ticket 11 note already carries the sideEffects
  tree-shaking hazard (adding a `sideEffects` field now would change
  shaking semantics repo-wide untested); onFrame's page-origin `time` kept
  (SparkScene byte-parity; declared); pixelRatio applied once (SparkScene
  parity; declared).
- Grok efficiency angle: ZERO findings (measured — gate 5.77s, three
  chunk-split not duplicated, zero per-frame allocations, DEV helpers
  stripped from dist).
- Sweep residuals closed: floor (not round) sample indexing in capture()
  (round-past-edge on clamped fractions); mid-capture-resize aspect restore
  guarded; HMR dispose also removes the status bar; dispose-mid-capture
  rejection labeling accepted as a documented cosmetic residual. Final gate
  after sweep fixes: TRUE exit 0, 46 modules / 65 deps.
