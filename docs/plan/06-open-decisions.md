# 06 — Open decisions

Owner calls only — product judgements no agent can make. Each entry: the question, why
it matters, what scope it moves, the working assumption the plan uses until answered.
Answering these is not homework before Phase 0; only D1–D3 shape the spike itself.

## Decided (recorded)

| # | Decision | Date |
|---|---|---|
| D0.1 | Build a sibling repo `threejs-toolkit`; **never modify sparkjs-toolkit** | 2026-08-14 |
| D0.2 | The goal is a functioning three.js version of the full toolkit — every aspect considered, not a subset | 2026-08-14 |
| D0.3 | No duration estimates anywhere in the plan; countable scope only | 2026-08-14 |
| D0.4 | Document everything before any code action | 2026-08-14 |
| **D1** | **The port is unconditional.** Load should be similarly optimized and as fast as possible, but shipping is NOT conditioned on matching Spark's 2.3 s. Phase 0 becomes a measurement/optimization baseline, not a cancellation gate. See ADR 0001. | 2026-08-15 |
| **D2** | **First-class for every visitor is the goal; best-effort only in lieu.** Decide weighting with data (`navigator.gpu` analytics line ASAP); fallback rows measured in every harness regardless. "I'm not going to give you permission to be lazy in any way." | 2026-08-15 |
| **D3–D4, D6, D9–D10** | **No feature cuts. Full parity everywhere effort can reach it.** Fork carried indefinitely (D3); glow kept (D4); splat text supported (D6); SceneGrade full parity (D9); DoF built regardless of current usage (D10). All follow from D2's no-laziness ruling + D0.2. | 2026-08-15 |

## Resolved by the D2/D3 blanket ruling (2026-08-15) — kept for the record

D3 (fork: carried), D4 (glow: kept), D6 (splat text: supported), D9 (SceneGrade: full
parity), D10 (DoF: built regardless of current usage). No feature cuts anywhere.

**D5 — CropTool live GPU preview** resolves technically, not by preference: rebuild
against the CPU-filter oracle (shared math is ground truth). The pending runtime check
of the original's enum bug only determines whether the *old* preview counts as a
comparison baseline.

**D7/D8 — export precision**: 8-bit SPZ color is format-inherent (reported numerically
in H-ASSET, not decidable away); scale/quat round-trip via preserve-at-decode, with
eigendecomposition only as a measured-necessity fallback.

**D11 — DECIDED (2026-08-15, ADR 0002):** disjoint constraint + composer warning now;
merge-at-load for finalized static compositions Phase 4+; owner expects overlap to be
rare anyway (scenes combined upstream into one splat during prep).

**D12 — DECIDED by ruling:** strict source compatibility — it is what makes the
sibling swap a one-line dependency change (H-API enforces).

**D13 — Quality-knob surface for the new fork?** [Phase 3+]
Spark exposed 18 tunables; upstream exposes one. Which knobs earn re-creation in the
fork (splat scale? falloff? radius cap?) — each is fork surface. *Assumption: none
until a fixture shows a visual need; add by evidence, not nostalgia.*

**D14 — DECIDED (2026-08-23, OWNER RULED at ticket 02's measurement stop):
the embed bundle INLINES the WASM — variant A, everything in one file.**
Grounds: the embed's contract IS single-file self-containment (sparkjs's own
embed config externalizes nothing; Spark ships its wasm as inline base64 for
the same reason); A's costs are trivial at these sizes while C's failure
mode — sidecar files stranded from the embed that needs them — is structural
and lands on every future embedding. The standing side-load assumption is
superseded by these numbers. SCOPE (recorded 2026-08-27, external audit): this ruling governs the eventual
PRODUCT embed (`src/embed/register.ts` → `<splat-site>`), which R2 defers to a
later Phase 2 ticket. The artifact `npm run build:embed` produces TODAY is the
ticket-01 SCAFFOLD: its lib entry is `src/backend/index.ts` (vite.embed.config.ts,
labelled SCAFFOLD ENTRY) and it exports only `createDecodeWorker`. The numbers
below are unaffected — they were measured with dedicated worker-only entries
(.collab-logs/d14/entry-{inline,sideload}.ts), and the wasm is a fixed size
independent of what else the bundle carries (152,881 B as measured here; it
grows only when the CRATE changes — e.g. 154,880 B after the 2026-08-27
decoder-guard pass), so the real entry changes the embed's TOTAL size, not the
A-vs-B-vs-C difference the ruling turns on.

Measurement (ticket 02, real builds, logs in
.collab-logs/d14/; raw wasm 152,881 B):

| Variant | Embed file delta | Extra requests | Separate assets (raw / gzip) |
|---|---|---|---|
| A inline (RULED) | +212,906 B raw / +93,995 B gzip | 0 | — |
| B worker side-loaded, wasm inlined in worker | +~200 B | 1 | worker 212,191 / 93,640 |
| C worker + wasm both separate | +~200 B | 2 | worker 5,820 / 1,965 + wasm 152,881 / 71,185 |

Vite fact that shaped the field: LIBRARY mode always inlines assets, so C
would need the worker as a second build artifact; B falls out of lib mode
free. POST-PARITY REVISIT CANDIDATE: C's independent caching and streaming
compile (instantiateStreaming needs a real .wasm response) become material
only if embed size grows — revisit then, with these numbers as baseline.

**D15 — DECIDED (2026-08-15): alexgee.online switches first.** Owner note: order is
inconsequential to the build plan. Standing task unchanged: one-pass survey of each
consuming site's toolkit-API usage before its switch.

**D16 — DECIDED (2026-08-19): the no-comparison ruling reaches NUMBERS only.**
Visual/behavioral comparison against sparkjs-toolkit executing CONTINUES —
H-GRADE, H-VISUAL, H-PICK, H-EDIT, H-OPTICS stand as written. Performance and
selection NUMBER comparison stays retired (ADR 0003, whose too-wide decision-1
sentence was tightened the same day). H-LOAD's numeric rows remain absolute
baselines; its criterion-4 visual check regains the Spark diff beside the
self-stability check at the Phase 2 re-run (Phase 0's recorded results predate
the ruling and stand as recorded). Related DECIDED items from the 2026-08-16
session: pool budget is runtime-derived (`min(P_limits, P_asset)`, `?pages=N`
override; ADR 0003 §2); eviction is priority-protection (§3); eviction criteria
run in the `?pages=32` regime (§4); mobile budgets deliberately unpinned until
measured on-device (Phase 2).

**D17 — OPEN (2026-08-16): reclaim `covarianceB.zw`** — 8 % of pool bytes are dead
lanes per splat (adversarial-review finding). Candidate: repack SH1 words or
selection flags into them. Pure optimization; touch only with measurements in hand.

**D18 — OPEN (2026-08-19): `src/backend/index.ts` is a PLACEHOLDER the Phase 2
seam work must replace.** It exists only to anchor the vendor-import boundary
rule (commit 89c35a7) before the real SplatBackend seam lands. Its sibling
anchors (`src/vendor/three-gs/index.ts` — replaced by ticket 02 with the real
vendored files, 2026-08-20; `src/core/index.ts` — replaced by ticket 04 with
the real core files, 2026-08-20) are replaced
by Phase 1 tickets; this one alone outlives Phase 1 — whoever builds the Phase 2
seam deletes and replaces it, never leaves it beside the real code.
**CLOSED (2026-08-29, Phase 2 ticket 03):** the placeholder types
(`BackendMeshOptions`, the vendored-mesh type re-export) are deleted; the
barrel now carries the real seam (`SplatBackend` types + `ThreeGsBackend`)
plus the ticket-02 decode export, which lives on per this decision's own
terms. The embed build gets its own decode-only entry
(`src/backend/embed-entry.ts`) so the barrel's new runtime exports never
enter the embed artifact.

