import { Raycaster, Vector2, type Camera, type Object3D, type Scene } from "three";
import type { SiteConfig } from "../site/SiteConfig";
import type { ScreenRect } from "../ui/ObstacleLayout";
import {
  type BlockRenderer,
  type TextHost,
  domLaneCaps,
} from "./BlockRenderer";
import { FontRegistry } from "./FontRegistry";
import { ColumnsLane } from "./ColumnsLane";
import { FreeLane } from "./FreeLane";
import { PanelLane } from "./PanelLane";
import { PlaneLane } from "./PlaneLane";
import { SplatLane } from "./SplatLane";
import { applyEase, resolve } from "./StyleResolver";
import type {
  CapabilitySet,
  EaseName,
  ResolveContext,
  Resolved,
  TextBlock,
  TextStyle,
  VariantCondition,
} from "./TextModel";

export interface TextSystemOptions {
  site: SiteConfig;
  host: HTMLElement;
  scene?: Scene;
  camera?: Camera;
  registry: FontRegistry;
  getObstacleRects?: () => ScreenRect[];
  /** Notify the host that a link inside site text was activated. TextSystem
   *  never navigates and never touches `location`. */
  onLinkActivate?: (detail: {
    href: string;
    blockId: string;
    runIndex: number | null;
    kind: "fragment" | "external";
  }) => boolean;
}

interface BlockSnapshot {
  presentation: TextBlock["presentation"];
  space: TextBlock["space"];
}

interface MountedBlock {
  block: TextBlock;
  snapshot: BlockSnapshot;
  renderer: BlockRenderer;
  fontFamily?: string;
  opacity: number;
  fadeFrom: number;
  fadeTarget: 0 | 1;
  fadeElapsedMs: number;
  fadeDurationMs: number;
  revision: number;
}

interface PendingMount {
  token: number;
  snapshot: BlockSnapshot;
  fontFamily?: string;
}

interface MaterialState {
  opacity: number;
  transparent: boolean;
}

type BlockState = "hover" | "selected";
type ConditionSource = "progress" | "bindingRange" | "geo" | "stop" | "state" | "interpolated";

interface ScreenInteraction {
  surface: HTMLElement;
  detach: () => void;
}

const warnedPlaceholderLanes = new Set<TextBlock["presentation"]>();

/** Whether a document-level key event should act on THIS instance: it either
 *  originated inside `anchor`'s subtree (composed path — retargeting-safe), or
 *  from no element context at all (body/html — nothing focused). A key whose
 *  real target is some OTHER element (e.g. a second embed's panel input) is
 *  ignored, so Escape in one instance never clears another's selection. */
function keyEventScopedTo(event: KeyboardEvent, anchor: HTMLElement): boolean {
  const path = event.composedPath();
  const target = (path[0] ?? event.target) as Node | null;
  const doc = anchor.ownerDocument;
  return path.includes(anchor)
    || !target
    || target.nodeType !== Node.ELEMENT_NODE
    || target === doc.body
    || target === doc.documentElement;
}
const MAX_PRESENT_SOFT = 12;

class PlaceholderLane implements BlockRenderer {
  readonly surface = null;

  constructor(
    private readonly lane: TextBlock["presentation"],
    private readonly host: TextHost,
  ) {}

  mount(_block: TextBlock, _resolved: Resolved, _host: TextHost): void {
    if (!warnedPlaceholderLanes.has(this.lane)) {
      warnedPlaceholderLanes.add(this.lane);
      console.warn(`TextSystem ${this.lane} lane is not yet implemented; block rendering is a no-op.`);
    }
  }

  update(_resolved: Resolved, _ctx: ResolveContext): void {}

  capabilities(): CapabilitySet {
    return this.lane === "panel" || this.lane === "plane"
      ? domLaneCaps(this.host)
      : { excluded: {} };
  }

  dispose(): void {}
}

