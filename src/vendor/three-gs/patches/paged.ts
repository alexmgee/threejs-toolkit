/**
 * Fork patch [paged] (ticket 06): fixed-capacity GaussianSplatMesh with page
 * uploads and explicit invalidation — the Phase 0 spike's [capacity]
 * [uploadPage] [invalidate] patches promoted as a PURE .ts SIBLING (D20):
 * the vendored JS stays byte-identical; this module reaches private
 * internals of the PINNED three version from outside. FORK.md's [paged]
 * entry inventories every field; the re-diff procedure re-verifies them.
 * Do not soften the assertions.
 *
 * How capacity works without a JS change: the vendored constructor sizes
 * everything from the source geometry's `position` count, so a zero-filled
 * geometry of `capacity` splats allocates the storage buffers at capacity.
 * A zero row renders NOTHING (zero covariance → alphaScale 0, zero color
 * alpha), so empty slots are invisible without the spike's `center.w`
 * selection lane — selection is ticket 07's concern. After construction the
 * source covariance/color/SH arrays are released (40 B/splat the mesh never
 * reads again); the source `position` array stays referenced by the
 * vendored `_positionAttribute` but is NOT maintained: the paged mesh always
 * carries the [selection] patch, whose instance-level `_sortCPU` reads the
 * vec4 center storage array's xyz + w instead (ticket 07 review removed
 * the dead per-page mirror copy).
 *
 * Partial uploads: pages are written into the storage attributes' arrays
 * and pushed as `addUpdateRange` + `needsUpdate` — the partial path that
 * exists in 0.185.1 (WebGPU backend `updateAttribute` writes each range and
 * clears them; the WebGL2 backend `bufferSubData`s each range). Whether the
 * path is actually HIT is asserted race-free per render (see
 * `snapshotPendingRanges` / `assertPartialUploadConsumed`): a range object
 * that survives the render it was pending for was not consumed → fall back
 * LOUDLY to full-buffer uploads (`partialUploadBroken`). On the WebGL2
 * fallback the vertex shader reads storage through a PBO DataTexture that
 * shares the attribute's (possibly padded, REPLACED) array and re-uploads
 * only on its own `needsUpdate` — whole-texture, no partial path there; a
 * recorded fallback characteristic (spike finding).
 *
 * Invalidation: nothing updates by itself (doc 03 §A4, H-LOAD 9–10). A page
 * arriving under a MOTIONLESS camera must still be sorted into draw order
 * and receive SH contribution — `invalidate()` resets the two private
 * flags the vendored `updateSort` / `updateSphericalHarmonics` gate on, so
 * the next `onBeforeRender` re-dispatches both.
 *
 * SH: the worker delivers SH1 as PACKED u32 words (ticket 02); they are
 * copied into the band attribute directly — no JS packing.
 */
import { BufferAttribute, BufferGeometry, Sphere, Vector3 } from "three/webgpu";
import { GaussianSplatMesh } from "../GaussianSplatMesh.js";
import { SH_BAND_WORDS, createPackedSphericalHarmonicsBand } from "../GaussianSplatUtils.js";
import { ForkPatchError, forkInternalsMissingIn } from "./dispose.js";

/** Byte 128 in every lane = coefficient 0 (createPackedSphericalHarmonicsBand's fill). */
export const NEUTRAL_SH_WORD = 0x80808080;

/** A decoded page — the DecodeResult subset the upload consumes. */
export interface PagedPage {
  readonly count: number;
  /** xyz triples, count*3 */
  readonly center: Float32Array;
  /** upper-triangle 6 per splat */
  readonly covariance: Float32Array;
  /** rgba bytes, count*4 */
  readonly color: Uint8Array;
  /** packed SH1 words, count*3 or length 0 */
  readonly sh1Words: Uint32Array;
}

