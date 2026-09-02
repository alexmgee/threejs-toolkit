# Handoff 006 — Phase 2 tickets 03+04 CLOSED; next: TICKET 05

2026-08-29. Written for a COLD session with no memory of this one. Goal of
the next session: **TICKET 05 — RadPager fetch + 4-worker decode pool**
(.scratch/phase-2-backend/issues/05-fetch-decode-pool.md), runnable without
re-deriving anything. Ticket 05 starts on the owner's explicit go, not on
this document. Handoff 005 remains the record for tickets 01/02.

## STATE

| What | Commit(s) |
|---|---|
| Tickets 01+02 + spec + rulings | per handoff 005 (`d9022b6`…`1cd8b2d`) |
| Ticket 03: SplatBackend seam + ThreeGsBackend + monolithic PLY, pixel-proven both backends | `b9af209` + `2ca1d61` (status) + `f9ee79a` (ACs) |
| Ticket 04: fork patch 1 — dispose() + capacity guard as pure .ts siblings; embed-size tripwire | `c58c0d2` |

Frontier: **05 next** — it heads the pager chain 05→06→07, the phase's
critical path; 08 and 10 are also unlocked but 05 is the owner-named next.
One ticket at a time; unlocked ≠ authorized.

**Vendored digests still byte-identical to the ticket-02 baseline** (delta
zero SURVIVED fork patch 1 — that is the point of the D20 shape):
`0da00b78…` GaussianSplatMesh.js · `e9e90b69…` CountingSort.js ·
`f65f9222…` GaussianSplatUtils.js (full hashes in FORK.md).

## WHAT NOW EXISTS that ticket 05 builds on

- **The seam** — `src/backend/SplatBackend.ts`: full doc 02:67-84 interface;
  `SplatHandle` carries `readonly object: THREE.Object3D` (owner-ruled;
  caller composes via scene.add); `LoadProgress = { bytesLoaded, bytesTotal,
  phase: fetching|constructing|ready|failed, fraction }` — fraction =
  bytes ratio (clamped, total never below loaded), holds 1.0 through
  constructing, ready/whenReady authoritative, monotone by construction,
  ticket 08 owns the §A5 reveal refinement; `SplatBackendError` with
  machine-readable `reason` (assert on reason, not prose — message carries
  no name prefix).
- **ThreeGsBackend** — `src/backend/ThreeGsBackend.ts`: monolithic PLY path
  (bounded 64 KiB header scan, CRLF-tolerant, required-property validation
  refusing mesh-PLYs as `not-splat-ply`, line-anchored vertex count,
  RangeError→`over-capacity` catch-and-name at parse/convert/construct);
  real `dispose()` (aborts in-flight fetch via AbortController, mesh held on
  HandleState — never `children[0]`, finally-guaranteed detach + handle
  invalidation, post-dispose handle is `unknown-handle`, mid-load dispose
  rejects `handle-disposed`); constructor options `{ renderer,
  maxStorageBufferBindingSizeOverride /* TEST-ONLY */ }`. Remaining
  named-refusal stubs and owners: `rad`→**tickets 05/06** (ticket 05
  replaces this refusal with the real paged path), `splat`→ticket 08,
  `spz`→watch item 13, raycast→Phase 3 §B, setEdits→Phase 3 §C,
  setMeshColor→Phase 4, setOptics→Phase 5.
- **The patches mechanism** — `src/vendor/three-gs/patches/{dispose,
  capacity-guard}.ts`: PURE .ts siblings; vendored JS byte-frozen; FORK.md's
  titled entries name EVERY internal surface touched and re-diff step 3a
  re-verifies them; patches throw `ForkPatchError` (never import src/
  outside vendor — `vendor-must-not-reach-src` cruises it), backend wraps
  into `SplatBackendError`. dispose is strictly two-phase
  (validate+collect, then free) and also frees the WebGL2 PBO DataTextures
  and DualAttributeData twin GL buffers; `_attributes === null` = pre-init,
  not a reshape. capacity-guard: largest binding over vec4 count×16, SH
  bands, and the count-independent 16,384 B sort histogram/offset
  (BIN_COUNT 4096 mirrored + inventoried).
- **Gate** — `npm run check:full` standard on this machine (handoff 005
  ruling stands); `check` now also runs `scripts/check-embed-size.mjs`
  right after build: dist-embed/embed.js ≤ 262,144 B (baseline 215,915;
  missing artifact FAILS; drilled both ways). The embed entry is
  `src/backend/embed-entry.ts` (decode-only) — the barrel as entry
  ballooned embed.js to 1.1 MB in ticket 03; never point it back.
