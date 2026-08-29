/**
 * Embed build entry (ticket 03) — decode-only, deliberately NOT the backend
 * barrel. Ticket 03 gave the barrel runtime exports (ThreeGsBackend →
 * three/webgpu + the vendored mesh); building the barrel as the embed entry
 * ballooned dist-embed/embed.js from the recorded 213 kB to ~1.1 MB
 * (review finding, 2026-08-29). The embed artifact's contract is still
 * ticket 02's: the inline decode worker (D14 variant A) and nothing else,
 * until ticket 08 lands the real src/embed/register.ts entry.
 */
export { createDecodeWorker, type DecodeRequest, type DecodeResult } from "./decode";
