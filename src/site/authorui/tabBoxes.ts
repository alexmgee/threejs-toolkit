import { uniqueEntityId, type SiteObstacleBox } from "../SiteConfig";
import {
  el,
  sectionLabel,
  textBtn,
} from "./primitives";
import { browseRow } from "./paneKit";
import type { AuthorTabCtx } from "./tabContext";

type Vec3 = [number, number, number];

export function renderBoxes(ctx: AuthorTabCtx): HTMLElement {
  return el("div", { className: "ap-stack" }, [
    el("div", { className: "ap-actions" }, [
      textBtn("square-dashed", "+ Add box (pick 2 corners)", {
        tone: "accent",
        onClick: () => {
          void ctx.pickPoint().then((a) => {
            if (!a) return;
            void ctx.pickPoint().then((b) => {
              if (!b) return;
              const box: SiteObstacleBox = {
                id: uniqueEntityId(ctx.site.obstacles.map((item) => item.id), "box"),
                min: [0, 0, 0],
                max: [0, 0, 0],
              };
              setBoxFromCorners(box, a, b);
              ctx.site.obstacles.push(box);
              ctx.structural("obstacles");
            });
          });
        },
      }),
      textBtn("plus", "+ Add box (pick)", {
        onClick: () => {
          void ctx.pickPoint().then((point) => {
            if (!point) return;
            ctx.site.obstacles.push({
              id: uniqueEntityId(ctx.site.obstacles.map((item) => item.id), "box"),
              min: [point[0] - 0.5, point[1] - 0.5, point[2] - 0.5],
              max: [point[0] + 0.5, point[1] + 0.5, point[2] + 0.5],
            });
            ctx.structural("obstacles");
          });
        },
      }),
    ]),
    el("div", {
      className: "ap-hint",
      text: "Boxes keep long-form text from covering scene areas — invisible to visitors.",
    }),
    sectionLabel(`${ctx.site.obstacles.length} Boxes`),
    ...ctx.site.obstacles.map((box) => browseRow({
      icon: "square-dashed",
      title: box.label ?? box.id,
      chips: [{ text: boxDims(box) }],
      onClick: () => ctx.selectBox(box.id),
    })),
    el("div", {
      className: "ap-hint",
      text: "Click a box to open its editor — placement, appearance, and gizmo live there.",
    }),
  ]);
}

/** Row summary chip: `W × H × D`, plus the dominant rotation when rotated. */
function boxDims(box: SiteObstacleBox): string {
  const size = getSize(box).map(formatTrimmed).join(" × ");
  const rotation = box.rotationDeg ?? [0, 0, 0];
  const dominant = rotation.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
  return dominant !== 0 ? `${size} · ${formatTrimmed(dominant)}°` : size;
}

function setBoxFromCorners(
  box: SiteObstacleBox,
  a: Vec3,
  b: Vec3,
  minSize = 0.2,
): void {
  const min: Vec3 = [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.min(a[2], b[2]),
  ];
  const max: Vec3 = [
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.max(a[2], b[2]),
  ];
  for (let axis = 0; axis < 3; axis++) {
    const size = max[axis] - min[axis];
    if (size >= minSize) continue;
    const pad = (minSize - size) / 2;
    min[axis] -= pad;
    max[axis] += pad;
  }
  box.min = min;
  box.max = max;
}

export function padBox(box: SiteObstacleBox, delta: number, minSize = 0.05): void {
  const min: Vec3 = [...box.min];
  const max: Vec3 = [...box.max];
  for (let axis = 0; axis < 3; axis++) {
    min[axis] -= delta;
    max[axis] += delta;
    if (max[axis] - min[axis] >= minSize) continue;
    const center = (min[axis] + max[axis]) / 2;
    min[axis] = center - minSize / 2;
    max[axis] = center + minSize / 2;
  }
  box.min = min;
  box.max = max;
}

export function getCenter(box: SiteObstacleBox): Vec3 {
  return [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
}

export function getSize(box: SiteObstacleBox): Vec3 {
  return [
    box.max[0] - box.min[0],
    box.max[1] - box.min[1],
    box.max[2] - box.min[2],
  ];
}

export function applyCenterSize(box: SiteObstacleBox, center: Vec3, size: Vec3): void {
  box.min = [
    center[0] - size[0] / 2,
    center[1] - size[1] / 2,
    center[2] - size[2] / 2,
  ];
  box.max = [
    center[0] + size[0] / 2,
    center[1] + size[1] / 2,
    center[2] + size[2] / 2,
  ];
}

function formatTrimmed(value: number): string {
  return String(Number(value.toFixed(2)));
}
