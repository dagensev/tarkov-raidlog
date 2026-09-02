import { openDB, type IDBPDatabase } from "idb";

import type { LogEvent } from "@/lib/logs/events";
import type { TaskStatus } from "@/lib/logs/progress";
import type { TarkovData } from "@/lib/tarkovdev/types";
import type { Faction } from "@/lib/graph/availability";

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
  /** Not derivable from the logs; the user sets it. */
  playerLevel: number;
  faction: Faction;
  /** Trader loyalty by trader id. Partial, and treated as "unverified" where missing. */
  traderLevels: Record<string, number>;
  /** Profile generation id chosen as the current wipe, or null to use auto-detection. */
  wipeId: string | null;
  /** Map chosen by hand, overriding detection. */
  mapOverride: string | null;
  /** Poll interval while the game is running, in ms. */
  pollIntervalMs: number;
}

export const DEFAULT_SETTINGS: Settings = {
  playerLevel: 1,
  faction: "USEC",
  traderLevels: {},
  wipeId: null,
  mapOverride: null,
  pollIntervalMs: 2000,
};

interface StoredValues {
  logDirectory: FileSystemDirectoryHandle;
  events: LogEvent[];
  settings: Settings;
  manualTasks: Record<string, TaskStatus>;
  tarkovData: TarkovData;
  tarkovDataFetchedAt: number;
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

/** How long cached tarkov.dev data is considered fresh. */
export const TARKOV_DATA_TTL_MS = 24 * 60 * 60 * 1000;

export interface CachedTarkovData {
  data: TarkovData;
  fetchedAt: number;
  stale: boolean;
}

/**
 * Read cached game data.
 *
 * Returns stale data rather than nothing when the cache is past its TTL: the API is a
 * free community service that does go down, and yesterday's task list beats an empty
 * screen. The caller decides whether to try refreshing.
 */
export async function loadCachedTarkovData(): Promise<CachedTarkovData | null> {
  const [data, fetchedAt] = await Promise.all([get("tarkovData"), get("tarkovDataFetchedAt")]);
  if (!data) return null;
  const at = fetchedAt ?? 0;
  return { data, fetchedAt: at, stale: Date.now() - at > TARKOV_DATA_TTL_MS };
}

export async function saveTarkovData(data: TarkovData): Promise<void> {
  await Promise.all([set("tarkovData", data), set("tarkovDataFetchedAt", Date.now())]);
}
