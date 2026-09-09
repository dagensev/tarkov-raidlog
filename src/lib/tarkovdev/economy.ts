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
}

export interface Barter {
  id: string;
  traderId: string;
  /** Task that unlocks the offer, or null. 56 of 806 have one. */
  taskUnlock: string | null;
  minTraderLevel: number | null;
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
}

export interface EconomyBundle {
  mode: GameMode;
  stations: HideoutStation[];
  barters: Barter[];
  crafts: Craft[];
  fetchedAt: number;
}

/** Currency lines are dropped here so nothing downstream has to know money exists. */
function requirements(raw: readonly RawItemRequirement[] | undefined): ItemRequirement[] {
  const out: ItemRequirement[] = [];
  for (const line of raw ?? []) {
    if (!line?.item || CURRENCY_ITEM_IDS.has(line.item)) continue;
    out.push({
      itemId: line.item,
      count: Math.max(1, Math.ceil(line.count ?? 1)),
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
      requiredItems,
      offeredItem: product(raw.offeredItem),
    });
  }

  const trimmedCrafts: Craft[] = [];
  for (const raw of Object.values(collection<RawCraft>(crafts.data, "crafts"))) {
    if (!raw?.requiredItems) continue;
    const requiredItems = requirements(raw.requiredItems);
    if (requiredItems.length === 0) continue;
    trimmedCrafts.push({
      id: raw.id,
      stationId: raw.station,
      level: raw.level ?? 1,
      requiredItems,
      productItem: product(raw.productItem),
    });
  }

  return {
    mode,
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
