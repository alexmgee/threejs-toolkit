# 03 — Capability specs

The dense core. One section per capability that does not translate directly. Each has:
what sparkjs-toolkit does today → what upstream three.js offers → the design → counted
scope → risk class → how it is verified (pointer into doc 05). Risk classes:
`public-api` (front door), `private-internals` (reaches past it), `fork` (modified
upstream copy), `must-invent` (nothing to build on), `no-path` (accepted regression).

---

## §A — RadPager: paged `.rad` streaming  [must-invent + fork] — the biggest build

**Today:** Spark's pager streams `.rad` scenes (65,536-splat chunks) with range
requests, a 4-worker decode pool, GPU page residency with LRU eviction, LOD selection,
progressive reveal. Product result: hero first-pixel 2.3 s (down from 34 s via
prefetch-all-chunks + `lodRaycast:0` + telemetry-off).

**Upstream:** nothing. All loaders are load-whole-file-then-construct; splat count
frozen at construction; the SPZ format's per-splat LOD field is read past, never
decoded.

**Why feasible anyway:** the engine underneath fully supports CPU-side buffer mutation
with partial range uploads; the four storage buffers are reachable (via fork);
`setBinNode` is public; the padding lanes carry per-splat flags.

### A1 — Format layer (`RadHeader.ts`)
`.rad` facts corrected by review, from Spark's own Rust source (`rad.rs`):
- `chunksStart = 8 + roundup8(headerLength)` — **not** `8 + length`.
- Scales are stored logarithmically and decoded back to **linear** before covariance
  construction (`rad.rs:1203-1224`, `:1693`); getting this wrong double-applies `exp()`.
