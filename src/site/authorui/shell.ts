import {
  el,
  icon,
  textBtn,
  type IconName,
} from "./primitives";

export type AuthorPanelTabId =
  | "Tour"
  | "Hotspots"
  | "Text"
  | "Objects"
  | "Boxes"
  | "Look"
  | "Scene";

export interface AuthorPanelShellOptions {
  siteName: string;
  saveStateText: string;
  activeTab: AuthorPanelTabId;
  onExport: () => void;
  onCopyJson: () => void;
  onTabSelect: (id: AuthorPanelTabId) => void;
  /** When wired, the header shows a "Load" affordance: a paste box that reboots
   *  the scene from a config string. Rejects surface inline; the running scene
   *  is untouched on failure. */
  onLoadJson?: (json: string) => Promise<void>;
}

export interface AuthorPanelShell {
  root: HTMLElement;
  contentHost: HTMLElement;
  /** Pinned strip BELOW the scroll region (the P8c context simulator lives
   *  here) — always visible in both browse and inspect modes. */
  footerHost: HTMLElement;
  /** The header title area (grip icon + name) — AuthorPanel wires pointer drag
   *  to it (DD4). Buttons live in a sibling actions group, so they never start
   *  a drag. */
  dragHandle: HTMLElement;
  /** Header collapse button (DD5) — AuthorPanel wires its click to collapse the
   *  panel to a floating reopen tab. A sibling of the grip, so it never drags. */
  collapseButton: HTMLElement;
  setActiveTab: (id: AuthorPanelTabId) => void;
  setSaveStateText: (text: string) => void;
  /** Mount (or clear) the fixed inspect-mode header. It sits between the tab
   *  strip and the scroll region so both the tabs and the header stay pinned
   *  while the inspector body scrolls (the Plan 07 QC flex structure). */
  setInspectorHeader: (header: HTMLElement | null) => void;
}

interface TabSpec {
  id: AuthorPanelTabId;
  iconName: IconName;
  label: string;
}

/** A "Load" toggle button + a collapsible paste panel (textarea + Load/error).
 *  A bad paste surfaces its error inline and leaves the running scene alone. */
function buildLoadRow(onLoadJson: (json: string) => Promise<void>): {
  toggle: HTMLElement;
  panel: HTMLElement;
} {
  const textarea = el("textarea", {
    className: "ap-input ap-textarea ap-load-textarea",
    attrs: { rows: "5", placeholder: "Paste a site.json config, then Load…", spellcheck: "false" },
  }) as HTMLTextAreaElement;
  const error = el("div", { className: "ap-load-error", text: "" });
  error.hidden = true;
  const panel = el("div", { className: "ap-load-panel" }, [
    textarea,
    error,
    el("div", { className: "ap-actions" }, [
      textBtn("circle-check", "Load", {
        tone: "accent",
        onClick: () => {
          error.hidden = true;
          onLoadJson(textarea.value).catch((err: unknown) => {
            error.textContent = err instanceof Error ? err.message : String(err);
            error.hidden = false;
          });
        },
      }),
    ]),
  ]);
  panel.hidden = true;
  const toggle = textBtn("download", "Load", {
    onClick: () => {
      panel.hidden = !panel.hidden;
    },
  });
  return { toggle, panel };
}

const TABS: TabSpec[] = [
  { id: "Tour", iconName: "route", label: "Tour" },
  { id: "Hotspots", iconName: "map-pin", label: "Hotspots" },
  { id: "Text", iconName: "type", label: "Text" },
  { id: "Objects", iconName: "box", label: "Objects" },
  { id: "Boxes", iconName: "square-dashed", label: "Boxes" },
  { id: "Look", iconName: "sliders-horizontal", label: "Appearance" },
  { id: "Scene", iconName: "globe", label: "Scene" },
];

export function createAuthorPanelShell(options: AuthorPanelShellOptions): AuthorPanelShell {
  const saveState = el("div", {
    className: "ap-save-state",
    text: options.saveStateText,
  });
  const tabButtons = new Map<AuthorPanelTabId, HTMLButtonElement>();
  const tabStrip = el("div", { className: "ap-tabs", role: "tablist" });
  for (const tab of TABS) {
    const button = el("button", {
      className: "ap-tab",
      type: "button",
      role: "tab",
      title: tab.label,
      ariaLabel: tab.label,
      ariaSelected: tab.id === options.activeTab,
      onClick: () => options.onTabSelect(tab.id),
    }, [
      icon(tab.iconName),
    ]) as HTMLButtonElement;
    tabButtons.set(tab.id, button);
    tabStrip.appendChild(button);
  }

  const inspectorHost = el("div", { className: "ap-inspector-header" });
  inspectorHost.hidden = true;
  const contentHost = el("div", { className: "ap-content" });
  const footerHost = el("div", { className: "ap-shell-footer" });

  const headerActions: HTMLElement[] = [
    textBtn("download", "Export", { tone: "accent", onClick: options.onExport }),
    textBtn("download", "Copy-JSON", { onClick: options.onCopyJson }),
  ];
  const loadRow = options.onLoadJson ? buildLoadRow(options.onLoadJson) : null;
  if (loadRow) headerActions.push(loadRow.toggle);

  // The title area is the drag grip (DD4): a grip icon + the name/save-state
  // column. Header action buttons sit in a sibling group so they never drag.
  const dragHandle = el("div", { className: "ap-shell-title ap-drag-handle", title: "Drag to move" }, [
    el("span", { className: "ap-grip", ariaLabel: "Move panel" }, [icon("move")]),
    el("div", { className: "ap-shell-title-main" }, [
      el("div", { className: "ap-site-name", text: options.siteName }),
      saveState,
    ]),
  ]);

  // Collapse-to-tab button (DD5) — first in the actions group, a sibling of the
  // grip so clicking it never starts a drag.
  const collapseButton = el("button", {
    className: "ap-btn ap-collapse-btn",
    type: "button",
    title: "Collapse panel",
    ariaLabel: "Collapse panel",
  }, ["‹"]);

  const root = el("div", { className: "ap-shell" }, [
    el("header", { className: "ap-shell-header" }, [
      dragHandle,
      el("div", { className: "ap-header-actions" }, [collapseButton, ...headerActions]),
    ]),
    ...(loadRow ? [loadRow.panel] : []),
    tabStrip,
    inspectorHost,
    contentHost,
    footerHost,
  ]);

  return {
    root,
    contentHost,
    footerHost,
    dragHandle,
    collapseButton,
    setActiveTab(id) {
      for (const [tabId, button] of tabButtons) {
        button.setAttribute("aria-selected", String(tabId === id));
      }
    },
    setSaveStateText(text) {
      saveState.textContent = text;
    },
    setInspectorHeader(header) {
      inspectorHost.replaceChildren(...(header ? [header] : []));
      inspectorHost.hidden = header === null;
    },
  };
}
