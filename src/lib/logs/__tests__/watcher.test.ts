import { describe, expect, it } from "vitest";

import type { TaskEvent } from "../events";
import { MemoryLogSource } from "../source";
import { LogWatcher } from "../watcher";
import { USER_CONFIRMED, TASK_FINISHED, APP_LINES_V11 } from "./fixtures";

const NEW = "log_2026.09.01_19-27-07_1.1.0.1.46911";
const OLD = "log_2025.11.15_13-01-25_1.0.0.0.41760";
const NOTIF = "2026.09.01 push-notifications_000.log";
const APP = "2026.09.01 application_000.log";

describe("LogWatcher", () => {
  it("reads every folder on a full scan", async () => {
    const source = new MemoryLogSource({
      [OLD]: { "x push-notifications_000.log": `${TASK_FINISHED}\n` },
      [NEW]: { [NOTIF]: `${USER_CONFIRMED}\n`, [APP]: APP_LINES_V11 },
    });
    const { events } = await new LogWatcher(source).scanAll();
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("task");
    expect(kinds).toContain("raid-starting");
    expect(kinds).toContain("map-loading");
  });

  it("reports scan progress per folder", async () => {
    const source = new MemoryLogSource({
      [OLD]: { [NOTIF]: "" },
      [NEW]: { [NOTIF]: "" },
    });
    const seen: string[] = [];
    await new LogWatcher(source).scanAll((p) => seen.push(`${p.index + 1}/${p.total}`));
    expect(seen).toEqual(["1/2", "2/2"]);
  });

  it("only returns new bytes on a subsequent poll", async () => {
    const source = new MemoryLogSource({ [NEW]: { [NOTIF]: `${USER_CONFIRMED}\n` } });
    const watcher = new LogWatcher(source);

    expect(await watcher.poll()).toHaveLength(1);
    // Nothing changed on disk.
    expect(await watcher.poll()).toHaveLength(0);

    source.append(NEW, NOTIF, `${TASK_FINISHED}\n`);
    const second = await watcher.poll();
    expect(second).toHaveLength(1);
    expect(second[0].kind).toBe("task");
  });

  it("reassembles a JSON block split across two polls", async () => {
    // The case that makes incremental tailing hard: the game writes a notification's
    // opening line, we poll, then it writes the payload.
    const cut = TASK_FINISHED.indexOf('"templateId"');
    const source = new MemoryLogSource({ [NEW]: { [NOTIF]: TASK_FINISHED.slice(0, cut) } });
    const watcher = new LogWatcher(source);

    expect(await watcher.poll()).toHaveLength(0);

    source.append(NEW, NOTIF, `${TASK_FINISHED.slice(cut)}\n`);
    const events = await watcher.poll();
    expect(events).toHaveLength(1);
    expect((events[0] as TaskEvent).taskId).toBe("657315ddab5a49b71f098853");
  });

  it("tails only the newest folder", async () => {
    const source = new MemoryLogSource({
      [OLD]: { [NOTIF]: "" },
      [NEW]: { [NOTIF]: "" },
    });
    const watcher = new LogWatcher(source);
    await watcher.poll();

    // Writing to an old folder is not something the game does, and we should not pay
    // to re-read it every two seconds.
    source.append(OLD, NOTIF, `${TASK_FINISHED}\n`);
    expect(await watcher.poll()).toHaveLength(0);

    source.append(NEW, NOTIF, `${USER_CONFIRMED}\n`);
    expect(await watcher.poll()).toHaveLength(1);
  });

  it("starts over when a file shrinks", async () => {
    const source = new MemoryLogSource({ [NEW]: { [NOTIF]: `${TASK_FINISHED}\n` } });
    const watcher = new LogWatcher(source);
    expect(await watcher.poll()).toHaveLength(1);

    // Truncation would otherwise leave the offset pointing into the middle of a record.
    source.write(NEW, NOTIF, `${USER_CONFIRMED}\n`);
    const events = await watcher.poll();
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("raid-starting");
  });

  it("ignores files that are not the two we watch", async () => {
    const source = new MemoryLogSource({
      [NEW]: {
        "x output_000.log": `${TASK_FINISHED}\n`,
        "x backend_000.log": `${TASK_FINISHED}\n`,
      },
    });
    expect(await new LogWatcher(source).poll()).toHaveLength(0);
  });

  it("ignores directories that are not session folders", async () => {
    const source = new MemoryLogSource({ "not-a-log-folder": { [NOTIF]: `${TASK_FINISHED}\n` } });
    expect(await new LogWatcher(source).poll()).toHaveLength(0);
  });

  it("collects profile ids and session modes for wipe analysis", async () => {
    const source = new MemoryLogSource({
      [NEW]: { [NOTIF]: `${USER_CONFIRMED}\n`, [APP]: APP_LINES_V11 },
    });
    const watcher = new LogWatcher(source);
    const { observations } = await watcher.scanAll();
    const entry = observations.find((o) => o.folder.name === NEW);
    expect(entry?.profileIds).toContain("6a8632b90000000000000001");
    expect(entry?.sessionModes).toContain("PvpSeason");
  });

  it("re-reads from the start after a reset", async () => {
    const source = new MemoryLogSource({ [NEW]: { [NOTIF]: `${TASK_FINISHED}\n` } });
    const watcher = new LogWatcher(source);
    expect(await watcher.poll()).toHaveLength(1);
    watcher.reset();
    expect(await watcher.poll()).toHaveLength(1);
  });
});
