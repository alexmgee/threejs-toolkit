# 02 — Vendor the fork at delta zero, with FORK.md

**What to build:** the real `GaussianSplatMesh` + `CountingSort` +
`GaussianSplatUtils` live under `src/vendor/three-gs/`, byte-identical to the
dev-branch snapshot the spike vendored, governed by a FORK.md. With no fork
feature in use, behavior equals upstream (H-FORK's identity premise).
Read `../spec.md` first.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] The three addon files are byte-identical to
      `spikes/native-rad/vendor/{GaussianSplatMesh,CountingSort,GaussianSplatUtils}.js`
      (`diff` empty against each) — NOT the spike's edited fork
      (`spikes/native-rad/src/GaussianSplatMesh.fork.js` is Phase 2 material)
- [ ] FORK.md records: upstream provenance as precisely as recoverable (the
      exact dev-branch commit if it can be established; otherwise the snapshot
      date, source, and an honest note that the hash was not recorded at
      vendoring), a "no local changes yet" delta statement, and the
      per-release re-diff procedure (doc 03 section F)
- [ ] The PLACEHOLDER `src/vendor/three-gs/index.ts` is DELETED and replaced by
      the real module surface — never left beside it
- [ ] `src/backend/index.ts` (the D18 placeholder, which stays until Phase 2)
      has its import re-pointed at a real vendor export so it still compiles
- [ ] `npm run check` green — the seam rule still holds with the real fork in place
