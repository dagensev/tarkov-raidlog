import { taskIsOnMap } from "@/lib/tarkovdev/maps";
import type { GameMap, Task } from "@/lib/tarkovdev/types";

export interface MapOption {
  map: GameMap;
  count: number;
}

/**
 * Maps worth offering in a picker, each with how many of `tasks` it holds.
 *
 * Maps with nothing to show are dropped, so choosing any option always lands on at least
 * one task. `keep` exempts a single id from that — for a picker whose selection was made
 * for you rather than by you, where removing the selected option would blank the control
 * while the panel beneath it explains there is nothing here.
 *
 * Map order is the caller's, so a picker keeps whatever order it was handed.
 */
export function mapOptions(
  maps: readonly GameMap[],
  tasks: readonly Task[],
  keep?: string | null,
): MapOption[] {
  return maps
    .map((map) => ({ map, count: tasks.filter((task) => taskIsOnMap(task, map.id)).length }))
    .filter((option) => option.count > 0 || (Boolean(keep) && option.map.id === keep));
}
