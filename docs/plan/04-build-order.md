# 04 — Build order

Reframed from the reviewed proposal's in-place plan for the sibling-repo reality.
Ordering principle unchanged: **the unknown most able to cancel or reshape the project
is resolved first and cheapest.** Every phase names entry criteria, work, exit
criteria; early phases end in decision gates. No durations (charter invariant 3);
sizes are the reviewed adaptation-point counts, reinterpreted for copied files.

A greenfield note: because nothing here can break sparkjs-toolkit, the *risk* ordering
matters less than in-place — but the *information* ordering matters exactly as much.
Building the easy 62% first would feel productive and prove nothing. The spike still
goes first.

> **Amendment 2026-08-16 (ADR 0003).** Phase 0's description below is corrected in
> three places: measurements are **absolute baselines for this toolkit**, so no Spark
> control trials run (Spark figures are context only); the page pool is a
> **runtime-derived budget**, not a fixed 32-page pin; and the trials run in **two
> regimes** (derived default + `?pages=32` eviction regime) rather than against a
> control. Phase 0's measured outcome is `docs/plan/results/phase-0.md`.
>
> **Ticketing note (2026-08-19).** Phase 1 executes as 11 graph-verified tickets
> in `.scratch/phase-1-foundation/`. Owner rulings at ticketing: the embed set
> (SplatSiteElement, FragmentRouter, register, diagWiring.stub — 4 of the 86 —
> plus the SiteRuntime/diagWiring re-typing) moves to Phase 2, so **Phase 1
> copies 82 of the 86**; `SplatTextMesh` ships as an API-preserving typed stub
> (doc 06 D19); `SparkPagerAdapter` is carried through Phase 1 and deleted in
> Phase 2 (doc 03 §G); D16 ruled — visual comparison harnesses survive, so this
> phase's H-GRADE exit stands as written.

---

## Phase 0 — The spike  ·  0 toolkit files · 9 spike files  ·  BASELINE

**Question it answers:** how does a toolkit-owned pager on three.js perform on the
real hero, as this toolkit's own baseline — and how does the WebGL2 fallback behave?
(Per ADR 0001 the port is unconditional: the spike measures and sets the
optimization baseline; it no longer holds a cancellation power.)

**Entry:** the local r186 snapshot; one real hero `.rad`; permission to compile the
Rust reference decoder.

**Work** (`spikes/native-rad/`, never imported by src/): `index.html`, `main.ts`,
`RadHeader.ts`, `RadFetcher.ts`, `rad-worker.ts`, `measure.ts`,
`GaussianSplatMesh.fork.js`, `rad-three/Cargo.toml`, `rad-three/src/lib.rs`.
Implements only: correct RAD0 parsing (§A1 math), range fetch, one decode worker,
runtime-derived page pool (`pages = min(P_limits, P_asset)` from the created device's
real limits per ADR 0003 — 122 pages on the trial machine; `?pages=32` is the
constrained eviction-test regime only), base+SH upload, explicit sort/SH
invalidation, the pinned test camera pose, WebGPU + forceWebGL runs. Two free
extras while in there: confirm raycast absence empirically (**done** — 9 rays,
0 hits); time a picking prototype for the §B route choice (**not done** — moved
to Phase 3 entry).

**Exit:** the ten numeric criteria of doc 05 H-LOAD *as amended*, five cold-cache
trials per backend in each of the two regimes, recorded as absolute baselines.
**Met 2026-08-16** — `docs/plan/results/phase-0.md`.

**STEERING (ADR 0001):** the ten criteria are recorded as the project baseline.
Misses on reveal (1), fallback frame cost (5) or memory (6) open named optimization
items that Phase 2 must carry forward; misses on correctness criteria (2, 7–10) are
bugs fixed in the spike before promotion. Nothing here stops the port — the spike's
job is to make every later optimization argument a comparison against measured
numbers instead of guesses.

## Phase 1 — Repo scaffold + COPY mass + renderer foundation  ·  47 adapt points  ·  GATE

**Entry:** Phase 0 passed. r186 published (or the snapshot pinned with a re-verify
task recorded).

**Work:**
1. Scaffold: package.json (three pinned **0.185.1**, no Spark — r186 is not
   published as of the 2026-08-19 check, watch item 13; the `GaussianSplatMesh`
   addon stays vendored from the dev branch until it ships in a release),
   tsconfig, vite configs (WASM worker bundling deferred to Phase 2 — owner
   ruling 2026-08-19, ticket 01), lint rule enforcing the vendor-import
   boundary. No `three-gs.d.ts` — hand-written declarations rejected; the
   vendored JS is inferred-from but never checked (same ruling, doc 03 §F).
2. Copy the 86 COPY files + barrel; compile clean.
3. `ThreeSplatScene`: WebGPURenderer via the sync-facade + ready-promise pattern;
   `workingColorSpace = SRGBColorSpace`; tone-mapping/background parity with
   SparkScene's choices.
4. The 47 renderer adaptation points across the 18 three-only files: CameraSystem
   literals + dead fields, MediaLayer capabilities throw, EnvironmentLoader async
   PMREM, SceneGrade → node PostProcessing + TSL (largest single item).
5. Vendor the fork **unmodified** (delta zero) + `FORK.md` scaffold.

**Exit:** every copied sandbox that needs no splats runs; a plain three.js mesh scene
renders under ThreeSplatScene on both backends; MediaLayer color re-measured and
recorded as the new baseline; SceneGrade output approved against sparkjs-toolkit
side-by-side (H-GRADE).

