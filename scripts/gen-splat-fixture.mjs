import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERTEX_COUNT = 48;
const FLOATS_PER_VERTEX = 14;
const SPACING = 0.15;
const GRID = 4;
const SH_C0 = 0.2820947917738781;
const LOG_SCALE = Math.log(0.25);
const LOGITS = [4.0, 2.0, 0.0, -2.0];

const CLUSTERS = [
  { cx: 0, cy: 0, cz: 0, r: 1, g: 0, b: 0 },
  { cx: -3, cy: 0, cz: 0, r: 0, g: 1, b: 0 },
  { cx: 3, cy: 0, cz: 0, r: 1, g: 1, b: 0 },
];

const HEADER = [
  'ply',
  'format binary_little_endian 1.0',
  `element vertex ${VERTEX_COUNT}`,
  'property float x',
  'property float y',
  'property float z',
  'property float scale_0',
  'property float scale_1',
  'property float scale_2',
  'property float rot_0',
  'property float rot_1',
  'property float rot_2',
  'property float rot_3',
  'property float f_dc_0',
  'property float f_dc_1',
  'property float f_dc_2',
  'property float opacity',
  'end_header',
].join('\n') + '\n';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'examples', 'assets', 'splat-lab', 'fixture.ply');

const headerBuf = Buffer.from(HEADER, 'utf8');
const binBuf = Buffer.alloc(VERTEX_COUNT * FLOATS_PER_VERTEX * 4);
let offset = 0;
function writeF(value) {
  binBuf.writeFloatLE(value, offset);
  offset += 4;
}

let minX = Infinity;
let maxX = -Infinity;
let minY = Infinity;
let maxY = -Infinity;
let minZ = Infinity;
let maxZ = -Infinity;

let i = 0;
for (const cluster of CLUSTERS) {
  const fDc0 = (cluster.r - 0.5) / SH_C0;
  const fDc1 = (cluster.g - 0.5) / SH_C0;
  const fDc2 = (cluster.b - 0.5) / SH_C0;
  for (let row = 0; row < GRID; row++) {
    const dy = (row - 1.5) * SPACING;
    for (let col = 0; col < GRID; col++) {
      const dx = (col - 1.5) * SPACING;
      const x = cluster.cx + dx;
      const y = cluster.cy + dy;
      const z = cluster.cz;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      writeF(x);
      writeF(y);
      writeF(z);
      writeF(LOG_SCALE);
      writeF(LOG_SCALE);
      writeF(LOG_SCALE);
      writeF(1);
      writeF(0);
      writeF(0);
      writeF(0);
      writeF(fDc0);
      writeF(fDc1);
      writeF(fDc2);
      writeF(LOGITS[i % 4]);
      i += 1;
    }
  }
}

const fileBuf = Buffer.concat([headerBuf, binBuf]);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, fileBuf);

const sha256 = createHash('sha256').update(fileBuf).digest('hex');
const sigmoid = (logit) => 1 / (1 + Math.exp(-logit));

console.log(`vertices ${VERTEX_COUNT}`);
console.log(`bytes ${fileBuf.length}`);
console.log(`sha256 ${sha256}`);
console.log(`bounds x ${minX} ${maxX}`);
console.log(`bounds y ${minY} ${maxY}`);
console.log(`bounds z ${minZ} ${maxZ}`);
for (const logit of LOGITS) {
  console.log(`sigmoid ${logit} ${sigmoid(logit)}`);
}
