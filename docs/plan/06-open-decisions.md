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

**D14 — Embed bundle + WASM: inline or side-load?** [Phase 2]
The single-file embed build must carry the decoder. Inline = bigger file, zero extra
requests; side-load = extra request, cacheable. *Assumption: side-load with
integrity hash; revisit with real size numbers.*

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

**D19 — DECIDED (2026-08-19): `ui/SplatTextMesh` ships in Phase 1 as an
API-preserving typed STUB** inside the text cluster ticket, so
`text/SplatLane.ts` compiles unchanged (doc 01: "SplatLane unchanged *if*
SplatTextMesh keeps its API"). The stub throws on construction with an explicit
"rebuilt in Phase 4 (doc 03 §E)" error. Phase 4's rebuild deletes and replaces
it — same delete-and-replace obligation as D18. Never left beside real code.

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

**D22 — PARTIALLY RULED (2026-08-20): the renderer TYPING half was assigned
to ticket 03 and is DONE** (one-line widen to `WebGLRenderer |
WebGPURenderer`, type-only import, declared adaptation). **The dead-fields /
~10-construction-literals half remains OPEN and unassigned:** doc 01:92
requires "2 dead fields, ~10 construction literals" for CameraSystem, and
no ticket in the cut owns those edits (grep-verified across all 11; ticket
04's AC scoped its adaptation to picking only). The typing obstacle is
RESOLVED — the field now takes WebGPURenderer. Needs an owner assignment.
Detail: ticket 04 Comments (registration) + ticket 03 Comments (the widen).

**D23 — OPEN (2026-08-20): boundary-rule gaps surfaced by ticket 04's
review, owner call on whether/where to guard:** (a) examples/ may legally
import src/backend and thus the re-exported fork-mesh TYPE (the seam's
public door — tightening is a design choice); (b) src -> examples is
cruised but unguarded (fixture code could become load-bearing); (c) vendor
-> src is unguarded (a fork patch could reach into toolkit code, corrupting
re-diff purity); (d) spikes/ is outside the cruise set entirely (spike ->
vendor internals invisible). Detail: ticket 04 Comments.

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
