# 10 — D22 second half: CameraSystem dead fields + construction literals (micro)

**Status:** done
**Blocked by:** None — can start immediately (frontier-parallel micro-work).

**What to build:** the open, unassigned second half of doc 06 D22 finally gets a
named home: CameraSystem's 2 dead fields and ~10 renderer-era construction
literals are resolved, with a camera fixture proving orbit/recenter behavior
unchanged. (The typing half was done in ticket 03 of Phase 1 — the
WebGLRenderer|WebGPURenderer widen.)

Standing rules bind (spec.md). Scope discipline: doc 01:92's counted edits only —
the picking dependency stays a Phase 3 rebuild.

- [x] The 2 dead fields and the construction literals doc 01:92 counts are
      resolved; each edit listed in Comments against the count.
- [x] A camera fixture proves orbit/recenter behavior unchanged on both backends
      (before/after captures at pinned poses).
- [x] Gate green at fixpoint; doc 06 D22 updated to fully RULED/done with a
      pointer to this ticket.

## Comments

**Evidence gathered at ticket start (2026-09-17):**
- doc 01:92's "2 dead fields, ~10 construction literals" traces to sparkjs's
  `docs/research/threejs-port-findings.html:949` ("Ten CameraSystem
  construction literals"). At pin fd67153 there are exactly 10
  `new CameraSystem({…})` call sites (examples all/camera/colmap/composer/main/
  path/rail, text-lab ×2, `src/embed/SiteRuntime.ts:895`); every one passes
  `renderer`, 9 pass `sparkRenderer`.
- The 2 dead fields are `CameraSystemConfig.renderer` (REQUIRED; destructured
  in the constructor, never used — at the pin and here) and
  `CameraSystemConfig.sparkRenderer` (optional; never read — at the pin and
  here).
- In this repo 3 of the 10 literals exist (`examples/rail/main.ts:92`,
  `examples/text-lab/main.ts:251`, `:372`); all pass `renderer`, none
  `sparkRenderer` (stripped at copy time). SiteRuntime's literal lands with
  ticket 09. `CameraSystemConfig` is barrel-exported here and at the pin
  (H-API surface).

**Owner rulings (2026-09-17):**
- **Q1 — B: keep both fields, `@deprecated` and ignored; `renderer` made
  optional.** Grounds: H-API compile-unchanged; all 10 pin call sites pass
  `renderer` — the exact opposite of D24's zero-caller evidence. No doc 06
  divergence entry; the deprecation comments cite this ruling. REJECTED: A
  (remove both — every real caller breaks at compile time).
- **Q2 — leave `scene` as-is.** It is assigned but never read HERE (it fed the
  pin's splat raycast, stubbed in Phase 1); recorded in doc 06 as a Phase 3
  item tied to the `backend.raycast()` decision so it cannot be re-discovered
  as a surprise.
- **Q3 — B: a dedicated `examples/camera-lab/` page.** Baseline captured on the
  PRE-EDIT code, exact match required after the edit, camera numbers AND pixel
  readbacks, both backends. The fake-pointer claim (OrbitControls' pointer
  capture rejecting synthetic pointers) is verified EMPIRICALLY first: if fake
  pointers work on this build, dispatching them is the stronger drill (closer
  to real input); `setState`-driven orbits only if the rejection is confirmed.

**Build (2026-09-17).** Edits against doc 01:92's count:
- Dead field 1 — `CameraSystemConfig.renderer`: now `renderer?:`, JSDoc
  `@deprecated Ignored …` citing this ruling (`src/core/CameraSystem.ts:93-97`);
  the constructor's unused `renderer` destructure is removed (the only place it
  was read — nothing in `src/` or `examples/` reads `config.renderer`).
- Dead field 2 — `CameraSystemConfig.sparkRenderer`: JSDoc
  `@deprecated Ignored …` citing this ruling (`:99-102`); type unchanged.
- Construction literals (10 at the pin): the 3 present here
  (`examples/rail/main.ts:92`, `examples/text-lab/main.ts:251`, `:372`) are
  UNCHANGED and still compile (gate typecheck) — under Q1-B nothing forces an
  edit. The pin's SiteRuntime literal (`fd67153:src/embed/SiteRuntime.ts:895`)
  passes `sparkRenderer: sparkScene.spark`, a member ThreeSplatScene does not
  have — ticket 09 must change that property when it re-types SiteRuntime
  (the field itself stays accepted). The other 6 pin literals live in example
  pages this repo never copied.
- `scene` untouched (Q2). File stays CRLF as committed (980 CR / 980 lines).
- New `examples/camera-lab/` + vite input.

**Fake-pointer verification (ruling Q3), in-app browser pane, Chrome
152.0.7977.76:** a `CameraSystem` on an isolated canvas, synthetic
`PointerEvent`s (pointerId 1, mouse, buttons 1): `setPointerCapture` threw
nothing, no listener errors, a 60 px drag moved the camera (0,0,5) →
(−4.755283, 0, 1.545085) (still radius 5 — an orbit), capture released after
`pointerup`. The rejection claim is REFUTED on this build, so camera-lab drives
orbits with dispatched pointer events, not `setState`.

**Instrument defects caught while building camera-lab (fixed before any
baseline counted):** (1) a 5×3 sample grid saw only the centre column's
vertical box stack, which a vertical-axis orbit leaves in place — WebGL2
`pixels changed=false`; grid → 9×5. (2) Across page loads the WebGPU recenter
pivot changed (mid 1.5017… vs 1.4927…) while orbit numbers did not: a
synthetic `MouseEvent` truncates `clientX/clientY` to integers (probe: 10.5 →
10, 20.75 → 20) and the canvas sat at a fractional offset (top 60.667 px under
a heading at pane DPR 1.5). The viewer is now `position: fixed` at (0,0) and
`viewport-pinned` asserts integer offsets.

**Evidence (dev server, in-app pane):**
- Pre-edit baselines, each reproduced across TWO page loads: WebGPU
  `sha256=444a093df755f516b7ae7c69e27d330f6c3f52a540ddfa705f10c244188ae659`,
  WebGL2 `sha256=bc514b236e53f2380e9981f8a6e96be3b1b9379153bea43085faeb46f896e764`
  — `camera-lab: 6 passed, 0 failed` each (`viewport-pinned` 512×256 at (0,0),
  pixel ratio 1; `script-deterministic` two fresh CameraSystems identical;
  `synthetic-pointer-orbit-moves-camera` yaw 30 → −71.249 → 69.374, target
  unchanged, pixels changed; `double-click-recenter-moves-pivot` (0,0,0) →
  (1.8623, 1.0000, −3.3088), later orbit keeps it; `pixels-read` 270 samples;
  `no-page-errors`).
- AFTER the edit: WebGPU `444a093d…e659`, WebGL2 `bc514b23…e764` — IDENTICAL
  to the baselines (6 snapshots of getState + position + quaternion + target +
  45 pixel samples, both backends). `camera-lab: 6 passed, 0 failed` each.
- Teeth: `recenterEasing = 3 → 2` in CameraSystem changed the WebGPU digest to
  `bb1a6938…c794` (mid-recenter pivot moved, endpoint identical); reverted from a
  byte backup (sha256 `a03bb0bb…` = the tested file).
- H-API compile check (scratch tsconfig extending the repo's, file outside the
  repo): a literal omitting `renderer` and the pin-SiteRuntime-shaped literal
  (`renderer` + `sparkRenderer`) both compile (exit 0); a planted literal
  missing `scene` fails TS2345 (exit 2) — the check is not vacuous. HEAD had
  `renderer` required (`CameraSystem.ts:94`).
- rail / text-lab not re-run: their construction literals are unchanged and
  compile, and camera-lab proves CameraSystem's behaviour unchanged.
- Gate: `npm run check:full` EXIT=0 on the final tree
  (`.collab-logs/gate-t10-run2.log`): embed 216,527 B; 162 modules / 495 deps,
  no violations; crate 6 + golden 7.

**Adversarial review round (astra-review per the v2 registry lane order —
gpt-6-astra, effort high, sandbox read-only, codex-cli 0.153.3,
banner-confirmed; access class ordinary_authorized, residual broad-read
capability recorded; prompt `.collab-logs/t10-review-prompt.md`, material
`t10-review-material.diff`, output `astra-review-t10.md`, trace
`astra-review-t10-err.log`, 13 tool calls; 268 repo files hash-identical
before/after; Codex weekly window 42% used at launch, no paid credits, one
pre-existing codex.exe left alone): 0 findings** in all four categories. It
re-verified the 10 pin literals (all pass `renderer`, 9 `sparkRenderer`) and
ran a read-only typecheck; it states it did not re-run browser captures.

**Built-in /code-review round (high, after the adversarial round): 1 finding,
CONFIRMED and fixed** — doc 06 D22's heading still said "PARTIALLY RULED …
remains OPEN and unassigned … Needs an owner assignment" beside the appended
ruling; rewritten to RULED AND DONE with the history kept and a DONE pointer
to this ticket (this ticket's AC 3).

**Status change: done — all three ACs met (2026-09-17).**
