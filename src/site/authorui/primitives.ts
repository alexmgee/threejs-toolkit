export type Child = HTMLElement | SVGElement | Text | string | number | boolean | null | undefined;

export type IconName =
  | "download"
  | "plus"
  | "map-pin"
  | "type"
  | "box"
  | "square-dashed"
  | "sliders"
  | "sliders-horizontal"
  | "route"
  | "camera"
  | "play"
  | "arrow-up"
  | "arrow-down"
  | "trash"
  | "move"
  | "scaling"
  | "rotate-cw"
  | "crosshair"
  | "chevron-down"
  | "info"
  | "circle-check"
  | "triangle-alert"
  | "eye"
  | "globe";

export interface ElementProps {
  className?: string;
  text?: string;
  title?: string;
  type?: string;
  role?: string;
  ariaLabel?: string;
  ariaSelected?: boolean;
  ariaPressed?: boolean;
  ariaChecked?: boolean;
  dataset?: Record<string, string>;
  attrs?: Record<string, string>;
  onClick?: (event: MouseEvent) => void;
  onInput?: (event: Event) => void;
}

export interface SliderOptions {
  label: string;
  title?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  fmt?: (value: number) => string;
  onInput: (value: number) => void;
}

export interface SegmentOption {
  id: string;
  label: string;
}

export type Tone = "neutral" | "accent" | "danger";

export interface ButtonOptions {
  tone?: Tone;
  title?: string;
  onClick?: (event: MouseEvent) => void;
}

export type GizmoMode = "translate" | "scale" | "rotate";

export interface CollapsibleOptions {
  open?: boolean;
  /** Notified with the new open state on each toggle — lets a caller persist
   *  expansion across rerenders (the inspector rebuilds on clear/scope switch). */
  onToggle?: (open: boolean) => void;
}

export interface GizmoBarOptions {
  modes: GizmoMode[];
  disabledModes?: Array<{ mode: GizmoMode; reason: string }>;
  onMode: (mode: GizmoMode) => void;
  onDeactivate: () => void;
  active: boolean;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.title !== undefined) node.title = props.title;
  if (props.type !== undefined) node.setAttribute("type", props.type);
  if (props.role !== undefined) node.setAttribute("role", props.role);
  if (props.ariaLabel !== undefined) node.setAttribute("aria-label", props.ariaLabel);
  if (props.ariaSelected !== undefined) {
    node.setAttribute("aria-selected", String(props.ariaSelected));
  }
  if (props.ariaPressed !== undefined) {
    node.setAttribute("aria-pressed", String(props.ariaPressed));
  }
  if (props.ariaChecked !== undefined) {
    node.setAttribute("aria-checked", String(props.ariaChecked));
  }
  if (props.dataset) {
    for (const [key, value] of Object.entries(props.dataset)) node.dataset[key] = value;
  }
  if (props.attrs) {
    for (const [key, value] of Object.entries(props.attrs)) node.setAttribute(key, value);
  }
  if (props.onClick) {
    node.addEventListener("click", (event) => props.onClick?.(event as MouseEvent));
  }
  if (props.onInput) node.addEventListener("input", props.onInput);
  appendChildren(node, children);
  return node;
}

export function card(children: Child[] = []): HTMLElement {
  return el("section", { className: "ap-card" }, children);
}

export function field(label: string, valueEl: HTMLElement, title?: string): HTMLElement {
  return el("label", { className: "ap-field", title }, [
    el("span", { className: "ap-field-label", text: label, title }),
    valueEl,
  ]);
}

export function slider(options: SliderOptions): HTMLElement {
  const fmt = options.fmt ?? ((value: number) => String(value));
  const valueEl = el("span", { className: "ap-slider-value", text: fmt(options.value) });
  const input = el("input", {
    className: "ap-range",
    type: "range",
    attrs: {
      min: String(options.min),
      max: String(options.max),
      step: String(options.step),
      value: String(options.value),
    },
    onInput: (event) => {
      const next = Number((event.currentTarget as HTMLInputElement).value);
      valueEl.textContent = fmt(next);
      options.onInput(next);
    },
  });
  // Label and value share one row (label left, value right); the range sits
  // directly beneath — no standalone value row wasting vertical space.
  return el("label", { className: "ap-field ap-field-slider", title: options.title }, [
    el("div", { className: "ap-slider-head" }, [
      el("span", { className: "ap-field-label", text: options.label, title: options.title }),
      valueEl,
    ]),
    input,
  ]);
}

export function segmented(
  options: SegmentOption[],
  activeId: string,
  onSelect: (id: string) => void,
): HTMLElement {
  return el("div", { className: "ap-segmented" }, options.map((option) =>
    el("button", {
      className: "ap-segment",
      type: "button",
      text: option.label,
      ariaPressed: option.id === activeId,
      onClick: () => onSelect(option.id),
    }),
  ));
}

