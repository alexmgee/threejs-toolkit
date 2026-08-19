# .rad format contract — spike authority

Single source of truth for both implementations (TS `RadHeader.ts` + Rust `rad-three`).
Extracted 2026-08-15 from Spark's `spark-lib/src/rad.rs` (1,826 lines, MIT),
`splat_encode.rs`, `decoder.rs`, and **verified against the real hero**
`lab-sh1-sparsity.rad` (204 MB). File:line refs are into sparkjs-toolkit's
`reference/spark/rust/spark-lib/src/`.

All integers little-endian. `roundup8(n) = (n+7) & ~7`.

## Container layout (rad.rs:1361-1379, 1471-1502)

```
[0..4)   magic 'RAD0' = 0x30444152 (u32 LE)
[4..8)   headerLength = JSON byte length (u32 LE)
[8..8+headerLength)          header JSON (UTF-8)
chunksStart = 8 + roundup8(headerLength)     ← padded, NOT 8 + headerLength
[chunksStart..)              chunks, back to back
```

Chunk *file* offsets: header JSON `chunks[i].offset` is relative to `chunksStart`.
Absolute chunk i range = `[chunksStart + chunks[i].offset, +chunks[i].bytes)`.

## Header JSON (RadMeta, rad.rs:122-143)

```jsonc
{ "version": 1, "type": "gsplat", "count": <u64 total splats>,
  "maxSh": 0|1|2|3, "lodTree": true?, "chunkSize": 65536,
  "allChunkBytes": <u64>, "chunks": [{ "offset": u64, "bytes": u64,
      "base": usize?, "count": usize? }...],
  "splatEncoding": { /* SetSplatEncoding, all fields optional */ },
  "shCodeCount": u32?, "comment": string? }
```
Validate: version==1, type=="gsplat", chunks.length == ceil(count/chunkSize)
(rad.rs:1506-1521). `lodTree:true` additionally forces `lodOpacity:true` on the
receiver (rad.rs:1533-1538).

### SetSplatEncoding (decoder.rs:77-94; defaults decoder.rs:62-73)
`rgbMin=0, rgbMax=1, lnScaleMin=-12, lnScaleMax=9, sh1Max=1, sh2Max=1, sh3Max=1,
lodOpacity=false` — header values override per-field. NOTE: these encoding params are
defaults/overrides for *receivers*; the .rad chunk properties carry their own
min/max inline where the encoding needs one, and THOSE inline values are what the
property decoder uses (rad.rs:1644-1651 etc.). The hero's header sets only
`{"lodOpacity": true}`.

## Chunk layout (rad.rs:919-935, 1571-1601)

```
[0..4)   magic 'RADC' = 0x43444152
[4..8)   chunkMetaLength (u32 LE)
[8..8+len)                chunk meta JSON
metaEnd = 8 + roundup8(len)
[metaEnd..metaEnd+8)      payloadBytes (u64 LE)
payloadStart = metaEnd + 8
[payloadStart..)          properties, each padded to 8
```

Chunk meta JSON (RadChunkMeta, rad.rs:152-165): `version:1, base, count,
payloadBytes, maxSh?, lodTree?, splatEncoding?, properties:[...]`.
Each property (rad.rs:168-179): `{ offset, bytes, property, encoding,
compression?: "gz", min?, max? }` — `offset` is relative to payloadStart; property
data occupies `roundup8(bytes)` in the stream (rad.rs:1785-1786); `bytes` is the
COMPRESSED size when compression is present.

`compression:"gz"` = raw DEFLATE (miniz_oxide `decompress_to_vec`, rad.rs:1622 —
**no gzip header/trailer**; Rust: miniz_oxide; JS check: DecompressionStream
expects "deflate-raw").

## Property decode — transposed layout throughout

Every codec stores dimension-major ("transposed"): all dim-0 values for the whole
chunk, then all dim-1… Decoders therefore index `data[d*count + i]` (u8 codecs,
rad.rs:1082-1092) or equivalent stride patterns for f16/f32 (rad.rs:968-1002).
`f32_lebytes`/`f16_lebytes` additionally split by BYTE plane: byte-b of all values
grouped (rad.rs:1004-1054) — index `data[count*d + i + stride*b]`,
`stride = count*dims`.

