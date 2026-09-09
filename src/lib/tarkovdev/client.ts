import {
  DEFAULT_LANGUAGE,
  endpointPath,
  type EndpointName,
  type GameMode,
} from "./endpoints";
import type {
  RawDocument,
  RawItem,
  RawItemsData,
  RawMap,
  RawMapsData,
  RawTask,
  RawTasksData,
  RawTrader,
  RawTradersData,
  TranslationDictionary,
} from "./raw-types";
import { foldedMapIds } from "./maps";
import type { GameMap, ItemRef, NamedRef, TarkovData, Task, TaskObjective } from "./types";

/** Thrown when the API answers but the answer is not usable. */
export class TarkovDevError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "TarkovDevError";
  }
}

export interface FetchOptions {
  signal?: AbortSignal;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Attempts, including the first. Retries use exponential backoff. */
  attempts?: number;
  /** Base backoff in ms; doubled each retry. */
  backoffMs?: number;
  language?: string;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** GET a JSON document, retrying transient failures. */
export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const { signal, fetchImpl = fetch, attempts = 3, backoffMs = 400 } = options;
  let lastError: TarkovDevError | undefined;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(backoffMs * 2 ** (attempt - 1));

    let response: Response;
    try {
      response = await fetchImpl(url, { headers: { Accept: "application/json" }, signal });
    } catch (cause) {
      if (signal?.aborted) throw cause;
      lastError = new TarkovDevError(`network error: ${(cause as Error).message}`, undefined, true);
      continue;
    }

    // 4xx other than 429 means we asked for the wrong thing; retrying will not help.
    const retryable = response.status === 429 || response.status >= 500;
    if (!response.ok) {
      lastError = new TarkovDevError(`HTTP ${response.status} for ${url}`, response.status, retryable);
      if (!retryable) throw lastError;
      continue;
    }

    try {
      return (await response.json()) as T;
    } catch (cause) {
      lastError = new TarkovDevError(
        `unreadable response from ${url}: ${(cause as Error).message}`,
        response.status,
        true,
      );
    }
  }

  throw lastError ?? new TarkovDevError(`failed to fetch ${url}`);
}

/**
 * GET one API document, or its translation file when `translated`.
 *
 * Every endpoint fetch is these same two lines. Having them in one place is what makes
 * adding hideout, barters and crafts a matter of naming them.
 */
export function fetchEndpoint<T>(
  mode: GameMode,
  name: EndpointName,
  options: FetchOptions = {},
  translated = false,
): Promise<T> {
  const lang = translated ? (options.language ?? DEFAULT_LANGUAGE) : undefined;
  return fetchJson<T>(endpointPath(mode, name, lang), options);
}

/**
 * The documents the app needs, already trimmed.
 *
 * The maps document is ~9.5 MB, almost all of it mobs and loot containers we never read,
 * so it is stripped to per-map metadata before it is returned — and therefore before it
 * reaches the cache.
 */
export interface CoreBundle {
  mode: GameMode;
  tasks: Record<string, RawTask>;
  maps: Record<string, RawMap>;
  traders: Record<string, RawTrader>;
  text: TranslationDictionary;
  fetchedAt: number;
}

/** Drop spawns, extracts, locks, loot and hazards — the bulk of the 9.5 MB. */
function stripMap(map: RawMap): RawMap {
  const {
    id,
    name,
    normalizedName,
    nameId,
    scenePath,
    description,
    wiki,
    enemies,
    raidDuration,
    players,
  } = map;
  return {
    id,
    name,
    normalizedName,
    nameId,
    scenePath,
    description,
    wiki,
    enemies,
    raidDuration,
    players,
  };
}

/**
 * Fetch everything needed to show tasks.
 *
 * Deliberately excludes `items` (~15.8 MB) — the only thing it adds is names for the 58
 * key items tasks reference, so it is loaded separately and merged in when it arrives.
 */
