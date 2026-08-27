# 02 — WASM decode worker + real library packaging + decoder format gaps

**Status:** done
**Blocked by:** None — can start immediately.

**What to build:** the spike's Rust decoder and its worker load correctly from the
*toolkit's* builds — dev, pages, and the single-file embed build — so every later
ticket can assume "the decoder is importable"; plus the first honest
library-packaging run (the Phase 1 gate typechecked the barrel but never bundled
it); plus the decoder format gaps the spike audit confirmed.

Standing rules bind (spec.md). Promotion is copy-forward from
`spikes/native-rad/` — the spike itself stays untouched and still runs (it is the
H-LOAD baseline). **Rule-11 stop baked in:** D14 (embed WASM inline vs side-load)
is an owner decision — measure both, STOP, present numbers.

- [x] The `rad-three` crate is promoted out of `spikes/` to a repo-owned location
      with a reproducible build command; a fixture page decodes one real chunk in a
      worker and checks pinned checksums of the decoded output. (AC text corrected
      2026-08-27: it previously said "on both backends' pages". The fixture renders
      nothing, so the both-backends rule — spec.md, "wherever rendering is involved"
      — does not apply here; the decode path is backend-INDEPENDENT.)
- [x] Decoder gap (audit): opacity handling resolved against Spark's own `rad.rs` —
      which alpha encodings are sigmoid-coded is determined from the reference and
      implemented single-pass; the resolution quoted in Comments.
- [x] Decoder gap (audit): SH emitted as packed u32 words by the worker, not packed
      in JS afterwards.
