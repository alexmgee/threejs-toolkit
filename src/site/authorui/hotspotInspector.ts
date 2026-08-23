/**
 * hotspotInspector.ts — the annotation (hotspot) inspect pane (Plan 14 P5).
 * Per the Pencil `Panel-Hotspots-Inspect` frame: Title · Body · Radius ·
 * Highlight · GIZMO · ACTIONS (Frame · Re-anchor · Delete).
 *
 * Two sub-tabs since ticket 10: MARKER (the frame above — what the marker is)
 * and RULES (what it does when activated). Both panes are built once and
 * toggled by visibility, never rebuilt on a switch — the same contract the text
 * inspector's group tabs keep, and the reason a half-typed flag name and a
 * half-authored rule card both survive a pill click.
 *
 * Copy lives on the annotation alone (ticket 13/A5): title/body write
 * `annotation.copy` and fire onChange("text"), which the runtime uses to keep
 * an open conjured box honest. No block is minted or mirrored — the copy
 * floats at the marker via the runtime's conjured box. Radius/highlight fire
 * onChange("annotations"); delete prunes the blocks the annotation's rules
 * displayed.
 */

import { el, sectionLabel, textBtn, type GizmoMode } from "./primitives";
import {
  breadcrumb,
  paneRow,
  sliderRow,
  textInputRow,
  paneGizmoRow,
  type EntityPaneDeps,
} from "./paneKit";
import { pruneAnnotationBlocks } from "./tabHotspots";
import { createRulesPane } from "./rulesPane";
import type { SiteAnnotation } from "../SiteConfig";
import type { InspectorPane } from "../authorPanelTypes";
import type { AuthorTabCtx } from "./tabContext";

const DEFAULT_HIGHLIGHT = "#4ade80";
const DEFAULT_RADIUS = 0.6;

export function createHotspotPane(
  item: SiteAnnotation,
  ctx: AuthorTabCtx,
  deps: EntityPaneDeps,
): InspectorPane {
  item.copy.title ??= "";
  item.radius ??= DEFAULT_RADIUS;
  item.highlight ??= DEFAULT_HIGHLIGHT;

  const header = breadcrumb({
    tab: "Hotspots",
    title: item.copy.title || item.id,
    onBack: () => deps.back(),
    onDelete: () => {
      // PRUNE FIRST, then splice. The prune reads this annotation's rules to
      // learn which blocks it displayed (ticket 17 moved that from the blocks
      // onto the annotation), so removing the annotation first would leave it
      // nothing to read and orphan the copy blocks on their reserved ids.
      pruneAnnotationBlocks(ctx, item);
      const index = ctx.site.annotations.indexOf(item);
      if (index >= 0) ctx.site.annotations.splice(index, 1);
      // Drop this annotation's Rules-pane draft with it (ticket 10), the same
      // way `resetInspectorScope` drops a deleted block's edit scope: an
      // annotation later created under the same id must open on an empty pane,
      // not on a dead marker's half-authored cards.
      ctx.rulesState.delete(item.id);
      clearGizmoIfOurs();
      ctx.structural("annotations");
    },
  });

  const marker = el("div", { className: "ap-stack" }, [
    sectionLabel("Copy"),
    textInputRow("Title", item.copy.title ?? "", (value) => {
      // The copy IS the display truth (ticket 13): the conjured box derives
      // from it, and the marker's aria label reads it.
      item.copy.title = value;
      ctx.onChange("text");
    }),
    paneRow("Body", bodyTextarea()),

    sectionLabel("Appearance"),
    sliderRow({
      label: "Radius",
      value: item.radius ?? DEFAULT_RADIUS,
      min: 0.1,
      max: 5,
      step: 0.05,
      onInput: (value) => {
        item.radius = value;
        ctx.onChange("annotations");
      },
    }),
    highlightRow(),

    ...(ctx.authorGizmo?.attachAnnotation ? [sectionLabel("Gizmo"), gizmoRow()] : []),

    sectionLabel("Actions"),
    el("div", { className: "ap-actions" }, [
      textBtn("crosshair", "Re-anchor (pick)", {
        onClick: () => {
          void ctx.pickPoint().then((point) => {
            if (!point) return;
            item.anchor = point;
            ctx.authorGizmo?.resync?.();
            ctx.structural("annotations");
          });
        },
      }),
      textBtn("eye", "Frame in view", {
        tone: "accent",
        onClick: () => deps.frame({ kind: "hotspot", id: item.id }),
      }),
    ]),
    el("div", {
      className: "ap-hint",
      text: "Esc or ← Back returns to the list. Only this hotspot is editable while open.",
    }),
  ]);

  const body = subTabs(item.id, ctx, [
    { id: "marker", label: "Marker", pane: marker },
    { id: "rules", label: "Rules", pane: createRulesPane(item, ctx) },
  ]);

  return {
    header,
    body,
    select: () => {},
    deselect: () => clearGizmoIfOurs(),
  };

  function bodyTextarea(): HTMLElement {
    const area = el("textarea", {
      className: "ap-input ap-textarea",
      attrs: { rows: "3" },
      text: item.copy.body ?? "",
    }) as HTMLTextAreaElement;
    area.addEventListener("input", () => {
      item.copy.body = area.value;
      ctx.onChange("text");
    });
    return area;
  }

  function highlightRow(): HTMLElement {
    const swatch = el("input", {
      className: "ap-color",
      type: "color",
      attrs: { value: item.highlight ?? DEFAULT_HIGHLIGHT },
    }) as HTMLInputElement;
    const hex = el("input", {
      className: "ap-input ap-color-hex",
      type: "text",
      attrs: { value: item.highlight ?? DEFAULT_HIGHLIGHT, spellcheck: "false", "aria-label": "Highlight hex" },
    }) as HTMLInputElement;
    const commit = (value: string): void => {
      item.highlight = value;
      ctx.onChange("annotations");
    };
    swatch.addEventListener("input", () => {
      hex.value = swatch.value;
      commit(swatch.value);
    });
    hex.addEventListener("input", () => {
      const value = hex.value.trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(value)) return;
      swatch.value = value;
      commit(value);
    });
    return paneRow("Highlight", el("div", { className: "ap-color-row" }, [swatch, hex]));
  }

  function gizmoRow(): HTMLElement {
    const state = deps.gizmoState();
    const activeMode: GizmoMode | null =
      state && state.kind === "hotspot" && state.id === item.id ? state.mode : null;
    return paneGizmoRow({
      modes: ["translate", "scale"],
      activeMode,
      space: deps.spaceFor("hotspot"),
      onMode: (mode) => {
        // Push this pane's remembered space BEFORE attach (attach re-applies the
        // gizmo's stored space, which could be another kind's leftover).
        ctx.authorGizmo?.setSpace?.(deps.spaceFor("hotspot"));
        ctx.authorGizmo?.attachAnnotation?.(item, mode as "translate" | "scale",
          () => ctx.requestRerender());
        deps.setGizmoState({ kind: "hotspot", id: item.id, mode });
        ctx.requestRerender();
      },
      onSpace: (space) => {
        deps.setSpaceFor("hotspot", space);
        ctx.authorGizmo?.setSpace?.(space);
        ctx.requestRerender();
      },
      onDeactivate: () => {
        ctx.authorGizmo?.detach();
        deps.setGizmoState(null);
        ctx.requestRerender();
      },
    });
  }

  function clearGizmoIfOurs(): void {
    const state = deps.gizmoState();
    if (state && state.kind === "hotspot" && state.id === item.id) {
      ctx.authorGizmo?.detach();
      deps.setGizmoState(null);
    }
  }
}

