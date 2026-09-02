# 05 — RadPager fetch + 4-worker decode pool

**Status:** done
**Blocked by:** 02 — WASM worker; 03 — seam.

**What to build:** the hero `.rad`'s bytes arrive via HTTP Range requests
(prefetch-all-chunks policy carried from the 34s→2.3s result) and are decoded by a
QUEUED pool of four workers — promoted from the spike's single worker with its
one-decode gate. This ticket owns the failure semantics the spike lacks: bounded
retries, then pages marked permanently unavailable WITHOUT wedging reveal.

Standing rules bind (spec.md). Residency, uploads, and progress are ticket 06 —
this slice ends at "decoded chunks exist, on time, or are honestly given up on."

- [x] All splat payload requests are byte ranges — no monolithic fetch; network log
      quoted in Comments.
- [x] Four decode workers demonstrably run concurrently on a real hero load
      (worker-utilization evidence, not inference from timing alone).
- [x] A failed range retries a bounded number of times, then the affected pages are
      marked unavailable; the load completes with the shortfall reported, nothing
      wedged — shown with an injected failure.
- [x] Decode output of the pool is chunk-for-chunk identical to the single-worker
      spike's on the same input (checksums).

## Comments

**Owner rulings taken at ticket start (2026-09-02), six design stops:**
- **S1 pool size = 4**, spec-inherited (doc 03 A3 <- Spark `SplatWorker.ts:100`
  `maxWorkers = 4`, itself underived), parameterized on the DecodePool
  constructor. Utilization/throughput recorded in this ticket's evidence so a
  future default change is a one-line ruling with data, not a redesign.
- **S2 retry = 3 attempts total, immediate, no delay.** Count anchors to the
  most widely deployed published default — verified from the npm artifact
  `@smithy/core` 3.33.3 (`DEFAULT_MAX_ATTEMPTS = 3`,
  `TRANSIENT_ERROR_STATUS_CODES = [500, 502, 503, 504]`), not from memory.
  Zero delay is derived from THIS system's constraint: any backoff timer
  wedges hidden-tab loads under Chrome's ~1/min intensive timer throttling
  (handoff 006 trap 1); immediate retry has zero invented constants.
- **S3 failure taxonomy.** Retryable: network error, 5xx, byte-count mismatch
  on a 206. WHOLE-LOAD terminal (named `range-unsupported`): a 200 where 206
  was expected — the server ignores Range, every retry would download the
  full 213 MB; header-fetch failure is whole-load too. Per-page terminal, no
  retry: 4xx (404/403/416…) and a crate decode error (same bytes decode the
  same way). Completion: the load RESOLVES, never rejects, with an
  unavailable-chunks report (index, reason, attempts, detail) — even when
  every chunk is unavailable. DEFERRED to tickets 06/08 (reveal policy):
  whether an all-unavailable load counts as failed at the seam.
