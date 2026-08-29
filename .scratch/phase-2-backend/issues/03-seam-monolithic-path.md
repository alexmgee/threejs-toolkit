# 03 — SplatBackend seam + ThreeGsBackend + monolithic SPZ/PLY path

**Status:** done
**Blocked by:** None — can start immediately.

**What to build:** a small `.spz`/`.ply` scene loads and renders through the real
SplatBackend seam (doc 02 interface) on both backends — the first end-to-end splat
on the production runtime. The D18 backend placeholder is DELETED-AND-REPLACED,
never left beside real code. This ticket owns MONOLITHIC-path readiness
(`whenReady` resolves on first paint); paged readiness belongs to ticket 08 — the
two definitions must not be invented twice.

Standing rules bind (spec.md). Owner D23 ruling applies here: the seam becomes
load-bearing in this ticket.

- [ ] A fixture loads a small static asset via `backend.load()` and renders it on
      WebGPU and `?webgl=1`; screenshots at a pinned pose in Comments.
- [ ] `counts()` and `bounds()` match an independent CPU read of the same asset
      (bounds per-point, not 8-corner `applyMatrix4`).
- [ ] `whenReady()` resolves after first paint; `progress()` is monotonic across
      the load.
- [ ] Boundary guards (owner D23 ruling): the vendor→src / fork-internals rule is
      added to the boundary config and a deliberate violation fails the gate;
      src→examples and spikes-uncruised are recorded accepted-unguarded with
      reasons in Comments; examples→src/backend recorded open-by-design.
- [ ] The existing seam rule still holds: a deliberate outside-the-seam import of
      the fork fails the gate.
- [ ] The D18 placeholder's old exports are gone from the tree, not deprecated in
      place.

## Comments

**Note from ticket 02 (2026-08-23, citation corrected same day by review),
binding on this ticket's PLY loader:** raw 3DGS `.ply` stores opacity as
LOGITS — Spark's PLY reader applies the sigmoid at load:
`reference/spark/src/ply.ts:553-555`, `op = 1/(1+exp(-opacity))` (no clamp).
Do NOT copy ply.ts:673 — that is the INVERSE (write-side logit for
injectRgba) despite its "sigmoid" comment; applying it at load turns
opacity 2 into NaN. The `.rad` container is linear-alpha (doc 03 A1,
corrected); the read-side sigmoid belongs HERE, applied exactly once.

Confirmed independently in Spark's Rust (2026-08-27): `reference/spark/rust/spark-lib/src/ply.rs:115-116`
applies the same `1/(1+exp(-x))` to the PLY property literally named `opacity`
(`:858`); the write-side inverse is `ply.rs:1244` ("opacity -> logit(opacity)",
clamped ±100) — the Rust twin of the ply.ts:673 trap. Two witnesses, both
languages.

**Sigmoid placement resolved at build (2026-08-29):** the vendored
`createGaussianSplatGeometryFromPLYGeometry` ALREADY applies the read-side
sigmoid itself (`src/vendor/three-gs/GaussianSplatUtils.js:330`,
`sigmoid(opacity.getX(i))` with `sigmoid = 1/(1+Math.exp(-value))`, :29-33).
"Applied exactly once" therefore means the backend applies NONE — the vendor
conversion is the single application site. A backend-side sigmoid would be the
double-application twin of the write-side trap.

**Owner rulings taken at ticket start (2026-08-29):**
- **PLY only this ticket.** three 0.185.1 ships no SPZLoader (verified: only
  `PLYLoader.js` in `node_modules/three/examples/jsm/loaders/`). SPZ is a
  NAMED GAP tied to doc 06 watch item 13 (r186 ships SPZLoader → plain
  import then); the seam's `spz` branch throws a named refusal citing that
  item. Vendoring SPZLoader now rejected (permanent fork surface, no current
  consumer, obsolete in one release).
