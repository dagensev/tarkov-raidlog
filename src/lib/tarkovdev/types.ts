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
