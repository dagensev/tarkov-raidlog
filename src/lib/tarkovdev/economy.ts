/**
 * The three things that consume stash items: hideout upgrades, trader barters and crafts.
 *
 * Kept apart from ./client.ts because none of it is needed to show tasks. Together the
 * documents are 437 KB against the item catalogue's 16.7 MB, so they are cheap enough to
 * fetch alongside it rather than lazily on first use — which would otherwise force a
 * second catalogue download in the same session.
 */

import { collection, fetchEndpoint, type FetchOptions } from "./client";
import type { GameMode } from "./endpoints";
import type {
  RawBarter,
  RawCraft,
  RawDocument,
  RawHideoutStation,
  RawItemRequirement,
  TranslationDictionary,
} from "./raw-types";

/**
 * Roubles, dollars and euros.
 *
 * The Library wants 400,000 roubles and there is no `currency` item type to spot that
 * with — all three are ordinary items tagged `noFlea`. Left in, every hideout level and
 * most barters would report money as an item you must not sell.
 */
export const CURRENCY_ITEM_IDS: ReadonlySet<string> = new Set([
  "5449016a4bdc2d6f028b456f", // roubles
  "5696686a4bdc2da3298b456a", // dollars
  "569668774bdc2da2298b4568", // euros
]);

/** One line of a shopping list, with the item resolved to an id and the count usable. */
export interface ItemRequirement {
  itemId: string;
  /**
   * Ceilinged. 305 barter lines are fractional — every one of them GP coin, at counts
   * like 155.1 — and a fractional "keep 155.1" is not something to put on screen.
   */
  count: number;
  /**
   * The same figure unrounded, which is what costing a line has to use.
   *
   * Purified water asks for 0.66 of a water filter, and charging a whole one overstates
   * that craft by half. Kept beside `count` rather than replacing it, because the two
   * questions genuinely differ: a keep list says how many to hold back and cannot say
   * two thirds, while a profit figure is wrong if it rounds.
   */
  exactCount: number;
  foundInRaid: boolean;
  /** Craft only: must be present, handed back afterwards, so never consumed. */
  tool: boolean;
}

export interface HideoutLevel {
  level: number;
  requirements: ItemRequirement[];
}

export interface HideoutStation {
  id: string;
  /** Resolved through `hideout_en`; the document itself carries a translation key. */
  name: string;
  normalizedName: string;
  levels: HideoutLevel[];
  /** The station portrait on assets.tarkov.dev, for the crafts table. */
  imageLink: string | null;
}

export interface Barter {
  id: string;
  traderId: string;
  /** Task that unlocks the offer, or null. 56 of 806 have one. */
  taskUnlock: string | null;
  minTraderLevel: number | null;
  /**
   * How many times one restock lets you take it, or null for no limit. Read by the crafts
   * calculator, which prices a barter per trade and has to say when that trade is rationed.
   */
  buyLimit: number | null;
  requiredItems: ItemRequirement[];
  offeredItem: { itemId: string; count: number };
}

export interface Craft {
  id: string;
  stationId: string;
  /** Station level the craft needs before it can be run at all. */
  level: number;
  requiredItems: ItemRequirement[];
  productItem: { itemId: string; count: number };
  /**
   * How long one run takes, in seconds, before any Crafting skill reduction.
   *
   * Zero when the document omits it, which nothing in the live data does. A craft with no
   * duration has no profit per hour, and the calculator says so rather than dividing by
   * nothing.
   */
  durationSeconds: number;
  /** Task that has to be finished before the craft appears. Null for most. */
  taskUnlock: string | null;
  /** Game editions the craft is exclusive to. Empty for all but one. */
  gameEditions: string[];
}

export interface EconomyBundle {
  mode: GameMode;
  /** Shape of the entries, against `ECONOMY_BUNDLE_VERSION`. Absent on older caches. */
  version?: number;
  stations: HideoutStation[];
  barters: Barter[];
  crafts: Craft[];
  fetchedAt: number;
}

/**
 * Bump whenever the trimming keeps something new.
 *
 * The same reasoning as `SELL_INDEX_VERSION`: a cached bundle lives a day, and a field
 * added today is simply absent from every reader's cache until then. Craft durations were
 * the case that forced this — a calculator that divides by a missing duration is worse
 * than one that waits for a refetch.
 */
export const ECONOMY_BUNDLE_VERSION = 2;

