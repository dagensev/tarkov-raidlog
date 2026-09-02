import { describe, expect, it } from "vitest";

import type { GroupMemberEvent, RaidStartingEvent, TaskEvent } from "../events";
import { getLogType, isWatchedLogFile, parseLogFolderName, sortLogFolders } from "../log-types";
import { LogParser, LogRecordSplitter, type ParseContext } from "../parse-line";

const notifications: ParseContext = { folder: "log_test", source: "notifications" };
const application: ParseContext = { folder: "log_test", source: "application" };

function parseAll(text: string, ctx: ParseContext = notifications) {
  const parser = new LogParser(ctx);
  return [...parser.push(text), ...parser.flush()];
}

describe("getLogType", () => {
  it("identifies push-notifications as the notifications log", () => {
    // The game renamed this file; matching by suffix is what keeps it working.
    expect(getLogType("2026.09.01_19-27-07_1.1.0.1.46911 push-notifications_000.log")).toBe(
      "notifications",
    );
    expect(getLogType("notifications.log")).toBe("notifications");
  });

  it("identifies the other log types", () => {
    expect(getLogType("2026.09.01 application_000.log")).toBe("application");
    expect(getLogType("2026.09.01 output_000.log")).toBe("output");
    expect(getLogType("2026.09.01 traces_000.log")).toBe("traces");
    expect(getLogType("2026.09.01 backend_000.log")).toBe("unknown");
  });

  it("watches only application and notifications", () => {
    expect(isWatchedLogFile("x application_000.log")).toBe(true);
    expect(isWatchedLogFile("x push-notifications_000.log")).toBe(true);
    // output_000.log is ~2.7 MB of Unity noise per session and carries nothing we use.
    expect(isWatchedLogFile("x output_000.log")).toBe(false);
  });
});

describe("parseLogFolderName", () => {
  it("parses a session folder", () => {
    const info = parseLogFolderName("log_2026.09.01_19-27-07_1.1.0.1.46911");
    expect(info?.gameVersion).toBe("1.1.0.1.46911");
    expect(new Date(info!.startedAt).getFullYear()).toBe(2026);
  });

  it("accepts a single-digit hour, as the game writes it", () => {
    expect(parseLogFolderName("log_2025.11.16_9-55-44_1.0.0.0.41771")).not.toBeNull();
  });

  it("rejects anything that is not a session folder", () => {
    expect(parseLogFolderName("Logs")).toBeNull();
    expect(sortLogFolders(["nope", "log_2026.09.01_19-27-07_1.1.0.1.46911"])).toHaveLength(1);
  });
});

describe("LogRecordSplitter", () => {
  it("attaches a JSON block to its header line", async () => {
    const { USER_CONFIRMED } = await import("./fixtures");
    const splitter = new LogRecordSplitter();
    const records = [...splitter.push(USER_CONFIRMED), ...splitter.flush()];
    expect(records).toHaveLength(1);
    expect(records[0].category).toBe("push-notifications");
    expect((records[0].json as { location: string }).location).toBe("Shoreline");
  });

  it("survives a chunk boundary in the middle of a JSON block", async () => {
    const { USER_CONFIRMED } = await import("./fixtures");
    // This is the case incremental tailing hits constantly and a multiline regex
    // over the whole buffer gets wrong.
    for (const cut of [10, 80, 150, USER_CONFIRMED.length - 5]) {
      const splitter = new LogRecordSplitter();
      const records = [
        ...splitter.push(USER_CONFIRMED.slice(0, cut)),
        ...splitter.push(USER_CONFIRMED.slice(cut)),
        ...splitter.flush(),
      ];
      expect(records, `cut at ${cut}`).toHaveLength(1);
      expect((records[0].json as { location: string }).location).toBe("Shoreline");
    }
  });

  it("emits a record as soon as its JSON closes, without waiting for the next header", async () => {
    const { USER_CONFIRMED } = await import("./fixtures");
    const splitter = new LogRecordSplitter();
    // Trailing newline only; no following header line.
    const records = splitter.push(`${USER_CONFIRMED}\n`);
    expect(records).toHaveLength(1);
  });

  it("splits consecutive plain lines into one record each", async () => {
    const { APP_LINES_V11 } = await import("./fixtures");
    const splitter = new LogRecordSplitter();
    const records = [...splitter.push(APP_LINES_V11), ...splitter.flush()];
    expect(records).toHaveLength(6);
  });

  it("keeps the record when its JSON is malformed", () => {
    const splitter = new LogRecordSplitter();
    const text = '2026-09-01 19:51:04.641|1.1.0.1.46911|Info|push-notifications|Got notification | UserConfirmed\n{\n  "location": \n}';
    const records = [...splitter.push(text), ...splitter.flush()];
    expect(records).toHaveLength(1);
    expect(records[0].json).toBeUndefined();
  });
});

