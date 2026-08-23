/**
 * Rules Lab — DisplayChannel lifetime runtime proof (Phase 2 ticket 01).
 *
 * Drives the exact trap handoff 004 names: an authored `lifetime` on a
 * show-blocks effect VALIDATES (RuleModel is at pin fd67153) and must now
 * actually END the display at runtime (DisplayChannel re-synced to the pin).
 * The four restored endings are exercised for real, not merely imported.
 *
 * Vintage-tolerant on purpose: the ending functions are feature-detected at
 * runtime so the SAME fixture runs against the pre-re-sync DisplayChannel for
 * the ticket's "before" capture (where the assertions FAIL — that failure is
 * the evidence the trap was real). Types are written against the pin.
 *
 * DEV hook: window.__rulesLab { done } — await done for {passed, failed}.
 */

import * as DC from "@toolkit/rules/DisplayChannel";
import * as barrel from "@toolkit/index";
import { validateAnnotationRules, type EffectLifetime } from "@toolkit/rules/RuleModel";
import type { WhenContext } from "@toolkit/rules/RuleResolver";

const out = document.getElementById("out")!;
let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, detail: string): void {
  const div = document.createElement("div");
  div.className = `assertion ${condition ? "pass" : "fail"}`;
  div.textContent = `${condition ? "PASS" : "FAIL"} — ${name}: ${detail}`;
  out.appendChild(div);
  console.log(`rules-lab ${condition ? "PASS" : "FAIL"} ${name} — ${detail}`);
  condition ? passed++ : failed++;
}

// Feature-detect the pin's endings so the before-run executes (old vintage
// exports none of these — each absence is reported as its assertion's FAIL).
type Ending = ((state: DC.DisplayChannelState) => DC.DisplayChannelState) | undefined;
const mod = DC as Record<string, unknown>;
const endOnTravel = mod.endOnTravel as Ending;
const dismissAll = mod.dismissAll as Ending;
const endStaleWhile = mod.endStaleWhile as
  | ((state: DC.DisplayChannelState, context: WhenContext) => DC.DisplayChannelState)
  | undefined;
const endOrphanedClaims = mod.endOrphanedClaims as
  | ((
      state: DC.DisplayChannelState,
      refs: { ownerExists: (id: string) => boolean; blockExists: (id: string) => boolean },
    ) => DC.DisplayChannelState)
  | undefined;

const tourContext: WhenContext = { engagement: "tour", stop: "stop-1", memory: new Set() };
const blockExists = (id: string) => id === "b1" || id === "b2";
// The old showBlocks reads `isReactivation`; the pin reads `lifetime`+`context`
// and stores the toggle on the claim. Passing the union keeps one fixture
// source runnable against both vintages (extra keys are ignored by each).
const show = (
  state: DC.DisplayChannelState,
  owner: string,
  blocks: string[],
  lifetime: EffectLifetime | undefined,
  extra?: { isReactivation?: boolean; takeover?: boolean },
): DC.DisplayChannelState =>
  DC.showBlocks(state, owner, blocks, blockExists, {
    takeover: extra?.takeover ?? true,
    lifetime,
    context: tourContext,
    isReactivation: extra?.isReactivation ?? false,
  } as unknown as Parameters<typeof DC.showBlocks>[4]);

