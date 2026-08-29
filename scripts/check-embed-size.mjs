// The embed artifact's contract is ticket 02's inline-decode-only bundle:
// 215,915 bytes as of 2026-08-29 (93.1 kB gzip). This tripwire exists because
// ticket 03's barrel change silently ballooned embed.js to 1,157,614 bytes and
// only a reviewer's habit caught it — no gate pinned the size. The 256 KiB
// bound leaves ~21% headroom for ordinary drift while failing loudly on any
// bundle-graph regression (the failure class is 5x, not 5%). Raising the bound
// requires an owner ruling recorded in the ticket that raises it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BOUND = 262144;
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
