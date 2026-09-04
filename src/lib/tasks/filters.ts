/**
 * The task list's filters, beside the orderings in `sort.ts`.
 *
 * Filters are log-derived only.
 *
 * There was a "Ready" filter built on computed availability. It was dropped because it
 * could not be trusted: trader loyalty is not in the logs, 176 tasks carry event flags we
 * do not evaluate, and 13 unlock on a timer we ignore. Showing a confident "ready" that is
 * sometimes wrong is worse than not showing one.
 */

export type TaskFilter = "started" | "finished" | "all";

export const FILTERS: ReadonlyArray<{ id: TaskFilter; label: string; title: string }> = [
  { id: "started", label: "In progress", title: "Accepted and not yet handed in" },
  { id: "finished", label: "Done", title: "Completed this wipe" },
  { id: "all", label: "All", title: "Every task in the game" },
];
