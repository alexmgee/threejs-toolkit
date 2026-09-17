# 08 — Load/reveal/ready contract (§A5) in the rebuilt SplatLoader

**Status:** done
**Blocked by:** 03 — seam; 06 — residency + progress.

**What to build (AMENDED 2026-09-13, owner ruling S0 — see Comments):** the
rebuilt `SplatLoader` over the seam holds the ONE §A5 reveal/progress policy
and reveals a paged scene progressively — proven on a loader-level fixture
page on both backends. Owns PAGED readiness as consumed by the site layer
(ticket 03 owns monolithic first-paint readiness at the seam — one contract,
two paths, no duplicate definitions). The pin-copies of SplatSiteElement,
FragmentRouter and `register`, and the element's event-parity proof, MOVED to
ticket 09, where the real SiteRuntime can start the element.

*Original text (kept for the record):* `<splat-site>` — pin-copied VERBATIM,
together with the other deferred Phase 1 embed copies (FragmentRouter and
`register`; doc 04:23 lists all four, `diagWiring.stub` rides ticket 09) —
reveals a paged scene progressively and fires `whenReady` / `onReady` /
`onLoadProgress` with the same shapes as sparkjs-toolkit, driven by the
rebuilt SplatLoader over the seam.

Standing rules bind (spec.md): copies via `git show fd67153:<path>`; every
adaptation lives behind the seam.

- [ ] ~~SplatSiteElement, FragmentRouter, and register are byte-identical to the pin;
      SHAs in Comments, hashed on the destination tree.~~ **MOVED to ticket 09
      (ruling S0).**
- [ ] ~~The event sequence and payload shapes on a fixture site.json match
      sparkjs-toolkit's on the same file (H-API row), both backends.~~ **MOVED to
      ticket 09 (ruling S0).**
- [x] Reveal fires on the seam's paint-observed ready (first paint after the first
      page with splats) plus first-paint confirmation, never on a residency-derived
      number; reported progress is the true fraction until reveal, then exactly 1
      once, monotone; forcing eviction mid-load does not un-reveal — both backends
      (ruling S1).
- [x] A load with pages marked unavailable (ticket 05 semantics) still reveals and
      reports the shortfall (truthful counts, one console warning) — nothing wedges
      (ruling S2; refined by F4-A 2026-09-17: plus one named warning per chunk given
      up on after the load settled).
- [x] A whole-load failure after first paint reaches the loader's consumer as a
      named failure — the path the element's `loaderror` consumes in ticket 09 —
      never a silent phase flip (ruling S2, backend gap at ThreeGsBackend.ts:742-761).
- [x] `loadSplat` keeps its name and options shape, gains the backend option, returns
      the handle, and applies the conditional 180° X-flip with the pin's
      SplatLoader.ts:81-88 semantics; the return-type change is a doc 06 entry (D25).

## Comments

**Owner rulings taken at ticket start (2026-09-13), three design stops + four
smaller points:**
- **S0 — structure: B, build the contract underneath the runtime.** Evidence:
  the pinned element cannot run without SiteRuntime — it imports
  `createSiteRuntime`/`resolveSiteAssets` from `./SiteRuntime`
  (`fd67153:src/embed/SplatSiteElement.ts:25`) and fires `ready` /
  `loadprogress` only from the runtime's callbacks (`:1006-1017`); at the pin
  SiteRuntime owns readiness and the reveal gate (`SiteRuntime.ts:748-769`
  settleReady/failReady, `:2432-2606` checkSceneVisibility) and imports five
  files that do not exist in this repo (`core/SplatLoader` → 08,
  `core/SparkScene` → D24 rename in 09, `embed/diagWiring` → 09's stub,
  `interact/SplatHighlight` → Phase 3, `core/SplatBounds` → 11). The exact
  copies cannot typecheck alone and AC2 cannot be shown without a runtime.
  So: the rebuilt SplatLoader holds the ONE reveal/progress policy, proven on a
  loader-level page (AC3/AC4); the three pin-copies and AC1/AC2 move to ticket
  09. REJECTED: A (pull the SiteRuntime copy into 08 — 4,494 lines + three stubs
  across ticket boundaries); C (an interim SiteRuntime stand-in — events proven
  against a fake is the vacuous-check trap).
