/**
 * Decode worker: one chunk in, decoded splat-major arrays out (transferred).
 * Spike runs a single worker (doc 04 Phase 0); production grows a pool of 4.
 */
import init, { decode_chunk } from "../rad-three/pkg/rad_three.js";

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
  sh1: Float32Array;      // length 0 when absent
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
    const out: DecodeResult = {
      index,
      bytes,
      base: d.base,
      count: d.count,
      center: d.take_center(),
      covariance: d.take_covariance(),
      color: d.take_color(),
      sh1: d.take_sh1(),
      alpha: d.take_alpha(),
      scale: d.take_scale(),
      quat: d.take_quat(),
      childCount: d.take_child_count(),
      childStart: d.take_child_start(),
      decodeMs: performance.now() - t0,
    };
    d.free();
    (self as unknown as Worker).postMessage(out, [
      out.bytes,
      out.center.buffer, out.covariance.buffer, out.color.buffer, out.sh1.buffer,
      out.alpha.buffer, out.scale.buffer, out.quat.buffer,
      out.childCount.buffer, out.childStart.buffer,
    ]);
  } catch (e) {
    // Return the transferred request bytes even on failure so the caller's cache survives.
    (self as unknown as Worker).postMessage({ index, error: String(e), bytes }, [bytes]);
  }
};
