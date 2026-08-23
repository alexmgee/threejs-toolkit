# Handoff 004 — Phase 1 CLOSED; next: PHASE 2 ENTRY

2026-08-23. Written for a COLD session with no memory of this one. Goal of
the next session: **PHASE 2 ENTRY — backend + production pager + load
contract (doc 04 Phase 2, ≥114 adapt points), starting with /to-tickets on
Phase 2 fed by doc 01 and the inheritance list below.** Phase 2 starts on
the owner's explicit go, not on this document.

## State — Phase 1 complete, all 11 tickets

| Ticket | What landed | Commit |
|---|---|---|
| 01 scaffold | buildable package; gate = typecheck + boundaries + both vite builds | `b26060c` |
| 02 fork | 3 vendored addon files at delta zero + FORK.md | `e4aca4e` |
| 04 foundation | 32 copies, CameraSystem adapt, rail fixture, D20–D23 | `f9f7b59` |
| 03 scene | ThreeSplatScene both backends (pixel-proven), colorSpace.ts | `04378f6` |
| 10 scene-grade GATE | SceneGrade on node RenderPipeline+TSL; H-GRADE approved | `a112253` |
| 05 text+markers | 17 copies at fd67153 + D19 SplatTextMesh stub + text-lab fixture | `d744b02` |
| 08 periphery | 5 copies; EnvironmentLoader on three/webgpu PMREM; rail repoint | `782482e` |
| 07 diag | 22 paths; SparkPagerAdapter per R4; selfTest 20/20 in-browser | `b9c9251` |
| 09 MediaLayer | capabilities fix; colour baseline absolute, both backends | `2a7d55e` |
| 06 author-ui | 25 paths + 3 ruled closure files; panel + Rules pane runtime-proven | `8b621db` |
| 11 barrel | trimmed barrel, 51 sources; D24 naming ruling | `23d0b0b` |

Also: D21 second amendment + ticket 10 date fix `69648ee`; the first
amendment `835eb1d`. Doc 04 carries "Met 2026-08-23" for Phase 1 and the
GATE resolution line. Phase 1 exit criteria: fixtures run (rail, scene,
grade, text-lab, periphery, diag, media, author — all in vite's input map,
all runtime-proven in their tickets' Comments); H-GRADE approved (ticket
10); colour baseline re-measured (ticket 09 results doc).

## THE VINTAGE MAP (Phase 2's re-sync input — authoritative copy in doc 06
D21 THIRD NOTE's final inventory; this is the summary)

**Re-sync runs against sparkjs commit `fd67153`.** Never disk — the owner
edits sparkjs continuously; every copy is `git show <pin>:<path>`.

- Landed AT `fd67153` already (re-sync diff = empty): tickets 05/06/07/08/
  09's copies (SHAs in each ticket's Comments) PLUS the three ruled
  closure files `src/rules/RuleAuthoring.ts`, `src/rules/RuleModel.ts`,
  `src/site/SiteConfig.ts` (SHAs in ticket 06's Comments and the D21 note).
- Landed at ticket 04's OLDER vintage (re-sync diff runs against
  fd67153): ticket 04's remaining copies per its SHA inventory — of the
  rules/site clusters only `src/rules/DisplayChannel.ts` actually differs
  from the pin (deliberate; see next section); seven rules/ + three site/
  files coincide with the pin byte-for-byte.
- Ticket 03/10's adapted files (ThreeSplatScene, SceneGrade, capture.ts)
  and ticket 08/09's declared adaptations (EnvironmentLoader, MediaLayer,
  FrameDiffValidator type widen) are ADAPTED, not copies — re-sync treats
  them by declared-divergence diff, not byte identity.

## DisplayChannel re-sync FIRST (Phase 2's opening move)

The pin's RuleModel validates an authored `lifetime` on show-blocks; the
pin's DisplayChannel IMPLEMENTS it. We landed RuleModel at the pin but
DisplayChannel at the old vintage — so an authored `lifetime` VALIDATES
and is then silently ignored at runtime. Harmless today (DisplayChannel
has ZERO importers — verified), a semantic trap the moment a runtime
consumer lands. Re-syncing DisplayChannel to fd67153 closes it and
returns the barrel's four trimmed names (endOnTravel, dismissAll,
endStaleWhile, endOrphanedClaims — declared at the line in src/index.ts).

## Latent semantic changes riding the ticket-06 swaps (doc 06 D21 note,
"HONEST BASIS CORRECTION")

Safe today because NO landed runtime consumer exists (normalizeSiteConfig:
zero callers; landed SiteConfig importers all type-only). Phase 2's copied
consumers (SiteRuntime et al.) will activate them:
- pin `normalizeSiteConfig` stops minting annotation-copy seeded blocks,
  drops the old recognizers, THROWS on an authored `annotation-<id>-copy`
  block id;
- pin RuleModel throws on duplicate show-blocks effects (two effects
  naming exactly the same blocks).

## Open items

- **D22's second half** (CameraSystem dead fields / ~10 construction
  literals) — still OPEN, unassigned (doc 06).
- **Two pending task chips**: text-lab HMR teardown (ticket 05 gap, has
  the recipe); periphery dist-asset emission (?url imports, media page is
  the pattern).
