import type { GameLogType, LogEvent } from "./events";
import {
  GAME_STARTED_RE,
  LOCATION_LOADED_RE,
  LOG_HEADER_RE,
  MATCHING_COMPLETED_RE,
  NOTIFICATION_RE,
  NOTIFICATION_TYPES,
  SCENE_PRESET_RE,
  SELECT_PROFILE_RE,
  SESSION_MODE_RE,
  TASK_TEMPLATE_RE,
  TRACE_PROFILE_RE,
} from "./patterns";

/** One log record: a header line plus any continuation lines (usually a JSON block). */
export interface RawRecord {
  timestamp: number;
  gameVersion: string;
  level: string;
  category: string;
  message: string;
  /** Parsed JSON block, if the record had one and it parsed cleanly. */
  json?: unknown;
}

export interface ParseContext {
  folder: string;
  source: GameLogType;
}

/**
 * Splits a byte stream into complete log records.
 *
 * Records are delimited by header lines, so the last record in a chunk is only known
 * to be complete once a *following* header arrives. Holding it back is what makes
 * incremental tailing safe: a poll can land in the middle of a JSON block, and
 * parsing the partial object would otherwise drop the event.
 *
 * A record is released early when its JSON block closes (a `}` at column 0), so live
 * events surface immediately instead of waiting for the game to write its next line.
 * `flush()` releases whatever is still pending, for use at end of file.
 */
export class LogRecordSplitter {
  private buf = "";
  private pending: string[] = [];
  private jsonOpen = false;

  /** Feed a chunk of text; returns every record known to be complete. */
  push(chunk: string): RawRecord[] {
    this.buf += chunk;
    const out: RawRecord[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, nl).replace(/\r$/, "");
      this.buf = this.buf.slice(nl + 1);
      this.consume(line, out);
    }
    return out;
  }

  /** Release the final pending record. Call once no more data is coming. */
  flush(): RawRecord[] {
    const out: RawRecord[] = [];
    if (this.buf.length > 0) {
      const line = this.buf.replace(/\r$/, "");
      this.buf = "";
      this.consume(line, out);
    }
    const rec = this.close();
    if (rec) out.push(rec);
    return out;
  }

  private consume(line: string, out: RawRecord[]): void {
    if (LOG_HEADER_RE.test(line)) {
      const rec = this.close();
      if (rec) out.push(rec);
      this.pending = [line];
      this.jsonOpen = false;
      return;
    }
    // Continuation lines only mean something once we have a header to attach them to.
    if (this.pending.length === 0) return;
    this.pending.push(line);
    if (!this.jsonOpen && line === "{") {
      this.jsonOpen = true;
    } else if (this.jsonOpen && line === "}") {
      // JSON block closed: release without waiting for the next header.
      const rec = this.close();
      if (rec) out.push(rec);
    }
  }

  private close(): RawRecord | null {
    if (this.pending.length === 0) return null;
    const lines = this.pending;
    this.pending = [];
    this.jsonOpen = false;
    return buildRecord(lines);
  }
}

