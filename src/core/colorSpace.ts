/**
 * Toolkit color-space opt-in — a dedicated side-effect module (ticket 03,
 * review finding), doc 04 Phase 1 item 3: the toolkit works in sRGB
 * (Spark's own working space).
 *
 * WHY a separate module: the write must precede ANY THREE.Color/material
 * construction, and coupling it to the ThreeSplatScene class file made the
 * opt-in depend on importing that one class — a cells/-only or text/-only
 * deep import would silently run in three's default linear space (the
 * [1,1,8]-vs-[17,17,51] class of divergence, proven by execution during
 * review). ThreeSplatScene imports this module; ticket 11's barrel must
 * import it FIRST (AC recorded there).
 *
 * HONEST LIMIT: module scope guarantees ordering only relative to modules
 * that (transitively) import this one. An entry file that evaluates a
 * Color-constructing module BEFORE any toolkit import still races — keep
 * toolkit imports first in entry files.
 *
 * KNOWN HAZARD (review, proven by execution — OWNER ATTENTION, ticket 03):
 * three 0.185's ColorManagement defines no workingColorSpaceConfig for
 * SRGBColorSpace, so with this global set, assigning the documented public
 * API `renderer.outputColorSpace = ...` on a CLASSIC THREE.WebGLRenderer
 * throws TypeError inside three (_getUnpackColorSpace). WebGPURenderer is
 * unaffected (the toolkit's path). Nothing in this repo assigns that
 * setter today; the rail fixture's classic WebGLRenderer dies at the
 * ticket 08 repoint. The doc 04 sRGB mandate vs three's classic-renderer
 * support matrix is recorded as an open owner item in ticket 03.
 */
import { ColorManagement, SRGBColorSpace } from "three/webgpu";

ColorManagement.workingColorSpace = SRGBColorSpace;
