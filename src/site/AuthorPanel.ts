import tokensCss from "./authorui/tokens.css?raw";
import {
  downloadSiteConfig,
  serializeSiteConfig,
} from "./SiteConfig";
import type {
  FrameTarget,
  Inspectable,
  InspectorPane,
  SiteAuthorPanelConfig,
} from "./authorPanelTypes";
import {
  createAuthorPanelShell,
  type AuthorPanelShell,
  type AuthorPanelTabId,
} from "./authorui/shell";
import { el } from "./authorui/primitives";
import { renderHotspots } from "./authorui/tabHotspots";
import { renderBoxes } from "./authorui/tabBoxes";
import { renderObjects } from "./authorui/tabObjects";
import { renderText } from "./authorui/tabText";
import { renderTour } from "./authorui/tabTour";
import { renderLook } from "./authorui/tabLook";
import { renderScene } from "./authorui/tabScene";
import {
  createInspectorUiState,
  createStyleInspectable,
  createTextInspectable,
  inspectorScopeKey,
  renderStyleInspector,
  renderTextInspector,
  type InspectorUiState,
  type TextInspectorDeps,
} from "./authorui/textInspector";
import { ContextSim } from "./authorui/contextSim";
import type { AuthorTabCtx } from "./authorui/tabContext";
import { createBoxPane } from "./authorui/boxInspector";
import { createHotspotPane } from "./authorui/hotspotInspector";
import { createStopPane } from "./authorui/stopInspector";
import { createPropPane } from "./authorui/propInspector";
import type { EntityPaneDeps, PaneGizmoState } from "./authorui/paneKit";

// One fixed panel width for browse AND inspect — the browse→inspect width jump
// (380→600) was jarring in use (user feedback 2026-07-17). Both constants kept
// so the two modes stay independently tunable.
const BROWSE_WIDTH = "600px";
const INSPECT_WIDTH = "600px";
const SELECT_OUTLINE = "2px solid #4ade80";
const HOVER_OUTLINE = "2px dashed rgba(74, 222, 128, 0.6)";
// Selecting an entity frames the camera on it (user decision 2026-07-17: try
// auto-frame first). Flip to false to revert to the explicit Frame buttons only.
const AUTO_FRAME_ON_SELECT = true;

/** Every selectable entity kind. block/style use the cascade inspector
 *  (textInspector); the rest use the Plan-14 entity panes. */
type SelectedEntity = {
  kind: "block" | "style" | "box" | "hotspot" | "stop" | "prop";
  id: string;
};

export class AuthorPanel {
  private root: HTMLElement;
  private styleEl: HTMLStyleElement;
  private shell: AuthorPanelShell;
  private container: HTMLElement;
  private activeTab: AuthorPanelTabId = "Tour";
  private mode: "browse" | "inspect" = "browse";
  private selected: SelectedEntity | null = null;
  private currentPane: InspectorPane | null = null;
  // Session gizmo state — OUTSIDE pane DOM so a commit-time pane refresh can
  // rebuild the bar's pressed state while TransformControls stays attached.
  private paneGizmo: PaneGizmoState | null = null;
  private paneSpace: Record<string, "world" | "local"> = {};
  private seedState: AuthorTabCtx["seedState"] = {
    knobs: { minVotes: 8, eps: 0.5, peakFloor: 0.4, topN: 3 },
    cache: null,
    loading: null,
  };
  private fontsState: AuthorTabCtx["fontsState"] = {
    openedOnce: false,
    draft: null,
    requestId: 0,
  };
  // Per-instance Rules-pane drafts (ticket 10): half-authored rule cards have
  // no representation in the config, so they live here and survive the
  // inspector's wholesale rebuilds. Keyed by annotation id.
  private rulesState: AuthorTabCtx["rulesState"] = new Map();
  private annotationSortByConfidence: boolean = false;
  private ctx: AuthorTabCtx;
  private sim: ContextSim;
  private disposed = false;
  // Per-instance text-inspector UI state (DD0): the open sub-tab + each edit
  // target's open cascade scope. Instance-owned so two embeds never share.
  private inspectorUiState: InspectorUiState = createInspectorUiState();

  // ── On-surface selection highlight ──
  private highlightId: string | null = null;
  private hoverId: string | null = null;
  private highlightedEl: HTMLElement | null = null;
  private hoveredEl: HTMLElement | null = null;
  private highlightRaf = 0;

