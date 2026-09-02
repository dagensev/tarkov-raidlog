import { describe, expect, it } from "vitest";

import type { LogEvent } from "@/lib/logs/events";
import { RAID_ACTIVE_WINDOW_MS, isRaidActive, type RaidState } from "../app-store";

/**
 * Both cases here were found by running the app against a real log directory, not by
 * reading the code.
 */

const NOW = Date.UTC(2026, 8, 2, 21, 30);

function event(kind: LogEvent["kind"], at: number, extra: Record<string, unknown> = {}): LogEvent {
  return {
    kind,
    timestamp: at,
    source: "application",
    folder: "log_2026.09.02_18-51-00_1.1.0.1.46911",
    gameVersion: "1.1.0.1.46911",
    ...extra,
  } as LogEvent;
}

describe("isRaidActive", () => {
  it("treats a raid that started moments ago as active", () => {
    const raid: RaidState = { active: true, at: NOW - 60_000, scene: "rezerv_base_preset" };
    expect(isRaidActive(raid, NOW)).toBe(true);
  });

  it("still counts a long raid in progress", () => {
    // Reserve runs 40+ minutes and writes nothing between GameStarted and the end.
    const raid: RaidState = { active: true, at: NOW - 45 * 60_000 };
    expect(isRaidActive(raid, NOW)).toBe(true);
  });

  it("does not call a hours-old raid start active", () => {
    // The real failure: the game closed mid-raid so no UserMatchOver was ever written,
    // and a full historical scan replayed that dangling start. The app claimed to be in
    // a raid on Customs two and a half hours later.
    const raid: RaidState = { active: true, at: NOW - 2.5 * 3600_000 };
    expect(isRaidActive(raid, NOW)).toBe(false);
  });

  it("is inactive once a raid-ended has been seen", () => {
    expect(isRaidActive({ active: false, at: NOW }, NOW)).toBe(false);
  });

  it("cuts off just past the window", () => {
    expect(isRaidActive({ active: true, at: NOW - RAID_ACTIVE_WINDOW_MS + 1 }, NOW)).toBe(true);
    expect(isRaidActive({ active: true, at: NOW - RAID_ACTIVE_WINDOW_MS }, NOW)).toBe(false);
  });
});

describe("raid state ordering", () => {
  it("is derived from events in time order, not the order they were read", async () => {
    // Each log file is read whole before the next, so a batch arrives grouped by file.
    // These three are the real events from one session, in the order the watcher
    // produced them: application-log events first, then the notifications-log event
    // that chronologically sits between them.
    const { __testRaidFrom } = await import("../app-store");
    const events = [
      event("map-loading", Date.UTC(2026, 8, 2, 18, 51, 27), { scene: "rezerv_base_preset" }),
      event("game-started", Date.UTC(2026, 8, 2, 18, 54, 13)),
      event("raid-starting", Date.UTC(2026, 8, 2, 18, 51, 40), {
        location: "RezervBase",
        source: "notifications",
      }),
    ];

    const state = __testRaidFrom(events, { active: false, at: 0 });
    // The latest event in time is game-started, so `at` must be its timestamp — not the
    // raid-starting that happened to be processed last.
    expect(state.at).toBe(Date.UTC(2026, 8, 2, 18, 54, 13));
    expect(state.scene).toBe("rezerv_base_preset");
    expect(state.location).toBe("RezervBase");
  });

  it("ends the raid when raid-ended is chronologically last", async () => {
    const { __testRaidFrom } = await import("../app-store");
    const events = [
      event("raid-ended", Date.UTC(2026, 8, 2, 19, 30, 0), { source: "notifications" }),
      event("game-started", Date.UTC(2026, 8, 2, 18, 54, 13)),
    ];
    expect(__testRaidFrom(events, { active: false, at: 0 }).active).toBe(false);
  });
});
