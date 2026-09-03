import { describe, expect, it } from "vitest";

import { objectiveAmount } from "../objectives";
import type { TaskObjective } from "../types";

/**
 * Fixtures are real objectives from `https://json.tarkov.dev/pvp-season/tasks`, with the
 * descriptions as they resolve through `tasks_en` — the point being that none of them
 * carries its own quantity except where noted.
 */
const objective = (partial: Partial<TaskObjective>): TaskObjective => ({
  id: "o",
  description: "",
  type: "shoot",
  optional: false,
  maps: [],
  __typename: "shoot",
  ...partial,
});

describe("objectiveAmount", () => {
  it("reports a count above one", () => {
    // "What's on the Flash Drive?" — the description names the item but not how many.
    expect(
      objectiveAmount(
        objective({
          type: "findItem",
          count: 2,
          description: "Find the item in raid: Secure Flash drive",
        }),
      ),
    ).toBe("×2");
  });

  it("reports kill counts", () => {
    // "Wet Job - Part 1" reads as a single kill without this.
    expect(
      objectiveAmount(
        objective({
          type: "shoot",
          count: 10,
          description: "Eliminate Scavs with an M4A1, M16, ADAR, or TX-15 on Shoreline",
        }),
      ),
    ).toBe("×10");
  });

  it("stays quiet for a count of one", () => {
    expect(objectiveAmount(objective({ type: "giveQuestItem", count: 1 }))).toBeNull();
  });

  it("stays quiet when there is no count", () => {
    expect(objectiveAmount(objective({ type: "visit" }))).toBeNull();
  });

  it("separates thousands, because money comes through as a count", () => {
    // "Loyalty Buyout" — hand over 1,000,000 RUB.
    expect(
      objectiveAmount(objective({ type: "giveItem", count: 1_000_000, description: "Hand over RUB" })),
    ).toBe("×1,000,000");
  });

  it("reports a skill level, which the description omits", () => {
    expect(
      objectiveAmount(
        objective({ type: "skill", level: 8, description: "Reach the required Attention skill level" }),
      ),
    ).toBe("Lv 8");
  });

  it("leaves trader loyalty alone, since the description already says it", () => {
    expect(
      objectiveAmount(
        objective({ type: "traderLevel", level: 4, description: "Reach Loyalty Level 4 with Ragman" }),
      ),
    ).toBeNull();
  });
});
