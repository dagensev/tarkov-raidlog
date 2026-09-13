import { describe, expect, it } from "vitest";

import { intelligenceCenterLevel, nextLevels, recordedCount } from "../hideout-levels";

describe("nextLevels", () => {
  it("records a level", () => {
    expect(nextLevels({}, "workbench", 3)).toEqual({ workbench: 3 });
  });

  it("overwrites a level already recorded", () => {
    expect(nextLevels({ workbench: 1 }, "workbench", 3)).toEqual({ workbench: 3 });
  });

  it("removes the key when the level is cleared, rather than writing zero", () => {
    // "Not told" and "not built" want the same upgrade items, but only "not built" stops
    // crafts you cannot run from padding the keep list. They must stay distinguishable.
    expect(nextLevels({ workbench: 2 }, "workbench", null)).toEqual({});
  });

  it("keeps zero as a real answer", () => {
    expect(nextLevels({}, "workbench", 0)).toEqual({ workbench: 0 });
  });

  it("leaves other stations alone", () => {
    expect(nextLevels({ lavatory: 1 }, "workbench", 2)).toEqual({
      lavatory: 1,
      workbench: 2,
    });
  });

  it("does not mutate the record it was given", () => {
    const current = { workbench: 1 };
    nextLevels(current, "workbench", 3);
    expect(current).toEqual({ workbench: 1 });
  });

  it("never stores a negative or fractional level", () => {
    expect(nextLevels({}, "workbench", -2)).toEqual({ workbench: 0 });
    expect(nextLevels({}, "workbench", 2.7)).toEqual({ workbench: 2 });
  });

  it("ignores a level that is not a number at all", () => {
    expect(nextLevels({}, "workbench", Number.NaN)).toEqual({});
  });

  it("serves trader loyalty by the same rule, where zero is Fence's lowest standing", () => {
    // Fence is the one trader whose ladder starts at 0, so zero has to survive as an
    // answer here too rather than being mistaken for "not told".
    expect(nextLevels({ prapor: 2 }, "fence", 0)).toEqual({ prapor: 2, fence: 0 });
    expect(nextLevels({ prapor: 2, fence: 0 }, "prapor", null)).toEqual({ fence: 0 });
  });
});

describe("recordedCount", () => {
  it("counts stations answered for, zero included", () => {
    expect(recordedCount({ workbench: 0, lavatory: 3 })).toBe(2);
  });
});

describe("intelligenceCenterLevel", () => {
  const stations = [
    { id: "s1", normalizedName: "stash" },
    { id: "s2", normalizedName: "intelligence-center" },
  ];

  it("reads the recorded level for the station that discounts the flea fee", () => {
    expect(intelligenceCenterLevel({ s2: 3 }, stations)).toBe(3);
  });

  it("reads zero for a station nobody has answered for", () => {
    // Which reads the fee as undiscounted. Overstating the fee understates a flip's
    // profit, and a row that promises money it does not pay out is the expensive mistake.
    expect(intelligenceCenterLevel({ s1: 4 }, stations)).toBe(0);
  });

  it("reads zero when the station is not in the loaded data at all", () => {
    expect(intelligenceCenterLevel({ s2: 3 }, [{ id: "s1", normalizedName: "stash" }])).toBe(0);
  });
});
