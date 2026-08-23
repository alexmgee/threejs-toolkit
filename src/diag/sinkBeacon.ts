import type { DerivedBlock, LoadRecordRevision } from "./LoadRecord";
import { DEFAULT_BEACON_POLICY, type BeaconPolicy } from "./policies";
import type { PageHideContext, SinkCapabilities, TelemetrySink } from "./sinks";

export const BEACON_PROTOCOL_VERSION = "1";

export type RemoteConsentCheck = boolean | (() => boolean);
export type CheckpointReason =
  | "event_threshold"
  | "byte_threshold"
  | "derived_update"
  | "terminal_transition"
  | "periodic_foreground"
  | "suspension"
  | "abandonment";

export interface BeaconEventSequenceRange {
  readonly first: number | null;
  readonly last: number | null;
}

export interface CompactRawEvent {
  readonly sequence: number;
  readonly eventTimeMs: number;
  readonly type: string;
  readonly source: string;
  readonly payload: unknown;
}

export interface CompactDerivedSummary {
  readonly name: string;
  readonly policyVersion: string;
  readonly rawEventCutoffSequence: number | null;
  readonly value: unknown;
}

export interface BeaconEnvelope {
  readonly protocolVersion: string;
  readonly recordId: string;
  readonly revisionId: number;
  readonly sourceRevisionId: number;
  readonly loadId: string;
  readonly sceneId: string;
  readonly eventSequenceRange: Readonly<BeaconEventSequenceRange>;
  readonly rawEventDelta: readonly Readonly<CompactRawEvent>[];
  readonly derivedSummaryDelta: readonly Readonly<CompactDerivedSummary>[];
  readonly declaredGaps: readonly string[];
  readonly checkpointReason: CheckpointReason;
  readonly lifecycle: Readonly<{ persisted: boolean; outcome: "suspended" | "abandoned" }> | null;
  readonly checksum: string;
}

export interface BeaconSinkOptions {
  readonly policy?: BeaconPolicy;
  readonly now?: () => number;
  readonly sendBeacon?: (endpoint: string, body: Uint8Array) => boolean;
  readonly asyncTransport?: (endpoint: string, body: Uint8Array, envelope: Readonly<BeaconEnvelope>) => Promise<boolean>;
}

export interface BeaconSink extends TelemetrySink {
  readonly name: "beacon";
  exportPending(): readonly Readonly<BeaconEnvelope>[];
  retryPending(): void;
}

interface RecordCheckpointState {
  nextRevisionId: number;
  lastSourceRevisionId: number;
  lastSequence: number;
  lastTerminalOutcome: string | null;
  lastCheckpointMs: number | null;
  derivedChecksums: Map<string, string>;
  urgencyKeys: Set<string>;
}

interface EnvelopeDraft {
  readonly raw: readonly Readonly<CompactRawEvent>[];
  readonly derived: readonly Readonly<CompactDerivedSummary>[];
  readonly gaps: readonly string[];
}

const MAX_COMPACT_STRING_CHARACTERS = 512;
const MAX_DECLARED_GAPS = 32;

