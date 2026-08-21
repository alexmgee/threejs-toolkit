# Handoff 003 — Phase 1 core landed; next: ticket 10, the GATE

2026-08-20. Written for a COLD session with no memory of this one. Goal of
the next session: **TICKET 10 — SceneGrade on node PostProcessing, the
Phase 1 GATE.** Everything below exists so you never re-derive it.

## State

| Ticket | What landed | Commit |
|---|---|---|
| 01 scaffold | buildable package, gate = typecheck + boundaries + BOTH vite builds | `b26060c` |
| 02 fork | 3 vendored addon files at delta zero + FORK.md + `.gitattributes -text` | `e4aca4e` |
| 04 foundation | 32 COPY files, adapted CameraSystem, rail fixture, examples/ boundary rules, D20–D23 | `f9f7b59` |
| 03 scene | ThreeSplatScene on BOTH backends (pixel-proven), colorSpace.ts, D22 typing widen | `04378f6` |

Frontier: 05 / 07 / 08 / 09 / 10 are all unblocked (10 needs 03+04 — both
done). **One ticket at a time; the owner names which. This handoff targets
10.** The GATE clause (doc 04): if SceneGrade cannot reach visual parity on
node PostProcessing, **grade-parity-later vs block is an OWNER decision** —
present evidence and stop, never self-rule. D16 means visual comparison
against sparkjs-toolkit IS the test — H-GRADE per doc 05. Number comparison
stays banned (ADR 0003).

## Read first, in this order

1. `.scratch/phase-1-foundation/spec.md` — standing rules 1–8 bind every
   ticket; R5 as amended (copy source rules + SHA-at-copy-time).
2. `.scratch/phase-1-foundation/issues/10-scene-grade-gate.md` — the ticket,
   INCLUDING its Comments: ThreeSplatScene's `clock` is a Timer (NO
   `elapsedTime` — use `getElapsed()`), `renderOverride` does not exist,
   generalize the capture code, and the linear-vs-sRGB readback caution.
3. `docs/plan/05-parity-verification.md` — H-GRADE definition + ground rules
   (rule 2: artifacts or it didn't happen; rule 4: both backends always;
   rule 5: hidden-tab discipline).
4. `docs/plan/06-open-decisions.md` — the decision ledger D16–D23 plus the
   sRGB constraint line; D-numbers are settled, do not re-litigate.
5. `src/vendor/three-gs/FORK.md` — fork governance, drift list, digests
   (SceneGrade's TSL work sits near the fork's rendering surface).

## TRAPS — each already cost real time this session

1. **WebGPU readback rows are 256-byte padded.** `W=256` in
   examples/scene/main.ts is LOAD-BEARING (guarded at runtime). Any capture
   width where `W*4 % 256 != 0` reads shifted garbage on WebGPU only.
2. **Readback row ORDER differs per backend** (GL bottom-up, WebGPU
   top-down). Only vertically symmetric sample rows are backend-independent
   — H-GRADE pixel-diffs MUST normalize orientation or sample y=H/2.
3. **THREE.Timer needs `connect(document)`** or tab-return deltas equal the
   whole hidden duration; the facade does this — don't construct raw Timers
   without it.
4. **sRGB set-too-late class of bug:** a working-color-space write after any
   `new THREE.Color()` silently linearizes earlier colors ([1,1,8] vs
   [17,17,51] for 0x111133 — that exact fingerprint shipped briefly).
   `core/colorSpace.ts` must be (transitively) imported before any renderer/
   color construction; ThreeSplatScene does it. ACCEPTED CONSTRAINT: with it
   set, assigning `outputColorSpace` on a CLASSIC WebGLRenderer throws
   inside three — self-enforcing, WebGPU path unaffected (doc 06).
5. **dispose/ready race:** three's `Renderer.dispose()` silently no-ops
   before init; the facade defers teardown until `ready` settles — copy the
   pattern, don't call dispose bare on uninitialized renderers.
