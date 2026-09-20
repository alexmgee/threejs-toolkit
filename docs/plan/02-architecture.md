# 02 — Target architecture

## The stack, top to bottom

```
site project (portfolio, sculptures…)          — unchanged, swaps one file: dependency
  └─ <splat-site> web component (COPY)         — same element, same events, same site.json
      └─ SiteRuntime (ADAPT)                   — same orchestration, re-typed seams
          └─ ThreeSplatScene (NEW, replaces SparkScene)
              ├─ THREE.WebGPURenderer          — WebGPU, or its WebGL2 fallback backend
              ├─ SplatBackend seam (NEW)       — the one interface all splat work goes through
              │    └─ ThreeGsBackend (NEW)
              │         ├─ vendor/three-gs/* (FORK of upstream addon)
              │         └─ RadPager (NEW)      — streaming: fetch → decode → residency
              └─ node PostProcessing           — SceneGrade rewritten in TSL
```

## Upstream ground truth the design is built on

(Every fact below is file:line-verified in the reviewed proposal; re-verify against
published r186 before Phase 1.)

**`GaussianSplatMesh`** (the upstream splat renderer, 769 lines):
- Public surface: constructor `(splatGeometry, { autoSort = true })`, `updateSort()`,
  `updateSphericalHarmonics()`. **That is all.** No dispose, no raycast, no LOD, no
  streaming, no per-splat mutation API.
- Data layout: four float32 vec4 GPU storage buffers — center / covarianceA /
  covarianceB / color — **64 bytes per splat** before SH. Splat count frozen at
  construction (`geometry.instanceCount = count`).
- **Three padding lanes** (`center.w`, `covB.z`, `covB.w`) are allocated but never
  read or written — 12 free bytes/splat. Our fork carries per-splat state there
  (edit masks, selection flags) without changing the buffer layout.
- Spherical harmonics (view-dependent shine): degrees 1–3, 8-bit-quantized, packed
  4-per-uint32; degree 3 = 52 bytes/splat. A compute pre-pass evaluates SH once per
  splat per camera change.
- `frustumCulled` forced `false` — every mesh submits every frame; culling is ours.
- Depth: test-only, never writes; the whole quad uses the splat center's depth. This
  is exactly Spark's contract — why PropLayer works unchanged.
- Private internals we depend on (fork or reach-in): `_buffers` (live storage
  attributes incl. `colorRead`), `_sort`, the module-private `createVertexNode` /
  `createMaterialNodes` factories, SH dispatch state.

**`CountingSort`** (271 lines): per-mesh GPU counting sort, ~4,096 depth bins, four
compute passes; `setBinNode()` is a **public injection point** (used by the pager for
selection-aware ordering). CPU fallback on WebGL2: full main-thread re-sort at ~1.8° of
camera rotation — the fallback's stutter risk, measured by the spike.

**Geometry contract** a custom loader must satisfy (this is how the pager feeds the
renderer without any upstream loader): attributes `position` (f32×3), `covariance`
(f32×6, upper-triangle order xx,xy,xz,yy,yz,zz), `color` (u8×4 normalized), optional
`sphericalHarmonics1/2/3` (u32×3/4/6). `writeCovariance` (exported upstream) converts
Spark-style quat+scale → covariance.

**`WebGPURenderer`**: async `init()`, but a pre-init `render()` transparently returns
`renderAsync()` (three.webgpu.js:54868) — so `createSiteRuntime` **stays synchronous**
with an observed ready promise. Global requirement:
`ColorManagement.workingColorSpace = SRGBColorSpace` (correct splat alpha blending),
which changes color math for *every* material → MediaLayer's color baseline re-measured.
No `preserveDrawingBuffer`; frame capture uses async readback (parity harness, doc 05).

## The SplatBackend seam

One interface, defined by what the toolkit actually consumes today (extracted from the
8 value-importers + 5 type-importers), not by what Spark offered:

```ts
interface SplatBackend {
  // lifecycle
  load(source: SplatSource): SplatHandle;      // .rad (paged) | spz/ply/splat (monolithic)
  dispose(handle: SplatHandle): void;          // full GPU teardown — upstream has none
  // load/reveal contract (consumed by SplatSiteElement, SiteRuntime, LoadingUI)
  progress(handle): LoadProgress;              // completed-work based; NEVER residency
  whenReady(handle): Promise<void>;
  // interaction
  raycast(handle, ray): SplatHit | null;       // resident splats only
  // composition
  bounds(handle): Box3;                        // resident/streamed-aware
  counts(handle): { total, resident, selected };
  // edits (fork-fed)
  setEdits(handle, edits: SdfEdit[]): void;
  setMeshColor(handle, rgba): void;            // recolor/opacity (locative, text fades)
  // optics (fork-fed)
  setOptics(handle, { focalDistance, apertureAngle } | null): void;
}
```

Design rules for the seam:
1. **Progress is completed work, never residency.** Review proved residency *falls*
   during eviction and is capped below total on big scenes — it cannot be a progress
   number. Progress = bytes fetched + pages decoded + pages first-uploaded,
   monotonic by construction (spike criterion 8).
