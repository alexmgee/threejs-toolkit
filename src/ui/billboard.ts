import * as THREE from "three";

const _camPos = new THREE.Vector3();
const _objPos = new THREE.Vector3();

/**
 * Orient `object` toward `camera`. Call once per frame.
 *
 * "none" is a no-op: the caller owns the static `rotationDeg` in that mode.
 * Assumes `object` and `camera` are parented to the scene root — "full" copies
 * the camera's local quaternion, which is its world quaternion only there.
 */
export function applyBillboard(
  object: THREE.Object3D,
  camera: THREE.Camera,
  mode: "full" | "y" | "none",
): void {
  if (mode === "none") return;
  if (mode === "full") {
    object.quaternion.copy(camera.quaternion);
    return;
  }
  // "y": yaw-only — stays upright, faces the camera's horizontal direction
  camera.getWorldPosition(_camPos);
  object.getWorldPosition(_objPos);
  object.rotation.set(0, Math.atan2(_camPos.x - _objPos.x, _camPos.z - _objPos.z), 0);
}