export function chip(text: string, tone: Tone = "neutral"): HTMLElement {
  return el("span", {
    className: "ap-chip",
    text,
    dataset: { tone },
    attrs: { "aria-hidden": "true" },
  });
}

export function iconBtn(iconName: IconName, options: ButtonOptions = {}): HTMLButtonElement {
  const title = options.title ?? iconName;
  return el("button", {
    className: "ap-btn",
    type: "button",
    title,
    ariaLabel: title,
    dataset: { tone: options.tone ?? "neutral" },
    onClick: options.onClick,
  }, [icon(iconName)]) as HTMLButtonElement;
}

export function textBtn(
  iconName: IconName,
  label: string,
  options: ButtonOptions = {},
): HTMLButtonElement {
  return el("button", {
    className: "ap-btn",
    type: "button",
    title: options.title,
    dataset: { tone: options.tone ?? "neutral" },
    onClick: options.onClick,
  }, [icon(iconName), el("span", { text: label })]) as HTMLButtonElement;
}

export function switchToggle(on: boolean, onToggle: (on: boolean) => void): HTMLButtonElement {
  return el("button", {
    className: "ap-switch",
    type: "button",
    role: "switch",
    ariaChecked: on,
    onClick: (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const next = button.getAttribute("aria-checked") !== "true";
      button.setAttribute("aria-checked", String(next));
      onToggle(next);
    },
  }) as HTMLButtonElement;
}

export function sectionLabel(text: string): HTMLElement {
  return el("div", { className: "ap-section-label", text });
}

export function collapsible(
  summary: HTMLElement,
  body: HTMLElement,
  options: CollapsibleOptions = {},
): HTMLElement {
  let open = options.open ?? false;
  const bodyEl = el("div", { className: "ap-collapsible-body" }, [body]);
  const button = el("button", {
    className: "ap-collapsible-summary",
    type: "button",
    ariaLabel: "Toggle item",
    attrs: { "aria-expanded": String(open) },
    onClick: () => {
      open = !open;
      button.setAttribute("aria-expanded", String(open));
      bodyEl.hidden = !open;
      options.onToggle?.(open);
    },
  }, [
    el("span", { className: "ap-collapsible-summary-content" }, [summary]),
    icon("chevron-down"),
  ]);
  bodyEl.hidden = !open;

  return el("section", { className: "ap-collapsible" }, [
    button,
    bodyEl,
  ]);
}

export function gizmoBar(options: GizmoBarOptions): HTMLElement {
  return el("div", { className: "ap-gizmo-bar" }, [
    el("div", { className: "ap-gizmo-segments" }, [
      ...options.modes.map((mode) =>
        el("button", {
          className: "ap-gizmo-segment",
          type: "button",
          title: gizmoModeLabel(mode),
          ariaLabel: gizmoModeLabel(mode),
          onClick: () => options.onMode(mode),
        }, [icon(gizmoModeIcon(mode)), el("span", { text: gizmoModeLabel(mode) })]),
      ),
      ...(options.disabledModes ?? []).map(({ mode, reason }) =>
        el("button", {
          className: "ap-gizmo-segment",
          type: "button",
          title: reason,
          ariaLabel: gizmoModeLabel(mode),
          attrs: {
            "aria-disabled": "true",
            tabindex: "-1",
          },
        }, [icon(gizmoModeIcon(mode)), el("span", { text: gizmoModeLabel(mode) })]),
      ),
    ]),
    options.active
      ? textBtn("crosshair", "Deactivate", { onClick: options.onDeactivate })
      : null,
  ]);
}

export function icon(name: IconName): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "ap-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const body = iconPaths(name);
  for (const item of body) {
    const node = document.createElementNS(SVG_NS, item.tag);
    for (const [key, value] of Object.entries(item.attrs)) node.setAttribute(key, value);
    svg.appendChild(node);
  }
  return svg;
}

function gizmoModeLabel(mode: GizmoMode): string {
  switch (mode) {
    case "translate":
      return "Move";
    case "scale":
      return "Resize";
    case "rotate":
      return "Rotate";
  }
}

function gizmoModeIcon(mode: GizmoMode): IconName {
  switch (mode) {
    case "translate":
      return "move";
    case "scale":
      return "scaling";
    case "rotate":
      return "rotate-cw";
  }
}

interface SvgPart {
  tag: "path" | "circle" | "rect" | "polyline" | "line";
  attrs: Record<string, string>;
}

