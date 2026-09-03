"use client";

import { useMemo, useState } from "react";

import { ConnectLogs } from "@/components/connect-logs";
import { TaskRow, rowStatus } from "@/components/task-row";
import { EmptyNote, Panel, PanelHeader, cx } from "@/components/ui";
import {
  useAvailability,
  useMapsWithTasks,
  useTaskStates,
  useTasks,
} from "@/lib/store/hooks";
import { useInSquad, useSquadHoldingCounts } from "@/lib/store/squad-hooks";
import { taskIsOnMap } from "@/lib/tarkovdev/maps";
import { mapOptions } from "@/lib/tasks/map-options";
import { SORT_MODES, sharedWithSquad, sortTasks, type SortMode } from "@/lib/tasks/sort";

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
  const pickableMaps = useMapsWithTasks();
  const squadHolders = useSquadHoldingCounts();
  const inSquad = useInSquad();

  const [filter, setFilter] = useState<Filter>("started");
  const [query, setQuery] = useState("");
  const [mapId, setMapId] = useState<string>("");
  const [kappaOnly, setKappaOnly] = useState(false);
  const [sort, setSort] = useState<SortMode>("progress");

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

  /** Everything passing the filters *except* the map, which the map options derive from. */
  const beforeMapFilter = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tasks.filter((task) => {
      const status = rowStatus(states.get(task.id));
      if (filter !== "all" && status !== filter) return false;
      if (kappaOnly && !task.kappaRequired) return false;
      if (needle) {
        const name = task.name.toLowerCase();
        const trader = task.trader?.name.toLowerCase() ?? "";
        if (!name.includes(needle) && !trader.includes(needle)) return false;
      }
      return true;
    });
  }, [tasks, states, filter, query, kappaOnly]);

  /**
   * Maps that still have something to show under the current filters, with a count.
   *
   * Derived from the already-filtered tasks so that picking any option always lands on
   * at least one task — filter to In progress and you are offered only the maps you have
   * something running on.
   */
  const options = useMemo(
    () => mapOptions(pickableMaps, beforeMapFilter),
    [pickableMaps, beforeMapFilter],
  );

  // A map chosen under one filter may have nothing under the next. Ignore it rather than
  // showing an empty list against a stale selection; it reapplies if the filter comes back.
  const activeMapId = options.some((o) => o.map.id === mapId) ? mapId : "";

  // Sorting by what your squad is on says nothing while you are alone, so that option is
  // offered only in a squad — and a selection left over from one is dropped, exactly as a
  // stale map selection is.
  const sortModes = useMemo(
    () => SORT_MODES.filter((mode) => mode.id !== "squad" || inSquad),
    [inSquad],
  );
  const activeSort = sortModes.some((mode) => mode.id === sort) ? sort : "progress";
  const sortInputs = useMemo(() => ({ states, squadHolders }), [states, squadHolders]);

  const matching = useMemo(
    () =>
      activeMapId
        ? beforeMapFilter.filter((task) => taskIsOnMap(task, activeMapId))
        : beforeMapFilter,
    [beforeMapFilter, activeMapId],
  );

  const visible = useMemo(
    () => sortTasks(matching, activeSort, sortInputs),
    [matching, activeSort, sortInputs],
  );

  /** How many of the tasks on screen a squadmate is holding too. */
  const sharedCount = useMemo(
    () => matching.reduce((n, task) => n + (sharedWithSquad(task.id, sortInputs) ? 1 : 0), 0),
    [matching, sortInputs],
  );

  if (tasks.length === 0) {
    return (
      <div className="space-y-4">
        <ConnectLogs />
        <Panel>
          <PanelHeader title="Tasks" meta="no game data" />
          <EmptyNote>
            Task data comes from tarkov.dev and has not loaded yet. Your log history is safe
            either way.
          </EmptyNote>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/*
        The landing page, so it carries the one thing that has to happen before anything
        works. Renders nothing once a folder is connected.
      */}
      <ConnectLogs />
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
              value={activeMapId}
              onChange={(e) => setMapId(e.target.value)}
              title="Only maps with something to show under the current filters"
              className="data border border-line-bright bg-ground-2 px-2 py-1.5 text-[12px] text-bone focus:border-amber-dim focus:outline-none"
            >
              <option value="">Any map ({beforeMapFilter.length})</option>
              {options.map(({ map, count }) => (
                <option key={map.id} value={map.id}>
                  {map.name} ({count})
                </option>
              ))}
            </select>
            <select
              value={activeSort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              aria-label="Sort order"
              title={sortModes.find((mode) => mode.id === activeSort)?.title}
              className="data border border-line-bright bg-ground-2 px-2 py-1.5 text-[12px] text-bone focus:border-amber-dim focus:outline-none"
            >
              {sortModes.map((mode) => (
                <option key={mode.id} value={mode.id} title={mode.title}>
                  {/* The squad option carries its count, since "none right now" is the
                      answer often enough to be worth seeing before you pick it. */}
                  {mode.id === "squad" ? `${mode.label} (${sharedCount})` : mode.label}
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
          title={
            activeMapId
              ? `Tasks · ${options.find((o) => o.map.id === activeMapId)?.map.name}`
              : "Tasks"
          }
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
                mapId={activeMapId || undefined}
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
