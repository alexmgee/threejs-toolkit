# Handoff 005 — Phase 2 tickets 01+02 CLOSED; next: TICKET 03

2026-08-28. Written for a COLD session with no memory of this one. Goal of the
next session: **TICKET 03 — SplatBackend seam + ThreeGsBackend + monolithic
SPZ/PLY path** (.scratch/phase-2-backend/issues/03-seam-monolithic-path.md),
runnable without re-deriving anything. Ticket 03 starts on the owner's
explicit go, not on this document.

## STATE

| What | Commit(s) |
|---|---|
| Phase 2 ticketing: spec + 13 tickets | `5f30d27` |
| Ticket 01: DisplayChannel re-synced to fd67153, lifetime trap closed, rules-lab 9/9 | `d9022b6` |
| Ticket 02: rad-three crate promoted, packed-SH in Rust, decode-lab, D14 ruled+wired variant A, lib build | `1fb65d4` |
| Ticket 02 defect-fix pass (external gpt5.6 audit): guards on all 9 decoders (checked_mul), container-extent panic fixed, golden-test skip visible + gate-run, mechanism-guarding boundary rule, clean-clone npm hooks; 2 audit claims REFUTED by measurement | `a1c076c` |
| Owner rulings: check:full standard gate here; meta.count oversized → named refusal | `15f4211` |
| agenttrail adopted: PLAN.md + AGENTS.md tracked, binding derived-view line, false credits fixed | `1cd8b2d` |

Frontier: **03 next**, then 04–13 per the spec's blocked-by edges
(.scratch/phase-2-backend/spec.md ticket map). Ticket 10 (D22 micro) is also
frontier but 03 is the owner-named next. One ticket at a time; unlocked ≠
authorized.

**agenttrail:** maintain PLAN.md per the convention block in CLAUDE.md/AGENTS.md
(`[~]` before starting + save immediately, `[x]` on completion, `by: claude`
lines) — but PLAN.md is a DERIVED VIEW, never an authority:
docs/plan/04-build-order.md is the sole sequencing authority and .scratch/
tickets are the work ledger; on conflict they win and PLAN.md is corrected.

## TICKET 03 ENTRY BRIEF — everything waiting in or binding on it

