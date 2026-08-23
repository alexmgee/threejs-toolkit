import type { LoadRecordRevision } from "./LoadRecord";
import type { SinkOperation } from "./events";

export type SinkPersistence = "persistent" | "partitioned" | "denied" | "memory_fallback" | "unavailable";

export interface SinkCapabilities {
  available: boolean;
  consent: "granted" | "denied" | "pending" | "not_required";
  persistence: SinkPersistence;
  partitioned: boolean;
  quota: "available" | "limited" | "exceeded" | "unknown";
  lastSuccessMs: number | null;
  lastFailureMs: number | null;
  fallbackTier: string | null;
  status: string;
}

export interface PageHideContext {
  recordId: string;
  revisionId: number;
  eventTimeMs: number;
  persisted: boolean;
  record: Readonly<LoadRecordRevision>;
}

export interface TelemetrySink {
  readonly name: string;
  capabilities(): Readonly<SinkCapabilities>;
  onRecord(record: Readonly<LoadRecordRevision>): Promise<void> | void;
  onPageHide(context: Readonly<PageHideContext>): Promise<void> | void;
}

export interface SinkFailureStatus {
  sinkName: string;
  operation: SinkOperation;
  reason: "rejection" | "timeout";
  message: string;
}

export interface SinkFanoutOptions {
  deadlineMs: number;
  statusRevision(failure: Readonly<SinkFailureStatus>): Readonly<LoadRecordRevision> | undefined;
}

export interface TelemetryFanout {
  onRecord(record: Readonly<LoadRecordRevision>): Promise<void>;
  onPageHide(context: Readonly<PageHideContext>): Promise<void>;
  capabilities(): Readonly<Record<string, Readonly<SinkCapabilities>>>;
}

export function createTelemetryFanout(sinks: readonly TelemetrySink[], options: Readonly<SinkFanoutOptions>): TelemetryFanout {
  const sinkList = Object.freeze([...sinks]);

  return Object.freeze({
    async onRecord(record: Readonly<LoadRecordRevision>): Promise<void> {
      const snapshot = deepFreezeCopy(record);
      await deliver(sinkList, "onRecord", options, (sink) => sink.onRecord(snapshot));
    },
    async onPageHide(context: Readonly<PageHideContext>): Promise<void> {
      const snapshot = deepFreezeCopy(context);
      await deliver(sinkList, "onPageHide", options, (sink) => sink.onPageHide(snapshot));
    },
    capabilities(): Readonly<Record<string, Readonly<SinkCapabilities>>> {
      const result: Record<string, Readonly<SinkCapabilities>> = {};
      for (const sink of sinkList) {
        try {
          result[sink.name] = deepFreezeCopy(sink.capabilities());
        } catch {
          result[sink.name] = Object.freeze({
            available: false,
            consent: "not_required",
            persistence: "unavailable",
            partitioned: false,
            quota: "unknown",
            lastSuccessMs: null,
            lastFailureMs: null,
            fallbackTier: null,
            status: "capability_report_failed",
          });
        }
      }
      return Object.freeze(result);
    },
  });
}

async function deliver(
  sinks: readonly TelemetrySink[],
  operation: "onRecord" | "onPageHide",
  options: Readonly<SinkFanoutOptions>,
  invoke: (sink: TelemetrySink) => Promise<void> | void,
): Promise<void> {
  const results = await Promise.allSettled(sinks.map((sink) => withDeadline(sink, operation, options.deadlineMs, invoke)));
  const failures = results.flatMap((result) => result.status === "rejected" ? [asFailure(result.reason, operation)] : []);
  await Promise.allSettled(failures.map(async (failure) => {
    const statusRecord = options.statusRevision(failure);
    if (!statusRecord) return;
    const snapshot = deepFreezeCopy(statusRecord);
    const survivors = sinks.filter((sink) => sink.name !== failure.sinkName);
    await Promise.allSettled(survivors.map((sink) => withDeadline(sink, "onRecord", options.deadlineMs, (target) => target.onRecord(snapshot))));
  }));
}

async function withDeadline(
  sink: TelemetrySink,
  operation: "onRecord" | "onPageHide",
  deadlineMs: number,
  invoke: (sink: TelemetrySink) => Promise<void> | void,
): Promise<void> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => reject({ sinkName: sink.name, operation, reason: "timeout", message: "Sink deadline exceeded" } satisfies SinkFailureStatus), deadlineMs);
  });
  try {
    await Promise.race([Promise.resolve().then(() => invoke(sink)), timeout]);
  } catch (error) {
    if (isSinkFailure(error)) throw error;
    throw {
      sinkName: sink.name,
      operation,
      reason: "rejection",
      message: error instanceof Error ? error.message : String(error),
    } satisfies SinkFailureStatus;
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

function asFailure(reason: unknown, operation: SinkOperation): Readonly<SinkFailureStatus> {
  if (isSinkFailure(reason)) return Object.freeze(reason);
  return Object.freeze({ sinkName: "unknown", operation, reason: "rejection", message: String(reason) });
}

function isSinkFailure(value: unknown): value is SinkFailureStatus {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<SinkFailureStatus>;
  return typeof candidate.sinkName === "string" && (candidate.reason === "rejection" || candidate.reason === "timeout");
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
