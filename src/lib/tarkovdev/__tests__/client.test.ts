import { describe, expect, it, vi } from "vitest";

import {
  TarkovDevError,
  denormalize,
  fetchJson,
  itemIconLink,
  itemPageLink,
  loadItemCatalogue,
  referencedItemIds,
  type CoreBundle,
  type SellItem,
} from "../client";
import { endpointPath, gameModeFromSessionMode } from "../endpoints";
import type { RawTask } from "../raw-types";

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const opts = { backoffMs: 0 };

describe("gameModeFromSessionMode", () => {
  it("maps the three Session mode values seen in real logs", () => {
    expect(gameModeFromSessionMode("PvpSeason")).toBe("pvp-season");
    expect(gameModeFromSessionMode("Regular")).toBe("regular");
    expect(gameModeFromSessionMode("Pve")).toBe("pve");
  });

  it("returns undefined for anything else, so the caller can fall back", () => {
    expect(gameModeFromSessionMode("Arena")).toBeUndefined();
    expect(gameModeFromSessionMode(undefined)).toBeUndefined();
  });
});

describe("endpointPath", () => {
  it("builds data and translation paths", () => {
    expect(endpointPath("pvp-season", "tasks")).toBe("https://json.tarkov.dev/pvp-season/tasks");
    expect(endpointPath("pve", "maps", "en")).toBe("https://json.tarkov.dev/pve/maps_en");
  });
});