export async function loadCoreBundle(
  mode: GameMode,
  options: FetchOptions = {},
): Promise<CoreBundle> {
  const get = <T>(name: EndpointName, withLang?: boolean) =>
    fetchEndpoint<T>(mode, name, options, withLang);

  const [tasks, tasksText, maps, mapsText, traders, tradersText] = await Promise.all([
    get<RawDocument<RawTasksData>>("tasks"),
    get<RawDocument<TranslationDictionary>>("tasks", true),
    get<RawDocument<RawMapsData>>("maps"),
    get<RawDocument<TranslationDictionary>>("maps", true),
    get<RawDocument<RawTradersData>>("traders"),
    get<RawDocument<TranslationDictionary>>("traders", true),
  ]);

  const strippedMaps: Record<string, RawMap> = {};
  for (const [id, map] of Object.entries(collection<RawMap>(maps.data, "maps"))) {
    strippedMaps[id] = stripMap(map);
  }

  return {
    mode,
    tasks: collection<RawTask>(tasks.data, "tasks"),
    maps: strippedMaps,
    traders: collection<RawTrader>(traders.data, "traders"),
    text: { ...tasksText.data, ...mapsText.data, ...tradersText.data },
    fetchedAt: Date.now(),
  };
}

/**
 * Pull a keyed collection out of a document.
 *
 * The documents are not consistent about this: `tasks` and `maps` nest their collection
 * under a named property alongside siblings (`questItems`, `mobs`), while `traders` keys
 * the trader objects directly off `data`. Reading only the named property silently
 * yielded an empty trader list, which showed up as raw ids in place of names.
 */
export function collection<T>(data: unknown, key: string): Record<string, T> {
  const doc = data as Record<string, unknown> | null | undefined;
  if (!doc) return {};
  const named = doc[key];
  if (named && typeof named === "object") return named as Record<string, T>;
  return doc as Record<string, T>;
}

/** Item ids referenced by tasks — keys, plus objective and marker items. */
export function referencedItemIds(tasks: Record<string, RawTask>): string[] {
  const ids = new Set<string>();
  for (const task of Object.values(tasks)) {
    for (const group of task.neededKeys ?? []) {
      for (const id of group.keys ?? []) ids.add(id);
    }
    for (const objective of task.objectives ?? []) {
      if (objective.item) ids.add(objective.item);
      if (objective.markerItem) ids.add(objective.markerItem);
      for (const alternatives of objective.requiredKeys ?? []) {
        for (const id of alternatives) ids.add(id);
      }
    }
  }
  return [...ids];
}

export type ItemIndex = Record<string, ItemRef>;

/** Prices and footprint for one item — everything the sell check puts on a row. */
export interface SellItem {
  id: string;
  name: string;
  shortName: string | null;
  /** Also the tarkov.dev page: `https://tarkov.dev/item/<normalizedName>`. */
  normalizedName: string;
  /** Grid footprint in stash cells. */
  width: number;
  height: number;
  /** Cannot be listed on the flea market at all, so no flea price means anything. */
  noFlea: boolean;
  /**
   * Character level needed before this can be listed, or 0 for no requirement beyond the
   * flea itself. Every item carries one, including the restricted ones, where it means
   * nothing — read it only when `noFlea` is false.
   */
  minLevelForFlea: number;
  avg24hPrice: number | null;
  lastLowPrice: number | null;
  basePrice: number | null;
  /** The best offer across traders, chosen on roubles. */
  bestTrader: { traderId: string; priceRUB: number } | null;
  wikiLink: string | null;
  /**
   * Only stored when it is not the derivable `assets.tarkov.dev` URL, which covers 5207
   * of 5320 items. Read it through `itemIconLink`, never directly.
   */
  iconLink?: string;
}

/**
 * Bump whenever `SellItem` gains a field the page reads.
 *
 * A cached index is kept for a day, so without this a new field renders blank until the
 * next refresh — present in the code, absent from every existing reader's cache, and
 * indistinguishable from a bug. A mismatch makes the catalogue count as behind.
 */
export const SELL_INDEX_VERSION = 1;

export interface SellIndex {
  mode: GameMode;
  /** Shape of the entries, against `SELL_INDEX_VERSION`. Absent on pre-versioned caches. */
  version?: number;
  /** When the catalogue was downloaded. Prices are only ever as fresh as this. */
  fetchedAt: number;
  /** Every item that can sit in a stash, keyed by id. Presets excluded. */
  items: Record<string, SellItem>;
}

/** The icon URL, derived where it follows the usual pattern. */
export function itemIconLink(item: SellItem): string {
  return item.iconLink ?? `https://assets.tarkov.dev/${item.id}-icon.webp`;
}

/** The tarkov.dev page, which follows `normalizedName` for every item in the catalogue. */
export function itemPageLink(item: SellItem): string {
  return `https://tarkov.dev/item/${item.normalizedName}`;
}

