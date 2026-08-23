# 08 — Scene periphery: environment, colmap, frustum, controls, props

**What to build:** the scene-adjacent renderer files working under
ThreeSplatScene on both backends. 5 files / ~1,705 lines.
Read `../spec.md` first.

**Files:** `core/EnvironmentLoader` (async PMREM on WebGPU — doc 01),
`core/ColmapData`, `core/FrustumRenderer`, `core/Controls`,
`render/PropLayer` (zero changes expected — doc 01 lists it for re-verification
only).

**Blocked by:** 03, 04

**Status:** done

- [x] EnvironmentLoader's SparkScene import re-pointed to ThreeSplatScene; the
      PMREM path awaited (async on WebGPU) and an environment map loads on
      both backends. NOT a type-swap-only port (ticket 03 review, corrected):
      (a) PMREMGenerator must come from three/webgpu, not core three — the
      core class calls WebGL-only renderer methods; (b) the facade freezes
      canvas `alpha` at construction and does not retain the original
      background — adapt setShowBackground/clear()'s restore contract
      accordingly; (c) await `scene.ready` before PMREM work
- [x] PropLayer lands byte-identical (zero changes) and a prop mesh renders in
      the plain scene on both backends
- [x] ColmapData / FrustumRenderer / Controls carry only their doc 01 minor
      renderer-API adaptations, declared in Comments (reality outgrew the
      wording: ZERO adaptations were needed — all three land byte-identical;
      doc 01's "minor renderer-API surface" line for this group was
      EnvironmentLoader's, see Comments)
- [x] The rail fixture's inline bootstrap (examples/rail/main.ts) is REPLACED
      by ThreeSplatScene and the fixture re-verified on BOTH backends; the
      antialias/pixelRatio divergence notes in ticket 04's Comments are
      resolved at that moment (owner ruling 2026-08-20 at ticket 03 start,
      settling ticket 04's "ticket 03's or 08's business" either/or).
      NOTE (ticket 03 review): the repoint also flips the rail page into the
      toolkit's sRGB working space (importing ThreeSplatScene pulls
      core/colorSpace.ts; the page currently renders in three's default
      linear) — marker/background pixel values change vs any pre-repoint
      captures. Declare it; re-pin any recorded observations.
- [x] `npm run check` green

## Comments

**2026-08-22 (execution session):**

**Copy vintage: sparkjs commit `fd67153`** (D21 as twice amended). All 5
files copied via `git show fd67153:<path>`, never from disk; each verified
byte-identical against the pin before adaptation (zero mismatches). Four of
the five (all but PropLayer) hash differently in sparkjs's working tree
than at the pin — pin-copy discipline again load-bearing.

**SHA-256 at copy time (destination files, pin fd67153, BEFORE the declared
EnvironmentLoader adaptation below):**
```
ae2f5339550fe3ccf1b3a955675767199172cd7fbd8480e83c3b17a631128cfb src/core/EnvironmentLoader.ts
04f59144a713dec392aad389cfa81591ef31a3caf3c74a782fbb869c243450a8 src/core/ColmapData.ts
d725950acc1a0de67bc4b4d05ed16aa9e86010d73a41919ef246b43caa0e7c43 src/core/FrustumRenderer.ts
a1ca0e75976a43c59d30ad38fa1ab701f08b1758cc99157c62ef027dd150bb7f src/core/Controls.ts
0a1f378794ca514cf1acb79859129f73fe79ae500b788c5b6c8e2ea2739f7bc1 src/render/PropLayer.ts
```

**Adaptations — EnvironmentLoader ONLY (the other four land byte-identical;
grep confirmed zero renderer-API references in ColmapData / FrustumRenderer /
Controls / PropLayer):**
1. `import type { SparkScene }` → `ThreeSplatScene`; the public `sparkScene`
   field/config-key NAME is KEPT (consumed by Phase 2's SiteRuntime copy —
   renaming is ticket 11's naming ruling's business, not this port's).
2. PMREMGenerator imported from `three/webgpu` (AC (a)): the node generator
   (renderers/common/extras) serves both the WebGPU backend and the facade's
   WebGL2 fallback; core three's class calls WebGL-only renderer methods.
3. `load()` awaits `sparkScene.ready` before PMREM work (AC (c)) — the node
   generator THROWS before backend init ("Use await renderer.init()"), and
   its `fromEquirectangularAsync`/`fromCubemapAsync` variants are deprecated
   since r181 (verified in the pinned 0.185.1 sources), so ready-then-sync
   is the supported pattern. `compileEquirectangularShader()` is async on
   the node generator and is now awaited.
4. Restore contract (AC (b)): the class captures `scene.background` once,
   before first overwriting it; `setShowBackground(false)` and `clear()`
   restore that captured background instead of null. This makes clear()'s
   pre-existing doc comment ("restore original background") true — the
   original CODE set null, harmless under SparkScene's transparent default,
   wrong under the facade's constructed background color.

**Rail fixture repoint (inherited AC, settling ticket 04's either/or):**
inline bootstrap (scene/camera/WebGLRenderer/ResizeObserver/Clock/
setAnimationLoop, ~45 lines) REPLACED by ThreeSplatScene + setOnFrame;
`?webgl=1` backend toggle + ready observers added (repo fixture pattern).
- antialias/pixelRatio divergence RESOLVED: the facade's splat-tuned
  contract now governs (antialias:false, capped pixelRatio — runtime shows
  getPixelRatio()=1 at dpr 1); ticket 04's antialias:true + uncapped-DPR
  bootstrap is deleted with the bootstrap.
- sRGB flip DECLARED (ticket 03 review note): importing ThreeSplatScene
  pulls core/colorSpace.ts transitively — the rail page now renders in the
  toolkit's sRGB working space (was three's default linear). No recorded
  pre-repoint pixel captures exist for this page (grep of docs/plan/results
  finds none), so nothing to re-pin.
- Markers, nav UI, scroll binding, latch note, stops: UNCHANGED.
  `__railFixture` dev hook keeps its keys and gains `scene3`.

**Periphery fixture (new, examples/periphery/) — runtime proof harness:**
ThreeSplatScene + createOrbitControls (exercises Controls at runtime) +
EnvironmentLoader (`?env=cube` selects the cubemap path; default HDR) +
PropLayer. ColmapData / FrustumRenderer are COMPILE-verified only: no
runtime AC names them and exercising FrustumRenderer requires a COLMAP
dataset (none exists in-repo; its consumers arrive with later phases).
Assets are GENERATED deterministic fixtures in examples/assets/periphery
(one-box .glb, 64×32 flat-RGBE .hdr — non-RLE because no scanline
starts with the 0x02,0x02 RLE marker — and six 16×16 solid PNG cube
faces); generator script: session scratchpad gen-assets.mjs,
reproducible from this description.
vite.config.ts gains the periphery page (input-map pattern).

**Runtime evidence (dev server; `__periphery.report` after `booted`
settles, PLUS pixel readback via the ticket-10 capture helper — center
pixel = the box prop, edge pixel = the environment background, y=H/2):**
- WebGPU + HDR:  report `{"phase":"ready","backend":"webgpu","envKind":"hdr","envLoaded":true,"envTextureType":"_Texture","sceneEnvironmentSet":true,"sceneBackgroundSet":true,"propInstalled":true,"propMeshCount":1}`;
  readback center `[184,87,166,255]` (env-lit box) edge `[120,180,255,255]`
  (env background).
- WebGL2 + HDR:  same report with `"backend":"webgl2-fallback"`; readback
  IDENTICAL to WebGPU to the LSB: center `[184,87,166,255]`, edge
  `[120,180,255,255]`.
- WebGPU + cube: report same, `"envKind":"cubemap"`; center `[156,46,54,255]`
  edge `[119,40,40,255]`.
- WebGL2 + cube: report same; center IDENTICAL `[156,46,54,255]`, edge
  `[12,147,147,255]`. OBSERVED DIVERGENCE, declared: the cubemap
  BACKGROUND's sampled face direction differs per backend (edge ≈ +x face
  on WebGPU vs ≈ -z face on WebGL2) — upstream cube orientation behavior,
  not this port's code (IBL lighting is backend-identical; the HDR equirect
  path is backend-identical everywhere). Recorded, not worked around.
