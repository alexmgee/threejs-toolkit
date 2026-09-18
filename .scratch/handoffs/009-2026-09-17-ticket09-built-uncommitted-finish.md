# Handoff 009 — Ticket 09 BUILT, GREEN, UNCOMMITTED; next: FINISH ticket 09

2026-09-17. MID-TICKET handoff, written for a COLD session. Goal of the next
session: **finish ticket 09** (`.scratch/phase-2-backend/issues/09-siteruntime-retyping.md`)
— size-bound tripwire update → `npm run check:full` true exit → adversarial round
(registry-first) → built-in round → two staged lists → two commits. **NOTHING commits
before both review rounds.** The session that wrote this ran out of context; all ticket
09 work sits UNCOMMITTED in the working tree. Handoff 008 remains the record of the
ticket's entry brief and of tickets 08/10.

## FIRST ACT — re-verify this inventory; nothing else until it matches

HEAD at writing: `12ae437` (Handoff 008) plus this handoff's own commit. `git status
--porcelain` at writing, verbatim:

```
 M .scratch/phase-1-foundation/issues/04-foundation-cluster.md
 M .scratch/phase-1-foundation/issues/08-scene-periphery-cluster.md
 M .scratch/phase-2-backend/issues/09-siteruntime-retyping.md
 M .scratch/phase-2-backend/issues/12-diagnostics-rewired.md
 M PLAN.md
 M docs/plan/06-open-decisions.md
 M docs/plan/results/phase-0.md
 M examples/loader-lab/main.ts
 M examples/vite-env.d.ts
 M src/backend/ThreeGsBackend.ts
 M src/core/EnvironmentLoader.ts
 M src/core/ThreeSplatScene.ts
 M src/index.ts
 M tsconfig.json
 M vite.config.ts
 M vite.embed.config.ts