  // ── Drag / position (DD4) ──
  private dragging = false;
  private dragPointerId = -1;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragStartLeft = 0;
  private dragStartTop = 0;
  /** Instance-owned panel position (container-content coords). null = the CSS
   *  default (left 8 / top 36); set once dragged so it sticks across rerenders
   *  and drives the resize re-clamp. */
  private position: { left: number; top: number } | null = null;
  private collapsed = false;
  private resizeObserver: ResizeObserver | null = null;
  // Floating "Author ›" reopen tab shown while collapsed (DD5). Carries the
  // `spark-authorui` scope class so tokens.css styles it; per-instance.
  private reopenButton: HTMLButtonElement;

  constructor(private config: SiteAuthorPanelConfig) {
    this.container = config.container ?? document.body;
    this.styleEl = document.createElement("style");
    this.styleEl.textContent = tokensCss;
    // Install the tokens where the panel actually lives: a document-head <style>
    // cannot reach a shadow-hosted container, so a shadow-mounted panel renders
    // unstyled. tokens.css is class-scoped (no :root), so it moves verbatim.
    // (Cross-realm-safe shadow test — instanceof compares this realm's ctor.)
    // Light DOM mounts into the CONTAINER's document head, not the ambient
    // global one — a panel mounted into a same-origin iframe from the parent
    // realm would otherwise be unstyled.
    const root = this.container.getRootNode();
    const isShadow = root.nodeType === Node.DOCUMENT_FRAGMENT_NODE
      && (root as ShadowRoot).host !== undefined;
    (isShadow ? (root as ShadowRoot) : this.container.ownerDocument.head)
      .appendChild(this.styleEl);

    this.root = document.createElement("div");
    this.root.className = "spark-authorui";
    Object.assign(this.root.style, {
      position: "absolute",
      top: "36px",
      left: "8px",
      // Above ALL scene chrome (text layer 700, headline 740, editorial 720,
      // annotations 850, captions 900, nav/CTA 950): the authoring panel is an
      // opaque overlay and must never have scene text render on top of it. Just
      // below the loading overlay (1000) so "please wait" still covers it.
      zIndex: "999",
      width: BROWSE_WIDTH,
      maxHeight: "calc(100% - 48px)",
      // Flex column so the shell is height-capped and .ap-content becomes the
      // scroll region — header + tab strip stay fixed while content scrolls.
      display: "flex",
      flexDirection: "column",
      transition: "width 160ms ease",
    });

    this.ctx = {
      site: config.site,
      // Instance-scoped DOM lookups (e.g. the font-select refocus) query through
      // THIS panel's root — a global document.querySelector finds nothing inside
      // a shadow root, and with two light-DOM panels it hits the wrong instance.
      panelRoot: this.root,
      onChange: (kind) => config.onChange(kind),
      structural: (kind) => {
        config.onChange(kind);
        this.requestRerender();
      },
      requestRerender: () => this.requestRerender(),
      pickPoint: config.pickPoint,
      getPlace: config.getPlace,
      hotspotSeed: config.hotspotSeed,
      authorGizmo: config.authorGizmo,
      fonts: config.fonts,
      textSystem: config.textSystem,
      getCameraState: config.getCameraState,
      goToStop: config.goToStop,
      selectBlock: (id) => this.select(id),
      selectStyle: (id) => this.selectStyle(id),
      selectBox: (id) => this.selectBox(id),
      selectHotspot: (id) => this.selectHotspot(id),
      selectStop: (id) => this.selectStop(id),
      selectProp: (id) => this.selectProp(id),
      // Forget a deleted entity's persisted edit scope (DD0) — a block/style
      // recreated under the same id opens at Base, not the deleted variant.
      resetInspectorScope: (kind, id) =>
        this.inspectorUiState.activeScope.delete(inspectorScopeKey(kind, id)),
      seedState: this.seedState,
      fontsState: this.fontsState,
      rulesState: this.rulesState,
      annotationSortByConfidence: this.annotationSortByConfidence,
      setAnnotationSortByConfidence: (on) => {
        this.annotationSortByConfidence = on;
        this.ctx.annotationSortByConfidence = on;
      },
    };

    this.shell = createAuthorPanelShell({
      siteName: `Author — ${config.site.name ?? "site"}`,
      saveStateText: "draft",
      activeTab: this.activeTab,
      onExport: () => {
        downloadSiteConfig(config.site, `${config.site.name ?? "site"}.site.json`);
      },
      onCopyJson: () => {
        void navigator.clipboard.writeText(serializeSiteConfig(config.site)).then(() => {
          if (!this.disposed) this.shell.setSaveStateText("copied");
        });
      },
      onTabSelect: (id) => {
        this.activeTab = id;
        this.shell.setActiveTab(id);
        // Selecting a tab always returns to browse — the inspector is a detour,
        // not a tab. deselect() re-renders the active tab.
        if (this.mode === "inspect") this.deselect();
        else this.requestRerender();
      },
      // async wrapper so a SYNCHRONOUS throw from loadSite (bad JSON / failed
      // normalize) becomes a rejection the shell's inline error can catch.
      onLoadJson: config.loadSite
        ? async (json) => { await config.loadSite!(json); }
        : undefined,
    });

    // The context simulator (P8c) pins below the scroll region; it overrides
    // the INSPECTOR's resolve context only (style preview, not layout). It is
    // instance-owned so two panels never share a preview. A scrub only affects
    // an OPEN inspector, so rerender only in inspect mode — rebuilding a browse
    // tab on every input would reset disclosures and re-run hotspot clustering
    // for nothing (consult finding C).
    this.sim = new ContextSim({
      containerSize: () => ({
        w: this.container.clientWidth || window.innerWidth,
        h: this.container.clientHeight || window.innerHeight,
      }),
      onChange: () => {
        if (this.mode === "inspect") this.requestRerender();
      },
    });
    this.shell.footerHost.appendChild(this.sim.element);

    this.root.appendChild(this.shell.root);
    this.container.appendChild(this.root);

    // Author-mode selection sources: click/hover on a block's rendered surface.
    this.container.addEventListener("click", this.onSurfaceClick);
    this.container.addEventListener("pointermove", this.onSurfacePointerMove);
    this.container.addEventListener("pointerleave", this.onSurfacePointerLeave);
    document.addEventListener("keydown", this.onKeyDown);

    // Drag by the header grip (DD4); re-clamp the position when the container
    // resizes (skipped while collapsed — display:none measures 0).
    this.shell.dragHandle.addEventListener("pointerdown", this.onDragStart);
    this.resizeObserver = new ResizeObserver(() => this.onContainerResize());
    this.resizeObserver.observe(this.container);

    // Collapse to a floating reopen tab (DD5). The reopen control carries the
    // scope class so tokens.css styles it, lives in the container (independently
    // clamped), and is hidden until collapse. Per-instance.
    this.reopenButton = document.createElement("button");
    this.reopenButton.className = "spark-authorui ap-reopen";
    this.reopenButton.type = "button";
    this.reopenButton.textContent = "Author ›";
    this.reopenButton.title = "Reopen author panel";
    this.reopenButton.setAttribute("aria-label", "Reopen author panel");
    Object.assign(this.reopenButton.style, { position: "absolute", zIndex: "999", display: "none" });
    this.reopenButton.addEventListener("click", () => this.reopen());
    this.container.appendChild(this.reopenButton);
    this.shell.collapseButton.addEventListener("click", () => this.collapse());

    this.requestRerender();
  }

