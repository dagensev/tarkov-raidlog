import type { LogEvent, TaskEvent } from "./events";

export type TaskStatus = "started" | "finished" | "failed";

export interface TaskState {
  taskId: string;
  status: TaskStatus;
  /** When the state was reached, ms since epoch. */
  at: number;
  /** `log` when derived from a log event, `manual` when the user set it by hand. */
  origin: "log" | "manual";
  traderId?: string;
}

export interface DeriveOptions {
  /**
   * Restrict to these log folders — normally the current wipe's. Events outside it are
   * ignored rather than deleted, so changing the selection re-derives instantly.
   */
  folders?: ReadonlySet<string>;
  /**
   * User overrides, applied on top of whatever the logs say. This is how progress from
   * before the logs on disk gets recorded, and how a mis-detected task gets corrected.
   */
  manual?: Readonly<Record<string, TaskStatus>>;
}

export function isTaskEvent(event: LogEvent): event is TaskEvent {
  return event.kind === "task";
}

/**
 * Collapse a stream of task events into one state per task.
 *
 * The latest event wins, so a task that was failed and then restarted resolves to
 * `started` rather than sticking at `failed`. Manual overrides beat the logs outright:
 * the user is correcting us, and a later log event for the same task will not silently
 * revert them — only a fresh event *after* the override was set would, which is why
 * overrides carry no timestamp of their own.
 */
export function deriveTaskStates(
  events: readonly LogEvent[],
  options: DeriveOptions = {},
): Map<string, TaskState> {
  const { folders, manual } = options;
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
      origin: "log",
      traderId: event.traderId,
    });
  }

  if (manual) {
    for (const [taskId, status] of Object.entries(manual)) {
      const existing = states.get(taskId);
      states.set(taskId, {
        taskId,
        status,
        at: existing?.at ?? 0,
        origin: "manual",
        traderId: existing?.traderId,
      });
    }
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
  /** How many states came from a manual override rather than the logs. */
  manual: number;
}

export function summarize(states: ReadonlyMap<string, TaskState>): ProgressSummary {
  const summary: ProgressSummary = { finished: 0, started: 0, failed: 0, manual: 0 };
  for (const state of states.values()) {
    summary[state.status] += 1;
    if (state.origin === "manual") summary.manual += 1;
  }
  return summary;
}
