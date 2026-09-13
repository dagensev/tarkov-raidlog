/**
 * Which task unlocks a craft, including the gates tarkov.dev's crafts document dropped.
 *
 * The crafts document carries `taskUnlock`, but its importer only attaches one when it can
 * match the game's `QuestComplete` requirement to a task reward. When the match fails it
 * logs "Unknown quest unlock" and publishes the craft with no gate at all — see
 * `jobs/update-crafts.mjs` in the-hideout/tarkov-data-manager. The UHF RFID Reader is the
 * live case: Snatch unlocks it, the document lists it as free to run, and it lands at the
 * top of a profit-per-hour table, which is the worst place for a craft nobody can start.
 *
 * The tasks document still says which crafts each task hands out, by station and product,
 * and the core bundle already caches it whole. So the gate is put back from that side. What
 * this cannot do is recover a gate that neither document records.
 */

import type { TaskStatus } from "@/lib/logs/progress";
import type { RawTask } from "@/lib/tarkovdev/raw-types";

export interface CraftUnlock {
  taskId: string;
  /**
   * Handed out on accepting the task rather than on finishing it, so a started task is
   * enough. Only knowable for a gate the tasks document names.
   */
  onStart: boolean;
}

const key = (stationId: string, itemId: string) => `${stationId}:${itemId}`;

/** Station and product to the task that unlocks that craft. */
export function craftUnlockIndex(
  tasks: Readonly<Record<string, RawTask>>,
): Map<string, CraftUnlock> {
  const index = new Map<string, CraftUnlock>();
  for (const task of Object.values(tasks)) {
    const sides = [
      { rewards: task.startRewards, onStart: true },
      { rewards: task.finishRewards, onStart: false },
    ];
    for (const { rewards, onStart } of sides) {
      for (const unlock of rewards?.craftUnlock ?? []) {
        if (!unlock?.station || !unlock.item) continue;
        const id = key(unlock.station, unlock.item);
        // First one wins. No craft in the live data is unlocked by two tasks, and if one
        // ever is, either is a truthful answer to "what gates this".
        if (!index.has(id)) index.set(id, { taskId: task.id, onStart });
      }
    }
  }
  return index;
}

/** The gate on a craft: the crafts document's own answer when it has one, else the recovered one. */
export function craftTaskUnlock(
  craft: { stationId: string; productItem: { itemId: string }; taskUnlock: string | null },
  index: ReadonlyMap<string, CraftUnlock>,
): CraftUnlock | null {
  const recovered = index.get(key(craft.stationId, craft.productItem.itemId)) ?? null;
  if (craft.taskUnlock) {
    return {
      taskId: craft.taskUnlock,
      onStart: recovered?.taskId === craft.taskUnlock ? recovered.onStart : false,
    };
  }
  return recovered;
}

/** Whether a task's logged status has handed the craft out yet. */
export function unlockMet(unlock: CraftUnlock, status: TaskStatus | undefined): boolean {
  return status === "finished" || (unlock.onStart && status === "started");
}
