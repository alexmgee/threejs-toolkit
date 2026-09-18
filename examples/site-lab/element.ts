/**
 * element-events — the `<splat-site>` event proof (ticket 09 AC5, doc 05's
 * H-API row; owner ruling Stop 14, E1).
 *
 * THE SAME FILE runs against BOTH toolkits: it imports only `defineSplatSite`
 * from `@toolkit/index` — an alias both repos define — and drives the element
 * through its public attribute and command API, never through internals. The
 * sparkjs side is a `git archive fd67153` export with a node_modules junction
 * (read-only; sparkjs itself untouched), and both sides load the SAME
 * site.json, whose scene URL resolves on either dev server.
 *
 * Frames — and the rail's travel — are pumped explicitly through the runtime's
 * own handle, so neither side depends on the pane being visible (a hidden pane
 * runs no animation frames; both toolkits reveal on rendered frames and travel
 * on rail updates).
 *
 * The recorded log is the EVENT SEQUENCE with payload shapes. Values are
 * recorded for `ready` and `stopchanged`; `loadprogress` values are recorded
 * but expected to differ — ruling Stop 5 (P1) replaced the pin's throttled,
 * chased stream with "report only on rise, exactly one 1" (doc 06 D29).
 */

import { defineSplatSite } from "@toolkit/index";
import pinRecord from "./pin-element-events.json";

const EVENT_TYPES = [
  "loadstart",
  "ready",
  "loadprogress",
  "loaderror",
  "stopchanged",
  "hotspotclick",
  "selectionchanged",
  "engagementchange",
  "memorychanged",
  "linkactivate",
] as const;

interface Recorded {
  type: string;
  /** Sorted payload keys + the typeof each value — the "payload shape". */
  shape: string;
  /** Recorded for every event; compared only where the rulings sanction it. */
  value: unknown;
}

const log: Recorded[] = [];
const out = document.getElementById("out")!;
const viewer = document.getElementById("viewer")!;

function shapeOf(detail: unknown): string {
  if (detail === null || typeof detail !== "object") return typeof detail;
  const entries = Object.entries(detail as Record<string, unknown>)
    .map(([key, value]) => `${key}:${value === null ? "null" : Array.isArray(value) ? "array" : typeof value}`)
    .sort();
  return `{${entries.join(",")}}`;
}

function yieldMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(0);
  });
}

/** Render through whichever scene facade the toolkit exposes on its runtime
 *  handle (`sparkScene` in both: this repo keeps the pin's member name, doc 06
 *  D28). Missing runtime (not booted yet) is a no-op.
 *  The rail is driven here too, at a fixed step: travel advances on animation
 *  frames, which a hidden page never gets, so without this a goToStop never
 *  arrives while the pane is hidden (pane-independence, the house fixture
 *  doctrine; site-lab pumps its rail the same way — owner ruling 2026-09-17).
 *  Both toolkits' runtime handles expose `cameraRail`. */
function pump(el: Element): void {
  const runtime = (el as unknown as {
    runtime?: {
      sparkScene?: { renderer: { render: (s: unknown, c: unknown) => void }; scene: unknown; camera: unknown };
      cameraRail?: { update: (deltaSeconds: number) => void };
    };
  }).runtime;
  const scene = runtime?.sparkScene;
  if (!scene) return;
  runtime?.cameraRail?.update(1 / 60);
  try {
    scene.renderer.render(scene.scene, scene.camera);
  } catch {
    // Before the renderer's init settles, render() refuses by name — keep pumping.
  }
}

async function pumpUntil(el: Element, done: () => boolean, boundMs: number): Promise<number> {
  const t0 = performance.now();
  while (!done() && performance.now() - t0 < boundMs) {
    pump(el);
    await yieldMacrotask();
  }
  return performance.now() - t0;
}

