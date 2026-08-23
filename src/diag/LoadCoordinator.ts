import {
  attach,
  getLoadProbeControl,
  type AffirmativeAttachOptions,
  type DeniedAttachOptions,
  type LiveLoadProbeHandle,
  type LoadProbeAttachResult,
  type LoadProbeControl,
  type PendingAttachOptions,
} from "./LoadProbe";
import type { LoadRecordRevision } from "./LoadRecord";
import type { TerminalOutcome } from "./events";
import { sanitizeSceneId } from "./privacy";
import type { LifecycleEvent } from "./visibility";

export type SceneRegistration =
  | PendingAttachOptions
  | DeniedAttachOptions
  | Omit<AffirmativeAttachOptions, "loadId">;

interface RegisteredProbe {
  readonly handle: LiveLoadProbeHandle;
  readonly control: LoadProbeControl;
}

export class LoadCoordinator {
  private readonly loadId = ephemeralLoadId();
  private readonly probes = new Map<string, RegisteredProbe>();
  private readonly finalized = new Map<string, Readonly<LoadRecordRevision>>();
  private allScenesVisible = false;
  private disposed = false;

  registerScene(registration: Readonly<SceneRegistration>): LoadProbeAttachResult {
    if (this.disposed) return Object.freeze({ attached: false, consent: "disabled", capabilities: Object.freeze([]) });
    try {
      const result = registration.consent === "pending" || registration.consent === "denied"
        ? attach(registration)
        : attach({ ...registration, loadId: this.loadId });
      if (!isLiveHandle(result)) return result;
      const control = getLoadProbeControl(result);
      if (!control) return result;
      const previous = this.probes.get(control.sceneId);
      if (previous) previous.control.dispose();
      this.probes.set(control.sceneId, { handle: result, control });
      return result;
    } catch {
      return Object.freeze({ attached: false, consent: "disabled", capabilities: Object.freeze([]) });
    }
  }

  markSceneFirstSplatReady(sceneId: string, numSplats: number, eventTimeMs?: number): void {
    try {
      this.probes.get(sanitizeSceneId(sceneId))?.control.markSceneFirstSplatReady(numSplats, eventTimeMs);
    } catch {
      // Coordinator calls are observer-only.
    }
  }

  markAllScenesVisible(eventTimeMs?: number): void {
    if (this.allScenesVisible || this.disposed) return;
    this.allScenesVisible = true;
    for (const probe of this.probes.values()) {
      try { probe.control.markCoordinatorOverlayReveal(eventTimeMs); } catch { /* isolated per scene */ }
    }
  }

  handleLifecycleEvent(event: Readonly<LifecycleEvent>): void {
    if (this.disposed) return;
    for (const [sceneId, probe] of this.probes) {
      try {
        probe.control.handleLifecycleEvent(event);
        if (event.type === "pagehide" && !event.persisted) {
          const revision = probe.control.finalize("abandoned");
          if (revision) this.finalized.set(sceneId, revision);
        }
      } catch {
        // One scene cannot prevent lifecycle delivery to the others.
      }
    }
  }

  checkpointAll(reason = "coordinator"): readonly Readonly<LoadRecordRevision>[] {
    const revisions: Readonly<LoadRecordRevision>[] = [];
    for (const probe of this.probes.values()) {
      try {
        const revision = probe.control.checkpoint(reason);
        if (revision) revisions.push(revision);
      } catch {
        // Sink/record failure is isolated per scene.
      }
    }
    return Object.freeze(revisions);
  }

  finalizeAll(outcomeHint?: TerminalOutcome): readonly Readonly<LoadRecordRevision>[] {
    for (const [sceneId, probe] of this.probes) {
      if (this.finalized.has(sceneId)) continue;
      try {
        const revision = probe.control.finalize(outcomeHint);
        if (revision) this.finalized.set(sceneId, revision);
      } catch {
        // Finalization remains best-effort and isolated per scene.
      }
    }
    return Object.freeze([...this.finalized.values()]);
  }

  dispose(): void {
    if (this.disposed) return;
    this.finalizeAll("abandoned");
    this.disposed = true;
    for (const probe of this.probes.values()) {
      try { probe.control.dispose(); } catch { /* isolated per scene */ }
    }
    this.probes.clear();
  }
}

function isLiveHandle(result: LoadProbeAttachResult): result is LiveLoadProbeHandle {
  return "status" in result && typeof result.finalize === "function";
}

function ephemeralLoadId(): string {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject && typeof cryptoObject.randomUUID === "function") return `load-${cryptoObject.randomUUID()}`;
  const atMs = globalThis.performance?.now?.() ?? Date.now();
  return `load-${Math.random().toString(36).slice(2)}-${atMs.toString(36)}`;
}
