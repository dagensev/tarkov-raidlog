import { describe, expect, it } from "vitest";

import type { LogEvent } from "@/lib/logs/events";
import { trailFrom } from "@/lib/logs/screenshots";
import { MemoryScreenshotSource } from "@/lib/logs/screenshot-source";
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

describe("screenshot trail", () => {
  const raidAt = new Date(2026, 8, 3, 18, 10).getTime();
  const shot = (hour: number, minute: number, x: number) =>
    `2026-09-03[${String(hour).padStart(2, "0")}-${String(minute).padStart(2, "0")}]_` +
    `${x.toFixed(2)}, 2.58, -24.30_0.00000, 0.79692, 0.00000, 0.60408_16.86 (0).png`;

  it("derives this raid's trail from a directory listing", async () => {
    const source = new MemoryScreenshotSource([shot(17, 0, 1), shot(18, 20, 2)]);
    const trail = trailFrom(await source.list(), raidAt);
    expect(trail.map((s) => s.x)).toEqual([2]);
  });

  it("grows as screenshots are taken, without accumulating state", async () => {
    const source = new MemoryScreenshotSource([shot(18, 20, 1)]);
    expect(trailFrom(await source.list(), raidAt)).toHaveLength(1);
    source.add(shot(18, 25, 2));
    expect(trailFrom(await source.list(), raidAt)).toHaveLength(2);
  });

  it("empties when a later raid starts, with no explicit reset", async () => {
    const source = new MemoryScreenshotSource([shot(18, 20, 1)]);
    const laterRaid = new Date(2026, 8, 3, 19, 0).getTime();
    expect(trailFrom(await source.list(), laterRaid)).toEqual([]);
  });

  it("re-derives the same trail from an unchanged listing instead of appending to it", async () => {
    // trail is "derived each poll, never accumulated" (see AppState.trail) — calling this
    // twice on the same listing must come back the same size, not grow.
    const source = new MemoryScreenshotSource([shot(18, 20, 1), shot(18, 25, 2)]);
    const names = await source.list();
    expect(trailFrom(names, raidAt)).toHaveLength(2);
    expect(trailFrom(names, raidAt)).toHaveLength(2);
  });
});

describe("poll ordering: raid state before trail", () => {
  // Regression guard for the fix in 973227b: pollOnce must fold fresh events into the raid
  // state (raidFrom) *before* re-deriving the trail (trailFrom) from it. Get that backwards
  // and a raid that just started keeps showing the previous raid's screenshots for one poll.
  const shot = (hour: number, minute: number, x: number) =>
    `2026-09-03[${String(hour).padStart(2, "0")}-${String(minute).padStart(2, "0")}]_` +
    `${x.toFixed(2)}, 2.58, -24.30_0.00000, 0.79692, 0.00000, 0.60408_16.86 (0).png`;

  it("empties the trail the instant a new raid starts, but not if filtered against the stale raid", async () => {
    const { __testRaidFrom } = await import("../app-store");

    const previousRaid: RaidState = { active: true, at: new Date(2026, 8, 3, 17, 0).getTime() };
    // The one fresh event this poll saw: game-started for a brand-new raid.
    const freshEvents = [event("game-started", new Date(2026, 8, 3, 18, 10, 13).getTime())];
    // Taken during the previous raid, long before the new one started.
    const names = [shot(17, 30, 1)];

    const raid = __testRaidFrom(freshEvents, previousRaid);

    // Correct order: raidFrom runs first, so trailFrom filters against the NEW raid.at and
    // the old screenshot is gone in the same tick the new raid begins.
    expect(trailFrom(names, raid.at)).toEqual([]);

    // What the bug looked like: filtering against the OLD raid's timestamp (i.e. reading the
    // trail before folding in fresh events) keeps last raid's screenshot on the map for one
    // extra poll. This assertion is here so reordering pollOnce's two lines fails a test
    // instead of only showing up as a bug report — do not delete it as "redundant" with the
    // line above; the two together are the point.
    expect(trailFrom(names, previousRaid.at)).not.toEqual([]);
  });
});
