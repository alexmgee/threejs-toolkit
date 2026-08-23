# 01 — DisplayChannel re-sync to fd67153

**Status:** ready-for-agent
**Blocked by:** None — can start immediately (worked FIRST by owner mandate).

**What to build:** an authored `lifetime` on a show-blocks effect actually ends the
display at runtime instead of validating and being silently ignored — closing the
vintage split doc 06 D21's third note flags as "Phase 2 must close first" — and the
four trimmed barrel names (`endOnTravel`, `dismissAll`, `endStaleWhile`,
`endOrphanedClaims`) return to the public barrel.

Standing rules bind (spec.md): copy via `git show fd67153:<path>`, never disk;
hash the destination tree; sparkjs read-only; runtime proof on both backends;
rule-11 stops.

- [ ] `src/rules/DisplayChannel.ts` is byte-identical to
      `git show fd67153:src/rules/DisplayChannel.ts`; SHA recorded in Comments,
      hashed on the destination tree.
- [ ] A runtime fixture drives a rules scenario with an authored `lifetime` and
      shows the display ending at the authored boundary; the pre-re-sync run of the
      same fixture shows it NOT ending — both captured in Comments.
- [ ] The four returned barrel names resolve and are exercised at least once from a
      fixture (not merely exported).
- [ ] Gate green at fixpoint (typecheck + boundaries + both vite builds), exit code
      read from a file, not a pipe.
- [ ] Diag selfTest re-run in-browser stays 20/20.
