import {
  attachSparkPagerAdapter,
  type AdapterInvalidReason,
  type SparkPagerAdapterEvent,
  type SparkPagerAdapterHandle,
} from "./SparkPagerAdapter";
import type { ProbeStatus } from "./events";

export type AdapterFaultName =
  | "fingerprint_change"
  | "thrown_getter"
  | "decreasing_bytes"
  | "resident_over_requested"
  | "invalid_level"
  | "invalid_topology"
  | "missing_optional_stage"
  | "reordered_events"
  | "sink_failure"
  | "storage_denial"
  | "persisted_lifecycle_suspension";

export interface FaultExpectation {
  readonly probeStatus: ProbeStatus;
  readonly invalidReason?: AdapterInvalidReason;
  readonly declaredGap?: string;
  readonly recordContinues: true;
}

export interface FaultReplayResult {
  readonly name: AdapterFaultName;
  readonly expectation: Readonly<FaultExpectation>;
  readonly actualStatus: ProbeStatus;
  readonly invalidReason?: AdapterInvalidReason;
  readonly invalidationCount: number;
  readonly postInvalidPagerReads: number;
  readonly declaredGaps: readonly string[];
  readonly events: readonly Readonly<SparkPagerAdapterEvent>[];
  readonly externalSignals: readonly string[];
  readonly passed: boolean;
}

export interface MockPagerHarness {
  readonly mesh: { readonly paged: MockPagedSplats };
  readonly paged: MockPagedSplats;
  readonly pager: MockSplatPager;
  readonly renderer: { display?: { mappingVersion: number } };
  readonly events: SparkPagerAdapterEvent[];
  readonly externalSignals: string[];
  readonly handle: SparkPagerAdapterHandle;
  setTime(atMs: number): void;
}

interface MutableHarnessParts {
  mesh: { paged: MockPagedSplats };
  paged: MockPagedSplats;
  pager: MockSplatPager;
  renderer: { display?: { mappingVersion: number } };
  events: SparkPagerAdapterEvent[];
  externalSignals: string[];
  time: number;
}

interface FaultDefinition {
  readonly name: AdapterFaultName;
  readonly expectation: Readonly<FaultExpectation>;
  beforeAttach?(parts: MutableHarnessParts): void;
  apply(harness: MockPagerHarness): void;
}

interface MockForwardEntry {
  page: number;
  lru: number;
}

interface MockReverseEntry {
  splats: object;
  chunk: number;
  time: number;
  numSplats?: number;
  level?: number;
  parentPage?: number;
  childPages?: number[];
  bounds?: [[number, number, number], [number, number, number]];
  requestStartMs?: number;
  decodeEndMs?: number;
  uploadStartMs?: number;
  uploadEndMs?: number;
}

interface MockUpload {
  page: number;
  numSplats: number;
  packedArray: Uint32Array;
  extra: Record<string, unknown>;
  splats: MockPagedSplats;
  chunk: number;
}

export class MockPagedSplats {
  rootUrl = "/examples/assets/teleport-lab1-hd.rad";
  numSplats = 1;
  dynoNumSplats = {};
  dynoIndices = {};
  readonly radMetaPromise: Promise<{
    meta: { count: number; chunks: Array<{ offset: number; bytes: number }> };
    chunksStart: number;
  }>;

  constructor(readonly pager: MockSplatPager) {
    this.radMetaPromise = Promise.resolve({
      meta: { count: 65_536, chunks: [{ offset: 0, bytes: 128 }] },
      chunksStart: 64,
    });
  }

  getRadMeta(): Promise<{ meta: { count: number; chunks: Array<{ offset: number; bytes: number }> }; chunksStart: number }> {
    return this.radMetaPromise;
  }

  fetchDecodeChunk(_chunk: number): Promise<{ numSplats: number; packedArray: Uint32Array; extra: Record<string, unknown> }> {
    return Promise.resolve({ numSplats: 1, packedArray: new Uint32Array(4), extra: {} });
  }

  update(numSplats: number, _indices: Uint32Array): void {
    this.numSplats = numSplats;
  }

  getNumSplats(): number {
    return this.numSplats;
  }
}

