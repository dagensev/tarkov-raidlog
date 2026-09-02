import { describe, expect, it } from "vitest";

import type { Task, TaskRequirement } from "@/lib/tarkovdev/types";
import {
  buildTaskGraph,
  getChildren,
  getParents,
  getPredecessors,
  getSuccessors,
} from "../task-graph";

function task(id: string, requirements: TaskRequirement[] = []): Task {
  return {
    id,
    name: id,
    experience: 0,
    minPlayerLevel: null,
    kappaRequired: null,
    lightkeeperRequired: null,
    factionName: "Any",
    wikiLink: null,
    trader: null,
    map: null,
    taskRequirements: requirements,
    traderRequirements: [],
    objectives: [],
    neededKeys: [],
  };
}

const complete = (id: string): TaskRequirement => ({
  task: { id, name: id },
  status: ["complete"],
});
const active = (id: string): TaskRequirement => ({ task: { id, name: id }, status: ["active"] });

describe("buildTaskGraph", () => {
  it("draws an edge from prerequisite to dependent", () => {
    const graph = buildTaskGraph([task("a"), task("b", [complete("a")])]);
    expect(getParents(graph, "b")).toEqual(["a"]);
    expect(getChildren(graph, "a")).toEqual(["b"]);
  });

  it("walks a chain transitively", () => {
    const graph = buildTaskGraph([
      task("a"),
      task("b", [complete("a")]),
      task("c", [complete("b")]),
      task("d", [complete("c")]),
    ]);
    expect(getPredecessors(graph, "d").sort()).toEqual(["a", "b", "c"]);
    expect(getSuccessors(graph, "a").sort()).toEqual(["b", "c", "d"]);
  });

  it("lets an `active` requirement inherit predecessors instead of adding an edge", () => {
    // c requires b to be *in progress*. Making b a prerequisite of c would mean
    // "finish b first", which is wrong — c should open up when b does.
    const graph = buildTaskGraph([
      task("a"),
      task("b", [complete("a")]),
      task("c", [active("b")]),
    ]);
    expect(getParents(graph, "c")).toEqual(["a"]);
    expect(getParents(graph, "c")).not.toContain("b");
  });

  it("ignores an `active` requirement on a task that has no predecessors", () => {
    const graph = buildTaskGraph([task("a"), task("b", [active("a")])]);
    expect(getParents(graph, "b")).toEqual([]);
  });

  it("skips a requirement naming a task that is not in the list", () => {
    // tarkov.dev references removed and event-only tasks; a dangling node would
    // show up as a permanently unmeetable prerequisite.
    const graph = buildTaskGraph([task("b", [complete("ghost")])]);
    expect(graph.hasNode("ghost")).toBe(false);
    expect(getParents(graph, "b")).toEqual([]);
  });

  it("survives a cycle without hanging", () => {
    const graph = buildTaskGraph([task("a", [complete("b")]), task("b", [complete("a")])]);
    expect(getPredecessors(graph, "a")).toContain("b");
    expect(getSuccessors(graph, "a")).toContain("b");
  });

  it("returns nothing for an unknown task", () => {
    const graph = buildTaskGraph([task("a")]);
    expect(getPredecessors(graph, "nope")).toEqual([]);
    expect(getParents(graph, "nope")).toEqual([]);
  });
});
