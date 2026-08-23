/**
 * ColmapData — Pure COLMAP reconstruction parser (no Three.js dependency)
 *
 * Parses cameras.txt/bin and images.txt/bin from COLMAP sparse reconstructions.
 * Provides coordinate conversion from COLMAP (Y-down, Z-forward) to Three.js
 * (Y-up, Z-backward) world space.
 *
 * Supports camera models: SIMPLE_PINHOLE, PINHOLE, SIMPLE_RADIAL, RADIAL, OPENCV.
 */

import * as THREE from "three";

// ─── Types ──────────────────────────────────────────────────────────

export interface ColmapCamera {
  id: number;
  model: string;
  width: number;
  height: number;
  params: number[];
}

export interface ColmapImage {
  id: number;
  qw: number;
  qx: number;
  qy: number;
  qz: number;
  tx: number;
  ty: number;
  tz: number;
  cameraId: number;
  name: string;
}

export interface ColmapData {
  cameras: Map<number, ColmapCamera>;
  images: Map<number, ColmapImage>;
}

export interface CameraPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  forward: THREE.Vector3;
  up: THREE.Vector3;
}

export interface ColmapLoadOptions {
  /** Base path to the sparse reconstruction folder (e.g. "/data/sparse/0/") */
  path?: string;
  /** Local files from a directory picker (<input webkitdirectory>) */
  files?: FileList | File[];
  /** Format to load — "auto" tries binary first, falls back to text (default: "auto") */
  format?: "text" | "binary" | "auto";
}

// ─── Camera Model Definitions ───────────────────────────────────────

/** Camera model name → number of parameters (all 11 COLMAP models) */
const CAMERA_MODEL_PARAMS: Record<string, number> = {
  SIMPLE_PINHOLE: 3,        // f, cx, cy
  PINHOLE: 4,               // fx, fy, cx, cy
  SIMPLE_RADIAL: 4,         // f, cx, cy, k
  RADIAL: 5,                // f, cx, cy, k1, k2
  OPENCV: 8,                // fx, fy, cx, cy, k1, k2, p1, p2
  OPENCV_FISHEYE: 8,        // fx, fy, cx, cy, k1, k2, k3, k4
  FULL_OPENCV: 12,          // fx, fy, cx, cy, k1, k2, p1, p2, k3, k4, k5, k6
  FOV: 5,                   // fx, fy, cx, cy, omega
  SIMPLE_RADIAL_FISHEYE: 4, // f, cx, cy, k
  RADIAL_FISHEYE: 5,        // f, cx, cy, k1, k2
  THIN_PRISM_FISHEYE: 12,   // fx, fy, cx, cy, k1, k2, p1, p2, k3, k4, sx1, sy1
};

/** Camera model ID (in binary format) → model name */
const CAMERA_MODEL_ID_TO_NAME: Record<number, string> = {
  0: "SIMPLE_PINHOLE",
  1: "PINHOLE",
  2: "SIMPLE_RADIAL",
  3: "RADIAL",
  4: "OPENCV",
  5: "OPENCV_FISHEYE",
  6: "FULL_OPENCV",
  7: "FOV",
  8: "SIMPLE_RADIAL_FISHEYE",
  9: "RADIAL_FISHEYE",
  10: "THIN_PRISM_FISHEYE",
};

// ─── Text Parsers ───────────────────────────────────────────────────

export function parseCamerasText(text: string): Map<number, ColmapCamera> {
  const cameras = new Map<number, ColmapCamera>();

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 5) continue;

    const id = parseInt(parts[0], 10);
    const model = parts[1];
    const width = parseInt(parts[2], 10);
    const height = parseInt(parts[3], 10);
    const params = parts.slice(4).map(Number);

    const expectedParams = CAMERA_MODEL_PARAMS[model];
    if (expectedParams === undefined) {
      console.warn(`[ColmapData] Unsupported camera model "${model}" (camera ${id}), skipping`);
      continue;
    }

    cameras.set(id, { id, model, width, height, params });
  }

  return cameras;
}

