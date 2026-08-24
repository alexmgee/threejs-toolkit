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
      worker and prints a checksum of the decoded output, on both backends' pages.
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
  reference/spark/rust: ZERO hits; the only sigmoid in Spark is the PLY
  importer (reference/spark/src/ply.ts:673, "Inject opacity sigmoid" on raw
  3DGS logits at import). CONCLUSION: no `.rad` alpha encoding is
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
  worker, checksums all 9 arrays. Both pages: `decode-lab RESULT 4 passed,
  0 failed` on default AND ?webgl=1, identical checksums (center=9f411115,
  sh1Words=50b88b76, decode 43-83 ms).
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
  placeholder before the true value was pinned). Both pages re-run: 4/4.
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

Post-fix verification: fixture 4/4 on BOTH pages with pinned checksums;
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

Final verification: fixture 4/4 BOTH pages with all-9 pinned checksums; gate
EXIT=0 (.collab-logs/gate-t02-run10.log; fixpoint runs 8/9 before it).

**Status change: done — all five ACs met; D14 ruled and wired (variant A).**
