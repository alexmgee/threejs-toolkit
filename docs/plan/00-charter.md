# 00 — Charter

## Goal

A functioning three.js-native version of sparkjs-toolkit: every aspect of the original
analyzed and considered, with a clear, informed transition plan, a clear picture of what
does not translate, and a considered plan for rebuilding what must be rebuilt.
(Owner's words, 2026-08-14.)

Concretely: a visitor loads a site built on threejs-toolkit and gets the same experience
a sparkjs-toolkit site gives today — the frozen frame, live markers, tour and explore,
annotations with rules, progressive scene reveal — with three.js r186's own splat
renderer underneath instead of Spark.

## The sibling-repo decision (owner, 2026-08-14)

This is a **new repo**, not an in-place migration. Consequences, all deliberate:

- **sparkjs-toolkit stays whole and untouched.** It keeps serving its sites. It is the
  permanent reference implementation and control group for every parity test.
- **There is no "cutover" and no rollback risk.** Sites switch by changing one
  `file:` dependency (`"sparkjs-toolkit": "file:../sparkjs-toolkit"` →
  `"threejs-toolkit": "file:../threejs-toolkit"`), per site, whenever each site is ready.
  A site that never switches loses nothing.
- **The reviewed proposal's in-place scope counts reinterpret cleanly.** "Edit regions in
  existing files" become **adaptation points in copied files** — same places, same work,
  but performed on a copy, so a mistake never harms the original.
- **The two toolkits may temporarily disagree** — that is fine. Divergence is measured by
  the parity harness (doc 05), not prevented by discipline.

## Non-goals

- Improving on Spark's feature set. Parity first. Every "while we're at it" idea gets a
  line in `06-open-decisions.md` instead of code.
- Preserving sparkjs-toolkit's *internal* structure where it exists only to serve Spark
  (the pager adapter, the reveal-gate internals). Public behavior is the contract, not
  private plumbing.
- Supporting the classic `THREE.WebGLRenderer`. This toolkit is WebGPURenderer-only
  (with its built-in WebGL2 fallback backend). That is a hard constraint of the upstream
  splat addon, not a choice.

## Invariants

1. **sparkjs-toolkit is read-only to this project.** No file there changes because of
   work here. (The one exception already made, with the owner present: research docs and
   `.collab-logs/` were *added* there before this repo existed.)
2. **Public API parity is the target contract.** `<splat-site>` and its events, the
   `site.json` schema, `createSiteRuntime`, the authoring panel behavior — identical
   unless a divergence is recorded in `06-open-decisions.md` with the owner's sign-off.
   This is what makes the one-line dependency switch real.
3. **No duration estimates.** The owner ruled them out: nobody knows his velocity, so a
   day figure is invented precision. Scope is counted in verifiable units — files,
   adaptation points, new modules, deleted lines — every one checkable by reading source.
4. **Verification is by artifact and measurement, never by claim.** A green build proves
   compilation; only the parity harness (doc 05) proves behavior.
5. **Decision gates are real.** A gate that fails stops the line at that phase. The
   fallback postures (keep using sparkjs-toolkit for heavy sites; ship threejs-toolkit
   only for light ones) are documented outcomes, not defeats.

## The one sentence of risk, up front

three.js r186's splat renderer exposes **one public option** (`autoSort`) and **zero** of
the five capabilities this toolkit needs beyond basic drawing. Everything distinctive —
streaming, picking, edits, optics, teardown — is built on private internals or a fork,
and re-verified against every future three.js release. The charter accepts this with
open eyes; doc 03 itemizes exactly which private surfaces are touched and where.

## Naming

- Repo: `D:\Projects\threejs-toolkit`
- Package name: `threejs-toolkit` (private, consumed via `file:` like its sibling)
- The forked upstream files live under `src/vendor/three-gs/` with a `FORK.md` recording
  the exact upstream commit, every local change, and the re-diff procedure per release.

## Provenance and trust level

This plan derives from the adversarially reviewed proposal
(`sparkjs-toolkit/docs/research/2026-08-14-threejs-port-proposal-reviewed.md`):

- 16 Claude agents read every relevant source file in both codebases.
- All 5 first-pass capability verdicts were **refuted** by hostile reviewers
  (gpt5.6-sol ×3, grok-4.5 ×2; 71 corrections); the corrected findings are what these
  docs contain.
- **Nothing has been executed.** Every performance claim is a structural reading.
- three.js r186 is **unpublished** (npm at 0.185.1 as of 2026-08-14; r186 due
  2026-08-19). All addon facts come from a local snapshot of the dev branch at
  `sparkjs-toolkit` scratchpad `three-gs/`; every file:line cited in doc 03 must be
  re-verified against the published r186 before Phase 1 begins. The spike may run
  against the snapshot.
