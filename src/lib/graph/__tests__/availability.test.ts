import { describe, expect, it } from "vitest";

import type { TaskState } from "@/lib/logs/progress";
import type { Task, TaskRequirement } from "@/lib/tarkovdev/types";
import { computeAvailability, evaluateTask, type PlayerContext } from "../availability";

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

function states(entries: Record<string, TaskState["status"]>): Map<string, TaskState> {
  return new Map(
    Object.entries(entries).map(([taskId, status]) => [
      taskId,
      { taskId, status, at: 1_000 },
    ]),
  );
}

const player: PlayerContext = {};

const req = (id: string, status: string[]): TaskRequirement => ({
  task: { id, name: id },
  status: status as TaskRequirement["status"],
});

describe("evaluateTask", () => {
  it("marks a task with no requirements available", () => {
    expect(evaluateTask(task("a"), states({}), player).status).toBe("available");
  });

  it("reports a finished task", () => {
    expect(evaluateTask(task("a"), states({ a: "finished" }), player).status).toBe("finished");
  });

  it("reports a task in progress", () => {
    expect(evaluateTask(task("a"), states({ a: "started" }), player).status).toBe("started");
  });

  it("locks a task whose prerequisite is not complete", () => {
    const result = evaluateTask(
      task("b", { taskRequirements: [req("a", ["complete"])] }),
      states({}),
      player,
    );
    expect(result.status).toBe("locked");
    expect(result.reasons[0]).toMatchObject({ kind: "task", taskId: "a", actual: "none" });
  });

  it("unlocks once the prerequisite is complete", () => {
    const result = evaluateTask(
      task("b", { taskRequirements: [req("a", ["complete"])] }),
      states({ a: "finished" }),
      player,
    );
    expect(result.status).toBe("available");
  });

  it("treats an `active` requirement as satisfied by a started prerequisite", () => {
    const subject = task("b", { taskRequirements: [req("a", ["active"])] });
    expect(evaluateTask(subject, states({ a: "started" }), player).status).toBe("available");
    // Finished is not "active" — the prerequisite is no longer in progress.
    expect(evaluateTask(subject, states({ a: "finished" }), player).status).toBe("locked");
  });

  it("accepts any one of several allowed statuses", () => {
    const subject = task("b", { taskRequirements: [req("a", ["complete", "failed"])] });
    expect(evaluateTask(subject, states({ a: "failed" }), player).status).toBe("available");
    expect(evaluateTask(subject, states({ a: "finished" }), player).status).toBe("available");
    expect(evaluateTask(subject, states({ a: "started" }), player).status).toBe("locked");
  });

  it("does not gate on player level or faction, which it cannot know", () => {
    // Neither is in the logs and this app no longer asks for them. Guessing would hide
    // real tasks behind a level you may well have passed; the row states the requirement
    // and leaves the judgement to the person who knows the answer.
    for (const subject of [task("a", { minPlayerLevel: 99 }), task("b", { factionName: "BEAR" })]) {
      const result = evaluateTask(subject, states({}), player);
      expect(result.status, subject.id).toBe("available");
      expect(result.reasons, subject.id).toEqual([]);
    }
  });

  it("locks on an unmet trader level", () => {
    const subject = task("a", {
      traderRequirements: [{ trader: { id: "prapor", name: "Prapor" }, value: 3 }],
    });
    const result = evaluateTask(subject, states({}), { ...player, traderLevels: { prapor: 2 } });
    expect(result.status).toBe("locked");
    expect(result.reasons[0]).toMatchObject({ kind: "trader", required: 3, current: 2 });
  });

  it("shows a task with an uncheckable trader level rather than hiding it", () => {
    // Trader loyalty is not in the logs, so it is often unknown. Hiding real tasks
    // would be worse than showing one that turns out not to be ready.
    const subject = task("a", {
      traderRequirements: [{ trader: { id: "prapor", name: "Prapor" }, value: 3 }],
    });
    const result = evaluateTask(subject, states({}), player);
    expect(result.status).toBe("available");
    expect(result.unverified).toBe(true);
  });

  it("keeps a task you are holding out of the locked bucket", () => {
    // You already have it; telling you it is locked would be nonsense.
    const subject = task("b", { taskRequirements: [req("a", ["complete"])] });
    expect(evaluateTask(subject, states({ b: "started" }), player).status).toBe("started");
  });

  it("collects every reason a task is locked, not just the first", () => {
    const subject = task("b", {
      taskRequirements: [req("a", ["complete"])],
      traderRequirements: [{ trader: { id: "prapor", name: "Prapor" }, value: 3 }],
    });
    const result = evaluateTask(subject, states({}), { traderLevels: { prapor: 1 } });
    expect(result.reasons.map((r) => r.kind).sort()).toEqual(["task", "trader"]);
  });
});

describe("computeAvailability", () => {
  it("evaluates every task", () => {
    const result = computeAvailability(
      [task("a"), task("b", { taskRequirements: [req("a", ["complete"])] })],
      states({ a: "finished" }),
      player,
    );
    expect(result.get("a")?.status).toBe("finished");
    expect(result.get("b")?.status).toBe("available");
  });
});
