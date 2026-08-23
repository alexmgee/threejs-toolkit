import {
  blocksShownByAnnotation,
  seededCaptionBlock,
  stopShowingBlock,
  unbindBlocksFrom,
  uniqueBlockId,
  type SiteStop,
} from "../SiteConfig";
import {
  collapsible,
  el,
  field,
  icon,
  iconBtn,
  sectionLabel,
  slider,
  textBtn,
} from "./primitives";
import type { AuthorTabCtx } from "./tabContext";
import { displayLabel } from "./textInspector";

export function renderTour(ctx: AuthorTabCtx): HTMLElement {
  return el("div", { className: "ap-stack" }, [
    el("div", { className: "ap-actions" }, [
      textBtn("plus", "+ Add stop from view", {
        tone: "accent",
        onClick: () => {
          // Never reuse an id: a deleted stop's id may still be referenced by
          // blocks, bindings, or variants in saved data — a dormant
          // `when.stopId` variant would silently reactivate against the new stop.
          const taken = (candidate: string): boolean =>
            ctx.site.stops.some((stop) => stop.id === candidate)
            || ctx.site.blocks.some((block) =>
              block.id === `stop-${candidate}-body`
              || block.id === `stop-${candidate}-title`
              || block.id === `editorial-${candidate}`
              || block.binding?.stops?.includes(candidate) === true
              || block.variants?.some((variant) => variant.when.stopId === candidate) === true)
            || ctx.site.styles.some((style) =>
              style.variants?.some((variant) => variant.when.stopId === candidate) === true);
          let n = ctx.site.stops.length;
          while (taken(`stop-${n}`)) n++;
          const sid = `stop-${n}`;
          ctx.site.stops.push({
            id: sid,
            label: `Stop ${n}`,
            camera: ctx.getCameraState(),
          });
          ctx.site.blocks.push(seededCaptionBlock("body", `stop-${sid}-body`, "", { stops: [sid] }));
          ctx.structural("stops");
        },
      }),
    ]),
    sectionLabel(`${ctx.site.stops.length} Stops`),
    ...ctx.site.stops.map((stop, index) => renderStopRow(ctx, stop, index)),
    el("div", {
      className: "ap-hint",
      text: "Click a stop to open its editor — copy, optics, camera, and bound blocks live there.",
    }),
  ]);
}

/** Browse row: click the label to inspect; reorder handles stay list-level
 *  (per Plan 14), stopping propagation so they don't also open the pane. */
function renderStopRow(ctx: AuthorTabCtx, stop: SiteStop, index: number): HTMLElement {
  const reorder = (delta: number, title: string): HTMLElement =>
    iconBtn(delta < 0 ? "arrow-up" : "arrow-down", {
      title,
      onClick: (event) => {
        event.stopPropagation();
        ctx.site.stops.splice(index + delta, 0, ctx.site.stops.splice(index, 1)[0]);
        ctx.structural("stops");
      },
    });
  return el("div", { className: "ap-browse-row ap-stop-row" }, [
    el("button", {
      className: "ap-stop-row-main",
      type: "button",
      title: stopTitle(stop),
      onClick: () => ctx.selectStop(stop.id!),
    }, [
      icon("route"),
      el("span", { className: "ap-browse-row-title", text: stopTitle(stop) }),
      el("span", { className: "ap-chip ap-browse-row-chip", text: cameraText(stop) }),
    ]),
    index > 0 ? reorder(-1, "Move up") : null,
    index < ctx.site.stops.length - 1 ? reorder(1, "Move down") : null,
  ]);
}

// ─── Shared stop-body helpers (used by stopInspector.ts) ──

export function stopTitleBlockUpsert(ctx: AuthorTabCtx, sid: string, value: string): void {
  const titleId = `stop-${sid}-title`;
  const existing = ctx.site.blocks.find((block) => block.id === titleId);
  if (value && !existing) {
    ctx.site.blocks.push(seededCaptionBlock("title", titleId, value, { stops: [sid] }));
  } else if (existing && value) {
    existing.content = value;
  } else if (existing) {
    ctx.site.blocks.splice(ctx.site.blocks.indexOf(existing), 1);
  }
  ctx.onChange("text");
}