- [x] Both vite configs emit a working worker+WASM pairing (settings graduated from
      the spike's config); the embed build's inline-vs-side-load candidates are both
      measured and the ticket STOPS for the owner's D14 ruling with file-size
      numbers in hand.
- [x] A real library build (not the pages build) is produced and imported by a
      throwaway consumer; if `"sideEffects": false` is added,
      `src/core/colorSpace.ts` is exempt and the sRGB fingerprint re-checked
      ([17,17,51], not [1,1,8]).

## Comments

**Progress to the D14 stop (2026-08-23):**

- Crate promoted: `rad-three/` at repo root (copy-forward; spike untouched —
  git shows zero spike modifications and the spike's own `npm run check` is
  EXIT=0). Reproducible builds: `npm run build:wasm` (wasm-pack build
  rad-three --target web --release; wasm-pack 0.14.0, cargo 1.94.1).
- Golden test carried: `decodes_hero_chunk0` runs against chunk 0 of
  lab-sh1-sparsity.rad and now ALSO asserts packed-word parity;
  `cargo test --release` → 2 passed, 0 failed.
- SIGMOID RESOLUTION (AC 2), quoted from the reference: spark-lib decodes
  `.rad` alpha with NO transform — rad.rs:1640-1656 matches encoding
  f32/f16/r8 and calls set_opacity directly; set_opacity stores linear
  (gsplat.rs:99, csplat.rs:101). Exhaustive `grep -ri sigmoid` over
  reference/spark/rust: ZERO hits in source — SEE RECORD CORRECTION
  (2026-08-27) at the end of these Comments: that grep searched for the WORD,
  and Spark's Rust writes its sigmoids as the formula, so this sentence was
  false as a claim about the code. The read-side sigmoid in Spark's PLY
  importer is reference/spark/src/ply.ts:553-555 (the 673 citation was
  corrected the same day by review — it is the write-side inverse).
  CONCLUSION (unchanged, and now resting on format structure): no `.rad` alpha encoding is
  sigmoid-coded; the crate's single linear decode is already exactly-once;
  nothing to implement. NOTE for the owner: doc 03 A1's "Opacity is
  sigmoid-encoded" bullet is inaccurate for `.rad` (not edited — plan-doc
  correction is the owner's call). NOTE for ticket 03: raw 3DGS .ply DOES
  carry logit opacity — the monolithic PLY path needs the sigmoid there.
- SH packed-u32 (AC 3): `take_sh1_packed()` packs in Rust (clamp +
  round-half-to-even, bit-identical to the spike's Uint8ClampedArray path;
  parity unit test with rail/tie cases). Promoted worker
  src/backend/rad-worker.ts transfers `sh1Words: Uint32Array` (count*3);
  no JS packing remains on the decode path.
- Fixture `examples/decode-lab/` (vite input map): Range-fetches chunk 0 of
  the 213 MB golden asset via /@fs (206s asserted), decodes in the promoted
  worker, checksums all 9 arrays. `decode-lab RESULT 4 passed, 0 failed`,
  checksums center=9f411115, sh1Words=50b88b76, decode 43-83 ms. CORRECTED
  2026-08-27: this bullet claimed the run covered "both backends". It did not —
  the page constructs no renderer and reads no query param, so the ?webgl=1 run
  executed the identical code path and is NOT backend coverage. The decode path
  is backend-INDEPENDENT; the numbers above stand unchanged.
- Worker settings graduated to BOTH vite configs (worker.format es,
  build.target esnext); vite.config.ts also gains the /@fs asset allow.
  No embed worker wiring — awaiting D14.
- Lib packaging (AC 5): vite.lib.config.ts + `npm run build:lib` →
  dist-lib/threejs-toolkit.js (637.60 kB / 169.15 kB gzip, three external,
  fork internal). Throwaway node consumer imported it and ran showBlocks →
  endOnTravel → validateAnnotationRules successfully (output quoted in
  session log). "sideEffects": false NOT added, so no colorSpace exemption
  or fingerprint re-check required (recorded).
- Gate: EXIT=0 twice to fixpoint (.collab-logs/gate-t02-run{2,3}.log) after
  one type-only fixture fix (ArrayBufferView).

**D14 MEASUREMENT (2026-08-23; builds + logs in .collab-logs/d14/):**

| Variant | Embed file delta | Extra requests | Separate assets (raw / gzip) |
|---|---|---|---|
| A inline (all-in-one) | +212,906 B raw / +93,995 B gzip | 0 | — |
| B worker side-loaded, wasm inlined in worker | +~200 B | 1 | worker 212,191 / 93,640 |
| C worker + wasm both separate | +~200 B | 2 | worker 5,820 / 1,965 + wasm 152,881 / 71,185 (total 158,701 / 73,150) |

Raw wasm is 152,881 B. Vite fact found while measuring: LIBRARY mode always
inlines assets — a single-file lib embed cannot emit the wasm beside itself,
so variant C requires the worker built as a separate artifact step (a second
build, like the measurement's non-lib config); variant B falls out of lib
mode for free. Streaming compile (WebAssembly.instantiateStreaming) works
only on a real .wasm response (variants B/C at the wasm level: C only).

**STOPPED for owner D14 ruling per the ticket's baked-in stop.**

**D14 RULED (2026-08-23): variant A — everything inline (grounds + table
recorded in doc 06 D14). Wiring + verification:**

- `src/backend/decode.ts`: `?worker&inline` factory (`createDecodeWorker`),
  exported from the backend entry the embed build consumes. Site-build
  fixtures keep constructing the worker by URL — the inline path is
  embed-only.
- `npm run build:embed` → dist-embed/embed.js, ONE file, 212,912 B /
  93.75 kB gzip (matches the variant-A measurement), base64 wasm inside.
  SCOPE CORRECTED 2026-08-27: this artifact is the SCAFFOLD embed (lib entry
  `src/backend/index.ts`; it exports only `createDecodeWorker`) — it proves the
  inline worker+wasm path through a real build, NOT the `<splat-site>` product
  embed, which R2 defers to a later ticket. The file is essentially all inlined
  worker+wasm, which is why its size tracks the worker-only variant-A number.
- Behavior through the bundle: in-browser dynamic import of
  /dist-embed/embed.js → createDecodeWorker → same chunk-0 decode:
  count=65536, center=9f411115, sh1Words=50b88b76 (196,608 words), 42 ms —
  byte-identical to the fixture's checksums.
- Owner's two addenda done: doc 03 A1 corrected (linear alpha, grep evidence
  cited in-place); ticket 03 carries the PLY-sigmoid note in its Comments.
- Gate re-run to fixpoint post-wiring: EXIT=0 twice
  (.collab-logs/gate-t02-run{4,5}.log). .gitignore: dist-lib/ and
  rad-three/pkg/ excluded (generated).

**Adversarial review round (2026-08-23) — Opus + gpt5.6-sol (high) on the
diff; grok still unfunded (402). Findings re-verified before acting:**

- CONFIRMED (both reviewers, independent probe values): sh1_byte was NOT
  bit-identical to JS — Rust computed v*128+128 in f32 while JS widens to
  f64; at f32-tie values (probe 0.019531309604644775: JS 131, f32-chain 130;
  re-verified by direct node probe) the byte flips. FIXED: arithmetic in f64;
  probe value + NaN case added to the parity test; golden test extended to
  cover word 1 (coeffs 4-7 were unchecked — a coeff-swap would have passed).
  cargo test 2/2 post-fix. The golden chunk's checksums are UNCHANGED by the
  fix (no coefficient in chunk 0 sits on an f32-tie boundary) — verified by
  re-run.
- CONFIRMED (both): clean-clone break — pkg/ is gitignored but statically
  imported; check/build had no wasm prerequisite. FIXED: `npm run check` now
  chains build:wasm first (gate re-run green with the chain).
- CONFIRMED (both): fixture checksums were printed but compared only by eye;
  the format assertion was unfalsifiable. FIXED: expected center/sh1Words
  pinned in the fixture (assertion proved falsifiable — it failed on a wrong
  placeholder before the true value was pinned). Re-run: 4/4.
- CONFIRMED (Opus): d.free() not exception-safe in the worker — a throwing
  take_* leaked the wasm object. FIXED: try/finally.
- CONFIRMED (both): vite.embed.config.ts comment still said "unwired, D14
  pending" after wiring. FIXED.
- CONFIRMED (gpt5.6): the PLY-sigmoid citations pointed at ply.ts:673 —
  which is the INVERSE (write-side logit for injectRgba) despite its
  comment; the true read-side sigmoid is ply.ts:553-555. Verified by reading
  both sites. FIXED in doc 03 A1 and ticket 03's note (which now also warns
  the 673 form turns opacity 2 into NaN). Also FIXED doc 03 wording: "no
  transform" → "no NONLINEAR transform" (r8 gets affine min/max dequant).
