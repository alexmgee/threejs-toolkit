/**
 * PagePool — GPU page residency + LOD frontier selection (task 4).
 *
 * Budget is RUNTIME-DERIVED, not a constant (ADR 0003, accepted 2026-08-16):
 * the caller computes pages = min(P_limits, P_asset, override) from the
 * created device's real limits and the asset's chunk count, and passes it in.
 * Contention policy: the top-`pages` chunks of the traversal's priority order are
 * protected; residents outside that set are evictable, oldest first. This is
 * deadlock-free — if a missing chunk ranks inside the top set, some resident must
 * rank outside it and is evictable.
 *
 * The traversal follows the shape of Spark's traverse_lod_trees
 * (spark-worker-rs/lod_tree.rs:412) — priority-queue descent with foveation
 * weighting — as concept reference, not as a parity target (metrics are absolute
 * baselines per the owner directive; Spark numbers are context only). Node "size"
 * is the encoder's formula (splat_encode.rs:480-491): 2·expansion(α)·avgScale.
 *
 * This module is three.js-free on purpose: it consumes plain arrays and camera
 * parameters and emits selection flags; main.ts glues it to the mesh fork.
 */
import type { RadHeaderInfo } from "./RadHeader.js";
import type { DecodeResult } from "./rad-worker.js";

// PAGE_SIZE is 1<<16, so a paged index (slot<<16 | local) IS the flat pool
// index (slot·PAGE_SIZE + local) — selection buffers are indexed directly.
export const PAGE_SIZE = 65536;

// Frame-budget + foveation defaults, borrowed from Spark as a starting concept
// (SparkRenderer.ts defaults); ours to retune against our own measurements.
const MAX_SPLATS = 2_500_000;
const LOD_SCALE = 1.0;
const BEHIND_FOVEATE = 0.2;
const CONE_FOV0_DEG = 90.0;
const CONE_FOV_DEG = 120.0;
const CONE_FOVEATE = 0.4;

export interface CameraParams {
  /** Camera origin in mesh-object space. */
  origin: [number, number, number];
  /** Normalized view forward in mesh-object space. */
  forward: [number, number, number];
  /** 2·tan(fovY/2)/renderHeightPx · lodRenderScale — world units per pixel at distance 1. */
  pixelScaleLimit: number;
}

export interface TraverseResult {
  /** Selected splats (paged index = slot·PAGE_SIZE + local). Owned by the pool; valid until next traverse. */
  selected: Uint8Array;
  selectedCount: number;
  /** Pool slots whose selection flags changed — the pages the mesh must re-upload. */
  changedSlots: number[];
  /** Chunks the traversal wanted (drives decode priority + eviction protection). */
  touchedChunks: number[];
  /** True when no wanted chunk was missing — the pose is rendered at full LOD quality. */
  fullQuality: boolean;
}

interface PageData {
  chunk: number; // -1 = free
  count: number;
  center: Float32Array; // PAGE_SIZE·3
  size: Float32Array; // PAGE_SIZE — Spark lod size, precomputed at insert
  childCount: Uint16Array;
  childStart: Uint32Array;
}

export class PagePool {
  readonly pageCount: number;
  readonly capacity: number;
  readonly chunkToPage: Int32Array;
  private readonly pages: PageData[] = [];
  private readonly lastTouched: Float64Array;
  private readonly everUploaded: Uint8Array;
  private everUploadedCount = 0;
  private tick = 0;
  /** Wanted chunks in traversal-priority order (heap pops best-first, so append order IS priority order). */
  private wantedOrdered: number[] = [];
  // Flat per-chunk flags instead of Sets: the traversal touches chunks ~1M
  // times per call at the test pose, and Set.add/.has dominated the profile.
  private readonly touchedFlags: Uint8Array;
  private readonly protectedFlags: Uint8Array;

  // Selection double-buffer so changed pages can be diffed cheaply. Each
  // buffer carries a per-slot written mask so clearing and diffing touch only
  // pages that actually held selection, not the full capacity.
  private selA: { flags: Uint8Array; written: Uint8Array };
  private selB: { flags: Uint8Array; written: Uint8Array };

  // Frontier max-heap (score, pagedIndex) in flat arrays.
  private heapScore = new Float32Array(1024);
  private heapIndex = new Uint32Array(1024);
  private heapSize = 0;

