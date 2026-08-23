/**
 * inspector.ts — the generic inspect-mode control kit (D10).
 *
 * ONE home for the `InspectorControl` → DOM mapping, rendered over the
 * primitives.ts kit. The text inspector's essentials strip (P7a) and its
 * nine domain groups (P7b) both build from `renderControl`, so a control kind
 * behaves identically wherever it appears. Controls display RESOLVED values
 * (never abstract defaults) and grey — with the lane's own reason string —
 * when a capability excludes the field.
 *
 * Focus contract (review finding #1): a control's `set` must mutate + fire
 * `onChange` WITHOUT a structural rerender, or the focused input is replaced
 * mid-edit and the caret is lost. The kit never re-renders on input; each
 * input reflects its own value in place and keeps its paired sibling in sync.
 */

import {
  chip,
  el,
  icon,
  segmented,
  switchToggle,
  type Child,
} from "./primitives";
import type {
  ControlTier,
  InspectorControl,
} from "../authorPanelTypes";

const TIER_LABEL: Record<ControlTier, string> = {
  token: "From typography token",
  style: "From style",
  variant: "From a variant",
  override: "Local override (this block)",
  none: "Not set",
};

/** Render one control as a labelled field. Sliders pair with numeric entry
 *  (QC baseline); a `disabledReason` greys the control and surfaces the reason.
 *  A tier dot shows where the RESOLVED value comes from (cascade legibility);
 *  a clear button (when the scoped layer sets the field) resets to inherited.
 *  `tierLabels` re-words the dot titles for a non-block edit target (P8a's
 *  style inspector) — the tier VALUES stay shared. */
export function renderControl(
  control: InspectorControl,
  tierLabels: Record<ControlTier, string> = TIER_LABEL,
): HTMLElement {
  const disabled = control.disabledReason !== undefined;
  const body = disabled ? renderDisabledValue(control) : renderInput(control);
  const head: Child[] = [
    tierDot(control.tier(), tierLabels),
    el("span", { className: "ap-field-label", text: control.label, title: control.label }),
  ];
  if (!disabled && control.clear) head.push(clearButton(control.clear));
  const children: Child[] = [
    el("div", { className: "ap-ctrl-head" }, head),
    body,
  ];
  if (disabled) {
    children.push(el("div", {
      className: "ap-ctrl-reason",
      text: control.disabledReason,
      title: control.disabledReason,
    }));
  }
  return el("div", {
    className: disabled ? "ap-ctrl ap-ctrl-disabled" : "ap-ctrl",
    title: disabled ? control.disabledReason : undefined,
  }, children);
}

function tierDot(tier: ControlTier, labels: Record<ControlTier, string>): HTMLElement {
  return el("span", {
    className: "ap-tier-dot",
    dataset: { tier },
    title: labels[tier],
    attrs: { "aria-label": labels[tier] },
  });
}

function clearButton(onClear: () => void): HTMLButtonElement {
  return el("button", {
    className: "ap-ctrl-clear",
    type: "button",
    title: "Clear to inherited",
    ariaLabel: "Clear to inherited",
    onClick: () => onClear(),
  }, ["×"]) as HTMLButtonElement;
}

// ─── Per-kind inputs ──────────────────────────────────────

function renderInput(control: InspectorControl): HTMLElement {
  switch (control.kind) {
    case "slider":
      return renderSlider(control);
    case "select":
      return renderSelect(control);
    case "segmented":
      return renderSegmented(control);
    case "toggle":
      return renderToggle(control);
    case "color":
      return renderColor(control);
    case "textarea":
      return renderTextarea(control);
    case "vector":
      return renderVector(control);
    case "text":
    default:
      return renderText(control);
  }
}

function renderSlider(control: InspectorControl): HTMLElement {
  const value = toNumber(control.get());
  const min = control.min ?? 0;
  const max = control.max ?? 100;
  const step = control.step ?? 1;
  const range = el("input", {
    className: "ap-range",
    type: "range",
    attrs: { min: String(min), max: String(max), step: String(step), value: String(value) },
  }) as HTMLInputElement;
  // Numeric entry accepts BEYOND the slider range (QC baseline): the number
  // input carries no `max`, so a value past the slider clamps the thumb but
  // keeps the true figure.
  const number = el("input", {
    className: "ap-input ap-ctrl-number",
    type: "number",
    attrs: { step: String(step), value: formatNumber(value) },
  }) as HTMLInputElement;
  range.addEventListener("input", () => {
    const next = Number(range.value);
    number.value = formatNumber(next);
    control.set(next);
  });
  number.addEventListener("input", () => {
    // A cleared field is mid-edit, NOT zero — Number("") === 0 would silently
    // write size/leading/tracking 0 into the live block on every backspace.
    if (number.value.trim() === "") return;
    const next = Number(number.value);
    if (Number.isNaN(next)) return;
    range.value = String(next);
    control.set(next);
  });
  return el("div", { className: "ap-ctrl-slider" }, [range, number]);
}

function renderSelect(control: InspectorControl): HTMLElement {
  const current = stringify(control.get());
  const options = control.options ?? [];
  // Display the resolved value even when it is not an offered option (a font
  // stack from the token, a weight the family lacks a picker entry for).
  const known = options.some((option) => option.value === current);
  const select = el("select", { className: "ap-input ap-select" }) as HTMLSelectElement;
  if (!known && current !== "") {
    select.appendChild(optionEl(current, `${current} (current)`));
  }
  for (const option of options) select.appendChild(optionEl(option.value, option.label));
  select.value = current;
  select.addEventListener("change", () => control.set(select.value));
  return select;
}