interface RangeAttribute {
  array: Float32Array | Uint32Array;
  updateRanges: Array<{ start: number; count: number }>;
  addUpdateRange(start: number, count: number): void;
  clearUpdateRanges(): void;
  needsUpdate: boolean;
  pbo?: { needsUpdate: boolean };
}

interface PendingSnapshot {
  attribute: RangeAttribute;
  first: { start: number; count: number };
  pending: number;
}

function forkInternalsMissing(what: string): never {
  return forkInternalsMissingIn("paged", what);
}

function requireRangeAttribute(node: unknown, label: string, ctor: Float32ArrayConstructor | Uint32ArrayConstructor, length: number): RangeAttribute {
  if (node === null || typeof node !== "object") forkInternalsMissing(label);
  const attribute = node as Partial<RangeAttribute>;
  if (!(attribute.array instanceof ctor) || attribute.array.length !== length) {
    forkInternalsMissing(`${label}.array (${ctor.name}[${length}])`);
  }
  if (
    typeof attribute.addUpdateRange !== "function" ||
    typeof attribute.clearUpdateRanges !== "function" ||
    !Array.isArray(attribute.updateRanges)
  ) {
    forkInternalsMissing(`${label}.updateRanges API`);
  }
  return attribute as RangeAttribute;
}

function requireStorageValue(node: unknown, label: string): unknown {
  if (node === null || typeof node !== "object") forkInternalsMissing(label);
  return (node as { value?: unknown }).value;
}

export interface PagedMeshOptions {
  autoSort?: boolean;
}

/**
 * A GaussianSplatMesh allocated at a fixed capacity, driven by page uploads.
 * Construct through `createPagedMesh` (validates every internal surface
 * BEFORE the first write — loud coupling, never silent).
 */
export class PagedMesh {
  readonly mesh: GaussianSplatMesh;
  readonly capacity: number;
  readonly pageSize: number;
  readonly pageCount: number;
  readonly shDegree: number;
  /** Set the first time a pushed range survived the render it was pending
   *  for — the partial path is not being hit; uploads fall back to full
   *  buffer writes from then on. Never silently. */
  partialUploadBroken = false;
  /** Which upload path the storage attributes are on: `partial` (ranges
   *  consumed by the backend's buffer update — WebGPU), `pbo-texture` (the
   *  WebGL2 fallback reads storage through PBO DataTextures; nothing ever
   *  consumes buffer ranges there — whole-texture re-upload per page, a
   *  RECORDED fallback characteristic, not a defect; ranges are not pushed
   *  at all so they cannot pile up), or `full-fallback` after a broken
   *  partial path. Fixture assertion: "partial" on WebGPU, "pbo-texture"
   *  on WebGL2, never "full-fallback". */
  uploadPath: "partial" | "pbo-texture" | "full-fallback" = "partial";
  rangesPushed = 0;
  rangesConsumed = 0;
  /** Whole-texture PBO re-uploads requested (WebGL2 fallback). */
  pboUploads = 0;
  /** Renders observed (onAfterRender). */
  renders = 0;

  private readonly centerAttr: RangeAttribute;
  private readonly covAAttr: RangeAttribute;
  private readonly covBAttr: RangeAttribute;
  private readonly colorAttr: RangeAttribute;
  private readonly sh1Attr: RangeAttribute | null;
  private readonly meshRecord: Record<string, unknown>;
  private snapshot: PendingSnapshot[] = [];
  private primed = false;
  private readonly boundingSphere: Sphere;

