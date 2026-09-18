/**
 * H-API consumer fixture — the SCENE-NAMING variant (ticket 09 AC6, owner
 * ruling Stop 17 C1; doc 06 D24).
 *
 * D24's prediction, made measurable: a consumer that names the scene class
 * compiles against sparkjs-toolkit and FAILS here, because this toolkit's scene
 * is `ThreeSplatScene` and there is no `SparkScene` — the loud one-line edit
 * D24 chose over a silently misrepresenting alias. Both compiles are quoted in
 * ticket 09's Comments; the failure IS the expected result, not a defect.
 *
 * The pin's own consumers name the scene by MODULE PATH (D24's evidence: all
 * 16 of them), which is what this file does.
 */

import { SparkScene } from "@toolkit/core/SparkScene";

export function sceneChildren(scene: SparkScene): number {
  return scene.scene.children.length;
}
