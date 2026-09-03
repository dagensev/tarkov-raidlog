import type { TaskState, TaskStatus } from "@/lib/logs/progress";
import type { Task, TaskRequirement } from "@/lib/tarkovdev/types";

/**
 * Which tasks you can actually pick up right now.
 *
 * Ported from TarkovTracker's `tarkov-tracker/src/stores/progress.js` (`unlockedTasks`),
 * minus the halves of it we cannot honestly answer: a task is available when it is not
 * already done, every prerequisite stands as required, and trader levels are met.
 *
 * TarkovTracker also gates on player level and faction, because it asks the player for
 * both. This app does not ask, so it does not judge — the level a task wants and the side
 * it is locked to are shown on the row as facts about the task, and you apply them.
 */

export type AvailabilityStatus = "finished" | "failed" | "started" | "available" | "locked";

export type LockReason =
  | { kind: "task"; taskId: string; taskName: string; need: string[]; actual: TaskStatus | "none" }
  | { kind: "trader"; traderId: string; traderName: string; required: number; current?: number };

export interface TaskAvailability {
  taskId: string;
  status: AvailabilityStatus;
  reasons: LockReason[];
  /** True when a trader level requirement could not be checked for lack of data. */
  unverified: boolean;
}

export interface PlayerContext {
  /**
   * Loyalty level per trader id. Not derivable from the logs, so it is usually partial.
   * A trader with no entry is treated as satisfied and the task is flagged `unverified`
   * rather than hidden — hiding real tasks is worse than showing one that is not ready.
   */
  traderLevels?: Readonly<Record<string, number>>;
}

/**
 * Does a prerequisite stand as this requirement demands?
 *
 * tarkov.dev gives a list of acceptable statuses, and any one of them satisfies it.
 * `complete` maps to our `finished`, `active` to `started`, `failed` to `failed`.
 */
function requirementMet(
  requirement: TaskRequirement,
  states: ReadonlyMap<string, TaskState>,
): boolean {
  const actual = states.get(requirement.task.id)?.status;
  for (const wanted of requirement.status ?? []) {
    if (wanted === "complete" && actual === "finished") return true;
    if (wanted === "active" && actual === "started") return true;
    if (wanted === "failed" && actual === "failed") return true;
    // A prerequisite that must be *not* started is expressed as an empty/other status
    // upstream; treat anything unrecognised as unmet rather than silently passing.
  }
  return false;
}

/** Work out the state of one task. */
export function evaluateTask(
  task: Task,
  states: ReadonlyMap<string, TaskState>,
  player: PlayerContext,
): TaskAvailability {
  const own = states.get(task.id);
  if (own?.status === "finished") {
    return { taskId: task.id, status: "finished", reasons: [], unverified: false };
  }
  if (own?.status === "failed") {
    return { taskId: task.id, status: "failed", reasons: [], unverified: false };
  }

  const reasons: LockReason[] = [];
  let unverified = false;

  for (const requirement of task.taskRequirements ?? []) {
    if (requirementMet(requirement, states)) continue;
    reasons.push({
      kind: "task",
      taskId: requirement.task.id,
      taskName: requirement.task.name,
      need: requirement.status ?? [],
      actual: states.get(requirement.task.id)?.status ?? "none",
    });
  }

  for (const requirement of task.traderRequirements ?? []) {
    const current = player.traderLevels?.[requirement.trader.id];
    if (current === undefined) {
      unverified = true;
      continue;
    }
    if (current < requirement.value) {
      reasons.push({
        kind: "trader",
        traderId: requirement.trader.id,
        traderName: requirement.trader.name,
        required: requirement.value,
        current,
      });
    }
  }

  // A task already in progress stays "started" even if a requirement now reads unmet —
  // you are holding it, so telling you it is locked would be nonsense.
  if (own?.status === "started") {
    return { taskId: task.id, status: "started", reasons: [], unverified };
  }

  return {
    taskId: task.id,
    status: reasons.length === 0 ? "available" : "locked",
    reasons,
    unverified,
  };
}

/** Evaluate every task. */
export function computeAvailability(
  tasks: readonly Task[],
  states: ReadonlyMap<string, TaskState>,
  player: PlayerContext,
): Map<string, TaskAvailability> {
  const result = new Map<string, TaskAvailability>();
  for (const task of tasks) result.set(task.id, evaluateTask(task, states, player));
  return result;
}

/** Tasks you can pick up or are already holding, which is what the task list shows first. */
export function activeTasks(
  tasks: readonly Task[],
  availability: ReadonlyMap<string, TaskAvailability>,
): Task[] {
  return tasks.filter((task) => {
    const status = availability.get(task.id)?.status;
    return status === "available" || status === "started";
  });
}