function buildRecord(lines: string[]): RawRecord | null {
  const m = LOG_HEADER_RE.exec(lines[0]);
  if (!m) return null;
  const [, date, time, tz, gameVersion, level, category, message] = m;
  // 1.0.x logs carry an explicit offset; 1.1.x omit it and are local time, which is
  // exactly how JS parses a date-time string with no offset.
  const iso = tz ? `${date}T${time}${tz.trim()}` : `${date}T${time}`;
  const timestamp = new Date(iso).getTime();

  const rec: RawRecord = {
    timestamp: Number.isNaN(timestamp) ? 0 : timestamp,
    gameVersion,
    level,
    category,
    message,
  };

  const start = lines.indexOf("{", 1);
  if (start > 0) {
    const end = lines.lastIndexOf("}");
    if (end > start) {
      try {
        rec.json = JSON.parse(lines.slice(start, end + 1).join("\n"));
      } catch {
        // Truncated or malformed JSON: keep the record, drop the payload.
      }
    }
  }
  return rec;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Turn one record into zero or more events. */
export function parseRecord(rec: RawRecord, ctx: ParseContext): LogEvent[] {
  const meta = {
    timestamp: rec.timestamp,
    source: ctx.source,
    folder: ctx.folder,
    gameVersion: rec.gameVersion,
  };

  const notification = NOTIFICATION_RE.exec(rec.message);
  if (notification) return parseNotification(notification[1], rec, meta);

  const events: LogEvent[] = [];

  const scene = SCENE_PRESET_RE.exec(rec.message);
  if (scene) events.push({ ...meta, kind: "map-loading", scene: scene[1] });

  const mode = SESSION_MODE_RE.exec(rec.message);
  if (mode) events.push({ ...meta, kind: "session-mode", mode: mode[1] });

  const queue = MATCHING_COMPLETED_RE.exec(rec.message);
  if (queue) {
    const seconds = Number(queue[1].replace(",", "."));
    if (Number.isFinite(seconds)) events.push({ ...meta, kind: "queue-completed", seconds });
  }

  if (LOCATION_LOADED_RE.test(rec.message)) events.push({ ...meta, kind: "map-loaded" });
  if (GAME_STARTED_RE.test(rec.message)) events.push({ ...meta, kind: "game-started" });

  const selectProfile = SELECT_PROFILE_RE.exec(rec.message);
  if (selectProfile) {
    events.push({
      ...meta,
      kind: "profile",
      profileId: selectProfile[1],
      accountId: selectProfile[2],
    });
  } else {
    // 1.1.0 dropped SelectProfile; the id survives in the raid trace line.
    const trace = TRACE_PROFILE_RE.exec(rec.message);
    if (trace) events.push({ ...meta, kind: "profile", profileId: trace[1] });
  }

  return events;
}

interface EventMeta {
  timestamp: number;
  source: GameLogType;
  folder: string;
  gameVersion: string;
}

function parseNotification(type: string, rec: RawRecord, base: EventMeta): LogEvent[] {
  const payload = asRecord(rec.json);
  if (!payload) return [];

  switch (type) {
    case NOTIFICATION_TYPES.chatMessage: {
      const message = asRecord(payload.message);
      if (!message) return [];
      const template = str(message.templateId);
      if (!template) return [];
      const m = TASK_TEMPLATE_RE.exec(template);
      if (!m) return [];
      const status = statusFromSuffix(m[2]);
      if (!status) return [];
      // The payload's own `dt` is unix seconds and beats the line timestamp, which
      // drifts when the game replays queued notifications on login.
      const dt = num(message.dt);
      return [
        {
          ...base,
          timestamp: dt !== undefined ? dt * 1000 : base.timestamp,
          kind: "task",
          status,
          taskId: m[1],
          traderId: str(payload.dialogId) ?? str(message.uid),
          messageType: num(message.type),
        },
      ];
    }

    case NOTIFICATION_TYPES.userConfirmed: {
      const location = str(payload.location);
      if (!location) return [];
      return [
        {
          ...base,
          kind: "raid-starting",
          location,
          raidMode: str(payload.raidMode),
          shortId: str(payload.shortId),
          profileId: str(payload.profileid),
        },
      ];
    }

    case NOTIFICATION_TYPES.userMatchOver:
      return [{ ...base, kind: "raid-ended" }];

    case NOTIFICATION_TYPES.groupInviteSend:
    case NOTIFICATION_TYPES.groupInviteAccept:
    case NOTIFICATION_TYPES.groupRaidReady:
    case NOTIFICATION_TYPES.groupRaidNotReady: {
      // `Info` sits at the top level for invites, under `extendedProfile` for ready-ups.
      const extended = asRecord(payload.extendedProfile);
      const info = asRecord(payload.Info) ?? asRecord(extended?.Info);
      if (!info) return [];
      return [
        {
          ...base,
          kind: "group-member",
          action: groupAction(type),
          nickname: str(info.Nickname),
          side: str(info.Side),
          level: num(info.Level),
          isLeader: typeof payload.isLeader === "boolean" ? payload.isLeader : undefined,
        },
      ];
    }

    case NOTIFICATION_TYPES.groupUserLeave:
      return [
        {
          ...base,
          kind: "group-member",
          action: "left",
          // TarkovMonitor defaults this to "You": the payload omits the nickname
          // when it is the local player who left.
          nickname: str(payload.Nickname) ?? "You",
        },
      ];

    case NOTIFICATION_TYPES.groupRaidSettings: {
      const settings = asRecord(payload.raidSettings);
      if (!settings) return [];
      return [
        {
          ...base,
          kind: "group-raid-settings",
          location: str(settings.location),
          raidMode: str(settings.raidMode),
          side: str(settings.side),
        },
      ];
    }

    default:
      return [];
  }
}

function groupAction(type: string): "invited" | "joined" | "ready" | "not-ready" {
  if (type === NOTIFICATION_TYPES.groupInviteSend) return "invited";
  if (type === NOTIFICATION_TYPES.groupInviteAccept) return "joined";
  if (type === NOTIFICATION_TYPES.groupRaidNotReady) return "not-ready";
  return "ready";
}

function statusFromSuffix(suffix: string): "started" | "finished" | "failed" | null {
  switch (suffix) {
    case "description":
      return "started";
    case "successMessageText":
      return "finished";
    case "failMessageText":
      return "failed";
    default:
      // `declinedMessageText` is not a progress change.
      return null;
  }
}

/** Convenience: splitter and record parser wired together for one file. */
export class LogParser {
  private splitter = new LogRecordSplitter();
  constructor(private ctx: ParseContext) {}

  push(chunk: string): LogEvent[] {
    return this.splitter.push(chunk).flatMap((rec) => parseRecord(rec, this.ctx));
  }

  flush(): LogEvent[] {
    return this.splitter.flush().flatMap((rec) => parseRecord(rec, this.ctx));
  }
}
