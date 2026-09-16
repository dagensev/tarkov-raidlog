import { describe, expect, it } from "vitest";

import type { BarterRow } from "../barter-row";
import {
  DEFAULT_BARTER_VIEW,
  filterBarterRows,
  nextBarterSort,
  sortBarterRows,
  type BarterView,
} from "../filters";

const view = (overrides: Partial<BarterView> = {}): BarterView => ({
  ...DEFAULT_BARTER_VIEW,
  ...overrides,
});

const ids = (rows: readonly BarterRow[]) => rows.map((row) => row.barter.id);

/** Only the fields the filters and orderings read. */
function row(id: string, fields: Partial<BarterRow> = {}): BarterRow {
  return {
    barter: { id } as BarterRow["barter"],
    traderId: "prapor",
    traderName: "Prapor",
    minLevel: 1,
    recordedLevel: null,
    runnable: true,
    taskUnlock: null,
    taskLocked: false,
    taskDone: null,
    limit: null,
    lines: [],
    product: null,
    productName: id,
    productCount: 1,
    cost: 0,
    value: 0,
    valueFrom: null,
    savings: 0,
    savingsPerRestock: null,
    resale: null,
    revenue: null,
    resell: null,
    chainSeconds: 0,
    routeLocked: false,
    plan: { batch: 1, exact: true, steps: [], leftovers: [] },
    ...fields,
  } as BarterRow;
}

const ROWS: BarterRow[] = [
  row("a", { traderId: "prapor", traderName: "Prapor", minLevel: 1, savings: 500, limit: 4 }),
  row("b", { traderId: "prapor", traderName: "Prapor", minLevel: 3, savings: 900, limit: 1 }),
  row("c", { traderId: "therapist", traderName: "Therapist", minLevel: 3, savings: null }),
  row("d", { traderId: "therapist", traderName: "Therapist", minLevel: 4, savings: 100, runnable: false }),
  row("e", { traderId: "mechanic", traderName: "Mechanic", minLevel: 2, savings: 700, taskLocked: true }),
];

describe("filterBarterRows", () => {
  it("narrows nothing when nothing is chosen", () => {
    expect(ids(filterBarterRows(ROWS, view()))).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("widens across several traders rather than narrowing", () => {
    const both = filterBarterRows(ROWS, view({ traders: ["prapor", "therapist"] }));
    expect(ids(both)).toEqual(["a", "b", "c", "d"]);
  });

  it("narrows across groups and widens within one", () => {
    const narrowed = filterBarterRows(ROWS, view({ traders: ["therapist"], levels: [3] }));
    expect(ids(narrowed)).toEqual(["c"]);
  });

  it("hides what the recorded loyalty or the logs say you cannot trade yet", () => {
    expect(ids(filterBarterRows(ROWS, view({ runnableOnly: true })))).toEqual(["a", "b", "c", "e"]);
  });

  it("hides task-locked offers on their own switch", () => {
    expect(ids(filterBarterRows(ROWS, view({ hideTaskLocked: true })))).toEqual(["a", "b", "c", "d"]);
  });

  it("matches a query against the trader as well as the product", () => {
    expect(ids(filterBarterRows(ROWS, view({ query: "therap" })))).toEqual(["c", "d"]);
    // No trader's name holds a "d", so this one can only have come from the product.
    expect(ids(filterBarterRows(ROWS, view({ query: "d" })))).toEqual(["d"]);
  });
});

describe("sortBarterRows", () => {
  it("sinks a row with no figure in both directions, rather than flipping it", () => {
    const down = sortBarterRows(ROWS, view({ sort: "savings", descending: true }));
    const up = sortBarterRows(ROWS, view({ sort: "savings", descending: false }));
    expect(ids(down).at(-1)).toBe("c");
    expect(ids(up).at(-1)).toBe("c");
  });

  it("puts the largest saving first by default", () => {
    expect(ids(sortBarterRows(ROWS, view()))).toEqual(["b", "e", "a", "d", "c"]);
  });

  it("orders by trader, then by the loyalty the offer needs", () => {
    const sorted = sortBarterRows(ROWS, view({ sort: "trader", descending: false }));
    expect(ids(sorted)).toEqual(["e", "a", "b", "c", "d"]);
  });

  it("sinks an unlimited offer when the limit is the column", () => {
    expect(ids(sortBarterRows(ROWS, view({ sort: "limit", descending: true }))).slice(0, 2)).toEqual(["a", "b"]);
  });
});

describe("nextBarterSort", () => {
  it("opens the money columns high-first and the names and the cost low-first", () => {
    expect(nextBarterSort(view({ sort: "trader" }), "savings").descending).toBe(true);
    expect(nextBarterSort(view({ sort: "savings" }), "resell").descending).toBe(true);
    expect(nextBarterSort(view({ sort: "savings" }), "limit").descending).toBe(true);
    expect(nextBarterSort(view({ sort: "savings" }), "trader").descending).toBe(false);
    expect(nextBarterSort(view({ sort: "savings" }), "barter").descending).toBe(false);
    // The cheap end is the interesting end of a cost.
    expect(nextBarterSort(view({ sort: "savings" }), "cost").descending).toBe(false);
  });

  it("flips the column it is already on", () => {
    expect(nextBarterSort(view({ sort: "savings", descending: true }), "savings").descending).toBe(false);
  });
});
