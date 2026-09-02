"use client";

import { useState } from "react";

import type { TaskAvailability } from "@/lib/graph/availability";
import type { TaskState } from "@/lib/logs/progress";
import type { Task } from "@/lib/tarkovdev/types";
import { useAppStore } from "@/lib/store/app-store";
import { Pill, cx } from "./ui";

const STATUS_STYLE = {
  finished: { rail: "bg-moss", label: "Done", tone: "moss" },
  started: { rail: "bg-amber", label: "Active", tone: "amber" },
  available: { rail: "bg-bone-dim", label: "Ready", tone: "muted" },
  locked: { rail: "bg-line-bright", label: "Locked", tone: "muted" },
  failed: { rail: "bg-rust", label: "Failed", tone: "rust" },
} as const;

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
          className="data border border-rust/40 bg-rust/10 px-1.5 py-[1px] text-[10px] text-rust transition-colors hover:bg-rust hover:text-ground"
        >
          {key.shortName ?? key.name}
        </a>
      ))}
    </div>
  );
}

function Reasons({ availability }: { availability: TaskAvailability }) {
  if (availability.reasons.length === 0) return null;
  return (
    <ul className="space-y-1 pt-1">
      {availability.reasons.map((reason, i) => (
        <li key={i} className="data text-[11px] text-muted">
          {reason.kind === "task" && `Needs “${reason.taskName}” ${reason.need.join(" or ")}`}
          {reason.kind === "level" && `Needs level ${reason.required} (you are ${reason.current})`}
          {reason.kind === "trader" &&
            `Needs ${reason.traderName} LL${reason.required}${
              reason.current !== undefined ? ` (you are LL${reason.current})` : ""
            }`}
          {reason.kind === "faction" && `${reason.required} only`}
        </li>
      ))}
    </ul>
  );
}

export function TaskRow({
  task,
  state,
  availability,
  mapId,
}: {
  task: Task;
  state?: TaskState;
  availability?: TaskAvailability;
  mapId?: string;
}) {
  const [open, setOpen] = useState(false);
  const setManualTask = useAppStore((s) => s.setManualTask);

  const status = availability?.status ?? "available";
  const style = STATUS_STYLE[status];
  const isDone = status === "finished";
  const objectives = mapId
    ? task.objectives.filter((o) => o.maps.some((m) => m.id === mapId))
    : task.objectives;

  return (
    <li className="group relative flex gap-3 border-b border-line/70 transition-colors hover:bg-panel-2/60">
      <span className={cx("w-[3px] shrink-0", style.rail)} aria-hidden />

      <div className="min-w-0 flex-1 py-2.5 pr-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={cx(
              "cursor-pointer text-left text-[14px] leading-tight transition-colors",
              isDone ? "text-muted line-through decoration-moss/50" : "text-bone hover:text-amber",
            )}
          >
            {task.name}
          </button>

          {task.trader ? (
            <span className="data text-[11px] text-bone-dim">{task.trader.name}</span>
          ) : null}
          {task.map ? <Pill tone="steel">{task.map.name}</Pill> : null}
          {task.kappaRequired ? <Pill tone="amber">κ</Pill> : null}
          {task.minPlayerLevel ? (
            <span className="data text-[10px] text-muted">Lv{task.minPlayerLevel}</span>
          ) : null}
          {state?.origin === "manual" ? <Pill tone="muted">by hand</Pill> : null}
          {availability?.unverified ? (
            <Pill tone="muted" className="opacity-70">
              trader LL unknown
            </Pill>
          ) : null}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <KeyList task={task} mapId={mapId} />
        </div>

        {open ? (
          <div className="mt-2 space-y-2 border-l border-line-bright pl-3">
            {objectives.length > 0 ? (
              <ul className="space-y-1">
                {objectives.map((objective) => (
                  <li key={objective.id} className="text-[12px] leading-snug text-bone-dim">
                    <span className="text-muted">— </span>
                    {objective.description}
                    {objective.optional ? (
                      <span className="data ml-1 text-[10px] text-muted">optional</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {availability ? <Reasons availability={availability} /> : null}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2 py-2.5 pr-3">
        <Pill tone={style.tone}>{style.label}</Pill>

        {task.wikiLink ? (
          <a
            href={task.wikiLink}
            target="_blank"
            rel="noreferrer"
            title="Open the wiki page"
            className="stencil border border-line-bright px-2 py-1 text-[9px] text-muted transition-colors hover:border-amber-dim hover:text-amber"
          >
            Wiki
          </a>
        ) : null}

        {/* Manual override: the only way to record progress the logs cannot reach. */}
        <button
          type="button"
          title={isDone ? "Mark as not done" : "Mark as done"}
          onClick={() => void setManualTask(task.id, isDone ? null : "finished")}
          className={cx(
            "grid size-6 cursor-pointer place-items-center border text-[11px] transition-colors",
            isDone
              ? "border-moss/60 bg-moss/15 text-moss hover:border-rust/60 hover:text-rust"
              : "border-line-bright text-muted hover:border-moss hover:text-moss",
          )}
        >
          {isDone ? "✓" : ""}
        </button>
      </div>
    </li>
  );
}
