import type {
  CapturedProbeEvent,
  DisposableSource,
  NetworkSnapshot,
  NetworkSource,
} from "./LoadProbe";
import { stripSceneUrl } from "./privacy";

export interface AdapterObservedRequestKey {
  readonly requestId: string;
  readonly resourceName: string;
  readonly resourceStartTimeMs?: number;
  readonly startTimeLowerBoundMs?: number;
  readonly startTimeUpperBoundMs?: number;
}

export interface NetworkObserverOptions {
  readonly resourceUrl: string;
  readonly resourceUrlBase?: string;
  readonly performance?: Performance;
  readonly observerFactory?: (callback: PerformanceObserverCallback) => PerformanceObserver;
}

interface TimingRecord {
  readonly requestId?: string;
  readonly resourceName: string;
  readonly startTimeMs: number;
  readonly durationMs: number;
  readonly taoAvailable: boolean;
  readonly transferSize?: number;
}

const CAPABILITIES = Object.freeze([
  "resource_timing_enrichment",
  "tao_status",
  "timing_buffer_overflow_status",
  "clock_mapping",
] as const);

const DECLARED_GAPS = Object.freeze([
  "bytes_received_absent",
  "resource_timing_has_no_range_or_page_ownership",
] as const);

export class NetworkObserver implements NetworkSource {
  readonly capabilities = CAPABILITIES;
  readonly declaredGaps = DECLARED_GAPS;

  private readonly targetResourceName: string;
  private readonly performanceApi: Performance | undefined;
  private readonly observerFactory: ((callback: PerformanceObserverCallback) => PerformanceObserver) | undefined;
  private readonly requestKeys = new Map<string, Readonly<AdapterObservedRequestKey>>();
  private readonly timings: TimingRecord[] = [];
  private receiver: ((event: Readonly<CapturedProbeEvent>) => void) | undefined;
  private observer: PerformanceObserver | undefined;
  private attached = false;
  private disposed = false;
  private timingBufferOverflow = false;
  private droppedEntryCount = 0;

  constructor(options: Readonly<NetworkObserverOptions>) {
    const runtimeBase = options.resourceUrlBase ?? (typeof globalThis.location === "undefined" ? undefined : globalThis.location.href);
    this.targetResourceName = canonicalRadUrl(options.resourceUrl, runtimeBase);
    this.performanceApi = options.performance ?? globalThis.performance;
    this.observerFactory = options.observerFactory
      ?? (typeof globalThis.PerformanceObserver === "function"
        ? (callback) => new globalThis.PerformanceObserver(callback)
        : undefined);
  }

  registerRequestKey(key: Readonly<AdapterObservedRequestKey>): void {
    if (this.disposed) return;
    validateRequestKey(key, this.targetResourceName);
    this.requestKeys.set(key.requestId, Object.freeze({ ...key }));
  }

  removeRequestKey(requestId: string): void {
    this.requestKeys.delete(requestId);
  }

  attach(receiver: (event: Readonly<CapturedProbeEvent>) => void): DisposableSource {
    if (this.disposed) return Object.freeze({ dispose() {} });
    if (this.attached) throw new Error("NetworkObserver is already attached");
    this.attached = true;
    this.receiver = receiver;

    if (this.performanceApi && this.observerFactory) {
      try {
        this.observer = this.observerFactory((list: PerformanceObserverEntryList) => {
          const dropped = (list as PerformanceObserverEntryList & { readonly droppedEntriesCount?: number }).droppedEntriesCount ?? 0;
          if (dropped > 0) this.markBufferOverflow(dropped);
          for (const entry of list.getEntries()) this.consumeEntry(entry);
        });
        this.observer.observe({ type: "resource", buffered: true });
      } catch {
        this.observer?.disconnect();
        this.observer = undefined;
      }
      this.performanceApi.addEventListener("resourcetimingbufferfull", this.handleBufferFull);
    }

    let active = true;
    return Object.freeze({
      dispose: () => {
        if (!active) return;
        active = false;
        this.detach();
      },
    });
  }

