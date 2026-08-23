import { uniqueEntityId, type SiteProp, type SiteScene } from "../SiteConfig";
import {
  el,
  sectionLabel,
  textBtn,
} from "./primitives";
import { browseRow } from "./paneKit";
import { propTitle } from "./propInspector";
import type { AuthorTabCtx } from "./tabContext";

interface PropEntry {
  scene: SiteScene;
  prop: SiteProp;
  sceneIndex: number;
  propIndex: number;
}

export function renderObjects(ctx: AuthorTabCtx): HTMLElement {
  const props = collectProps(ctx);

  return el("div", { className: "ap-stack" }, [
    el("div", { className: "ap-actions" }, [
      textBtn("plus", "+ Add prop (pick)", {
        tone: "accent",
        onClick: () => {
          void ctx.pickPoint().then((point) => {
            if (!point) return;
            const scene = ctx.site.scenes[0];
            // Prop ids are unique ACROSS scenes (the prop layer keys on them) —
            // scan every scene's props, not just the target scene's.
            const allIds = ctx.site.scenes.flatMap((s) => (s.props ?? []).map((p) => p.id));
            const id = uniqueEntityId(allIds, "prop");
            (scene.props ??= []).push({
              id,
              url: "",
              position: point,
              rotationDeg: [0, 0, 0],
              scale: 1,
            });
            ctx.structural("props");
            ctx.selectProp(id); // open the new prop so its URL can be set
          });
        },
      }),
    ]),
    sectionLabel(`${props.length} Props`),
    ...props.map((entry) => browseRow({
      icon: "box",
      title: entry.prop.label ?? propTitle(entry.prop),
      chips: [{ text: `scene ${entry.sceneIndex}` }],
      onClick: () => ctx.selectProp(entry.prop.id),
    })),
    el("div", {
      className: "ap-hint",
      text: "Click an object to open its editor — URL, transform, shadow, and gizmo live there.",
    }),
  ]);
}

function collectProps(ctx: AuthorTabCtx): PropEntry[] {
  const entries: PropEntry[] = [];
  ctx.site.scenes.forEach((scene, sceneIndex) => {
    (scene.props ?? []).forEach((prop, propIndex) => {
      entries.push({ scene, prop, sceneIndex, propIndex });
    });
  });
  return entries;
}

