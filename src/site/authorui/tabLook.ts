import type {
  SiteGradeSettings,
  SiteTypographySettings,
} from "../SiteConfig";
import type { TextStyle } from "../../text/TextModel";
import { DEFAULT_FONT_STACK } from "../../ui/TextLayout";
import {
  card,
  chip,
  el,
  field,
  iconBtn,
  sectionLabel,
  slider,
  switchToggle,
  textBtn,
} from "./primitives";
import type { AuthorTabCtx } from "./tabContext";
import { renderFontsBrowser } from "./fontsBrowser";

type GradeNumberKey =
  | "exposure"
  | "contrast"
  | "saturation"
  | "temperature"
  | "tint"
  | "vignette"
  | "grain";

type MaterializedGrade = SiteGradeSettings & {
  enabled: boolean;
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  vignette: number;
  grain: number;
};

type MaterializedTypography = SiteTypographySettings & {
  fontFamily: string;
  baseSizePx: number;
  scaleRatio: number;
  lineHeight: number;
  measureCh: number;
};

const FONT_STACKS = [
  { label: "DM Sans", value: DEFAULT_FONT_STACK },
  { label: "Inter", value: '"Inter", Helvetica, Arial, sans-serif' },
  { label: "Georgia", value: 'Georgia, "Times New Roman", serif' },
  { label: "IBM Plex Sans", value: '"IBM Plex Sans", Helvetica, Arial, sans-serif' },
];

interface GradeSliderSpec {
  key: GradeNumberKey;
  label: string;
  min: number;
  max: number;
  step: number;
}

const GRADE_SLIDERS: GradeSliderSpec[] = [
  { key: "exposure", label: "Exposure", min: 0, max: 3, step: 0.01 },
  { key: "contrast", label: "Contrast", min: 0, max: 2, step: 0.01 },
  { key: "saturation", label: "Saturation", min: 0, max: 2, step: 0.01 },
  { key: "temperature", label: "Temperature", min: -1, max: 1, step: 0.01 },
  { key: "tint", label: "Tint", min: -1, max: 1, step: 0.01 },
  { key: "vignette", label: "Vignette", min: 0, max: 1, step: 0.01 },
  { key: "grain", label: "Grain", min: 0, max: 1, step: 0.01 },
];

/**
 * The `settings.blocks` / `settings.text` objects, created ON FIRST WRITE.
 *
 * Deliberately NOT the `materializeTypography`/`materializeGrade` pattern its
 * neighbours use. Those write their defaults into the config as soon as the tab
 * renders; doing that here would put `takeover: true` into every site file that
 * never asked for it, changing `serializeSiteConfig`'s output for files nobody
 * edited — which is precisely what plan-23's byte-identical gate exists to
 * catch. Absent has to stay a representable, meaningful state (ticket 17/I3).
 */
function blocksSettings(ctx: AuthorTabCtx): NonNullable<NonNullable<AuthorTabCtx["site"]["settings"]>["blocks"]> {
  const settings = (ctx.site.settings ??= {});
  return (settings.blocks ??= {});
}

function textSettings(ctx: AuthorTabCtx): NonNullable<NonNullable<AuthorTabCtx["site"]["settings"]>["text"]> {
  const settings = (ctx.site.settings ??= {});
  return (settings.text ??= {});
}