export function parseImagesText(text: string): Map<number, ColmapImage> {
  const images = new Map<number, ColmapImage>();

  const lines = text.split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"));

  // images.txt has two lines per image: pose line + points2D line
  for (let i = 0; i < lines.length; i += 2) {
    const parts = lines[i].split(/\s+/);
    if (parts.length < 10) continue;

    const image: ColmapImage = {
      id: parseInt(parts[0], 10),
      qw: parseFloat(parts[1]),
      qx: parseFloat(parts[2]),
      qy: parseFloat(parts[3]),
      qz: parseFloat(parts[4]),
      tx: parseFloat(parts[5]),
      ty: parseFloat(parts[6]),
      tz: parseFloat(parts[7]),
      cameraId: parseInt(parts[8], 10),
      name: parts[9],
    };

    images.set(image.id, image);
  }

  return images;
}

export function parseColmapText(camerasText: string, imagesText: string): ColmapData {
  return {
    cameras: parseCamerasText(camerasText),
    images: parseImagesText(imagesText),
  };
}

// ─── Binary Parsers ─────────────────────────────────────────────────

export function parseCamerasBinary(buffer: ArrayBuffer): Map<number, ColmapCamera> {
  const cameras = new Map<number, ColmapCamera>();
  const view = new DataView(buffer);
  let offset = 0;

  const numCameras = Number(view.getBigUint64(offset, true));
  offset += 8;

  for (let i = 0; i < numCameras; i++) {
    const id = view.getUint32(offset, true);
    offset += 4;

    const modelId = view.getInt32(offset, true);
    offset += 4;

    const width = Number(view.getBigUint64(offset, true));
    offset += 8;

    const height = Number(view.getBigUint64(offset, true));
    offset += 8;

    const model = CAMERA_MODEL_ID_TO_NAME[modelId];
    if (model === undefined) {
      console.warn(`[ColmapData] Unknown camera model ID ${modelId} (camera ${id}), skipping`);
      // Read remaining bytes as a fallback — assume no params and hope next camera aligns.
      // This is imperfect but better than aborting all cameras.
      continue;
    }

    const numParams = CAMERA_MODEL_PARAMS[model];
    const params: number[] = [];
    for (let p = 0; p < numParams; p++) {
      params.push(view.getFloat64(offset, true));
      offset += 8;
    }

    cameras.set(id, { id, model, width, height, params });
  }

  return cameras;
}

export function parseImagesBinary(buffer: ArrayBuffer): Map<number, ColmapImage> {
  const images = new Map<number, ColmapImage>();
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 0;

  const numImages = Number(view.getBigUint64(offset, true));
  offset += 8;

  for (let i = 0; i < numImages; i++) {
    const id = view.getUint32(offset, true);
    offset += 4;

    // Quaternion (wxyz) + translation (xyz) — 7 doubles
    const qw = view.getFloat64(offset, true); offset += 8;
    const qx = view.getFloat64(offset, true); offset += 8;
    const qy = view.getFloat64(offset, true); offset += 8;
    const qz = view.getFloat64(offset, true); offset += 8;
    const tx = view.getFloat64(offset, true); offset += 8;
    const ty = view.getFloat64(offset, true); offset += 8;
    const tz = view.getFloat64(offset, true); offset += 8;

    const cameraId = view.getUint32(offset, true);
    offset += 4;

    // Null-terminated image name
    let name = "";
    while (offset < bytes.length && bytes[offset] !== 0) {
      name += String.fromCharCode(bytes[offset]);
      offset++;
    }
    offset++; // skip null terminator

    // Skip 2D points: numPoints2D × (x:f64 + y:f64 + point3D_id:u64) = 24 bytes each
    const numPoints2D = Number(view.getBigUint64(offset, true));
    offset += 8;
    offset += numPoints2D * 24;

    images.set(id, { id, qw, qx, qy, qz, tx, ty, tz, cameraId, name });
  }

  return images;
}

export function parseColmapBinary(camerasBuf: ArrayBuffer, imagesBuf: ArrayBuffer): ColmapData {
  return {
    cameras: parseCamerasBinary(camerasBuf),
    images: parseImagesBinary(imagesBuf),
  };
}

// ─── Coordinate Conversion ──────────────────────────────────────────

/**
 * Convert a COLMAP image pose to Three.js world-space camera pose.
 *
 * COLMAP convention: Y-down, Z-forward, world-to-camera transform
 * Three.js convention: Y-up, Z-backward, camera-to-world transform
 *
 * The transform is a 180° rotation about the camera's local X-axis,
 * which flips both Y and Z.
 */