- CONFIRMED (Opus, latent): blanket-re-exporting src/backend from the lib
  barrel would drag ~200 kB inline base64 into dist-lib. GUARD comment added
  at the export site for ticket 03. Dead worker config removed from
  vite.lib.config.ts.
- SKIPPED with reason: Content-Range header validation in the fixture — the
  pinned golden checksums now catch any wrong-body case; a header check adds
  no detection power here.
- ACCEPTED with reason (recorded, no change): the built decode-lab page is
  dev-only (its /@fs asset URL and the machine-local fs.allow path are the
  established spike pattern; the fixture is a dev instrument), and every
  site build now emits the 5.8 kB worker + 152.9 kB wasm as assets — the
  cost of having the decoder in the pages build at all.

Post-fix verification: fixture 4/4 with pinned checksums;
embed rebuilt (213,393 B single file — grew ~500 B with the try/finally) and
the through-embed decode re-verified earlier checksums; gate EXIT=0 with the
chained wasm build (.collab-logs/gate-t02-run6.log).

**Built-in /code-review (medium, 2026-08-23) — 8 angles via 4 finders,
reported separately:**

- FIXED: clean-clone wasm prerequisite was only in `check` — chained into
  `build` and `dev` too; then `check` reordered to `build && typecheck &&
  lint:boundaries` so wasm-pack runs ONCE per gate (efficiency finding).