export function renderLook(ctx: AuthorTabCtx): HTMLElement {
  const typography = materializeTypography(ctx);
  const grade = materializeGrade(ctx);

  return el("div", { className: "ap-stack" }, [
    sectionLabel("Appearance"),
    sectionLabel("Typography"),
    card([
      field("Font family", fontFamilySelect(typography.fontFamily, (value) => {
        typography.fontFamily = value;
        ctx.onChange("typography");
      })),
      slider({
        label: "Base size (px)",
        value: typography.baseSizePx,
        min: 12,
        max: 24,
        step: 1,
        onInput: (value) => {
          typography.baseSizePx = value;
          ctx.onChange("typography");
        },
      }),
      slider({
        label: "Scale ratio",
        value: typography.scaleRatio,
        min: 1,
        max: 1.6,
        step: 0.05,
        fmt: formatTrimmed,
        onInput: (value) => {
          typography.scaleRatio = value;
          ctx.onChange("typography");
        },
      }),
      slider({
        label: "Line-height",
        value: typography.lineHeight,
        min: 1,
        max: 2,
        step: 0.05,
        fmt: formatTrimmed,
        onInput: (value) => {
          typography.lineHeight = value;
          ctx.onChange("typography");
        },
      }),
      slider({
        label: "Line width (ch)",
        title: "default line width in characters for screen text",
        value: typography.measureCh,
        min: 30,
        max: 90,
        step: 1,
        onInput: (value) => {
          typography.measureCh = value;
          ctx.onChange("typography");
        },
      }),
    ]),
    ...renderStyles(ctx),
    ...renderFontsBrowser(ctx),
    sectionLabel("Grade"),
    card([
      field("Enabled", switchToggle(grade.enabled, (on) => {
        grade.enabled = on;
        ctx.onChange("grade");
      })),
      ...GRADE_SLIDERS.map((spec) =>
        slider({
          label: spec.label,
          value: grade[spec.key],
          min: spec.min,
          max: spec.max,
          step: spec.step,
          fmt: formatTrimmed,
          onInput: (value) => {
            grade[spec.key] = value;
            ctx.onChange("grade");
          },
        })
      ),
      field("LUT URL", textInput(grade.lutUrl ?? "", (value) => {
        const trimmed = value.trim();
        if (trimmed) grade.lutUrl = trimmed;
        else delete grade.lutUrl;
        ctx.onChange("grade");
      })),
    ]),
    // Ticket 17: three decisions the toolkit used to make for the visitor, with
    // no way for an author to reach them. All three fire "text" — that kind
    // already runs `textSystem.sync()`, which is exactly what re-resolves panel
    // placement and block presence. No new change kind is needed, and inventing
    // one would add a vocabulary word for no behaviour.
    sectionLabel("Behaviour"),
    card([
      field("Marker takeover", switchToggle(ctx.site.settings?.blocks?.takeover ?? true, (on) => {
        blocksSettings(ctx).takeover = on;
        ctx.onChange("text");
      }), "On: a marker's content removes content another marker is showing. Any single display effect can override this."),
      field("Markers hide stop text", switchToggle(ctx.site.settings?.blocks?.hideStopContent ?? false, (on) => {
        blocksSettings(ctx).hideStopContent = on;
        ctx.onChange("text");
      }), "On: while a marker is selected, stop captions and editorial text give way. Off by default — they belong to where the visitor is, not to what they clicked."),
      field("Collapse on narrow", switchToggle(ctx.site.settings?.text?.collapseOnNarrow ?? true, (on) => {
        textSettings(ctx).collapseOnNarrow = on;
        ctx.onChange("text");
      }), "On: below 768px every panel becomes one full-width bar. Any single panel can override this from its own Placement."),
    ]),
  ]);
}

// ─── Style manager (P8a) ──────────────────────────────────
// The named-style surface: an indented basedOn tree; a row opens the SAME
// inspector the blocks use, scoped to the style's base/variants. Editing a
// style restyles every wearer live (onChange("text") → TextSystem.sync()).
// This supersedes the Plan 07 Caption/Editorial re-pointed sections (D13).

function renderStyles(ctx: AuthorTabCtx): HTMLElement[] {
  const rows = styleTreeRows(ctx.site.styles);
  return [
    sectionLabel("Styles"),
    card([
      ...rows.map(({ style, depth }) => styleRow(ctx, style, depth)),
      el("div", { className: "ap-actions" }, [
        textBtn("plus", "New style", {
          tone: "accent",
          title: "Create a style based on Body",
          onClick: () => {
            const id = uniqueStyleId(ctx.site.styles, "new-style");
            ctx.site.styles.push({ id, name: "New style", basedOn: "body", base: {} });
            ctx.structural("text");
            ctx.selectStyle(id);
          },
        }),
      ]),
    ]),
  ];
}

/** Depth-first rows of the basedOn tree. A style whose basedOn is missing (or
 *  itself) roots at depth 0; members of a basedOn cycle are unreachable from
 *  any root, so they are appended at depth 0 rather than dropped (the resolver
 *  already console-warns the cycle itself). */
function styleTreeRows(styles: TextStyle[]): { style: TextStyle; depth: number }[] {
  const ids = new Set(styles.map((style) => style.id));
  const children = new Map<string | null, TextStyle[]>();
  for (const style of styles) {
    const parent = style.basedOn !== undefined && style.basedOn !== style.id && ids.has(style.basedOn)
      ? style.basedOn
      : null;
    const siblings = children.get(parent) ?? [];
    siblings.push(style);
    children.set(parent, siblings);
  }
  const rows: { style: TextStyle; depth: number }[] = [];
  const seen = new Set<string>();
  const visit = (parentId: string | null, depth: number): void => {
    for (const style of children.get(parentId) ?? []) {
      if (seen.has(style.id)) continue;
      seen.add(style.id);
      rows.push({ style, depth });
      visit(style.id, depth + 1);
    }
  };
  visit(null, 0);
  for (const style of styles) {
    if (seen.has(style.id)) continue;
    seen.add(style.id);
    rows.push({ style, depth: 0 });
  }
  return rows;
}

