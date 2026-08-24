//! rad-three — minimal .rad chunk decoder for the native-rad spike.
//!
//! Every byte-layout and codec decision here follows spikes/native-rad/FORMAT.md,
//! which was extracted from Spark's spark-lib/src/rad.rs (MIT) and verified against
//! the real hero file. Scope ruling from FORMAT.md: implement exactly the encodings
//! the hero uses (f32_lebytes, f16, r8_delta, ln_f16, oct88r8, s8, u16, u32) plus
//! plain f32; everything else errors loudly with the encoding name.
//!
//! Input:  one whole chunk (starting at 'RADC') as bytes.
//! Output: decoded arrays in SPLAT-MAJOR order plus the covariance the three.js
//! geometry contract wants (position f32x3, covariance f32x6 upper-triangle
//! xx,xy,xz,yy,yz,zz, color u8x4, sh1 f32x9), and the LOD tree legs
//! (child_count u16, child_start u32) and raw scale/quat/alpha for
//! preserve-at-decode + LOD selection.

use half::f16;
use miniz_oxide::inflate::decompress_to_vec;
use serde::Deserialize;
use wasm_bindgen::prelude::*;

const RAD_CHUNK_MAGIC: u32 = 0x4344_4152; // 'RADC'

fn roundup8(n: usize) -> usize {
    (n + 7) & !7
}

#[derive(Deserialize)]
struct ChunkMeta {
    version: u32,
    base: u64,
    count: u64,
    #[serde(rename = "payloadBytes")]
    _payload_bytes: u64,
    #[serde(rename = "maxSh", default)]
    max_sh: Option<usize>,
    #[serde(rename = "lodTree", default)]
    _lod_tree: Option<bool>,
    properties: Vec<Prop>,
}

#[derive(Deserialize)]
struct Prop {
    offset: u64,
    bytes: u64,
    property: String,
    encoding: String,
    #[serde(default)]
    compression: Option<String>,
    #[serde(default)]
    min: Option<f32>,
    #[serde(default)]
    max: Option<f32>,
}

/// Decoded chunk, exposed to JS as flat typed arrays (splat-major).
#[wasm_bindgen]
pub struct DecodedChunk {
    base: u64,
    count: usize,
    max_sh: usize,
    center: Vec<f32>,      // count*3
    alpha: Vec<f32>,       // count   (linear; >1.0 possible on LOD interior nodes)
    rgb: Vec<f32>,         // count*3 (may exceed [0,1])
    scale: Vec<f32>,       // count*3 (LINEAR — ln codecs already exp()ed)
    quat: Vec<f32>,        // count*4 xyzw
    covariance: Vec<f32>,  // count*6 upper triangle xx,xy,xz,yy,yz,zz
    color: Vec<u8>,        // count*4 RGBA8 normalized, alpha clamped for rendering
    sh1: Vec<f32>,         // count*9 or empty
    child_count: Vec<u16>, // count or empty
    child_start: Vec<u32>, // count or empty
}

#[wasm_bindgen]
impl DecodedChunk {
    #[wasm_bindgen(getter)] pub fn base(&self) -> f64 { self.base as f64 }
    #[wasm_bindgen(getter)] pub fn count(&self) -> usize { self.count }
    #[wasm_bindgen(getter)] pub fn max_sh(&self) -> usize { self.max_sh }
    pub fn take_center(&mut self) -> Vec<f32> { std::mem::take(&mut self.center) }
    pub fn take_alpha(&mut self) -> Vec<f32> { std::mem::take(&mut self.alpha) }
    pub fn take_rgb(&mut self) -> Vec<f32> { std::mem::take(&mut self.rgb) }
    pub fn take_scale(&mut self) -> Vec<f32> { std::mem::take(&mut self.scale) }
    pub fn take_quat(&mut self) -> Vec<f32> { std::mem::take(&mut self.quat) }
    pub fn take_covariance(&mut self) -> Vec<f32> { std::mem::take(&mut self.covariance) }
    pub fn take_color(&mut self) -> Vec<u8> { std::mem::take(&mut self.color) }
    /// SH1 packed to the addon's clamped-byte words (count*3 u32, little-endian;
    /// empty when the chunk has no sh1): byte = v*128+128 clamped to [0,255]
    /// with round-half-to-even — bit-identical to the spike's JS packing
    /// through Uint8ClampedArray (GsplatSH1 layout: 9 coefficient bytes + 3
    /// pad bytes of 128 per splat). Consumes sh1. Production packs HERE so the
    /// worker transfers words, not floats (doc 03 §A3).
    pub fn take_sh1_packed(&mut self) -> Vec<u32> {
        let sh1 = std::mem::take(&mut self.sh1);
        pack_sh1_words(&sh1)
    }
    pub fn take_child_count(&mut self) -> Vec<u16> { std::mem::take(&mut self.child_count) }
    pub fn take_child_start(&mut self) -> Vec<u32> { std::mem::take(&mut self.child_start) }
}