- Live restore check (AC (b)): `setShowBackground(false)` →
  scene.background restored to `#111133` (the facade-constructed color,
  NOT null) — proven by execution on both backends.
- Fixture-asset debugging note (evidence trail): the first generated
  assets (4×4 HDR, 4×4 cube faces) produced a BLACK background on both
  backends while IBL still lit the prop — degenerate PMREM atlas from
  pathologically small inputs (the generator sizes from
  `texture.image.width / 4` for equirect and face width for cubes —
  PMREMGenerator.js `_setSizeFromTexture`; a 4-wide input → 1px faces).
  Regenerated at 64×32 (HDR) / 16×16 (faces);
  background rendered immediately. The port was never at fault.
- Rail fixture, BOTH backends: `next()` + 120 simulated frames drives
  progress 0 → 0.5 and the camera to stop 1 ("Red marker", yaw 120):
  camPos `[26.13, 9.61, -16.16]` IDENTICAL on webgpu and webgl2-fallback.
- `npm run check` green (exit 0, redirect-then-`$?`).
- Browser-pane screenshots unavailable this session (pane hidden, rAF
  paused — handoff 003 trap 7); all evidence above is readback/state-based
  via the dev hooks, driven manually where the frame loop couldn't tick.

**2026-08-22 — adversarial review round (Opus subagent report landed first;
every finding re-verified against the code/upstream before acting; gpt5.6-sol
and grok-4.6 rounds recorded below when landed):**
- CONFIRMED & FIXED (Opus 1.1): no `disposed` guard — dispose() during an
  in-flight load() would resurrect a PMREMGenerator against a possibly
  torn-down renderer. Added a `disposed` flag, set in dispose(), checked at
  load() entry and after each await (throws loudly, disposes the local
  envMap).