  /** Open the inspector for a block (browse → inspect). */
  select(id: string): void {
    if (this.disposed) return;
    if (this.mode === "inspect" && this.selected?.kind === "block" && this.selected.id === id) return;
    const block = this.config.site.blocks.find((candidate) => candidate.id === id);
    if (!block) return;
    this.enterInspect({ kind: "block", id });
  }

  /** Open the inspector for a named style (browse → inspect) — the SAME
   *  inspector component, scoped to the style's base/variants (P8a). */
  selectStyle(id: string): void {
    if (this.disposed) return;
    if (this.mode === "inspect" && this.selected?.kind === "style" && this.selected.id === id) return;
    const style = this.config.site.styles.find((candidate) => candidate.id === id);
    if (!style) return;
    this.enterInspect({ kind: "style", id });
  }

  /** Open the entity pane for an obstacle box (browse → inspect, Plan 14). */
  selectBox(id: string): void {
    if (this.disposed) return;
    if (this.mode === "inspect" && this.selected?.kind === "box" && this.selected.id === id) return;
    const box = this.config.site.obstacles.find((candidate) => candidate.id === id);
    if (!box) return;
    this.enterInspect({ kind: "box", id });
  }

  /** Open the entity pane for a hotspot annotation (browse → inspect, Plan 14). */
  selectHotspot(id: string): void {
    if (this.disposed) return;
    if (this.mode === "inspect" && this.selected?.kind === "hotspot" && this.selected.id === id) return;
    const item = this.config.site.annotations.find((candidate) => candidate.id === id);
    if (!item) return;
    this.enterInspect({ kind: "hotspot", id });
  }

