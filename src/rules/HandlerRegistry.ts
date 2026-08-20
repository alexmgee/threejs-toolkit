/**
 * HandlerRegistry — the ADR-0001 escape hatch, as a pure store (D31 `custom`)
 *
 * Every leg of a rule is a flat, enumerable vocabulary in site.json; the single
 * way out is a `custom` effect naming a handler the CONSUMING SITE registers in
 * TypeScript. site.json stays data, bespoke logic stays typed and testable in
 * the site project, and the author panel keeps a name field where a code editor
 * would otherwise have to go.
 *
 * PURE module — no DOM, camera, or Spark imports, ever. It is generic over the
 * runtime handle it carries (`R`) precisely so it can hand a handler the whole
 * runtime without importing it: naming `SiteRuntimeHandle` here would drag DOM
 * and Spark into seam 1 and put the dispatch contract out of reach of the
 * headless check script.
 *
 * A missing handler THROWS rather than returning quietly. An author whose rule
 * silently did nothing has no way in — no error, no log, no failed load, just a
 * marker that "doesn't work". The throw is caught by the runtime so one broken
 * handler cannot kill the rest of a rule's effects, but it is never swallowed
 * without a word.
 */

import type { WhenContext } from "./RuleResolver";

/** What a `custom` handler is handed when its effect runs. */
export interface CustomHandlerDetail<R> {
  /** The annotation whose activation resolved the rule carrying this effect. */
  readonly annotationId: string;
  /** The moment the rule was resolved against — engagement state, active stop,
   *  and the scene-memory snapshot. The SAME object the resolver matched on, so
   *  a handler and the conditions that let it run can never disagree about what
   *  was true. Frozen in time: the memory leg is a snapshot the store replaces
   *  rather than mutates. */
  readonly context: WhenContext;
  /** The site's own runtime handle — the same public surface a host page drives
   *  the scene through. A handler can therefore do anything a host can (move the
   *  camera, select an object, set a flag) without the toolkit having to
   *  anticipate it as an effect kind. */
  readonly runtime: R;
}

export type CustomHandler<R> = (detail: CustomHandlerDetail<R>) => void;

export class HandlerRegistry<R> {
  private readonly handlers = new Map<string, CustomHandler<R>>();

  /** `handlers` seeds the registry — the shape `createSiteRuntime({ handlers })`
   *  passes, and the shape pre-flight counts registered names from. */
  constructor(handlers: Readonly<Record<string, CustomHandler<R>>> = {}) {
    for (const [name, handler] of Object.entries(handlers)) {
      this.handlers.set(name, handler);
    }
  }

  /** Register (or REPLACE) the handler for a name. Replacement rather than
   *  accumulation is deliberate: a site that re-registers on a re-mount would
   *  otherwise fire its handler once per mount it has ever survived. */
  register(name: string, handler: CustomHandler<R>): void {
    this.handlers.set(name, handler);
  }

  unregister(name: string): void {
    this.handlers.delete(name);
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }

  /** The registered names. Read by pre-flight to warn about a `custom` effect
   *  naming a handler nobody registered. */
  get names(): readonly string[] {
    return [...this.handlers.keys()];
  }

  /**
   * Run the named handler.
   *
   * Throws when nothing is registered under that name, naming BOTH the handler
   * and the annotation that tried to reach it — the two things an author or site
   * developer needs to find it. A handler's own error is left to propagate
   * unwrapped, so a site developer reads their own stack rather than the
   * toolkit's; the caller distinguishes the two cases by which message it gets.
   */
  dispatch(name: string, detail: CustomHandlerDetail<R>): void {
    const handler = this.handlers.get(name);
    if (handler === undefined) {
      throw new Error(
        `No rule handler registered as "${name}" — annotation "${detail.annotationId}" has a custom effect naming it. `
        + `Register it before the scene loads (registerRuleHandler, or the handlers option).`,
      );
    }
    handler(detail);
  }
}
