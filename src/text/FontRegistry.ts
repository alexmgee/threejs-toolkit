import type { SiteFontFace } from "./TextModel";

export interface FontFamilyMeta {
  family: string;
  slug: string;
  file: string;
  /** Served italic file; present iff italicStrategy === "file". */
  italicFile?: string;
  axes: Record<string, [number, number]>;
  features: string[];
  italicStrategy: "file" | "slnt" | "none";
  category: "sans" | "serif" | "slab" | "mono" | "display";
  manual?: boolean;
}

export interface ParsedSfntTables {
  axes: Record<string, { min: number; default: number; max: number }>;
  features: string[];
}

interface SfntTable {
  offset: number;
  length: number;
}

const REGISTERED_AXIS_TAGS = new Set(["wght", "wdth", "opsz", "slnt", "ital"]);

function tableTag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function assertRange(offset: number, length: number, limit: number, label: string): void {
  if (offset < 0 || length < 0 || offset > limit - length) {
    throw new Error(`invalid sfnt ${label} range`);
  }
}

/** Parse the fvar axes and GSUB feature tags from an uncompressed sfnt font. */
export function parseSfntTables(buf: ArrayBuffer): ParsedSfntTables {
  const view = new DataView(buf);
  assertRange(0, 4, view.byteLength, "header");

  const signature = view.getUint32(0);
  if (signature === 0x774f4632 || signature === 0x774f4646) {
    throw new Error("woff cannot be parsed for tables (brotli/zlib compressed) — supply .ttf/.otf");
  }
  assertRange(0, 12, view.byteLength, "header");
  if (signature !== 0x00010000 && signature !== 0x4f54544f) {
    throw new Error("unsupported sfnt version");
  }

  const numTables = view.getUint16(4);
  assertRange(12, numTables * 16, view.byteLength, "table directory");
  const tables = new Map<string, SfntTable>();

  for (let index = 0; index < numTables; index += 1) {
    const recordOffset = 12 + index * 16;
    const tag = tableTag(view, recordOffset);
    const offset = view.getUint32(recordOffset + 8);
    const length = view.getUint32(recordOffset + 12);
    assertRange(offset, length, view.byteLength, `${tag} table`);
    tables.set(tag, { offset, length });
  }

  const axes: ParsedSfntTables["axes"] = {};
  const fvar = tables.get("fvar");
  if (fvar) {
    assertRange(fvar.offset, 16, fvar.offset + fvar.length, "fvar header");
    const axesArrayOffset = view.getUint16(fvar.offset + 4);
    const axisCount = view.getUint16(fvar.offset + 8);
    const axisSize = view.getUint16(fvar.offset + 10);
    if (axisSize < 20) throw new Error("invalid sfnt fvar axis size");

    const axesOffset = fvar.offset + axesArrayOffset;
    assertRange(axesOffset, axisCount * axisSize, fvar.offset + fvar.length, "fvar axes");
    for (let index = 0; index < axisCount; index += 1) {
      const axisOffset = axesOffset + index * axisSize;
      axes[tableTag(view, axisOffset)] = {
        min: view.getInt32(axisOffset + 4) / 65536,
        default: view.getInt32(axisOffset + 8) / 65536,
        max: view.getInt32(axisOffset + 12) / 65536,
      };
    }
  }

  const featureTags = new Set<string>();
  const gsub = tables.get("GSUB");
  if (gsub) {
    assertRange(gsub.offset, 10, gsub.offset + gsub.length, "GSUB header");
    const featureListOffset = view.getUint16(gsub.offset + 6);
    const featureList = gsub.offset + featureListOffset;
    assertRange(featureList, 2, gsub.offset + gsub.length, "GSUB FeatureList");
    const featureCount = view.getUint16(featureList);
    assertRange(featureList + 2, featureCount * 6, gsub.offset + gsub.length, "GSUB FeatureRecords");
    for (let index = 0; index < featureCount; index += 1) {
      featureTags.add(tableTag(view, featureList + 2 + index * 6));
    }
  }

  return { axes, features: [...featureTags].sort() };
}