**GATE:** if SceneGrade cannot reach visual parity on node PostProcessing (upstream
WebGPU post-processing is young — watch condition 13), decide grade-parity-later vs
block, with the owner. Everything else here has no plausible blocker.

**GATE resolved 2026-08-22: grade-parity-REACHED (H-GRADE approved on the
ticket 10 evidence).**

**Met 2026-08-23** — all 11 tickets of `.scratch/phase-1-foundation/`
done (spec.md ticket map; per-ticket evidence in each issue file's
Comments); GATE resolution above; barrel naming ruled D24 (doc 06).

## Phase 2 — Backend + production pager + load contract  ·  ≥114 adapt points  ·  GATE

**Entry:** Phases 0–1. The spike's numbers are the bar to beat.

**Work:** promote spike → `src/backend/` per doc 02: SplatBackend seam;
ThreeGsBackend; RadPager (4-worker pool, device-classed page budget, LRU, LOD
traversal, `center.w`+`setBinNode` selection, explicit invalidations); monolithic
SPZ/PLY path for small scenes (same seam); dispose + capacity guard + culling in the
fork (first real fork deltas, each a titled FORK.md patch); load/reveal/ready contract
(§A5) wired into the copied SplatSiteElement untouched; SiteRuntime seams re-pointed
(:2221 registration, :4133 teardown); StatsHUD/SplatBounds fed from backend counters;
diagnostics rewired (§G) and the ~4,300 gross lines left behind for good.

**Exit:** H-LOAD re-run **on the production runtime** matches or beats the spike;
H-LIFE (load→dispose→load ×N, memory flat); a real site.json drives the whole element
end to end on both backends.

**GATE:** regression vs the spike's own numbers ⇒ the integration (not the concept)
is at fault; find it before any interaction work stacks on top.

## Phase 3 — Interaction: picking + SDF edits  ·  18(+1) adapt points  ·  GATE

**Work:** time both §B candidate routes at phase entry (CPU ray-ellipsoid over
retained position+covariance with page-AABB pre-filter, vs GPU ID/depth readback) —
Phase 0 confirmed raycast absence empirically but did **not** choose a route, so the
choice lands here — then put the winner behind `backend.raycast()`; re-point all
three consumers. EditLayer (§C route 2 first: `colorRead` compute + pristine
copy); SplatHighlight on it; CropTool preview on it (pending Q7's answer on whether
the original preview ever worked); dynamic edit capacity; WebGL2 fallback edit path;
SceneComposer crop hydration (+1).

**Exit:** H-PICK and H-EDIT parity on both backends.

**GATE:** this phase prices the fork honestly — if route 2 proves insufficient and
route 1 (node-graph surgery) balloons the fork delta, the owner re-answers Q5/Q6
(glow/crop worth it?) with real costs in hand.

## Phase 4 — Assets: export + text + bounds tail  ·  ≥16 adapt points

**Work:** preserve-at-decode attributes through pager + loaders; SplatExporter on
them; `textSplatGeometry.ts` + SplatTextMesh rebuild (8 regions); recolor/opacity via
`setMeshColor`; bounds percentile clamping + rail-sandbox centroid call site.
**Exit:** H-ASSET (export round-trip; text parity vs sparkjs-toolkit).

*Bounds percentile clamping is a framing REQUIREMENT, not polish (2026-09-19, measured in
Phase 2 ticket 11):* floaters set 94 % of the hero's exact centre box — the centre-spread
diagonal is ≈64 units for the middle 98 % of splats, ≈155 for the middle 99.8 %, and ≈1,085
for the exact min…max. A camera framed on the exact union therefore stands ~17× too far out;
measured end to end in text-lab, it landed INSIDE the box and the obstacle stopped projecting
at all. The pin hid this by SAMPLING (its undershoot skipped the floaters); exact bounds — the
Phase 2 contract — cannot. Until this lands, splat framing is honest only on floater-free
assets. Evidence and the full distribution: Phase 2 ticket 11 Comments.

## Phase 5 — Optics  ·  14–16 adapt points

Last: nothing depends on it, so it is ordered last for scheduling reasons only —
doc 06 **D10** rules DoF is built regardless of current usage, so this phase is
not cancellable. **Work:** DoF uniforms in the
forked vertex node (Spark-congruent math, 512 radius cap); `setOptics` per rail stop;
DebugPanel optics folder rewired. **Exit:** H-OPTICS focus-ramp parity.

## Phase 6 — Hardening + first consumer switch

Device matrix (desktop WebGPU, desktop forceWebGL, one real mobile, one iOS/Safari —
Q4/Q6 decide weight); full H-suite on the kitchen-sink example; TOOLKIT-GUIDE /
CLAUDE.md / GLOSSARY.md for this repo; then **one** consuming site switches its `file:`
dependency — **alexgee.online first, per doc 06 D15** (the owner's call; order is
inconsequential to the build plan) — runs its own content through the harness, and
ships. Remaining sites follow.

---

## Standing rules across all phases

- FORK.md updated in the same change as any vendor edit — no drift, ever.
- Every "while we're at it" → doc 06, not code (charter non-goal 1).
- Each phase ends with its H-suite results written to `docs/plan/results/phase-N.md` —
  measured numbers, not adjectives. Claims without artifacts do not close a phase.
- Upstream watch (doc 06 list) checked at each phase boundary; if upstream lands
  streaming/raycast/dispose mid-build, prefer deleting our code to keeping it.
