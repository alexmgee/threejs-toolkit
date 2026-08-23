import type { DerivedBlock, LoadRecordRevision } from "./LoadRecord";
import type { PageHideContext, SinkCapabilities, TelemetrySink } from "./sinks";

export interface ConsoleReportSinkOptions {
  readonly development?: boolean;
  readonly authorMode?: boolean;
  readonly exportAvailable?: boolean | (() => boolean);
  readonly logger?: Pick<Console, "log">;
  readonly now?: () => number;
}

export interface ConsoleReportSink extends TelemetrySink {
  readonly name: "console";
}

export function createConsoleReportSink(options: Readonly<ConsoleReportSinkOptions> = {}): ConsoleReportSink {
  const enabled = options.development === true || options.authorMode === true;
  const logger = options.logger ?? console;
  const now = options.now ?? (() => performance.now());
  let lastSuccessMs: number | null = null;
  let lastFailureMs: number | null = null;

  const report = (record: Readonly<LoadRecordRevision>): void => {
    if (!enabled) return;
    try {
      const convergence = findDerived(record.evidence.derivedBlocks, "convergence");
      const reveal = findDerived(record.evidence.derivedBlocks, "reveal");
      const sinkState = record.status.sinkHistory.length === 0
        ? "none"
        : record.status.sinkHistory.map((entry) => `${entry.sinkName}:${entry.status}`).join(",");
      const summary = [
        `record=${record.identity.recordId}`,
        `revision=${record.identity.revisionId}`,
        `outcome=${record.status.terminalOutcome ?? "in_progress"}`,
        `adapter=${record.status.probeStatus}`,
        `gaps=${record.status.declaredGaps.length === 0 ? "none" : record.status.declaredGaps.join(",")}`,
        `sinks=${sinkState}`,
        `reveal=${summarizeDerived(reveal)}`,
        `convergence=${summarizeDerived(convergence)}`,
        `export=${resolveExportAvailability(options.exportAvailable) ? "available" : "unavailable"}`,
      ].join(" ");
      logger.log(`Load telemetry summary: ${summary}`);
      lastSuccessMs = now();
    } catch {
      lastFailureMs = now();
    }
  };

  return Object.freeze({
    name: "console" as const,
    capabilities(): Readonly<SinkCapabilities> {
      return Object.freeze({
        available: enabled,
        consent: "not_required",
        persistence: "unavailable",
        partitioned: false,
        quota: "unknown",
        lastSuccessMs,
        lastFailureMs,
        fallbackTier: null,
        status: enabled ? "active" : "disabled",
      });
    },
    onRecord: report,
    onPageHide(context: Readonly<PageHideContext>): void {
      report(context.record);
    },
  });
}

function findDerived(blocks: readonly Readonly<DerivedBlock>[], fragment: string): Readonly<DerivedBlock> | undefined {
  const normalized = fragment.toLowerCase();
  return [...blocks].reverse().find((block) => block.name.toLowerCase().includes(normalized));
}

function summarizeDerived(block: Readonly<DerivedBlock> | undefined): string {
  if (!block) return "unavailable";
  const encoded = JSON.stringify(block.value);
  return encoded.length <= 160 ? encoded : `${encoded.slice(0, 157)}...`;
}

function resolveExportAvailability(value: boolean | (() => boolean) | undefined): boolean {
  try {
    return typeof value === "function" ? value() : value === true;
  } catch {
    return false;
  }
}