export class MockSplatPager {
  renderer = {};
  extSplats = false;
  pageSplats = 65_536;
  maxPages = 4;
  maxSplats = 65_536 * 4;
  autoDrive = true;
  numFetchers = 3;
  readonly splatsChunkToPage = new Map<object, Array<MockForwardEntry | null>>();
  pageToSplatsChunk: Array<MockReverseEntry | null> = [];
  pageFreelist: number[] = [1, 2, 3];
  pageLru = new Set<MockForwardEntry>();
  freeablePages: number[] = [];
  newUploads: MockUpload[] = [];
  readyUploads: MockUpload[] = [];
  lodTreeUpdates: Array<Record<string, unknown>> = [];
  fetchers: Array<Record<string, unknown>> = [];
  fetched: Array<Record<string, unknown>> = [];
  fetchPriority: Array<Record<string, unknown>> = [];

  getSplatsChunk(splats: object, chunk: number): MockForwardEntry | undefined {
    return this.splatsChunkToPage.get(splats)?.[chunk] ?? undefined;
  }

  driveFetchers(): void {
    // Deliberately inert: fault replay never asks the adapter to drive Spark.
  }

  uploadPage(_page: number, _packedArray: Uint32Array, _extra: Record<string, unknown>, _extArray?: Uint32Array): void {
    // Deliberately inert CPU-staging seam.
  }

  processUploads(): void {
    // Deliberately inert: the adapter only fingerprints this callable.
  }

  consumeLodTreeUpdates(): Array<Record<string, unknown>> {
    return [];
  }
}

const FAULT_DEFINITIONS: readonly FaultDefinition[] = Object.freeze([
  {
    name: "fingerprint_change",
    expectation: expectation("invalid", "fingerprint_changed"),
    apply: ({ pager }) => {
      pager.maxPages = 3;
    },
  },
  {
    name: "thrown_getter",
    expectation: expectation("invalid", "thrown_getter"),
    apply: ({ pager }) => {
      Object.defineProperty(pager, "pageToSplatsChunk", {
        configurable: true,
        get(): never {
          throw new Error("injected thrown_getter");
        },
      });
    },
  },
  {
    // bytesReceived is an absent capability, so no byte metric is invented.
    // The fault drives the adapter's installed monotonic mapping-time counter.
    name: "decreasing_bytes",
    expectation: expectation("invalid", "counter_decreased", "bytes_received_absent"),
    apply: ({ pager }) => {
      const reverse = pager.pageToSplatsChunk[0];
      if (reverse) reverse.time = 5;
    },
  },
  {
    name: "resident_over_requested",
    expectation: expectation("invalid", "resident_over_requested"),
    apply: ({ pager }) => {
      const orphanOwner = {};
      const forward = { page: 1, lru: 11 };
      pager.splatsChunkToPage.set(orphanOwner, [forward]);
      pager.pageToSplatsChunk[1] = { splats: orphanOwner, chunk: 0, time: 11, numSplats: 1 };
      pager.pageLru.add(forward);
      pager.pageFreelist = [2, 3];
    },
  },
  {
    name: "invalid_level",
    expectation: expectation("invalid", "invalid_level"),
    apply: ({ pager }) => {
      const reverse = pager.pageToSplatsChunk[0];
      if (reverse) reverse.level = -1;
    },
  },
  {
    name: "invalid_topology",
    expectation: expectation("invalid", "forward_reverse_disagreement"),
    apply: ({ pager }) => {
      const reverse = pager.pageToSplatsChunk[0];
      if (reverse) reverse.chunk = 1;
    },
  },
  {
    name: "missing_optional_stage",
    expectation: expectation("degraded", undefined, "render_eligible_exact_frame_absent_page_level_only"),
    beforeAttach: ({ renderer }) => {
      delete renderer.display;
    },
    apply: () => undefined,
  },
  {
    name: "reordered_events",
    expectation: expectation("invalid", "reordered_lifecycle"),
    apply: ({ pager }) => {
      const reverse = pager.pageToSplatsChunk[0];
      if (reverse) {
        reverse.requestStartMs = 10;
        reverse.decodeEndMs = 9;
      }
    },
  },
  {
    name: "sink_failure",
    expectation: expectation("degraded"),
    apply: ({ externalSignals }) => {
      externalSignals.push("sink_failure:record_continues");
    },
  },
  {
    name: "storage_denial",
    expectation: expectation("degraded"),
    apply: ({ externalSignals }) => {
      externalSignals.push("storage_denial:memory_fallback");
    },
  },
  {
    name: "persisted_lifecycle_suspension",
    expectation: expectation("degraded"),
    apply: ({ externalSignals }) => {
      externalSignals.push("persisted:true", "suspended", "reconciled_non_comparable");
    },
  },
]);

