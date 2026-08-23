/**
 * contextSim.ts — the author-mode context simulator (D11, P8c).
 *
 * A strip pinned to the author panel's bottom that OVERRIDES fields on the
 * `ResolveContext` the inspector's DISPLAY `resolve()` uses — and nothing
 * else. It is a STYLE preview, not a layout preview: free rects and panel
 * geometry keep denormalizing against the real container, the live TextSystem
 * never sees these values, and WRITE-field decisions resolve against the live
 * context (a sim-activated variant must not steer what an edit persists). This
 * closes P7a's deferred G1 (the inspector previously resolved at a fixed base
 * context of `{containerW, containerH, progress: 0}`).
 *
 * State is INSTANCE-owned (one per AuthorPanel) — a module singleton would leak
 * a preview between two panels or into a recreated panel (consult finding A).
 */

import { DEMO_PLACES } from "../../locative/GeoContext";
import type { ResolveContext } from "../../text/TextModel";
import { el, field, slider, switchToggle } from "./primitives";

interface SimState {
  widthPx: number | null;
  heightPx: number | null;
  progress: number | null;
  placeId: string | null;
  distanceM: number;
  hover: boolean;
  selected: boolean;
}

const inactive = (): SimState => ({
  widthPx: null,
  heightPx: null,
  progress: null,
  placeId: null,
  distanceM: 0,
  hover: false,
  selected: false,
});

export interface ContextSimOptions {
  containerSize: () => { w: number; h: number };
  /** Fired on every override change — the panel re-renders the inspector so
   *  its resolved values and tier dots reflect the simulated context. */
  onChange: () => void;
}

/** The context simulator. `element` mounts in the panel footer; `context()`
 *  is what the inspector applies to its DISPLAY resolve context. */
export class ContextSim {
  readonly element: HTMLElement;
  private sim: SimState = inactive();

  constructor(private readonly options: ContextSimOptions) {
    this.element = el("div", { className: "ap-sim-strip" });
    this.rebuild();
  }

  /** Apply the simulator's overrides to the inspector's base resolve context.
   *  With nothing overridden the base passes through untouched (live ctx). */
  context(base: ResolveContext): ResolveContext {
    if (!this.anyOverride()) return base;
    const states = new Set<"hover" | "selected">();
    if (this.sim.hover) states.add("hover");
    if (this.sim.selected) states.add("selected");
    return {
      ...base,
      ...(this.sim.widthPx !== null ? { containerW: this.sim.widthPx } : {}),
      ...(this.sim.heightPx !== null ? { containerH: this.sim.heightPx } : {}),
      ...(this.sim.progress !== null ? { progress: this.sim.progress } : {}),
      ...(this.sim.placeId !== null ? { placeId: this.sim.placeId, distanceM: this.sim.distanceM } : {}),
      ...(states.size > 0 ? { states } : {}),
    };
  }

  private anyOverride(): boolean {
    return this.sim.widthPx !== null
      || this.sim.heightPx !== null
      || this.sim.progress !== null
      || this.sim.placeId !== null
      || this.sim.hover
      || this.sim.selected;
  }

  private rebuild(): void {
    this.element.replaceChildren(this.build());
  }

  private build(): HTMLElement {
    const liveSize = this.options.containerSize();
    const liveW = liveSize.w;
    const liveH = liveSize.h;
    // Always-present Clear whose enabled state updates WITHOUT a strip rebuild —
    // sliders/toggles must not rebuild mid-gesture (a rebuild replaces the input
    // being dragged), so a conditionally-rendered button would never reappear
    // after the first scrub.
    const clearBtn = el("button", {
      className: "ap-btn",
      type: "button",
      title: "Clear all overrides (restore live context)",
      text: "Clear",
      onClick: () => {
        this.sim = inactive();
        this.options.onChange();
        this.rebuild();
      },
    }) as HTMLButtonElement;
    const notify = (): void => {
      clearBtn.disabled = !this.anyOverride();
      this.options.onChange();
    };
    clearBtn.disabled = !this.anyOverride();

    const placeSelect = el("select", { className: "ap-input ap-select", ariaLabel: "Simulated place" }) as HTMLSelectElement;
    const live = document.createElement("option");
    live.value = "";
    live.textContent = "— live —";
    placeSelect.appendChild(live);
    for (const key of Object.keys(DEMO_PLACES)) {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = key;
      placeSelect.appendChild(option);
    }
    placeSelect.value = this.sim.placeId ?? "";
    placeSelect.addEventListener("change", () => {
      this.sim.placeId = placeSelect.value === "" ? null : placeSelect.value;
      notify();
      this.rebuild(); // the distance field appears/disappears with the place
    });

    const children: (HTMLElement | null)[] = [
      el("div", { className: "ap-sim-strip-head" }, [
        el("span", { className: "ap-section-label", text: "Context simulator" }),
        clearBtn,
      ]),
      slider({
        label: "Viewport width (px)",
        value: this.sim.widthPx ?? liveW,
        min: 320,
        max: 1920,
        step: 10,
        onInput: (value) => {
          this.sim.widthPx = value;
          notify();
        },
      }),
      slider({
        label: "Viewport height (px)",
        value: this.sim.heightPx ?? liveH,
        min: 240,
        max: 1600,
        step: 10,
        onInput: (value) => {
          this.sim.heightPx = value;
          notify();
        },
      }),
      slider({
        label: "Progress",
        value: this.sim.progress ?? 0,
        min: 0,
        max: 1,
        step: 0.01,
        fmt: (value) => String(Number(value.toFixed(2))),
        onInput: (value) => {
          this.sim.progress = value;
          notify();
        },
      }),
      field("Place", placeSelect),
      this.sim.placeId !== null
        ? slider({
            label: "Distance (m)",
            value: this.sim.distanceM,
            min: 0,
            max: 2000,
            step: 10,
            onInput: (value) => {
              this.sim.distanceM = value;
              notify();
            },
          })
        : null,
      el("div", { className: "ap-sim-strip-toggles" }, [
        field("Hover", switchToggle(this.sim.hover, (on) => {
          this.sim.hover = on;
          notify();
        })),
        field("Selected", switchToggle(this.sim.selected, (on) => {
          this.sim.selected = on;
          notify();
        })),
      ]),
      el("div", {
        className: "ap-hint",
        text: "Style preview only — layout, free rects and panel geometry stay live.",
      }),
    ];
    return el("div", { className: "ap-stack ap-sim-strip-body" }, children);
  }
}