function offeredAxes(
  axes: ParsedSfntTables["axes"] | SiteFontFace["axes"],
): Record<string, [number, number]> {
  const offered: Record<string, [number, number]> = {};
  if (!axes) return offered;

  for (const [tag, range] of Object.entries(axes)) {
    if (!REGISTERED_AXIS_TAGS.has(tag)) continue;
    offered[tag] = Array.isArray(range) ? [range[0], range[1]] : [range.min, range.max];
  }
  return offered;
}

// Derived from examples/assets/fonts/src/*.ttf by parseSfntTables.
export const STABLE: FontFamilyMeta[] = [
  {
    family: "Inter",
    slug: "inter",
    file: "inter.woff2",
    italicFile: "inter-italic.woff2",
    axes: { opsz: [14, 32], wght: [100, 900] },
    features: ["aalt", "calt", "case", "ccmp", "cv01", "cv02", "cv03", "cv04", "cv05", "cv06", "cv07", "cv08", "cv09", "cv10", "cv11", "cv12", "cv13", "cv14", "dlig", "dnom", "frac", "locl", "numr", "ordn", "pnum", "salt", "sinf", "ss01", "ss02", "ss03", "ss04", "ss05", "ss06", "ss07", "ss08", "subs", "sups", "tnum", "zero"],
    italicStrategy: "file",
    category: "sans",
  },
  {
    family: "DM Sans",
    slug: "dm-sans",
    file: "dm-sans.woff2",
    italicFile: "dm-sans-italic.woff2",
    axes: { opsz: [9, 40], wght: [100, 1000] },
    features: ["aalt", "calt", "case", "ccmp", "dnom", "frac", "liga", "locl", "numr", "ordn", "ss01", "ss02", "ss03", "ss04", "ss05", "ss06", "ss07", "ss08", "sups"],
    italicStrategy: "file",
    category: "sans",
  },
  {
    family: "Instrument Sans",
    slug: "instrument-sans",
    file: "instrument-sans.woff2",
    italicFile: "instrument-sans-italic.woff2",
    axes: { wdth: [75, 100], wght: [400, 700] },
    features: ["aalt", "case", "ccmp", "liga", "locl", "ordn", "pnum", "ss01", "ss02", "ss03", "ss04", "ss05", "ss06", "ss07", "ss08", "ss09", "ss10", "ss11", "ss12", "tnum"],
    italicStrategy: "file",
    category: "sans",
  },
  {
    family: "Space Grotesk",
    slug: "space-grotesk",
    file: "space-grotesk.woff2",
    axes: { wght: [300, 700] },
    features: ["aalt", "case", "ccmp", "dnom", "frac", "liga", "lnum", "locl", "numr", "onum", "ordn", "pnum", "salt", "sinf", "ss01", "ss02", "ss03", "ss04", "ss05", "subs", "sups", "tnum", "zero"],
    italicStrategy: "none",
    category: "sans",
  },
  {
    family: "Source Serif 4",
    slug: "source-serif-4",
    file: "source-serif-4.woff2",
    italicFile: "source-serif-4-italic.woff2",
    axes: { wght: [200, 900], opsz: [8, 60] },
    features: ["aalt", "c2sc", "case", "ccmp", "dnom", "frac", "liga", "lnum", "locl", "numr", "onum", "ordn", "pnum", "sinf", "smcp", "ss01", "ss02", "subs", "sups", "tnum", "zero"],
    italicStrategy: "file",
    category: "serif",
  },
  {
    family: "Newsreader",
    slug: "newsreader",
    file: "newsreader.woff2",
    italicFile: "newsreader-italic.woff2",
    axes: { wght: [200, 800], opsz: [6, 72] },
    features: ["case", "liga", "locl", "ordn", "pnum", "rvrn", "sups", "tnum"],
    italicStrategy: "file",
    category: "serif",
  },
  {
    family: "Literata",
    slug: "literata",
    file: "literata.woff2",
    italicFile: "literata-italic.woff2",
    axes: { opsz: [7, 72], wght: [200, 900] },
    features: ["aalt", "c2sc", "case", "ccmp", "dlig", "dnom", "frac", "liga", "lnum", "locl", "numr", "onum", "ordn", "pnum", "rvrn", "sinf", "smcp", "ss01", "ss02", "subs", "sups", "tnum", "zero"],
    italicStrategy: "file",
    category: "serif",
  },
  {
    family: "Fraunces",
    slug: "fraunces",
    file: "fraunces.woff2",
    italicFile: "fraunces-italic.woff2",
    // The master also exposes SOFT/WONK; those custom axes are not in the served woff2.
    axes: { opsz: [9, 144], wght: [100, 900] },
    features: ["case", "liga", "rvrn", "ss01"],
    italicStrategy: "file",
    category: "serif",
  },
  {
    family: "Archivo",
    slug: "archivo",
    file: "archivo.woff2",
    italicFile: "archivo-italic.woff2",
    axes: { wght: [100, 900], wdth: [62, 125] },
    features: ["aalt", "case", "ccmp", "dnom", "frac", "liga", "lnum", "locl", "numr", "onum", "ordn", "pnum", "rvrn", "sinf", "subs", "sups", "tnum", "zero"],
    italicStrategy: "file",
    category: "sans",
  },
  {
    family: "Bricolage Grotesque",
    slug: "bricolage-grotesque",
    file: "bricolage-grotesque.woff2",
    axes: { opsz: [12, 96], wght: [200, 800], wdth: [75, 100] },
    features: ["aalt", "case", "ccmp", "dnom", "frac", "lnum", "locl", "numr", "onum", "ordn", "pnum", "sinf", "subs", "sups", "tnum"],
    italicStrategy: "none",
    category: "sans",
  },
  {
    family: "JetBrains Mono",
    slug: "jetbrains-mono",
    file: "jetbrains-mono.woff2",
    italicFile: "jetbrains-mono-italic.woff2",
    axes: { wght: [100, 800] },
    features: ["aalt", "calt", "case", "ccmp", "frac", "locl", "ordn", "sinf", "subs", "sups", "zero"],
    italicStrategy: "file",
    category: "mono",
  },
  {
    family: "Source Sans 3",
    slug: "source-sans-3",
    file: "source-sans-3.woff2",
    italicFile: "source-sans-3-italic.woff2",
    axes: { wght: [200, 900] },
    features: ["aalt", "c2sc", "case", "ccmp", "cv01", "cv02", "cv03", "cv04", "cv05", "cv06", "cv07", "cv08", "cv09", "cv10", "cv11", "cv12", "cv13", "cv14", "cv15", "cv16", "cv17", "cv18", "cv19", "dlig", "dnom", "frac", "hlig", "liga", "locl", "numr", "onum", "ordn", "pnum", "salt", "sinf", "smcp", "ss01", "ss02", "ss03", "ss04", "ss05", "ss06", "ss07", "ss08", "ss09", "ss10", "subs", "sups", "titl", "zero"],
    italicStrategy: "file",
    category: "sans",
  },
  {
    family: "Outfit",
    slug: "outfit",
    file: "outfit.woff2",
    axes: { wght: [100, 900] },
    features: ["aalt", "ccmp", "dlig", "frac", "liga", "ordn", "pnum", "rvrn", "salt", "ss01", "sups", "tnum"],
    italicStrategy: "none",
    category: "sans",
  },
  {
    family: "Spline Sans Mono",
    slug: "spline-sans-mono",
    file: "spline-sans-mono.woff2",
    italicFile: "spline-sans-mono-italic.woff2",
    axes: { wght: [300, 700] },
    features: ["aalt", "case", "ccmp", "dlig", "dnom", "frac", "locl", "numr", "ordn", "salt", "sinf", "ss01", "ss02", "ss03", "ss04", "ss05", "ss06", "ss07", "ss08", "ss09", "ss10", "ss11", "ss12", "ss14", "ss15", "ss16", "ss17", "ss18", "ss19", "subs", "sups", "zero"],
    italicStrategy: "file",
    category: "mono",
  },
  {
    family: "Roboto Slab",
    slug: "roboto-slab",
    file: "roboto-slab.woff2",
    axes: { wght: [100, 900] },
    features: ["aalt", "c2sc", "case", "ccmp", "dlig", "frac", "liga", "lnum", "locl", "ordn", "smcp", "ss01", "ss02", "ss03", "ss04", "ss05", "sups"],
    italicStrategy: "none",
    category: "slab",
  },
  {
    family: "Bodoni Moda",
    slug: "bodoni-moda",
    file: "bodoni-moda.woff2",
    italicFile: "bodoni-moda-italic.woff2",
    axes: { wght: [400, 900], opsz: [6, 96] },
    features: ["aalt", "c2sc", "case", "ccmp", "dlig", "frac", "hlig", "liga", "lnum", "locl", "onum", "ordn", "pnum", "smcp", "ss01", "ss02", "ss03", "sups", "tnum"],
    italicStrategy: "file",
    category: "serif",
  },
];