- **Fixture asset is GENERATED**: `scripts/gen-splat-fixture.mjs` (node,
  zero deps, zero randomness) → `examples/assets/splat-lab/fixture.ply`,
  48 splats (red/green/yellow 4×4 clusters at x=0/-3/+3, spacing 0.15,
  scale 0.25, identity rotation, opacity LOGITS cycling [4,2,0,-2]).
  Deterministic: two runs byte-identical, sha256
  `80eddee8fa2ab2e6c534c95009811d15256b83e02254170239234df216158751`
  (3,046 bytes). Verified by independent Python struct parse: count 48,
  bounds x ±3.225 / y ±0.225 / z 0 (f32), opacity cycle + log-scale +
  w-first quaternion all confirmed. Built by grok-4.6 (dispatch log
  `.collab-logs/t03-grok-*.{md,txt,log}`), re-verified by Claude.
- **Full doc 02 interface declared now**; unimplemented methods throw named
  refusals citing the owning ticket (dispose→04, raycast→Phase 3 §B,
  setEdits→Phase 3 §C, setMeshColor→Phase 4, setOptics→Phase 5).
- **Handle hand-over**: `SplatHandle.object: readonly THREE.Object3D`,
  caller composes — dated resolution note added to doc 02's seam section.
- **Progress definition (zero invented constants)**: `LoadProgress =
  { bytesLoaded, bytesTotal, phase: fetching|constructing|ready, fraction }`;
  fraction = bytesLoaded/bytesTotal during fetch, holds at 1.0 through
  constructing; ready/whenReady is the authoritative gate; monotone by
  construction. Ticket 08 owns the §A5 reveal refinement (noted in the
  type's doc comment). Implementation adds `failed` as a terminal phase for
  the named-refusal surfacing requirement (fraction freezes on failure) —
  an error-surface addition, not a progress-weighting decision.

**D23 boundary records (owner ruling 2026-08-23, executed 2026-08-29):**
- **(c) vendor→src now GUARDED**: rule `vendor-must-not-reach-src` in
  `.dependency-cruiser.cjs` (vendor is a leaf; the dependency arrow always
  points vendor-ward). Drilled: deliberate
  `GaussianSplatUtils.js → core/ThreeSplatScene` import appended → depcruise
  EXIT=1 naming `vendor-must-not-reach-src`; file restored byte-identical
  (sha256 `f65f9222…` before and after) → EXIT=0; no false positive on the
  legitimate tree (baseline EXIT=0, 140 modules / 416 deps,
  `.collab-logs/t03-cruise-*.txt`).
- **Existing seam rule still bites**: deliberate outside-the-seam fork
  import (`core/colorSpace.ts → vendor/three-gs/GaussianSplatMesh.js`) →
  EXIT=1 naming `vendor-seam-only`; restored → EXIT=0.
- **(b) src→examples: ACCEPTED-UNGUARDED.** Reason: no such edge exists
  today and the direction is implausible by construction — examples/ pages
  are Vite HTML entry points, not modules the library could resolve;
  tsconfig path aliases point examples→src only. A rule would guard against
  an import style nothing in the toolchain produces; revisit if src ever
  gains a dev-tooling module that tempts it.
- **(d) spikes/ uncruised: ACCEPTED-UNGUARDED.** Reason: spikes are
  throwaway measurement scaffolding with their own pinned deps; cruising
  them would lint dead code and add noise, while the live danger — anything
  under src/ or examples/ importing spikes — IS guarded (`no-spike-imports`
  covers `from: ^(src|examples)/`). Spikes importing each other or src is
  harmless-by-definition (they never ship).
- **(a) examples→src/backend: OPEN-BY-DESIGN** — the seam's public door;
  fixtures exercise the backend exactly the way consumers will.

**Behavioral exit evidence (2026-08-29, `examples/splat-lab/`, pinned pose
camera [0,0,6] FOV 60, background 0x111133; in-page suite quoted verbatim):**

WebGPU (default page):
```
backend: webgpu — 12 passed, 0 failed
PASS — counts-total: backend=48 independent=48
PASS — counts-resident-selected: resident=48 selected=48 total=48
PASS — bounds-match-independent: backend min=(-3.2249999046325684,-0.22499999403953552,0) max=(3.2249999046325684,0.22499999403953552,0)
PASS — sigmoid-opacity-bytes: 48 alpha bytes match sigmoid(logit)*255
PASS — progress-monotonic: ok (samples=25, sawReady=true)
PASS — whenReady-after-first-paint: paintsAtReady=1 phase=ready fraction=1
PASS — spz-named-refusal: load x.spz throws SplatBackendError citing watch item 13
PASS — dispose-named-refusal: dispose throws SplatBackendError citing ticket 04
PASS — pixel-center-red: rgba=[255,0,0,255]
PASS — pixel-left-green: rgba=[0,255,0,255]
PASS — pixel-right-yellow: rgba=[255,255,0,255]
PASS — pixel-corner-background: rgba=[17,17,51,255] near background
```

`?webgl=1`:
```
backend: webgl2-fallback — 12 passed, 0 failed
(identical 12 PASS lines; progress-monotonic: samples=3, sawReady=true;
whenReady-after-first-paint: paintsAtReady=4 phase=ready fraction=1;
identical rgba readbacks [255,0,0,255]/[0,255,0,255]/[255,255,0,255]/[17,17,51,255])
```

Screenshots visually confirmed on both backends (green left / red center /
yellow right gaussian blobs on 0x111133, identical layouts). The pixel
readbacks are the machine evidence; the page is reproducible at
`examples/splat-lab/` (dev server) on both backends.

The independent CPU read is a fixture-local DataView PLY parser (no vendor,
no backend imports); bounds compare per-point exact (===) per AC. Sigmoid
expectation computed via `Uint8ClampedArray` writes (native clamp-and-round —
handoff 005 trap 7: never Math.round for byte expectations a clamped array
produced).

**Adversarial review round (gpt5.6-sol, effort=high, read-fenced;
`.collab-logs/t03-codex-review.md`; every finding re-verified against source
before acting — confirm-or-refute, never absorb):** 8 findings.
- **CONFIRMED CRITICAL (fixed):** the pipeline's outer catch returned early
  on any SplatBackendError assuming `fail()` had recorded it — but the
  header/SH-degree helpers throw refusals directly, so a malformed PLY hung
  `whenReady` in "constructing" forever; and `fail()`'s own throw inside the
  catch escaped as an unhandled rejection. Fix: `fail()` records+rejects
  without throwing (idempotent), every failure site `return`s, the outer
  catch records helper refusals, and `whenReady` carries a no-op catch so a
  pre-listener failure can't fire unhandledrejection. Pinned by two NEW
  fixture drills: `missing-asset-fails-named` (404 → fetch-failed, phase
  failed) and `non-ply-payload-fails-named` (HTML payload → named reject, no
  constructing hang).
- **CONFIRMED (fixed):** runner crash showed "N passed, 0 failed" in pass
  styling (failed++ on runner catch); undocumented `min(1,·)` clamp vs the
  doc'd fraction formula (clamp now documented in LoadProgress); pixel
  asserts ignored alpha (all now require a===255) and the captureSync
  fallback swallowed ANY capture failure (now WebGL2-fallback-only, WebGPU
  rethrows); refusal stubs untested (all five remaining stubs + rad format
  now asserted); extrema-only bounds compare (added
  `positions-match-independent`: all 48 xyz triples exact === against the
  independent parse); "nine methods" miscount in doc 02 note / handle
  comment (reworded to the exact doc 02:67-84 set).
- **PARTIALLY ACCEPTED:** paint sentinel proves *a* paint, not *the mesh's*
  paint — whenReady assert now also requires the mesh present
  (meshChildren=1); fully independent mesh-paint ordering would need to
  instrument the very hook under test, recorded as an accepted residual.
  Progress "controlled chunk stream" harness deferred: ticket 08 owns §A5
  refinement; the failed-freeze path IS now exercised by the two failure
  drills.
- **REFUTED:** "separate the inline decoder from the public backend barrel"
  — contradicts the owner's D18 ruling (ticket 02 Comments / handoff 005:
  the decode export lives on in whatever replaces the barrel); the
  lib-barrel cruiser rule guards the consumer surface (src/index.ts), and
  dist-lib tree-shakes the unused decode edge (ticket 02's measured lib
  build). Residual noted: importing the backend BARREL from an app bundles
  the inline worker — consumers use src/index.ts or the module paths, as
  the guard comment instructs.

