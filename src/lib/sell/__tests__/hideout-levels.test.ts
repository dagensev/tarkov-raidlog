import { describe, expect, it } from "vitest";

import { nextHideoutLevels, recordedCount } from "../hideout-levels";

describe("nextHideoutLevels", () => {
  it("records a level", () => {
    expect(nextHideoutLevels({}, "workbench", 3)).toEqual({ workbench: 3 });
  });

  it("overwrites a level already recorded", () => {
    expect(nextHideoutLevels({ workbench: 1 }, "workbench", 3)).toEqual({ workbench: 3 });
  });

  it("removes the key when the level is cleared, rather than writing zero", () => {
    // "Not told" and "not built" want the same upgrade items, but only "not built" stops
    // crafts you cannot run from padding the keep list. They must stay distinguishable.
    expect(nextHideoutLevels({ workbench: 2 }, "workbench", null)).toEqual({});
  });

  it("keeps zero as a real answer", () => {
    expect(nextHideoutLevels({}, "workbench", 0)).toEqual({ workbench: 0 });
  });

  it("leaves other stations alone", () => {
    expect(nextHideoutLevels({ lavatory: 1 }, "workbench", 2)).toEqual({
      lavatory: 1,
      workbench: 2,
    });
  });

  it("does not mutate the record it was given", () => {
    const current = { workbench: 1 };
    nextHideoutLevels(current, "workbench", 3);
    expect(current).toEqual({ workbench: 1 });
  });

  it("never stores a negative or fractional level", () => {
    expect(nextHideoutLevels({}, "workbench", -2)).toEqual({ workbench: 0 });
    expect(nextHideoutLevels({}, "workbench", 2.7)).toEqual({ workbench: 2 });
  });

  it("ignores a level that is not a number at all", () => {
    expect(nextHideoutLevels({}, "workbench", Number.NaN)).toEqual({});
  });
});

describe("recordedCount", () => {
  it("counts stations answered for, zero included", () => {
    expect(recordedCount({ workbench: 0, lavatory: 3 })).toBe(2);
  });
});
