import { describe, expect, it } from "vitest";

import type { Barter, Craft, HideoutStation } from "@/lib/tarkovdev/economy";

import { craftRow } from "../craft-row";
import { MAX_ROUTE_DEPTH, planner, routeGraph, type RouteContext } from "../routes";
import { EVERY_ROUTE, MARKETS, barter, craft, index, item, line, market, offer, station } from "./fixtures";

const WORKBENCH = station("workbench", { name: "Workbench" });
const LAVATORY = station("lavatory", { name: "Lavatory" });

const CATALOGUE = index([
  item("nuts", { avg24hPrice: 5_000 }),
  item("bolts", { avg24hPrice: 10_000 }),
  item("sugar", { avg24hPrice: 20_000 }),
  item("moonshine", { avg24hPrice: 150_000 }),
  item("gpu", { avg24hPrice: 300_000 }),
  // Nobody sells it, so only a trade can price it.
  item("wire"),
  item("a0", { avg24hPrice: 1_000 }),
  item("a1", { avg24hPrice: 10_000 }),
  item("a2", { avg24hPrice: 10_000 }),
  item("a3", { avg24hPrice: 10_000 }),
  item("a4", { avg24hPrice: 10_000 }),
]);

function context(
  economy: { barters?: Barter[]; crafts?: Craft[]; stations?: HideoutStation[] },
  overrides: Partial<RouteContext> = {},
): RouteContext {
  return {
    index: CATALOGUE,
    graph: routeGraph({
      stations: economy.stations ?? [WORKBENCH, LAVATORY],
      barters: economy.barters ?? [],
      crafts: economy.crafts ?? [],
    }),
    market: market(),
    buyFrom: EVERY_ROUTE,
    sellTo: EVERY_ROUTE,
    craftingSkill: 0,
    fuelRoublesPerHour: null,
    hideoutLevels: {},
    traderLevels: {},
    craftUnlocks: new Map(),
    taskStates: null,
    ...overrides,
  };
}

describe("getting an ingredient through a barter", () => {
  const nutsForSugar = barter({ requiredItems: [line("nuts", 1)], offeredItem: { itemId: "sugar", count: 1 } });

  it("takes the barter when its inputs cost less than buying outright", () => {
    const got = planner(context({ barters: [nutsForSugar] }), null, 0).acquire("sugar");
    expect(got).toMatchObject({ from: "barter", priceRUB: 5_000, seconds: 0, locked: false });
    expect(got?.step?.lines[0].unit).toMatchObject({ from: "flea", priceRUB: 5_000 });
  });

  it("divides what the barter costs by how many it hands over", () => {
    const bulk = barter({ requiredItems: [line("bolts", 1)], offeredItem: { itemId: "sugar", count: 4 } });
    expect(planner(context({ barters: [bulk] }), null, 0).acquire("sugar")?.priceRUB).toBe(2_500);
  });

  it("leaves barters alone when they are not an enabled route", () => {
    const got = planner(context({ barters: [nutsForSugar] }, { buyFrom: MARKETS }), null, 0).acquire("sugar");
    expect(got).toMatchObject({ from: "flea", priceRUB: 20_000 });
  });

  it("prices an item no market sells", () => {
    const forWire = barter({ requiredItems: [line("nuts", 3)], offeredItem: { itemId: "wire", count: 1 } });
    expect(planner(context({ barters: [forWire] }), null, 0).acquire("wire")?.priceRUB).toBe(15_000);
  });

  it("falls back to the market when a barter's own input has no price", () => {
    const fromWire = barter({ requiredItems: [line("wire", 1)], offeredItem: { itemId: "sugar", count: 1 } });
    expect(planner(context({ barters: [fromWire] }), null, 0).acquire("sugar")?.from).toBe("flea");
  });
});

describe("getting an ingredient through a craft", () => {
  const sugarCraft = craft({
    id: "sugar-craft",
    requiredItems: [line("nuts", 2)],
    productItem: { itemId: "sugar", count: 2 },
    durationSeconds: 7_200,
  });

  it("carries the craft's fuel and time, per unit it yields", () => {
    const got = planner(context({ crafts: [sugarCraft] }, { fuelRoublesPerHour: 1_000 }), null, 0).acquire("sugar");
    // Two nuts and two hours of fuel, over the two it makes.
    expect(got).toMatchObject({ from: "craft", priceRUB: (10_000 + 2_000) / 2, seconds: 3_600 });
    expect(got?.step).toMatchObject({ where: "Workbench", yields: 2, fuelCost: 2_000, seconds: 7_200 });
  });

  it("burns no fuel at a station that runs without power", () => {
    const lavatory = { ...sugarCraft, stationId: "lavatory" };
    const got = planner(context({ crafts: [lavatory] }, { fuelRoublesPerHour: 1_000 }), null, 0).acquire("sugar");
    expect(got?.priceRUB).toBe(5_000);
  });

  it("shortens the time with the Crafting skill", () => {
    const got = planner(context({ crafts: [sugarCraft] }, { craftingSkill: 50 }), null, 0).acquire("sugar");
    expect(got?.seconds).toBe(3_600 * 0.625);
  });

  it("stops taking a slow route once time has a price", () => {
    const slow = { ...sugarCraft, durationSeconds: 36_000, productItem: { itemId: "sugar", count: 1 } };
    const routes = context({ crafts: [slow] });
    expect(planner(routes, null, 0).acquire("sugar")?.from).toBe("craft");
    // 10,000 of nuts plus ten hours at 2,000 an hour is more than the flea's 20,000.
    expect(planner(routes, null, 2_000).acquire("sugar")?.from).toBe("flea");
  });
});