function familySlug(family: string): string {
  return family
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Split a CSS font-family list into candidate names — quote-aware, so a family
 *  named `"ACME, Inc"` stays one token and its quotes are stripped. */
function familyCandidates(familyOrStack: string): string[] {
  const candidates: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (const ch of familyOrStack) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ",") {
      const token = current.trim();
      if (token.length > 0) candidates.push(token);
      current = "";
      continue;
    }
    current += ch;
  }
  const tail = current.trim();
  if (tail.length > 0) candidates.push(tail);
  return candidates;
}

export function faceDescriptors(
  meta: FontFamilyMeta,
  style: FontFaceDescriptors["style"],
): FontFaceDescriptors {
  const descriptors: FontFaceDescriptors = { style };
  const weight = meta.axes.wght;
  const width = meta.axes.wdth;
  if (weight) descriptors.weight = `${weight[0]} ${weight[1]}`;
  if (width) descriptors.stretch = `${width[0]}% ${width[1]}%`;
  return descriptors;
}

export class FontRegistry {
  private readonly baseUrl: string;
  private readonly families = new Map<string, FontFamilyMeta>();
  private readonly urls = new Map<string, string>();
  private readonly loadPromises = new Map<string, Promise<void>>();
  private readonly bufferPromises = new Map<string, Promise<ArrayBuffer>>();
  private readonly diagnosticMessages: string[] = [];
  private readonly seenDiagnostics = new Set<string>();
  private readonly onDiagnostic?: (message: string) => void;

