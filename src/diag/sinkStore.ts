import type { LoadRecordRevision, SinkStatusEntry } from "./LoadRecord";
import { DEFAULT_STORAGE_POLICY, type StoragePolicy } from "./policies";
import type { PageHideContext, SinkCapabilities, SinkPersistence, TelemetrySink } from "./sinks";

export type StoreConsent = "granted" | "denied" | "pending";
export type PartitioningResult = "unpartitioned" | "partitioned" | "unknown";

export interface StoreSinkOptions {
  readonly ephemeralMeasurementConsent: StoreConsent;
  readonly localPersistenceConsent: StoreConsent;
  readonly databaseName?: string;
  readonly indexedDB?: IDBFactory | null;
  readonly detectPartitioning?: () => PartitioningResult | Promise<PartitioningResult>;
  readonly policy?: StoragePolicy;
  readonly now?: () => number;
}

export interface StoreSink extends TelemetrySink {
  readonly name: "store";
  ready(): Promise<Readonly<SinkCapabilities>>;
  exportRecords(): Promise<readonly Readonly<LoadRecordRevision>[]>;
}

interface StoredRecord {
  readonly recordId: string;
  readonly revisionId: number;
  readonly finalized: boolean;
  readonly updatedAtMs: number;
  readonly sizeBytes: number;
  readonly record: Readonly<LoadRecordRevision>;
}

interface MetaEntry {
  readonly key: string;
  readonly value: number;
}

const DATABASE_VERSION = 1;
const RECORDS_STORE = "records";
const META_STORE = "meta";
const PENDING_EVICTIONS_KEY = "pendingEvictions";

export function createStoreSink(options: Readonly<StoreSinkOptions>): StoreSink {
  const policy = options.policy ?? DEFAULT_STORAGE_POLICY;
  const now = options.now ?? (() => performance.now());
  const idb = options.indexedDB === undefined ? resolveIndexedDb() : options.indexedDB;
  const databaseName = options.databaseName ?? "sparkjs-load-telemetry-v1";
  const memory = new Map<string, StoredRecord>();
  let memoryEvictionsPending = 0;
  let database: IDBDatabase | null = null;
  let initialization: Promise<void> | null = null;
  let persistence: SinkPersistence = initialPersistence(options);
  let partitioned = false;
  let quota: SinkCapabilities["quota"] = "unknown";
  let fallbackTier: string | null = null;
  let lastSuccessMs: number | null = null;
  let lastFailureMs: number | null = null;

  const capabilities = (): Readonly<SinkCapabilities> => Object.freeze({
    available: options.ephemeralMeasurementConsent === "granted" && (database !== null || fallbackTier === "memory"),
    consent: options.localPersistenceConsent,
    persistence,
    partitioned,
    quota,
    lastSuccessMs,
    lastFailureMs,
    fallbackTier,
    status: persistence,
  });

  const useMemory = (record: Readonly<LoadRecordRevision>): void => {
    if (options.ephemeralMeasurementConsent !== "granted") return;
    const withStatus = memoryEvictionsPending > 0
      ? appendEvictionStatus(record, memoryEvictionsPending, now())
      : deepFreezeCopy(record);
    memoryEvictionsPending = 0;
    const candidate = toStoredRecord(withStatus, now());
    const previous = memory.get(candidate.recordId);
    if (!previous || candidate.revisionId > previous.revisionId) memory.set(candidate.recordId, candidate);
    memoryEvictionsPending += evictStoredRecords(memory, policy.memoryFallbackMaxRecords, policy.memoryFallbackMaxBytes);
    fallbackTier = "memory";
    lastSuccessMs = now();
  };

  const initialize = async (): Promise<void> => {
    if (options.ephemeralMeasurementConsent !== "granted" || options.localPersistenceConsent !== "granted") {
      fallbackTier = options.ephemeralMeasurementConsent === "granted" ? "memory" : null;
      return;
    }
    if (!idb) {
      persistence = "unavailable";
      fallbackTier = "memory";
      return;
    }
    try {
      const partitioning = await detectPartitioning(options.detectPartitioning);
      if (partitioning === "partitioned") {
        persistence = "partitioned";
        partitioned = true;
        fallbackTier = "memory";
        return;
      }
      if (partitioning === "unknown") {
        persistence = "memory_fallback";
        fallbackTier = "memory";
        return;
      }
      database = await openDatabase(idb, databaseName);
      persistence = "persistent";
      quota = "available";
      fallbackTier = null;
    } catch (error) {
      lastFailureMs = now();
      if (isDeniedError(error)) persistence = "denied";
      else if (isQuotaError(error)) {
        persistence = "memory_fallback";
        quota = "exceeded";
      } else persistence = "unavailable";
      fallbackTier = "memory";
    }
  };

  const ensureInitialized = (): Promise<void> => {
    initialization ??= initialize();
    return initialization;
  };

  const onRecord = async (record: Readonly<LoadRecordRevision>): Promise<void> => {
    if (options.ephemeralMeasurementConsent !== "granted") return;
    await ensureInitialized();
    if (!database) {
      useMemory(record);
      return;
    }
    try {
      await persistRevision(database, record, policy, now);
      persistence = "persistent";
      quota = "available";
      lastSuccessMs = now();
    } catch (error) {
      lastFailureMs = now();
      if (isQuotaError(error)) quota = "exceeded";
      persistence = "memory_fallback";
      fallbackTier = "memory";
      database.close();
      database = null;
      useMemory(record);
    }
  };

  return Object.freeze({
    name: "store" as const,
    capabilities,
    async ready(): Promise<Readonly<SinkCapabilities>> {
      await ensureInitialized();
      return capabilities();
    },
    onRecord,
    async onPageHide(context: Readonly<PageHideContext>): Promise<void> {
      await onRecord(context.record);
    },
    async exportRecords(): Promise<readonly Readonly<LoadRecordRevision>[]> {
      await ensureInitialized();
      const persistent = database ? await readAllRecords(database) : [];
      const combined = new Map<string, StoredRecord>();
      for (const stored of [...persistent, ...memory.values()]) {
        const previous = combined.get(stored.recordId);
        if (!previous || stored.revisionId > previous.revisionId) combined.set(stored.recordId, stored);
      }
      return Object.freeze([...combined.values()]
        .sort((left, right) => left.updatedAtMs - right.updatedAtMs)
        .map((stored) => deepFreezeCopy(stored.record)));
    },
  });
}

