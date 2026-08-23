/**
 * paneKit.ts — the shared vocabulary of the entity inspect panes (Plan 14).
 *
 * Built over primitives.ts for the browse↔inspect selection model: slider
 * rows (label + range + numeric entry, per the Pencil `C-SliderRow`), the
 * breadcrumb header, browse list rows (`C-BoxListRow`), and the pane gizmo
 * row (mode + World/Local space + Deactivate). Entity panes (box/hotspot/
 * stop/prop) compose these; the cascade inspector (inspector.ts) keeps its
 * own kit — panes have no tiers.
 *
 * Focus contract (inherited from inspector.ts): `onInput`/`set` mutate and
 * fire the change WITHOUT a structural rerender — inputs reflect their own
 * value in place, and an empty numeric field is mid-edit, NOT zero.
 */

import {
  el,
  icon,
  textBtn,
  type Child,
  type GizmoMode,
  type IconName,
  type Tone,
} from "./primitives";
import type { FrameTarget } from "../authorPanelTypes";

// ─── Pane deps (AuthorPanel-owned services) ───────────────

/** Session gizmo state lives in AuthorPanel, NOT in pane DOM — a commit-time
 *  pane refresh replaces the DOM while TransformControls stays attached, so the
 *  bar must rebuild its pressed state from here. */
export interface PaneGizmoState {
  kind: string;
  id: string;
  mode: GizmoMode;
}

export interface EntityPaneDeps {
  /** Return to the browse list (breadcrumb back). */
  back: () => void;
  /** Bring an entity on screen (no-op when the host wires no frameEntity). */
  frame: (target: FrameTarget) => void;
  gizmoState: () => PaneGizmoState | null;
  setGizmoState: (state: PaneGizmoState | null) => void;
  /** Per-kind World/Local memory (session-scoped, default "world"). */
  spaceFor: (kind: string) => "world" | "local";
  setSpaceFor: (kind: string, space: "world" | "local") => void;
}

// ─── Slider row (C-SliderRow: label · range · number) ─────

export interface SliderRowOptions {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  title?: string;
  onInput: (value: number) => void;
}

/** Label + range + numeric entry. The number input keeps its native arrow
 *  steppers and accepts values BEYOND the slider range (the range clamps its
 *  thumb but the true figure survives — same contract as inspector.ts). */
export function sliderRow(options: SliderRowOptions): HTMLElement {
  const range = el("input", {
    className: "ap-range",
    type: "range",
    attrs: {
      min: String(options.min),
      max: String(options.max),
      step: String(options.step),
      value: String(options.value),
    },
  }) as HTMLInputElement;
  const number = el("input", {
    className: "ap-input ap-ctrl-number",
    type: "number",
    attrs: { step: String(options.step), value: formatNumber(options.value) },
  }) as HTMLInputElement;
  range.addEventListener("input", () => {
    const next = Number(range.value);
    number.value = formatNumber(next);
    options.onInput(next);
  });
  number.addEventListener("input", () => {
    // Empty is mid-edit, NOT zero — Number("") === 0 would write 0 per backspace.
    if (number.value.trim() === "") return;
    const next = Number(number.value);
    if (Number.isNaN(next)) return;
    range.value = String(next);
    options.onInput(next);
  });
  return el("div", { className: "ap-pane-row", title: options.title }, [
    el("span", { className: "ap-field-label ap-pane-row-label", text: options.label, title: options.title ?? options.label }),
    el("div", { className: "ap-ctrl-slider" }, [range, number]),
  ]);
}

/** A labelled row hosting an arbitrary control (text input, color pair, …). */
export function paneRow(label: string, control: HTMLElement, title?: string): HTMLElement {
  return el("div", { className: "ap-pane-row", title }, [
    el("span", { className: "ap-field-label ap-pane-row-label", text: label, title: title ?? label }),
    control,
  ]);
}

/** Plain text input that writes through on every keystroke. */
export function textInputRow(
  label: string,
  value: string,
  onValue: (value: string) => void,
): HTMLElement {
  const input = el("input", {
    className: "ap-input",
    type: "text",
    attrs: { value },
    onInput: (event) => onValue((event.currentTarget as HTMLInputElement).value),
  }) as HTMLInputElement;
  return paneRow(label, input);
}

// ─── Breadcrumb header (‹ Tab / entity · Delete) ──────────

export interface BreadcrumbOptions {
  /** The browse list this pane came from, e.g. "Boxes". */
  tab: string;
  /** The entity's display label (falls back to id at the call site). */
  title: string;
  onBack: () => void;
  onDelete?: () => void;
  deleteLabel?: string;
}

