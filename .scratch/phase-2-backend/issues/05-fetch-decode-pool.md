# 05 — RadPager fetch + 4-worker decode pool

**Status:** ready-for-agent
**Blocked by:** 02 — WASM worker; 03 — seam.

**What to build:** the hero `.rad`'s bytes arrive via HTTP Range requests
(prefetch-all-chunks policy carried from the 34s→2.3s result) and are decoded by a
QUEUED pool of four workers — promoted from the spike's single worker with its
one-decode gate. This ticket owns the failure semantics the spike lacks: bounded
retries, then pages marked permanently unavailable WITHOUT wedging reveal.

Standing rules bind (spec.md). Residency, uploads, and progress are ticket 06 —
this slice ends at "decoded chunks exist, on time, or are honestly given up on."

- [ ] All splat payload requests are byte ranges — no monolithic fetch; network log
      quoted in Comments.
- [ ] Four decode workers demonstrably run concurrently on a real hero load
      (worker-utilization evidence, not inference from timing alone).
- [ ] A failed range retries a bounded number of times, then the affected pages are
      marked unavailable; the load completes with the shortfall reported, nothing
      wedged — shown with an injected failure.
- [ ] Decode output of the pool is chunk-for-chunk identical to the single-worker
      spike's on the same input (checksums).