- FIXED: golden-checksum gate widened from 2 to ALL 9 output arrays
  (pinned; fixture re-run 4/4 on both pages, "all 9 arrays match").
- FIXED: the inline-worker guard graduated from a comment to a
  dependency-cruiser reachability rule
  (`lib-barrel-must-not-reach-inline-worker`); violation drill fired
  (1 error) and re-ran green after restore.
- FIXED: dead `take_sh1` trimmed from the promoted crate (spike keeps its
  own); cargo tests 2/2 post-trim.
- SKIPPED with reason: fixture assert-harness duplication (2nd copy) and the
  tripled @toolkit alias — recorded cleanup candidates; extraction touches
  committed ticket-01 code / is more machinery than the cost.
- Clean angles: removed-behavior (all deletions are stale-comment or doc
  corrections), cross-file (zero old-field consumers of sh1; embed chain
  consistent), conventions (scope traced; no credit lines; sparkjs
  untouched — citations re-verified against the reference source).

Final verification: fixture 4/4 with all-9 pinned checksums; gate
EXIT=0 (.collab-logs/gate-t02-run10.log; fixpoint runs 8/9 before it).

**Status change: done — all five ACs met; D14 ruled and wired (variant A).**

---

## DEFECT-FIX PASS (2026-08-27) — external gpt5.6-sol audit

Ticket 02 stays **done**; this is a defect-fix pass with its own evidence, not a
reopen. An independent gpt5.6-sol audit (dispatched outside the session,
read-only, high effort) raised 5 fix-items, 3 verify-then-judge items, and a
record correction. Every item was re-verified with real commands by a Claude
agent AND a scoped gpt5.6-sol medium consult before action (logs:
.collab-logs/verify-claim*.md). Two claims were REFUTED.

### REFUTED — no change made

- **Claim 1 (color_from rounding).** The audit called `.round()` in `color_from`
  "the SAME bug as sh1_byte, unfixed" and prescribed f64 + `round_ties_even`.
  Refuted by both reviewers independently: the sh1 fix existed because JS packs
  the SAME floats through a `Uint8ClampedArray` (fork.js:264 + :278), creating a
  bit-identity contract. **No JS produces color bytes** — every JS site only
  consumes them as `color[i]/255` (fork.js:239, vendor GaussianSplatMesh.js:385);
  the one JS clamped-array color writer (GaussianSplatUtils.js:293) is the PLY
  loader path, a different format. The reference implementation uses the CURRENT
  rule everywhere (`antisplat.rs:218`, `ksplat.rs:553`, `csplat.rs:22`,
  `rad.rs:1062/1125`), all in f32. So the prescription would move the crate AWAY
  from the reference on both axes. Measured on the real asset — all 122 chunks'
  rgb ladders (31,232 levels) and every representable f16 alpha in [0,1]: the
  change is a **byte-for-byte no-op on all 7,935,358 splats**, while diverging
  from the reference elsewhere in the input space (e.g. x=0.50392157 gives 128
  where the reference gives 129). A comment now records why `.round()` is
  deliberate, so the audit does not recur. **Third-packer search closed**: the
  crate has exactly three float-to-integer conversions, all accounted for.
- **"The ticket said 'lib'; the script is build:lib".** No inconsistency exists —
  every citation in the ticket and spec.md already says `build:lib`, matching
  package.json. Nothing renamed.

### CONFIRMED AND FIXED

