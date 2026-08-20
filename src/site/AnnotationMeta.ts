/** Provenance + trust data for machine-seeded annotations. Optional everywhere;
 *  hand-authored annotations simply have none. */
export interface AnnotationMeta {
  source: "owlv2-colmap" | "owlv2-synthetic" | "interactions-import" | "vlm-scan" | "manual";
  confidence?: number;             // best single-view score, 0..1
  votes?: number;                  // distinct supporting views/frames
  size?: [number, number, number]; // AABB extents, world units — only when a true 3-axis size exists
}
