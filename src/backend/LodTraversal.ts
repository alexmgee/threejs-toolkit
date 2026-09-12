/**
 * LodTraversal — per-slot LOD data + Spark-shaped frontier selection
 * (ticket 07). Promoted from the TRAVERSAL half of
 * `spikes/native-rad/src/PagePool.ts` (size precompute at insert, traverse
 * including pixelScale/foveation, heap helpers, double-buffered selection
 * diff). Residency (slot ↔ chunk, protected, lastTouched, everUploaded)
 * arrives through `ResidencyView` so this module never touches PagePool.
 *
 * Concept reference, not a parity target (ADR 0003): Spark
 * `spark-worker-rs/lod_tree.rs` `traverse_lod_trees` /
 * `compute_pixel_scale`; SparkRenderer.ts defaults behindFoveate 0.2,
 * cone 90°→120°, coneFoveate 0.4, and defaultSplatTarget 2.5M. Those
 * numbers are starting values (owner rulings 07-S3/S4), never comparators.
 *
 * Node size is the encoder's formula (splat_encode.rs:480-491):
 * 2 · expansion(α) · avgScale. Paged index packing is the spike's:
 * `pagedIndex = slot << 16 | local`, so pageSize is 65536.
 *
 * three.js-free: plain typed arrays in, selection flags out. No `Set` /
 * `Map` in the traversal hot path — flat flags like the spike.
 */
import { SplatBackendError } from "./SplatBackend.js";

/** Paged index packs local into 16 bits (`slot << 16 | local`). */
const PAGE_SIZE = 65536;

/** What the traversal needs from residency (implemented by the backend over PagePool). */
export interface ResidencyView {
  readonly pageCount: number;
  readonly chunkCount: number;
  /** -1 when not resident. */
  slotOf(chunk: number): number;
}

export interface CameraParams {
  /** Camera origin in mesh-object space. */
  origin: [number, number, number];
  /** Normalized view forward in mesh-object space. */
  forward: [number, number, number];
  /** 2·tan(fovY/2)/renderHeightPx · lodRenderScale — world units per pixel at distance 1 (Spark SparkRenderer.ts driveLod). */
  pixelScaleLimit: number;
}

/** Owner ruling 07-S3/S4: Spark's defaults as STARTING values (ADR 0003 consequence); mobile classes unpinned. */
export interface LodTuning {
  maxSplats: number;
  lodScale: number;
  behindFoveate: number;
  coneFov0Deg: number;
  coneFovDeg: number;
  coneFoveate: number;
}

export const DEFAULT_LOD_TUNING: Readonly<LodTuning> = {
  maxSplats: 2_500_000,
  lodScale: 1.0,
  behindFoveate: 0.2,
  coneFov0Deg: 90,
  coneFovDeg: 120,
  coneFoveate: 0.4,
};

/** The decoded page subset the traversal keeps per slot. */
export interface LodPage {
  readonly count: number;
  readonly center: Float32Array;
  readonly scale: Float32Array;
  readonly alpha: Float32Array;
  readonly childCount: Uint16Array;
  readonly childStart: Uint32Array;
}

export interface TraverseResult {
  /** Per paged index (slot·pageSize + local): 1 = selected. Owned by the traversal; valid until the next traverse. */
  selected: Uint8Array;
  selectedCount: number;
  /** Slots whose selection flags changed since the previous traverse (the pages the mesh must rewrite). */
  changedSlots: number[];
  /** Chunks the traversal wanted, in PRIORITY order (heap pops best-first; append order IS priority) — the ChunkPriority swap point. */
  wantedChunks: number[];
  /** True when no wanted chunk was missing — full LOD quality at this pose. */
  fullQuality: boolean;
  /** Interior nodes expanded / leaves emitted / heap pushes — evidence counters. */
  stats: { expanded: number; leaves: number; heapPushes: number; heapMax: number };
}

interface PageData {
  count: number;
  center: Float32Array;
  size: Float32Array;
  childCount: Uint16Array;
  childStart: Uint32Array;
  /** Largest linear scale component in the page — the culling margin
   *  (splat footprints extend past their centers). */
  maxScale: number;
}

interface SelectionBuffer {
  flags: Uint8Array;
  written: Uint8Array;
}