6. **EnvironmentLoader is NOT a type-swap port** (ticket 08's corrected AC):
   it constructs CORE three's PMREMGenerator, which is WebGL-only — the
   port must use three/webgpu's own PMREMGenerator and await `ready`.
7. **Hidden-pane rAF trap (handoff 001 trap 2 still binds):** the harness
   pane pauses rAF and sometimes never lays out. Fallback readbacks poll
   fences via rAF (three.webgpu.js:68900) and NEVER settle hidden — use the
   demo's captureSync (same-task gl.readPixels) pattern; screenshots need a
   visible pane.
8. **CHECK must be the TRUE exit code.** `npm run check 2>&1 | tail` reports
   tail's exit, not npm's — this masked a real gate failure once. Redirect
   to a file and echo `$?` directly.

## Verification standard for the GATE

Pixel evidence by READBACK on BOTH backends, shown not summarized — a table
of sampled [r,g,b,a] values per backend, like ticket 03's. The pattern to
extend lives in `examples/scene/main.ts` (`capture()` async readback +
`captureSync()` fallback + the DEV hook); ticket 10's Comments tell you to
generalize it, not rewrite it. H-GRADE additionally requires the sparkjs
side-by-side (see below). "It builds" proves nothing — ticket 01's review
established that a green gate can be vacuous.

## sparkjs-toolkit relationship

- `D:\Projects\sparkjs-toolkit` is PERMANENTLY READ-ONLY. Every ticket.
- Phase 1's copy vintage = ticket 04's SHA-256 inventory (in its Comments);
  the working tree has moved past it (its ticket-13 work). D21: Phase 2's
  re-sync input is the diff between that inventory and sparkjs commit
  `59b65cf` — never "current disk".
- No sparkjs edits while a copy ticket runs (the drift mid-ticket-04 cost a
  full review cycle — mtime-ordering forensics, a D-entry, and a guard).
- The H-GRADE side-by-side runs sparkjs's SceneGrade from ITS OWN repo
  (its dev server, its examples) — never by copying anything here.

## Process rules that live in no file

- The OWNER commits — per instance, after being shown the staged file list
  and count; never commit unprompted. Explain git commands in one plain
  sentence first (the owner does not use git).
- One ticket at a time; unlocked ≠ authorized — each start is an explicit go.
- STOP at unsettled decisions (repo rule 11) — present options with a
  recommendation; never pick a reading; the ticket's Comments record every
  ruling taken.
- Review order once the gate is green: adversarial (agent-collab recipes —
  gpt5.6-sol high consult, grok-4.6, Opus subagent) on the diff since the
  last commit, THEN the built-in /code-review; report separately, never
  merged. Every external finding is a CLAIM until re-verified with real
  commands in-session.
- No time or duration estimates, ever (charter invariant). Scope in files
  and edit points.
- Ticket close: tick ACs (annotate any wording the reality outgrew), set
  Status: done, declare every divergence in Comments (spec rule 5).

## Wider context (not about ticket 10 — one line each)

- D21 re-sync input: ticket 04 Comments (SHA list) vs sparkjs `59b65cf`;
  golden rebaseline `862b9eb` — doc 06 D21 has the full ruling.
- Ticket 08 inherited ACs: rail-fixture bootstrap repoint to ThreeSplatScene
  (+ sRGB flip declaration + antialias/pixelRatio resolution) and the
  PMREMGenerator-from-three/webgpu correction — all in its file.
- Ticket 11 KNOWN STOP: sparkjs's barrel exports `SparkScene`, ours is
  `ThreeSplatScene` — naming is an owner ruling waiting in ticket 11; also
  its colorSpace-first import AC and the `sideEffects` tree-shaking hazard.
- `.claude/launch.json` is gitignored and machine-local — the `toolkit-dev`
  entry (npm run dev, port 5173, autoPort) must be re-created if lost.
- `D:\tmp` is never a scratchpad (owner global rule); use the session
  scratchpad or ask.
- Memory notes for future sessions live in the Claude project memory:
  adversarial-findings-are-claims, review-order-after-green, D20 resolution.