- Opacity (alpha) is stored **linear** in `.rad` — f32/f16/r8, with no
  NONLINEAR transform anywhere (`rad.rs:1640-1656` → `set_opacity`, stored
  as-is; r8 still gets the ordinary affine min/max dequantization every r8
  property gets). CORRECTED 2026-08-23 (ticket 02); grep claim RE-CORRECTED
  2026-08-27 (external audit): this bullet previously claimed sigmoid-encoding.
  The correction rests on the STRUCTURE of the format, not on a word search:
  `enum RadAlphaEncoding` is exactly Auto|F32|F16|R8 with no sigmoid variant
  (`rad.rs:56-62`); `resolve_alpha_encoding` only picks F16 vs R8 by
  `max_alpha > 1.0` (`:347-364`); and the R8 encoder quantizes the range
  [0.0, max_alpha] (`:638`) — a logit range, unbounded and routinely negative,
  could not survive it. The earlier note that `grep -ri sigmoid` over
  spark-lib's Rust returned zero hits was true about the STRING but FALSE as a
  claim about the code: Spark's Rust writes its sigmoids as the formula.
  Searching the form `1.0 / (1.0 + (-x).exp())` across `reference/spark/rust`
  finds exactly two, both outside `.rad` — `spark-lib/src/ply.rs:116` (raw-3DGS
  PLY opacity, the property literally named `opacity` at `:858`; the Rust twin
  of `ply.ts:553-555`) and `spark-lib/src/sogs.rs:436` (SOGS **v1** sh0 alpha;
  v2's `decode_sh0_v2` is linear `byte/255`, `:410-420`). The only inverse in
  Rust is `ply.rs:1244` ("opacity -> logit(opacity)", clamped ±100); ply.ts:673
  is likewise the INVERSE (write-side logit for injectRgba) despite its comment
  saying "sigmoid". Consequence: the `.rad` decoder does nothing; the monolithic
  **PLY** path (Phase 2 ticket 03) DOES need the read-side sigmoid.
- **SOGS caveat for a future loader** (recorded 2026-08-27 with the above; no
  ticket owns it yet): SOGS alpha is VERSION-DEPENDENT. `sogs.rs`'s
  `decode_sh0_v1` (`:425-443`) affine-dequantizes alpha and then applies the
  sigmoid at `:436`; `decode_sh0_v2` (`:410-420`) is linear `byte/255` with no
  sigmoid. Carrying the `.rad` "alpha is linear" conclusion across to SOGS would
  silently produce wrong opacity on every v1 asset — branch on version.
- The LOD tree consumes: center, **a scalar size**, child count, child start
  (`lod_tree.rs:208-217`); size derives per `splat_encode.rs:480-491`. The first-pass
  design misidentified this datum — the corrected contract is the one implemented.

### A2 — Fetch layer (`RadFetcher.ts`)
HTTP Range requests against R2 (already Range-enabled for Spark). Policy carried over
verbatim from the tuned result: **prefetch-all-chunks** (kills wave-by-wave
serialization). Failure semantics: a failed range retries n times then marks pages
unavailable without wedging reveal (Spark's pager-stall lesson, reimplemented at our
layer).

### A3 — Decode layer (Rust/WASM worker)
A slim crate (`rad-three/`) built from Spark's MIT reference decoder: decode chunk →
{positions f32×3, covariances f32×6 (via quat+scale→cov, upstream `writeCovariance`
semantics), colors u8×4, SH words u32}. One worker in the spike; pool of 4 in
production (matching the tuned Spark decode pool). Toolchain: cargo + wasm-bindgen;
worker + WASM bundled by both vite configs (embed build included — the single-file
embed bundle must inline or side-load the WASM; decision recorded in doc 06 Q14).
**Scope note (review):** pruning the Rust to the minimal decode path is flagged
UNKNOWN-scope — the ownership boundaries in spark-lib are not clean.

### A4 — Residency + LOD (`PagePool.ts`, `Residency.ts`)
Fixed page budget (spike: exactly 32 pages; production: budget from device memory
class). LRU eviction. LOD tree traversal per camera → selected set. Selection is
carried to the GPU via `center.w` flags and a `setBinNode` bin function so deselected
splats collapse out of the draw order. Two invalidation duties review caught as
missing from the first design — **nothing updates by itself**:
- a page upload or selection change must explicitly mark sort dirty (`updateSort`);
- SH must be re-dispatched for arrived pages even under a *motionless* camera.

### A5 — Load / reveal / ready contract
Public contract preserved exactly (SplatSiteElement copies verbatim): `whenReady`,
`onReady`, `onLoadProgress`, reveal policy. Internals simplified: one phase — bytes →
decode → construct → visible. **Progress = completed work, monotonic; never residency**
(falls under eviction; capped below total when pages < chunks). Spark's
resident>=wanted drain false-positive trap dies with Spark; its replacement invariant:
reveal fires on progress thresholds + first-paint confirmation, monotone by
construction.

**Scope:** ≥114 adaptation points in adapted files (SiteRuntime, ThreeSplatScene,
loaders, StatsHUD, bounds…) + the new backend modules + the crate. This is the floor
review raised from the refuted 121/11 claim. **Verify:** doc 05 H-LOAD (the ten spike
criteria, re-run at production integration).

---

## §B — Picking (raycast)  [must-invent; upstream has zero]

**Today:** Spark's WASM `SplatMesh.raycast()` answers "which splat is under the
cursor." Three consumers — all silently dead without this (no compile error):
1. CameraSystem double-click recenter,
2. SiteRuntime author-mode picking (:3319–3326),
3. SceneComposer object selection.

**Upstream:** `grep -in raycast` across all eight addon files: zero. Default
`Mesh.raycast` would test the 4-vertex placeholder quad.

**Design:** `raycast()` on the backend, resident-splats-only, two candidate
implementations — the spike (Phase 0 extra) picks one by measurement:
- **(a) CPU ray-ellipsoid** over retained `position` + `covariance` attributes,
  chunk-bounding-box pre-filter (page AABBs already exist in the pager). Predictable,
  main-thread cost scales with residency.
- **(b) GPU ID/depth readback** — render splat IDs to a small offscreen target around
  the cursor, async read. One-frame latency; near-zero main-thread cost.
Pass bar for either: correct hit on the parity fixture and per-pick cost compatible
with double-click UX on the hero.

**Scope:** backend method + 3 consumer re-points (counted inside §A's SiteRuntime work
and CameraSystem's ADAPT). **Verify:** doc 05 H-PICK (same click, same hit, Spark vs
new, ±tolerance in world units).

---

## §C — SDF edits: hover glow + live crop  [fork + private-internals]

**Today:** `SplatEdit`/`SplatEditSdf` recolor/hide splats inside shapes, live on GPU.
Consumers: SplatHighlight (marker hover glow — **live on visitor sites**; 214 lines,
100% Spark) and CropTool's visual preview (475 lines; preview possibly never worked —
`"SPHERE"` vs `"sphere"` enum bug, swallowed throw; runtime confirmation pending in a
separate session — doc 06 Q7).

**Upstream:** no edit buffer, no shape uniforms, no injectable color modifier. But
review found the seams the first pass missed:
- `_buffers.colorRead` exposes the **live color storage attribute** — a compute pass
  can rewrite splat colors directly, keeping a pristine RGBA copy for restoration;
