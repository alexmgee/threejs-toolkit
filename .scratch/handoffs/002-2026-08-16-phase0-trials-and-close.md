# Handoff 002 — Run the Phase 0 trials, close Phase 0

> **UPDATE (same day, later): PHASE 0 CLOSED.** The 20 trials ran (results in
> `docs/plan/results/phase-0.md`), `/pocock-code-review` ran on both axes
> (Standards: 4 hard findings; Spec: 5 missing/partial + 2 refuted on
> verification), and ALL its fixes were applied same-session: README ground
> rules re-aligned with ADR 0003, stale claims corrected, the fixed GPU-bytes
> figure replaced by named derivation terms in `measure.ts`, criterion 8/9 wording made honest (by-construction /
> proxy-with-recorded-gap), criterion 7 split into count + pixel halves (count
> restores exactly everywhere; pixel-exact only where determinism is
> structural), first-pixel defined as a post-render proxy, raycast absence
> CONFIRMED empirically (9 rays, 0 hits, stock Mesh.raycast on the 4-vertex
> quad). Still open into later phases: the §B picking-prototype timing (doc 04
> free extra #2) and doc 06 D16/D17. Next session's goal: Phase 1 entry —
> scaffold + COPY mass + renderer foundation per doc 04, with the r186-publish
> watch item (doc 06 #13, due ~2026-08-19) checked first.

Written 2026-08-16 by the first threejs-toolkit-anchored session. Supersedes
handoff 001 (its tasks 4–6 are BUILT and runtime-verified; what remains is
measurement + review + closure).

## Next session's goal

**Phase 1 entry** (doc 04): repo scaffold, the COPY mass, renderer foundation.
Check the r186-publish watch item first (doc 06 upstream list #13, due
~2026-08-19) — if r186 shipped, re-verify doc 03's file:line citations before
building on them, and reconsider the vendored dev-branch addon.

Phase 0 itself is CLOSED: trials run, both reviews run, all findings applied.

## How to re-run a trial (the harness stays useful for Phase 2's re-measure)

1. Start `native-rad-spike` (launch.json, port 5209; 5209 may be held by
   another session — trap from handoff 001 still applies).
2. Keep the pane VISIBLE (rAF drives the trial machine; hidden = parked).
3. Navigate to `/?measure=1&v=<unique>` (default regime) or
   `/?measure=1&pages=32&v=<unique>`; add `&webgl=1` for fallback rows.
   Fresh `v` per trial = cold-cache (versioned URLs, doc 05 rule 1).
4. The page runs LOAD → STABILITY → DRAG → RESTORE itself and shows
   `TRIAL DONE` in the HUD; results accumulate in localStorage.
5. `window.__measure.report()` aggregates; `window.__measure.clear()` resets.

## State: DONE this session (all uncommitted — owner commits, never Claude)

- **Task 4 complete**: `src/PagePool.ts` — runtime-derived budget
  (min(P_limits, P_asset), `?pages=N` override), Spark-shaped traversal with
  foveation, priority-protection eviction (protect top-budget priority chunks,
  evict others oldest-first; deadlock-free), dirty-slot selection buffers,
  leaf-skip heap (~482K pushes at test pose), flat-flag chunk sets.
- **Task 5 complete**: `src/GaussianSplatMesh.fork.js` — four titled edits
  ([capacity] [uploadPage] [selection via center.w] [invalidate]) + WebGL PBO
  handling (`pbo.needsUpdate` on every storage write; SH1 byte view re-derived
  after setupPBO's array replacement) + partial-upload accumulation watchdog.
- **Task 6 built**: `src/measure.ts` (absolute-baseline instrument) +
  `main.ts` hero mode (budget derivation incl. WebGL MAX_TEXTURE_SIZE term,
  decode scheduler with zero-copy worker round-trip, 180° X-flip convention).
- **ADR 0003** + doc 05 H-LOAD amendment + doc 06 D16/D17 entries.
- **Reviews**: built-in /code-review (high) — 10 verified findings — and
  `/pocock-code-review` (both axes) both ran; all findings applied. A follow-up
  stale-claim sweep across every doc this session touched found 9 more
  (doc 04 never got its ADR 0003 amendment; doc 05's "512 radius cap matched in
  fork" was false — the fork still has upstream's 1024). All fixed. Trail:
  `docs/plan/results/phase-0.md` §Review trail.
- **Verified by execution** (both backends, both regimes): see the results
  doc's "Verified by execution" table — range-only fetch, deterministic
  selection, eviction+restore machinery, motionless-camera invalidation,
  partial-upload path, orientation.

## TRAPS (new this session; handoff 001's traps still hold)

1. **The scene data is Y-down.** sparkjs-toolkit applies a 180° X-flip in
   `SplatLoader.ts:81-88` — but it is **conditional**, inside `if (eulerRotationDeg)`:
   the field's *presence* arms the flip (lab.site.json authors `[0,0,0]`, which still
   flips), and a mesh loaded via `quaternion` or with no rotation field gets **no**
   flip. Raw Spark with no rotation field (the loadtest control) renders upside down.
   Our hero mesh applies `rotation.x = Math.PI` to match the site-json path; when the
   toolkit port lands, reproduce the *condition*, not a blanket flip.
2. **Hidden pane ≠ just parked rAF**: `innerWidth/innerHeight` are 0 (guard
   via `viewSize()`), `setTimeout` is heavily throttled, and worker messages
   still flow — the pager self-drives via the `document.hidden` branch in
   `worker.onmessage`.
3. **WebGL storage writes need `attribute.pbo.needsUpdate = true`** or they
   never reach the shader (the PBO DataTexture re-uploads only on its own
   flag; three.webgpu.js:64682). Also setupPBO REPLACES `attribute.array` —
   never cache views across the first render.
4. **Do not assert partial-upload consumption right after a render** — async
   decode results push ranges between render and assert (false "broken").
   The fork's accumulation watchdog (>10,000 ranges) is the race-free signal;
   `assertPartialUploadConsumed()` only in controlled probe sequences.
5. **Offscreen RenderTarget probes under-read coverage** vs the canvas
   (0.749 vs 0.996 — splat sizing at small targets). Compare like with like.
6. **Traversal costs ~260 ms** at ?pages=32 steady state on the main thread —
   expect ~1 s-class at 122 pages; it is a NAMED optimization item (worker
   traversal, Phase 2), not a bug to "fix" during trials.
7. **Owner directive (binding)**: never evaluate against sparkjs-toolkit
   metrics. Absolute baselines only; Spark is concept reference. ADR 0003.

## Wider context (one line each)

- Pool-size derivation + all research: ADR 0003; raw mission logs
  machine-local in `.collab-logs/` (gitignored).
- Open decisions raised this session: D16 (how far the no-comparison ruling
  reaches into H-VISUAL/H-PICK/H-EDIT), D17 (covB.zw dead lanes) —
  `docs/plan/06-open-decisions.md`.
- The ten criteria as amended: `docs/plan/05-parity-verification.md` §H-LOAD.
- Execution-verified facts + named optimization items:
  `docs/plan/results/phase-0.md`.
- `requiredLimits` seam: three accepts it, doesn't request adapter limits by
  default (2 GiB available on this box, unneeded at hero scale) — ADR 0003.
- Memory notes for future sessions: `challenge-arbitrary-constants`,
  `no-spark-comparison-metrics` (auto-memory dir).
- grok-4.6 model id verified in the agent-collab CHANGELOG (2026-08-16 entry).
- Kuato session-memory API was not consulted this session; nothing to flag.
