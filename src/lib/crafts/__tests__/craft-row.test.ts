import { describe, expect, it } from "vitest";

import { CRAFTING_TIME_PER_LEVEL, craftRow, craftRows, craftSeconds } from "../craft-row";
import type { CraftRowOptions } from "../craft-row";
import { craft, index, item, line, market, offer, station } from "./fixtures";

const WORKBENCH = station("workbench");
const STATIONS = new Map([[WORKBENCH.id, WORKBENCH]]);

const CATALOGUE = index([
  item("sugar", { avg24hPrice: 20_000 }),
  item("water", { avg24hPrice: 30_000 }),
  item("still", { avg24hPrice: 500_000 }),
  item("moonshine", { avg24hPrice: 150_000, bestTrader: offer({ priceRUB: 60_000 }) }),
  item("filter", { avg24hPrice: 90_000 }),
]);

const options = (overrides: Partial<CraftRowOptions> = {}): CraftRowOptions => ({
  market: market(),
  inputSource: "cheapest",
  outputSource: "best",
  craftingSkill: 0,
  fuelRoublesPerHour: null,
  hideoutLevels: {},
  craftUnlocks: new Map(),
  taskStates: null,
  ...overrides,
});

const row = (over: Parameters<typeof craft>[0] = {}, opts: Partial<CraftRowOptions> = {}) =>
  craftRow(craft(over), STATIONS, CATALOGUE, options(opts));

describe("craftSeconds", () => {
  it("takes 0.75% off per level of Crafting", () => {
    expect(craftSeconds(10_000, 10)).toBe(10_000 * (1 - 10 * CRAFTING_TIME_PER_LEVEL));
  });

  it("reaches 37.5% off at Elite", () => {
    expect(craftSeconds(10_000, 50)).toBe(6_250);
  });

  it("clamps rather than refusing a level outside the range", () => {
    expect(craftSeconds(10_000, 99)).toBe(craftSeconds(10_000, 50));
    expect(craftSeconds(10_000, -5)).toBe(10_000);
  });
});

describe("costing the inputs", () => {
  it("adds up every consumed line at what one costs", () => {
    const built = row({ requiredItems: [line("sugar", 2), line("water", 1)] });
    expect(built.inputCost).toBe(2 * 20_000 + 30_000);
  });

  it("charges nothing for a tool, which is handed back", () => {
    const built = row({
      requiredItems: [line("sugar", 2), line("still", 1, { tool: true })],
    });
    expect(built.inputCost).toBe(40_000);
    expect(built.lines.find((each) => each.tool)).toMatchObject({ cost: 0, unit: null });
  });

  it("keeps a fractional count unrounded", () => {
    // Purified water asks for 0.66 of a water filter. Charging a whole one overstates
    // that craft by half.
    const built = row({ requiredItems: [line("filter", 0.66)] });
    expect(built.lines[0].count).toBe(0.66);
    expect(built.inputCost).toBeCloseTo(0.66 * 90_000, 6);
  });

  it("reports no cost at all when one ingredient has no price", () => {
    const built = row({ requiredItems: [line("sugar", 2), line("unknown-item", 1)] });
    expect(built.inputCost).toBeNull();
    expect(built.profit).toBeNull();
    expect(built.profitPerHour).toBeNull();
  });
});

describe("the profit figures", () => {
  const base = { requiredItems: [line("sugar", 2)], productItem: { itemId: "moonshine", count: 1 } };

  it("is revenue less inputs less fuel", () => {
    const built = row(base, { fuelRoublesPerHour: 5_000 });
    // One hour, so the fuel line is a whole 5,000.
    expect(built.fuelCost).toBe(5_000);
    expect(built.profit).toBe(150_000 - 40_000 - 5_000);
  });

  it("charges no fuel when fuel is switched off", () => {
    expect(row(base).fuelCost).toBe(0);
  });

  it("multiplies the revenue by how many the craft yields", () => {
    const built = row({ ...base, productItem: { itemId: "moonshine", count: 3 } });
    expect(built.revenue).toBe(450_000);
  });

  it("divides profit by the adjusted hours, not the document's", () => {
    const built = row({ ...base, durationSeconds: 7_200 }, { craftingSkill: 50 });
    expect(built.seconds).toBe(4_500);
    expect(built.profitPerHour).toBeCloseTo(built.profit! / 1.25, 6);
  });

  it("reports no rate for a craft with no duration, rather than an infinite one", () => {
    const built = row({ ...base, durationSeconds: 0 });
    expect(built.profit).not.toBeNull();
    expect(built.profitPerHour).toBeNull();
  });

  it("reports nothing when the product itself cannot be sold", () => {
    const built = row({ ...base, productItem: { itemId: "quest-item", count: 1 } });
    expect(built.revenue).toBeNull();
    expect(built.profit).toBeNull();
  });
});

