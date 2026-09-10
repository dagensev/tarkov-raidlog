import { describe, expect, it } from "vitest";

import type { TaskState, TaskStatus } from "@/lib/logs/progress";
import type { Barter, Craft, EconomyBundle, HideoutStation } from "@/lib/tarkovdev/economy";
import type { Task, TaskObjective } from "@/lib/tarkovdev/types";

import {
  barterReasons,
  buildKeepList,
  craftReasons,
  hideoutReasons,
  taskReasons,
} from "../keep-list";

const ROUBLES = "5449016a4bdc2d6f028b456f";

function objective(partial: Partial<TaskObjective> = {}): TaskObjective {
  return {
    id: "o1",
    description: "",
    type: "giveItem",
    optional: false,
    maps: [],
    __typename: "giveItem",
    zones: [],
    possibleLocations: [],
    items: [],
    containsAll: [],
    ...partial,
  };
}

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
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
    map: null,
    taskRequirements: [],
    traderRequirements: [],
    objectives: [],
    neededKeys: [],
    ...overrides,
  };
}

function states(entries: Record<string, TaskStatus>): Map<string, TaskState> {
  return new Map(
    Object.entries(entries).map(([taskId, status]) => [
      taskId,
      { taskId, status, at: 0, origin: "log" as const },
    ]),
  );
}

function station(id: string, levels: HideoutStation["levels"]): HideoutStation {
  return { id, name: id, normalizedName: id, levels };
}

const line = (itemId: string, count = 1, extra: Partial<{ foundInRaid: boolean; tool: boolean }> = {}) => ({
  itemId,
  count,
  foundInRaid: extra.foundInRaid ?? false,
  tool: extra.tool ?? false,
});

const ids = (map: Map<string, unknown>) => [...map.keys()].sort();

describe("taskReasons", () => {
  const wires = task("t1", {
    objectives: [objective({ items: ["wires"], count: 2, foundInRaid: true })],
  });

  it("wants items from a task you are holding", () => {
    expect(ids(taskReasons([wires], states({ t1: "started" })))).toEqual(["wires"]);
  });

  it("wants items from a task you have not started, which is the point of the page", () => {
    // Narrowing to held tasks is exactly how people sell a thing they need next week.
    expect(ids(taskReasons([wires], states({})))).toEqual(["wires"]);
  });

  it("stops wanting items once the task is finished", () => {
    expect(taskReasons([wires], states({ t1: "finished" })).size).toBe(0);
  });

  it("stops wanting items from a failed task that cannot be picked up again", () => {
    expect(taskReasons([wires], states({ t1: "failed" })).size).toBe(0);
  });

  it("keeps wanting items from a failed task that is restartable", () => {
    const restartable = task("t1", { restartable: true, objectives: wires.objectives });
    expect(ids(taskReasons([restartable], states({ t1: "failed" })))).toEqual(["wires"]);
  });

  it("carries the task's wiki page, so a reason can be read up on", () => {
    const linked = task("t1", {
      wikiLink: "https://escapefromtarkov.fandom.com/wiki/First_in_Line",
      objectives: wires.objectives,
    });
    expect(taskReasons([linked], states({})).get("wires")![0].link).toBe(
      "https://escapefromtarkov.fandom.com/wiki/First_in_Line",
    );
  });

  it("omits the link rather than carrying an empty one", () => {
    // Every live task has a wiki page, but the field is nullable and a bare href would
    // render as a link that goes nowhere.
    expect(taskReasons([wires], states({})).get("wires")![0].link).toBeUndefined();
  });

  it("carries the count and the found-in-raid flag through", () => {
    const [reason] = taskReasons([wires], states({})).get("wires")!;
    expect(reason).toMatchObject({ count: 2, foundInRaid: true, alternatives: 1, tier: "hard" });
  });

  it("treats a single-item objective as a hard reason", () => {
    const [reason] = taskReasons([wires], states({})).get("wires")!;
    expect(reason.tier).toBe("hard");
  });

  it("softens an objective with many alternatives, and records how many", () => {
    // "Hand over any medical item" accepts 110 of them. Holding one particular one is a
    // far weaker obligation than a named hand-in, and the number is what says so.
    const any = task("t2", {
      objectives: [objective({ items: ["a", "b", "c", "d", "e", "f", "g", "h"] })],
    });
    const [reason] = taskReasons([any], states({})).get("c")!;
    expect(reason).toMatchObject({ tier: "soft", alternatives: 8 });
  });

  it("keeps a small alternative set hard, so the figurine hand-ins survive", () => {
    const figurines = task("t3", { objectives: [objective({ items: ["x", "y", "z"] })] });
    expect(taskReasons([figurines], states({})).get("y")![0].tier).toBe("hard");
  });

  it("softens an optional objective however few alternatives it has", () => {
    const bonus = task("t4", { objectives: [objective({ items: ["w"], optional: true })] });
    expect(taskReasons([bonus], states({})).get("w")![0]).toMatchObject({
      tier: "soft",
      // Recorded as well as applied: "A Bitter Victory" wants moonshine twice, once
      // required and once as a bonus, and without this the two rows look identical.
      optional: true,
    });
  });

  it("produces nothing for a sellItem objective", () => {
    // Asserted by type name rather than by list size: the five real ones list 105 to 3535
    // alternatives, and it is the meaning that matters, not the count. They say sell
    // these to a trader, which is the opposite of a reason to keep one.
    const sellAnything = task("t5", {
      objectives: [objective({ type: "sellItem", items: ["wires", "lamp"] })],
    });
    expect(taskReasons([sellAnything], states({})).size).toBe(0);
  });

  it("produces nothing for a quest-item objective, which cannot be sold anyway", () => {
    const fetchQuest = task("t6", {
      objectives: [objective({ type: "findQuestItem", items: ["letter"] })],
    });
    expect(taskReasons([fetchQuest], states({})).size).toBe(0);
  });

  it("wants the gun and every named mod of a weapon build", () => {
    const gunsmith = task("t7", {
      objectives: [
        objective({
          type: "buildWeapon",
          item: { id: "m4", name: "M4A1" },
          containsAll: ["handguard", "muzzle"],
        }),
      ],
    });
    expect(ids(taskReasons([gunsmith], states({})))).toEqual(["handguard", "m4", "muzzle"]);
  });

  it("treats weapon-build parts as required together, not as alternatives", () => {
    const gunsmith = task("t8", {
      objectives: [objective({ type: "buildWeapon", containsAll: ["a", "b", "c", "d", "e"] })],
    });
    expect(taskReasons([gunsmith], states({})).get("a")![0]).toMatchObject({
      tier: "hard",
      alternatives: 1,
    });
  });

  it("never reports a currency", () => {
    const money = task("t9", { objectives: [objective({ items: [ROUBLES, "wires"] })] });
    expect(ids(taskReasons([money], states({})))).toEqual(["wires"]);
  });
});