  /** Open the entity pane for a tour stop (browse → inspect, Plan 14). */
  selectStop(id: string): void {
    if (this.disposed) return;
    if (this.mode === "inspect" && this.selected?.kind === "stop" && this.selected.id === id) return;
    const stop = this.config.site.stops.find((candidate) => candidate.id === id);
    if (!stop) return;
    this.enterInspect({ kind: "stop", id });
  }

  /** Open the entity pane for a glTF prop (browse → inspect, Plan 14). */
  selectProp(id: string): void {
    if (this.disposed) return;
    if (this.mode === "inspect" && this.selected?.kind === "prop" && this.selected.id === id) return;
    const found = this.findProp(id);
    if (!found) return;
    this.enterInspect({ kind: "prop", id });
  }

  private findProp(id: string): { scene: SiteAuthorPanelConfig["site"]["scenes"][number]; prop: NonNullable<SiteAuthorPanelConfig["site"]["scenes"][number]["props"]>[number] } | null {
    for (const scene of this.config.site.scenes) {
      const prop = scene.props?.find((candidate) => candidate.id === id);
      if (prop) return { scene, prop };
    }
    return null;
  }

  private enterInspect(selected: SelectedEntity): void {
    this.currentPane?.deselect();
    this.currentPane = null;
    // Turn off any on-canvas placement editor/gizmo left active on the block we
    // are leaving — it must not linger over a no-longer-inspected block (P8d).
    // This detaches the shared AuthorGizmo, so the pane gizmo state dies too.
    this.config.placement?.deactivate();
    this.paneGizmo = null;
    this.mode = "inspect";
    this.selected = selected;
    this.root.style.width = INSPECT_WIDTH;
    this.renderInspect();
    // Bring the selection on screen (styles are not spatial — nothing to frame).
    if (AUTO_FRAME_ON_SELECT && selected.kind !== "style") {
      const kind = selected.kind === "block" ? "block" : selected.kind;
      this.config.frameEntity?.({ kind, id: selected.id } as FrameTarget);
    }
  }

  /** Return to browse mode on the active tab. */
  deselect(): void {
    if (this.mode !== "inspect") return;
    this.currentPane?.deselect();
    this.currentPane = null;
    this.config.placement?.deactivate();
    this.paneGizmo = null;
    this.mode = "browse";
    this.selected = null;
    this.root.style.width = BROWSE_WIDTH;
    this.shell.setInspectorHeader(null);
    this.setHighlight(null);
    this.requestRerender();
  }

  refresh(): void {
    this.requestRerender();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.container.removeEventListener("click", this.onSurfaceClick);
    this.container.removeEventListener("pointermove", this.onSurfacePointerMove);
    this.container.removeEventListener("pointerleave", this.onSurfacePointerLeave);
    document.removeEventListener("keydown", this.onKeyDown);
    this.shell.dragHandle.removeEventListener("pointerdown", this.onDragStart);
    this.resizeObserver?.disconnect();
    this.reopenButton.remove();
    if (this.highlightRaf !== 0) cancelAnimationFrame(this.highlightRaf);
    this.config.placement?.deactivate();
    this.setHighlight(null);
    this.setHover(null);
    this.root.remove();
    this.styleEl.remove();
  }

  private requestRerender(): void {
    if (this.disposed) return;
    if (this.mode === "inspect" && this.selected) {
      this.renderInspect();
    } else {
      this.shell.contentHost.replaceChildren(this.renderActiveTab());
    }
  }

  private renderInspect(): void {
    const selected = this.selected;
    if (!selected) return;
    // If a sub-tab pill in THIS panel holds focus when the inspector rebuilds
    // wholesale, focus would fall to <body>; note it so it can be restored to
    // the rebuilt active pill (consult #6). Scoped to this panel's root so a
    // pill focused in another embed never triggers a refocus here.
    const rootNode = this.root.getRootNode() as Document | ShadowRoot;
    const active = rootNode.activeElement;
    const pillWasFocused = active instanceof HTMLElement
      && this.root.contains(active)
      && active.classList.contains("ap-subtab");
    const pane = this.buildPane(selected);
    if (!pane) {
      // The inspected entity vanished (deleted elsewhere) — fall back to browse.
      this.deselect();
      return;
    }
    this.currentPane = pane;
    this.shell.setInspectorHeader(pane.header);
    this.shell.contentHost.replaceChildren(pane.body);
    pane.select();
    if (pillWasFocused) {
      this.shell.contentHost.querySelector<HTMLElement>('.ap-subtab[aria-selected="true"]')?.focus();
    }
  }

