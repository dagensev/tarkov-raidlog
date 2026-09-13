import { describe, expect, it } from "vitest";

import type { Barter, Craft } from "@/lib/tarkovdev/economy";
import type { SellIndex } from "@/lib/tarkovdev/client";

import { craftRow, type CraftRowOptions } from "../craft-row";
import { exceedsRestock, type CraftPlan, type PlanItem, type PlanStep } from "../plan";
import { routeGraph } from "../routes";
import { EVERY_ROUTE, MARKETS, barter, craft, index, item, line, market, offer, station } from "./fixtures";

const STATIONS = [
  station("lavatory", { name: "Lavatory" }),
  station("medstation", { name: "Medstation" }),
  station("nutrition", { name: "Nutrition Unit" }),
];

const options = (overrides: Partial<CraftRowOptions> = {}): CraftRowOptions => ({
  market: market({ traderNames: new Map([["therapist", "Therapist"]]) }),
  buyFrom: EVERY_ROUTE,
  sellTo: EVERY_ROUTE,
  craftingSkill: 0,
  fuelRoublesPerHour: null,
  hideoutLevels: {},
  traderLevels: {},
  craftUnlocks: new Map(),
  taskStates: null,
  ...overrides,
});

function planFor(
  root: Craft,
  economy: { crafts?: Craft[]; barters?: Barter[] },
  catalogue: SellIndex,
  overrides: Partial<CraftRowOptions> = {},
): CraftPlan {
  const graph = routeGraph({
    stations: STATIONS,
    crafts: [root, ...(economy.crafts ?? [])],
    barters: economy.barters ?? [],
  });
  return craftRow(root, graph, catalogue, options(overrides)).plan;
}

const round = (n: number) => +n.toFixed(2);

/** A step squeezed to the words a test wants to compare. */
function said(step: PlanStep): string {
  const list = (items: readonly (PlanItem & { spare?: number })[]) =>
    items.map((each) => `${round(each.count)} ${each.itemId}${each.spare ? ` (+${round(each.spare)} spare)` : ""}`).join(", ");
  switch (step.kind) {
    case "buy":
      return `buy ${step.items
        .map((each) => `${each.count} ${each.itemId}${each.uses !== null && each.count - each.uses > 1e-6 ? ` (uses ${round(each.uses)})` : ""} @${each.trader ?? each.market}`)
        .join(", ")}${step.tools.length ? ` | tools ${list(step.tools)}` : ""}`;
    case "sell":
      return `sell ${step.items.map((each) => `${each.count} ${each.itemId} @${each.trader ?? each.market}`).join(", ")}`;
    default:
      return `${step.kind} ${step.where} x${step.runs}: ${list(step.takes)} -> ${list(step.gives)}`;
  }
}

