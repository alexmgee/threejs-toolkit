# 04 — Foundation cluster: domain base + camera + SiteConfig hub

**What to build:** the compile-closed foundation everything else stands on —
the renderer-agnostic domain model, the camera family, and the SiteConfig hub
(imported by 24 other files). 32 files / ~13,243 lines, graph-verified closed.
Read `../spec.md` first; re-verify closure with `python ../graph-check.py`
after any scope change.

**Files:** all of `cells/` (9), all of `rules/` (9 — Channels and RuleModel are
a cycle, land together), all of `locative/` (2), `site/AnnotationMeta`,
`text/TextModel`, `text/FontRegistry`, `core/LoadingUI`, `render/AudioPlayer`,
`core/CameraSystem` + `core/CameraPath` + `core/CameraRail` + `core/ScrollRail`,
`site/SiteConfig`, `site/HotspotSeeder`, `site/InteractionsImport`.

**Blocked by:** 01

**Status:** done

- [x] Every COPY file byte-identical to its sparkjs-toolkit source (`diff` empty)
      *(TIME-DEPENDENT tick: true at copy time 03:02:31 and pinned by the
      SHA-256 list below; the SOURCE has since drifted for RuleModel,
      DisplayChannel, SiteConfig — see D21, doc 06. Do not re-run this
      diff as regression verification without reading D21 first.)*
- [x] `core/CameraSystem.ts` is the one adapted file: its spark-value import is
      removed and the picking/recenter dependency left explicitly dead with a
      doc 03 section B citation (the seam returns as `backend.raycast()` in
      Phase 3); every other behavior untouched; the divergence declared in
      Comments
- [x] The PLACEHOLDER `src/core/index.ts` is DELETED as the real core files
      land — never left beside them
- [x] `vite.config.ts` is REPOINTED off `src/core/index.ts` when that file is
      deleted (owner ruling 2026-08-19, ticket 01) — the site build's scaffold
      entry dies with this ticket, and `npm run check` now runs both builds,
      so leaving it stale fails the gate loudly
- [x] The camera-rail parity fixture (from sparkjs-toolkit examples) is copied
      and runs — it needs no splats *(landed as a declared ADAPTATION per
      owner ruling 1 below — "copied" is not byte-copied here)*
- [x] `npm run check` green

## Comments

**2026-08-20 — owner rulings taken before/while building (repo rule 11):**
1. Fixture = ADAPTED with authored stops (R5's byte-identity binds the 32
   src/ COPY files only; examples/ fixtures are adaptations by design). When
   ticket 03 lands ThreeSplatScene, repointing the fixture's bootstrap is
   ticket 03's or 08's business.
2. vite.config.ts repoints to a PAGE build of examples/rail/index.html
   (sibling shape); ticket 11's barrel is the lib surface, not the site
   entry (comment carried in the config).
3. This ticket creates examples/ → depcruise scope extended to cover it
   (fixtures may import src entry surfaces, never vendor/three-gs internals
   or spikes/). Proven: clean pass / planted violation fails naming the rule
   / clean pass.
4. Channels <-> RuleModel upstream cycle: scoped no-circular exception for
   exactly that pair (divergence-of-RULE, not of file). WHY harmless:
   RuleModel's side is `import type` (RuleModel.ts:25-27, upstream's own
   comment) — the cycle exists only in the type graph, counted because
   tsPreCompilationDeps:true deliberately counts type edges. Proven the
   narrowed rule still bites: planted NEW two-file cycle → exit 1 naming
   no-circular; removed → exit 0.

**2026-08-20 — divergences declared (spec rule 5):**
- core/CameraSystem.ts (the one sanctioned adapted file): (a) line 18
  `import { SplatMesh } from "@sparkjsdev/spark";` REMOVED; (b) the
  depthPick splat-raycast pair (`const hits = this._raycaster.intersect
  Objects(...)` + `const splatHits = hits.filter(... instanceof SplatMesh
  ...)`) replaced by `const splatHits: THREE.Intersection[] = [];` under a
  DEAD comment citing doc 03 §B (returns as backend.raycast() in Phase 3).
  No splat hit is possible; depthPick always takes its pre-existing
  view-plane fallback. Everything else byte-identical to source.
