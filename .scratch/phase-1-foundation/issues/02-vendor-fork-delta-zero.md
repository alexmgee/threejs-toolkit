# 02 — Vendor the fork at delta zero, with FORK.md

**What to build:** the real `GaussianSplatMesh` + `CountingSort` +
`GaussianSplatUtils` live under `src/vendor/three-gs/`, byte-identical to the
dev-branch snapshot the spike vendored, governed by a FORK.md. With no fork
feature in use, behavior equals upstream (H-FORK's identity premise).
Read `../spec.md` first.

**Blocked by:** 01

**Status:** done

- [x] The three addon files are byte-identical to
      `spikes/native-rad/vendor/{GaussianSplatMesh,CountingSort,GaussianSplatUtils}.js`
      (`diff` empty against each) — NOT the spike's edited fork
      (`spikes/native-rad/src/GaussianSplatMesh.fork.js` is Phase 2 material)
- [x] FORK.md records: upstream provenance as precisely as recoverable (the
      exact dev-branch commit if it can be established; otherwise the snapshot
      date, source, and an honest note that the hash was not recorded at
      vendoring), a "no local changes yet" delta statement, and the
      per-release re-diff procedure (doc 03 section F)
      *(wording note: the delta statement reads "no FUNCTIONAL changes" — a
      literal "no local changes yet" would be false, because the snapshot
      itself carries the `[flatten-imports]` divergence from upstream, forced
      by AC 1's byte-identity-to-spike; FORK.md's patch list is the complete
      divergence inventory)*
- [x] The PLACEHOLDER `src/vendor/three-gs/index.ts` is DELETED and replaced by
      the real module surface — never left beside it
- [x] `src/backend/index.ts` (the D18 placeholder, which stays until Phase 2)
      has its import re-pointed at a real vendor export so it still compiles
- [x] `npm run check` green — the seam rule still holds with the real fork in place

## Comments

**2026-08-20 — owner rulings taken before building (repo rule 11):**
1. "Real module surface" = the JS files themselves, NO barrel: the vendor
   directory contains only upstream bytes + FORK.md; a hand-written TS file
   inside it would break the delta-zero property. Backend deep-imports
   `../vendor/three-gs/GaussianSplatMesh.js`; the seam rule is
   directory-scoped so it still holds.
2. `BackendMeshOptions` is backend-owned (`capacity`/`pages` declared locally
   in src/backend/): capacity is a pager concept that upstream's constructor
   does not take — it exists only once OUR fork patch adds it. Backend wraps
   vendor; vendor never informs backend's types. *(Citation note, from
   review: the ruling's "(ADR 0003)" aside fits `pages` — ADR 0003 derives
   the pages budget and never mentions capacity; the capacity guard contract
   lives in doc 03 §F. Both cites now correct in src/backend/index.ts.)*

**2026-08-20 — divergences declared (spec rule 5):**
- No barrel replaces the placeholder (ruling 1); backend deep-imports the
  vendor file and re-exports the type only.
- `BackendMeshOptions` restructured per ruling 2 (same shape:
  `{capacity?: number; pages?: number}`, same doc comments).
- `[flatten-imports]` is the only divergence from upstream — recorded as a
  titled patch in FORK.md (single home for provenance detail).
- `.gitattributes` added at repo root (`-text` on both vendor dirs): without
  it, the machine-wide `core.autocrlf=true` rewrites the vendored files to
  CRLF at the next checkout, falsifying FORK.md's SHA-256 drift baseline
  and all future upstream byte-comparisons (review finding, demonstrated
  end-to-end; verified `git check-attr` unspecified before the fix).
- Plan-doc wording reconciled to this ticket's own AC 2 (which sanctions the
  window fallback): 00-charter:73, 02-architecture:118, 03 §F:197 said
  FORK.md records "the exact upstream commit / commit hash" — now say
  provenance as precisely as recoverable. 03 §F:201's "byte-for-byte"
  identity now defers to H-FORK's pixel-identical definition (doc 05, which
  §F already cited). Doc 06 D18 entry notes the vendor anchor was replaced
  by this ticket.

**2026-08-20 — provenance + type status:** established this session,
recorded in FORK.md (single home): §Provenance (window `da05705`..`9a5e800`
exclusive, per-file identity, method: diff against raw.githubusercontent),
§Type status (checkJs census; watch item 10 is breaking), §Known upstream
drift (dated post-snapshot list incl. the r186 rename and the ef58888
frustum-culling collision with §F's planned `visible` culling), and the
module-graph note (dual `'three'`/`'three/webgpu'` entry points — Phase 2
alias decision pending). The spike fork's actual patch titles ([capacity]
[uploadPage] [selection] [invalidate]) are named there as the incoming
Phase 2 set.

**2026-08-20 — verification evidence:**
- Byte-identity: `diff` empty AND SHA-256 match for all three files against
  spikes/native-rad/vendor/ (AC 1); digests recorded in FORK.md.
- Seam rule fail-on-violation probe: a temp src/core file importing
  vendor/three-gs produced `error vendor-seam-only` naming the rule; clean
  pass (8 modules, 9 dependencies) after removal (AC 5). Type-only imports
  are visible to the rule (tsPreCompilationDeps: true; probe-verified).
- `npm run check` (typecheck + boundaries + both builds) exit 0.
- HONEST GATE CAVEAT (declared): the gate is blind to the vendored bytes.
  Both builds are vacuous — the only edge into vendor is type-only, so
  0.00 kB chunks prove the seam and nothing else. With checkJs off, tsc
  suppresses even unresolvable imports inside the .js files (probe-verified:
  a vendor file importing './no-such-module.js' passes the ENTIRE gate).
  Execution evidence for these bytes: the H-LOAD browser baseline (commit
  e738ba6) ran the spike fork, which imports the vendored CountingSort.js
  and GaussianSplatUtils.js — those two files have executed in a browser;
  vendored GaussianSplatMesh.js itself has NEVER been loaded (only its fork
  superset). The spike's `npm run smoke` is a BUNDLE check, not execution.
  First value-export through the seam flips the embed build from 0 kB to
  bundling addon + three (`external: []` is intentional there).

**2026-08-20 — §F open question RULED at close: D20 (doc 06).** Fork patches
are authored in `.ts` files alongside the vendored JS; `@ts-check` rejected
(120-error triage dies when the addon ships in a release). Effective at the
first Phase 2 fork patch. §F now points at D20; the question is closed.

**2026-08-20 — owner ruling R5 (spec.md):** the COPY source for tickets 03-09
is sparkjs-toolkit's working tree as on disk (grounds and the SHA-256
at-copy-time requirement recorded in spec.md's rulings section).
