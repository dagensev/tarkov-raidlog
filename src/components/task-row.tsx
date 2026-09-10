"use client";

import type { TaskAvailability } from "@/lib/graph/availability";
import type { TaskState } from "@/lib/logs/progress";
import { objectiveAmount } from "@/lib/tarkovdev/objectives";
import type { Task, TaskObjective } from "@/lib/tarkovdev/types";
import { useSquadHolders } from "@/lib/store/squad-hooks";
import { ItemIcon } from "./item-icon";
import { Pill, cx } from "./ui";

/**
 * Status shown per task comes from the logs alone — done, in progress, failed, or not
 * started. It deliberately does not report whether a task is *available*: that would
 * depend on trader loyalty we cannot read, event flags we do not evaluate, and unlock
 * delays we ignore, so it was wrong often enough to be misleading.
 *
 * Requirements are still surfaced, as information rather than as a verdict.
 */
type RowStatus = "finished" | "started" | "failed" | "not-started";

const STATUS_STYLE: Record<RowStatus, { rail: string; label: string; tone: Parameters<typeof Pill>[0]["tone"] }> = {
  finished: { rail: "bg-moss", label: "Done", tone: "moss" },
  started: { rail: "bg-amber", label: "In progress", tone: "amber" },
  failed: { rail: "bg-rust", label: "Failed", tone: "rust" },
  "not-started": { rail: "bg-line-bright", label: "Not started", tone: "muted" },
};

export function rowStatus(state?: TaskState): RowStatus {
  return state?.status ?? "not-started";
}

/** Keys needed on a given map, which is the thing you want to know before you queue. */
function KeyList({ task, mapId }: { task: Task; mapId?: string }) {
  const groups = task.neededKeys?.filter((g) => !mapId || !g.map || g.map.id === mapId) ?? [];
  const keys = groups.flatMap((g) => g.keys);
  if (keys.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="stencil text-[9px] text-rust">Keys</span>
      {keys.map((key) => (
        <a
          key={key.id}
          href={key.wikiLink ?? undefined}
          target="_blank"
          rel="noreferrer"
          title={key.name}
          className="data inline-flex items-center gap-1 border border-rust/40 bg-rust/10 py-[1px] pr-1.5 pl-1 text-[10px] text-rust transition-colors hover:bg-rust hover:text-ground"
        >
          <ItemIcon src={key.iconLink} size={14} />
          {key.shortName ?? key.name}
        </a>
      ))}
    </div>
  );
}

/**
 * Squadmates holding this task too.
 *
 * Read from the squad store here rather than passed in: task rows appear on three pages
 * and only one of them knows anything about squads. Renders nothing when you are alone,
 * so the row is unchanged for a solo player.
 */
function SquadTag({ taskId }: { taskId: string }) {
  const holders = useSquadHolders(taskId);
  if (holders.length === 0) return null;

  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className="stencil text-[9px] text-moss">Squad</span>
      {holders.map((member) => (
        <span
          key={member.id}
          title={`${member.name} is also holding this`}
          className="data border border-moss/40 bg-moss/10 px-1.5 py-[1px] text-[10px] text-moss"
        >
          {member.name}
        </span>
      ))}
    </span>
  );
}

/** How many of a thing an objective wants — the part the description leaves out. */
function Amount({ objective }: { objective: TaskObjective }) {
  const amount = objectiveAmount(objective);
  if (!amount) return null;
  return (
    <span className="data ml-1.5 border border-amber/40 bg-amber/10 px-1 py-[1px] text-[10px] whitespace-nowrap text-amber">
      {amount}
    </span>
  );
}

/** Unmet prerequisites, phrased as information rather than a locked verdict. */
function Requires({ availability }: { availability: TaskAvailability }) {
  const reasons = availability.reasons.filter((r) => r.kind !== "trader");
  if (reasons.length === 0) return null;
  return (
    <div className="pt-1">
      <span className="stencil text-[9px] text-muted">Requires</span>
      <ul className="mt-1 space-y-1">
        {reasons.map((reason, i) => (
          <li key={i} className="data text-[11px] text-muted">
            {reason.kind === "task" && `“${reason.taskName}” ${reason.need.join(" or ")}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TaskRow({
  task,
  state,
  availability,
  mapId,
  id,
}: {
  task: Task;
  state?: TaskState;
  availability?: TaskAvailability;
  mapId?: string;
  /** Anchor, so a pin on the map can scroll to this row. */
  id?: string;
}) {
  const status = rowStatus(state);
  const style = STATUS_STYLE[status];
  const isDone = status === "finished";

  const objectives = mapId
    ? task.objectives.filter((o) => o.maps.some((m) => m.id === mapId))
    : task.objectives;

  return (
    <li id={id} className="group relative flex gap-3 border-b border-line/70 transition-colors hover:bg-panel-2/60">
      <span className={cx("w-[3px] shrink-0", style.rail)} aria-hidden />

      <div className="min-w-0 flex-1 py-2.5 pr-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {/* The name is the wiki link: it is the thing you reach for mid-raid. */}
          {task.wikiLink ? (
            <a
              href={task.wikiLink}
              target="_blank"
              rel="noreferrer"
              title={`Open “${task.name}” on the wiki`}
              className={cx(
                "text-[14px] leading-tight underline decoration-line-bright underline-offset-4 transition-colors hover:decoration-amber",
                isDone ? "text-muted line-through decoration-moss/50" : "text-bone hover:text-amber",
              )}
            >
              {task.name}
            </a>
          ) : (
            <span
              className={cx(
                "text-[14px] leading-tight",
                isDone ? "text-muted line-through decoration-moss/50" : "text-bone",
              )}
            >
              {task.name}
            </span>
          )}

          {task.trader ? (
            <span className="data text-[11px] text-bone-dim">{task.trader.name}</span>
          ) : null}
          {task.map ? <Pill tone="steel">{task.map.name}</Pill> : null}
          {task.kappaRequired ? <Pill tone="amber">κ</Pill> : null}
          {task.minPlayerLevel ? (
            <span className="data text-[10px] text-muted">Lv{task.minPlayerLevel}</span>
          ) : null}
          {/*
            Twelve of the 491 tasks are locked to one side. Nothing here knows which side
            you are — that is the point — so this states the task's requirement and leaves
            the comparison to you.
          */}
          {task.factionName && task.factionName !== "Any" ? (
            <Pill tone="steel">{task.factionName} only</Pill>
          ) : null}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <KeyList task={task} mapId={mapId} />
          <SquadTag taskId={task.id} />
        </div>

        <div className="mt-2 space-y-2 border-l border-line-bright pl-3">
            {objectives.length > 0 ? (
              <ul className="space-y-1">
                {objectives.map((objective) => (
                  <li key={objective.id} className="text-[12px] leading-snug text-bone-dim">
                    <span className="text-muted">— </span>
                    {objective.description}
                    <Amount objective={objective} />
                    {objective.optional ? (
                      <span className="data ml-1 text-[10px] text-muted">optional</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          {availability && !isDone ? <Requires availability={availability} /> : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 py-2.5 pr-3">
        <Pill tone={style.tone}>{style.label}</Pill>

        {/* Completion comes from the logs alone — there is nothing here to click. */}
        {isDone ? (
          <span
            title="Completed in your logs"
            className="grid size-6 place-items-center border border-moss/40 bg-moss/10 text-[11px] text-moss"
          >
            ✓
          </span>
        ) : null}
      </div>
    </li>
  );
}
