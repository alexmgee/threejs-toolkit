# 04 — Fork patch 1: dispose() + capacity guard

**Status:** done
**Blocked by:** 03 — seam + monolithic path.

**What to build:** loading and unloading a scene repeatedly leaves no growing
memory, and an over-capacity asset is refused with a named toolkit error instead of
a silent allocation failure. This is the FIRST real fork delta, so it also proves
the D20 patches-authored-in-.ts mechanism end to end.

Standing rules bind (spec.md). Fork governance: every delta is a titled FORK.md
patch entry landing in the same change.

- [x] H-LIFE at this scope: load→dispose→load ×10 on the ticket-03 fixture, JS heap
      returns to baseline each cycle, both backends; numbers in Comments, not
      adjectives.
- [x] An asset exceeding the storage-buffer binding limit produces a named toolkit
      error and a still-usable page (no crash, no blank canvas), both backends.
- [x] H-FORK: with the new features unused, rendered output is pixel-identical to
      the unmodified vendored addon on the fixture set.
- [x] FORK.md gains a titled patch entry in the same change; the patch source is
      authored in .ts (D20) and type-checked by the gate.
- [x] (Folded in from ticket 03's flagged gap, owner-ordered 2026-08-29): a gate
      tripwire pins dist-embed/embed.js size — fail above a stated bound with a
      comment naming the 215,915-byte baseline and why; drilled (planted
      regression fails, restore green).

## Comments

**Owner rulings taken at ticket start (2026-08-29):**
- **D20's concrete shape = PURE .ts SIBLING PATCHES** under
  `src/vendor/three-gs/patches/` — the vendored JS stays byte-identical
  (digests unchanged, H-FORK identity by construction). FORK.md entries must
  inventory every internal field/path a patch reaches; the re-diff procedure
  gains a step (3a) re-verifying those against new upstream. Rejected: JS
  glue edits (digest churn + re-apply cost every re-diff).
- **GPU free path = `renderer._attributes.delete`** — verified this session
  as the ONLY buffer-free mechanism in three 0.185 (Attributes.js:52 →
  backend.destroyAttribute + info.destroyAttribute; invoked upstream only by
  geometry disposal, so storage()-bound buffers leak without it). Condition:
  runtime existence assertions BEFORE any freeing — absent/reshaped internals
  throw `ForkPatchError("fork-internals-missing")`. Loud coupling is a
  documented patch; silent coupling is forbidden.
- **Capacity guard**: WebGPU pre-checks
  `renderer.backend.device.limits.maxStorageBufferBindingSize` before the big
  allocations (count parsed from the PLY header, refusal before conversion).
  WebGL2 exposes NO such limit (verified: nothing in three's WebGL backend) —
  the SAME named error (`over-capacity`) surfaces at allocation-failure time
  via RangeError catch-and-name; no invented threshold. The guard accepts an
  injectable limit override as a documented TEST-ONLY seam (the real WebGPU
  default is 128 MiB ≈ 8.4M splats — untrippable by a real fixture asset);
  the drill proves the refusal on both backends via a low injected limit.
- **H-LIFE pass criterion**: `renderer.info.memory` (live buffer count +
  `storageAttributesSize` bytes) EXACTLY equal to baseline after every one of
  the 10 cycles — deterministic, decremented by the very path dispose uses;
  zero tolerance constants. JS heap recorded per cycle with ONE structural
  assertion: the 10-number series is not strictly increasing across all
  consecutive pairs. Each cycle must first prove the load actually happened
  (counts + a pixel sample) before flatness counts as evidence.

**Embed tripwire landed + drilled (2026-08-29):**
`scripts/check-embed-size.mjs` (built by grok-4.6, verified line-by-line by
Claude) wired into `check` right after `build`; bound 262,144 B with the
215,915-byte baseline and the 1.1 MB regression story in its header; a
MISSING artifact also fails (vacuous-check rule). Drill transcript:
planted regression (embed entry → backend barrel, rebuilt) →
`embed-size: … 1157867 bytes, bound is 262144`, EXIT=1; entry restored +
rebuilt → `embed-size OK: 215915 bytes`, EXIT=0; artifact renamed away →
missing-artifact error, EXIT=1; restored → EXIT=0.

**Build evidence (2026-08-29, `examples/splat-lab/` — suite grew 21→26
assertions; quoted from the page):**

WebGPU (default): `26 passed, 0 failed`. H-LIFE cycles (per-cycle
after-dispose counters, all EXACTLY equal the cycle's pre-load baseline +
metered capture delta): `storage 8/36224B, textures 0/0B` for all 10
cycles; heap series [15039793, 17152017, 16990392, 18512351, 15802238,
16589630, 17910425, 17800104, 20794949, 17258381] — not strictly
increasing. Final dispose returns to TRUE ZERO
(`storageAttributes=0 storageAttributesSize=0 textures=0`).
Over-capacity: `SplatBackendError(over-capacity)` — "asset needs a 768-byte
storage binding; device maxStorageBufferBindingSize is 256 (48 splats, SH
degree 0)"; page still renders after (center [255,0,0,255]).

webgl2-fallback (`?webgl=1`): `26 passed, 0 failed`. Cycles flat at
`storage 0/0B, textures 7/265408B` ×10 (splat data lives in PBO textures on
this backend); heap series [27731280, 27731280, 27508422, 27508422,
33125338, 33125338, 33125338, 17639591, 17639591, 17639591] — not strictly
increasing. Final state = baseline0 + exactly the metered capture-module
leak (2 textures/262144 B — the shared capture module's DOCUMENTED
leak-its-render-target-on-timeout policy, correctly attributed by metering,
not to dispose).

**Defects caught by the fixture DURING this build (each fixed before
review):**
1. **WebGL2 PBO texture leak in the dispose patch** — first cycle run went
   red: +7 textures/+265 kB per cycle. The GLSL node builder backs each
   PBO-read storage attribute with a DataTexture at `attribute.pbo`
   (GLSLNodeBuilder.js:396-404); buffer deletion alone leaks it. Patch now
   disposes `attribute.pbo` via its PUBLIC `.dispose()` first. This is the
   union gate + liveness leg doing exactly what it exists for.
2. **Backend-conditional gate vacuity** — `info.memory` has no `buffers`
   field (undefined===undefined green, trap 1), and on WebGL2 the storage
   counters are 0/0 (splat data is textures there). Gate now compares the
   UNION of 9 counters, requires a loaded-state DIFFERENCE from baseline
   before flatness counts, and throws if any counter is missing.
3. **Capture-module leak mis-attribution** — the shared capture module
   deliberately leaks its offscreen render target when a hidden-pane
   readback times out ("the hang is terminal here"); the gate now METERS
   every capture's own counter delta and folds it into the expected
   baseline. Zero tolerance constants anywhere.
4. **Chrome intensive timer throttling** (hidden page, nested timers →
   ~1 fire/minute) froze the cycle loop for minutes — the cycle machinery
   is now timer-free: MessageChannel macrotask yields (unthrottled),
   synchronous renders as the ready-kick/paint, captureSync for cycle
   samples on the fallback (center probe is aspect-safe live). Also moved
   the background pixel probe off [2, H/2] (a narrow live aspect clamps the
   green cluster onto it — ticket-03 review finding A5 observed live).
5. **captureSync is WebGL2-only** — composer's first liveness helper used
   it unconditionally; on WebGPU it returns an error record. Now branched
   by backend.

**Adversarial review round (gpt5.6-sol, effort=high, read-fenced;
`.collab-logs/t04-codex-review.md`; every finding re-verified before
acting):** 8 findings.
- **F1 BLOCKER CONFIRMED (fixed):** the disposer's assert-before-free claim
  was false — compute nodes were freed before SH-band validation, and
  optional-chaining silently skipped renamed compute nodes. Rewritten
  STRICTLY TWO-PHASE: validate + collect everything (sort compute nodes
  REQUIRED, SH compute node null-allowed at degree 0, present-but-
  undisposable pbo is a reshape), then free validated shapes only.
- **F2 CONFIRMED (fixed):** `BIN_COUNT = 4096` (GaussianSplatMesh.js:47,
  verified) makes the sort's histogram/offset bindings 16,384 B regardless
  of count — the LARGEST binding below ~1k splats; the guard's "sort
  buffers strictly smaller" premise was an undercount. Guard now includes
  `SORT_BIN_COUNT*4` (mirrored constant, FORK.md-inventoried); the drill
  message now names 16384 vs 256.
- **F3 CONFIRMED (fixed):** a patch throw mid-dispose left the mesh
  attached and the handle recognized — scene detach, pending-whenReady
  rejection, and handle invalidation now sit in a `finally` (the GPU
  memory may be unfreeable on a reshape, but the contract surfaces are
  unconditional).
- **F4 CONFIRMED (fixed):** `null` renderer passed the undefined-only check
  → now dispose-needs-renderer; a wrong-shaped `{}` renderer intentionally
  remains fork-internals-missing (that IS the accurate name).
- **F5 CONFIRMED (fixed):** `PLYLoader.parse` allocates file-sized arrays
  outside both RangeError catches → parse now wrapped (RangeError →
  over-capacity, else ply-parse-failed).
- **F6 CONFIRMED (fixed):** blanket capture metering could absorb a real
  lazy splat leak into the whitelisted delta — absorption now happens ONLY
  on the timeout/fallback catch path (where the capture module leaks by
  design); successful and synchronous captures leave their deltas fully
  visible to the gate.
- **F7 PARTIALLY ACCEPTED:** added `mid-load-dispose-named` (pipeline stops,
  whenReady(handle-disposed), zero mesh children; the drill also settled
  the post-dispose contract — grab the whenReady promise BEFORE dispose,
  after it the handle is unknown to every method) and
  `dispose-needs-renderer`. Residuals recorded: reshaped-internals throw is
  type-level+code-review only (no runtime drill can reshape three);
  SH degrees 1–3 dispose paths untested until an SH-carrying asset exists
  (hero .rad in tickets 05+); liveness accepts any one union-counter
  change.
- **F8 REFUTED (with note):** "stale artifact passes the tripwire" — in the
  gate chain `build:embed` (vite build) unconditionally rewrites embed.js
  immediately before the size check, and a MISSING artifact fails loudly;
  the stale-file scenario exists only for a standalone
  `npm run check:embed-size` outside the chain, which is not the gate.
- Reviewer's NEEDS-SOURCE on GaussianSplatUtils.js digest: verified by
  Claude — `f65f9222…` unchanged (all three digests re-hashed post-fix).

Post-fix re-run: **28 passed, 0 failed on BOTH backends** (suite grew
26→28 with the two new drills; over-capacity message now
"16384-byte storage binding … 256"; H-LIFE cycles flat as recorded above).

**Built-in /code-review round (high, 8 finder angles + verification, after
the adversarial round; 11 findings reported, ALL fixed same session):**
- **Dual-buffer GL leak** (CONFIRMED against WebGLAttributeUtils.js:16-41/
  175-179/249): the WebGL2 fallback allocates TWO GL buffers per storage
  attribute; `destroyAttribute` frees only the active one, and info.memory
  decrements either way — a leak the H-LIFE counters structurally cannot
  see. The patch now collects and frees the inactive twins
  (`renderer.backend.get`/`gl` added to the FORK.md inventory).
- **children[0] mesh lookup** (CONFIRMED): handle.object is public; a
  consumer-parented helper would get "disposed" while the real mesh leaks
  forever. HandleState now holds the mesh directly.
- **Abandoned download** (CONFIRMED): mid-load dispose left the fetch
  running to completion. AbortController in HandleState; dispose aborts;
  AbortError lands as the handle-disposed refusal.
- **Pre-init false reshape** (CONFIRMED vs Renderer.js:319/:812):
  `_attributes` is null before renderer.init(); the patch treated that
  lifecycle state as fork-internals-missing. Null now means "nothing
  uploaded, skip deletion"; any other non-map shape stays loud.
- **Unanchored vertex-count regex** (CONFIRMED) → line-anchored parse.
- **Degree>3 NaN vacuity in the guard** (CONFIRMED) → loud
  `unsupported-sh-degree` ForkPatchError.
- **Progress sampler probing a disposed handle** (CONFIRMED) → timer
  cleared before the main dispose.
- **Cleanups** (all CONFIRMED, applied): main load moved onto the same
  timer-free ready-wait as the cycles (the old 250 ms interval kick was
  still throttle-vulnerable; awaitFrame + dead re-init block deleted);
  dispose's finally now calls checkDisposed instead of a hand copy;
  readySignaled derived from progress.phase (split-brain risk for the
  pager tickets); one shared MessageChannel with a resolver queue (per-
  yield port pairs were feeding GC churn into the heap series the leak
  gate reads); no render during the fetching phase of the ready-wait;
  isDominantRed single definition used by every red probe;
  countersDiffer double-negation removed; dev hook handle starts null.
- Conventions finder: **zero violations** (vendored JS byte-frozen
  re-verified, no credit lines, PLAN convention held, scope clean).
- Accepted residuals recorded: left-edge background probe dropped in favor
  of the aspect-safe top-edge probe (documented trade); fixture's
  independent parser TextDecodes the whole 3 KB fixture (template caveat
  noted for any future big-asset reuse); chunks[]+assembly 2× transient
  peak and per-chunk progress allocation deferred to the pager tickets
  (recorded); yieldMacrotask/shared-harness extraction folds into the
  existing ticket-03 extraction chip; embed tripwire checks the artifact
  the gate chain just built (standalone stale-file runs are outside the
  gate's contract).

**FINAL evidence (post-both-reviews tree): 28 passed, 0 failed on WebGPU
AND webgl2-fallback** (dev; quoted above/below); `npm run check:full`
EXIT=0 (embed-size OK 215,915 B in-chain; 148 modules / 434 deps cruised;
6 crate tests incl. golden); vendored digests byte-identical
(0da00b78… / e9e90b69… / f65f9222…).

**Scope note:** the spike fork's `[capacity]` patch
(`spikes/native-rad/src/GaussianSplatMesh.fork.js`) is FIXED-CAPACITY
allocation for the pager — tickets 05/06 material, deliberately NOT promoted
here. This ticket's capacity GUARD (limit refusal) is a different mechanism.

**Status change: done — all five ACs met with evidence above (2026-08-29; H-FORK identity by construction: vendored JS byte-identical + pixel readbacks equal ticket 03's pinned values).**
