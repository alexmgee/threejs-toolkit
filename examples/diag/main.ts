/**
 * Diagnostics self-test runner — ticket 07 runtime proof.
 *
 * Runs diag/dev/selfTest in a browser page (its AC). This page runs the
 * RENDERER-FREE core and keeps doing so (owner ruling G5, 2026-09-20): the
 * Phase-7 acceptance assertion needs a real SiteRuntime, so it is evaluated
 * in examples/site-lab, which is already renderer-bound and already runs on
 * both backends, and stays "deferred" here.
 *
 * The lab-load-001 fixture and its schema assertion are GONE with ticket
 * 12's §G deletions (owner ruling B1): the JSON was a recording of a SPARK
 * pager session, keyed on Spark's private member names, which no code in
 * this toolkit can feed or reproduce.
 *
 * DEV hook: window.__diagSelfTest { done } — await done for the results.
 */

import { renderSelfTestResults, runSelfTest } from "@toolkit/diag/dev/selfTest";

/**
 * The denominator this page must report, stated as a NUMBER rather than
 * inferred. selfTest excludes skipped/deferred assertions from its own
 * denominator, so a lost or silently-skipping assertion would otherwise
 * turn "15/15" into a green "14/14". Baseline after ticket 12: 16 pushed,
 * of which phase7-runtime-consent is deferred here (it evaluates in
 * site-lab), leaving 15 evaluated.
 */
const EXPECTED_EVALUATED = 15;

const out = document.getElementById("out")!;

const done = (async () => {
  const results = await runSelfTest();
  if (results.evaluatedCount !== EXPECTED_EVALUATED) {
    throw new Error(
      `self-test denominator is ${results.evaluatedCount}, expected ${EXPECTED_EVALUATED} — `
      + `an assertion was lost or silently skipped: `
      + results.assertions.map((a) => `${a.id}:${a.status}`).join(", "),
    );
  }
  renderSelfTestResults(out, results);
  for (const line of results.machineLines) console.log(line);
  return results;
})();

// A throw anywhere above must be VISIBLE on the page, not a blank #out.
done.catch((err) => {
  const pre = document.createElement("pre");
  pre.className = "fail";
  pre.textContent = `SELF-TEST RUNNER FAILED: ${err}`;
  out.appendChild(pre);
  console.error("[diag-selftest]", err);
});

(window as unknown as Record<string, unknown>).__diagSelfTest = { done };
