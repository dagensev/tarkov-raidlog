"use client";

import { useMemo } from "react";

import { computeAvailability, type TaskAvailability } from "@/lib/graph/availability";
import { buildTaskGraph } from "@/lib/graph/task-graph";
import { deriveTaskStates, summarize, type TaskState } from "@/lib/logs/progress";
import type { ProfileGeneration } from "@/lib/logs/wipe";
import { intelligenceCenterLevel } from "@/lib/sell/hideout-levels";
import { buildKeepList, type KeepList } from "@/lib/sell/keep-list";
import { catalogueRows, type PriceContext, type SellRow } from "@/lib/sell/verdict";
import { DEFAULT_FLEA_RATES, denormalize, type SellIndex } from "@/lib/tarkovdev/client";
import type { EconomyBundle, HideoutStation } from "@/lib/tarkovdev/economy";
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
const EMPTY_KEEP: KeepList = new Map();
const EMPTY_ROWS: SellRow[] = [];
const EMPTY_STATIONS: HideoutStation[] = [];

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
  const traderLevels = useAppStore((s) => s.settings.traderLevels);

  return useMemo(
    () => computeAvailability(tasks, states, { traderLevels }),
    [tasks, states, traderLevels],
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

/**
 * Hideout, barter and craft data, once it matches the loaded task set.
 *
 * The mode check matters because only one copy of each document is cached: switching to
 * PvE refetches everything, and until it lands the cached copy belongs to the mode you
 * just left. Serving that would put regular-mode barters on a PvE sell check.
 */
export function useEconomy(): EconomyBundle | null {
  const economy = useAppStore((s) => s.economy);
  const mode = useGameMode();
  return economy && economy.mode === mode ? economy : null;
}

export function useSellIndex(): SellIndex | null {
  const index = useAppStore((s) => s.sellIndex);
  const mode = useGameMode();
  return index && index.mode === mode ? index : null;
}

/** Trader id to name, for labelling the barters that want an item. */
export function useTraderNames(): ReadonlyMap<string, string> {
  const data = useTarkovData();
  return useMemo(
    () => new Map((data?.traders ?? []).map((trader) => [trader.id, trader.name])),
    [data],
  );
}

/** What still wants each item, and why. Empty until the economy documents arrive. */
export function useKeepList(): KeepList {
  const tasks = useTasks();
  const taskStates = useTaskStates();
  const economy = useEconomy();
  const hideoutLevels = useAppStore((s) => s.settings.hideoutLevels);
  const traderLevels = useAppStore((s) => s.settings.traderLevels);
  const traderNames = useTraderNames();

  return useMemo(
    () =>
      economy
        ? buildKeepList({ tasks, taskStates, economy, hideoutLevels, traderLevels, traderNames })
        : EMPTY_KEEP,
    [tasks, taskStates, economy, hideoutLevels, traderLevels, traderNames],
  );
}

/**
 * What the flea tab needs to price a row: the fee rates and the hideout that discounts them.
 *
 * Its own hook so the context object has a stable identity across renders — `useSellRows`
 * memoizes on it, and a fresh object each render would rebuild all 4835 rows on every
 * keystroke in the search box.
 */
export function usePriceContext(): PriceContext {
  const index = useSellIndex();
  const economy = useEconomy();
  const traderNames = useTraderNames();
  const hideoutLevels = useAppStore((s) => s.settings.hideoutLevels);

  const rates = index?.fleaMarket ?? DEFAULT_FLEA_RATES;
  const stations = economy?.stations ?? EMPTY_STATIONS;

  return useMemo(
    () => ({
      rates,
      traderNames,
      intelligenceCenter: intelligenceCenterLevel(hideoutLevels, stations),
    }),
    [rates, traderNames, hideoutLevels, stations],
  );
}

/**
 * The rows the flea tab renders: one per item in the catalogue.
 *
 * The sell check built these from the keep list, so the only items that ever reached the
 * screen were ones something already wanted, and an item nobody wanted could be found only
 * by typing its name. Every narrowing now happens in `filterRows` over the whole table
 * instead, which is what makes the filter chips and the column sorts mean anything.
 *
 * Building all 4835 once per catalogue load is cheap; re-filtering them per keystroke is
 * cheaper still, which is why the query is not a dependency here.
 */
export function useSellRows(): SellRow[] {
  const keep = useKeepList();
  const index = useSellIndex();
  const context = usePriceContext();

  return useMemo(
    () => (index ? catalogueRows(index, keep, context) : EMPTY_ROWS),
    [keep, index, context],
  );
}
