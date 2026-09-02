import type { LogEvent } from "./events";
import { getLogType, isWatchedLogFile, sortLogFolders, type LogFolderInfo } from "./log-types";
import { LogParser } from "./parse-line";
import type { LogSource } from "./source";
import type { FolderObservation } from "./wipe";

/**
 * Reads log folders and tails the live one.
 *
 * Offsets are tracked per file so a poll only reads bytes that are new. The parser for a
 * file is kept alive between polls, which is what lets a JSON block split across two polls
 * be reassembled instead of dropped.
 */

export interface ScanProgress {
  folder: string;
  index: number;
  total: number;
}

export interface ScanResult {
  events: LogEvent[];
  observations: FolderObservation[];
  /** Scene names with no entry in the map table, worth reporting so the table can grow. */
  unknownScenes: string[];
}

interface FileCursor {
  /** Byte offset, matching what the filesystem reports for size. */
  offset: number;
  parser: LogParser;
  /**
   * Kept alive across polls so a UTF-8 sequence split between two reads is decoded
   * correctly rather than turning into a replacement character. Logs contain Cyrillic
   * player nicknames, so this is not hypothetical.
   */
  decoder: TextDecoder;
}

export class LogWatcher {
  private readonly cursors = new Map<string, FileCursor>();
  /** Accumulated per-folder facts, so a poll updates the wipe picture too. */
  private readonly observed = new Map<string, { profileIds: Set<string>; modes: Set<string> }>();

  constructor(private readonly source: LogSource) {}

  private key(folder: string, file: string): string {
    return `${folder}/${file}`;
  }

  private note(folder: string, event: LogEvent): void {
    let entry = this.observed.get(folder);
    if (!entry) this.observed.set(folder, (entry = { profileIds: new Set(), modes: new Set() }));
    if (event.kind === "profile") entry.profileIds.add(event.profileId);
    if (event.kind === "raid-starting" && event.profileId) entry.profileIds.add(event.profileId);
    if (event.kind === "session-mode") entry.modes.add(event.mode);
  }

  /** Session folders on disk, oldest first. */
  async folders(): Promise<LogFolderInfo[]> {
    return sortLogFolders(await this.source.listFolders());
  }

  /**
   * Read one folder from wherever we last stopped.
   *
   * `final` flushes the parser's held-back trailing record, which is correct for a folder
   * that is no longer being written to and wrong for the live one.
   */
  private async readFolder(folder: string, final: boolean): Promise<LogEvent[]> {
    const events: LogEvent[] = [];
    for (const file of await this.source.listFiles(folder)) {
      if (!isWatchedLogFile(file)) continue;
      const key = this.key(folder, file);
      const stat = await this.source.stat(folder, file);
      if (!stat) continue;

      const fresh = (): FileCursor => ({
        offset: 0,
        parser: new LogParser({ folder, source: getLogType(file) }),
        decoder: new TextDecoder("utf-8"),
      });

      let cursor = this.cursors.get(key);
      if (!cursor) this.cursors.set(key, (cursor = fresh()));

      // A shrinking file means the game rotated or truncated it; start over rather than
      // reading from an offset that now points into the middle of a different record.
      if (stat.size < cursor.offset) {
        this.cursors.set(key, (cursor = fresh()));
      }

      if (stat.size > cursor.offset) {
        const bytes = await this.source.readFrom(folder, file, cursor.offset);
        cursor.offset += bytes.byteLength;
        events.push(...cursor.parser.push(cursor.decoder.decode(bytes, { stream: true })));
      }
      if (final) events.push(...cursor.parser.flush());
    }

    for (const event of events) this.note(folder, event);
    return events;
  }

  /**
   * Read every folder once. Folders other than the newest are flushed, since the game is
   * not writing to them any more.
   */
  async scanAll(onProgress?: (progress: ScanProgress) => void): Promise<ScanResult> {
    const folders = await this.folders();
    const events: LogEvent[] = [];

    for (const [index, folder] of folders.entries()) {
      onProgress?.({ folder: folder.name, index, total: folders.length });
      const isNewest = index === folders.length - 1;
      events.push(...(await this.readFolder(folder.name, !isNewest)));
    }

    return { events, observations: this.observations(folders), unknownScenes: [] };
  }

  /** Read whatever the live folder has written since the last call. */
  async poll(): Promise<LogEvent[]> {
    const folders = await this.folders();
    const newest = folders[folders.length - 1];
    if (!newest) return [];
    return this.readFolder(newest.name, false);
  }

  /** Per-folder facts for wipe analysis, from everything read so far. */
  observations(folders?: readonly LogFolderInfo[]): FolderObservation[] {
    const list = folders ?? [];
    return list.map((folder) => {
      const entry = this.observed.get(folder.name);
      return {
        folder,
        profileIds: [...(entry?.profileIds ?? [])],
        sessionModes: [...(entry?.modes ?? [])],
      };
    });
  }

  /** Forget all offsets so the next read starts from the beginning. */
  reset(): void {
    this.cursors.clear();
    this.observed.clear();
  }
}
