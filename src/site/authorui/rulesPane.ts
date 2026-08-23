/**
 * rulesPane.ts — the Rules pane of the annotation inspector (ticket 10).
 *
 * An ordered list of rule cards that MIRRORS first-match-wins: card 1 is asked
 * first, and the up/down controls are the priority. Each card carries its
 * condition chips (one row per condition leg) and its effect rows, each effect
 * row a mini-form for that kind. Everything the previous tickets made
 * authorable is composed here, without touching JSON.
 *
 * ── Where the edits go ───────────────────────────────────
 * Through the EXISTING author-panel commit path, and no other. The pane writes
 * `annotation.rules` and calls `ctx.onChange("annotations")`; the runtime
 * coalesces that into one `applyPanelChange` per frame, and the resolver reads
 * `annotation.rules` afresh at every activation — so a committed edit is live
 * in the same session with nothing else to wire. Export is equally free:
 * `serializeSiteConfig` stringifies the working config, so authored rules ship
 * with the ids the author chose.
 *
 * ── What makes the commit transactional ──────────────────
 * The pane owns a WORKING copy of the rule list, which may hold half-authored
 * cards. On every edit it projects out the cards pre-flight accepts, runs the
 * REAL pre-flight over the whole site with that projection substituted, and
 * writes only if it passes. A refused write leaves the running scene on the
 * last good list and shows pre-flight's own sentence — the author's mistake
 * never reaches the runtime, and never reaches an exported file either.
 *
 * The editing vocabulary itself lives in `rules/RuleAuthoring.ts` (pure), which
 * is what lets lm-check §10 assert the round trip headlessly. This file is the
 * DOM over it.
 */

import {
  canonicalRule,
  committableRules,
  legValues,
  lifetimeChoice,
  lifetimeFor,
  lifetimeWhile,
  moveRule,
  newEffect,
  newRule,
  newWaypoint,
  preflightRules,
  probeRule,
  removeAt,
  takeoverChoice,
  takeoverFor,
  toggleLegValue,
  waypointKind,
  withLeg,
  replaceAt,
  withWaypointHold,
  withWaypointPose,
  withWaypointTarget,
  type LifetimeChoice,
  type RuleSiteRefs,
  type TakeoverChoice,
} from "../../rules/RuleAuthoring";
import {
  displayTemplatePrefix,
  KNOWN_CONDITION_KEYS,
  KNOWN_EFFECT_KINDS,
  KNOWN_MODES,
  KNOWN_SEQUENCE_TERMINALS,
  KNOWN_STATES,
  KNOWN_TRIGGERS,
  KNOWN_UNTIL_ENDINGS,
  type AnnotationRule,
  type CameraSequenceEffect,
  type CustomEffect,
  type ModeEffect,
  type PlayAudioEffect,
  type RuleEffect,
  type RuleWhen,
  type SequencePose,
  type SetFlagEffect,
  type ShowBlocksEffect,
} from "../../rules/RuleModel";
import { uniqueEntityId, type SiteAnnotation } from "../SiteConfig";
import { el, icon, iconBtn, sectionLabel, segmented, textBtn } from "./primitives";
import { formatNumber, paneRow } from "./paneKit";
import type { AuthorTabCtx } from "./tabContext";

/** Human label for an enumerable token, DERIVED rather than mapped: a kind or
 *  ending added to a vocabulary in RuleModel gets a readable label here without
 *  a second edit anyone could forget (ADR-0001's growth rule, label side). */