export class TextSystem {
  private readonly site: SiteConfig;
  private readonly registry: FontRegistry;
  private readonly layer: HTMLDivElement;
  private readonly textHost: TextHost;
  private readonly resizeObserver: ResizeObserver;
  private readonly camera?: Camera;
  private readonly onLinkActivate?: TextSystemOptions["onLinkActivate"];
  private readonly pointerTarget: HTMLElement;
  private readonly reducedMotionQuery: MediaQueryList;
  private readonly mounted = new Map<string, MountedBlock>();
  private readonly pending = new Map<string, PendingMount>();
  /** id → block, rebuilt each sync — the per-frame paths must not O(n) scan. */
  private readonly blocksById = new Map<string, TextBlock>();
  private nextMountToken = 0;
  private readonly warnedFontLoads = new Set<string>();
  private readonly materialStates = new WeakMap<object, MaterialState>();
  private readonly blockStates = new Map<string, Set<BlockState>>();
  private readonly conditionIndex = new Map<ConditionSource, Set<string>>();
  private readonly screenInteractions = new Map<string, ScreenInteraction>();
  private readonly worldSurfaces = new Map<string, Object3D>();
  private readonly raycaster = new Raycaster();
  private readonly pointerNdc = new Vector2();
  private containerW: number;
  private containerH: number;
  private activeStopId: string | null = null;
  private activeAnnotationId: string | null = null;
  /** Ids the display channel is showing right now (D31) — see setShownBlockIds. */
  private shownBlockIds: ReadonlySet<string> = new Set<string>();
  /** Runtime-conjured blocks (ticket 13: the copy floor's floating boxes) —
   *  rendered beside `site.blocks` but never part of the site's data, so
   *  serialization cannot pick them up. See setConjuredBlocks. */
  private conjured: readonly TextBlock[] = [];
  /** Host-supplied ids whose lane DOM duplicates prose in the host HTML. */
  private duplicatedBlockIds: ReadonlySet<string> = new Set<string>();
  private progress = 0;
  private placeId: string | undefined;
  private tier: "preset" | "precise" | undefined;
  private distanceM: number | undefined;
  private reducedMotion: boolean;
  private worldListenersAttached = false;
  private pendingPointerMove: { clientX: number; clientY: number } | null = null;
  private warnedPresentSoft = false;
  private perfNotice: string | undefined;
  private disposed = false;

  constructor(options: TextSystemOptions) {
    this.site = options.site;
    this.registry = options.registry;
    this.camera = options.camera;
    this.onLinkActivate = options.onLinkActivate;
    this.pointerTarget = options.host.querySelector("canvas") ?? options.host;
    this.containerW = options.host.clientWidth;
    this.containerH = options.host.clientHeight;
    this.reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reducedMotion = this.reducedMotionQuery.matches;
    this.reducedMotionQuery.addEventListener("change", this.handleReducedMotionChange);

    this.layer = options.host.ownerDocument.createElement("div");
    this.layer.className = "sjt-text-layer";
    Object.assign(this.layer.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      zIndex: "700",
    });
    FontRegistry.fontSynthesisNone(this.layer);
    options.host.appendChild(this.layer);

    this.textHost = {
      container: options.host,
      layer: this.layer,
      scene: options.scene,
      camera: options.camera,
      registry: options.registry,
      getObstacleRects: options.getObstacleRects,
      onLinkActivate: options.onLinkActivate,
      isDuplicatedBlock: (id) => this.isDuplicatedBlock(id),
      // A getter, not a value: `this.site` is the same object the author panel
      // edits, so reading it here at use time is what makes the switch live.
      collapseOnNarrow: () => this.site.settings?.text?.collapseOnNarrow ?? true,
    };