  constructor(opts: { baseUrl?: string; fonts?: SiteFontFace[]; onDiagnostic?: (message: string) => void } = {}) {
    this.baseUrl = opts.baseUrl ?? "/examples/assets/fonts/";
    this.onDiagnostic = opts.onDiagnostic;
    for (const meta of STABLE) {
      this.families.set(meta.family, meta);
      this.urls.set(meta.family, `${this.baseUrl}${meta.file}`);
    }
    for (const face of opts.fonts ?? []) this.registerFace(face);
  }

  list(): FontFamilyMeta[] {
    return [...this.families.values()];
  }

  /** Author-facing font diagnostics: every otherwise-silent failure (a 404'd BYO
   *  italic, a failed stack candidate) reports here once, deduped — an authored
   *  face that quietly renders wrong is a lie the author cannot debug. */
  get diagnostics(): readonly string[] {
    return this.diagnosticMessages;
  }

  private reportDiagnostic(message: string): void {
    if (this.seenDiagnostics.has(message)) return;
    this.seenDiagnostics.add(message);
    this.diagnosticMessages.push(message);
    console.warn(`FontRegistry: ${message}`);
    try {
      this.onDiagnostic?.(message);
    } catch (error) {
      // A throwing observer must not convert a non-fatal diagnostic into a
      // rejected load (ensureLoaded never rejects) or an unhandled rejection.
      console.warn("FontRegistry: onDiagnostic hook threw", error);
    }
  }

