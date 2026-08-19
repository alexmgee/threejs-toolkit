# 01 — Scaffold completion: buildable toolkit package

**What to build:** a developer runs `npm run check` and both vite builds at the
repo root and everything is green — the package the rest of Phase 1 lands into.
Read `../spec.md` first; its standing rules bind.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] `three` pinned exactly `0.185.1` (no `^`/`~`) and `@types/three` `0.185.x`
      added to the root package.json (r186 is NOT published — doc 06 watch item
      13, checked 2026-08-19; do not float the range)
- [x] `vite.config.ts` and `vite.embed.config.ts` exist and each builds a
      trivial `src/` entry to completion
- [x] WASM worker bundling is explicitly DEFERRED to Phase 2 (owner ruling): a
      comment in each vite config says so and points at the spike's proven
      worker settings (`spikes/native-rad/vite.config.ts`)
- [x] ~~`three-gs.d.ts` declares the vendored addon's public surface (doc 03
      section F) so importers need no `@ts-expect-error`~~ SUPERSEDED by owner
      ruling (2026-08-19, see Comments): no hand-written d.ts; `allowJs: true`
      already provides checked types. Doc 03 §F amended. The criterion's
      purpose — importers need no `@ts-expect-error` — is met and verified.
- [x] The vendor-import boundary rule is NOT rebuilt — it exists and is proven
      (commit 89c35a7: clean pass / fail-on-violation naming the rule / pass).
      `npm run check` still runs typecheck && lint:boundaries, green

## Comments

**2026-08-19 — owner ruling on the d.ts criterion.** The fourth acceptance
criterion assumed a hand-written `three-gs.d.ts` was needed. Verified false
under the ROOT tsconfig (`allowJs: true`, unlike the spike's `allowJs: false`),
all three tests re-run independently before acting:

1. A bare import of `spikes/native-rad/vendor/GaussianSplatMesh.js` typechecks
   clean (exit 0) with REAL inferred types — a bogus-method probe fails TS2339,
   so inference is not `any`.
2. A deliberately false sibling `.d.ts` (`constructor(totallyWrong: string)` +
   a method that does not exist) silently shadows the JS and passes tsc exit 0
   — a hand-written d.ts is an unchecked claim, not a contract.
3. `npx tsc <vendor .js> --declaration --allowJs --emitDeclarationOnly`
   generates accurate declarations from upstream JSDoc (exit 0) — the
   documented path if a pinned, derived audit surface is ever wanted.

Ruling: do NOT hand-write `three-gs.d.ts`; doc 03 §F amended accordingly.
Public-vs-private narrowing deferred to FORK.md (ticket 02+).

**2026-08-19 — declared divergences / notes (spec standing rule 5):**
- Vite configs lib-build EXISTING modules (`src/core/index.ts`,
  `src/backend/index.ts`) as scaffold entries rather than inventing
  placeholder entry files (owner direction). Real entries (examples/*.html
  multi-page; `src/embed/register.ts`, deferred by R2) arrive at ticket 11 /
  Phase 2, which repoint the configs. "Generated an empty chunk" warnings are
  expected — both entries are types-only today.
- `dist-embed/` added to `.gitignore` (orphan output of the new embed build;
  `dist/` was already ignored).
- Versions installed: three 0.185.1 (exact), @types/three 0.185.4 (within the
  ticket's 0.185.x), vite 6.4.3 (spec `^6.0.11`, the spike-proven line).

**2026-08-19 — owner ruling batch 2 (post-review fixes, all applied):**
1. `noUnusedLocals`/`noUnusedParameters` DROPPED from root tsconfig (collided
   with spec rule 5's byte-identical COPY). Pinned affected set: **14 files
   under src/, 9 under examples/** (17 and 11 error lines respectively —
   an earlier "17" was counting lines, not files). Dated comment in
   tsconfig.json; revisit recorded as doc 06 watch item 15 (Phase 6).
2. Doc 03 §F reworded to "inferred-from but never checked"; constructor-param
   degradation to `any` recorded (verified: `new GaussianSplatMesh("wrong")`
   passes tsc exit 0). "How do fork patches get type-checked" recorded in §F
   as a NAMED OPEN QUESTION for ticket 02 — not settled.
3. vite.embed.config.ts gains `external: []` + `inlineDynamicImports: true`
   with the sibling's reasoning carried in the comment (straight defect fix).
4. `@toolkit` alias added NOW: tsconfig `paths` + vite alias in both configs;
   tsconfig include gains `examples/**/*.ts` (ticket 04's fixture needs it).
5. `done` Status value added to docs/agents/triage-labels.md; this ticket's
   Status set to done at close.
6. Builds folded into the gate: `check` = typecheck && lint:boundaries &&
   build (both configs). Spec standing rule 3's parenthetical updated to
   match. vite.config.ts comment corrected — its scaffold entry dies at
   TICKET 04 (not 11); ticket 04 gained an AC requiring the repoint.
7. Rulings propagated to plan docs: 04 (work item 1: no three-gs.d.ts, WASM
   deferred), 06 (watch item 10 reworded — no file to delete), 01:138 and
   02:128 (WASM worker → Phase 2). Claim-search run repo-wide; spec.md:45
   already correct (deferral list), doc 03 §A3 is the capability itself —
   no other twins found.
