import type { EventTimeRange, EventType, JsonValue, ProbeStatus, RawEvent, TerminalOutcome } from "./events";
import { DEFAULT_RECORD_CAP_POLICY, type RecordCapPolicy } from "./policies";

export const LOAD_RECORD_SCHEMA_VERSION = "1";
export const LOAD_RECORD_SEMANTICS_VERSION = "1";

export interface LoadRecordIdentity {
  recordId: string;
  revisionId: number;
  loadId: string;
  sceneId: string;
  serverVersion: string | null;
  radFormatVersion: string | null;
  topologyFingerprint: string | null;
}

export interface LoadRecordVersioning {
  schemaVersion: string;
  semanticsVersion: string;
  probeVersion: string;
  adapterVersion: string;
  sparkVersion: string;
  toolkitVersion: string;
}

export interface LoadRecordPolicy {
  convergencePolicy: Readonly<Record<string, JsonValue>>;
  samplingPolicy: Readonly<Record<string, JsonValue>>;
  revealPolicyObserved: JsonValue;
  featureFlags: readonly string[];
  capabilityFlags: readonly string[];
}

export interface SinkStatusEntry {
  sinkName: string;
  status: string;
  eventTimeMs: number;
  detail?: string;
}

export interface LoadRecordStatus {
  probeStatus: ProbeStatus;
  reasons: readonly string[];
  declaredGaps: readonly string[];
  sinkHistory: readonly Readonly<SinkStatusEntry>[];
  terminalOutcome: TerminalOutcome | null;
  uncertaintyReasons: readonly string[];
}

export interface LoadRecordEnvironment {
  browserBucket: string;
  osClass: string;
  gpuBucket: string;
  viewportBucket: string;
  dprBucket: string;
  connectionBucket: string;
  deviceMemoryBucket: string;
  logicalCoreBucket: string;
  rendererClass: string;
}

export interface NonComparableSpan {
  startMs: number;
  endMs: number;
  reason: string;
}

export interface LoadRecordTiming {
  monotonicTimeOriginMs: number;
  wallClockBucket: string | null;
  clockQuality: string;
  elapsedDurationMs: number;
  foregroundVisibleDurationMs: number;
  nonComparableSpans: readonly Readonly<NonComparableSpan>[];
}

export interface CompactedSegment {
  firstSequence: number;
  lastSequence: number;
  eventCount: number;
  eventTimeRange: EventTimeRange;
  perTypeCounts: Readonly<Partial<Record<EventType, number>>>;
}

export type DropReason = "raw_cap" | "total_cap" | "total_cap_frozen";

export interface DroppedEventSummary {
  eventType: EventType;
  eventTimeRange: EventTimeRange;
  count: number;
  reason: DropReason;
}

export interface DerivedBlock {
  name: string;
  policyVersion: string;
  rawEventCutoffSequence: number | null;
  value: JsonValue;
}

export interface FrozenInterval {
  startMs: number;
  endMs: number;
}

export interface LoadRecordEvidence {
  rawEvents: readonly Readonly<RawEvent>[];
  compactedSegments: readonly Readonly<CompactedSegment>[];
  droppedEvents: readonly Readonly<DroppedEventSummary>[];
  derivedBlocks: readonly Readonly<DerivedBlock>[];
  rawEventCutoffSequence: number | null;
}

export interface LoadRecordCaps {
  policyVersion: string;
  rawBytes: number;
  totalBytes: number;
  currentRawBytes: number;
  currentTotalBytes: number;
  rawCaptureFrozen: boolean;
  frozenInterval: Readonly<FrozenInterval> | null;
}

export interface LoadRecordRevision {
  identity: Readonly<LoadRecordIdentity>;
  versioning: Readonly<LoadRecordVersioning>;
  policy: Readonly<LoadRecordPolicy>;
  status: Readonly<LoadRecordStatus>;
  environment: Readonly<LoadRecordEnvironment>;
  timing: Readonly<LoadRecordTiming>;
  evidence: Readonly<LoadRecordEvidence>;
  caps: Readonly<LoadRecordCaps>;
  finalized: boolean;
}

export interface LoadRecordInit {
  identity: Omit<LoadRecordIdentity, "revisionId">;
  versioning: Omit<LoadRecordVersioning, "schemaVersion" | "semanticsVersion">;
  policy: LoadRecordPolicy;
  status: Omit<LoadRecordStatus, "terminalOutcome" | "uncertaintyReasons"> & Partial<Pick<LoadRecordStatus, "terminalOutcome" | "uncertaintyReasons">>;
  environment: LoadRecordEnvironment;
  timing: LoadRecordTiming;
  caps?: RecordCapPolicy;
}

export interface AppendResult {
  appended: boolean;
  sequence: number;
  reason?: DropReason;
}

export class LoadRecord {
  readonly recordId: string;

