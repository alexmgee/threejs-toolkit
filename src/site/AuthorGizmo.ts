import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";

export type AuthorGizmoMode = "translate" | "scale" | "rotate";
export type AuthorGizmoSpace = "world" | "local";

export interface AuthorGizmoTarget {
  modes: ReadonlyArray<AuthorGizmoMode>;
  getPosition(): [number, number, number];
  setPosition(position: [number, number, number]): void;
  getScale?(): [number, number, number];
  setScale?(scale: [number, number, number]): void;
  getRotationDeg?(): [number, number, number];
  setRotationDeg?(rotationDeg: [number, number, number]): void;
  onLiveChange?(): void;
  onCommit?(): void;
}

export interface AuthorGizmoConfig {
  scene: THREE.Scene;
  camera: THREE.Camera;
  domElement: HTMLElement;
  orbitControls?: { enabled: boolean };
}

/**
 * Authoring-only helper; one generic target at a time.
 *
 * Scale mode caveat: TransformControls scales the hidden proxy object's
 * `scale` property. Targets decide how that vector maps back to authored
 * data, including any uniform-scale or minimum-size rules.
 */
export class AuthorGizmo {
  private scene: THREE.Scene;
  private orbitControls: { enabled: boolean } | null;
  private proxy = new THREE.Object3D();
  private controls: TransformControls;
  private helper: THREE.Object3D;
  private target: AuthorGizmoTarget | null = null;
  private dragging = false;
  private disposed = false;
  private space: AuthorGizmoSpace = "world";

  constructor(config: AuthorGizmoConfig) {
    this.scene = config.scene;
    this.orbitControls = config.orbitControls ?? null;
    this.proxy.visible = false;
    this.scene.add(this.proxy);

    this.controls = new TransformControls(config.camera, config.domElement);
    this.helper = this.controls.getHelper();
    this.helper.visible = false;
    this.controls.addEventListener("objectChange", this.handleObjectChange);
    this.controls.addEventListener("dragging-changed", this.handleDraggingChanged);
  }

  get active(): boolean {
    return this.target !== null;
  }

  /** Transform space for the translate/rotate handles. Scale is ALWAYS local —
   *  TransformControls behavior regardless of space. Persists across attaches. */
  setSpace(space: AuthorGizmoSpace): void {
    this.space = space;
    this.controls.setSpace(space);
  }

  /** Re-read the proxy from the current target — call after a structural edit
   *  moves the attached entity (fit/re-center), or the next drag resumes from a
   *  stale proxy and jumps the entity back to its pre-edit transform. */
  resync(): void {
    if (this.target) this.syncProxyFromTarget(this.target);
  }

  attach(target: AuthorGizmoTarget, mode: AuthorGizmoMode): void {
    if (this.disposed) return;
    if (!target.modes.includes(mode)) {
      throw new Error(`AuthorGizmo: target does not support ${mode} mode.`);
    }
    if (mode === "scale" && !target.setScale) {
      throw new Error("AuthorGizmo: scale mode requires setScale().");
    }
    if (mode === "rotate" && !target.setRotationDeg) {
      throw new Error("AuthorGizmo: rotate mode requires setRotationDeg().");
    }

    this.target = target;
    this.syncProxyFromTarget(target);
    this.controls.setMode(mode);
    this.controls.setSpace(this.space); // explicit re-apply — robust across attaches
    this.controls.attach(this.proxy);
    this.helper.visible = true;
    if (!this.helper.parent) this.scene.add(this.helper);
  }

  detach(): void {
    this.controls.detach();
    this.target = null;
    this.dragging = false;
    this.helper.visible = false;
    if (this.helper.parent) this.helper.parent.remove(this.helper);
    if (this.orbitControls) this.orbitControls.enabled = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detach();
    this.controls.removeEventListener("objectChange", this.handleObjectChange);
    this.controls.removeEventListener("dragging-changed", this.handleDraggingChanged);
    this.controls.dispose();
    this.proxy.removeFromParent();
  }

  private syncProxyFromTarget(target: AuthorGizmoTarget): void {
    this.proxy.position.set(...target.getPosition());
    this.proxy.scale.set(...(target.getScale?.() ?? [1, 1, 1]));
    const rotationDeg = target.getRotationDeg?.() ?? [0, 0, 0];
    this.proxy.rotation.set(
      THREE.MathUtils.degToRad(rotationDeg[0]),
      THREE.MathUtils.degToRad(rotationDeg[1]),
      THREE.MathUtils.degToRad(rotationDeg[2]),
      "XYZ",
    );
    this.proxy.updateMatrixWorld();
  }

  private handleObjectChange = (): void => {
    if (!this.target) return;
    const mode = this.controls.getMode();
    if (mode === "translate") {
      this.target.setPosition([
        this.proxy.position.x,
        this.proxy.position.y,
        this.proxy.position.z,
      ]);
    } else if (mode === "scale" && this.target.setScale) {
      const scale: [number, number, number] = [
        Math.abs(this.proxy.scale.x),
        Math.abs(this.proxy.scale.y),
        Math.abs(this.proxy.scale.z),
      ];
      this.proxy.scale.set(...scale);
      this.target.setScale(scale);
      const synced = this.target.getScale?.();
      if (synced) this.proxy.scale.set(...synced);
    } else if (mode === "rotate" && this.target.setRotationDeg) {
      this.target.setRotationDeg([
        THREE.MathUtils.radToDeg(this.proxy.rotation.x),
        THREE.MathUtils.radToDeg(this.proxy.rotation.y),
        THREE.MathUtils.radToDeg(this.proxy.rotation.z),
      ]);
    }
    this.target.onLiveChange?.();
  };

  private handleDraggingChanged = (event: { value: unknown }): void => {
    const dragging = Boolean(event.value);
    if (this.orbitControls) this.orbitControls.enabled = !dragging;
    if (this.dragging && !dragging) {
      this.target?.onCommit?.();
      // onCommit may bake the dragged transform into the authored value and
      // reset the live object (e.g. splat-text scale→size bake resets object
      // scale to 1). Re-sync the proxy from that committed state, or the next
      // drag resumes from the stale proxy scale and compounds.
      if (this.target) this.syncProxyFromTarget(this.target);
    }
    this.dragging = dragging;
  };
}
