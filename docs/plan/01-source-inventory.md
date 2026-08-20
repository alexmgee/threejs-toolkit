# 01 — Source inventory

Every file of `sparkjs-toolkit/src` (117 files, 48,823 lines, measured 2026-08-14 by
import-graph scan; raw per-file data in `source-inventory.json` beside this doc). Each
file gets exactly one **disposition**:

- **COPY** — copied verbatim. No renderer or Spark knowledge. Compiles and behaves
  identically. May still be touched later for reasons *unrelated* to the port.
- **ADAPT** — copied, then edited at counted adaptation points. The mechanism is known;
  it is a rewrite of specific lines, not an invention.
- **REBUILD** — the file's *purpose* survives but its mechanism was Spark; a new
  implementation is written against the new backend (spec in doc 03).
- **FORK-FED** — the file survives near-verbatim but only works because our forked
  upstream renderer (doc 03 §F) supplies a private capability.
- **DROP** — not carried over; its job ceases to exist. Its deletion is a feature.

## Vocabulary used below (plain-language, once)

- **Renderer** — the code that draws splats to screen each frame. Spark today;
  three.js `GaussianSplatMesh` under `WebGPURenderer` in this repo.
- **Pager** — Spark's streaming loader: fetches a `.rad` scene in 65,536-splat chunks,
  keeps only the needed pages in GPU memory, reveals the scene progressively. three.js
  has none; we build one (doc 03 §A).
- **Raycast / picking** — finding which splat is under the cursor. Spark answers this;
  three.js never does (doc 03 §B).
