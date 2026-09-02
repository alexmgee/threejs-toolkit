/**
 * Evidence helpers for examples/rad-lab — FNV-1a checksums copied from
 * examples/decode-lab/main.ts, plus a sweep-line over decode-job busy windows.
 */

export function fnv1a(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function sumView(view: ArrayBufferView): string {
  return fnv1a(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
}

/** SHA-256 hex of a typed-array view — the determinism AC's checksum.
 *  32-bit FNV-1a stays for the decode-lab golden pin only: it is
 *  collision-prone (adversarial review, 2026-09-02) and must not be the
 *  sole proof that 122 x 9 arrays are identical across pool sizes. */
export async function sha256View(view: ArrayBufferView): Promise<string> {
  // Copy into a plain ArrayBuffer: TS 5.7 types typed arrays over
  // ArrayBufferLike (SharedArrayBuffer-capable), which BufferSource rejects.
  const bytes = new Uint8Array(view.byteLength);
  bytes.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface BusyWindow {
  dispatchedAt: number;
  completedAt: number;
}

/** Sweep-line: maximum number of windows overlapping any instant.
 *  Half-open [dispatchedAt, completedAt): at equal timestamps process
 *  ends before starts. Empty input → 0. */
export function maxConcurrentBusy(windows: readonly BusyWindow[]): number {
  if (windows.length === 0) {
    return 0;
  }
  const events: { t: number; d: number }[] = [];
  for (const w of windows) {
    events.push({ t: w.dispatchedAt, d: 1 });
    events.push({ t: w.completedAt, d: -1 });
  }
  events.sort((a, b) => (a.t !== b.t ? a.t - b.t : a.d - b.d));
  let current = 0;
  let max = 0;
  for (const event of events) {
    current += event.d;
    if (current > max) {
      max = current;
    }
  }
  return max;
}

/** Sweep-line: total time covered by the UNION of the windows. Aggregate
 *  window duration exceeds this only when windows overlap — the
 *  parallelism proof that does not depend on the fetch-bound phase span. */
export function unionBusyMs(windows: readonly BusyWindow[]): number {
  const events: { t: number; d: number }[] = [];
  for (const w of windows) {
    events.push({ t: w.dispatchedAt, d: 1 });
    events.push({ t: w.completedAt, d: -1 });
  }
  events.sort((a, b) => (a.t !== b.t ? a.t - b.t : a.d - b.d));
  let current = 0;
  let covered = 0;
  let openedAt = 0;
  for (const event of events) {
    if (current === 0 && event.d === 1) openedAt = event.t;
    current += event.d;
    if (current === 0) covered += event.t - openedAt;
  }
  return covered;
}

export function sumBusyMs(windows: readonly BusyWindow[]): number {
  let sum = 0;
  for (const w of windows) sum += w.completedAt - w.dispatchedAt;
  return sum;
}

export function evidenceSelfCheck(): string | null {
  const overlap = maxConcurrentBusy([
    { dispatchedAt: 0, completedAt: 10 },
    { dispatchedAt: 5, completedAt: 15 },
    { dispatchedAt: 9, completedAt: 12 },
    { dispatchedAt: 15, completedAt: 20 },
  ]);
  const adjacent = maxConcurrentBusy([
    { dispatchedAt: 0, completedAt: 5 },
    { dispatchedAt: 5, completedAt: 10 },
  ]);
  // Union of [0,10),[5,15),[9,12),[15,20) = [0,20) = 20; sum = 10+10+3+5 = 28.
  const union = unionBusyMs([
    { dispatchedAt: 0, completedAt: 10 },
    { dispatchedAt: 5, completedAt: 15 },
    { dispatchedAt: 9, completedAt: 12 },
    { dispatchedAt: 15, completedAt: 20 },
  ]);
  const gapped = unionBusyMs([
    { dispatchedAt: 0, completedAt: 5 },
    { dispatchedAt: 10, completedAt: 12 },
  ]);
  if (overlap === 3 && adjacent === 1 && union === 20 && gapped === 7) {
    return null;
  }
  return `evidence self-check failed: overlap=${overlap} (want 3), adjacent=${adjacent} (want 1), union=${union} (want 20), gapped=${gapped} (want 7)`;
}
