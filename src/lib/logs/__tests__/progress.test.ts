import { describe, expect, it } from "vitest";

import type { LogEvent, TaskEvent } from "../events";
import { deriveTaskStates, summarize, taskIdsWithStatus } from "../progress";

const TASK_A = "657315ddab5a49b71f098853";
const TASK_B = "657315e270bb0b8dba00cc48";

function task(
  taskId: string,
  status: TaskEvent["status"],
  at: number,
  folder = "current",
): LogEvent {
  return {
    kind: "task",
    status,
    taskId,
    timestamp: at,
    source: "notifications",
    folder,
    gameVersion: "1.1.0.1.46911",
  };
}

describe("deriveTaskStates", () => {
  it("keeps the latest event for a task", () => {
    const states = deriveTaskStates([
      task(TASK_A, "started", 1_000),
      task(TASK_A, "finished", 2_000),
    ]);
    expect(states.get(TASK_A)).toMatchObject({ status: "finished", at: 2_000, origin: "log" });
  });

  it("resolves a failed-then-restarted task to started", () => {
    // Latest wins, so a restart is not stuck at `failed`.
    const states = deriveTaskStates([
      task(TASK_A, "failed", 2_000),
      task(TASK_A, "started", 3_000),
    ]);
    expect(states.get(TASK_A)?.status).toBe("started");
  });

  it("ignores event order in the input", () => {
    const states = deriveTaskStates([
      task(TASK_A, "finished", 2_000),
      task(TASK_A, "started", 1_000),
    ]);
    expect(states.get(TASK_A)?.status).toBe("finished");
  });

  it("excludes folders outside the selected wipe", () => {
    const states = deriveTaskStates(
      [task(TASK_A, "finished", 1_000, "old-wipe"), task(TASK_B, "finished", 2_000, "current")],
      { folders: new Set(["current"]) },
    );
    expect([...states.keys()]).toEqual([TASK_B]);
  });

  it("lets a manual override beat the logs", () => {
    // How progress from before the logs on disk gets recorded.
    const states = deriveTaskStates([task(TASK_A, "started", 1_000)], {
      manual: { [TASK_A]: "finished", [TASK_B]: "finished" },
    });
    expect(states.get(TASK_A)).toMatchObject({ status: "finished", origin: "manual" });
    expect(states.get(TASK_B)).toMatchObject({ status: "finished", origin: "manual" });
  });

  it("keeps trader and timestamp from the log when overriding", () => {
    const event = task(TASK_A, "started", 1_000) as TaskEvent;
    event.traderId = "54cb57776803fa99248b456e";
    const states = deriveTaskStates([event], { manual: { [TASK_A]: "finished" } });
    expect(states.get(TASK_A)).toMatchObject({
      at: 1_000,
      traderId: "54cb57776803fa99248b456e",
    });
  });

  it("ignores non-task events", () => {
    const states = deriveTaskStates([
      { kind: "raid-ended", timestamp: 1, source: "notifications", folder: "f", gameVersion: "1" },
    ]);
    expect(states.size).toBe(0);
  });
});

describe("summarize", () => {
  it("counts states by status and flags manual entries", () => {
    const states = deriveTaskStates(
      [task(TASK_A, "finished", 1_000), task(TASK_B, "started", 1_000)],
      { manual: { zzz: "failed" } },
    );
    expect(summarize(states)).toEqual({
      finished: 1,
      started: 1,
      failed: 1,
      manual: 1,
      unmatched: 0,
    });
    expect(taskIdsWithStatus(states, "finished")).toEqual([TASK_A]);
  });

  it("separates completions the task list does not contain", () => {
    // Real logs turn these up: quests finished during a wipe that tarkov.dev no longer
    // publishes. Counting them in would make the overview disagree with the task list.
    const states = deriveTaskStates([
      task(TASK_A, "finished", 1_000),
      task("616051e63f96cc089c1cf37f", "finished", 1_000),
    ]);
    const known = new Set([TASK_A]);
    expect(summarize(states, known)).toMatchObject({ finished: 1, unmatched: 1 });
  });

  it("counts everything when the task list has not loaded", () => {
    // An empty set means "we do not know yet", not "nothing is known".
    const states = deriveTaskStates([task(TASK_A, "finished", 1_000)]);
    expect(summarize(states, new Set())).toMatchObject({ finished: 1, unmatched: 0 });
  });
});
