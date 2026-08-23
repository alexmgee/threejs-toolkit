# 06 — Author UI cluster

**What to build:** the authoring panel and its inspector/tab family,
compile-closed given 04 and 05. The panel opens standalone against a
SiteConfig fixture. 23 files / ~8,085 lines. (Header counts predate the
closure rulings — the delivery is 28 files; see Comments/D21 third note.) Read `../spec.md` first.

**Files:** all of `site/authorui/` (plus the `tokens.css` asset for the `?raw`
import), `site/AuthorPanel`, `site/AuthorGizmo`, `site/authorPanelTypes`.

**Blocked by:** 04, 05

**Status:** done

- [x] Every COPY file byte-identical; `site/AuthorGizmo`, `site/authorPanelTypes`
      and `site/authorui/textInspector` (the three-only files) carry only their
      doc 01 adaptations ("three math/types only; near-COPY"), declared in
      Comments (reality outgrew the wording: ZERO adaptations were needed —
      all three land byte-identical)
- [x] The `tokens.css` asset is copied and the `?raw` vite import resolves
- [x] The author panel opens against a SiteConfig fixture and its tabs render
      (no scene required; SceneComposer wiring is Phase 3)
- [x] `npm run check` green

## Comments

**2026-08-23 (execution session):**

**Copy vintage: sparkjs commit `fd67153`** (D21 as amended). All 25 cluster
paths (22 under site/authorui/ incl. tokens.css + css.d.ts, plus
site/AuthorPanel.ts, site/AuthorGizmo.ts, site/authorPanelTypes.ts) copied
via `git show fd67153:<path>`, each verified byte-identical against the pin
(zero mismatches); the destination hash-set equals the sparkjs working-tree
hash-set for these files (no drift). PLUS the three RULED closure files
below.

**OWNER RULINGS taken during this ticket (full trail in doc 06 D21 THIRD
NOTE, dated 2026-08-23):**
1. `src/rules/RuleAuthoring.ts` copied at the pin — rulesPane value-imports
   ~20 of its functions; the two were born coupled in sparkjs `7599471`,
   so the cluster was never compile-closed without it. Declared, not
   silent.
2. `src/rules/RuleModel.ts` (LANDED ticket-04 copy) re-pinned to
   `fd67153` — the pane needs its newer exports; verified strict export
   superset (nothing removed) before the swap; ruling conditional on the
   consumer proof below.
3. CATEGORY RULE (owner-approved) for any further landed file the closure
   requires: superset check → byte-identical swap + SHA → consumer proof;
   `src/site/SiteConfig.ts` swapped under it (pin adds conjuredCopyId /
   conjuredCopyBlock; strict export superset verified; 192 diff lines).
   No further files needed — the closure completed with these three.
   `src/rules/DisplayChannel.ts` deliberately stays at ticket 04's vintage
   (only other rules/site file differing from the pin; untouched by this
   closure).