  private readonly initial: LoadRecordInit;
  private readonly caps: RecordCapPolicy;
  private readonly events: RawEvent[] = [];
  private readonly compactedSegments: CompactedSegment[] = [];
  private readonly droppedEvents: DroppedEventSummary[] = [];
  private readonly derivedBlocks: DerivedBlock[] = [];
  private rawFrozen = false;
  private frozenInterval: FrozenInterval | null = null;
  private revisionId = 0;
  private dirty = true;
  private finalized = false;
  private terminalOutcome: TerminalOutcome | null;
  private uncertaintyReasons: readonly string[];
  private cachedRevision: Readonly<LoadRecordRevision> | null = null;

  constructor(init: LoadRecordInit) {
    this.initial = deepFreezeCopy(init);
    this.recordId = init.identity.recordId;
    this.caps = deepFreezeCopy(init.caps ?? DEFAULT_RECORD_CAP_POLICY);
    this.terminalOutcome = init.status.terminalOutcome ?? null;
    this.uncertaintyReasons = deepFreezeCopy(init.status.uncertaintyReasons ?? []);
    if (this.serializedSizes(this.revisionId).totalBytes > this.caps.totalBytes) {
      throw new RangeError("Initial LoadRecord envelope exceeds the total-record cap");
    }
  }

  append(event: RawEvent): AppendResult {
    this.assertEventIdentity(event);
    if (this.rawFrozen) return this.coalesceDrop(event, "total_cap_frozen");

    let candidate = this.encodeRawWith(event);
    while (candidate.byteLength > this.caps.rawBytes && this.events.length > 0) {
      this.compactOldestEvent();
      candidate = this.encodeRawWith(event);
    }
    if (candidate.byteLength > this.caps.rawBytes) {
      return this.coalesceDrop(event, "raw_cap");
    }
    if (this.encodedTotalWith(event).byteLength > this.caps.totalBytes) {
      this.freezeRawAt(event.eventTimeMs);
      return this.coalesceDrop(event, "total_cap");
    }

    this.events.push(deepFreezeCopy(event));
    this.markDirty();
    return { appended: true, sequence: event.sequence };
  }

  appendDerivedBlock(block: Omit<DerivedBlock, "rawEventCutoffSequence">): boolean {
    if (this.finalized) return false;
    const candidate: DerivedBlock = deepFreezeCopy({
      ...block,
      rawEventCutoffSequence: this.rawEventCutoffSequence(),
    });
    this.derivedBlocks.push(candidate);
    if (!this.fitTotalCap()) {
      this.derivedBlocks.pop();
      return false;
    }
    this.markDirty();
    return true;
  }

  checkpoint(): Readonly<LoadRecordRevision> {
    if (!this.dirty && this.cachedRevision) return this.cachedRevision;
    const nextRevisionId = this.revisionId + 1;
    if (!this.fitTotalCap(nextRevisionId)) {
      throw new RangeError("LoadRecord checkpoint exceeds the total-record cap");
    }
    this.revisionId = nextRevisionId;
    this.cachedRevision = deepFreezeCopy(this.buildRevision(this.revisionId));
    this.dirty = false;
    return this.cachedRevision;
  }

  finalize(outcome: TerminalOutcome, uncertaintyReasons: readonly string[] = []): Readonly<LoadRecordRevision> {
    if (this.finalized) return this.checkpoint();
    this.terminalOutcome = outcome;
    this.uncertaintyReasons = deepFreezeCopy(uncertaintyReasons);
    this.finalized = true;
    if (!this.fitTotalCap()) {
      throw new RangeError("Final LoadRecord status exceeds the total-record cap");
    }
    this.markDirty();
    return this.checkpoint();
  }

  snapshot(): Readonly<LoadRecordRevision> {
    return deepFreezeCopy(this.buildRevision(this.revisionId));
  }

  private assertEventIdentity(event: RawEvent): void {
    if (event.recordId !== this.recordId || event.sceneId !== this.initial.identity.sceneId) {
      throw new Error("Raw event identity does not match its LoadRecord");
    }
  }

  private encodeRawWith(event: RawEvent): Uint8Array {
    return encodeJson({
      rawEvents: [...this.events, event],
      compactedSegments: this.compactedSegments,
      droppedEvents: this.droppedEvents,
    });
  }

  private encodedTotalWith(event: RawEvent): Uint8Array {
    const events = this.events;
    this.events.push(event);
    const encoded = encodeJson(this.buildRevision(this.revisionId));
    this.events.pop();
    if (this.events !== events) throw new Error("LoadRecord event storage changed unexpectedly");
    return encoded;
  }

  private compactOldestEvent(): void {
    const event = this.events.shift();
    if (!event) return;
    const previous = last(this.compactedSegments);
    if (previous && previous.lastSequence < event.sequence) {
      previous.lastSequence = event.sequence;
      previous.eventCount += 1;
      previous.eventTimeRange.endMs = event.eventTimeMs;
      previous.perTypeCounts = Object.freeze({
        ...previous.perTypeCounts,
        [event.type]: (previous.perTypeCounts[event.type] ?? 0) + 1,
      });
    } else {
      this.compactedSegments.push({
        firstSequence: event.sequence,
        lastSequence: event.sequence,
        eventCount: 1,
        eventTimeRange: { startMs: event.eventTimeMs, endMs: event.eventTimeMs },
        perTypeCounts: Object.freeze({ [event.type]: 1 }),
      });
    }
    this.markDirty();
  }