const done = (async () => {
  // 1 — the trap's first half: an authored lifetime VALIDATES.
  let validated = false;
  try {
    validateAnnotationRules(
      [
        {
          id: "a1",
          rules: [
            { on: "activate", do: [{ kind: "show-blocks", blocks: ["b1"], lifetime: { until: "travel" } }] },
          ],
        },
      ],
      [{ id: "b1" }, { id: "b2" }],
      [{ id: "stop-1" }],
    );
    validated = true;
  } catch (err) {
    console.log(`rules-lab validation threw: ${err}`);
  }
  assert("lifetime-validates", validated, 'authored lifetime {until:"travel"} passes RuleModel validation');

  // 2 — the trap's second half, CLOSED: that same authored lifetime now ends
  // the display on travel. This is the assertion that FAILS pre-re-sync.
  // Direct TYPED call (no cast): the gate typechecks this site against the
  // pin's opts contract — the dual-vintage helper's cast checks nothing.
  const shownUnderTravel = DC.showBlocks(DC.EMPTY_DISPLAY_CHANNEL, "a1", ["b1"], blockExists, {
    takeover: true,
    lifetime: { until: "travel" },
    context: tourContext,
  });
  const travelShown = DC.shownBlockIds(shownUnderTravel).has("b1");
  const afterTravel = endOnTravel?.(shownUnderTravel);
  assert(
    "lifetime-ends-on-travel",
    travelShown && afterTravel !== undefined && DC.shownBlockIds(afterTravel).size === 0,
    afterTravel === undefined
      ? "endOnTravel MISSING — authored lifetime is silently ignored (the trap)"
      : `shown pre-travel: ${travelShown}; shown post-travel: ${DC.shownBlockIds(afterTravel).size}`,
  );

  // 3 — travel ends ONLY the travel lifetime: a forever claim survives it.
  // takeover:false, or a2's show would evict a1's claim BEFORE travel runs and
  // the assertion would pass for an endOnTravel that removes nothing
  // (adversarial review finding, 2026-08-23).
  const mixed = show(shownUnderTravel, "a2", ["b2"], "forever", { takeover: false });
  const mixedAfter = endOnTravel?.(mixed);
  assert(
    "travel-ends-only-travel",
    mixedAfter !== undefined && !DC.shownBlockIds(mixedAfter).has("b1") && DC.shownBlockIds(mixedAfter).has("b2"),
    mixedAfter === undefined ? "endOnTravel MISSING" : `post-travel ids: ${[...DC.shownBlockIds(mixedAfter)].join(",")}`,
  );

  // 4 — the default toggle: re-running the same effect under the default
  // lifetime removes the claim (second click closes the first).
  const first = show(DC.EMPTY_DISPLAY_CHANNEL, "a1", ["b1"], undefined);
  const second = show(first, "a1", ["b1"], undefined, { isReactivation: true });
  assert(
    "default-reactivation-toggle",
    DC.shownBlockIds(first).has("b1") && DC.shownBlockIds(second).size === 0,
    `after first: ${[...DC.shownBlockIds(first)].join(",")}; after repeat: ${DC.shownBlockIds(second).size}`,
  );

  // 4b — the toggle is keyed on the STORED LIFETIME, not on re-activation
  // itself: re-activating a `forever` claim is an identity no-op — it stays
  // shown. This is the assertion that separates the pin's toggle key from the
  // old vintage's `isReactivation` key (which removed it).
  const foreverFirst = show(DC.EMPTY_DISPLAY_CHANNEL, "a1", ["b1"], "forever");
  const foreverRepeat = show(foreverFirst, "a1", ["b1"], "forever", { isReactivation: true });
  assert(
    "reactivation-respects-lifetime",
    DC.shownBlockIds(foreverFirst).has("b1") && DC.shownBlockIds(foreverRepeat).has("b1"),
    `forever claim after re-activation: ${DC.shownBlockIds(foreverRepeat).has("b1") ? "still shown (lifetime-keyed)" : "REMOVED (re-activation-keyed — the old vintage)"}`,
  );

  // 5 — dismissAll clears everything, `forever` included.
  const foreverShown = show(DC.EMPTY_DISPLAY_CHANNEL, "a1", ["b1"], "forever");
  const dismissed = dismissAll?.(foreverShown);
  assert(
    "dismiss-all-clears-forever",
    dismissed !== undefined && DC.shownBlockIds(foreverShown).has("b1") && DC.shownBlockIds(dismissed).size === 0,
    dismissed === undefined ? "dismissAll MISSING" : `pre: b1 shown; post: ${DC.shownBlockIds(dismissed).size}`,
  );

  // 6 — a stay-while claim ends when its condition stops holding.
  const whileShown = show(DC.EMPTY_DISPLAY_CHANNEL, "a1", ["b1"], { while: { state: "tour" } });
  const stillTour = endStaleWhile?.(whileShown, tourContext);
  const leftTour = endStaleWhile?.(whileShown, { engagement: "explore", stop: null, memory: new Set() });
  assert(
    "stale-while-ends",
    stillTour !== undefined &&
      leftTour !== undefined &&
      DC.shownBlockIds(whileShown).has("b1") &&
      DC.shownBlockIds(stillTour).has("b1") &&
      DC.shownBlockIds(leftTour).size === 0,
    leftTour === undefined
      ? "endStaleWhile MISSING"
      : `while tour: shown; after explore: ${DC.shownBlockIds(leftTour).size}`,
  );

  // 7 — author-mode hygiene: a claim whose owner was deleted is removed while
  // a VALID companion claim survives — an endOrphanedClaims implemented as
  // dismissAll must FAIL here (adversarial review finding, 2026-08-23).
  const twoOwners = show(foreverShown, "a2", ["b2"], "forever", { takeover: false });
  const orphaned = endOrphanedClaims?.(twoOwners, {
    ownerExists: (id) => id === "a2",
    blockExists,
  });
  assert(
    "orphaned-claims-end",
    orphaned !== undefined &&
      !DC.shownBlockIds(orphaned).has("b1") &&
      DC.shownBlockIds(orphaned).has("b2"),
    orphaned === undefined
      ? "endOrphanedClaims MISSING"
      : `post-delete ids: ${[...DC.shownBlockIds(orphaned)].join(",") || "(none)"} — a1 orphaned, a2 valid`,
  );

  // 8 — the four restored BARREL names resolve from src/index and run: one
  // real transition through the barrel-imported travel ending.
  // Identity, not typeof: the barrel is a plain re-export, so each barrel name
  // must BE the deep-import function the behavioral assertions above exercised
  // — a misaliased re-export cannot pass (adversarial review, 2026-08-23).
  const viaBarrel =
    barrel.endOnTravel === mod.endOnTravel &&
    barrel.dismissAll === mod.dismissAll &&
    barrel.endStaleWhile === mod.endStaleWhile &&
    barrel.endOrphanedClaims === mod.endOrphanedClaims &&
    typeof barrel.endOnTravel === "function" &&
    DC.shownBlockIds(barrel.endOnTravel(shownUnderTravel)).size === 0;
  assert(
    "barrel-names-restored",
    viaBarrel,
    viaBarrel
      ? "endOnTravel/dismissAll/endStaleWhile/endOrphanedClaims resolve via the barrel and endOnTravel ran"
      : "one or more barrel names missing or inert",
  );

  const heading = document.createElement("h2");
  heading.className = failed === 0 ? "pass" : "fail";
  heading.textContent = `rules-lab: ${passed} passed, ${failed} failed`;
  out.appendChild(heading);
  console.log(`rules-lab RESULT ${passed} passed, ${failed} failed`);
  return { passed, failed };
})();

done.catch((err) => {
  const div = document.createElement("div");
  div.className = "assertion fail";
  div.textContent = `RULES-LAB RUNNER FAILED: ${err}`;
  out.appendChild(div);
  console.log(`rules-lab RUNNER FAILED: ${err}`);
});

declare global {
  interface Window {
    __rulesLab?: { done: Promise<{ passed: number; failed: number }> };
  }
}
window.__rulesLab = { done };
