import { describe, expect, it } from "vitest";

import { itemBox, type BoxLimits } from "../item-box";

/** The calculators' own limits, so these read as what is actually on screen. */
const LIMITS: BoxLimits = { maxUnit: 46, maxHeight: 92, maxWidth: 46 * 6 };

describe("itemBox", () => {
  it("draws a one-cell item at the full unit", () => {
    expect(itemBox({ width: 1, height: 1 }, LIMITS)).toEqual({ width: 46, height: 46, unit: 46 });
  });

  it("draws the same one-cell item the same size whatever it sits beside", () => {
    // The point of a fixed unit: a LEDX next to a pistol and a LEDX next to a weapon case
    // are the same LEDX, and a box that changed size would read as a different item.
    const alone = itemBox({ width: 1, height: 1 }, LIMITS);
    itemBox({ width: 6, height: 6 }, LIMITS);
    expect(itemBox({ width: 1, height: 1 }, LIMITS)).toEqual(alone);
  });

  it("draws a gun at the full unit, wide and flat", () => {
    // A 5×2 assault rifle, which is what most of them are. This is the case the module
    // exists for, and it was the one getting it worst: with the width budget at three cells
    // every gun in the game scaled to roughly half the unit everything else was drawn at.
    expect(itemBox({ width: 5, height: 2 }, LIMITS)).toEqual({ width: 230, height: 92, unit: 46 });
  });

  it("draws the widest gun published without scaling it either", () => {
    expect(itemBox({ width: 6, height: 2 }, LIMITS).unit).toBe(LIMITS.maxUnit);
  });

  it("lets a two-cell-tall item use the full height", () => {
    expect(itemBox({ width: 1, height: 2 }, LIMITS)).toEqual({ width: 46, height: 92, unit: 46 });
  });

  it("scales the largest case down to fit the row rather than overflowing it", () => {
    // Down is the dimension a table row has none of, so height is the one limit that still
    // bites. A 6×6 case is the worst of them and still comes out square.
    const box = itemBox({ width: 6, height: 6 }, LIMITS);
    expect(box.height).toBeLessThanOrEqual(LIMITS.maxHeight);
    expect(box.width).toBe(box.height);
  });

  it("never draws a box below the floor, whatever it is asked for", () => {
    expect(itemBox({ width: 400, height: 400 }, LIMITS).unit).toBe(10);
  });

  it("treats an item the catalogue does not have as one cell", () => {
    expect(itemBox(null, LIMITS)).toEqual(itemBox({ width: 1, height: 1 }, LIMITS));
  });

  it("rounds a nonsense footprint into something drawable", () => {
    expect(itemBox({ width: 0, height: -3 }, LIMITS)).toEqual(itemBox({ width: 1, height: 1 }, LIMITS));
  });
});
