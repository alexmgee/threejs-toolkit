/**
 * PagePool — GPU page residency (ticket 06). Promoted from
 * `spikes/native-rad/src/PagePool.ts` minus traversal, selection, heap, and
 * foveation (those belong to ticket 07).
 *
 * Budget is RUNTIME-DERIVED, not a constant (ADR 0003, accepted 2026-08-16):
 * the caller computes pages = min(P_limits, P_asset, override) from the
 * created device's real limits and the asset's chunk count, and passes
 * `pageCount` in. Page size is the asset's `chunkSize` (`options.pageSize`),
 * never a constant.
 *
 * ADR 0003 decision 3 — eviction is priority-protection: the top-`pages`
 * chunks of the priority order are shielded; residents outside that set
 * are evictable, oldest-touched first. Deadlock-free by construction: a
 * missing chunk ranked inside the top set implies some resident ranks
 * outside it.
 *
 * The ChunkPriority order is ticket 07's swap point (owner ruling S2,
 * 2026-09-03). Ticket 06 uses static index order via `indexOrder()`.
 *
 * This module is three.js-free: it consumes plain arrays and emits
 * residency.
 */
import { SplatBackendError } from "./SplatBackend.js";

/** Priority ORDER of wanted chunks — the swap point ticket 07's traversal
 *  implements (owner ruling S2). Ticket 06 uses static index order. */
export interface ChunkPriority {
  order(): readonly number[];
}

/** 0, 1, 2, …, chunkCount-1. */
export function indexOrder(chunkCount: number): ChunkPriority {
  const order: number[] = new Array(chunkCount);
  for (let i = 0; i < chunkCount; i++) order[i] = i;
  return {
    order(): readonly number[] {
      return order;
    },
  };
}

export interface PageBounds {
  readonly min: [number, number, number];
  readonly max: [number, number, number];
}

export interface PagePoolOptions {
  chunkCount: number;
  pageCount: number;
  pageSize: number;
  priority: ChunkPriority;
}

interface PageData {
  chunk: number; // -1 = free
  count: number;
  hasBounds: boolean;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

function requirePositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new SplatBackendError(
      "invalid-page-pool",
      `${name} must be a positive integer, got ${value}`,
    );
  }
}

export class PagePool {
  readonly chunkCount: number;
  readonly pageCount: number;
  readonly pageSize: number;
  readonly capacity: number;

  private readonly priority: ChunkPriority;
  private readonly chunkToPage: Int32Array;
  private readonly pages: PageData[] = [];
  private readonly lastTouched: Float64Array;
  private readonly everUploaded: Uint8Array;
  private readonly protectedFlags: Uint8Array;
  private everUploadedCount = 0;
  private tick = 0;

  constructor(options: PagePoolOptions) {
    requirePositiveInteger("chunkCount", options.chunkCount);
    requirePositiveInteger("pageCount", options.pageCount);
    requirePositiveInteger("pageSize", options.pageSize);

    this.chunkCount = options.chunkCount;
    this.pageCount = options.pageCount;
    this.pageSize = options.pageSize;
    this.capacity = options.pageCount * options.pageSize;
    this.priority = options.priority;

    this.chunkToPage = new Int32Array(options.chunkCount).fill(-1);
    this.lastTouched = new Float64Array(options.pageCount);
    this.everUploaded = new Uint8Array(options.chunkCount);
    this.protectedFlags = new Uint8Array(options.chunkCount);
    for (let i = 0; i < options.pageCount; i++) {
      this.pages.push({
        chunk: -1,
        count: 0,
        hasBounds: false,
        minX: 0,
        minY: 0,
        minZ: 0,
        maxX: 0,
        maxY: 0,
        maxZ: 0,
      });
    }
    this.refreshPriority();
  }

  /** Re-derive the protected set from the priority order: the first
   *  `pageCount` wanted chunks are protected (never evicted); everything
   *  else is evictable oldest-first. Call after order changes. */
  refreshPriority(): void {
    this.protectedFlags.fill(0);
    const order = this.priority.order();
    const n = Math.min(order.length, this.pageCount);
    for (let i = 0; i < n; i++) {
      const chunk = order[i];
      if (chunk >= 0 && chunk < this.chunkCount) this.protectedFlags[chunk] = 1;
    }
  }

  isResident(chunk: number): boolean {
    return this.slotOf(chunk) !== -1;
  }

  /** -1 when not resident. */
  slotOf(chunk: number): number {
    if (chunk < 0 || chunk >= this.chunkCount) return -1;
    return this.chunkToPage[chunk];
  }

  /** -1 when free. */
  chunkAt(slot: number): number {
    if (slot < 0 || slot >= this.pageCount) return -1;
    return this.pages[slot].chunk;
  }

  get residentPageCount(): number {
    return this.pageCount - this.freePageCount;
  }

  get freePageCount(): number {
    let n = 0;
    for (let p = 0; p < this.pageCount; p++) if (this.pages[p].chunk === -1) n++;
    return n;
  }

  /** Sum of resident pages' counts. */
  get residentSplatCount(): number {
    let n = 0;
    for (let p = 0; p < this.pageCount; p++) {
      if (this.pages[p].chunk !== -1) n += this.pages[p].count;
    }
    return n;
  }