/**
 * The pane's sub-tab bar: one pill per pane, exactly one pane visible.
 *
 * A pill click only flips `hidden` — no rerender, no teardown — so every pane
 * keeps its DOM, its focus and its in-progress input values. The open pill is
 * remembered on the PANEL instance (`ctx.rulesState`, keyed by annotation), so
 * the inspector's wholesale rebuilds reopen where the author was; AuthorPanel
 * already restores focus to `.ap-subtab[aria-selected="true"]` after one.
 */
function subTabs(
  annotationId: string,
  ctx: AuthorTabCtx,
  tabs: { id: string; label: string; pane: HTMLElement }[],
): HTMLElement {
  const remembered = ctx.rulesState.get(annotationId)?.tab;
  let active = tabs.some((tab) => tab.id === remembered) ? remembered! : tabs[0].id;

  const pills = tabs.map((tab) => el("button", {
    className: "ap-subtab",
    type: "button",
    role: "tab",
    text: tab.label,
    ariaSelected: tab.id === active,
    attrs: { tabindex: tab.id === active ? "0" : "-1" },
    onClick: () => activate(tab.id, true),
  }) as HTMLButtonElement);

  for (const tab of tabs) tab.pane.hidden = tab.id !== active;

  function activate(id: string, focusPill: boolean): void {
    active = id;
    const entry = ctx.rulesState.get(annotationId);
    if (entry) entry.tab = id;
    tabs.forEach((tab, index) => {
      const on = tab.id === id;
      tab.pane.hidden = !on;
      pills[index].setAttribute("aria-selected", String(on));
      pills[index].tabIndex = on ? 0 : -1;
      if (on && focusPill) pills[index].focus();
    });
  }

  pills.forEach((pill, index) => {
    pill.addEventListener("keydown", (event) => {
      const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1
        : 0;
      if (delta === 0) return;
      event.preventDefault();
      activate(tabs[(index + delta + tabs.length) % tabs.length].id, true);
    });
  });

  return el("div", { className: "ap-stack" }, [
    el("div", {
      className: "ap-subtabs",
      role: "tablist",
      attrs: { "aria-label": "Hotspot panes" },
    }, [el("div", { className: "ap-subtab-row", role: "presentation" }, pills)]),
    ...tabs.map((tab) => tab.pane),
  ]);
}