function initialPersistence(options: Readonly<StoreSinkOptions>): SinkPersistence {
  if (options.ephemeralMeasurementConsent !== "granted") return "denied";
  if (options.localPersistenceConsent === "denied") return "denied";
  if (options.localPersistenceConsent === "pending") return "unavailable";
  return "unavailable";
}

function resolveIndexedDb(): IDBFactory | null {
  return typeof globalThis.indexedDB === "object" ? globalThis.indexedDB : null;
}

async function detectPartitioning(
  detector: StoreSinkOptions["detectPartitioning"],
): Promise<PartitioningResult> {
  if (detector) return detector();
  if (typeof globalThis.window !== "object") return "unknown";
  if (globalThis.window.top === globalThis.window) return "unpartitioned";
  const documentWithStorageAccess = globalThis.document as Document & { hasStorageAccess?: () => Promise<boolean> };
  if (typeof documentWithStorageAccess.hasStorageAccess !== "function") return "unknown";
  return await documentWithStorageAccess.hasStorageAccess() ? "unpartitioned" : "partitioned";
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RECORDS_STORE)) db.createObjectStore(RECORDS_STORE, { keyPath: "recordId" });
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
}

async function persistRevision(
  database: IDBDatabase,
  record: Readonly<LoadRecordRevision>,
  policy: StoragePolicy,
  now: () => number,
): Promise<void> {
  const transaction = database.transaction([RECORDS_STORE, META_STORE], "readwrite");
  const records = transaction.objectStore(RECORDS_STORE);
  const meta = transaction.objectStore(META_STORE);
  const existing = await requestResult<StoredRecord | undefined>(records.get(record.identity.recordId));
  const pending = await requestResult<MetaEntry | undefined>(meta.get(PENDING_EVICTIONS_KEY));
  if (!existing || record.identity.revisionId > existing.revisionId) {
    const revision = pending && pending.value > 0 ? appendEvictionStatus(record, pending.value, now()) : deepFreezeCopy(record);
    await requestResult(records.put(toStoredRecord(revision, now())));
    if (pending && pending.value > 0) await requestResult(meta.put({ key: PENDING_EVICTIONS_KEY, value: 0 } satisfies MetaEntry));
  }
  const all = await requestResult<StoredRecord[]>(records.getAll());
  const evicted = selectEvictions(all, policy.maxRecords, policy.maxBytes);
  for (const entry of evicted) await requestResult(records.delete(entry.recordId));
  if (evicted.length > 0) {
    const currentPending = await requestResult<MetaEntry | undefined>(meta.get(PENDING_EVICTIONS_KEY));
    await requestResult(meta.put({ key: PENDING_EVICTIONS_KEY, value: (currentPending?.value ?? 0) + evicted.length } satisfies MetaEntry));
  }
  await transactionDone(transaction);
}

function readAllRecords(database: IDBDatabase): Promise<StoredRecord[]> {
  const transaction = database.transaction(RECORDS_STORE, "readonly");
  return requestResult<StoredRecord[]>(transaction.objectStore(RECORDS_STORE).getAll());
}

function toStoredRecord(record: Readonly<LoadRecordRevision>, updatedAtMs: number): StoredRecord {
  const snapshot = deepFreezeCopy(record);
  return {
    recordId: snapshot.identity.recordId,
    revisionId: snapshot.identity.revisionId,
    finalized: snapshot.finalized,
    updatedAtMs,
    sizeBytes: encodeJson(snapshot).byteLength,
    record: snapshot,
  };
}

function appendEvictionStatus(
  record: Readonly<LoadRecordRevision>,
  count: number,
  eventTimeMs: number,
): Readonly<LoadRecordRevision> {
  const entry: SinkStatusEntry = {
    sinkName: "store",
    status: "evicted_complete_oldest",
    eventTimeMs,
    detail: `${count} record${count === 1 ? "" : "s"}`,
  };
  return deepFreezeCopy({
    ...record,
    status: { ...record.status, sinkHistory: [...record.status.sinkHistory, entry] },
  });
}

function evictStoredRecords(records: Map<string, StoredRecord>, maxRecords: number, maxBytes: number): number {
  const evictions = selectEvictions([...records.values()], maxRecords, maxBytes);
  for (const entry of evictions) records.delete(entry.recordId);
  return evictions.length;
}

function selectEvictions(records: readonly StoredRecord[], maxRecords: number, maxBytes: number): readonly StoredRecord[] {
  let count = records.length;
  let bytes = records.reduce((total, record) => total + record.sizeBytes, 0);
  const ordered = [...records].sort((left, right) => {
    if (left.finalized !== right.finalized) return left.finalized ? -1 : 1;
    return left.updatedAtMs - right.updatedAtMs;
  });
  const evicted: StoredRecord[] = [];
  for (const record of ordered) {
    if (count <= maxRecords && bytes <= maxBytes) break;
    evicted.push(record);
    count -= 1;
    bytes -= record.sizeBytes;
  }
  return evicted;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function isDeniedError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "QuotaExceededError";
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
