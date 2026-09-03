import { describe, expect, it } from "vitest";

import type { GameMap, Task } from "@/lib/tarkovdev/types";
import { mapOptions } from "../map-options";

const map = (id: string, name: string): GameMap => ({
  id,
  name,
  normalizedName: name.toLowerCase(),
  nameId: id,
  scenePath: null,
  wiki: null,
  raidDuration: null,
  players: null,
  enemies: null,
  description: null,
});

const MAPS = [map("m1", "Customs"), map("m2", "Factory"), map("m3", "Woods")];

const task = (id: string, mapId: string | null): Task => ({
  id,
  name: id,
  normalizedName: id,
  experience: 0,
  minPlayerLevel: null,
  kappaRequired: null,
  lightkeeperRequired: null,
  factionName: "Any",
  wikiLink: null,
  trader: null,
  map: mapId ? { id: mapId, name: mapId } : null,
  taskRequirements: [],
  traderRequirements: [],
  objectives: [],
  neededKeys: [],
});

const shape = (options: ReturnType<typeof mapOptions>) =>
  options.map((o) => [o.map.name, o.count]);

describe("mapOptions", () => {
  it("counts the tasks each map holds", () => {
    const tasks = [task("a", "m1"), task("b", "m1"), task("c", "m3")];
    expect(shape(mapOptions(MAPS, tasks))).toEqual([
      ["Customs", 2],
      ["Woods", 1],
    ]);
  });

  it("drops maps with nothing to show, so every option lands on a task", () => {
    expect(shape(mapOptions(MAPS, [task("a", "m2")]))).toEqual([["Factory", 1]]);
  });

  it("keeps the map you are looking at even when it holds nothing", () => {
    // The raid board picks a map for you. Dropping it from its own dropdown would blank
    // the control while the panel underneath explains that this map has nothing.
    expect(shape(mapOptions(MAPS, [task("a", "m1")], "m3"))).toEqual([
      ["Customs", 1],
      ["Woods", 0],
    ]);
  });

  it("adds nothing when no map is being kept", () => {
    for (const keep of [undefined, null, ""]) {
      expect(shape(mapOptions(MAPS, [task("a", "m1")], keep)), String(keep)).toEqual([
        ["Customs", 1],
      ]);
    }
  });

  it("returns nothing when there are no tasks to count", () => {
    expect(mapOptions(MAPS, [])).toEqual([]);
  });
});
