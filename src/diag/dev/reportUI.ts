import type { JsonValue, RawEvent } from "../events";
import type { DerivedBlock, LoadRecordRevision } from "../LoadRecord";

export interface ReportUiOptions {
  readonly title?: string;
  readonly expandedTimeline?: boolean;
}

interface HeatmapLike {
  readonly columns: number;
  readonly rows: number;
  readonly values: readonly number[];
  readonly source: string;
}

/** Render a development-only, human-readable view of one immutable revision. */
export function renderLoadRecordReport(
  record: Readonly<LoadRecordRevision>,
  container: HTMLElement,
  options: Readonly<ReportUiOptions> = {},
): HTMLElement {
  const section = document.createElement("section");
  section.className = "panel load-record-report";
  const heading = document.createElement("h2");
  heading.textContent = options.title ?? `LoadRecord ${record.identity.recordId} · revision ${record.identity.revisionId}`;
  section.append(heading);

  const summary = document.createElement("dl");
  summary.className = "report-grid";
  appendDefinition(summary, "Scene", record.identity.sceneId);
  appendDefinition(summary, "Load", record.identity.loadId);
  appendDefinition(summary, "Outcome", record.status.terminalOutcome ?? "in progress");
  appendDefinition(summary, "Probe", `${record.status.probeStatus}${record.status.reasons.length ? ` — ${record.status.reasons.join(", ")}` : ""}`);
  appendDefinition(summary, "Duration", `${record.timing.elapsedDurationMs} ms elapsed / ${record.timing.foregroundVisibleDurationMs} ms foreground`);
  appendDefinition(summary, "Raw evidence", `${record.evidence.rawEvents.length} events; ${record.caps.currentRawBytes}/${record.caps.rawBytes} bytes`);
  section.append(summary);

  const columns = document.createElement("div");
  columns.className = "report-grid";
  columns.append(
    listPanel("Declared gaps", record.status.declaredGaps.length ? record.status.declaredGaps : ["none"]),
    listPanel("Uncertainty", record.status.uncertaintyReasons.length ? record.status.uncertaintyReasons : ["none"]),
    outcomesPanel(record),
    evidenceBoundaryPanel(record),
  );
  section.append(columns);

  const timeline = document.createElement("details");
  timeline.open = options.expandedTimeline ?? true;
  const timelineSummary = document.createElement("summary");
  timelineSummary.textContent = `Timeline (${record.evidence.rawEvents.length} raw events)`;
  timeline.append(timelineSummary, timelineTable(record.evidence.rawEvents));
  section.append(timeline);

  const heatmaps = extractHeatmaps(record.evidence.derivedBlocks);
  if (heatmaps.length > 0) {
    const heatmapSection = document.createElement("section");
    heatmapSection.innerHTML = "<h3>Heatmaps</h3>";
    const grid = document.createElement("div");
    grid.className = "report-grid";
    for (const heatmap of heatmaps) grid.append(renderHeatmap(heatmap));
    heatmapSection.append(grid);
    section.append(heatmapSection);
  } else {
    section.append(listPanel("Heatmap", ["No spatial heatmap derived block in this revision."]));
  }

  if (record.evidence.derivedBlocks.length > 0) {
    const derived = document.createElement("details");
    const derivedSummary = document.createElement("summary");
    derivedSummary.textContent = `Derived blocks (${record.evidence.derivedBlocks.length})`;
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(record.evidence.derivedBlocks, null, 2);
    derived.append(derivedSummary, pre);
    section.append(derived);
  }

  container.append(section);
  return section;
}

function appendDefinition(list: HTMLDListElement, term: string, value: string): void {
  const wrapper = document.createElement("div");
  const dt = document.createElement("dt");
  dt.textContent = term;
  const dd = document.createElement("dd");
  dd.textContent = value;
  dd.style.margin = ".25rem 0 0";
  wrapper.append(dt, dd);
  list.append(wrapper);
}

function listPanel(title: string, values: readonly string[]): HTMLElement {
  const section = document.createElement("section");
  const heading = document.createElement("h3");
  heading.textContent = title;
  const list = document.createElement("ul");
  for (const value of values) {
    const item = document.createElement("li");
    item.textContent = value;
    list.append(item);
  }
  section.append(heading, list);
  return section;
}

function outcomesPanel(record: Readonly<LoadRecordRevision>): HTMLElement {
  const values = [
    `terminal: ${record.status.terminalOutcome ?? "in progress"}`,
    `finalized: ${record.finalized}`,
    `revision: ${record.identity.revisionId}`,
    `adapter: ${record.status.probeStatus}`,
  ];
  return listPanel("Outcome", values);
}

