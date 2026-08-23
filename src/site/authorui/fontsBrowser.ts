/**
 * fontsBrowser.ts — the Appearance-tab fonts browser + BYO registration (P8b).
 *
 * A collapsible section beside the style manager. It renders the registered
 * families grouped by category with a specimen line in the ACTUAL face, and it
 * registers bring-your-own faces (URL / file) into `settings.fonts` + the live
 * registry.
 *
 * Lazy-load contract: specimen faces fetch ONLY on the browser's first open —
 * a named but UNREFERENCED family (e.g. Fraunces) triggers no network request
 * until then (referenced faces preload with the running site, which is not a
 * violation).
 *
 * BYO parse: a `.ttf`/`.otf` is fetched/read and its fvar axes + GSUB features
 * are parsed into an editable draft; a `.woff2` cannot be parsed (its tables
 * are compressed) so it falls to the manual mini-form, whose copy says why. A
 * FETCH failure (404/CORS) aborts with an error instead of a manual draft — an
 * unusable font must not be registerable. All browser state (the lazy-load
 * latch, the active draft, the async request guard) is per-panel (`ctx.fontsState`).
 */

import { parseSfntTables, STABLE } from "../../text/FontRegistry";
import type { FontFamilyMeta } from "../../text/FontRegistry";
import type { SiteFontFace } from "../../text/TextModel";
import {
  collapsible,
  el,
  field,
  sectionLabel,
  textBtn,
} from "./primitives";
import type { AuthorTabCtx, FontDraft } from "./tabContext";

const SPECIMEN = "The quick brown fox jumps 0123";
const CATEGORY_ORDER: FontFamilyMeta["category"][] = ["sans", "serif", "slab", "mono", "display"];
const CATEGORY_LABEL: Record<FontFamilyMeta["category"], string> = {
  sans: "Sans", serif: "Serif", slab: "Slab", mono: "Mono", display: "Display",
};
// Editable variable-font axes shown in the mini-form (ital is carried in the
// record when parsed but is not a hand-tunable min/max row).
const AXIS_TAGS = ["wght", "wdth", "opsz", "slnt"] as const;
const AXIS_LABEL: Record<(typeof AXIS_TAGS)[number], string> = {
  wght: "Weight", wdth: "Width", opsz: "Optical size", slnt: "Slant",
};

export function renderFontsBrowser(ctx: AuthorTabCtx): HTMLElement[] {
  const fonts = ctx.fonts;
  if (!fonts) return [];
  const state = ctx.fontsState;
  return [
    sectionLabel("Fonts"),
    collapsible(
      el("span", { className: "ap-item-title", text: "Fonts browser" }),
      buildBody(ctx),
      {
        open: state.openedOnce,
        onToggle: (open) => {
          if (!open || state.openedOnce) return;
          state.openedOnce = true;
          // First open only: load every family so specimens render in the real
          // face. Deferred to here so an unreferenced family fetches nothing
          // before the browser is opened.
          for (const meta of fonts.list()) void fonts.ensureLoaded(meta.family);
        },
      },
    ),
  ];
}

function buildBody(ctx: AuthorTabCtx): HTMLElement {
  const fonts = ctx.fonts!;
  const families = fonts.list();
  const groups: HTMLElement[] = [];
  for (const category of CATEGORY_ORDER) {
    const metas = families.filter((meta) => meta.category === category);
    if (metas.length === 0) continue;
    groups.push(el("div", { className: "ap-stack ap-font-group" }, [
      el("div", { className: "ap-field-label", text: CATEGORY_LABEL[category] }),
      ...metas.map((meta) => familyRow(meta)),
    ]));
  }
  return el("div", { className: "ap-stack" }, [
    ...groups,
    byoSection(ctx),
  ]);
}

function familyRow(meta: FontFamilyMeta): HTMLElement {
  const axisSummary = Object.keys(meta.axes).length > 0
    ? Object.entries(meta.axes).map(([tag, [min, max]]) => `${tag} ${min}–${max}`).join(" · ")
    : "static";
  // Specimen renders in the ACTUAL face once the family loads (first open).
  const specimen = el("div", { className: "ap-font-specimen", text: SPECIMEN });
  specimen.style.fontFamily = `"${meta.family}", sans-serif`;
  return el("div", { className: "ap-font-row" }, [
    el("div", { className: "ap-font-meta" }, [
      el("span", { className: "ap-item-title", text: meta.family }),
      el("span", { className: "ap-registry-meta", text: `${meta.manual ? "manual · " : ""}${axisSummary}` }),
    ]),
    specimen,
  ]);
}

