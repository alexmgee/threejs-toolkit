# CLAUDE.md

Guidance for Claude Code when working in `threejs-toolkit`.

This repo is a sibling of `sparkjs-toolkit`: the same 3D Gaussian-splat website
toolkit, rebuilt on three.js r186 native splat rendering (`GaussianSplatMesh` +
`WebGPURenderer`) instead of the Spark library. See [README.md](README.md) for
the ground rules and the reading order of `docs/plan/`.

## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature-slug>/`, tracked by git (this repo has no remote). See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each named after its role, recorded as a `Status:` line in each issue file. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. `docs/adr/` already holds two hand-written ADRs; new ones continue from `0003`. See `docs/agents/domain.md`.