describe("hideoutReasons", () => {
  const workbench = station("workbench", [
    { level: 1, requirements: [line("screws", 2)] },
    { level: 2, requirements: [line("wires", 4, { foundInRaid: true })] },
    { level: 3, requirements: [line("tools", 1)] },
  ]);

  it("wants only the levels above the one you recorded", () => {
    expect(ids(hideoutReasons([workbench], { workbench: 2 }))).toEqual(["tools"]);
  });

  it("wants every level when the station is not in the record", () => {
    // Nothing recorded means we are guessing, and the safe guess for a keep is "not built".
    expect(ids(hideoutReasons([workbench], {}))).toEqual(["screws", "tools", "wires"]);
  });

  it("wants the same for an explicit zero, which is the answer it was guessing", () => {
    expect(ids(hideoutReasons([workbench], { workbench: 0 }))).toEqual([
      "screws",
      "tools",
      "wires",
    ]);
  });

  it("labels a reason with the station and the level that wants it", () => {
    expect(hideoutReasons([workbench], { workbench: 2 }).get("tools")![0]).toMatchObject({
      label: "workbench 3",
      sourceId: "workbench:3",
      tier: "hard",
    });
  });

  it("carries found-in-raid, which is what rules out a flea copy", () => {
    expect(hideoutReasons([workbench], { workbench: 1 }).get("wires")![0].foundInRaid).toBe(true);
  });
});

describe("barterReasons", () => {
  const barter = (overrides: Partial<Barter> = {}): Barter => ({
    id: "b1",
    traderId: "mechanic",
    taskUnlock: null,
    minTraderLevel: 1,
    requiredItems: [line("wires", 3)],
    offeredItem: { itemId: "gun", count: 1 },
    ...overrides,
  });

  const names = new Map([["mechanic", "Mechanic"]]);

  it("is always soft, because a barter never finishes", () => {
    const reasons = barterReasons([barter()], states({}), {}, names);
    expect(reasons.get("wires")![0]).toMatchObject({ tier: "soft", count: 3, label: "Mechanic barter" });
  });

  it("marks a barter behind an unfinished task as locked, without dropping it", () => {
    const gated = barter({ taskUnlock: "t9" });
    expect(barterReasons([gated], states({}), {}, names).get("wires")![0].locked).toBe(true);
  });

  it("unlocks the barter once that task is finished", () => {
    const gated = barter({ taskUnlock: "t9" });
    const reasons = barterReasons([gated], states({ t9: "finished" }), {}, names);
    expect(reasons.get("wires")![0].locked).toBeUndefined();
  });

  it("locks a barter above your recorded loyalty level", () => {
    const gated = barter({ minTraderLevel: 3 });
    const reasons = barterReasons([gated], states({}), { mechanic: 2 }, names);
    expect(reasons.get("wires")![0].locked).toBe(true);
  });

  it("leaves it unlocked when the trader level was never recorded", () => {
    // Nothing in the app writes trader levels yet, so this is the common case, and hiding
    // a barter nobody has told us about would quietly make its inputs look sellable.
    const gated = barter({ minTraderLevel: 3 });
    const reason = barterReasons([gated], states({}), {}, names).get("wires")![0];
    expect(reason.locked).toBeUndefined();
  });

});

