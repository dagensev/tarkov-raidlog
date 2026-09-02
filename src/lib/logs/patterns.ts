/**
 * Raw log patterns.
 *
 * Ported from TarkovMonitor's `GameWatcher.cs` and verified against real logs in
 * `C:\Battlestate Games\Escape from Tarkov\Logs` (2025-11-15 -> 2026-09-01,
 * game versions 1.0.0.0.41760 through 1.1.0.1.46911).
 *
 * Keep every regex non-global: they are reused across calls and a global regex
 * would carry `lastIndex` between them.
 */

/**
 * Header line of a log record. Both observed shapes:
 *
 *   2026-09-01 19:27:08.691|1.1.0.1.46911|Info|application|<message>
 *   2025-11-15 14:28:22.869 -07:00|1.0.0.0.41760|Debug|application|<message>
 *
 * The timezone offset appeared in 1.0.x logs and is absent in 1.1.x, so it is optional.
 */
export const LOG_HEADER_RE =
  /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}\.\d{3})( ?[+-]\d{2}:\d{2})?\|([^|]*)\|([^|]*)\|([^|]*)\|(.*)$/;

/** `Got notification | ChatMessageReceived` — the notification type follows the pipe. */
export const NOTIFICATION_RE = /Got notification \| (\w+)/;

/**
 * Quest state, from a chat message's `templateId`:
 *
 *   "templateId": "657315ddab5a49b71f098853 successMessageText"
 *
 * The 24-hex prefix is the task id (TarkovMonitor takes the first space-delimited
 * segment). The suffix is the authoritative status signal.
 */
export const TASK_TEMPLATE_RE =
  /^([0-9a-f]{24}) (description|successMessageText|failMessageText|declinedMessageText)/;

/**
 * Profile ids, for wipe detection. Three sources, because the game moved the goalposts:
 *
 *  - `SelectProfile ProfileId:<id> AccountId:<n>` — application log, present through 1.0.x,
 *    gone in 1.1.0.
 *  - `TRACE-NetworkGameCreate profileStatus: 'Profileid: <id>, ...'` — application log, 1.1.x.
 *  - `"profileid": "<id>"` — the `UserConfirmed` notification payload.
 */
export const SELECT_PROFILE_RE =
  /(?:Select(?:ed)?Profile|PrepareSelectedProfileLocally) ProfileId:([0-9a-f]{24}) AccountId:(\d+)/;
export const TRACE_PROFILE_RE = /Profileid: ([0-9a-f]{24})/;
export const PAYLOAD_PROFILE_RE = /"profileid":\s*"([0-9a-f]{24})"/;

/** Any 24-hex id, used when sweeping a whole file for profile ids. */
export const OBJECT_ID_RE = /[0-9a-f]{24}/;

/**
 * Map bundle load: `scene preset path:maps/customs_preset.bundle rcid:bigmap.scenespreset.asset`.
 * Fires before the match is confirmed, so it is our earliest map signal.
 */
export const SCENE_PRESET_RE = /scene preset path:maps\/([a-zA-Z0-9_]+)\.bundle/;

/** `Session mode: PvpSeason` | `Regular` | `Pve`. */
export const SESSION_MODE_RE = /Session mode: (\w+)/;

/** `MatchingCompleted:2.81 real:10.18 diff:7.37` — `real` is wall-clock queue time. */
export const MATCHING_COMPLETED_RE = /MatchingCompleted:[\d.,]+ real:([\d.,]+)/;

/** `LocationLoaded:23.73 real:37.34 diff:13.61`. */
export const LOCATION_LOADED_RE = /^LocationLoaded:/;

/** `GameStarted:50.72(11.2) ...` — not `GameStarting`, which fires earlier. */
export const GAME_STARTED_RE = /^GameStarted:/;

/** Notification type names we act on. Everything else is ignored. */
export const NOTIFICATION_TYPES = {
  chatMessage: "ChatMessageReceived",
  userConfirmed: "UserConfirmed",
  userMatchOver: "UserMatchOver",
  groupInviteAccept: "GroupMatchInviteAccept",
  groupInviteSend: "GroupMatchInviteSend",
  groupRaidReady: "GroupMatchRaidReady",
  groupRaidNotReady: "GroupMatchRaidNotReady",
  groupUserLeave: "GroupMatchUserLeave",
  groupRaidSettings: "GroupMatchRaidSettings",
  groupWasRemoved: "GroupMatchWasRemoved",
} as const;

/**
 * `message.type` values seen alongside each template suffix. Verified across all 26
 * log folders: type 10 always accompanied `description`, type 12 always
 * `successMessageText`. Used only to corroborate the suffix.
 */
export const MESSAGE_TYPE = {
  taskStarted: 10,
  taskFailed: 11,
  taskFinished: 12,
} as const;