  /**
   * All registered candidates for a family name or CSS font-family STACK, in
   * stack order (exact name first) — authored styles routinely carry full
   * stacks (the typography token default is one), and an exact-only lookup
   * silently failed every registry consumer downstream.
   */
  private candidatesOf(familyOrStack: string): FontFamilyMeta[] {
    const direct = this.families.get(familyOrStack);
    if (direct) return [direct];
    const metas: FontFamilyMeta[] = [];
    for (const candidate of familyCandidates(familyOrStack)) {
      const found = this.families.get(candidate);
      if (found) metas.push(found);
    }
    return metas;
  }

  meta(familyOrStack: string): FontFamilyMeta | undefined {
    return this.candidatesOf(familyOrStack)[0];
  }

  /**
   * Make the stack renderable: load its first registered candidate, falling
   * through to later candidates when a face fails — CSS font matching falls
   * through per-glyph to the next available family, and the registry must not
   * strand a loadable fallback behind a broken first entry. Never rejects.
   */
  async ensureLoaded(familyOrStack: string): Promise<void> {
    for (const meta of this.candidatesOf(familyOrStack)) {
      try {
        await this.loadFamily(meta);
        return;
      } catch {
        this.reportDiagnostic(
          `face "${meta.family}" failed to load — falling through to the next family in the stack`,
        );
      }
    }
  }

  private loadFamily(meta: FontFamilyMeta): Promise<void> {
    const family = meta.family;
    const cached = this.loadPromises.get(family);
    if (cached) return cached;

    const promise = (async () => {
      const url = this.urls.get(family);
      if (!url) return;
      const isStable = STABLE.includes(meta);
      // The FontFace is always named by the resolved family (never a stack string),
      // or CSS referencing the family name would not match the loaded face.
      // Descriptors come from meta.axes for BYO faces too — a BYO variable font
      // registered without its weight range renders as a default-400 face under
      // font-synthesis: none.
      const face = new FontFace(family, `url(${url})`, faceDescriptors(meta, "normal"));
      const roman = face.load().then((loaded) => {
        document.fonts.add(loaded);
      });
      // Italic loads for ANY meta that carries one — BYO italicUrl included, with
      // the same stable-vs-BYO URL resolution getFaceBuffers already uses.
      const italic = meta.italicFile
        ? new FontFace(
            family,
            `url(${isStable ? `${this.baseUrl}${meta.italicFile}` : meta.italicFile})`,
            faceDescriptors(meta, "italic"),
          )
            .load()
            .then((loaded) => {
              document.fonts.add(loaded);
            })
            .catch(() => {
              // Non-fatal for the family, but never silent: with font-synthesis
              // off, italic text renders ROMAN and the author gets no signal.
              this.reportDiagnostic(
                `italic face for "${family}" failed to load — italic text will render roman (check the italic URL/CORS)`,
              );
            })
        : Promise.resolve();
      await Promise.all([roman, italic]);
    })();
    this.loadPromises.set(family, promise);
    // Evict on rejection (separate handled branch — awaiters still see the error):
    // a cached rejection would pin the family to fallback forever after one blip.
    promise.catch(() => {
      if (this.loadPromises.get(family) === promise) this.loadPromises.delete(family);
    });
    return promise;
  }

