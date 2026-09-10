/**
 * Raw shapes returned by the JSON API, before denormalization.
 *
 * Verified against live responses from `https://json.tarkov.dev/pvp-season/*` (491 tasks,
 * 17 maps). Id-valued fields are named plainly here to make the reference obvious: where
 * the denormalized types in ./types.ts have `trader: { id, name }`, these have
 * `trader: string`.
 */

/** Every document is wrapped, and data documents also list their translatable paths. */
export interface RawDocument<T> {
  data: T;
  translations?: string[];
}

/** A translation file: flat map of translation key to localized string. */
export type TranslationDictionary = Record<string, string>;

export interface RawTaskRequirement {
  task: string;
  status: string[];
}

export interface RawTraderRequirement {
  id: string;
  trader: string;
  requirementType: string;
  compareMethod: string;
  value: number;
}

/** A point in the game world. */
export interface GamePosition {
  x: number;
  y: number;
  z: number;
}

/**
 * A volume an objective happens in — a stash spot, an area to visit.
 *
 * `outline` is the footprint as a polygon, which is what makes "plant it in this area"
 * drawable as an area rather than a dot.
 */
export interface RawObjectiveZone {
  id: string;
  /** Map id. */
  map: string;
  position: GamePosition;
  size?: GamePosition;
  outline?: GamePosition[];
  top?: number;
  bottom?: number;
}

export interface RawObjective {
  id: string;
  /** Translation key; in practice equal to the objective id. */
  description: string;
  type: string;
  optional: boolean;
  count?: number;
  foundInRaid?: boolean;
  /** Map ids. */
  maps?: string[];
  /** Item id. */
  item?: string;
  /**
   * Item ids that all satisfy this objective — alternatives, not a set to collect.
   * One entry means "hand over exactly this"; `first-in-line` has 110, meaning "any
   * medical item". The count of alternatives is how much weight the requirement carries.
   */
  items?: string[];
  /** `buildWeapon` only: mod ids the finished gun must carry. */
  containsAll?: string[];
  questItem?: string;
  markerItem?: string;
  /** Item ids, grouped: each inner array is an alternative set. */
  requiredKeys?: string[][];
  possibleLocations?: Array<{ map: string; positions: Array<{ x: number; y: number; z: number }> }>;
  zones?: RawObjectiveZone[];
  targetNames?: string[];
  exitStatus?: string[];
  playerLevel?: number;
  level?: number;
  trader?: string;
  task?: string;
  status?: string[];
}

export interface RawNeededKeys {
  /** Map id, or null when the key is not tied to one map. */
  map: string | null;
  /** Item ids. */
  keys: string[];
}

export interface RawTask {
  id: string;
  /** Translation key, e.g. `"657315ddab5a49b71f098853 name"`. */
  name: string;
  /** Already plain text. */
  normalizedName: string;
  /** Already plain text. */
  wikiLink: string | null;
  experience: number;
  minPlayerLevel: number | null;
  kappaRequired: boolean | null;
  lightkeeperRequired: boolean | null;
  factionName: "Any" | "BEAR" | "USEC" | string;
  /** Trader id. */
  trader: string;
  /** Map id, or null for a task not tied to one map. */
  map: string | null;
  taskRequirements: RawTaskRequirement[];
  traderRequirements: RawTraderRequirement[];
  objectives: RawObjective[];
  neededKeys: RawNeededKeys[];
  taskImageLink?: string | null;
  restartable?: boolean;
}

export interface RawTasksData {
  /** Keyed by task id, not an array. */
  tasks: Record<string, RawTask>;
  questItems?: Record<string, unknown>;
  achievements?: Record<string, unknown>;
}

export interface RawMap {
  id: string;
  /** Translation key, e.g. `"56f40101d2720b2a4d8b45d6 Name"` — note the capital N. */
  name: string;
  normalizedName: string;
  /** BSG's internal location id, e.g. `bigmap`. Matches `UserConfirmed.location`. */
  nameId: string;
  /** Unity scene bundle, e.g. `maps/customs_preset.bundle`. Matches the application log. */
  scenePath: string | null;
  description: string | null;
  wiki: string | null;
  enemies?: string[];
  raidDuration: number | null;
  players: string | null;
  minPlayerLevel?: number;
  maxPlayerLevel?: number;
}

export interface RawMapsData {
  maps: Record<string, RawMap>;
  /** Also present and large; not used. */
  mobs?: Record<string, unknown>;
  lootContainers?: Record<string, unknown>;
}

export interface RawTraderLevel {
  id: string;
  level: number;
  requiredPlayerLevel: number;
  requiredReputation: number;
}

export interface RawTrader {
  id: string;
  /** Translation key. */
  name: string;
  normalizedName: string;
  resetTime: string | null;
  levels: RawTraderLevel[];
}

export interface RawTradersData {
  traders: Record<string, RawTrader>;
}

/**
 * One side of a trader's counter, in that trader's own currency and in roubles.
 *
 * The same shape carries both directions. `sellToTrader` fills in only the first five
 * fields — a trader buys your loot whatever your standing — while `buyFromTrader` also
 * carries what gates the offer.
 */