void (async () => {
  defineSplatSite();
  const el = document.createElement("splat-site");
  for (const type of EVENT_TYPES) {
    el.addEventListener(type, (event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      log.push({ type, shape: shapeOf(detail), value: detail });
    });
  }
  el.setAttribute("src", "./sites/lab.site.json");
  viewer.appendChild(el);

  const readyMs = await pumpUntil(el, () => log.some((r) => r.type === "ready" || r.type === "loaderror"), 120_000);
  // The backend this run ACTUALLY got, read from the live runtime handle —
  // never from the URL that asked for it (ruling Stop 11; review finding B1).
  // This toolkit's scene is a WebGPURenderer whose backend the URL selects; the
  // pin's SparkScene is a WebGL-only WebGLRenderer with no backend field.
  const liveScene = (el as unknown as {
    runtime?: { sparkScene?: { backend?: string; renderer?: { isWebGPURenderer?: boolean; isWebGLRenderer?: boolean } } };
  }).runtime?.sparkScene;
  const rendererKind = liveScene?.renderer?.isWebGPURenderer === true
    ? "WebGPURenderer"
    : liveScene?.renderer?.isWebGLRenderer === true ? "WebGLRenderer" : "unknown";
  const backend = liveScene?.backend ?? (rendererKind === "WebGLRenderer" ? "webgl" : "unknown");
  const expectedBackend = new URLSearchParams(location.search).get("webgl") === "1" ? "webgl2-fallback" : "webgpu";
  const stopsBefore = log.filter((r) => r.type === "stopchanged").length;
  (el as unknown as { goToStop(index: number): void }).goToStop(2);
  const travelMs = await pumpUntil(
    el,
    () => log.filter((r) => r.type === "stopchanged").length > stopsBefore,
    120_000,
  );
  // Disconnecting tears the runtime down — the element's own lifecycle.
  el.remove();
  await yieldMacrotask();

  const summary = {
    origin: location.origin,
    renderer: rendererKind,
    backend,
    readyMs: Math.round(readyMs),
    travelMs: Math.round(travelMs),
    sequence: log.map((r) => r.type),
    shapes: Object.fromEntries(log.map((r) => [r.type, r.shape])),
    ready: log.find((r) => r.type === "ready")?.value ?? null,
    stopchanged: log.filter((r) => r.type === "stopchanged").map((r) => r.value),
    loadprogress: log.filter((r) => r.type === "loadprogress").map((r) => (r.value as { progress: number }).progress),
  };
  // ─── The comparison (ruling Stop 14, E1 + E3) ───
  // Checked on BOTH sides against the recorded pin sequence: event types AND
  // how many of each, in order; payload shapes; the ready / stopchanged values;
  // and the backend the run actually got. NOT compared: the loadprogress values
  // and count, which ruling Stop 5 (P1) deliberately changed (doc 06 D29 item 2)
  // — reported as data instead. Every other count IS compared (review finding
  // 4): a doubled loadstart or ready must fail, not collapse into one.
  const collapsed: Array<[string, number]> = [];
  for (const record of log) {
    const last = collapsed[collapsed.length - 1];
    if (last && last[0] === record.type) last[1]++;
    else collapsed.push([record.type, 1]);
  }
  const countsCompared = (sequence: Array<[string, number]>): Array<[string, number | "not compared"]> =>
    sequence.map(([type, count]) => [type, type === "loadprogress" ? "not compared" : count]);
  const ourCounts = countsCompared(collapsed);
  const pinCounts = countsCompared(pinRecord.sequenceCollapsed as Array<[string, number]>);
  const readyValue = { ...((summary.ready ?? {}) as Record<string, unknown>) };
  delete readyValue.src; // origin-dependent on each side
  const progress = summary.loadprogress;
  const checks: Array<[string, boolean, string]> = [
    [
      "backend the run actually got (live runtime handle, ruling Stop 11)",
      rendererKind === "WebGPURenderer" ? backend === expectedBackend : rendererKind === "WebGLRenderer",
      rendererKind === "WebGPURenderer"
        ? `${rendererKind}, backend ${backend} (this URL asks for ${expectedBackend})`
        : `${rendererKind}, backend ${backend} (the pin's SparkScene is WebGL-only)`,
    ],
    [
      "event types and counts in order (loadprogress count not compared, doc 06 D29)",
      JSON.stringify(ourCounts) === JSON.stringify(pinCounts),
      `${JSON.stringify(ourCounts)} vs pin ${JSON.stringify(pinCounts)}`,
    ],
    [
      "payload shapes",
      JSON.stringify(summary.shapes) === JSON.stringify(pinRecord.shapes),
      JSON.stringify(summary.shapes),
    ],
    [
      "ready payload (src is origin-dependent)",
      JSON.stringify(readyValue) === JSON.stringify(pinRecord.ready),
      `${JSON.stringify(readyValue)} vs pin ${JSON.stringify(pinRecord.ready)}`,
    ],
    [
      "stopchanged payload",
      JSON.stringify(summary.stopchanged) === JSON.stringify(pinRecord.stopchanged),
      JSON.stringify(summary.stopchanged),
    ],
    [
      "loadprogress monotone, ends at 1 (values NOT compared, doc 06 D29)",
      progress.length > 0 &&
        progress.every((v, i) => i === 0 || v >= progress[i - 1]!) &&
        progress[progress.length - 1] === 1,
      `${progress.length} report(s), ${progress.filter((v) => v === 1).length} of them 1 (pin recorded ${pinRecord.loadprogress.count} reports, ${pinRecord.loadprogress.ones} of them 1)`,
    ],
  ];
  for (const [name, ok, detail] of checks) {
    const div = document.createElement("div");
    div.className = ok ? "pass" : "fail";
    div.textContent = `${ok ? "PASS" : "FAIL"} — ${name}: ${detail}`;
    out.appendChild(div);
    console.log(`element-events ${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
  }
  const failedChecks = checks.filter(([, ok]) => !ok).length;
  const heading = document.createElement("h2");
  heading.id = "result";
  heading.textContent = `element-events: ${checks.length - failedChecks} passed, ${failedChecks} failed`;
  out.appendChild(heading);

  const pre = document.createElement("pre");
  pre.id = "log";
  pre.textContent = JSON.stringify(summary, null, 1);
  out.appendChild(pre);
  console.log("element-events RESULT", JSON.stringify(summary));
})();