Post-fix re-run: **20 passed, 0 failed on BOTH backends** (webgpu and
webgl2-fallback; identical rgba readbacks as above; paintsAtReady 2/3,
meshChildren=1, sawReady=true both).

**Built-in /code-review round (high effort, 8 finder angles + verification,
after the adversarial round; 10 findings reported, all fixed same session):**
- **Built page died** (CONFIRMED by an actual `vite build`): the 3 KB
  fixture.ply inlines as a data: URL (under Vite's 4096-byte
  assetsInlineLimit) and extension inference fails on data URLs → the
  fixture now passes `format: "ply"` explicitly. Proven fixed by serving
  `dist/` via `vite preview` — the BUILT page runs 21/21 (both a WebGPU and
  a `?webgl=1` run).
- **Silent NaN mesh** (CONFIRMED against PLYLoader.js:648-656): a plain
  mesh PLY maps absent splat properties to undefined→NaN full-length
  attributes, converts "successfully", and reaches ready invisible. Fix:
  `validateSplatPlyHeader` refuses (`not-splat-ply`) when any required
  INRIA property is missing from the header; pinned by a new fixture drill
  loading a synthesized mesh-only PLY via Blob URL.
- **Embed regression** (CONFIRMED by measurement): the embed build's entry
  was the backend barrel; ticket 03's value exports ballooned
  `dist-embed/embed.js` 213 kB → 1,157,614 B. Fix: dedicated decode-only
  `src/backend/embed-entry.ts`; measured back to **215,915 B / 95,365 B
  gzip**. Doc 06 D18 CLOSED with the same note. (No gate pins the embed
  size — trap-1 shape; candidate tripwire recorded below.)
