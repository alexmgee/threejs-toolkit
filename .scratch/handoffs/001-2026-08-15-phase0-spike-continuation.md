# Handoff 001 — Continue the Phase 0 spike, mid-task-4

Written 2026-08-15 by the last sparkjs-toolkit-anchored session. You are the first
session anchored in `D:\Projects\threejs-toolkit`, where all work now happens.
sparkjs-toolkit (`D:\Projects\sparkjs-toolkit`) is **permanently read-only** — reference,
assets, and parity control only.

## Next session's goal

Finish Phase 0: PagePool + mesh fork (tasks 4–5 below), light up the 204 MB hero on
both backends, then run the ten measurements against the Spark control (task 6) and
write `docs/plan/results/phase-0.md`. Per **ADR 0001 the spike is a baseline, not a
gate** — misses become named optimization items, never stops.

## Read these before any code (in order, all in this repo)

1. `CLAUDE.md` — repo conventions (issues in `.scratch/<slug>/`, ADRs continue from 0003).
2. `docs/plan/00-charter.md` → `06-open-decisions.md` — the complete plan; 06 holds
   every settled decision (D1: port unconditional; D2: no laziness, first-class
   everything; D11/ADR 0002: disjoint composition).
3. `spikes/native-rad/FORMAT.md` — the .rad byte contract, verified against the real
   hero. **Never re-derive format facts; this file is the authority.**

## State: what is DONE (all committed; history starts at `16ea69d`)

- **Task 1** — FORMAT.md extracted from Spark's `rad.rs` and byte-verified against
  `lab-sh1-sparsity.rad` (204 MB, 7,935,358 splats, 122 chunks, maxSh 1, lodTree,
  chunkSize 65,536, chunksStart 8128).
- **Task 2** — `spikes/native-rad/` scaffold: three **0.185.1** + vite; vendored
  dev-branch addon (`vendor/GaussianSplatMesh.js` + CountingSort + Utils) **compiles
  and renders on published three** — WebGPU probe 24.7% coverage / 141 ms first /
  4.4 ms steady; WebGL2 fallback 23.0%.
- **Task 3** — `rad-three/` WASM decoder (151 KB): decodes hero chunk 0 correctly on
  first golden run (`cargo test --release` in `rad-three/`). Diagnostics: chunk 0 has
  27,317 interior LOD nodes; 6,536 nodes with alpha>1 (lodOpacity aggregates —
  empirical confirmation).
- **Task 4 (partial)** — written: `src/RadHeader.ts` (container parse),
  `src/RadFetcher.ts` (prefetch-all, 206-or-die), `src/rad-worker.ts` (single worker
  wrapping WASM, transfers all arrays). NOT written: PagePool, LOD frontier,
  main.ts hero mode.

## Since this handoff was written (same day, later session)

- **Trap 6 is resolved.** `.claude/launch.json` now exists HERE, with `native-rad-spike`
  (port 5209) and `spark-parity-control` (sparkjs-toolkit dev, port 5173). Stop using the
  sparkjs-toolkit shim. The file is **gitignored** (machine-local, holds absolute paths) —
  if it's missing, recreate it; it is not in history. It is only visible to a session
  anchored in `D:/Projects/threejs-toolkit`.
- **Re-verified by execution, not assumption:** `npm run check` exit 0 · `npm run smoke`
  exit 0 (11 modules) · `cargo test --release` → `decodes_hero_chunk0 ... ok` ·
  hero over `/@fs/D:/Projects/sparkjs-toolkit/examples/assets/lab-sh1-sparsity.rad` with a
  Range header → **206, exact byte count**. The 206-or-die transport path is real, not
  inferred.
- **Port 5209 may already be held** by a parallel session. `--strictPort` turns that into
  a hard failure (`Error: Port 5209 is already in use`), and a `curl` against 5209 will
  still return 200 from the *other* server — that check cannot distinguish them. Use a
  free port to test a config change.
- **README corrected** (commit `3ffe260`): it claimed three.js **r186**; the real pin is
  **0.185.1** with the addon vendored from the dev branch. Ground rule 2 no longer claims
  "no frame has been rendered" — it now expires against `docs/plan/results/phase-0.md`.

## What remains

**Task 4 (finish)** — `src/PagePool.ts`: 32 pages × 65,536 splats fixed capacity
(2,097,152 splats; 33.6 MB per storage buffer — safely under binding caps). LRU only
matters once >32 chunks stream; hero has 122. Node tables per resident chunk (center,
maxScale-as-size, alpha, childCount, childStart — childStart indexes the GLOBAL splat
array, children live in OTHER chunks). **Frontier rule** (= progressive reveal): a
node renders iff `childCount==0` OR children's chunk not resident OR projected size
below threshold (then prune children). Re-run traversal on page arrival AND camera
move; write selection flags.