  /** Resolve the selection to a rendered pane, or null if the entity vanished.
   *  block/style wrap the cascade inspector; entity kinds build panes directly
   *  (registered one per Plan-14 phase — an unregistered kind resolves null). */
  private buildPane(selected: SelectedEntity): InspectorPane | null {
    switch (selected.kind) {
      case "style": {
        const style = this.config.site.styles.find((candidate) => candidate.id === selected.id);
        if (!style) return null;
        const deps = this.inspectorDeps();
        const inspectable = createStyleInspectable(style, this.ctx, deps);
        const rendered = renderStyleInspector(style, this.ctx, deps);
        // Styles are not spatial — no Frame action.
        return this.wrapInspectable(inspectable, rendered, "Back to styles", null);
      }
      case "block": {
        const block = this.config.site.blocks.find((candidate) => candidate.id === selected.id);
        if (!block) return null;
        const deps = this.inspectorDeps();
        const inspectable = createTextInspectable(block, this.ctx, deps);
        const rendered = renderTextInspector(block, this.ctx, deps);
        // A Frame action only for spatial (world) blocks — screen blocks have
        // nothing in world space to bring into view.
        const frameId = block.space === "world" ? block.id : null;
        return this.wrapInspectable(inspectable, rendered, "Back to blocks", frameId);
      }
      case "box": {
        const box = this.config.site.obstacles.find((candidate) => candidate.id === selected.id);
        if (!box) return null;
        return createBoxPane(box, this.ctx, this.paneDeps());
      }
      case "hotspot": {
        const item = this.config.site.annotations.find((candidate) => candidate.id === selected.id);
        if (!item) return null;
        return createHotspotPane(item, this.ctx, this.paneDeps());
      }
      case "stop": {
        const stop = this.config.site.stops.find((candidate) => candidate.id === selected.id);
        if (!stop) return null;
        return createStopPane(stop, this.ctx, this.paneDeps());
      }
      case "prop": {
        const found = this.findProp(selected.id);
        if (!found) return null;
        return createPropPane(found.scene, found.prop, this.ctx, this.paneDeps());
      }
      default:
        return null;
    }
  }

  /** Adapt the cascade inspector's (inspectable, rendered) pair to the shared
   *  InspectorPane lifecycle, including the classic Back button header. */
  private wrapInspectable(
    inspectable: Inspectable,
    rendered: { header: HTMLElement; body: HTMLElement },
    backTitle: string,
    frameBlockId: string | null,
  ): InspectorPane {
    const back = el("button", {
      className: "ap-btn ap-inspector-back",
      type: "button",
      title: backTitle,
      ariaLabel: backTitle,
      onClick: () => this.deselect(),
    }, ["← Back"]);
    const headChildren: HTMLElement[] = [back, rendered.header];
    if (frameBlockId !== null) {
      headChildren.push(el("button", {
        className: "ap-btn ap-inspector-frame",
        type: "button",
        title: "Frame in view",
        ariaLabel: "Frame in view",
        onClick: () => this.config.frameEntity?.({ kind: "block", id: frameBlockId }),
      }, ["⤢"]));
    }
    return {
      header: el("div", { className: "ap-inspector-headrow" }, headChildren),
      body: rendered.body,
      select: () => inspectable.select(),
      deselect: () => inspectable.deselect(),
    };
  }

  private paneDeps(): EntityPaneDeps {
    return {
      back: () => this.deselect(),
      frame: (target) => this.config.frameEntity?.(target),
      gizmoState: () => this.paneGizmo,
      setGizmoState: (state) => {
        this.paneGizmo = state;
      },
      spaceFor: (kind) => this.paneSpace[kind] ?? "world",
      setSpaceFor: (kind, space) => {
        this.paneSpace[kind] = space;
      },
    };
  }

  private inspectorDeps(): TextInspectorDeps {
    return {
      getSurface: (id) => this.config.textSystem?.getBlockSurface(id) ?? null,
      capabilitiesFor: (block) => this.config.textSystem?.capabilitiesFor(block) ?? { excluded: {} },
      setHighlight: (id) => this.setHighlight(id),
      containerSize: () => ({
        w: this.container.clientWidth || window.innerWidth,
        h: this.container.clientHeight || window.innerHeight,
      }),
      simContext: (base) => this.sim.context(base),
      placementTools: (block) => this.config.placement?.toolsFor(block) ?? [],
      // A style change reshapes the resolved cascade, so the whole inspector must
      // rerender — but that replaces the focused style <select>, so restore focus
      // to the new one (keyboard style-navigation would otherwise break).
      restyled: () => {
        this.config.onChange("text");
        this.renderInspect();
        const select = this.shell.root.querySelector<HTMLElement>(".ap-inspector-style select");
        select?.focus();
      },
      uiState: this.inspectorUiState,
    };
  }