| encoding | decode (per value) | ref |
|---|---|---|
| f32 | LE f32, transposed | :968 |
| f16 | LE half → f32, transposed | :992 |
| f32_lebytes | byte-planed transposed f32 | :1018 |
| f16_lebytes | byte-planed transposed f16 | :1044 |
| r8 | `(b/255)*(max-min)+min` | :1082 |
| s8 | `(i8/127)*max` | :1107 |
| r8_delta | per-dim running u8 sum (wrapping) then r8 map | :1134 |
| s8_delta | per-dim running u8 sum then s8 map | :1164 |
| ln_0r8 | `b==0 → 0`, else `exp(lnMin + (b-1)*(lnMax-lnMin)/254)` (splat_encode.rs:291-298) | :1191 |
| ln_f16 | `exp(f16)` | :1215 |
| oct88r8 | 3 bytes [u,v,r] → axis via octahedral unfold, `halfθ = r/255·π/2`, quat `[axis·sinθ/2, cosθ/2]` (splat_encode.rs:221-232) | :1236 |
| u16 / u32 | LE, transposed | :1257,:1294 |

Orientation non-oct encodings (f32/f16) store xyz; `w = sqrt(max(0, 1-x²-y²-z²))`
(rad.rs:1704-1710).

## Properties → receiver semantics (rad.rs:1629-1783)

| property | dims | notes |
|---|---|---|
| center | 3 | world position, f32 out |
| alpha | 1 | LINEAR opacity, already decoded (no sigmoid step in .rad — sigmoid lives in .ply/gsplat land). With `lodOpacity:true`, interior LOD nodes carry alpha **> 1.0** (why the hero uses f16: encoder picks f16 iff max_alpha>1, rad.rs:359-363) |
| rgb | 3 | color, may exceed [0,1] (SH DC range); r8_delta uses inline min/max |
| scales | 3 | LINEAR scale out — ln codecs already `exp()`; **never exp() again** |
| orientation | 4 out | quat xyzw |
| sh1/sh2/sh3 | 9/15/21 | SH coefficients f32 out; s8 uses inline `max` |
| sh1_code/…​ | 9/15/21 | clustered-SH codebook variant (hero doesn't use; skip in spike, error loudly) |
| sh_label | 1 | cluster label u16/u32 (skip in spike, error loudly) |
| child_count | 1 | u16 — LOD tree: number of children of this node |
| child_start | 1 | u32→usize — LOD tree: index of first child |

## LOD tree model

Splats double as tree nodes. `child_count`/`child_start` index into the SAME splat
array (children are contiguous). Interior nodes are renderable coarse proxies
(alpha aggregates >1 under lodOpacity). Traversal: start at roots, descend while a
node's projected size exceeds threshold, render the frontier. (Frontier selection
math is ours; the format only gives center/scales/alpha + child pointers. Spark's
selection heuristics live in Rust `spark-worker-rs/src/lod_tree.rs`
(`traverse_lod_trees`), not in TS `SplatPager.ts` — consult as concept
reference only; per ADR 0003 we do not target parity with them.)

## The hero file (ground truth, probed 2026-08-15)

`lab-sh1-sparsity.rad`: 213,727,632 bytes. headerLength 8120 → chunksStart 8128.
count 7,935,358 · maxSh 1 · lodTree true · chunkSize 65,536 · 122 chunks ·
allChunkBytes 213,719,504 (8128 + this = file size ✓). splatEncoding
`{lodOpacity:true}`. Chunk 0 (base 0, count 65,536, payloadBytes 1,805,048):

```
center      f32_lebytes  gz   547,010 B
alpha       f16          gz   109,554 B
rgb         r8_delta     gz   143,392 B   min -4.05788  max 3.72055
scales      ln_f16       gz   340,496 B
orientation oct88r8      gz   195,052 B
sh1         s8           gz   383,528 B   max 1.5051008
child_count u16          gz    20,082 B
child_start u32          gz    65,906 B
```

**Spike scope ruling:** implement exactly these eight encodings + the f32 fallbacks;
`sh*_code`/`sh_label`/`ln_0r8`/`r8`(non-delta)/`s8_delta`/f16_lebytes error loudly
with the encoding name. Last chunk has count 5,502 — never assume full chunks.

## Downstream conversion (for the three.js geometry contract)

quat+scale → covariance via upstream `GaussianSplatUtils.writeCovariance` semantics:
Σ = R·S·SᵀRᵀ, upper triangle (xx,xy,xz,yy,yz,zz). Alpha clamps to [0,1] at the
color-buffer write for leaf rendering; the pre-clamp value feeds LOD selection.
Preserve-at-decode (doc 03 §E): keep scale+quat arrays alongside covariance.
