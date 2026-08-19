# 01 — Scaffold completion: buildable toolkit package

**What to build:** a developer runs `npm run check` and both vite builds at the
repo root and everything is green — the package the rest of Phase 1 lands into.
Read `../spec.md` first; its standing rules bind.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] `three` pinned exactly `0.185.1` (no `^`/`~`) and `@types/three` `0.185.x`
      added to the root package.json (r186 is NOT published — doc 06 watch item
      13, checked 2026-08-19; do not float the range)
- [ ] `vite.config.ts` and `vite.embed.config.ts` exist and each builds a
      trivial `src/` entry to completion
- [ ] WASM worker bundling is explicitly DEFERRED to Phase 2 (owner ruling): a
      comment in each vite config says so and points at the spike's proven
      worker settings (`spikes/native-rad/vite.config.ts`)
- [ ] `three-gs.d.ts` declares the vendored addon's public surface (doc 03
      section F) so importers need no `@ts-expect-error`
- [ ] The vendor-import boundary rule is NOT rebuilt — it exists and is proven
      (commit 89c35a7: clean pass / fail-on-violation naming the rule / pass).
      `npm run check` still runs typecheck && lint:boundaries, green