/** `slot << 16 | local` is a SIGNED 32-bit shift in JS: slots ≥ 32768 would
 *  produce negative typed-array indices (adversarial review, 2026-09-12).
 *  32767 pages × 65536 splats is 2^31 splats — far beyond any device limit
 *  the capacity guard admits — so this is a refusal, not a design limit. */
const MAX_PAGE_COUNT = 0x7fff;

function requirePageSize(pageSize: number): void {
  if (!Number.isInteger(pageSize) || pageSize !== PAGE_SIZE) {
    throw new SplatBackendError(
      "lod-page-size",
      `pageSize must be ${PAGE_SIZE} (paged index packs local into 16 bits), got ${pageSize}`,
    );
  }
}

function requireTuning(tuning: LodTuning): void {
  if (!Number.isInteger(tuning.maxSplats) || tuning.maxSplats < 1) {
    throw new SplatBackendError(
      "lod-tuning",
      `maxSplats must be a positive integer, got ${tuning.maxSplats}`,
    );
  }
  if (!(tuning.lodScale > 0)) {
    throw new SplatBackendError(
      "lod-tuning",
      `lodScale must be > 0, got ${tuning.lodScale}`,
    );
  }
  if (!(tuning.behindFoveate >= 0 && tuning.behindFoveate <= 1)) {
    throw new SplatBackendError(
      "lod-tuning",
      `behindFoveate must be in [0, 1], got ${tuning.behindFoveate}`,
    );
  }
  if (!(tuning.coneFoveate >= 0 && tuning.coneFoveate <= 1)) {
    throw new SplatBackendError(
      "lod-tuning",
      `coneFoveate must be in [0, 1], got ${tuning.coneFoveate}`,
    );
  }
  if (!(tuning.coneFov0Deg > 0 && tuning.coneFov0Deg <= 180)) {
    throw new SplatBackendError(
      "lod-tuning",
      `coneFov0Deg must be in (0, 180], got ${tuning.coneFov0Deg}`,
    );
  }
  if (!(tuning.coneFovDeg > 0 && tuning.coneFovDeg <= 180)) {
    throw new SplatBackendError(
      "lod-tuning",
      `coneFovDeg must be in (0, 180], got ${tuning.coneFovDeg}`,
    );
  }
}

function mergeTuning(tuning?: Partial<LodTuning>): LodTuning {
  return {
    maxSplats: tuning?.maxSplats ?? DEFAULT_LOD_TUNING.maxSplats,
    lodScale: tuning?.lodScale ?? DEFAULT_LOD_TUNING.lodScale,
    behindFoveate: tuning?.behindFoveate ?? DEFAULT_LOD_TUNING.behindFoveate,
    coneFov0Deg: tuning?.coneFov0Deg ?? DEFAULT_LOD_TUNING.coneFov0Deg,
    coneFovDeg: tuning?.coneFovDeg ?? DEFAULT_LOD_TUNING.coneFovDeg,
    coneFoveate: tuning?.coneFoveate ?? DEFAULT_LOD_TUNING.coneFoveate,
  };
}

export class LodTraversal {
  readonly pageSize: number;
  readonly pageCount: number;
  readonly capacity: number;
  readonly tuning: LodTuning;

  private readonly residency: ResidencyView;
  private readonly chunkCount: number;
  private readonly pages: PageData[] = [];
  private readonly touchedFlags: Uint8Array;

  private selA: SelectionBuffer;
  private selB: SelectionBuffer;

  private heapScore = new Float32Array(1024);
  private heapIndex = new Uint32Array(1024);
  private heapSize = 0;

  constructor(residency: ResidencyView, pageSize: number, tuning?: Partial<LodTuning>) {
    requirePageSize(pageSize);
    const merged = mergeTuning(tuning);
    requireTuning(merged);

    if (!Number.isInteger(residency.pageCount) || residency.pageCount < 1 || residency.pageCount > MAX_PAGE_COUNT) {
      throw new SplatBackendError(
        "lod-page-count",
        `pageCount must be in 1..${MAX_PAGE_COUNT} (paged index packs the slot into the upper 15 bits), got ${residency.pageCount}`,
      );
    }
    this.residency = residency;
    this.pageSize = pageSize;
    this.pageCount = residency.pageCount;
    this.chunkCount = residency.chunkCount;
    this.capacity = this.pageCount * pageSize;
    this.tuning = merged;

    this.selA = {
      flags: new Uint8Array(this.capacity),
      written: new Uint8Array(this.pageCount),
    };
    this.selB = {
      flags: new Uint8Array(this.capacity),
      written: new Uint8Array(this.pageCount),
    };
    this.touchedFlags = new Uint8Array(this.chunkCount);

    for (let i = 0; i < this.pageCount; i++) {
      this.pages.push({
        count: 0,
        center: new Float32Array(pageSize * 3),
        size: new Float32Array(pageSize),
        childCount: new Uint16Array(pageSize),
        childStart: new Uint32Array(pageSize),
        maxScale: 0,
      });
    }
  }

