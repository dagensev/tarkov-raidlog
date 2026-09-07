import { describe, expect, it } from "vitest";

import { MAP_CALIBRATION } from "../calibration";

/**
 * The calibration in `calibration.ts` is vendored. If tarkov.dev redraws a map, every pin
 * on it slides and nothing else complains — so this compares each drawing's aspect ratio
 * against the bounds we hold for it. Measured drift when the table was written was under
 * 1% on every map, worst 0.94% on Customs.
 *
 * Checks the real tarkov.dev SVG endpoints. Skips when offline or when SKIP_LIVE_API=1,
 * so a network outage or an offline machine does not fail the build.
 */

const skip = process.env.SKIP_LIVE_API === "1";

async function probe(): Promise<boolean> {
  if (skip) return false;
  try {
    const response = await fetch(
      "https://assets.tarkov.dev/maps/svg/Customs.svg",
      { method: "HEAD" },
    );
    return response.ok;
  } catch {
    return false;
  }
}

const isAvailable = await probe();

function rotate(x: number, z: number, degrees: number): [number, number] {
  if (!degrees) return [x, z];
  const radians = (degrees * Math.PI) / 180;
  return [
    x * Math.cos(radians) - z * Math.sin(radians),
    x * Math.sin(radians) + z * Math.cos(radians),
  ];
}

describe.skipIf(!isAvailable)("vendored map calibration", () => {
  for (const [key, calibration] of Object.entries(MAP_CALIBRATION)) {
    it(`still matches the drawing for ${key}`, async () => {
      const response = await fetch(calibration.svgPath);
      expect(response.ok, `${key}: ${response.status}`).toBe(true);

      const viewBox = /viewBox="([\d.\-\s]+)"/.exec(await response.text());
      expect(viewBox, `${key}: no viewBox`).not.toBeNull();
      const [, , width, height] = viewBox![1].trim().split(/\s+/).map(Number);

      const box = calibration.svgBounds ?? calibration.bounds;
      const [ax, az] = rotate(box[0][0], box[0][1], calibration.coordinateRotation);
      const [bx, bz] = rotate(box[1][0], box[1][1], calibration.coordinateRotation);

      const drawn = width / height;
      const expected = Math.abs(bx - ax) / Math.abs(bz - az);
      expect(Math.abs(drawn - expected) / expected, `${key} drift`).toBeLessThan(0.02);
    }, 20_000);
  }
});
