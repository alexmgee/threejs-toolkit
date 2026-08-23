/**
 * Diagnostics self-test runner — ticket 07 runtime proof.
 *
 * Runs diag/dev/selfTest in a browser page (its AC). The sparkjs runner
 * (examples/loadtest) also wires Spark meshes and embed/diagWiring — both
 * Phase 2 scope — so this page runs the renderer-free core: runSelfTest
 * with the copied lab-load-001 fixture. The Phase-7 acceptance assertion
 * needs diagWiring's runtime evaluator and is left at its built-in
 * "deferred" status (declared in ticket 07's Comments).
 *
 * DEV hook: window.__diagSelfTest { done } — await done for the results.
 */

import { renderSelfTestResults, runSelfTest } from "@toolkit/diag/dev/selfTest";
import fixture from "@toolkit/diag/fixtures/lab-load-001.json";

const out = document.getElementById("out")!;

const done = (async () => {
  // Guard the vacuous-pass vector: assertFixture returns "skipped" for an
  // undefined fixture and selfTest excludes skips from the denominator, so
  // a lost JSON import would otherwise shrink "20/20" to a green "19/19".
  if (fixture === undefined) {
    throw new Error("lab-load-001 fixture import resolved undefined");
  }
  const results = await runSelfTest({ fixture });
  if (results.assertions.find((a) => a.id === "fixture-schema")?.status === "skipped") {
    throw new Error("fixture-schema was skipped — the fixture did not reach selfTest");
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
