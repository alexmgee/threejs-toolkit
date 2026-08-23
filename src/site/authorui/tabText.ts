/**
 * tabText.ts — the Text-tab block registry (P7a).
 *
 * Replaces the P5b interim splat cards: EVERY text block (panel, free, columns,
 * splat, plane) is first-class here, listed with space/presentation badges and
 * filterable by space / presentation. A row selects the block into the
 * inspector (browse → inspect); "+ New block" creates one per presentation
 * (world presentations pick a point); the trash button removes one.
 *
 * All styling now lives in the inspector — this tab is pure navigation +
 * structure (add/remove), so its mutations are `structural` (they change the
 * block list), never the focus-preserving `onChange` the inspector uses.
 */

import type { TextBlock, WorldPlacement } from "../../text/TextModel";
import { stopShowingBlock, uniqueBlockId } from "../SiteConfig";
import {
  chip,
  el,
  iconBtn,
  sectionLabel,
  textBtn,
} from "./primitives";
import type { AuthorTabCtx } from "./tabContext";
import { displayLabel } from "./textInspector";

type SpaceFilter = "all" | TextBlock["space"];
type PresentationFilter = "all" | TextBlock["presentation"];

// Filters persist across rerenders (module state, like the tour tab's gizmo
// flag) so a structural refresh does not silently reset the author's view.
let filterSpace: SpaceFilter = "all";
let filterPresentation: PresentationFilter = "all";

const PRESENTATIONS: TextBlock["presentation"][] = ["panel", "free", "columns", "splat", "plane"];

const PRESENTATION_LABEL: Record<TextBlock["presentation"], string> = {
  panel: "Panel",
  free: "Free",
  columns: "Columns",
  splat: "Splat",
  plane: "Plane",
};

let newPresentation: TextBlock["presentation"] = "panel";

export function renderText(ctx: AuthorTabCtx): HTMLElement {
  const all = ctx.site.blocks;
  const blocks = all.filter(
    (block) =>
      (filterSpace === "all" || block.space === filterSpace) &&
      (filterPresentation === "all" || block.presentation === filterPresentation),
  );

  return el("div", { className: "ap-stack" }, [
    renderNewBlock(ctx),
    renderFilters(ctx),
    sectionLabel(
      blocks.length === all.length
        ? `${all.length} text block${all.length === 1 ? "" : "s"}`
        : `${blocks.length} of ${all.length} blocks`,
    ),
    blocks.length === 0
      ? el("div", { className: "ap-hint", text: "No blocks match the current filters." })
      : el("div", { className: "ap-stack" }, blocks.map((block) => renderRow(ctx, block))),
  ]);
}

function renderRow(ctx: AuthorTabCtx, block: TextBlock): HTMLElement {
  const main = el("button", {
    className: "ap-registry-main",
    type: "button",
    title: `Inspect ${displayLabel(block)}`,
    onClick: () => ctx.selectBlock(block.id),
  }, [
    el("div", { className: "ap-registry-line" }, [
      el("span", { className: "ap-item-title", text: displayLabel(block) }),
      el("div", { className: "ap-badges" }, [
        chip(block.space, "accent"),
        chip(PRESENTATION_LABEL[block.presentation]),
      ]),
    ]),
    el("div", { className: "ap-registry-meta", text: rowMeta(ctx, block) }),
  ]);

  const remove = iconBtn("trash", {
    tone: "danger",
    title: `Delete ${displayLabel(block)}`,
    onClick: () => {
      const index = ctx.site.blocks.indexOf(block);
      if (index < 0) return;
      ctx.site.blocks.splice(index, 1);
      // A rule naming this block lives on the ANNOTATION and outlives the
      // splice (ticket 17). Left behind it throws "references unknown block id"
      // on the next load, and until then the display channel can hold a claim
      // on a block that is not there. A binding needed no such cleanup, because
      // it died with the block it was written on.
      stopShowingBlock(ctx.site.annotations, block.id);
      // Forget this block's persisted edit scope (DD0 / consult #2) — a block
      // later recreated under the same id must open at Base, not inherit the
      // deleted one's variant scope. Mirrors the style-delete path in tabLook.
      ctx.resetInspectorScope("block", block.id);
      ctx.structural("text");
    },
  });

  return el("div", { className: "ap-registry-row" }, [main, remove]);
}

function rowMeta(ctx: AuthorTabCtx, block: TextBlock): string {
  const parts = [block.styleId ?? "no style", shortBinding(ctx, block)];
  return parts.filter(Boolean).join(" · ");
}