export interface RawTraderOffer {
  /** Trader id. */
  trader: string;
  /** In `currency`, so never comparable across traders. */
  price: number;
  /** The same offer in roubles. This is the one to compare. */
  priceRUB: number;
  currency: string;
  currencyItem: string;
  /** Buy offers only: the loyalty level that unlocks it. */
  minTraderLevel?: number | null;
  /** Buy offers only: task id that unlocks it. 66 of 2399 buyable items have one. */
  taskUnlock?: string | null;
  /** Buy offers only: how many the trader will part with per restock. */
  buyLimit?: number | null;
  restockAmount?: number | null;
}

export interface RawItem {
  id: string;
  /** Translation key. */
  name: string;
  /** Translation key. */
  shortName: string;
  normalizedName: string;
  wikiLink?: string | null;
  iconLink?: string | null;
  /** Grid footprint in stash cells. */
  width?: number;
  height?: number;
  /**
   * Category tags. `noFlea` marks an item that cannot be listed at all, which covers all
   * three currencies; `preset` marks tarkov.dev's built-gun entries, which are not stash
   * items.
   */
  types?: string[];
  /** Character level the flea market requires before this can be listed. 0 for most. */
  minLevelForFlea?: number | null;
  basePrice?: number | null;
  avg24hPrice?: number | null;
  lastLowPrice?: number | null;
  stackMaxSize?: number | null;
  sellToTrader?: RawTraderOffer[];
  /** What traders will sell it to you for. Empty for the 2436 items none of them stock. */
  buyFromTrader?: RawTraderOffer[];
  /** Item category ids, the whole ancestry from the leaf up to `item`. */
  categories?: string[];
  /** Handbook category ids: the leaf the item sits in, then that leaf's root. */
  handbookCategories?: string[];
}

/**
 * A node of either category tree.
 *
 * The two differ in one way that matters: an item category's `name` is a translation key
 * of the usual `<id> Name` shape, while a handbook category's `name` is its own bare id.
 * Both are keys into the dictionary, so resolving them the same way works.
 */
export interface RawCategory {
  id: string;
  /** Translation key. */
  name: string;
  normalizedName: string;
  /** Parent id. Item categories write "" at a root, handbook categories write null. */
  parent?: string | null;
  children?: string[];
}

/** The flea market itself. The only reason to read it is the pair of fee rates. */
export interface RawFleaMarket {
  name: string;
  normalizedName: string;
  minPlayerLevel: number;
  enabled: boolean;
  sellOfferFeeRate: number;
  sellRequirementFeeRate: number;
}

export interface RawItemsData {
  items: Record<string, RawItem>;
  itemCategories?: Record<string, RawCategory>;
  handbookCategories?: Record<string, RawCategory>;
  fleaMarket?: RawFleaMarket;
  playerLevels?: Array<{ level: number; exp: number }>;
}

/**
 * One line of a shopping list: a hideout level's, a barter's or a craft's.
 *
 * `count` is fractional for the 305 GP coin barter lines, which is why nothing may use it
 * without rounding.
 */
export interface RawItemRequirement {
  id?: string;
  /** Item id. */
  item: string;
  count: number;
  attributes?: {
    foundInRaid?: boolean;
    /** Craft only: the item must be present but is handed back afterwards. */
    tool?: boolean;
  };
}

export interface RawHideoutLevel {
  id: string;
  level: number;
  constructionTime?: number;
  itemRequirements?: RawItemRequirement[];
  stationLevelRequirements?: Array<{ id: string; station: string; level: number }>;
  traderRequirements?: unknown[];
}

export interface RawHideoutStation {
  id: string;
  /** Translation key, e.g. `hideout_area_12_name`. */
  name: string;
  normalizedName: string;
  areaType: number;
  levels: RawHideoutLevel[];
  imageLink?: string | null;
}

/**
 * The hideout document keys stations directly off `data`, with no wrapper property —
 * the same shape `traders` uses. `collection` handles both.
 */
export type RawHideoutData = Record<string, RawHideoutStation>;

export interface RawBarter {
  id: string;
  /** Trader id. */
  trader: string;
  /** Task that unlocks the offer, or null. 56 of 806 have one. */
  taskUnlock?: string | null;
  minTraderLevel?: number | null;
  requiredItems: RawItemRequirement[];
  offeredItem: RawItemRequirement;
  restockAmount?: number;
  buyLimit?: number;
}

export interface RawCraft {
  id: string;
  /** Hideout station id. */
  station: string;
  /** Station level the craft needs. */
  level: number;
  requiredItems: RawItemRequirement[];
  requiredQuestItems?: unknown[];
  productItem: RawItemRequirement;
  duration?: number;
  gameEditions?: string[];
}

/** Barters and crafts are both keyed by array index off `data`. */
export type RawBartersData = Record<string, RawBarter>;
export type RawCraftsData = Record<string, RawCraft>;
