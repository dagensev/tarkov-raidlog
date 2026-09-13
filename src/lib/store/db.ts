import { openDB, type IDBPDatabase } from "idb";

import { DEFAULT_FUEL_TANK_ID } from "@/lib/crafts/fuel";
import { MARKET_KINDS, type FleaBasis, type RouteKind } from "@/lib/crafts/pricing";
import type { LogEvent } from "@/lib/logs/events";
import type { CoreBundle, ItemIndex, SellIndex } from "@/lib/tarkovdev/client";
import type { EconomyBundle } from "@/lib/tarkovdev/economy";
import type { GameMode } from "@/lib/tarkovdev/endpoints";

/**
 * Local persistence.
 *
 * One key-value store rather than a schema of typed stores: the whole dataset is small
 * (a real 10-month log history parses to ~1,350 events) and nothing needs indexed
 * queries, so a table per concept would be structure without payoff.
 *
 * A `FileSystemDirectoryHandle` is structured-cloneable, which is what lets the granted
 * log directory survive a reload — the one piece of state that genuinely cannot be
 * rebuilt from anything else.
 */

const DB_NAME = "tarkov-raidlog";
const DB_VERSION = 1;
const STORE = "kv";

export interface Settings {
  /** Trader loyalty by trader id. Partial, and treated as "unverified" where missing. */
  traderLevels: Record<string, number>;
  /**
   * Built hideout level by station id. The logs never mention the hideout, so this is the
   * only source there is.
   *
   * A missing station means "not told", which the sell check treats as "you might still
   * need it". An explicit 0 means "not built", which is a different thing: it keeps the
   * station's own upgrades on the keep list while dropping the crafts you cannot run.
   */
  hideoutLevels: Record<string, number>;
  /**
   * Character level, typed on the sell check, where it hides items the flea will not let
   * you list yet. The logs never state it. Null means "do not filter on it".
   */
  playerLevel: number | null;
  /** Profile generation id chosen as the current wipe, or null to use auto-detection. */
  wipeId: string | null;
  /** Map chosen by hand, overriding detection. */
  mapOverride: string | null;
  /** Game mode chosen by hand, or null to take it from the logs' `Session mode:`. */
  gameMode: GameMode | null;
  /** Poll interval while the game is running, in ms. */
  pollIntervalMs: number;
  /** Whether objective pins are drawn on the raid map. */
  showObjectivePins: boolean;

  // --- character skills -------------------------------------------------------------
  // Neither is in the logs and neither is in tarkov.dev's data, so both are typed by
  // hand and both default to zero, which is the reading that flatters nothing.

  /** Crafting, which takes 0.75% off a craft's time per level. */
  craftingSkill: number;
  /**
   * Hideout Management, which deepens the Intelligence Center's listing fee discount.
   *
   * Read by the flea tab as well as the crafts table — `fleaMarketFee` has always taken
   * it and every caller passed zero until there was a field to type it into.
   */
  hideoutManagement: number;

  // --- how the crafts table prices things ---------------------------------------------
  // Modelling choices rather than browsing ones: retyping them every session would make
  // the table useless, so unlike the filter chips they live here.

  /**
   * How craft ingredients may be got: bought on the flea or from a trader, bartered for, or
   * crafted. The table takes whichever enabled route suits the row best.
   */
  craftBuyFrom: RouteKind[];
  /** How the product may be got rid of, by the same four routes. */
  craftSellTo: RouteKind[];
  /** Which flea figure stands in for the price. */
  craftFleaBasis: FleaBasis;
  /** Whether a trader offer above your recorded loyalty counts as a price you can pay. */
  craftRespectLoyalty: boolean;
  /** Whether generator fuel is charged against a craft's profit. */
  craftIncludeFuel: boolean;
  /** Which tank the fuel cost is derived from. */
  fuelTankId: string;
  /**
   * Roubles an hour of generator time costs, overriding the derived figure.
   *
   * Null means derive it. The escape hatch exists because the derivation leaves out the
   * Hideout Management reduction, which is real and which nothing here can model.
   */
  fuelRoublesPerHour: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
  traderLevels: {},
  hideoutLevels: {},
  // The highest requirement any item carries, so the default hides nothing and only
  // lowering it narrows the list.
  playerLevel: 40,
  wipeId: null,
  mapOverride: null,
  gameMode: null,
  pollIntervalMs: 2000,
  showObjectivePins: true,
  craftingSkill: 0,
  hideoutManagement: 0,
  // Markets only. Barter and craft routes are opt-in: they rewrite most rows into chains,
  // which is a lot to take in before you have gone looking for it.
  craftBuyFrom: [...MARKET_KINDS],
  craftSellTo: [...MARKET_KINDS],
  craftFleaBasis: "avg24h",
  craftRespectLoyalty: true,
  craftIncludeFuel: true,
  fuelTankId: DEFAULT_FUEL_TANK_ID,
  fuelRoublesPerHour: null,
};