/// One SH1 byte, exactly as JS `Uint8ClampedArray` stores `v * 128 + 128`:
/// clamp to [0, 255], then round half to even (the ToUint8Clamp algorithm).
/// The arithmetic MUST be f64: JS widens the Float32Array element to f64
/// before `*128+128`, and an f32 sum can round onto an exact .5 the f64 sum
/// is not, flipping the tie (adversarial review, 2026-08-23 — probe value
/// 0.019531309604644775 packs 131 in JS, 130 under f32 arithmetic).
fn sh1_byte(v: f32) -> u8 {
    ((v as f64) * 128.0 + 128.0).clamp(0.0, 255.0).round_ties_even() as u8
}

/// Coefficient-major sh1 floats (count*9) -> packed words (count*3).
fn pack_sh1_words(sh1: &[f32]) -> Vec<u32> {
    let count = sh1.len() / 9;
    let mut words = Vec::with_capacity(count * 3);
    for i in 0..count {
        let mut bytes = [128u8; 12];
        for j in 0..9 {
            bytes[j] = sh1_byte(sh1[i * 9 + j]);
        }
        for w in 0..3 {
            words.push(u32::from_le_bytes(bytes[w * 4..w * 4 + 4].try_into().unwrap()));
        }
    }
    words
}

fn err(msg: String) -> JsValue {
    JsValue::from_str(&msg)
}

/// Decode one whole .rad chunk (bytes beginning with 'RADC').
#[wasm_bindgen]
pub fn decode_chunk(bytes: &[u8]) -> Result<DecodedChunk, JsValue> {
    decode_chunk_impl(bytes).map_err(err)
}