function appendChildren(parent: HTMLElement, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (child instanceof HTMLElement || child instanceof SVGElement || child instanceof Text) {
      parent.appendChild(child);
    } else {
      parent.appendChild(document.createTextNode(String(child)));
    }
  }
}

function path(d: string): SvgPart {
  return { tag: "path", attrs: { d } };
}

function line(x1: number, y1: number, x2: number, y2: number): SvgPart {
  return { tag: "line", attrs: { x1: String(x1), y1: String(y1), x2: String(x2), y2: String(y2) } };
}

function iconPaths(name: IconName): SvgPart[] {
  switch (name) {
    case "download":
      return [path("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"), path("M7 10l5 5 5-5"), path("M12 15V3")];
    case "plus":
      return [line(12, 5, 12, 19), line(5, 12, 19, 12)];
    case "map-pin":
      return [{ tag: "circle", attrs: { cx: "12", cy: "10", r: "3" } }, path("M12 22s7-5.2 7-12a7 7 0 0 0-14 0c0 6.8 7 12 7 12z")];
    case "type":
      return [path("M4 7V4h16v3"), line(9, 20, 15, 20), path("M12 4v16")];
    case "box":
      return [path("M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7z"), path("M3.3 7 12 12l8.7-5"), path("M12 22V12")];
    case "square-dashed":
      return [path("M5 3h2"), path("M11 3h2"), path("M17 3h2"), path("M21 5v2"), path("M21 11v2"), path("M21 17v2"), path("M19 21h-2"), path("M13 21h-2"), path("M7 21H5"), path("M3 19v-2"), path("M3 13v-2"), path("M3 7V5")];
    case "sliders":
    case "sliders-horizontal":
      return [line(4, 6, 10, 6), line(14, 6, 20, 6), { tag: "circle", attrs: { cx: "12", cy: "6", r: "2" } }, line(4, 12, 14, 12), line(18, 12, 20, 12), { tag: "circle", attrs: { cx: "16", cy: "12", r: "2" } }, line(4, 18, 7, 18), line(11, 18, 20, 18), { tag: "circle", attrs: { cx: "9", cy: "18", r: "2" } }];
    case "route":
      return [path("M4 19c3-6 13 0 16-6"), { tag: "circle", attrs: { cx: "5", cy: "5", r: "2" } }, { tag: "circle", attrs: { cx: "19", cy: "19", r: "2" } }, path("M7 5h4a3 3 0 0 1 0 6H9")];
    case "camera":
      return [path("M14.5 4 16 7h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3l1.5-3z"), { tag: "circle", attrs: { cx: "12", cy: "13", r: "3" } }];
    case "play":
      return [path("M8 5v14l11-7z")];
    case "arrow-up":
      return [path("M12 19V5"), path("M5 12l7-7 7 7")];
    case "arrow-down":
      return [path("M12 5v14"), path("M5 12l7 7 7-7")];
    case "trash":
      return [path("M3 6h18"), path("M8 6V4h8v2"), path("M19 6l-1 14H6L5 6"), line(10, 11, 10, 17), line(14, 11, 14, 17)];
    case "move":
      return [path("M12 2v20"), path("M2 12h20"), path("M5 9l-3 3 3 3"), path("M19 9l3 3-3 3"), path("M9 5l3-3 3 3"), path("M9 19l3 3 3-3")];
    case "scaling":
      return [path("M15 3h6v6"), path("M9 21H3v-6"), path("M21 3l-7 7"), path("M3 21l7-7")];
    case "rotate-cw":
      return [path("M21 12a9 9 0 1 1-2.6-6.4"), path("M21 3v6h-6")];
    case "crosshair":
      return [{ tag: "circle", attrs: { cx: "12", cy: "12", r: "7" } }, line(12, 2, 12, 6), line(12, 18, 12, 22), line(2, 12, 6, 12), line(18, 12, 22, 12)];
    case "chevron-down":
      return [path("M6 9l6 6 6-6")];
    case "info":
      return [{ tag: "circle", attrs: { cx: "12", cy: "12", r: "9" } }, line(12, 11, 12, 17), line(12, 7, 12, 7)];
    case "circle-check":
      return [{ tag: "circle", attrs: { cx: "12", cy: "12", r: "9" } }, path("M8 12l3 3 5-6")];
    case "triangle-alert":
      return [path("M12 3 2 21h20z"), line(12, 9, 12, 14), line(12, 18, 12, 18)];
    case "eye":
      return [path("M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"), { tag: "circle", attrs: { cx: "12", cy: "12", r: "3" } }];
    case "globe":
      return [{ tag: "circle", attrs: { cx: "12", cy: "12", r: "9" } }, path("M3 12h18"), path("M12 3a14 14 0 0 1 0 18"), path("M12 3a14 14 0 0 0 0 18")];
  }
}