// ─── BYO registration ─────────────────────────────────────

function byoSection(ctx: AuthorTabCtx): HTMLElement {
  const state = ctx.fontsState;
  const urlInput = el("input", {
    className: "ap-input",
    type: "text",
    attrs: { placeholder: "https://…/font.ttf", "aria-label": "Font URL" },
  }) as HTMLInputElement;

  const fileInput = el("input", {
    className: "ap-input",
    type: "file",
    attrs: { accept: ".ttf,.otf,.woff2,.woff", "aria-label": "Font file" },
  }) as HTMLInputElement;
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) void beginDraftFromFile(ctx, file);
  });

  const children: HTMLElement[] = [
    sectionLabel("Add a font"),
    field("From URL", urlInput),
    el("div", { className: "ap-actions" }, [
      textBtn("plus", "Fetch & parse", {
        tone: "accent",
        onClick: () => {
          const url = urlInput.value.trim();
          if (url) void beginDraftFromUrl(ctx, url);
        },
      }),
    ]),
    field("Or a file", fileInput),
  ];
  if (state.draft) children.push(draftForm(ctx));
  return el("div", { className: "ap-stack ap-byo" }, children);
}

async function beginDraftFromUrl(ctx: AuthorTabCtx, url: string): Promise<void> {
  const state = ctx.fontsState;
  const request = ++state.requestId; // async-race guard: only the latest wins
  let buffer: ArrayBuffer;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    buffer = await response.arrayBuffer();
  } catch (error) {
    // A FETCH failure (404/CORS) is NOT a parse failure — abort instead of
    // offering a manual draft for a font that cannot load (consult finding G).
    if (request !== state.requestId) return;
    setError(ctx, `Couldn't fetch "${url}" (${error instanceof Error ? error.message : "network error"}). Check the URL and CORS.`);
    return;
  }
  if (request !== state.requestId) return; // a newer request superseded this one
  const isWoff = /\.woff2?($|\?|#)/i.test(url);
  applyParse(ctx, { family: familyFromUrl(url), url, buffer, isWoff, sessionOnly: false });
}

async function beginDraftFromFile(ctx: AuthorTabCtx, file: File): Promise<void> {
  const state = ctx.fontsState;
  const request = ++state.requestId;
  const url = URL.createObjectURL(file);
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    if (request === state.requestId) setError(ctx, `Couldn't read "${file.name}".`);
    URL.revokeObjectURL(url);
    return;
  }
  if (request !== state.requestId) { URL.revokeObjectURL(url); return; }
  const isWoff = /\.woff2?$/i.test(file.name);
  applyParse(ctx, { family: familyFromUrl(file.name), url, buffer, isWoff, sessionOnly: true });
}

/** Parse the fetched bytes into a draft — parsed axes when the sfnt is
 *  readable, else a manual draft whose note says why. */
function applyParse(
  ctx: AuthorTabCtx,
  input: { family: string; url: string; buffer: ArrayBuffer; isWoff: boolean; sessionOnly: boolean },
): void {
  const state = ctx.fontsState;
  let axes: Record<string, [number, number]> = {};
  let features = "";
  let parsedBuffer: ArrayBuffer | null = null;
  let note = "";
  try {
    const parsed = parseSfntTables(input.buffer);
    axes = axesFromParsed(parsed.axes);
    features = parsed.features.join(", ");
    parsedBuffer = input.buffer;
  } catch {
    note = input.isWoff
      ? "woff2 tables are compressed and can't be read here — enter the axis ranges below by hand (the face still loads and renders)."
      : "Couldn't parse this font's tables. Enter axis ranges by hand, or supply a .ttf/.otf for automatic parsing.";
  }
  if (input.sessionOnly) {
    note = `${note ? note + " " : ""}Loaded from this session only — export keeps every other setting but omits this file-dropped face (re-host it at a URL to persist).`;
  }
  discardDraft(state); // revoke a superseded (un-registered) blob first
  state.draft = {
    family: input.family,
    url: input.url,
    italicUrl: "",
    axes,
    features,
    buffer: parsedBuffer,
    note,
    sessionOnly: input.sessionOnly,
  };
  ctx.requestRerender();
}