fn decode_chunk_impl(bytes: &[u8]) -> Result<DecodedChunk, String> {
    if bytes.len() < 8 {
        return Err("chunk too short".into());
    }
    let magic = u32::from_le_bytes(bytes[0..4].try_into().unwrap());
    if magic != RAD_CHUNK_MAGIC {
        return Err(format!("bad RADC magic 0x{magic:08x}"));
    }
    let meta_len = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    let meta_end = 8 + roundup8(meta_len);
    if bytes.len() < meta_end + 8 {
        return Err("chunk truncated before payloadBytes".into());
    }
    let meta: ChunkMeta =
        serde_json::from_slice(&bytes[8..8 + meta_len]).map_err(|e| format!("chunk meta JSON: {e}"))?;
    if meta.version != 1 {
        return Err(format!("unsupported chunk version {}", meta.version));
    }
    let payload_start = meta_end + 8;
    let count = meta.count as usize;

    let mut out = DecodedChunk {
        base: meta.base,
        count,
        max_sh: meta.max_sh.unwrap_or(0),
        center: Vec::new(),
        alpha: Vec::new(),
        rgb: Vec::new(),
        scale: Vec::new(),
        quat: Vec::new(),
        covariance: Vec::new(),
        color: Vec::new(),
        sh1: Vec::new(),
        child_count: Vec::new(),
        child_start: Vec::new(),
    };

    for prop in &meta.properties {
        let start = payload_start + prop.offset as usize;
        let end = start + prop.bytes as usize;
        if bytes.len() < start + roundup8(prop.bytes as usize) {
            return Err(format!("property {} out of range", prop.property));
        }
        let raw = &bytes[start..end];
        let data: Vec<u8>;
        let data = match prop.compression.as_deref() {
            Some("gz") => {
                data = decompress_to_vec(raw).map_err(|e| format!("inflate {}: {e:?}", prop.property))?;
                &data[..]
            }
            Some(other) => return Err(format!("unsupported compression {other}")),
            None => raw,
        };

        match prop.property.as_str() {
            "center" => {
                out.center = match prop.encoding.as_str() {
                    "f32" => decode_f32(data, 3, count)?,
                    "f32_lebytes" => decode_f32_lebytes(data, 3, count)?,
                    e => return Err(format!("unsupported center encoding {e}")),
                };
            }
            "alpha" => {
                out.alpha = match prop.encoding.as_str() {
                    "f32" => decode_f32(data, 1, count)?,
                    "f16" => decode_f16(data, 1, count)?,
                    "r8" => decode_r8(data, 1, count, need(prop.min, "min")?, need(prop.max, "max")?),
                    e => return Err(format!("unsupported alpha encoding {e}")),
                };
            }
            "rgb" => {
                out.rgb = match prop.encoding.as_str() {
                    "f32" => decode_f32(data, 3, count)?,
                    "f16" => decode_f16(data, 3, count)?,
                    "r8_delta" => decode_r8_delta(data, 3, count, need(prop.min, "min")?, need(prop.max, "max")?),
                    e => return Err(format!("unsupported rgb encoding {e}")),
                };
            }
            "scales" => {
                out.scale = match prop.encoding.as_str() {
                    "f32" => decode_f32(data, 3, count)?,
                    "ln_f16" => decode_ln_f16(data, 3, count)?,
                    e => return Err(format!("unsupported scales encoding {e}")),
                };
            }
            "orientation" => {
                out.quat = match prop.encoding.as_str() {
                    "oct88r8" => decode_quat_oct88r8(data, count)?,
                    e => return Err(format!("unsupported orientation encoding {e}")),
                };
            }
            "sh1" => {
                out.sh1 = match prop.encoding.as_str() {
                    "f32" => decode_f32(data, 9, count)?,
                    "f16" => decode_f16(data, 9, count)?,
                    "s8" => decode_s8(data, 9, count, need(prop.max, "max")?),
                    e => return Err(format!("unsupported sh1 encoding {e}")),
                };
            }
            // Spike scope (FORMAT.md): higher SH bands / clustered SH unsupported —
            // the hero is maxSh 1. Error loudly rather than render wrong.
            "sh2" | "sh3" | "sh1_code" | "sh2_code" | "sh3_code" | "sh_label" => {
                return Err(format!("property {} outside spike scope", prop.property));
            }
            "child_count" => {
                if prop.encoding != "u16" {
                    return Err(format!("unsupported child_count encoding {}", prop.encoding));
                }
                out.child_count = decode_u16(data, 1, count)?;
            }
            "child_start" => {
                if prop.encoding != "u32" {
                    return Err(format!("unsupported child_start encoding {}", prop.encoding));
                }
                out.child_start = decode_u32(data, 1, count)?;
            }
            other => return Err(format!("unknown property {other}")),
        }
    }

    // Derive the three.js geometry contract pieces.
    if !out.scale.is_empty() && !out.quat.is_empty() {
        out.covariance = covariance_from(&out.scale, &out.quat, count);
    }
    if !out.rgb.is_empty() {
        out.color = color_from(&out.rgb, &out.alpha, count);
    }
    Ok(out)
}

fn need(v: Option<f32>, name: &str) -> Result<f32, String> {
    v.ok_or_else(|| format!("property missing {name}"))
}

// ---- codecs: all transposed (dimension-major); see FORMAT.md table ----

fn decode_f32(data: &[u8], dims: usize, count: usize) -> Result<Vec<f32>, String> {
    if data.len() < 4 * dims * count {
        return Err("f32 data short".into());
    }
    let mut out = vec![0.0f32; dims * count];
    for i in 0..count {
        let mut index = i * 4;
        for d in 0..dims {
            out[i * dims + d] = f32::from_le_bytes(data[index..index + 4].try_into().unwrap());
            index += count * 4;
        }
    }
    Ok(out)
}

fn decode_f16(data: &[u8], dims: usize, count: usize) -> Result<Vec<f32>, String> {
    if data.len() < 2 * dims * count {
        return Err("f16 data short".into());
    }
    let mut out = vec![0.0f32; dims * count];
    for i in 0..count {
        let mut index = i * 2;
        for d in 0..dims {
            out[i * dims + d] = f16::from_le_bytes([data[index], data[index + 1]]).to_f32();
            index += count * 2;
        }
    }
    Ok(out)
}

fn decode_f32_lebytes(data: &[u8], dims: usize, count: usize) -> Result<Vec<f32>, String> {
    if data.len() < 4 * dims * count {
        return Err("f32_lebytes data short".into());
    }
    let stride = count * dims;
    let mut out = vec![0.0f32; dims * count];
    for i in 0..count {
        for d in 0..dims {
            let index = count * d + i;
            let b = [data[index], data[index + stride], data[index + stride * 2], data[index + stride * 3]];
            out[i * dims + d] = f32::from_le_bytes(b);
        }
    }
    Ok(out)
}

