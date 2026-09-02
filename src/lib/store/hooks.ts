"use client";

import { useMemo } from "react";

import { computeAvailability, type TaskAvailability } from "@/lib/graph/availability";
import { buildTaskGraph } from "@/lib/graph/task-graph";
import { deriveTaskStates, summarize, type TaskState } from "@/lib/logs/progress";
import type { ProfileGeneration } from "@/lib/logs/wipe";
import { denormalize } from "@/lib/tarkovdev/client";
import { mapsWithTasks, resolveMap } from "@/lib/tarkovdev/maps";
import type { GameMap, TarkovData, Task } from "@/lib/tarkovdev/types";
import { isRaidActive, resolveGameMode, useAppStore } from "./app-store";

/**
 * Derived views over the store.
 *
 * These are hooks with `useMemo` rather than zustand selectors because the results are
 * fresh objects every call. As a selector, a new Map would fail zustand's identity check
 * and re-render on every unrelated store change — and recompute availability across five
 * hundred tasks each time.
 */

const EMPTY_TASKS: Task[] = [];
const EMPTY_MAPS: GameMap[] = [];

/**
 * The API's normalized documents, reshaped into nested objects.
 *
 * Memoized on the two cached inputs, so the reshaping happens once per data refresh
 * rather than once per render.
 */
export function useTarkovData(): TarkovData | null {
  const bundle = useAppStore((s) => s.bundle);
  const itemIndex = useAppStore((s) => s.itemIndex);
  return useMemo(
    () => (bundle ? denormalize(bundle, itemIndex ?? undefined) : null),
    [bundle, itemIndex],
  );
}

export function useTasks(): Task[] {
  return useTarkovData()?.tasks ?? EMPTY_TASKS;
}

export function useMaps(): GameMap[] {
  return useTarkovData()?.maps ?? EMPTY_MAPS;
}

/**
 * Maps worth offering in a picker — those with at least one task assigned to them.
 *
 * Detection can still resolve to a map outside this list; it only narrows what is worth
 * choosing by hand.
 */
export function useMapsWithTasks(): GameMap[] {
  const maps = useMaps();
  const tasks = useTasks();
  return useMemo(() => mapsWithTasks(maps, tasks), [maps, tasks]);
}

/** The game mode in effect: manual choice, else the logs' `Session mode:`, else default. */
export function useGameMode() {
  const settings = useAppStore((s) => s.settings);
  const sessionMode = useAppStore((s) => s.sessionMode);
  return useMemo(() => resolveGameMode({ settings, sessionMode }), [settings, sessionMode]);
}

export function useSelectedWipe(): ProfileGeneration | undefined {
  const wipes = useAppStore((s) => s.wipes);
  const wipeId = useAppStore((s) => s.settings.wipeId);
  return useMemo(() => {
    if (!wipes) return undefined;
    if (wipeId) {
      const chosen = wipes.generations.find((g) => g.id === wipeId);
      if (chosen) return chosen;
    }
    return wipes.current;
  }, [wipes, wipeId]);
}

export function useTaskStates(): Map<string, TaskState> {
  const events = useAppStore((s) => s.events);
  const manual = useAppStore((s) => s.manualTasks);
  const wipe = useSelectedWipe();

  return useMemo(
    () =>
      deriveTaskStates(events, {
        folders: wipe ? new Set(wipe.folders) : undefined,
        manual,
      }),
    [events, manual, wipe],
  );
}

export function useAvailability(): Map<string, TaskAvailability> {
  const tasks = useTasks();
  const states = useTaskStates();
  const level = useAppStore((s) => s.settings.playerLevel);
  const faction = useAppStore((s) => s.settings.faction);
  const traderLevels = useAppStore((s) => s.settings.traderLevels);

  return useMemo(
    () => computeAvailability(tasks, states, { level, faction, traderLevels }),
    [tasks, states, level, faction, traderLevels],
  );
}

export function useTaskGraph() {
  const tasks = useTasks();
  return useMemo(() => buildTaskGraph(tasks), [tasks]);
}

/** The map we believe you are on, honouring a manual override. */
export function useCurrentMap(): GameMap | undefined {
  const maps = useMaps();
  const override = useAppStore((s) => s.settings.mapOverride);
  const scene = useAppStore((s) => s.raid.scene);
  const location = useAppStore((s) => s.raid.location);

  return useMemo(() => {
    if (maps.length === 0) return undefined;
    if (override) {
      const chosen = maps.find((m) => m.id === override);
      if (chosen) return chosen;
    }
    if (!scene && !location) return undefined;
    return resolveMap(maps, { scene, location });
  }, [maps, override, scene, location]);
}

/**
 * Whether a raid is happening now, not merely the last thing the logs described.
 *
 * Re-evaluated on every store change rather than on a timer: after a scan of old logs
 * the window has long passed, which is the case that matters.
 */
export function useRaidActive(): boolean {
  const raid = useAppStore((s) => s.raid);
  return useMemo(() => isRaidActive(raid), [raid]);
}

/**
 * Counts for the overview board.
 *
 * Restricted to tasks the loaded dataset contains, so these agree with the task list.
 * Completions of quests tarkov.dev no longer publishes are reported as `unmatched`
 * instead of quietly inflating the total past what the list can show.
 */
export function useProgressCounts() {
  const states = useTaskStates();
  const tasks = useTasks();

  return useMemo(() => {
    const known = new Set(tasks.map((task) => task.id));
    const { finished, started, failed, manual, unmatched } = summarize(states, known);
    return {
      finished,
      started,
      failed,
      manual,
      unmatched,
      // Everything the logs have never mentioned. Counted by subtraction rather than by
      // asking whether a task is "available", which is not reliably knowable.
      notStarted: Math.max(0, tasks.length - finished - started - failed),
      total: tasks.length,
    };
  }, [states, tasks]);
}