?? examples/h-api/
?? examples/site-lab/
?? src/backend/decode-url.ts
?? src/core/SplatBounds.ts
?? src/embed/
?? src/interact/
```

The `??` directories expand to (`git status --porcelain --untracked-files=all`):
`examples/h-api/{scene-naming,shared-surface}.ts`; `examples/site-lab/{element.html,
element.ts,index.html,main.ts,pin-element-events.json}`; `examples/site-lab/sites/
{control-copy-block-id,control-duplicate-show-blocks,lab,lm-lifetime,obstacle,
throw-copy-block-id,throw-duplicate-show-blocks}.site.json`; `src/embed/{FragmentRouter,
SiteRuntime,SplatSiteElement,diagWiring.stub,diagWiring,register}.ts`;
`src/interact/SplatHighlight.ts`; plus the two single files above.

SHA-256 at writing (`sha256sum < FILE`), with raw CR-byte counts (`tr -cd '\r' < FILE | wc -c`):

| sha256 | file | CR |
|---|---|---:|
| `a114327ad51a3a6dc5d5427f8048b0b10080867e805d94ddb139373a1c5966d0` | src/embed/SiteRuntime.ts | 0 |
| `773a619b93e0b546da616102c34dd4fa0e719dd4d4ea75f3bb93f3ff09c014ef` | src/embed/SplatSiteElement.ts (= pin blob) | 0 |
| `770abf78f5dba7088d9461d1e61e38ca56fbd6d6eb3cec19f1371affae8b7f67` | src/embed/FragmentRouter.ts (= pin blob) | 0 |
| `eaf181afc553e83ee11d6f21202f0fdb395a9f8b6607b10cda534208e56f5dcc` | src/embed/register.ts (= pin blob) | 0 |
| `3cfaa0b48f7aff5607373f1f96fefd10313459cedef834a8bacaf47b7a9abf29` | src/embed/diagWiring.ts (pin + 1 line) | 0 |
| `fcd0a4e7fd5f7de866f87cd3891c0e139e03fda2ea600ebc97952004d67490b2` | src/embed/diagWiring.stub.ts (= pin blob) | 0 |
| `9816c303d117e403aa2c87a9ee27d129aee5577c49b1dceaf00b6c1d898ddb67` | src/interact/SplatHighlight.ts (D27 stub) | 0 |
| `e3f9f1e1407ee5aa1d4b66750a88d8142b42f8806099dbd2d49db690fa0efa48` | src/core/SplatBounds.ts (D30 stub) | 0 |
| `d4bc2516840efcdee1803866cae3cf1c05f14bbb275027d70d7bb9095844cce8` | src/backend/decode-url.ts | 0 |
| `ba9cfd5d0cda1722c0101e9e7222aac1d0bd8a978fed62d38274b44283346821` | src/backend/ThreeGsBackend.ts | 0 |
| `1171c00445e7f801d9094cf78c95c8a2a916c2a061eb362a65589b206acc9ec9` | src/core/ThreeSplatScene.ts | 0 |
| `7349db9f71d0dff25d35a72b394369bca6423cfb5d6e19f312ba57fb76c21223` | src/core/EnvironmentLoader.ts | 0 |
| `00e45244d06c482f1db52c5155d401fc0e4684d94d6a0ea056789c533af6335a` | src/index.ts | 0 |
| `7423cba52548b9b16e7edf934ffc45491ce2f85da98a1a8ada8734242c92bea0` | vite.config.ts | 77 (all-CRLF, as committed) |
| `854a57ee2295691a73a2b99971c55fb25673cb9962b1a9d406265bbc0d6d2e36` | vite.embed.config.ts | 0 |
| `a81d3dc823153f3601d2c55e2cf11bbf62ac1c71bd3a02fec4b75ea4f65687dc` | tsconfig.json | 0 |
| `2dc96a6ebaab4ae7fa4c979e90484976869758b601b3c2e5c702a1907c057004` | examples/vite-env.d.ts | 0 |
| `1f5c00b8b8415ee1e3d32ba5050d4949d159d32bf4dc46ed308272e2ac3a894f` | examples/loader-lab/main.ts | 0 |
| `fc67af8115a1370c8f734c5d0d78d11d9b2312228c0458c12d5d28696b54f05d` | examples/site-lab/index.html | 0 |
| `59c15fe23cc648e93fb3338c5209f26484d5058b938c1b09d09a93b36de136cf` | examples/site-lab/main.ts | 0 |
| `8711b4ff05414ba0632d897d12ea6a3b4d570d391e4d2fbc9cfefb9a639121f5` | examples/site-lab/element.html | 0 |
| `6fa3a589ccc6ae9624927e3ec2497a6962757582c8bd38e5436e69141eccbb33` | examples/site-lab/element.ts | 0 |
| `a33596218b65842334d6044e7669032185f2ff074f493d86e3a27e395b7f9f67` | examples/site-lab/pin-element-events.json | 0 |
| `61375c0b9db881e36f46e46d55c841b2babc40b8f05d3c885766f2d10e57a744` | examples/site-lab/sites/lab.site.json | 0 |
| `a5eca0ebe87d14045a3942ddcd71c0148bfb61280713416c4b5505ab3381ce09` | examples/site-lab/sites/lm-lifetime.site.json | 0 |
| `5f95375e276ab9736698cb7c21bd72577d2b4eb2527a77d7cb835484505bc33a` | examples/site-lab/sites/obstacle.site.json | 0 |
| `8c3c2323677b44b1746078b6d0cf96e10ab7d99937793d6a4e6718611681350a` | examples/site-lab/sites/throw-copy-block-id.site.json | 0 |
| `71fbf083e00c0976fa117ef4171612ce29c37b058fb8043998982fd26e54cca2` | examples/site-lab/sites/control-copy-block-id.site.json | 0 |
| `001601ff318f9582225f1636c347e80bd2c2eb1e4ab48353b98a989e69581a07` | examples/site-lab/sites/throw-duplicate-show-blocks.site.json | 0 |
| `ed4e7e25f7fb857aecb4832c50a7786a0e92ccdb129ef76b9273f0cbc4b2fd0b` | examples/site-lab/sites/control-duplicate-show-blocks.site.json | 0 |
| `b812b00d200e683f0cc1feab6819ca0554465363fca2b61df376f61108f106ba` | examples/h-api/shared-surface.ts | 0 |
| `834132a3a4fb52eb7642cd93c29cc9fc4e4c3d9ba9e7d0ae2673b58e47f75a9a` | examples/h-api/scene-naming.ts | 0 |
| `69cb67bdf6edb74fd90c581b51cda5ebc0a3d970160c2424f55c75fd429b084b` | docs/plan/results/phase-0.md | 0 |
| `990c9a2fc8d0558f6267bc4226c4f6bc2cccb94c7c86f941bdf57aabc3714737` | docs/plan/06-open-decisions.md | 0 |
| `aa45636928df9807812f8acb2cd954a8557783379ef68db2e87e45e6b70287e9` | PLAN.md | 331 (all-CRLF, as committed) |
| `d39ab718020aeef7748b93c316be075e7a44090965454ece730277ad36f52bba` | .scratch/phase-2-backend/issues/09-siteruntime-retyping.md | 0 |
| `62afef9cea3a82934e7f746b23e1534dc2038d0a26f3488f67dd6205fc338019` | .scratch/phase-2-backend/issues/12-diagnostics-rewired.md | 0 |
| `168d2c10b9205e3936eadfe54518727ec2434530bbc2811fb5ea5ad96d2f0091` | .scratch/phase-1-foundation/issues/04-foundation-cluster.md | 0 |
| `3e10cf47c36296c631c3d199987bfe44e9e3b3c3677ffe1fa4883821588b25cf` | .scratch/phase-1-foundation/issues/08-scene-periphery-cluster.md | 0 |

Line-ending map: every touched file is LF (CR=0) EXCEPT `vite.config.ts` and `PLAN.md`,
which are committed all-CRLF and must stay so. `src/**` and `examples/**` are `-text`
(bytes stored exactly); `.scratch/**`, `docs/**`, `vite.embed.config.ts`, `tsconfig.json`
print git's autocrlf "LF will be replaced by CRLF" notice on `git diff` — pre-existing,
harmless, not churn.

## THE SIZE BOUND — confirm with the owner before applying

In the last message of the writing session (interrupted before ANY action was taken on it)
the owner stated: **bound 3,932,160 B (3.75 MiB) for the product embed** — telemetry in,
the pin's default configuration, the build the tripwire guards. Stated grounds: ~25%
headroom over today's 3,138,621 B, matching the original bound's ~21% proportion and its
binary-round convention (256 KiB); reference anchor, the sibling's embed is ~6 MB with
Spark inlined, so the product embed sits at ~52% of reference; today's numbers, both
builds raw and gzip plus the 122,232 B telemetry-graph cost, go in the ticket verbatim as
the baseline the next raise is measured against. The owner's final instruction then said
the ruling arrives in the new session — so **confirm it with the owner at start**, then
record it in ticket 09 (the script's own rule: "Raising the bound requires an owner ruling
recorded in the ticket that raises it") and update `BOUND` + the header comment in
`scripts/check-embed-size.mjs`. Never set a number yourself.

Measured (recorded in ticket 09 Comments, "The embed entry switch and its MEASUREMENTS"):

| build | raw | gzip |
|---|---:|---:|
| product embed, telemetry in | 3,138,621 B | 806,083 B |
| `TELEMETRY_MEASURE=off` | 3,016,389 B | 774,453 B |
| telemetry-graph cost | 122,232 B | 31,630 B |

Both single-file (`dist-embed/` held only `embed.js`); marker
`loadTelemetry:semanticsVersion` present in the first, absent in the second. Current
`BOUND = 262144` → `check:embed-size` FAILS until updated; everything else in the gate
passed on the final tree: `build:site EXIT=0 · test:crate EXIT=0 (6 passed) · typecheck
EXIT=0 · lint:boundaries EXIT=0 — no dependency violations found (186 modules, 586
dependencies cruised)`. `dist-embed/embed.js` on disk right now is the TELEMETRY_MEASURE=off
build (the last one run) — `check:full` rebuilds it, so no action needed.

## TICKET 09 STATE

**All seventeen stops RULED** (owner, 2026-09-17), each recorded in ticket 09 Comments
(owner-ruling blocks in order) unless noted:
1. diagWiring — A+A2: real `diagWiring.ts` with one declared line, stub byte-identical,
   `TELEMETRY_MEASURE` switch, identical telemetry barrel names; A2 author note on skipped
   paged-scene registration (reading confirmed: once per runtime, first skipped scene);
   plan-review ownership gap closed. Also ticket 12 Comments, PLAN decisions.
2. SplatHighlight — A+A1: inert pin-API stub, one author-mode note (trigger confirmed:
   first non-empty marker list). Doc 06 **D27**.
3. SplatBounds — A: typed stub returning the pin's documented `null`. Doc 06 **D30**.
4. SparkScene-only members — 4a/4b/4d deleted, 4c nothing, 4e DoF skipped + author note,
   4f throttle T1 with seam-read guard (capped sites never throttle). Doc 06 **D29** 1 & 4.
5. Multi-scene progress — P1 (slowest of ALL scenes, report on rise, one 1); pin's 1-spam
   and double 1 not reproduced. Doc 06 **D29** 2.
6. S5 noise — no advance ruling; MEASURED 0 contract warnings on the pin's own site.
7. Author picking — P-A: backend neutralizes stock raycast (phantom template-quad hits),
   author note at first `pickPoint`. Doc 06 **D31**; phase-0.md scope correction.
8. Tint — R1+K2: white no-op, non-white author note; boot catch narrowed to font failure.
   Doc 06 **D29** 3.
9. Decode-worker source — B: URL-constructed `src/backend/decode-url.ts`, embed config
   swaps it for inline `decode.ts` ("config-time swap pattern", named); phase-1
   `import.meta` constraint amended (vite-env.d.ts + phase-1 ticket 04).
10. Boot-order race — A: backend awaits `renderer.init()` before device limits, both
    paths; `renderer-init-failed` by name; also closed the silently skipped PLY pre-check.
11. WebGL2 through the element — A: fixture hides `navigator.gpu` before boot;
    deliberately DIFFERENT coverage from `forceWebGL`.
12. Handle naming — N2: `sparkScene: ThreeSplatScene`, `mesh: Object3D`, new `handle`,
    `paged` from format. Doc 06 **D28**; EnvironmentLoader's stale reason corrected in its
    header + phase-1 ticket 08.
13. Barrel — B-A: pin's three embed blocks verbatim; guard re-proven on the real tree.
14. Element event proof — E1 then E3 (live two-sided run = evidence; stored pin record =
    convenience).
15. Obstacle outlines — L-A: three's WebGPU line pair. Doc 06 **D29** 5.
16. H-LIFE at runtime scope — H1 hardened: synchronous post-dispose read, window ASSERTED.
17. H-API consumer fixture — C1: one file, two tsconfigs, two variants.
Plus: WebGL2 budget guard fixed to `gl == null` (unit probe). Doc 06 D27–D31 are NEW.

**SiteRuntime edit inventory:** ticket 09 Comments, "Build — the embed set and the re-typed
SiteRuntime" (19 ruled edits, listed) + "Build — Stops 3, 7, 13" (20th: the lost
`SplatMesh` cast; 21st: the `pickPoint` note) + Stop 15's three-part line-pair swap (D29
item 5, "Build — `examples/site-lab/`"). The whole diff is reproducible without the
writing session's scratch scripts: `git -C ../sparkjs-toolkit show fd67153:src/embed/SiteRuntime.ts | diff - src/embed/SiteRuntime.ts`.

**BUILT AND GREEN (evidence quoted verbatim in ticket 09 Comments):**
- `examples/site-lab/` **11 passed, 0 failed on WebGPU AND on WebGL2** (via the
  `navigator.gpu` route): both latent throws with controls (AC2/AC3); `real-site-ready:
  backend=webgpu … ready in 3010 ms … scenes=1 paged=true visible=true` / WebGL2 `ready in
  2637 ms`; `site-progress-contract: 2 report(s) [0.3388, 1.0000]`; Stop 6 `0 contract
  warning(s)`; navigation `stopchanged {"index":2,"id":"shelf"}`; runtime H-LIFE ×10
  `[1111111111]`, heaps not strictly increasing; AC4 `poster … mounted=false, keepsake (the
  control) mounted=true`; `no-unhandled-rejections: 0`.
- **Stop 16 window:** `measuring window open (renderer not yet disposed)=true; baseline
  storage 0/0B … → loaded storage 10/799571968B … → after dispose storage 0/0B …;
  backend.dispose calls=1 for 1 scene handle(s)=true; canvas attached true → false; mesh
  children 1 → 0`.
- **Stop 15 red → green, both backends:** red (pin's classic pair restored byte-for-byte)
  `"not compatible" errors while rendering=1` (266 of 527 sampled pixels flooded on WebGL2);
  green `material Line2NodeMaterial; "not compatible" errors … =0; removing the outline
  changes 27 of 527 (WebGPU) / 10 of 527 (WebGL2) sampled pixels` at `[74,222,128]`.
- **AC5 two-sided:** pin `loadstart, loadprogress×23, ready, stopchanged`, TWO 1s; ours
  `loadstart, loadprogress×2, ready, stopchanged`, one 1; identical shapes, identical ready
  (minus origin `src`) and stopchanged. Five checks pass on ours WebGPU, ours WebGL2, AND
  the pin itself.
- **AC6:** `shared surface vs THIS toolkit: tsc EXIT=0` · `vs sparkjs pin fd67153: tsc
  EXIT=0` · `scene naming vs THIS toolkit: tsc EXIT=2 … error TS2307: Cannot find module
  '@toolkit/core/SparkScene'` · `scene naming vs sparkjs pin: tsc EXIT=0`.
- **Final-tree labs:** loader-lab **36/36** WebGPU + WebGL2 · splat-lab **28/28** both ·
  pager-lab **26/26** WebGPU default + WebGL2 `?pages=32`. camera-lab digests reproduced
  after the ThreeSplatScene throttle hook (WebGPU `444a093d…e659`, WebGL2 `bc514b23…e764`).
- Library bundle (ticket 13 material): 721,358 → 929,227 B + separate
  `assets/rad-worker-CuUp7t4N.js` 213.20 kB.

**REMAINS, in order:**
1. Re-verify the inventory above. 2. Confirm the size bound with the owner; record it +
today's numbers in ticket 09; update `scripts/check-embed-size.mjs`. 3. `npm run check:full`
to a TRUE exit (redirect to a file, echo the code). 4. Adversarial round, registry-first.
5. Built-in `/code-review` round, reported separately; every finding re-verified with real
commands. 6. Close-out records: tick ticket 09's ACs + `Status: done`; PLAN.md
`#siteruntime-retype` and `#element-events` → `[x]` with `by: claude` (CRLF). 7. Two staged
lists shown to the owner: **(a) `docs/plan/results/phase-0.md` ALONE** (owner-ordered Phase 0
record correction), **(b) everything else**. 8. Two commits, only on the owner's terms for
that session.

## ENVIRONMENT FACTS the finish depends on

- **Pinned sparkjs snapshot:** `.collab-logs/sparkjs-pin/` (gitignored, on **D:**) =
  `git archive fd67153` + a `node_modules` JUNCTION to `D:/Projects/sparkjs-toolkit/node_modules`
  (versions match the pin: spark 2.1.0, three 0.180.0) + harness-only
  `vite.harness.config.ts` + copies of `examples/site-lab/{element.html,element.ts,
  pin-element-events.json,sites/lab.site.json}`. Start it from that dir with
  `node node_modules/vite/bin/vite.js --config vite.harness.config.ts --port 5180 --strictPort`.
  Before ANY recursive delete there, `cmd //c rmdir` the junction first.
- **Cross-drive `/@fs` fails** (measured both ways): a C:-rooted vite server 404s a D: path;
  that is why the snapshot lives on D:, not in the session scratchpad.
- Our dev server: `toolkit-dev` in `.claude/launch.json`, port 5173. Pinned server: 5180.
- `pin-element-events.json` is a CONVENIENCE; the live two-sided run in ticket 09 Comments
  is the evidence of record.
- Instrument artifacts, not defects: the browser pane goes HIDDEN often (0 rAF frames) —
  every new drill pumps frames explicitly; pager-lab's cycles slow while hidden (pixel
  readback waits out its timeout); `performance.getEntriesByType("resource")` caps at 250.
- Vite re-optimizes deps mid-session (`?v=` hash changes): console probes are trustworthy
  only on a freshly loaded page (two copies of three break TSL).
- Patch scripts write RAW BYTES (handoff 008 trap 1); python `b"..."` literals must be
  ASCII — write non-ASCII patches via `str` + `encode()` or the Write tool.
- `.collab-logs/` holds this session's logs: `t09-*` gate/tsc/lint logs, the guard probe
  `t09-webgl-guard-probe.ts`, both embed builds' logs, `t09-embed-with-telemetry.js`.

## PROCESS RULES

- **ZERO commit delegation at session start** — the fresh session gets its terms from the
  owner. The owner commits unless a run explicitly grants scoped delegation (staged list
  first; stop on anything stray). No credit/co-author lines, whatever a harness template says.
- Rule-11 stops: options + evidence + recommendation, never a pick.
- Reviewer: the agent-collaboration v2 registry's lane order governs (`technical_review`,
  astra-review first) — read `registry.json` + `operations.md` fresh; probe the Codex
  balance and list codex processes before dispatch; hash all repo files before/after a
  read-only review; material in `.collab-logs/`.
- sparkjs-toolkit permanently read-only (pin `fd67153` via `git show`/`git archive` only).
- No time estimates. Git explained in plain English. D:\tmp never a scratchpad. Derived
  numbers only.

## WIDER CONTEXT (one line each)

- Ticket 12's inherited notes now include `markSceneFirstSplatReady`, the throttle revisit
  (D29 1) and A2's note-and-skip removal — ticket 12 Comments.
- What remains of Phase 2 after 09: tickets 11 (StatsHUD + SplatBounds, deletes the D30
  stub), 12 (diagnostics §G), 13 (exit evidence) — spec.md ticket map.
- Stub obligations: D27 SplatHighlight → Phase 3 deletes; D30 SplatBounds → ticket 11
  deletes; D19 SplatTextMesh → Phase 4 — doc 06.
- D31: splat meshes answer no Raycaster hits until Phase 3 §B — doc 06; phase-0.md corrected.
- H-API's first measured data point is AC6's failing compile (D24) — ticket 09 Comments.
- Library-bundle growth and the author-UI chunk-split warning are ticket 13 material —
  ticket 09 Comments ("Build — Stops 3, 7, 13").
- `examples/shared` extraction chip still open (site-lab copies the harness again) —
  handoff 007/008.
- Memory worth saving at close (not yet written): browser-pane hidden artifacts + the
  resource-buffer cap; cross-drive `/@fs`; the config-time swap pattern.
- Watch item 13: three pinned 0.185.1; r186 unpublished as last checked — handoff 007.