- **splat-lab** — `examples/splat-lab/` at **28/28 on WebGPU and
  `?webgl=1`**, dev and built. Its harness provides, reusable for 05:
  timer-free machinery (MessageChannel `yieldMacrotask` + phase-polling
  ready-wait — survives hidden-pane throttling), the paint sentinel
  (counts real paints, not rAF ticks), the H-LIFE union-counter gate
  (9 info.memory counters, per-cycle pre-load baseline + metered
  capture-leak delta, loaded-state-must-differ liveness leg), an
  independent DataView PLY parser, and the pinned-pose readback pattern
  (createCapture from `examples/shared/capture.ts`; asserts on
  `error.reason` codes). Fixture asset: generated
  `examples/assets/splat-lab/fixture.ply` (48 splats, sha `80eddee8…`,
  generator `scripts/gen-splat-fixture.mjs`).

## TICKET 05 ENTRY BRIEF

- **Promotion source material — STUDY BEFORE INVENTING**: the Phase 0 spike
  under `spikes/native-rad/`: its RadFetcher (206-or-die Range discipline),
  the rad-worker round-trip, and **FORMAT.md — which stays the byte
  authority; never re-derive format facts** (chunksStart = 8 +
  roundup8(headerLength) and friends live there and in doc 02:101-108).
  Promote where the spike holds, replace where the spec says otherwise
  (spike gaps recorded in spec.md: single worker → pool of 4; no
  retry/pages-unavailable). The spike's fork
  (`spikes/native-rad/src/GaussianSplatMesh.fork.js`) carries `[capacity]`
  `[uploadPage]` `[selection]` `[invalidate]` — fixed-capacity allocation
  is 05/06 material NOW; reconcile against §F, do not assume titles match.
  The crate is promoted (`rad-three/`, packed-SH parity, named-refusal
  decoders); `src/backend/decode.ts` + `rad-worker.ts` exist (inline-worker
  cruiser rules bind: only decode.ts value-imports the worker; lib barrel
  must not reach decode).
- **Hero asset serves via the /@fs Range path** (vite `fs.allow`) —
  **range-only fetch is a HARD requirement with its own assertion**: prove
  the fetch path issues Range requests and dies on a 200 (206-or-die), not
  silently full-body. The hero asset is machine-local; `check` stays
  portable — hero-dependent tests follow the golden-test pattern
  (visible skip, gate-run via check:full).
- **Ticket 04's recorded gap closes here**: SH-degree 1–3 dispose paths are
  untested until SH data flows. The hero carries SH — once a paged mesh
  with SH bands loads, PLACE THE ASSERTION: dispose with SH bands +
  contribution buffer live, union counters exactly back to baseline.
- **Retry + pages-unavailable semantics are THIS ticket's** (doc 03 A2:
  bounded retry, then pages marked unavailable WITHOUT wedging reveal —
  named refusals, never a hang). **Derived numbers only**: every constant —
  the pool size 4 included — traces to the spec/plan (doc 03 A2/A3, doc 02)
  or becomes a design stop with options+evidence+recommendation. The
  owner halts work over underived numbers (memory:
  challenge-arbitrary-constants).

## TRAPS, priced (005's carry forward — vacuous-assertion check, sibling-fix
## question both ways, grep-can't-answer-math, cwd persistence, wasm-pack
## hooks, ties-to-even, hidden-pane visibilityState — plus this session's):

1. **Chrome intensive timer throttling**: a long-hidden page clamps nested
   timers to ~1 fire/minute — froze the cycle loop for minutes. Fixture
   machinery went TIMER-FREE for exactly this: MessageChannel macrotask
   yields (unthrottled) + synchronous renders + phase polling. Reuse it;
   never build fixture waits on setInterval/setTimeout.
2. **captureSync/capture render-target leak**: the shared capture module
   deliberately leaks its offscreen target on a hidden-pane readback
   timeout ("the hang is terminal here") — unmetered, it masquerades as a
   dispose bug. splat-lab meters every capture's own counter delta into the
   expected baseline (absorption ONLY on the timeout path — blanket
   absorption would whitelist real leaks).
3. **In-place file writes silently swallowed** (once, ~1h in): python/node/
   perl rewrites of one file read back unchanged in the SAME process;
   write-copy-then-rename worked (sed -i too — it renames). Suspect
   agenttrail's watcher; if it recurs, pause agenttrail to test. Symptom
   shape: an edit "not taking" with no error.
