import type { TaskState } from "@/lib/logs/progress";
import type { Task } from "@/lib/tarkovdev/types";

/**
 * Orderings for the task list.
 *
 * Kept out of the page because the rules are worth asserting on their own — "shared"
 * in particular has an edge that is easy to get backwards, and a squad is not something
 * a test can conjure by rendering the page.
 */

export type SortMode = "progress" | "squad" | "trader" | "level" | "name";

export interface SortInputs {
  /** Log-derived state per task id, as the task list already holds it. */
  states: ReadonlyMap<string, TaskState>;
  /** Squadmates — you excluded — also holding each task, by task id. */
  squadHolders: ReadonlyMap<string, number>;
  /** The map the list is filtered to, when one is. Tasks handed out for it lead every mode. */
  mapId?: string;
}

export const SORT_MODES: ReadonlyArray<{ id: SortMode; label: string; title: string }> = [
  { id: "progress", label: "By progress", title: "What you are holding first, then by trader" },
  { id: "squad", label: "Shared with squad", title: "Tasks you and a squadmate are both holding, first" },
  { id: "trader", label: "By trader", title: "Grouped by who hands it out" },
  { id: "level", label: "By level", title: "Lowest level requirement first" },
  { id: "name", label: "By name", title: "Alphabetical" },
];

/** Whether both you and at least one squadmate are still holding this one. */
export function sharedWithSquad(taskId: string, inputs: SortInputs): boolean {
  if (inputs.states.get(taskId)?.status !== "started") return false;
  return (inputs.squadHolders.get(taskId) ?? 0) > 0;
}

const holding = (task: Task, inputs: SortInputs): boolean =>
  inputs.states.get(task.id)?.status === "started";

/** Held first, then grouped by trader. The order the list has always opened in. */
const byProgress = (a: Task, b: Task, inputs: SortInputs): number =>
  Number(holding(b, inputs)) - Number(holding(a, inputs)) ||
  (a.trader?.name ?? "").localeCompare(b.trader?.name ?? "");

const COMPARE: Record<SortMode, (a: Task, b: Task, inputs: SortInputs) => number> = {
  progress: byProgress,

  squad: (a, b, inputs) => {
    // Only counts when you hold it too: a task your squadmate is on alone is not
    // something you can pair up on, and floating it up would bury the ones you can.
    const rank = (task: Task) =>
      sharedWithSquad(task.id, inputs) ? (inputs.squadHolders.get(task.id) ?? 0) : 0;
    return rank(b) - rank(a) || byProgress(a, b, inputs);
  },

  trader: (a, b) => (a.trader?.name ?? "").localeCompare(b.trader?.name ?? ""),

  // `||`, not `??`: the API says "no requirement" with a literal 0 on 283 of the 491
  // tasks and with null on none of them, and both mean the same thing. Either way it is
  // not level zero, so it sorts last rather than burying the low-level tasks this
  // option exists to surface.
  level: (a, b) => (a.minPlayerLevel || Infinity) - (b.minPlayerLevel || Infinity),

  name: () => 0,
};

/**
 * Tasks *assigned* to the filtered map, above the ones that merely touch it.
 *
 * `taskIsOnMap` is deliberately wide — it keeps a task assigned elsewhere that has one
 * objective here, or whose key is found here — so filtering to Customs answers with more
 * than the Customs tasks. Ranking the assigned ones first puts what the trader sent you
 * here for at the top without dropping the rest off the list.
 *
 * Above the mode's own ordering rather than below it: the filter is the stronger
 * statement of intent, and a held task on another map is still a task for another map.
 */
const byFilteredMap = (a: Task, b: Task, mapId: string): number =>
  Number(b.map?.id === mapId) - Number(a.map?.id === mapId);

/** A sorted copy. Every mode falls through to the name so the order never jitters. */
export function sortTasks(
  tasks: readonly Task[],
  mode: SortMode,
  inputs: SortInputs,
): Task[] {
  const compare = COMPARE[mode];
  const { mapId } = inputs;
  return [...tasks].sort(
    (a, b) =>
      (mapId ? byFilteredMap(a, b, mapId) : 0) ||
      compare(a, b, inputs) ||
      a.name.localeCompare(b.name),
  );
}
