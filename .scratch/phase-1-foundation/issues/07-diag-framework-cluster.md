# 07 — Diagnostics framework cluster

**What to build:** the diagnostics framework — sinks, records, policies,
fixtures, FrameDiffValidator — with its own self-test running green. The whole
`diag/` directory is one compile-closed cluster (verified: nothing in diag/
imports outside diag/). 21 files / ~7,895 lines. Read `../spec.md` first.

**Files:** all of `diag/` — INCLUDING `diag/SparkPagerAdapter.ts`, carried
unmodified per owner ruling R4 (two Phase-1 files import it; doc 03 section G
schedules its deletion for Phase 2 — deleting early costs edits the plan
already assigned to Phase 2).

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Every COPY file byte-identical; `diag/dev/FrameDiffValidator.ts` (the one
      three-only file) carries only its doc 01 adaptation — it becomes a
      load-bearing tool of this project (doc 05)
- [ ] `diag/dev/selfTest.ts` executes in a browser page and passes
- [ ] SparkPagerAdapter carries a Comments note: "carried per R4; Phase 2
      deletes (doc 03 section G)" — no code changes to it
- [ ] `npm run check` green