- **D18**: `src/backend/index.ts` is a PLACEHOLDER that this ticket
  DELETES-AND-REPLACES with the real seam — never left beside real code. But
  its ticket-02 additions are REAL and stay: the `createDecodeWorker` export
  (embed's door) and the guard comment. The placeholder TYPES die; the decode
  export lives on in whatever replaces the barrel.
- **D23 (owner-ruled at breakdown)**: the vendor→src / fork-internals guard
  lands in THIS ticket's ACs — add the dependency-cruiser rule AND run the
  prove-it-bites drills (deliberate violation → gate fails; restore → green;
  no false positive on the legitimate tree). (b) src→examples and (d) spikes
  uncruised stay accepted-unguarded with reasons in Comments; (a)
  examples→src/backend stays open-by-design.
- **PLY sigmoid (both-language citations, in the ticket's Comments)**: raw
  3DGS `.ply` opacity is LOGITS. Read-side sigmoid =
  `reference/spark/src/ply.ts:553-555` (`1/(1+exp(-opacity))`, no clamp) and
  its Rust twin `spark-lib/src/ply.rs:115-116` (property named `opacity`,
  :858). Do NOT copy ply.ts:673 or ply.rs:1244 — both are the write-side
  INVERSE (logit) despite ply.ts:673's comment saying "sigmoid"; applying it
  at load turns opacity 2 into NaN. `.rad` alpha is linear (doc 03 A1,
  corrected twice, now structure-grounded).
- **Decoder errors are NAMED REFUSALS** (short data, overflowing extents,
  oversized count — all Err with the property/reason in the message, never
  panics; six crate tests pin this). The seam must SURFACE these as toolkit
  errors to its caller; a decode failure must never present as a crash or a
  silent blank.
- **Inline-worker boundary rule guards the MECHANISM**:
  `rad-worker-value-import-only-from-decode` in .dependency-cruiser.cjs —
  only `src/backend/decode.ts` may value-import the worker (type-only imports
  are free; `new Worker(new URL(...))` is no dependency edge). The seam's
  public surface must NOT re-open this: no blanket `export * from "./backend"`
  into src/index.ts (the companion `lib-barrel-must-not-reach-inline-worker`
  rule also enforces that), and the ThreeGsBackend must not value-import the
  worker directly.
- **Exit is BEHAVIORAL**: a small SPZ/PLY scene loads end-to-end through the
  real seam and renders on BOTH backends — pixel-proven via the established
  readback pattern (`examples/scene/` is the model: default page + `?webgl=1`,
  screenshots/readbacks at a pinned pose, evidence verbatim in Comments).
  Rendering IS involved here, so the both-backends rule fully applies —
  unlike decode-lab, whose "both backends" claim was struck as vacuous.
  Plus: `counts()`/`bounds()` vs an independent CPU read (per-point, not
  8-corner applyMatrix4); monolithic `whenReady()` after first paint;
  `progress()` monotonic.

## THE GATE

- **`npm run check:full`** (= portable `check` + `test:crate:golden`) is the
  STANDARD session gate on THIS machine (owner ruling 2026-08-28, recorded in
  spec.md standing rules) — the hero asset is always present here.
- Portable **`check`** stays the clean-clone contract and never grows an
  asset dependency. npm pre-hooks (`pretypecheck`, `prebuild:site`,
  `prebuild:embed`) build the wasm; they DO fire through nested `npm run`
  (verified empirically).
- TRUE exit code discipline: redirect output to a file, `echo $?` — never
  judge by a pipe's exit. Iterate to fixpoint; tsc reports in waves.

## TRAPS learned in tickets 01/02 — each cost real time or a review round

1. **Vacuous-assertion check**: before trusting any green check, ask "what
   would make this go red?" Caught four times: a takeover-eviction made a
   travel assertion pass for a no-op ending; a regex format check could not
   fail; the golden test PASSED with its asset absent (libtest swallows
   eprintln — summaries read "2 passed" either way); a name-filtered test
   script went `running 0 tests` EXIT=0 after a rename. Fix shape: pin
   expected values, make skips visible, drill the failure path.
2. **The sibling-fix question**: after fixing a defect, ask "where else does
   this exact shape appear?" The overflow found in 3 new guards lived in all
   5 pre-existing ones; the f32-tie bug fixed in sh1_byte was then WRONGLY
   alleged in color_from — the question cuts both ways (see trap 8).
3. **grep-for-the-word cannot answer questions about math**: "zero grep hits
   for sigmoid" was true of the STRING and false of the CODE — Spark's Rust
   writes `1.0 / (1.0 + (-x).exp())`. Search for the FORM, or better, argue
   from structure (the RadAlphaEncoding enum settled it).
4. **Hidden-pane visibilityState** (handoff 003 trap, still current):
   document.visibilityState "hidden" pauses rAF — fixture loops never tick.
   WebGPU async capture settles hidden; WebGL2 needs captureSync;
   resize_window for real layout dimensions.
5. **cwd persistence**: a `cd` in one Bash call persists — one cargo test run
   silently executed with cwd inside rad-three/ and a later "cd rad-three"
   failed. Absolute paths or re-cd every compound command.
6. **wasm-pack pre-hooks**: `npm run build` → `prebuild:site` → build:wasm
   DOES fire through nested `npm run` (proved by output, after I predicted
   the opposite). But `npm --ignore-scripts` bypasses hooks, and raw
   `tsc`/`vite` invocations still need `npm run build:wasm` first.
7. **Uint8ClampedArray is ties-to-even; Math.round/Rust .round() are not** —
   and WHICH rule applies depends on whether a JS path actually produces
   those bytes. sh1: JS packs the same floats → bit-identity binds (and in
   f64, because JS widens). color: no JS producer exists → the Spark
   reference's `.round()` is the authority. Same arithmetic, opposite
   conclusions.
8. **A divergence claim needs both sides checked**: the external audit
   transplanted sh1's contract onto color without checking whether a JS
   color path existed (it does not) or what the reference does (it uses
   `.round()`). Two refuted claims out of five — re-verify EVERY external
   finding with commands whose output would differ either way.

## PROCESS RULES that live in no file

- The OWNER commits — except when a run explicitly grants scoped delegation
  (staged-list-shown-first, stop on any stray path). This session had two
  scoped grants (tickets 01, 02) plus explicit instructions for the later
  commits; the next session starts with NONE.
- One ticket at a time; each start is an explicit owner go.
- Rule-11 stops: at any unsettled decision, STOP with options + evidence +
  a recommendation — never a pick. This session's D14 stop (measure both,
  present numbers) and the check:full/meta.count flags are the template.
- Review order after green: adversarial FIRST (Opus subagent + gpt5.6-sol
  high; grok rejoins when funded — it was 402 "balance exhausted" all
  session), THEN built-in /code-review, reported separately. EVERY external
  finding re-verified with real commands — confirm or refute, never absorb
  (this session: 2 audit claims refuted with measurement, 1 adversarial
  suspicion of mine refuted by empirical npm output).
- No time estimates, ever. Git explained in plain English to the owner.
- sparkjs-toolkit is PERMANENTLY read-only. Copy vintage `fd67153` via
  `git show fd67153:<path> > dest`, never disk; hash the DESTINATION.

## WIDER CONTEXT (one line each)

- Vintage map: doc 06 D21 THIRD NOTE (final inventory) + FOURTH NOTE
  (DisplayChannel split CLOSED; the deliberately-old-vintage set is EMPTY).
- D14 RULED: embed inlines the wasm (variant A), measurement table + SCOPE
  note (today's embed artifact is the ticket-01 scaffold, not <splat-site>)
  in doc 06.
- D16: number comparisons vs Spark retired; visual/behavioral comparison
  continues (H-VISUAL/H-GRADE/etc. stand).
- D20: fork patches authored in .ts beside the vendored JS — takes effect at
  ticket 04's first real fork delta.
- D24: barrel exports ThreeSplatScene under its OWN name, no SparkScene
  alias; the rename lands in ticket 09's consumer re-typing.
- Watch item 13: three still 0.185.1 (checked 2026-08-23); r186 carries the
  GaussianSplat rename (PR #34306) — re-check at the phase boundary.
- `.claude/launch.json` is machine-local and UNRECOVERABLE if lost
  (toolkit-dev, port 5173, autoPort); sparkjs dev may hold 5173 — never kill.
- D:\tmp is NEVER a scratchpad — session scratchpad dir or ask.
- Two open task chips from Phase 1: text-lab HMR teardown (ticket 05 gap,
  recipe recorded); periphery dist-asset emission (?url imports, media page
  is the pattern).
- SOGS caveat recorded in doc 03 A1: v1 alpha is sigmoid-after-dequant, v2 is
  linear — branch on version if a SOGS loader ever lands.
- Memory notes (all still accurate): adversarial-findings-are-claims,
  review-order-after-green, challenge-arbitrary-constants,
  no-spark-comparison-metrics.
