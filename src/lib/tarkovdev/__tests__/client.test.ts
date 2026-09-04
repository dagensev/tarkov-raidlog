import { describe, expect, it, vi } from "vitest";

import {
  TarkovDevError,
  denormalize,
  fetchJson,
  referencedItemIds,
  type CoreBundle,
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
