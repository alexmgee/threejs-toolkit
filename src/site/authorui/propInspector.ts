/**
 * propInspector.ts — the glTF-prop inspect pane (Plan 14 P7). Per the Pencil
 * `Panel-Objects-Inspect` frame: NAME · URL · POSITION · ROTATION · SCALE ·
 * Cast shadow · GIZMO · ACTIONS (Re-place · Frame · Delete).
 *
 * Field semantics are byte-identical to the retired prop card: url/position/
 * rotation/scale/castShadow fire onChange("props"); re-place + delete go through
 * ctx.structural("props"). A prop is keyed by id (unique across scenes); the
 * pane holds the owning scene for delete.
 */

import { el, sectionLabel, switchToggle, textBtn, type GizmoMode } from "./primitives";
import {
  breadcrumb,
  paneRow,
  sliderRow,
  textInputRow,
  paneGizmoRow,
  type EntityPaneDeps,
} from "./paneKit";
import type { SiteProp, SiteScene } from "../SiteConfig";
import type { InspectorPane } from "../authorPanelTypes";
import type { AuthorTabCtx } from "./tabContext";

type Vec3 = [number, number, number];

export function createPropPane(
  scene: SiteScene,
  prop: SiteProp,
  ctx: AuthorTabCtx,
  deps: EntityPaneDeps,
): InspectorPane {
  prop.rotationDeg ??= [0, 0, 0];
  prop.scale ??= 1;
  prop.castShadow ??= false;

  const header = breadcrumb({
    tab: "Objects",
    title: prop.label ?? propTitle(prop),
    onBack: () => deps.back(),
    deleteLabel: "Delete prop",
    onDelete: () => {
      const index = scene.props?.indexOf(prop) ?? -1;
      if (index >= 0) scene.props?.splice(index, 1);
      clearGizmoIfOurs();
      ctx.structural("props");
    },
  });

  const body = el("div", { className: "ap-stack" }, [
    textInputRow("Name", prop.label ?? "", (value) => {
      if (value.trim() === "") delete prop.label;
      else prop.label = value;
      ctx.onChange("meta"); // display-only
    }),
    textInputRow("URL", prop.url, (value) => {
      prop.url = value;
      ctx.onChange("props");
    }),

    sectionLabel("Position"),
    ...axisRows("Position", prop.position, 0.05, (axis, value) => {
      const position: Vec3 = [...prop.position];
      position[axis] = value;
      prop.position = position;
      ctx.onChange("props");
    }),

    sectionLabel("Rotation"),
    ...axisRows("Rotation", prop.rotationDeg, 1, (axis, value) => {
      const rotation: Vec3 = [prop.rotationDeg![0], prop.rotationDeg![1], prop.rotationDeg![2]];
      rotation[axis] = value;
      prop.rotationDeg = rotation;
      ctx.onChange("props");
    }, ["X (°)", "Y (°)", "Z (°)"], { min: -180, max: 180 }),

    sectionLabel("Appearance"),
    sliderRow({
      label: "Scale",
      value: prop.scale ?? 1,
      min: 0.01,
      max: 10,
      step: 0.01,
      onInput: (value) => {
        prop.scale = value;
        ctx.onChange("props");
      },
    }),
    paneRow("Cast shadow", switchToggle(prop.castShadow ?? false, (on) => {
      prop.castShadow = on;
      ctx.onChange("props");
    })),

    ...(ctx.authorGizmo ? [sectionLabel("Gizmo"), gizmoRow()] : []),

    sectionLabel("Actions"),
    el("div", { className: "ap-actions" }, [
      textBtn("crosshair", "Re-place (pick)", {
        onClick: () => {
          void ctx.pickPoint().then((point) => {
            if (!point) return;
            prop.position = point;
            ctx.authorGizmo?.resync?.();
            ctx.structural("props");
          });
        },
      }),
      textBtn("eye", "Frame in view", {
        tone: "accent",
        onClick: () => deps.frame({ kind: "prop", id: prop.id }),
      }),
    ]),
    el("div", {
      className: "ap-hint",
      text: "Esc or ← Back returns to the list. Only this object is editable while open.",
    }),
  ]);

  return {
    header,
    body,
    select: () => {},
    deselect: () => clearGizmoIfOurs(),
  };

  function gizmoRow(): HTMLElement {
    const state = deps.gizmoState();
    const activeMode: GizmoMode | null =
      state && state.kind === "prop" && state.id === prop.id ? state.mode : null;
    return paneGizmoRow({
      modes: ["translate", "scale", "rotate"],
      activeMode,
      space: deps.spaceFor("prop"),
      onMode: (mode) => {
        ctx.authorGizmo?.setSpace?.(deps.spaceFor("prop"));
        ctx.authorGizmo?.attachProp(prop, mode as "translate" | "scale" | "rotate",
          () => ctx.requestRerender());
        deps.setGizmoState({ kind: "prop", id: prop.id, mode });
        ctx.requestRerender();
      },
      onSpace: (space) => {
        deps.setSpaceFor("prop", space);
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
    if (state && state.kind === "prop" && state.id === prop.id) {
      ctx.authorGizmo?.detach();
      deps.setGizmoState(null);
    }
  }
}

export function propTitle(prop: SiteProp): string {
  const fileName = prop.url.trim().split(/[\\/]/).filter(Boolean).pop();
  return fileName || "Untitled object";
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
    min: range?.min ?? values[axis] - 10,
    max: range?.max ?? values[axis] + 10,
    step,
    onInput: (value) => onAxis(axis, value),
  }));
}