export function stopBodyBlockUpsert(ctx: AuthorTabCtx, sid: string, value: string): void {
  const bodyId = `stop-${sid}-body`;
  let existing = ctx.site.blocks.find((block) => block.id === bodyId);
  if (!existing) {
    existing = seededCaptionBlock("body", bodyId, "", { stops: [sid] });
    ctx.site.blocks.push(existing);
  }
  existing.content = value;
  ctx.onChange("text");
}

export function stopColumnsBlock(ctx: AuthorTabCtx, sid: string) {
  return ctx.site.blocks.find(
    (block) => block.presentation === "columns" && block.binding?.stops?.includes(sid),
  );
}

export function stopBlockContent(ctx: AuthorTabCtx, blockId: string): string {
  const block = ctx.site.blocks.find((candidate) => candidate.id === blockId);
  return typeof block?.content === "string" ? block.content : "";
}

/** Set the stop's camera to the live view; caller updates any summary UI. */
export function setStopCameraFromView(ctx: AuthorTabCtx, stop: SiteStop): void {
  stop.camera = ctx.getCameraState();
  ctx.onChange("stops");
}

/** Delete a stop and unbind its blocks. */
export function deleteStop(ctx: AuthorTabCtx, stop: SiteStop): void {
  const index = ctx.site.stops.indexOf(stop);
  if (index >= 0) ctx.site.stops.splice(index, 1);
  unbindBlocksFrom(ctx.site.blocks, "stops", stop.id!);
  ctx.structural("stops");
}

/** Convert a caption stop to editorial columns: move the body copy into a new
 *  columns block and unbind-or-drop the caption blocks (restores the retired
 *  Mode toggle's only create path — the ONLY UI that produces a columns block).
 *  A caption block the author shared across stops keeps serving the others. */
export function convertStopToEditorialColumns(ctx: AuthorTabCtx, sid: string): void {
  const titleId = `stop-${sid}-title`;
  const bodyId = `stop-${sid}-body`;
  // LIVE lookup, not a render-time capture — content edits don't rerender, so a
  // body block created after render (author typed copy first) must still be seen.
  const liveBody = ctx.site.blocks.find((block) => block.id === bodyId);
  ctx.site.blocks.push({
    id: `editorial-${sid}`,
    content: typeof liveBody?.content === "string" ? liveBody.content : "",
    space: "screen",
    presentation: "columns",
    styleId: "editorial",
    binding: { stops: [sid] },
    placement: {},
  });
  for (let i = ctx.site.blocks.length - 1; i >= 0; i--) {
    const candidate = ctx.site.blocks[i];
    if (candidate.id !== titleId && candidate.id !== bodyId) continue;
    const boundStops = candidate.binding?.stops;
    const remaining = boundStops?.filter((id) => id !== sid) ?? [];
    // The keep-alive check: does this block have any OTHER reason to be on
    // screen? It used to ask whether a marker was bound to it — a question with
    // only one answer since ticket 17 retired that binding, which would have
    // made this guard vacuously true and quietly deleted blocks a marker still
    // shows. Asked of the RULES now, where the answer moved.
    const shownByMarker = ctx.site.annotations.some((annotation) =>
      blocksShownByAnnotation(annotation).includes(candidate.id));
    if (remaining.length === 0 && candidate.binding.always !== true
      && candidate.binding.range === undefined
      && !shownByMarker) {
      ctx.site.blocks.splice(i, 1);
      // Nothing else names it, but a rule might still — retract before the
      // reference dangles into the next load.
      stopShowingBlock(ctx.site.annotations, candidate.id);
    } else {
      candidate.binding.stops = remaining;
    }
  }
  ctx.structural("text");
}

/** The stop's doorway into the block inspector (D11, P8c): every block bound
 *  to this stop as a clickable chip, plus a one-tap pre-bound panel creator.
 *  Chips SELECT (browse → inspect); structure edits stay on the Text tab. */
