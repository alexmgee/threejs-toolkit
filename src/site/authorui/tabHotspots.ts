import {
  clusterLiftedDetailed,
  type DetailedClusteredHotspot,
  type SeedWorldTransform,
} from "../HotspotSeeder";
import {
  interactionsToAnnotations,
  type InteractionsJson,
} from "../InteractionsImport";
import {
  blocksShownByAnnotation,
  conjuredCopyId,
  unbindBlocksFrom,
  uniqueEntityId,
  type SiteAnnotation,
} from "../SiteConfig";
import {
  chip,
  collapsible,
  el,
  field,
  icon,
  sectionLabel,
  slider,
  switchToggle,
  textBtn,
} from "./primitives";
import { browseRow } from "./paneKit";
import type { AuthorTabCtx } from "./tabContext";

export function renderHotspots(ctx: AuthorTabCtx): HTMLElement {
  return el("div", { className: "ap-stack" }, [
    renderSeedingDisclosure(ctx),
    renderInteractionsImport(ctx),
    renderAnnotationsList(ctx),
  ]);
}

/** Import analyzer detections without requiring the advanced ?seed= URL flow. */
function renderInteractionsImport(ctx: AuthorTabCtx): HTMLElement {
  const detectionsInput = el("input", {
    className: "ap-input",
    type: "file",
    attrs: { accept: ".json", "aria-label": "Detections file" },
  }) as HTMLInputElement;
  const transformInput = el("input", {
    className: "ap-input",
    type: "file",
    attrs: { accept: ".json", "aria-label": "Transform file" },
  }) as HTMLInputElement;
  const errorHint = el("div", {
    className: "ap-hint",
    attrs: { hidden: "" },
  });
  let importing = false;

  const showError = (message: string) => {
    errorHint.textContent = message;
    errorHint.hidden = false;
  };
  const importButton = textBtn("plus", "Import", {
    tone: "accent",
    onClick: () => {
      if (importing) return;
      importing = true;
      importButton.disabled = true;
      errorHint.hidden = true;

      void importInteractions(ctx, detectionsInput.files?.[0], transformInput.files?.[0])
        .catch((error: unknown) => {
          showError(error instanceof Error ? error.message : "Unable to import the selected files.");
        })
        .finally(() => {
          importing = false;
          importButton.disabled = false;
        });
    },
  });

  return collapsible(
    el("span", { text: "Import detections file" }),
    el("div", { className: "ap-stack" }, [
      sectionLabel("Import detections"),
      field("Detections file", detectionsInput),
      field("Transform file (optional)", transformInput),
      el("div", { className: "ap-actions" }, [importButton]),
      errorHint,
    ]),
    { open: false },
  );
}

async function importInteractions(
  ctx: AuthorTabCtx,
  detectionsFile?: File,
  transformFile?: File,
): Promise<void> {
  if (!detectionsFile) {
    throw new Error("Choose a detections file before importing.");
  }

  const rawDetections = await readJsonFile(detectionsFile, "Detections file");
  if (!isInteractionsJson(rawDetections)) {
    throw new Error("Detections file must contain a JSON object with an objects array.");
  }

  let transform: SeedWorldTransform | undefined;
  if (transformFile) {
    const rawTransform = await readJsonFile(transformFile, "Transform file");
    if (!isTransformSidecar(rawTransform)) {
      throw new Error("Transform file must contain a 3×3 R_rows matrix and a three-value t vector.");
    }
    transform = { R: rawTransform.R_rows, t: rawTransform.t };
  }

  const imported = interactionsToAnnotations(
    rawDetections,
    transform ? { transform } : undefined,
  );
  const annotations = imported.annotations.map((annotation) => ({
    ...annotation,
    meta: imported.meta[annotation.id],
  }));
  const collisions = findImportCollisions(ctx, annotations);
  if (collisions.length > 0) {
    throw new Error(`Import blocked by colliding ids: ${formatCollisionIds(collisions)}.`);
  }

  // No blocks are minted for the imported copy (ticket 13/A5): a marker's copy
  // floats at the marker via the runtime's conjured box, so an imported marker
  // behaves exactly like one written by hand.
  ctx.site.annotations = [...ctx.site.annotations, ...annotations];
  ctx.structural("annotations");
}

async function readJsonFile(file: File, label: string): Promise<unknown> {
  try {
    return JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error(`${label} could not be read as JSON.`);
  }
}