**D19 — DECIDED (2026-08-19): `ui/SplatTextMesh` ships in Phase 1 as an
API-preserving typed STUB** inside the text cluster ticket, so
`text/SplatLane.ts` compiles unchanged (doc 01: "SplatLane unchanged *if*
SplatTextMesh keeps its API"). The stub throws on construction with an explicit
"rebuilt in Phase 4 (doc 03 §E)" error. Phase 4's rebuild deletes and replaces
it — same delete-and-replace obligation as D18. Never left beside real code.
**Phase 4 addition (owner ruling S1, Phase 2 ticket 11, 2026-09-18):** the rebuild
also re-adds splat-text FRAMING. SiteRuntime's `sphereFromObject` lost its dead
duck-typed splat branch (D33 item 5), so selection framing of a splat-text block
needs a real handle source for `computeSplatBounds(backend, handle)` when the
rebuilt mesh exists.

**D20 — DECIDED (2026-08-20): fork patches are authored in `.ts` files
alongside the vendored JS.** New patch logic gets full type-checking; the
remaining JS glue lines are covered by FORK.md's titled-patch inventory and
SHA-256 digest baseline, not the type system. `// @ts-check` on the vendored
files is REJECTED: triaging their 120 upstream errors (census in FORK.md
§Type status) is work that dies the day the addon ships in a release.
Takes effect when the first fork patch lands (Phase 2). Closes doc 03 §F's
open question (assigned ticket 01 → ticket 02; ruled at ticket 02 close).

**D21 — DECIDED (2026-08-20): Phase 1 lands on the copy-time vintage;
Phase 2's re-sync input is the diff between ticket 04's SHA-256 inventory
and sparkjs-toolkit commit `59b65cf` (which carries the full drift: ticket
13 + load-optimization, 34 files; `862b9eb` is the golden rebaseline) — not
"current disk".** Ticket 05 unguarded. Original question and evidence: Ticket 04's 32 copies were taken from disk at 03:02:31; the sparkjs
working tree then kept moving (its "ticket 13" feature, 03:15–03:39+:
RuleModel, DisplayChannel, SiteConfig, SiteRuntime, TextSystem, authorui
tabHotspots + hotspotInspector — the last two are ticket 06 COPY scope —
plus src/index.ts; the tree may still be moving). The copies match their
recorded copy-time SHAs exactly; "diff empty vs source" is now
time-dependent. Evidence for the ruling: every ticket-05 import into the
04 cluster resolves at the copy-time vintage (TextSystem's SiteConfig
surface is field-identical across vintages; the drift-added exports are
consumed only by Phase-2-deferred SiteRuntime and the drifted rules files).
(Gated tickets 05/06/08 while open; lifted at ruling.) Detail: ticket 04
Comments.

**D21 AMENDMENT (2026-08-22, ruled at owner delegation after ticket 10
closed): the copy vintage for the UNSTARTED copy tickets (05/06) and the
golden rebaseline RE-PIN to sparkjs commit `7599471` ("Ticket 10: Rules
pane" — sparkjs's ticket 10, not ours).** Since the original ruling sparkjs
gained four commits; three touch no src/ (`862b9eb`, `0ee6610`, `c782891`)
and `7599471` alone does. Verified in-session against the sparkjs history:
public barrel `src/index.ts` byte-identical across `59b65cf..7599471`
(diff empty); no renames; RuleModel.ts gains six vocabulary exports and
removes none; src changes are additions plus small in-place edits (2,308
insertions / 11 deletions overall) to `src/rules/RuleAuthoring.ts` (new),
`src/site/authorui/rulesPane.ts` (new), `RuleModel.ts`,
`hotspotInspector.ts`, `AuthorPanel.ts`, and `tabContext.ts` — the last
four all inside ticket 06's author-ui copy scope. GROUNDS for re-pin over
bin: tickets 05/06 have not started, so no copies exist at the old vintage
to invalidate — re-pinning means ticket 06 copies the inspector (and its
pane siblings) WITH the Rules pane once, instead of copying stale files
now and reconciling them again in Phase 2. CONSEQUENCE: Phase 2's re-sync
input becomes the diff between each ticket's recorded copy-time SHAs and
`7599471`; ticket 04's already-landed copies stay at their recorded
vintage (unchanged — their re-sync diff simply runs against the new pin).
Rule 1 unchanged: sparkjs stays read-only; the pin is by commit hash,
never "current disk".

**D21 SECOND AMENDMENT (2026-08-22, ruled at owner delegation before ticket
05 start): the copy vintage for the UNSTARTED copy tickets (05/06) RE-PINS
again, from `7599471` to sparkjs commit `fd67153` ("Ticket 12 build:
live-markers dry-run page").** Since the first re-pin sparkjs gained two
commits, both dated 2026-08-22, verified in-session against the sparkjs
history: `c050cc5` ("Ticket 11: sequence waypoint capture") touches
`src/rules/RuleAuthoring.ts` and `src/site/authorui/rulesPane.ts` — one new
exported pure function (`withWaypointPose`) plus in-place edits (88
insertions / 5 deletions across both files; the deletions are a comment
rewording, an import list widened to add `formatNumber`, and UI string
tweaks); no renames inside src/; public barrel `src/index.ts` byte-identical
across `7599471..fd67153` (diff empty). `fd67153` touches no src/ at all
(tickets/docs plus a `scratchpad/ → scripts/` move of `lm-check.ts`, outside
every copy scope). GROUNDS, same as the first amendment: 05/06 have not
started, so no copies exist at the old vintage to invalidate — ticket 06
copies rulesPane.ts (its author-ui scope) once at the newer vintage instead
of reconciling again in Phase 2. SCOPE PRECISION: `RuleAuthoring.ts` lives
in `src/rules/` — ticket 04's ALREADY-LANDED cluster, not ticket 06's scope
(sparkjs commit c050cc5's own port note calls it "ticket 06 copy scope";
that is wrong by this repo's ticket files, and it is absent from ticket
04's SHA inventory — it is a new-since-04 file). New-since-04 files inside
landed clusters belong to Phase 2's re-sync, NOT to a silent pull-forward
by any Phase 1 copy ticket. CONSEQUENCE: Phase 2's re-sync input for each
ticket is the diff between its recorded copy-time SHAs and `fd67153`;
ticket 04's landed copies stay at their recorded vintage. Rule 1 unchanged:
sparkjs stays read-only; the pin is by commit hash, never "current disk".

**D21 THIRD NOTE (2026-08-23, OWNER RULED at ticket 06 start):
`src/rules/RuleAuthoring.ts` lands WITH ticket 06, copied byte-identical at
pin `fd67153`.** The second amendment's ban was on SILENT pull-forwards;
this is a declared, ruled one. Grounds: the compile edge — rulesPane.ts and
RuleAuthoring.ts were born coupled in sparkjs `7599471` (the pane
value-imports ~20 of its functions, `withWaypointPose` included), so ticket
06 was never compile-closed at either re-pinned vintage without it; the
ticket cut predates both files (2026-08-19). By graph reality the file is
part of the pane's closure regardless of its directory. SECOND RULED
EXCEPTION (same date): `src/rules/RuleModel.ts` — a LANDED ticket-04 copy —
RE-PINS to `fd67153` inside ticket 06. Grounds: the pane needs RuleModel
exports the old vintage lacks, and the pin is verified a STRICT EXPORT
SUPERSET of the landed copy (existing consts gain `export`; new symbols
`EffectLifetime`/`DEFAULT_LIFETIME`/`KNOWN_UNTIL_ENDINGS`/
`KNOWN_SEQUENCE_TERMINALS`/`KNOWN_EFFECT_KINDS` etc.; NOTHING removed —
zero only-ours exports). The ruling is CONDITIONAL on the landed-consumer
proof: gate green plus the diag selfTest re-run in-browser staying 20/20
(result in ticket 06's Comments). `DisplayChannel.ts` — the only other
rules/ file differing from the pin — DELIBERATELY stays at ticket 04's
vintage: nothing in 06's closure touches it. CONSEQUENCE: Phase 2's
re-sync treats `src/rules/RuleAuthoring.ts` AND `src/rules/RuleModel.ts`
as LANDED at `fd67153` (SHAs in ticket 06's Comments); the rest of ticket
04's src/rules/ cluster stays at its recorded vintage. FINAL INVENTORY
(ticket 06 close, 2026-08-23 — Phase 2's re-sync reads the whole vintage
map from here): files the rulings/category rule landed at `fd67153`:
`src/rules/RuleAuthoring.ts`
(d69e466ffc96101b1c7d5c6a399843a5d232a971a338feb13dca35278b5c3608),
`src/rules/RuleModel.ts`
(83014e7fe0ac0c459eb1da23e8e9f71b1013df82b0cf52381763c9806c529b43),
`src/site/SiteConfig.ts`
(f34e134cadde264470892924a6c81f06543b7dfa3f76480bcc9f8aa10f0f1f0b) —
RuleModel and SiteConfig each verified a strict export superset of the
replaced copy before the swap (RuleAuthoring is a NEW file — it replaced
nothing, so no superset claim applies to it); consumer proof recorded in
ticket 06's Comments. HONEST BASIS
CORRECTION (adversarial review, 2026-08-23): the superset test covers the
symbol table only — the swaps ALSO carry semantic changes inside existing
symbols, and the recorded consumer proof could not exercise them because
NO LANDED RUNTIME CONSUMER EXISTS (verified: `normalizeSiteConfig` has
zero callers outside its own file; every landed importer of SiteConfig is
type-only; DisplayChannel has zero importers). That absence — not the
fixture runs — is what guarantees no regression today. Semantic changes
Phase 2/3 INHERITS with these files: (a) pin `normalizeSiteConfig` stops
minting annotation-copy seeded blocks, drops the old recognizers, and
THROWS on an authored `annotation-<id>-copy` block id; (b) pin RuleModel
adds a validation throw on duplicate show-blocks effects; (c) the
RuleModel-new / DisplayChannel-old vintage split means an authored
`lifetime` on show-blocks VALIDATES but is silently ignored at runtime
until DisplayChannel re-syncs — the pin's DisplayChannel is the file that
implements it. Phase 2's re-sync must close (c) first. LANDED FILES
DELIBERATELY AT THE OLD VINTAGE: `src/rules/DisplayChannel.ts` (the only
other landed rules/site file whose bytes differ from `fd67153`; nothing
in 06's closure touches it). The remaining seven ticket-04 rules/ files
and three site/ files are byte-identical to `fd67153` already (verified
by diff), so their recorded vintages and the pin coincide. Every other
cluster stays per its own ticket's recorded SHAs.

**D21 FOURTH NOTE (2026-08-23, Phase 2 ticket 01 close): the DisplayChannel
vintage split — item (c) above — is CLOSED.** `src/rules/DisplayChannel.ts`
re-synced byte-identical to `fd67153`
(89c4a9c418a6ddb3f0de412ec7ef21ba5b65e3245665b4f250879d3c96f91716); the four
trimmed barrel names (endOnTravel, dismissAll, endStaleWhile,
endOrphanedClaims) restored to src/index.ts; authored `lifetime` proven to
end a display at runtime (before/after fixture captures in
.scratch/phase-2-backend/issues/01-displaychannel-resync.md Comments). The
final inventory's "LANDED FILES DELIBERATELY AT THE OLD VINTAGE" set is now
EMPTY — every landed rules/site file is at the pin. Semantic inheritances (a)
and (b) remain pending their first runtime consumer (Phase 2 ticket 09).

**D22 — RULED AND DONE (typing half 2026-08-20 → ticket 03; dead-fields half
2026-09-17 → Phase 2 ticket 10). The renderer TYPING half was assigned
to ticket 03 and is DONE** (one-line widen to `WebGLRenderer |
WebGPURenderer`, type-only import, declared adaptation). **The dead-fields /
~10-construction-literals half was OPEN and unassigned until 2026-09-17:** doc 01:92
requires "2 dead fields, ~10 construction literals" for CameraSystem, and
no ticket in the cut owns those edits (grep-verified across all 11; ticket
04's AC scoped its adaptation to picking only). The typing obstacle is
RESOLVED — the field now takes WebGPURenderer. (Assigned 2026-09-17 — below.)
Detail: ticket 04 Comments (registration) + ticket 03 Comments (the widen).
**Second half ASSIGNED to Phase 2 ticket 10 and RULED (owner, 2026-09-17):**
the "2 dead fields" are `CameraSystemConfig.renderer` and `.sparkRenderer`
(both unused at the pin and here); the "~10 construction literals" are the
10 `new CameraSystem({…})` call sites at the pin (sparkjs
`docs/research/threejs-port-findings.html:949`), 3 of which exist here. Both
fields STAY, `@deprecated` and ignored, `renderer` made optional — H-API
compile-unchanged, because all 10 pin call sites pass `renderer` (the
opposite of D24's zero-caller evidence); no divergence entry. **Phase 3 item
(recorded so it is not re-discovered as a surprise):** `CameraSystem`'s
private `scene` field is assigned but never read HERE — it fed the pin's
splat raycast, which Phase 1 stubbed (doc 03 §B); whether it lives or goes is
decided with `backend.raycast()`. **DONE (ticket 10):** both fields deprecated in
`src/core/CameraSystem.ts`; `examples/camera-lab/` proves orbit/recenter unchanged
(pre-edit baseline = post-edit capture, numbers and pixels, both backends). Detail:
ticket 10 Comments.

**D23 — RULED AND DONE (surfaced 2026-08-20; owner ruling 2026-08-23 at Phase 2
ticketing, `.scratch/phase-2-backend/spec.md` "D23 reconciliation"; executed
2026-08-29 by Phase 2 ticket 03): boundary-rule gaps surfaced by ticket 04's
review, owner call on whether/where to guard:** (a) examples/ may legally
import src/backend and thus the re-exported fork-mesh TYPE (the seam's
public door — tightening is a design choice); (b) src -> examples is
cruised but unguarded (fixture code could become load-bearing); (c) vendor
-> src is unguarded (a fork patch could reach into toolkit code, corrupting
re-diff purity); (d) spikes/ is outside the cruise set entirely (spike ->
vendor internals invisible). Detail: ticket 04 Comments. **Ruling:** (a) stays
OPEN BY DESIGN — the seam's public door, where fixtures exercise the backend
exactly as consumers will (Phase 2 ticket 11's `backend-doors-only` rule exempts
examples/ on this ground); (b) and (d) stay ACCEPTED-UNGUARDED, with reasons; (c)
is GUARDED by `vendor-must-not-reach-src`, drilled both ways. Detail and drills:
Phase 2 ticket 03 Comments.

**D24 — DECIDED (2026-08-23, OWNER RULED at ticket 11's stop): the barrel
exports `ThreeSplatScene` under its OWN name — no `SparkScene` alias.**
This is the H-API-sanctioned divergence entry (doc 05: "divergences allowed
only via doc 06 entries"). Grounds, from the evidence brief: (1) ZERO
sparkjs consumers import `SparkScene` from the barrel — all 16 use the
module path `core/SparkScene`, which Phase 2/3 re-types when copying
regardless, so the barrel name reaches external consumers only; (2) an
alias would misrepresent to those consumers 14 SparkScene-only config keys
(pagedExtSplats, LOD/foveation knobs, …), 4 members (.spark,
.registerPagedSplat, .throttleGate, .renderCount/.throttled), the
.renderer/.clock type changes, and the sync-constructor-vs-`ready`
execution model; (3) `SparkSceneConfig` is written down by zero consumers
anywhere, so a config alias defends nobody. CONSEQUENCE: the sibling swap's
one-line-dependency goal (D12) is carried by Phase 2's consumer re-typing;
the external rename is a loud one-line edit, not a silent semantic trap.
H-API's consumer fixture (Phase 2) records this divergence as expected.

**D25 — DECIDED (2026-09-13, OWNER RULED at ticket 08's stop): `loadSplat`
keeps its name and options shape, gains a `backend` option, and returns the
seam's `SplatHandle` instead of Spark's `SplatMesh`.** The H-API-sanctioned
divergence entry for the rebuilt `core/SplatLoader` (doc 05: "divergences
allowed only via doc 06 entries"). Grounds: the pin's `loadSplat(options):
SplatMesh` (`fd67153:src/core/SplatLoader.ts`) needs no renderer and returns a
Spark type that cannot exist here; a seam loader needs the backend (the paged
`.rad` path needs the renderer for its page budget and a decode-worker factory)
and the seam hands the renderable over as `handle.object` for the caller to
compose (doc 02 resolution note, 2026-08-29). The barrel name and the options
names stay, so pin callers (SiteRuntime, SceneComposer, 8 example pages at the
pin) change at the call site, loudly, never silently. The conditional 180°
X-flip stays the loader's (pin `SplatLoader.ts:81-88`: presence of
`eulerRotationDeg` arms it), applied to `handle.object`; the backend hands the
object over unrotated. H-API's consumer fixture records this divergence as
expected.

**D26 — DECIDED (2026-09-13, OWNER RULED at ticket 08's stop S1): reveal = the
seam's paint-observed ready; the pin's reveal gate is a REFERENCE, not a
pending constant set.** The rebuilt SplatLoader reveals at the seam's ready
(first paint after the first page with splats), reports the true completed-work
fraction until then, then exactly 1 once — monotone, never un-revealed. Grounds:
doc 04 Phase 2 says the element "reveals progressively" (coarse-then-sharpen is
the stated intent); zero constants; one meaning of ready on both load paths;
cannot hang under `?pages=32`, where the fraction tops out at 0.5082. **The
pin's gate is recorded here as the reference** for a future PRODUCT decision
that wants the coarse first moment hidden: `fd67153:src/embed/SiteRuntime.ts:2460-2476`
(REVEAL_MODE auto/visual/pristine; REVEAL_MIN_MS 1500; REVEAL_MAX_WAIT_MS
20000/120000; REVEAL_LIGHT_MAX_WANTED 48; REVEAL_STABLE_MS 5000;
REVEAL_LIGHT_STABLE_MS 1500; PROGRESS_CHASE_RATE 0.35; REVEAL_VISUAL_WINDOW_MS
1200; REVEAL_VISUAL_GROWTH 0.06; REVEAL_VISUAL_DWELL_MS 500;
PROGRESS_REPORT_INTERVAL_MS 80) plus the 0.98 progress cap at `:2529` — every
one hand-picked, and its signals read residency (resident/wanted) or splat-count
growth, which §A5 forbids. That revisit needs its own evidence and ruling; no
constant may be smuggled in under this entry.
**D26 NOTE (2026-09-24, ticket 13 finding F1 — OWNER ITEM for the Phase 2 boundary, recorded,
NOT fixed): the reveal can fire on a paint that draws ZERO splats.** Measured in ticket 13
(regime E2: chunk 0's request held 3,000 ms and no frame for the first 2,500 ms of the load):
reveal with 0 selected / 0 drawn, the first splats 84 renders later on WebGPU and 18 on
WebGL2 — against the backend's own rule that an empty paint must not count
(`src/backend/ThreeGsBackend.ts:819-820`). Cause: "first page with splats" means UPLOADED
splats (`:823`), while under LOD selection nothing is drawn until chunk 0, the root, is
resident. In normal loads the two coincide by construction (a traversal over the empty scene
admits only the root; 16/16 runs). Background-tab loading is a real user regime, so whether
the reveal waits for a drawn splat is a product decision; the semantics stay as ruled here
meanwhile. Detail: ticket 13 Comments.

**D27 — DECIDED (2026-09-17, OWNER RULED at Phase 2 ticket 09's Stop 2):
`interact/SplatHighlight` ships as an API-preserving INERT stub until Phase 3.**
SiteRuntime constructs the highlight unconditionally on every boot
(`fd67153:src/embed/SiteRuntime.ts:3192`), and the real class value-imports
Spark's SplatEdit family (`fd67153:src/interact/SplatHighlight.ts:10-15`), so it
can be neither copied nor rebuilt before Phase 3's edit layer (doc 03 §C, doc 04
Phase 3). The stub mirrors the pin's exported names and public members exactly
and does nothing: marker hover glow is ABSENT until Phase 3 — a declared
divergence, announced by ONE named note in author mode (printed by SiteRuntime,
which knows the mode) and by no visitor-facing warning (ticket 08 S5's test: a
warning that fires on every normal load is a broken warning). Unlike D19's
`SplatTextMesh` stub it does NOT throw: D19's throwing constructor is safe only
because the splat-text lane is reached conditionally, while a throwing stub that
SiteRuntime constructs unconditionally would kill every boot. SAME OBLIGATION AS
D19: Phase 3 DELETES this file and replaces it; never left beside real code. The
barrel name stays deferred (D19 precedent: no stub in the barrel). Detail:
ticket 09 Comments.

**D28 — DECIDED (2026-09-17, OWNER RULED at Phase 2 ticket 09's Stop 12):
SiteRuntime's handle keeps the pin's member NAMES, re-typed honestly.**
`SiteRuntimeHandle.sparkScene` is typed `ThreeSplatScene`; `LoadedScene.mesh` is
the `THREE.Object3D` the backend hands over (a group holding the splat mesh), with
a new `handle: SplatHandle` beside it; `LoadedScene.paged` derives from the file
format (a `.rad` is paged), and an authored `paged` is passed through, accepted and
warned per ticket 08's S5 when it contradicts. Grounds: D12 (strict source
compatibility — what makes the sibling swap a one-line dependency change): readers
of `sparkScene.scene` / `.camera` / `.canvas` / `.renderer` compile unchanged. D24
ruled only the BARREL type name, because an alias would misrepresent the class;
here the type is honest and only the member name is inherited. Precedent: phase-1
ticket 08 kept EnvironmentLoader's `sparkScene` config-key name typed
`ThreeSplatScene`. Cost accepted: the names no longer match the types, and `mesh`
is a group. The H-API divergence is in these members' TYPES: code calling Spark
members on them breaks at compile time, loudly. PRECEDENT'S REASON CORRECTED
(found at this stop): phase-1 ticket 08 kept the name as "consumed by Phase 2's
SiteRuntime copy", but the pin's SiteRuntime never constructs EnvironmentLoader;
the `sparkScene` config key's real consumers are SceneComposer, CropTool and
DebugPanel (Phase 3) and pin example pages (`fd67153:examples/composer/main.ts:44-47`).
The kept name stands on D12, not on that reason. Detail: ticket 09 Comments.

**D29 — DECIDED (2026-09-17, OWNER RULED at Phase 2 ticket 09's Stops 4e, 4f, 5
and 8): SiteRuntime's declared behavioural divergences from the pin** (H-API:
divergences are allowed only via doc 06 entries). Pin lines are
`fd67153:src/embed/SiteRuntime.ts`.
1. **Docked-idle render throttle (Stop 4f, T1).** `ThreeSplatScene` carries the
   pin's `throttleGate` (+ read-only `renderCount` / `throttled`). The refinement
   guard reads the seam: a paged scene is still refining while
   `progress().fraction < 1` (the pin read resident < wanted from Spark pager
   internals, `:3444-3453`). More conservative than the pin: throttling waits for
   the whole file, and under a constrained page budget the paged fraction never
   reaches 1 (0.5082 under `?pages=32`, ticket 06), so capped sites never throttle.
   Never refinement-starving; zero constants. REVISIT OWNER: ticket 12 notes whether
   its diagnostics door can offer a seam-legal "wanted" signal; ticket 13's
   idle-power / H-LOAD evidence decides whether that signal (T2) is ever warranted.
   REJECTED BY NAME: T4, a gate without the refinement guard — the pin's own
   documented bug (`:3433-3443`).
   *Decided 2026-09-26 (ticket 13, owner ruling W2 b): T2 is deferred to a later power ticket,
   which opens with this fact.* Capped sites are a REAL-DEVICE regime, not a test artifact: the
   product's own formula (`webglPageLimit`, `src/backend/ThreeGsBackend.ts:494-519`) puts a WebGL2
   device with `MAX_TEXTURE_SIZE` 4,096 at 85 of the hero's 122 pages — COMPUTED, NOT MEASURED on
   such a device — and a capped site never idle-throttles. Ticket 13's counted trials held the
   throttle off by design, so they carry no idle observation.
2. **Site load progress (Stop 5, P1).** The slowest scene across ALL scenes (a
   revealed scene counts 1), reported only when it rises, exactly one 1 at the last
   reveal; ready is pin-identical (`:2596-2605`). NOT reproduced: (a) idle 1-spam —
   a site with no paged scene reported `1` every 80 ms before ready, because the
   report loop skips non-paged scenes (`:2585-2594`); (b) the double 1 — when the
   last scene reveals, the throttled report can send 1 and the ready branch sends 1
   again (`:2585-2599`). The pin's 80 ms report interval (`:2476`, a D26 reference
   constant) is not carried. `<splat-site>` emits one `loadprogress` per report, so
   this shapes the element's event stream.
3. **Locative tint and the boot catch (Stop 8, R1 + K2).** A white tint is a no-op
   by value and skips silently; a non-white tint skips with ONE author-mode note
   (Phase 4's `setMeshColor` owns the real tint). The pin's `.catch(() => {})` after
   `whenFontsReady(...).then(...)` (`:3365-3375`) is narrowed to the font promise's
   own rejection — a divergence in failure VISIBILITY only. Grounds: the pin's
   catch-all is exactly the mechanism that would have swallowed the tint loss.
4. **Rail depth of field (Stop 4e).** The Spark optics writes (`:887-892`) are
   skipped and `fov` still applies; ONE author-mode note the first time a stop asks
   for aperture > 0. Phase 5 owns optics.
5. **Author-mode obstacle outlines (Stop 15, L-A).** The pin's classic
   `LineSegments2` + `LineMaterial` (`:3550-3554`) become three's WebGPU pair —
   `lines/webgpu/LineSegments2` + `Line2NodeMaterial`, which take the pin's own
   parameters (`color`, `linewidth`, `worldUnits`) and share `LineSegmentsGeometry`.
   A renderer-migration adaptation of the kind doc 01 counts, not a feature change.
   Measured in site-lab on BOTH backends: with the classic pair, three logs
   `NodeBuilder: Material "LineMaterial" is not compatible.` and substitutes a plain
   node material that floods the frame (266 of 527 sampled pixels change on WebGL2);
   with the node pair, zero such errors and a real outline (27 of 527 sampled pixels
   on WebGPU, 10 of 527 on WebGL2, at the authored colour `[74,222,128]`). The named
   alternative if this pair ever fails is plain `LineSegments` + `LineBasicMaterial`
   at 1 px — never a silent substitution.
Detail and evidence: ticket 09 Comments.

**D30 — DECIDED (2026-09-17, OWNER RULED at Phase 2 ticket 09's Stop 3):
`core/SplatBounds` ships as an API-preserving typed stub until ticket 11.** The
pin's module samples splat centres through Spark's `forEachSplat`
(`fd67153:src/core/SplatBounds.ts`), which this backend does not expose; ticket 11
rebuilds it on the backend's resident-page union. The stub keeps the pin's exported
names (`SplatBoundsOptions` verbatim, `computeSplatBounds` with the mesh parameter
widened) and returns `null` — the pin's OWN documented outcome ("Returns null when
no splat data is readable yet — callers treat null as 'no bounds'", pin :12-14). It
is silent for the same reason D27's stub is: the one consumer branch cannot be
reached in Phase 2. SiteRuntime calls it only from `sphereFromObject` (pin :3758-3771)
behind an `isSplatMesh` duck-type that the vendored mesh never satisfies (it sets
`isGaussianSplatMesh`, `GaussianSplatMesh.js:121`), and the only pin objects that
satisfy it are splat-text meshes, which D19's throwing stub keeps from existing until
Phase 4. SAME OBLIGATION AS D19 AND D27: ticket 11 DELETES this file and replaces it;
never left beside real code. The barrel name stays deferred until then. Detail:
ticket 09 Comments. **DISCHARGED (2026-09-18, Phase 2 ticket 11):** the stub's content
is gone — the pin's module was copied over it byte-identically and re-typed onto the
seam's `bounds()` (D33); the barrel name returns with it.

**D31 — DECIDED (2026-09-17, OWNER RULED at Phase 2 ticket 09's Stop 7): the
backend neutralizes three's stock raycast on its splat meshes until Phase 3 §B.**
Measured at the stop (both backends, camera 3 units from the origin): 9 rays gave 10
hits on a 48-splat PLY and on the 7.9 M-splat hero alike, all on the mesh's own
template quad (`InstancedBufferGeometry`, position count 4, bbox `[-2,-2,0]..[2,2,0]`)
— three's raycast ignores instancing, so it tests one quad at each mesh's origin. The
hits land off the splats (a PLY hit at y 0.866 against splat bounds of ±0.225), and the
pin's author `pickPoint` returns the first hit, so hotspot/box/prop placement silently
landed on a phantom plane. A splat mesh therefore answers no `Raycaster` hits at all
until §B puts real picking behind `backend.raycast`; SiteRuntime announces the gap once,
in author mode, at the first `pickPoint`. Fixed in the backend, where the wrong answer is
produced, on the same grounds as ticket 09 Stop 10. CONSEQUENCE for the Phase 0 record:
`docs/plan/results/phase-0.md`'s "Raycast absence: CONFIRMED empirically … 0 hits" holds
only for rays that MISS that quad — corrected there with a dated note. Detail: ticket 09
Comments.

**D32 — DECIDED (2026-09-18, OWNER RULED at Phase 2 ticket 11's stops D, S5 and S6):
`StatsHUD` reads the seam's counters — config `{ container, backend, handles?,
updateRate?, visible?, position? }`, line `fps | drawn | resident | src`.** The
H-API-sanctioned divergence entry for the rebuilt `core/StatsHUD` (doc 05: "divergences
allowed only via doc 06 entries"). The pin (`fd67153:src/core/StatsHUD.ts`) takes
`{ container, spark: SparkRenderer, splats?: SplatMesh | SplatMesh[], … }` and prints
`fps | drawn | lod-sel | src | trav | sort/lod | fetch`, every field but fps read from
Spark internals. Here:
1. **Config.** `spark` and `splats` are DELETED, not re-typed under their old names:
   every call site's argument types change regardless (no `SparkRenderer` exists here),
   so a kept name would only disguise the break. `backend` is typed as the
   `SplatBackend` INTERFACE and `handles` as `SplatHandle | SplatHandle[]`;
   `updateRate`, `visible` and `position` are unchanged.
2. **Fields.** `lod-sel`, `trav`, `sort/lod` and `fetch` are DELETED — Spark internals
   with no seam counter. `drawn` changes meaning: the sum over the given handles of
   `counts().selected` (the last render's draw count), where the pin read the
   renderer-wide `activeSplats`. `resident` is NEW: the sum of `counts().resident`.
   `src` changes meaning: the sum of `counts().total`, where the pin printed the FIRST
   readable mesh's total only (it `break`s after one). With no handles all three sums
   are 0.
3. **Number format kept (S5):** the pin's `(n / 1000).toFixed(0)K`. At 1K resolution any
   whole-chunk residency error — 65,536 splats, or the hero's 5,502-splat tail chunk —
   shows with margin to spare.
4. **A disposed handle THROWS (S6):** `counts()` refuses it by name (`unknown-handle`)
   and `update()` lets that propagate, where the pin's optional chaining never threw. A
   diagnostics HUD that silently skipped a disposed handle would lie by omission.
CAVEAT (D15): consuming sites are unsurveyed. The pin's three callers
(`examples/all/main.ts:136`, `examples/main.ts:116`, `examples/path/main.ts:80`, each
`{ container, spark: sparkScene.spark, splats: [splat] }`) and any external consumer
fail to compile — D24's class: a loud break with a one-line fix. Detail: ticket 11
Comments.

**D33 — DECIDED (2026-09-18, OWNER RULED at Phase 2 ticket 11's stops A, B, C, S1 and
S2): `computeSplatBounds(backend, handle, options?)` reads the seam's `bounds()`.** The
H-API-sanctioned divergence entry for the rebuilt `core/SplatBounds`, which replaces
D30's stub. The pin (`fd67153:src/core/SplatBounds.ts`) takes one `SplatMesh`, samples
every Nth centre through Spark's `forEachSplat`, transforms each by `matrixWorld` and
pads the box 5 % per axis. Here:
1. **Signature (A1).** `bounds(handle)` needs the backend AND the handle, so both are
   parameters; the pin's one-argument call fails to COMPILE — D24's principle, a loud
   break. Rejected: an object→(backend, handle) registry filled at load (hidden global
   mutable state).
2. **World box (B1).** The seam's box is in `handle.object`'s local space (the backend
   adds its mesh at identity inside that group, on both load paths). The world box is
   its 8-corner transform by `handle.object.matrixWorld`, refreshed first through
   `updateWorldMatrix(true, false, true)` — ancestors included, which the pin's
   `updateMatrixWorld(true)` does not refresh, and FORCED, because three recomputes
   `matrixWorld` only when `matrixWorldNeedsUpdate` is set and an object with
   `matrixAutoUpdate = false` never sets it (adversarial review 2026-09-20, measured at
   r185: a frozen handle under a moved ancestor framed at its stale position). Exact for
   axis-aligned transforms,
   conservative (never smaller) under arbitrary rotation; doc 03's Bounds paragraph is
   amended with the grounds and the revisit trigger (per-page seam growth).
3. **Options (C1).** `SplatBoundsOptions` is unchanged. `targetSamples` is `@deprecated`
   and ignored (D22's precedent: nothing is sampled any more); `world` and `padFraction`
   keep their meanings and defaults (`true`, 0.05). The pad's original justification,
   sampling undershoot, died with the sampling, but pin callers keep compiling and keep
   their framing margin.
4. **Refusals (S2).** `null` — the pin's documented "no readable splat data yet" — for a
   handle not built yet (`bounds-before-construct`), with no page resident
   (`no-resident-pages`), or with an empty box. Every other refusal propagates, a
   disposed handle's `unknown-handle` included: null is an answer, a throw is an
   accusation, and a caller framing a disposed handle has a bug.
5. **The dead call site (S1).** SiteRuntime's `sphereFromObject` (pin :3758-3771) also
   sampled duck-typed `isSplatMesh` children, a branch no Phase 2 object reaches: nothing
   sets `isSplatMesh` (the vendored mesh sets `isGaussianSplatMesh`), and splat-text
   meshes cannot exist while D19's stub throws. The branch and its import are deleted;
   Phase 4 re-adds splat-text framing with a real handle source (recorded under D19).
Detail: ticket 11 Comments.

**D34 — DECIDED (2026-09-20, OWNER RULED at Phase 2 ticket 12's stop G3): the
barrel-exported load-telemetry input types are RE-TYPED to the seam pair.** The
H-API-sanctioned divergence entry for `embed/diagWiring`'s registration surface,
mirroring D32/D33's form. The pin's `RegisterPagedSceneInput` carries
`{ sceneId, mesh: SplatMesh, renderer: unknown, sceneUrl }`, where `mesh` is a Spark
`SplatMesh` whose `paged.pager` the wiring polls for 30 s before giving up in silence.
This backend never has that object, so the pin's shape could only ever be satisfied by
lying about what it holds. Here:
1. **The input is `{ sceneId, backend, handle, sceneUrl, backendKind }`.** A loud
   compile break, exactly D24's principle. Rejected: passing a duck-typed adapter built
   from the seam (the type would still name a mesh it does not hold), and adding the
   seam pair as optional fields beside the pin's (two shapes to keep honest forever).
2. **`backend` is typed `SplatBackend & PagerDiagnosticsProvider`, not the concrete
   class.** Telemetry needs one thing beyond doc 02's fixed method set — the pager's
   counter door — because `LaggardMapper` consumes PER-PAGE evidence that aggregate
   `counts()` cannot produce. `PagerDiagnosticsProvider` is a new one-method interface
   exported from `ThreeGsBackend.ts`, itself one of the five doors `backend-doors-only`
   permits, so the rule is satisfied by construction and the type states exactly which
   extra reach telemetry takes. Rejected: the concrete `ThreeGsBackend` (a concrete
   class on the public API for the first time) and `SplatBackend` alone (type-checks
   clean while silently killing a §G survivor).
3. **`backendKind` travels with the registration** rather than being read from the door.
   Scene metadata is fixed at attach time, but the counter door does not open until the
   asset's header lands — measured at ~910 ms for the lab hero — so reading it at
   registration recorded `"unknown"` on every paged load. The runtime passes
   `sparkScene.backend`, which is exactly the "the scene already knows" the B3 ruling
   named.
4. **Registration no longer polls.** The pin's 30 s poll tangled two things: Spark hid
   the pager behind private names (gone — we read a published door), and a paged scene's
   state genuinely does not exist yet when `load()` returns (NOT gone). The handle is
   registered at once and the source treats the door's `not-paged` refusal as "not yet"
   rather than "never"; `unknown-handle` is the only refusal that closes it. Collapsing
   those two refusals silenced an entire load's telemetry in this ticket's own build,
   caught by the site-lab fixture, which is why the distinction is written into the
   source's contract rather than left to a comment.
Detail: ticket 12 Comments.

**D35 — DECIDED (2026-09-20, OWNER RULED at Phase 2 ticket 12's stops B2 and its
sibling): the load record's versioning block drops its two Spark fossils and gains
`engineVersion`; `LOAD_RECORD_SEMANTICS_VERSION` goes 1 → 2.** The pin's
`LoadRecordVersioning` carries `adapterVersion` and `sparkVersion` beside
`probeVersion`/`toolkitVersion`. Both were fed from one place — `SparkPagerAdapter`'s
`capabilities` — and §G deletes it, so both fields would have outlived their only
source. Measured before the change, on a WebGPU run of the real production wiring
(quoted in ticket 12 as the RED state):

    versioning.sparkVersion   : "2.1.0"
    versioning.adapterVersion : "spark-pager-2.1.0.1"
    environment.rendererClass : "webgl"          <- on a WebGPU run (B3)

1. **`sparkVersion` → `engineVersion`**, fed from three's own `REVISION` at runtime,
   never hardcoded: the value is the engine's own claim about itself, so it cannot drift
   from the engine actually running. Rejected: `rendererVersion` — `environment.
   rendererClass` already exists and answers a different question (which backend), and
   two "renderer" fields in one schema is a reader trap.
2. **`adapterVersion` is DELETED outright**, not renamed. Its concept has no successor:
   with LoadProbe's ports implemented directly there is no separable adapter to version,
   and a renamed fossil is still a fossil. If ticket 13's record-reading later wants a
   toolkit-identity field, that is a new field with its own justification.
3. **The semantics version bumps.** A record written under 1 and one written under 2 are
   not the same shape and readers must know it; the mechanism exists for exactly this
   moment, and dodging the bump to avoid the churn would be schema drift. Ticket 13's
   H-LOAD reads the bump as expected, not as a surprise (noted in ticket 13's file).
4. **`environment.rendererClass` is fixed in the same change (B3).** The pin hardcoded
   `"webgl"`, so every WebGPU run recorded itself as WebGL — AC2 asks for a COMPLETE
   record on BOTH backends, which that defeats by construction. It now carries the
   runtime's actual backend identity (`"webgpu"` | `"webgl2-fallback"`). The GPU bucket
   beside it (`bucketGpu(undefined, undefined, "unknown")`) is NOT fixed here: feeding it
   requires choosing a GPU-identification mechanism inside a deliberately
   privacy-bucketed stack. **Ruled 2026-09-20: it stays all-`unknown`, recorded as
   FAITHFUL rather than as a defect** — the pin's own production call is
   `bucketGpu(undefined, undefined, "unknown")` (`fd67153:src/embed/diagWiring.ts:388`,
   verified), and its only call with real values is a hardcoded `"NVIDIA"` literal in
   `selfTest.ts:728`, so all-unknown is the pin's production privacy posture and not
   something this rewire broke. Feeding it is a fingerprinting-surface PRODUCT decision
   reserved to the owner post-parity — never a port improvement.
5. **The optional-budget denominator is RENAMED, not re-policied (added 2026-09-22 after the
   adversarial review round).** `probe_summary.renderedFrames` becomes
   **`renderedSampleWindows`**, because that is what it counts: one entry is pushed per
   captured event carrying `renderedFrame`, and the telemetry source emits one such event per
   SNAPSHOT while rendering runs at frame rate. Measured on a real paged load: **120 frames
   drawn against 19 flagged events, a 6.32x ratio** (environment-dependent). This cadence is
   the PIN's own — `fd67153:src/diag/SparkPagerAdapter.ts:529` emits one `pager_snapshot` per
   `readSnapshot` — so the ladder's behaviour is unchanged from what shipped, and the field was
   simply misnamed. Emitting true frame counts was REJECTED: it would loosen the optional-work
   throttle roughly sixfold past any behaviour the pin ever ran, "a policy change wearing a bug
   fix's clothes". The policy constant `optionalCpuMsPerRenderedFrame` KEEPS its inherited name
   and value; whether the allowance should be recalibrated against true frames is a
   post-parity tuning decision recorded in ticket 13, to be made once against evidence rather
   than drifting per ticket. The G2 advance-assertion is unchanged — it tests feed liveness,
   which is orthogonal to the unit. This rename rides the `LOAD_RECORD_SEMANTICS_VERSION`
   1 → 2 bump already in this entry, at no extra cost.
   *Provenance:* found by `astra-review` in ticket 12's adversarial round, confirmed
   independently on the real backend, and shown inherited by checking the pin.
   *CORRECTED 2026-09-26 (ticket 13, FINDING RSW-1 — owner ruling):* "roughly sixfold" above is the
   UNCAPPED ratio. The telemetry tick samples at >= 100 ms (`src/embed/diagWiring.ts:131`, `:298-310`)
   and the allowance is capped at 50 ms per 5,000 ms window (`src/diag/LoadProbe.ts:465-469`,
   `src/diag/policies.ts:26-31`), so emitting true frame counts would loosen the throttle at most
   roughly twofold, and only above ~20 fps. The owner's grounds for this item carried the same
   overstatement, and this note owns it. The ruling itself stands: window-counting is the pin's
   cadence, kept for parity. *The deferral is DISCHARGED (2026-09-26, owner ruling W1 a):* no retune
   in Phase 2 — RSW-1 shrinks the maximum effect to ~2x above 20 fps; the trials' drags ran at 2-10
   fps, where a retune changes nearly nothing; the owner's opt-in telemetry-price item already
   covers the whole cost. A retune happens later only against a profile, as a post-parity item.
   Detail: ticket 13, stop W1 and its ruling. *CORRECTED AGAIN 2026-09-27 (ticket 13, FINDING R1-F2 — owner close-out ruling 2):* "at most roughly twofold, and only above ~20 fps" and "~2x above 20 fps" above are wrong as well — the second wrong version of this stake, and like the first it passed through the owner's rulings. Because the tick fires on the first render at least 100 ms after the last sample and times the next from it (`src/embed/diagWiring.ts:301-302`), above 10 fps it samples less often than every 100 ms, and emitting true frame counts would loosen the throttle: no effect at or below 10 fps, ~2x from 10-20 fps, up to ~3x just above 20 fps (the model, re-run 2026-09-27: 1.00x at 2-10 fps; 1.96-2.03x at 10.5-20; 2.78-2.86x at 20.5-21; 1.96-2.63x from 24 to 144 fps). The ruling and the discharge both stand: the trials' drags ran at 2-10 fps, where the ratio is exactly 1.0. Detail: ticket 13, R1-F2.
Detail: ticket 12 Comments.

**D36 — DECIDED (2026-09-24, OWNER RULED at Phase 2 ticket 13's reconciliation stop, Q1,
Q1b, Q2 and Q3): how the Phase 2 H-LOAD re-run is measured.** Doc 05's H-LOAD says the
production figures come from "the rewired diag stack". Read against the spike at this stop,
the stack alone cannot give a like-for-like comparison with the spike's Phase 0 medians
(`docs/plan/results/phase-0.md:29-36`), which ADR 0003 allows as the bar:
1. **Where trials run — the owner's real Chrome, a VISIBLE tab (Q1: option A, fallback B).**
   The spike's own rule (`spikes/native-rad/src/measure.ts:194-198`): a trial that was ever
   hidden is invalid and re-run, never recorded; the Claude desktop browser pane reported
   `hidden` as its normal state in every recorded session (memory note of 2026-09-17/-18,
   handoff 012 Q1). Trials are driven through Claude-in-Chrome, read-only (navigate and
   read, no account actions). The harness COPIES the spike's contamination flag and
   auto-rerun: hidden or contaminated trials are discarded and repeated, never recorded.
   Fallback B: the owner opens the harness once in auto mode and leaves it alone (the
   Phase 0 procedure).
2. **What hosts the trials — the `<splat-site>` element on
   `examples/site-lab/sites/lab.site.json` (Q1b).** Grounds: AC1 says "production runtime",
   and doc 04's Phase 2 exit is the whole element; the loader level would re-measure the
   spike's shape, not the product.
3. **First-pixel — the spike's definition in every trial, D26's reveal alongside (Q2).** The
   comparison column is the first rendered frame whose traversal selection is non-empty
   (`spikes/native-rad/main.ts:455-457`); the toolkit's D26 reveal (first paint after the
   first page upload, `src/backend/ThreeGsBackend.ts:819-825`) is recorded beside it. D26 is
   NOT changed — it stays the product's definition of reveal; the comparison uses the bar's
   own definition. Whether the two moments coincide is MEASURED (the frame-ordering check in
   ticket 13's Comments), not read from the code.
4. **Longest main-thread block — page-wide with the spike's exact method, beside the
   record's per-scene figure (Q3).** The spike counts every long task from page start
   (`measure.ts:180-186`); the production record counts only blocks ending at or after the
   scene's registration (`src/embed/diagWiring.ts:246`), so on one run the record's figure
   can only be ≤ the spike-method figure. The harness measures the comparator page-wide; the
   production filter STAYS exactly as ticket 12 built it — correct for a per-scene record,
   unfair as a baseline comparator.
5. **Peak JS heap — the same shape, ruled earlier (ticket 12, 2026-09-20; quoted verbatim in
   ticket 13).** The harness samples with the spike's 500 ms `performance.memory` poll
   (`measure.ts:188-192`); whether the record earns a heap field is ticket 13's own stop,
   under its own semantics bump if so.
   *Decided 2026-09-26 (ticket 13, owner ruling W5 b): no field.* Grounds: a Chrome-only API; the
   heap is page-scoped where the record is scene-scoped; the harness measured it in all 40
   preserved trials. Ticket 12's named gap is discharged as decided-with-grounds;
   `LOAD_RECORD_SEMANTICS_VERSION` stays `"2"`.
Consequence: first-pixel, longest block and peak heap are compared through harness
instruments that use the spike's own definitions and methods; the stack's own figures are
reported alongside, never substituted. Full-quality's source is NOT ruled here. Detail:
ticket 13 Comments.

**D36 ADDENDUM (2026-09-24, OWNER RULED at ticket 13's harness-design stop, H1-H8): the trial
harness (`examples/hload/`).**
6. **The `?pages=32` regime on the element (H1 a).** The harness sets the backend's documented
   measurement override (`pageBudgetOverride`, `src/backend/ThreeGsBackend.ts:272-274`) through
   an observation hook on `ThreeGsBackend.prototype.load`, and EVERY trial asserts the backend's
   own reported budget before it counts. No product change: SiteRuntime's backend construction
   (`src/embed/SiteRuntime.ts:864`) stays as ticket 09 built it; whether the element ever earns a
   budget attribute is a post-parity product question.
7. **Pose and drag (H2 a).** The spike's pose A — (0,0,3) → origin, fov 60 — and its
   quarter-orbit, driven through the element's public CameraSystem; the near-plane difference
   (element 0.1, spike 0.01) declared in every trial record and in the results table.
8. **Canvas size and pixel ratio (H3).** First a read-only attempt to recover the spike's own
   trial records from the built-in pane's saved storage — if recovered, the spike's real size,
   cited; else pixel ratio pinned to 1 and a fixed 1280x720 box. Either way the bar comparison
   carries a declared caveat while the spike's trial size is unrecorded; only a recovered value
   removes it.
9. **The docked-idle throttle (H4 a).** A synthetic `pointermove` per harness frame through the
   element's own input-reset path, and every trial record carries the throttle state, proving
   the 10 fps regime never engaged — the guard shown biting first (a trial without the synthetic
   input trips the throttle). *Dated note (2026-09-24, owner ruling): the stop behind this item
   said a throttled drag reads falsely LOW; in this harness, which times render to render, it
   reads falsely HIGH (plant C4: p95 1,265.8 ms over 5 drag frames). The guard's purpose is
   unchanged — a throttled trial is invalid either way.*
10. **Full-quality and steady (H5 a)** on the spike's definitions read through the door, the
    record's convergence terminal alongside; **cold cache (H6 a)** by a per-trial cache-busted
    copy of lab.site.json, proven cold from resource timing; **the dev server (H7 a)**, as the
    spike used; **D16's picture pair (H8 a)** from one shared page on both servers, for the
    owner's eye check as in ticket 10. *Dated note on H6 (2026-09-24, owner ruling) — the cold
    check's actual mechanism:* the dev server answers `Cache-Control: no-cache` with a weak ETag,
    so every default fetch receives full 206 bodies (measured, and a force-cache load found none
    of the 123 chunk ranges stored) — cold holds by the server's own headers and the cache-buster
    is belt-and-braces. The check requires every hero entry to be a 206 whose body crossed the
    network AND at least one entry per chunk plus the header probe (`>= pAsset + 1`), which is
    what catches bytes that arrive with no request; the warm-HTTP-cache plant is superseded by a
    chunk answered without a request. Detail: ticket 13 Comments.
11. **The load record and the two trial sets (2026-09-24, OWNER RULED at ticket 13's stop on the
    blockers).** The element writes NO load record by default: SiteRuntime forces telemetry off
    for visitors (`src/embed/SiteRuntime.ts:2357-2373`, grounds in its own comment), and
    lab.site.json opts in nowhere. So: the COUNTED H-LOAD trials run at the VISITOR DEFAULT —
    telemetry off, the product as shipped, because the bar is what a visitor experiences and the
    pin's posture is that visitors do not pay for measurement. A SEPARATE full 5 x 4 opt-in set
    (lab.site.json's content plus `settings.telemetry`, labelled as its own configuration, never
    mixed into the visitor medians) supplies the record figures for items 4-5's "alongside", the
    `renderedSampleWindows` retune evidence (D35 item 5), and the MEASURED cost of telemetry
    itself — visitor default against opt-in on the same criteria, the empirical check on the
    comment's claim that opt-in telemetry is "now bounded"; if the numbers say it is not bounded,
    that is a finding. Trials run in the owner's Chrome only; if Chrome is not connected when
    trials are ready, the session stops and reports — fallback B is the owner's explicit call.
12. **The results stop (2026-09-25, OWNER RULED at ticket 13's post-trials stop, S1-S5).** The
    counted sets (40 of 40 valid) gave one timing regression — WebGL2 `?pages=32` first-pixel
    703.0 ms against the bar's 598 — and three open questions about the bar comparison
    (`docs/plan/results/phase-2-hload.md`). (S1) A same-environment CONTROL with the spike's own
    measuring page, in Chrome, at 1280x720 and pixel ratio 1, five webgl-pages32 trials, the same
    day — a control, never a new bar, recorded as such, its decision rule written down before the
    run: ~700 ms → "environment drift, both stacks equally affected, bar re-dated"; ~600 ms → our
    code, and the first-pixel path is instrumented stage by stage and brought as a stop. (S2) The
    same run settles criterion 3's figures: the spike at 1280x720 selecting 2,314,382 / 603,256
    PROVES the window-size explanation (the caveat becomes a footnote with the measurement);
    anything else is a finding and a stop. (S3) The WebGL2 default's cross-trial hashes: read both
    codebases on decode-order determinism, then one temporary run with the decode pool pinned to
    one worker through an EXISTING seam — none existing is a stop, and no product code changes for
    it without a ruling. (S4) Criterion 4's cross-trial difference band is measured with the same
    capture method as D16's picture pair (item 10), and judged against the bar's own footnoted
    behaviour, not a threshold set now. (S5) All 40 raw trial records are copied into
    `docs/plan/results/` beside the doc, the store's fingerprint recomputed over the repo copy and
    shown equal — trial evidence, in the ticket's single commit. Also ruled: the opt-in telemetry
    price — bounded and repeatable, not small (up to +32.7 % first-pixel and +538 MB median peak
    heap in the constrained regime) — joins the owner items for the Phase 2 boundary, and the
    `renderedSampleWindows` retune stop (D35 item 5) cites these numbers. Detail: ticket 13
    Comments.
    *Follow-up (2026-09-25, OWNER RULED at GO; control run done the same day).* The control read
    the spike at 570.8 ms (webgl-pages32 first-pixel, five trials) — "~600" by the pre-written
    rule, so the regression is OUR CODE: production is 132.2 ms slower in the same browser, and the
    first-pixel path is instrumented stage by stage next, brought back as a stop. At 1280x720 the
    spike selects 603,256 and 2,314,382 in every trial — the window-size explanation is PROVEN. S3
    is ruled (b): no product change — the chunk-to-slot map from the diagnostics door is recorded
    in every WebGL2 trial beside the hash and the network arrival order; grounds: a one-worker pool
    (option a) still submits in arrival order, so it could not have isolated concurrency. S4 is
    ruled (A): in-page full-frame readback, the band computed in the page, the H8 picture pair
    saved as PNGs through the byte-exact receiver into `docs/plan/results/phase-2-hload-pictures/`,
    each PNG's sha256 recorded beside it. Found by the control, for the owner: the environment moved
    the spike's own figures (webgl-default first-pixel 1,092.4 against its Phase 0 1,423), so
    production's "match" there hides a 321.1 ms same-browser gap. Also recorded as a finding for
    the r186 report: README.md's and the docs' "not in any published release" lines are stale since
    three 0.186.0 (2026-09-08; 0.186.1 on 2026-09-24).
    *Second follow-up (2026-09-26, OWNER RULED on stops V1-V4 — quoted verbatim; what each ruling
    records is in ticket 13's Comments).*
    > V1 (a): name it, don't fix it here. Record with the full measurements: the shared cause
    > (full-capacity source-array construction through the byte-frozen vendored constructor,
    > required by D20), the side-by-side (243 vs 14 ms at 32 pages, 897 vs 37 ms at 122), the
    > estimate labeled as an estimate (~85 of 132.2 ms, ~298 of 321.1 ms), the ~47 ms remainder
    > named as unexplained, and the chunk-0-bytes stage (270-690 ms, longest tasks 231/822 ms)
    > named as unattributed. The fix is (b)'s shape — placeholder mesh plus empty full-size
    > storage inside D20's rules — in its own post-Phase-2 ticket; add it to the owner-items list
    > with these numbers.
    >
    > V2 (a): record 2.01% as criterion 4's number, with the verdicts as presented — WebGPU
    > variation is the bar's own † kind; WebGL2-pages32 is the ‡ kind, more frequent;
    > WebGL2-default's cross-load variation is new behavior with a proven mechanism (slot =
    > decode-completion order under 4-worker scheduling, not network order), accepted as the price
    > of 3-5x faster full-quality loading. Record (b) and (c) as post-parity options with (c)'s
    > cost quoted (54 s vs 15.5 s).
    >
    > V3 (a): r186 adoption is its own post-Phase-2 ticket. Record the per-item dispositions (item
    > 13 deletes the SPZ refusal at adoption; item 5 is a recorded reason to KEEP doc 03 §B; item
    > 10 drops the JS type-guessing reliance at adoption), the four breaking changes as that
    > ticket's known scope, and the six stale "unpublished" lines as its doc corrections — none
    > edited now. Add r186 adoption to the owner-items list.
    >
    > V4 (b): record RS-1 and convert the line endings in their own small change after this
    > ticket. The audit (93 byte-identical, 24 traced, 11 native, zero unexplained) closes the
    > re-sync item with a finding.
    *Third follow-up (2026-09-26, OWNER RULED on FINDING RSW-1 and stops W1-W5 — quoted verbatim;
    what each ruling records is in ticket 13's Comments, and in D29 item 1, D35 item 5 and item 5
    above).* *Dated note 2026-09-27 (ticket 13, owner close-out ruling 2, FINDING R1-F2):* the stakes quoted in the RSW-1 and W1 paragraphs below — "at most roughly twofold, and only above ~20 fps" and "~2x above 20 fps" — were Claude's arithmetic, and wrong: no effect at or below 10 fps, ~2x from 10-20 fps, up to ~3x just above 20 fps. The quote stays as the owner wrote it; W1's no-retune stands (the drags ran at 2-10 fps, where the ratio is exactly 1.0). Detail: D35 item 5's note and ticket 13, R1-F2.
    > RSW-1: correct in ALL FOUR places with dated notes — doc 06 D35 item 5, ticket 12, ticket
    > 13, AND the source comment at PagerTelemetrySource.ts:299-306. The comment is the one code
    > edit authorized: comments that overstate are instrument-honesty defects, and this one
    > defends a ruling of mine with wrong arithmetic. The correction preserves the ruling
    > (window-counting is the pin's cadence, kept for parity) and replaces the stakes: "at most
    > roughly twofold, and only above ~20 fps, because the tick samples at >=100 ms and the
    > per-window allowance is capped" — cite your trace. My D35 grounds carried the same
    > overstatement; the dated note owns that.
    >
    > W1 (a): no retune in Phase 2. Grounds recorded: RSW-1 shrinks the maximum effect to ~2x
    > above 20 fps; the trials' drag regime ran at 2-10 fps where a retune changes nearly nothing;
    > and the owner's telemetry-price item already covers the whole cost. Retune later only
    > against a profile, as a post-parity item — record it as CLOSED for this ticket with these
    > grounds, discharging the D35 item 5 deferral.
    >
    > W2 (b): record and defer to a later power ticket, WITH your new fact prominently recorded:
    > capped sites are a real-device regime, not a test artifact — the product's own formula puts
    > a 4,096-texture WebGL2 device at 85 of the hero's 122 pages, and a capped site never
    > idle-throttles. Label the 85/122 as computed-not-measured. That fact is what the power
    > ticket opens with.
    >
    > W3 (a): lab.site.json + lm-lifetime.site.json, swap partner as recommended — they are the
    > pin's own portfolio sites, which is as "real" as this repo can get without shipping assets,
    > and the src-swap is the product's actual swap mechanism. H-LIFE x10 on one live element
    > alternating src swaps with remove/re-add, counters back to baseline EXACTLY, heap reported
    > against site-lab's existing not-strictly-increasing standard — no new tolerance invented.
    > End-to-end through every stop on both backends. In the owner's Chrome, one window session —
    > announce when ready and wait for go.
    >
    > W4 (a): the direct SH-output check in pager-lab, shown failing on a planted fault first
    > (your invalidate()/_sphericalHarmonicsInitialized plant), no product change. WebGL2
    > recomputing per-draw is recorded as the reason the check only needs to bite on WebGPU.
    >
    > W5 (b): no field. Grounds recorded: Chrome-only API, page-scoped where the record is
    > scene-scoped, and the harness already measured heap in all 40 preserved trials. The named
    > gap from ticket 12 is discharged as decided-with-grounds, not forgotten. The semantics
    > version stays at 2.
    *Fourth follow-up (2026-09-27, OWNER RULED in the STOP message and in the next session's opening
    message — the ruling sentences quoted verbatim; what each records, two of the STOP message's
    figures corrected (PL-1 is 3 of 8 WebGPU runs, not 3 of 7; the tree held 29 status lines and
    four hook briefs), the post-ticket small changes sublist and the open route question RR-1 are in
    ticket 13's Comments).*
    > Interpretation, already ruled: runtimes freed in the plain tab → HL-1 is the debugging
    > connection, an instrument artifact, counted heap evidence from the owner's plain tab (fallback
    > B); not freed → HL-1 is a real product finding, WebGL2's heap gate failure pre-explained,
    > retainer-hunt diagnosis deferred to its own ticket. Then the counted session: WebGPU then
    > WebGL2, stops 1→2→0, ten alternating src-swap and remove/re-add cycles, final removal, records
    > to docs/plan/results/phase-2-hlife-records.json (ruled), fingerprint re-checked on the repo
    > copy, owner's window fronted throughout, hidden runs redone.
    >
    > the W4 SH-output check (red on both branches — held-flag plant on WebGPU, sh-premise plant on
    > WebGL2 — green both backends both regimes; the ruled single-re-arm plant SUPERSEDED because it
    > cannot bite, owner owns that supersession; the sh-rearm-once green run as the proof), finding
    > PL-1 (evict-readmit inherited flake, 3-of-7 WebGPU, one pre-insertion failure proving
    > inheritance; a PL-1 failure alone does not block close-out, tally reported, band-widening on
    > the post-ticket list)
    >
    > The two open points are answered now: (1) "the post-ticket list" lives in ticket 13's
    > owner-items section, as a clearly-labeled "post-ticket small changes" sublist (currently:
    > widen evict-readmit's noise band; convert the RS-1 line endings) — distinct from the numbered
    > owner items. (2) If the owner's plain tab shows the runtimes freed, the counted heap evidence
    > comes from plain-tab runs the owner starts by opening the URL; the page POSTs its records
    > byte-exact to the 5299 receiver exactly as the H-LOAD raw records did, fingerprint re-checked
    > on the repo copy — no debugging attachment touches those runs; the Claude-driven tab is used
    > only for the parts that need driving, and each record states which tab kind produced it.
    >
    > SECOND, RG-3: approved — re-run the W3 page's deliberate-fault checks against the FINAL page
    > bytes in the built-in pane (logic only) before any counted trial, and record that the reds
    > reproduce on the fingerprinted bytes. A plant that has not been shown red on the exact bytes
    > that will run has not been shown red.
    *RR-1, ruled the same day (the owner's chosen answers to the stop, quoted verbatim with each
    option's text as offered; ticket 13's Comments):*
    > "(B) Store route (Recommended)" — No page change. Plain-tab runs save to the browser store as
    > now; after they read DONE, my driven tab reads the store and sends one file, the route H-LOAD
    > actually took. hlife.ts stays at ee6e577c, so RG-3, your HL-1 check and every counted run
    > share one fingerprint. Tab kind is written into the run name (e.g. plain-webgpu-1) and the
    > runs table.
    >
    > "Yes, all plain-tab" — Every counted run on both backends is a plain-tab run you start by
    > opening the URL; my driven tab never touches a run and only sends the records afterwards.
    *Fifth follow-up (2026-09-27, the owner's GO message — OPEN OBSERVATION MR-1 and OBSERVATION
    IH-1 ruled, the plain-tab result reported; quoted verbatim. The result, 3 of 12 collected, is
    partial — neither branch of the rule — and FINDING HF-1 then showed the H-LIFE page itself
    holding three runtimes: STOP HF-1, ticket 13's Comments).*
    > GO. My plain-tab result follows at the end of this message (READOUT and DONE lines pasted
    > verbatim).
    >
    > Ruling on the unplanted memory red in the RG-3 fault runs: it does NOT block the counted
    > session. Grounds: the counted runs plant nothing, so the retained-plant-objects candidate
    > cannot apply to them, and they judge eleven readings where the fault runs judged three against
    > ~117 MB pane noise. Keep it recorded as an open observation with both untested candidates; if
    > the counted runs' own heap series shows the same shape unplanted, it graduates to a finding
    > and comes back as a stop.
    >
    > Also record, as a small named observation: the idle-heap readout equaling the last steady
    > reading to the byte is suspicious enough to note (a readout that cannot move is a gauge that
    > may not be connected) — you flagged it honestly; it goes in the record as unexplained, not
    > relied upon, and HL-1's interpretation stays on the collected count as ruled.
    >
    > Then interpret my plain-tab result per the recorded rule (freed → instrument artifact, all
    > counted runs plain-tab with the driven tab as store-courier only; not freed → real product
    > finding, WebGL2 heap failure pre-explained), and run the counted session accordingly: WebGPU
    > then WebGL2, stops 1→2→0, ten alternating src-swap and remove/re-add cycles, final removal,
    > records to docs/plan/results/phase-2-hlife-records.json via the store route, fingerprints
    > re-checked on the repo copy, every record naming its tab kind. Announce anything that goes
    > hidden and redo it.
    >
    > My plain-tab result:
    >
    > READOUT — after teardown: idle heap 3135.1 MB; collected 3 of 12 (runtimes, renderers, splat
    > meshes) after 40 pressure round(s); NOT collected: runtime 0, renderer 0, mesh 0, runtime 2,
    > renderer 2, mesh 2, runtime 3, renderer 3, mesh 3
    >
    > DONE — 7 passed, 0 failed
    *Sixth follow-up (2026-09-27, OWNER RULED on STOP HF-1 — the whole message, quoted verbatim;
    what each part records is in ticket 13's Comments).*
    > Ruling on STOP HF-1: (A), as recommended. Fix the page so its main function names no runtime
    > (small helper functions), correct the lying header at hlife.ts:36 — a header that claims "no
    > references" while three variables hold runtimes is the same instrument-honesty defect as a
    > gauge that cannot move — then the full re-proof in your stated order: (1) RG-3's four faults
    > shown red on the NEW fingerprinted bytes, (2) a pane control whose READOUT then measures what
    > the PRODUCT keeps, (3) the owner repeats the plain-tab HL-1 check on the new bytes,
    > interpreted by the recorded rule (now with the partial case covered: state before the run what
    > counts as freed, not freed, and partial on the fixed page, so no result arrives
    > uninterpretable again), (4) the counted session.
    >
    > HL-1's status: accepted as proposed — it stays a candidate with its in-page evidence WITHDRAWN
    > as explained by HF-1, recorded that way with the withdrawal's grounds, its only remaining
    > support the bare-page console experiment. If step (2)'s pane control on clean bytes shows the
    > product retaining nothing, re-run the bare-page experiment once before ruling HL-1 out
    > entirely — a candidate should die on a measurement, not on a suspicion that its last leg was
    > also contaminated.
    >
    > The prediction-first test (writing "6 of 15" down before running it) is the standard for
    > cause-confirmation from here on; the record should show the prediction preceded the run.
    >
    > MR-1 and IH-1 dispositions stand as recorded. On IH-1 specifically: with HF-1 known, check
    > once on the fixed bytes whether the idle readout moves when it should (the page held ~3 GB of
    > runtimes — an idle reading identical to the byte across teardown was consistent with your page
    > pinning the heap; if it still never moves on clean bytes, that is its own small finding about
    > the readout's wiring).
    >
    > Then, per the standing order: the counted session, criterion 9's verdict, the AC4 12-item
    > verdicts, check:full, both review rounds reported separately, the single commit.
    *Seventh follow-up (2026-09-27, the owner's GO on the fixed page's plain-tab result — quoted
    verbatim: IH-1 left unchanged and recorded as a wiring finding, HL-1 RULED OUT on 12 of 12, the
    second bare-page run noted as a proper supersession, the counted session ordered; detail in
    ticket 13's Comments).*
    > GO — my plain-tab result on the fixed page is at the end of this message, to be interpreted by
    > the recorded rule (12/12 freed → all counted runs plain-tab with your driven tab as courier;
    > 0/12 → real product finding, driven runs as planned; partial → treated as not freed, pattern
    > recorded).
    >
    > Two rulings folded in:
    >
    > IH-1: leave the readout unchanged, exactly as you reasoned — nothing relies on it, and
    > re-touching the page would force another re-proof cycle for a gauge that is now understood.
    > Record it as a wiring finding (reading taken inside the ~50 ms performance.memory refresh
    > window, before cleanup) with the probe evidence, and add "re-place the idle-heap reading" to
    > the post-ticket small-changes list.
    >
    > HL-1 rule-out: accepted as proposed — if my result reads 12 of 12, HL-1 is RULED OUT, recorded
    > with its full evidence chain (in-page evidence withdrawn under HF-1; bare-page leg explained
    > by the probe's own scope flaw, bp-2 clean with prediction-first; plain tab clean on fixed
    > bytes). Anything other than 12 of 12 and it stays a candidate with the new pattern recorded,
    > and the counted runs proceed under the partial=not-freed rule.
    >
    > Your second bare-page run despite my "once" was right, and the record shows why it was right:
    > the first run's instrument was the thing being tested, and you changed only the flawed part
    > with the prediction written first. That supersession is noted as proper.
    >
    > Then the counted session per the standing order — WebGPU then WebGL2, stops 1→2→0, ten
    > alternating src-swap and remove/re-add cycles, final removal, records to
    > docs/plan/results/phase-2-hlife-records.json via the store route, fingerprints re-checked on
    > the repo copy, every record naming its tab kind, hidden runs redone. After it: criterion 9's
    > verdict, the AC4 12-item verdicts, check:full, both review rounds reported separately, the
    > single commit.
    >
    > My plain-tab result:
    >
    > READOUT — after teardown: idle heap 2260.7 MB; collected 12 of 12 (runtimes, renderers, splat
    > meshes) after 3 pressure round(s)
    >
    > DONE — 7 passed, 0 failed
    *Eighth follow-up (2026-09-27, OWNER RULED on the six close-out decisions — the whole message,
    quoted verbatim, each paragraph byte-identical to it: R1-F1 to the post-ticket list; R1-F2, the
    RSW-1 stakes corrected a second time; R2-4 to R2-7 to the post-ticket list, R2-8 a caveat; AC4's
    deferrals confirmed; the Phase 0 bar kept, C-1 a dated note; the hook briefs untouched; ticket
    12's status line authorized. Detail in ticket 13's Comments).*
    > Read .scratch/handoffs/016-2026-09-28-t13-close-out.md in full — the authoritative entry state — then verify the tree matches its inventory (22 plain status lines after the handoff commit; the four hook-written compaction briefs are never staged). Work only ticket 13's close-out. Last commit 3efdae9. The owner's six rulings on the decisions block (ticket 13:2785-2793, sha256 e208d380…) follow — record them verbatim first, in ticket 13, doc 06, PLAN.md.
    >
    > 1. R1-F1 (b): the stop-check fix goes on the post-ticket small-changes list. The committed page stays byte-identical to what the counted runs used, and the records already show every arrival reaching rest (2,951-3,211 ms).
    >
    > 2. R1-F2: YES — correct the RSW-1 wording now, in the six spots you located (source comment + the record notes; the owner's verbatim ruling quotes are never edited — dated notes beside them). New wording per your verified model: no effect at or below 10 fps, ~2x from 10-20 fps, up to ~3x just above 20 fps. Old wording kept visible, dated notes, the source comment keeps its five-line length so no citations shift. The record notes that this is the SECOND correction of the same comment and that both wrong versions passed through the owner's rulings — the W1 no-retune decision itself stands because the trials ran at 2-10 fps where the ratio is exactly 1.0. Re-run check:full after.
    >
    > 3. R2-4 through R2-7: post-ticket harness fixes on the small-changes list. R2-8 stays recorded as the caveat on AC4-1 and AC4-7's traversal counts.
    >
    > 4. AC4: the proposed deferrals are CONFIRMED as recorded in the ticket's table.
    >
    > 5. C-1: keep the Phase 0 bar, with the dated note that WebGL2-default's "match" is 321.1 ms behind the same-day spike. The control is never a new bar (ruling 1 stands); the bar's re-dating belongs to owner item 5.
    >
    > 6. The four hook briefs stay exactly as they are — untouched, uncommitted, never staged.
    >
    > Also authorized: flip ticket 12's status line from ready-for-agent to done with a dated note citing 70dbd22 (the gap you flagged) — it is record hygiene inside an already-modified file, part of this commit.
    >
    > Then close out in the handoff's order: tick ticket 13's ACs and set Status: done; re-run npm run check:full and report the true exit code; show me the staged file list — the 26 files per the preview at ticket 13:2796-2825 plus any lines these rulings just touched, the four hook briefs excluded, stop on anything stray — and after showing it, commit under the standing delegation with a message in the established style. No credit lines of any kind. Explain the git output in plain English — the owner does not use git.
    *The same session, two scope answers on ruling 2 (the owner's choices, verbatim):* "Yes, note
    beside each (Recommended)" — a dated note beside each verbatim quote of the RSW-1 / W1 ruling
    that carries the wrong stakes (the third follow-up above, ticket 13, PLAN.md), outside the
    quote; "Yes, dated note there too (Recommended)" — a dated note beside stop W1's own RSW-1
    arithmetic in ticket 13.

**sRGB constraint — ACCEPTED (2026-08-20, ticket 03 close):** with the doc 04
sRGB working space set (core/colorSpace.ts), assigning
`renderer.outputColorSpace` on a CLASSIC WebGLRenderer throws inside three —
self-enforcing at the offending line; WebGPU path unaffected. The mandate
stands; Phase 5 (optics) inherits this knowingly. Detail: colorSpace.ts +
ticket 03 Comments.

## Upstream watch list (checked at every phase boundary)

Events that shrink or delete our work — prefer deleting our code when one lands:
1. **Native paged/streamed splat API or `.rad` loader in three.js** — deletes most of
   §A; the single verdict-scale event.
2. `GaussianSplatMesh` gains append/resize/fixed-capacity — pager stops needing fork
   buffer access.
3. Public storage-buffer access + invalidation hooks — EditLayer legitimizes.
4. Real `dispose()` — delete our teardown patch.
5. Splat raycast/picking — delete §B.
6. Public node factories / material extension hooks — DoF and glow without fork.
7. Global cross-mesh sorting — deletes accepted regression §H1.
8. WebGL fallback sort off-main-thread — fallback risk shrinks.
9. Loader workers/incremental decode — first upstream streaming signal.
10. Addon TS declarations ship — drop the reliance on `allowJs` JSDoc
    inference for the vendored addon and reconcile against upstream's own
    declarations (no `three-gs.d.ts` exists to delete — owner ruling
    2026-08-19, ticket 01, doc 03 §F).
11. WebGPU PostProcessing stabilizes documented grade patterns — SceneGrade risk
    shrinks. **Checked 2026-08-21 (ticket 10 start), against the pinned
    0.185.1 install (verified by direct import against node_modules, not
    docs):** `PostProcessing` class present in three.webgpu.js; `three/tsl`
    exports every primitive the grade shader needs (`pass`, `renderOutput`,
    `uniform`, `texture3D`, `mix`/`dot`/`smoothstep`/`distance`/`clamp`/
    `fract`, `time`); `examples/jsm/tsl/display/` ships ~40 display nodes
    including `SMAANode` (the SMAAPass analog) and `Lut3DNode`. Risk
    assessed as materially shrunk; ticket 10 proceeds on this surface.
12. Addon moves examples/jsm → core — API stability signal. **This event has
    NOT fired.** (Related churn, not the watched event: 2026-08-19 upstream
    renamed the class and file within examples/jsm — a path + class-name
    change the re-diff must handle; hash/PR/r186 detail lives in
    src/vendor/three-gs/FORK.md's "Known upstream drift" list.)
13. r186 publishes — re-verify every file:line in doc 03 at the next phase
    boundary after it lands ("before Phase 1" is moot — Phase 1 is underway),
    and apply item 12's rename at publish (detail in FORK.md's drift list).
    **Checked 2026-08-19: NOT published** (`npm view three version` → 0.185.1).
    **NAMED GAP tied to this item (ticket 03, owner-ruled 2026-08-29): SPZ
    monolithic loading.** three 0.185.1 ships no SPZLoader (verified: only
    PLYLoader.js in examples/jsm/loaders); SPZLoader arrives with r186. The
    seam's `load()` is typed for `spz` but that branch throws a named refusal
    citing this item. When r186 lands, SPZ becomes a plain
    `three/addons/loaders/SPZLoader.js` import in ThreeGsBackend — never a
    vendored copy (rejected: permanent fork surface for a format with no
    current consumer, obsolete within one upstream release).
    The vendored dev-branch `GaussianSplatMesh` addon stays as-is, and doc 03's
    citations stand against 0.185.1. Re-check from this point at the next phase
    boundary — not from scratch.
14. Spark adds WebGPU or a public pager contract — reshapes the comparison but not
    this repo's course (D0.1/D0.2 stand unless you reopen them).
15. COPY mass complete (Phase 6) — revisit re-enabling `noUnusedLocals` /
    `noUnusedParameters` in the root tsconfig. Dropped 2026-08-19 (owner
    ruling, ticket 01): sparkjs-toolkit never had them (strict only), so they
    collided with spec rule 5's byte-identical COPY — 14 files under src/ +
    9 under examples/ fail them. Once the copies are landed and diverging is
    permitted, the hygiene flags can return.
