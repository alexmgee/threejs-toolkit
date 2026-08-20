/**
 * GeoAnchor — Georeferencing primitive for site scenes
 *
 * Defines a scene-local origin on the Earth without importing rendering
 * or math dependencies. Scene axes follow a local ENU convention:
 *
 *   scene +X -> East, scene +Z -> North, scene +Y -> Up
 *
 * headingDeg is scene +Z's compass bearing in degrees clockwise from
 * true north. scale is metres per scene unit.
 */

// ─── Types ────────────────────────────────────────────────

export interface GeoAnchor {
  lat: number;
  lon: number;
  alt?: number;
  headingDeg?: number;
  scale?: number;
}

// ─── Constants ────────────────────────────────────────────

const PI = Math.PI;
const METRES_PER_DEG_LAT = 111320;
const EARTH_RADIUS_METRES = METRES_PER_DEG_LAT * 180 / PI;

// ─── Math Helpers ─────────────────────────────────────────

export function geodeticToScene(a: GeoAnchor, lat: number, lon: number, alt?: number): { x: number; y: number; z: number } {
  const metresPerDegLon = METRES_PER_DEG_LAT * Math.cos(a.lat * PI / 180);
  const theta = (a.headingDeg ?? 0) * PI / 180;
  const s = a.scale ?? 1;

  const east = (lon - a.lon) * metresPerDegLon;
  const north = (lat - a.lat) * METRES_PER_DEG_LAT;
  const up = (alt ?? 0) - (a.alt ?? 0);

  return {
    x: (east * Math.cos(theta) - north * Math.sin(theta)) / s,
    y: up / s,
    z: (east * Math.sin(theta) + north * Math.cos(theta)) / s,
  };
}

export function sceneToGeodetic(a: GeoAnchor, x: number, y: number, z: number): { lat: number; lon: number; alt: number } {
  const metresPerDegLon = METRES_PER_DEG_LAT * Math.cos(a.lat * PI / 180);
  const theta = (a.headingDeg ?? 0) * PI / 180;
  const s = a.scale ?? 1;

  const east = (x * s) * Math.cos(theta) + (z * s) * Math.sin(theta);
  const north = -(x * s) * Math.sin(theta) + (z * s) * Math.cos(theta);
  const up = y * s;

  return {
    lat: a.lat + north / METRES_PER_DEG_LAT,
    lon: a.lon + east / metresPerDegLon,
    alt: (a.alt ?? 0) + up,
  };
}

export function bearingDistance(from: GeoAnchor, to: GeoAnchor): { bearingDeg: number; meters: number } {
  const lat1 = from.lat * PI / 180;
  const lat2 = to.lat * PI / 180;
  const dLat = lat2 - lat1;
  const dLon = (to.lon - from.lon) * PI / 180;

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const meters = 2 * EARTH_RADIUS_METRES * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearingDeg = (Math.atan2(y, x) * 180 / PI + 360) % 360;

  return { bearingDeg, meters };
}
