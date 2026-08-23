/**
 * stopInspector.ts — the tour-stop inspect pane (Plan 14 P6). Per the Pencil
 * `Panel-Stops-Inspect` frame: Label · Copy (title/body OR editorial columns) ·
 * bound-block chips + "＋ text block here" · OPTICS · Camera (set-from-view /
 * go-to-stop) · Delete. Reorder (up/down) stays in the browse rows.
 *
 * All copy/editorial/chip/optics semantics are copied VERBATIM from the retired
 * stop card via shared helpers exported from tabTour.ts — a caption stop upserts
 * title/body blocks; "＋ Editorial columns" converts and unbinds; "＋ text block
 * here" creates + opens a bound block. Nothing here reinvents those flows.
 */

import { el, sectionLabel, textBtn } from "./primitives";
import { breadcrumb, paneRow, textInputRow, type EntityPaneDeps } from "./paneKit";
import {
  blockChips,
  cameraText,
  convertStopToEditorialColumns,
  deleteStop,
  renderOptics,
  setStopCameraFromView,
  stopBlockContent,
  stopBodyBlockUpsert,
  stopColumnsBlock,
  stopTitle,
  stopTitleBlockUpsert,
} from "./tabTour";
import type { SiteStop } from "../SiteConfig";
import type { InspectorPane } from "../authorPanelTypes";
import type { AuthorTabCtx } from "./tabContext";

export function createStopPane(
  stop: SiteStop,
  ctx: AuthorTabCtx,
  deps: EntityPaneDeps,
): InspectorPane {
  const sid = stop.id!;
  const columnsBlock = stopColumnsBlock(ctx, sid);

  const header = breadcrumb({
    tab: "Tour",
    title: stopTitle(stop),
    onBack: () => deps.back(),
    deleteLabel: "Delete stop",
    onDelete: () => deleteStop(ctx, stop),
  });

  const cameraMeta = el("span", { className: "ap-stop-camera-meta", text: cameraText(stop) });

  const copySection: HTMLElement[] = columnsBlock
    ? [
        sectionLabel("Editorial copy"),
        paneRow("Copy", textareaFor(
          typeof columnsBlock.content === "string" ? columnsBlock.content : "",
          (value) => {
            columnsBlock.content = value;
            ctx.onChange("text");
          },
        )),
      ]
    : [
        sectionLabel("Copy"),
        textInputRow("Title", stopBlockContent(ctx, `stop-${sid}-title`), (value) =>
          stopTitleBlockUpsert(ctx, sid, value)),
        paneRow("Body", textareaFor(stopBlockContent(ctx, `stop-${sid}-body`), (value) =>
          stopBodyBlockUpsert(ctx, sid, value))),
        el("div", { className: "ap-actions" }, [
          textBtn("plus", "+ Editorial columns", {
            onClick: () => convertStopToEditorialColumns(ctx, sid),
          }),
        ]),
      ];

  const body = el("div", { className: "ap-stack" }, [
    textInputRow("Label", stop.label, (value) => {
      stop.label = value;
      ctx.onChange("copy");
    }),
    ...copySection,

    sectionLabel("Bound blocks"),
    blockChips(ctx, sid),

    // Optics (FOV / Focus / Aperture) — verbatim card semantics.
    renderOptics(ctx, stop),

    sectionLabel("Camera"),
    paneRow("This stop", cameraMeta),
    el("div", { className: "ap-actions" }, [
      textBtn("camera", "Set from current view", {
        onClick: () => {
          setStopCameraFromView(ctx, stop);
          cameraMeta.textContent = cameraText(stop);
        },
      }),
      textBtn("play", "Go to stop", {
        onClick: () => {
          const index = ctx.site.stops.indexOf(stop);
          if (index >= 0) ctx.goToStop?.(index);
        },
      }),
      textBtn("eye", "Frame in view", {
        tone: "accent",
        onClick: () => deps.frame({ kind: "stop", id: sid }),
      }),
    ]),
    el("div", {
      className: "ap-hint",
      text: "Esc or ← Back returns to the list. Reorder stops from the list.",
    }),
  ]);

  return { header, body, select: () => {}, deselect: () => {} };
}

function textareaFor(value: string, onValue: (value: string) => void): HTMLElement {
  const area = el("textarea", {
    className: "ap-input ap-textarea",
    attrs: { rows: "3" },
    text: value,
  }) as HTMLTextAreaElement;
  area.addEventListener("input", () => onValue(area.value));
  return area;
}