describe("craftReasons", () => {
  const workbench = station("workbench", [{ level: 1, requirements: [] }]);
  const craft = (overrides: Partial<Craft> = {}): Craft => ({
    id: "c1",
    stationId: "workbench",
    level: 2,
    requiredItems: [line("wires", 3), line("wrench", 1, { tool: true })],
    productItem: { itemId: "ammo", count: 60 },
    ...overrides,
  });

  it("wants nothing for a craft your station is too low to run", () => {
    expect(craftReasons([craft()], [workbench], { workbench: 1 }).size).toBe(0);
  });

  it("wants the inputs once the station is high enough", () => {
    expect(ids(craftReasons([craft()], [workbench], { workbench: 2 }))).toEqual(["wires", "wrench"]);
  });

  it("still wants them when the station level is unknown", () => {
    // An empty checklist must not quietly make every craft input look sellable.
    expect(ids(craftReasons([craft()], [workbench], {}))).toEqual(["wires", "wrench"]);
  });

  it("marks a tool as returned and gives it a count of one", () => {
    const reason = craftReasons([craft()], [workbench], { workbench: 2 }).get("wrench")![0];
    expect(reason).toMatchObject({ returned: true, count: 1 });
  });
});

describe("buildKeepList", () => {
  const economy = (overrides: Partial<EconomyBundle> = {}): EconomyBundle => ({
    mode: "regular",
    // Recorded at level 1 below, so level 2 is the one still wanting items and the
    // level-1 crafts are ones you can actually run.
    stations: [
      station("workbench", [
        { level: 1, requirements: [line("screws", 1)] },
        { level: 2, requirements: [line("wires", 4)] },
      ]),
    ],
    barters: [
      {
        id: "b1",
        traderId: "mechanic",
        taskUnlock: null,
        minTraderLevel: 1,
        requiredItems: [line("wires", 3)],
        offeredItem: { itemId: "gun", count: 1 },
      },
    ],
    crafts: [
      {
        id: "c1",
        stationId: "workbench",
        level: 1,
        requiredItems: [line("wrench", 1, { tool: true })],
        productItem: { itemId: "ammo", count: 60 },
      },
      {
        id: "c2",
        stationId: "workbench",
        level: 1,
        requiredItems: [line("wrench", 1, { tool: true })],
        productItem: { itemId: "meds", count: 1 },
      },
    ],
    fetchedAt: 0,
    ...overrides,
  });

  const inputs = (overrides: Partial<Parameters<typeof buildKeepList>[0]> = {}) => ({
    tasks: [task("t1", { objectives: [objective({ items: ["wires"], count: 2 })] })],
    taskStates: states({}),
    economy: economy(),
    hideoutLevels: { workbench: 1 },
    ...overrides,
  });

  it("merges every source into one entry per item", () => {
    const entry = buildKeepList(inputs()).get("wires")!;
    expect(entry.reasons.map((r) => r.kind).sort()).toEqual(["barter", "hideout", "task"]);
  });

  it("is hard when any one reason is hard", () => {
    expect(buildKeepList(inputs()).get("wires")!.tier).toBe("hard");
  });

  it("is soft when every reason is soft", () => {
    expect(buildKeepList(inputs()).get("wrench")!.tier).toBe("soft");
  });

  it("sums hard and soft counts apart, so a barter never inflates what you must keep", () => {
    const entry = buildKeepList(inputs()).get("wires")!;
    expect(entry.hardCount).toBe(6); // task 2 + hideout 4
    expect(entry.softCount).toBe(3); // the barter
  });

  it("counts a tool once however many crafts ask for it", () => {
    // Two crafts both want the wrench. One wrench serves both, and every later one too.
    expect(buildKeepList(inputs()).get("wrench")!.softCount).toBe(1);
  });

  it("counts how many to hold from tasks and hideout upgrades only", () => {
    // Task 2 plus hideout 4. The barter's 3 is left out, because neither a barter nor a
    // craft ever finishes: counting them gives a number you can never work down.
    expect(buildKeepList(inputs()).get("wires")!.keepCount).toBe(6);
  });

  it("leaves craft inputs out of the count", () => {
    const withCraft = economy({
      crafts: [
        {
          id: "c3",
          stationId: "workbench",
          level: 1,
          requiredItems: [line("wires", 5)],
          productItem: { itemId: "ammo", count: 60 },
        },
      ],
    });
    const entry = buildKeepList(inputs({ economy: withCraft })).get("wires")!;
    expect(entry.keepCount).toBe(6);
    expect(entry.softCount).toBe(8); // the barter's 3 and the craft's 5
  });

  it("leaves a loose task objective out of the count, however many it asks for", () => {
    // Minibus asks for ten found-in-raid items from the Tools category and twenty-one
    // items satisfy it. Counted, a wrench read "hold ten" when one of anything on the
    // list would do. It stays in the reason list, where "1 of 21 accepted" says what it is.
    const loose = task("minibus", {
      objectives: [
        objective({ items: ["wrench", "pliers", "awl", "drill", "files"], count: 10, foundInRaid: true }),
      ],
    });
    const entry = buildKeepList(inputs({ tasks: [loose], economy: economy({ stations: [], barters: [], crafts: [] }) })).get("wrench")!;
    expect(entry.reasons.map((r) => r.kind)).toEqual(["task"]);
    expect(entry.reasons[0].tier).toBe("soft");
    expect(entry.keepCount).toBe(0);
    expect(entry.tier).toBe("soft");
  });

  it("still counts a named hand-in, which is the case the number is for", () => {
    const named = task("debut", { objectives: [objective({ items: ["wrench"], count: 3 })] });
    const entry = buildKeepList(inputs({ tasks: [named], economy: economy({ stations: [], barters: [], crafts: [] }) })).get("wrench")!;
    expect(entry.keepCount).toBe(3);
    expect(entry.tier).toBe("hard");
  });

  it("counts nothing for an item only a barter or a craft wants", () => {
    const barterOnly = economy({ stations: [], crafts: [] });
    const list = buildKeepList(inputs({ tasks: [], economy: barterOnly }));
    expect(list.get("wires")).toMatchObject({ keepCount: 0, softCount: 3 });
    expect(buildKeepList(inputs()).get("wrench")!.keepCount).toBe(0);
  });

  it("adds up a task that wants the same item from two identical objectives", () => {
    // "A Bitter Victory" asks for moonshine in two objectives. Listing the task twice
    // reads as a bug, and four is the honest answer to how many you need.
    const twice = task("t2", {
      objectives: [
        objective({ id: "o1", items: ["wires"], count: 2 }),
        objective({ id: "o2", items: ["wires"], count: 2 }),
      ],
    });
    const entry = buildKeepList(inputs({ tasks: [twice] })).get("wires")!;
    const fromTask = entry.reasons.filter((r) => r.kind === "task");
    expect(fromTask).toHaveLength(1);
    expect(fromTask[0].count).toBe(4);
  });

  it("keeps two reasons apart when they differ in more than their count", () => {
    // One objective needs it found in raid and the other does not, which is a real
    // difference and the thing that decides whether a flea copy will do.
    const mixed = task("t3", {
      objectives: [
        objective({ id: "o1", items: ["wires"], count: 1, foundInRaid: true }),
        objective({ id: "o2", items: ["wires"], count: 1, foundInRaid: false }),
      ],
    });
    const entry = buildKeepList(inputs({ tasks: [mixed] })).get("wires")!;
    expect(entry.reasons.filter((r) => r.kind === "task")).toHaveLength(2);
  });

  it("orders reasons with the strongest claim first", () => {
    expect(buildKeepList(inputs()).get("wires")!.reasons[0].tier).toBe("hard");
  });

  it("drops barters and crafts when they are turned off", () => {
    const list = buildKeepList(
      inputs({ options: { includeBarters: false, includeCrafts: false } }),
    );
    expect(list.get("wires")!.softCount).toBe(0);
    expect(list.has("wrench")).toBe(false);
  });

  it("never reports a currency, whatever wanted it", () => {
    const withMoney = economy({
      stations: [station("workbench", [{ level: 2, requirements: [line(ROUBLES, 400000)] }])],
    });
    expect(buildKeepList(inputs({ economy: withMoney })).has(ROUBLES)).toBe(false);
  });
});