function isInteractionsJson(value: unknown): value is InteractionsJson {
  return typeof value === "object"
    && value !== null
    && Array.isArray((value as Partial<InteractionsJson>).objects);
}

interface TransformSidecar {
  R_rows: number[][];
  t: number[];
}

function isTransformSidecar(value: unknown): value is TransformSidecar {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<TransformSidecar>;
  return Array.isArray(candidate.R_rows)
    && candidate.R_rows.length === 3
    && candidate.R_rows.every((row) =>
      Array.isArray(row) && row.length === 3 && row.every(Number.isFinite))
    && Array.isArray(candidate.t)
    && candidate.t.length === 3
    && candidate.t.every(Number.isFinite);
}

function findImportCollisions(
  ctx: AuthorTabCtx,
  annotations: SiteAnnotation[],
): string[] {
  const existingAnnotationIds = new Set(ctx.site.annotations.map((annotation) => annotation.id));
  const existingBlockIds = new Set(ctx.site.blocks.map((block) => block.id));
  const producedAnnotationIds = new Set<string>();
  const collisions = new Set<string>();

  // The import mints no blocks any more (ticket 13/A5), so the old title/body
  // block collisions are gone — but each imported id RESERVES its conjured-box
  // id (`annotation-<id>-copy`), and an authored block already sitting there
  // would make the exported site refuse its next load. Refuse it here, at the
  // moment the author can still rename.
  for (const annotation of annotations) {
    if (existingAnnotationIds.has(annotation.id) || producedAnnotationIds.has(annotation.id)) {
      collisions.add(annotation.id);
    }
    producedAnnotationIds.add(annotation.id);
    const conjuredId = conjuredCopyId(annotation.id);
    if (existingBlockIds.has(conjuredId)) collisions.add(conjuredId);
  }

  return [...collisions];
}

function formatCollisionIds(ids: string[]): string {
  const limit = 8;
  const shown = ids.slice(0, limit);
  const remaining = ids.length - shown.length;
  return remaining > 0
    ? `${shown.join(", ")} (+${remaining} more)`
    : shown.join(", ");
}

function renderSeedingDisclosure(ctx: AuthorTabCtx): HTMLElement {
  return collapsible(
    el("span", { text: "Advanced — auto-seed from detections" }),
    ctx.hotspotSeed ? renderSeedingBody(ctx) : renderSeedingEmptyBody(),
    { open: false },
  );
}

function renderSeedingEmptyBody(): HTMLElement {
  return el("div", { className: "ap-stack" }, [
    sectionLabel("Hotspot seeding"),
    el("div", {
      className: "ap-hint",
      text: "Optional — auto-seed hotspots from an object-detection file (advanced). Pass ?seed=<lifted.json>&seedTransform=<transform.json> in the URL to enable. Authoring by hand? Just use “+ Add annotation” below.",
    }),
  ]);
}