function setError(ctx: AuthorTabCtx, message: string): void {
  const state = ctx.fontsState;
  discardDraft(state);
  state.draft = { family: "", url: "", italicUrl: "", axes: {}, features: "", buffer: null, note: message, sessionOnly: false };
  ctx.requestRerender();
}

function draftForm(ctx: AuthorTabCtx): HTMLElement {
  const state = ctx.fontsState;
  const current = state.draft!;
  // A pure error draft (no url) shows the message + a dismiss button only.
  if (!current.url) {
    return el("div", { className: "ap-stack ap-byo-form" }, [
      el("div", { className: "ap-hint", text: current.note }),
      el("div", { className: "ap-actions" }, [
        textBtn("trash", "Dismiss", { tone: "danger", onClick: () => { discardDraft(state); ctx.requestRerender(); } }),
      ]),
    ]);
  }

  const familyInput = el("input", {
    className: "ap-input",
    type: "text",
    attrs: { value: current.family, "aria-label": "Family name" },
  }) as HTMLInputElement;
  familyInput.addEventListener("input", () => { current.family = familyInput.value; });

  const italicInput = el("input", {
    className: "ap-input",
    type: "text",
    attrs: { value: current.italicUrl, placeholder: "optional italic .woff2/.ttf URL", "aria-label": "Italic URL" },
  }) as HTMLInputElement;
  italicInput.addEventListener("input", () => { current.italicUrl = italicInput.value; });

  const featuresInput = el("input", {
    className: "ap-input",
    type: "text",
    attrs: { value: current.features, placeholder: "ss01, tnum, …", "aria-label": "OpenType features" },
  }) as HTMLInputElement;
  featuresInput.addEventListener("input", () => { current.features = featuresInput.value; });

  const rows: HTMLElement[] = [
    sectionLabel("New font"),
    current.note ? el("div", { className: "ap-hint", text: current.note }) : null,
    field("Family name", familyInput),
    field("Italic URL", italicInput),
    ...AXIS_TAGS.map((tag) => axisRow(current, tag)),
    field("Features", featuresInput),
    el("div", { className: "ap-actions" }, [
      textBtn("plus", "Register font", { tone: "accent", onClick: () => registerDraft(ctx) }),
      textBtn("trash", "Cancel", { tone: "danger", onClick: () => { discardDraft(state); ctx.requestRerender(); } }),
    ]),
  ].filter((row): row is HTMLElement => row !== null);
  return el("div", { className: "ap-stack ap-byo-form" }, rows);
}

function axisRow(current: FontDraft, tag: (typeof AXIS_TAGS)[number]): HTMLElement {
  const range = current.axes[tag];
  const minInput = axisInput(range?.[0], "min", (value) => setAxis(current, tag, 0, value));
  const maxInput = axisInput(range?.[1], "max", (value) => setAxis(current, tag, 1, value));
  return field(AXIS_LABEL[tag], el("div", { className: "ap-actions" }, [minInput, maxInput]));
}

function axisInput(value: number | undefined, ariaLabel: string, onValue: (value: number | undefined) => void): HTMLInputElement {
  const input = el("input", {
    className: "ap-input ap-ctrl-number",
    type: "number",
    attrs: { "aria-label": ariaLabel, step: "1", value: value === undefined ? "" : String(value) },
  }) as HTMLInputElement;
  input.addEventListener("input", () => {
    const raw = input.value.trim();
    if (raw === "") { onValue(undefined); return; }
    const next = Number(raw);
    if (Number.isFinite(next)) onValue(next);
  });
  return input;
}

function setAxis(current: FontDraft, tag: string, index: 0 | 1, value: number | undefined): void {
  const existing = current.axes[tag];
  const pair: [number | undefined, number | undefined] = existing ? [existing[0], existing[1]] : [undefined, undefined];
  pair[index] = value;
  if (pair[0] === undefined && pair[1] === undefined) delete current.axes[tag];
  else current.axes[tag] = pair as unknown as [number, number]; // half-set held; register filters/validates
}

