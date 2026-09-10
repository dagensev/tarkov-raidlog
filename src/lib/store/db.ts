import { openDB, type IDBPDatabase } from "idb";

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

export async function loadSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await get("settings")) ?? {}) };
}

/** How long a cached bundle is considered fresh. */
export const BUNDLE_TTL_MS = 24 * 60 * 60 * 1000;

/** One rule for all three cached documents; each stamps the same `fetchedAt`. */
export function isStale(document: { fetchedAt: number } | undefined): boolean {
  return !document || Date.now() - document.fetchedAt > BUNDLE_TTL_MS;
}
