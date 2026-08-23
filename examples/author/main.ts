/**
 * Author panel fixture — ticket 06 runtime proof.
 *
 * The panel opens STANDALONE against a SiteConfig fixture (the ticket's AC:
 * no scene required; SceneComposer wiring is Phase 3). Camera state and the
 * pick callback are inert stubs — the panel never touches a renderer here.
 *
 * DEV hook: window.__author { panel, site, report }.
 */

import { AuthorPanel } from "@toolkit/site/AuthorPanel";
import type { SiteConfig } from "@toolkit/site/SiteConfig";

// Minimal-but-nonempty fixture: one stop and one annotation so the Tour and
// Hotspots tabs have a row to render; the remaining tabs render their
// empty states (declared in ticket 06's Comments).
const site: SiteConfig = {
  version: 1,
  name: "author-fixture",
  scenes: [],
  stops: [
    {
      id: "stop-1",
      label: "Front",
      camera: { yaw: 0, pitch: 15, distance: 10, pivot: { x: 0, y: 0, z: 0 } },
    },
  ],
  blocks: [],
  styles: [],
  obstacles: [],
  annotations: [
    {
      id: "marker-1",
      anchor: [1, 0.5, 0],
      copy: { title: "Marker", body: "Fixture annotation." },
    },
  ],
};

const report: Record<string, unknown> = { phase: "booting" };

try {
  const host = document.getElementById("host");
  if (!host) throw new Error("#host missing from index.html");
  const panel = new AuthorPanel({
    site,
    container: host,
    getCameraState: () => ({ yaw: 0, pitch: 15, distance: 10, pivot: { x: 0, y: 0, z: 0 } }),
    pickPoint: () => Promise.resolve(null),
    onChange: (kind) => console.log("[author-fixture] change:", kind),
  });
  report.phase = "open";
  (window as unknown as Record<string, unknown>).__author = { panel, site, report };
  console.log("[author-fixture] panel open");
} catch (err) {
  report.phase = "failed";
  report.error = String(err);
  const pre = document.createElement("pre");
  pre.textContent = `AUTHOR PANEL FAILED: ${err}`;
  (document.getElementById("host") ?? document.body).appendChild(pre);
  console.error("[author-fixture]", err);
  (window as unknown as Record<string, unknown>).__author = { report };
}