    this.resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1]?.contentRect;
      if (!rect || this.disposed) return;
      this.containerW = rect.width;
      this.containerH = rect.height;
      this.updatePresentBlocks();
    });
    this.resizeObserver.observe(options.host);
  }

  setActiveStop(id: string | null): void {
    // Same-value guard: rail transition hooks fire per frame — do not re-sync.
    if (this.activeStopId === id) return;
    this.activeStopId = id;
    this.sync();
  }

  /** Select (or clear) the active annotation — blocks bound to it fade in/out. */
  setActiveAnnotation(id: string | null): void {
    if (this.activeAnnotationId === id) return;
    this.activeAnnotationId = id;
    this.sync();
  }

  /**
   * Blocks shown by something other than their binding — the D31 display
   * channel handing over what a marker's rules are currently showing.
   *
   * A second, independent reason to be present: a block here mounts whether or
   * not any binding clause matches, and a bound block is unaffected by being
   * absent from this set. That separation is the point — a display effect's
   * template block carries NO binding, so this is the only thing that can show
   * it, and an effect may equally point at a block that is bound elsewhere.
   *
   * The caller owns replacement semantics (which effect wins which space); this
   * only asks "what is on right now".
   */
  setShownBlockIds(ids: ReadonlySet<string>): void {
    if (this.shownBlockIds.size === ids.size && [...ids].every((id) => this.shownBlockIds.has(id))) {
      return;
    }
    this.shownBlockIds = new Set(ids);
    this.sync();
  }

  /**
   * Blocks the RUNTIME made up rather than the site's data (ticket 13): the
   * copy floor's conjured boxes. Rendered, resolved and reconciled exactly
   * like authored blocks — one block universe, merged in `allBlocks` — but
   * they live only here, so `site.blocks` (and everything serialized from it)
   * never carries them. Presence still comes from `isPresent`: a conjured
   * block has an empty binding, so it is on screen exactly while the display
   * channel shows it.
   *
   * The whole current set each call, replaced wholesale — the runtime owns
   * membership; this class only renders.
   */
  setConjuredBlocks(blocks: readonly TextBlock[]): void {
    // Same-value guard, like every other setter on this class — by OBJECT
    // IDENTITY, which the runtime makes meaningful: it replaces a conjured
    // block's object only when the box really changed.
    if (
      blocks.length === this.conjured.length
      && blocks.every((block, index) => block === this.conjured[index])
    ) {
      return;
    }
    this.conjured = [...blocks];
    this.sync();
  }

  /** THE block universe — `site.blocks` plus the conjured set. Every read that
   *  used to go to `site.blocks` directly goes through here, so a new read
   *  site cannot silently create a second universe without the conjured half. */
  private allBlocks(): readonly TextBlock[] {
    return this.conjured.length === 0 ? this.site.blocks : [...this.site.blocks, ...this.conjured];
  }

  get activeAnnotation(): string | null {
    return this.activeAnnotationId;
  }

  /**
   * Ids whose lane DOM duplicates prose already present in the host HTML.
   * Those blocks render `aria-hidden="true"` with non-focusable links — spec §8's
   * "one copy, not two". The HOST is the sole authority (it is the only party
   * that knows which lane text repeats its own prose), so this is never inferred
   * from content. Idempotent, and callable at any time.
   */
  setDuplicatedBlockIds(ids: ReadonlySet<string>): void {
    if (
      this.duplicatedBlockIds.size === ids.size &&
      [...ids].every((id) => this.duplicatedBlockIds.has(id))
    ) {
      return;
    }
    this.duplicatedBlockIds = new Set(ids);
    this.sync();
  }

  /** True when this block's lane DOM must be hidden from the accessibility tree
   *  because the host HTML already carries the same prose. */
  isDuplicatedBlock(id: string): boolean {
    return this.duplicatedBlockIds.has(id);
  }

  setProgress(progress: number): void {
    if (Object.is(this.progress, progress)) return;
    this.progress = progress;
    const progressIds = this.conditionIndex.get("progress") ?? new Set<string>();
    for (const id of progressIds) {
      const block = this.blocksById.get(id);
      if (block) this.syncBlock(block);
    }
    for (const id of this.conditionIndex.get("bindingRange") ?? []) {
      if (progressIds.has(id)) continue;
      const block = this.blocksById.get(id);
      if (block) this.syncBlock(block, true);
    }
    this.checkPresentSoftLimit();
  }

  setPlace(
    placeId: string | undefined,
    tier: "preset" | "precise" | undefined,
    distanceM: number | undefined,
  ): void {
    if (this.placeId === placeId && this.tier === tier && Object.is(this.distanceM, distanceM)) return;
    this.placeId = placeId;
    this.tier = tier;
    this.distanceM = distanceM;
    for (const id of this.conditionIndex.get("geo") ?? []) {
      const block = this.blocksById.get(id);
      if (block) this.syncBlock(block);
    }
  }

  /**
   * Reconcile mounted state with the block universe (`site.blocks` plus the
   * conjured set — see `allBlocks`). CONTRACT: sync() is the
   * mandatory barrier after REPLACING block objects in `site.blocks` — the
   * per-frame paths (setProgress/setPlace) and async font completions resolve
   * blocks through an id-index rebuilt here, so a replacement without a sync
   * hands lanes the stale object until the next one.
   */
  sync(): void {
    if (this.disposed) return;
    this.rebuildConditionIndex();
    const blocks = this.allBlocks();
    const liveIds = new Set(blocks.map((block) => block.id));

    for (const [id, mounted] of this.mounted) {
      if (liveIds.has(id)) continue;
      this.invalidatePending(id);
      this.detachInteraction(id);
      mounted.renderer.dispose();
      this.mounted.delete(id);
      this.blockStates.delete(id);
    }
    for (const id of this.pending.keys()) {
      if (!liveIds.has(id)) this.invalidatePending(id);
    }

    for (const block of blocks) this.syncBlock(block);
    this.checkPresentSoftLimit();
  }

  update(_t: number, dt: number): void {
    if (this.disposed) return;
    const elapsedMs = Math.max(0, dt) * 1000;
    for (const [id, mounted] of [...this.mounted]) {
      if (mounted.opacity === mounted.fadeTarget && mounted.fadeElapsedMs >= mounted.fadeDurationMs) continue;
      mounted.fadeElapsedMs += elapsedMs;
      const amount = mounted.fadeDurationMs <= 0
        ? 1
        : Math.min(1, mounted.fadeElapsedMs / mounted.fadeDurationMs);
      const eased = applyEase(amount, this.transitionEaseOf(mounted.block));
      mounted.opacity = mounted.fadeFrom + (mounted.fadeTarget - mounted.fadeFrom) * eased;
      this.applySurfaceOpacity(mounted.renderer, mounted.opacity, mounted.fadeTarget !== 0);

      if (amount < 1 || mounted.fadeTarget !== 0) continue;
      this.detachInteraction(id);
      mounted.renderer.dispose();
      if (this.mounted.get(id) === mounted) this.mounted.delete(id);
    }
    if (this.pendingPointerMove && this.worldSurfaces.size > 0) {
      const move = this.pendingPointerMove;
      this.pendingPointerMove = null;
      const hoveredId = this.worldBlockAt(move);
      for (const id of [...this.worldSurfaces.keys()]) this.setBlockState(id, "hover", id === hoveredId);
    }
    for (const mounted of this.mounted.values()) {
      // Keyed on visibility, not fade direction: a block fading out is still on screen and must
      // keep tracking the camera until it is actually gone.
      if (mounted.opacity > 0) mounted.renderer.tick?.();
    }
  }

  getBlockSurface(id: string): HTMLElement | Object3D | null {
    const mounted = this.mounted.get(id);
    return mounted ? surfaceOf(mounted.renderer) : null;
  }

  /**
   * The block's lane capabilities — the single source the inspector greys
   * unsupported controls from. Uses the live renderer when the block is
   * mounted (so DOM lanes reflect the running document's CSS support), and a
   * throwaway renderer otherwise. Lane constructors are side-effect-free and
   * `capabilities()` reads static exclusion tables (never mount state), so the
   * unmounted path allocates nothing beyond the renderer object.
   */
  capabilitiesFor(block: TextBlock): CapabilitySet {
    const mounted = this.mounted.get(block.id);
    if (mounted) return mounted.renderer.capabilities();
    const renderer = this.createRenderer(block.presentation);
    const caps = renderer.capabilities();
    renderer.dispose();
    return caps;
  }

  blockMeta(id: string): { animatesViaRebuild: boolean; notice?: string } {
    const block = this.blocksById.get(id);
    return {
      animatesViaRebuild: !!block
        && (block.presentation === "splat" || block.presentation === "plane")
        && (this.conditionIndex.get("interpolated")?.has(id) ?? false),
      ...(this.perfNotice === undefined ? {} : { notice: this.perfNotice }),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.reducedMotionQuery.removeEventListener("change", this.handleReducedMotionChange);
    for (const id of this.pending.keys()) this.invalidatePending(id);
    for (const [id, mounted] of this.mounted) {
      this.detachInteraction(id);
      mounted.renderer.dispose();
    }
    this.detachWorldListeners();
    this.pending.clear();
    this.mounted.clear();
    this.blockStates.clear();
    this.layer.remove();
  }

  private resolveContext(blockId?: string): ResolveContext {
    return {
      containerW: this.containerW,
      containerH: this.containerH,
      activeStopId: this.activeStopId ?? undefined,
      progress: this.progress,
      reducedMotion: this.reducedMotion,
      states: blockId === undefined ? undefined : this.blockStates.get(blockId),
      placeId: this.placeId,
      tier: this.tier,
      distanceM: this.distanceM,
    };
  }

  private resolveBlock(block: TextBlock): Resolved {
    return resolve(
      block,
      this.site.styles,
      this.site.settings?.typography,
      this.resolveContext(block.id),
    );
  }

  private isPresent(block: TextBlock): boolean {
    // The display channel is a reason to be present in its own right, ORed in
    // ahead of the binding clauses: a template block has no binding at all, so
    // nothing below this line could ever mount it.
    if (this.shownBlockIds.has(block.id)) return true;
    // Stop-bound content belongs to WHERE THE VISITOR IS; a marker's content
    // belongs to what they activated. They are different kinds and neither
    // owns the other, so by default a stop's caption does not yield when a
    // marker is clicked (ticket 17, Rule B).
    //
    // It used to yield unconditionally — inherited from `CaptionOverlay`, where
    // the screen had exactly ONE caption box and a marker's copy took it over.
    // The block system replaced the box; this clause stayed behind. It survives
    // only as an author's setting, OFF out of the box, for the author who
    // deliberately docks a marker's panel in the stop caption's slot and wants
    // the caption to give way.
    //
    // ⚠ `MediaLayer.isMediaBindingPresent` carries the SAME setting for the same
    // reason. The two are deliberately parallel — change one and change the
    // other, or a marker click hides stop-bound media while its text stays.
    const stopContentYields = this.site.settings?.blocks?.hideStopContent ?? false;
    return block.binding.always === true
      || (!(stopContentYields && this.activeAnnotationId !== null)
        && this.activeStopId !== null && block.binding.stops?.includes(this.activeStopId) === true)
      || (block.binding.range !== undefined
        && this.progress >= block.binding.range.from
        && this.progress <= block.binding.range.to);
  }

  /** Site-wide default, per-block override — the authorable travel-fade duration. */
  private transitionDuration(block: TextBlock): number {
    // prefers-reduced-motion snaps fades entirely, matching the variant-range snap.
    if (this.reducedMotion) return 0;
    return Math.max(0, block.transitionMs ?? this.site.settings?.text?.transitionMs ?? 300);
  }

  private transitionEaseOf(block: TextBlock): EaseName {
    return block.transitionEase ?? this.site.settings?.text?.transitionEase ?? "linear";
  }

  /**
   * `presenceOnly` is the per-frame range-tick fast path: no resolve, no
   * remount check, no queued style update — presentation/space cannot change
   * per frame, and a pending mount re-reads the fresh block when it lands, so
   * the full path's fontFamily re-queue is an optimization it can skip.
   */
  private syncBlock(block: TextBlock, presenceOnly = false): void {
    const mounted = this.mounted.get(block.id);
    const snapshot = snapshotOf(block);

    if (!this.isPresent(block)) {
      this.invalidatePending(block.id);
      if (mounted && mounted.fadeTarget !== 0) this.startFade(mounted, 0);
      return;
    }

    if (mounted) {
      if (!presenceOnly) {
        if (requiresRemount(mounted.snapshot, snapshot)) {
          this.detachInteraction(block.id);
          mounted.renderer.dispose();
          this.mounted.delete(block.id);
          this.queueMount(block, snapshot);
          return;
        }
        mounted.block = block;
        mounted.snapshot = snapshot;
        mounted.renderer.setBlock?.(block);
      }
      if (mounted.fadeTarget !== 1) this.startFade(mounted, 1);
      this.configureInteraction(mounted);
      if (!presenceOnly) this.queueUpdate(mounted);
      return;
    }

    if (presenceOnly) {
      if (!this.pending.has(block.id)) this.queueMount(block, snapshot);
      return;
    }

    const resolved = this.resolveBlock(block);
    const pending = this.pending.get(block.id);
    if (pending
      && sameSnapshot(pending.snapshot, snapshot)
      && pending.fontFamily === resolved.layer.fontFamily) {
      return;
    }
    this.invalidatePending(block.id);
    this.queueMount(block, snapshot, resolved);
  }

  private queueMount(block: TextBlock, snapshot: BlockSnapshot, initialResolved = this.resolveBlock(block)): void {
    // A single monotonic counter: tokens stay unique across re-queues with no
    // per-id map to leak; `pending` is the sole source of truth for currency.
    const token = ++this.nextMountToken;
    this.pending.set(block.id, {
      token,
      snapshot,
      fontFamily: initialResolved.layer.fontFamily,
    });
    void this.mountAfterFont(block.id, token, initialResolved.layer.fontFamily);
  }

  private async mountAfterFont(id: string, token: number, fontFamily?: string): Promise<void> {
    await this.loadFont(fontFamily);
    if (!this.mountIsCurrent(id, token)) return;

    const block = this.blocksById.get(id);
    if (!block || !this.isPresent(block)) {
      this.invalidatePending(id);
      return;
    }

    let resolved = this.resolveBlock(block);
    if (resolved.layer.fontFamily !== fontFamily) {
      await this.loadFont(resolved.layer.fontFamily);
      if (!this.mountIsCurrent(id, token)) return;
      resolved = this.resolveBlock(block);
    }

    const renderer = this.createRenderer(block.presentation);
    renderer.mount(block, resolved, this.textHost);
    const duration = this.transitionDuration(block);
    const mounted: MountedBlock = {
      block,
      snapshot: snapshotOf(block),
      renderer,
      fontFamily: resolved.layer.fontFamily,
      opacity: duration <= 0 ? 1 : 0,
      fadeFrom: 0,
      fadeTarget: 1,
      fadeElapsedMs: 0,
      fadeDurationMs: duration,
      revision: 0,
    };
    this.pending.delete(id);
    this.mounted.set(id, mounted);
    this.applySurfaceOpacity(renderer, mounted.opacity, mounted.fadeTarget !== 0);
    this.configureInteraction(mounted);
  }

  private queueUpdate(mounted: MountedBlock): void {
    const block = mounted.block;
    const resolved = this.resolveBlock(block);
    if (!resolved.layer.fontFamily || resolved.layer.fontFamily === mounted.fontFamily) {
      mounted.renderer.update(resolved, this.resolveContext(block.id));
      this.applySurfaceOpacity(mounted.renderer, mounted.opacity, mounted.fadeTarget !== 0);
      this.configureInteraction(mounted);
      return;
    }

    const revision = ++mounted.revision;
    void this.updateAfterFont(block.id, mounted, revision, resolved.layer.fontFamily);
  }

  private async updateAfterFont(
    id: string,
    mounted: MountedBlock,
    revision: number,
    fontFamily: string,
  ): Promise<void> {
    await this.loadFont(fontFamily);
    if (this.disposed
      || this.mounted.get(id) !== mounted
      || mounted.revision !== revision
      || mounted.fadeTarget === 0) return;
    const block = this.blocksById.get(id);
    if (!block || !this.isPresent(block)) return;
    mounted.block = block;
    mounted.renderer.setBlock?.(block);
    const resolved = this.resolveBlock(block);
    mounted.fontFamily = resolved.layer.fontFamily;
    mounted.renderer.update(resolved, this.resolveContext(block.id));
    // fadeTarget is narrowed to 1 here (a 0 target returned above) — interactive.
    this.applySurfaceOpacity(mounted.renderer, mounted.opacity, true);
    this.configureInteraction(mounted);
  }

  private updatePresentBlocks(): void {
    for (const mounted of this.mounted.values()) {
      // ALL present blocks re-resolve on container resize: width-conditioned
      // variants exist on world blocks too (isScreenPresentation is NOT the
      // gate here), and the world lanes no-op cheap via their own dirty
      // checks (sameMetrics / raster signature) when nothing actually changed.
      if (mounted.fadeTarget === 0) continue;
      this.queueUpdate(mounted);
    }
  }

  private rebuildConditionIndex(): void {
    for (const source of ["progress", "bindingRange", "geo", "stop", "state", "interpolated"] as const) {
      this.conditionIndex.set(source, new Set());
    }
    this.blocksById.clear();
    const blocks = this.allBlocks();
    for (const block of blocks) this.blocksById.set(block.id, block);
    const liveIds = new Set(this.blocksById.keys());
    for (const id of this.blockStates.keys()) {
      if (!liveIds.has(id)) this.blockStates.delete(id);
    }

    for (const block of blocks) {
      if (block.binding.range) this.conditionIndex.get("bindingRange")!.add(block.id);
      if (block.binding.stops) this.conditionIndex.get("stop")!.add(block.id);
      for (const when of variantConditions(block, this.site.styles)) {
        if (when.progress) {
          this.conditionIndex.get("progress")!.add(block.id);
          this.conditionIndex.get("interpolated")!.add(block.id);
        }
        if (when.placeId !== undefined || when.tier !== undefined || when.distanceM !== undefined) {
          this.conditionIndex.get("geo")!.add(block.id);
        }
        if (when.distanceM) this.conditionIndex.get("interpolated")!.add(block.id);
        if (when.stopId !== undefined) this.conditionIndex.get("stop")!.add(block.id);
        if (when.state !== undefined) this.conditionIndex.get("state")!.add(block.id);
      }
      if (!this.conditionIndex.get("state")!.has(block.id)) this.blockStates.delete(block.id);
    }
  }

  private configureInteraction(mounted: MountedBlock): void {
    const id = mounted.block.id;
    if (mounted.fadeTarget === 0) {
      this.detachInteraction(id);
      return;
    }

    const surface = surfaceOf(mounted.renderer);
    if (surface instanceof HTMLElement) {
      if (!this.conditionIndex.get("state")?.has(id)) {
        this.detachInteraction(id);
        return;
      }
      if (this.worldSurfaces.delete(id)) this.updateWorldListeners();
      const existing = this.screenInteractions.get(id);
      if (existing?.surface === surface) return;
      existing?.detach();

      const states = this.blockStates.get(id) ?? new Set<BlockState>();
      this.blockStates.set(id, states);
      const previousPointerEvents = surface.style.pointerEvents;
      const doc = surface.ownerDocument;
      const onPointerEnter = (): void => this.setBlockState(id, "hover", true);
      const onPointerLeave = (): void => this.setBlockState(id, "hover", false);
      const onClick = (): void => this.setBlockState(id, "selected", !states.has("selected"));
      const onDocumentClick = (event: MouseEvent): void => {
        // composedPath, not contains(event.target): crossing an open shadow
        // boundary retargets event.target to the host element, so contains()
        // is false for clicks ON the surface — a click would select the block
        // and this document listener would immediately deselect it.
        if (!event.composedPath().includes(surface)) this.setBlockState(id, "selected", false);
      };
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== "Escape") return;
        if (!keyEventScopedTo(event, this.textHost.container)) return;
        this.setBlockState(id, "selected", false);
      };
      surface.style.pointerEvents = "auto";
      surface.addEventListener("pointerenter", onPointerEnter);
      surface.addEventListener("pointerleave", onPointerLeave);
      surface.addEventListener("click", onClick);
      doc.addEventListener("click", onDocumentClick);
      doc.addEventListener("keydown", onKeyDown);
      this.screenInteractions.set(id, {
        surface,
        detach: () => {
          surface.style.pointerEvents = previousPointerEvents;
          surface.removeEventListener("pointerenter", onPointerEnter);
          surface.removeEventListener("pointerleave", onPointerLeave);
          surface.removeEventListener("click", onClick);
          doc.removeEventListener("click", onDocumentClick);
          doc.removeEventListener("keydown", onKeyDown);
        },
      });
      return;
    }

    const screen = this.screenInteractions.get(id);
    if (screen) {
      screen.detach();
      this.screenInteractions.delete(id);
    }
    if (!this.conditionIndex.get("state")?.has(id) && mounted.block.href === undefined) {
      if (this.worldSurfaces.delete(id)) this.updateWorldListeners();
      return;
    }
    if (surface) {
      this.blockStates.set(id, this.blockStates.get(id) ?? new Set<BlockState>());
      this.worldSurfaces.set(id, surface);
      this.updateWorldListeners();
    } else if (this.worldSurfaces.delete(id)) {
      this.updateWorldListeners();
    }
  }

  private detachInteraction(id: string): void {
    const screen = this.screenInteractions.get(id);
    if (screen) {
      screen.detach();
      this.screenInteractions.delete(id);
    }
    if (this.worldSurfaces.delete(id)) this.updateWorldListeners();
  }

  private setBlockState(id: string, state: BlockState, enabled: boolean): void {
    const states = this.blockStates.get(id) ?? new Set<BlockState>();
    if (states.has(state) === enabled) return;
    if (enabled) states.add(state);
    else states.delete(state);
    this.blockStates.set(id, states);
    const mounted = this.mounted.get(id);
    if (mounted && mounted.fadeTarget !== 0) this.queueUpdate(mounted);
  }

  private updateWorldListeners(): void {
    if (this.worldSurfaces.size > 0 && !this.worldListenersAttached) {
      this.worldListenersAttached = true;
      this.pointerTarget.addEventListener("pointermove", this.handleWorldPointerMove);
      this.pointerTarget.addEventListener("pointerleave", this.handleWorldPointerLeave);
      this.pointerTarget.addEventListener("click", this.handleWorldClick);
      this.pointerTarget.ownerDocument.addEventListener("click", this.handleWorldDocumentClick);
      this.pointerTarget.ownerDocument.addEventListener("keydown", this.handleWorldKeyDown);
    } else if (this.worldSurfaces.size === 0) {
      this.detachWorldListeners();
    }
  }

  private detachWorldListeners(): void {
    if (!this.worldListenersAttached) return;
    this.worldListenersAttached = false;
    this.pointerTarget.removeEventListener("pointermove", this.handleWorldPointerMove);
    this.pointerTarget.removeEventListener("pointerleave", this.handleWorldPointerLeave);
    this.pointerTarget.removeEventListener("click", this.handleWorldClick);
    this.pointerTarget.ownerDocument.removeEventListener("click", this.handleWorldDocumentClick);
    this.pointerTarget.ownerDocument.removeEventListener("keydown", this.handleWorldKeyDown);
  }

  private worldBlockAt(event: { clientX: number; clientY: number }): string | undefined {
    if (!this.camera || this.worldSurfaces.size === 0) return undefined;
    const rect = this.pointerTarget.getBoundingClientRect();
    this.pointerNdc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObjects([...this.worldSurfaces.values()], true);
    for (const hit of hits) {
      for (const [id, surface] of this.worldSurfaces) {
        let object: Object3D | null = hit.object;
        while (object) {
          if (object === surface) return id;
          object = object.parent;
        }
      }
    }
    return undefined;
  }

  private readonly handleWorldPointerMove = (event: PointerEvent): void => {
    // Store-only: the WASM ray-ellipsoid raycast runs at most once per FRAME
    // (consumed in update()), never per pointermove event — the repo's own
    // guidance reserves splat raycasts for clicks, not 60-125Hz move streams.
    this.pendingPointerMove = { clientX: event.clientX, clientY: event.clientY };
  };

  private readonly handleWorldPointerLeave = (): void => {
    this.pendingPointerMove = null;
    for (const id of [...this.worldSurfaces.keys()]) this.setBlockState(id, "hover", false);
  };

  private readonly handleWorldClick = (event: MouseEvent): void => {
    const selectedId = this.worldBlockAt(event);
    for (const id of [...this.worldSurfaces.keys()]) {
      const selected = this.blockStates.get(id)?.has("selected") ?? false;
      this.setBlockState(id, "selected", id === selectedId ? !selected : false);
    }
    if (selectedId !== undefined) {
      const block = this.blocksById.get(selectedId);
      if (block?.href !== undefined) {
        this.onLinkActivate?.({
          href: block.href,
          blockId: block.id,
          runIndex: null,
          kind: block.href.startsWith("#") ? "fragment" : "external",
        });
      }
    }
  };

  private readonly handleWorldDocumentClick = (event: MouseEvent): void => {
    // composedPath, not contains(event.target): at the document level a click on
    // the shadow-hosted canvas retargets to the host element, so contains() is
    // false and this would deselect on the SAME click that just selected (the
    // exact bug fixed in the screen-surface path above).
    if (event.composedPath().includes(this.pointerTarget)) return;
    for (const id of [...this.worldSurfaces.keys()]) this.setBlockState(id, "selected", false);
  };

  private readonly handleWorldKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    if (!keyEventScopedTo(event, this.textHost.container)) return;
    for (const id of [...this.worldSurfaces.keys()]) this.setBlockState(id, "selected", false);
  };

  private readonly handleReducedMotionChange = (event: MediaQueryListEvent): void => {
    if (this.disposed || this.reducedMotion === event.matches) return;
    this.reducedMotion = event.matches;
    for (const id of this.conditionIndex.get("interpolated") ?? []) {
      const block = this.blocksById.get(id);
      if (block) this.syncBlock(block);
    }
  };

  private checkPresentSoftLimit(): void {
    if (this.warnedPresentSoft) return;
    let present = 0;
    for (const block of this.allBlocks()) {
      if (this.isPresent(block)) present++;
    }
    if (present <= MAX_PRESENT_SOFT) return;
    this.warnedPresentSoft = true;
    this.perfNotice = `More than ${MAX_PRESENT_SOFT} text blocks are present at once.`;
    console.warn(`TextSystem: ${this.perfNotice}`);
  }

  private startFade(mounted: MountedBlock, target: 0 | 1): void {
    if (target === 0) {
      this.detachInteraction(mounted.block.id);
      this.blockStates.delete(mounted.block.id);
    }
    mounted.fadeFrom = mounted.opacity;
    mounted.fadeTarget = target;
    mounted.fadeElapsedMs = 0;
    mounted.fadeDurationMs = this.transitionDuration(mounted.block);
    if (mounted.fadeDurationMs > 0) return;
    mounted.opacity = target;
    this.applySurfaceOpacity(mounted.renderer, target, target !== 0);
    if (target === 0) {
      mounted.renderer.dispose();
      if (this.mounted.get(mounted.block.id) === mounted) this.mounted.delete(mounted.block.id);
    }
  }

  private createRenderer(presentation: TextBlock["presentation"]): BlockRenderer {
    return presentation === "free"
      ? new FreeLane()
      : presentation === "panel"
        ? new PanelLane()
        : presentation === "columns"
          ? new ColumnsLane()
          : presentation === "splat"
            ? new SplatLane()
            : presentation === "plane"
              ? new PlaneLane()
      : new PlaceholderLane(presentation, this.textHost);
  }

  private invalidatePending(id: string): void {
    this.pending.delete(id);
  }

  private mountIsCurrent(id: string, token: number): boolean {
    return !this.disposed && this.pending.get(id)?.token === token;
  }

  private async loadFont(fontFamily?: string): Promise<void> {
    if (!fontFamily) return;
    try {
      await this.registry.ensureLoaded(fontFamily);
    } catch (error) {
      if (this.warnedFontLoads.has(fontFamily)) return;
      this.warnedFontLoads.add(fontFamily);
      console.warn(`TextSystem could not load font family "${fontFamily}"; using CSS fallback.`, error);
    }
  }

  private applySurfaceOpacity(renderer: BlockRenderer, opacity: number, interactive = opacity > 0): void {
    // Lanes with no CSS/material surface (gaussian splats) or shared chrome
    // (panel) own their fade; `interactive` drops the moment a fade-out starts.
    if (renderer.setOpacity) {
      renderer.setOpacity(opacity, interactive);
      return;
    }
    const surface = surfaceOf(renderer);
    if (!surface) return;
    if (surface instanceof HTMLElement) {
      surface.style.opacity = String(opacity);
      return;
    }

    surface.visible = opacity > 0;
    surface.traverse((object) => {
      const raw = (object as Object3D & { material?: unknown }).material;
      const materials = Array.isArray(raw) ? raw : raw ? [raw] : [];
      for (const material of materials) {
        if (!material || typeof material !== "object" || !("opacity" in material)) continue;
        const typed = material as { opacity: number; transparent: boolean; needsUpdate: boolean };
        let initial = this.materialStates.get(material);
        if (!initial) {
          initial = { opacity: typed.opacity, transparent: typed.transparent };
          this.materialStates.set(material, initial);
        }
        typed.opacity = initial.opacity * opacity;
        typed.transparent = initial.transparent || opacity < 1;
        typed.needsUpdate = true;
      }
    });
  }
}