- **S1 — reveal thresholds (deferred here by 06-S5): A, reveal = the seam's
  ready.** Report the true fraction until then, then exactly 1 once, monotone,
  never un-reveal. Grounds: doc 04's own Phase 2 text says the element
  "reveals progressively" — coarse-then-sharpen IS the stated intent; zero
  constants; one meaning of ready on both load paths; cannot hang under
  `?pages=32`, where the fraction tops out at 0.5082 (ticket 06 evidence — a
  fixed threshold above ~0.51 would never fire). The pin's 11-constant gate
  (`SiteRuntime.ts:2460-2476` + the 0.98 cap at `:2529`) is recorded in doc 06
  (D26) as the reference if a future PRODUCT decision wants the coarse moment
  hidden — that revisit needs its own evidence and ruling. REJECTED: B (load
  settled — a second ready moment; waits for all 213 MB under prefetch-all), C
  (traversal's wanted set — the pin's "pristine" in completed-work clothing;
  AC3), D (a tuned constant — no source).
- **S2 — partial shortfall (05-S3 → 06-S6): A.** A partial shortfall reveals
  normally with truthful counts and one console warning. The backend gap is
  fixed in the same stroke: a whole-load failure after first paint must reach
  the element as `loaderror` — `ThreeGsBackend.ts:742-761` currently flips
  phase to `failed` silently, the silent failure the named-refusal design
  forbids. No event-shape change, no doc 06 divergence. (The all-unavailable
  case stays 06-S6: `no-pages-available` fails the handle.) REJECTED: B (a
  degraded signal on the element — a divergence sparkjs has no equivalent of),
  C (shortfall-as-failure — needs an invented cutoff).