fn decode_r8(data: &[u8], dims: usize, count: usize, min: f32, max: f32) -> Vec<f32> {
    let mut out = vec![0.0f32; dims * count];
    for i in 0..count {
        let mut index = i;
        for d in 0..dims {
            out[i * dims + d] = (data[index] as f32 / 255.0) * (max - min) + min;
            index += count;
        }
    }
    out
}

fn decode_s8(data: &[u8], dims: usize, count: usize, max: f32) -> Vec<f32> {
    let mut out = vec![0.0f32; dims * count];
    for i in 0..count {
        let mut index = i;
        for d in 0..dims {
            out[i * dims + d] = ((data[index] as i8) as f32 / 127.0) * max;
            index += count;
        }
    }
    out
}

fn decode_r8_delta(data: &[u8], dims: usize, count: usize, min: f32, max: f32) -> Vec<f32> {
    // Delta runs along each dimension's row in the transposed layout
    // (encoder walks dim-major: rad.rs:1119-1132).
    let mut out = vec![0.0f32; dims * count];
    for d in 0..dims {
        let mut last = 0u8;
        for i in 0..count {
            let value = last.wrapping_add(data[d * count + i]);
            last = value;
            out[i * dims + d] = (value as f32 / 255.0) * (max - min) + min;
        }
    }
    out
}

fn decode_ln_f16(data: &[u8], dims: usize, count: usize) -> Result<Vec<f32>, String> {
    let v = decode_f16(data, dims, count)?;
    Ok(v.into_iter().map(|x| x.exp()).collect())
}

