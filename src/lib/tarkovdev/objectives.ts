import type { TaskObjective } from "./types";

/**
 * The amount an objective asks for, as a short badge, or null when there is nothing to add.
 *
 * tarkov.dev's objective descriptions are written without their quantities — "Eliminate
 * Scavs with an M4A1, M16, ADAR, or TX-15 on Shoreline" is ten kills, and "Hand over the
 * items" is two Secure Flash drives. The number lives in `count`, so a task read straight
 * from the description looks like one of each would finish it. 411 of the 1398 objectives
 * ask for more than one.
 *
 * Two types are handled apart from `count`:
 *
 *  - `skill` carries its target in `level` and says only "Reach the required Attention
 *    skill level", so the number is the whole point.
 *  - `traderLevel` also carries `level`, but its description already reads "Reach Loyalty
 *    Level 4 with Ragman" — a badge there would just repeat it.
 */
export function objectiveAmount(objective: TaskObjective): string | null {
  if (objective.type === "traderLevel") return null;
  if (objective.type === "skill") {
    return objective.level ? `Lv ${objective.level}` : null;
  }

  const count = objective.count ?? 0;
  // Roubles and dollars come through as counts in the millions, so they get separators.
  return count > 1 ? `×${count.toLocaleString("en-US")}` : null;
}