**SHA-256 at copy time (destination files, pin fd67153):**
```
7929d6ac5fae9107f91915047cff0b3c57c5464fbec904a6dbe4475b1e3f3b88 src/site/authorui/boxInspector.ts
1bf8054e541e16487d9fabce58ca02dd45d38e0da5ddd75d02eeacd2f5bfb854 src/site/authorui/contextSim.ts
a629bb50adfb90dd80ced7ac6a47e6c079518052cf6aa17996c21f69d0ee854c src/site/authorui/css.d.ts
ae5e7fb5100e8aff18e0abe029f6b979069a987a2376eb5277b788d81a281732 src/site/authorui/fontsBrowser.ts
1770238de8098e13cec6708f6253ce78c9d49a49d8fae5831911bbf0d54fb741 src/site/authorui/hotspotInspector.ts
e252b378d9bf097edeb79bc6739abff637b3d170f35133566e8b370b15dbc8c7 src/site/authorui/inspector.ts
f6b50200618f2349946a2cadf2abf71910b6200a60360add23c35bc6d390e80d src/site/authorui/paneKit.ts
bc15997522c3b2fbf7f286f68a81336ec03f75d7df8d620c53d4cd86a43fd41e src/site/authorui/primitives.ts
775c113c4726fef835cbec8956dfe7ca4ee7f0d2eaf1d5f9cc31b3cb2e29a1b5 src/site/authorui/propInspector.ts
c4aa4d02ffe50649edd3c0bd493a8beeeb6bd138dbfbc99b9ca19ce1388fe9b2 src/site/authorui/rulesPane.ts
df00ee94ecad32e9e03c29537eb07a1ce4fca66f18e48963449df1f066cd2762 src/site/authorui/shell.ts
36b37f5df90022051e1efb9e22669ebf616f6e5158668dd3e31016cbfa07e79e src/site/authorui/stopInspector.ts
d445967a70145219e6e3e272f8580cdafca48ad3cb29333bcea9a82f5680b5d0 src/site/authorui/tabBoxes.ts
8ef9488e8c650bf8aaf3064d7a856128b25acb0ae360c4ea4489b8d6dc300a0b src/site/authorui/tabContext.ts
7977707056fe325733b69780fdf97dbd53bf4b2cb3526cc149857c4b6f92202e src/site/authorui/tabHotspots.ts
68719cb00cfcdaa8bc542a8462749dfcc0b341ae9c11a06f83f0c5869dfda4fd src/site/authorui/tabLook.ts
17b47666f6e37884a067f0a9b7ebe5e41bfa4d82de61ea9f22776d4aa44a0b8c src/site/authorui/tabObjects.ts
efa9bc41df4da47969b3837c4fabef18285fb0cf417ee89ad7eb6d7bb82541d3 src/site/authorui/tabScene.ts
067f477c1d23e209037f42338dd3292d182dc7eba40658cc78e9309d53205711 src/site/authorui/tabText.ts
e62e875fa466200697fd88d1ce139a1abdf22f593d7b1795e967fbc95e8befd4 src/site/authorui/tabTour.ts
10a5b47b47a43c1c5258efe45801fee00be3ffabff6b3921c50982cec7187575 src/site/authorui/textInspector.ts
59648fc99e408148792b4fe289b4bc70a1e59a8b4d54e61d9a53f6cb38c3eadd src/site/authorui/tokens.css
f323d349c52a18dbf053e19342b43a385a1ba51cfc70783b95f37cd6fe5c514c src/site/AuthorGizmo.ts
868a25087a5379ddf1f592a0d4cc8c48abd3dec368c1446df9d944bc58931551 src/site/AuthorPanel.ts
e6cf4aa381e66348cc81a4d3cbaf504eaffc2bc1701c4c1a7eea5d9b3f8a2701 src/site/authorPanelTypes.ts
d69e466ffc96101b1c7d5c6a399843a5d232a971a338feb13dca35278b5c3608 src/rules/RuleAuthoring.ts
83014e7fe0ac0c459eb1da23e8e9f71b1013df82b0cf52381763c9806c529b43 src/rules/RuleModel.ts
f34e134cadde264470892924a6c81f06543b7dfa3f76480bcc9f8aa10f0f1f0b src/site/SiteConfig.ts
```
(Hash discipline note: every hash above was computed on the DESTINATION
file after a byte-identity diff against the pin.)

**Zero adaptations.** Doc 01's three-only "near-COPY" files (AuthorGizmo,
authorPanelTypes, textInspector) needed NO edits — all 28 files land
byte-identical; the gate was green with no file modified once the three
ruled closure files were in.