function tokenLabel(token: string): string {
  const words = token.split("-").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The condition legs, in a fixed reading order with the plain-language label
 *  and the gloss an author needs. Keyed off KNOWN_CONDITION_KEYS so a leg added
 *  to the vocabulary shows up as a row even before it is described here. */
const LEG_LABEL: Partial<Record<string, { label: string; hint: string }>> = {
  state: { label: "Engagement", hint: "Which input surface owns the scene when this rule is asked." },
  stop: { label: "At stop", hint: "The stop the visitor is currently at. Travelling between stops is not at any stop." },
  flag: { label: "Flags", hint: "Flags set earlier this visit by a set-flag effect. Gone on reload." },
  visited: { label: "Visited", hint: "Markers the visitor has activated this visit." },
};

const LIFETIME_OPTIONS: { choice: LifetimeChoice; label: string; title: string }[] = [
  { choice: "default", label: "Default — until re-activation", title: "The field is absent. Behaves as until re-activation." },
  { choice: "until-re-activation", label: "Until re-activation", title: "Written out. Activating this marker again closes the content." },
  { choice: "until-travel", label: "Until travel", title: "Gone on arrival at a stop." },
  { choice: "until-dismiss", label: "Until dismiss", title: "Nothing else ends it — only the visitor's Escape." },
  { choice: "forever", label: "Forever", title: "Never ends on its own. Takeover and Escape still remove it." },
  { choice: "while", label: "While…", title: "Stays while a condition holds." },
];

export function createRulesPane(item: SiteAnnotation, ctx: AuthorTabCtx): HTMLElement {
  // The pane's own copy, held on the PANEL instance rather than in this
  // closure: cards live here whether or not they are complete, and the
  // inspector rebuilds itself wholesale for reasons that have nothing to do
  // with rules (a gizmo attach, a context-simulator scrub). A draft that only
  // lived in the closure would vanish under the author on any of them.
  //
  // The stored draft is reused only while `annotation.rules` still holds what
  // this pane last wrote. Anything else — a Load JSON, a detections import —
  // means the config moved on and the draft is stale.
  const onDisk = JSON.stringify(item.rules ?? []);
  const stored = ctx.rulesState.get(item.id);
  const state = stored !== undefined && stored.committed === onDisk
    ? stored
    // A stale DRAFT is discarded; the open sub-tab is not — which pane the
    // author was reading is not invalidated by someone else editing the config.
    : { working: structuredClone(item.rules ?? []) as AnnotationRule[], committed: onDisk, tab: stored?.tab ?? "marker" };
  ctx.rulesState.set(item.id, state);
  let working: AnnotationRule[] = state.working;

  const cardHost = el("div", { className: "ap-stack" });
  const error = el("div", { className: "ap-load-error" });
  error.hidden = true;
  /** Per-card "not saved yet" hints, refreshed without rebuilding the DOM so a
   *  card can go complete under the author's cursor mid-keystroke.
   *
   *  Declared HERE, not beside `render`: `render()` runs before this function
   *  returns, and a `const` further down the body is in the temporal dead zone
   *  at that moment — the pane would throw on construction. */
  const hints: HTMLElement[] = [];
  /** The last stay-while clause each display effect carried, so flicking the
   *  lifetime select to Forever and back does not silently discard conditions
   *  the author wrote. Keyed on the working effect object, which survives the
   *  pane's own card rebuilds; a wholesale inspector rebuild starts it empty,
   *  which is the same moment every other transient pane state resets. */
  const parkedWhile = new WeakMap<object, RuleWhen>();
  /** In-progress text in a flag row's entry box, keyed by the clause's owner.
   *  A flag is only a condition once it is added, so the box holds text that is
   *  not yet anywhere in the model — and a card rebuild (an effect added two
   *  rows down) would otherwise silently swallow a half-typed name. */
  const parkedEntry = new WeakMap<object, string>();

  const addCard = textBtn("plus", "Add rule", {
    tone: "accent",
    title: "A new card is asked after the ones above it",
    onClick: () => {
      working = [...working, newRule()];
      commit(true);
    },
  });

  const root = el("div", { className: "ap-stack" }, [
    sectionLabel("Rules"),
    el("div", {
      className: "ap-hint",
      text: "Asked top to bottom; the first card whose conditions hold is the one that runs. "
        + "No card matches → the marker shows its copy.",
    }),
    cardHost,
    el("div", { className: "ap-actions" }, [addCard]),
    error,
  ]);

  render();
  return root;

  // ── The commit path ─────────────────────────────────────

  function refs(): RuleSiteRefs {
    return {
      annotations: ctx.site.annotations,
      blocks: ctx.site.blocks,
      stops: ctx.site.stops,
      audio: ctx.site.audio,
    };
  }

  /**
   * Project, pre-flight, write. `rerender` rebuilds the card list — passed
   * false by the text inputs, which must keep focus and their in-progress value
   * (the pane kit's focus contract); their card hints still refresh below.
   */
  function commit(rerender: boolean): void {
    const site = refs();
    // Canonical key order for the file, and a DEEP COPY so the config can only
    // ever change through a commit — an in-progress edit mutates the working
    // card in place, and a shared reference would let it reach the running
    // scene without passing pre-flight.
    const projection = committableRules(site, item.id, working)
      .map((rule) => structuredClone(canonicalRule(rule)));
    const message = preflightRules(site, item.id, projection);
    state.working = working;
    if (message === null) {
      // Absent, not `[]`, when nothing is authored: "no rules" is the shape a
      // marker without this pane has, and export should not tell them apart.
      if (projection.length === 0) delete item.rules;
      else item.rules = projection;
      // Snapshot what reached the annotation, so a later pane can tell its own
      // write apart from someone else's edit (see the draft note above).
      state.committed = JSON.stringify(item.rules ?? []);
      ctx.onChange("annotations");
    }
    // Refused: the running scene keeps the last good list. The author sees why,
    // and the working copy keeps their edit so they can fix it. A blank sound
    // is a SEPARATE complaint — it does not hold the rules back, but it must
    // not pass silently either (see `blankSoundWarning`).
    const shown = message ?? blankSoundWarning();
    error.textContent = shown ?? "";
    error.hidden = shown === null;
    if (rerender) render();
    else refreshHints();
  }

  /**
   * A sound whose file the author cleared.
   *
   * `validateAnnotationRules` cannot see this: a `play-audio` effect only has to
   * name an id that resolves, and it does. The url is checked by the SITE
   * pre-flight, on the next load — which is far too late. The File field writes
   * through on every keystroke (the focus contract), so a moment of emptiness
   * mid-retype has to be allowed; what must not happen is it passing unremarked.
   */
  function blankSoundWarning(): string | null {
    const blank = (ctx.site.audio ?? []).find((sound) => sound.url.trim() === "");
    return blank === undefined
      ? null
      : `Sound "${blank.id}" has no file — the scene will not load again until it has one.`;
  }

  // ── Rendering ───────────────────────────────────────────

  function render(): void {
    hints.length = 0;
    cardHost.textContent = "";
    if (working.length === 0) {
      cardHost.appendChild(el("div", {
        className: "ap-hint",
        text: "No rules. This marker shows its copy when activated.",
      }));
      return;
    }
    working.forEach((_, index) => cardHost.appendChild(renderCard(index)));
    refreshHints();
  }

  /** Rebuild ONE card in place — used when an edit changes that card's shape
   *  (an effect added, a kind swapped, a lifetime that grew a while-clause) but
   *  leaves the list order alone, so the rest of the pane keeps its scroll. */
  function rerenderCard(index: number): void {
    const existing = cardHost.children[index];
    if (!existing) {
      render();
      return;
    }
    const replacement = renderCard(index);
    existing.replaceWith(replacement);
    refreshHints();
  }

  function refreshHints(): void {
    const site = refs();
    working.forEach((rule, index) => {
      const hint = hints[index];
      if (!hint) return;
      // The empty-`do` case gets its own sentence: pre-flight's ("needs a
      // non-empty \"do\" array of effects") is written for a JSON author, and
      // this card has an Add-effect picker sitting right under it.
      const message = rule.do.length === 0
        ? "a rule needs at least one effect."
        : probeRule(site, item.id, rule);
      hint.textContent = message === null ? "" : `Not saved yet — ${trimPrefix(message)}`;
      hint.hidden = message === null;
    });
  }

  /** Pre-flight messages open with "SiteConfig: annotation "x" rule 2 …", which
   *  is right in a console and noise on the card that IS rule 2. */
  function trimPrefix(message: string): string {
    return message.replace(/^SiteConfig: annotation "[^"]*" rule \d+ /, "");
  }

  function renderCard(index: number): HTMLElement {
    const rule = working[index];
    const hint = el("div", { className: "ap-load-error" });
    hints[index] = hint;

    const header = el("div", { className: "ap-card-header" }, [
      el("span", { className: "ap-field-label", text: `Rule ${index + 1}` }),
      triggerSelect(rule, index),
      el("span", { className: "ap-browse-row-spacer" }),
      iconBtn("arrow-up", {
        title: "Ask this rule earlier",
        onClick: () => {
          working = moveRule(working, index, -1);
          commit(true);
        },
      }),
      iconBtn("arrow-down", {
        title: "Ask this rule later",
        onClick: () => {
          working = moveRule(working, index, 1);
          commit(true);
        },
      }),
      iconBtn("trash", {
        title: "Delete this rule",
        tone: "danger",
        onClick: () => {
          working = removeAt(working, index);
          commit(true);
        },
      }),
    ]);

    return el("div", { className: "ap-card" }, [
      header,
      sectionLabel("Conditions"),
      conditionEditor(
        rule,
        rule.when,
        (next) => {
          if (next === undefined) delete rule.when;
          else rule.when = next;
          commit(true);
        },
        { emptyHint: "No conditions — this card matches whenever it is asked, and shadows every card below it." },
      ),
      sectionLabel("Effects"),
      ...rule.do.map((effect, position) => effectRow(rule, index, effect, position)),
      el("div", { className: "ap-actions" }, [addEffectPicker(rule, index)]),
      hint,
    ]);
  }

  function triggerSelect(rule: AnnotationRule, index: number): HTMLElement {
    return selectControl({
      label: "Trigger",
      value: rule.on,
      options: KNOWN_TRIGGERS.map((trigger) => ({ value: trigger, label: `when ${trigger}d` })),
      onSelect: (value) => {
        rule.on = value as AnnotationRule["on"];
        commit(true);
      },
    });
  }

  // ── Conditions ──────────────────────────────────────────

  /**
   * One chip row per condition leg. Shared by a rule's `when` and by a display
   * effect's stay-while clause — the schema says they are the same vocabulary,
   * so the author meets the same control in both places.
   */
  function conditionEditor(
    /** The object the clause belongs to (a rule, or a display effect for its
     *  stay-while) — a stable identity for row state that outlives a rebuild. */
    owner: object,
    when: RuleWhen | undefined,
    onChange: (next: RuleWhen | undefined) => void,
    options: { emptyHint: string },
  ): HTMLElement {
    const rows: HTMLElement[] = [];
    for (const key of KNOWN_CONDITION_KEYS) {
      const meta = LEG_LABEL[key] ?? { label: tokenLabel(key), hint: "" };
      const chosen = legValues(when?.[key]);
      const row = key === "flag"
        ? freeChipRow(owner, chosen, meta.hint, (next) => onChange(withLeg(when, key, next)))
        : fixedChipRow(
            chosen,
            enumerable(key),
            meta.hint,
            (value) => onChange(toggleLegValue(when, key, value)),
          );
      if (row === null) continue;
      rows.push(paneRow(meta.label, row, meta.hint));
    }
    if (when === undefined) {
      rows.push(el("div", { className: "ap-hint", text: options.emptyHint }));
    }
    return el("div", { className: "ap-stack" }, rows);
  }

  /** The values a leg can name, for the legs whose vocabulary the site fixes. */
  function enumerable(key: string): { value: string; label: string }[] {
    if (key === "state") {
      return KNOWN_STATES.map((state) => ({ value: state, label: tokenLabel(state) }));
    }
    if (key === "stop") {
      return ctx.site.stops
        .map((stop) => stop.id)
        .filter((id): id is string => id !== undefined)
        .map((id) => ({ value: id, label: id }));
    }
    if (key === "visited") {
      return ctx.site.annotations.map((annotation) => ({
        value: annotation.id,
        label: annotation.id === item.id ? `${annotation.id} (self)` : annotation.id,
      }));
    }
    return [];
  }

  /** Toggle chips over a fixed vocabulary. Returns null when the site offers
   *  nothing to name — a stop row in a scene with no stops is a dead control,
   *  not an empty one. */
  function fixedChipRow(
    chosen: readonly string[],
    values: readonly { value: string; label: string }[],
    hint: string,
    onToggle: (value: string) => void,
  ): HTMLElement | null {
    if (values.length === 0) return null;
    return el("div", { className: "ap-badges" }, values.map((entry) => {
      const on = chosen.includes(entry.value);
      return el("button", {
        className: "ap-chip ap-chip-btn",
        type: "button",
        text: entry.label,
        title: hint,
        ariaPressed: on,
        dataset: { tone: on ? "accent" : "neutral" },
        onClick: () => onToggle(entry.value),
      });
    }));
  }

  /** Removable chips plus a text entry, for a leg whose values are free-form.
   *  Flags are authored names, so there is nothing to enumerate — but the ones
   *  already chosen are still chips, and so is every flag some rule in this
   *  site sets, which is the closest thing to a vocabulary a flag has. */
  function freeChipRow(
    owner: object,
    chosen: readonly string[],
    hint: string,
    onValues: (next: string[]) => void,
  ): HTMLElement {
    const entry = el("input", {
      className: "ap-input",
      type: "text",
      attrs: {
        value: parkedEntry.get(owner) ?? "",
        placeholder: "require a flag…",
        "aria-label": "Add flag condition",
        spellcheck: "false",
      },
    }) as HTMLInputElement;
    entry.addEventListener("input", () => parkedEntry.set(owner, entry.value));
    const add = (): void => {
      const name = entry.value.trim();
      if (name === "" || chosen.includes(name)) return;
      parkedEntry.delete(owner);
      onValues([...chosen, name]);
    };
    entry.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      add();
    });
    const suggestions = knownFlags().filter((flag) => !chosen.includes(flag));
    return el("div", { className: "ap-stack" }, [
      el("div", { className: "ap-badges" }, [
        ...chosen.map((flag) => el("button", {
          className: "ap-chip ap-chip-btn",
          type: "button",
          text: `${flag} ✕`,
          title: `Remove the "${flag}" condition`,
          dataset: { tone: "accent" },
          onClick: () => onValues(chosen.filter((name) => name !== flag)),
        })),
        ...suggestions.map((flag) => el("button", {
          className: "ap-chip ap-chip-btn",
          type: "button",
          text: flag,
          title: `Require the "${flag}" flag — set by a rule in this site`,
          onClick: () => onValues([...chosen, flag]),
        })),
      ]),
      el("div", { className: "ap-actions" }, [
        entry,
        textBtn("plus", "Add flag", { title: hint, onClick: add }),
      ]),
    ]);
  }

  /** Every flag any rule in this site sets — the suggestion list above. */
  function knownFlags(): string[] {
    const names = new Set<string>();
    for (const annotation of ctx.site.annotations) {
      for (const rule of annotation.rules ?? []) {
        for (const effect of rule.do) {
          if (effect.kind === "set-flag" && effect.flag !== "") names.add(effect.flag);
        }
      }
    }
    return [...names].sort();
  }

  // ── Effects ─────────────────────────────────────────────

  function addEffectPicker(rule: AnnotationRule, index: number): HTMLElement {
    const select = el("select", {
      className: "ap-input ap-select",
      ariaLabel: "Add effect",
    }) as HTMLSelectElement;
    select.appendChild(new Option("Add effect…", ""));
    for (const kind of KNOWN_EFFECT_KINDS) {
      select.appendChild(new Option(tokenLabel(kind), kind));
    }
    select.addEventListener("change", () => {
      const kind = select.value as RuleEffect["kind"] | "";
      select.value = "";
      if (kind === "") return;
      rule.do = [...rule.do, newEffect(kind)];
      commit(false);
      rerenderCard(index);
    });
    return select;
  }

  function effectRow(
    rule: AnnotationRule,
    index: number,
    effect: RuleEffect,
    position: number,
  ): HTMLElement {
    const kindSelect = selectControl({
      label: "Effect",
      value: effect.kind,
      options: KNOWN_EFFECT_KINDS.map((kind) => ({ value: kind, label: tokenLabel(kind) })),
      onSelect: (value) => {
        // A different kind is a different shape — the old fields have nowhere
        // to go, so this is a replacement rather than a conversion.
        rule.do = rule.do.map((entry, at) =>
          at === position ? newEffect(value as RuleEffect["kind"]) : entry);
        commit(false);
        rerenderCard(index);
      },
    });

    const header = el("div", { className: "ap-card-header" }, [
      icon("play"),
      kindSelect,
      el("span", { className: "ap-browse-row-spacer" }),
      iconBtn("trash", {
        title: "Remove this effect",
        tone: "danger",
        onClick: () => {
          rule.do = removeAt(rule.do, position);
          commit(false);
          rerenderCard(index);
        },
      }),
    ]);

    return el("div", { className: "ap-card" }, [header, miniForm(effect, index)]);
  }

  /** The per-kind mini-form. Exhaustive over the union, so a new effect kind is
   *  a compile error here until it has one — the pane cannot quietly ship a
   *  kind the author can add but not fill in. */
  function miniForm(effect: RuleEffect, index: number): HTMLElement {
    switch (effect.kind) {
      case "show-blocks": return displayForm(effect, index);
      case "set-flag": return flagForm(effect);
      case "play-audio": return audioForm(effect, index);
      case "camera-sequence": return sequenceForm(effect, index);
      case "engage":
      case "allow":
      case "deny": return modeForm(effect);
      case "custom": return customForm(effect);
    }
  }

  // ── show-blocks ─────────────────────────────────────────

  function displayForm(effect: ShowBlocksEffect, index: number): HTMLElement {
    const rows: HTMLElement[] = [paneRow("Blocks", blockPicker(effect, index))];

    rows.push(paneRow(
      "Takeover",
      segmented(
        [
          { id: "inherit", label: "Inherit" },
          { id: "on", label: "On" },
          { id: "off", label: "Off" },
        ],
        takeoverChoice(effect.takeover),
        (id) => {
          const next = takeoverFor(id as TakeoverChoice);
          if (next === undefined) delete effect.takeover;
          else effect.takeover = next;
          commit(false);
          rerenderCard(index);
        },
      ),
      "Does showing this remove content another marker is showing? Inherit follows the site setting.",
    ));

    const choice = lifetimeChoice(effect.lifetime);
    rows.push(paneRow(
      "Lifetime",
      selectControl({
        label: "Lifetime",
        value: choice,
        options: LIFETIME_OPTIONS.map((option) => ({
          value: option.choice,
          label: option.label,
          title: option.title,
        })),
        onSelect: (value) => {
          // Park the clause on the way OUT, and read it back on the way in.
          const leaving = lifetimeWhile(effect.lifetime);
          if (leaving !== undefined) parkedWhile.set(effect, leaving);
          const next = lifetimeFor(value as LifetimeChoice, parkedWhile.get(effect));
          if (next === undefined) delete effect.lifetime;
          else effect.lifetime = next;
          commit(false);
          rerenderCard(index);
        },
      }),
      "When this content ends on its own. Takeover and the visitor's Escape are not endings.",
    ));

    if (choice === "while") {
      const clause = lifetimeWhile(effect.lifetime);
      // Headed, because these are the SAME chip rows the card's own conditions
      // use, with the same labels — without a heading the two read as one list,
      // and "Engagement: Tour" would be ambiguous between "fire in tour" and
      // "stay while in tour", which are different sentences.
      rows.push(sectionLabel("Stays while"));
      rows.push(conditionEditor(
        effect,
        clause,
        (next) => {
          effect.lifetime = { while: next ?? {} };
          if (next !== undefined) parkedWhile.set(effect, next);
          commit(false);
          rerenderCard(index);
        },
        { emptyHint: "An empty condition always holds — with nothing named, this content never ends on its own." },
      ));
    }

    return el("div", { className: "ap-stack" }, rows);
  }

  function blockPicker(effect: ShowBlocksEffect, index: number): HTMLElement {
    // A templated effect names exactly one block — its own seeded template id —
    // and pre-flight refuses any other count. Adding or removing here would
    // make the effect unloadable with no way back, so the picker shows the id
    // and stands down. The template block itself is edited on the Text tab.
    if (effect.template !== undefined) {
      return el("div", { className: "ap-stack" }, [
        el("div", { className: "ap-badges" }, effect.blocks.map((id) =>
          el("span", { className: "ap-chip", text: id, dataset: { tone: "accent" } }))),
        el("div", {
          className: "ap-hint",
          text: `Seeded template (${displayTemplatePrefix(item.id)}…) — one block, fixed. Edit its text and placement on the Text tab.`,
        }),
      ]);
    }

    const chosen = effect.blocks;
    const available = ctx.site.blocks
      .map((block) => block.id)
      .filter((id) => !chosen.includes(id));

    const add = el("select", { className: "ap-input ap-select", ariaLabel: "Add block" }) as HTMLSelectElement;
    add.appendChild(new Option("Add block…", ""));
    for (const id of available) add.appendChild(new Option(id, id));
    add.addEventListener("change", () => {
      const id = add.value;
      add.value = "";
      if (id === "") return;
      effect.blocks = [...effect.blocks, id];
      commit(false);
      rerenderCard(index);
    });

    return el("div", { className: "ap-stack" }, [
      el("div", { className: "ap-badges" }, chosen.map((id) => el("button", {
        className: "ap-chip ap-chip-btn",
        type: "button",
        text: `${id} ✕`,
        title: `Stop showing ${id}`,
        dataset: { tone: "accent" },
        onClick: () => {
          effect.blocks = effect.blocks.filter((entry) => entry !== id);
          commit(false);
          rerenderCard(index);
        },
      }))),
      add,
    ]);
  }

  // ── set-flag / custom ───────────────────────────────────

  function flagForm(effect: SetFlagEffect): HTMLElement {
    return paneRow(
      "Flag name",
      writeThroughInput("Flag name", effect.flag, "flag name", (value) => { effect.flag = value; }),
      "Recorded in scene memory for the rest of the visit. Conditions read it by this name.",
    );
  }

  function customForm(effect: CustomEffect): HTMLElement {
    return el("div", { className: "ap-stack" }, [
      paneRow(
        "Handler",
        writeThroughInput("Handler", effect.handler, "handler name", (value) => { effect.handler = value; }),
        "A handler the consuming site registered in TypeScript.",
      ),
      el("div", {
        className: "ap-hint",
        text: "Unregistered at load is a warning; unregistered when the marker is activated throws.",
      }),
    ]);
  }

  // ── engage / allow / deny ───────────────────────────────

  function modeForm(effect: ModeEffect): HTMLElement {
    return paneRow(
      "Mode",
      selectControl({
        label: "Mode",
        value: effect.mode,
        options: KNOWN_MODES.map((mode) => ({ value: mode, label: tokenLabel(mode) })),
        onSelect: (value) => {
          effect.mode = value as ModeEffect["mode"];
          commit(false);
        },
      }),
      effect.kind === "engage"
        ? "Takes the visitor into this mode, granting it on the way through."
        : effect.kind === "allow"
          ? "Offers this mode for the rest of the visit. Granting is not entering."
          : "Withdraws this mode. Denying the visitor's current mode returns them to the frozen frame.",
    );
  }

  // ── play-audio ──────────────────────────────────────────

  function audioForm(effect: PlayAudioEffect, index: number): HTMLElement {
    const sounds = ctx.site.audio ?? [];
    const sound = sounds.find((candidate) => candidate.id === effect.audio);

    const picker = selectControl({
      label: "Sound",
      value: effect.audio,
      options: [
        { value: "", label: sounds.length === 0 ? "No sounds yet" : "Choose a sound…" },
        ...sounds.map((entry) => ({ value: entry.id, label: entry.id })),
      ],
      onSelect: (value) => {
        effect.audio = value;
        commit(false);
        rerenderCard(index);
      },
    });

    const rows: HTMLElement[] = [paneRow("Sound", picker, "Names a sound in the site's audio list.")];

    if (sound) {
      rows.push(paneRow(
        "File",
        writeThroughInput("Sound file", sound.url, "https://… or /path/file.mp3", (value) => { sound.url = value; }),
        "Absolute, or a path from the site root. Relative paths are re-based against site.json only on reload.",
      ));
      const volume = el("input", {
        className: "ap-range",
        type: "range",
        ariaLabel: "Volume",
        attrs: { min: "0", max: "1", step: "0.05", value: String(sound.volume ?? 1) },
      }) as HTMLInputElement;
      const readout = el("span", { className: "ap-slider-value", text: String(sound.volume ?? 1) });
      volume.addEventListener("input", () => {
        // Written only once touched, so a sound that never carried a volume
        // keeps its absence (= full) through an unrelated edit.
        sound.volume = Number(volume.value);
        readout.textContent = volume.value;
        commit(false);
      });
      rows.push(paneRow(
        "Volume",
        el("div", { className: "ap-ctrl-slider" }, [volume, readout]),
        sound.volume === undefined ? "Not authored — plays at full." : "Authored on the sound, shared by every rule that plays it.",
      ));
    }

    rows.push(newSoundForm(effect, index));
    return el("div", { className: "ap-stack" }, rows);
  }

  /**
   * Mint a sound and point this effect at it.
   *
   * Guarded on a non-empty URL because an audio entry with an empty url passes
   * the RULE pre-flight (which only checks that the id resolves) and fails the
   * SITE pre-flight on the next load. Refusing to create one is the only place
   * that hole can be closed from.
   */
  function newSoundForm(effect: PlayAudioEffect, index: number): HTMLElement {
    const idInput = el("input", {
      className: "ap-input",
      type: "text",
      attrs: { placeholder: "sound id", "aria-label": "New sound id", spellcheck: "false" },
    }) as HTMLInputElement;
    const urlInput = el("input", {
      className: "ap-input",
      type: "text",
      attrs: { placeholder: "https://… or /path/file.mp3", "aria-label": "New sound URL", spellcheck: "false" },
    }) as HTMLInputElement;
    const create = textBtn("plus", "Add sound", {
      tone: "accent",
      onClick: () => {
        const url = urlInput.value.trim();
        if (url === "") {
          error.textContent = "A new sound needs a URL — a sound with none would fail to load the site.";
          error.hidden = false;
          return;
        }
        const existing = ctx.site.audio ?? (ctx.site.audio = []);
        const wanted = idInput.value.trim();
        const id = wanted !== "" && !existing.some((entry) => entry.id === wanted)
          ? wanted
          : uniqueEntityId(existing.map((entry) => entry.id), wanted === "" ? "sound" : wanted);
        existing.push({ id, url });
        effect.audio = id;
        commit(false);
        rerenderCard(index);
      },
    });
    return el("div", { className: "ap-stack" }, [
      el("div", { className: "ap-hint", text: "Or add a new sound:" }),
      el("div", { className: "ap-actions" }, [idInput, urlInput, create]),
    ]);
  }

  // ── camera-sequence ─────────────────────────────────────

  function sequenceForm(effect: CameraSequenceEffect, index: number): HTMLElement {
    const rows: HTMLElement[] = [
      paneRow(
        "Ends by",
        segmented(
          KNOWN_SEQUENCE_TERMINALS.map((terminal) => ({ id: terminal, label: tokenLabel(terminal) })),
          effect.terminal,
          (id) => {
            effect.terminal = id as CameraSequenceEffect["terminal"];
            commit(false);
            rerenderCard(index);
          },
        ),
        "Return glides back to the composed still; Stay leaves the camera at the last waypoint.",
      ),
    ];

    effect.waypoints.forEach((waypoint, at) => {
      const kind = waypointKind(waypoint);
      const destination = kind === "pose"
        ? el("span", {
            className: "ap-chip",
            // The readout is what tells two captures apart — the same
            // yaw/pitch/dist summary the stop inspector shows for a stop's
            // camera, so a pose reads the same everywhere it is authored.
            text: `Captured pose — ${poseText(waypoint.pose!)}`,
            title: "Captured from the live camera. Re-capture replaces it with the current view; order it or remove it here.",
            dataset: { tone: "accent" },
          })
        : selectControl({
            label: `Waypoint ${at + 1} destination`,
            value: kind === null ? "" : `${kind}:${waypoint.stop ?? waypoint.annotation ?? ""}`,
            options: [
              { value: "", label: "Choose a destination…" },
              ...ctx.site.stops
                .map((stop) => stop.id)
                .filter((id): id is string => id !== undefined)
                .map((id) => ({ value: `stop:${id}`, label: `Stop — ${id}` })),
              ...ctx.site.annotations.map((annotation) => ({
                value: `annotation:${annotation.id}`,
                label: `Frame — ${annotation.id}`,
              })),
            ],
            onSelect: (value) => {
              const [target, id] = splitOnce(value);
              effect.waypoints = effect.waypoints.map((entry, position) =>
                position === at
                  ? withWaypointTarget(entry, target === "annotation" ? "annotation" : "stop", id)
                  : entry);
              commit(false);
              rerenderCard(index);
            },
          });

      const hold = el("input", {
        className: "ap-input ap-ctrl-number",
        type: "number",
        attrs: { min: "0", step: "0.25", value: waypoint.hold === undefined ? "" : String(waypoint.hold), "aria-label": `Waypoint ${at + 1} hold` },
      }) as HTMLInputElement;
      hold.addEventListener("input", () => {
        const raw = hold.value.trim();
        const seconds = raw === "" ? undefined : Number(raw);
        if (seconds !== undefined && Number.isNaN(seconds)) return;
        effect.waypoints = effect.waypoints.map((entry, position) =>
          position === at ? withWaypointHold(entry, seconds) : entry);
        commit(false);
      });

      rows.push(el("div", { className: "ap-card-header" }, [
        el("span", { className: "ap-field-label", text: `${at + 1}.` }),
        destination,
        el("span", { className: "ap-field-label", text: "hold", title: "Seconds to rest here. Blank flows straight through." }),
        hold,
        el("span", { className: "ap-browse-row-spacer" }),
        // Only a pose waypoint offers re-capture: a stop or framing waypoint
        // follows its entity, and overwriting it with a pose is authored by
        // removing it and capturing — never by a button that silently converts.
        ...(kind === "pose"
          ? [iconBtn("camera", {
              title: "Re-capture from the current view — replaces this pose in place",
              onClick: () => {
                // LIVE lookup, not the render-time `waypoint`: the hold input
                // replaces waypoint objects without a card rebuild (the focus
                // contract), so the closure's copy can be stale — capturing
                // over it would silently drop a just-typed hold.
                effect.waypoints = replaceAt(
                  effect.waypoints,
                  at,
                  withWaypointPose(effect.waypoints[at], ctx.getCameraState()),
                );
                commit(false);
                rerenderCard(index);
              },
            })]
          : []),
        iconBtn("arrow-up", {
          title: "Fly here earlier",
          onClick: () => {
            effect.waypoints = moveWaypoint(effect.waypoints, at, -1);
            commit(false);
            rerenderCard(index);
          },
        }),
        iconBtn("arrow-down", {
          title: "Fly here later",
          onClick: () => {
            effect.waypoints = moveWaypoint(effect.waypoints, at, 1);
            commit(false);
            rerenderCard(index);
          },
        }),
        iconBtn("trash", {
          title: "Remove this waypoint",
          tone: "danger",
          onClick: () => {
            effect.waypoints = removeAt(effect.waypoints, at);
            commit(false);
            rerenderCard(index);
          },
        }),
      ]));
    });

    rows.push(el("div", { className: "ap-actions" }, [
      textBtn("plus", "Add waypoint", {
        onClick: () => {
          effect.waypoints = [...effect.waypoints, newWaypoint()];
          commit(false);
          rerenderCard(index);
        },
      }),
      // "Fly there, press capture" (ticket 11): the current camera pose,
      // appended as an authored-pose waypoint — the same live state the stop
      // inspector's "Set from current view" writes, through the same
      // transactional commit every other card edit takes.
      textBtn("camera", "Capture waypoint", {
        title: "Append the current camera view as a waypoint",
        onClick: () => {
          effect.waypoints = [
            ...effect.waypoints,
            withWaypointPose(newWaypoint(), ctx.getCameraState()),
          ];
          commit(false);
          rerenderCard(index);
        },
      }),
    ]));
    return el("div", { className: "ap-stack" }, rows);
  }

  // ── Small shared controls ───────────────────────────────

  /** A text input that writes through on every keystroke WITHOUT a rebuild —
   *  the pane kit's focus contract. The card hint still refreshes, so a name
   *  going from empty to valid is visible as it is typed.
   *
   *  `label` becomes the accessible name: `paneRow` labels with a <span>, not a
   *  <label for>, so without one these fields are announced as bare edit boxes
   *  — and two of them would answer to the same placeholder. */
  function writeThroughInput(
    label: string,
    value: string,
    placeholder: string,
    onValue: (next: string) => void,
  ): HTMLInputElement {
    const input = el("input", {
      className: "ap-input",
      type: "text",
      ariaLabel: label,
      attrs: { value, placeholder, spellcheck: "false" },
    }) as HTMLInputElement;
    input.addEventListener("input", () => {
      onValue(input.value);
      commit(false);
    });
    return input;
  }
}