interface StoredValues {
  logDirectory: FileSystemDirectoryHandle;
  /** The game's `Screenshots` folder. A different root from the logs, so it is picked apart. */
  screenshotDirectory: FileSystemDirectoryHandle;
  events: LogEvent[];
  settings: Settings;
  /** Trimmed API documents, keyed by nothing — one bundle per game mode at a time. */
  tarkovBundle: CoreBundle;
  /** Names for the handful of items tasks reference. Loaded after the core bundle. */
  itemIndex: ItemIndex;
  /** Hideout stations, barters and crafts — the things that consume stash items. */
  economyBundle: EconomyBundle;
  /**
   * Prices and footprints for every item. Kept apart from `itemIndex` so the task list's
   * thin refs, and their cache entry, are untouched by the sell check.
   */
  sellIndex: SellIndex;
  /** Squad you are currently in, if any. The token is also the invite. */
  squadToken: string;
  /** Who you appear as to squadmates. Random id, typed nickname. */
  squadIdentity: { id: string; name: string };
}

type StoredKey = keyof StoredValues;

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
      },
    });
  }
  return dbPromise;
}

export async function get<K extends StoredKey>(key: K): Promise<StoredValues[K] | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  return (await db()).get(STORE, key) as Promise<StoredValues[K] | undefined>;
}

export async function set<K extends StoredKey>(key: K, value: StoredValues[K]): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await (await db()).put(STORE, value, key);
}

export async function remove(key: StoredKey): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await (await db()).delete(STORE, key);
}

/**
 * The two single-choice fields the crafts table had before barters and crafts were routes.
 *
 * Read once, on load, so a reader who had narrowed the table to one market keeps that
 * choice. Barter and craft stay off, as they are for everyone else until turned on.
 */
interface LegacySettings {
  craftInputSource?: "cheapest" | "flea" | "trader";
  craftOutputSource?: "best" | "flea" | "trader";
}

function migrateSources(single: string | undefined): RouteKind[] | undefined {
  if (single === "flea" || single === "trader") return [single];
  return single === undefined ? undefined : [...MARKET_KINDS];
}

export async function loadSettings(): Promise<Settings> {
  const stored: Partial<Settings> & LegacySettings = (await get("settings")) ?? {};
  const { craftInputSource, craftOutputSource, ...rest } = stored;
  return {
    ...DEFAULT_SETTINGS,
    craftBuyFrom: migrateSources(craftInputSource) ?? DEFAULT_SETTINGS.craftBuyFrom,
    craftSellTo: migrateSources(craftOutputSource) ?? DEFAULT_SETTINGS.craftSellTo,
    ...rest,
  };
}

/** How long a cached bundle is considered fresh: tasks, maps, traders, hideout and crafts. */
export const BUNDLE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How long the item catalogue is considered fresh, which is how old a price may get.
 *
 * Shorter than the rest because it is the one document that moves by the minute — its
 * `Last-Modified` trails the request by a couple of minutes, where crafts' is days old —
 * and a flea verdict or a craft's profit is only as good as the price under it.
 */
export const PRICES_TTL_MS = 60 * 60 * 1000;

/** One rule for every cached document; each stamps its own `fetchedAt`. */
export function isStale(
  document: { fetchedAt: number } | undefined,
  ttlMs: number = BUNDLE_TTL_MS,
): boolean {
  return !document || Date.now() - document.fetchedAt > ttlMs;
}