describe("task events", () => {
  it("reads a completed quest from the templateId suffix", async () => {
    const { TASK_FINISHED } = await import("./fixtures");
    const events = parseAll(TASK_FINISHED);
    expect(events).toHaveLength(1);
    const task = events[0] as TaskEvent;
    expect(task.kind).toBe("task");
    expect(task.status).toBe("finished");
    expect(task.taskId).toBe("657315ddab5a49b71f098853");
    expect(task.traderId).toBe("54cb57776803fa99248b456e");
    expect(task.messageType).toBe(12);
    // `dt` is unix seconds and wins over the line timestamp.
    expect(task.timestamp).toBe(1763256663 * 1000);
  });

  it("reads an accepted quest", async () => {
    const { TASK_STARTED } = await import("./fixtures");
    const task = parseAll(TASK_STARTED)[0] as TaskEvent;
    expect(task.status).toBe("started");
    expect(task.taskId).toBe("657315e270bb0b8dba00cc48");
    expect(task.messageType).toBe(10);
  });

  it("ignores trader chatter that is not a quest state change", async () => {
    const { TRADER_CHATTER } = await import("./fixtures");
    // templateId is "<id> 0", which carries no quest status suffix.
    expect(parseAll(TRADER_CHATTER)).toHaveLength(0);
  });
});

describe("raid events", () => {
  it("reads the map from UserConfirmed", async () => {
    const { USER_CONFIRMED } = await import("./fixtures");
    const raid = parseAll(USER_CONFIRMED)[0] as RaidStartingEvent;
    expect(raid.kind).toBe("raid-starting");
    expect(raid.location).toBe("Shoreline");
    expect(raid.shortId).toBe("AAAAAA");
    expect(raid.profileId).toBe("6a8632b90000000000000001");
  });

  it("reads the end of a raid", async () => {
    const { USER_MATCH_OVER } = await import("./fixtures");
    expect(parseAll(USER_MATCH_OVER)[0].kind).toBe("raid-ended");
  });
});

describe("group events", () => {
  it("reads a squadmate from a top-level Info block", async () => {
    const { GROUP_INVITE_ACCEPT } = await import("./fixtures");
    const member = parseAll(GROUP_INVITE_ACCEPT)[0] as GroupMemberEvent;
    expect(member.action).toBe("joined");
    expect(member.nickname).toBe("Squadmate");
    expect(member.side).toBe("Usec");
    expect(member.level).toBe(16);
  });

  it("reads a squadmate from a nested extendedProfile block", async () => {
    const { GROUP_RAID_READY } = await import("./fixtures");
    const member = parseAll(GROUP_RAID_READY)[0] as GroupMemberEvent;
    expect(member.action).toBe("ready");
    expect(member.nickname).toBe("Squadmate");
  });

  it('names the local player "You" when the leave payload omits a nickname', async () => {
    const { GROUP_USER_LEAVE } = await import("./fixtures");
    const member = parseAll(GROUP_USER_LEAVE)[0] as GroupMemberEvent;
    expect(member.action).toBe("left");
    expect(member.nickname).toBe("You");
  });

  it("reads the group's chosen map", async () => {
    const { GROUP_RAID_SETTINGS } = await import("./fixtures");
    const event = parseAll(GROUP_RAID_SETTINGS)[0];
    expect(event).toMatchObject({ kind: "group-raid-settings", location: "Interchange" });
  });
});

describe("application log events", () => {
  it("reads map, session mode, queue time and raid lifecycle", async () => {
    const { APP_LINES_V11 } = await import("./fixtures");
    const events = parseAll(APP_LINES_V11, application);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("map-loading");
    expect(kinds).toContain("session-mode");
    expect(kinds).toContain("queue-completed");
    expect(kinds).toContain("map-loaded");
    expect(kinds).toContain("game-started");
    expect(events.find((e) => e.kind === "map-loading")).toMatchObject({
      scene: "shoreline_preset",
    });
    expect(events.find((e) => e.kind === "queue-completed")).toMatchObject({ seconds: 10.18 });
  });

  it("reads profile ids from both the 1.0.x and 1.1.x line shapes", async () => {
    const { APP_LINES_V10 } = await import("./fixtures");
    const events = parseAll(APP_LINES_V10, application);
    const profiles = events.filter((e) => e.kind === "profile");
    // SelectProfile (gone in 1.1.0) and the raid trace line both yield the id.
    expect(profiles).toHaveLength(2);
    expect(profiles.every((p) => p.profileId === "5e5c26bf000000000000000d")).toBe(true);
    expect(profiles[0]).toMatchObject({ accountId: "1234567" });
  });

  it("parses the 1.0.x timezone offset rather than treating it as local time", async () => {
    const { APP_LINES_V10 } = await import("./fixtures");
    const event = parseAll(APP_LINES_V10, application)[0];
    expect(new Date(event.timestamp).toISOString()).toBe("2025-11-15T21:28:22.869Z");
  });
});
