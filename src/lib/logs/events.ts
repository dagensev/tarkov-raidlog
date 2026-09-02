/**
 * Discriminated union of everything we extract from Escape from Tarkov's log files.
 *
 * Event shapes are driven by what the game actually writes — see the pattern
 * definitions in ./patterns.ts for the raw log lines each of these comes from.
 */

/** Which of the game's log files a record came from. */
export type GameLogType = "application" | "notifications" | "output" | "traces" | "unknown";

/** Fields every event carries, regardless of kind. */
export interface LogEventMeta {
  /** Milliseconds since epoch. Task events prefer the payload's own `dt` over the line timestamp. */
  timestamp: number;
  /** Which log file this came from. */
  source: GameLogType;
  /** Name of the `log_<date>_<version>` folder, e.g. `log_2026.09.01_19-27-07_1.1.0.1.46911`. */
  folder: string;
  /** Game version from the log line, e.g. `1.1.0.1.46911`. */
  gameVersion: string;
}

/**
 * A quest was accepted, completed or failed.
 *
 * Derived from `Got notification | ChatMessageReceived` whose payload carries
 * `templateId: "<24-hex taskId> <suffix>"`. The suffix is authoritative; the numeric
 * `message.type` is kept only as a cross-check, since BSG could renumber it.
 */
export interface TaskEvent extends LogEventMeta {
  kind: "task";
  status: "started" | "finished" | "failed";
  /** 24-character BSG/tarkov.dev task id. */
  taskId: string;
  /** Trader that sent the message (`dialogId`). */
  traderId?: string;
  /** Raw numeric `message.type`: 10 = started, 12 = finished. Cross-check only. */
  messageType?: number;
}

/** Match found and confirmed — carries the map we are about to load into. */
export interface RaidStartingEvent extends LogEventMeta {
  kind: "raid-starting";
  /** BSG location name as written in the payload, e.g. `Shoreline`, `Interchange`. */
  location: string;
  raidMode?: string;
  /** Six-character raid id, shared across everyone in the same instance. */
  shortId?: string;
  profileId?: string;
}

/** The raid ended (`UserMatchOver`). */
export interface RaidEndedEvent extends LogEventMeta {
  kind: "raid-ended";
}

/**
 * The map bundle started loading. This is the *earliest* reliable map signal —
 * it fires before the match is confirmed.
 */
export interface MapLoadingEvent extends LogEventMeta {
  kind: "map-loading";
  /** Unity scene preset name, e.g. `customs_preset`, `shopping_mall`. */
  scene: string;
}

/** The map finished loading (`LocationLoaded:`). */
export interface MapLoadedEvent extends LogEventMeta {
  kind: "map-loaded";
}

/** We are in the raid and can move (`GameStarted`). */
export interface GameStartedEvent extends LogEventMeta {
  kind: "game-started";
}

/** Matchmaking finished; `seconds` is the real (wall-clock) queue time. */
export interface QueueCompletedEvent extends LogEventMeta {
  kind: "queue-completed";
  seconds: number;
}

/** A squadmate joined, readied up, or left the group. */
export interface GroupMemberEvent extends LogEventMeta {
  kind: "group-member";
  action: "invited" | "joined" | "ready" | "not-ready" | "left";
  nickname?: string;
  /** `Usec` or `Bear`. */
  side?: string;
  level?: number;
  isLeader?: boolean;
}

/** The group leader changed the raid target. */
export interface GroupRaidSettingsEvent extends LogEventMeta {
  kind: "group-raid-settings";
  location?: string;
  raidMode?: string;
  side?: string;
}

/**
 * A profile id was observed. These are the raw material for wipe detection —
 * see ./wipe.ts.
 */
export interface ProfileSeenEvent extends LogEventMeta {
  kind: "profile";
  /** 24-character MongoDB ObjectId. */
  profileId: string;
  accountId?: string;
}

/** PvP vs PvE. `PvpSeason` and `Regular` are both PvP; `Pve` is PvE. */
export interface SessionModeEvent extends LogEventMeta {
  kind: "session-mode";
  mode: string;
}

export type LogEvent =
  | TaskEvent
  | RaidStartingEvent
  | RaidEndedEvent
  | MapLoadingEvent
  | MapLoadedEvent
  | GameStartedEvent
  | QueueCompletedEvent
  | GroupMemberEvent
  | GroupRaidSettingsEvent
  | ProfileSeenEvent
  | SessionModeEvent;

export type LogEventKind = LogEvent["kind"];
