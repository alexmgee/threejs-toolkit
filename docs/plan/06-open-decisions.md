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