export function createBeaconSink(
  telemetryEndpoint: string | undefined,
  remoteConsent: RemoteConsentCheck,
  options: Readonly<BeaconSinkOptions> = {},
): BeaconSink {
  const policy = options.policy ?? DEFAULT_BEACON_POLICY;
  const now = options.now ?? (() => performance.now());
  const sendBeacon = options.sendBeacon ?? resolveSendBeacon();
  const asyncTransport = options.asyncTransport ?? resolveAsyncTransport();
  const states = new Map<string, RecordCheckpointState>();
  const pending = new Map<string, Readonly<BeaconEnvelope>>();
  const inFlight = new Set<string>();
  let lastSuccessMs: number | null = null;
  let lastFailureMs: number | null = null;

  const gateOpen = (): boolean => isValidEndpoint(telemetryEndpoint) && consentGranted(remoteConsent);

  const capabilities = (): Readonly<SinkCapabilities> => {
    const consent = consentGranted(remoteConsent) ? "granted" : "denied";
    const active = gateOpen();
    return Object.freeze({
      available: active && (sendBeacon !== undefined || asyncTransport !== undefined),
      consent,
      persistence: "unavailable",
      partitioned: false,
      quota: "unknown",
      lastSuccessMs,
      lastFailureMs,
      fallbackTier: pending.size > 0 ? "local_export" : null,
      status: active ? "active" : "dormant",
    });
  };

  const kickAsync = (envelopes: readonly Readonly<BeaconEnvelope>[]): void => {
    if (!gateOpen() || !asyncTransport || !telemetryEndpoint) return;
    for (const envelope of envelopes) {
      const key = envelopeKey(envelope);
      if (inFlight.has(key) || !pending.has(key)) continue;
      inFlight.add(key);
      const body = encodeJson(envelope);
      void asyncTransport(telemetryEndpoint, body, envelope).then((accepted) => {
        if (accepted) {
          pending.delete(key);
          lastSuccessMs = now();
        } else {
          lastFailureMs = now();
        }
      }, () => {
        lastFailureMs = now();
      }).finally(() => {
        inFlight.delete(key);
      });
    }
  };

  const createCheckpoint = (
    record: Readonly<LoadRecordRevision>,
    reason: CheckpointReason,
    lifecycle: BeaconEnvelope["lifecycle"] = null,
  ): readonly Readonly<BeaconEnvelope>[] => {
    if (!gateOpen()) return [];
    const state = getState(states, record.identity.recordId);
    const urgencyKey = lifecycle ? `${record.identity.revisionId}:${reason}:${lifecycle.persisted}` : null;
    if (urgencyKey && state.urgencyKeys.has(urgencyKey)) return [];
    if (!lifecycle && record.identity.revisionId <= state.lastSourceRevisionId) return [];

    const raw = record.evidence.rawEvents
      .filter((event) => event.sequence > state.lastSequence)
      .map((event): CompactRawEvent => ({
        sequence: event.sequence,
        eventTimeMs: event.eventTimeMs,
        type: event.type,
        source: event.source,
        payload: event.payload,
      }));
    const derived = record.evidence.derivedBlocks
      .filter((block) => state.derivedChecksums.get(block.name) !== checksumJson(block))
      .map(toCompactDerived);
    const evidenceGaps = [
      ...record.evidence.compactedSegments.map((segment) =>
        `raw_compacted:${segment.firstSequence}-${segment.lastSequence}:${segment.eventCount}`
      ),
      ...record.evidence.droppedEvents.map((drop) =>
        `raw_dropped:${drop.eventType}:${drop.eventTimeRange.startMs}-${drop.eventTimeRange.endMs}:${drop.count}:${drop.reason}`
      ),
    ];
    const baseGaps = compactGaps([...record.status.declaredGaps, ...evidenceGaps]);
    const drafts = fitDeltas(record, state.nextRevisionId, raw, derived, baseGaps, reason, lifecycle, policy);
    const envelopes: Readonly<BeaconEnvelope>[] = [];
    for (const draft of drafts) {
      const envelope = finalizeEnvelope(record, state.nextRevisionId, draft, reason, lifecycle);
      if (encodeJson(envelope).byteLength >= policy.maxEnvelopeBytesExclusive) {
        throw new RangeError("Beacon envelope does not fit the strict UTF-8 cap");
      }
      state.nextRevisionId += 1;
      pending.set(envelopeKey(envelope), envelope);
      envelopes.push(envelope);
    }
    if (raw.length > 0) state.lastSequence = raw[raw.length - 1].sequence;
    for (const block of record.evidence.derivedBlocks) state.derivedChecksums.set(block.name, checksumJson(block));
    state.lastSourceRevisionId = Math.max(state.lastSourceRevisionId, record.identity.revisionId);
    state.lastTerminalOutcome = record.status.terminalOutcome;
    state.lastCheckpointMs = now();
    if (urgencyKey) state.urgencyKeys.add(urgencyKey);
    return envelopes;
  };

  const onRecord = (record: Readonly<LoadRecordRevision>): void => {
    if (!gateOpen()) return;
    try {
      const state = getState(states, record.identity.recordId);
      const nonPersistedHide = record.evidence.rawEvents.some((event) =>
        event.sequence > state.lastSequence && event.type === "pagehide" && event.payload.persisted === false
      );
      if (nonPersistedHide) {
        const created = createCheckpoint(record, "abandonment", Object.freeze({ persisted: false, outcome: "abandoned" }));
        sendUrgentLatest(created, telemetryEndpoint, remoteConsent, sendBeacon, pending, kickAsync, () => {
          lastSuccessMs = now();
        }, () => {
          lastFailureMs = now();
        });
      } else {
        kickAsync(createCheckpoint(record, checkpointReason(record, state)));
      }
    } catch {
      lastFailureMs = now();
    }
  };

  return Object.freeze({
    name: "beacon" as const,
    capabilities,
    onRecord,
    onPageHide(context: Readonly<PageHideContext>): void {
      if (!gateOpen()) return;
      try {
        const reason: CheckpointReason = context.persisted ? "suspension" : "abandonment";
        const lifecycle = Object.freeze({
          persisted: context.persisted,
          outcome: context.persisted ? "suspended" as const : "abandoned" as const,
        });
        const created = createCheckpoint(context.record, reason, lifecycle);
        sendUrgentLatest(created, telemetryEndpoint, remoteConsent, sendBeacon, pending, kickAsync, () => {
          lastSuccessMs = now();
        }, () => {
          lastFailureMs = now();
        });
      } catch {
        lastFailureMs = now();
      }
    },
    exportPending(): readonly Readonly<BeaconEnvelope>[] {
      return Object.freeze([...pending.values()]
        .sort((left, right) => left.revisionId - right.revisionId)
        .map((envelope) => deepFreezeCopy(envelope)));
    },
    retryPending(): void {
      kickAsync([...pending.values()]);
    },
  });
}

