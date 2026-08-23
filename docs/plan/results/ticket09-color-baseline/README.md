# MediaLayer colour baseline — ticket 09 (Phase 1 exit criterion (c)) — 2026-08-23

This toolkit's OWN colour baseline for MediaLayer image planes under the
global sRGB working space (core/colorSpace.ts), measured fresh — an
ABSOLUTE record per ADR 0003. No pass/fail against anything; the numbers
below ARE the baseline later work is measured against.

## Bench (pinned settings)

- Page: `examples/media/` — ThreeSplatScene, fov 60, camera [0,0,4],
  background `0x111133`; one MediaLayer image plane, 2×2 at the origin,
  `binding: {always: true}`.
- Source image: `examples/assets/periphery/face-px.png` — solid sRGB
  **[200, 60, 60]** (generated, deterministic, 16×16).
- Texture path: MediaLayer's own — `tex.colorSpace = SRGBColorSpace`,
  `MeshBasicMaterial`, `toneMapped: false` (byte-identical copy; the one
  declared adaptation is the capabilities-throw fix, not colour).
- Readback: `examples/shared/capture.ts` (ticket 10's helper) — center
  pixel = the plane, edge (6% W, H/2) = the background. Async capture on
  WebGPU, same-task sync readback on WebGL2 (hidden-pane protocol,
  handoff 003 trap 7).

## The baseline

| sample | source value | WebGPU | WebGL2 fallback |
|---|---|---|---|
| media plane center | sRGB [200, 60, 60] | **[147, 12, 12, 255]** | **[147, 12, 12, 255]** |
| scene background   | 0x111133 → [17, 17, 51] | **[17, 17, 51, 255]** | **[17, 17, 51, 255]** |

Cross-backend: identical to the LSB on every sample.

Pane size at measurement (capture.ts's own instruction for sync-path
numbers): the WebGL2 column was read by `captureSync()` twice with
identical values — first against the default 300×150 drawing buffer
(aspect 2), re-verified post-review at 1373×1270 (aspect 1.08). The edge
sample (6% W, H/2) is background only while aspect ≳ 0.49 (plane spans ±1
at z 4, fov 60: left edge fraction = 0.5 − 1/(4.619·aspect) = 0.06 at
aspect 0.492; an earlier note said 0.98 — that mistook the full width for
the half-extent) — at narrower aspects it lands on the plane; record the
pane size beside any future sync-path reading. The WebGPU column used the async offscreen capture
(fixed 256×128).

## Reading (recorded, not judged)

- The background colour is IDENTITY through the pipeline: authored
  [17,17,51] reads back [17,17,51] on both backends.
- The sRGB-TAGGED TEXTURE reads back exactly one sRGB→linear decode with
  no re-encode: srgb_to_linear(200/255)·255 = 147.28 → 147;
  srgb_to_linear(60/255)·255 = 11.5 → 12. This is the measured property
  of MediaLayer's SRGBColorSpace texture under the toolkit's sRGB working
  space. (Context only, no comparison: the copied source comments state
  that under sparkjs's default-linear pipeline the same settings produced
  an exact colour match.)
- Any future change that moves these numbers (texture colorSpace policy,
  working-space change, tone mapping) is measured against THIS table.
