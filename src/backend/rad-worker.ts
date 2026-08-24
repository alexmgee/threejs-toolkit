/**
 * Decode worker (promoted from the Phase 0 spike, ticket 02): one .rad chunk
 * in, decoded splat-major arrays out (transferred).
 *
 * Differences from the spike worker, both ticket-02 decoder gaps:
 * - SH1 leaves the worker as PACKED u32 words (`sh1Words`, count*3,
 *   little-endian clamped-byte quantization — doc 03 §A3 "SH words u32"),
 *   packed in Rust by `take_sh1_packed`; the spike packed floats in JS on the
 *   upload path instead.
 * - Opacity: resolved against Spark's own decoder — `.rad` alpha is stored
 *   LINEAR (f32/f16/r8; spark-lib rad.rs decodes it with no transform);
 *   sigmoid exists only in Spark's PLY importer. The crate's single decode is
 *   already exactly-once; nothing to add (resolution quoted in ticket 02
 *   Comments).
 *
 * Pool policy: ticket 05 spawns four of these; the worker itself is
 * pool-agnostic (one request in flight per instance, caller schedules).
 */
import init, { decode_chunk } from "../../rad-three/pkg/rad_three.js";

export interface DecodeRequest {
  index: number;
  bytes: ArrayBuffer;
}

export interface DecodeResult {
  index: number;
  /** The request's chunk bytes, transferred back so the caller's cache survives the zero-copy round trip. */
  bytes: ArrayBuffer;
  base: number;
  count: number;
  center: Float32Array;
  covariance: Float32Array;
  color: Uint8Array;
  /** Packed GsplatSH1 words (count*3), length 0 when the chunk has no sh1. */
  sh1Words: Uint32Array;
  alpha: Float32Array;    // UN-clamped (LOD selection input)
  scale: Float32Array;    // preserve-at-decode
  quat: Float32Array;     // preserve-at-decode
  childCount: Uint16Array;
  childStart: Uint32Array;
  decodeMs: number;
}

const ready = init();

self.onmessage = async (ev: MessageEvent<DecodeRequest>) => {
  const { index, bytes } = ev.data;
  try {
    await ready;
    const t0 = performance.now();
    const d = decode_chunk(new Uint8Array(bytes));
    let out: DecodeResult;
    try {
      out = {
        index,
        bytes,
        base: d.base,
        count: d.count,
        center: d.take_center(),
        covariance: d.take_covariance(),
        color: d.take_color(),
        sh1Words: d.take_sh1_packed(),
        alpha: d.take_alpha(),
        scale: d.take_scale(),
        quat: d.take_quat(),
        childCount: d.take_child_count(),
        childStart: d.take_child_start(),
        decodeMs: performance.now() - t0,
      };
    } finally {
      // A throwing take_* must still free the wasm-side object — the ticket-05
      // pool holds four long-lived workers; leaking per failure compounds
      // (adversarial review, 2026-08-23).
      d.free();
    }
    (self as unknown as Worker).postMessage(out, [
      out.bytes,
      out.center.buffer, out.covariance.buffer, out.color.buffer, out.sh1Words.buffer,
      out.alpha.buffer, out.scale.buffer, out.quat.buffer,
      out.childCount.buffer, out.childStart.buffer,
    ]);
  } catch (e) {
    // Return the transferred request bytes even on failure so the caller's cache survives.
    (self as unknown as Worker).postMessage({ index, error: String(e), bytes }, [bytes]);
  }
};
