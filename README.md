# threejs-toolkit

A sibling of `sparkjs-toolkit`: the same 3D Gaussian-splat website toolkit, rebuilt on
three.js native splat rendering (`GaussianSplatMesh` + `WebGPURenderer`) instead of the
Spark library.

The renderer is pinned to **three 0.185.1** (published), with the `GaussianSplatMesh`
addon **vendored from the three.js dev branch** into `spikes/native-rad/vendor/` — the
addon is not in any published release yet. `spikes/native-rad/package.json` is the
authority on the version; don't quote a release number from prose.

**Status: PLANNING for the toolkit — no toolkit code exists yet. The Phase 0 spike is
underway** in `spikes/native-rad/` and does run. Current spike state, remaining tasks,
and the traps that cost real time are in
[.scratch/handoffs/001-2026-08-15-phase0-spike-continuation.md](.scratch/handoffs/001-2026-08-15-phase0-spike-continuation.md).

## Ground rules

1. **`sparkjs-toolkit` is never modified.** It is source material and the reference
   implementation. Every parity check in this project runs *against* it, side by side.
2. **Nothing here is trusted until executed.** The plan derives from source reading
   (twice-read, adversarially reviewed); Phase 0 exists to execute it. Frames now
   render and the `.rad` decoder passes a golden test, but **no measurement against
   the Spark control has been taken yet** — every performance claim in the plan docs
   remains unverified until `docs/plan/results/phase-0.md` exists.
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