  constructor(private readonly header: RadHeaderInfo, pageCount: number) {
    if (header.chunkSize !== PAGE_SIZE) {
      throw new Error(`PagePool requires chunkSize ${PAGE_SIZE}, got ${header.chunkSize}`);
    }
    if (!header.lodTree) {
      throw new Error("PagePool requires a lodTree .rad (hero has one; anything else is outside spike scope)");
    }
    if (!Number.isInteger(pageCount) || pageCount < 1) {
      throw new Error(`invalid page budget ${pageCount}`);
    }
    this.pageCount = pageCount;
    this.capacity = pageCount * PAGE_SIZE;
    this.lastTouched = new Float64Array(pageCount);
    this.selA = { flags: new Uint8Array(this.capacity), written: new Uint8Array(pageCount) };
    this.selB = { flags: new Uint8Array(this.capacity), written: new Uint8Array(pageCount) };
    this.chunkToPage = new Int32Array(header.chunks.length).fill(-1);
    this.everUploaded = new Uint8Array(header.chunks.length);
    this.touchedFlags = new Uint8Array(header.chunks.length);
    this.protectedFlags = new Uint8Array(header.chunks.length);
    for (let i = 0; i < pageCount; i++) {
      this.pages.push({
        chunk: -1,
        count: 0,
        center: new Float32Array(PAGE_SIZE * 3),
        size: new Float32Array(PAGE_SIZE),
        childCount: new Uint16Array(PAGE_SIZE),
        childStart: new Uint32Array(PAGE_SIZE),
      });
    }
  }

  /**
   * Monotonic load progress (A5: completed work, never residency). Counts chunks
   * ever uploaded, so it still reaches 1.0 with a pool smaller than the asset —
   * that independence from residency is the point: eviction cannot walk it back.
   */
  get progress(): number {
    return this.everUploadedCount / this.header.chunks.length;
  }

  isResident(chunk: number): boolean {
    return this.chunkToPage[chunk] !== -1;
  }

  get freePageCount(): number {
    let n = 0;
    for (let p = 0; p < this.pageCount; p++) if (this.pages[p].chunk === -1) n++;
    return n;
  }

  get residentPageCount(): number {
    return this.pageCount - this.freePageCount;
  }

  /**
   * Missing chunks that insert() would actually admit (inside the protected
   * top-priority set). Decoding anything else is wasted work: it ranks below
   * every resident and would be refused.
   */
  admissibleMissing(): number[] {
    const out: number[] = [];
    for (const c of this.wantedOrdered) {
      if (this.chunkToPage[c] === -1 && this.protectedFlags[c] === 1) out.push(c);
    }
    return out;
  }

  /**
   * Take a page slot for a decoded chunk. Priority-protection policy: the
   * top-`pageCount` priority chunks are shielded; anything else is evictable,
   * oldest first. Returns -1 only when the incoming chunk ranks below every
   * resident (it correctly waits; the budget is never exceeded).
   */
  insert(result: DecodeResult): number {
    const chunk = Math.floor(result.base / PAGE_SIZE);
    if (result.base % PAGE_SIZE !== 0) {
      throw new Error(`chunk base ${result.base} not page-aligned`);
    }
    const existing = this.chunkToPage[chunk];
    if (existing !== -1) return existing;

    let slot = -1;
    let oldest = Infinity;
    for (let p = 0; p < this.pageCount; p++) {
      if (this.pages[p].chunk === -1) {
        slot = p;
        break;
      }
      // Eviction candidates: residents outside the protected (top-priority) set, oldest first.
      if (this.protectedFlags[this.pages[p].chunk] === 0 && this.lastTouched[p] < oldest) {
        oldest = this.lastTouched[p];
        slot = p;
      }
    }
    if (slot === -1) return -1;

    const page = this.pages[slot];
    if (page.chunk !== -1) this.chunkToPage[page.chunk] = -1; // evict
    page.chunk = chunk;
    page.count = result.count;
    page.center.fill(0);
    page.center.set(result.center);
    page.childCount.fill(0);
    page.childCount.set(result.childCount);
    page.childStart.fill(0);
    page.childStart.set(result.childStart);

    // Spark's lod size (splat_encode.rs:480-491): 2·expansion·avgScale, where
    // expansion inflates aggregate interior nodes whose lodOpacity alpha exceeds 1.
    const size = page.size;
    size.fill(0);
    const { scale, alpha, count } = result;
    for (let i = 0; i < count; i++) {
      const avg = (scale[i * 3] + scale[i * 3 + 1] + scale[i * 3 + 2]) / 3;
      const a = alpha[i];
      const expansion = a <= 1 ? 1 : 1 + 0.7 * (a * 4 - 3 - 1);
      size[i] = 2 * expansion * avg;
    }

    this.chunkToPage[chunk] = slot;
    this.lastTouched[slot] = ++this.tick;
    if (this.everUploaded[chunk] === 0) {
      this.everUploaded[chunk] = 1;
      this.everUploadedCount++;
    }

    // The mesh's uploadPage zeroes the page's GPU selection lanes; invalidate
    // this slot's CPU baseline to match, so the next traverse's diff reports the
    // slot whenever its new selection is non-empty — no side-channel "just
    // uploaded" bookkeeping needed in the caller.
    this.selA.flags.fill(0, slot * PAGE_SIZE, (slot + 1) * PAGE_SIZE);
    this.selA.written[slot] = 1; // force the diff to examine this slot

    return slot;
  }