**Consumer proof (the RuleModel/SiteConfig rulings' condition — all held):**
- diag selfTest re-run in-browser: `SELF-TEST: 20/20 PASS` (unchanged).
- text-lab re-run: `8 lines · block height 192px`, 8 ptx rows, red D19
  stub error, backend webgpu (recorded evidence unchanged).
- media re-run: `[147,12,12,255]` / `[17,17,51,255]`,
  planeInstalled+planeVisible true (baseline unchanged).

**Fixture (new, examples/author/):** the panel opens STANDALONE against a
minimal SiteConfig fixture (one stop; inert getCameraState/pickPoint
stubs; onChange logs). vite.config.ts gains the author page. Runtime
evidence: `report.phase: "open"`; all 7 tabs render with icons + titles
(Tour, Hotspots, Text, Objects, Boxes, Appearance, Scene); clicking every
tab renders its content with ZERO console errors (Tour shows the fixture
stop "Front — yaw 0 / pitch 15 / dist 10"); tokens.css `?raw` import
RESOLVES (25,321 bytes — 25,155 UTF-16 chars — installed as a head <style>; shell computed
background rgb(230,231,228), not UA default).

**Rules pane: RUNTIME-PROVEN (the earlier "declared limitation" was
WRONG — gpt5.6-sol's finding, verified by execution):** with the seeded
annotation the pane is reachable without any pick flow: Hotspots → the
marker row opens the inspector (Marker | Rules | Copy | Appearance |
Actions), whose Rules section renders rulesPane; "Add rule" builds
"Rule 1 — when activated" with the full conditions UI (Engagement /
Disengaged / Tour / Explore / At stops …) through the ruled
RuleAuthoring closure (newRule et al.), with draft-not-committed
semantics intact (site.annotations[0].rules stays unset until commit)
and ZERO console errors.

`npm run check` green (exit 0, redirect-then-`$?`).

**2026-08-23 — adversarial review, Opus round (each finding re-verified in
this session before acting; gpt5.6-sol and grok-4.6 recorded when landed):**
- CONFIRMED, RECORD CORRECTED (#1–#4, the important ones): the swap
  rulings' grounds overstated what the superset test proves. The pin's
  SiteConfig/RuleModel carry SEMANTIC changes inside existing symbols
  (normalizeSiteConfig seeding/recognizer/throw changes; a new
  duplicate-show-blocks validation throw; the RuleModel-new/
  DisplayChannel-old split leaving authored `lifetime`
  validated-but-ignored). What actually guarantees no regression today —
  re-verified by grep in this session — is that NO landed runtime consumer
  exists: normalizeSiteConfig has zero callers, all landed SiteConfig
  importers are type-only, DisplayChannel has zero importers (its three
  mentions are comments). The D21 third note now carries this HONEST BASIS
  CORRECTION plus the Phase-2/3 inheritance list; Phase 2's re-sync must
  close the DisplayChannel half of the lifetime split first.
- CONFIRMED & FIXED (#5): the fixture comment promised an annotation the
  data lacked — one annotation added; the Hotspots tab now renders its
  marker row (re-verified: hasMarkerRow true, all 7 tabs, zero console
  errors). Remaining tabs render empty states — declared.
- CONFIRMED & FIXED (#6): tokens.css evidence said 25,155 BYTES — that is
  the UTF-16 char count; the file is 25,321 bytes (both now recorded).
- CONFIRMED & FIXED (#7): the `as SiteConfig["stops"][number]` cast was an
  inert tripwire-disabler — removed; the literal typechecks bare.
- CONFIRMED & FIXED (#8): the `#host` lookup sat outside the try — moved
  inside with an explicit throw; the catch now re-looks-up its mount.
- CONFIRMED & FIXED (#9): stale header count annotated (delivery is 28
  files; Comments/D21 note are authoritative).
- CONFIRMED & FIXED (#10): the three-only AC ticked without annotation —
  now annotated (zero adaptations; all three pin-identical).
- Opus verified TRUE by command: all 28 SHAs, byte-identity, no sparkjs
  drift, the seven+three pin-identical claim, DisplayChannel-only
  divergence, strict export supersets (RuleModel 27→36, SiteConfig 31→33,
  zero removals), 192-diff-line figure, typecheck and depcruise exit 0.
- Post-fix: gate green (exit 0); fixture re-run `phase:"open"`, 7/7 tabs,
  zero console errors.

**2026-08-23 — gpt5.6-sol (high) round:** swap safety: none; SHA/inventory/
graph claims: none. One fixture finding, CONFIRMED and converted to
evidence: the "Rules pane needs the pick flow" limitation was false — the
seeded marker reaches the full pane (proof above replaced the limitation
paragraph). The reachable path is now tested, not declared away.

**2026-08-23 — grok-4.6 round (post-fix tree; re-verified before acting):**
- CONFIRMED & FIXED (#3.1): the D21 note said all three swaps were
  "verified a strict export superset of the replaced copy" — RuleAuthoring
  is a NEW file (git confirms: not in HEAD pre-swap), so the claim applies
  to RuleModel and SiteConfig only; wording corrected in the note.
- CONFIRMED, DECLARED (#2.1): the fixture's dev hook records
  `report.phase` only — the constructor renders the Tour tab; the other
  six tabs render on click, and the click-through is HARNESS-DRIVEN (this
  session's browser runs, quoted verbatim above), not recorded by the
  hook. Anyone re-verifying must repeat the click-through, not read the
  hook. (grok traced each render* clean on this fixture — the tab strip
  is eager; only content bodies are click-built.)
- grok independently re-confirmed: the zero-runtime-consumer basis
  (normalizeSiteConfig/validateAnnotationRules no landed callers; all
  landed SiteConfig importers type-only; DisplayChannel/ModeLocks zero
  importers; the fixtures import none of the swapped modules — "they
  cannot observe the semantic edits; they also cannot regress from
  them"); all 28 SHAs; dest==pin==sparkjs-tree; the seven+three
  pin-identical enumeration; DisplayChannel as sole divergent file (6354
  vs 12716 bytes); the 192-line diffstat; tokens.css 25,321 bytes /
  25,155 chars; depcruise exit 0.