- examples/rail/main.ts is an ADAPTATION (ruling 1). Source sha256
  391ffd2ab582a1b878f72e0bb8a6a0b2995646c1eccf4a8abcdcec145c015c34.
  Strips: SparkScene (inline plain-three WebGL bootstrap instead —
  CameraSystemConfig requires a WebGLRenderer), loadSplat/splat management
  (Phase 2), DebugPanel (Phase 3), shared/splat-input (no Phase 1 ticket),
  back-link (no hub page yet). Adds: 3 authored rail stops (source shipped
  stops: [] and authored live via DebugPanel), placeholder wireframe
  meshes + grid, ResizeObserver sizing MIRRORING SparkScene.ts:233 (a
  window-resize listener alone left the canvas 0x0 when the module ran
  before first layout — found and fixed during browser verification),
  window.__railFixture hook — DEV-only via import.meta.env.DEV (doc 05
  harnesses drive fixtures programmatically; also enables headless
  verification where rAF pauses; the guard keeps the live global out of the
  built artifact). Post-review fixture refinements (all mine, declared):
  LoadingUI removed (construct-then-hide flashed a phantom overlay; it adds
  back with a real load flow in later tickets), markers now DERIVED from the
  rail stops' pivots (they had silently duplicated the coordinates), sizing
  is a zero-guarded immediate seed + ResizeObserver authority (the original
  unguarded manual sizing had an Infinity-aspect edge at h=0; RO-only was
  tried and reverted — see the sizing note below), and the
  stop with orbitLimits carries a LATCH NOTE (frozen CameraRail semantics
  never restore limits on leaving — visit-order-dependent; harnesses must
  pin visit order). Undeclared-knob note: the bootstrap uses antialias:true
  + uncapped devicePixelRatio, DIVERGING from SparkScene's splat-tuned
  antialias:false + capped ratio — fine splatless, must NOT be carried into
  a real splat scene at the ticket 03/08 repoint.
- examples/rail/index.html adapted (source sha256
  1262daf6d54b87470ddc526d8ae87de1e2e5792c251131e090ed4538b6ff59df): title,
  back-link removed; stylesheet link kept.
- examples/shared/sandbox-styles.css byte-copied (diff empty, sha256
  f2494ff69d79a6c5cc3e5c6158e096d817b61615bb6137a475ba0a0127b4b9e1).
- package.json: `dev` script added (vite) + .claude/launch.json — needed to
  run the fixture for behavior verification.
- lint:boundaries now cruises `src examples`.

**2026-08-20 — verification evidence:**
- All 32 COPY files diff-empty against the sparkjs working tree at copy time
  (R5), then CameraSystem adapted as declared above.
