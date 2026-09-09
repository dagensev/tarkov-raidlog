import { describe, expect, it } from "vitest";

import {
  FITTED,
  MAX_SCALE,
  clampView,
  fitBox,
  wheelFactor,
  zoomAt,
  type Point,
  type View,
} from "../viewport";

/** A 16:9 open area, in CSS pixels. */
const WIDE = { width: 1600, height: 900 };
/** A square area with a square picture, so both axes overflow together. */
const SQUARE = { width: 1000, height: 1000 };
const SQUARE_BOX = { width: 1000, height: 1000 };

/**
 * The picture point currently under a cursor, in unscaled stage pixels from the stage's
 * centre. Inverting the transform the component applies: a point `p` lands at
 * `view.x + p * view.scale` from the area's centre.
 */
function under(view: View, at: Point): Point {
  return { x: (at.x - view.x) / view.scale, y: (at.y - view.y) / view.scale };
}

describe("fitBox", () => {
  it("is bound by the area's width when the picture is the wider shape", () => {
    expect(fitBox(2, WIDE)).toEqual({ width: 1600, height: 800 });
  });

  it("is bound by the area's height when the picture is the taller shape", () => {
    expect(fitBox(1, WIDE)).toEqual({ width: 900, height: 900 });
  });

  it("keeps the picture's aspect ratio exactly", () => {
    const box = fitBox(1.3, { width: 640, height: 480 });
    expect(box.width / box.height).toBeCloseTo(1.3, 10);
  });

  it("never overflows the area", () => {
    for (const aspect of [0.2, 0.9, 1, 16 / 9, 5]) {
      const box = fitBox(aspect, WIDE);
      expect(box.width).toBeLessThanOrEqual(WIDE.width);
      expect(box.height).toBeLessThanOrEqual(WIDE.height);
    }
  });

  it("returns nothing for an area that has not been measured yet", () => {
    // The first paint, before the ResizeObserver has fired. Must not divide by zero.
    expect(fitBox(1.6, { width: 0, height: 0 })).toEqual({ width: 0, height: 0 });
  });
});

describe("clampView", () => {
  // 1600x800 inside 1600x900: width-bound, with letterboxing top and bottom.
  const BOX = fitBox(2, WIDE);

  it("allows no panning at all in the fitted view", () => {
    const clamped = clampView({ scale: 1, x: 300, y: -200 }, BOX, WIDE);
    expect(clamped.scale).toBe(1);
    expect(clamped.x).toBeCloseTo(0, 10);
    expect(clamped.y).toBeCloseTo(0, 10);
  });

  it("allows panning only across the overflow", () => {
    // At x2 the picture is 3200x1600 in a 1600x900 area: 800 px of slack each way
    // horizontally, 350 vertically.
    expect(clampView({ scale: 2, x: 5000, y: 5000 }, BOX, WIDE)).toEqual({
      scale: 2,
      x: 800,
      y: 350,
    });
    expect(clampView({ scale: 2, x: -5000, y: -5000 }, BOX, WIDE)).toEqual({
      scale: 2,
      x: -800,
      y: -350,
    });
  });

  it("leaves a view already inside the overflow alone", () => {
    const view = { scale: 2, x: 120, y: -40 };
    expect(clampView(view, BOX, WIDE)).toEqual(view);
  });

  it("clamps the scale at both ends", () => {
    expect(clampView({ scale: 0.25, x: 0, y: 0 }, BOX, WIDE).scale).toBe(1);
    expect(clampView({ scale: 99, x: 0, y: 0 }, BOX, WIDE).scale).toBe(MAX_SCALE);
  });
});

describe("zoomAt", () => {
  it("keeps the point under the cursor still", () => {
    // The property the whole feature rests on. Cases are chosen to sit well inside the
    // clamp, because clamping is allowed to override this — see the test below.
    const starts: View[] = [FITTED, { scale: 2, x: 0, y: 0 }, { scale: 4, x: -300, y: 200 }];
    const cursors: Point[] = [
      { x: 0, y: 0 },
      { x: 200, y: 100 },
      { x: -150, y: 90 },
    ];
    for (const start of starts) {
      for (const at of cursors) {
        for (const factor of [1.2, 1 / 1.2, 2]) {
          const next = zoomAt(start, factor, at, SQUARE_BOX, SQUARE);
          expect(under(next, at).x).toBeCloseTo(under(start, at).x, 6);
          expect(under(next, at).y).toBeCloseTo(under(start, at).y, 6);
        }
      }
    }
  });

  it("zooms in and out", () => {
    expect(zoomAt(FITTED, 2, { x: 0, y: 0 }, SQUARE_BOX, SQUARE).scale).toBe(2);
    expect(zoomAt({ scale: 4, x: 0, y: 0 }, 0.5, { x: 0, y: 0 }, SQUARE_BOX, SQUARE).scale).toBe(2);
  });

  it("lets the clamp override the cursor when it would pull the map off the edge", () => {
    // Panned hard right at x4 (the limit there is 1500), then zoomed out. Holding the
    // cursor point still would need x=750, but at x2 the limit is 500.
    const next = zoomAt({ scale: 4, x: 1500, y: 0 }, 0.5, { x: 0, y: 0 }, SQUARE_BOX, SQUARE);
    expect(next.scale).toBe(2);
    expect(next.x).toBe(500);
  });

  it("lands back on the fitted view when you zoom all the way out", () => {
    let view: View = { scale: 6, x: 900, y: -400 };
    for (let step = 0; step < 20; step++) {
      view = zoomAt(view, 1 / 1.2, { x: 300, y: 120 }, SQUARE_BOX, SQUARE);
    }
    expect(view.scale).toBe(1);
    expect(view.x).toBeCloseTo(0, 10);
    expect(view.y).toBeCloseTo(0, 10);
  });
});

describe("wheelFactor", () => {
  it("zooms in on a negative delta", () => {
    expect(wheelFactor(-100, 0)).toBeGreaterThan(1);
  });

  it("zooms out on a positive delta", () => {
    expect(wheelFactor(100, 0)).toBeLessThan(1);
  });

  it("treats a line as sixteen pixels", () => {
    expect(wheelFactor(3, 1)).toBeCloseTo(wheelFactor(48, 0), 12);
  });

  it("treats a page as materially more than the same number in pixels", () => {
    // "materially larger": how far each factor sits from 1 (the no-op factor), not the
    // factor itself — both are on the zoom-out side because the delta is positive.
    const page = Math.abs(wheelFactor(1, 2) - 1);
    const pixel = Math.abs(wheelFactor(1, 0) - 1);
    expect(page).toBeGreaterThan(pixel * 10);
    // One page must equal the pixels-per-page constant's worth of pixels (mirrors module value of 800).
    expect(wheelFactor(1, 2)).toBeCloseTo(wheelFactor(800, 0), 12);
  });

  it("composes a delta and its negation back to a factor of 1", () => {
    const cases: Array<[number, number]> = [
      [120, 0],
      [-120, 0],
      [3, 1],
      [1, 2],
    ];
    for (const [delta, mode] of cases) {
      expect(wheelFactor(delta, mode) * wheelFactor(-delta, mode)).toBeCloseTo(1, 10);
    }
  });
});