  private renderActiveTab(): HTMLElement {
    switch (this.activeTab) {
      case "Tour":
        return renderTour(this.ctx);
      case "Hotspots":
        return renderHotspots(this.ctx);
      case "Text":
        return renderText(this.ctx);
      case "Objects":
        return renderObjects(this.ctx);
      case "Boxes":
        return renderBoxes(this.ctx);
      case "Look":
        return renderLook(this.ctx);
      case "Scene":
        return renderScene(this.ctx);
    }
  }

  // ── Selection sources on the scene surface ──

  private readonly onSurfaceClick = (event: MouseEvent): void => {
    // Collapsed = fully inert: a scene click must NOT change the hidden
    // selection or auto-frame (the user collapsed to see the scene). DD5.
    if (this.disposed || this.collapsed) return;
    const target = event.target as Node;
    if (this.root.contains(target)) return; // clicks inside the panel are not selections
    const id = this.blockAt(target);
    if (id) this.select(id);
  };

  private readonly onSurfacePointerMove = (event: PointerEvent): void => {
    if (this.disposed || this.collapsed) return; // no hover outlines while collapsed
    const target = event.target as Node;
    this.setHover(this.root.contains(target) ? null : this.blockAt(target));
  };

  private readonly onSurfacePointerLeave = (): void => {
    if (!this.disposed && !this.collapsed) this.setHover(null);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // Escape is guarded while collapsed: it must NOT deselect, or the hidden
    // selection would not restore exactly on reopen (DD5).
    if (this.disposed || this.collapsed || this.mode !== "inspect") return;
    // Document-level Escape, scoped per instance: act when the key originated
    // inside THIS panel's container (composed path — retargeting-safe) or from
    // no element context at all (body/html, nothing focused). A key whose real
    // target is some OTHER element — e.g. a second embed's panel input — is
    // ignored, so Escape in instance A no longer closes instance B's inspector.
    if (event.key !== "Escape") return;
    const path = event.composedPath();
    const target = (path[0] ?? event.target) as Node | null;
    const doc = this.container.ownerDocument;
    const scoped = path.includes(this.container)
      || !target
      || target.nodeType !== Node.ELEMENT_NODE
      || target === doc.body
      || target === doc.documentElement;
    if (scoped) this.deselect();
  };

  /** The block id whose (screen) surface contains a node, if any. World
   *  surfaces (Object3D) are selected from the registry, not by DOM hit-test. */
  private blockAt(target: Node): string | null {
    const ts = this.config.textSystem;
    if (!ts) return null;
    for (const block of this.config.site.blocks) {
      const surface = ts.getBlockSurface(block.id);
      if (surface instanceof HTMLElement && surface.contains(target)) return block.id;
    }
    return null;
  }

  // ── On-surface highlight (outline re-applied per frame while active, so it
  //    survives a stop-driven remount; suspends with rAF in a hidden tab). ──

  private setHighlight(id: string | null): void {
    this.highlightId = id;
    this.syncOutlines();
    this.ensureHighlightLoop();
  }

  private setHover(id: string | null): void {
    if (this.hoverId === id) return;
    this.hoverId = id;
    this.syncOutlines();
    this.ensureHighlightLoop();
  }

  private syncOutlines(): void {
    // Suppressed while collapsed (consult V #6): a background rerender routes
    // pane.select() → setHighlight() → here, which would re-draw the on-scene
    // outline behind the hidden panel. reopen() calls syncOutlines() directly
    // after clearing `collapsed`, so the outline restores exactly then.
    if (this.collapsed) return;
    const ts = this.config.textSystem;
    const selEl = this.surfaceElement(ts, this.highlightId);
    let hovEl = this.surfaceElement(ts, this.hoverId);
    if (hovEl === selEl) hovEl = null; // selection outline wins over hover

    if (this.highlightedEl && this.highlightedEl !== selEl) {
      this.clearOutline(this.highlightedEl);
      this.highlightedEl = null;
    }
    if (selEl && this.highlightedEl !== selEl) {
      selEl.style.outline = SELECT_OUTLINE;
      selEl.style.outlineOffset = "2px";
      this.highlightedEl = selEl;
    }
    if (this.hoveredEl && this.hoveredEl !== hovEl) {
      // Never strip the outline off the SELECTED element: hover A then click A
      // makes A both selected and (stale) hovered — clearing the hover here
      // would wipe the selection outline just applied above, and bookkeeping
      // would then never reapply it.
      if (this.hoveredEl !== this.highlightedEl) this.clearOutline(this.hoveredEl);
      this.hoveredEl = null;
    }
    if (hovEl && this.hoveredEl !== hovEl) {
      hovEl.style.outline = HOVER_OUTLINE;
      hovEl.style.outlineOffset = "2px";
      this.hoveredEl = hovEl;
    }
  }

