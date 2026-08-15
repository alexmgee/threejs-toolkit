# 0001 — The port is unconditional

Date: 2026-08-15
Status: accepted

## Decision

threejs-toolkit will be built and shipped. Its existence is not conditioned on matching
sparkjs-toolkit's load performance (the 2.3 s hero reveal) or any other Spark benchmark.
Load behavior "should be similarly optimized and as fast as possible, but it is not
conditioned on matching something like that" (owner, 2026-08-15).

## Context

The adversarially reviewed proposal (sparkjs-toolkit, 2026-08-14) framed Phase 0 as a
"vertical cancellation spike": if a toolkit-owned pager on three.js could not match the
Spark control on reveal, the port would stop. The owner rejected that framing when it
was put to him directly (grilling session Q1).

The alternative was a hard parity gate, defended on three grounds (the 34s→2.3s result
is the project's most fought-for outcome; a regressing port is a toolkit you can't use
for hero scenes; a gate is free if it never bites). The owner chose otherwise: the goal
is a three.js version of the project, bottom line — performance is an optimization
target inside that goal, not a precondition of it.

## Consequences

- **Phase 0 changes character**: from cancellation gate to *measurement and
  optimization baseline*. Its ten numeric criteria remain the measurement instrument;
  criterion 1 ("no worse than the Spark control") becomes the optimization target, not
  a pass/fail bar. A miss produces an optimization backlog, not a stop.
- **Decision gates throughout the build order become steering points**: they decide
  *how* to respond (optimize, re-scope, re-order), never *whether* to continue.
- **Phase 2 (the pager) remains in scope on its merits** — progressive loading is what
  makes heavy scenes usable — but a shortfall against Spark ships with a recorded
  number and an open optimization item rather than blocking release.
- The fallback postures in the proposal (hybrid per-page, stay-and-watch) are no
  longer landing zones for a failed gate; they are simply not this project.
- Spark control runs remain in every harness (doc 05) — as the measuring stick that
  makes "similarly optimized" a number instead of a feeling.
