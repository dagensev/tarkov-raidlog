import { describe, expect, it } from "vitest";

import { craftRow, type CraftRow } from "../craft-row";
import {
  DEFAULT_CRAFT_VIEW,
  filterCraftRows,
  nextCraftSort,
  sortCraftRows,
  type CraftView,
} from "../filters";
import { routeGraph } from "../routes";
import { MARKETS, craft, index, item, line, market, station } from "./fixtures";

const WORKBENCH = station("workbench", { name: "Workbench" });
const LAVATORY = station("lavatory", { name: "Lavatory" });
const GRAPH = routeGraph({ stations: [WORKBENCH, LAVATORY], barters: [], crafts: [] });

const CATALOGUE = index([
  item("sugar", { name: "Pack of sugar", avg24hPrice: 20_000 }),
  item("bolts", { name: "Bolts", avg24hPrice: 15_000 }),
  item("moonshine", { name: "Moonshine", avg24hPrice: 150_000 }),
  item("kvass", { name: "Kvass", avg24hPrice: 10_000 }),
]);

function rowFor(overrides: Parameters<typeof craft>[0] = {}): CraftRow {
  return craftRow(craft(overrides), GRAPH, CATALOGUE, {
    market: market(),
    buyFrom: MARKETS,
    sellTo: MARKETS,
    traderLevels: {},
    craftingSkill: 0,
    fuelRoublesPerHour: null,
    hideoutLevels: { workbench: 2 },
    craftUnlocks: new Map(),
    taskStates: null,
  });
}

const view = (overrides: Partial<CraftView> = {}): CraftView => ({
  ...DEFAULT_CRAFT_VIEW,
  ...overrides,
});

const ROWS: CraftRow[] = [
  rowFor({ id: "a", level: 1 }),
  rowFor({ id: "b", level: 3 }),
  rowFor({ id: "c", stationId: "lavatory", productItem: { itemId: "kvass", count: 1 } }),
  rowFor({ id: "d", requiredItems: [line("bolts", 1)], taskUnlock: "t1" }),
  rowFor({ id: "e", gameEditions: ["edge_of_darkness"] }),
];

const ids = (rows: readonly CraftRow[]) => rows.map((row) => row.craft.id);

describe("filterCraftRows", () => {
  it("narrows nothing when nothing is chosen", () => {
    expect(ids(filterCraftRows(ROWS, view()))).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("keeps only the chosen stations", () => {
    expect(ids(filterCraftRows(ROWS, view({ stations: ["lavatory"] })))).toEqual(["c"]);
  });

  it("widens across several stations rather than narrowing", () => {
    const both = filterCraftRows(ROWS, view({ stations: ["lavatory", "workbench"] }));
    expect(both).toHaveLength(5);
  });

  it("keeps only the chosen station levels", () => {
    expect(ids(filterCraftRows(ROWS, view({ levels: [3] })))).toEqual(["b"]);
  });

  it("hides what the recorded hideout cannot run", () => {
    // The workbench is recorded at 2, so the level 3 craft is the one that goes.
    expect(ids(filterCraftRows(ROWS, view({ runnableOnly: true })))).not.toContain("b");
  });

  it("hides task-gated crafts on request", () => {
    expect(ids(filterCraftRows(ROWS, view({ hideTaskLocked: true })))).not.toContain("d");
  });

  it("matches a query against the product, the station and the ingredients", () => {
    expect(ids(filterCraftRows(ROWS, view({ query: "kvass" })))).toEqual(["c"]);
    expect(ids(filterCraftRows(ROWS, view({ query: "lavatory" })))).toEqual(["c"]);
    // Only row d is built from bolts; everything else takes sugar.
    expect(ids(filterCraftRows(ROWS, view({ query: "bolts" })))).toEqual(["d"]);
  });

  it("narrows across groups and widens within one", () => {
    const narrowed = filterCraftRows(ROWS, view({ stations: ["workbench"], levels: [3] }));
    expect(ids(narrowed)).toEqual(["b"]);
  });
});

describe("sortCraftRows", () => {
  const priced = (id: string, profitPerHour: number | null): CraftRow =>
    ({ ...rowFor({ id }), profitPerHour, profit: profitPerHour }) as CraftRow;

  const scored = [priced("low", 100), priced("none", null), priced("high", 900)];

  it("puts the best rate at the top when descending", () => {
    expect(ids(sortCraftRows(scored, view()))).toEqual(["high", "low", "none"]);
  });

  it("sinks a row with no figure in both directions, rather than flipping it", () => {
    const ascending = sortCraftRows(scored, view({ descending: false }));
    expect(ids(ascending)).toEqual(["low", "high", "none"]);
  });

  it("falls through to the product name so equal rows never shuffle", () => {
    const tied = [priced("b", 100), priced("a", 100)];
    const once = ids(sortCraftRows(tied, view()));
    expect(once).toEqual(ids(sortCraftRows([...tied].reverse(), view())));
  });

  it("orders by station name, then by the level within it", () => {
    const rows = [rowFor({ id: "wb3", level: 3 }), rowFor({ id: "lav", stationId: "lavatory" })];
    expect(ids(sortCraftRows(rows, view({ sort: "station", descending: false })))).toEqual([
      "lav",
      "wb3",
    ]);
  });

  it("orders on the adjusted craft time", () => {
    const rows = [rowFor({ id: "slow", durationSeconds: 7200 }), rowFor({ id: "fast", durationSeconds: 600 })];
    expect(ids(sortCraftRows(rows, view({ sort: "time", descending: false })))).toEqual([
      "fast",
      "slow",
    ]);
  });
});

describe("nextCraftSort", () => {
  it("opens money and rates high-first", () => {
    expect(nextCraftSort(view({ sort: "craft" }), "profit")).toEqual({
      sort: "profit",
      descending: true,
    });
  });

  it("opens names and durations low-first, which is their interesting end", () => {
    expect(nextCraftSort(view(), "time")).toEqual({ sort: "time", descending: false });
    expect(nextCraftSort(view(), "craft")).toEqual({ sort: "craft", descending: false });
    expect(nextCraftSort(view(), "station")).toEqual({ sort: "station", descending: false });
  });

  it("flips the column it is already on", () => {
    const current = view({ sort: "profit", descending: true });
    expect(nextCraftSort(current, "profit")).toEqual({ sort: "profit", descending: false });
  });
});