- **Claim 6 (severity raised by verification).** `decode_r8`, `decode_s8` and
  `decode_r8_delta` indexed `data[..]` with NO length guard while all seven
  sibling decoders check. The chunk-level check validates the COMPRESSED extent;
  inflation happens after and its length was never examined — so a short
  INFLATED payload indexed out of bounds. On wasm32 `panic=abort`, so the trap
  ran no destructors: each attempt permanently leaked the already-allocated
  `vec![0.0f32; dims*count]`. **Measured: a 200-byte hostile chunk cost 0.75 MB
  of wasm heap, ~3,900x amplification, monotonic — 200 attempts grew linear
  memory 1.06 MB to 151.50 MB, and wasm memory never shrinks.** Not
  hypothetical: two of the eight properties in the production hero asset (rgb
  `r8_delta`, sh1 `s8`) route through the unguarded decoders, both
  gz-compressed. FIXED: guards added, return types `Result`, `?` at the three
  call sites; a permanent `short_payloads_error_instead_of_panicking` test pins
  both the short case and the exact one-byte boundary for all three.
- **Claim 2.** `decodes_hero_chunk0` returned early — and therefore PASSED —
  when the hero asset was absent; libtest swallows the `eprintln`, so the
  summary read "2 passed" identically on a machine with and without the asset
  (proved by running the crate from a scratch copy with the path repointed:
  byte-identical summary lines, only wall time differed). Aggravator found while
  verifying: **`cargo test` was not in the gate at all**, so nothing ever re-ran
  it. FIXED: `#[ignore]` + hard-fail body + `RAD_HERO_ASSET` override, so an
  absent asset now prints "1 ignored" instead of "ok"; and `test:crate` is
  chained into `npm run check` with `--include-ignored`, where a missing asset
  is a hard failure. Honest scope: `#[ignore]` does not manufacture coverage off
  this machine — it stops absence from reading as green.
- **Claim 3.** The "4/4 on BOTH backends" evidence was vacuous: decode-lab
  constructs no renderer and reads no query param, so the `?webgl=1` run
  executed the identical code path. Corrected in AC 1, in the evidence bullets,
  and in PLAN.md; the fixture is NOT wrapped in a renderer (that would inflate
  it to make the claim true). Numbers unchanged — only the backend-coverage
  claim is withdrawn. The decode path is backend-INDEPENDENT.
- **Claim 4.** The `lib-barrel-must-not-reach-inline-worker` rule guards a
  FILENAME, not the mechanism: dependency-cruiser strips the `?worker&inline`
  query, and 16.10.4 matches resolved paths only. FIXED by ADDING a companion
  rule `rad-worker-value-import-only-from-decode` (the original is left in
  place — retargeting it false-positives on a legitimate type-only re-export).
  Three drills run: clean tree GREEN (416 deps); a `sneaky-inline.ts` importing
  the inline worker from a different module FIRES the new rule (the old rule was
  blind to it); a legitimate `export type { DecodeResult }` re-export stays
  GREEN. Honest scope in the rule's own comment: it does not catch an inline
  import of a DUPLICATED worker source file.
- **Claim 5.** Only `check`/`build`/`dev` had the wasm prerequisite; direct
  `typecheck`, `build:site`, `build:embed` still failed or used stale artifacts
  on a clean clone. FIXED with npm pre-hooks (`pretypecheck`, `prebuild:site`,
  `prebuild:embed`); `build` drops its now-redundant explicit step. `build:lib`
  needs no hook (its graph excludes the backend) and `dev` keeps its explicit
  chain (vite dev is not an npm script). Residual gaps, recorded not hidden:
  `npm --ignore-scripts` bypasses hooks, and invoking `tsc`/`vite` directly
  still needs `npm run build:wasm` first.
- **Claim 7.** `worker.terminate()` ran only on the success path, leaking the
  worker and its wasm instance on a rejected decode. FIXED with try/finally —
  the same shape the previous round applied one level down to `d.free()`, and
  the pattern ticket 05 will copy for four pooled workers. Severity honestly
  LOW on its own (dev-only page, one worker, cleared by reload); fixed for
  precedent.
