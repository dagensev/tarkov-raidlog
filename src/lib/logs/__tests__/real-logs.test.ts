import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { getLogType, isWatchedLogFile, sortLogFolders, type LogFolderInfo } from "../log-types";
import { LogParser } from "../parse-line";
import { deriveTaskStates } from "../progress";
import { analyzeWipes, type FolderObservation } from "../wipe";
import type { LogEvent } from "../events";

/**
 * End-to-end check against a real Escape from Tarkov log directory.
 *
 * This is the test that proves the parser works on the actual game output rather than on
 * fixtures shaped like it. It self-skips when no log directory is present, so it does
 * nothing in CI or on a machine without the game installed. Point it elsewhere with
 * `EFT_LOGS_DIR`.
 */
const LOGS_DIR =
  process.env.EFT_LOGS_DIR ?? "C:\\Battlestate Games\\Escape from Tarkov\\Logs";

const hasLogs = existsSync(LOGS_DIR);

interface ScanResult {
  events: LogEvent[];
  observations: FolderObservation[];
  folders: LogFolderInfo[];
}

function scan(): ScanResult {
  const folders = sortLogFolders(readdirSync(LOGS_DIR));
  const events: LogEvent[] = [];
  const observations: FolderObservation[] = [];

  for (const folder of folders) {
    const dir = join(LOGS_DIR, folder.name);
    const profileIds = new Set<string>();
    const sessionModes = new Set<string>();

    for (const file of readdirSync(dir)) {
      if (!isWatchedLogFile(file)) continue;
      const parser = new LogParser({ folder: folder.name, source: getLogType(file) });
      const text = readFileSync(join(dir, file), "utf8");
      for (const event of [...parser.push(text), ...parser.flush()]) {
        events.push(event);
        if (event.kind === "profile") profileIds.add(event.profileId);
        if (event.kind === "raid-starting" && event.profileId) profileIds.add(event.profileId);
        if (event.kind === "session-mode") sessionModes.add(event.mode);
      }
    }

    observations.push({
      folder,
      profileIds: [...profileIds],
      sessionModes: [...sessionModes],
    });
  }

  return { events, observations, folders };
}

describe.skipIf(!hasLogs)("real Escape from Tarkov logs", () => {
  const result = hasLogs ? scan() : null!;

  it("parses every session folder without throwing", () => {
    expect(result.folders.length).toBeGreaterThan(0);
    expect(result.events.length).toBeGreaterThan(0);
  });

  it("recovers quest events from the notifications log", () => {
    const taskIds = new Set(
      result.events.filter((e) => e.kind === "task").map((e) => e.taskId),
    );
    // Every task id is a 24-hex BSG id, and there are enough of them to be a real history.
    expect(taskIds.size).toBeGreaterThan(50);
    for (const id of taskIds) expect(id).toMatch(/^[0-9a-f]{24}$/);
  });

  it("sees both quest-accepted and quest-completed events", () => {
    const statuses = new Set(
      result.events.filter((e) => e.kind === "task").map((e) => e.status),
    );
    expect(statuses).toContain("started");
    expect(statuses).toContain("finished");
  });

  it("separates wipes and narrows progress to the current one", () => {
    const wipes = analyzeWipes(result.observations);
    expect(wipes.generations.length).toBeGreaterThanOrEqual(2);
    expect(wipes.current).toBeDefined();

    const current = wipes.current!;
    const currentFolders = new Set(current.folders);
    const taskEvents = result.events.filter((e) => e.kind === "task");
    const inCurrent = taskEvents.filter((e) => currentFolders.has(e.folder));

    // A previous wipe left task events behind, and they are excluded. Comparing
    // *distinct task ids* would prove nothing here: the same early quests get done
    // every wipe, so both sets contain them.
    expect(inCurrent.length).toBeLessThan(taskEvents.length);
    expect(inCurrent.length).toBeGreaterThan(0);

    const states = deriveTaskStates(result.events, { folders: currentFolders });
    expect(states.size).toBeGreaterThan(0);

    // The real invariant: nothing in the derived progress predates the current wipe.
    for (const state of states.values()) {
      expect(state.at).toBeGreaterThanOrEqual(current.createdAt);
    }
  });

  it("keeps out-of-wipe events available rather than discarding them", () => {
    const wipes = analyzeWipes(result.observations);
    const stale = result.events.filter(
      (e) => e.kind === "task" && !wipes.current!.folders.includes(e.folder),
    );
    // Changing the wipe selection must be able to bring these back instantly.
    expect(stale.length).toBeGreaterThan(0);
    const revived = deriveTaskStates(result.events, {
      folders: new Set(wipes.generations[0].folders),
    });
    expect(revived.size).toBeGreaterThan(0);
  });

  it("detects a map for at least one raid", () => {
    const maps = result.events.filter((e) => e.kind === "map-loading");
    const raids = result.events.filter((e) => e.kind === "raid-starting");
    expect(maps.length + raids.length).toBeGreaterThan(0);
  });

  it("reports what it found", () => {
    const wipes = analyzeWipes(result.observations);
    const byKind = new Map<string, number>();
    for (const event of result.events) {
      byKind.set(event.kind, (byKind.get(event.kind) ?? 0) + 1);
    }

    const lines = [
      "",
      `  folders            ${result.folders.length}`,
      `  events             ${result.events.length}`,
      ...[...byKind.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([kind, n]) => `    ${kind.padEnd(17)} ${n}`),
      `  wipe generations   ${wipes.generations.length}`,
      ...wipes.generations.map((g) => {
        const created = new Date(g.createdAt).toISOString().slice(0, 10);
        const from = new Date(g.firstSeenAt).toISOString().slice(0, 10);
        const to = new Date(g.lastSeenAt).toISOString().slice(0, 10);
        const marker = g === wipes.current ? " <- current" : "";
        return `    created ${created}  seen ${from}..${to}  ${g.folders.length} folders  ${g.sessionModes.join("/") || "?"}${marker}`;
      }),
      `  tasks (all logs)   ${deriveTaskStates(result.events).size}`,
      `  tasks (this wipe)  ${deriveTaskStates(result.events, { folders: new Set(wipes.current?.folders ?? []) }).size}`,
      ...wipes.generations.map((g) => {
        const set = new Set(g.folders);
        const evs = result.events.filter((e) => e.kind === "task" && set.has(e.folder));
        const ids = new Set(evs.map((e) => (e.kind === "task" ? e.taskId : "")));
        const created = new Date(g.createdAt).toISOString().slice(0, 10);
        return `    gen ${created}: ${evs.length} task events, ${ids.size} distinct`;
      }),
      "",
    ];
    console.log(lines.join("\n"));
    expect(result.events.length).toBeGreaterThan(0);
  });
});
