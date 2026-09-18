/**
 * H-API consumer fixture — the SHARED surface (doc 05 H-API: "TypeScript
 * consumers compile against either toolkit unchanged"; ticket 09 AC6, owner
 * ruling Stop 17 C1).
 *
 * This file is compiled TWICE, unchanged, with `@toolkit/*` mapped at this
 * toolkit's `src/` and at a pinned sparkjs export's `src/` (fd67153). It must
 * compile against BOTH. It names only the barrel surface a consuming site
 * actually uses, and it deliberately touches the two members ticket 09 re-typed
 * but did NOT rename (doc 06 D28): `handle.sparkScene` and
 * `LoadedScene.mesh` — read through API that both toolkits' types provide.
 *
 * Nothing here runs: it is a compile fixture. The sibling `scene-naming.ts`
 * carries the one divergence D24 predicts.
 */

import {
  createSiteRuntime,
  defineSplatSite,
  formatFragment,
  normalizeSiteConfig,
  parseFragment,
  type SiteConfig,
  type SiteRuntimeHandle,
} from "@toolkit/index";

/** Boot the element and the runtime exactly as a consuming site does. */
export function mount(container: HTMLElement, rawSite: unknown): SiteRuntimeHandle {
  defineSplatSite();
  const site: SiteConfig = normalizeSiteConfig(structuredClone(rawSite));
  const stopCount: number = site.stops.length;
  void stopCount;
  return createSiteRuntime({ container, rawSite, author: false });
}

/** Host-side routing, through the barrel's own helpers. */
export function routeLabel(hash: string): string {
  const target = parseFragment(hash);
  return target ? formatFragment(target) : "";
}

/** The re-typed-but-not-renamed members (doc 06 D28), read through API both
 *  toolkits' types carry: the scene facade's own Object3D scene graph, and each
 *  loaded scene's object transform and visibility. */
export function sceneSummary(handle: SiteRuntimeHandle): string {
  const childCount = handle.sparkScene.scene.children.length;
  const visible = handle.loadedScenes.filter((entry) => entry.visible).length;
  const firstY = handle.loadedScenes[0]?.mesh.position.y ?? 0;
  return `${childCount} objects, ${visible} visible scene(s), first mesh y=${firstY}`;
}

/** Navigation through the handle's own commands. */
export function goToFirstStop(handle: SiteRuntimeHandle): void {
  handle.goToStop(0);
}