- **Claim 8.** D14's record described "the embed bundle" without saying the
  artifact built today is the ticket-01 SCAFFOLD (lib entry
  `src/backend/index.ts`, exporting only `createDecodeWorker`), not the
  `<splat-site>` product embed. The RULING is unaffected — the wasm is a fixed
  size independent of what else the bundle carries (152,881 B when D14 was
  measured; 154,880 B after this pass added the guards), so the real entry moves
  the embed's TOTAL, not the A-vs-B-vs-C difference the ruling turns on. Scope
  notes added to doc 06's D14 entry and to the build:embed bullet above.

### RECORD CORRECTION — the sigmoid grep claim, not the conclusion

"Exhaustive grep ... ZERO hits; the only sigmoid in Spark is the PLY importer"
was **false about the code**. The grep matched the WORD; Spark's Rust writes its
sigmoids as the formula. Searching the FORM `1.0 / (1.0 + (-x).exp())` across
`reference/spark/rust` finds exactly two, both outside `.rad`:
`spark-lib/src/ply.rs:116` (raw-3DGS PLY opacity — the property named `opacity`,
`:858`; the Rust twin of ply.ts:553-555) and `spark-lib/src/sogs.rs:436` (SOGS
**v1** sh0 alpha; `decode_sh0_v2` is linear `byte/255`). One inverse:
`ply.rs:1244`. None is in `rad.rs` (its only `.exp()`, `:1220`, is the ln-scale
decode). **The CONCLUSION is unchanged and now rests on structure, not a word
search**: `enum RadAlphaEncoding` = Auto|F32|F16|R8, no sigmoid variant
(`rad.rs:56-62`); `resolve_alpha_encoding` picks F16 vs R8 only by
`max_alpha > 1.0` (`:347-364`); the R8 encoder quantizes [0.0, max_alpha]
(`:638`), which an unbounded, routinely-negative logit range could not satisfy;
the Alpha decode arm (`:1640-1656`) does f32/f16/affine-r8 straight into
`set_opacity`, which stores verbatim (gsplat.rs:99, csplat.rs:101). `.rad` alpha
is linear — NO CODE CHANGE. Corrected in doc 03 A1 and in the SIGMOID RESOLUTION
bullet above; ticket 03's PLY note gains the Rust citation; a SOGS
version-branch caveat is recorded in doc 03 A1 for whoever writes that loader.

Also corrected: the earlier "`cargo test --release` gives 2 passed, 0 failed"
citation was ambiguous between a real run and a silent skip. It was a real run
on this machine — but the pass count could not prove it. Replaced by output only
a real decode can produce (below).

### VERIFICATION OF THIS PASS

- `npm run check` EXIT=0 (.collab-logs/gate-t02fix-run2.log). The gate now runs
  `test:crate` — the crate's asset-free tests execute in the gate for the first
  time: `3 passed; 0 failed; 1 ignored`, the "1 ignored" being the golden test
  making its skip VISIBLE (it previously read "ok").
- Golden test, reproducible by `npm run test:crate:golden` verbatim:
  `running 1 test` … `center bounds: [-477.01797, -316.6046, -207.84116] ..
  [23.988297, 42.33009, 76.70622]`, `interior nodes in chunk0: 27317`,
  `test tests::decodes_hero_chunk0 ... ok`, `1 passed; 0 failed; 3 filtered
  out`. Those two lines can only come from a run that actually decoded — which
  a bare pass count could not establish. (The script carries `--nocapture`
  precisely because libtest swallows that output on a passing test.)
- Fixture: `decode-lab RESULT 4 passed, 0 failed`, all 9 pinned checksums
  unchanged (center=9f411115, sh1Words=50b88b76) — the guards and the checked
  extents altered no decode output.
- Boundary drills: clean GREEN (416 deps) / evasion FIRES / type-only
  re-export GREEN.
- npm pre-hook chain verified EMPIRICALLY rather than by reasoning (it was the
  prime suspect): `npm run build` emits `prebuild:site → build:wasm → build:site`
  and `prebuild:embed → build:wasm → build:embed`, so hooks DO fire through the
  nested `npm run` and dropping the explicit step did not reopen the
  clean-clone hole. Cost: wasm-pack runs ~3 warm times per `check` (~1 s each).
