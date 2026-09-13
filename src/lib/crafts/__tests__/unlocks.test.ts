import { describe, expect, it } from "vitest";

import type { RawTask } from "@/lib/tarkovdev/raw-types";

import { craftTaskUnlock, craftUnlockIndex, unlockMet } from "../unlocks";

const task = (id: string, extra: Partial<RawTask> = {}): RawTask => ({ id, ...extra }) as RawTask;

const TASKS: Record<string, RawTask> = {
  snatch: task("snatch", {
    finishRewards: { craftUnlock: [{ station: "intel", item: "rfid", level: 2 }] },
  }),
  early: task("early", { startRewards: { craftUnlock: [{ station: "workbench", item: "ammo" }] } }),
  plain: task("plain"),
};

const craft = (stationId: string, itemId: string, taskUnlock: string | null = null) => ({
  stationId,
  productItem: { itemId },
  taskUnlock,
});

describe("craftUnlockIndex", () => {
  it("keys every craft a task hands out by station and product", () => {
    const index = craftUnlockIndex(TASKS);
    expect(index.get("intel:rfid")).toEqual({ taskId: "snatch", onStart: false });
    expect(index.get("workbench:ammo")).toEqual({ taskId: "early", onStart: true });
    expect(index.size).toBe(2);
  });

  it("tolerates tasks with no rewards at all", () => {
    expect(craftUnlockIndex({ plain: task("plain") }).size).toBe(0);
  });
});

describe("craftTaskUnlock", () => {
  const index = craftUnlockIndex(TASKS);

  it("recovers a gate the crafts document dropped", () => {
    // The UHF RFID Reader case: Snatch unlocks it, and the crafts document says nothing.
    expect(craftTaskUnlock(craft("intel", "rfid"), index)).toEqual({
      taskId: "snatch",
      onStart: false,
    });
  });

  it("prefers the crafts document's own answer when it has one", () => {
    expect(craftTaskUnlock(craft("intel", "rfid", "other"), index)).toEqual({
      taskId: "other",
      onStart: false,
    });
  });

  it("does not match the same product made at a different station", () => {
    expect(craftTaskUnlock(craft("lavatory", "rfid"), index)).toBeNull();
  });

  it("reports no gate for a craft nobody unlocks", () => {
    expect(craftTaskUnlock(craft("workbench", "sugar"), index)).toBeNull();
  });
});

describe("unlockMet", () => {
  it("wants the task finished for a reward handed out on completion", () => {
    const unlock = { taskId: "snatch", onStart: false };
    expect(unlockMet(unlock, "finished")).toBe(true);
    expect(unlockMet(unlock, "started")).toBe(false);
    expect(unlockMet(unlock, undefined)).toBe(false);
  });

  it("is met once the task is started for a reward handed out on accepting it", () => {
    const unlock = { taskId: "early", onStart: true };
    expect(unlockMet(unlock, "started")).toBe(true);
    expect(unlockMet(unlock, "finished")).toBe(true);
    expect(unlockMet(unlock, "failed")).toBe(false);
  });
});