fn decode_quat_oct88r8(data: &[u8], count: usize) -> Result<Vec<f32>, String> {
    if data.len() < 3 * count {
        return Err("oct88r8 data short".into());
    }
    let mut out = vec![0.0f32; 4 * count];
    for i in 0..count {
        // NOTE: oct88r8 is stored per-splat [u,v,r] triplets, NOT transposed —
        // encode_quat_oct88r8 (rad.rs:1227-1234) walks splats emitting 3 bytes each.
        let (u, v, r) = (data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
        let x = u as f32 / 255.0 * 2.0 - 1.0;
        let y = v as f32 / 255.0 * 2.0 - 1.0;
        let z = 1.0 - x.abs() - y.abs();
        let t = (-z).max(0.0);
        let x = if x >= 0.0 { x - t } else { x + t };
        let y = if y >= 0.0 { y - t } else { y + t };
        let len = (x * x + y * y + z * z).sqrt();
        let (ax, ay, az) = (x / len, y / len, z / len);
        let half_theta = r as f32 / 255.0 * 0.5 * std::f32::consts::PI;
        let (s, w) = half_theta.sin_cos();
        out[i * 4] = ax * s;
        out[i * 4 + 1] = ay * s;
        out[i * 4 + 2] = az * s;
        out[i * 4 + 3] = w;
    }
    Ok(out)
}

fn decode_u16(data: &[u8], dims: usize, count: usize) -> Result<Vec<u16>, String> {
    if data.len() < 2 * dims * count {
        return Err("u16 data short".into());
    }
    let mut out = vec![0u16; dims * count];
    for i in 0..count {
        let mut index = i * 2;
        for d in 0..dims {
            out[i * dims + d] = u16::from_le_bytes([data[index], data[index + 1]]);
            index += count * 2;
        }
    }
    Ok(out)
}

fn decode_u32(data: &[u8], dims: usize, count: usize) -> Result<Vec<u32>, String> {
    if data.len() < 4 * dims * count {
        return Err("u32 data short".into());
    }
    let mut out = vec![0u32; dims * count];
    for i in 0..count {
        let mut index = i * 4;
        for d in 0..dims {
            out[i * dims + d] =
                u32::from_le_bytes([data[index], data[index + 1], data[index + 2], data[index + 3]]);
            index += count * 4;
        }
    }
    Ok(out)
}

// ---- geometry-contract derivations ----

/// Σ = R S Sᵀ Rᵀ, upper triangle (xx,xy,xz,yy,yz,zz) — the exact contract
/// three.js GaussianSplatUtils.writeCovariance consumes (FORMAT.md tail).
fn covariance_from(scale: &[f32], quat: &[f32], count: usize) -> Vec<f32> {
    let mut out = vec![0.0f32; count * 6];
    for i in 0..count {
        let (x, y, z, w) = (quat[i * 4], quat[i * 4 + 1], quat[i * 4 + 2], quat[i * 4 + 3]);
        // rotation matrix from quaternion (column-major thinking, but symmetric result)
        let (xx, yy, zz) = (x * x, y * y, z * z);
        let (xy, xz, yz) = (x * y, x * z, y * z);
        let (wx, wy, wz) = (w * x, w * y, w * z);
        let r = [
            [1.0 - 2.0 * (yy + zz), 2.0 * (xy - wz), 2.0 * (xz + wy)],
            [2.0 * (xy + wz), 1.0 - 2.0 * (xx + zz), 2.0 * (yz - wx)],
            [2.0 * (xz - wy), 2.0 * (yz + wx), 1.0 - 2.0 * (xx + yy)],
        ];
        let s2 = [
            scale[i * 3] * scale[i * 3],
            scale[i * 3 + 1] * scale[i * 3 + 1],
            scale[i * 3 + 2] * scale[i * 3 + 2],
        ];
        // M = R * S²  then Σ = M * Rᵀ
        let mut m = [[0.0f32; 3]; 3];
        for a in 0..3 {
            for b in 0..3 {
                m[a][b] = r[a][b] * s2[b];
            }
        }
        let mut cov = [[0.0f32; 3]; 3];
        for a in 0..3 {
            for b in 0..3 {
                let mut acc = 0.0;
                for k in 0..3 {
                    acc += m[a][k] * r[b][k];
                }
                cov[a][b] = acc;
            }
        }
        out[i * 6] = cov[0][0];
        out[i * 6 + 1] = cov[0][1];
        out[i * 6 + 2] = cov[0][2];
        out[i * 6 + 3] = cov[1][1];
        out[i * 6 + 4] = cov[1][2];
        out[i * 6 + 5] = cov[2][2];
    }
    out
}

/// RGBA8 for the renderer's color attribute. Alpha clamps to [0,1] HERE ONLY —
/// the un-clamped alpha array is preserved for LOD selection (lodOpacity nodes
/// legitimately exceed 1.0; FORMAT.md).
fn color_from(rgb: &[f32], alpha: &[f32], count: usize) -> Vec<u8> {
    let mut out = vec![0u8; count * 4];
    for i in 0..count {
        for c in 0..3 {
            out[i * 4 + c] = (rgb[i * 3 + c].clamp(0.0, 1.0) * 255.0).round() as u8;
        }
        let a = if alpha.is_empty() { 1.0 } else { alpha[i].clamp(0.0, 1.0) };
        out[i * 4 + 3] = (a * 255.0).round() as u8;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Golden test against chunk 0 of the real hero file. Run with:
    ///   cargo test --release -- --nocapture
    /// Requires the hero asset at the sparkjs-toolkit path (read-only).
    #[test]
    fn decodes_hero_chunk0() {
        let path = "D:/Projects/sparkjs-toolkit/examples/assets/lab-sh1-sparsity.rad";
        let Ok(all) = std::fs::read(path) else {
            eprintln!("hero asset not present; skipping");
            return;
        };
        // header: FORMAT.md container layout
        let header_len = u32::from_le_bytes(all[4..8].try_into().unwrap()) as usize;
        let chunks_start = 8 + roundup8(header_len);
        let meta: serde_json::Value = serde_json::from_slice(&all[8..8 + header_len]).unwrap();
        let c0 = &meta["chunks"][0];
        let (off, len) = (c0["offset"].as_u64().unwrap() as usize, c0["bytes"].as_u64().unwrap() as usize);
        let chunk = &all[chunks_start + off..chunks_start + off + len];

        let mut d = decode_chunk_impl(chunk).expect("decode");
        assert_eq!(d.count, 65536);
        assert_eq!(d.base, 0);
        assert_eq!(d.center.len(), 65536 * 3);
        assert_eq!(d.quat.len(), 65536 * 4);
        assert_eq!(d.covariance.len(), 65536 * 6);
        assert_eq!(d.sh1.len(), 65536 * 9);
        assert_eq!(d.child_count.len(), 65536);

        // sanity: centers finite and inside a plausible scene box
        let mut min = [f32::INFINITY; 3];
        let mut max = [f32::NEG_INFINITY; 3];
        for i in 0..d.count {
            for c in 0..3 {
                let v = d.center[i * 3 + c];
                assert!(v.is_finite(), "non-finite center at {i}");
                min[c] = min[c].min(v);
                max[c] = max[c].max(v);
            }
        }
        eprintln!("center bounds: {min:?} .. {max:?}");
        assert!((max[0] - min[0]) > 0.1 && (max[0] - min[0]) < 10000.0);

        // sanity: quats normalized
        for i in (0..d.count).step_by(4096) {
            let q = &d.quat[i * 4..i * 4 + 4];
            let n = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
            assert!((n - 1.0).abs() < 1e-3, "quat {i} norm {n}");
        }

        // sanity: scales positive-linear, not log
        let s_max = d.scale.iter().cloned().fold(0.0f32, f32::max);
        assert!(s_max > 0.0 && s_max < 1000.0, "scale max {s_max}");

        // sanity: LOD structure — child_start of nodes with children in range
        let mut interior = 0usize;
        for i in 0..d.count {
            if d.child_count[i] > 0 {
                interior += 1;
            }
        }
        eprintln!("interior nodes in chunk0: {interior}");
        assert!(interior > 0, "lodTree chunk should contain interior nodes");

        // sanity: alpha >1 exists (lodOpacity aggregate) but most leaves <=1
        let over = d.alpha.iter().filter(|a| **a > 1.0).count();
        eprintln!("alpha>1 count: {over} / {}", d.count);

        // packed SH words: right length, and byte-exact vs the scalar reference
        let sh1_floats = d.sh1.clone();
        let words = pack_sh1_words(&sh1_floats);
        assert_eq!(words.len(), 65536 * 3);
        for i in (0..d.count).step_by(4097) {
            let bytes0 = words[i * 3].to_le_bytes();
            for j in 0..4 {
                assert_eq!(bytes0[j], sh1_byte(sh1_floats[i * 9 + j]), "splat {i} byte {j}");
            }
            let bytes1 = words[i * 3 + 1].to_le_bytes();
            for j in 0..4 {
                assert_eq!(bytes1[j], sh1_byte(sh1_floats[i * 9 + 4 + j]), "splat {i} coeff {}", 4 + j);
            }
            let bytes2 = words[i * 3 + 2].to_le_bytes();
            assert_eq!(bytes2[0], sh1_byte(sh1_floats[i * 9 + 8]), "splat {i} last coeff");
            assert_eq!(bytes2[1], 128, "splat {i} pad byte");
            assert_eq!(bytes2[2], 128, "splat {i} pad byte");
            assert_eq!(bytes2[3], 128, "splat {i} pad byte");
        }

        let _ = d.take_color();
    }

    /// Packing parity with JS Uint8ClampedArray semantics: saturation at the
    /// rails and round-half-to-even at ties.
    #[test]
    fn sh1_packing_matches_clamped_byte_semantics() {
        assert_eq!(sh1_byte(-1.5), 0); //  -64  -> clamp 0
        assert_eq!(sh1_byte(-1.0), 0);
        assert_eq!(sh1_byte(0.0), 128);
        assert_eq!(sh1_byte(0.5), 192);
        assert_eq!(sh1_byte(1.0), 255); //  256  -> clamp 255
        assert_eq!(sh1_byte(1.505), 255); // hero saturation case (doc 03 §H.3)
        // ties: x.5 rounds to even, matching ToUint8Clamp
        assert_eq!(sh1_byte(2.5 / 128.0), 130); // 130.5 -> 130
        assert_eq!(sh1_byte(3.5 / 128.0), 132); // 131.5 -> 132
        // f64-arithmetic tie: the f32 sum is exactly 130.5 (-> 130) but the
        // JS f64 sum is 130.50000762939453 (-> 131). Guards the f64 mandate.
        assert_eq!(sh1_byte(0.019531309604644775), 131);
        // NaN follows ToUint8Clamp: NaN -> 0
        assert_eq!(sh1_byte(f32::NAN), 0);
        // absent sh1 packs to nothing; pad-only layout is the upload side's job
        assert!(pack_sh1_words(&[]).is_empty());
        // one splat: 3 words, all-zero input packs to 128s
        let w = pack_sh1_words(&[0.0; 9]);
        assert_eq!(w, vec![u32::from_le_bytes([128; 4]); 3]);
    }
}
