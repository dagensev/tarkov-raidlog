"use client";

import { useMemo } from "react";

import { craftRows, type CraftRow } from "@/lib/crafts/craft-row";
import { FUEL_TANKS, fuelRoublesPerHour, solarPowerBuilt } from "@/lib/crafts/fuel";
import { fleaPrice, type MarketContext } from "@/lib/crafts/pricing";
import { craftUnlockIndex } from "@/lib/crafts/unlocks";
import { computeAvailability, type TaskAvailability } from "@/lib/graph/availability";
import { buildTaskGraph } from "@/lib/graph/task-graph";
import { deriveTaskStates, summarize, type TaskState } from "@/lib/logs/progress";
import type { ProfileGeneration } from "@/lib/logs/wipe";
import { intelligenceCenterLevel } from "@/lib/sell/hideout-levels";
import { buildKeepList, type KeepList } from "@/lib/sell/keep-list";
import { catalogueRows, type PriceContext, type SellRow } from "@/lib/sell/verdict";
import {
  DEFAULT_FLEA_RATES,
  SELL_INDEX_VERSION,
  denormalize,
  type SellIndex,
} from "@/lib/tarkovdev/client";
import {
  ECONOMY_BUNDLE_VERSION,
  type EconomyBundle,
  type HideoutStation,
} from "@/lib/tarkovdev/economy";
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
const EMPTY_CRAFT_ROWS: CraftRow[] = [];
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
  const wipe = useSelectedWipe();

  return useMemo(
    () =>
      deriveTaskStates(events, {
        folders: wipe ? new Set(wipe.folders) : undefined,
      }),
    [events, wipe],
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

/**
 * The map the logs point at, ignoring any manual override.
 *
 * Its own hook because the picker has to name what detection found even while an override
 * is in force — that is the whole content of its first option.
 */
export function useDetectedMap(): GameMap | undefined {
  const maps = useMaps();
  const scene = useAppStore((s) => s.raid.scene);
  const location = useAppStore((s) => s.raid.location);

  return useMemo(() => {
    if (maps.length === 0 || (!scene && !location)) return undefined;
    return resolveMap(maps, { scene, location });
  }, [maps, scene, location]);
}

/** The map we believe you are on, honouring a manual override. */
export function useCurrentMap(): GameMap | undefined {
  const maps = useMaps();
  const override = useAppStore((s) => s.settings.mapOverride);
  const detected = useDetectedMap();

  return useMemo(() => {
    if (override) {
      const chosen = maps.find((m) => m.id === override);
      if (chosen) return chosen;
    }
    return detected;
  }, [maps, override, detected]);
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
    const { finished, started, failed, unmatched } = summarize(states, known);
    return {
      finished,
      started,
      failed,
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
 * Two gates, for the same reason. Only one copy of each document is cached, so switching
 * to PvE refetches everything and until it lands the cached copy belongs to the mode you
 * just left — serving that would put regular-mode barters on a PvE sell check. And a cache
 * lives an hour or a day, so after a release that changed the entry shape the copy on disk
 * is the old shape; serving that hands today's components yesterday's fields.
 * `catalogueBehind` already knows to refetch in both cases, and these two are what stop the page rendering
 * from the wrong copy while it does.
 */
export function useEconomy(): EconomyBundle | null {
  const economy = useAppStore((s) => s.economy);
  const mode = useGameMode();
  if (!economy) return null;
  return economy.mode === mode && economy.version === ECONOMY_BUNDLE_VERSION ? economy : null;
}

export function useSellIndex(): SellIndex | null {
  const index = useAppStore((s) => s.sellIndex);
  const mode = useGameMode();
  if (!index) return null;
  return index.mode === mode && index.version === SELL_INDEX_VERSION ? index : null;
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

  const hideoutManagement = useAppStore((s) => s.settings.hideoutManagement);

  const rates = index?.fleaMarket ?? DEFAULT_FLEA_RATES;
  const stations = economy?.stations ?? EMPTY_STATIONS;

  return useMemo(
    () => ({
      rates,
      traderNames,
      intelligenceCenter: intelligenceCenterLevel(hideoutLevels, stations),
      hideoutManagement,
    }),
    [rates, traderNames, hideoutLevels, stations, hideoutManagement],
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

/**
 * What an hour of generator time costs, and where the figure came from.
 *
 * Derived from the chosen tank's own flea price unless the reader has typed a number,
 * which is the escape hatch for everything the derivation leaves out — the Hideout
 * Management reduction chiefly. `derived` is the untouched figure, so the field can show
 * what it is overriding rather than merely accepting a number in place of one.
 */
export function useFuelCost(): {
  roublesPerHour: number | null;
  derived: number | null;
  overridden: boolean;
  tank: (typeof FUEL_TANKS)[number];
  tankPrice: number | null;
  solarPower: boolean;
} {
  const index = useSellIndex();
  const economy = useEconomy();
  const hideoutLevels = useAppStore((s) => s.settings.hideoutLevels);
  const tankId = useAppStore((s) => s.settings.fuelTankId);
  const override = useAppStore((s) => s.settings.fuelRoublesPerHour);
  const basis = useAppStore((s) => s.settings.craftFleaBasis);

  const stations = economy?.stations ?? EMPTY_STATIONS;

  return useMemo(() => {
    const tank = FUEL_TANKS.find((each) => each.itemId === tankId) ?? FUEL_TANKS[0];
    const item = index?.items[tank.itemId] ?? null;
    // The tank is bought like any other ingredient, so it is priced on the same basis the
    // ingredients are. Using the average here and the last low there would make the fuel
    // line disagree with the rest of the row for no reason the reader could see.
    const tankPrice = item ? fleaPrice(item, basis) : null;
    const solarPower = solarPowerBuilt(hideoutLevels, stations);
    const derived = fuelRoublesPerHour({
      tankPrice,
      tankUnits: item?.resourceUnits,
      solarPower,
    });
    const overridden = typeof override === "number" && override >= 0;
    return {
      roublesPerHour: overridden ? override : derived,
      derived,
      overridden,
      tank,
      tankPrice,
      solarPower,
    };
  }, [index, stations, hideoutLevels, tankId, override, basis]);
}

/**
 * The rows the crafts calculator renders: one per craft.
 *
 * Built once per data or assumption change, then filtered per keystroke, exactly as
 * `useSellRows` is — and for the same reason. Pricing 213 crafts walks a few hundred
 * ingredients through the catalogue, which is cheap once and wasteful on every character
 * typed into the search box.
 */
export function useCraftRows(): CraftRow[] {
  const economy = useEconomy();
  const index = useSellIndex();
  const traderNames = useTraderNames();
  const price = usePriceContext();
  const fuel = useFuelCost();

  const bundle = useAppStore((s) => s.bundle);
  const events = useAppStore((s) => s.events);
  const taskStates = useTaskStates();
  // Off the raw tasks the core bundle already caches whole, so recovering a dropped gate
  // costs no fetch. Keyed on the bundle alone, which changes once a day.
  const craftUnlocks = useMemo(() => craftUnlockIndex(bundle?.tasks ?? {}), [bundle]);
  // No events means no logs, and with no logs the page cannot say a task is unfinished —
  // which is a different thing from knowing that it is.
  const knownTaskStates = events.length > 0 ? taskStates : null;

  const hideoutLevels = useAppStore((s) => s.settings.hideoutLevels);
  const traderLevels = useAppStore((s) => s.settings.traderLevels);
  const inputSource = useAppStore((s) => s.settings.craftInputSource);
  const outputSource = useAppStore((s) => s.settings.craftOutputSource);
  const basis = useAppStore((s) => s.settings.craftFleaBasis);
  const respectLoyalty = useAppStore((s) => s.settings.craftRespectLoyalty);
  const includeFuel = useAppStore((s) => s.settings.craftIncludeFuel);
  const craftingSkill = useAppStore((s) => s.settings.craftingSkill);

  const market: MarketContext = useMemo(
    () => ({
      rates: price.rates,
      traderNames,
      // Null rather than an empty record: the two mean different things here. A record
      // says "check these levels", where a missing trader reads as level 1; null says
      // "loyalty is not part of the question", and every offer counts.
      traderLevels: respectLoyalty ? traderLevels : null,
      basis,
      intelligenceCenter: price.intelligenceCenter,
      hideoutManagement: price.hideoutManagement,
    }),
    [price, traderNames, traderLevels, respectLoyalty, basis],
  );

  return useMemo(() => {
    if (!economy || !index) return EMPTY_CRAFT_ROWS;
    return craftRows(economy.crafts, economy.stations, index, {
      market,
      inputSource,
      outputSource,
      craftingSkill,
      fuelRoublesPerHour: includeFuel ? fuel.roublesPerHour : null,
      hideoutLevels,
      craftUnlocks,
      taskStates: knownTaskStates,
    });
  }, [
    craftUnlocks,
    knownTaskStates,
    economy,
    index,
    market,
    inputSource,
    outputSource,
    craftingSkill,
    includeFuel,
    fuel.roublesPerHour,
    hideoutLevels,
  ]);
}

/** The stations that actually have crafts, for the filter chips. */
export function useCraftStations(): HideoutStation[] {
  const economy = useEconomy();
  return useMemo(() => {
    if (!economy) return EMPTY_STATIONS;
    const used = new Set(economy.crafts.map((craft) => craft.stationId));
    return economy.stations.filter((station) => used.has(station.id));
  }, [economy]);
}