function registerDraft(ctx: AuthorTabCtx): void {
  const fonts = ctx.fonts;
  const state = ctx.fontsState;
  const current = state.draft;
  if (!fonts || !current) return;
  const family = current.family.trim();
  const url = current.url.trim();
  if (!family || !url) return;

  // Refuse to shadow a CURATED stable family: registerFace overwrites the
  // registry entry, silently dropping its italic pairing, optical-size axis
  // and curated feature set (consult finding D). Force a unique name; a prior
  // BYO of the same name is a legitimate re-registration (upsert) and allowed.
  const shadowsStable = STABLE.some((meta) => meta.family === family)
    && !(ctx.site.settings?.fonts ?? []).some((face) => face.family === family);
  if (shadowsStable) {
    current.note = `"${family}" is a built-in curated font — pick a different family name so it does not overwrite the curated face (italic, optical size and features).`;
    ctx.requestRerender();
    return;
  }

  // Keep only fully-specified, ORDERED axis ranges (both bounds finite, min<=max).
  const axes: Record<string, [number, number]> = {};
  for (const [tag, pair] of Object.entries(current.axes)) {
    const min = pair?.[0];
    const max = pair?.[1];
    if (Number.isFinite(min) && Number.isFinite(max) && (min as number) <= (max as number)) {
      axes[tag] = [min as number, max as number];
    }
  }
  const features = [...new Set(current.features.split(/[,\s]+/).map((f) => f.trim()).filter(Boolean))];

  const face: SiteFontFace = { family, url };
  if (current.italicUrl.trim()) face.italicUrl = current.italicUrl.trim();
  if (Object.keys(axes).length > 0) face.axes = axes;
  if (features.length > 0) face.features = features;
  if (!current.buffer) face.manual = true;

  // Register on the LIVE registry (immediately pickable + loadable). Persist to
  // settings.fonts for export/reload — UNLESS session-only (a file-dropped blob
  // URL would 404 on reload, so exporting it would be a lie).
  fonts.register(face, current.buffer ?? undefined);
  if (!current.sessionOnly) {
    const settings = (ctx.site.settings ??= {});
    const list = (settings.fonts ??= []);
    const at = list.findIndex((existing) => existing.family === family);
    if (at >= 0) list[at] = face;
    else list.push(face);
  }

  // Load the new face so its specimen (and any block already wearing this
  // previously-unknown family) renders in it — the first-open latch has already
  // run, so nothing else would trigger the load (consult finding G). After the
  // load resolves, nudge a text sync so world (raster) lanes rebuild.
  void fonts.ensureLoaded(family).then(() => ctx.onChange("text"));

  // Drop the draft WITHOUT revoking a session-only blob URL — the just-registered
  // FontFace loads through it (revoking would 404 the face). Un-registered blobs
  // are revoked via discardDraft on cancel/supersede instead.
  state.draft = null;
  // structural: rerender the Appearance tab so the new family shows in the
  // browser AND every font picker; "typography" so the engine re-resolves.
  ctx.structural("typography");
}

// ─── Draft lifecycle ──────────────────────────────────────

/** Discard a draft that was NOT registered — revoke its blob URL (a file draft
 *  leaks the object URL otherwise) and clear it. Never call after a successful
 *  register: the registered FontFace still loads through that blob. */
function discardDraft(state: AuthorTabCtx["fontsState"]): void {
  if (state.draft?.sessionOnly && state.draft.url.startsWith("blob:")) {
    URL.revokeObjectURL(state.draft.url);
  }
  state.draft = null;
}

// ─── Helpers ──────────────────────────────────────────────

function axesFromParsed(
  parsed: Record<string, { min: number; default: number; max: number }>,
): Record<string, [number, number]> {
  const axes: Record<string, [number, number]> = {};
  // Editable tags first, then carry a parsed `ital` axis so it survives export
  // even though the mini-form shows no hand-tunable row for it.
  for (const tag of [...AXIS_TAGS, "ital"]) {
    const range = parsed[tag];
    if (range) axes[tag] = [range.min, range.max];
  }
  return axes;
}

function familyFromUrl(url: string): string {
  // Drop any query/fragment FIRST — otherwise splitting on ?/# as separators
  // takes the query value ("v=2") as the "filename" instead of the real file.
  const path = url.split(/[?#]/)[0];
  const file = path.split(/[\\/]/).pop() ?? path;
  const base = file.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim();
  return base
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ") || "New font";
}
