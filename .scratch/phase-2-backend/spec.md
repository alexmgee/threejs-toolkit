# Phase 2 — Backend + production pager + load contract

Source: `docs/plan/04-build-order.md` Phase 2 (≥114 adapt points, GATE) · seam and
pager architecture in doc 02 · full capability specs in doc 03 §A (A1–A5) and §G ·
inheritance list in `.scratch/handoffs/004-2026-08-23-phase1-closed-phase2-entry.md`.
Breakdown approved by the owner 2026-08-23 after quiz.

**Exit (doc 04):** H-LOAD re-run on the production runtime matches or beats the
spike; H-LIFE (load→dispose→load ×N, memory flat); a real site.json drives the whole
element end to end on both backends. **GATE:** regression vs the spike's own numbers
⇒ the integration (not the concept) is at fault; find it before anything stacks on top.

## Ticket map (13 tickets; blockers in parentheses)

01 DisplayChannel re-sync (—) · 02 WASM worker + lib packaging (—) ·
03 seam + monolithic path (—) · 04 fork patch 1: dispose+capacity (03) ·
05 fetch + 4-worker decode pool (02, 03) · 06 page residency (05) ·
07 LOD + selection + culling (06) · 08 §A5 contract into SplatSiteElement (03, 06) ·
09 SiteRuntime re-typing (01, 04, 08) · 10 D22 CameraSystem micro (—) ·
11 StatsHUD + SplatBounds (07, 09) · 12 diagnostics rewired §G (07, 09) ·
13 Phase 2 exit evidence (11, 12).

Frontier: 01, 02, 03, 10 — but ticket 01 is worked first by owner mandate (handoff
004: the lifetime trap is Phase 2's opening move). One ticket at a time; unlocked ≠
authorized; each start is an explicit owner go.

## Standing rules (restated for cold contexts; they bind in every ticket)

- **Copy vintage:** every copied file comes from sparkjs commit `fd67153` via
  `git show fd67153:<path> > <dest>` — never from disk (the owner edits sparkjs
  continuously). Diff back against the pin; hash the DESTINATION tree (cwd traps in
  handoff 004 §TRAPS). sparkjs is PERMANENTLY read-only.
- **Vintage map:** doc 06 D21 THIRD NOTE's final inventory is the authoritative
  record of what landed at which vintage; handoff 004 summarizes it. After ticket 01
  lands, `src/rules/DisplayChannel.ts` joins the at-pin set and the map is closed.
- **Runtime proof standard:** both backends wherever rendering is involved (WebGPU +
  `?webgl=1`); evidence quoted verbatim in the ticket's Comments; "it builds" proves
  nothing. Behavior verification is Claude-or-human only; artifacts, not exit codes.
- **Review order after green:** adversarial review first (agent-collab recipes),
  then built-in /code-review, reported separately. Every external finding is
  re-verified with real commands — confirm-or-refute, never absorb.
- **Commits:** the owner commits, unless a run explicitly grants scoped delegation
  (staged-list-shown-first). Never commit .collab-logs, dist, node_modules.
- **Rule-11 stops:** any decision the spec/docs leave unsettled → stop and ask the
  owner before building either reading. No time estimates, ever.
- **Gate:** `npm run check` TRUE exit code (redirect to file, echo $?, never pipe);
  iterate to fixpoint — tsc reports in waves.

## Entry-condition records (2026-08-23)

- **three version (watch item 13):** `npm view three version` → **0.185.1** on
  2026-08-23. r186 (carries the GaussianSplat rename, PR #34306) is NOT published.
  three stays pinned 0.185.1; re-check at the next phase boundary.
- **Spike audit:** gpt5.6-sol read-only audit of `spikes/native-rad/` vs doc 03 §A,
  log at `.collab-logs/codex-spike-audit.md`. Key confirmed gaps, each owned by a
  ticket: no opacity-sigmoid decode path exists in the crate (grep-verified —
  which encodings are sigmoid-coded must be resolved against Spark's `rad.rs` in
  ticket 02); SH packed to u32 in JS, not the worker (02); single decode worker
  (05); no retry/pages-unavailable (05); capacity derived from GPU limits but no
  device-memory-class policy (06); `setBinNode` ignores `center.w` (07); progress
  counts only first-uploads, not the completed-work model (06); no
  whenReady/onReady/onLoadProgress/reveal (03 monolithic / 08 paged).

## Owner rulings taken at breakdown (2026-08-23)

- **Anisotropy:** MediaLayer stays at parity (anisotropy 1) in ticket 09. The
  `getMaxAnisotropy()` upgrade is a post-parity improvement candidate — recorded
  with the other improvement items (ticket 13's carried-forward list), not a 09
  change.
- **D14 (embed WASM inline vs side-load):** ticket 02 measures both and STOPS for
  the owner's ruling with numbers in hand. Not an implementer decision.
- **D23 reconciliation:** ticket 04's era ruling covered the examples-side edges
  only (examples/ added to the cruise set and to `vendor-seam-only` +
  `no-spike-imports` — see `.dependency-cruiser.cjs` comments). Still genuinely
  unguarded: (b) src→examples, (c) vendor→src, (d) spikes/ uncruised. Ruling:
  ticket 03's ACs implement the vendor→src / fork-internals guard (c); (b) and (d)
  stay accepted-unguarded with reasons recorded in ticket 03's Comments; (a)
  examples→src/backend stays open-by-design (the seam's public door).
- **Percentile clamping:** stays Phase 4 (doc 04:144). Ticket 11 tests bounds
  against the independent resident-page union instead.

## Latent semantic changes Phase 2 activates (doc 06 D21 third note)

Safe today only because no landed runtime consumer exists. Ticket 09 must prove,
with runtime cases plus passing controls:
(a) pin `normalizeSiteConfig` THROWS on an authored `annotation-<id>-copy` block id
and no longer mints annotation-copy seeded blocks; (b) pin RuleModel THROWS on
duplicate show-blocks effects; (c) authored `lifetime` runs for real once ticket 01
lands DisplayChannel at the pin.

## Review provenance of this breakdown

Drafted by an Opus subagent; spike audited and the draft adversarially reviewed by
gpt5.6-sol at high effort (logs: `.collab-logs/opus-draft.md`,
`codex-spike-audit.md`, `codex-plan-review.md`). Review findings were re-verified
against the docs/spike before absorbing (sigmoid gap grep-confirmed; register/
diagWiring.stub deferral confirmed at doc 04:23–24; percentile-clamp phase confirmed
at doc 04:144). **grok was unavailable — 402 "Grok Build usage balance exhausted"
(2026-08-23); two reviewers is the floor met here, and grok rejoins the rotation
when funded.**
