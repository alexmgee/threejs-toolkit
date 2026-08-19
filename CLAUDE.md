# CLAUDE.md

Guidance for Claude Code when working in `threejs-toolkit`.

This repo is a sibling of `sparkjs-toolkit`: the same 3D Gaussian-splat website
toolkit, rebuilt on three.js native splat rendering (`GaussianSplatMesh` +
`WebGPURenderer`) instead of the Spark library. three is pinned **0.185.1** —
r186 is not published (doc 06 watch item 13, checked 2026-08-19) — with the
`GaussianSplatMesh` addon vendored from the dev branch until it ships in a
release. See [README.md](README.md) for the ground rules and the reading order
of `docs/plan/`.

## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature-slug>/`, tracked by git (this repo has no remote). See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each named after its role, recorded as a `Status:` line in each issue file. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. New ADRs continue from the highest existing number + 1; 0001 and 0002 pre-date the skills and are never renumbered or rewritten. See `docs/agents/domain.md`.
