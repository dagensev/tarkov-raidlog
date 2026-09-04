import { describe, expect, it } from "vitest";

import type { Task } from "@/lib/tarkovdev/types";
import { objectivePins } from "../pins";

const position = (x: number) => ({ x, y: 0, z: 0 });

function task(id: string, name: string, objectives: Task["objectives"]): Task {
  return {
    id,
    name,
    normalizedName: id,
    experience: 0,
    minPlayerLevel: null,
    kappaRequired: null,
    lightkeeperRequired: null,
    factionName: "Any",
    wikiLink: null,
    trader: null,
    map: null,
    taskRequirements: [],
    traderRequirements: [],
    objectives,
    neededKeys: [],
  } as unknown as Task;
}

function objective(
  id: string,
  description: string,
  zones: Task["objectives"][number]["zones"],
  possibleLocations: Task["objectives"][number]["possibleLocations"] = [],
): Task["objectives"][number] {
  return {
    id,
    description,
    type: "plantItem",
    optional: false,
    maps: [],
    __typename: "plantItem",
    zones,
    possibleLocations,
  } as unknown as Task["objectives"][number];
}

const zone = (map: string, x: number) => ({
  id: `z-${map}-${x}`,
  map,
  position: position(x),
  outline: null,
  top: null,
  bottom: null,
});

describe("objectivePins", () => {
  it("returns one pin per zone on the map", () => {
    const tasks = [
      task("t1", "Task One", [objective("o1", "Plant it", [zone("customs", 1), zone("customs", 2)])]),
    ];
    const pins = objectivePins(tasks, "customs", new Map());
    expect(pins).toHaveLength(2);
    expect(pins[0].taskName).toBe("Task One");
    expect(pins[0].description).toBe("Plant it");
    expect(pins[0].kind).toBe("zone");
  });

  it("ignores zones on other maps", () => {
    const tasks = [task("t1", "Task One", [objective("o1", "Plant it", [zone("woods", 1)])])];
    expect(objectivePins(tasks, "customs", new Map())).toEqual([]);
  });

  it("follows a folded map id, so Night Factory objectives land on Factory", () => {
    const tasks = [
      task("t1", "Task One", [objective("o1", "Plant it", [zone("night-factory", 1)])]),
    ];
    const folded = new Map([["night-factory", "factory"]]);
    expect(objectivePins(tasks, "factory", folded)).toHaveLength(1);
  });

  it("returns one pin per candidate location", () => {
    const tasks = [
      task("t1", "Task One", [
        objective("o1", "Find it", [], [
          { map: "customs", positions: [position(1), position(2), position(3)] },
        ]),
      ]),
    ];
    const pins = objectivePins(tasks, "customs", new Map());
    expect(pins).toHaveLength(3);
    expect(pins.every((pin) => pin.kind === "location")).toBe(true);
  });

  it("carries an outline through when the zone has one", () => {
    const outlined = {
      ...zone("customs", 1),
      outline: [position(0), position(2), position(4)],
    };
    const tasks = [task("t1", "Task One", [objective("o1", "Plant it", [outlined])])];
    expect(objectivePins(tasks, "customs", new Map())[0].outline).toHaveLength(3);
  });

  it("gives every pin a distinct key", () => {
    const tasks = [
      task("t1", "Task One", [objective("o1", "Plant it", [zone("customs", 1), zone("customs", 2)])]),
      task("t2", "Task Two", [
        objective("o2", "Find it", [], [{ map: "customs", positions: [position(1), position(2)] }]),
      ]),
    ];
    const keys = objectivePins(tasks, "customs", new Map()).map((pin) => pin.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("skips objectives with no geometry", () => {
    const tasks = [task("t1", "Task One", [objective("o1", "Hand it over", [])])];
    expect(objectivePins(tasks, "customs", new Map())).toEqual([]);
  });

  it("keeps zones distinct when tarkov.dev reuses one zone.id for several positions", () => {
    // Real data: objective 673f5065cdfe082966842575 has 19 zones all with id "Wrong_wheels",
    // each at a different position. zone.id alone can't tell them apart.
    const reused = {
      ...zone("customs", 1),
      id: "Wrong_wheels",
    };
    const alsoReused = {
      ...zone("customs", 2),
      id: "Wrong_wheels",
    };
    const tasks = [task("t1", "Task One", [objective("o1", "Plant it", [reused, alsoReused])])];
    const pins = objectivePins(tasks, "customs", new Map());
    expect(pins).toHaveLength(2);
    const keys = pins.map((pin) => pin.key);
    expect(new Set(keys).size).toBe(2);
  });

  it("keeps locations distinct across several possibleLocations entries on the same map", () => {
    // Real data: objective 6391d9ba4b15ca31f76bc325 has 3 possibleLocations entries all on
    // Woods. An index restarted per entry collides with the other entries' indices.
    const tasks = [
      task("t1", "Task One", [
        objective("o1", "Find it", [], [
          { map: "customs", positions: [position(1), position(2)] },
          { map: "customs", positions: [position(3), position(4)] },
        ]),
      ]),
    ];
    const pins = objectivePins(tasks, "customs", new Map());
    expect(pins).toHaveLength(4);
    const keys = pins.map((pin) => pin.key);
    expect(new Set(keys).size).toBe(4);
  });
});
