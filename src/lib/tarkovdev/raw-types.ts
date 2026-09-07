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

export interface RawItem {
  id: string;
  /** Translation key. */
  name: string;
  /** Translation key. */
  shortName: string;
  normalizedName: string;
  wikiLink?: string | null;
  iconLink?: string | null;
}

export interface RawItemsData {
  items: Record<string, RawItem>;
  playerLevels?: Array<{ level: number; exp: number }>;
}