- CONFIRMED & FIXED (Opus 1.2): overlapping load() calls could leak the
  loser's PMREM texture and finish in race order. load() now serializes on
  a private chain — last REQUESTED wins deterministically, no leak.
- CONFIRMED & FIXED (Opus 1.3): `setShowBackground(false)` before the first
  load() clobbered the facade background to null forever (capture happened
  inside load()). The original background is now captured in the
  CONSTRUCTOR (readonly).
- CONFIRMED & FIXED (Opus 1.4): a second `load({showBackground:false})`
  left scene.background pointing at the just-disposed previous texture.
  The previous environment is now disposed at REPLACEMENT time (after the
  awaits), and the showBackground:false path restores the captured
  original.
- CONFIRMED & FIXED (Opus 1.5, pin-inherited): only the PMREM texture was
  disposed, never its RenderTarget — one leaked target per load() AT THE
  PIN too. The target is now stored and disposed with the texture.
  DECLARED divergence from the pin (a fix, carried in the adapted file's
  header note).
- CONFIRMED, DECLARED (Opus 2.2/2.3, rail, low): the facade adds
  `touch-action: none` + contextmenu suppression to the rail canvas
  (right-click menu gone — facade contract, not bootstrap behavior), and a
  failed backend init is now non-fatal (one console.error; nav UI builds
  inert) where the old bootstrap threw at construction. Both are facade
  contracts accepted with the repoint.
- CONFIRMED & FIXED (Opus 3.1): `report.envLoaded` was a tautology
  (`isLoaded` is true whenever load() resolves) — field REMOVED from the
  fixture; the identity checks (`sceneEnvironmentSet`/`sceneBackgroundSet`)
  are the real evidence. Earlier evidence lines above that quote
  `"envLoaded":true` predate the removal.