export const ADAPTER_FAULT_NAMES: readonly AdapterFaultName[] = Object.freeze(FAULT_DEFINITIONS.map(({ name }) => name));

export function createMockPagerHarness(beforeAttach?: (parts: MutableHarnessParts) => void): MockPagerHarness {
  const pager = new MockSplatPager();
  const paged = new MockPagedSplats(pager);
  const firstForward = { page: 0, lru: 10 };
  pager.splatsChunkToPage.set(paged, [firstForward]);
  pager.pageToSplatsChunk[0] = {
    splats: paged,
    chunk: 0,
    time: 10,
    numSplats: 1,
    level: 0,
    bounds: [[-1, -1, -1], [1, 1, 1]],
  };
  pager.pageLru.add(firstForward);
  const renderer: { display?: { mappingVersion: number } } = { display: { mappingVersion: 0 } };
  const events: SparkPagerAdapterEvent[] = [];
  const externalSignals: string[] = [];
  const parts: MutableHarnessParts = {
    mesh: { paged },
    paged,
    pager,
    renderer,
    events,
    externalSignals,
    time: 10,
  };
  beforeAttach?.(parts);
  const handle = attachSparkPagerAdapter({
    pagedMesh: parts.mesh,
    renderer,
    installedVersion: "2.1.0",
    expectedVersion: "2.1.0",
    sceneLocalPagedId: "fixture-paged-0",
    eventReceiver: (event) => events.push(event as SparkPagerAdapterEvent),
    now: () => parts.time,
  });
  return {
    mesh: parts.mesh,
    paged,
    pager,
    renderer,
    events,
    externalSignals,
    handle,
    setTime(atMs: number): void {
      parts.time = atMs;
    },
  };
}

export function replayAdapterFault(name: AdapterFaultName): Readonly<FaultReplayResult> {
  const definition = FAULT_DEFINITIONS.find((candidate) => candidate.name === name);
  if (!definition) throw new RangeError(`Unknown adapter fault: ${name}`);
  const harness = createMockPagerHarness(definition.beforeAttach);
  harness.handle.readSnapshot(10);
  definition.apply(harness);
  harness.setTime(20);
  harness.handle.readSnapshot(20);
  const invalidations = harness.events.filter((event) => event.type === "adapter_invalidated");
  const invalidReason = invalidations[0]?.type === "adapter_invalidated" ? invalidations[0].code : undefined;
  const beforePostInvalidRead = harness.events.filter((event) => event.type === "pager_snapshot").length;
  if (harness.handle.capabilities.probeStatus === "invalid") harness.handle.readSnapshot(30);
  const afterPostInvalidRead = harness.events.filter((event) => event.type === "pager_snapshot").length;
  const postInvalidPagerReads = afterPostInvalidRead - beforePostInvalidRead;
  const expectation = definition.expectation;
  const passed = harness.handle.capabilities.probeStatus === expectation.probeStatus
    && invalidReason === expectation.invalidReason
    && invalidations.length === (expectation.probeStatus === "invalid" ? 1 : 0)
    && postInvalidPagerReads === 0
    && (expectation.declaredGap === undefined || harness.handle.capabilities.declaredGaps.includes(expectation.declaredGap));
  return Object.freeze({
    name,
    expectation,
    actualStatus: harness.handle.capabilities.probeStatus,
    ...(invalidReason ? { invalidReason } : {}),
    invalidationCount: invalidations.length,
    postInvalidPagerReads,
    declaredGaps: harness.handle.capabilities.declaredGaps,
    events: Object.freeze([...harness.events]),
    externalSignals: Object.freeze([...harness.externalSignals]),
    passed,
  });
}

export function replayAdapterFaultList(): readonly Readonly<FaultReplayResult>[] {
  return Object.freeze(ADAPTER_FAULT_NAMES.map(replayAdapterFault));
}

function expectation(
  probeStatus: ProbeStatus,
  invalidReason?: AdapterInvalidReason,
  declaredGap?: string,
): Readonly<FaultExpectation> {
  return Object.freeze({
    probeStatus,
    ...(invalidReason ? { invalidReason } : {}),
    ...(declaredGap ? { declaredGap } : {}),
    recordContinues: true,
  });
}