  /** Largest linear splat scale over the RESIDENT pages (0 when empty). */
  maxResidentScale(): number {
    let max = 0;
    for (let slot = 0; slot < this.pageCount; slot++) {
      const page = this.pages[slot];
      if (page.count > 0 && page.maxScale > max) max = page.maxScale;
    }
    return max;
  }

  /**
   * Store a decoded page in `slot` and precompute Spark's node size
   * (splat_encode.rs:480-491). Invalidates the slot's previous-selection
   * baseline so the next traverse reports it in changedSlots whenever its
   * new selection is non-empty (the GPU page was rewritten with w = 0 by
   * the upload).
   */
  setPage(slot: number, page: LodPage): void {
    const dest = this.pages[slot];
    dest.count = page.count;
    dest.center.fill(0);
    dest.center.set(page.center);
    dest.childCount.fill(0);
    dest.childCount.set(page.childCount);
    dest.childStart.fill(0);
    dest.childStart.set(page.childStart);

    const size = dest.size;
    size.fill(0);
    const { scale, alpha, count } = page;
    let maxScale = 0;
    for (let i = 0; i < count; i++) {
      const sx = scale[i * 3];
      const sy = scale[i * 3 + 1];
      const sz = scale[i * 3 + 2];
      if (sx > maxScale) maxScale = sx;
      if (sy > maxScale) maxScale = sy;
      if (sz > maxScale) maxScale = sz;
      const avg = (sx + sy + sz) / 3;
      const a = alpha[i];
      const expansion = a <= 1 ? 1 : 1 + 0.7 * (a * 4 - 3 - 1);
      size[i] = 2 * expansion * avg;
    }
    dest.maxScale = maxScale;

    this.invalidateSlot(slot);
  }

  /** Free a slot (evicted): zero its data, invalidate its baseline. */
  clearPage(slot: number): void {
    const dest = this.pages[slot];
    dest.count = 0;
    dest.center.fill(0);
    dest.size.fill(0);
    dest.childCount.fill(0);
    dest.childStart.fill(0);
    dest.maxScale = 0;
    this.invalidateSlot(slot);
  }

  /**
   * Spark's frontier traversal (concept reference: spark-worker-rs
   * lod_tree.rs traverse_lod_trees; the spike's port). Root = splat 0 of
   * chunk 0 (lod_tree.rs:466-470). A node renders iff it is a leaf
   * (childCount 0), OR its children's chunk(s) are not resident (coarse
   * proxy; fullQuality = false), OR its projected size ≤ limit, OR the
   * splat budget / loop end left it in the frontier.
   *
   * If chunk 0 is not resident: nothing selected, fullQuality false,
   * wantedChunks = [0].
   */
  traverse(cam: CameraParams): TraverseResult {
    const prevSel = this.selA;
    const nextSel = this.selB;
    this.selA = nextSel;
    this.selB = prevSel;
    for (let slot = 0; slot < this.pageCount; slot++) {
      if (nextSel.written[slot]) nextSel.flags.fill(0, slot * PAGE_SIZE, (slot + 1) * PAGE_SIZE);
    }
    nextSel.written.fill(0);
    const prev = prevSel.flags;
    const next = nextSel.flags;
    const nextWritten = nextSel.written;

    const touchedList: number[] = [];
    const touchedFlags = this.touchedFlags;
    touchedFlags.fill(0);
    const touch = (c: number): void => {
      if (touchedFlags[c] === 0) {
        touchedFlags[c] = 1;
        touchedList.push(c);
      }
    };

    const [ox, oy, oz] = cam.origin;
    const [fx, fy, fz] = cam.forward;
    const limit = cam.pixelScaleLimit;
    const lodScale = this.tuning.lodScale;
    const behindFoveate = this.tuning.behindFoveate;
    const coneFoveate = this.tuning.coneFoveate;
    const coneDot0 = Math.cos(0.5 * this.tuning.coneFov0Deg * (Math.PI / 180));
    const coneDot = Math.min(Math.cos(0.5 * this.tuning.coneFovDeg * (Math.PI / 180)), coneDot0);

    const pixelScale = (page: PageData, local: number): number => {
      const dx = page.center[local * 3] - ox;
      const dy = page.center[local * 3 + 1] - oy;
      const dz = page.center[local * 3 + 2] - oz;
      const distance = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 1e-6);
      const invDistance = 1 / distance;
      const base = page.size[local] * invDistance * lodScale;
      // Spark's default foveation (lod_tree.rs:601-628 · SparkRenderer defaults).
      const forwardDot = dx * fx + dy * fy + dz * fz;
      let foveate: number;
      if (forwardDot <= 0) {
        foveate = behindFoveate;
      } else {
        const dot = forwardDot * invDistance;
        if (dot >= coneDot0) {
          foveate = 1;
        } else if (dot >= coneDot) {
          const t = (dot - coneDot) / (coneDot0 - coneDot);
          foveate = coneFoveate + (1 - coneFoveate) * t;
        } else {
          const t = dot / coneDot;
          foveate = behindFoveate + (coneFoveate - behindFoveate) * t;
        }
      }
      return foveate * base;
    };

