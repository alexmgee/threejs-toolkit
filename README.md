# threejs-toolkit

A sibling of `sparkjs-toolkit`: the same 3D Gaussian-splat website toolkit, rebuilt on
three.js r186 native splat rendering (`GaussianSplatMesh` + `WebGPURenderer`) instead of
the Spark library.

**Status: PLANNING. No code exists yet. Nothing runs yet.**

## Ground rules

1. **`sparkjs-toolkit` is never modified.** It is source material and the reference
   implementation. Every parity check in this project runs *against* it, side by side.
2. **Nothing here is trusted until executed.** The entire plan derives from source
   reading (twice-read, adversarially reviewed) — but no frame has been rendered and no
   millisecond measured. Phase 0 (the spike) is the first execution of anything.
3. **No duration estimates, anywhere.** All scope is countable: files, adaptation
   points, new modules, deleted lines. See `docs/plan/00-charter.md` for why.

## The map

Read in order:

| Doc | What it holds |
|---|---|
| [docs/plan/00-charter.md](docs/plan/00-charter.md) | Goal, non-goals, invariants, the sibling-repo decision, naming |
| [docs/plan/01-source-inventory.md](docs/plan/01-source-inventory.md) | Every directory and file of sparkjs-toolkit, classified: copy / adapt / rebuild / fork / drop |
| [docs/plan/02-architecture.md](docs/plan/02-architecture.md) | Target architecture: renderer, backend seam, the pager, module map |
| [docs/plan/03-capability-specs.md](docs/plan/03-capability-specs.md) | Per-capability rebuild specs — the dense core of the plan |
| [docs/plan/04-build-order.md](docs/plan/04-build-order.md) | Phases, entry/exit criteria, decision gates |
| [docs/plan/05-parity-verification.md](docs/plan/05-parity-verification.md) | How equivalence with sparkjs-toolkit is proven, phase by phase |
| [docs/plan/06-open-decisions.md](docs/plan/06-open-decisions.md) | The owner's calls, each mapped to the scope it moves |

Upstream evidence this plan is built on lives in the sparkjs-toolkit repo:
`docs/research/2026-08-14-threejs-port-proposal-reviewed.md` (the adversarially reviewed
proposal) and `.collab-logs/verify-*.out.md` (the raw review JSON, file:line evidence).