function sendUrgentLatest(
  created: readonly Readonly<BeaconEnvelope>[],
  endpoint: string | undefined,
  remoteConsent: RemoteConsentCheck,
  sendBeacon: BeaconSinkOptions["sendBeacon"],
  pending: Map<string, Readonly<BeaconEnvelope>>,
  kickAsync: (envelopes: readonly Readonly<BeaconEnvelope>[]) => void,
  onSuccess: () => void,
  onFailure: () => void,
): void {
  const latest = created[created.length - 1];
  if (latest && sendBeacon && isValidEndpoint(endpoint) && consentGranted(remoteConsent)) {
    try {
      const accepted = sendBeacon(endpoint, encodeJson(latest));
      if (accepted) {
        pending.delete(envelopeKey(latest));
        onSuccess();
      } else {
        onFailure();
      }
    } catch {
      onFailure();
    }
  }
  kickAsync([...created.slice(0, -1), ...(latest && pending.has(envelopeKey(latest)) ? [latest] : [])]);
}

function checkpointReason(record: Readonly<LoadRecordRevision>, state: RecordCheckpointState): CheckpointReason {
  if (record.status.terminalOutcome !== null && record.status.terminalOutcome !== state.lastTerminalOutcome) return "terminal_transition";
  if (record.evidence.rawEvents.some((event) => event.sequence > state.lastSequence)) return "event_threshold";
  if (record.evidence.derivedBlocks.some((block) => state.derivedChecksums.get(block.name) !== checksumJson(block))) return "derived_update";
  return "periodic_foreground";
}

function fitDeltas(
  record: Readonly<LoadRecordRevision>,
  firstRevisionId: number,
  raw: readonly Readonly<CompactRawEvent>[],
  derived: readonly Readonly<CompactDerivedSummary>[],
  gaps: readonly string[],
  reason: CheckpointReason,
  lifecycle: BeaconEnvelope["lifecycle"],
  policy: BeaconPolicy,
): readonly EnvelopeDraft[] {
  const units: Array<{ kind: "raw"; value: Readonly<CompactRawEvent> } | { kind: "derived"; value: Readonly<CompactDerivedSummary> }> = [
    ...raw.map((value) => ({ kind: "raw" as const, value })),
    ...derived.map((value) => ({ kind: "derived" as const, value })),
  ];
  const drafts: EnvelopeDraft[] = [];
  let currentRaw: Readonly<CompactRawEvent>[] = [];
  let currentDerived: Readonly<CompactDerivedSummary>[] = [];
  let currentGaps = [...gaps];

  const fits = (candidateRaw: readonly Readonly<CompactRawEvent>[], candidateDerived: readonly Readonly<CompactDerivedSummary>[]): boolean => {
    const draft = { raw: candidateRaw, derived: candidateDerived, gaps: currentGaps };
    const envelope = finalizeEnvelope(record, firstRevisionId + drafts.length, draft, reason, lifecycle);
    return encodeJson(envelope).byteLength < policy.maxEnvelopeBytesExclusive;
  };
  const flush = (): void => {
    drafts.push({ raw: currentRaw, derived: currentDerived, gaps: currentGaps });
    currentRaw = [];
    currentDerived = [];
    currentGaps = [...gaps];
  };

  for (const unit of units) {
    const nextRaw = unit.kind === "raw" ? [...currentRaw, unit.value] : currentRaw;
    const nextDerived = unit.kind === "derived" ? [...currentDerived, unit.value] : currentDerived;
    if (fits(nextRaw, nextDerived)) {
      currentRaw = nextRaw;
      currentDerived = nextDerived;
      continue;
    }
    if (currentRaw.length > 0 || currentDerived.length > 0) flush();
    const compacted = unit.kind === "raw" ? compactOversizedRaw(unit.value) : compactOversizedDerived(unit.value);
    currentGaps = [...gaps, unit.kind === "raw" ? "oversized_raw_payload_compacted" : "oversized_derived_summary_compacted"];
    if (unit.kind === "raw") currentRaw = [compacted as CompactRawEvent];
    else currentDerived = [compacted as CompactDerivedSummary];
    if (!fits(currentRaw, currentDerived)) throw new RangeError("Beacon protocol metadata exceeds its configured envelope cap");
  }
  if (currentRaw.length > 0 || currentDerived.length > 0 || drafts.length === 0) flush();
  return drafts;
}

