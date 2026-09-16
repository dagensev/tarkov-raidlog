import { describe, expect, it } from "vitest";

import type { TaskState } from "@/lib/logs/progress";
import type { Task } from "@/lib/tarkovdev/types";
import { SORT_MODES, sharedWithSquad, sortTasks, type SortInputs } from "../sort";

const task = (id: string, over: Partial<Task> = {}): Task => ({
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
  ...over,
});

const trader = (name: string) => ({ id: name, name });

const inputs = (
  states: Record<string, TaskState["status"]> = {},
  squadHolders: Record<string, number> = {},
  mapId?: string,
): SortInputs => ({
  states: new Map(
    Object.entries(states).map(([id, status]) => [id, { status } as TaskState]),
  ),
  squadHolders: new Map(Object.entries(squadHolders)),
  mapId,
});

const map = (id: string) => ({ id, name: id });

const order = (list: readonly Task[]) => list.map((t) => t.id);

describe("SORT_MODES", () => {
  it("leads with the mode the page opens on", () => {
    expect(SORT_MODES[0].id).toBe("progress");
  });
});

describe("sortTasks", () => {
  it("does not reorder the caller's array", () => {
    const list = [task("b"), task("a")];
    expect(order(sortTasks(list, "name", inputs()))).toEqual(["a", "b"]);
    expect(order(list)).toEqual(["b", "a"]);
  });

  describe("progress", () => {
    it("puts what you are holding above everything else", () => {
      const list = [task("done"), task("cold"), task("held")];
      const sorted = sortTasks(list, "progress", inputs({ done: "finished", held: "started" }));
      expect(order(sorted)[0]).toBe("held");
    });

    it("groups the rest by trader, so a run follows who to hand in to", () => {
      const list = [
        task("z", { trader: trader("Prapor") }),
        task("a", { trader: trader("Therapist") }),
        task("m", { trader: trader("Prapor") }),
      ];
      expect(order(sortTasks(list, "progress", inputs()))).toEqual(["m", "z", "a"]);
    });
  });

  describe("squad", () => {
    it("floats tasks you and a squadmate are both holding to the top", () => {
      const list = [task("solo"), task("shared")];
      const sorted = sortTasks(
        list,
        "squad",
        inputs({ solo: "started", shared: "started" }, { shared: 1 }),
      );
      expect(order(sorted)).toEqual(["shared", "solo"]);
    });

    it("ranks by how many squadmates are on it", () => {
      const list = [task("one"), task("three"), task("two")];
      const sorted = sortTasks(
        list,
        "squad",
        inputs(
          { one: "started", two: "started", three: "started" },
          { one: 1, two: 2, three: 3 },
        ),
      );
      expect(order(sorted)).toEqual(["three", "two", "one"]);
    });

    it("does not count a task only your squadmate is holding", () => {
      // "Shared" means both of you still need it. Something they are on and you are not
      // is their business, and floating it up would bury the tasks you can actually pair on.
      const list = [task("theirs"), task("yours")];
      const sorted = sortTasks(list, "squad", inputs({ yours: "started" }, { theirs: 2 }));
      expect(order(sorted)).toEqual(["yours", "theirs"]);
    });

    it("falls back to the progress order below the shared block", () => {
      const list = [task("cold"), task("held"), task("shared")];
      const sorted = sortTasks(
        list,
        "squad",
        inputs({ held: "started", shared: "started" }, { shared: 1 }),
      );
      expect(order(sorted)).toEqual(["shared", "held", "cold"]);
    });

    it("is the plain progress order when you are alone", () => {
      const list = [task("cold"), task("held")];
      const solo = inputs({ held: "started" });
      expect(order(sortTasks(list, "squad", solo))).toEqual(
        order(sortTasks(list, "progress", solo)),
      );
    });
  });

  describe("level", () => {
    it("sorts by the level needed to pick it up", () => {
      const list = [
        task("high", { minPlayerLevel: 30 }),
        task("low", { minPlayerLevel: 5 }),
        task("mid", { minPlayerLevel: 15 }),
      ];
      expect(order(sortTasks(list, "level", inputs()))).toEqual(["low", "mid", "high"]);
    });

    it("puts tasks with no level requirement last rather than first", () => {
      // Neither a null nor a zero means "level 0" -- both mean the API states no
      // requirement, and sorting those to the top would hide the low-level tasks the
      // option exists to surface. The live API uses 0 for this on 283 of 491 tasks,
      // which `??` would have let through as a real level.
      const list = [task("null"), task("zero", { minPlayerLevel: 0 }), task("ten", { minPlayerLevel: 10 })];
      expect(order(sortTasks(list, "level", inputs()))).toEqual(["ten", "null", "zero"]);
    });
  });

  it("sorts by trader, then by name inside each trader", () => {
    const list = [
      task("b", { trader: trader("Prapor") }),
      task("a", { trader: trader("Prapor") }),
      task("c", { trader: trader("Mechanic") }),
    ];
    expect(order(sortTasks(list, "trader", inputs()))).toEqual(["c", "a", "b"]);
  });

  describe("filtered to a map", () => {
    it("leads with the tasks handed out for that map", () => {
      // The filter keeps tasks that merely have an objective or a key there, so the ones
      // actually assigned to the map have to be lifted above them.
      const list = [task("elsewhere", { map: map("woods") }), task("here", { map: map("customs") })];
      expect(order(sortTasks(list, "name", inputs({}, {}, "customs")))).toEqual(["here", "elsewhere"]);
    });

    it("outranks the mode's own ordering", () => {
      // A held task on another map is still a task for another map.
      const list = [task("held", { map: map("woods") }), task("cold", { map: map("customs") })];
      const withMap = inputs({ held: "started" }, {}, "customs");
      expect(order(sortTasks(list, "progress", withMap))).toEqual(["cold", "held"]);
      expect(order(sortTasks(list, "progress", inputs({ held: "started" })))).toEqual(["held", "cold"]);
    });

    it("orders within each block by the chosen mode", () => {
      const list = [
        task("a-here", { map: map("customs"), trader: trader("Therapist") }),
        task("b-here", { map: map("customs"), trader: trader("Prapor") }),
        task("c-away", { map: map("woods"), trader: trader("Therapist") }),
        task("d-away", { map: map("woods"), trader: trader("Prapor") }),
      ];
      expect(order(sortTasks(list, "trader", inputs({}, {}, "customs")))).toEqual([
        "b-here",
        "a-here",
        "d-away",
        "c-away",
      ]);
    });

    it("changes nothing when no map is picked", () => {
      const list = [task("b", { map: map("customs") }), task("a", { map: map("woods") })];
      expect(order(sortTasks(list, "name", inputs()))).toEqual(["a", "b"]);
    });
  });

  it("breaks every tie by name, so the list never jitters", () => {
    const list = [task("b"), task("c"), task("a")];
    for (const mode of SORT_MODES) {
      expect(order(sortTasks(list, mode.id, inputs())), mode.id).toEqual(["a", "b", "c"]);
    }
  });
});

describe("sharedWithSquad", () => {
  it("needs both of you to be holding it", () => {
    const both = inputs({ t: "started" }, { t: 1 });
    expect(sharedWithSquad("t", both)).toBe(true);
    expect(sharedWithSquad("t", inputs({ t: "started" }))).toBe(false);
    expect(sharedWithSquad("t", inputs({}, { t: 1 }))).toBe(false);
    expect(sharedWithSquad("t", inputs({ t: "finished" }, { t: 1 }))).toBe(false);
  });
});