  constructor(mesh: GaussianSplatMesh, capacity: number, pageSize: number, shDegree: number) {
    this.mesh = mesh;
    this.capacity = capacity;
    this.pageSize = pageSize;
    this.pageCount = capacity / pageSize;
    this.shDegree = shDegree;
    const record = mesh as unknown as Record<string, unknown>;
    this.meshRecord = record;

    // ── Validate + collect every internal surface (no mutations) ──
    const buffers = record._buffers;
    if (buffers === null || typeof buffers !== "object") forkInternalsMissing("mesh._buffers");
    const b = buffers as Record<string, unknown>;
    this.centerAttr = requireRangeAttribute(requireStorageValue(b.centerRead, "mesh._buffers.centerRead"), "mesh._buffers.centerRead.value", Float32Array, capacity * 4);
    this.covAAttr = requireRangeAttribute(requireStorageValue(b.covarianceARead, "mesh._buffers.covarianceARead"), "mesh._buffers.covarianceARead.value", Float32Array, capacity * 4);
    this.covBAttr = requireRangeAttribute(requireStorageValue(b.covarianceBRead, "mesh._buffers.covarianceBRead"), "mesh._buffers.covarianceBRead.value", Float32Array, capacity * 4);
    this.colorAttr = requireRangeAttribute(requireStorageValue(b.colorRead, "mesh._buffers.colorRead"), "mesh._buffers.colorRead.value", Float32Array, capacity * 4);
    if (shDegree >= 1) {
      const words = SH_BAND_WORDS[1];
      if (words === undefined) forkInternalsMissing("SH_BAND_WORDS[1]");
      this.sh1Attr = requireRangeAttribute(b.sphericalHarmonics1Attribute, "mesh._buffers.sphericalHarmonics1Attribute", Uint32Array, capacity * words);
    } else {
      this.sh1Attr = null;
    }
    // `_positionAttribute` is validated (the vendored `_sortCPU` would read
    // it) but never written: patches/selection.ts replaces `_sortCPU` on the
    // instance with a center-storage reader, so a mirror copy per upload
    // would be dead work (built-in review, 2026-09-12).
    const positionAttribute = record._positionAttribute as { array?: unknown } | undefined;
    if (
      positionAttribute === undefined || positionAttribute === null ||
      !(positionAttribute.array instanceof Float32Array) ||
      positionAttribute.array.length !== capacity * 3
    ) {
      forkInternalsMissing("mesh._positionAttribute.array (Float32Array[capacity*3])");
    }
    if (typeof record._sortInitialized !== "boolean") forkInternalsMissing("mesh._sortInitialized");
    if (typeof record._sphericalHarmonicsInitialized !== "boolean") forkInternalsMissing("mesh._sphericalHarmonicsInitialized");
    const splatGeometry = (mesh as unknown as { splatGeometry?: BufferGeometry }).splatGeometry;
    if (splatGeometry === undefined || splatGeometry.boundingSphere === null) forkInternalsMissing("mesh.splatGeometry.boundingSphere");
    this.boundingSphere = splatGeometry.boundingSphere;

    const geometrySphere = (mesh as unknown as { geometry?: { boundingSphere: Sphere | null } }).geometry;
    if (geometrySphere === undefined) forkInternalsMissing("mesh.geometry");
    this.drawGeometry = geometrySphere as { boundingSphere: Sphere | null; instanceCount: number };

    // ── Hook the render cycle for the race-free partial-path assertion ──
    // The caller's beforeRender (ticket 07: LOD traversal + selection) runs
    // FIRST so the vendored onBeforeRender's sort/SH updates see the new
    // selection lane and any invalidation it requested.
    const previousBefore = mesh.onBeforeRender;
    mesh.onBeforeRender = (...args) => {
      this.beforeRender?.(args[0], args[2]);
      this.snapshotPendingRanges();
      previousBefore.apply(mesh, args);
    };
    const previousAfter = mesh.onAfterRender;
    mesh.onAfterRender = (...args) => {
      this.renders++;
      this.assertPartialUploadConsumed();
      previousAfter.apply(mesh, args);
      this.afterRender?.();
    };
  }

