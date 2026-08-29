# FORK.md — vendored three.js Gaussian-splat addon

Governs `src/vendor/three-gs/`: `GaussianSplatMesh.js`, `CountingSort.js`,
`GaussianSplatUtils.js`. Doc 03 §F is the policy; this file is the record.

## Provenance

Vendored into the Phase 0 spike (`spikes/native-rad/vendor/`, this repo's
commit `16ea69d`, dated 2026-08-15 06:44 UTC) from the three.js **dev
branch** (github.com/mrdoob/three.js). **The exact dev commit was not
recorded at vendoring.** Established from content on 2026-08-20 by
byte-comparison against upstream (each claim verified by `diff` against
raw.githubusercontent files):

- The snapshot window is **dev between `da05705` (2026-08-12 18:27 UTC,
  "Simplify GaussianSplatUtils via ThreeJS math classes", #34223) and
  `9a5e800` (2026-08-15 09:30 UTC, "GaussianSplatMesh: Fix sort invalidation
  for transforms", #34233, exclusive)** — every dev commit in that window
  yields exactly the recorded content for the three upstream paths,
  **GaussianSplatMesh modulo the `[flatten-imports]` patch below**. Content
  cannot pin it tighter. (Consistent with this repo's own timestamps:
  `16ea69d` at 06:44 UTC pre-dates the window's upper bound by ~2h46m.)
- Upstream paths: `examples/jsm/objects/GaussianSplatMesh.js`,
  `examples/jsm/gpgpu/CountingSort.js` (unchanged upstream since 2026-08-08,
  #33950), `examples/jsm/utils/GaussianSplatUtils.js`.

## Delta statement

**No functional changes** (delta zero, ticket 02). The three files are
byte-identical to `spikes/native-rad/vendor/` (diff + sha256 verified at
landing). The complete inventory of local divergence from upstream is the
patch list below — nothing else.

Content digests (SHA-256) — the drift baseline that survives the throwaway
spike directory and needs no upstream commit. Byte-preservation through git
is pinned by the repo-root `.gitattributes` (`-text` on this directory —
without it, `core.autocrlf` would CRLF-rewrite these files at the next
checkout and falsify every digest):

```
0da00b782153b0049752a4b7fa3c8624690aa6e0ec805128da02896a7f2accac  GaussianSplatMesh.js
e9e90b6940a4da923534c3f249e8e7bd2c7603f8b432c54c62ecdc6db4be47e3  CountingSort.js
f65f9222985071a49874d61d59400498ce6cbe7288d40e0f960987cad6b3387b  GaussianSplatUtils.js
```

With no fork feature in use, rendered output is pixel-identical to
unmodified upstream — the **H-FORK** identity test; doc 05 owns the
definition (identity is on output, not source bytes).

**Type status (recorded 2026-08-20):** the snapshot does NOT type-agree with
the pinned `@types/three@0.185.x` — `tsc --noEmit --checkJs` yields 120
errors in these files (76× TS7006 implicit-any params, 18× TS7053,
13× TS2304, 8× TS2339, 4× TS2554, 1× TS2769). `checkJs` staying off is
load-bearing for the green gate, and the type flowing through the backend
seam has `any` parameters throughout. Doc 06 watch item 10 (reconcile with
upstream declarations when they ship) is therefore a **breaking** item, not
a cleanup.

**Module-graph note (Phase 2 alias decision pending):**
`GaussianSplatUtils.js` imports bare `'three'` while `GaussianSplatMesh.js`
and `CountingSort.js` import `'three/webgpu'` + `'three/tsl'`. Upstream
reconciles this via its examples importmap; this repo's vite configs define
no such alias. Consequence: the first VALUE export through the seam bundles
BOTH `three.module.js` and `three.webgpu.js` into the self-contained embed
build (`external: []`), with cross-copy `instanceof` hazards. Decide a
`three` → `three/webgpu` alias (or equivalent) before Phase 2's first value
export; the bytes here are frozen, so the fix is config-side.

### Patches

**Patch mechanism (owner-ruled 2026-08-29, ticket 04 — D20's concrete
shape):** functional patches are PURE `.ts` SIBLING MODULES under
`patches/`, operating on the vendored instances from outside. The vendored
JS stays byte-identical (digests above unchanged); each entry below
inventories EVERY internal field/path its patch reaches, because those are
undeclared private surfaces of a pinned three version — the re-diff
procedure re-verifies each one (step 3a). Patches never import from
`src/` outside this directory (`vendor-must-not-reach-src` guards it); they
throw `ForkPatchError` and the backend seam wraps it into the toolkit's
named errors.

- **`[flatten-imports]`** (at vendoring, Phase 0 spike): the three files are
  colocated in one directory; two import specifiers in
  `GaussianSplatMesh.js` rewritten accordingly. No code change.
  - `'../gpgpu/CountingSort.js'` → `'./CountingSort.js'`
  - `'../utils/GaussianSplatUtils.js'` → `'./GaussianSplatUtils.js'`

- **`[dispose]`** (ticket 04, 2026-08-29): `patches/dispose.ts` —
  `disposeGaussianSplatMesh(mesh, renderer)` performs the full GPU teardown
  upstream lacks (doc 03 §F). Frees, in order: the five compute nodes
  (`mesh._sphericalHarmonicsComputeNode`, sort `_resetNode`/`_histogramNode`/
  `_prefixNode`/`_scatterNode` via `ComputeNode.dispose()` — the renderer
  deletes their pipelines/bindings on the event), then every storage
  attribute via `renderer._attributes.delete(attr)` (the same internal path
  three's own geometry disposal uses; decrements `renderer.info.memory`),
  then `geometry.dispose()` + `material.dispose()`. Internal surfaces
  reached (re-verify each at re-diff): `renderer._attributes.delete`;
  `mesh._buffers.{centerRead,covarianceARead,covarianceBRead,colorRead}.value`
  (TSL storage nodes expose their `StorageBufferAttribute` as `.value`);
  `mesh._buffers.sphericalHarmonics<d>Attribute` (d=1..degree);
  `mesh._buffers.sphericalHarmonicsContributionRead.value` (lazy);
  `mesh._sort.{orderAttribute, binRead.value, histogramAtomic.value,
  offsetAtomic.value, _resetNode, _histogramNode, _prefixNode,
  _scatterNode}`; `mesh._sphericalHarmonicsComputeNode`; `attribute.pbo` on
  each storage attribute (WebGL2-fallback PBO `DataTexture` stashed by
  GLSLNodeBuilder.js:396-404 — freed via its PUBLIC `.dispose()`; without
  it the fallback leaks ~7 textures per load/dispose cycle, caught live by
  the H-LIFE union gate); `renderer._attributes === null` treated as the
  legitimate PRE-INIT state (Renderer.js:319 vs :812 — nothing uploaded,
  attribute deletion skipped; any other non-map shape is a reshape);
  `renderer.backend.get(attribute)` + `renderer.backend.gl.deleteBuffer` +
  `DualAttributeData.buffers` (WebGL2 fallback allocates TWO GL buffers per
  storage attribute for transform feedback, WebGLAttributeUtils.js:16-41 /
  :175-179, and `destroyAttribute` frees only the active one :249 — the
  patch frees the inactive twin, invisible to info.memory either way).
  Loud-coupling rule
  (owner): STRICTLY TWO-PHASE — phase 1 validates and collects EVERY
  surface (throwing `ForkPatchError("fork-internals-missing")` before any
  mutation, so a reshaped three can never produce a half-disposed mesh;
  sort compute nodes are REQUIRED, the SH compute node may legitimately be
  null at degree 0, a present-but-undisposable `.pbo` is a reshape); phase
  2 frees validated shapes only. An adversarial review refuted the first
  cut's assert-before-free claim (compute nodes freed before SH-band
  validation, optional-chaining skipping renamed nodes) — the two-phase
  rewrite is the fix, keep it.

- **`[capacity-guard]`** (ticket 04, 2026-08-29): `patches/capacity-guard.ts`
  — pure sizing math + assertion: `maxStorageBindingBytes(count, shDegree)`
  (largest single binding over: vec4 buffers count×16 B incl. the lazy SH
  contribution; SH band d count×`SH_BAND_WORDS[d]`×4 B; the sort's
  histogram/offset at `BIN_COUNT`×4 = 16,384 B REGARDLESS of count — the
  max for scenes under ~1k splats; review-corrected, the first cut called
  sort buffers "strictly smaller") and `assertStorageWithinLimit(...)` throwing
  `ForkPatchError("over-capacity")`. The backend pre-checks against
  `renderer.backend.device.limits.maxStorageBufferBindingSize` on WebGPU
  BEFORE the big allocations; on the WebGL2 fallback (no queryable limit)
  the same named error surfaces at allocation-failure time (RangeError
  catch-and-name — owner ruling, no invented threshold). Internal surface
  reached (re-verify at re-diff): `renderer.backend.device.limits.
  maxStorageBufferBindingSize` (WebGPU backend only); `BIN_COUNT = 4096`
  (GaussianSplatMesh.js:47, private constant mirrored as SORT_BIN_COUNT —
  re-verify the value at every re-diff). Depends on vendor export
  `SH_BAND_WORDS`.

Future functional patches land as titled entries here, per doc 03 §F's
capability list (§F is the policy home; no enumeration here). The Phase 0
spike's proven fork (`spikes/native-rad/src/GaussianSplatMesh.fork.js`,
Phase 2 material) carries the concrete incoming set under its own titles:
**`[capacity]` `[uploadPage]` `[selection]` `[invalidate]`** — reconcile
against §F's list when Phase 2 promotes the fork; do not assume they match.

## Known upstream drift — as of 2026-08-20 (retire/re-date at each re-diff)

Post-snapshot changes to the addon on dev, in order (verified against the
dev history 2026-08-20; the list is a dated snapshot, NOT a complete
inventory forever — re-enumerate at every re-diff):

- `9a5e800` sort-invalidation fix for transforms (#34233)
- `ef58888` per-mesh bounding box + frustum culling (#34254) — **collides
  with §F's planned backend culling via `visible` from pager AABBs;
  reconcile at re-diff**
- `97adf2e` inline splat data reads (#34262)
- `3afdbd3` RGBA8 color packing in storage buffers (#34255)
- `047f268` TSL 4x8 pack/unpack (#34263)
- `5d5ebcf` **rename `GaussianSplatMesh` → `GaussianSplat`** (PR #34306,
  merged to dev 2026-08-19, assigned to **r186** — owner-verified). From
  r186 on, the file is `examples/jsm/objects/GaussianSplat.js` and the
  class/import name changes everywhere (doc 06 watch items 12/13).

## Per-release re-diff procedure

When a three.js release (or new dev snapshot) is adopted:

1. Fetch the upstream files at the release tag. Consult (then retire and
   re-date) the "Known upstream drift" section above; re-enumerate upstream
   changes since the snapshot — do not treat the recorded list as complete.
2. Diff each vendored file against its upstream counterpart.
3. Every hunk must be attributable to (a) an upstream change or (b) a titled
   patch in this file (the `[flatten-imports]` hunks fall under (b)). An
   unattributable hunk is a bug — stop and audit.
3a. Re-verify every INTERNAL SURFACE the `.ts` sibling patches inventory in
   their entries above (`renderer._attributes.delete`, storage-node `.value`,
   the `_buffers`/`_sort` field names, `device.limits.
   maxStorageBufferBindingSize`, …) against the new three version — the
   patches assert these at runtime and throw
   `ForkPatchError("fork-internals-missing")` when reshaped, but the re-diff
   is where the fix lands, not the field. (Owner ruling 2026-08-29: pure
   `.ts` siblings keep the JS byte-frozen; this step is the price.)
4. Re-apply titled patches on top of the new snapshot; re-run H-FORK
   (doc 05) before adopting.
5. Update the Provenance section and the SHA-256 digests with the new
   tag/commit — record the exact hash this time — and date the re-diff.
