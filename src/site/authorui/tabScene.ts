import type { GeoAnchor } from "../../locative/GeoAnchor";
import type { SiteScene } from "../SiteConfig";
import {
  chip,
  collapsible,
  el,
  field,
  sectionLabel,
  textBtn,
} from "./primitives";
import type { AuthorTabCtx } from "./tabContext";

type MaterializedGeoAnchor = GeoAnchor & {
  alt: number;
  headingDeg: number;
  scale: number;
};

export function renderScene(ctx: AuthorTabCtx): HTMLElement {
  const firstUnanchored = ctx.site.scenes.find((scene) => !scene.geoAnchor);
  return el("div", { className: "ap-stack" }, [
    firstUnanchored ? renderAddAnchor(ctx, firstUnanchored) : null,
    sectionLabel(`${ctx.site.scenes.length} Scenes`),
    ...ctx.site.scenes.map((scene, index) => renderSceneCard(ctx, scene, index)),
  ]);
}

function renderSceneCard(ctx: AuthorTabCtx, scene: SiteScene, index: number): HTMLElement {
  const anchor = scene.geoAnchor;

  return collapsible(summary(anchor ? "Geo anchored scene" : "Unanchored scene", scene.id), el("div", {
    className: "ap-stack",
  }, [
    el("div", { className: "ap-actions" }, [
      chip(anchor ? "geo anchor" : "unanchored", anchor ? "accent" : "neutral"),
    ]),
    anchor
      ? renderAnchorFields(ctx, scene, materializeAnchor(anchor))
      : el("div", { className: "ap-hint", text: "No geo anchor on this scene" }),
  ]), { open: index === 0 });
}

function renderAddAnchor(ctx: AuthorTabCtx, scene: SiteScene): HTMLElement {
  return el("div", { className: "ap-actions" }, [
    textBtn("plus", "+ Add geo anchor", {
      tone: "accent",
      onClick: () => {
        scene.geoAnchor = { lat: 0, lon: 0, alt: 0, headingDeg: 0, scale: 1 };
        ctx.structural("scenes");
      },
    }),
  ]);
}

function summary(title: string, badge: string): HTMLElement {
  return el("div", { className: "ap-item-summary" }, [
    el("span", { className: "ap-item-title", text: title }),
    chip(badge),
  ]);
}

function renderAnchorFields(
  ctx: AuthorTabCtx,
  scene: SiteScene,
  anchor: MaterializedGeoAnchor,
): HTMLElement {
  return el("div", { className: "ap-stack" }, [
    field("Latitude", numberInput(anchor.lat, {
      step: 0.0001,
      onValue: (value) => {
        anchor.lat = value;
        ctx.onChange("scenes");
      },
    })),
    field("Longitude", numberInput(anchor.lon, {
      step: 0.0001,
      onValue: (value) => {
        anchor.lon = value;
        ctx.onChange("scenes");
      },
    })),
    field("Altitude", numberInput(anchor.alt, {
      step: 0.1,
      onValue: (value) => {
        anchor.alt = value;
        ctx.onChange("scenes");
      },
    })),
    field("Heading", numberInput(anchor.headingDeg, {
      min: 0,
      max: 360,
      step: 0.1,
      onValue: (value) => {
        anchor.headingDeg = value;
        ctx.onChange("scenes");
      },
    })),
    field("Scale", numberInput(anchor.scale, {
      step: 0.001,
      onValue: (value) => {
        anchor.scale = value;
        ctx.onChange("scenes");
      },
    })),
    renderAnchorActions(ctx, scene, anchor),
  ]);
}

function renderAnchorActions(
  ctx: AuthorTabCtx,
  scene: SiteScene,
  anchor: MaterializedGeoAnchor,
): HTMLElement {
  return el("div", { className: "ap-actions" }, [
    ctx.getPlace
      ? textBtn("map-pin", "Use my location", {
          onClick: () => {
            void ctx.getPlace?.().then((p) => {
              if (!p) return;
              anchor.lat = p.lat;
              anchor.lon = p.lon;
              ctx.onChange("scenes");
              ctx.requestRerender();
            });
          },
        })
      : null,
    textBtn("trash", "Remove geo anchor", {
      tone: "danger",
      onClick: () => {
        delete scene.geoAnchor;
        ctx.structural("scenes");
      },
    }),
  ]);
}

function materializeAnchor(anchor: GeoAnchor): MaterializedGeoAnchor {
  anchor.alt ??= 0;
  anchor.headingDeg ??= 0;
  anchor.scale ??= 1;
  return anchor as MaterializedGeoAnchor;
}

function numberInput(
  value: number,
  options: { min?: number; max?: number; step: number; onValue: (value: number) => void },
): HTMLInputElement {
  const attrs: Record<string, string> = {
    step: String(options.step),
    value: String(value),
  };
  if (options.min !== undefined) attrs.min = String(options.min);
  if (options.max !== undefined) attrs.max = String(options.max);

  return el("input", {
    className: "ap-input",
    type: "number",
    attrs,
    onInput: (event) => {
      const next = Number((event.currentTarget as HTMLInputElement).value);
      if (!Number.isNaN(next)) options.onValue(next);
    },
  }) as HTMLInputElement;
}
