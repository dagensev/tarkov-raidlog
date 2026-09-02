"use client";

import { useMemo, useState } from "react";

import { TaskRow, rowStatus } from "@/components/task-row";
import { EmptyNote, Panel, PanelHeader, cx } from "@/components/ui";
import {
  useAvailability,
  useMapsWithTasks,
  useTaskStates,
  useTasks,
} from "@/lib/store/hooks";
import { taskIsOnMap } from "@/lib/tarkovdev/maps";

/**
 * Filters are log-derived only.
 *
 * There was a "Ready" filter built on computed availability. It was dropped because it
 * could not be trusted: trader loyalty is not in the logs, 176 tasks carry event flags we
 * do not evaluate, and 13 unlock on a timer we ignore. Showing a confident "ready" that is
 * sometimes wrong is worse than not showing one.
 */
type Filter = "started" | "finished" | "all";

const FILTERS: Array<{ id: Filter; label: string; title: string }> = [
  { id: "started", label: "In progress", title: "Accepted and not yet handed in" },
  { id: "finished", label: "Done", title: "Completed this wipe" },
  { id: "all", label: "All", title: "Every task in the game" },
];

export default function TasksPage() {
  const tasks = useTasks();
  const states = useTaskStates();
  const availability = useAvailability();
  const maps = useMapsWithTasks();

  const [filter, setFilter] = useState<Filter>("started");
  const [query, setQuery] = useState("");
  const [mapId, setMapId] = useState<string>("");
  const [kappaOnly, setKappaOnly] = useState(false);

  const counts = useMemo<Record<Filter, number>>(() => {
    let started = 0;
    let finished = 0;
    for (const task of tasks) {
      const status = rowStatus(states.get(task.id));
      if (status === "started") started += 1;
      if (status === "finished") finished += 1;
    }
    return { started, finished, all: tasks.length };
  }, [tasks, states]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tasks
      .filter((task) => {
        const status = rowStatus(states.get(task.id));
        if (filter !== "all" && status !== filter) return false;
        if (kappaOnly && !task.kappaRequired) return false;
        if (mapId && !taskIsOnMap(task, mapId)) return false;
        if (needle && !task.name.toLowerCase().includes(needle)) {
          const trader = task.trader?.name.toLowerCase() ?? "";
          if (!trader.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        // In progress first, then grouped by trader so a run follows who to hand in to.
        const rank = (id: string) => (rowStatus(states.get(id)) === "started" ? 0 : 1);
        return (
          rank(a.id) - rank(b.id) ||
          (a.trader?.name ?? "").localeCompare(b.trader?.name ?? "") ||
          a.name.localeCompare(b.name)
        );
      });
  }, [tasks, states, filter, query, mapId, kappaOnly]);

  if (tasks.length === 0) {
    return (
      <Panel>
        <PanelHeader title="Tasks" meta="no game data" />
        <EmptyNote>
          Task data comes from tarkov.dev and has not loaded yet. Your log history is safe either
          way.
        </EmptyNote>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel className="rise">
        <PanelHeader title="Filters" meta={`${visible.length} shown`} />
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              title={option.title}
              onClick={() => setFilter(option.id)}
              className={cx(
                "stencil cursor-pointer border px-3 py-1.5 text-[10px] transition-colors",
                filter === option.id
                  ? "border-amber bg-amber/15 text-amber"
                  : "border-line-bright text-muted hover:text-bone-dim",
              )}
            >
              {option.label}
              <span className="data ml-2 text-[10px] opacity-60">{counts[option.id]}</span>
            </button>
          ))}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tasks or traders"
              className="data w-52 border border-line-bright bg-ground-2 px-2 py-1.5 text-[12px] text-bone placeholder:text-muted focus:border-amber-dim focus:outline-none"
            />
            <select
              value={mapId}
              onChange={(e) => setMapId(e.target.value)}
              className="data border border-line-bright bg-ground-2 px-2 py-1.5 text-[12px] text-bone focus:border-amber-dim focus:outline-none"
            >
              <option value="">Any map</option>
              {maps.map((map) => (
                <option key={map.id} value={map.id}>
                  {map.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setKappaOnly((v) => !v)}
              title="Only tasks required for Kappa"
              className={cx(
                "stencil cursor-pointer border px-3 py-1.5 text-[10px] transition-colors",
                kappaOnly
                  ? "border-amber bg-amber/15 text-amber"
                  : "border-line-bright text-muted hover:text-bone-dim",
              )}
            >
              κ only
            </button>
          </div>
        </div>
      </Panel>

      <Panel className="rise" style={{ animationDelay: "60ms" }}>
        <PanelHeader
          title={mapId ? `Tasks · ${maps.find((m) => m.id === mapId)?.name}` : "Tasks"}
          meta={`${visible.length} of ${tasks.length}`}
        />
        {visible.length === 0 ? (
          <EmptyNote>Nothing matches those filters.</EmptyNote>
        ) : (
          <ul>
            {visible.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                state={states.get(task.id)}
                availability={availability.get(task.id)}
                mapId={mapId || undefined}
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