- the padding lanes carry per-splat edit masks;
- **no K=8 ceiling exists in toolkit usage** (CropTool.ts:65,:94–128; DebugPanel
  :1236–1248) — edit capacity must be dynamic, growing the node/uniform set and
  rebuilding when it overflows.

**Design:** an `EditLayer` in the fork: SDF uniform set (sphere/box/plane, inverted
flags) + either (route 1) injected TSL in the forked vertex/color path, or (route 2)
the `colorRead` compute rewrite. Route 2 is preferred first: smaller fork delta, works
per-splat, restorable. **WebGL2 fallback:** review corrected the first pass — fallback
shader edits are *not* blocked (only the SH compute dispatch is); a custom fallback
vertex/SH path in the fork keeps the glow on WebGL2 rather than silently skipping it.
Spark parity detail kept honest: Spark's blend is `target = rgba + sdfRgba`
(SplatEdit.ts:775-776) — additive, alpha *not* saturated; replicate, don't approximate.

**Scope:** 18 counted regions in existing files (19 with SceneComposer crop hydration)
+ the EditLayer in the fork. **Verify:** doc 05 H-EDIT (glow fixture screenshot-diffed
against sparkjs-toolkit on both backends; crop preview against CPU-filter ground truth).

---

## §D — Per-splat depth of field  [fork]

**Today:** `SparkRenderer.focalDistance` / `apertureAngle`, authored per rail stop
(`SiteStop.optics`); blurs each splat by true view-space Z. SceneGrade.ts:24–27
explicitly rejects screen-space DoF as inferior.

**Upstream:** no depth output at any level; TSL `dof()` needs a `viewZNode` splats
never emit. **But** the structural slot exists: the vertex path's `alphaScale` /
`blurAdjust` computation is congruent with Spark's own `splatVertex.glsl:218–237` —
the same math transplants. It is sealed inside module-private `createVertexNode`; the
class is the sole export. **Fork required — and the fork drags `CountingSort` +
`GaussianSplatUtils` with it via relative imports** (dependency closure, review).

**Design:** forked vertex node takes optional `focalDistance`/`apertureAngle`
uniforms; per-splat blur radius from view-Z; `setOptics(null)` = exact upstream
behavior (fork is a superset, keeping re-diffs tractable). Depth-interop half needs
**no fork**: `material.allowOverride = false` is public API, set at construction.
Exact-parity nicety: upstream hardcodes max pixel radius 1024 vs Spark's 512 — match
Spark for visual parity (one line, flagged in FORK.md).

**Scope:** 14–16 counted regions + the fork delta. Deferrable: nothing depends on it
(Phase 5 last for scheduling only; doc 06 D10 rules DoF is built regardless of
current usage, so it is not cancellable). **Verify:** doc 05 H-OPTICS (authored-stop
fixture, focus ramp screenshots vs sparkjs-toolkit).

---

## §E — Export, text-as-splats, bounds  [mixed]