    this.heapSize = 0;
    let selectedCount = 0;
    let numSplats = 0;
    let fullQuality = true;
    let expanded = 0;
    let leaves = 0;
    let heapPushes = 0;
    let heapMax = 0;

    const push = (score: number, index: number): void => {
      this.heapPush(score, index);
      heapPushes++;
      if (this.heapSize > heapMax) heapMax = this.heapSize;
    };

    touch(0);
    const rootPage = this.residency.slotOf(0);
    if (rootPage !== -1) {
      push(pixelScale(this.pages[rootPage], 0), rootPage << 16);
      numSplats = 1;
    } else {
      fullQuality = false;
    }

    const maxSplats = this.tuning.maxSplats;
    while (this.heapSize > 0) {
      const score = this.heapScore[0];
      if (score <= limit) break;
      const pagedIndex = this.heapIndex[0];

      const page = this.pages[pagedIndex >>> 16];
      const local = pagedIndex & 0xffff;
      const childCount = page.childCount[local];
      const childStart = page.childStart[local];

      if (childCount === 0) {
        this.heapPop();
        next[pagedIndex] = 1;
        nextWritten[pagedIndex >>> 16] = 1;
        selectedCount++;
        leaves++;
        continue;
      }

      const newNumSplats = numSplats - 1 + childCount;
      if (newNumSplats > maxSplats) break;

      this.heapPop();

      // childStart indexes the GLOBAL splat array; children are contiguous and
      // span at most two chunks (childCount ≤ 65,535).
      const firstChunk = childStart >>> 16;
      const lastChunk = (childStart + childCount - 1) >>> 16;
      touch(firstChunk);
      if (lastChunk !== firstChunk) touch(lastChunk);

      if (lastChunk >= this.chunkCount) {
        // Malformed pointer past the file — render the proxy (Spark tolerates this identically).
        next[pagedIndex] = 1;
        nextWritten[pagedIndex >>> 16] = 1;
        selectedCount++;
        continue;
      }
      const firstPage = this.residency.slotOf(firstChunk);
      const lastPage = this.residency.slotOf(lastChunk);
      if (firstPage === -1 || lastPage === -1) {
        // Children not resident yet — this node stands in as the coarse proxy.
        next[pagedIndex] = 1;
        nextWritten[pagedIndex >>> 16] = 1;
        selectedCount++;
        fullQuality = false;
        continue;
      }

      expanded++;
      for (let child = childStart; child < childStart + childCount; child++) {
        const childSlot = this.residency.slotOf(child >>> 16);
        const childLocal = child & 0xffff;
        const childPaged = (childSlot << 16) | childLocal;
        // Leaves never expand, so they never need heap ordering — every heap
        // entry is eventually rendered either way. Emitting them directly cuts
        // heap traffic ~7× (851K → interior-only pushes at the test pose).
        if (this.pages[childSlot].childCount[childLocal] === 0) {
          next[childPaged] = 1;
          nextWritten[childSlot] = 1;
          selectedCount++;
          leaves++;
          continue;
        }
        const childScore = pixelScale(this.pages[childSlot], childLocal);
        if (childScore <= limit) {
          next[childPaged] = 1;
          nextWritten[childSlot] = 1;
          selectedCount++;
        } else {
          push(childScore, childPaged);
        }
      }
      numSplats = newNumSplats;
    }

