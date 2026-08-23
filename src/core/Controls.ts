/**
 * Controls — Camera control abstraction for the toolkit
 *
 * Wraps Three.js OrbitControls for the common orbit/pan/zoom
 * interaction pattern needed by most sites. Also supports
 * SparkControls (FPS-style) as an alternative.
 *
 * OrbitControls is the right default for portfolio viewers,
 * sculpture inspection, and embedded viewports. SparkControls
 * (FPS/fly mode) can be swapped in for world exploration.
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export interface OrbitControlsConfig {
  /** The camera to control */
  camera: THREE.PerspectiveCamera;
  /** The canvas element for event binding */
  canvas: HTMLCanvasElement;
  /** Enable damping / inertia (default: true) */
  enableDamping?: boolean;
  /** Damping factor when enableDamping is true (default: 0.1) */
  dampingFactor?: number;
  /** Minimum orbit distance (default: 0.5) */
  minDistance?: number;
  /** Maximum orbit distance (default: 500) */
  maxDistance?: number;
  /** Minimum polar angle in radians — prevents flipping below ground (default: 0.1) */
  minPolarAngle?: number;
  /** Maximum polar angle in radians (default: Math.PI - 0.1) */
  maxPolarAngle?: number;
  /** Enable auto-rotation (default: false) */
  autoRotate?: boolean;
  /** Auto-rotation speed (default: 1.0) */
  autoRotateSpeed?: number;
  /** Orbit target point (default: [0, 0, 0]) */
  target?: [number, number, number];
  /** Pan speed (default: 1.0) */
  panSpeed?: number;
  /** Zoom/dolly speed (default: 1.0) */
  zoomSpeed?: number;
  /** Enable panning (default: true) */
  enablePan?: boolean;
}

export function createOrbitControls(config: OrbitControlsConfig): OrbitControls {
  const {
    camera,
    canvas,
    enableDamping = true,
    dampingFactor = 0.1,
    minDistance = 0.5,
    maxDistance = 500,
    minPolarAngle = 0.1,
    maxPolarAngle = Math.PI - 0.1,
    autoRotate = false,
    autoRotateSpeed = 1.0,
    target = [0, 0, 0],
    panSpeed = 1.0,
    zoomSpeed = 1.0,
    enablePan = true,
  } = config;

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = enableDamping;
  controls.dampingFactor = dampingFactor;
  controls.minDistance = minDistance;
  controls.maxDistance = maxDistance;
  controls.minPolarAngle = minPolarAngle;
  controls.maxPolarAngle = maxPolarAngle;
  controls.autoRotate = autoRotate;
  controls.autoRotateSpeed = autoRotateSpeed;
  controls.target.set(...target);
  controls.panSpeed = panSpeed;
  controls.zoomSpeed = zoomSpeed;
  controls.enablePan = enablePan;

  return controls;
}