describe("craftPlan", () => {
  // The chain a reader found hard to follow: bandages crafted on into meds, the meds traded
  // for crackers, the crackers crafted into chocolate that is finally sold.
  const catalogue = index([
    item("fleece", { avg24hPrice: 30_000 }),
    item("kit", { avg24hPrice: 50_000 }),
    item("bandage", { avg24hPrice: 1_000 }),
    item("ai2", { buyOffers: [offer({ traderId: "therapist", priceRUB: 6_650 })] }),
    item("meds", { avg24hPrice: 1_000 }),
    item("crackers", { bestTrader: offer({ traderId: "therapist", priceRUB: 1_000 }) }),
    item("alyonka", { avg24hPrice: 35_000 }),
    item("slickers", { avg24hPrice: 17_606 }),
  ]);
  const bandages = craft({
    id: "bandages",
    stationId: "lavatory",
    requiredItems: [line("fleece", 1), line("kit", 1, { tool: true })],
    productItem: { itemId: "bandage", count: 6 },
    durationSeconds: 1_200,
  });
  const chain = {
    crafts: [
      craft({
        id: "meds-craft",
        stationId: "medstation",
        level: 2,
        requiredItems: [line("bandage", 1), line("ai2", 1)],
        productItem: { itemId: "meds", count: 3 },
        durationSeconds: 1_800,
      }),
      craft({
        id: "slickers-craft",
        stationId: "nutrition",
        level: 2,
        requiredItems: [line("crackers", 1), line("alyonka", 1)],
        productItem: { itemId: "slickers", count: 5 },
        durationSeconds: 780,
      }),
    ],
    barters: [
      barter({
        id: "crackers-trade",
        traderId: "therapist",
        buyLimit: 5,
        requiredItems: [line("meds", 1)],
        offeredItem: { itemId: "crackers", count: 1 },
      }),
    ],
  };

  it("lays a chain out in the order the work happens", () => {
    const plan = planFor(bandages, chain, catalogue);
    expect(plan).toMatchObject({ batch: 1, exact: true, leftovers: [] });
    expect(plan.steps.map(said)).toEqual([
      "buy 1 fleece @flea, 6 ai2 @Therapist, 18 alyonka @flea | tools 1 kit",
      "craft Lavatory x1: 1 fleece -> 6 bandage",
      "craft Medstation x6: 6 bandage, 6 ai2 -> 18 meds",
      "barter Therapist x18: 18 meds -> 18 crackers",
      "craft Nutrition Unit x18: 18 crackers, 18 alyonka -> 90 slickers",
      "sell 90 slickers @flea",
    ]);
  });

  it("flags a barter one run of the row needs more trades of than a restock allows", () => {
    const plan = planFor(bandages, chain, catalogue);
    expect(plan.steps.filter((step) => exceedsRestock(step, plan.batch)).map((step) => (step as { id: string }).id)).toEqual([
      "crackers-trade",
    ]);
  });

  it("does not flag a barter within its limit", () => {
    const roomy = { ...chain, barters: chain.barters.map((each) => ({ ...each, buyLimit: 20 })) };
    const plan = planFor(bandages, roomy, catalogue);
    expect(plan.steps.some((step) => exceedsRestock(step, plan.batch))).toBe(false);
  });

  it("is buy, craft, sell when nothing is traded on", () => {
    expect(planFor(bandages, chain, catalogue, { buyFrom: MARKETS, sellTo: MARKETS }).steps.map(said)).toEqual([
      "buy 1 fleece @flea | tools 1 kit",
      "craft Lavatory x1: 1 fleece -> 6 bandage",
      "sell 6 bandage @flea",
    ]);
  });

  it("plans the fewest runs of the row that come out even, rather than a fraction of a run", () => {
    // One run needs one vest, bartered for one chocolate bar, which comes five to a craft.
    const shop = index([
      item("vest", { avg24hPrice: 20_000 }),
      item("slickers", { avg24hPrice: 17_606 }),
      item("alyonka", { avg24hPrice: 35_000 }),
      item("ripstop", { avg24hPrice: 100_000 }),
    ]);
    const ripstop = craft({
      id: "ripstop",
      stationId: "lavatory",
      requiredItems: [line("vest", 1)],
      productItem: { itemId: "ripstop", count: 2 },
    });
    const plan = planFor(
      ripstop,
      {
        crafts: [
          craft({
            id: "slickers-craft",
            stationId: "nutrition",
            requiredItems: [line("alyonka", 1)],
            productItem: { itemId: "slickers", count: 5 },
            durationSeconds: 60,
          }),
        ],
        barters: [barter({ id: "vest-trade", requiredItems: [line("slickers", 1)], offeredItem: { itemId: "vest", count: 1 } })],
      },
      shop,
    );
    expect(plan).toMatchObject({ batch: 5, exact: true, leftovers: [] });
    expect(plan.steps.map(said)).toEqual([
      "buy 1 alyonka @flea",
      "craft Nutrition Unit x1: 1 alyonka -> 5 slickers",
      "barter prapor x5: 5 slickers -> 5 vest",
      "craft Lavatory x5: 5 vest -> 10 ripstop",
      "sell 10 ripstop @flea",
    ]);
  });

  it("waits for enough of the product to make a whole trade", () => {
    const shop = index([
      item("scrap", { avg24hPrice: 1_000 }),
      item("cog", { avg24hPrice: 1_000 }),
      item("gear", { bestTrader: offer({ priceRUB: 500_000 }) }),
    ]);
    const cogs = craft({
      id: "cogs",
      stationId: "lavatory",
      requiredItems: [line("scrap", 1)],
      productItem: { itemId: "cog", count: 2 },
    });
    const plan = planFor(
      cogs,
      { barters: [barter({ id: "gear-trade", requiredItems: [line("cog", 5)], offeredItem: { itemId: "gear", count: 1 } })] },
      shop,
    );
    expect(plan).toMatchObject({ batch: 5, exact: true });
    expect(plan.steps.map(said)).toEqual([
      "buy 5 scrap @flea",
      "craft Lavatory x5: 5 scrap -> 10 cog",
      "barter prapor x2: 10 cog -> 2 gear",
      "sell 2 gear @prapor",
    ]);
  });

  it("rounds up to whole runs and lists the spares when no batch up to ten comes out even", () => {
    const shop = index([
      item("scrap", { avg24hPrice: 1_000 }),
      item("part", { avg24hPrice: 50_000 }),
      item("gizmo", { avg24hPrice: 100_000 }),
    ]);
    const gizmo = craft({
      id: "gizmo",
      stationId: "lavatory",
      requiredItems: [line("part", 1)],
      productItem: { itemId: "gizmo", count: 1 },
    });
    const plan = planFor(
      gizmo,
      {
        crafts: [
          craft({
            id: "parts",
            stationId: "nutrition",
            requiredItems: [line("scrap", 1)],
            productItem: { itemId: "part", count: 11 },
            durationSeconds: 60,
          }),
        ],
      },
      shop,
    );
    expect(plan).toMatchObject({ batch: 1, exact: false });
    expect(plan.leftovers.map((each) => `${each.count} ${each.itemId}`)).toEqual(["10 part"]);
    expect(plan.steps.map(said)).toEqual([
      "buy 1 scrap @flea",
      "craft Nutrition Unit x1: 1 scrap -> 11 part (+10 spare)",
      "craft Lavatory x1: 1 part -> 1 gizmo",
      "sell 1 gizmo @flea",
    ]);
  });

  it("buys a whole item for a craft that uses part of one", () => {
    // Purified water's 0.66 of a water filter only comes out even at fifty runs.
    const shop = index([item("filter", { avg24hPrice: 10_000 }), item("water", { avg24hPrice: 50_000 })]);
    const water = craft({
      id: "water",
      stationId: "lavatory",
      requiredItems: [line("filter", 0.66)],
      productItem: { itemId: "water", count: 1 },
    });
    const plan = planFor(water, {}, shop);
    expect(plan).toMatchObject({ batch: 1, exact: false, leftovers: [] });
    expect(plan.steps.map(said)).toEqual([
      "buy 1 filter (uses 0.66) @flea",
      "craft Lavatory x1: 0.66 filter -> 1 water",
      "sell 1 water @flea",
    ]);
  });
});