- Embed rebuilt after ALL fixes: 215,459 B single file (wasm 154,880 B). The
  earlier 213,211 B figure in this pass was a mid-pass snapshot the later fixes
  invalidated — caught by adversarial review, which is why this line is dated to
  the final build rather than the first.

### CONTAINER-EXTENT DEFECT — my framing was wrong; now FIXED

Verification surfaced a defect NOT in the audit, and I first recorded it as
"`prop.offset`/`prop.bytes`/`meta.count as usize` truncate on wasm32, so an
out-of-range offset silently ALIASES instead of erroring — silent-wrong-data,
deferred to the owner". **The adversarial pass proved that framing WRONG and the
defect worse than recorded: it PANICS.** A `prop.bytes` near u64::MAX makes
`roundup8(bytes)` wrap to 0 (defeating the extent check outright) and makes
`end = start + bytes` wrap BELOW `start`, so `&bytes[start..end]` panics —
reproduced on the 64-bit HOST, not merely wasm, with a ~200-byte chunk declaring
`"bytes":18446744073709551609`. On wasm32 that is the identical
trap-and-permanently-leak mechanism this whole pass exists to close.

Deferring a proven panic of exactly the class under repair was not defensible, so
it is FIXED here rather than left for a later decision: checked `usize::try_from`
for `offset`/`bytes`, `checked_add` for `start`/`end`, and a `roundup8_checked`
that reports overflow instead of wrapping to 0. Pinned by
`hostile_property_extent_errors_instead_of_panicking`.

