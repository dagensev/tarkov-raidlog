import type { LogEvent, TaskEvent } from "./events";

export type TaskStatus = "started" | "finished" | "failed";

export interface TaskState {
  taskId: string;
  status: TaskStatus;
  /** When the state was reached, ms since epoch. */
  at: number;
  traderId?: string;
}

export interface DeriveOptions {
  /**
   * Restrict to these log folders — normally the current wipe's. Events outside it are
   * ignored rather than deleted, so changing the selection re-derives instantly.
   */
  folders?: ReadonlySet<string>;
}

export function isTaskEvent(event: LogEvent): event is TaskEvent {
  return event.kind === "task";
}

/**
 * Collapse a stream of task events into one state per task.
 *
 * The latest event wins, so a task that was failed and then restarted resolves to
 * `started` rather than sticking at `failed`. The logs are the only source of task
 * progress — there is no way to overrule them from inside the app.
 */
export function deriveTaskStates(
  events: readonly LogEvent[],
  options: DeriveOptions = {},
): Map<string, TaskState> {
  const { folders } = options;
  const states = new Map<string, TaskState>();

  for (const event of events) {
    if (!isTaskEvent(event)) continue;
    if (folders && !folders.has(event.folder)) continue;

    const existing = states.get(event.taskId);
    if (existing && existing.at > event.timestamp) continue;
    states.set(event.taskId, {
      taskId: event.taskId,
      status: event.status,
      at: event.timestamp,
      traderId: event.traderId,
    });
  }

  return states;
}

/** Task ids in a given state. */
export function taskIdsWithStatus(
  states: ReadonlyMap<string, TaskState>,
  status: TaskStatus,
): string[] {
  return [...states.values()].filter((s) => s.status === status).map((s) => s.taskId);
}

export interface ProgressSummary {
  finished: number;
  started: number;
  failed: number;
  /**
   * Tasks the logs record but the current task list does not contain.
   *
   * Real logs turn these up: quests completed during a wipe that tarkov.dev no longer
   * publishes, because they were event-only or removed in a patch. They are counted
   * apart rather than folded in, so this summary agrees with a task list that cannot
   * show them.
   */
  unmatched: number;
}

/**
 * Count states by status.
 *
 * Pass `knownTaskIds` to restrict the counts to tasks the loaded dataset actually has;
 * anything else lands in `unmatched`. Without it, everything is counted.
 */
export function summarize(
  states: ReadonlyMap<string, TaskState>,
  knownTaskIds?: ReadonlySet<string>,
): ProgressSummary {
  const summary: ProgressSummary = {
    finished: 0,
    started: 0,
    failed: 0,
    unmatched: 0,
  };
  for (const state of states.values()) {
    if (knownTaskIds && knownTaskIds.size > 0 && !knownTaskIds.has(state.taskId)) {
      summary.unmatched += 1;
      continue;
    }
    summary[state.status] += 1;
  }
  return summary;
}