// Content is deliberately NOT part of the remount snapshot: every lane applies
// content changes in place on its update path (DOM lanes swap text; splat/plane
// rebuild via their own dirty checks). Remounting on content — the old behavior —
// restarted the fade and the panel animation on every authoring keystroke.
function snapshotOf(block: TextBlock): BlockSnapshot {
  return {
    presentation: block.presentation,
    space: block.space,
  };
}

function sameSnapshot(a: BlockSnapshot, b: BlockSnapshot): boolean {
  return a.presentation === b.presentation && a.space === b.space;
}

function requiresRemount(a: BlockSnapshot, b: BlockSnapshot): boolean {
  return !sameSnapshot(a, b);
}


function variantConditions(block: TextBlock, styles: TextStyle[]): VariantCondition[] {
  const conditions = (block.variants ?? []).map((variant) => variant.when);
  const byId = new Map(styles.map((style) => [style.id, style]));
  const visited = new Set<string>();
  let styleId = block.styleId;
  while (styleId !== undefined && !visited.has(styleId)) {
    visited.add(styleId);
    const style = byId.get(styleId);
    if (!style) break;
    conditions.push(...(style.variants ?? []).map((variant) => variant.when));
    styleId = style.basedOn;
  }
  return conditions;
}

function surfaceOf(renderer: BlockRenderer): HTMLElement | Object3D | null {
  return (renderer as BlockRenderer & { readonly surface?: HTMLElement | Object3D | null }).surface ?? null;
}