  /** Caller hook after each render (the backend flips ready here). */
  afterRender: (() => void) | null = null;
  /** Caller hook BEFORE the vendored onBeforeRender (ticket 07: the LOD
   *  driver traverses, writes selection, sets the draw count here). Only
   *  runs when three decided to draw the mesh (a frustum-culled mesh gets
   *  no onBeforeRender — so a culled mesh also skips traversal, and three
   *  un-culls it by its bounding sphere the moment it re-enters view). */
  beforeRender: ((renderer: unknown, camera: unknown) => void) | null = null;
  private readonly drawGeometry: { boundingSphere: Sphere | null; instanceCount: number };

  /** [selection] Rewrite one page's `center.w` selection lane (1 = draw,
   *  0 = deselected; the sort's reserved bin catches 0 — patches/selection.ts). */
  setSelection(slot: number, flags: Uint8Array): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.pageCount) {
      throw new ForkPatchError("page-slot-out-of-range", `setSelection: slot ${slot} outside 0..${this.pageCount - 1}`);
    }
    if (flags.length !== this.pageSize) {
      throw new ForkPatchError("selection-length", `setSelection: ${flags.length} flags for a ${this.pageSize}-splat page`);
    }
    const base = slot * this.pageSize;
    const centerData = this.centerAttr.array;
    for (let i = 0; i < this.pageSize; i++) centerData[(base + i) * 4 + 3] = flags[i]!;
    this.pushRange(this.centerAttr, base * 4, this.pageSize * 4);
  }

  /** [selection] Instances drawn = selected rows; the sort put every
   *  deselected row behind them (public InstancedBufferGeometry API). */
  setDrawCount(selectedCount: number): void {
    if (!Number.isInteger(selectedCount) || selectedCount < 0 || selectedCount > this.capacity) {
      throw new ForkPatchError("draw-count", `setDrawCount: ${selectedCount} outside 0..${this.capacity}`);
    }
    this.drawGeometry.instanceCount = selectedCount;
  }

  get drawCount(): number {
    return this.drawGeometry.instanceCount;
  }

  /** Write one decoded page into slot `slot` (rows past `count` zeroed —
   *  a short last chunk safely replaces a full evicted one). */
  uploadPage(slot: number, page: PagedPage): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.pageCount) {
      throw new ForkPatchError("page-slot-out-of-range", `uploadPage: slot ${slot} outside 0..${this.pageCount - 1}`);
    }
    const count = page.count;
    if (count > this.pageSize) {
      throw new ForkPatchError("page-too-large", `uploadPage: page count ${count} exceeds page size ${this.pageSize}`);
    }
    const base = slot * this.pageSize;
    // Re-read every array per call: the WebGL2 PBO setup REPLACES
    // attribute.array with a padded copy (GLSLNodeBuilder setupPBO) — a
    // cached view would write to a dead buffer (spike finding).
    const centerData = this.centerAttr.array;
    const covAData = this.covAAttr.array;
    const covBData = this.covBAttr.array;
    const colorData = this.colorAttr.array;
    const { center, covariance, color } = page;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const i4 = (base + i) * 4;
      const i6 = i * 6;
      centerData[i4] = center[i3]!;
      centerData[i4 + 1] = center[i3 + 1]!;
      centerData[i4 + 2] = center[i3 + 2]!;
      centerData[i4 + 3] = 0;
      covAData[i4] = covariance[i6]!;
      covAData[i4 + 1] = covariance[i6 + 1]!;
      covAData[i4 + 2] = covariance[i6 + 2]!;
      covAData[i4 + 3] = covariance[i6 + 3]!;
      covBData[i4] = covariance[i6 + 4]!;
      covBData[i4 + 1] = covariance[i6 + 5]!;
      covBData[i4 + 2] = 0;
      covBData[i4 + 3] = 0;
      colorData[i4] = color[i * 4]! / 255;
      colorData[i4 + 1] = color[i * 4 + 1]! / 255;
      colorData[i4 + 2] = color[i * 4 + 2]! / 255;
      colorData[i4 + 3] = color[i * 4 + 3]! / 255;
    }
    const tailStart = (base + count) * 4;
    const tailEnd = (base + this.pageSize) * 4;
    centerData.fill(0, tailStart, tailEnd);
    covAData.fill(0, tailStart, tailEnd);
    covBData.fill(0, tailStart, tailEnd);
    colorData.fill(0, tailStart, tailEnd);

    this.pushRange(this.centerAttr, base * 4, this.pageSize * 4);
    this.pushRange(this.covAAttr, base * 4, this.pageSize * 4);
    this.pushRange(this.covBAttr, base * 4, this.pageSize * 4);
    this.pushRange(this.colorAttr, base * 4, this.pageSize * 4);

    if (this.sh1Attr !== null) {
      const words = SH_BAND_WORDS[1]!;
      const shData = this.sh1Attr.array as Uint32Array;
      const filled = page.sh1Words.length > 0 ? count : 0;
      if (filled > 0) shData.set(page.sh1Words.subarray(0, filled * words), base * words);
      shData.fill(NEUTRAL_SH_WORD, (base + filled) * words, (base + this.pageSize) * words);
      this.pushRange(this.sh1Attr, base * words, this.pageSize * words);
    }
  }

  /** Zero a slot (an evicted page must disappear, not linger until overwritten). */
  clearPage(slot: number): void {
    this.uploadPage(slot, {
      count: 0,
      center: new Float32Array(0),
      covariance: new Float32Array(0),
      color: new Uint8Array(0),
      sh1Words: new Uint32Array(0),
    });
  }

  /** Explicit sort + SH invalidation: the next onBeforeRender re-sorts and
   *  re-dispatches SH even under a motionless camera. */
  invalidate(): void {
    this.meshRecord._sortInitialized = false;
    this.meshRecord._sphericalHarmonicsInitialized = false;
  }

  /** The sort's depth range comes from splatGeometry.boundingSphere — keep
   *  it covering the resident pages. */
  setBounds(min: readonly [number, number, number], max: readonly [number, number, number]): void {
    const center = new Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    const radius = 0.5 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    this.boundingSphere.center.copy(center);
    this.boundingSphere.radius = Math.max(radius, Number.EPSILON);
    // Frustum culling (doc 03 §F, ticket 07): three's own per-frame test
    // reads the DRAW geometry's bounding sphere (Renderer.js
    // frustum.intersectsObject → geometry.boundingSphere × matrixWorld).
    // Keep it over the resident pages' AABB union so `frustumCulled = true`
    // culls the mesh from the pager's AABBs through public API.
    if (this.drawGeometry.boundingSphere === null) this.drawGeometry.boundingSphere = new Sphere();
    this.drawGeometry.boundingSphere.center.copy(center);
    this.drawGeometry.boundingSphere.radius = Math.max(radius, Number.EPSILON);
  }

  private pushRange(attribute: RangeAttribute, start: number, count: number): void {
    if (attribute.pbo !== undefined) {
      // WebGL2 fallback: the storage read is a PBO DataTexture sharing this
      // array — re-upload the whole texture. No buffer path consumes ranges
      // here, so none are pushed (they would only accumulate).
      attribute.pbo.needsUpdate = true;
      this.pboUploads++;
      if (this.uploadPath === "partial") this.uploadPath = "pbo-texture";
      return;
    }
    if (this.partialUploadBroken) {
      attribute.needsUpdate = true;
      return;
    }
    attribute.addUpdateRange(start, count);
    attribute.needsUpdate = true;
    this.rangesPushed++;
  }

  /** onBeforeRender: remember which range objects are pending for THIS
   *  render (identity of the first one + the count). */
  private snapshotPendingRanges(): void {
    this.snapshot = [];
    for (const attribute of this.attributes()) {
      const first = attribute.updateRanges[0];
      if (first !== undefined) {
        this.snapshot.push({ attribute, first, pending: attribute.updateRanges.length });
      }
    }
  }

  /** onAfterRender: a snapshot's first range object still sitting at the
   *  head of updateRanges means the backend never consumed it (it clears
   *  the array after writing). Ranges pushed between before and after
   *  append behind it, so the identity check is race-free. The very first
   *  render only PRIMES: buffer creation uploads the whole array and never
   *  clears ranges (spike finding), so surviving pre-creation ranges are
   *  legitimate — cleared, not judged. */
  private assertPartialUploadConsumed(): void {
    const snapshot = this.snapshot;
    this.snapshot = [];
    if (!this.primed) {
      this.primed = true;
      for (const entry of snapshot) entry.attribute.clearUpdateRanges();
      // The PBO textures exist only after the first shader build: an asset
      // whose pages all landed before this render would otherwise stay
      // labelled "partial" on the WebGL2 fallback (adversarial review).
      if (this.uploadPath === "partial" && this.attributes().some((a) => a.pbo !== undefined)) {
        this.uploadPath = "pbo-texture";
      }
      return;
    }
    let broken = false;
    for (const entry of snapshot) {
      if (entry.attribute.updateRanges[0] === entry.first) {
        broken = true;
        entry.attribute.clearUpdateRanges();
        entry.attribute.needsUpdate = true;
      } else {
        this.rangesConsumed += entry.pending;
      }
    }
    if (broken && !this.partialUploadBroken) {
      this.partialUploadBroken = true;
      this.uploadPath = "full-fallback";
      console.warn("[paged] partial-update path NOT consumed by the renderer — falling back to full-buffer uploads (H-LOAD trap: assert hit, else fall back loudly)");
    }
  }

  private attributes(): RangeAttribute[] {
    const list = [this.centerAttr, this.covAAttr, this.covBAttr, this.colorAttr];
    if (this.sh1Attr !== null) list.push(this.sh1Attr);
    return list;
  }
}

