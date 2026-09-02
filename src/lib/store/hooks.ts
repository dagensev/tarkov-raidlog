"use client";

import { useMemo } from "react";

import { computeAvailability, type TaskAvailability } from "@/lib/graph/availability";
import { buildTaskGraph } from "@/lib/graph/task-graph";
import { deriveTaskStates, type TaskState } from "@/lib/logs/progress";
import type { ProfileGeneration } from "@/lib/logs/wipe";
import { denormalize } from "@/lib/tarkovdev/client";
import { resolveMap } from "@/lib/tarkovdev/maps";
import type { GameMap, TarkovData, Task } from "@/lib/tarkovdev/types";
import { resolveGameMode, useAppStore } from "./app-store";

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

/** Counts for the overview board. */
export function useProgressCounts() {
  const states = useTaskStates();
  const availability = useAvailability();
  const total = useTasks().length;

  return useMemo(() => {
    let finished = 0;
    let started = 0;
    let manual = 0;
    for (const state of states.values()) {
      if (state.status === "finished") finished += 1;
      if (state.status === "started") started += 1;
      if (state.origin === "manual") manual += 1;
    }
    let available = 0;
    let locked = 0;
    for (const entry of availability.values()) {
      if (entry.status === "available") available += 1;
      if (entry.status === "locked") locked += 1;
    }
    return { finished, started, manual, available, locked, total };
  }, [states, availability, total]);
}