  private coalesceDrop(event: RawEvent, reason: DropReason): AppendResult {
    const previous = last(this.droppedEvents);
    if (previous && previous.eventType === event.type && previous.reason === reason) {
      previous.count += 1;
      previous.eventTimeRange.endMs = event.eventTimeMs;
    } else {
      this.droppedEvents.push({
        eventType: event.type,
        eventTimeRange: { startMs: event.eventTimeMs, endMs: event.eventTimeMs },
        count: 1,
        reason,
      });
    }
    if (this.frozenInterval) this.frozenInterval.endMs = event.eventTimeMs;
    while (this.rawSize() > this.caps.rawBytes && this.events.length > 0) {
      this.compactOldestEvent();
    }
    if (this.rawSize() > this.caps.rawBytes) {
      throw new RangeError("Dropped-event boundary cannot fit within the raw-log cap");
    }
    if (!this.fitTotalCap()) {
      throw new RangeError("Dropped-event boundary cannot fit within the total-record cap");
    }
    this.markDirty();
    return { appended: false, sequence: event.sequence, reason };
  }

  private freezeRawAt(eventTimeMs: number): void {
    this.rawFrozen = true;
    this.frozenInterval = { startMs: eventTimeMs, endMs: eventTimeMs };
    this.markDirty();
  }

  private fitTotalCap(revisionId = this.revisionId): boolean {
    while (this.serializedSizes(revisionId).totalBytes > this.caps.totalBytes && this.events.length > 0) {
      this.compactOldestEvent();
    }
    return this.serializedSizes(revisionId).totalBytes <= this.caps.totalBytes;
  }

  private rawEventCutoffSequence(): number | null {
    const compacted = last(this.compactedSegments)?.lastSequence;
    return last(this.events)?.sequence ?? compacted ?? null;
  }

  private buildRevision(revisionId: number): LoadRecordRevision {
    const sizes = this.serializedSizes(revisionId);
    return this.buildRevisionWithSizes(revisionId, sizes.rawBytes, sizes.totalBytes);
  }

  private rawSize(): number {
    return encodeJson({
      rawEvents: this.events,
      compactedSegments: this.compactedSegments,
      droppedEvents: this.droppedEvents,
    }).byteLength;
  }

  private serializedSizes(revisionId: number): { rawBytes: number; totalBytes: number } {
    const initial = this.serializedSizesWithoutSizeFields(revisionId);
    let totalBytes = initial.totalBytes;
    let nextTotalBytes = encodeJson(this.buildRevisionWithSizes(revisionId, initial.rawBytes, totalBytes)).byteLength;
    while (nextTotalBytes !== totalBytes) {
      totalBytes = nextTotalBytes;
      nextTotalBytes = encodeJson(this.buildRevisionWithSizes(revisionId, initial.rawBytes, totalBytes)).byteLength;
    }
    return { rawBytes: initial.rawBytes, totalBytes };
  }

  private serializedSizesWithoutSizeFields(revisionId: number): { rawBytes: number; totalBytes: number } {
    const rawBytes = encodeJson({
      rawEvents: this.events,
      compactedSegments: this.compactedSegments,
      droppedEvents: this.droppedEvents,
    }).byteLength;
    const totalBytes = encodeJson(this.buildRevisionWithSizes(revisionId, rawBytes, 0)).byteLength;
    return { rawBytes, totalBytes };
  }

  private buildRevisionWithSizes(revisionId: number, currentRawBytes: number, currentTotalBytes: number): LoadRecordRevision {
    return {
      identity: { ...this.initial.identity, revisionId },
      versioning: {
        schemaVersion: LOAD_RECORD_SCHEMA_VERSION,
        semanticsVersion: LOAD_RECORD_SEMANTICS_VERSION,
        ...this.initial.versioning,
      },
      policy: this.initial.policy,
      status: {
        ...this.initial.status,
        terminalOutcome: this.terminalOutcome,
        uncertaintyReasons: this.uncertaintyReasons,
      },
      environment: this.initial.environment,
      timing: this.initial.timing,
      evidence: {
        rawEvents: this.events,
        compactedSegments: this.compactedSegments,
        droppedEvents: this.droppedEvents,
        derivedBlocks: this.derivedBlocks,
        rawEventCutoffSequence: this.rawEventCutoffSequence(),
      },
      caps: {
        policyVersion: this.caps.version,
        rawBytes: this.caps.rawBytes,
        totalBytes: this.caps.totalBytes,
        currentRawBytes,
        currentTotalBytes,
        rawCaptureFrozen: this.rawFrozen,
        frozenInterval: this.frozenInterval,
      },
      finalized: this.finalized,
    };
  }

  private markDirty(): void {
    this.dirty = true;
    this.cachedRevision = null;
  }
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function last<T>(values: readonly T[]): T | undefined {
  return values[values.length - 1];
}

function deepFreezeCopy<T>(value: T): T {
  return deepFreeze(JSON.parse(JSON.stringify(value)) as T);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