function shortBinding(ctx: AuthorTabCtx, block: TextBlock): string {
  const binding = block.binding;
  if (binding.always) return "always";
  const stops = binding.stops ?? [];
  if (stops.length > 0) {
    return `@ ${stops.map((id) => ctx.site.stops.find((stop) => stop.id === id)?.label ?? id).join(", ")}`;
  }
  if (binding.range) return `scroll ${binding.range.from}–${binding.range.to}`;
  // Markers stopped being a binding (ticket 17) — the `⚑ <marker>` case that
  // used to sit here became unreachable, because no block carries an
  // annotations leg after load. A block a marker shows is described by its
  // RULE, which is what this row now says.
  const shownBy = ctx.site.annotations.filter((annotation) =>
    annotation.rules?.some((rule) =>
      rule.do.some((effect) => effect.kind === "show-blocks" && effect.blocks.includes(block.id))));
  if (shownBy.length > 0) {
    return `⚑ ${shownBy.map((a) => a.copy?.title ?? a.id).join(", ")}`;
  }
  return "unbound";
}

// ─── Filters ──────────────────────────────────────────────

function renderFilters(ctx: AuthorTabCtx): HTMLElement {
  const spaceSelect = filterSelect(
    "Space",
    [
      { value: "all", label: "All spaces" },
      { value: "screen", label: "Screen" },
      { value: "world", label: "World" },
    ],
    filterSpace,
    (value) => {
      filterSpace = value as SpaceFilter;
      ctx.requestRerender();
    },
  );
  const presentationSelect = filterSelect(
    "Type",
    [
      { value: "all", label: "All types" },
      ...PRESENTATIONS.map((p) => ({ value: p, label: PRESENTATION_LABEL[p] })),
    ],
    filterPresentation,
    (value) => {
      filterPresentation = value as PresentationFilter;
      ctx.requestRerender();
    },
  );
  return el("div", { className: "ap-registry-filters" }, [spaceSelect, presentationSelect]);
}

function filterSelect(
  label: string,
  options: { value: string; label: string }[],
  current: string,
  onChange: (value: string) => void,
): HTMLElement {
  const select = el("select", { className: "ap-input ap-select", ariaLabel: label }) as HTMLSelectElement;
  for (const option of options) {
    const opt = document.createElement("option");
    opt.value = option.value;
    opt.textContent = option.label;
    select.appendChild(opt);
  }
  select.value = current;
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

// ─── New block ────────────────────────────────────────────

function renderNewBlock(ctx: AuthorTabCtx): HTMLElement {
  const select = el("select", { className: "ap-input ap-select", ariaLabel: "New block type" }) as HTMLSelectElement;
  for (const presentation of PRESENTATIONS) {
    const option = document.createElement("option");
    option.value = presentation;
    option.textContent = PRESENTATION_LABEL[presentation];
    select.appendChild(option);
  }
  select.value = newPresentation;
  select.addEventListener("change", () => {
    newPresentation = select.value as TextBlock["presentation"];
  });

  const add = textBtn("plus", "Add", {
    tone: "accent",
    onClick: () => createBlock(ctx, newPresentation),
  });

  return el("div", { className: "ap-fit-row" }, [select, add]);
}

function createBlock(ctx: AuthorTabCtx, presentation: TextBlock["presentation"]): void {
  const id = uniqueBlockId(ctx.site.blocks);
  if (presentation === "splat" || presentation === "plane") {
    // World presentations need a world point — reuse the crosshair pick flow.
    void ctx.pickPoint().then((point) => {
      if (!point) return;
      ctx.site.blocks.push(worldBlock(id, presentation, point));
      commitNewBlock(ctx, id);
    });
    return;
  }
  ctx.site.blocks.push(screenBlock(id, presentation));
  commitNewBlock(ctx, id);
}

function commitNewBlock(ctx: AuthorTabCtx, id: string): void {
  ctx.structural("text");
  ctx.selectBlock(id);
}

function screenBlock(id: string, presentation: "panel" | "free" | "columns"): TextBlock {
  const base = {
    id,
    content: "New text",
    space: "screen" as const,
    binding: { always: true },
  };
  if (presentation === "panel") {
    // "left" — the corner without the engagement chrome, as a starting value the
    // Slot control changes.
    return { ...base, presentation, styleId: "caption-body", placement: { slot: "left", order: 99 } };
  }
  if (presentation === "free") {
    return {
      ...base,
      presentation,
      styleId: "body",
      placement: { rect: { x: 0.35, y: 0.35, width: 0.3, height: 0.2 } },
    };
  }
  return { ...base, presentation, styleId: "editorial", placement: {} };
}

function worldBlock(
  id: string,
  presentation: "splat" | "plane",
  position: [number, number, number],
): TextBlock {
  const placement: WorldPlacement = { position, worldPerPx: 0.125 / 32 };
  return {
    id,
    content: "New text",
    space: "world",
    presentation,
    styleId: presentation === "splat" ? "splat-text" : "body",
    binding: { always: true },
    placement,
  };
}