  private surfaceElement(
    ts: SiteAuthorPanelConfig["textSystem"],
    id: string | null,
  ): HTMLElement | null {
    if (!ts || !id) return null;
    const surface = ts.getBlockSurface(id);
    return surface instanceof HTMLElement ? surface : null;
  }

  private clearOutline(element: HTMLElement): void {
    element.style.outline = "";
    element.style.outlineOffset = "";
  }

  /** A world (splat/plane) surface is an Object3D — never an HTMLElement — so
   *  outlining it here is impossible; only screen blocks can remount an element
   *  the loop needs to re-outline. (Hover ids are always screen: blockAt only
   *  returns HTMLElement-surface blocks.) */
  private isScreenBlock(id: string | null): boolean {
    if (!id) return false;
    return this.config.site.blocks.find((block) => block.id === id)?.space === "screen";
  }

  private ensureHighlightLoop(): void {
    // Paused while collapsed (DD5) — pauseHighlightWhileCollapsed cancelled it;
    // reopen() restarts it after re-syncing the kept selection/hover.
    if (this.collapsed) return;
    // Don't spin the rAF loop for a world-block selection it can never outline;
    // syncOutlines already ran once (a harmless no-op) via setHighlight.
    const active = this.hoverId !== null || this.isScreenBlock(this.highlightId);
    if (active && this.highlightRaf === 0) {
      const tick = (): void => {
        if (this.disposed || this.collapsed || (this.highlightId === null && this.hoverId === null)) {
          this.highlightRaf = 0;
          return;
        }
        this.syncOutlines();
        this.highlightRaf = requestAnimationFrame(tick);
      };
      this.highlightRaf = requestAnimationFrame(tick);
    } else if (!active && this.highlightRaf !== 0) {
      cancelAnimationFrame(this.highlightRaf);
      this.highlightRaf = 0;
    }
  }

  // ── Drag (DD4) ──
  // Delta-based so it never depends on the container's offset origin: capture
  // the pointer + starting position on pointerdown, then move by the pointer
  // delta and clamp. pointerup / pointercancel / lostpointercapture ALL end the
  // drag and reset the cursor, so a touch-scroll or OS cancel can't strand it
  // in "grabbing".

