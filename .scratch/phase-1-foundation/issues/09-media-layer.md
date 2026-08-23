# 09 — MediaLayer: fix the capabilities throw, re-measure the colour baseline

**What to build:** image/video planes render in-scene on both backends, and
the colour baseline is measured fresh under the new global colour space —
Phase 1 exit criterion (c). Read `../spec.md` first.

**Blocked by:** 04 (compiles), 03 (the measurement needs a running scene)

**Status:** done

- [x] The throwing bug fixed: `renderer.capabilities` does not exist on
      WebGPURenderer and the optional chain sits on the wrong object (doc 01,
      MediaLayer lines ~67-70) — fix the chain, declare the change in Comments
- [x] Media planes render under ThreeSplatScene on BOTH backends
- [x] The colour baseline is RE-MEASURED (not inherited): readback numbers
      recorded in `docs/plan/results/` as this toolkit's own baseline —
      an absolute record per ADR 0003, not a comparison
- [x] `npm run check` green

## Comments

**2026-08-23 (execution session):**

**Copy vintage: sparkjs commit `fd67153`** (D21 as twice amended), copied
via `git show`, verified byte-identical against the pin before adaptation.
SHA-256 at copy time (destination, PRE-adaptation; equals the sparkjs
working-tree hash — this file has not drifted):
```
f78bf559fa3fc113cf8dd5178d0aa34b4684c0a3704b50e8f7153745453f4293 src/render/MediaLayer.ts
```

**The one sanctioned adaptation (declared):** MediaLayer.ts attach() — the
optional chain sat on `renderer` while `renderer.capabilities` does not
exist on WebGPURenderer, so attaching with the facade renderer THREW
(doc 01/doc 04). Chain moved onto `capabilities`
(`renderer?.capabilities?.getMaxAnisotropy() ?? 1`) plus the matching `?`
in the inline cast type; facade attaches get anisotropy 1 on BOTH
backends (the facade renderer is the WebGPURenderer class even on the
WebGL2 fallback — it never has `.capabilities`). No other code change.

**Fixture (new, examples/media/):** ThreeSplatScene + MediaLayer with one
image plane of KNOWN sRGB value ([200,60,60] — the generated
face-px.png), `?webgl=1` backend toggle, ticket-10 capture wiring, HMR
teardown, loud failure paths. attach() is passed
`{scene, renderer} as {scene}` — the renderer rides the same internal
cast sparkjs's runtime uses (attach's declared param is {scene} only).
vite.config.ts gains the media page.

**Runtime evidence — media planes render on BOTH backends:**
- WebGPU: report `{"phase":"ready","backend":"webgpu","planeInstalled":true}`,
  readback center `[147,12,12,255]` (the plane), edge `[17,17,51,255]`
  (background) — the plane demonstrably renders (attach() with the facade
  renderer no longer throws; the fix is load-bearing on this path).
- WebGL2: identical to the LSB — center `[147,12,12,255]`, edge
  `[17,17,51,255]`.

**Colour baseline RE-MEASURED (exit criterion (c)):** recorded as an
ABSOLUTE baseline in `docs/plan/results/ticket09-color-baseline/README.md`
(ADR 0003 — our numbers, no comparison; the copied source comment's
Spark-era "exact match" is noted there as context only). Headline: the
background colour is identity ([17,17,51] in → [17,17,51] out); an
SRGBColorSpace-tagged texture reads back exactly one sRGB→linear decode
with no re-encode (200→147, 60→12) under the toolkit's sRGB working
space — cross-backend identical. `npm run check` green (exit 0).

**2026-08-23 — adversarial review (Opus + gpt5.6-sol high landed; grok-4.6
pending below; every finding re-verified before acting):**
- CONFIRMED & FIXED (Opus F3 / sol B1): the fixture's runtime-string asset
  URL 404'd in a served dist/ build (no publicDir; vite emits nothing for
  bare strings). Switched to a `?url` import — the 73-byte PNG now INLINES
  as a data URI in the built page (verified present in dist/assets/media-*
  after the gate build). NOTE: examples/periphery (committed, ticket 08)
  has the same dist-asset gap for its hdr/glb/pngs — flagged as a separate
  task, not touched here.
- CONFIRMED & FIXED (Opus F6 / sol C3): README arithmetic — the stated
  intermediate was 147.1; srgb_to_linear(200/255)·255 = 147.28 (rounds to
  the same 147; table unchanged).
- CONFIRMED & FIXED (sol B2): the fixture header read as predicting an
  identity [200,60,60] readback; reworded to defer to the results README
  (the page carries no expected value).
- CONFIRMED & FIXED (Opus F4): the WebGL2 sync-path edge sample is
  aspect-dependent (background only at aspect ≳ 0.98) — pane sizes now
  recorded in the README per capture.ts's own instruction (300×150 first
  reading; 1373×1270 re-verification; identical values).
- CONFIRMED & FIXED (Opus F5): `planeInstalled` attests object existence,
  not rendering — fixture now also reports `planeVisible` (sync-visibility
  outcome), and the center readback remains the actual rendering evidence.
- CONFIRMED & FIXED (Opus F2): "WebGPU attaches get anisotropy 1" wording
  corrected in the code comment and above — the facade renderer is the
  WebGPURenderer class on BOTH backends, so both get 1.
- DECLARED, NOT CHANGED (Opus F1): `renderer.getMaxAnisotropy()` EXISTS on
  the facade renderer (delegates to backend capabilities) — a
  `renderer?.getMaxAnisotropy?.() ?? 1` variant would preserve real
  anisotropy at the same cost. The owner's sanction for this ticket is THE
  CHAIN FIX specifically; adopting getMaxAnisotropy() is recorded here as
  a candidate for Phase 2's SiteRuntime re-typing pass, not taken now.
- Both reviewers verified the adaptation's exactness (reverse-applied
  bytes equal the pin blob) and all factual claims (SHA, no-drift,
  typecheck 0).
- Post-fix runtime: both backends re-verified — reports now
  `planeInstalled:true, planeVisible:true`, readbacks unchanged
  (`[147,12,12,255]` / `[17,17,51,255]`); gate green (exit 0).

**2026-08-23 — grok-4.6 round (post-fix tree; re-verified before acting):**
- CONFIRMED & FIXED (#2): the README's edge-sample aspect threshold was
  0.98 — wrong by exactly the half-vs-full-extent factor; the correct
  bound is ≈ 0.49 (plane ±1 at z 4, fov 60; derivation now in the README,
  the error acknowledged in place). Both recorded panes are safe under
  the correct bound; the colour table is untouched.
- DECLARED, NOT CHANGED (#1): harness protocol note — `capture()` before
  `booted` settles (or after a failed boot) renders a plane-less scene
  whose center is the background colour; the evidence protocol is always
  `await booted`, check `report.phase === "ready"`, THEN capture. The
  recorded numbers are not this path (nothing else in the scene is
  [147,12,12], as grok itself verified).
- Factual claims: none — grok independently re-verified the pin SHA,
  no-drift, reverse-applied byte identity, the sRGB arithmetic, and that
  the background-identity + one-decode readings are mutually consistent
  (a linearized background would read [1,1,8] — handoff 003 trap 4's
  fingerprint — and it does not).
