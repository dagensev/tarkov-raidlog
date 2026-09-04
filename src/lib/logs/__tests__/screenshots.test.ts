import { describe, expect, it } from "vitest";

import { parseScreenshotName, trailFrom } from "../screenshots";

/**
 * A real screenshot, taken on Customs on 2026-09-03. Its position lands 0.1 m from a
 * player spawn tarkov.dev publishes, which is what makes it worth pinning a test to
 * rather than inventing numbers.
 */
const REAL =
  "2026-09-03[18-15]_356.64, 2.58, -24.30_0.00000, 0.79692, 0.00000, 0.60408_16.86 (0).png";

describe("parseScreenshotName", () => {
  it("reads position and facing from a real file name", () => {
    const shot = parseScreenshotName(REAL);
    expect(shot).not.toBeNull();
    expect(shot!.x).toBeCloseTo(356.64, 2);
    expect(shot!.y).toBeCloseTo(2.58, 2);
    expect(shot!.z).toBeCloseTo(-24.3, 2);
    // Pure Y-axis quaternion, so yaw is 2*atan2(qy, qw).
    expect(shot!.yaw).toBeCloseTo(105.67, 1);
    expect(shot!.name).toBe(REAL);
  });

  it("reads the timestamp as local time, to the minute", () => {
    const shot = parseScreenshotName(REAL)!;
    const at = new Date(shot.takenAt);
    expect(at.getFullYear()).toBe(2026);
    expect(at.getMonth()).toBe(8); // September, zero-indexed
    expect(at.getDate()).toBe(3);
    expect(at.getHours()).toBe(18);
    expect(at.getMinutes()).toBe(15);
  });

  it("handles a negative facing", () => {
    const shot = parseScreenshotName(
      "2026-09-03[18-16]_0.00, 0.00, 0.00_0.00000, -0.70711, 0.00000, 0.70711_16.86 (0).png",
    );
    expect(shot!.yaw).toBeCloseTo(-90, 1);
  });

  it("rejects an operating-system screenshot", () => {
    expect(parseScreenshotName("Screenshot 2026-09-03 181500.png")).toBeNull();
  });

  it("rejects a name with no coordinates", () => {
    expect(parseScreenshotName("2026-09-03[18-15]_bad, data, here (0).png")).toBeNull();
  });

  it("accepts a double-digit screenshot index", () => {
    const shot = parseScreenshotName(
      "2026-09-03[18-15]_356.64, 2.58, -24.30_0.00000, 0.79692, 0.00000, 0.60408_16.86 (10).png",
    );
    expect(shot).not.toBeNull();
    expect(shot!.x).toBeCloseTo(356.64, 2);
  });

  it("rejects a non-png", () => {
    expect(
      parseScreenshotName(
        "2026-09-03[18-15]_356.64, 2.58, -24.30_0.00000, 0.79692, 0.00000, 0.60408_16.86 (0).jpg",
      ),
    ).toBeNull();
  });
});

describe("trailFrom", () => {
  const at = (hour: number, minute: number) =>
    new Date(2026, 8, 3, hour, minute).getTime();

  const shot = (hour: number, minute: number, x: number) =>
    `2026-09-03[${String(hour).padStart(2, "0")}-${String(minute).padStart(2, "0")}]_` +
    `${x.toFixed(2)}, 2.58, -24.30_0.00000, 0.79692, 0.00000, 0.60408_16.86 (0).png`;

  it("keeps only screenshots from the current raid, oldest first", () => {
    const names = [shot(18, 30, 3), shot(17, 0, 1), shot(18, 20, 2)];
    const trail = trailFrom(names, at(18, 10));
    expect(trail.map((s) => s.x)).toEqual([2, 3]);
  });

  it("keeps a screenshot taken in the same minute the raid started", () => {
    // The file name has no seconds, so its timestamp can trail the raid's by up to 59 s.
    const trail = trailFrom([shot(18, 15, 1)], at(18, 15) + 45_000);
    expect(trail).toHaveLength(1);
  });

  it("ignores names it cannot parse", () => {
    const trail = trailFrom(["desktop.ini", shot(18, 20, 1)], at(18, 10));
    expect(trail).toHaveLength(1);
  });

  it("is empty before any raid has started", () => {
    expect(trailFrom([shot(18, 20, 1)], 0)).toEqual([]);
  });
});