function renderSegmented(control: InspectorControl): HTMLElement {
  const options = (control.options ?? []).map((option) => ({ id: option.value, label: option.label }));
  return segmented(options, stringify(control.get()), (id) => control.set(id));
}

function renderToggle(control: InspectorControl): HTMLElement {
  return el("div", { className: "ap-ctrl-inline" }, [
    switchToggle(Boolean(control.get()), (on) => control.set(on)),
  ]);
}

/** Swatch (native picker) + editable #rrggbb hex field (DD2 / Plan-14 pattern),
 *  kept in sync; BOTH write through the SAME `control.set`. The native picker
 *  only accepts #rrggbb, so the resolved value is normalized for the initial
 *  display; the hex field waits for a full valid 6-digit hex before committing. */
function renderColor(control: InspectorControl): HTMLElement {
  const initial = cssColorToHex(stringify(control.get()));
  const swatch = el("input", {
    className: "ap-color",
    type: "color",
    attrs: { value: initial },
  }) as HTMLInputElement;
  const hex = el("input", {
    className: "ap-input ap-color-hex",
    type: "text",
    attrs: { value: initial, spellcheck: "false", "aria-label": `${control.label} hex` },
  }) as HTMLInputElement;
  swatch.addEventListener("input", () => {
    hex.value = swatch.value;
    control.set(swatch.value);
  });
  hex.addEventListener("input", () => {
    const value = hex.value.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(value)) return; // wait for a full valid hex
    swatch.value = value;
    control.set(value);
  });
  return el("div", { className: "ap-color-row" }, [swatch, hex]);
}

function renderText(control: InspectorControl): HTMLElement {
  const input = el("input", {
    className: "ap-input",
    type: "text",
    attrs: { value: stringify(control.get()) },
  }) as HTMLInputElement;
  input.addEventListener("input", () => control.set(input.value));
  return input;
}

function renderTextarea(control: InspectorControl): HTMLElement {
  const area = el("textarea", { className: "ap-input ap-textarea" }) as HTMLTextAreaElement;
  area.value = stringify(control.get());
  area.addEventListener("input", () => control.set(area.value));
  return area;
}

function renderVector(control: InspectorControl): HTMLElement {
  const value = toVector(control.get());
  const axes = ["x", "y", "z"] as const;
  const next: [number, number, number] = [...value];
  return el("div", { className: "ap-ctrl-vector" }, axes.map((axis, index) => {
    const input = el("input", {
      className: "ap-input",
      type: "number",
      attrs: { "aria-label": `${control.label} ${axis}`, step: "0.01", value: formatNumber(value[index]) },
    }) as HTMLInputElement;
    input.addEventListener("input", () => {
      if (input.value.trim() === "") return; // mid-edit empty ≠ 0
      const parsed = Number(input.value);
      if (Number.isNaN(parsed)) return;
      next[index] = parsed;
      control.set([...next]);
    });
    return input;
  }));
}

// ─── Disabled display ─────────────────────────────────────

/** A greyed, read-only echo of the resolved value — the control still shows
 *  what is applied, it just cannot be edited (the lane excludes the field). */
function renderDisabledValue(control: InspectorControl): HTMLElement {
  const raw = control.get();
  const text = control.kind === "toggle"
    ? (raw ? "on" : "off")
    : Array.isArray(raw)
      ? raw.map((v) => (typeof v === "number" ? formatNumber(v) : String(v))).join(", ")
      : typeof raw === "number"
        ? formatNumber(raw)
        : stringify(raw) || "—";
  return el("div", { className: "ap-ctrl-static" }, [
    chip(text),
    icon("info"),
  ]);
}

// ─── Coercion helpers ─────────────────────────────────────

function optionEl(value: string, label: string): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function stringify(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function toVector(value: unknown): [number, number, number] {
  if (Array.isArray(value) && value.length >= 3) {
    return [toNumber(value[0]), toNumber(value[1]), toNumber(value[2])];
  }
  return [0, 0, 0];
}

/** Round for display without trailing-zero noise; integers print clean. */
function formatNumber(value: number): string {
  return String(Number(value.toFixed(3)));
}

let colorCanvas: HTMLCanvasElement | null = null;

/** `<input type=color>` only accepts #rrggbb. Resolve ANY supported CSS color
 *  (named / rgb() / hsl() / shorthand / #rrggbbaa) to #rrggbb via a 2D context
 *  so a live `rgba(...)`/`tomato` value shows its real color instead of a wrong
 *  white default. Alpha is dropped — the native picker has no alpha channel
 *  (a dedicated opacity control is P7c). Invalid input falls back to black. */
function cssColorToHex(value: string): string {
  const raw = (value ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${[...raw.slice(1)].map((d) => d + d).join("")}`.toLowerCase();
  }
  if (typeof document === "undefined") return "#000000";
  colorCanvas ??= document.createElement("canvas");
  const ctx = colorCanvas.getContext("2d");
  if (!ctx) return "#000000";
  // Seed a known value: an unparseable assignment leaves fillStyle unchanged.
  ctx.fillStyle = "#000000";
  ctx.fillStyle = raw;
  const resolved = ctx.fillStyle; // "#rrggbb" (opaque) or "rgba(r, g, b, a)"
  if (/^#[0-9a-fA-F]{6}$/.test(resolved)) return resolved.toLowerCase();
  const rgba = resolved.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgba) {
    return `#${[rgba[1], rgba[2], rgba[3]]
      .map((n) => Number(n).toString(16).padStart(2, "0"))
      .join("")}`;
  }
  return "#000000";
}
