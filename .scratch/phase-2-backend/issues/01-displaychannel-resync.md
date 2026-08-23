# 01 — DisplayChannel re-sync to fd67153

**Status:** done
**Blocked by:** None — can start immediately (worked FIRST by owner mandate).

**What to build:** an authored `lifetime` on a show-blocks effect actually ends the
display at runtime instead of validating and being silently ignored — closing the
vintage split doc 06 D21's third note flags as "Phase 2 must close first" — and the
four trimmed barrel names (`endOnTravel`, `dismissAll`, `endStaleWhile`,
`endOrphanedClaims`) return to the public barrel.

Standing rules bind (spec.md): copy via `git show fd67153:<path>`, never disk;
hash the destination tree; sparkjs read-only; runtime proof on both backends;
rule-11 stops.

- [x] `src/rules/DisplayChannel.ts` is byte-identical to
      `git show fd67153:src/rules/DisplayChannel.ts`; SHA recorded in Comments,
      hashed on the destination tree.
- [x] A runtime fixture drives a rules scenario with an authored `lifetime` and
      shows the display ending at the authored boundary; the pre-re-sync run of the
      same fixture shows it NOT ending — both captured in Comments.
- [x] The four returned barrel names resolve and are exercised at least once from a
      fixture (not merely exported).
- [x] Gate green at fixpoint (typecheck + boundaries + both vite builds), exit code
      read from a file, not a pipe.
- [x] Diag selfTest re-run in-browser stays 20/20.

## Comments

**Re-sync executed 2026-08-23.**

- Copy: `git -C ../sparkjs-toolkit show fd67153:src/rules/DisplayChannel.ts > src/rules/DisplayChannel.ts`.
  Destination hash `89c4a9c418a6ddb3f0de412ec7ef21ba5b65e3245665b4f250879d3c96f91716`
  (sha256, hashed in THIS repo), equal to the pin's stream hash — byte-identical.
  Pre-re-sync file matched ticket 04's recorded SHA
  `0ff82b5bf3d4608b2720a15e0766fc8b11799869b5819724d8b3cda89da33272` exactly.
  Delta: 135 → 257 lines; `showBlocks` opts change (`isReactivation` →
  stored `lifetime` + `context`); four new endings. Zero importers existed, so
  no call-site breakage (verified by the boundary cruise + typecheck).
- Barrel: `endOnTravel`, `dismissAll`, `endStaleWhile`, `endOrphanedClaims`
  added to the DisplayChannel export line in src/index.ts; the deferred-names
  note replaced with a resolved note. Prior exports are a strict subset of the
  pin file's exports (verified by export grep) — nothing removed.
- Runtime proof (fixture `examples/rules-lab/`, registered in vite input map):
  - BEFORE (old vintage temporarily restored from HEAD): console verbatim —
    `PASS lifetime-validates`, `FAIL lifetime-ends-on-travel — endOnTravel
    MISSING — authored lifetime is silently ignored (the trap)`, plus FAILs for
    travel-ends-only-travel / dismiss-all / stale-while / orphaned-claims:
    **2 passed, 5 failed** — the trap demonstrated by execution.
  - AFTER (pin file): `rules-lab RESULT 8 passed, 0 failed` — includes
    `PASS lifetime-ends-on-travel — shown pre-travel: true; shown post-travel: 0`
    and `PASS barrel-names-restored — endOnTravel/dismissAll/endStaleWhile/
    endOrphanedClaims resolve via the barrel and endOnTravel ran`.
  - DisplayChannel is a PURE store (no rendering), so the both-backends rule
    does not apply; the proof is an in-browser execution, dev server port 57617.
- Diag selfTest re-run in-browser: `SELF-TEST: 20/20 PASS`
  (phase7-runtime-consent still DEFERRED — un-defers at ticket 12 per spec).
- Gate: `npm run check` twice to fixpoint, output redirected to
  .collab-logs/gate-t01-run{1,2}.log, `echo $?` → EXIT=0 both runs, 0 errors.

**Adversarial review round (2026-08-23) — Opus reviewer findings, each
re-verified against the code before acting:**

1. CONFIRMED: fixture assertion 3 was vacuous — the helper's hardcoded
   `takeover: true` made a2's show evict a1's claim before endOnTravel ran
   (pin survivors filter, DisplayChannel.ts:152-154). FIXED: a2 shows with
   `takeover: false`; the assertion now genuinely proves travel discriminates
   by stored lifetime.
