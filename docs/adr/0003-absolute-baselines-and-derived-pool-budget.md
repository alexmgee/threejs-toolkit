# 0003 — Absolute baselines, not Spark comparisons; page-pool budget is derived, not pinned

Date: 2026-08-16
Status: accepted
Supersedes (in part): **ADR 0001**, whose consequences still describe H-LOAD
criterion 1 as "no worse than the Spark control" and state that "Spark control
runs remain in every harness (doc 05)". Both are retired by decision 1 below.
ADR 0001's actual decision — the port is unconditional — stands unchanged, and
per repo convention its text is left intact rather than rewritten.

## Decision

1. **Measurements are absolute baselines for this toolkit.** No harness scores
   this toolkit's performance or selection NUMBERS by comparison against
   sparkjs-toolkit executing. *(Sentence tightened 2026-08-19 per D16: the
   original read "No harness scores this toolkit by comparison…", which
   overreached — visual/behavioral comparison harnesses survive; only number
   comparison is retired.)* Spark's source,
   constants, and historical numbers (e.g. the 2.3 s hero reveal) remain
   *reference material* — planning direction and concept assistance — never
   pass/fail comparators. Owner, 2026-08-16: "it doesn't have to be fair! …
   we are building two entirely separate toolkits and each will need to be
   optimized according to itself, not the other. forget about spark's metrics
   entirely, basically, unless they help provide planning direction, concept
   assistance."
2. **The GPU page-pool budget is runtime-derived**:
   `pages = min(P_limits, P_asset)`, overridable with `?pages=N` for test
   regimes. `P_limits` comes from the *created device's* real limits —
   WebGPU: `floor(min(maxStorageBufferBindingSize, maxBufferSize) / (65,536 × 16 B))`
   (the four vec4 storage buffers are the binding-limited allocations);
   WebGL2 fallback: the largest page count whose PBO textures
   (`pow2ceil(√N)` wide for vec4 attrs, `pow2ceil(√3N)` for SH1 words) fit
   `MAX_TEXTURE_SIZE`. `P_asset = ceil(assetSplats / 65,536)`.
3. **Eviction policy is priority-protection**: the top-`pages` chunks of the
   traversal's priority order are shielded; residents outside that set are
   evictable, oldest-touched first. Deadlock-free by construction: a missing
   chunk ranked inside the top set implies some resident ranks outside it.
4. **Eviction correctness (H-LOAD criteria 7–8) is measured under an explicit
   constrained regime** (`?pages=32`), separately from the derived default.
   Eviction correctness is a property of the machinery; the shipped default is
   not crippled to make the test fire.

## Context

The proposal pinned "a fixed 32-page pool" with no recorded derivation. At the
test pose the traversal wants 34+ chunks, so the pin permanently blurred two
subtrees and made every load metric measure the bottleneck instead of the
system. When asked "why is this the designated amount?" no source answered.

A four-mission research unit (two Opus deep-research agents, a Grok source
extraction, a GPT-5.6 methodology consult) plus a GPT-5.6-xhigh adversarial
review established, with citations (raw logs machine-local in `.collab-logs/`):

- Effective WebGPU cap today: three.js 0.185.1 requests **no** adapter limits
  (`requiredLimits: {}` — three.webgpu.js:83805), so the default 128 MiB
  binding cap applies → **128 pages** max per vec4 buffer. The constructor
  accepts `requiredLimits` — a recorded seam for assets beyond 128 pages
  (this machine's adapter offers ~2 GiB, measured live).
- The hero (122 chunks) fits **fully resident under default limits**:
  122 MiB per vec4 buffer, ~762.5 MiB GPU total at 100 B/splat (WebGPU, SH1).
- WebGL2 fallback stores storage attributes as textures (no SSBO) with
  ~3× memory (buffer + transform-feedback dual + PBO texture) and JS-heap
  retention; a `MAX_TEXTURE_SIZE` 2048 device caps at **21 pages**
  (SH1-limited). The fallback derives its own limit at boot.
- Spark's residency is itself device-classed (256/128/96 pages ≙ MiB budgets;
  the iOS "96-page thrash" is Spark's iOS default meeting a 122-chunk asset);
  its per-frame LOD targets (2.5 M desktop …) are draw-cost-driven, a separate
  axis. Both are concept references for our own tuning.
- Mobile budgets are **deliberately unpinned**: no trustworthy 2025-26
  on-device numbers for granted WebGPU limits on A17/A18-class Safari were
  found; a provisional guess was withdrawn under adversarial review. Phase 2
  measures on real hardware.

## Consequences

- Doc 05's H-LOAD is amended (dated note): criteria 1/3/4/5 become absolute
  recorded baselines; criterion 6 reads "pool stays exactly at its configured
  budget"; criteria 7–8 run in the `?pages=32` regime. Spark-control trials are
  dropped from task 6; the historical 2.3 s figure may be quoted as context.
- Later-phase visual-parity harnesses (H-VISUAL, pixel diffs) were not
  explicitly revoked by the owner directive. **Resolved 2026-08-19 (D16):
  they survive as Spark comparisons; decision 1 above was tightened to match.**
- Named optimization item: `covarianceB.zw` is 8 % dead weight per splat.
- The frame-budget and foveation constants borrowed from Spark stay as
  starting values, to be retuned against our own measurements.