  private readonly onDragStart = (event: PointerEvent): void => {
    if (this.disposed || this.dragging) return; // ignore a second concurrent pointer
    // Never start a drag from a control inside the title (defensive — the grip
    // holds none, but keeps a future button/input in the title area safe).
    if ((event.target as HTMLElement).closest("button, input, select, textarea, a")) return;
    const handle = this.shell.dragHandle;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* no active pointer for this id (e.g. a synthetic event) — capture is an
         optimization; the move/up listeners below still drive the drag */
    }
    this.dragging = true;
    this.dragPointerId = event.pointerId;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    const current = this.currentPosition();
    this.dragStartLeft = current.left;
    this.dragStartTop = current.top;
    handle.classList.add("grabbing");
    event.preventDefault(); // touch: never scroll the page while dragging
    handle.addEventListener("pointermove", this.onDragMove);
    handle.addEventListener("pointerup", this.onDragEnd);
    handle.addEventListener("pointercancel", this.onDragEnd);
    handle.addEventListener("lostpointercapture", this.onDragEnd);
  };

  private readonly onDragMove = (event: PointerEvent): void => {
    if (!this.dragging || event.pointerId !== this.dragPointerId) return;
    const left = this.dragStartLeft + (event.clientX - this.dragStartX);
    const top = this.dragStartTop + (event.clientY - this.dragStartY);
    this.applyPosition(this.clampPosition(left, top));
    event.preventDefault();
  };

  private readonly onDragEnd = (event: PointerEvent): void => {
    // Only the DRAGGING pointer's up/cancel/lostcapture ends the drag — a second
    // finger tapping the grip must not terminate the first pointer's drag and
    // release its capture (consult V #5).
    if (!this.dragging || event.pointerId !== this.dragPointerId) return;
    this.endDrag();
  };

  private endDrag(): void {
    if (!this.dragging) return;
    this.dragging = false;
    const handle = this.shell.dragHandle;
    try {
      handle.releasePointerCapture(this.dragPointerId);
    } catch {
      /* capture already lost (lostpointercapture) — nothing to release */
    }
    this.dragPointerId = -1;
    handle.classList.remove("grabbing");
    handle.removeEventListener("pointermove", this.onDragMove);
    handle.removeEventListener("pointerup", this.onDragEnd);
    handle.removeEventListener("pointercancel", this.onDragEnd);
    handle.removeEventListener("lostpointercapture", this.onDragEnd);
  }

  private currentPosition(): { left: number; top: number } {
    if (this.position) return this.position;
    return {
      left: parseFloat(this.root.style.left) || 0,
      top: parseFloat(this.root.style.top) || 0,
    };
  }

  private applyPosition(pos: { left: number; top: number }): void {
    this.position = pos;
    this.root.style.left = `${pos.left}px`;
    this.root.style.top = `${pos.top}px`;
  }

  /** Clamp a position to container-content coordinates, keeping ≥48px of the
   *  panel horizontally reachable and ≥36px of the header vertically; degenerate
   *  containers (<48px) clamp toward 0. */
  private clampPosition(left: number, top: number): { left: number; top: number } {
    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    const pw = this.root.offsetWidth;
    const minLeft = Math.min(0, -(pw - 48));
    const maxLeft = Math.max(0, cw - 48);
    const maxTop = Math.max(0, ch - 36);
    return {
      left: Math.min(Math.max(left, minLeft), maxLeft),
      top: Math.min(Math.max(top, 0), maxTop),
    };
  }

  private onContainerResize(): void {
    if (this.disposed) return;
    if (this.collapsed) {
      // The panel measures 0 (display:none) so ITS re-clamp defers to reopen —
      // but the VISIBLE reopen tab must stay inside the resized container, or a
      // shrink can clip it off-screen and strand the panel (consult V #7).
      this.positionReopen(this.currentPosition());
      return;
    }
    if (this.position) this.applyPosition(this.clampPosition(this.position.left, this.position.top));
  }

  // ── Collapse / reopen (DD5) ──
  // Collapse hides the panel (state + listeners stay live) and shows a floating
  // reopen tab. While collapsed the panel is fully INERT: surface click/hover
  // and Escape short-circuit (the hidden selection must restore exactly), and
  // the highlight rAF loop pauses (outlines clear). Reopen restores the panel
  // and everything it held — tab, selection, position, active sub-tab.

  private collapse(): void {
    if (this.disposed || this.collapsed) return;
    // End any in-flight drag first (consult V) — the grip is about to be hidden.
    if (this.dragging) this.endDrag();
    this.collapsed = true;
    this.root.style.display = "none";
    // Reveal first so the tab is measurable, then clamp it fully inside the
    // container near the panel's last position (an off-edge panel must not
    // strand an invisible tab).
    this.reopenButton.style.display = "";
    this.positionReopen(this.currentPosition());
    // Pause the highlight/hover loop and clear the on-scene outlines (the user
    // collapsed to SEE the scene) — the selection state is kept for restore.
    this.pauseHighlightWhileCollapsed();
    this.reopenButton.focus();
  }

  private reopen(): void {
    if (this.disposed || !this.collapsed) return;
    this.collapsed = false;
    this.reopenButton.style.display = "none";
    this.root.style.display = "flex";
    // The container may have resized while collapsed (skipped then) — re-clamp
    // now that the panel measures again.
    if (this.position) this.applyPosition(this.clampPosition(this.position.left, this.position.top));
    // Re-apply the outlines and restart the loop (selection/hover were kept).
    this.syncOutlines();
    this.ensureHighlightLoop();
    this.shell.collapseButton.focus();
  }

  private positionReopen(near: { left: number; top: number }): void {
    const button = this.reopenButton;
    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    const bw = button.offsetWidth || 90;
    const bh = button.offsetHeight || 30;
    // Independently clamped FULLY inside the container (unlike the panel, which
    // may legally park off-edge) so the tab is always visible and clickable.
    button.style.left = `${Math.min(Math.max(near.left, 0), Math.max(0, cw - bw))}px`;
    button.style.top = `${Math.min(Math.max(near.top, 0), Math.max(0, ch - bh))}px`;
  }

  private pauseHighlightWhileCollapsed(): void {
    if (this.highlightRaf !== 0) {
      cancelAnimationFrame(this.highlightRaf);
      this.highlightRaf = 0;
    }
    // Clear the visible outlines but KEEP highlightId / hoverId for restore.
    if (this.highlightedEl) {
      this.clearOutline(this.highlightedEl);
      this.highlightedEl = null;
    }
    if (this.hoveredEl) {
      this.clearOutline(this.hoveredEl);
      this.hoveredEl = null;
    }
  }
}