export function colmapPoseToThreeJS(image: ColmapImage): CameraPose {
  // Build rotation matrix from COLMAP quaternion (world-to-camera)
  const colmapQuat = new THREE.Quaternion(image.qx, image.qy, image.qz, image.qw);
  const R = new THREE.Matrix4().makeRotationFromQuaternion(colmapQuat);

  // Camera center in COLMAP world: C = -R^T * t
  const t = new THREE.Vector3(image.tx, image.ty, image.tz);
  const Rt = R.clone().transpose();
  const position = t.clone().negate().applyMatrix4(Rt);

  // Flip Y and Z to go from COLMAP world to Three.js world
  position.y = -position.y;
  position.z = -position.z;

  // Camera-to-world quaternion with coordinate system flip:
  // Apply 180° X-axis rotation (flips Y and Z) to the inverse of the COLMAP quaternion.
  // This simplifies to: THREE.Quaternion(-qx, qy, qz, qw)
  const quaternion = new THREE.Quaternion(-image.qx, image.qy, image.qz, image.qw).normalize();

  // Derive forward and up vectors from the quaternion
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);

  return { position, quaternion, forward, up };
}

// Shared 180° X-axis flip quaternion (converts COLMAP camera convention to Three.js)
const X_FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);

/**
 * Convert a COLMAP image pose to camera-space values **without** changing the
 * world coordinate system.  Positions stay in the original COLMAP/3DGS
 * reconstruction space — use this when the splat is loaded raw (no euler
 * rotation or quaternion flip on the SplatMesh).
 *
 * The quaternion is still adjusted so that Three.js rendering conventions
 * (forward = -Z, up = +Y) produce correct frustum geometry.
 */
export function colmapPoseRaw(image: ColmapImage): CameraPose {
  // World-to-camera rotation
  const colmapQuat = new THREE.Quaternion(image.qx, image.qy, image.qz, image.qw);
  const R = new THREE.Matrix4().makeRotationFromQuaternion(colmapQuat);

  // Camera center in COLMAP world: C = -R^T * t  (NO Y/Z flip)
  const t = new THREE.Vector3(image.tx, image.ty, image.tz);
  const Rt = R.clone().transpose();
  const position = t.clone().negate().applyMatrix4(Rt);

  // Camera-to-world rotation, then flip local axes so Three.js conventions
  // (-Z forward, +Y up) match COLMAP camera axes (+Z forward, -Y up)
  const quaternion = colmapQuat.clone().invert().multiply(X_FLIP).normalize();

  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);

  return { position, quaternion, forward, up };
}

// ─── Intrinsics Helpers ─────────────────────────────────────────────

/**
 * Extract focal lengths (fx, fy) from a COLMAP camera.
 * For single-focal models (SIMPLE_PINHOLE, SIMPLE_RADIAL, RADIAL), fx === fy.
 */
export function getFocalLengths(camera: ColmapCamera): { fx: number; fy: number } {
  const p = camera.params;
  switch (camera.model) {
    case "SIMPLE_PINHOLE":
    case "SIMPLE_RADIAL":
    case "RADIAL":
    case "SIMPLE_RADIAL_FISHEYE":
    case "RADIAL_FISHEYE":
      return { fx: p[0], fy: p[0] };
    case "PINHOLE":
    case "OPENCV":
    case "OPENCV_FISHEYE":
    case "FULL_OPENCV":
    case "FOV":
    case "THIN_PRISM_FISHEYE":
      return { fx: p[0], fy: p[1] };
    default:
      return { fx: p[0], fy: p[0] };
  }
}

/**
 * Extract principal point (cx, cy) from a COLMAP camera.
 */
export function getPrincipalPoint(camera: ColmapCamera): { cx: number; cy: number } {
  const p = camera.params;
  switch (camera.model) {
    case "SIMPLE_PINHOLE":
    case "SIMPLE_RADIAL":
    case "RADIAL":
    case "SIMPLE_RADIAL_FISHEYE":
    case "RADIAL_FISHEYE":
      return { cx: p[1], cy: p[2] };
    case "PINHOLE":
    case "OPENCV":
    case "OPENCV_FISHEYE":
    case "FULL_OPENCV":
    case "FOV":
    case "THIN_PRISM_FISHEYE":
      return { cx: p[2], cy: p[3] };
    default:
      return { cx: p[1], cy: p[2] };
  }
}

