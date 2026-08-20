import type { SiteAnnotation } from "./SiteConfig";

export interface LiftedDetection {
  label: string;
  score: number;
  image: string;
  anchor_colmap: [number, number, number];
  extent: number;
}

export interface SeederKnobs {
  minVotes: number;
  eps: number;
  peakFloor: number;
  topN: number;
}

export interface SeedWorldTransform {
  R: number[][];
  t: number[];
}

interface IndexedDetection extends LiftedDetection {
  originalIndex: number;
}

interface ClusterCandidate {
  label: string;
  peakScore: number;
  votes: number;
  position: [number, number, number];
  scale: number;
}

export interface DetailedClusteredHotspot {
  annotation: SiteAnnotation;
  votes: number;
  peakScore: number;
}

function distance(a: readonly number[], b: readonly number[]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.hypot(dx, dy, dz);
}

function weightedMean(items: IndexedDetection[]): [number, number, number] {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let sw = 0;
  for (const item of items) {
    const w = Math.max(item.score, 1e-6);
    sx += item.anchor_colmap[0] * w;
    sy += item.anchor_colmap[1] * w;
    sz += item.anchor_colmap[2] * w;
    sw += w;
  }
  return [sx / sw, sy / sw, sz / sw];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
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
  position: [number, number, number],
  worldTransform?: SeedWorldTransform | null,
): [number, number, number] {
  if (!worldTransform) {
    return [round(position[0], 6), round(-position[1], 6), round(-position[2], 6)];
  }
  const r = worldTransform.R;
  const t = worldTransform.t;
  return [
    round((r[0]?.[0] ?? 0) * position[0] + (r[0]?.[1] ?? 0) * position[1] + (r[0]?.[2] ?? 0) * position[2] + (t[0] ?? 0), 6),
    round((r[1]?.[0] ?? 0) * position[0] + (r[1]?.[1] ?? 0) * position[1] + (r[1]?.[2] ?? 0) * position[2] + (t[1] ?? 0), 6),
    round((r[2]?.[0] ?? 0) * position[0] + (r[2]?.[1] ?? 0) * position[1] + (r[2]?.[2] ?? 0) * position[2] + (t[2] ?? 0), 6),
  ];
}

function radiusFromScale(scale: number): number {
  return round(clamp(0.5 * scale, 0.05, 1.5), 3);
}

export function clusterLifted(
  lifted: LiftedDetection[],
  knobs: SeederKnobs,
  worldTransform?: SeedWorldTransform | null,
): SiteAnnotation[] {
  return clusterLiftedDetailed(lifted, knobs, worldTransform).map((item) => item.annotation);
}

export function clusterLiftedDetailed(
  lifted: LiftedDetection[],
  knobs: SeederKnobs,
  worldTransform?: SeedWorldTransform | null,
): DetailedClusteredHotspot[] {
  const selected = selectClusterCandidates(lifted, knobs);
  const labelCounts = new Map<string, number>();
  return selected.map((candidate) => {
    const next = (labelCounts.get(candidate.label) ?? 0) + 1;
    labelCounts.set(candidate.label, next);
    return {
      annotation: {
        id: `${slugify(candidate.label)}-${next}`,
        anchor: transformPosition(candidate.position, worldTransform),
        radius: radiusFromScale(candidate.scale),
        copy: {
          title: titleCase(candidate.label),
          body: "",
        },
      },
      votes: candidate.votes,
      peakScore: candidate.peakScore,
    };
  });
}

function selectClusterCandidates(
  lifted: LiftedDetection[],
  knobs: SeederKnobs,
): ClusterCandidate[] {
  const indexed: IndexedDetection[] = lifted.map((item, originalIndex) => ({
    ...item,
    originalIndex,
  }));
  const labels = [...new Set(indexed.map((item) => item.label))].sort();
  const candidates: ClusterCandidate[] = [];

  for (const label of labels) {
    const items = indexed
      .filter((item) => item.label === label)
      .sort((a, b) =>
        b.score - a.score ||
        a.image.localeCompare(b.image) ||
        a.originalIndex - b.originalIndex
      );
    const assigned = new Array<boolean>(items.length).fill(false);

    for (let i = 0; i < items.length; i++) {
      if (assigned[i]) continue;
      const anchor = items[i];
      const memberIndexes: number[] = [];
      for (let j = 0; j < items.length; j++) {
        if (!assigned[j] && distance(items[j].anchor_colmap, anchor.anchor_colmap) <= knobs.eps) {
          memberIndexes.push(j);
        }
      }
      for (const index of memberIndexes) assigned[index] = true;
      const members = memberIndexes.map((index) => items[index]);
      const votes = new Set(members.map((member) => member.image)).size;
      const peakScore = Math.max(...members.map((member) => member.score));
      if (votes < knobs.minVotes || peakScore < knobs.peakFloor) continue;

      candidates.push({
        label,
        peakScore,
        votes,
        position: weightedMean(members),
        scale: median(members.map((member) => member.extent)),
      });
    }
  }

  const selected: ClusterCandidate[] = [];
  for (const label of labels) {
    selected.push(
      ...candidates
        .filter((candidate) => candidate.label === label)
        .sort((a, b) =>
          b.peakScore - a.peakScore ||
          b.votes - a.votes ||
          a.position[0] - b.position[0] ||
          a.position[1] - b.position[1] ||
          a.position[2] - b.position[2]
        )
        .slice(0, knobs.topN),
    );
  }

  selected.sort((a, b) =>
    a.label.localeCompare(b.label) ||
    b.peakScore - a.peakScore ||
    b.votes - a.votes ||
    a.position[0] - b.position[0] ||
    a.position[1] - b.position[1] ||
    a.position[2] - b.position[2]
  );

  return selected;
}