function evidenceBoundaryPanel(record: Readonly<LoadRecordRevision>): HTMLElement {
  const values = [
    `compacted segments: ${record.evidence.compactedSegments.length}`,
    `dropped summaries: ${record.evidence.droppedEvents.length}`,
    `raw cutoff: ${record.evidence.rawEventCutoffSequence ?? "none"}`,
    `raw frozen: ${record.caps.rawCaptureFrozen}`,
    `total bytes: ${record.caps.currentTotalBytes}/${record.caps.totalBytes}`,
  ];
  return listPanel("Evidence boundaries", values);
}

function timelineTable(events: readonly Readonly<RawEvent>[]): HTMLTableElement {
  const table = document.createElement("table");
  const head = document.createElement("thead");
  head.innerHTML = "<tr><th>Seq</th><th>Time</th><th>Source</th><th>Type</th><th>Status / visibility</th><th>Payload</th></tr>";
  const body = document.createElement("tbody");
  for (const event of events) {
    const row = document.createElement("tr");
    appendCell(row, String(event.sequence));
    appendCell(row, formatNumber(event.eventTimeMs));
    appendCell(row, event.source);
    appendCell(row, event.type);
    appendCell(row, `${event.adapterStatus} / ${event.visibilityPhase}`);
    appendCell(row, compactJson(event.payload));
    body.append(row);
  }
  table.append(head, body);
  return table;
}

function appendCell(row: HTMLTableRowElement, value: string): void {
  const cell = document.createElement("td");
  cell.textContent = value;
  row.append(cell);
}

function extractHeatmaps(blocks: readonly Readonly<DerivedBlock>[]): HeatmapLike[] {
  const heatmaps: HeatmapLike[] = [];
  for (const block of blocks) findHeatmaps(block.value, block.name, heatmaps, new Set<object>());
  return heatmaps;
}

function findHeatmaps(value: JsonValue, source: string, output: HeatmapLike[], visited: Set<object>): void {
  if (value === null || typeof value !== "object") return;
  if (visited.has(value)) return;
  visited.add(value);
  if (isJsonRecord(value)) {
    const columns = integer(value.gridColumns) ?? integer(value.columns);
    const rows = integer(value.gridRows) ?? integer(value.rows);
    if (columns && rows) {
      const values = heatValues(value, columns, rows);
      if (values) output.push({ columns, rows, values, source });
    }
    for (const [key, child] of Object.entries(value)) findHeatmaps(child, `${source}.${key}`, output, visited);
  } else {
    for (const child of value) findHeatmaps(child, source, output, visited);
  }
}

function heatValues(record: Readonly<Record<string, JsonValue>>, columns: number, rows: number): readonly number[] | undefined {
  if (Array.isArray(record.values) && record.values.length === columns * rows && record.values.every(isFiniteNumber)) {
    return record.values.map((value) => clamp(value as number));
  }
  if (!Array.isArray(record.cells)) return undefined;
  const values = new Array<number>(columns * rows).fill(0);
  let found = false;
  for (const value of record.cells) {
    if (!isJsonRecord(value)) continue;
    const column = integer(value.column);
    const row = integer(value.row);
    const likelihood = isFiniteNumber(value.coarsePageLikelihood) ? value.coarsePageLikelihood : undefined;
    if (column === undefined || row === undefined || likelihood === undefined || column < 0 || row < 0 || column >= columns || row >= rows) continue;
    values[row * columns + column] = clamp(likelihood);
    found = true;
  }
  return found ? values : undefined;
}

function renderHeatmap(heatmap: Readonly<HeatmapLike>): HTMLElement {
  const figure = document.createElement("figure");
  const caption = document.createElement("figcaption");
  caption.textContent = `${heatmap.source} (${heatmap.columns} × ${heatmap.rows})`;
  const grid = document.createElement("div");
  grid.className = "heatmap-grid";
  grid.style.gridTemplateColumns = `repeat(${heatmap.columns}, 1fr)`;
  grid.style.gridTemplateRows = `repeat(${heatmap.rows}, 1fr)`;
  heatmap.values.forEach((value, index) => {
    const cell = document.createElement("span");
    cell.className = "heatmap-cell";
    cell.style.backgroundColor = heatColor(value);
    cell.title = `column=${index % heatmap.columns} row=${Math.floor(index / heatmap.columns)} likelihood=${value.toFixed(4)}`;
    grid.append(cell);
  });
  figure.append(caption, grid);
  return figure;
}

function isJsonRecord(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function isFiniteNumber(value: JsonValue): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function compactJson(value: unknown): string {
  const encoded = JSON.stringify(value);
  return encoded.length <= 240 ? encoded : `${encoded.slice(0, 237)}...`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function heatColor(value: number): string {
  const normalized = clamp(value);
  const hue = (1 - normalized) * 240;
  return `hsl(${hue} 90% ${30 + normalized * 25}%)`;
}