/** Currency lines are dropped here so nothing downstream has to know money exists. */
function requirements(raw: readonly RawItemRequirement[] | undefined): ItemRequirement[] {
  const out: ItemRequirement[] = [];
  for (const line of raw ?? []) {
    if (!line?.item || CURRENCY_ITEM_IDS.has(line.item)) continue;
    const exactCount = typeof line.count === "number" && line.count > 0 ? line.count : 1;
    out.push({
      itemId: line.item,
      count: Math.max(1, Math.ceil(exactCount)),
      exactCount,
      foundInRaid: line.attributes?.foundInRaid === true,
      tool: line.attributes?.tool === true,
    });
  }
  return out;
}

function product(raw: RawItemRequirement | undefined): { itemId: string; count: number } {
  return { itemId: raw?.item ?? "", count: Math.max(1, Math.ceil(raw?.count ?? 1)) };
}

/**
 * Fetch and trim the three documents.
 *
 * The hideout document keys its stations directly off `data` with no wrapper property,
 * the same shape `traders` uses and the same one that silently produced an empty list
 * when read as a named property. `collection` is what handles both.
 */
export async function loadEconomyBundle(
  mode: GameMode,
  options: FetchOptions = {},
): Promise<EconomyBundle> {
  const [hideout, hideoutText, barters, crafts] = await Promise.all([
    fetchEndpoint<RawDocument<unknown>>(mode, "hideout", options),
    fetchEndpoint<RawDocument<TranslationDictionary>>(mode, "hideout", options, true),
    fetchEndpoint<RawDocument<unknown>>(mode, "barters", options),
    fetchEndpoint<RawDocument<unknown>>(mode, "crafts", options),
  ]);

  const text = hideoutText.data ?? {};
  const stations: HideoutStation[] = [];
  for (const [id, raw] of Object.entries(
    collection<RawHideoutStation>(hideout.data, "hideoutStations"),
  )) {
    if (!raw?.levels) continue;
    stations.push({
      id,
      name: text[raw.name] ?? raw.normalizedName ?? id,
      normalizedName: raw.normalizedName,
      levels: raw.levels
        .map((level) => ({ level: level.level, requirements: requirements(level.itemRequirements) }))
        .sort((a, b) => a.level - b.level),
      imageLink: raw.imageLink ?? null,
    });
  }

  const trimmedBarters: Barter[] = [];
  for (const raw of Object.values(collection<RawBarter>(barters.data, "barters"))) {
    if (!raw?.requiredItems) continue;
    const requiredItems = requirements(raw.requiredItems);
    // A barter whose only input was money asks nothing of the stash.
    if (requiredItems.length === 0) continue;
    trimmedBarters.push({
      id: raw.id,
      traderId: raw.trader,
      taskUnlock: raw.taskUnlock ?? null,
      minTraderLevel: raw.minTraderLevel ?? null,
      buyLimit: typeof raw.buyLimit === "number" && raw.buyLimit > 0 ? raw.buyLimit : null,
      requiredItems,
      offeredItem: product(raw.offeredItem),
    });
  }

  const trimmedCrafts: Craft[] = [];
  for (const raw of Object.values(collection<RawCraft>(crafts.data, "crafts"))) {
    if (!raw?.requiredItems) continue;
    const requiredItems = requirements(raw.requiredItems);
    // A craft that asks nothing of the stash. Exactly one does: the Bitcoin Farm, whose
    // only input is electricity and whose cycle time depends on how many graphics cards
    // are slotted — a number the document does not carry. Dropping it here is what keeps
    // it off the crafts calculator, which has no way to price it honestly.
    if (requiredItems.length === 0) continue;
    trimmedCrafts.push({
      id: raw.id,
      stationId: raw.station,
      level: raw.level ?? 1,
      requiredItems,
      productItem: product(raw.productItem),
      durationSeconds: raw.duration ?? 0,
      taskUnlock: raw.taskUnlock ?? null,
      gameEditions: raw.gameEditions ?? [],
    });
  }

  return {
    mode,
    version: ECONOMY_BUNDLE_VERSION,
    stations: stations.sort((a, b) => a.name.localeCompare(b.name)),
    barters: trimmedBarters,
    crafts: trimmedCrafts,
    fetchedAt: Date.now(),
  };
}

/** Every item id the hideout, a barter or a craft consumes. Currencies already dropped. */
export function economyItemIds(economy: EconomyBundle): string[] {
  const ids = new Set<string>();
  for (const station of economy.stations) {
    for (const level of station.levels) {
      for (const line of level.requirements) ids.add(line.itemId);
    }
  }
  for (const barter of economy.barters) {
    for (const line of barter.requiredItems) ids.add(line.itemId);
  }
  for (const craft of economy.crafts) {
    for (const line of craft.requiredItems) ids.add(line.itemId);
  }
  return [...ids];
}