describe("fetchJson", () => {
  it("returns the parsed document", async () => {
    const fetchImpl = vi.fn(async () => response(200, { data: { maps: {} } }));
    await expect(fetchJson("https://x/y", { ...opts, fetchImpl })).resolves.toEqual({
      data: { maps: {} },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a server error then succeeds", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(503, {}))
      .mockResolvedValueOnce(response(200, { data: { ok: true } }));
    await expect(fetchJson("https://x/y", { ...opts, fetchImpl })).resolves.toEqual({
      data: { ok: true },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 404", async () => {
    // A wrong path is our bug; hammering the API will not fix it.
    const fetchImpl = vi.fn(async () => response(404, {}));
    await expect(fetchJson("https://x/nope", { ...opts, fetchImpl })).rejects.toThrow(/404/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a network failure", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(response(200, { data: 1 }));
    await expect(fetchJson("https://x/y", { ...opts, fetchImpl })).resolves.toEqual({ data: 1 });
  });

  it("marks a transient failure retryable so callers can fall back to cache", async () => {
    const fetchImpl = vi.fn(async () => response(500, {}));
    let error: TarkovDevError | undefined;
    try {
      await fetchJson("https://x/y", { ...opts, fetchImpl, attempts: 1 });
    } catch (thrown) {
      error = thrown as TarkovDevError;
    }
    expect(error).toBeInstanceOf(TarkovDevError);
    expect(error?.retryable).toBe(true);
  });
});

/** A bundle shaped like the real documents, with translation keys rather than text. */
function bundle(): CoreBundle {
  const task: RawTask = {
    id: "t1",
    name: "t1 name",
    normalizedName: "first-in-line",
    wikiLink: "https://escapefromtarkov.fandom.com/wiki/First_in_Line",
    experience: 1000,
    minPlayerLevel: 5,
    kappaRequired: true,
    lightkeeperRequired: false,
    factionName: "Any",
    trader: "trader1",
    map: "map1",
    taskRequirements: [{ task: "t0", status: ["complete"] }],
    traderRequirements: [
      { id: "r1", trader: "trader1", requirementType: "level", compareMethod: ">=", value: 2 },
      // Standing is informational and must not gate availability.
      { id: "r2", trader: "trader1", requirementType: "standing", compareMethod: ">=", value: 3 },
    ],
    objectives: [
      {
        id: "o1",
        description: "o1",
        type: "findQuestItem",
        optional: false,
        maps: ["map1"],
        requiredKeys: [["key1"]],
      },
    ],
    neededKeys: [{ map: "map1", keys: ["key1"] }],
  };
  const prerequisite: RawTask = { ...task, id: "t0", name: "t0 name", taskRequirements: [] };

  return {
    mode: "pvp-season",
    tasks: { t1: task, t0: prerequisite },
    maps: {
      map1: {
        id: "map1",
        name: "map1 Name",
        normalizedName: "customs",
        nameId: "bigmap",
        scenePath: "maps/customs_preset.bundle",
        description: "map1 description",
        wiki: null,
        raidDuration: 35,
        players: "10-12",
      },
    },
    traders: {
      trader1: {
        id: "trader1",
        name: "trader1 name",
        normalizedName: "prapor",
        resetTime: null,
        levels: [],
      },
    },
    text: {
      "t1 name": "First in Line",
      "t0 name": "Debut",
      o1: "Locate the Emercom station on Ground Zero",
      "map1 Name": "Customs",
      "trader1 name": "Prapor",
      "map1 description": "An industrial area.",
    },
    fetchedAt: 0,
  };
}

describe("denormalize", () => {
  it("resolves translation keys into readable text", () => {
    // The API returns "<id> name" as the name; the text only exists in the _en document.
    const data = denormalize(bundle());
    const task = data.tasks.find((t) => t.id === "t1")!;
    expect(task.name).toBe("First in Line");
    expect(task.objectives[0].description).toBe("Locate the Emercom station on Ground Zero");
    expect(data.maps[0].name).toBe("Customs");
    expect(task.trader?.name).toBe("Prapor");
  });

  it("expands id references into nested objects", () => {
    const task = denormalize(bundle()).tasks.find((t) => t.id === "t1")!;
    expect(task.map).toEqual({ id: "map1", name: "Customs" });
    expect(task.taskRequirements[0].task).toEqual({ id: "t0", name: "Debut" });
    expect(task.objectives[0].maps).toEqual([{ id: "map1", name: "Customs" }]);
  });

  it("passes through fields that need no translation", () => {
    const task = denormalize(bundle()).tasks.find((t) => t.id === "t1")!;
    expect(task.wikiLink).toBe("https://escapefromtarkov.fandom.com/wiki/First_in_Line");
    expect(task.normalizedName).toBe("first-in-line");
    expect(task.kappaRequired).toBe(true);
    expect(task.minPlayerLevel).toBe(5);
  });

  it("keeps only loyalty-level trader requirements", () => {
    // Standing requirements would otherwise lock tasks that are actually available.
    const task = denormalize(bundle()).tasks.find((t) => t.id === "t1")!;
    expect(task.traderRequirements).toHaveLength(1);
    expect(task.traderRequirements[0]).toMatchObject({ value: 2 });
  });

  it("shows a placeholder key until the item index arrives", () => {
    const task = denormalize(bundle()).tasks.find((t) => t.id === "t1")!;
    expect(task.neededKeys[0].keys[0]).toMatchObject({ id: "key1", shortName: "key" });
  });

  it("names keys once the item index is merged in", () => {
    const items = {
      key1: {
        id: "key1",
        name: "Factory emergency exit key",
        shortName: "Fact.Emrg",
        iconLink: null,
        wikiLink: null,
      },
    };
    const task = denormalize(bundle(), items).tasks.find((t) => t.id === "t1")!;
    expect(task.neededKeys[0].keys[0].name).toBe("Factory emergency exit key");
    expect(task.neededKeys[0].keys[0].shortName).toBe("Fact.Emrg");
  });

  it("falls back to the id when a reference points at something missing", () => {
    const b = bundle();
    b.tasks.t1.trader = "ghost";
    const task = denormalize(b).tasks.find((t) => t.id === "t1")!;
    expect(task.trader).toEqual({ id: "ghost", name: "ghost" });
  });

  it("carries the map fields the raid board reads", () => {
    const map = denormalize(bundle()).maps[0];
    expect(map).toMatchObject({
      normalizedName: "customs",
      nameId: "bigmap",
      scenePath: "maps/customs_preset.bundle",
      raidDuration: 35,
      players: "10-12",
      description: "An industrial area.",
    });
  });

  it("carries objective zones and possible locations through", () => {
    const raw = bundle();
    raw.tasks.t1.objectives[0].zones = [
      {
        id: "z1",
        map: "map1",
        position: { x: 1, y: 2, z: 3 },
        outline: [
          { x: 0, y: 2, z: 0 },
          { x: 2, y: 2, z: 0 },
        ],
        top: 5,
        bottom: 1,
      },
    ];
    raw.tasks.t1.objectives[0].possibleLocations = [
      { map: "map1", positions: [{ x: 9, y: 8, z: 7 }] },
    ];

    const objective = denormalize(raw).tasks.find((t) => t.id === "t1")!.objectives[0];
    expect(objective.zones).toHaveLength(1);
    expect(objective.zones[0].position).toEqual({ x: 1, y: 2, z: 3 });
    expect(objective.zones[0].outline).toHaveLength(2);
    expect(objective.zones[0].top).toBe(5);
    expect(objective.possibleLocations[0].positions[0]).toEqual({ x: 9, y: 8, z: 7 });
  });

  it("gives an objective with no geometry empty arrays, not undefined", () => {
    // The fixture's objective has neither, which is the common case: 873 of 1398 real
    // objectives have nowhere to point.
    const objective = denormalize(bundle()).tasks.find((t) => t.id === "t1")!.objectives[0];
    expect(objective.zones).toEqual([]);
    expect(objective.possibleLocations).toEqual([]);
  });
});

describe("referencedItemIds", () => {
  it("collects key and objective item ids", () => {
    // Only these need names, which is why the 15.8 MB item catalogue is filtered down.
    expect(referencedItemIds(bundle().tasks)).toEqual(["key1"]);
  });
});

describe("loadItemCatalogue", () => {
  /** Two items: one a key a task references, one a preset, plus a normal barter item. */
  function itemsDoc() {
    return {
      data: {
        items: {
          key1: {
            id: "key1",
            name: "key1 Name",
            shortName: "key1 Short",
            normalizedName: "dorm-key",
            iconLink: "https://assets.tarkov.dev/key1-icon.webp",
            wikiLink: "https://wiki/key1",
            width: 1,
            height: 1,
            types: ["keys"],
            basePrice: 100,
            avg24hPrice: 5000,
            lastLowPrice: 4800,
            sellToTrader: [
              { trader: "peacekeeper", price: 40, priceRUB: 4400, currency: "USD" },
              { trader: "therapist", price: 4600, priceRUB: 4600, currency: "RUB" },
            ],
          },
          lamp: {
            id: "lamp",
            name: "lamp Name",
            shortName: "lamp Short",
            normalizedName: "energy-saving-lamp",
            iconLink: "https://cdn.example/custom-lamp.webp",
            width: 1,
            height: 1,
            types: ["barter"],
            avg24hPrice: 32513,
            sellToTrader: [],
          },
          m4: {
            id: "m4",
            name: "m4 Name",
            shortName: "m4 Short",
            normalizedName: "m4a1-default",
            types: ["gun", "preset"],
          },
        },
      },
    };
  }

  const text = { data: { "key1 Name": "Dorm room key", "key1 Short": "Dorm", "lamp Name": "Lamp" } };

  function fetchImpl() {
    return vi.fn<typeof fetch>(async (url) =>
      response(200, String(url).endsWith("_en") ? text : itemsDoc()),
    );
  }

  it("builds both projections from one pair of requests", async () => {
    // The catalogue is 16.7 MB. Downloading it twice for two shapes is the thing to avoid.
    const impl = fetchImpl();
    await loadItemCatalogue("regular", ["key1"], { ...opts, fetchImpl: impl });
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it("restricts the name index to the requested ids", async () => {
    const { index } = await loadItemCatalogue("regular", ["key1"], {
      ...opts,
      fetchImpl: fetchImpl(),
    });
    expect(Object.keys(index)).toEqual(["key1"]);
    expect(index.key1).toMatchObject({ name: "Dorm room key", shortName: "Dorm" });
  });

  it("keeps every non-preset item in the sell index, requested or not", async () => {
    const { sell } = await loadItemCatalogue("regular", ["key1"], {
      ...opts,
      fetchImpl: fetchImpl(),
    });
    expect(Object.keys(sell.items).sort()).toEqual(["key1", "lamp"]);
  });

  it("drops presets, which are built guns rather than stash items", async () => {
    const { sell } = await loadItemCatalogue("regular", [], { ...opts, fetchImpl: fetchImpl() });
    expect(sell.items.m4).toBeUndefined();
  });

  it("a preset is excluded from the sell index even when it is also a requested key", async () => {
    const { index, sell } = await loadItemCatalogue("regular", ["m4"], {
      ...opts,
      fetchImpl: fetchImpl(),
    });
    expect(index.m4).toBeDefined();
    expect(sell.items.m4).toBeUndefined();
  });

  it("picks the best trader on roubles, never on the quoted price", async () => {
    // Peacekeeper's 40 is dollars. Comparing quoted prices would pick the smaller offer.
    const { sell } = await loadItemCatalogue("regular", [], { ...opts, fetchImpl: fetchImpl() });
    expect(sell.items.key1.bestTrader).toEqual({ traderId: "therapist", priceRUB: 4600 });
  });

  it("reports no trader offer rather than a zero one", async () => {
    const { sell } = await loadItemCatalogue("regular", [], { ...opts, fetchImpl: fetchImpl() });
    expect(sell.items.lamp.bestTrader).toBeNull();
  });

  it("omits an icon link that follows the derivable pattern, keeps one that does not", async () => {
    const { sell } = await loadItemCatalogue("regular", [], { ...opts, fetchImpl: fetchImpl() });
    expect(sell.items.key1.iconLink).toBeUndefined();
    expect(sell.items.lamp.iconLink).toBe("https://cdn.example/custom-lamp.webp");
    expect(itemIconLink(sell.items.key1)).toBe("https://assets.tarkov.dev/key1-icon.webp");
    expect(itemIconLink(sell.items.lamp)).toBe("https://cdn.example/custom-lamp.webp");
  });

  it("derives the tarkov.dev page from the normalized name", () => {
    expect(itemPageLink({ normalizedName: "energy-saving-lamp" } as SellItem)).toBe(
      "https://tarkov.dev/item/energy-saving-lamp",
    );
  });

  it("flags an item that cannot be listed on the flea", async () => {
    const doc = itemsDoc();
    doc.data.items.lamp.types = ["barter", "noFlea"];
    const impl = vi.fn<typeof fetch>(async (url) =>
      response(200, String(url).endsWith("_en") ? text : doc),
    );
    const { sell } = await loadItemCatalogue("regular", [], { ...opts, fetchImpl: impl });
    expect(sell.items.lamp.noFlea).toBe(true);
    expect(sell.items.key1.noFlea).toBe(false);
  });
});
