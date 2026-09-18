// The embed artifact is the PRODUCT embed since ticket 09 switched the entry to
// src/embed/register.ts: 3,138,621 bytes when the bound was ruled, 2026-09-17
// (806,083 B gzip), built telemetry-in — the pin's default configuration,
// which is what this gate builds (3,016,389 B with TELEMETRY_MEASURE=off).
// The 3.75 MiB bound (15 x 256 KiB) leaves ~25% headroom, the original bound's
// proportion and binary-round convention; the owner's ruling and the baseline
// any future raise is measured against are recorded in ticket 09. This
// tripwire exists because ticket 03's barrel change silently ballooned the then
// decode-only embed.js (ticket 02's contract: 215,915 bytes, bound 256 KiB) to
// 1,157,614 bytes and only a reviewer's habit caught it — no gate pinned the
// size. Raising the bound requires an owner ruling recorded in the ticket that
// raises it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BOUND = 3932160;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifact = path.join(repoRoot, 'dist-embed', 'embed.js');

let size;
try {
  size = fs.statSync(artifact).size;
} catch (err) {
  if (err && err.code === 'ENOENT') {
    console.error(
      `embed-size: missing artifact ${artifact} — size tripwire cannot run (a missing artifact must fail the gate, never silently pass)`,
    );
    process.exit(1);
  }
  throw err;
}

if (size > BOUND) {
  console.error(`embed-size: ${artifact} is ${size} bytes, bound is ${BOUND}`);
  process.exit(1);
}

console.log(`embed-size OK: ${size} bytes (bound ${BOUND})`);