function styleRow(ctx: AuthorTabCtx, style: TextStyle, depth: number): HTMLElement {
  const wearers = ctx.site.blocks.filter((block) => block.styleId === style.id).length;
  const variantCount = style.variants?.length ?? 0;
  const main = el("button", {
    className: "ap-registry-main",
    type: "button",
    title: `Edit style ${style.name}`,
    onClick: () => ctx.selectStyle(style.id),
  }, [
    el("div", { className: "ap-registry-line" }, [
      el("span", { className: "ap-item-title", text: style.name }),
      el("div", { className: "ap-badges" }, [
        variantCount > 0 ? chip(`${variantCount} variant${variantCount === 1 ? "" : "s"}`) : null,
      ]),
    ]),
    el("div", {
      className: "ap-registry-meta",
      text: `${style.id} · ${wearers} wearer${wearers === 1 ? "" : "s"}`,
    }),
  ]);

  const duplicate = iconBtn("plus", {
    title: `Duplicate ${style.name}`,
    onClick: () => duplicateStyle(ctx, style),
  });
  const remove = iconBtn("trash", {
    tone: "danger",
    title: style.id === "body"
      ? "Body is the root style — deleted styles fall back to it"
      : `Delete ${style.name}`,
    onClick: () => deleteStyle(ctx, style),
  });
  // Body is the schema-guaranteed root (normalize reseeds it) AND the fallback
  // target for every delete — deleting it would dangle both.
  if (style.id === "body") remove.disabled = true;

  const row = el("div", { className: "ap-registry-row" }, [main, duplicate, remove]);
  if (depth > 0) row.style.marginLeft = `${depth * 14}px`;
  return row;
}

function duplicateStyle(ctx: AuthorTabCtx, source: TextStyle): void {
  const copy: TextStyle = {
    id: uniqueStyleId(ctx.site.styles, `${source.id}-copy`),
    name: `${source.name} copy`,
    ...(source.basedOn !== undefined ? { basedOn: source.basedOn } : {}),
    base: JSON.parse(JSON.stringify(source.base)) as TextStyle["base"],
    ...(source.variants !== undefined
      ? { variants: JSON.parse(JSON.stringify(source.variants)) as TextStyle["variants"] }
      : {}),
  };
  ctx.site.styles.splice(ctx.site.styles.indexOf(source) + 1, 0, copy);
  ctx.structural("text");
}

/** Delete a style: its wearers re-point to its basedOn (falling back to
 *  "body"), child styles re-base the same way, and the author is warned with
 *  the exact re-point counts first (D11). Re-basing is PLANNED against the
 *  post-delete graph before anything mutates: a basedOn cycle of any length
 *  through the deleted style must not survive as a smaller cycle (delete A of
 *  A→B→C→A would otherwise leave B⇄C), and the warn message must name the
 *  targets that are actually applied. */