**Export (SplatExporter, 354):** upstream SPZ support is read-only, and covariance
packing destroys scale/quat. **Strategy (review's correction): preserve-at-decode** —
our loaders/pager retain scale+quat (and pre-sigmoid opacity where available) as extra
attributes before covariance construction; export round-trips from source data.
Eigendecomposition (reconstructing scale/quat from covariance) is the fallback only if
memory cost of retention proves unacceptable — it is `must-invent` math with precision
loss. 8-bit color loss on SPZ round-trip is inherent to the format — owner sign-off in
doc 06 Q9/Q10.

**Text (SplatTextMesh, 279):** today `textSplats` (Spark) rasterizes text to splats.
Rebuild: own the ~104-line canvas rasterization (already toolkit-side) + new
`textSplatGeometry.ts` producing the doc-02 geometry contract directly. 8 counted
regions; SplatLane.ts untouched if the class API is preserved. **Live production
path** (SiteRuntime → TextSystem → SplatLane → SplatTextMesh) — visitor-facing, not
authoring-only. Recolor/opacity fades ride §C's `setMeshColor`.

**Bounds (SplatBounds, 74):** public `position` attribute read; exact world AABB
computed per-point (never `Box3.applyMatrix4` — 8-corner only, review). Streamed
variant reports resident bounds from the pager (contract preserved: "currently
readable streamed bounds"). Percentile clamping for paged-scene floaters carries over.
Plus the missed call site: **sparkjs-toolkit's** `examples/rail/main.ts:131–154`
centroid (not this repo's same-named adapted fixture — disambiguated ticket 04).

**Scope:** ≥28 regions (assets total, review-corrected from 27; includes rail
sandbox). **Verify:** doc 05 H-ASSET (export → re-import → screenshot-diff; text
fixture vs sparkjs-toolkit).

---

## §F — The fork itself  [governance]

`src/vendor/three-gs/`: `GaussianSplatMesh.js` + `CountingSort.js` +
`GaussianSplatUtils.js` (closure). `FORK.md` records: upstream provenance as
precisely as recoverable (exact commit hash, or the pinned window ticket 02
established), every local change as a titled patch (teardown, EditLayer, optics
uniforms, capacity guard, fallback paths, maxPixelRadius), and the per-release
re-diff procedure. Local changes are **additive supersets** wherever possible —
with all features off, rendered output must equal unmodified upstream
(pixel-identical; the identity is defined on output, not source bytes — doc 05
H-FORK is the definition home).
TypeScript: the addon ships no declarations, but none are hand-written locally
(owner ruling, ticket 01, 2026-08-19 — supersedes this section's earlier
"we write `three-gs.d.ts` locally"). The vendored JS is **inferred-from but
never checked**: the root tsconfig's `allowJs: true` gives importers types
inferred from upstream's JSDoc (a bogus-method probe fails TS2339), but the
JS bodies themselves are not type-checked (`checkJs` is off), and constructor
parameters whose JSDoc type names don't resolve in the JS module's scope
silently degrade to `any` — verified: `new GaussianSplatMesh("wrong")` passes
tsc exit 0. The import resolving is NOT the same as the call being checked.
A hand-written sibling `.d.ts` is rejected because tsc silently prefers it and
never checks it against the JS (a deliberately false one passed, exit 0). If a
pinned audit surface is ever wanted, GENERATE it —
`npx tsc <vendored .js files> --declaration --allowJs --emitDeclarationOnly`
(verified accurate, exit 0) — mark it derived, and never hand-edit it.
Public-vs-private narrowing stays a separate, later job (FORK.md).
How fork patches get type-checked: **DECIDED — D20 (doc 06, 2026-08-20)**:
patches are authored in `.ts` files alongside the vendored JS; effective at
the first Phase 2 fork patch. The question this paragraph used to hold open
closed with ticket 02.

Fork-carried items beyond §§C–D:
- **`dispose()`** [must-invent]: upstream has none; the official demo leaks every
  per-splat buffer. Ours frees the four storage buffers, SH attributes, and the
  sort's order/bin/histogram/offset buffers (renderer-owned destruction paths —
  private, listed in FORK.md). Consumers: SiteRuntime teardown (:4133–4137),
  SceneComposer add/remove (:194,:530).
- **Frustum culling** [public-api]: upstream forces `frustumCulled=false`; backend
  culls via `visible` from pager AABBs.
- **Capacity guard** [must-invent]: check `maxStorageBufferBindingSize` before
  allocation (~8.4 M splats/buffer); refuse gracefully with a toolkit error instead
  of upstream's silent failure.

---

## §G — Diagnostics  [rebuild-or-retire, per instrument]

**Today:** 21 diag files, 7,895 lines; the instruments that produced 34s→2.3s.
**Dies with Spark:** SparkPagerAdapter (1,362 — monkey-patches 4 private methods, pins
32 private names) + pager-internal halves of LoadProbe/diagWiring/LaggardMapper
(~2,900 gross). **Survives re-fed:** NetworkObserver (273), LoadRecord, sinks,
fixtures, FrameDiffValidator — wired to RadPager's *public* counters (our own pager
needs no monkey-patching; that pathology was Spark-specific). **Trap carried
forward (review):** the CPU-budget denominator is fed only by pager snapshots — feed
it from RadPager or delete the budget feature; never leave it silently self-disabled.
**Scope:** inside §A's count + ~4,300 gross lines deleted. **Verify:** the diagnostics
*are* verification tooling — H-LOAD consumes their output.

---

## §H — Accepted regressions  [no-path]  — the honest list

1. **Cross-mesh global sort**: overlapping splat objects blend wrong, permanently.
   Constraint documented in SceneComposer; overlap fixture makes it visible for
   sign-off.
2. **Quality knobs**: 14 SparkRenderer + 4 SplatMesh tunables → `autoSort` + whatever
   our fork chooses to expose. The authoring vocabulary shrinks; DebugPanel folders
   die.
3. **SH ceiling**: degree 3, 8-bit quantized (Spark: higher precision available) —
   possible banding on glossy scenes.
4. **Foveation, radial sort**: no counterparts; silently absent.
5. **Memory floor**: 64 B/splat + SH, ~3–10× Spark packed; mitigated (not fixed) by
   pager residency budget.