- **Barrel packaging caveat** (ticket 11 Comments): `npm run build` is a
  pages build — the barrel is typechecked and boundary-checked but never
  BUNDLED by the gate. The colorSpace tree-shake survival IS
  execution-proven (scratchpad lib-build experiment, recorded in ticket
  11), but real lib packaging is Phase 2 work. If `"sideEffects": false`
  is ever added to package.json, exempt `./src/core/colorSpace.ts`.
- MediaLayer anisotropy: `renderer.getMaxAnisotropy()` exists on the
  facade renderer — upgrade candidate at Phase 2's SiteRuntime re-typing
  (ticket 09 Comments); today facade attaches get anisotropy 1 on BOTH
  backends.
- diag `phase7-runtime-consent` assertion un-defers when diagWiring lands.
- D13/D14/D17/D18 remain open per doc 06 (D18: backend placeholder is
  DELETED-AND-REPLACED by the Phase 2 seam, never left beside real code).

## TRAPS — each cost real time this run

1. **Copy-from-commit mechanics**: `git show <pin>:<path>` into the
   destination, then diff BACK against the pin, then hash the DESTINATION.
   Hashing with cwd in sparkjs silently hashes the wrong tree (happened
   twice, caught both times). The owner's live sparkjs edits are real: 4
   of ticket 05's 17 files differed on disk from the pin mid-copy.
2. **Gate = TRUE exit code**: redirect to a file and echo `$?` — piping to
   tail/grep reports the pipe's exit. Also: a `cd` into sparkjs persists
   into later commands in the same shell — one gate run silently executed
   in the WRONG REPO ("Missing script: check" was the tell).
3. **Hidden-pane visibility (handoff 003 trap 7 still binds)**:
   document.visibilityState "hidden" pauses rAF — fixture loops never
   tick, screenshots time out. Verified paths: WebGPU async capture
   settles hidden; WebGL2 uses captureSync (same-task readPixels); layout
   needs resize_window to get real dimensions; drive frames by hand
   through the dev hooks.
4. **EOL pinning**: git warns "LF will be replaced by CRLF" on every
   .scratch/docs write — harmless with `.gitattributes -text` on copies,
   but always write copies via `git show > file` (binary-safe), never
   through an editor.
5. **Vintage edges surface as compile waves**: tsc reports errors in
   batches — a green-looking first wave can hide a second (SiteConfig
   surfaced only after RuleModel landed). Iterate the gate to fixpoint
   before judging closure.
6. **Tiny generated assets degenerate PMREM** (`width/4` → 1px cube
   faces render BLACK backgrounds while IBL still lights) — fixture
   assets need sane dimensions (64×32 HDR / 16×16 faces minimum).
7. **sRGB trap 4 fingerprint still current**: a linearized background
   reads [1,1,8] for 0x111133 — the media baseline work re-confirmed
   [17,17,51] identity; any drift to [1,1,8] means colorSpace.ts stopped
   loading first.

## Process rules that live in no file

- The OWNER commits — except when a run explicitly delegates (this run
  did, per-ticket, staged-list-shown-first; ticket 11 was owner-go only).
  Never commit .collab-logs, dist, node_modules; stop on any stray path.
- One ticket at a time; unlocked ≠ authorized; each start is an explicit
  go. STOP at unsettled decisions (rule 11) — this run stopped four times
  (06-blocker, RuleAuthoring, RuleModel, category rule) and each
  two-minute checkpoint was ruled quickly; the CATEGORY-RULE pattern
  (conditions + proof obligation + final inventory) is the template for
  Phase 2's re-sync decisions.
- Review order after green: adversarial (gpt5.6-sol high consult +
  grok-4.6 + Opus subagent, .collab-logs/ recipes) then built-in
  /code-review, reported separately. EVERY external finding re-verified
  with real commands — this run confirmed most, but REFUTED two with
  execution (grok's capture-ray claim; codex's tree-shaking claim):
  confirm-or-refute, never absorb.
- Behavior verification is Claude-or-human only; artifacts, not exit
  codes. No time estimates, ever. sparkjs is PERMANENTLY read-only.
- Runtime proof standard: both backends wherever rendering is involved
  (?webgl=1 fixture pattern); evidence quoted verbatim in the ticket's
  Comments; "it builds" proves nothing.

## Wider context (one line each)

- Phase 2 scope: doc 04 Phase 2 (§96–113) — backend seam, pager ≥114
  points, load contract, embed set, StatsHUD/SplatBounds/SplatLoader,
  SparkPagerAdapter deletion (doc 03 §G), WASM worker vite settings from
  spikes/native-rad.
- D24 (barrel naming) grounds and the alias evidence table: doc 06 D24 +
  ticket 11's review round Comments.
- Colour baseline: docs/plan/results/ticket09-color-baseline/README.md —
  absolute, ADR 0003; pane-size discipline for sync readbacks noted there.
- H-GRADE evidence: docs/plan/results/ticket10-hgrade/ (dates corrected
  2026-08-22 — ruling 2026-08-22 on evidence stamped 2026-08-21).
- Fixture asset generator: session scratchpad gen-assets.mjs, reproducible
  from ticket 08's Comments description.
- Fork governance: src/vendor/three-gs/FORK.md; D20 patches-in-.ts takes
  effect at the first Phase 2 patch.
- `.claude/launch.json` is machine-local (toolkit-dev, port 5173,
  autoPort); sparkjs dev server may hold 5173 — never kill it.
- Memory notes: adversarial-findings-are-claims, review-order-after-green,
  challenge-arbitrary-constants, no-spark-comparison-metrics (all still
  accurate).