describe("how far a route goes", () => {
  const ladder = [1, 2, 3, 4].map((step) =>
    barter({
      id: `up${step}`,
      requiredItems: [line(`a${step - 1}`, 1)],
      offeredItem: { itemId: `a${step}`, count: 1 },
    }),
  );

  it(`follows trades ${MAX_ROUTE_DEPTH} deep and no further`, () => {
    const routes = planner(context({ barters: ladder }), null, 0);
    // Three barters down from a4 is a1 at the market; a0, one further, is out of reach.
    expect(routes.acquire("a4")?.priceRUB).toBe(10_000);
    expect(routes.acquire("a4", 4)?.priceRUB).toBe(1_000);
  });

  it("never makes an item out of itself", () => {
    const doubling = barter({ requiredItems: [line("sugar", 1)], offeredItem: { itemId: "sugar", count: 2 } });
    expect(planner(context({ barters: [doubling] }), null, 0).acquire("sugar")?.from).toBe("flea");
  });

  it("never routes an ingredient through the row's own product", () => {
    const fromNuts = barter({ requiredItems: [line("nuts", 1)], offeredItem: { itemId: "sugar", count: 1 } });
    expect(planner(context({ barters: [fromNuts] }), "nuts", 0).acquire("sugar")?.from).toBe("flea");
    expect(planner(context({ barters: [fromNuts] }), null, 0).acquire("sugar")?.from).toBe("barter");
  });
});

describe("getting rid of the product", () => {
  it("trades it on when what comes back is worth more, less what else the trade wants", () => {
    const upgrade = barter({
      requiredItems: [line("moonshine", 1), line("nuts", 1)],
      offeredItem: { itemId: "gpu", count: 1 },
    });
    const vendorable = index([
      ...Object.values(CATALOGUE.items),
      item("gpu", { avg24hPrice: 400_000, bestTrader: offer({ priceRUB: 300_000 }) }),
    ]);
    const gone = planner(context({ barters: [upgrade] }, { index: vendorable }), "moonshine", 0).dispose("moonshine");
    expect(gone).toMatchObject({ to: "barter", net: 295_000, fee: 0 });
    expect(gone?.step).toMatchObject({ takes: 1, product: { itemId: "gpu", count: 1 } });
    expect(gone?.step?.lines.map((each) => each.itemId)).toEqual(["nuts"]);
    // Not the flea's 400,000: a traded item is not found in raid, so the flea will not list it.
    expect(gone?.step?.product).toMatchObject({ foundInRaid: false, disposal: { to: "trader", net: 300_000 } });
  });

  it("drops a barter whose prize nothing but the flea would buy", () => {
    const upgrade = barter({ requiredItems: [line("moonshine", 1)], offeredItem: { itemId: "gpu", count: 1 } });
    expect(planner(context({ barters: [upgrade] }), "moonshine", 0).dispose("moonshine")?.to).toBe("flea");
  });

  it("crafts it on, carrying that craft's time per unit taken", () => {
    const upgrade = craft({
      id: "gpu-craft",
      requiredItems: [line("moonshine", 2)],
      productItem: { itemId: "gpu", count: 1 },
      durationSeconds: 18_000,
    });
    const richer = index([...Object.values(CATALOGUE.items), item("gpu", { avg24hPrice: 400_000 })]);
    const gone = planner(context({ crafts: [upgrade] }, { index: richer }), "moonshine", 0).dispose("moonshine");
    // A crafted item is found in raid, so this one does reach the flea.
    expect(gone).toMatchObject({ to: "craft", net: 200_000, seconds: 9_000 });
    expect(gone?.step?.product).toMatchObject({ foundInRaid: true, disposal: { to: "flea" } });
  });

  it("does not count a craft that only borrows the item as somewhere to get rid of it", () => {
    const borrows = craft({
      requiredItems: [line("moonshine", 1, { tool: true }), line("nuts", 1)],
      productItem: { itemId: "gpu", count: 1 },
    });
    expect(planner(context({ crafts: [borrows] }), null, 0).dispose("moonshine")?.to).toBe("flea");
  });

  it("never trades an item into itself", () => {
    const back = barter({ requiredItems: [line("gpu", 1)], offeredItem: { itemId: "gpu", count: 2 } });
    expect(planner(context({ barters: [back] }), null, 0).dispose("gpu")?.to).toBe("flea");
  });
});