  async getBuffer(familyOrStack: string): Promise<ArrayBuffer> {
    const candidates = this.candidatesOf(familyOrStack);
    if (candidates.length === 0) {
      throw new Error(`unknown font family: ${familyOrStack}`);
    }
    let lastError: unknown;
    for (const meta of candidates) {
      try {
        return await this.bufferOf(meta.family);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  private bufferOf(family: string): Promise<ArrayBuffer> {
    const cached = this.bufferPromises.get(family);
    if (cached) return cached;

    const url = this.urls.get(family);
    if (!url) return Promise.reject(new Error(`unknown font family: ${family}`));

    const promise = fetch(url).then((response) => {
      if (!response.ok) throw new Error(`failed to fetch font ${family}: ${response.status}`);
      return response.arrayBuffer();
    });
    this.bufferPromises.set(family, promise);
    promise.catch(() => {
      if (this.bufferPromises.get(family) === promise) this.bufferPromises.delete(family);
      this.reportDiagnostic(
        `face binary for "${family}" could not be fetched — plane rasters fall back until a retry succeeds`,
      );
    });
    return promise;
  }

  /**
   * Face binaries for the first LOADABLE registered candidate of the stack —
   * a broken first entry falls through to the next, mirroring CSS matching.
   * Returns the winning meta so callers name @font-face rules correctly.
   */
  async getFaceBuffers(
    familyOrStack: string,
  ): Promise<{
    meta: FontFamilyMeta;
    faces: Array<{ style: "normal" | "italic"; buffer: ArrayBuffer }>;
  } | null> {
    const candidates = this.candidatesOf(familyOrStack);
    let winner: { meta: FontFamilyMeta; roman: ArrayBuffer } | null = null;
    for (const candidate of candidates) {
      try {
        winner = { meta: candidate, roman: await this.bufferOf(candidate.family) };
        break;
      } catch {
        // try the next registered candidate
      }
    }
    if (!winner) return null;
    const meta = winner.meta;
    const faces: Array<{ style: "normal" | "italic"; buffer: ArrayBuffer }> = [
      { style: "normal", buffer: winner.roman },
    ];
    if (!meta.italicFile) return { meta, faces };

    const key = `italic:${meta.italicFile}`;
    let italic = this.bufferPromises.get(key);
    if (!italic) {
      const url = STABLE.includes(meta) ? `${this.baseUrl}${meta.italicFile}` : meta.italicFile;
      italic = fetch(url).then((response) => {
        if (!response.ok) throw new Error(`failed to fetch italic font ${meta.family}: ${response.status}`);
        return response.arrayBuffer();
      });
      this.bufferPromises.set(key, italic);
      const cached = italic;
      cached.catch(() => {
        if (this.bufferPromises.get(key) === cached) this.bufferPromises.delete(key);
      });
    }

    const buffer = await italic.catch(() => {
      this.reportDiagnostic(
        `italic face binary for "${meta.family}" could not be fetched — plane rasters render italic text roman`,
      );
      return null;
    });
    if (buffer) faces.push({ style: "italic", buffer });
    return { meta, faces };
  }

  registerFace(face: SiteFontFace, buffer?: ArrayBuffer): FontFamilyMeta {
    // The registry owns its bytes: copy on intake so a caller mutating or
    // transferring their buffer cannot poison downstream consumers (the plane
    // raster memoizes base64 on buffer identity).
    buffer = buffer?.slice(0);
    let axes = offeredAxes(face.axes);
    let features = [...new Set(face.features ?? [])].sort();
    let manual = face.manual ?? buffer === undefined;

    if (buffer) {
      try {
        const parsed = parseSfntTables(buffer);
        // Caller-supplied axes/features WIN — the fonts-browser mini-form is
        // editable, so re-parsing the buffer here would silently overwrite the
        // author's edits (settings.fonts and the live registry would disagree,
        // and a reload would change behavior). Fall back to parsed values only
        // for what the caller left unset.
        if (Object.keys(axes).length === 0) axes = offeredAxes(parsed.axes);
        if (features.length === 0) features = parsed.features;
        manual = false;
      } catch {
        manual = face.manual ?? true;
      }
    }

    const meta: FontFamilyMeta = {
      family: face.family,
      slug: familySlug(face.family),
      file: face.url,
      axes,
      features,
      italicStrategy: face.italicUrl || axes.ital ? "file" : "none",
      category: "sans",
      manual,
    };
    if (face.italicUrl) meta.italicFile = face.italicUrl;

    this.families.set(face.family, meta);
    this.urls.set(face.family, face.url);
    this.loadPromises.delete(face.family);
    if (buffer) this.bufferPromises.set(face.family, Promise.resolve(buffer));
    else this.bufferPromises.delete(face.family);
    return meta;
  }

  static fontSynthesisNone(host: HTMLElement): void {
    host.style.fontSynthesis = "none";
  }
}