// ─── Module-level helpers (no pane state) ─────────────────

interface SelectOptions {
  label: string;
  value: string;
  options: { value: string; label: string; title?: string }[];
  onSelect: (value: string) => void;
}

function selectControl(options: SelectOptions): HTMLSelectElement {
  const select = el("select", {
    className: "ap-input ap-select",
    ariaLabel: options.label,
  }) as HTMLSelectElement;
  for (const entry of options.options) {
    const option = new Option(entry.label, entry.value, false, entry.value === options.value);
    if (entry.title) option.title = entry.title;
    select.appendChild(option);
  }
  select.value = options.value;
  select.addEventListener("change", () => options.onSelect(select.value));
  return select;
}

/** The yaw/pitch/dist summary a captured pose shows — the same reading the stop
 *  inspector gives a stop's camera, so a pose is legible wherever it appears. */
function poseText(pose: SequencePose): string {
  return [
    `yaw ${formatNumber(pose.yaw)}`,
    `pitch ${formatNumber(pose.pitch)}`,
    `dist ${formatNumber(pose.distance)}`,
  ].join(" / ");
}

/** `"stop:overview"` → `["stop", "overview"]`, splitting on the FIRST colon
 *  only: ids may contain colons (the routing format uses them), and the part
 *  after the first is the whole id. */
function splitOnce(value: string): [string, string] {
  const at = value.indexOf(":");
  return at < 0 ? [value, ""] : [value.slice(0, at), value.slice(at + 1)];
}

function moveWaypoint<T>(list: readonly T[], index: number, delta: number): T[] {
  const next = [...list];
  const target = index + delta;
  if (target < 0 || target >= next.length) return next;
  const [entry] = next.splice(index, 1);
  next.splice(target, 0, entry);
  return next;
}