**Task 5** — `GaussianSplatMesh.fork.js` (copy `vendor/GaussianSplatMesh.js`, edit):
(a) `{capacity}` option → allocate the four vec4 storage buffers + SH at capacity from
empty arrays, `instanceCount = capacity`; (b) `uploadPage(slot, DecodeResult)` →
subarray writes + `addUpdateRange` + `needsUpdate` (partial-update path exists —
`three.webgpu.js:33071` honors `updateRanges`; **assert at runtime** it's hit, else
fall back to full-buffer upload and record the cost); (c) selection via `center.w`
(0 = deselected → degenerate quad in vertex node; keeps CountingSort untouched);
(d) explicit sort + SH invalidation after every upload/selection change — **nothing
updates by itself**, arrivals under a motionless camera must still appear (H-LOAD
criteria 9–10).

**Task 6** — `measure.ts`: extend the proven `window.__spike.probe()` pattern.
5 cold-cache trials × {WebGPU, `?webgl=1`}: navigation→first-pixel, →full-quality,
longest main-thread block (LongTask observer), peak JS heap, peak GPU (best-effort).
Spark control: sparkjs-toolkit loadtest sandbox (`npm run dev` there, or launch entry
`toolkit-dev`), same asset + camera pose. Results table →
`docs/plan/results/phase-0.md` with the H-LOAD criteria from
`docs/plan/05-parity-verification.md`.

## TRAPS — every one cost real time today

1. **`updateSort(renderer, camera)`** — two args. Passing only `camera` throws
   `undefined matrixWorldInverse`. Same for `updateSphericalHarmonics`. The assessment
   docs' API table omits the renderer arg.
2. **Hidden Browser pane parks rAF** — `setAnimationLoop` never fires, HUD stays
   "boot…", screenshots time out. Verify via `window.__spike.probe()` (offscreen
   render + readback), never via the animation loop.
3. **WebGL-backend async readback deadlocks hidden** — `readRenderTargetPixelsAsync`
   awaits a fence resolved only on an animation tick. The probe's WebGL path instead
   does `render()` then same-task `drawImage(canvas)` → `getImageData`. Keep it.
4. **`oct88r8` is per-splat triplets, NOT transposed** — the one codec that differs
   from the dimension-major rule (FORMAT.md table). `r8_delta` delta-runs are
   per-dimension rows in the transposed layout.
5. **Scales come out LINEAR** — `ln_f16` decode already applies `exp()`. Never exp
   twice. Alpha is linear too; **alpha>1 is legal** (LOD interiors) — clamp only at
   the RGBA8 write, keep raw alpha for selection.
6. **Dev-server shim**: the spike's launch entry lives in
   `sparkjs-toolkit/.claude/launch.json` (name `native-rad-spike`, port 5209, npm
   `--prefix`). From the new anchor, add a proper `.claude/launch.json` HERE and stop
   using the shim. The hero is served via vite `server.fs.allow` +
   `/@fs/D:/Projects/sparkjs-toolkit/examples/assets/...` — vite serves Range/206
   (verified via `RadFetcher.fetchHeader` throwing on non-206).
7. **`npm run smoke`** (vite build) is the fast addon-compile check;
   `npm run check` = tsc. Vendored addon has no TS declarations —
   `@ts-expect-error` on its imports is intentional (plan doc 03 §F).
8. **Windows/npm**: every Bash command resets cwd to the anchor; use absolute paths
   or `-C`/`--prefix`. (Anchored here now, this mostly self-resolves.)

## Suggested skills

- `/spark` — when comparing against Spark behavior or reading its source
  (`D:\Projects\sparkjs-toolkit\reference\spark\`).
- `/webgpu-tsl` — for the fork's vertex-node selection edit (TSL) and storage-buffer
  update semantics.
- `/performance-optimization` — task 6 instrumentation (LongTasks, memory probes).
- `/threejs-core` — general three.js questions; NOT for splat specifics (vendored
  source is the truth).
- `agent-collab` — only if dispatching to codex/grok; posture and recipes as in
  `D:\Projects\agent-collaboration\`.

## Wider context (one line each)

- Decisions ledger + upstream watch list: `docs/plan/06-open-decisions.md`.
- Why no time estimates anywhere: charter invariant 3, `docs/plan/00-charter.md`.
- Ten measurement criteria definitions: `docs/plan/05-parity-verification.md` (H-LOAD).
- Adversarially reviewed proposal behind the plan:
  `sparkjs-toolkit/docs/research/2026-08-14-threejs-port-proposal-reviewed.md`.
- Raw hostile-review JSON (file:line evidence):
  `sparkjs-toolkit/.collab-logs/verify-*.out.md`.
- Owner working rules that don't carry via files: plain-English explanations
  (git especially); verify before claiming; no feature cuts, no laziness (D2);
  never offer time estimates; ask only load-bearing questions.
- `GLOSSARY.md` at repo root is expected by CLAUDE.md but missing — seed it when pager
  terms (page, frontier, resident, preserve-at-decode) first hit code review.
- Interactive findings page (artifact e96a65eb-…): source at
  `sparkjs-toolkit/docs/research/threejs-port-findings.html` — update only from over there.
- A background session was runtime-confirming sparkjs CropTool's `"SPHERE"` enum bug;
  outcome unknown here — affects only plan doc 06 D5's oracle note, not spike work.