- **CRLF headers falsely refused** (CONFIRMED vs PLYLoader.js:148) → header
  scan now accepts `end_header\r?\n`. **Whole-file TextDecode ×2** → one
  bounded 64 KiB prefix decode. **Dead `=== null` guard** → undefined check
  + `ply-missing-position` named refusal + `Box3.setFromBufferAttribute`.
  **Compressed content-length** → reported bytesTotal can never sit below
  bytesLoaded. **whenReady precondition** documented on the seam (paint-
  observed; object must be in a rendered scene) and the fixture gained a
  250 ms ready-kick watchdog so a hidden pane can't hang the await.
  **Error-message prefix** dropped (name supplies it). **Assertions moved
  to `error.reason` codes** (prose stays only for owner citations); the
  missing-asset drill uses a fixed path and accepts either named reason
  (404 vs SPA-fallback hosts). Refusal coverage extended to ALL stubs.
- Deferred out of scope (recorded as task chips, not fixed here): the
  fixture assert/summary harness + xFrac + verdict CSS are copies of
  decode-lab/scene patterns (extraction belongs in examples/shared);
  decode-lab's own copy still renders a crashed runner as green.

**FINAL evidence (post-both-reviews tree, quoted from the page):** dev
WebGPU `21 passed, 0 failed` · dev webgl2-fallback `21 passed, 0 failed` ·
BUILT page (vite preview) `21 passed, 0 failed` on both a default and a
`?webgl=1` run; identical rgba readbacks ([255,0,0,255] / [0,255,0,255] /
[255,255,0,255] / [17,17,51,255]); `npm run check:full` EXIT=0 (146
modules / 430 deps cruised, 6 crate tests incl. golden).

**Fixture instrumentation findings (2 FAIL→fix rounds, both fixture-side,
backend unchanged):** (1) first-paint counting via the scene's `onFrame`
misses the facade's forced first init render (ThreeSplatScene.ts:192, direct
render bypassing the animation loop) — a local fetch beats WebGPU init, so
that init frame IS the mesh's legitimate first paint; replaced with a
paint-sentinel mesh (colorWrite/depthWrite off, frustumCulled off,
onAfterRender counter). (2) rAF-driven progress sampling never ticks in a
hidden pane (handoff trap 4) and would have passed vacuously — replaced with
a 16 ms interval sampler that must OBSERVE phase "ready" (non-vacuous), plus
one deterministic final sample to close the assert-vs-interval race seen
when visibility flips.

**Status change: done — all six ACs met with evidence above (2026-08-29, commit b9af209).**
