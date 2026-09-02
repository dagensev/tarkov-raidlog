import type { GameLogType } from "./events";

/**
 * Identify a game log file from its filename.
 *
 * The game names files `<timestamp>_<version> <type>_000.log`, e.g.
 * `2026.09.01_19-27-07_1.1.0.1.46911 push-notifications_000.log`. TarkovMonitor
 * matches these by suffix rather than exact name, which is what makes
 * `push-notifications_000.log` fall out as the notifications log for free.
 */
export function getLogType(filename: string): GameLogType {
  const name = filename.toLowerCase();
  if (/application(_\d+)?\.log$/.test(name)) return "application";
  if (/notifications(_\d+)?\.log$/.test(name)) return "notifications";
  if (/traces(_\d+)?\.log$/.test(name)) return "traces";
  if (/output(_\d+)?\.log$/.test(name)) return "output";
  return "unknown";
}

/**
 * The only two files worth reading.
 *
 * `output_000.log` is ~2.7 MB of Unity noise per session against ~56 KB + ~172 KB
 * for these two, and carries nothing we use.
 */
export const WATCHED_LOG_TYPES: readonly GameLogType[] = ["application", "notifications"];

export function isWatchedLogFile(filename: string): boolean {
  return WATCHED_LOG_TYPES.includes(getLogType(filename));
}

/** Matches a session folder, e.g. `log_2026.09.01_19-27-07_1.1.0.1.46911`. */
const FOLDER_RE = /^log_(\d{4})\.(\d{2})\.(\d{2})_(\d{1,2})-(\d{2})-(\d{2})_(\d+\.\d+\.\d+\.\d+\.\d+)$/;

export interface LogFolderInfo {
  name: string;
  /** Local time the session started, ms since epoch. */
  startedAt: number;
  /** Game version, e.g. `1.1.0.1.46911`. */
  gameVersion: string;
}

/** Parse a session folder name, or return null if it is not one. */
export function parseLogFolderName(name: string): LogFolderInfo | null {
  const m = FOLDER_RE.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, gameVersion] = m;
  const startedAt = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
  ).getTime();
  return { name, startedAt, gameVersion };
}

/** Session folders only, oldest first. */
export function sortLogFolders(names: string[]): LogFolderInfo[] {
  return names
    .map(parseLogFolderName)
    .filter((f): f is LogFolderInfo => f !== null)
    .sort((a, b) => a.startedAt - b.startedAt);
}
