"use client";

import { useMemo, useState } from "react";

import { TaskRow } from "@/components/task-row";
import { EmptyNote, Panel, PanelHeader, cx } from "@/components/ui";
import { useAvailability, useMaps, useTaskStates, useTasks } from "@/lib/store/hooks";

type Filter = "todo" | "available" | "started" | "finished" | "locked" | "all";

/**
 * `todo` is the union of ready and in-progress — everything you could act on. It is
 * named separately from both so no label describes two different sets.
 */
const FILTERS: Array<{ id: Filter; label: string; title: string }> = [
  { id: "todo", label: "To do", title: "Ready to pick up, plus what you are already holding" },
  { id: "available", label: "Ready", title: "Nothing is blocking these — go pick them up" },
  { id: "started", label: "In progress", title: "Already accepted, not yet handed in" },
  { id: "finished", label: "Done", title: "Completed this wipe" },
  { id: "locked", label: "Locked", title: "Something is unmet — open a task to see what" },
  { id: "all", label: "All", title: "Every task in the game" },
];

export default function TasksPage() {
  const tasks = useTasks();
  const states = useTaskStates();
  const availability = useAvailability();
  const maps = useMaps();

  const [filter, setFilter] = useState<Filter>("todo");
  const [query, setQuery] = useState("");
  const [mapId, setMapId] = useState<string>("");
  const [kappaOnly, setKappaOnly] = useState(false);

  const counts = useMemo<Record<Filter, number>>(() => {
    const tally = { available: 0, started: 0, finished: 0, locked: 0, failed: 0 };
    for (const entry of availability.values()) {
      if (entry.status in tally) tally[entry.status as keyof typeof tally] += 1;
    }
    return {
      available: tally.available,
      started: tally.started,
      finished: tally.finished,
      locked: tally.locked,
      todo: tally.available + tally.started,
      all: availability.size,
    };
  }, [availability]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tasks
      .filter((task) => {
        const status = availability.get(task.id)?.status ?? "available";
        if (filter === "todo" && status !== "available" && status !== "started") return false;
        if (filter !== "todo" && filter !== "all" && status !== filter) return false;
        if (kappaOnly && !task.kappaRequired) return false;
        if (mapId) {
          const onMap =
            task.map?.id === mapId ||
            task.objectives.some((o) => o.maps.some((m) => m.id === mapId)) ||
            task.neededKeys.some((k) => k.map?.id === mapId);
          if (!onMap) return false;
        }
        if (needle && !task.name.toLowerCase().includes(needle)) {
          const trader = task.trader?.name.toLowerCase() ?? "";
          if (!trader.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        // Ready before in-progress, then by trader so a run is grouped by who to hand in to.
        const rank = (id: string) => (availability.get(id)?.status === "started" ? 0 : 1);
        return (
          rank(a.id) - rank(b.id) ||
          (a.trader?.name ?? "").localeCompare(b.trader?.name ?? "") ||
          a.name.localeCompare(b.name)
        );
      });
  }, [tasks, availability, filter, query, mapId, kappaOnly]);

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