// ─── Async Loader ───────────────────────────────────────────────────

/**
 * Load COLMAP reconstruction data from a directory.
 *
 * Expects standard COLMAP output structure:
 * - Text: `cameras.txt` + `images.txt`
 * - Binary: `cameras.bin` + `images.bin`
 *
 * "auto" mode (default) tries binary first, falls back to text.
 */
export async function loadColmapData(options: ColmapLoadOptions): Promise<ColmapData> {
  if (options.files) {
    return loadColmapFromFiles(options.files, options.format ?? "auto");
  }

  if (!options.path) {
    throw new Error("[ColmapData] Either 'path' or 'files' must be provided");
  }

  const basePath = options.path.endsWith("/") ? options.path : options.path + "/";
  const format = options.format ?? "auto";

  if (format === "binary" || format === "auto") {
    try {
      const [camerasResp, imagesResp] = await Promise.all([
        fetch(basePath + "cameras.bin"),
        fetch(basePath + "images.bin"),
      ]);

      if (camerasResp.ok && imagesResp.ok) {
        const [camerasBuf, imagesBuf] = await Promise.all([
          camerasResp.arrayBuffer(),
          imagesResp.arrayBuffer(),
        ]);
        return parseColmapBinary(camerasBuf, imagesBuf);
      }

      if (format === "binary") {
        throw new Error(`[ColmapData] Binary files not found at ${basePath}`);
      }
      // auto mode: fall through to text
    } catch (e) {
      if (format === "binary") throw e;
      // auto mode: fall through to text
    }
  }

  // Text format
  const [camerasResp, imagesResp] = await Promise.all([
    fetch(basePath + "cameras.txt"),
    fetch(basePath + "images.txt"),
  ]);

  if (!camerasResp.ok || !imagesResp.ok) {
    throw new Error(`[ColmapData] COLMAP files not found at ${basePath}`);
  }

  const [camerasText, imagesText] = await Promise.all([
    camerasResp.text(),
    imagesResp.text(),
  ]);

  return parseColmapText(camerasText, imagesText);
}

// ─── Local File Loader ─────────────────────────────────────────────

function findFile(files: FileList | File[], name: string): File | undefined {
  const list = Array.from(files);
  // Prefer files inside a "sparse" directory (the real COLMAP output)
  // over top-level files which may be readmes or manifests with the same name.
  const sparse = list.find(f => {
    const p = f.webkitRelativePath;
    return p.includes("/sparse/") && (f.name === name || p.endsWith("/" + name));
  });
  if (sparse) return sparse;
  return list.find(f => f.name === name || f.webkitRelativePath.endsWith("/" + name));
}

async function loadColmapFromFiles(
  files: FileList | File[],
  format: "text" | "binary" | "auto",
): Promise<ColmapData> {
  console.log(`[ColmapData] loadColmapFromFiles: ${Array.from(files).length} files, format="${format}"`);

  if (format === "binary" || format === "auto") {
    const cameraBin = findFile(files, "cameras.bin");
    const imageBin = findFile(files, "images.bin");
    console.log(`[ColmapData] binary search: cameras.bin=${!!cameraBin}, images.bin=${!!imageBin}`);

    if (cameraBin && imageBin) {
      const [camerasBuf, imagesBuf] = await Promise.all([
        cameraBin.arrayBuffer(),
        imageBin.arrayBuffer(),
      ]);
      console.log(`[ColmapData] binary buffers: cameras=${camerasBuf.byteLength}B, images=${imagesBuf.byteLength}B`);
      return parseColmapBinary(camerasBuf, imagesBuf);
    }

    if (format === "binary") {
      throw new Error("[ColmapData] cameras.bin / images.bin not found in selected files");
    }
  }

  const cameraTxt = findFile(files, "cameras.txt");
  const imageTxt = findFile(files, "images.txt");
  console.log(`[ColmapData] text search: cameras.txt=${!!cameraTxt}, images.txt=${!!imageTxt}`);

  if (!cameraTxt || !imageTxt) {
    throw new Error("[ColmapData] No COLMAP files (cameras/images .bin or .txt) found in selected files");
  }

  const [camerasText, imagesText] = await Promise.all([
    cameraTxt.text(),
    imageTxt.text(),
  ]);

  return parseColmapText(camerasText, imagesText);
}