export function blockChips(ctx: AuthorTabCtx, sid: string): HTMLElement {
  const bound = ctx.site.blocks.filter((block) => block.binding?.stops?.includes(sid) === true);
  return field("Blocks", el("div", { className: "ap-badges ap-block-chips" }, [
    ...bound.map((block) => el("button", {
      className: "ap-chip ap-chip-btn",
      type: "button",
      title: `Inspect ${displayLabel(block)}`,
      text: shortChipLabel(block),
      dataset: { tone: block.space === "world" ? "accent" : "neutral" },
      attrs: { dir: "auto" },
      onClick: () => ctx.selectBlock(block.id),
    })),
    el("button", {
      className: "ap-chip ap-chip-btn",
      type: "button",
      title: "Add a text block bound to this stop",
      text: "＋ text block here",
      dataset: { tone: "accent" },
      onClick: () => {
        const id = uniqueBlockId(ctx.site.blocks);
        ctx.site.blocks.push({
          id,
          content: "New text",
          space: "screen",
          presentation: "panel",
          styleId: "caption-body",
          binding: { stops: [sid] },
          // "left" — the corner without the engagement chrome, as a starting value.
          placement: { slot: "left" },
        });
        ctx.structural("text");
        ctx.selectBlock(id);
      },
    }),
  ]));
}

function shortChipLabel(block: Parameters<typeof displayLabel>[0]): string {
  // Slice by code point, not UTF-16 unit — `String.slice` can split an emoji
  // surrogate pair and emit a lone half (a mojibake glyph in the chip).
  const points = [...displayLabel(block)];
  return points.length > 24 ? `${points.slice(0, 21).join("")}…` : points.join("");
}

export function renderOptics(ctx: AuthorTabCtx, stop: SiteStop): HTMLElement {
  const defaultFov = ctx.site.settings?.fov ?? 60;
  return el("div", { className: "ap-stack" }, [
    sectionLabel("Optics"),
    el("div", {
      className: "ap-hint",
      text: "Camera optics for this stop, blended as the camera travels.",
    }),
    slider({
      label: "Field of view",
      value: stop.optics?.fov ?? defaultFov,
      min: 20,
      max: 120,
      step: 1,
      fmt: formatInt,
      onInput: (value) => {
        (stop.optics ??= {}).fov = value;
        ctx.onChange("stops");
      },
    }),
    slider({
      label: "Focus distance",
      value: stop.optics?.focalDistance ?? 10,
      min: 0.5,
      max: 50,
      step: 0.1,
      fmt: formatNumber,
      onInput: (value) => {
        (stop.optics ??= {}).focalDistance = value;
        ctx.onChange("stops");
      },
    }),
    slider({
      label: "Aperture",
      value: stop.optics?.apertureAngle ?? 0,
      min: 0,
      max: 10,
      step: 0.1,
      fmt: formatNumber,
      onInput: (value) => {
        (stop.optics ??= {}).apertureAngle = value;
        ctx.onChange("stops");
      },
    }),
  ]);
}

export function stopTitle(stop: SiteStop): string {
  return stop.label || "Untitled stop";
}

export function cameraText(stop: SiteStop): string {
  const camera = stop.camera;
  return [
    `yaw ${formatNumber(camera.yaw)}`,
    `pitch ${formatNumber(camera.pitch)}`,
    `dist ${formatNumber(camera.distance)}`,
  ].join(" / ");
}

export function textInput(value: string, onValue: (value: string) => void): HTMLInputElement {
  return el("input", {
    className: "ap-input",
    type: "text",
    attrs: { value },
    onInput: (event) => onValue((event.currentTarget as HTMLInputElement).value),
  }) as HTMLInputElement;
}

export function textareaInput(value: string, onValue: (value: string) => void): HTMLTextAreaElement {
  return el("textarea", {
    className: "ap-input ap-textarea",
    attrs: { rows: "4" },
    text: value,
    onInput: (event) => onValue((event.currentTarget as HTMLTextAreaElement).value),
  }) as HTMLTextAreaElement;
}

function formatNumber(value: number): string {
  return String(Number(value.toFixed(2)));
}

function formatInt(value: number): string {
  return String(Math.round(value));
}