    // Budget/limit reached: everything still in the frontier renders as-is.
    for (let h = 0; h < this.heapSize; h++) {
      next[this.heapIndex[h]] = 1;
      nextWritten[this.heapIndex[h] >>> 16] = 1;
      selectedCount++;
    }
    this.heapSize = 0;

    const changedSlots: number[] = [];
    for (let slot = 0; slot < this.pageCount; slot++) {
      if (!prevSel.written[slot] && !nextWritten[slot]) continue;
      const base = slot * PAGE_SIZE;
      for (let i = 0; i < PAGE_SIZE; i++) {
        if (next[base + i] !== prev[base + i]) {
          changedSlots.push(slot);
          break;
        }
      }
    }

    return {
      selected: next,
      selectedCount,
      changedSlots,
      wantedChunks: touchedList,
      fullQuality,
      stats: { expanded, leaves, heapPushes, heapMax },
    };
  }

  /** Forget the previous selection of EVERY slot: the next traverse reports
   *  all occupied slots in changedSlots. Required after anything else wrote
   *  the GPU selection lanes behind the traversal's back (the backend's
   *  selection-off path writes every resident row to 1 — without this the
   *  next traversal rewrote only the slots IT thought changed and stale
   *  1-lanes stayed in the draw; caught live 2026-09-12). */
  invalidateAll(): void {
    for (let slot = 0; slot < this.pageCount; slot++) this.invalidateSlot(slot);
  }

  /** The GPU lanes now hold "every occupied row selected" (the backend's
   *  selection-off path): set the baseline to exactly that, so the next
   *  traverse reports every slot whose frontier selection differs —
   *  including slots that end up WHOLLY deselected (a zeroed baseline
   *  would call those unchanged and leave their lanes at 1; adversarial
   *  review, 2026-09-12). */
  assumeAllSelected(): void {
    for (let slot = 0; slot < this.pageCount; slot++) {
      const base = slot * this.pageSize;
      const count = this.pages[slot].count;
      this.selA.flags.fill(1, base, base + count);
      this.selA.flags.fill(0, base + count, base + this.pageSize);
      this.selA.written[slot] = 1;
    }
  }

  /** Selection flags for one slot (subarray view of the current buffer). */
  selectionOf(slot: number): Uint8Array {
    const base = slot * this.pageSize;
    return this.selA.flags.subarray(base, base + this.pageSize);
  }

  private invalidateSlot(slot: number): void {
    const base = slot * this.pageSize;
    this.selA.flags.fill(0, base, base + this.pageSize);
    this.selA.written[slot] = 1;
  }

  private heapPush(score: number, index: number): void {
    if (this.heapSize === this.heapScore.length) {
      const s = new Float32Array(this.heapScore.length * 2);
      const x = new Uint32Array(this.heapIndex.length * 2);
      s.set(this.heapScore);
      x.set(this.heapIndex);
      this.heapScore = s;
      this.heapIndex = x;
    }
    let i = this.heapSize++;
    this.heapScore[i] = score;
    this.heapIndex[i] = index;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heapScore[parent] >= this.heapScore[i]) break;
      this.heapSwap(i, parent);
      i = parent;
    }
  }

  private heapPop(): void {
    const last = --this.heapSize;
    this.heapScore[0] = this.heapScore[last];
    this.heapIndex[0] = this.heapIndex[last];
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let largest = i;
      if (l < last && this.heapScore[l] > this.heapScore[largest]) largest = l;
      if (r < last && this.heapScore[r] > this.heapScore[largest]) largest = r;
      if (largest === i) break;
      this.heapSwap(i, largest);
      i = largest;
    }
  }

  private heapSwap(a: number, b: number): void {
    const s = this.heapScore[a];
    this.heapScore[a] = this.heapScore[b];
    this.heapScore[b] = s;
    const x = this.heapIndex[a];
    this.heapIndex[a] = this.heapIndex[b];
    this.heapIndex[b] = x;
  }
}