  readSnapshot(atMs: number): Readonly<NetworkSnapshot> | undefined {
    if (this.disposed || !Number.isFinite(atMs)) return undefined;
    const performanceApi = this.performanceApi;
    const timeOriginMs = performanceApi?.timeOrigin;
    const monotonicNowMs = performanceApi?.now();
    const clockMapping = Number.isFinite(timeOriginMs) && Number.isFinite(monotonicNowMs)
      ? {
          timeOriginMs: timeOriginMs as number,
          monotonicNowMs: monotonicNowMs as number,
          wallClockNowMs: (timeOriginMs as number) + (monotonicNowMs as number),
        }
      : null;
    const value = {
      resourceName: this.targetResourceName,
      taoAvailable: this.timings.length === 0 ? null : this.timings.every((entry) => entry.taoAvailable),
      timingBufferOverflow: this.timingBufferOverflow,
      droppedEntryCount: this.droppedEntryCount,
      clockMapping,
      timings: this.timings.map((entry) => ({ ...entry })),
    } as const;
    return Object.freeze({
      adapterStatus: this.timingBufferOverflow ? "degraded" : "valid",
      requiredReadingsValid: !this.timingBufferOverflow,
      workingSetStable: true,
      relevantOutstanding: false,
      recentContradictoryEvent: false,
      qualifyingProgress: false,
      value,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detach();
    this.requestKeys.clear();
  }

  private readonly handleBufferFull = (): void => {
    this.markBufferOverflow();
  };

  private detach(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    this.performanceApi?.removeEventListener("resourcetimingbufferfull", this.handleBufferFull);
    this.receiver = undefined;
    this.attached = false;
  }

  private markBufferOverflow(droppedEntryCount?: number): void {
    this.timingBufferOverflow = true;
    if (droppedEntryCount !== undefined) this.droppedEntryCount += droppedEntryCount;
    this.emit("timing_buffer_overflow", { ...(droppedEntryCount === undefined ? {} : { droppedEntryCount }) });
  }

  private consumeEntry(entry: PerformanceEntry): void {
    if (entry.entryType !== "resource") return;
    let resourceName: string;
    try {
      resourceName = canonicalUrl(entry.name, this.targetResourceName);
    } catch {
      return;
    }
    if (resourceName !== this.targetResourceName) return;

    const resource = entry as PerformanceResourceTiming;
    const candidateRequestIds = [...this.requestKeys.values()]
      .filter((key) => requestKeyMatches(key, resourceName, entry.startTime))
      .map((key) => key.requestId);
    const requestId = candidateRequestIds.length === 1 ? candidateRequestIds[0] : undefined;
    if (candidateRequestIds.length > 1) {
      this.emit("resource_ambiguity", { resourceName, candidateRequestIds: Object.freeze(candidateRequestIds) });
    }

    const taoAvailable = hasTimingAccess(resource, resourceName);
    const transferSize = taoAvailable && Number.isFinite(resource.transferSize)
      ? resource.transferSize
      : undefined;
    const timing: TimingRecord = Object.freeze({
      ...(requestId === undefined ? {} : { requestId }),
      resourceName,
      startTimeMs: entry.startTime,
      durationMs: entry.duration,
      taoAvailable,
      ...(transferSize === undefined ? {} : { transferSize }),
    });
    this.timings.push(timing);
    this.emit("resource_timing", {
      ...(requestId === undefined ? {} : { requestId }),
      resourceName,
      startTimeMs: entry.startTime,
      durationMs: entry.duration,
      ...(transferSize === undefined ? {} : { transferSize }),
    });
    this.emit("tao_status", {
      ...(requestId === undefined ? {} : { requestId }),
      status: taoAvailable ? "allowed" : "blocked",
    });
  }

  private emit<TType extends "resource_timing" | "tao_status" | "resource_ambiguity" | "timing_buffer_overflow">(
    type: TType,
    payload: Extract<CapturedProbeEvent, { type: TType }>["payload"],
  ): void {
    const eventTimeMs = this.performanceApi?.now() ?? 0;
    try {
      this.receiver?.(Object.freeze({
        type,
        eventTimeMs,
        source: "network",
        payload,
        adapterStatus: this.timingBufferOverflow ? "degraded" : "valid",
        capabilityFlags: CAPABILITIES,
        declaredGaps: DECLARED_GAPS,
      }) as Extract<CapturedProbeEvent, { type: TType }>);
    } catch {
      // Diagnostics receivers are isolated from the observed browser callback.
    }
  }
}

function canonicalRadUrl(raw: string, base?: string): string {
  const canonical = canonicalUrl(raw, base);
  if (!new URL(canonical).pathname.toLowerCase().endsWith(".rad")) {
    throw new Error("NetworkObserver resourceUrl must identify a .rad resource");
  }
  return canonical;
}

function canonicalUrl(raw: string, base?: string): string {
  return new URL(stripSceneUrl(raw, base)).href;
}

function validateRequestKey(key: Readonly<AdapterObservedRequestKey>, base: string): void {
  if (!key.requestId) throw new Error("Adapter-observed request key requires requestId");
  canonicalUrl(key.resourceName, base);
  const hasExact = Number.isFinite(key.resourceStartTimeMs);
  const hasBounds = Number.isFinite(key.startTimeLowerBoundMs) && Number.isFinite(key.startTimeUpperBoundMs);
  if (!hasExact && !hasBounds) throw new Error("Adapter-observed request key requires an explicit resource start time or interval");
  if (hasBounds && (key.startTimeLowerBoundMs as number) > (key.startTimeUpperBoundMs as number)) {
    throw new Error("Adapter-observed request key interval is inverted");
  }
}

function requestKeyMatches(key: Readonly<AdapterObservedRequestKey>, resourceName: string, startTimeMs: number): boolean {
  let keyName: string;
  try {
    keyName = canonicalUrl(key.resourceName, resourceName);
  } catch {
    return false;
  }
  if (keyName !== resourceName) return false;
  if (key.resourceStartTimeMs !== undefined) return key.resourceStartTimeMs === startTimeMs;
  return startTimeMs >= (key.startTimeLowerBoundMs as number) && startTimeMs <= (key.startTimeUpperBoundMs as number);
}

function hasTimingAccess(entry: PerformanceResourceTiming, resourceName: string): boolean {
  const performanceOrigin = typeof location === "undefined" ? undefined : location.origin;
  if (performanceOrigin !== undefined && new URL(resourceName).origin === performanceOrigin) return true;
  return entry.responseStart > 0 || entry.transferSize > 0 || entry.encodedBodySize > 0 || entry.decodedBodySize > 0;
}