2. **The seam is the only door.** No file outside `src/backend/` and `src/vendor/`
   may import from `vendor/three-gs/`. Enforced by lint rule from day one — this is
   what keeps the fork surface auditable. *Amended (2026-09-18, owner ruling E2 at
   Phase 2 ticket 11):* the door rule reaches the backend's own internals too — no
   file under `src/` outside `src/backend/` may import a backend module other than
   the five doors `SplatBackend.ts`, `ThreeGsBackend.ts`, `decode.ts`, `decode-url.ts`
   and `index.ts` (lint rule `backend-doors-only`, type-only imports included).
   `examples/` stays exempt (doc 06 D23 (a): fixtures exercise the backend exactly as
   consumers will). HONEST SCOPE: a lint rule sees imports, not property reads —
   whatever a door hands out, such as `ThreeGsBackend.pagerDiagnostics`, stays
   reachable through it; the counter consumers (StatsHUD, SplatBounds) type their
   backend as the `SplatBackend` interface, on which only the seam's methods exist.
3. **One implementation, honestly.** No pretense of a Spark implementation living here
   too — sparkjs-toolkit *is* the other implementation, in its own repo. The seam
   exists to concentrate coupling, not to promise pluggability.

*Resolution note (2026-08-29, ticket 03):* the sketch above never pinned how the
renderable reaches the caller. Owner-ruled: `SplatHandle` carries
`readonly object: THREE.Object3D` and the caller composes it (`scene.add`);
the interface stays at exactly the method set above. Rejected alternatives: a tenth
`objectOf()` method (grows the specced interface for purity alone) and
backend-side attach (fights three.js composition idiom and ticket 09's
SceneComposer work).

*Resolution note (2026-09-16, ticket 08 ruling S3):* the load REQUEST type
grows — `SplatSource` gains two optional observers, `onProgress(progress)`
(called at every point the backend refreshes the handle's `LoadProgress`) and
`onFailure(error)` (called from the one terminal-failure site). The seam is
otherwise pull-only, and `whenReady` settles once, so before this a whole-load
failure AFTER first paint only flipped `progress().phase` to `failed` with no
announcement — the silent failure the named-refusal design forbids. No method
is added; the interface stays at exactly the method set above. Rejected:
per-frame polling (hidden tabs stop frames — the throttling trap) and a
failure promise on the handle (the handle-shape ruling above).

## RadPager — the streaming loader (full spec: doc 03 §A)

Pipeline: `RadHeader` (parse; `chunksStart = 8 + roundup8(headerLength)` — the format
math review corrected) → `RadFetcher` (HTTP Range requests, prefetch-all policy carried
over from the 34s→2.3s result) → worker pool (Rust/WASM decode; log-scale decode
contract per Spark's `rad.rs`) → `PagePool` (fixed page budget, LRU eviction) →
`Residency/LOD` (tree traversal → selected set; `center.w` flags + `setBinNode` for
ordering) → buffer uploads (partial-range updates into the four storage buffers + SH) →
explicit `updateSort` / SH invalidation (neither happens by itself on data change —
review caught both).

## Module map of this repo

```
threejs-toolkit/
├─ docs/plan/                  ← this plan
├─ spikes/native-rad/          ← Phase 0; throwaway; never imported by src/
├─ src/
│  ├─ vendor/three-gs/         ← FORK: GaussianSplatMesh + CountingSort + GaussianSplatUtils
│  │   └─ FORK.md              ← upstream provenance (commit or pinned window), every local change, re-diff procedure
│  ├─ backend/                 ← SplatBackend seam + ThreeGsBackend + RadPager + workers
│  ├─ core/    (adapted)       ← ThreeSplatScene, CameraSystem, SceneComposer, CropTool,
│  │                              SplatExporter, SplatBounds, StatsHUD, DebugPanel, loaders
│  ├─ render/  (adapted)       ← SceneGrade (TSL), MediaLayer, PropLayer
│  ├─ interact/ SplatHighlight ← fork-fed
│  ├─ ui/      SplatTextMesh   ← rebuilt; + copied marker DOM files
│  ├─ cells/ rules/ site/ text/ locative/ embed/ diag/  ← COPY per doc 01
│  └─ index.ts                 ← same barrel names as sparkjs-toolkit (API parity)
├─ examples/                   ← parity fixtures, one per subsystem (doc 05)
└─ vite.config.ts / vite.embed.config.ts  ← WASM worker bundling in Phase 2 (ruling 2026-08-19)
```

## Known hard ceilings (accepted, not solved)

- **Cross-mesh sorting**: each mesh sorts privately; overlapping splat objects blend in
  whole-object order and pop when centroids swap. No API, no workaround at any level.
  SceneComposer documents a disjointness constraint; the parity harness includes an
  overlap fixture so the artifact is *seen and signed off*, not discovered.
- **Memory**: 64 B/splat + SH ≈ 3–10× Spark's packed forms. And WebGPU's
  `maxStorageBufferBindingSize` caps a single buffer at ~8.4 M splats **with no
  capacity guard upstream** — allocation just fails. The backend adds the guard and a
  refusal path; the pager's page budget keeps residency under it by design.
- **SH ceiling**: degree 3, 8-bit — banding possible on glossy photogrammetry; spike
  fixture includes a worst-case view.
