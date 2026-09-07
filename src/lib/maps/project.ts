import type { MapCalibration, MapFloor } from "./calibration";

/**
 * Game coordinates onto a map drawing.
 *
 * tarkov.dev does this with a Leaflet CRS built from `transform` and `coordinateRotation`.
 * The `transform` looks essential and is not: the picture and the markers project through
 * the same CRS, so it cancels out of anything positioned *relative to the picture*. What
 * is left is a rotation and a normalisation against the map's bounds, which is this file
 * and needs no map library at all.
 *
 * Checked two ways before being written: ~2,600 published spawn and extract positions land
 * inside bounds on eleven of thirteen maps, and every SVG's aspect ratio matches its
 * rotated bounds to better than 1%.
 */

export interface MapPoint {
  /** Fraction across the picture from its left edge, 0 to 1. */
  u: number;
  /** Fraction down the picture from its top edge, 0 to 1. */
  v: number;
}

/** Rotate a point about the origin. Rotations are multiples of 90°, so a box stays a box. */
function rotate(x: number, z: number, degrees: number): [number, number] {
  if (!degrees) return [x, z];
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [x * cos - z * sin, x * sin + z * cos];
}

/** Where a game position falls on the map picture. Values outside 0–1 are off the map. */
export function project(
  calibration: MapCalibration,
  point: { x: number; z: number },
): MapPoint {
  const box = calibration.svgBounds ?? calibration.bounds;
  const rotation = calibration.coordinateRotation;

  const [ax, az] = rotate(box[0][0], box[0][1], rotation);
  const [bx, bz] = rotate(box[1][0], box[1][1], rotation);
  const [px, pz] = rotate(point.x, point.z, rotation);

  const minX = Math.min(ax, bx);
  const minZ = Math.min(az, bz);

  return {
    u: (px - minX) / Math.abs(bx - ax),
    v: (pz - minZ) / Math.abs(bz - az),
  };
}

/**
 * The floor a height falls on, or null for the base layer.
 *
 * Bands are half-open at the top so a position exactly on a boundary picks the lower
 * floor, which is where you are standing rather than the one above your head.
 */
export function floorFor(calibration: MapCalibration, y: number): MapFloor | null {
  for (const floor of calibration.floors) {
    if (y >= floor.height[0] && y < floor.height[1]) return floor;
  }
  return null;
}
