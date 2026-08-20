import type { AnnotationMeta } from "./AnnotationMeta";
import type { SiteAnnotation } from "./SiteConfig";
import type { SeedWorldTransform } from "./HotspotSeeder";

export interface InteractionsObject {
  label: string;
  position: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number; w: number };
  scale?: { x: number; y: number; z: number };
  frames?: { frame_idx: number; box: number[]; score: number }[];
}

export interface InteractionsJson {
  objects: InteractionsObject[];
}

export interface ImportOptions {
  transform?: SeedWorldTransform;  // REPLACES the default [x,−y,−z] flip
  idPrefix?: string;               // default "imp-"
  radiusClamp?: [number, number];  // default [0.05, 1.5]
}

export interface ImportedAnnotations {
  annotations: SiteAnnotation[];
  meta: Record<string, AnnotationMeta>;
}

interface IndexedObject {
  object: InteractionsObject;
  originalIndex: number;
  confidence?: number;
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "hotspot";
}

function titleCase(label: string): string {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function transformPosition(
  position: InteractionsObject["position"],
  worldTransform?: SeedWorldTransform,
): [number, number, number] {
  if (!worldTransform) {
    return [round(position.x, 6), round(-position.y, 6), round(-position.z, 6)];
  }
  const r = worldTransform.R;
  const t = worldTransform.t;
  return [
    round((r[0]?.[0] ?? 0) * position.x + (r[0]?.[1] ?? 0) * position.y + (r[0]?.[2] ?? 0) * position.z + (t[0] ?? 0), 6),
    round((r[1]?.[0] ?? 0) * position.x + (r[1]?.[1] ?? 0) * position.y + (r[1]?.[2] ?? 0) * position.z + (t[1] ?? 0), 6),
    round((r[2]?.[0] ?? 0) * position.x + (r[2]?.[1] ?? 0) * position.y + (r[2]?.[2] ?? 0) * position.z + (t[2] ?? 0), 6),
  ];
}

function confidenceOf(object: InteractionsObject): number | undefined {
  return object.frames && object.frames.length > 0
    ? Math.max(...object.frames.map((frame) => frame.score))
    : undefined;
}

function isInteractionsObject(value: unknown): value is InteractionsObject {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<InteractionsObject>;
  return typeof candidate.label === "string"
    && typeof candidate.position?.x === "number"
    && typeof candidate.position.y === "number"
    && typeof candidate.position.z === "number";
}

/** Convert splat_analyzer interactions objects into site annotations and trust metadata. */
export function interactionsToAnnotations(
  doc: InteractionsJson,
  opts: ImportOptions = {},
): ImportedAnnotations {
  const indexed: IndexedObject[] = [];
  let skipped = 0;

  for (const [originalIndex, value] of doc.objects.entries()) {
    if (!isInteractionsObject(value)) {
      skipped++;
      continue;
    }
    indexed.push({ object: value, originalIndex, confidence: confidenceOf(value) });
  }

  if (skipped > 0) {
    console.warn(`InteractionsImport: skipped ${skipped} malformed object${skipped === 1 ? "" : "s"}`);
  }

  indexed.sort((a, b) => {
    const labelOrder = a.object.label < b.object.label ? -1 : a.object.label > b.object.label ? 1 : 0;
    if (labelOrder !== 0) return labelOrder;
    if (a.confidence === undefined && b.confidence !== undefined) return 1;
    if (a.confidence !== undefined && b.confidence === undefined) return -1;
    return (b.confidence ?? 0) - (a.confidence ?? 0)
      || a.object.position.x - b.object.position.x
      || a.object.position.y - b.object.position.y
      || a.object.position.z - b.object.position.z
      || a.originalIndex - b.originalIndex;
  });

  const annotations: SiteAnnotation[] = [];
  const meta: Record<string, AnnotationMeta> = {};
  const labelCounts = new Map<string, number>();
  const idPrefix = opts.idPrefix ?? "imp-";
  const radiusClamp = opts.radiusClamp ?? [0.05, 1.5];

  for (const item of indexed) {
    const object = item.object;
    const ordinal = (labelCounts.get(object.label) ?? 0) + 1;
    labelCounts.set(object.label, ordinal);
    const id = `${idPrefix}${slugify(object.label)}-${ordinal}`;
    const annotation: SiteAnnotation = {
      id,
      anchor: transformPosition(object.position, opts.transform),
      copy: { title: titleCase(object.label), body: "" },
    };
    const annotationMeta: AnnotationMeta = { source: "interactions-import" };

    if (object.scale) {
      annotation.radius = round(
        clamp(0.5 * Math.max(object.scale.x, object.scale.y, object.scale.z), radiusClamp[0], radiusClamp[1]),
        3,
      );
      annotationMeta.size = [object.scale.x, object.scale.y, object.scale.z];
    }
    if (item.confidence !== undefined) {
      annotationMeta.confidence = item.confidence;
      annotationMeta.votes = object.frames!.length;
    }

    annotations.push(annotation);
    meta[id] = annotationMeta;
  }

  return { annotations, meta };
}