describe("what gates a craft", () => {
  it("counts an unrecorded station as one you can run", () => {
    // Silence about a station is not the same as being told it is not built, which is the
    // same distinction the keep list draws.
    expect(row({ level: 3 }).runnable).toBe(true);
    expect(row({ level: 3 }).recordedLevel).toBeNull();
  });

  it("counts a station recorded below the craft's level as one you cannot", () => {
    expect(row({ level: 3 }, { hideoutLevels: { workbench: 2 } }).runnable).toBe(false);
    expect(row({ level: 2 }, { hideoutLevels: { workbench: 2 } }).runnable).toBe(true);
  });

  it("flags the task and edition gates", () => {
    expect(row({ taskUnlock: "t1" }).taskLocked).toBe(true);
    expect(row({ gameEditions: ["edge_of_darkness"] }).editionLocked).toBe(true);
    expect(row().taskLocked).toBe(false);
    expect(row().editionLocked).toBe(false);
  });

  it("names the station, falling back to its id when the document has no such station", () => {
    expect(row().stationName).toBe("workbench");
    expect(row({ stationId: "gone" }).stationName).toBe("gone");
  });
});

describe("the task gate, read from the logs", () => {
  const unlocks = new Map([["workbench:moonshine", { taskId: "t9", onStart: false }]]);
  const gated = (taskStates: CraftRowOptions["taskStates"]) =>
    row({}, { craftUnlocks: unlocks, taskStates });

  it("recovers a gate the crafts document left off", () => {
    expect(gated(null)).toMatchObject({ taskLocked: true, taskUnlock: "t9" });
  });

  it("cannot run until the logs show the task finished", () => {
    const started = gated(new Map([["t9", { status: "started" as const }]]));
    expect(started.taskDone).toBe(false);
    expect(started.runnable).toBe(false);

    const finished = gated(new Map([["t9", { status: "finished" as const }]]));
    expect(finished.taskDone).toBe(true);
    expect(finished.runnable).toBe(true);
  });

  it("counts as able with no logs at all, the same stance as an unrecorded station", () => {
    expect(gated(null)).toMatchObject({ taskDone: null, runnable: true });
  });

  it("says nothing about task progress for a craft with no gate", () => {
    expect(row({}, { taskStates: new Map() }).taskDone).toBeNull();
  });
});

describe("craftRows", () => {
  it("builds one row per craft", () => {
    const rows = craftRows(
      [craft({ id: "a" }), craft({ id: "b" })],
      [WORKBENCH],
      CATALOGUE,
      options(),
    );
    expect(rows.map((each) => each.craft.id)).toEqual(["a", "b"]);
  });
});

describe("stations that run without power", () => {
  const LAVATORY = station("lavatory");
  const both = new Map([
    [WORKBENCH.id, WORKBENCH],
    [LAVATORY.id, LAVATORY],
  ]);
  const priced = (stationId: string) =>
    craftRow(
      craft({ stationId, requiredItems: [line("sugar", 2)] }),
      both,
      CATALOGUE,
      options({ fuelRoublesPerHour: 5_000 }),
    );

  it("charges no fuel to a Lavatory craft", () => {
    const built = priced("lavatory");
    expect(built.usesPower).toBe(false);
    expect(built.fuelCost).toBe(0);
    expect(built.profit).toBe(150_000 - 40_000);
  });

  it("still charges a powered station", () => {
    expect(priced("workbench").fuelCost).toBe(5_000);
  });

  it("charges a station the hideout document does not know", () => {
    expect(priced("somewhere-new").usesPower).toBe(true);
  });
});