function renderSeedingBody(ctx: AuthorTabCtx): HTMLElement {
  const countText = el("div", {
    className: "ap-candidate-count",
    text: candidateText(ctx, "candidates: -"),
  });
  const candidateList = el("div", { className: "ap-candidate-list" });

  const ensureLoaded = (): Promise<DetailedClusteredHotspot[]> => {
    if (ctx.seedState.cache) {
      return Promise.resolve(reclusterDetailed(ctx));
    }
    if (!ctx.seedState.loading) {
      countText.textContent = "candidates: loading...";
      ctx.seedState.loading = ctx.hotspotSeed!.load().then((items) => {
        ctx.seedState.cache = items;
        ctx.seedState.loading = null;
        return items;
      });
    }
    return ctx.seedState.loading.then(() => reclusterDetailed(ctx));
  };

  const recompute = () => {
    void ensureLoaded()
      .then((items) => {
        countText.textContent = `candidates: ${items.length}`;
        candidateList.replaceChildren(...renderCandidatePreview(ctx, items));
      })
      .catch((error: unknown) => {
        console.error("[AuthorPanel] failed to load hotspot seed", error);
        ctx.seedState.loading = null;
        countText.textContent = "candidates: error";
        candidateList.replaceChildren(el("div", {
          className: "ap-hint",
          text: "Unable to preview hotspot candidates.",
        }));
      });
  };

  const knobs = ctx.seedState.knobs;
  const node = el("div", { className: "ap-stack" }, [
    sectionLabel("Hotspot seeding"),
    slider({
      label: "Minimum votes",
      value: knobs.minVotes,
      min: 1,
      max: 40,
      step: 1,
      fmt: formatInt,
      onInput: (value) => {
        knobs.minVotes = value;
        recompute();
      },
    }),
    slider({
      label: "Cluster radius",
      value: knobs.eps,
      min: 0.1,
      max: 3,
      step: 0.1,
      fmt: formatTrimmed,
      onInput: (value) => {
        knobs.eps = value;
        recompute();
      },
    }),
    slider({
      label: "Peak floor",
      value: knobs.peakFloor,
      min: 0.1,
      max: 0.9,
      step: 0.01,
      fmt: formatTrimmed,
      onInput: (value) => {
        knobs.peakFloor = value;
        recompute();
      },
    }),
    slider({
      label: "Top candidates",
      value: knobs.topN,
      min: 1,
      max: 5,
      step: 1,
      fmt: formatInt,
      onInput: (value) => {
        knobs.topN = value;
        recompute();
      },
    }),
    countText,
    candidateList,
    el("div", { className: "ap-actions" }, [
      textBtn("circle-check", "Apply to hotspots", {
        tone: "accent",
        onClick: () => {
          void ensureLoaded()
            .then(() => {
              const next = reclusterDetailed(ctx).map(({ annotation, votes, peakScore }) => ({
                ...annotation,
                meta: {
                  source: ctx.hotspotSeed?.source ?? "owlv2-colmap",
                  votes,
                  confidence: peakScore,
                },
              }));
              // Runtime replacement bypasses normalize's seeding: prune blocks of
              // annotations that disappear, seed blocks for genuine newcomers — and
              // NEVER clobber a recurring id. Seeder ids are stable label ordinals,
              // so a re-run reuses ids while resetting copy; the author's captions
              // (and their blocks) must survive a re-Apply.
              const previous = new Map(ctx.site.annotations.map((annotation) => [annotation.id, annotation]));
              for (const annotation of ctx.site.annotations) {
                if (!next.some((candidate) => candidate.id === annotation.id)) {
                  // The annotation OBJECT, not its id: the prune reads its
                  // rules to find what it displayed. Safe here because the list
                  // is replaced below, after this loop.
                  pruneAnnotationBlocks(ctx, annotation);
                }
              }
              ctx.site.annotations = next.map((candidate) => {
                const kept = previous.get(candidate.id);
                return kept ? { ...candidate, copy: kept.copy, highlight: kept.highlight ?? candidate.highlight } : candidate;
              });
              // Newcomers get no blocks (ticket 13/A5): their copy floats at
              // the marker via the runtime's conjured box.
              ctx.structural("annotations");
            })
            .catch((error: unknown) => {
              console.error("[AuthorPanel] failed to apply hotspot seed", error);
              ctx.seedState.loading = null;
              countText.textContent = "candidates: error";
            });
        },
      }),
    ]),
    el("div", {
      className: "ap-hint",
      text: "Replaces all hotspots — dial first, curate after",
    }),
  ]);

  recompute();
  return node;
}

function renderAnnotationsList(ctx: AuthorTabCtx): HTMLElement {
  const displayedAnnotations = ctx.site.annotations.map((annotation, originalIndex) => ({
    annotation,
    originalIndex,
    tier: !annotation.meta
      ? 2
      : annotation.meta.confidence === undefined ? 1 : 0,
    confidence: annotation.meta?.confidence,
  }));
  if (ctx.annotationSortByConfidence) {
    displayedAnnotations.sort((left, right) =>
      left.tier - right.tier
      || (left.tier === 0 ? right.confidence! - left.confidence! : 0)
      || left.originalIndex - right.originalIndex);
  }

  return el("div", { className: "ap-stack" }, [
    el("div", { className: "ap-actions" }, [
      textBtn("plus", "+ Add annotation", {
        tone: "accent",
        onClick: () => {
          void ctx.pickPoint().then((point) => {
            if (!point) return;
            const aid = uniqueEntityId(ctx.site.annotations.map((a) => a.id), "note");
            // Copy only — no blocks, no rule (ticket 13/A5). A marker made in
            // the panel behaves exactly like one written by hand: its copy
            // floats at the marker via the runtime's conjured box.
            ctx.site.annotations.push({
              id: aid,
              anchor: point,
              copy: { title: "New annotation", body: "" },
            });
            ctx.structural("annotations");
          });
        },
      }),
    ]),
    sectionLabel(`${ctx.site.annotations.length} Hotspots`),
    field("Sort by confidence", switchToggle(ctx.annotationSortByConfidence, (on) => {
      ctx.setAnnotationSortByConfidence(on);
      ctx.requestRerender();
    })),
    ...displayedAnnotations.map(({ annotation: item }) => browseRow({
      icon: "map-pin",
      title: item.copy?.title || item.id,
      chips: item.meta ? [{
        text: `${item.meta.votes ?? "—"} votes · ${item.meta.confidence?.toFixed(2) ?? "—"}`,
      }] : undefined,
      onClick: () => ctx.selectHotspot(item.id),
    })),
    el("div", {
      className: "ap-hint",
      text: "Click a hotspot to open its editor — copy, radius, highlight, and gizmo live there.",
    }),
  ]);
}

