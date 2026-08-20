/**
 * SceneMemory — the per-visit flag store (D31 live markers)
 *
 * One store per visit, holding two kinds of entry that share a namespace:
 * automatic `visited:<id>` records written on every marker activation, and
 * authored flags written by `set-flag` effects. Conditions read it; effects
 * write it. It resets on reload because there is nothing to reset — the store
 * is ordinary memory owned by the runtime, and v1 has no persistence (that is
 * the spec's v2 ledger item 5, deliberately deferred).
 *
 * PURE module — no DOM, camera, or Spark imports, ever. It sits beside the
 * resolver at the same seam, so lm-check asserts the whole memory contract
 * headlessly.
 *
 * `record` is the SINGLE write funnel. Nothing else mutates the store, which is
 * what lets a host observing `onChange` be certain it has seen every flag
 * change — an effect that reached in and mutated a Set would be invisible.
 *
 * Every change REPLACES the snapshot rather than mutating it. Two consequences
 * the rest of the system leans on: a `WhenContext` already handed to the
 * resolver can never change underneath it, and a consumer holding an older
 * snapshot can detect a change by identity alone (the runtime's presence guard
 * does exactly that).
 */

/** The reserved key space for automatic activation records. Authored flags may
 *  not use it — pre-flight rejects that — so a `visited:` entry always means a
 *  marker was really activated. */
export const VISITED_PREFIX = "visited:";

/** The store key recording that an annotation was activated. The single place
 *  the format lives: the runtime writes through here and the `visited`
 *  condition leg reads through here, so the two cannot drift apart. */
export function visitedFlag(annotationId: string): string {
  return `${VISITED_PREFIX}${annotationId}`;
}

export interface SceneMemoryOptions {
  /** Called after every real change, with the new snapshot. Wired to the
   *  notifier at construction so a write cannot happen unannounced. */
  onChange?: (flags: ReadonlySet<string>) => void;
}

export class SceneMemory {
  private snapshot: ReadonlySet<string> = new Set<string>();
  private readonly onChange?: (flags: ReadonlySet<string>) => void;

  constructor(options: SceneMemoryOptions = {}) {
    this.onChange = options.onChange;
  }

  /** The store as conditions see it. Stable until something is recorded, then
   *  replaced wholesale — never mutated in place. */
  get flags(): ReadonlySet<string> {
    return this.snapshot;
  }

  /**
   * Record a flag. THE write funnel — every path that changes memory comes
   * through here, so `onChange` sees them all.
   *
   * Returns whether anything changed. Recording a flag that is already set is a
   * no-op: no new snapshot, no notification. That matters because activation
   * records repeat (a visitor clicks the same marker twice) and a host should
   * not hear about a change that did not happen.
   */
  record(flag: string): boolean {
    if (this.snapshot.has(flag)) return false;
    this.snapshot = new Set(this.snapshot).add(flag);
    this.onChange?.(this.snapshot);
    return true;
  }
}