function finalizeEnvelope(
  record: Readonly<LoadRecordRevision>,
  revisionId: number,
  draft: Readonly<EnvelopeDraft>,
  reason: CheckpointReason,
  lifecycle: BeaconEnvelope["lifecycle"],
): Readonly<BeaconEnvelope> {
  const sequences = draft.raw.map((event) => event.sequence);
  const withoutChecksum = {
    protocolVersion: BEACON_PROTOCOL_VERSION,
    recordId: record.identity.recordId,
    revisionId,
    sourceRevisionId: record.identity.revisionId,
    loadId: record.identity.loadId,
    sceneId: record.identity.sceneId,
    eventSequenceRange: {
      first: sequences.length > 0 ? Math.min(...sequences) : null,
      last: sequences.length > 0 ? Math.max(...sequences) : null,
    },
    rawEventDelta: draft.raw,
    derivedSummaryDelta: draft.derived,
    declaredGaps: draft.gaps,
    checkpointReason: reason,
    lifecycle,
  };
  return deepFreezeCopy({ ...withoutChecksum, checksum: checksumJson(withoutChecksum) });
}

function compactOversizedRaw(event: Readonly<CompactRawEvent>): Readonly<CompactRawEvent> {
  return {
    ...event,
    payload: {
      compacted: true,
      originalBytes: encodeJson(event.payload).byteLength,
      checksum: checksumJson(event.payload),
    },
  };
}

function compactOversizedDerived(block: Readonly<CompactDerivedSummary>): Readonly<CompactDerivedSummary> {
  return {
    ...block,
    value: {
      compacted: true,
      originalBytes: encodeJson(block.value).byteLength,
      checksum: checksumJson(block.value),
    },
  };
}

function compactGaps(gaps: readonly string[]): readonly string[] {
  const unique = [...new Set(gaps.map((gap) => gap.slice(0, MAX_COMPACT_STRING_CHARACTERS)))];
  if (unique.length <= MAX_DECLARED_GAPS) return Object.freeze(unique);
  return Object.freeze([
    ...unique.slice(0, MAX_DECLARED_GAPS - 1),
    `declared_gaps_compacted:${unique.length - (MAX_DECLARED_GAPS - 1)}`,
  ]);
}

function toCompactDerived(block: Readonly<DerivedBlock>): CompactDerivedSummary {
  return {
    name: block.name,
    policyVersion: block.policyVersion,
    rawEventCutoffSequence: block.rawEventCutoffSequence,
    value: block.value,
  };
}

function getState(states: Map<string, RecordCheckpointState>, recordId: string): RecordCheckpointState {
  let state = states.get(recordId);
  if (!state) {
    state = {
      nextRevisionId: 1,
      lastSourceRevisionId: -1,
      lastSequence: 0,
      lastTerminalOutcome: null,
      lastCheckpointMs: null,
      derivedChecksums: new Map(),
      urgencyKeys: new Set(),
    };
    states.set(recordId, state);
  }
  return state;
}

function envelopeKey(envelope: Readonly<BeaconEnvelope>): string {
  return `${envelope.recordId}:${envelope.revisionId}`;
}

function consentGranted(consent: RemoteConsentCheck): boolean {
  try {
    return typeof consent === "function" ? consent() === true : consent === true;
  } catch {
    return false;
  }
}

function isValidEndpoint(endpoint: string | undefined): endpoint is string {
  if (!endpoint) return false;
  try {
    return new URL(endpoint).protocol === "https:";
  } catch {
    return false;
  }
}

function resolveSendBeacon(): BeaconSinkOptions["sendBeacon"] {
  if (typeof globalThis.navigator !== "object" || typeof globalThis.navigator.sendBeacon !== "function") return undefined;
  return (endpoint, body) => globalThis.navigator.sendBeacon(
    endpoint,
    new Blob([toArrayBuffer(body)], { type: "application/json" }),
  );
}

function resolveAsyncTransport(): BeaconSinkOptions["asyncTransport"] {
  if (typeof globalThis.fetch !== "function") return undefined;
  return async (endpoint, body) => {
    const response = await globalThis.fetch(endpoint, {
      method: "POST",
      body: toArrayBuffer(body),
      headers: { "Content-Type": "application/json" },
      keepalive: false,
      credentials: "omit",
    });
    return response.ok;
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function checksumJson(value: unknown): string {
  const bytes = encodeJson(value);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
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