/**
 * Drop the blocks a deleted annotation was displaying, and anything still
 * bound to it.
 *
 * ⚠ MUST RUN BEFORE the annotation is spliced out of the list. It reads that
 * annotation's RULES to learn what it displayed, and ticket 17 moved that
 * knowledge out of the blocks and onto the annotation — so once the annotation
 * is gone the evidence is gone with it, and this becomes a silent no-op that
 * leaves the copy blocks squatting their reserved ids. Re-creating a hotspot
 * with the same id then fails to load.
 */
export function pruneAnnotationBlocks(ctx: AuthorTabCtx, annotation: SiteAnnotation): void {
  // Any block still carrying the retired leg — a hand-authored file, or one
  // written by an older build of the panel.
  unbindBlocksFrom(ctx.site.blocks, "annotations", annotation.id);
  for (const blockId of blocksShownByAnnotation(annotation)) {
    const index = ctx.site.blocks.findIndex((block) => block.id === blockId);
    if (index < 0) continue;
    const binding = ctx.site.blocks[index].binding ?? {};
    // Another reason to be on screen: leave it alone. Only a block whose ONLY
    // reason to exist was this annotation goes.
    if (binding.always === true
      || (binding.stops?.length ?? 0) > 0
      || binding.range !== undefined) continue;
    if (ctx.site.annotations.some((other) =>
      other.id !== annotation.id && blocksShownByAnnotation(other).includes(blockId))) continue;
    ctx.site.blocks.splice(index, 1);
  }
}

// `upsertAnnotationBlock` is gone (ticket 13/A5). It was the THIRD
// `seededCaptionBlock` call site: every marker made or retitled in the panel
// was born with a screen panel attached and would never float. Copy now lives
// on the annotation alone; the runtime's conjured box is what displays it.

function renderCandidatePreview(
  ctx: AuthorTabCtx,
  items: DetailedClusteredHotspot[],
): HTMLElement[] {
  if (items.length === 0) {
    return [el("div", {
      className: "ap-hint",
      text: "No hotspot candidates at the current settings.",
    })];
  }

  return items.map((item) => renderCandidateRow(item, ctx.seedState.knobs.peakFloor));
}

function renderCandidateRow(
  item: DetailedClusteredHotspot,
  peakFloor: number,
): HTMLElement {
  const passesPeakFloor = item.peakScore >= peakFloor;
  const statusName = passesPeakFloor ? "circle-check" : "triangle-alert";
  return el("div", {
    className: "ap-candidate-row",
    dataset: { tone: passesPeakFloor ? "positive" : "warning" },
  }, [
    chip(item.annotation.id),
    el("span", {
      className: "ap-candidate-title",
      text: item.annotation.copy.title || item.annotation.id,
    }),
    chip(`${formatInt(item.votes)} votes · ${formatScore(item.peakScore)}`),
    el("span", {
      className: "ap-status-icon",
      title: passesPeakFloor ? "Meets peak floor" : "Below peak floor",
      dataset: { tone: passesPeakFloor ? "positive" : "warning" },
    }, [icon(statusName)]),
  ]);
}

function reclusterDetailed(ctx: AuthorTabCtx): DetailedClusteredHotspot[] {
  return clusterLiftedDetailed(
    ctx.seedState.cache ?? [],
    ctx.seedState.knobs,
    ctx.hotspotSeed?.worldTransform ?? null,
  );
}

function candidateText(ctx: AuthorTabCtx, fallback: string): string {
  if (!ctx.seedState.cache) return fallback;
  return `candidates: ${reclusterDetailed(ctx).length}`;
}

function formatInt(value: number): string {
  return String(Math.round(value));
}

function formatTrimmed(value: number): string {
  return String(Number(value.toFixed(2)));
}

function formatScore(value: number): string {
  return value.toFixed(2);
}
