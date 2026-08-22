# H-GRADE — ticket 10 (Phase 1 GATE) evidence — 2026-08-21

SceneGrade rebuilt on node RenderPipeline + TSL, compared side-by-side
against sparkjs-toolkit's SceneGrade executing from its own repo (its dev
server on port 5180, `examples/portfolio-lab/`), per doc 05 H-GRADE and the
D16 ruling. Number comparison not used (ADR 0003) — the tables below are
pixel *readback* evidence, the doc-05 ground-rule-2 artifact form, not
performance/selection metrics.

## Setup (identical on both sides)

Deterministic unlit fixture: red 2x2x2 box at origin, green r=0.8 sphere at
x=-3, yellow 1x1x1 box at x=+3, background 0x111133, camera (0,0,6) fov 60,
1280x720 canvas. The sparkjs side runs its OWN SceneGrade inside its own
runtime (`window.__portfolioLab`, splat content hidden, fixture injected at
runtime via console — nothing written to the read-only repo).

PINNED grade settings (the ticket's three knobs):
`{ contrast: 1.25, tint: 0.5, vignette: 0.5 }` — exposure/saturation/
temperature/grain at defaults.

## Files

- `side-by-side.png` — labeled 6-up composite for owner review
- `sparkjs-grade-{on,off}.png` — reference frames (WebGL, EffectComposer)
- `threejs-webgpu-grade-{on,off}.png` — ours, WebGPU backend
- `threejs-webgl-grade-{on,off}.png` — ours, forceWebGL fallback

All frames captured by pixel READBACK (gl.readPixels same-task on WebGL;
readRenderTargetPixelsAsync on WebGPU; GL rows flipped to top-down so all
PNGs share one orientation), never toDataURL of the live canvas.

## Results

**Grade OFF (control): all three frames are SHA-256 IDENTICAL**
(`90c02b97…`), across Spark/WebGL, ours/WebGPU, ours/WebGL.

**Grade ON:**

| pair | max channel delta | mean delta | pixels differing >1 LSB |
|---|---|---|---|
| spark vs ours-WebGPU | 71 | 0.0274 | 0.125 % |
| spark vs ours-WebGL | 71 | 0.0274 | 0.125 % |
| ours WebGPU vs ours WebGL | 1 | 0.0000 | 0.000 % |

All 1,149 differing pixels (0.125 %) lie on/near object silhouettes
(100 % within 2 px of a strong gradient) — the SMAA implementations differ
(sparkjs SMAAPass GLSL vs three's SMAANode TSL). Interiors and background
match exactly.

## Sample readbacks (graded, [r,g,b,a], y = H/2 row)

Expected values hand-derived from the pinned settings in display space.

| sample | expected | sparkjs (live canvas) | ours WebGPU (256x128 offscreen) | ours WebGL (live canvas) |
|---|---|---|---|---|
| center (red box) | [255,0,0] | [255,0,0,255] | [255,0,0,255] | [255,0,0,255] |
| left (green sphere) | [0,247,0] | [0,247,0,255] | [0,247,0,255] | [0,247,0,255] |
| right (yellow box) | [255,247,0] | [255,247,0,255] | [255,247,0,255] | [255,247,0,255] |
| corner (background) | [0,0,25-26]* | [0,0,25,255] | [0,0,26,255] | [0,0,25,255] |
| ungraded corner | [17,17,51] | [17,17,51,255] | [17,17,51,255] | [17,17,51,255] |

\* corner vignette depends on the sampled pixel's uv — the WebGPU offscreen
target's corner uv differs slightly from the live canvases' (26 vs 25).

Derivations: green 247 = 255x((1x0.875 - 0.5)x1.25 + 0.5) [tint then
contrast]; corner 25-26 = 255 x (0.2x1.25 - 0.125) x (1 - 0.5 x
smoothstep(0.3, 0.75, dist)) [contrast then vignette on the 0x111133 blue].

Color space of recorded pixels: display sRGB on every path (measured — the
ungraded control reads [17,17,51], never the linearized [1,1,8]).

## Known limit reconfirmed

Async readback on the WebGL fallback times out in a hidden pane (rAF-fenced
— ticket 03's finding); captureSync was used there, per the documented
fallback discipline.