/**
 * Build the zero geometry + mesh at `capacity` and validate every internal
 * surface before returning. Supports SH degree 0 or 1 (the worker emits
 * SH1 only); other degrees are refused by name.
 */
export function createPagedMesh(
  capacity: number,
  pageSize: number,
  shDegree: number,
  options: PagedMeshOptions = {},
): PagedMesh {
  if (!Number.isInteger(capacity) || capacity < 1 || !Number.isInteger(pageSize) || pageSize < 1 || capacity % pageSize !== 0) {
    throw new ForkPatchError("invalid-capacity", `capacity ${capacity} must be a positive multiple of page size ${pageSize}`);
  }
  if (shDegree !== 0 && shDegree !== 1) {
    throw new ForkPatchError("unsupported-sh-degree", `paged mesh supports SH degree 0 or 1, got ${shDegree}`);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(capacity * 3), 3));
  geometry.setAttribute("covariance", new BufferAttribute(new Float32Array(capacity * 6), 6));
  geometry.setAttribute("color", new BufferAttribute(new Uint8ClampedArray(capacity * 4), 4, true));
  if (shDegree === 1) {
    const words = SH_BAND_WORDS[1]!;
    geometry.setAttribute("sphericalHarmonics1", new BufferAttribute(createPackedSphericalHarmonicsBand(capacity, 1).packed, words));
  }
  // The constructor computes these from the (all-zero) positions; the
  // caller's setBounds keeps the sphere over the resident pages.
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  if (geometry.boundingSphere !== null) geometry.boundingSphere.radius = 1;

  const mesh = new GaussianSplatMesh(geometry, { autoSort: options.autoSort ?? true });
  const paged = new PagedMesh(mesh, capacity, pageSize, shDegree);

  // Release the source arrays the vendored mesh copied at construction and
  // never reads again (covariance/color/SH: 40 B/splat). `position` stays
  // referenced by the vendored mesh (`_positionAttribute`); the [selection]
  // patch's CPU sort reads the center storage array instead.
  geometry.deleteAttribute("covariance");
  geometry.deleteAttribute("color");
  if (shDegree === 1) geometry.deleteAttribute("sphericalHarmonics1");
  return paged;
}