export function breadcrumb(options: BreadcrumbOptions): HTMLElement {
  const back = el("button", {
    className: "ap-btn ap-inspector-back",
    type: "button",
    title: `Back to ${options.tab.toLowerCase()}`,
    ariaLabel: `Back to ${options.tab.toLowerCase()}`,
    onClick: () => options.onBack(),
  }, ["← Back"]);
  const crumbs = el("div", { className: "ap-breadcrumb" }, [
    el("span", { className: "ap-breadcrumb-list", text: options.tab }),
    el("span", { className: "ap-breadcrumb-sep", text: "/" }),
    el("span", { className: "ap-breadcrumb-item", text: options.title, title: options.title }),
  ]);
  const children: Child[] = [back, crumbs];
  if (options.onDelete) {
    children.push(
      el("span", { className: "ap-breadcrumb-spacer" }),
      textBtn("trash", options.deleteLabel ?? "Delete", {
        tone: "danger",
        onClick: options.onDelete,
      }),
    );
  }
  return el("div", { className: "ap-inspector-headrow ap-pane-headrow" }, children);
}

// ─── Browse list row (C-BoxListRow) ───────────────────────

export interface BrowseRowOptions {
  icon: IconName;
  title: string;
  /** Info chips after the title (dims, link target, camera summary…). */
  chips?: Array<{ text: string; tone?: Tone }>;
  onClick: () => void;
}

export function browseRow(options: BrowseRowOptions): HTMLElement {
  return el("button", {
    className: "ap-browse-row",
    type: "button",
    title: options.title,
    onClick: () => options.onClick(),
  }, [
    icon(options.icon),
    el("span", { className: "ap-browse-row-title", text: options.title }),
    ...(options.chips ?? []).map((chipDef) =>
      el("span", {
        className: `ap-chip ap-browse-row-chip${chipDef.tone === "accent" ? " ap-chip-accent" : ""}`,
        text: chipDef.text,
      })),
    el("span", { className: "ap-browse-row-spacer" }),
    icon("chevron-down"),
  ]);
}

// ─── Pane gizmo row (mode · World/Local · Deactivate) ─────

export interface PaneGizmoRowOptions {
  modes: GizmoMode[];
  /** null = gizmo not active on this entity. */
  activeMode: GizmoMode | null;
  space: "world" | "local";
  onMode: (mode: GizmoMode) => void;
  onSpace: (space: "world" | "local") => void;
  onDeactivate: () => void;
}

const MODE_META: Record<GizmoMode, { icon: IconName; label: string }> = {
  translate: { icon: "move", label: "Move" },
  scale: { icon: "scaling", label: "Scale" },
  rotate: { icon: "rotate-cw", label: "Rotate" },
};

export function paneGizmoRow(options: PaneGizmoRowOptions): HTMLElement {
  return el("div", { className: "ap-gizmo-bar ap-pane-gizmo" }, [
    el("div", { className: "ap-gizmo-segments" }, options.modes.map((mode) =>
      el("button", {
        className: "ap-gizmo-segment",
        type: "button",
        title: MODE_META[mode].label,
        ariaLabel: MODE_META[mode].label,
        ariaPressed: options.activeMode === mode,
        onClick: () => options.onMode(mode),
      }, [icon(MODE_META[mode].icon), el("span", { text: MODE_META[mode].label })]),
    )),
    // Icons-only World/Local (user decision). Scale is always local regardless
    // of space — TransformControls behavior; the titles say so.
    el("div", { className: "ap-gizmo-segments ap-space-segments" }, [
      spaceButton("world", "globe", "World space (scale is always local)", options),
      spaceButton("local", "box", "Local space (scale is always local)", options),
    ]),
    options.activeMode !== null
      ? textBtn("crosshair", "Deactivate", { onClick: options.onDeactivate })
      : null,
  ]);
}

function spaceButton(
  space: "world" | "local",
  iconName: IconName,
  title: string,
  options: PaneGizmoRowOptions,
): HTMLElement {
  return el("button", {
    className: "ap-gizmo-segment ap-space-segment",
    type: "button",
    title,
    ariaLabel: title,
    ariaPressed: options.space === space,
    onClick: () => options.onSpace(space),
  }, [icon(iconName)]);
}

// ─── Shared formatting ────────────────────────────────────

/** Round for display without trailing-zero noise; integers print clean. */
export function formatNumber(value: number): string {
  return String(Number(value.toFixed(3)));
}
