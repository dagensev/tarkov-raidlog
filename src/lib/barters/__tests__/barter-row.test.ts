import { describe, expect, it } from "vitest";

import {
  EVERY_ROUTE,
  FLEA_ONLY,
  MARKETS,
  barter,
  index,
  item,
  line,
  market,
  offer,
} from "@/lib/crafts/__tests__/fixtures";
import { routeGraph } from "@/lib/crafts/routes";
import type { SellIndex } from "@/lib/tarkovdev/client";
import type { Barter } from "@/lib/tarkovdev/economy";

import { barterRow, type BarterRowOptions } from "../barter-row";

const options = (overrides: Partial<BarterRowOptions> = {}): BarterRowOptions => ({
  market: market({ traderNames: new Map([["prapor", "Prapor"]]) }),
  buyFrom: MARKETS,
  sellTo: MARKETS,
  craftingSkill: 0,
  fuelRoublesPerHour: null,
  hideoutLevels: {},
  traderLevels: {},
  craftUnlocks: new Map(),
  taskStates: null,
  ...overrides,
});

function row(
  offered: Barter,
  catalogue: SellIndex,
  overrides: Partial<BarterRowOptions> = {},
  others: Barter[] = [],
) {
  const graph = routeGraph({ stations: [], crafts: [], barters: [offered, ...others] });
  return barterRow(offered, graph, catalogue, options(overrides));
}

/** Nuts cost 1,000 on the flea; sugar goes for 10,000 there and 4,000 at Prapor. */
const CATALOGUE = index([
  item("nuts", { avg24hPrice: 1_000 }),
  item("sugar", {
    avg24hPrice: 10_000,
    bestTrader: offer({ traderId: "prapor", priceRUB: 4_000 }),
  }),
]);

describe("barterRow", () => {
  it("measures the saving against what buying the thing would have cost", () => {
    const result = row(barter(), CATALOGUE);
    expect(result.cost).toBe(1_000);
    expect(result.value).toBe(10_000);
    expect(result.savings).toBe(9_000);
  });

  it("prices the product as cash rather than through the barter that is the row", () => {
    // Routed through `acquire`, the cheapest way to get sugar is this very barter, which
    // would make the value equal the cost and every saving on the tab zero.
    const result = row(barter(), CATALOGUE, { buyFrom: EVERY_ROUTE });
    expect(result.value).toBe(10_000);
    expect(result.savings).toBe(9_000);
  });

  it("never resells on the flea, since a traded item is not found in raid", () => {
    const result = row(barter(), CATALOGUE, { sellTo: EVERY_ROUTE });
    expect(result.resale?.to).toBe("trader");
    // The trader pays 4,000 against 1,000 of nuts, so the flip clears 3,000 — a long way
    // short of the 10,000 the flea would have paid, which it is not allowed to.
    expect(result.resell).toBe(3_000);
  });

  it("has no resale at all when the flea is the only sink allowed", () => {
    const result = row(barter(), CATALOGUE, { sellTo: FLEA_ONLY });
    expect(result.resale).toBeNull();
    expect(result.revenue).toBeNull();
    expect(result.resell).toBeNull();
    // The saving stands: it never depended on being able to sell the thing.
    expect(result.savings).toBe(9_000);
  });

  it("poisons every figure that depends on an input nobody sells", () => {
    const catalogue = index([item("nuts"), item("sugar", { avg24hPrice: 10_000 })]);
    const result = row(barter(), catalogue, { sellTo: EVERY_ROUTE });
    expect(result.cost).toBeNull();
    expect(result.savings).toBeNull();
    expect(result.resell).toBeNull();
    expect(result.savingsPerRestock).toBeNull();
    // The value is its own question and still has an answer.
    expect(result.value).toBe(10_000);
  });

  it("says nothing about the saving on a product the catalogue has no price for", () => {
    const catalogue = index([item("nuts", { avg24hPrice: 1_000 }), item("sugar")]);
    const result = row(barter(), catalogue);
    expect(result.cost).toBe(1_000);
    expect(result.value).toBeNull();
    expect(result.savings).toBeNull();
  });

  it("multiplies the saving by the count handed over", () => {
    const result = row(barter({ offeredItem: { itemId: "sugar", count: 3 } }), CATALOGUE);
    expect(result.value).toBe(30_000);
    expect(result.savings).toBe(29_000);
  });

  it("spreads the saving over a restock, and says nothing when there is no limit", () => {
    expect(row(barter({ buyLimit: 4 }), CATALOGUE).savingsPerRestock).toBe(36_000);
    expect(row(barter(), CATALOGUE).savingsPerRestock).toBeNull();
  });

  it("treats an unrecorded loyalty as high enough", () => {
    const high = barter({ minTraderLevel: 4 });
    expect(row(high, CATALOGUE).runnable).toBe(true);
    expect(row(high, CATALOGUE, { traderLevels: { prapor: 2 } }).runnable).toBe(false);
    expect(row(high, CATALOGUE, { traderLevels: { prapor: 4 } }).runnable).toBe(true);
  });

  it("treats a task gate with no logs behind it as passed", () => {
    const gated = barter({ taskUnlock: "t1" });
    expect(row(gated, CATALOGUE).taskDone).toBeNull();
    expect(row(gated, CATALOGUE).runnable).toBe(true);

    const started = new Map([["t1", { status: "started" as const }]]);
    expect(row(gated, CATALOGUE, { taskStates: started }).taskDone).toBe(false);
    expect(row(gated, CATALOGUE, { taskStates: started }).runnable).toBe(false);

    const finished = new Map([["t1", { status: "finished" as const }]]);
    expect(row(gated, CATALOGUE, { taskStates: finished }).taskDone).toBe(true);
    expect(row(gated, CATALOGUE, { taskStates: finished }).runnable).toBe(true);
  });

  it("names the trader from the market's own dictionary, falling back to the id", () => {
    expect(row(barter(), CATALOGUE).traderName).toBe("Prapor");
    expect(row(barter({ traderId: "gone" }), CATALOGUE).traderName).toBe("gone");
  });

  it("marks a route it knows the reader cannot take", () => {
    // Nuts are only got through a barter above the loyalty recorded for Prapor.
    const catalogue = index([item("nuts"), item("bolts", { avg24hPrice: 100 }), item("sugar", { avg24hPrice: 10_000 })]);
    const source = barter({
      id: "b2",
      minTraderLevel: 4,
      requiredItems: [line("bolts", 1)],
      offeredItem: { itemId: "nuts", count: 1 },
    });
    const result = row(barter(), catalogue, { buyFrom: EVERY_ROUTE, traderLevels: { prapor: 1 } }, [source]);
    expect(result.cost).toBe(100);
    expect(result.routeLocked).toBe(true);
  });

  it("carries the restock limit into the plan's own step", () => {
    const result = row(barter({ buyLimit: 2 }), CATALOGUE);
    const step = result.plan.steps.find((each) => each.kind === "barter");
    expect(step).toBeDefined();
    expect(step?.kind === "barter" ? step.limit : null).toBe(2);
  });
});