function deleteStyle(ctx: AuthorTabCtx, style: TextStyle): void {
  if (style.id === "body") return;
  const styles = ctx.site.styles;
  // The fallback must EXIST after the splice — a dangling/self basedOn falls
  // back to body (normalize guarantees body).
  const fallbackId = style.basedOn !== undefined
    && style.basedOn !== style.id
    && styles.some((candidate) => candidate.id === style.basedOn)
    ? style.basedOn
    : "body";
  const wearers = ctx.site.blocks.filter((block) => block.styleId === style.id);
  const childStyles = styles.filter((candidate) => candidate !== style && candidate.basedOn === style.id);

  // Plan each child's new parent, then break any cycle the plan would create
  // by walking the PLANNED post-delete graph: fallback → body → root.
  const survivors = styles.filter((candidate) => candidate !== style);
  const planned = new Map<TextStyle, string | undefined>();
  for (const child of childStyles) {
    planned.set(child, fallbackId === child.id ? "body" : fallbackId);
  }
  const plannedParent = (of: TextStyle): string | undefined =>
    planned.has(of) ? planned.get(of) : of.basedOn;
  const createsCycle = (child: TextStyle, parentId: string): boolean => {
    const seen = new Set<string>();
    let current: string | undefined = parentId;
    while (current !== undefined && !seen.has(current)) {
      if (current === child.id) return true;
      seen.add(current);
      const parent = survivors.find((candidate) => candidate.id === current);
      current = parent === undefined ? undefined : plannedParent(parent);
    }
    return false;
  };
  for (const child of childStyles) {
    const target = planned.get(child);
    if (target === undefined || !createsCycle(child, target)) continue;
    // Degenerate imported graphs only: body's own chain can reach the child.
    planned.set(child, createsCycle(child, "body") ? undefined : "body");
  }

  const nameOf = (id: string): string => styles.find((candidate) => candidate.id === id)?.name ?? id;
  const details: string[] = [];
  if (wearers.length > 0) {
    details.push(`${wearers.length} block${wearers.length === 1 ? "" : "s"} will re-point to "${nameOf(fallbackId)}".`);
  }
  const targets = new Map<string, number>();
  for (const target of planned.values()) {
    const key = target ?? "(root)";
    targets.set(key, (targets.get(key) ?? 0) + 1);
  }
  for (const [target, count] of targets) {
    details.push(target === "(root)"
      ? `${count} style${count === 1 ? "" : "s"} will become root styles.`
      : `${count} style${count === 1 ? "" : "s"} will re-base onto "${nameOf(target)}".`);
  }
  const message = [`Delete style "${style.name}"?`, ...details].join("\n");
  if (!window.confirm(message)) return;

  for (const block of wearers) block.styleId = fallbackId;
  for (const [child, target] of planned) {
    if (target === undefined) delete child.basedOn;
    else child.basedOn = target;
  }
  const index = styles.indexOf(style);
  if (index >= 0) styles.splice(index, 1);
  ctx.resetInspectorScope("style", style.id);
  ctx.structural("text");
}

function uniqueStyleId(styles: TextStyle[], base: string): string {
  if (!styles.some((style) => style.id === base)) return base;
  let counter = 2;
  while (styles.some((style) => style.id === `${base}-${counter}`)) counter += 1;
  return `${base}-${counter}`;
}

// ─── Settings materialization ─────────────────────────────

function materializeTypography(ctx: AuthorTabCtx): MaterializedTypography {
  const settings = (ctx.site.settings ??= {});
  const typography = (settings.typography ??= {
    fontFamily: DEFAULT_FONT_STACK,
    baseSizePx: 16,
    scaleRatio: 1.25,
    lineHeight: 1.5,
    measureCh: 66,
  }) as MaterializedTypography;

  typography.fontFamily ??= DEFAULT_FONT_STACK;
  typography.baseSizePx ??= 16;
  typography.scaleRatio ??= 1.25;
  typography.lineHeight ??= 1.5;
  typography.measureCh ??= 66;

  return typography;
}

function fontFamilySelect(
  value: string,
  onValue: (value: string) => void,
): HTMLSelectElement {
  const stacks = FONT_STACKS.some((option) => option.value === value)
    ? FONT_STACKS
    : [{ label: value, value }, ...FONT_STACKS];
  return el("select", {
    className: "ap-input",
    onInput: (event) => onValue((event.currentTarget as HTMLSelectElement).value),
  }, stacks.map((option) => el("option", {
    text: option.label,
    attrs: {
      value: option.value,
      ...(option.value === value ? { selected: "" } : {}),
    },
  }))) as HTMLSelectElement;
}

function materializeGrade(ctx: AuthorTabCtx): MaterializedGrade {
  const settings = (ctx.site.settings ??= {});
  const grade = (settings.grade ??= {
    enabled: false,
    exposure: 1,
    contrast: 1,
    saturation: 1,
    temperature: 0,
    tint: 0,
    vignette: 0,
    grain: 0,
  }) as MaterializedGrade;

  grade.enabled ??= false;
  grade.exposure ??= 1;
  grade.contrast ??= 1;
  grade.saturation ??= 1;
  grade.temperature ??= 0;
  grade.tint ??= 0;
  grade.vignette ??= 0;
  grade.grain ??= 0;

  return grade;
}

function textInput(value: string, onValue: (value: string) => void): HTMLInputElement {
  return el("input", {
    className: "ap-input",
    type: "text",
    attrs: { value },
    onInput: (event) => onValue((event.currentTarget as HTMLInputElement).value),
  }) as HTMLInputElement;
}

function formatTrimmed(value: number): string {
  return String(Number(value.toFixed(2)));
}
