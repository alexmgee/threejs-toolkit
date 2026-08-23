/**
 * boxInspector.ts — the obstacle-box inspect pane (Plan 14 P4, the reference
 * entity pane). Sections per the Pencil `Panel-Boxes-Inspect` frame: NAME ·
 * POSITION · SIZE (+ pad) · ROTATION · APPEARANCE · GIZMO · ACTIONS.
 *
 * Data semantics are copied VERBATIM from the retired tabBoxes card: center/
 * size edits reproject min/max via applyCenterSize; pad is delta-applied; an
 * all-zero rotation deletes the field; fit-to-hotspot uses the same radius
 * rule. Every edit fires ctx.onChange — no structural rerender (focus
 * contract); structural actions (delete) go through ctx.structural.
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
import { applyCenterSize, getCenter, getSize, padBox } from "./tabBoxes";
import type { SiteObstacleBox } from "../SiteConfig";
import type { InspectorPane } from "../authorPanelTypes";
import type { AuthorTabCtx } from "./tabContext";

type Vec3 = [number, number, number];

const DEFAULT_COLOR = "#4ade80";
const DEFAULT_LINE_WIDTH = 1;

export function createBoxPane(
  box: SiteObstacleBox,
  ctx: AuthorTabCtx,
  deps: EntityPaneDeps,
): InspectorPane {
  const header = breadcrumb({
    tab: "Boxes",
    title: box.label ?? box.id,
    onBack: () => deps.back(),
    onDelete: () => {
      const index = ctx.site.obstacles.indexOf(box);
      if (index >= 0) ctx.site.obstacles.splice(index, 1);
      clearGizmoIfOurs();
      // structural → rerender → the pane's entity is gone → panel falls back to browse.
      ctx.structural("obstacles");
    },
  });

  const body = el("div", { className: "ap-stack" }, [
    // ── NAME ──
    textInputRow("Name", box.label ?? "", (value) => {
      if (value.trim() === "") delete box.label;
      else box.label = value;
      ctx.onChange("meta"); // display-only — no scene effect
    }),

    // ── POSITION ──
    sectionHeading("Position"),
    ...axisRows("Center", getCenter(box), 0.1, (axis, value) => {
      const center = getCenter(box);
      center[axis] = value;
      applyCenterSize(box, center, getSize(box));
      ctx.onChange("obstacles");
    }),

    // ── SIZE ──
    sectionHeading("Size"),
    ...axisRows("Size", getSize(box), 0.1, (axis, value) => {
      // No clamp — the retired card stored the raw value (byte-identical parity);
      // the obstacle gizmo is where the 0.05 floor lives.
      const size = getSize(box);
      size[axis] = value;
      applyCenterSize(box, getCenter(box), size);
      ctx.onChange("obstacles");
    }, ["W", "H", "D"]),
    padRow(),

    // ── ROTATION ──
    sectionHeading("Rotation"),
    ...axisRows("Rotation", currentRotation(), 1, (axis, value) => {
      const rotation = currentRotation();
      rotation[axis] = value;
      if (rotation[0] === 0 && rotation[1] === 0 && rotation[2] === 0) {
        delete box.rotationDeg;
      } else {
        box.rotationDeg = rotation;
      }
      ctx.onChange("obstacles");
    }, ["X (°)", "Y (°)", "Z (°)"], { min: -180, max: 180 }),

    // ── APPEARANCE ──
    sectionHeading("Appearance"),
    lineColorRow(),
    sliderRow({
      label: "Line weight (px)",
      value: box.lineWidth ?? DEFAULT_LINE_WIDTH,
      min: 0.5,
      max: 8,
      step: 0.5,
      onInput: (value) => {
        if (value === DEFAULT_LINE_WIDTH) delete box.lineWidth;
        else box.lineWidth = value;
        ctx.onChange("obstacles");
      },
    }),

    // ── GIZMO ──
    ...(ctx.authorGizmo ? [sectionHeading("Gizmo"), gizmoRow()] : []),

    // ── ACTIONS ──
    sectionHeading("Actions"),
    actionsRow(),
    el("div", {
      className: "ap-hint",
      text: "Esc or ← Back returns to the list. Only this box is editable while open.",
    }),
  ]);

  return {
    header,
    body,
    select: () => {},
    deselect: () => clearGizmoIfOurs(),
  };

  // ── Section builders ──

  function currentRotation(): Vec3 {
    return [
      box.rotationDeg?.[0] ?? 0,
      box.rotationDeg?.[1] ?? 0,
      box.rotationDeg?.[2] ?? 0,
    ];
  }

  function padRow(): HTMLElement {
    // Delta-applied, exactly like the retired card: the slider's absolute value
    // is a session scrub position; each move applies only the delta.
    let prevPad = 0;
    return sliderRow({
      label: "Pad (all faces)",
      value: 0,
      min: -2,
      max: 2,
      step: 0.05,
      onInput: (value) => {
        const delta = value - prevPad;
        prevPad = value;
        padBox(box, delta);
        ctx.onChange("obstacles");
      },
    });
  }

  function lineColorRow(): HTMLElement {
    // Swatch (native picker) + editable hex field (per the Pencil frame), kept
    // in sync. Either writes box.color; typing the default deletes the field.
    const swatch = el("input", {
      className: "ap-color",
      type: "color",
      attrs: { value: box.color ?? DEFAULT_COLOR },
    }) as HTMLInputElement;
    const hex = el("input", {
      className: "ap-input ap-color-hex",
      type: "text",
      attrs: { value: box.color ?? DEFAULT_COLOR, spellcheck: "false", "aria-label": "Line color hex" },
    }) as HTMLInputElement;
    const commit = (value: string): void => {
      if (value.toLowerCase() === DEFAULT_COLOR) delete box.color;
      else box.color = value;
      ctx.onChange("obstacles");
    };
    swatch.addEventListener("input", () => {
      hex.value = swatch.value;
      commit(swatch.value);
    });
    hex.addEventListener("input", () => {
      const value = hex.value.trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(value)) return; // wait for a full valid hex
      swatch.value = value;
      commit(value);
    });
    return paneRow("Line color", el("div", { className: "ap-color-row" }, [swatch, hex]));
  }

  function gizmoRow(): HTMLElement {
    const state = deps.gizmoState();
    const activeMode: GizmoMode | null =
      state && state.kind === "box" && state.id === box.id ? state.mode : null;
    return paneGizmoRow({
      modes: ["translate", "scale", "rotate"],
      activeMode,
      space: deps.spaceFor("box"),
      onMode: (mode) => {
        // Push THIS pane's remembered space BEFORE attaching — attach re-applies
        // the gizmo's stored space, which could be another kind's leftover
        // (Box=Local then a World hotspot would otherwise attach Local).
        ctx.authorGizmo?.setSpace?.(deps.spaceFor("box"));
        // Commit: the target's own onCommit enqueues "obstacles"; the pane
        // refresh re-reads the just-committed numbers (state survives — it
        // lives in AuthorPanel, not in this DOM).
        ctx.authorGizmo?.attachObstacle(box, mode as "translate" | "scale" | "rotate",
          () => ctx.requestRerender());
        deps.setGizmoState({ kind: "box", id: box.id, mode });
        ctx.requestRerender();
      },
      onSpace: (space) => {
        deps.setSpaceFor("box", space);
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

  function actionsRow(): HTMLElement {
    const actions: HTMLElement[] = [];
    if (ctx.site.annotations.length > 0) actions.push(fitToHotspot());
    actions.push(
      textBtn("crosshair", "Re-center (pick)", {
        onClick: () => {
          void ctx.pickPoint().then((point) => {
            if (!point) return;
            applyCenterSize(box, [point[0], point[1], point[2]], getSize(box));
            // Re-sync a live gizmo proxy — else the next drag jumps the box back.
            ctx.authorGizmo?.resync?.();
            ctx.structural("obstacles");
          });
        },
      }),
      textBtn("eye", "Frame in view", {
        tone: "accent",
        onClick: () => deps.frame({ kind: "box", id: box.id }),
      }),
    );
    return el("div", { className: "ap-actions" }, actions);
  }

  function fitToHotspot(): HTMLElement {
    // Same rule as the retired card: cube of max(radius × 1.15, 0.3) about the anchor.
    let annotationId = ctx.site.annotations[0].id;
    const select = el("select", {
      className: "ap-input",
      onInput: (event) => {
        annotationId = (event.currentTarget as HTMLSelectElement).value;
      },
    }) as HTMLSelectElement;
    for (const annotation of ctx.site.annotations) {
      select.appendChild(el("option", {
        text: annotation.copy?.title || annotation.id,
        attrs: { value: annotation.id },
      }));
    }
    select.value = annotationId;
    return el("div", { className: "ap-fit-row" }, [
      select,
      textBtn("scaling", "Fit to hotspot", {
        onClick: () => {
          const annotation = ctx.site.annotations.find((item) => item.id === annotationId);
          if (!annotation) return;
          const radius = Math.max((annotation.radius ?? 0.6) * 1.15, 0.3);
          box.min = [
            annotation.anchor[0] - radius,
            annotation.anchor[1] - radius,
            annotation.anchor[2] - radius,
          ];
          box.max = [
            annotation.anchor[0] + radius,
            annotation.anchor[1] + radius,
            annotation.anchor[2] + radius,
          ];
          ctx.authorGizmo?.resync?.();
          ctx.structural("obstacles");
        },
      }),
    ]);
  }

  function clearGizmoIfOurs(): void {
    const state = deps.gizmoState();
    if (state && state.kind === "box" && state.id === box.id) {
      ctx.authorGizmo?.detach();
      deps.setGizmoState(null);
    }
  }
}

// ─── Local helpers ────────────────────────────────────────

function sectionHeading(text: string): HTMLElement {
  return sectionLabel(text);
}

function axisRows(
  label: string,
  values: Vec3,
  step: number,
  onAxis: (axis: 0 | 1 | 2, value: number) => void,
  suffixes: [string, string, string] = ["X", "Y", "Z"],
  range?: { min: number; max: number },
): HTMLElement[] {
  return ([0, 1, 2] as const).map((axis) => sliderRow({
    label: `${label} ${suffixes[axis]}`,
    value: values[axis],
    // Position/size are unbounded — the slider gets a working window around the
    // current value; the number input accepts anything beyond it.
    min: range?.min ?? values[axis] - 10,
    max: range?.max ?? values[axis] + 10,
    step,
    onInput: (value) => onAxis(axis, value),
  }));
}