4. **Counters have blind spots**: the WebGL2 transform-feedback twin
   buffers AND the PBO textures both escaped `renderer.info.memory`
   (the counter decrements whether or not the twin is freed; PBO textures
   are counted but nothing upstream frees them). Derived pass-criteria
   cannot see what the instrumentation doesn't count — that is what the
   adversarial + built-in review rounds are FOR. Also: gate on the UNION of
   counters (storage moves on WebGPU, textures on WebGL2 — a single-family
   gate is backend-conditionally vacuous) and require the loaded state to
   DIFFER from baseline before flatness counts.
5. **Vacuous-assertion check, again, four new instances this session**: the
   `buffers` info field that doesn't exist (undefined===undefined green),
   the storage-only gate on WebGL2 (0===0), the missing-artifact tripwire
   leg, degree>3 NaN in the guard. Before trusting green: what makes this
   go red?
6. **check:full TRUE exit discipline**: redirect to file, echo $?; never
   judge by a pipe; iterate tsc to fixpoint.

## PROCESS RULES that live in no file (unchanged from 005)

- The OWNER commits — NO delegation unless granted per run
  (staged-list-shown-first, stop on any stray). This session had two scoped
  grants (03, 04) + an explicit handoff-commit instruction; the next
  session starts with NONE.
- One ticket at a time; each start is an explicit owner go. Rule-11 stops
  at anything unsettled: options + evidence + recommendation, never a pick
  (this session's stops: patch shape, GPU-free path, guard limit, H-LIFE
  criterion, SPZ scope, asset, interface breadth, handle hand-over,
  progress shape — all owner-ruled, recorded in the tickets/PLAN).
- Review order after green: adversarial FIRST — gpt5.6-sol at HIGH effort,
  read-fenced prompt in .collab-logs (grok is FUNDED again and worked twice
  this session; composer-2.5 is the coding labor lane, proven in 03/04 —
  **park `.claude/settings.local.json` during cursor-agent dispatches and
  restore after**: cursor's Claude-hooks compat mangles the agenttrail hook
  into a bash syntax error that blocks every tool call; long specs go in a
  .collab-logs file + a two-line pointer prompt, argv and stdin both fail).
  THEN built-in /code-review. Reported separately; EVERY external finding
  re-verified with commands whose output would differ — confirm or refute,
  never absorb (this session: sol 8 findings → 6 confirmed 1 partial
  1 refuted; built-in 11 more, incl. two leaks counters couldn't see).
- No time estimates, ever. Git explained in plain English to the owner.
- sparkjs-toolkit PERMANENTLY read-only; vintage `fd67153` via
  `git show fd67153:<path> > dest`, never disk; hash the DESTINATION.

## WIDER CONTEXT (one line each)

- Decision ledger: doc 06 (D14 inline-wasm ruled · D16 comparisons retired ·
  D18 CLOSED this session · D20 proven as pure .ts siblings · D21 vintage
  map final · D23 executed in 03 · D24 own-name export) + ticket-03/04
  Comments + PLAN.md ## decisions carry the 2026-08-29 rulings.
- Watch item 13: three pinned 0.185.1; r186 ships SPZLoader AND the
  GaussianSplat rename — SPZ named gap + FORK.md re-diff both hang on it;
  re-check at the phase boundary.
- `.claude/launch.json` machine-local and unrecoverable (toolkit-dev, port
  5173, strictPort); sparkjs dev may hold 5173 — never kill.
- D:\tmp is NEVER a scratchpad — session scratchpad dir or ask.
- Open task chips: decode-lab renders green on runner crash (splat-lab's
  fix never propagated); examples/shared extraction (assert harness, xFrac,
  verdict CSS — plus yieldMacrotask joined the list this session);
  SH-degree dispose gap → CLOSES IN 05 (assertion placement in the brief).
- PLAN.md is a DERIVED VIEW — docs/plan/04-build-order.md is the sole
  sequencing authority, .scratch/ tickets the work ledger; on conflict they
  win.
- The embed artifact contract: 215,915 B decode-only via embed-entry.ts;
  raising the 262,144 B bound requires an owner ruling recorded in the
  ticket that raises it.
- Memory notes all still accurate: adversarial-findings-are-claims,
  review-order-after-green, challenge-arbitrary-constants,
  no-spark-comparison-metrics, fork-patch-typechecking (D20 resolved).