  /** Protected AND not resident — the only chunks worth decoding. */
  admissibleMissing(): number[] {
    const out: number[] = [];
    const order = this.priority.order();
    for (let i = 0; i < order.length; i++) {
      const chunk = order[i];
      if (this.isAdmissible(chunk)) out.push(chunk);
    }
    return out;
  }

  isAdmissible(chunk: number): boolean {
    if (chunk < 0 || chunk >= this.chunkCount) return false;
    return this.protectedFlags[chunk] === 1 && this.chunkToPage[chunk] === -1;
  }

  /**
   * Take a slot for a decoded chunk: first free slot, else evict the
   * oldest-touched UNPROTECTED resident. Returns `{ slot, evicted }` —
   * evicted is the chunk that lost its slot or -1. Returns slot -1 (no
   * eviction) when every slot is protected and resident (the chunk
   * correctly waits). Records count, per-page AABB from `centers` (xyz
   * triples, first `count` splats — per-point, never 8-corner), touches
   * the slot, and counts a FIRST upload once per chunk (monotone).
   */
  insert(chunk: number, count: number, centers: Float32Array): { slot: number; evicted: number } {
    if (!Number.isInteger(chunk) || chunk < 0 || chunk >= this.chunkCount) {
      throw new SplatBackendError(
        "invalid-page-pool",
        `chunk ${chunk} is out of range for chunkCount ${this.chunkCount}`,
      );
    }
    if (!Number.isInteger(count) || count < 0 || count > this.pageSize) {
      throw new SplatBackendError(
        "invalid-page-pool",
        `count ${count} is out of range for pageSize ${this.pageSize}`,
      );
    }

    const existing = this.chunkToPage[chunk];
    if (existing !== -1) return { slot: existing, evicted: -1 };

    let slot = -1;
    let oldest = Infinity;
    for (let p = 0; p < this.pageCount; p++) {
      if (this.pages[p].chunk === -1) {
        slot = p;
        break;
      }
      // Eviction candidates: residents outside the protected (top-priority)
      // set, oldest first.
      if (this.protectedFlags[this.pages[p].chunk] === 0 && this.lastTouched[p] < oldest) {
        oldest = this.lastTouched[p];
        slot = p;
      }
    }
    if (slot === -1) return { slot: -1, evicted: -1 };

    const page = this.pages[slot];
    const evicted = page.chunk;
    if (evicted !== -1) this.chunkToPage[evicted] = -1;

    page.chunk = chunk;
    page.count = count;
    writePageBounds(page, count, centers);

    this.chunkToPage[chunk] = slot;
    this.lastTouched[slot] = ++this.tick;
    if (this.everUploaded[chunk] === 0) {
      this.everUploaded[chunk] = 1;
      this.everUploadedCount++;
    }

    return { slot, evicted };
  }

  /** Explicit eviction. Returns the freed slot or -1 if not resident. */
  evict(chunk: number): number {
    const slot = this.slotOf(chunk);
    if (slot === -1) return -1;
    this.chunkToPage[chunk] = -1;
    const page = this.pages[slot];
    page.chunk = -1;
    page.count = 0;
    page.hasBounds = false;
    return slot;
  }

  /** Ages the LRU clock for a resident chunk. No-op if not resident. */
  touch(chunk: number): void {
    const slot = this.slotOf(chunk);
    if (slot === -1) return;
    this.lastTouched[slot] = ++this.tick;
  }

  /** Chunks ever uploaded (first uploads), monotone — NEVER residency. */
  get firstUploadedCount(): number {
    return this.everUploadedCount;
  }

  /** Union AABB of the RESIDENT pages, or null when nothing is resident.
   *  Fresh object each call. */
  residentBounds(): PageBounds | null {
    let found = false;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let p = 0; p < this.pageCount; p++) {
      const page = this.pages[p];
      if (page.chunk === -1 || !page.hasBounds) continue;
      found = true;
      if (page.minX < minX) minX = page.minX;
      if (page.minY < minY) minY = page.minY;
      if (page.minZ < minZ) minZ = page.minZ;
      if (page.maxX > maxX) maxX = page.maxX;
      if (page.maxY > maxY) maxY = page.maxY;
      if (page.maxZ > maxZ) maxZ = page.maxZ;
    }
    if (!found) return null;
    return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
  }

  pageBounds(slot: number): PageBounds | null {
    if (slot < 0 || slot >= this.pageCount) return null;
    const page = this.pages[slot];
    if (page.chunk === -1 || !page.hasBounds) return null;
    return {
      min: [page.minX, page.minY, page.minZ],
      max: [page.maxX, page.maxY, page.maxZ],
    };
  }

  /** Splat count in the slot (0 when free). */
  pageCountAt(slot: number): number {
    if (slot < 0 || slot >= this.pageCount) return 0;
    return this.pages[slot].count;
  }
}

/** Per-point min/max over the first `count` xyz triples. */
function writePageBounds(page: PageData, count: number, centers: Float32Array): void {
  if (count <= 0) {
    page.hasBounds = false;
    return;
  }
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = centers[i * 3];
    const y = centers[i * 3 + 1];
    const z = centers[i * 3 + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  page.minX = minX;
  page.minY = minY;
  page.minZ = minZ;
  page.maxX = maxX;
  page.maxY = maxY;
  page.maxZ = maxZ;
  page.hasBounds = true;
}
