# 02 — WASM decode worker + real library packaging + decoder format gaps

**Status:** ready-for-agent
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

- [ ] The `rad-three` crate is promoted out of `spikes/` to a repo-owned location
      with a reproducible build command; a fixture page decodes one real chunk in a
      worker and prints a checksum of the decoded output, on both backends' pages.
- [ ] Decoder gap (audit): opacity handling resolved against Spark's own `rad.rs` —
      which alpha encodings are sigmoid-coded is determined from the reference and
      implemented single-pass; the resolution quoted in Comments.
- [ ] Decoder gap (audit): SH emitted as packed u32 words by the worker, not packed
      in JS afterwards.
- [ ] Both vite configs emit a working worker+WASM pairing (settings graduated from
      the spike's config); the embed build's inline-vs-side-load candidates are both
      measured and the ticket STOPS for the owner's D14 ruling with file-size
      numbers in hand.
- [ ] A real library build (not the pages build) is produced and imported by a
      throwaway consumer; if `"sideEffects": false` is added,
      `src/core/colorSpace.ts` is exempt and the sRGB fingerprint re-checked
      ([17,17,51], not [1,1,8]).