- ASSESSED, DECLARED (Opus 3.2): `propInstalled` finds the glTF NODE named
  "box" (the generated asset's node), not PropLayer's slot bookkeeping —
  true-when-installed but coupled to the asset's node name; prop transform
  application is not asserted. Accepted for this fixture; noted for any
  future asset regeneration.
- CONFIRMED & FIXED (Opus 4.1): the debugging note above misnamed the
  degeneracy driver as image.height; corrected to width/4 (verified in
  PMREMGenerator.js `_setSizeFromTexture`).
- Opus additionally re-verified by command: all 5 pin SHAs, byte-identity
  of the four unmodified copies, zero renderer-API references in them, the
  r181 deprecations + pre-init throws, mixed three/three-webgpu class
  identity (instanceof CubeTexture safe), asset dimensions/non-RLE layout,
  and typecheck exit 0.
- Post-fix runtime evidence (WebGL2, captureSync): baseline unchanged
  (center `[184,87,166]`, edge `[120,180,255]`); reload with
  `showBackground:false` → scene.background `#111133` and edge readback
  `[17,17,51,255]` (the restored facade color RENDERED, prop still
  env-lit — Opus 1.4 contract proven); two un-awaited racing loads
  (cube then hdr) → scene.environment AND scene.background === the
  last-requested texture, edge back to `[120,180,255]` (Opus 1.2 proven).
  Gate re-run green (exit 0).

**2026-08-22 — gpt5.6-sol (high) review round (findings re-verified before
acting):**
- CONFIRMED & FIXED (#4): the ColmapData/FrustumRenderer/Controls AC was
  ticked without annotating that reality outgrew its wording (zero
  adaptations vs "their minor renderer-API adaptations") — annotated per
  spec rule 5.
- ASSESSED, DECLARED, NOT CHANGED (#1): an in-flight load() resolving
  AFTER a later setShowBackground(false)/clear() re-applies the
  environment. PIN-INHERITED semantics (the original behaves identically);
  a load the caller requested applies when it resolves. Serialization
  covers load-vs-load ordering only.
- ASSESSED, NOT CHANGED (#3): `booted` fulfills (not rejects) after a boot
  failure — deliberate harness design (Opus independently judged it
  correct): the .catch stamps `phase:"failed"` + `error`, and harness
  scripts read `report.phase`, never infer success from settlement alone.
- Rail repoint: none found.

**2026-08-22 — grok-4.6 review round (ran against the POST-fix tree; each
finding re-verified before acting):**
- CONFIRMED & FIXED (#2): the `disposed` guard skipped the
  compileEquirectangularShader await window (Comments' "after each await"
  was false for it). Check added directly after that await.
- CONFIRMED & FIXED (#3): rail had no HMR teardown while examples/scene
  and examples/grade both dispose the facade in import.meta.hot.dispose —
  a dev save stacked a second canvas + rAF loop + wheel listener. Handler
  added (scene3.dispose, wheel listener removal, navBar removal); page
  re-verified after the edit (1 canvas, 3 markers, webgpu). NOTE FOR THE
  OWNER: examples/text-lab (ticket 05, already committed) has the same
  gap — flagged, not touched (outside this ticket).
- ASSESSED, DECLARED, NOT CHANGED (#1): `scene3.dispose()` while an
  env.load() is in flight (WITHOUT env.dispose()) lets PMREM run against a
  torn-down backend — the facade's `disposed` flag is private, so the
  loader cannot see it. CALLER CONTRACT declared: dispose the
  EnvironmentLoader with (or before) its scene; the fixtures' HMR handlers
  do. Widening the facade's public surface is not this ticket's business.
- REFUTED (#4): "capture center ray misses the box" — OrbitControls'
  constructor ends with `this.update()` (OrbitControls.js:463), orienting
  the camera to the [0,0,0] target immediately; empirically the center
  readback tracked the box (env-lit red) across three different
  environments while the edge tracked each background. No change.
- Ticket factual claims: none (grok independently re-verified pin SHAs,
  byte-identity, working-tree drift on 4 of 5, and the zero-renderer-API
  grep).