- Gate (final state): npm run check TRUE exit 0 — typecheck + boundaries
  (43 modules / 59 deps) + page build rail-*.js ~557 kB + embed 0 kB.
  Coverage stated precisely: the site build BUNDLES the fixture's reachable
  graph only — CameraSystem and CameraRail (CameraPath's edge is `import
  type`, erased; ScrollRail is imported by nothing — the fixture rolls its
  own wheel handler; LoadingUI was removed from the fixture post-review).
  ScrollRail AND LoadingUI are copied-but-unexercised in Phase 1; the other
  30 files are covered by tsc --noEmit only (tsconfig includes
  examples/**/*.ts, so the fixture is typechecked too) — a typecheck gate,
  not a build gate, for those 30.
- Fixture RUNS (browser, Claude-verified): live WebGL context; canvas
  1280x720; clicking Next → camera traveled [0, 9.26, 28.98] →
  [26.13, 9.61, -16.16], onStopArrived fired (label "Red marker"), orbit
  target snapped to the authored pivot [12, 2, -8]. rAF is paused in the
  hidden harness pane (0 ticks/600ms measured), so the update loop was
  pumped manually with the same update(1/60) calls the loop makes.

**2026-08-20 — SHA-256 at copy time (R5), 32 files:**
```
550929f492f75e79661d528cb8a57baf9f630e8eb4400dec07155cb646c26c3c *src/cells/assignment.ts
d0ac931a3c826af3424655e32c3585128d2fbd548348a662c4fcc2890d283b67 *src/cells/colmap.ts
74d07e5dcf5089d9928540fce34e407d2e31d73b063650392339f6d33afa8557 *src/cells/covisibility.ts
1d7e8477f985a9556fbfc772998d7c2dd69f9635540a70d46fe492420f9646f3 *src/cells/geometry.ts
3976bb4a0034da0bbde7d8d2fa304d1a1db8e8245e63c8887182db5c8e8cdff9 *src/cells/index.ts
2fd3615ece28c77c5371c1aef08ac85cce5dc3099495e09c6b0fb96e0acacba7 *src/cells/manifest.ts
4505180176fe92fc4894ec42d3dcad5b3b5346ea10bc706343aadb0c62f2d559 *src/cells/ownership.ts
bd2d21f2bbc5e185a3b7f91f6bdad68b14e2b4611cac3f4aab605f36732a4f46 *src/cells/partition.ts
2357343825c428afff5428cf643963daef667bc3b2be264d9790532c79bd56ee *src/cells/types.ts
e7755caeca057eaf87d8366665349b14798f604da570e4fe1fe3471933939f2c *src/rules/AudioChannel.ts
c8e81cbbbdbbe8e27ca84ba138f5e8de8738b7303b958d4d9baf065b244992e2 *src/rules/CameraChannel.ts
92e830d0942f79d65d9b4d985906e83119517bc87cc4499f12442bddde3e861e *src/rules/Channels.ts
0ff82b5bf3d4608b2720a15e0766fc8b11799869b5819724d8b3cda89da33272 *src/rules/DisplayChannel.ts
4ae39f9fa4646b1cd16dbc17bc4a5c65655a511b2547658e293182066abab047 *src/rules/HandlerRegistry.ts
2b1fb8a704aca99d5a266b974d8d575954fe380ba30c0087fb5c4c85b20c81ed *src/rules/ModeLocks.ts
70a7cf6ed3806ade18d1de656415d143eec45d5aa53e032a0d76cd1dfa857b18 *src/rules/RuleModel.ts
44cd03f8410dceeaed1f180bcf6fba2f935c723846efd86fd96d60756aa6a46f *src/rules/RuleResolver.ts
b8d1920d390285b19989c5b05c1733f847e9bfa9ab5684bdeb1905b2b54743f5 *src/rules/SceneMemory.ts
cbd82e22b6b744f2f4ac30ef1e4221c5bdc0a39a431dd40bef0ed082240e1f78 *src/locative/GeoAnchor.ts
2e41aaea48c9965c1c87e1bf783bedf68b323ace35d1391841e7d9051e2499f9 *src/locative/GeoContext.ts
20aaa56c8df621c34fe755ff566b4f6940fae623ead6a04264bde1c670b5e228 *src/site/AnnotationMeta.ts
735fd17e3b2759dbd470b5953d92feb56716667753c192f419c0b6f4987023f3 *src/site/SiteConfig.ts
1022838f63170aa62b872a32411583d4b0d07a2804a819d7f7bd84ad3de3173a *src/site/HotspotSeeder.ts
10fc9e17ebccf5e3aa59bd92e005e10f299b290663ad99c6917f27c08d03d137 *src/site/InteractionsImport.ts
77e26dcebe9e380781ef92a751841e3bd39fc3a41c680d82dd2599a62370f38e *src/text/TextModel.ts
5f4f27c6b721f84b79bfd759e44001438d12bf50337f818fbd3829a203b22e93 *src/text/FontRegistry.ts
1a4ae21d48b6355a64c84635a9636a89ded6c66353226e58bde01562807fbd31 *src/core/LoadingUI.ts
0a38edb78a897f1c986a936696e6ddc9ea22142d93d8a6eb5ed4a048ae71b1c5 *src/core/CameraPath.ts
6ffba27bc7856e09416507ce8b4f5c76f120ae6357c1095a4a6752a3d4d71181 *src/core/CameraRail.ts
a0e59475b70033b79f1028ee9e146452f3ddcc2e4c7e9aab2a50c856765f8a27 *src/core/ScrollRail.ts
e3e5a2a6308d6d045f4d5b0f22bda16855c53781a03b5299adb0448fe3380034 *src/render/AudioPlayer.ts
9de48f1017f52f3cdff6e5d7874c19f6413131b4fede91fd1b57da7a6fd1be57 *src/core/CameraSystem.ts
```

**2026-08-20 — adversarial review pass + built-in review (all claims
re-verified before acting; two review stages kept separate, results in the
session report):**
- SOURCE DRIFT DISCOVERED and registered as **D21 (doc 06, OPEN — gates
  05/06/08)**: copies taken 03:02:31; sparkjs's "ticket 13" work then
  changed RuleModel/DisplayChannel/SiteConfig (03:15-03:18) and kept going
  to at least 03:39 (SiteRuntime, TextSystem, authorui tabHotspots +
  hotspotInspector — ticket 06 scope — and src/index.ts; the tree may still
  be moving). Copies match their recorded SHAs exactly. Compatibility
  evidence for the ruling recorded in D21. Ticket 05 set to needs-info
  until D21 is ruled.
- CameraSystem's unassigned doc 01 renderer-type edits registered as **D22
  (doc 06, OPEN)**; boundary-rule gap classes (examples->backend legality,
  src->examples, vendor->src, spikes uncruised) registered as **D23 (doc
  06, OPEN)**.
- EOL protection extended (the ticket-02 bomb recurred for this copy mass —
  demonstrated end-to-end by review): .gitattributes now pins `-text` on
  src/** and examples/**; the copies mirror the source's MIXED endings
  (28 LF / 4 CRLF) and every SHA/diff baseline is byte-level.
- Value-cycle tripwire + scoped exemption proven (scratchpad mini-repo:
  type-only back-edge exit 0; value back-edge exit 1 naming the rule; the
  sneaky mixed-import case also fires). Known accepted residue documented
  in the config: self-imports of the exempted pair escape (degenerate).
- Fixture corrections applied and declared above (LoadingUI, derived
  markers, guarded-seed + RO sizing, latch note, header now POINTS at this ticket's
  Comments instead of re-enumerating).
- Doc/record fixes: README status + vendored-addon authority corrected
  (was "no toolkit code exists yet"); docs 01:137 + 03:186 rail-fixture
  citations disambiguated (they mean SPARKJS'S file — this repo now has a
  same-named file with no such call site); D18 register line updated
  (src/core/index.ts replaced by ticket 04); vite-env.d.ts comment
  corrected (the types reference is program-global, not examples-scoped —
  src/ must stay import.meta-free).
- Skipped (recorded, not acted): vite 500 kB chunk warning left as a growth
  tripwire (bundle is ~93% three by measurement; one-line
  chunkSizeWarningLimit silences it if preferred); dev-server root URL 404s
  (no hub page exists until later tickets — open /examples/rail/); ticket
  Comments keep the inline SHA block per R5's letter (machine-checkable
  sidecar would need an R5 amendment).
- Post-review fix: the DEV guard needed vite's client types —
  examples/vite-env.d.ts added (standard vite convention); gate re-run,
  TRUE exit 0 (43 modules, 60 deps).
- Sizing note (verification honesty): the fixture sizes via a zero-guarded
  immediate applySize() seed (a clientWidth read forces layout where one is
  computable) + a ResizeObserver as ongoing authority (SparkScene.ts:233's
  own mechanism). The harness pane stopped producing layout entirely late in
  the session (viewer 0x0 even after fronting + viewport reset; RO and rAF
  never ran), so post-rework sizing was verified only in the earlier run
  where the pane had layout (canvas 1280x720). Rail behavior (next/prev,
  arrival callbacks, orbit-target snap) verified twice with exact math via
  the DEV hook. First real-browser open should confirm sizing visually.