/** Trader offers are quoted in the trader's own currency, so only roubles compare. */
function bestTraderOffer(item: RawItem): { traderId: string; priceRUB: number } | null {
  let best: { traderId: string; priceRUB: number } | null = null;
  for (const offer of item.sellToTrader ?? []) {
    if (!offer?.trader || typeof offer.priceRUB !== "number") continue;
    if (!best || offer.priceRUB > best.priceRUB) {
      best = { traderId: offer.trader, priceRUB: offer.priceRUB };
    }
  }
  return best;
}

/**
 * Both projections of the item catalogue, from one download.
 *
 * The catalogue is 16.7 MB and there is no per-item endpoint, so anything wanting a
 * single item fact pays for all of them. Returning two projections rather than one merged
 * shape leaves the task list's thin `ItemRef` — and its cache entry — exactly as it was:
 * `index` holds names for the handful of key items tasks reference, `sell` holds prices
 * and footprints for everything.
 */
export async function loadItemCatalogue(
  mode: GameMode,
  keyIds: readonly string[],
  options: FetchOptions = {},
): Promise<{ index: ItemIndex; sell: SellIndex }> {
  const [items, text] = await Promise.all([
    fetchEndpoint<RawDocument<RawItemsData>>(mode, "items", options),
    fetchEndpoint<RawDocument<TranslationDictionary>>(mode, "items", options, true),
  ]);

  const wanted = new Set(keyIds);
  const index: ItemIndex = {};
  const sell: Record<string, SellItem> = {};

  for (const [id, item] of Object.entries(collection<RawItem>(items.data, "items"))) {
    const name = text.data[item.name] ?? item.normalizedName ?? id;
    const shortName = text.data[item.shortName] ?? null;

    if (wanted.has(id)) {
      index[id] = {
        id,
        name,
        shortName,
        iconLink: item.iconLink ?? null,
        wikiLink: item.wikiLink ?? null,
      };
    }

    // Presets are tarkov.dev's pre-built gun entries, not things that sit in a stash.
    // Left in they would appear in every weapon search without ever being sellable.
    const types = item.types ?? [];
    if (types.includes("preset")) continue;

    const entry: SellItem = {
      id,
      name,
      shortName,
      normalizedName: item.normalizedName,
      width: item.width ?? 1,
      height: item.height ?? 1,
      noFlea: types.includes("noFlea"),
      minLevelForFlea: item.minLevelForFlea ?? 0,
      avg24hPrice: item.avg24hPrice ?? null,
      lastLowPrice: item.lastLowPrice ?? null,
      basePrice: item.basePrice ?? null,
      bestTrader: bestTraderOffer(item),
      wikiLink: item.wikiLink ?? null,
    };
    const derivable = `https://assets.tarkov.dev/${id}-icon.webp`;
    if (item.iconLink && item.iconLink !== derivable) entry.iconLink = item.iconLink;
    sell[id] = entry;
  }

  return {
    index,
    sell: { mode, version: SELL_INDEX_VERSION, fetchedAt: Date.now(), items: sell },
  };
}

// --- denormalization ---------------------------------------------------------------

function makeResolver(bundle: CoreBundle) {
  const { text } = bundle;
  /** Translation keys resolve through the dictionary; anything else passes through. */
  const t = (key: string | null | undefined, fallback = ""): string =>
    (key ? (text[key] ?? key) : fallback) || fallback;

  // Night Factory is Factory after dark. Rewriting the reference here — rather than
  // filtering the picker — is what keeps its tasks reachable under Factory.
  const folded = foldedMapIds(Object.values(bundle.maps));

  const mapRef = (id: string | null | undefined): NamedRef | null => {
    if (!id) return null;
    const shownAs = folded.get(id) ?? id;
    const map = bundle.maps[shownAs];
    return { id: shownAs, name: map ? t(map.name, map.normalizedName) : shownAs };
  };

  const traderRef = (id: string | null | undefined): NamedRef | null => {
    if (!id) return null;
    const trader = bundle.traders[id];
    return { id, name: trader ? t(trader.name, trader.normalizedName) : id };
  };

  const taskRef = (id: string): NamedRef => {
    const task = bundle.tasks[id];
    return { id, name: task ? t(task.name, task.normalizedName) : id };
  };

  return { t, mapRef, traderRef, taskRef };
}

function itemRef(id: string, items: ItemIndex | undefined): ItemRef {
  // Until the item index arrives, show something stable rather than an empty chip.
  return items?.[id] ?? { id, name: id, shortName: "key", iconLink: null, wikiLink: null };
}

/**
 * Turn the normalized documents into the denormalized shape the rest of the app uses.
 *
 * Everything downstream — the graph, availability, the UI — was written against nested
 * objects, so the reshaping stops here rather than leaking id lookups into components.
 */