describe("locked routes", () => {
  const gated = (overrides: Partial<Barter>) =>
    barter({ requiredItems: [line("nuts", 1)], offeredItem: { itemId: "sugar", count: 1 }, ...overrides });

  it("still uses a barter above your recorded loyalty, and marks it", () => {
    const got = planner(context({ barters: [gated({ minTraderLevel: 3 })] }, { traderLevels: { prapor: 1 } }), null, 0).acquire("sugar");
    expect(got).toMatchObject({ from: "barter", locked: true });
    expect(got?.step?.gates).toEqual([{ kind: "loyalty", traderId: "prapor", level: 3, recorded: 1, met: false }]);
  });

  it("says nothing about loyalty nobody recorded", () => {
    const got = planner(context({ barters: [gated({ minTraderLevel: 3 })] }), null, 0).acquire("sugar");
    expect(got).toMatchObject({ locked: false });
    expect(got?.step?.gates).toEqual([]);
  });

  it("reads a barter's task gate from the logs, and cannot tell without them", () => {
    const task = gated({ taskUnlock: "t1" });
    const unknown = planner(context({ barters: [task] }), null, 0).acquire("sugar");
    expect(unknown?.step?.gates).toEqual([{ kind: "task", taskId: "t1", met: null }]);
    expect(unknown?.locked).toBe(false);

    const unfinished = planner(context({ barters: [task] }, { taskStates: new Map() }), null, 0).acquire("sugar");
    expect(unfinished?.locked).toBe(true);

    const done = new Map([["t1", { status: "finished" as const }]]);
    expect(planner(context({ barters: [task] }, { taskStates: done }), null, 0).acquire("sugar")?.locked).toBe(false);
  });

  it("marks a craft above the recorded station level", () => {
    const high = craft({ level: 3, requiredItems: [line("nuts", 1)], productItem: { itemId: "sugar", count: 1 } });
    const got = planner(context({ crafts: [high] }, { hideoutLevels: { workbench: 2 } }), null, 0).acquire("sugar");
    expect(got?.locked).toBe(true);
  });

  it("carries a lock up from a route further down", () => {
    const lockedBolts = barter({ id: "bolts", minTraderLevel: 4, requiredItems: [line("nuts", 1)], offeredItem: { itemId: "bolts", count: 1 } });
    const sugarFromBolts = barter({ id: "sugar", requiredItems: [line("bolts", 1)], offeredItem: { itemId: "sugar", count: 1 } });
    const got = planner(context({ barters: [lockedBolts, sugarFromBolts] }, { traderLevels: { prapor: 1 } }), null, 0).acquire("sugar");
    expect(got?.step?.id).toBe("sugar");
    expect(got?.step?.gates).toEqual([]);
    expect(got?.locked).toBe(true);
  });
});

describe("the row's plan", () => {
  // One sugar makes a moonshine in an hour. Sugar is 50,000 on the flea, or nuts crafted
  // into sugar at a station for 5,000 and however long that takes.
  const catalogue = index([
    item("nuts", { avg24hPrice: 5_000 }),
    item("sugar", { avg24hPrice: 50_000 }),
    item("moonshine", { avg24hPrice: 100_000 }),
  ]);
  const moonshine = craft({ requiredItems: [line("sugar", 1)], durationSeconds: 3_600 });
  const sugarIn = (seconds: number) =>
    craft({
      id: "sugar-craft",
      requiredItems: [line("nuts", 1)],
      productItem: { itemId: "sugar", count: 1 },
      durationSeconds: seconds,
    });
  const rowWith = (sugarSeconds: number) => {
    // The row sets its own index and graph, so the context's copies can ride along.
    const { graph, ...options } = context({ crafts: [moonshine, sugarIn(sugarSeconds)] }, { index: catalogue });
    return craftRow(moonshine, graph, catalogue, options);
  };

  it("buys outright when crafting the ingredient would earn less per hour", () => {
    // Crafting: 95,000 over eleven hours. Buying: 50,000 over one. The cheaper plan loses.
    const row = rowWith(36_000);
    expect(row.lines[0].unit?.from).toBe("flea");
    expect(row).toMatchObject({ profit: 50_000, chainSeconds: 0, totalSeconds: 3_600 });
    expect(row.profitPerHour).toBe(50_000);
  });

  it("crafts the ingredient when that earns more per hour, and counts its time", () => {
    // Crafting: 95,000 over an hour and a half beats 50,000 over one.
    const row = rowWith(1_800);
    expect(row.lines[0].unit?.from).toBe("craft");
    expect(row).toMatchObject({ profit: 95_000, chainSeconds: 1_800, totalSeconds: 5_400 });
    expect(row.profitPerHour).toBeCloseTo(95_000 / 1.5, 6);
  });

  it("flags the row when its plan leans on a route it cannot take", () => {
    const high = { ...sugarIn(1_800), level: 3 };
    const { graph, ...options } = context({ crafts: [moonshine, high] }, { index: catalogue, hideoutLevels: { workbench: 1 } });
    const row = craftRow(moonshine, graph, catalogue, options);
    // The row's own craft needs level 1 and is runnable; the sugar craft is not.
    expect(row.runnable).toBe(true);
    expect(row.routeLocked).toBe(true);
  });
});