2. CONFIRMED: the recorded before-capture (2/5, total 7) predated the
   barrel assertion — not the same fixture source as the after-run. FIXED:
   before-capture re-run with the FINAL fixture against HEAD DisplayChannel
   AND HEAD barrel. Superseding evidence, console verbatim:
   `rules-lab RESULT 2 passed, 7 failed` (of 9) — including
   `FAIL lifetime-ends-on-travel — endOnTravel MISSING — authored lifetime is
   silently ignored (the trap)` and `FAIL reactivation-respects-lifetime —
   forever claim after re-activation: REMOVED (re-activation-keyed — the old
   vintage)`. The earlier 2/5 capture is superseded, not evidence.
3. CONFIRMED: the dual-vintage opts cast erased compile checking of the call
   site. FIXED: assertion 2's state is now built by a direct fully-TYPED
   `DC.showBlocks` call (no cast) — the gate typechecks the pin's opts
   contract at that site.
4. CONFIRMED: assertion 4 (default toggle) passes under both vintages —
   inert as vintage evidence. FIXED: new assertion
   `reactivation-respects-lifetime` — re-activating a `forever` claim stays
   shown under the pin (lifetime-keyed) and was removed under the old vintage
   (re-activation-keyed); FAILs before, PASSes after.
5. NOTE (no code change): the copied file's identity contract (same-object on
   no-op) is untested here and no AC requires it; its documented harness
   (lm-check §17b) lives in sparkjs, not this tree. Recorded for Phase 2's
   later rules-runtime work.

**Final after-capture (pin DisplayChannel + new barrel), console verbatim:**
`rules-lab RESULT 9 passed, 0 failed` — including
`PASS reactivation-respects-lifetime — forever claim after re-activation:
still shown (lifetime-keyed)` and `PASS barrel-names-restored`.
Gate re-run to fixpoint after the fixes: EXIT=0 twice
(.collab-logs/gate-t01-run{3,4}.log).

**Adversarial review round 2 (2026-08-23) — gpt5.6-sol (high) on the diff;
grok unavailable (402, spec.md review section). Findings re-verified:**

- Findings on the takeover-vacuous assertion 3 and the before-capture
  arithmetic duplicated the Opus round (its snapshot predated those fixes) —
  already fixed above.
- CONFIRMED (new): the orphan test had no valid companion claim, so an
  endOrphanedClaims implemented as dismissAll would pass. FIXED: two-owner
  state (a1 orphaned, a2 valid, takeover:false); assertion requires a1's
  block gone AND a2's block surviving.
- CONFIRMED (new): only endOnTravel was exercised through the barrel; the
  other three names had typeof checks. FIXED: the barrel assertion now
  requires IDENTITY (barrel.X === module X) for all four names, tying each
  barrel export to the exact function the behavioral assertions exercised —
  a misaliased re-export cannot pass.
- Its hybrid-toggle scenario (finding 1) is covered by
  `reactivation-respects-lifetime`: an implementation gating on
  isReactivation removes the forever claim and FAILS it.

**FINAL evidence (both captures with this exact fixture source):**
- BEFORE (HEAD DisplayChannel + HEAD barrel): `rules-lab RESULT 2 passed,
  7 failed` of 9.
- AFTER (pin DisplayChannel `89c4a9c4…` + new barrel): `rules-lab RESULT
  9 passed, 0 failed`, including `PASS orphaned-claims-end — post-delete
  ids: b2 — a1 orphaned, a2 valid`.
- Gate to fixpoint post-fixes: EXIT=0 twice (.collab-logs/gate-t01-run{5,6}.log).

**Built-in /code-review (medium, 2026-08-23) — 8 finder angles + verify,
reported separately from the adversarial rounds:**

- FIXED: doc 06 D21 ledger updated — D21 FOURTH NOTE records the split
  closed, the "deliberately old vintage" set now empty (altitude finding).
- FIXED: unused DEFAULT_LIFETIME import and the dead `extra.context`
  override removed from the fixture (simplification findings).
- SKIPPED with reason: barrel import's ~930 KB modulepreload on the built
  rules-lab page (measured by the reviewer's vite build) — the AC mandates
  barrel-name exercise from a fixture and any barrel import carries the same
  re-export graph; recorded as a candidate for the ticket 02 packaging work.
- SKIPPED with reason: fixture CSS block duplicates diag's — extracting a
  shared stylesheet touches the diag fixture, outside this ticket; cleanup
  candidate.
- SKIPPED with reason: 5 of 9 assertions still use the dual-vintage cast —
  deliberate mechanism for the before/after evidence; assertion 2's direct
  typed call pins the current pin contract at compile time.
- Clean angles: line-by-line (beyond the above), removed-behavior,
  cross-file (zero DisplayChannel callers verified), conventions (hash
  independently re-verified byte-identical).

Post-fix verification: fixture 9/9 (`rules-lab RESULT 9 passed, 0 failed`),
gate EXIT=0 (.collab-logs/gate-t01-run7.log).

**Status change: done — all five ACs met with evidence above.**