- **Smaller points, all approved as recommended:** (1) `loadSplat` keeps its
  name and options shape, gains the backend option, returns the handle; the
  return-type change is recorded in doc 06 per H-API's mechanism (D25). (2)
  The loader applies the conditional 180° flip exactly as the pin does
  (`fd67153:src/core/SplatLoader.ts:81-88` — presence of `eulerRotationDeg`
  arms it; phase-0.md:27 records the same). **Correction to handoff 007** (its
  "SiteConfig's CONDITIONAL eulerRotationDeg behaviour … ticket 09's layer"
  line, and ticket 06's approved assumption of the same): the pin evidence
  places the flip in SplatLoader, which this ticket owns; the backend still
  hands the object over UNROTATED. The handoff is a dated snapshot and stays
  untouched; this comment is the correction. (3) The embed-entry switch to
  `register.ts` moves to ticket 09 with S0 — measure there, then the owner sets
  the new size bound (never raised by an agent). (4) AC2's event-shape
  reference (now ticket 09's) comes from a pinned-file snapshot exported to a
  scratch dir; sparkjs untouched.

**Owner rulings at the second stop (2026-09-16), three more design stops:**
- **S3 — progress/failure notification: A, optional `onProgress` / `onFailure`
  callbacks on the load request** (`SplatSource`), plus `onError` on
  `SplatLoadOptions` for ticket 09's runtime. Evidence: the seam is pull-only —
  `progress()` returns a snapshot refreshed at fixed points
  (ThreeGsBackend.ts:699, :706, :731, :795, `fail()` at :277) and `whenReady`
  settles once, so a post-ready failure had no push path. Grounds: nothing
  polls, so it works in hidden tabs (the throttling trap, already priced); the
  fix sits at the exact site of the silent failure (`fail()`); no new seam
  METHOD — a request type growing is a doc 02 note, not an interface
  amendment. REJECTED: B (per-frame polling — hidden-tab failures would wait
  for tab focus, the throttling trap re-admitted by design, plus a per-frame
  check for the handle's whole life); C (a failure promise on the handle —
  violates the handle-shape ruling of 2026-08-29).
- **S4 — `loadSplatAsync`: A, refuses by name.** Evidence: the pin resolves
  on construction (`mesh.initialized`) and its one src caller, SceneComposer
  (`fd67153:src/core/SceneComposer.ts:102`), adds the mesh AFTER awaiting;
  this seam's ready is paint-observed and needs the object already in a
  rendered scene (SplatBackend.ts `whenReady` doc), so a promise handing over
  the handle only at reveal can never resolve. Its real semantics are settled
  by SceneComposer's own ticket (Phase 3), where an actual caller exists.
  REJECTED: B (resolve on construction — a second ready moment the seam does
  not define); C (a `parent` option — grows the options shape for a caller
  that does not exist yet).
- **S5 — `extSplats` / `lod` / `paged`: C, accepted; one named warning when a
  supplied value contradicts what the format decides** (`.rad` = paged + LOD;
  PLY = monolithic, no LOD; precision fixed). REJECTED: A (silently ignored —
  the silent behavior change the named-refusal philosophy forbids); B (refuse
  contradictions — would break every `.rad` site that omits `paged`, including
  the pin SiteRuntime's own default `paged: def.paged ?? false`
  (`SiteRuntime.ts:2373`), making the STANDARD case a refusal). **Carried to
  ticket 09:** when the real site.json lands, the warning's noise level gets
  one review — a warning that fires on every normal load is a broken warning.
- **Approved consequences of S1/S2:** `onLoad` = reveal on BOTH load paths —
  safe because the pin's SiteRuntime already ignored Spark's `onLoad` for
  paged meshes (`SiteRuntime.ts:2379-2381`, visibility set only
  `if (!entry.paged)`); a pre-reveal fraction of exactly 1 (PLY "constructing")
  is held back so the single 1 lands at reveal — monotone to exactly 1;
  `fileName` picks the format by extension (pin semantics); the backend prints
  the single shortfall warning, as the only layer holding the unavailable list.

**Build (2026-09-16).** Edited: `src/backend/SplatBackend.ts` (`SplatSource`
observers `onProgress`/`onFailure`; `formatFromName` — the one extension
rule, now shared by the backend and the loader), `src/backend/ThreeGsBackend.ts`
(every LoadProgress write routes through `setProgress`, which notifies;
`fail()` notifies failed-phase progress → rejects → `onFailure`; observer
calls isolated with `reportError`; ONE shortfall warning at settle; a pool
broken after settle now fails the handle — review F1), `src/index.ts`
(`loadSplat` + `SplatLoadOptions` back in the barrel; `loadSplatAsync` stays
listed as deferred — D19 precedent: no throwing barrel exports),
`vite.config.ts` (loader-lab input), doc 02 seam note (S3). New:
`src/core/SplatLoader.ts`, `examples/loader-lab/`. Built by Claude
(coordinator, inline — no build dispatch).

**Review routing note:** agent-collaboration v2's `technical_review` lane
lists `astra-review` first and `sol-review` as fallback; handoff 007's
process rules (bound on this session by the owner's start instruction) name
gpt5.6-sol at high, as ticket 07 used. The session followed the handoff —
recorded here for the owner, who may prefer the registry order next time.

**Adversarial review round (gpt-5.6-sol, effort=high, sandbox read-only;
codex-cli 0.153.3, banner-confirmed; access class ordinary_authorized — the
host cannot enforce read isolation, residual broad-read capability recorded;
prompt `.collab-logs/t08-review-prompt.md`, material
`t08-review-material.diff`, output `codex-review-t08.md`, trace
`codex-review-t08-err.log`; all 266 repo files hash-identical before/after;
Codex weekly window 26% used before launch, no paid credits; one pre-existing
codex.exe process observed and left alone): 5 findings, each re-verified by
tracing the source.**
- F1 BLOCKER CONFIRMED (fixed): `admit()`'s rejection handler swallowed a
  BROKEN pool's `decode-worker-error` as `false` after settle
  (ThreeGsBackend.ts:979; RadPager.decodeCached had already dropped the
  bytes) — the scene silently stopped refining, `fail()` never ran.
  Red-first drill `pool-break-after-settle-reaches-onError` (synthetic
  ErrorEvent through the pool's real worker-error handler + eviction of a
  wanted chunk) timed out at 120 s on the unfixed code; green after.
- F2 HIGH CONFIRMED (fixed): `onProgress(1)` and `onLoad` shared one `try`, so
  a throwing progress observer cost the consumer its reveal. Red-first drill
  `onLoad-survives-throwing-progress-observer`: onLoad fired 0 times → 1.
- F3 PARTIALLY CONFIRMED: (a) fixed — the S5 warning ran after
  `backend.load()`, so a load refused on the spot never warned; red-first
  drill `refused-load-still-warns`: 0 warnings → 1. (b) REFUTED — routing a
  synchronous refusal to `onError`: the seam's refusal contract since ticket
  03 is a synchronous throw, and `loadSplat` has no handle to return for a
  refused load, so `onError` would need an invented placeholder handle.
- F4 MED CONFIRMED — NOT FIXED, owner stop: a deferred chunk that first
  decodes AFTER settle and fails joins `unavailable` with no warning (the
  one warning site runs at settle). Fixing it collides with S2's "one
  console warning".
- F5 LOW CONFIRMED (fixed): the fixture's scripted seam did not mirror the
  real `fail()` order; now failed-phase progress → reject → `onFailure`, plus
  a direct-seam drill `seam-observers-failed-phase-then-failure` on the real
  backend.
- Reviewer found none in: pin fidelity, contract/boundary drift, other
  observer plumbing (every progress write routes through `setProgress`).

**Built-in /code-review round (high, single careful diff pass, after the
adversarial round):** 1 finding — the same F4 gap, independently re-found;
no other defect found.
- **Noticed while tracing F1 (coordinator, not fixed — not a whole-load
  failure, outside S2's scope):** in a post-settle admission, the two other
  per-job pool rejections — `decode-dispatch-failed` (DecodePool.ts pump,
  synchronous postMessage throw) and `decode-protocol-error` (reply for the
  wrong chunk) — also resolve `false`, and `RadPager.decodeCached` has already
  deleted the cached bytes (restored only for DecodeFailedError). The chunk is
  then neither cached nor in `unavailable`: never admitted again, never
  reported. Recorded for the owner.

**Owner rulings at the third stop (2026-09-17):**
- **F4 — A.** Keep the load-finish shortfall warning, and print one more NAMED
  warning each time a chunk is found unavailable after the load settled.
  Grounds: the S2 "one warning" ruling covered facts known at finish; a
  post-settle discovery is a new fact and the no-silent-failures rule says
  announce it; the count is bounded by the chunk count by construction (a
  given-up chunk is never retried). REJECTED: B (one warning per load — later
  shortfalls silent in the console), C (one warning at the first discovery —
  later ones silent).
- **Fold-in, same stroke:** the two rarer post-settle per-chunk worker-error
  paths recorded above (`decode-dispatch-failed`, `decode-protocol-error`)
  mark the chunk UNAVAILABLE, so it joins the list and F4-A's warning
  announces it — same silent-loss class, same fix shape, proven red first.
- **Reviewer selection going forward — CORRECTS the routing note above:** the
  agent-collaboration v2 registry's lane order governs (`astra-review` first
  for technical review). Canon wins over handoff snapshots on conflict; a
  handoff names what was true when written, never a standing pin. This
  ticket's adversarial round (gpt-5.6-sol, already run) stands as run.

**Build after the third stop (2026-09-17).** `ThreeGsBackend.markUnavailable`
is now the ONE site a chunk joins the unavailable list (load-path
`onUnavailable` and every admission give-up go through it); after the load
settled it prints a named warning per newly given-up chunk
(`[ThreeGsBackend] "<url>": chunk N (reason, K attempts) became unavailable
after the load settled — <detail>`); `admit()` routes
`decode-dispatch-failed` / `decode-protocol-error` to it; `ChunkUnavailable`'s
reason union gains those two (RadFetcher.ts); the settle warning and the new
one share `describeUnavailable`. **Observed, not changed (outside the
ruling):** during the LOAD itself RadPager treats any non-DecodeFailedError
pool rejection — these two included — as a pool failure and rejects the
whole load (RadPager.ts:237-241), so the same error is whole-load at load
time and per-chunk after settle.
**Owner ruling (2026-09-17): this asymmetry is DESIGNED.** During the load a
dispatch/protocol error is pool infrastructure failing (ticket 05's deliberate fail-fast); after
settle it is one chunk's re-admission in a proven pool — different blast radius, different correct
answer.

**Prove-red record for the third-stop drills.** First attempt corrupted the
last chunk at fetch and relied on it staying deferred; on a cold dev server
(restarted between sessions — cause of the stop unknown) every chunk was
decoded during the load, so the drill's PRECONDITION failed, not the
behaviour. Redesigned to be timing-independent: after settle, selection goes
off (the LOD driver then kicks no admissions, whether or not anything
renders), in-flight admissions drain, the three targets are cached-not-
resident chunks (made by eviction if needed), and a one-shot synthetic
worker fault meets each re-decode (non-fatal error reply with the chunk's own
bytes → decode-failed; synchronous postMessage throw → dispatch-failed;
wrong-chunk reply → protocol-error). The PLY `pre-reveal-one-held` check went
red once in the same session without any code change to what it measures —
it sampled the seam between renders it does not control; it now taps the raw
seam notifications through a pass-through backend. Red run on the unfixed
backend (WebGPU default, targets [121, 120, 118], every fault fired):
`post-settle-decode-failure-warns-by-name` 0 warnings (entry present);
`post-settle-dispatch-failure-marks-unavailable` entry null, bytes gone, 0
warnings; `post-settle-protocol-error-marks-unavailable` entry null, 0
warnings; `post-settle-given-up-chunks-stay-per-chunk` 0 warnings — `27
passed, 4 failed`, the other 27 green. Green after the fix.

**FINAL evidence (post-both-reviews tree + third-stop fixes, 2026-09-17; dev
server; in-app browser pane, `navigator.gpu.requestAdapter()` non-null probed
on a real page; one run at a time):**
- `examples/loader-lab/` **31 passed, 0 failed in all four regimes** —
  WebGPU default (budget 122, device limit bind 128 MiB / buf 256 MiB), WebGPU
  `?pages=32` (override 32), WebGL2 default (MAX_TEXTURE_SIZE 16384), WebGL2
  `?pages=32`. Quoted from the WebGPU `?pages=32` run:
  `reveal-at-seam-ready: onLoad=1 after 462 ms: seam phase=ready,
  first-uploaded pages=1, paged-mesh renders=10 (paint confirmation), load
  settled=false (last chunk held), seam fraction=0.1063; budget 32 pages
  (override (32))` · `eviction-mid-load-does-not-unreveal: load settled at
  eviction=false; evicted 1 chunks: resident pages 1 → 0 (a residency-derived
  signal would have fallen 0.031 → 0.000); after 3 renders: onLoad=1, loader
  events after reveal=0, seam phase=ready, seam fraction 0.1063 → 0.1421` ·
  `shortfall-reported: unavailable=["1:range-rejected","7:range-rejected"]; 1
  warning(s) … settled with 2 of 122 chunks unavailable — chunk 1
  (range-rejected, 1 attempt), chunk 7 (range-rejected, 1 attempt)` ·
  `failure-after-reveal-reaches-onError: log order: onLoad at 2,
  onError(range-unsupported) at 3 … whenReady had resolved=true` ·
  `pool-break-after-settle-reaches-onError: … onError(decode-worker-error) …
  seam phase=failed` · `post-settle-given-up-chunks-stay-per-chunk: onLoad=1
  onError=0 seam phase=ready; contract warnings since settle=3`. WebGPU
  default: `post-settle-decode-failure-warns-by-name: … chunk 121 … 1
  warning(s): ["[ThreeGsBackend] … chunk 121 (decode-failed, 1 attempt) became
  unavailable after t…` (dispatch chunk 120, protocol chunk 119 likewise, each
  exactly one named warning). Every run: `no-unhandled-rejections: 0`.
- Scripted policy drills (all regimes): `reveal-policy-scripted` full log
  `[0.1,0.4,1,load,error:range-unsupported]` as expected;
  `failure-first-never-reveals-scripted`; `onLoad-survives-throwing-progress-
  observer`; `refused-load-still-warns`; `seam-observers-failed-phase-then-
  failure` (real backend: last two `[progress:failed, failure:no-pages-
  available]`).
- Mutation record (2026-09-16, both reverted byte-identically — sha256
  `298e682f…` loader, `a5e5d1b5…` backend at that point): removing the 1.0 hold
  + post-reveal guards turned 5 checks red; suppressing onFailure for
  already-ready handles made the failure-after-reveal drill time out.
- Regression on the final code: `examples/splat-lab/` **28 passed, 0 failed**
  on WebGPU and on WebGL2; `examples/pager-lab/` **26 passed, 0 failed** on
  WebGPU default (H-LIFE ×10 exactly `storage 10/799571968B, textures 0/0B`)
  and on WebGL2 `?pages=32` (budget override 32). rad-lab not re-run: RadPager
  / RadFetcher runtime code is unchanged (RadFetcher gained a type-only union
  member).
- Gate: `npm run check:full` EXIT=0 on the final tree
  (`.collab-logs/gate-t08-run2.log`): embed-size OK 216,527 B (unchanged; bound
  262,144); 161 modules / 491 dependencies cruised, no violations; crate 6
  tests + golden (7 with `--include-ignored`). Vendored digests byte-identical
  (`0da00b78…` / `e9e90b69…` / `f65f9222…`, matching FORK.md).
- Not re-reviewed: the third-stop changes (F4-A warning, the two admission
  reasons, the drill redesign) landed after both review rounds; they are
  covered by the prove-red record above.

**Line-ending correction before commit (2026-09-17):** the staged diff showed whole-file churn in
`RadFetcher.ts` / `ThreeGsBackend.ts` — the coordinator's Python patch scripts had rewritten them
with CRLF on Windows (text-mode write), and `src/** -text` stores bytes exactly (committed files
here are LF). `RadFetcher.ts`, `ThreeGsBackend.ts` and `examples/loader-lab/main.ts` were
normalized to LF in binary mode; each equals its tested version minus exactly its CR bytes
(351 / 1,461 / 929, verified with `cmp`). Gate re-run on the committed bytes: `npm run check:full`
EXIT=0 (`.collab-logs/gate-t08-run3.log`; embed 216,527 B; 161 modules / 491 deps, no violations;
crate 6 + golden 7). Fixtures were not re-run for this CR-only change.

**Targeted adversarial review of the third-stop diff (2026-09-17; owner-ordered after close;
astra-review per the v2 registry lane order — gpt-6-astra, effort high, sandbox read-only,
codex-cli 0.153.3, banner-confirmed; access class ordinary_authorized, residual broad-read
capability recorded; material = the third-stop diff RECONSTRUCTED exactly by reversing the patch
scripts' recorded string pairs on HEAD 06fe819 (`.collab-logs/t08-third-stop-review-material.diff`),
prompt `t08-third-stop-review-prompt.md`, output `astra-review-t08-third-stop.md`, trace
`astra-review-t08-third-stop-err.log` (13 tool calls); 266 repo files hash-identical before/after;
Codex weekly window 39% used at launch, no paid credits, one pre-existing codex.exe left alone):
3 findings, all LOW, all CONFIRMED by source trace, all comment-only, fixed in a follow-up commit.**
- F1 (RadFetcher.ts:44): the reason-union comment said the two per-job rejections occur "after the
  load settled only" — false: `kickAdmissions` runs from the per-render LOD driver
  (ThreeGsBackend.ts:938) before settle too, and `admit()`'s routing has no settle guard. Comment
  now states the real split: by PATH — a re-admission (before or after settle) marks the chunk
  unavailable; the load path's own decodes treat the same errors as whole-load pool failure. This
  also CORRECTS the "whole-load at load time and per-chunk after settle" wording in the observed-
  asymmetry note above (a pre-settle re-admission failure is per-chunk and is folded into the settle
  warning, not announced separately). Behaviour unchanged; question put to the owner.
- F2 (examples/loader-lab/main.ts:113): `yieldUntil`'s comment claimed "no rendering, so the LOD
  driver kicks nothing new" — ThreeSplatScene's own animation loop still renders
  (ThreeSplatScene.ts:193); the drill is protected by `setSelectionEnabled(false)`, which it
  already applies first. Comment corrected.
- F3 (ThreeGsBackend.ts:967): `markUnavailable` had been inserted below `kickAdmissions`'s doc
  comment, attaching it to the wrong method (also noticed by the coordinator while rebuilding the
  diff, left for the reviewer). Comment moved back onto `kickAdmissions`.
- Reviewer found none in: `markUnavailable` dedupe and settle-warning timing, other admission
  rejection paths, the warning bound, fixture validity (Proxy binding, one-shot fault consumption,
  eviction fallback, later-drill state).

**Status change: done — the four ACs that remain in this ticket are met on
both backends in both regimes (evidence above); the original AC1/AC2 moved to
ticket 09 by ruling S0 (2026-09-13).**