  /**
   * Spark's frontier traversal on the paged store. Root = splat 0 (lod_tree.rs:466-470).
   * A node renders iff it is a leaf, its children's chunk(s) are not resident
   * (coarse proxy), its projected size is under the limit, or the splat budget /
   * loop end left it in the frontier.
   */
  traverse(cam: CameraParams): TraverseResult {
    this.tick++;
    const prevSel = this.selA;
    const nextSel = this.selB;
    this.selA = nextSel;
    this.selB = prevSel;
    // Clear only the pages that held selection two traversals ago.
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
    const touch = (c: number) => {
      if (touchedFlags[c] === 0) {
        touchedFlags[c] = 1;
        touchedList.push(c);
      }
    };
    const [ox, oy, oz] = cam.origin;
    const [fx, fy, fz] = cam.forward;
    const limit = cam.pixelScaleLimit;
    const coneDot0 = Math.cos(0.5 * CONE_FOV0_DEG * (Math.PI / 180));
    const coneDot = Math.min(Math.cos(0.5 * CONE_FOV_DEG * (Math.PI / 180)), coneDot0);

    const pixelScale = (page: PageData, local: number): number => {
      const dx = page.center[local * 3] - ox;
      const dy = page.center[local * 3 + 1] - oy;
      const dz = page.center[local * 3 + 2] - oz;
      const distance = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 1e-6);
      const invDistance = 1 / distance;
      const base = page.size[local] * invDistance * LOD_SCALE;
      // Spark's default foveation (lod_tree.rs:601-628 · SparkRenderer defaults).
      const forwardDot = dx * fx + dy * fy + dz * fz;
      let foveate: number;
      if (forwardDot <= 0) {
        foveate = BEHIND_FOVEATE;
      } else {
        const dot = forwardDot * invDistance;
        if (dot >= coneDot0) {
          foveate = 1;
        } else if (dot >= coneDot) {
          const t = (dot - coneDot) / (coneDot0 - coneDot);
          foveate = CONE_FOVEATE + (1 - CONE_FOVEATE) * t;
        } else {
          const t = dot / coneDot;
          foveate = BEHIND_FOVEATE + (CONE_FOVEATE - BEHIND_FOVEATE) * t;
        }
      }
      return foveate * base;
    };

    this.heapSize = 0;
    let selectedCount = 0;
    let numSplats = 0;
    let fullQuality = true;

    touch(0);
    const rootPage = this.chunkToPage[0];
    if (rootPage !== -1) {
      this.heapPush(pixelScale(this.pages[rootPage], 0), rootPage << 16);
      numSplats = 1;
    } else {
      fullQuality = false;
    }

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
        continue;
      }

      const newNumSplats = numSplats - 1 + childCount;
      if (newNumSplats > MAX_SPLATS) break;

      this.heapPop();

      // childStart indexes the GLOBAL splat array; children are contiguous and
      // span at most two chunks (childCount ≤ 65,535).
      const firstChunk = childStart >>> 16;
      const lastChunk = (childStart + childCount - 1) >>> 16;
      touch(firstChunk);
      if (lastChunk !== firstChunk) touch(lastChunk);

      if (lastChunk >= this.chunkToPage.length) {
        // Malformed pointer past the file — render the proxy (Spark tolerates this identically).
        next[pagedIndex] = 1;
        nextWritten[pagedIndex >>> 16] = 1;
        selectedCount++;
        continue;
      }
      const firstPage = this.chunkToPage[firstChunk];
      const lastPage = this.chunkToPage[lastChunk];
      if (firstPage === -1 || lastPage === -1) {
        // Children not resident yet — this node stands in as the coarse proxy.
        next[pagedIndex] = 1;
        nextWritten[pagedIndex >>> 16] = 1;
        selectedCount++;
        fullQuality = false;
        continue;
      }

      for (let child = childStart; child < childStart + childCount; child++) {
        const childSlot = this.chunkToPage[child >>> 16];
        const childLocal = child & 0xffff;
        const childPaged = (childSlot << 16) | childLocal;
        // Leaves never expand, so they never need heap ordering — every heap
        // entry is eventually rendered either way. Emitting them directly cuts
        // heap traffic ~7× (851K → interior-only pushes at the test pose).
        if (this.pages[childSlot].childCount[childLocal] === 0) {
          next[childPaged] = 1;
          nextWritten[childSlot] = 1;
          selectedCount++;
          continue;
        }
        const childScore = pixelScale(this.pages[childSlot], childLocal);
        if (childScore <= limit) {
          next[childPaged] = 1;
          nextWritten[childSlot] = 1;
          selectedCount++;
        } else {
          this.heapPush(childScore, childPaged);
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

    // Touch resident pages the traversal wanted (eviction ages by this tick).
    for (const c of touchedList) {
      const p = this.chunkToPage[c];
      if (p !== -1) this.lastTouched[p] = this.tick;
    }
    // Sets iterate in insertion order = traversal priority order (heap pops
    // best-first). Protect the top-pageCount; the rest are evictable.
    this.wantedOrdered = touchedList;
    this.protectedFlags.fill(0);
    for (let i = 0; i < touchedList.length && i < this.pageCount; i++) {
      this.protectedFlags[touchedList[i]] = 1;
    }

    // Diff only slots that hold selection in either buffer (or were force-marked
    // by insert()'s baseline invalidation) — everything else is all-zero in both.
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
      touchedChunks: touchedList,
      fullQuality,
    };
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