- **SDF edit** — live GPU recoloring of splats inside a sphere/box (the marker hover
  glow, CropTool's preview) (doc 03 §C).
- **DoF** — depth of field, per-splat blur by true distance, authored per tour stop
  (doc 03 §D).

## Directory totals

| dir | no imports | three-only | spark type-only | spark value | total lines |
|---|---:|---:|---:|---:|---:|
| (root) index.ts | 1 / 132 | — | — | — | 132 |
| cells/ | 9 / 5,499 | — | — | — | 5,499 |
| core/ | 4 / 1,878 | 4 / 1,296 | 3 / 2,086 | 6 / 2,899 | 8,159 |
| diag/ | 20 / 7,538 | 1 / 357 | — | — | 7,895 |
| embed/ | 4 / 1,978 | — | 2 / 4,906 | — | 6,884 |
| interact/ | — | — | — | 1 / 214 | 214 |
| locative/ | 2 / 362 | — | — | — | 362 |
| render/ | 1 / 136 | 3 / 1,334 | — | — | 1,470 |
| rules/ | 9 / 1,615 | — | — | — | 1,615 |
| site/ | 24 / 6,929 | 3 / 2,471 | — | — | 9,400 |
| text/ | 7 / 2,838 | 4 / 1,830 | — | — | 4,668 |
| ui/ | 5 / 1,307 | 3 / 939 | — | 1 / 279 | 2,525 |
| **total** | **86 / 30,212** | **18 / 8,224** | **5 / 6,992** | **8 / 3,395** | **48,823** |

62% of all lines import nothing. Note the split the headline hides: the 8 files that
import Spark *by value* total only 3,395 lines — but two of the *type-only* importers
(SiteRuntime, DebugPanel) are where most behavioral coupling actually lives, because a
`type` import means the file handles Spark objects it was handed by someone else.

## COPY — 86 files, 30,212 lines (62%)

The entire domain model from CONTEXT.md lives here and moves untouched: annotations,
markers, rules (trigger/condition/effect), presence, lifetime, channels, engagement
(disengaged / tour / explore), the frozen frame, scene memory, mode locks, slots,
reserved regions, engagement chrome.

| Cluster | Files / lines | What it is |
|---|---|---|
| cells/ | 9 / 5,499 | Scene partitioning. All imports `./`-relative. |
| rules/ | 9 / 1,615 | The rules engine — triggers, conditions, effects. |
| site/ (24 of 27) | 24 / 6,929 | Authoring UI, site config, inspectors, panes. |
| diag/ (20 of 21) | 20 / 7,538 | Diagnostics *framework*: sinks, records, fixtures, self-test. Renderer-agnostic by design; its pager-fed *inputs* are the REBUILD (doc 03 §G). |
| text/ (7 of 11) | 7 / 2,838 | Text layout, styles, block model. |
| embed/ (4 of 6) | 4 / 1,978 | `SplatSiteElement.ts` (1,126 — the `<splat-site>` web component; `grep -cin spark` = 0), FragmentRouter (802). |
| ui/ (5 of 8) | 5 / 1,307 | Markers/annotation DOM side. |
| core/ (4) | 4 / 1,878 | `CameraRail.ts` (919 — pure spherical math, imports *neither* three nor Spark), Controls glue, etc. |
| locative/ | 2 / 362 | Locative scenes. |
| index.ts | 1 / 132 | Barrel — trivially re-pointed. |

**Caveat recorded by review:** COPY means "no code edits required," not "no thought
required." Three COPY files have *behavioral* couplings to watch in the parity harness:
`SplatSiteElement` consumes the load/ready contract (rebuilt in doc 03 §A5);
diag sinks consume pager records (doc 03 §G); `StatsHUD.ts` (type-only importer, see
ADAPT) reads splat counts.

## ADAPT — the counted-edit files

### three-only importers (18 files, 8,224 lines) — renderer-migration edits only

These never touch Spark; they touch `WebGLRenderer`-era three.js APIs. The reviewed
count for the whole renderer migration is **47 adaptation points**; the notable ones:

| File | Lines | Adaptation |
|---|---:|---|
| render/SceneGrade.ts | 486 | **Largest single item.** Color grading (contrast/tint/vignette). Built on `EffectComposer`, which is WebGL-only. Rewritten on node `PostProcessing` + TSL (three's shader-graph language). Public authoring surface (`SiteGradeSettings.enabled`, SiteConfig.ts:215) — not droppable. |
| render/MediaLayer.ts | 439 | Image/video planes in-scene. One **throwing bug** to fix: `renderer.capabilities` doesn't exist on WebGPURenderer and the optional chain is on the wrong object (lines 67–70). Its verified color-parity baseline must be **re-measured** under the new global color space. |
| render/PropLayer.ts | 409 | Solid meshes inside the splat cloud. **Zero changes** — both renderers use identical depth flags. Listed here only for the re-verification run. |
| core/CameraSystem.ts | 973 | Orbit/recenter camera. Renderer-type edits (2 dead fields, ~10 construction literals); its *picking* dependency is a REBUILD (doc 03 §B). |
| core/EnvironmentLoader.ts, ColmapData.ts, FrustumRenderer.ts, Controls.ts | 1,296 | Minor renderer-API surface; PMREM (environment-map prefilter) is async on WebGPU. |
| site/authorui/textInspector.ts, AuthorGizmo.ts, authorPanelTypes.ts | 2,471 | three math/types only; near-COPY. |
| text/TextSystem.ts, SplatLane.ts, PlaneLane.ts, BlockRenderer.ts | 1,830 | Text rendering lanes. SplatLane unchanged **if** SplatTextMesh keeps its API (doc 03 §E). |
| ui/Annotations.ts, ObstacleLayout.ts, billboard.ts | 939 | Screen-projection of markers; renderer-agnostic math, re-verified only. |
| diag/dev/FrameDiffValidator.ts | 357 | Pixel-comparison harness — becomes a load-bearing *tool* of this project (doc 05). |

### Spark type-only importers (5 files, 6,992 lines) — re-typed, selectively rebuilt

| File | Lines | Disposition detail |
|---|---:|---|
| embed/SiteRuntime.ts | 4,281 | The production runtime. Mostly orchestration (COPY-grade); its Spark-typed seams — mesh registration (:2221–2236), author-mode picking raycast (:3319–3326), teardown (:4133–4137), the paged-load wiring — are re-pointed at the new backend. The reviewed count folds these into the pager's ≥114 and picking scopes. |
| core/DebugPanel.ts | 1,850 | Tweakpane debug UI. ~250 lines of Spark-only folders (LOD/quality/DoF knobs) **DROP** — the new renderer has one option. 34 direct Spark access lines total. Rest adapts. |
| embed/diagWiring.ts | 625 | Pager-diagnostic wiring — mostly REBUILD/DROP with §G. |
| core/SplatBounds.ts | 74 | Gets **simpler**: reads the public `position` attribute. Caveat: `Box3.applyMatrix4` is 8-corner, not exact — keep the documented contract honest. Its "streamed bounds" behavior must be reimplemented against the pager (review: the file cannot just be deleted). |
| core/StatsHUD.ts | 162 | Reads `numSplats`/paged counts (:121) — re-fed from the new backend's counters. |

## The 8 Spark value-importers — where the real work concentrates

| File | Lines | Disposition | Spec |
|---|---:|---|---|
| core/SparkScene.ts | 432 | **REBUILD** as `ThreeSplatScene` — owns WebGPURenderer (async-init handled via the pre-init `render()`→`renderAsync()` escape hatch), scene, camera, and the backend seam. The pager-stall fix and Spark tunables die with Spark. | 03 §A, 02 |
| core/SplatLoader.ts | 105 | **REBUILD** — same public contract (`whenReady`, `onLoadProgress`), fed by the new pager or by the monolithic loaders for small scenes. | 03 §A5 |
| core/CameraSystem.ts | 973 | ADAPT (above) + **REBUILD** of its raycast recenter. | 03 §B |
| core/SceneComposer.ts | 560 | ADAPT — multi-object composition; loses nothing structurally but inherits the **cross-mesh sorting constraint**: overlapping splat objects blend wrong, permanently (no upstream path). Also a picking consumer, and crop hydration lives here. | 03 §B, §C |
| core/CropTool.ts | 475 | Split: CPU export filter ADAPTs; live GPU preview is **FORK-FED** (SDF). Note: the GPU preview may never have worked in the original (`"SPHERE"` vs `"sphere"` enum bug — runtime confirmation in progress in a separate session). | 03 §C |
| core/SplatExporter.ts | 354 | **REBUILD** on the preserve-at-decode strategy (keep scale/quat at load; never eigendecompose covariance). | 03 §E |
| interact/SplatHighlight.ts | 214 | **FORK-FED** — the marker hover glow. 100% Spark today; the only exotic feature live on visitor sites. | 03 §C |
| ui/SplatTextMesh.ts | 279 | **REBUILD** — 8 counted regions + one new `textSplatGeometry.ts`. Live production path: SiteRuntime → TextSystem → SplatLane → SplatTextMesh (review killed the "authoring-only" claim). | 03 §E |

## DROP — deletions that are features

| What | ~Lines | Why it ceases to exist |
|---|---:|---|
| diag/SparkPagerAdapter.ts | 1,362 | Monkey-patches 4 private Spark pager methods, pins 32 private member names, version-stamped to Spark 2.1.0. Measures a machine we no longer run. |
| Pager-internal halves of LoadProbe.ts, diagWiring.ts, LaggardMapper.ts | ~2,900 gross | Their network/timing halves are rewired to the new pager's *public* counters instead (doc 03 §G) — including the CPU-budget denominator trap review found (it is fed only by pager snapshots; left alone it would silently self-disable). |
| DebugPanel Spark folders | ~250 | The knobs' referents (14 SparkRenderer + 4 SplatMesh properties) don't exist upstream. |
| Spark workarounds throughout | scattered | `paged:true` vs forbidden `lod:true`, the pager-stall fix, `extSplats` float16-striping avoidance (three.js stores float32 — striping is structurally impossible, at 4× the memory). |

Reviewed floor across all deletions: **≥1,903 lines** of old code deleted or replaced.

## Not in src/ but in scope

| Item | Disposition |
|---|---|
| examples/* sandboxes (11 entry points, vite-registered) | Rebuilt selectively — each is a parity fixture. **sparkjs-toolkit's** `examples/rail/main.ts:131–154` has a `forEachSplat` centroid call site review caught being missed (path disambiguated ticket 04 — THIS repo now has a file at that path, the adapted splatless fixture, which has no such call site). `examples/loadtest` is Spark-stack top to bottom → replaced by the new pager's own load harness. |
| vite.config.ts / vite.embed.config.ts | New copies; WASM worker integration for the decoder (doc 03 §A) lands in Phase 2 (owner ruling 2026-08-19, ticket 01). |
| package.json | three pinned to r186 line; no `@sparkjsdev/spark`; `@types` strategy for the undeclared addon (doc 03 §F). |
| TOOLKIT-GUIDE.md, CLAUDE.md, CONTEXT.md | Rewritten for this repo; CONTEXT.md's domain language carries over verbatim — the domain didn't change. |
| Consuming sites (portfolio, sculpture, plants) | **Explicitly unsurveyed** — an open tail. Each switches its `file:` dependency only after the parity harness passes for its content. See doc 06 Q15. |
