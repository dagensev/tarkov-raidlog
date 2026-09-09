/** Shapes returned by the query in ./query.ts. */

export interface NamedRef {
  id: string;
  name: string;
}

export interface ItemRef {
  id: string;
  name: string;
  shortName?: string | null;
  iconLink?: string | null;
  wikiLink?: string | null;
}

/**
 * How a prerequisite task must stand for a task to unlock.
 *
 * tarkov.dev returns an array because a requirement can be satisfied several ways.
 * `active` means the prerequisite must be *in progress*, not finished — which is why
 * TarkovTracker treats it specially when building the graph.
 */
export type TaskRequirementStatus = "complete" | "active" | "failed" | (string & {});

export interface TaskRequirement {
  task: NamedRef;
  status: TaskRequirementStatus[];
}

export interface TraderRequirement {
  trader: NamedRef;
  value: number;
}

/** A point in the game world. */
export interface GamePosition {
  x: number;
  y: number;
  z: number;
}

/** A volume an objective happens in. `map` is a map id. */
export interface ObjectiveZone {
  id: string;
  map: string;
  position: GamePosition;
  outline: GamePosition[] | null;
  top: number | null;
  bottom: number | null;
}

/** Candidate spots for one quest item. `map` is a map id. */
export interface ObjectiveLocations {
  map: string;
  positions: GamePosition[];
}

export interface TaskObjective {
  id: string;
  description: string;
  type: string;
  optional: boolean;
  maps: NamedRef[];
  __typename: string;
  count?: number | null;
  foundInRaid?: boolean | null;
  item?: ItemRef | null;
  questItem?: NamedRef | null;
  markerItem?: ItemRef | null;
  shotType?: string | null;
  targetNames?: string[] | null;
  exitStatus?: string[] | null;
  status?: string[] | null;
  task?: NamedRef | null;
  playerLevel?: number | null;
  level?: number | null;
  trader?: NamedRef | null;
  /** Where this objective happens. Empty for the 873 objectives with nowhere to point. */
  zones: ObjectiveZone[];
  /** Where a quest item may be found. Empty unless this is a `findQuestItem`. */
  possibleLocations: ObjectiveLocations[];
  /**
   * Item ids that each satisfy this objective — alternatives, not a set to collect.
   * One entry means "hand over exactly this"; the largest real one has 110, meaning
   * "any medical item". How many there are is how much weight the requirement carries.
   *
   * Ids rather than refs, because the item index they would resolve against holds only
   * the handful of key items tasks point at, and the sell check carries its own names.
   */
  items: string[];
  /** `buildWeapon` only: mod ids the finished gun must carry. */
  containsAll: string[];
}

/** Keys a task needs, grouped by the map they are used on. */
export interface NeededKeys {
  map: NamedRef | null;
  keys: ItemRef[];
}

export interface Task {
  id: string;
  name: string;
  /** Plain slug from the API, e.g. `first-in-line`. Needs no translation lookup. */
  normalizedName: string;
  experience: number;
  minPlayerLevel: number | null;
  kappaRequired: boolean | null;
  lightkeeperRequired: boolean | null;
  /** `Any`, `USEC` or `BEAR`. */
  factionName: string | null;
  wikiLink: string | null;
  trader: NamedRef | null;
  map: NamedRef | null;
  taskRequirements: TaskRequirement[];
  traderRequirements: TraderRequirement[];
  objectives: TaskObjective[];
  neededKeys: NeededKeys[];
  /** Can be picked up again after being failed, so its items still matter. */
  restartable?: boolean;
}

export interface GameMap {
  id: string;
  name: string;
  /** Plain slug, e.g. `customs`. Used to build tarkov.dev links. */
  normalizedName: string;
  /** BSG's internal location id, e.g. `bigmap`. Matches `UserConfirmed.location`. */
  nameId: string;
  /** Unity scene bundle, e.g. `maps/customs_preset.bundle`. Matches the application log. */
  scenePath: string | null;
  wiki: string | null;
  raidDuration: number | null;
  players: string | null;
  enemies: string[] | null;
  description: string | null;
}

export interface TraderLevel {
  id: string;
  level: number;
  requiredPlayerLevel: number;
  requiredReputation: number;
}

export interface Trader {
  id: string;
  name: string;
  resetTime: string | null;
  levels: TraderLevel[];
}

export interface PlayerLevel {
  level: number;
  exp: number;
}

export interface TarkovData {
  tasks: Task[];
  maps: GameMap[];
  traders: Trader[];
  playerLevels: PlayerLevel[];
}
