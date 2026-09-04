import { describe, expect, it } from "vitest";

import { MAP_CALIBRATION, calibrationFor } from "../calibration";
import { floorFor, project } from "../project";

describe("project", () => {
  it("places a real Customs screenshot where it was taken", () => {
    // From the 2026-09-03 screenshot: 0.1 m from a published player spawn.
    const point = project(MAP_CALIBRATION.customs, { x: 356.64, z: -24.3 });
    expect(point.u).toBeCloseTo(0.319, 2);
    expect(point.v).toBeCloseTo(0.48, 2);
  });

  it("puts the bounds corners at the corners", () => {
    for (const [key, calibration] of Object.entries(MAP_CALIBRATION)) {
      const box = calibration.svgBounds ?? calibration.bounds;
      const corners = [
        project(calibration, { x: box[0][0], z: box[0][1] }),
        project(calibration, { x: box[1][0], z: box[1][1] }),
      ];
      const us = corners.map((c) => c.u).sort((a, b) => a - b);
      const vs = corners.map((c) => c.v).sort((a, b) => a - b);
      expect(us[0], key).toBeCloseTo(0, 6);
      expect(us[1], key).toBeCloseTo(1, 6);
      expect(vs[0], key).toBeCloseTo(0, 6);
      expect(vs[1], key).toBeCloseTo(1, 6);
    }
  });

  it("keeps the centre of the map at the centre", () => {
    const { bounds } = MAP_CALIBRATION.woods;
    const point = project(MAP_CALIBRATION.woods, {
      x: (bounds[0][0] + bounds[1][0]) / 2,
      z: (bounds[0][1] + bounds[1][1]) / 2,
    });
    expect(point.u).toBeCloseTo(0.5, 6);
    expect(point.v).toBeCloseTo(0.5, 6);
  });

  it("uses svgBounds where the map publishes them", () => {
    // Reserve's picture is taller than its marker box, so the two disagree on purpose.
    const reserve = MAP_CALIBRATION.reserve;
    expect(reserve.svgBounds).toBeDefined();
    const atMarkerEdge = project(reserve, { x: 289, z: 244 });
    expect(atMarkerEdge.v).toBeGreaterThan(0);
    expect(atMarkerEdge.v).toBeLessThan(1);
  });
});

describe("floorFor", () => {
  it("picks the floor whose height band contains the position", () => {
    const streets = MAP_CALIBRATION["streets-of-tarkov"];
    expect(floorFor(streets, 17)?.svgLayer).toBe("Third_Floor");
    expect(floorFor(streets, -20)?.svgLayer).toBe("Underground_Level");
  });

  it("returns null at ground level", () => {
    expect(floorFor(MAP_CALIBRATION["streets-of-tarkov"], 2)).toBeNull();
  });

  it("returns null for a map with no floors", () => {
    expect(floorFor(MAP_CALIBRATION.woods, 50)).toBeNull();
  });
});

describe("calibrationFor", () => {
  it("finds a map by normalized name", () => {
    expect(calibrationFor({ normalizedName: "customs" })).toBe(MAP_CALIBRATION.customs);
  });

  it("is null for a map with no drawing, and for no map", () => {
    expect(calibrationFor({ normalizedName: "the-lab" })).toBeNull();
    expect(calibrationFor(null)).toBeNull();
    expect(calibrationFor(undefined)).toBeNull();
  });
});
