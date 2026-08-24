/**
 * Decode Lab — promoted WASM decode worker runtime proof (Phase 2 ticket 02).
 *
 * Range-fetches chunk 0 of the golden asset (the same chunk the crate's
 * decodes_hero_chunk0 test anchors on), decodes it in the promoted worker
 * (src/backend/rad-worker.ts), and prints FNV-1a checksums of every output
 * array — including the ticket's packed-SH gap: `sh1Words` arrives as u32
 * words packed in Rust, never in JS.
 *
 * The asset stays in read-only sparkjs-toolkit and is served through vite's
 * /@fs escape hatch (spike pattern); fetches are Range-only — the 213 MB file
 * must never be downloaded whole.
 *
 * DEV hook: window.__decodeLab { done } — await done for {passed, failed}.
 */

import type { DecodeResult } from "@toolkit/backend/rad-worker";

const ASSET = "/@fs/D:/Projects/sparkjs-toolkit/examples/assets/lab-sh1-sparsity.rad";

const out = document.getElementById("out")!;
let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, detail: string): void {
  const div = document.createElement("div");
  div.className = `assertion ${condition ? "pass" : "fail"}`;
  div.textContent = `${condition ? "PASS" : "FAIL"} — ${name}: ${detail}`;
  out.appendChild(div);
  console.log(`decode-lab ${condition ? "PASS" : "FAIL"} ${name} — ${detail}`);
  condition ? passed++ : failed++;
}

async function fetchRange(from: number, to: number): Promise<ArrayBuffer> {
  const res = await fetch(ASSET, { headers: { Range: `bytes=${from}-${to}` } });
  if (res.status !== 206) throw new Error(`expected 206 for bytes=${from}-${to}, got ${res.status}`);
  return res.arrayBuffer();
}

function fnv1a(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const sum = (view: ArrayBufferView): string =>
  fnv1a(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));

const roundup8 = (n: number): number => Math.ceil(n / 8) * 8;

const done = (async () => {
  // Container: magic (4) + headerLength u32le (4) + JSON header + chunks.
  const head = new DataView(await fetchRange(0, 7));
  const headerLength = head.getUint32(4, true);
  const meta = JSON.parse(
    new TextDecoder().decode(await fetchRange(8, 8 + headerLength - 1)),
  ) as { chunks: { offset: number; bytes: number }[] };
  const chunksStart = 8 + roundup8(headerLength);
  const c0 = meta.chunks[0];
  const chunk = await fetchRange(chunksStart + c0.offset, chunksStart + c0.offset + c0.bytes - 1);
  assert("range-fetch", chunk.byteLength === c0.bytes, `chunk 0: ${chunk.byteLength} bytes via Range (206s only)`);

  const worker = new Worker(new URL("@toolkit/backend/rad-worker.ts", import.meta.url), { type: "module" });
  const result = await new Promise<DecodeResult>((resolvePromise, reject) => {
    worker.onmessage = (ev: MessageEvent<DecodeResult & { error?: string }>) =>
      ev.data.error ? reject(new Error(ev.data.error)) : resolvePromise(ev.data);
    worker.onerror = (e) => reject(new Error(`worker error: ${e.message}`));
    worker.postMessage({ index: 0, bytes: chunk }, [chunk]);
  });

  assert(
    "decode-shape",
    result.count === 65536 &&
      result.base === 0 &&
      result.center.length === result.count * 3 &&
      result.covariance.length === result.count * 6,
    `count=${result.count} base=${result.base} decodeMs=${result.decodeMs.toFixed(1)}`,
  );

  // The packed-SH gap closed: words come from the worker, 3 per splat.
  assert(
    "sh1-packed-by-worker",
    result.sh1Words instanceof Uint32Array && result.sh1Words.length === result.count * 3,
    `sh1Words: ${result.sh1Words.length} u32 (${result.sh1Words.length / result.count} words/splat)`,
  );

  // Pinned expected checksums for the golden chunk (the same chunk the crate's
  // decodes_hero_chunk0 anchors): machine-checked, not compared by eye across
  // logs (adversarial review, 2026-08-23). Re-pin only on a DELIBERATE decoder
  // change, with the change named in the ticket that moves them.
  const EXPECTED: Record<string, string> = {
    center: "9f411115",
    covariance: "c35b272a",
    color: "21867ad1",
    sh1Words: "50b88b76",
    alpha: "bf16b679",
    scale: "9cea90d3",
    quat: "d7c2391c",
    childCount: "89e7d9c2",
    childStart: "a2362cb7",
  };
  const sums = {
    center: sum(result.center),
    covariance: sum(result.covariance),
    color: sum(result.color),
    sh1Words: sum(result.sh1Words),
    alpha: sum(result.alpha),
    scale: sum(result.scale),
    quat: sum(result.quat),
    childCount: sum(result.childCount),
    childStart: sum(result.childStart),
  };
  for (const [name, value] of Object.entries(sums)) {
    console.log(`decode-lab CHECKSUM ${name} fnv1a=${value}`);
  }
  const mismatches = Object.entries(sums).filter(([name, v]) => v !== EXPECTED[name]);
  assert(
    "checksums-match-golden",
    mismatches.length === 0,
    mismatches.length === 0
      ? `all 9 arrays match pinned golden checksums (center=${sums.center}, sh1Words=${sums.sh1Words})`
      : mismatches.map(([name, v]) => `${name}=${v} (want ${EXPECTED[name]})`).join("; "),
  );

  worker.terminate();
  const heading = document.createElement("h2");
  heading.className = failed === 0 ? "pass" : "fail";
  heading.textContent = `decode-lab: ${passed} passed, ${failed} failed`;
  out.appendChild(heading);
  console.log(`decode-lab RESULT ${passed} passed, ${failed} failed`);
  return { passed, failed };
})();

done.catch((err) => {
  const div = document.createElement("div");
  div.className = "assertion fail";
  div.textContent = `DECODE-LAB RUNNER FAILED: ${err}`;
  out.appendChild(div);
  console.log(`decode-lab RUNNER FAILED: ${err}`);
});

declare global {
  interface Window {
    __decodeLab?: { done: Promise<{ passed: number; failed: number }> };
  }
}
window.__decodeLab = { done };