STILL DEFERRED (genuinely the owner's call, and genuinely only wrong-data):
`meta.count as usize` (~:154) still truncates u64 to u32 on wasm32. It is not
memory-unsafe — every guard now derives its extent from the same truncated
`count` via checked arithmetic, so the decode is self-consistent; a hostile
count just yields a chunk decoded at the wrong length. Whether that should be a
hard error (`usize::try_from`) or stay a truncation is a semantics decision, not
a safety one.

ALSO RECORDED, not fixed (no reachable scenario): `decode_quat_oct88r8` guards
with `required_len(3, 1, count)` and then allocates `vec![0.0f32; 4 * count]`
with unchecked multiplication — the one decoder whose guard and allocation use
different arithmetic. Passing the guard requires `data.len() >= 3*count`, so
wrapping `4*count` on wasm32 would need a >3.2 GB inflated payload; not
constructible. Noted so it is not rediscovered as novel.

### ADVERSARIAL PASS ON THE FIXES (2026-08-27) — gpt5.6-sol HIGH + Opus

The fixes were themselves attacked before commit, by two reviewers in parallel.
Nine findings; every one verified with commands before acting. **Five were
defects in THIS pass's own work** — two in the code it added, three in the
record it wrote. That ratio is the argument for the pass.

**Defects in the new CODE**

- **The new guards were defeatable by integer overflow.** `usize` is 32 bits on
  wasm32, so `dims * count` WRAPS: count 477,218,589 with dims 9 gives
  4,294,967,301 → wraps to **5**, and a 5-byte payload would satisfy
  `data.len() < dims * count` and walk off the end exactly as before. `count` is
  attacker-controlled. The same weakness sat in the FIVE pre-existing guards
  (`4 * dims * count` …), not only the three added here. FIXED at the root: a
  `required_len(unit, dims, count)` helper using `checked_mul`, now used by ALL
  NINE guards; `declared_extent_overflow_is_rejected` pins it platform-
  independently plus the three wrapping decoder calls.
- **A container-extent PANIC, which I had recorded as mere wrong-data** — see the
  section above. Fixed with checked conversion/addition and `roundup8_checked`;
  pinned by `hostile_property_extent_errors_instead_of_panicking`.
- **Guard-test coverage hole:** `decode_r8` was exercised only at `dims=1`, so a
  regression to `required_len(1, 1, count)` left the suite GREEN (demonstrated).
  FIXED: dims=3 exact-fit and one-byte-short cases added. (No live bug —
  production calls `decode_r8` only with dims=1 — but the test's stated job is
  to stop a future edit reopening the hole.)

**Defects in the RECORD this pass wrote**

- **`test:crate` in `check` made the gate depend on the 213 MB sibling asset**,
  contradicting claim 5's whole purpose, and `-- --include-ignored` would
  silently enrol every FUTURE ignored test. RESOLVED: `check` runs `test:crate`
  (asset-free tests only — real new gate coverage that works anywhere); the
  golden run moved to explicit `test:crate:golden`. **Owner decision flagged
  below.**
- **`test:crate:golden` reproduced Claim 2's bug one level up.** Selecting the
  test by NAME filter meant renaming it turned the only golden invocation into
  `running 0 tests` … EXIT=0 — a green no-op, precisely the failure `#[ignore]` +
  hard-fail was added to eliminate (demonstrated by renaming in a scratch copy).
  FIXED: the script no longer filters by name; it runs `--include-ignored
  --nocapture`, so a rename cannot silently skip it.
- **An evidence citation conflated two runs.** The record cited `center bounds` /
  `interior nodes` as output of the gate-form command, but libtest captures
  `eprintln!` on a PASSING test: `gate-t02fix-run1.log` contains neither line
  (grep count 0). A reviewer reproducing the cited command would have seen only
  `... ok` — preserving the exact ambiguity the correction claimed to remove.
  FIXED: the record now cites `npm run test:crate:golden` (which carries
  `--nocapture`) and quotes its real output.
- **Sizes this pass itself invalidated.** The D14 SCOPE note and the ticket
  asserted present-tense that the wasm "is a fixed 152,881 B"; adding the guards
  made it 154,880 B, and the recorded embed size was a mid-pass snapshot. FIXED:
  both now separate the ARGUMENT (the wasm's size is independent of what else
  the bundle carries) from the dated measurements, and the embed figure is the
  final build.

**REFUTED by evidence — my own prime suspicion.** I expected that dropping
`build:wasm` from `build` (relying on `prebuild:site`/`prebuild:embed`) had
reopened the clean-clone hole, since the hooks sit on nested scripts. Checked
empirically rather than reasoned about, by both reviewers independently from
clean copies with no `rad-three/pkg`: `npm run build` emits `prebuild:site →
build:wasm → build:site` then `prebuild:embed → build:wasm → build:embed`,
EXIT=0. The hooks fire; the hole stays closed. `build:lib` confirmed not to need
the hook (its graph excludes the backend); raw `tsc` without `pkg` fails as
documented.

**Attacked and found clean:** guard arithmetic (`dims*count` is the exact
minimum for both index layouts; no decoder left unguarded); test falsifiability
(deleting each guard individually turns the suite RED; reverting `required_len`
to `wrapping_mul` turns the overflow test RED; the ±1 boundaries are correct in
both directions); and the new depcruise rule (a `pool.ts` doing `?worker&inline`
FIRES, non-inline `?worker` FIRES as documented, and ticket-05's likely shape —
`new Worker(new URL(...))` plus `import type` — stays GREEN).

### OWNER DECISION — should the gate require the golden asset?

`npm run check` deliberately does NOT run the golden test, so nothing automated
re-runs it; it is an explicit `npm run test:crate:golden` step. The alternative —
chaining it into `check` — makes the gate hard-fail on any machine lacking
sparkjs-toolkit's 213 MB asset. I took the clean-clone-preserving option because
claim 5 in this same pass exists to keep a clean clone working, and enlarging
what the gate requires is the harder-to-reverse choice. One-line change if you
want the stricter gate: append `&& npm run test:crate:golden` to `check`.
Flagging rather than deciding — what the gate may depend on is a policy call.
