import { describe, expect, it } from "vitest";

import {
  CURRENCY_ITEM_IDS,
  economyItemIds,
  loadEconomyBundle,
  type EconomyBundle,
} from "../economy";

const ROUBLES = "5449016a4bdc2d6f028b456f";

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Documents shaped like the real ones: the hideout keys its stations directly off `data`
 * with no wrapper property, and barters and crafts key off array indices.
 */
function documents() {
  return {
    hideout: {
      data: {
        workbench: {
          id: "workbench",
          name: "hideout_area_10_name",
          normalizedName: "workbench",
          areaType: 10,
          levels: [
            {
              id: "workbench-2",
              level: 2,
              itemRequirements: [
                { item: "wires", count: 4, attributes: { foundInRaid: true } },
                { item: ROUBLES, count: 250000, attributes: { foundInRaid: false } },
              ],
            },
            { id: "workbench-1", level: 1, itemRequirements: [{ item: "screws", count: 2 }] },
          ],
        },
      },
    },
    hideout_en: { data: { hideout_area_10_name: "Workbench" } },
    barters: {
      data: {
        "0": {
          id: "b1",
          trader: "mechanic",
          taskUnlock: "t9",
          minTraderLevel: 3,
          requiredItems: [{ item: "gp-coin", count: 155.1 }],
          offeredItem: { item: "gun", count: 1 },
        },
        "1": {
          id: "b2",
          trader: "therapist",
          taskUnlock: null,
          minTraderLevel: 1,
          requiredItems: [{ item: ROUBLES, count: 50000 }],
          offeredItem: { item: "meds", count: 1 },
        },
      },
    },
    crafts: {
      data: {
        "0": {
          id: "c1",
          station: "workbench",
          level: 2,
          requiredItems: [
            { item: "wrench", count: 1, attributes: { tool: true } },
            { item: "wires", count: 3 },
          ],
          productItem: { item: "ammo", count: 60 },
        },
      },
    },
  };
}

function fetchImpl(docs = documents()): typeof fetch {
  return (async (url: string) => {
    if (url.endsWith("/hideout_en")) return response(docs.hideout_en);
    if (url.endsWith("/hideout")) return response(docs.hideout);
    if (url.endsWith("/barters")) return response(docs.barters);
    if (url.endsWith("/crafts")) return response(docs.crafts);
    throw new Error(`unexpected url ${url}`);
  }) as unknown as typeof fetch;
}

const load = (docs?: ReturnType<typeof documents>): Promise<EconomyBundle> =>
  loadEconomyBundle("regular", { fetchImpl: fetchImpl(docs), backoffMs: 0 });

describe("loadEconomyBundle", () => {
  it("reads stations keyed directly off data, with no wrapper property", async () => {
    const economy = await load();
    expect(economy.stations).toHaveLength(1);
    expect(economy.stations[0].normalizedName).toBe("workbench");
  });

  it("resolves station names through the translation file", async () => {
    const economy = await load();
    // Left unresolved this reads `hideout_area_10_name`, which is what the raw doc holds.
    expect(economy.stations[0].name).toBe("Workbench");
  });

  it("orders station levels by level, whatever order the document used", async () => {
    const economy = await load();
    expect(economy.stations[0].levels.map((l) => l.level)).toEqual([1, 2]);
  });

  it("drops currency requirements from hideout levels", async () => {
    const economy = await load();
    const level2 = economy.stations[0].levels.find((l) => l.level === 2);
    expect(level2?.requirements.map((r) => r.itemId)).toEqual(["wires"]);
  });

  it("carries the found-in-raid flag, which decides whether a flea copy will do", async () => {
    const economy = await load();
    const level2 = economy.stations[0].levels.find((l) => l.level === 2);
    expect(level2?.requirements[0].foundInRaid).toBe(true);
  });

  it("ceilings fractional barter counts", async () => {
    const economy = await load();
    // Every fractional count in the live document is GP coin, at values like 155.1.
    expect(economy.barters[0].requiredItems[0].count).toBe(156);
  });

  it("drops a barter whose only input was money", async () => {
    const economy = await load();
    expect(economy.barters.map((b) => b.id)).toEqual(["b1"]);
  });

  it("keeps the task unlock and loyalty gate a barter sits behind", async () => {
    const economy = await load();
    expect(economy.barters[0]).toMatchObject({ taskUnlock: "t9", minTraderLevel: 3 });
  });

  it("marks a craft tool, which is returned rather than consumed", async () => {
    const economy = await load();
    const lines = economy.crafts[0].requiredItems;
    expect(lines.find((l) => l.itemId === "wrench")?.tool).toBe(true);
    expect(lines.find((l) => l.itemId === "wires")?.tool).toBe(false);
  });

  it("keeps the station level a craft needs before it can run", async () => {
    const economy = await load();
    expect(economy.crafts[0]).toMatchObject({ stationId: "workbench", level: 2 });
  });
});

describe("economyItemIds", () => {
  it("unions hideout, barter and craft inputs, tools included", async () => {
    const ids = economyItemIds(await load());
    expect([...ids].sort()).toEqual(["gp-coin", "screws", "wires", "wrench"]);
  });

  it("never reports a currency, which was dropped when the documents were trimmed", async () => {
    const ids = economyItemIds(await load());
    expect(ids.some((id) => CURRENCY_ITEM_IDS.has(id))).toBe(false);
  });
});