- **S4 `load("rad")` stays a named refusal this ticket**, reworded to cite
  ticket 06: ready is paint-observed and no mesh/upload exists in this
  slice, so a wired handle could never become ready — a lie in the API. The
  fixture page (`examples/rad-lab/`) is the proof surface. **Correction to
  handoff 006** (its "ticket 05 replaces this refusal with the real paged
  path" line): the refusal is replaced by ticket 06, not 05. The handoff is
  a dated snapshot and stays untouched; this comment is the correction.
- **S5 failure injection = injected `fetch`** on the fetcher (documented
  TEST-ONLY seam, same precedent as `maxStorageBufferBindingSizeOverride`).
  AC1's Range-only proof still comes from the real browser network log.
- **S6 determinism (AC4) = pool-of-4 vs pool-of-1 on the PROMOTED worker
  across all 122 chunks**, plus chunk 0 against decode-lab's pinned golden
  checksums (carried from the spike crate's golden test). A literal
  comparison against the spike's worker cannot match on SH by design —
  ticket 02 changed SH to packed words.
- **SH-degree dispose gap (ticket 04 residual) RE-ASSIGNED to ticket 06**:
  no paged mesh with SH bands loads in this slice (scope line: "decoded
  chunks exist"); the assertion lands where the first SH-carrying mesh is
  uploaded. Recorded in tickets 04 and 06 as well.

**Build (2026-09-02).** New: `src/backend/RadHeader.ts` (promoted header
parser, named refusals; grok-4.6 from the frozen spec, verified line by line),
`src/backend/RadFetcher.ts` (prefetch-all Range requests, 206-or-die,
3-attempt immediate retry, taxonomy per S3, injected-fetch seam per S5),
`src/backend/DecodePool.ts` (four long-lived queued workers via a worker
factory — no new value-import of the worker; per-job records with worker-side
decode timestamps), `src/backend/RadPager.ts` (header → fetch → pool;
resolve-with-shortfall report), `examples/rad-lab/` (fixture; composer-2.5
built main.ts/index.html from the spec, `evidence.ts` by grok; both verified by
artifact diff and by running). Edited: backend barrel exports;
`rad-worker.ts` gains `decodeStart`/`decodeEnd` (epoch ms) so concurrency is
measured INSIDE the workers; ThreeGsBackend's `rad-refused` message cites
ticket 06 (splat-lab's citation check updated to match). Frozen spec + agent
logs: `.collab-logs/t05-*`.

**Fixture evidence (dev server, hidden pane, quoted from the page —
`examples/rad-lab/`, `16 passed, 0 failed`):**
- `all-requests-range: 123 requests, all Range, all 206` (122 chunks + 1
  header probe; the recording fetch wrapper sees every request).
- **Browser network log** (the tool's own capture, hero URL only, one full
  fixture run): **489 requests → 368 × `206 Partial Content`, 121 ×
  `FAILED: net::ERR_ABORTED`, 0 × 200.** The 121 aborts are the
  chunk-200-aborts-load drill (122 chunks minus the one synthetic 200):
  a single 200 kills every other in-flight request.
- `all-chunks-decoded: decoded=122/122, unavailable=0, retries=0`.
- `pool-size-4: poolSize=4, distinct workers=4`; per-worker jobs
  `w0=31, w1=31, w2=30, w3=30`.
- `four-workers-concurrent: worker-side: maxConcurrent=4 sum=3079.0 ms >
  union=2936.1 ms (mean concurrency 1.05; decode busy 24% of the 12010 ms
  fetch-bound phase); main-thread outstanding max=4; throughput=10.2
  chunks/s 17.79 MB/s`. **Reading (the S1 utilization record):** all four
  workers were observed decoding simultaneously (worker-side epoch
  timestamps, not main-thread inference), but MEAN concurrency is ~1 because
  this load is fetch-bound — ~2.9 s of total decode (24 ms/chunk) against
  ~12 s of download from the dev server at ~18 MB/s — and the fixture's own
  per-chunk checksums occupy the main thread that dispatches jobs
  (main-thread dispatch→reply windows sum to 47.7 s, i.e. mostly waiting on
  the main thread, vs 3.1 s of decode). Pool-of-1 total load 12.0 s vs
  pool-of-4 12.1 s — identical, as expected when the network is the
  bottleneck. Decode throughput ceiling at 4 workers on this machine would be
  ~4/0.024 s ≈ 165 chunks/s; a faster source (R2/CDN, or a warm cache) is
  where the pool pays. `queuedMax` 104 (pool 4) / 118 (pool 1).
- `chunk0-matches-golden` (all 9 decode-lab pinned checksums);
  `pool-1-checksums-identical: compared 122 chunks, mismatches=0, workers=1`.
- Injected-failure load (pool 4): `retry-then-success: chunk3 decoded=true,
  retries=5 (want 5)` · `retry-exhausted-unavailable: chunk7
  reason=range-server-error attempts=3` · `rejected-no-retry: chunk11
  reason=range-rejected attempts=1` · `decode-failed-no-retry: chunk13
  reason=decode-failed attempts=1` · `length-mismatch-retried: chunk17
  decoded=true attempts=2 (chunk3 attempts=3, chunk0=1), unavailable=[7, 11,
  13], decoded=119` · `load-resolves-with-shortfall: decoded=119 +
  unavailable=3 = 122`.
- 206-or-die: `header-200-refused: fetchHeader rejected range-unsupported on
  status 200` · `chunk-200-aborts-load: reason=range-unsupported,
  inFlightAtRejection=0, lateDelegated=0` · `bad-magic-refused`.
- Both-backends rule: not applicable — no rendering in this slice (the
  fixture never creates a renderer). Built-page run: not possible for this
  fixture — the hero is served through the dev server's `/@fs` allow-list,
  which `vite preview` does not provide; the gate's `vite build` compiles the
  page (portable `check` unchanged, no asset dependency added).

**Defect caught by the fixture during the build:** the first concurrency
criterion compared aggregate decode time against the decode-PHASE span — a
fetch-bound span that aggregate decode can never exceed (3.1 s vs 12 s), so
the assertion could not pass; replaced by sum-vs-union of busy windows, and
then moved from main-thread windows (which count fixture checksum time and
make "4 outstanding" true by construction) to worker-side timestamps.

**Adversarial review round (gpt5.6-sol, effort=high, read-only;
`.collab-logs/codex-review-t05.md`; every finding re-verified by tracing the
code before acting): 11 findings — 11 CONFIRMED, all fixed same session.**
- F1 HIGH (DecodePool ctor leaks N-1 workers when the factory throws on the
  Nth) → try/catch terminates the created ones and rethrows.
- F2 HIGH (a synchronous `postMessage` throw — e.g. a detached buffer →
  DataCloneError — left the slot occupied forever and the queue behind it
  stuck) → caught; slot freed; job rejects `decode-dispatch-failed`.
- F3 MED (no generation guard on a replaced worker's handlers) → old
  worker's `onmessage`/`onerror` nulled before terminate + replace.
- F4 HIGH (WASM `init()` rejection surfaced as 122 "deterministic"
  `decode-failed` pages and a RESOLVED load) → the worker replies
  `fatal: true` on init failure; the pool maps it to `decode-worker-error`
  (not DecodeFailedError), so the pager REJECTS a pool failure.
- F5 HIGH (a short 206 probe was read as "file is short"; RFC 9110 §14.4
  lets a server send fewer bytes than asked) → remainder loop until
  headerEnd is covered; a zero-byte remainder → `rad-header-short`.
- F6 MED (`maxAttempts: 0`/NaN made every chunk vanish with no callback)
  → validated: `invalid-max-attempts`.
- F7 HIGH (dispose during the header fetch let a pool be created after) →
  pager-owned AbortController covers header + chunks; post-header
  disposed check throws `fetch-aborted`.
- F8 MED (decode-failed `attempts` hard-coded 1) → carries the chunk's
  fetch attempts.
- F9 HIGH (the abort drill was VACUOUS — prefetchAll settles every task
  before rejecting, so "no completion later than rejection" could not go
  red) → now asserts ≥1 AbortError, every other chunk settled as 206 or
  abort (none other/pending), no decode after rejection. Live result:
  `delegated=122 (header probe + 121 chunks): aborted=121, 206=1, other=0`.
  Removing `controller.abort()` would drive aborted to 0 → red.
- F10 MED (Range-only assertion accepted one whole-file Range) → the set
  of Range headers must equal {header probe} ∪ {exact per-chunk range} and
  the count must be chunks+1. Live: `ranges = header probe + 122 exact
  per-chunk ranges (exact)`.
- F11 LOW (32-bit FNV-1a collides; it was the sole determinism proof) →
  SHA-256 per array for pool-4 vs pool-1 (`1098` digests, 0 mismatches);
  FNV-1a kept only for the decode-lab golden pin.
- Reviewer found no defect in: inclusive Range-end math, the chunk-13
  decoder-path drill, cross-context epoch timestamp comparability, the
  lib-barrel/inline-worker boundary.

**Post-fix fixture re-run: `rad-lab: 16 passed, 0 failed`** (quoted):
`all-requests-range: 123 requests, all Range, all 206; ranges = header probe
+ 122 exact per-chunk ranges (exact)` ·
`four-workers-concurrent: worker-side: maxConcurrent=4 sum=3067.0 ms >
union=2848.0 ms (mean concurrency 1.08; decode busy 23% of the 12593 ms
fetch-bound phase)` · `pool-1-checksums-identical: compared 122 chunks x 9
arrays: SHA-256 mismatches=0 (of 1098), FNV-1a mismatches=0, workers=1` ·
`chunk-200-aborts-load: reason=range-unsupported; delegated=122 (header
probe + 121 chunks): aborted=121, 206=1, other=0; decoded before
rejection=0, after=0` · retry/unavailable drills unchanged (chunk 3
attempts 3, chunk 7 exhausted, chunk 11 rejected, chunk 13 decode-failed,
chunk 17 attempts 2; decoded 119 + unavailable 3 = 122).

**Built-in /code-review round (high effort, 8 finder angles + verification
pass, after the adversarial round; every finding re-verified against the
source before acting): 10 reported, 9 fixed, 1 recorded for ticket 06.**
- **Crate panic CONFIRMED and fixed (`rad-three/src/lib.rs`)** — the
  chunk-header meta-length arithmetic was still UNCHECKED (`8 +
  roundup8(len)`, `8 + len`), the very wrap ticket 02's pass closed for
  properties: on wasm32 (32-bit usize) a declared meta length 0xFFFFFFFF
  wrapped past the truncation check and built `&bytes[8..7]` — an
  unconditional slice-order panic → trap → poisoned instance. Native tests
  could not see it (64-bit usize does not wrap). Fixed with the property
  loop's checked shape; native test `hostile_meta_length_errors_instead_of_
  panicking` added (Err, never panic); the wasm32 path is drilled in the
  browser through the REAL worker: `hostile-meta-length-refused-not-trapped:
  chunk19 reason=decode-failed … detail="chunk 19: chunk meta length out of
  range" (load resolved — worker not poisoned)`. Crate suite 6 + golden.
- **Unhandled rejections CONFIRMED and fixed** — a whole-load rejection
  from `prefetchAll` disposed the pool before `Promise.all(decodes)` was
  ever attached, so every in-flight job's `pool-disposed` rethrow escaped.
  Now `dispose()` then `await Promise.allSettled(decodes)` in the catch.
  Global tripwire in the fixture: `no-unhandled-rejections: 0
  unhandledrejection events across every load in this fixture`.
- **WASM trap classified as per-chunk CONFIRMED and fixed** — the worker
  now replies `fatal` for `WebAssembly.RuntimeError` (a trap leaves the
  instance undefined); a returned decoder Err stays per-chunk.
- **No fail-fast CONFIRMED and fixed** — DecodePool gains a `broken` state:
  the first worker-level failure (init/trap/uncaught error) terminates all
  workers and rejects everything queued, in-flight, and future with the SAME
  error; RadPager aborts the fetches on that error and surfaces it (not the
  resulting fetch-aborted). The silent worker respawn on `onerror` is GONE
  (a durably broken environment would have looped forever; the owner
  recreates the pool). Drill: `broken-worker-fails-fast: load rejected
  SplatBackendError(decode-worker-error) "worker 0 crashed: Uncaught Error:
  rad-lab: synthetic worker crash" after 60 ms; landed=8, aborted
  fetches=115`.
- Fixed: double-load guard → `SplatBackendError("pager-reused")`;
  `linkAbortSignal`/`isAbortError`/`errorDetail` exported once from
  RadFetcher and shared (RadPager, DecodePool, fixture); dead
  `inFlightAtRejection` (structurally 0 — same shape as F9) and unused
  `CompletionRecord.rangeHeader` removed; FNV-1a computed for chunk 0 only
  (SHA-256 is the determinism proof); the 9 array names listed once
  (`CHECKSUM_KEYS`); ticket `Status:` restored to a canonical label.
- **Recorded for ticket 06, not fixed here:** `DecodePool.jobs` is
  unbounded (122 entries under this ticket's one-load-per-pager; session-
  length under 06's re-decode reuse) — 06 bounds or snapshots it. Same
  note: a `broken` pool must be recreated by its owner (no self-heal).
- Reviewer restatements of the recorded `examples/shared` extraction chip
  (assert harness, fnv1a) acknowledged, not re-fixed here. Serialized
  fixture runs kept deliberate (one network log per run).

**Fixture defect caught while landing the above:** a total-retry pin
(`retries === 5`) went red on the feature WORKING — warm, fast runs hit
genuine transient fetch errors (Chrome under 122 concurrent requests) that
the immediate-retry path recovered; two runs showed 2 and then 1 such
retries. The assertion now pins the INJECTED retries exactly (5) and reports
real transients separately; decode-failed `attempts` pins compare against
the report's recorded fetch attempts (a transient on the inner fetch of the
corruption drill legitimately makes it 2 — still exactly one decode).

**FINAL evidence (post-both-reviews tree, 2026-09-02) — `examples/rad-lab/`:
`rad-lab: 19 passed, 0 failed`** (quoted from the page, dev server, hidden
pane; hero warm in cache on this run):
- AC1 `all-requests-range: 123 requests, all Range, all 206; ranges =
  header probe + 122 exact per-chunk ranges (exact)`; browser network log
  quoted above (368 × 206, 121 × ERR_ABORTED from the 200 drill, 0 × 200).
- AC2 `four-workers-concurrent: worker-side: maxConcurrent=4 sum=3279.9 ms
  > union=992.3 ms (mean concurrency 3.31; decode busy 68% of the 1464 ms
  fetch-bound phase); … workers={w0=31, w1=30, w2=31, w3=30}
  throughput=83.3 chunks/s 145.99 MB/s`. **S1 utilization record, both
  regimes:** cold dev-server source (~18 MB/s, 12 s load) → mean worker
  concurrency ~1.05–1.08, decode busy ~24 %, pool-1 and pool-4 wall times
  identical (network-bound); warm source (~145 MB/s, 1.5 s load) → mean
  concurrency 3.1–3.3, decode busy 62–69 %. Pool-1 on the warm source
  would need ~2.9 s of serialized decode vs ~1.0 s union at pool-4.
- AC3 injected-failure load: `retry-then-success: chunk3 decoded=true
  attempts=3; injected retries=5 (want 5); total retries=5` ·
  `retry-exhausted-unavailable: chunk7 reason=range-server-error
  attempts=3` · `rejected-no-retry: chunk11 reason=range-rejected
  attempts=1` · `decode-failed-no-retry: chunk13 reason=decode-failed
  attempts=1 (… decoded exactly once, never retried on the same bytes)` ·
  `hostile-meta-length-refused-not-trapped: chunk19 …` ·
  `length-mismatch-retried: chunk17 decoded=true attempts=2 …
  unavailable=[7, 11, 13, 19], decoded=118` ·
  `load-resolves-with-shortfall: decoded=118 + unavailable=4 = 122`;
  whole-load refusals: `header-200-refused`, `chunk-200-aborts-load:
  … aborted=121, 206=1, other=0; decoded before rejection=0, after=0`,
  `broken-worker-fails-fast: … decode-worker-error … after 40 ms;
  landed=4, aborted fetches=119`; `no-unhandled-rejections: 0`.
- AC4 `chunk0-matches-golden` (9 pinned FNV-1a) ·
  `pool-1-checksums-identical: compared 122 chunks x 9 arrays: SHA-256
  mismatches=0 (of 1098), workers=1`.
- Gate: `npm run check:full` EXIT=0 (`.collab-logs/gate-t05-run3.log`):
  embed-size OK 216,527 B (bound 262,144; +612 B over the ticket-04 baseline
  from the worker's two timestamps and the fatal flag); 154 modules / 457
  deps cruised, no violations; crate 6 tests + golden (7 with
  `--include-ignored`). Vendored digests byte-identical (0da00b78… /
  e9e90b69… / f65f9222…). splat-lab regression: 28/28 on WebGPU (the
  `rad-refused` citation check updated to "ticket 06") and `28 passed, 0
  failed` on `?webgl=1` (`rad-named-refusal: throws
  SplatBackendError(rad-refused) citing ticket 06`).

**Status change: done — all four ACs met with evidence above (2026-09-02).**
