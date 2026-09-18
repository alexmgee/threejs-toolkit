/**
 * Measurement stub for the two-build bundle differential (Phase 7).
 * Selected in place of diagWiring.ts when TELEMETRY_MEASURE=off at build
 * config time. Same exported signature, no imports — Rollup statically
 * eliminates the entire diagnostics graph in build B.
 */

import type { LoadTelemetryHandle, WireLoadTelemetryInput } from "./diagWiring";

const NOOP = (): void => { /* stub */ };
const STUB_HANDLE: LoadTelemetryHandle = Object.freeze({
  status: Object.freeze({ attached: false, consent: "disabled" as const }),
  registerPagedScene: NOOP,
  markSceneFirstSplatReady: NOOP,
  markAllScenesVisible: NOOP,
  tick: NOOP,
  markInteraction: NOOP,
  sceneStatuses: () => Object.freeze([]),
  exportRecords: () => Object.freeze([]),
  dispose: NOOP,
});

export function wireLoadTelemetry(_input: Readonly<WireLoadTelemetryInput>): LoadTelemetryHandle {
  return STUB_HANDLE;
}