export function denormalize(bundle: CoreBundle, items?: ItemIndex): TarkovData {
  const { t, mapRef, traderRef, taskRef } = makeResolver(bundle);

  const tasks: Task[] = Object.values(bundle.tasks).map((raw) => ({
    id: raw.id,
    name: t(raw.name, raw.normalizedName),
    normalizedName: raw.normalizedName,
    experience: raw.experience ?? 0,
    minPlayerLevel: raw.minPlayerLevel ?? null,
    kappaRequired: raw.kappaRequired ?? null,
    lightkeeperRequired: raw.lightkeeperRequired ?? null,
    factionName: raw.factionName ?? "Any",
    restartable: raw.restartable ?? false,
    wikiLink: raw.wikiLink ?? null,
    trader: traderRef(raw.trader),
    map: mapRef(raw.map),
    taskRequirements: (raw.taskRequirements ?? []).map((req) => ({
      task: taskRef(req.task),
      status: req.status ?? [],
    })),
    traderRequirements: (raw.traderRequirements ?? [])
      // Only loyalty-level requirements gate availability; standing is informational.
      .filter((req) => req.requirementType === "level")
      .map((req) => ({ trader: traderRef(req.trader) ?? { id: req.trader, name: req.trader }, value: req.value })),
    objectives: (raw.objectives ?? []).map<TaskObjective>((objective) => ({
      id: objective.id,
      description: t(objective.description, objective.type),
      type: objective.type,
      optional: objective.optional ?? false,
      maps: (objective.maps ?? []).map((id) => mapRef(id)).filter((m): m is NamedRef => m !== null),
      __typename: objective.type,
      count: objective.count ?? null,
      foundInRaid: objective.foundInRaid ?? null,
      item: objective.item ? itemRef(objective.item, items) : null,
      // Ids, not refs: 877 distinct items appear across these lists and the key-item
      // index holds ~58 of them, so resolving here would mostly produce placeholders.
      items: objective.items ?? [],
      containsAll: objective.containsAll ?? [],
      questItem: null,
      markerItem: objective.markerItem ? itemRef(objective.markerItem, items) : null,
      targetNames: objective.targetNames?.map((name) => t(name, name)) ?? null,
      exitStatus: objective.exitStatus ?? null,
      status: objective.status ?? null,
      task: objective.task ? taskRef(objective.task) : null,
      playerLevel: objective.playerLevel ?? null,
      level: objective.level ?? null,
      trader: traderRef(objective.trader),
      shotType: null,
      // Already cached: `loadCoreBundle` keeps `RawTask` whole, so these arrived with the
      // bundle and were being dropped here rather than never fetched. Normalised to arrays
      // so every consumer can iterate without a null check.
      zones: (objective.zones ?? []).map((zone) => ({
        id: zone.id,
        map: zone.map,
        position: zone.position,
        outline: zone.outline ?? null,
        top: zone.top ?? null,
        bottom: zone.bottom ?? null,
      })),
      possibleLocations: (objective.possibleLocations ?? []).map((entry) => ({
        map: entry.map,
        positions: entry.positions ?? [],
      })),
    })),
    neededKeys: (raw.neededKeys ?? []).map((group) => ({
      map: mapRef(group.map),
      keys: (group.keys ?? []).map((id) => itemRef(id, items)),
    })),
  }));

  const maps: GameMap[] = Object.values(bundle.maps).map((raw) => ({
    id: raw.id,
    name: t(raw.name, raw.normalizedName),
    normalizedName: raw.normalizedName,
    nameId: raw.nameId,
    scenePath: raw.scenePath ?? null,
    wiki: raw.wiki ?? null,
    raidDuration: raw.raidDuration ?? null,
    players: raw.players ?? null,
    enemies: raw.enemies?.map((enemy) => t(enemy, enemy)) ?? null,
    description: raw.description ? t(raw.description, "") || null : null,
  }));

  const traders = Object.values(bundle.traders).map((raw) => ({
    id: raw.id,
    name: t(raw.name, raw.normalizedName),
    resetTime: raw.resetTime ?? null,
    levels: raw.levels ?? [],
  }));

  return { tasks, maps, traders, playerLevels: [] };
}

/** Convenience: fetch and denormalize in one call. Used by tests and one-shot loads. */
export async function fetchTarkovData(
  mode: GameMode,
  options: FetchOptions = {},
): Promise<TarkovData> {
  return denormalize(await loadCoreBundle(mode, options));
}
