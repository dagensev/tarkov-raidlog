import { describe, expect, it } from "vitest";

import { MAP_CALIBRATION, calibrationFor } from "../calibration";
import { floorFor, project } from "../project";

describe("project", () => {
  it("places a real Customs screenshot where it was taken", () => {
    // From the 2026-09-03 screenshot: 0.1 m from a published player spawn.
    const point = project(MAP_CALIBRATION.customs, { x: 356.64, z: -24.3 });
    expect(point.u).toBeCloseTo(0.319, 3);
    expect(point.v).toBeCloseTo(0.5197, 3);
  });

  /**
   * The top edge of a drawing is the map's *largest* rotated z.
   *
   * Reversing this mirrors every pin vertically, and almost nothing catches it: the aspect
   * ratio is unchanged, every point stays inside the bounds, and pins keep sitting on their
   * own outlines because both move together. It first shipped inverted and was only noticed
   * because a marker looked slightly wrong — slightly, because that screenshot happened to
   * be near the centre line, where a mirror is nearly a no-op.
   *
   * Checked against named landmarks tarkov.dev publishes for each map rather than against
   * our own arithmetic, so this fails if the orientation flips back.
   */
  it("counts v down from the largest rotated z, matching tarkov.dev's own placement", () => {
    // Customs, rotation 180: rotated z is -z, so the *smallest* raw z is the top edge.
    const customs = MAP_CALIBRATION.customs;
    const north = project(customs, { x: 0, z: -300 });
    const south = project(customs, { x: 0, z: 230 });
    expect(north.v).toBeLessThan(south.v);

    // tarkov.dev's label positions, with the fractions their Leaflet CRS produces.
    const landmarks: ReadonlyArray<[string, { x: number; z: number }, number]> = [
      ["Dorms", { x: 200, z: 150 }, 0.8401],
      ["Big Red", { x: -215, z: -119 }, 0.3456],
      ["New Gas", { x: 404, z: 31 }, 0.6213],
    ];
    for (const [name, position, expected] of landmarks) {
      expect(project(customs, position).v, name).toBeCloseTo(expected, 3);
    }
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

  it("resolves y on a shared boundary to the upper floor, because bands are half-open at the top", () => {
    // Bands exclude their top value, so a position exactly on a boundary lands on the floor
    // you are standing on rather than the one above your head. This guards against swapping
    // the `<` and `<=` operators in the height check.
    const streets = MAP_CALIBRATION["streets-of-tarkov"];
    expect(floorFor(streets, 10)?.svgLayer).toBe("Second_Floor");
    expect(floorFor(streets, 15)?.svgLayer).toBe("Third_Floor");
    expect(floorFor(streets, 20)?.svgLayer).toBe("Fourth_Floor");
    expect(floorFor(streets, -6)).toBeNull();
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
