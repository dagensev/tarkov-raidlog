# Objective Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a 2D map on the raid board showing where your held tasks' objectives are, and where you are, decoded from the coordinates Escape from Tarkov writes into screenshot filenames.

**Architecture:** Four pure, fully-tested modules (filename parsing, map projection, pin derivation, a directory-listing port) feed two React components. Nothing new touches the server: the Next.js static export, the Worker and the Durable Object are unchanged. Position data comes from listing a directory — no screenshot file is ever opened.

**Tech Stack:** TypeScript, React 19, Next.js 16 static export, Zustand, Vitest, Tailwind 4. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-03-objective-map-design.md`

## Global Constraints

- **No new npm dependencies.** Leaflet is explicitly not needed; the projection is ~15 lines of arithmetic.
- **Style is per-directory and must be matched exactly.** `src/lib/**` and `src/components/**` use **2-space indent and double quotes**. `src/app/**/page.tsx` uses **4-space indent and single quotes**. Copy the surrounding file.
- **Tests live in `__tests__/` beside the module**, named `<module>.test.ts`. `vitest.config.mts` only collects `src/**/*.test.ts` — a `.tsx` test file will silently never run.
- **Test environment is `node`.** There is no jsdom and no component-testing setup. Do not add one. All logic that needs testing goes in a pure module; components are verified in the browser.
- **Every regex must be non-global.** The codebase reuses regexes across calls and a `/g` flag would carry `lastIndex` between them. See the note atop `src/lib/logs/patterns.ts`.
- **Comments explain why, not what.** Match the density and voice of `src/lib/tarkovdev/maps.ts` and `src/components/map-3d.tsx`.
- Run `npm run typecheck` and `npm run lint` before every commit.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/logs/screenshots.ts` | **Create.** Filename → position. Trail derivation. Pure. |
| `src/lib/logs/screenshot-source.ts` | **Create.** `ScreenshotSource` port + File System Access and in-memory implementations. |
| `src/lib/maps/calibration.ts` | **Create.** Vendored per-map bounds, rotation, SVG path and floor height ranges. |
| `src/lib/maps/project.ts` | **Create.** Game coordinates → fraction of the map image. Floor selection. Pure. |
| `src/lib/maps/pins.ts` | **Create.** Held tasks → pins for one map, with map folding applied. Pure. |
| `src/components/objective-map.tsx` | **Create.** The panel: SVG render, floors, pan/zoom, pins, trail. |
| `src/lib/tarkovdev/raw-types.ts` | **Modify.** Add `zones` to `RawObjective`. |
| `src/lib/tarkovdev/types.ts` | **Modify.** Add `zones` and `possibleLocations` to `TaskObjective`. |
| `src/lib/tarkovdev/client.ts` | **Modify.** `denormalize` passes both through. |
| `src/lib/store/db.ts` | **Modify.** `screenshotDirectory` handle; `showObjectivePins` setting. |
| `src/lib/store/app-store.ts` | **Modify.** Screenshot status, connect actions, trail, poll. |
| `src/components/task-row.tsx` | **Modify.** Accept an `id` so a pin can scroll to its row. |
| `src/app/settings/page.tsx` | **Modify.** Screenshots folder panel. |
| `src/app/raid/page.tsx` | **Modify.** Mount the panel above "Bring these keys". |

Tasks 1–6 are pure and test-driven. Tasks 7–9 are UI and are verified in the browser.

---

### Task 1: Screenshot filename parsing

The game encodes position and facing into the screenshot filename. This module turns one filename into a position, and a directory listing into the current raid's trail.

**Files:**
- Create: `src/lib/logs/screenshots.ts`
- Test: `src/lib/logs/__tests__/screenshots.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface ScreenshotPosition { name: string; takenAt: number; x: number; y: number; z: number; yaw: number | null }`
  - `function parseScreenshotName(name: string): ScreenshotPosition | null`
  - `function trailFrom(names: readonly string[], raidAt: number): ScreenshotPosition[]`

- [ ] **Step 1: Write the failing test**

Create `src/lib/logs/__tests__/screenshots.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/logs/__tests__/screenshots.test.ts
```

Expected: FAIL — `Failed to resolve import "../screenshots"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/logs/screenshots.ts`:

```ts
/**
 * Position from a screenshot file name.
 *
 * Escape from Tarkov writes where you were standing into the name of every screenshot it
 * saves, which is the whole trick behind in-raid position tracking — no memory reading, no
 * overlay, no screen capture. Verified against a real file taken on Customs, whose parsed
 * position lands 0.1 m from a player spawn tarkov.dev publishes:
 *
 *   2026-09-03[18-15]_356.64, 2.58, -24.30_0.00000, 0.79692, 0.00000, 0.60408_16.86 (0).png
 *   └── date ──┘└─t─┘ └─ x, y, z ────────┘ └─ quaternion ─────────────────┘ └fov┘ └n┘
 *
 * The file itself is never opened. Everything here works off the name, which is what keeps
 * polling a folder of thousands of screenshots to a plain directory listing.
 *
 * Ported from TarkovMonitor's `GameWatcher.ScreenshotWatcher_Created`.
 */

/** Splits the name into its date, time and payload. Non-global: reused every poll. */
const NAME_RE = /^(\d{4})-(\d{2})-(\d{2})\[(\d{2})-(\d{2})\]_?(.+) \(\d\)\.png$/;

/**
 * Position and quaternion inside the payload.
 *
 * Position always carries two decimal places, the quaternion five — both confirmed against
 * a real file. The quaternion components are matched loosely enough to accept the `-0.0`
 * and `1.00000` forms the game also emits.
 */
const POSITION_RE =
  /^(-?\d+\.\d{2}), (-?\d+\.\d{2}), (-?\d+\.\d{2})_?(-?[\d.]\.\d{1,5}), (-?[\d.]\.\d{1,5}), (-?[\d.]\.\d{1,5}), (-?[\d.]\.\d{1,5})/;

/**
 * A screenshot's file name can trail the raid's start by up to 59 seconds, because the
 * name records the minute and not the second. Without this grace the first screenshot of a
 * raid is dropped roughly half the time.
 */
const MINUTE_MS = 60_000;

export interface ScreenshotPosition {
  /** The file name, which is also the identity of a trail point. */
  name: string;
  /** Local time from the name, to the minute, as epoch milliseconds. */
  takenAt: number;
  x: number;
  y: number;
  z: number;
  /** Facing in degrees, or null where the quaternion could not be read. */
  yaw: number | null;
}

/**
 * Facing, from the rotation quaternion.
 *
 * The ordinary rotation about Unity's Y axis. TarkovMonitor's version of this declares its
 * parameters `(x, z, y, w)` and is called with `(rx, ry, rz, rw)`, which reads like a
 * deliberate axis swap and is not — following the call through gives exactly this.
 */
function yawFrom(x: number, y: number, z: number, w: number): number {
  const siny = 2 * (w * y + x * z);
  const cosy = 1 - 2 * (y * y + z * z);
  return (Math.atan2(siny, cosy) * 180) / Math.PI;
}

/** Read one screenshot file name, or null when it is not one of the game's. */
export function parseScreenshotName(name: string): ScreenshotPosition | null {
  const outer = NAME_RE.exec(name);
  if (!outer) return null;

  const inner = POSITION_RE.exec(outer[6]);
  if (!inner) return null;

  const [year, month, day, hour, minute] = outer.slice(1, 6).map(Number);
  const [x, y, z, qx, qy, qz, qw] = inner.slice(1).map(Number);

  return {
    name,
    // The game names files in local time, and log timestamps are local too, so the two
    // are directly comparable only if this is built from local components.
    takenAt: new Date(year, month - 1, day, hour, minute).getTime(),
    x,
    y,
    z,
    yaw: yawFrom(qx, qy, qz, qw),
  };
}

/**
 * This raid's screenshots, oldest first.
 *
 * Derived rather than accumulated: every poll re-reads the directory and re-filters it, so
 * there is no growing state to clear, reloading the page mid-raid rebuilds the same trail,
 * and a new raid empties it by moving `raidAt`.
 */
export function trailFrom(names: readonly string[], raidAt: number): ScreenshotPosition[] {
  if (!raidAt) return [];
  const trail: ScreenshotPosition[] = [];
  for (const name of names) {
    const shot = parseScreenshotName(name);
    if (shot && shot.takenAt >= raidAt - MINUTE_MS) trail.push(shot);
  }
  return trail.sort((a, b) => a.takenAt - b.takenAt);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/logs/__tests__/screenshots.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Typecheck, lint and commit**

```bash
npm run typecheck && npm run lint && git add src/lib/logs/screenshots.ts src/lib/logs/__tests__/screenshots.test.ts && git commit -m "Read position out of screenshot file names"
```

---

### Task 2: Map calibration and projection

Turns a game coordinate into a fraction of the map picture. The calibration is vendored from `the-hideout/tarkov-dev`'s `src/data/maps.json`, following the precedent in `maps-3d.ts`.

**Files:**
- Create: `src/lib/maps/calibration.ts`
- Create: `src/lib/maps/project.ts`
- Test: `src/lib/maps/__tests__/project.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface MapFloor { name: string; svgLayer: string; height: readonly [number, number] }`
  - `interface MapCalibration { svgPath, svgLayer, bounds, svgBounds?, coordinateRotation, heightRange, floors }`
  - `function calibrationFor(map: { normalizedName: string } | null | undefined): MapCalibration | null`
  - `interface MapPoint { u: number; v: number }`
  - `function project(calibration: MapCalibration, point: { x: number; z: number }): MapPoint`
  - `function floorFor(calibration: MapCalibration, y: number): MapFloor | null`

- [ ] **Step 1: Write the calibration table**

Create `src/lib/maps/calibration.ts`. These values are copied from tarkov-dev's `src/data/maps.json`, taking the `interactive` variant of each map.

```ts
/**
 * Where a game coordinate falls on tarkov.dev's map drawings.
 *
 * Not part of the JSON API — this lives in `src/data/maps.json` in the-hideout/tarkov-dev,
 * alongside the SVGs on assets.tarkov.dev. Vendored rather than fetched for the same
 * reason as `maps-3d.ts`: thirteen entries of static data that change only when somebody
 * redraws a map, against a third-party dependency, a CORS surface and a failure mode on
 * every page load.
 *
 * Only the ten maps with an SVG are here. The Lab, The Labyrinth and Icebreaker publish
 * raster tiles instead, which this does not render — the panel hides itself for those,
 * the same way `Map3d` hides itself for a map nobody has drawn in 3D.
 *
 * `live-svg.test.ts` checks each SVG's aspect ratio against these bounds, so a redraw
 * fails a test rather than silently sliding every pin.
 *
 * To refresh: pull that maps.json and re-read `bounds`, `svgBounds`, `coordinateRotation`,
 * `svgPath`, `svgLayer`, `heightRange` and `layers` for each map whose `projection` is
 * `interactive`.
 */

export interface MapFloor {
  /** Shown in the floor switcher. */
  name: string;
  /** `id` of the `<g>` in the SVG this floor draws. */
  svgLayer: string;
  /** Height band, as `[bottom, top]`, matched against a position's `y`. */
  height: readonly [number, number];
}

export interface MapCalibration {
  svgPath: string;
  /** The `<g>` drawn as the base. Not always `Ground_Level` — Factory says `Ground_Floor`. */
  svgLayer: string;
  /** Marker space, as `[[x, z], [x, z]]`. */
  bounds: readonly [readonly [number, number], readonly [number, number]];
  /** Picture space, where it differs from marker space. Reserve is the only such map. */
  svgBounds?: readonly [readonly [number, number], readonly [number, number]];
  /** Degrees. Always a multiple of 90, which is why a rotated rectangle stays a rectangle. */
  coordinateRotation: number;
  /** Height band of the base layer, or null where the map publishes none. */
  heightRange: readonly [number, number] | null;
  floors: readonly MapFloor[];
}

/**
 * Keyed by `GameMap.normalizedName`.
 *
 * Floors without an `svgLayer` in the source data are dropped: tarkov.dev uses those to
 * dim markers by height, but there is no `<g>` to draw, so offering them in a switcher
 * would be a control that changes nothing. That removes Customs' "4th Floor" and
 * Reserve's "5th Floor".
 */
export const MAP_CALIBRATION: Readonly<Record<string, MapCalibration>> = {
  "streets-of-tarkov": {
    svgPath: "https://assets.tarkov.dev/maps/svg/StreetsOfTarkov.svg",
    svgLayer: "Ground_Level",
    bounds: [
      [323, -295],
      [-280, 532],
    ],
    coordinateRotation: 180,
    heightRange: [-6, 10],
    floors: [
      { name: "2nd Floor", svgLayer: "Second_Floor", height: [10, 15] },
      { name: "3rd Floor", svgLayer: "Third_Floor", height: [15, 20] },
      { name: "4th Floor", svgLayer: "Fourth_Floor", height: [20, 25] },
      { name: "5th Floor", svgLayer: "Fifth_Floor", height: [25, 10000] },
      { name: "Underground", svgLayer: "Underground_Level", height: [-10000, -6] },
    ],
  },
  "ground-zero": {
    svgPath: "https://assets.tarkov.dev/maps/svg/GroundZero.svg",
    svgLayer: "Ground_Level",
    bounds: [
      [249, -124],
      [-99, 364],
    ],
    coordinateRotation: 180,
    heightRange: [-1000, 28],
    floors: [
      { name: "3rd Floor", svgLayer: "Third_Floor", height: [32.3, 1000] },
      { name: "Garage", svgLayer: "Underground_Level", height: [-1000, 21] },
    ],
  },
  customs: {
    svgPath: "https://assets.tarkov.dev/maps/svg/Customs.svg",
    svgLayer: "Ground_Level",
    bounds: [
      [698, -307],
      [-372, 237],
    ],
    coordinateRotation: 180,
    heightRange: [-1000, 1000],
    floors: [{ name: "Underground", svgLayer: "Underground_Level", height: [-1000, 0.5] }],
  },
  factory: {
    svgPath: "https://assets.tarkov.dev/maps/svg/Factory.svg",
    svgLayer: "Ground_Floor",
    bounds: [
      [77, -64.5],
      [-65.5, 67.4],
    ],
    coordinateRotation: 90,
    heightRange: [-1, 3],
    floors: [
      { name: "2nd Floor", svgLayer: "Second_Floor", height: [3, 6] },
      { name: "3rd Floor", svgLayer: "Third_Floor", height: [6, 10000] },
      { name: "Tunnels", svgLayer: "Basement", height: [-10000, -1] },
    ],
  },
  interchange: {
    svgPath: "https://assets.tarkov.dev/maps/svg/Interchange.svg",
    svgLayer: "Ground_Level",
    bounds: [
      [598, -442],
      [-433, 426],
    ],
    coordinateRotation: 180,
    heightRange: null,
    floors: [
      { name: "2nd Floor", svgLayer: "First_Floor", height: [25, 34] },
      { name: "3rd Floor", svgLayer: "Second_Floor", height: [34, 1000] },
    ],
  },
  lighthouse: {
    svgPath: "https://assets.tarkov.dev/maps/svg/Lighthouse.svg",
    svgLayer: "Ground_Level",
    bounds: [
      [515, -998],
      [-545, 725],
    ],
    coordinateRotation: 180,
    heightRange: null,
    floors: [],
  },
  reserve: {
    svgPath: "https://assets.tarkov.dev/maps/svg/Reserve.svg",
    svgLayer: "Ground_Level",
    bounds: [
      [289, -293],
      [-303, 244],
    ],
    svgBounds: [
      [289, -274],
      [-303, 272],
    ],
    coordinateRotation: 180,
    heightRange: [-7, 10000],
    floors: [],
  },
  shoreline: {
    svgPath: "https://assets.tarkov.dev/maps/svg/Shoreline.svg",
    svgLayer: "Ground_Level",
    bounds: [
      [504, -415],
      [-1056, 618],
    ],
    coordinateRotation: 180,
    heightRange: [-1000, -1],
    floors: [
      { name: "2nd Floor", svgLayer: "Second_Floor", height: [-1, 2] },
      { name: "3rd Floor", svgLayer: "Third_Floor", height: [2, 1000] },
      { name: "Underground", svgLayer: "Underground_Level", height: [-1000, -5] },
    ],
  },
  terminal: {
    svgPath: "https://assets.tarkov.dev/maps/svg/Terminal.svg",
    svgLayer: "Ground_Level",
    bounds: [
      [463, -580],
      [-433, 475],
    ],
    coordinateRotation: 180,
    heightRange: null,
    floors: [],
  },
  woods: {
    svgPath: "https://assets.tarkov.dev/maps/svg/Woods.svg",
    svgLayer: "Ground_Level",
    bounds: [
      [646, -914],
      [-761, 442],
    ],
    coordinateRotation: 180,
    heightRange: null,
    floors: [],
  },
};

/** Calibration for a map, or null where nobody has drawn an SVG for it. */
export function calibrationFor(
  map: { normalizedName: string } | null | undefined,
): MapCalibration | null {
  return (map && MAP_CALIBRATION[map.normalizedName]) ?? null;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/maps/__tests__/project.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { MAP_CALIBRATION, calibrationFor } from "../calibration";
import { floorFor, project } from "../project";

describe("project", () => {
  it("places a real Customs screenshot where it was taken", () => {
    // From the 2026-09-03 screenshot: 0.1 m from a published player spawn.
    const point = project(MAP_CALIBRATION.customs, { x: 356.64, z: -24.3 });
    expect(point.u).toBeCloseTo(0.319, 2);
    expect(point.v).toBeCloseTo(0.48, 2);
  });

  it("puts the bounds corners at the corners", () => {
    for (const [key, calibration] of Object.entries(MAP_CALIBRATION)) {
      const box = calibration.svgBounds ?? calibration.bounds;
      const corners = [
        project(calibration, { x: box[0][0], z: box[0][1] }),
        project(calibration, { x: box[1][0], z: box[1][1] }),
      ];
      const us = corners.map((c) => c.u).sort((a, b) => a - b);
      const vs = corners.map((c) => c.v).sort((a, b) => a - b);
      expect(us[0], key).toBeCloseTo(0, 6);
      expect(us[1], key).toBeCloseTo(1, 6);
      expect(vs[0], key).toBeCloseTo(0, 6);
      expect(vs[1], key).toBeCloseTo(1, 6);
    }
  });

  it("keeps the centre of the map at the centre", () => {
    const { bounds } = MAP_CALIBRATION.woods;
    const point = project(MAP_CALIBRATION.woods, {
      x: (bounds[0][0] + bounds[1][0]) / 2,
      z: (bounds[0][1] + bounds[1][1]) / 2,
    });
    expect(point.u).toBeCloseTo(0.5, 6);
    expect(point.v).toBeCloseTo(0.5, 6);
  });

  it("uses svgBounds where the map publishes them", () => {
    // Reserve's picture is taller than its marker box, so the two disagree on purpose.
    const reserve = MAP_CALIBRATION.reserve;
    expect(reserve.svgBounds).toBeDefined();
    const atMarkerEdge = project(reserve, { x: 289, z: 244 });
    expect(atMarkerEdge.v).toBeGreaterThan(0);
    expect(atMarkerEdge.v).toBeLessThan(1);
  });
});

describe("floorFor", () => {
  it("picks the floor whose height band contains the position", () => {
    const streets = MAP_CALIBRATION["streets-of-tarkov"];
    expect(floorFor(streets, 17)?.svgLayer).toBe("Third_Floor");
    expect(floorFor(streets, -20)?.svgLayer).toBe("Underground_Level");
  });

  it("returns null at ground level", () => {
    expect(floorFor(MAP_CALIBRATION["streets-of-tarkov"], 2)).toBeNull();
  });

  it("returns null for a map with no floors", () => {
    expect(floorFor(MAP_CALIBRATION.woods, 50)).toBeNull();
  });
});

describe("calibrationFor", () => {
  it("finds a map by normalized name", () => {
    expect(calibrationFor({ normalizedName: "customs" })).toBe(MAP_CALIBRATION.customs);
  });

  it("is null for a map with no drawing, and for no map", () => {
    expect(calibrationFor({ normalizedName: "the-lab" })).toBeNull();
    expect(calibrationFor(null)).toBeNull();
    expect(calibrationFor(undefined)).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run src/lib/maps/__tests__/project.test.ts
```

Expected: FAIL — `Failed to resolve import "../project"`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/maps/project.ts`:

```ts
import type { MapCalibration, MapFloor } from "./calibration";

/**
 * Game coordinates onto a map drawing.
 *
 * tarkov.dev does this with a Leaflet CRS built from `transform` and `coordinateRotation`.
 * The `transform` looks essential and is not: the picture and the markers project through
 * the same CRS, so it cancels out of anything positioned *relative to the picture*. What
 * is left is a rotation and a normalisation against the map's bounds, which is this file
 * and needs no map library at all.
 *
 * Checked two ways before being written: ~2,600 published spawn and extract positions land
 * inside bounds on eleven of thirteen maps, and every SVG's aspect ratio matches its
 * rotated bounds to better than 1%.
 */

export interface MapPoint {
  /** Fraction across the picture from its left edge, 0 to 1. */
  u: number;
  /** Fraction down the picture from its top edge, 0 to 1. */
  v: number;
}

/** Rotate a point about the origin. Rotations are multiples of 90°, so a box stays a box. */
function rotate(x: number, z: number, degrees: number): [number, number] {
  if (!degrees) return [x, z];
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [x * cos - z * sin, x * sin + z * cos];
}

/** Where a game position falls on the map picture. Values outside 0–1 are off the map. */
export function project(
  calibration: MapCalibration,
  point: { x: number; z: number },
): MapPoint {
  const box = calibration.svgBounds ?? calibration.bounds;
  const rotation = calibration.coordinateRotation;

  const [ax, az] = rotate(box[0][0], box[0][1], rotation);
  const [bx, bz] = rotate(box[1][0], box[1][1], rotation);
  const [px, pz] = rotate(point.x, point.z, rotation);

  const minX = Math.min(ax, bx);
  const minZ = Math.min(az, bz);

  return {
    u: (px - minX) / Math.abs(bx - ax),
    v: (pz - minZ) / Math.abs(bz - az),
  };
}

/**
 * The floor a height falls on, or null for the base layer.
 *
 * Bands are half-open at the top so a position exactly on a boundary picks the lower
 * floor, which is where you are standing rather than the one above your head.
 */
export function floorFor(calibration: MapCalibration, y: number): MapFloor | null {
  for (const floor of calibration.floors) {
    if (y >= floor.height[0] && y < floor.height[1]) return floor;
  }
  return null;
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run src/lib/maps/__tests__/project.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 6: Typecheck, lint and commit**

```bash
npm run typecheck && npm run lint && git add src/lib/maps/ && git commit -m "Project game coordinates onto tarkov.dev's map drawings"
```

---

### Task 3: Carry objective coordinates through the data layer

The coordinates are already cached in every user's IndexedDB — `loadCoreBundle` stores `RawTask` whole. They are lost at the last step, because `denormalize` copies objectives field by field. This task stops dropping them.

**Files:**
- Modify: `src/lib/tarkovdev/raw-types.ts` (add `zones` to `RawObjective`, around line 48)
- Modify: `src/lib/tarkovdev/types.ts` (add to `TaskObjective`, around line 54)
- Modify: `src/lib/tarkovdev/client.ts` (`denormalize`, around line 307)
- Test: `src/lib/tarkovdev/__tests__/client.test.ts` (extend)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface ObjectiveZone { id, map, position, size, outline, top, bottom }` on `TaskObjective.zones`
  - `interface ObjectiveLocations { map: string; positions: GamePosition[] }` on `TaskObjective.possibleLocations`
  - `interface GamePosition { x: number; y: number; z: number }`

- [ ] **Step 1: Add the raw types**

In `src/lib/tarkovdev/raw-types.ts`, add above `RawObjective`:

```ts
/** A point in the game world. */
export interface GamePosition {
  x: number;
  y: number;
  z: number;
}

/**
 * A volume an objective happens in — a stash spot, an area to visit.
 *
 * `outline` is the footprint as a polygon, which is what makes "plant it in this area"
 * drawable as an area rather than a dot.
 */
export interface RawObjectiveZone {
  id: string;
  /** Map id. */
  map: string;
  position: GamePosition;
  size?: GamePosition;
  outline?: GamePosition[];
  top?: number;
  bottom?: number;
}
```

Then add one field to `RawObjective`, immediately after the existing `possibleLocations` line:

```ts
  zones?: RawObjectiveZone[];
```

- [ ] **Step 2: Add the denormalized types**

In `src/lib/tarkovdev/types.ts`, add above `TaskObjective`:

```ts
/** A point in the game world. */
export interface GamePosition {
  x: number;
  y: number;
  z: number;
}

/** A volume an objective happens in. `map` is a map id. */
export interface ObjectiveZone {
  id: string;
  map: string;
  position: GamePosition;
  outline: GamePosition[] | null;
  top: number | null;
  bottom: number | null;
}

/** Candidate spots for one quest item. `map` is a map id. */
export interface ObjectiveLocations {
  map: string;
  positions: GamePosition[];
}
```

Then add two fields to `TaskObjective`, after `trader`:

```ts
  /** Where this objective happens. Empty for the 873 objectives with nowhere to point. */
  zones: ObjectiveZone[];
  /** Where a quest item may be found. Empty unless this is a `findQuestItem`. */
  possibleLocations: ObjectiveLocations[];
```

- [ ] **Step 3: Write the failing test**

Append to `src/lib/tarkovdev/__tests__/client.test.ts`, inside the existing `describe("denormalize")` block. That file already has a `bundle(): CoreBundle` fixture at line 91 returning tasks `t1` and `t0`; these reuse it rather than building a second one, following the `denormalize(bundle()).tasks.find((t) => t.id === "t1")!` pattern the neighbouring tests use.

```ts
  it("carries objective zones and possible locations through", () => {
    const raw = bundle();
    raw.tasks.t1.objectives[0].zones = [
      {
        id: "z1",
        map: "map1",
        position: { x: 1, y: 2, z: 3 },
        outline: [
          { x: 0, y: 2, z: 0 },
          { x: 2, y: 2, z: 0 },
        ],
        top: 5,
        bottom: 1,
      },
    ];
    raw.tasks.t1.objectives[0].possibleLocations = [
      { map: "map1", positions: [{ x: 9, y: 8, z: 7 }] },
    ];

    const objective = denormalize(raw).tasks.find((t) => t.id === "t1")!.objectives[0];
    expect(objective.zones).toHaveLength(1);
    expect(objective.zones[0].position).toEqual({ x: 1, y: 2, z: 3 });
    expect(objective.zones[0].outline).toHaveLength(2);
    expect(objective.zones[0].top).toBe(5);
    expect(objective.possibleLocations[0].positions[0]).toEqual({ x: 9, y: 8, z: 7 });
  });

  it("gives an objective with no geometry empty arrays, not undefined", () => {
    // The fixture's objective has neither, which is the common case: 873 of 1398 real
    // objectives have nowhere to point.
    const objective = denormalize(bundle()).tasks.find((t) => t.id === "t1")!.objectives[0];
    expect(objective.zones).toEqual([]);
    expect(objective.possibleLocations).toEqual([]);
  });
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
npx vitest run src/lib/tarkovdev/__tests__/client.test.ts
```

Expected: FAIL — `zones` is `undefined`.

- [ ] **Step 5: Pass both through in `denormalize`**

In `src/lib/tarkovdev/client.ts`, in the objectives mapping (around line 307), add after `shotType: null,`:

```ts
      // Already cached: `loadCoreBundle` keeps `RawTask` whole, so these arrived with the
      // bundle and were being dropped here rather than never fetched. Normalised to arrays
      // so every consumer can iterate without a null check.
      zones: (objective.zones ?? []).map((zone) => ({
        id: zone.id,
        map: zone.map,
        position: zone.position,
        outline: zone.outline ?? null,
        top: zone.top ?? null,
        bottom: zone.bottom ?? null,
      })),
      possibleLocations: (objective.possibleLocations ?? []).map((entry) => ({
        map: entry.map,
        positions: entry.positions ?? [],
      })),
```

- [ ] **Step 6: Run the full test suite**

```bash
npm test
```

Expected: PASS. Existing `denormalize` tests must still pass — this only adds fields.

- [ ] **Step 7: Typecheck, lint and commit**

```bash
npm run typecheck && npm run lint && git add src/lib/tarkovdev/ && git commit -m "Stop dropping objective coordinates in denormalize"
```

---

### Task 4: Derive objective pins for a map

Turns the tasks you are holding into a flat list of things to draw. The map-folding step here is load-bearing: Night Factory carries 64 pins across 20 tasks under its own map id, and the app shows it as Factory.

**Files:**
- Create: `src/lib/maps/pins.ts`
- Test: `src/lib/maps/__tests__/pins.test.ts`

**Interfaces:**
- Consumes: `Task`, `TaskObjective`, `GamePosition` from `src/lib/tarkovdev/types.ts`; `foldedMapIds` from `src/lib/tarkovdev/maps.ts`.
- Produces:
  - `interface ObjectivePin { key, taskId, taskName, objectiveId, description, kind, position, outline }`
  - `function objectivePins(tasks: readonly Task[], mapId: string, folded: ReadonlyMap<string, string>): ObjectivePin[]`

- [ ] **Step 1: Write the failing test**

Create `src/lib/maps/__tests__/pins.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { Task } from "@/lib/tarkovdev/types";
import { objectivePins } from "../pins";

const position = (x: number) => ({ x, y: 0, z: 0 });

function task(id: string, name: string, objectives: Task["objectives"]): Task {
  return {
    id,
    name,
    normalizedName: id,
    experience: 0,
    minPlayerLevel: null,
    kappaRequired: null,
    lightkeeperRequired: null,
    factionName: "Any",
    wikiLink: null,
    trader: null,
    map: null,
    taskRequirements: [],
    traderRequirements: [],
    objectives,
    neededKeys: [],
  } as unknown as Task;
}

function objective(
  id: string,
  description: string,
  zones: Task["objectives"][number]["zones"],
  possibleLocations: Task["objectives"][number]["possibleLocations"] = [],
): Task["objectives"][number] {
  return {
    id,
    description,
    type: "plantItem",
    optional: false,
    maps: [],
    __typename: "plantItem",
    zones,
    possibleLocations,
  } as unknown as Task["objectives"][number];
}

const zone = (map: string, x: number) => ({
  id: `z-${map}-${x}`,
  map,
  position: position(x),
  outline: null,
  top: null,
  bottom: null,
});

describe("objectivePins", () => {
  it("returns one pin per zone on the map", () => {
    const tasks = [
      task("t1", "Task One", [objective("o1", "Plant it", [zone("customs", 1), zone("customs", 2)])]),
    ];
    const pins = objectivePins(tasks, "customs", new Map());
    expect(pins).toHaveLength(2);
    expect(pins[0].taskName).toBe("Task One");
    expect(pins[0].description).toBe("Plant it");
    expect(pins[0].kind).toBe("zone");
  });

  it("ignores zones on other maps", () => {
    const tasks = [task("t1", "Task One", [objective("o1", "Plant it", [zone("woods", 1)])])];
    expect(objectivePins(tasks, "customs", new Map())).toEqual([]);
  });

  it("follows a folded map id, so Night Factory objectives land on Factory", () => {
    const tasks = [
      task("t1", "Task One", [objective("o1", "Plant it", [zone("night-factory", 1)])]),
    ];
    const folded = new Map([["night-factory", "factory"]]);
    expect(objectivePins(tasks, "factory", folded)).toHaveLength(1);
  });

  it("returns one pin per candidate location", () => {
    const tasks = [
      task("t1", "Task One", [
        objective("o1", "Find it", [], [
          { map: "customs", positions: [position(1), position(2), position(3)] },
        ]),
      ]),
    ];
    const pins = objectivePins(tasks, "customs", new Map());
    expect(pins).toHaveLength(3);
    expect(pins.every((pin) => pin.kind === "location")).toBe(true);
  });

  it("carries an outline through when the zone has one", () => {
    const outlined = {
      ...zone("customs", 1),
      outline: [position(0), position(2), position(4)],
    };
    const tasks = [task("t1", "Task One", [objective("o1", "Plant it", [outlined])])];
    expect(objectivePins(tasks, "customs", new Map())[0].outline).toHaveLength(3);
  });

  it("gives every pin a distinct key", () => {
    const tasks = [
      task("t1", "Task One", [objective("o1", "Plant it", [zone("customs", 1), zone("customs", 2)])]),
      task("t2", "Task Two", [
        objective("o2", "Find it", [], [{ map: "customs", positions: [position(1), position(2)] }]),
      ]),
    ];
    const keys = objectivePins(tasks, "customs", new Map()).map((pin) => pin.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("skips objectives with no geometry", () => {
    const tasks = [task("t1", "Task One", [objective("o1", "Hand it over", [])])];
    expect(objectivePins(tasks, "customs", new Map())).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/maps/__tests__/pins.test.ts
```

Expected: FAIL — `Failed to resolve import "../pins"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/maps/pins.ts`:

```ts
import type { GamePosition, Task } from "@/lib/tarkovdev/types";

/**
 * Objectives to draw on one map.
 *
 * Flattened to one entry per thing drawn rather than per objective, because an objective
 * can name several zones and a quest item several candidate spots, and each of those is
 * its own mark on the map.
 */

export interface ObjectivePin {
  /** Stable and unique across a map's pins, for React keys. */
  key: string;
  taskId: string;
  taskName: string;
  objectiveId: string;
  description: string;
  /** `zone` is somewhere an objective happens; `location` is a candidate spot for an item. */
  kind: "zone" | "location";
  position: GamePosition;
  /** Footprint polygon, where the zone publishes one. */
  outline: GamePosition[] | null;
}

/**
 * Pins for one map, from the tasks you are holding.
 *
 * `folded` must be `foldedMapIds(maps)`. Without it every Night Factory objective vanishes:
 * the app shows Night Factory as Factory and rewrites task references accordingly, but the
 * ids inside `zone.map` are raw API data and still say `night-factory` — 64 pins across 20
 * tasks, on a map that is only ever displayed as Factory.
 */
export function objectivePins(
  tasks: readonly Task[],
  mapId: string,
  folded: ReadonlyMap<string, string>,
): ObjectivePin[] {
  const shownAs = (id: string): string => folded.get(id) ?? id;
  const pins: ObjectivePin[] = [];

  for (const task of tasks) {
    for (const objective of task.objectives) {
      for (const zone of objective.zones) {
        if (shownAs(zone.map) !== mapId) continue;
        pins.push({
          key: `${objective.id}:zone:${zone.id}`,
          taskId: task.id,
          taskName: task.name,
          objectiveId: objective.id,
          description: objective.description,
          kind: "zone",
          position: zone.position,
          outline: zone.outline,
        });
      }

      for (const entry of objective.possibleLocations) {
        if (shownAs(entry.map) !== mapId) continue;
        entry.positions.forEach((position, index) => {
          pins.push({
            key: `${objective.id}:loc:${entry.map}:${index}`,
            taskId: task.id,
            taskName: task.name,
            objectiveId: objective.id,
            description: objective.description,
            kind: "location",
            position,
            outline: null,
          });
        });
      }
    }
  }

  return pins;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/maps/__tests__/pins.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Typecheck, lint and commit**

```bash
npm run typecheck && npm run lint && git add src/lib/maps/pins.ts src/lib/maps/__tests__/pins.test.ts && git commit -m "Derive objective pins for a map, folding Night Factory into Factory"
```

---

### Task 5: The screenshot directory port

A one-method port, mirroring how `LogSource` keeps the log watcher testable outside a browser.

**Files:**
- Create: `src/lib/logs/screenshot-source.ts`
- Test: `src/lib/logs/__tests__/screenshot-source.test.ts`

**Interfaces:**
- Consumes: `isFileSystemAccessSupported`, `checkPermission`, `requestPermission` from `src/lib/logs/fs-access-source.ts`.
- Produces:
  - `interface ScreenshotSource { list(): Promise<string[]> }`
  - `class FileSystemAccessScreenshotSource implements ScreenshotSource`
  - `class MemoryScreenshotSource implements ScreenshotSource`
  - `function pickScreenshotDirectory(): Promise<FileSystemDirectoryHandle>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/logs/__tests__/screenshot-source.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { MemoryScreenshotSource } from "../screenshot-source";

describe("MemoryScreenshotSource", () => {
  it("lists the names it was given", async () => {
    const source = new MemoryScreenshotSource(["a.png", "b.png"]);
    await expect(source.list()).resolves.toEqual(["a.png", "b.png"]);
  });

  it("reflects names added after construction", async () => {
    const source = new MemoryScreenshotSource();
    source.add("later.png");
    await expect(source.list()).resolves.toEqual(["later.png"]);
  });

  it("starts empty", async () => {
    await expect(new MemoryScreenshotSource().list()).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/logs/__tests__/screenshot-source.test.ts
```

Expected: FAIL — `Failed to resolve import "../screenshot-source"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/logs/screenshot-source.ts`:

```ts
import { isFileSystemAccessSupported } from "./fs-access-source";

/**
 * Where screenshot file names come from.
 *
 * Deliberately not a `LogSource`. That port is shaped around byte-offset tailing — `stat`,
 * `readFrom`, folder-then-file addressing — and none of it means anything here, because
 * the position is in the *name* and no screenshot is ever opened. One method is the whole
 * requirement, and keeping it to one method is what makes the difference between a poll
 * that lists a directory and a poll that opens a thousand files to read their timestamps.
 */
export interface ScreenshotSource {
  /** File names in the screenshots directory. Names only: nothing is opened. */
  list(): Promise<string[]>;
}

/** Ask the user for the game's `Screenshots` directory. Must be called from a user gesture. */
export async function pickScreenshotDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!isFileSystemAccessSupported()) {
    throw new Error(
      "This browser cannot read local folders. Raidlog needs Chrome or Edge to show your position.",
    );
  }
  return window.showDirectoryPicker!({ id: "eft-screenshots", mode: "read" });
}

export class FileSystemAccessScreenshotSource implements ScreenshotSource {
  constructor(private readonly root: FileSystemDirectoryHandle) {}

  async list(): Promise<string[]> {
    const names: string[] = [];
    for await (const entry of this.root.values()) {
      // Only `.png` reaches the parser anyway, but filtering here keeps a folder that also
      // holds videos or thumbnails from being walked into the regex on every poll.
      if (entry.kind === "file" && entry.name.toLowerCase().endsWith(".png")) {
        names.push(entry.name);
      }
    }
    return names;
  }
}

/** In-memory source for tests. */
export class MemoryScreenshotSource implements ScreenshotSource {
  private readonly names: string[];

  constructor(initial: readonly string[] = []) {
    this.names = [...initial];
  }

  /** Add a name, as taking a screenshot would. */
  add(name: string): void {
    this.names.push(name);
  }

  async list(): Promise<string[]> {
    return [...this.names];
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/logs/__tests__/screenshot-source.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Typecheck, lint and commit**

```bash
npm run typecheck && npm run lint && git add src/lib/logs/screenshot-source.ts src/lib/logs/__tests__/screenshot-source.test.ts && git commit -m "Add a screenshot directory port"
```

---

### Task 6: Wire screenshots into the store and settings

Persists the directory handle, adds the connect/reconnect actions mirroring the log ones, derives the trail on each poll, and gives the user somewhere to grant the folder.

**Files:**
- Modify: `src/lib/store/db.ts` (`Settings` around line 24, `StoredValues` around line 45)
- Modify: `src/lib/store/app-store.ts` (`AppState` around line 49, actions around line 206, poll around line 339)
- Modify: `src/app/settings/page.tsx`
- Test: `src/lib/store/__tests__/raid-state.test.ts` (extend)

**Interfaces:**
- Consumes: `trailFrom`, `ScreenshotPosition` (Task 1); `FileSystemAccessScreenshotSource`, `MemoryScreenshotSource`, `pickScreenshotDirectory` (Task 5); `checkPermission`, `requestPermission` from `fs-access-source.ts`.
- Produces:
  - `AppState.screenshotStatus: LogStatus`, `AppState.screenshotError: string | null`, `AppState.trail: ScreenshotPosition[]`
  - `AppState.connectScreenshots(): Promise<void>`, `AppState.reconnectScreenshots(): Promise<void>`
  - `Settings.showObjectivePins: boolean`
  - `StoredValues.screenshotDirectory: FileSystemDirectoryHandle`

- [ ] **Step 1: Extend the storage types**

In `src/lib/store/db.ts`, add to `Settings`:

```ts
  /** Whether objective pins are drawn on the raid map. */
  showObjectivePins: boolean;
```

and to `DEFAULT_SETTINGS`:

```ts
  showObjectivePins: true,
```

and to `StoredValues`:

```ts
  /** The game's `Screenshots` folder. A different root from the logs, so it is picked apart. */
  screenshotDirectory: FileSystemDirectoryHandle;
```

- [ ] **Step 2: Write the failing test**

Append to `src/lib/store/__tests__/raid-state.test.ts`:

```ts
import { trailFrom } from "@/lib/logs/screenshots";
import { MemoryScreenshotSource } from "@/lib/logs/screenshot-source";

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
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run src/lib/store/__tests__/raid-state.test.ts
```

Expected: FAIL on the import of `screenshot-source` only if Task 5 is not yet merged; otherwise these pass immediately, which is fine — they are a regression guard on the store's contract with `trailFrom`.

- [ ] **Step 4: Add state and actions to the store**

In `src/lib/store/app-store.ts`:

Add imports at the top, beside the existing `fs-access-source` import:

```ts
import { type ScreenshotPosition, trailFrom } from "@/lib/logs/screenshots";
import {
  FileSystemAccessScreenshotSource,
  pickScreenshotDirectory,
  type ScreenshotSource,
} from "@/lib/logs/screenshot-source";
```

Add a module-level holder beside the existing `watcher` and `pollTimer` declarations (around line 85):

```ts
/**
 * Kept out of reactive state for the same reason the watcher is: this is a handle, not
 * something the UI renders, and putting it in the store would re-render on every poll.
 */
let screenshots: ScreenshotSource | null = null;
```

Add to `AppState` (around line 49, after the log fields):

```ts
  screenshotStatus: LogStatus;
  screenshotError: string | null;
  /** This raid's screenshots, oldest first. Derived each poll, never accumulated. */
  trail: ScreenshotPosition[];
```

and to the actions block:

```ts
  connectScreenshots: () => Promise<void>;
  reconnectScreenshots: () => Promise<void>;
```

Add to the store's initial state (around line 170, beside `raid: { active: false, at: 0 }`):

```ts
  screenshotStatus: "idle",
  screenshotError: null,
  trail: [],
```

Add the actions, after `reconnectLogs`:

```ts
  async connectScreenshots() {
    try {
      const handle = await pickScreenshotDirectory();
      await db.set("screenshotDirectory", handle);
      screenshots = new FileSystemAccessScreenshotSource(handle);
      set({ screenshotStatus: "watching", screenshotError: null });
      await readTrail(set, get);
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError") return;
      set({ screenshotStatus: "error", screenshotError: (error as Error).message });
    }
  },

  async reconnectScreenshots() {
    const handle = await db.get("screenshotDirectory");
    if (!handle) return get().connectScreenshots();
    const permission = await requestPermission(handle);
    if (permission !== "granted") {
      set({ screenshotStatus: "needs-permission" });
      return;
    }
    screenshots = new FileSystemAccessScreenshotSource(handle);
    set({ screenshotStatus: "watching", screenshotError: null });
    await readTrail(set, get);
  },
```

- [ ] **Step 5: Add the trail reader and hook it into hydrate and the poll**

Add this function to `src/lib/store/app-store.ts`, beside `startWatching`:

```ts
/**
 * Re-derive the trail from the screenshots folder.
 *
 * A listing, not a read: the position is in the file name, so this never opens a file and
 * costs the same whether the folder holds five screenshots or five thousand.
 */
async function readTrail(set: SetState, get: GetState): Promise<void> {
  if (!screenshots) return;
  try {
    set({ trail: trailFrom(await screenshots.list(), get().raid.at) });
  } catch (error) {
    // The folder was moved, or permission lapsed while the tab was open.
    screenshots = null;
    set({ screenshotStatus: "needs-permission", screenshotError: (error as Error).message });
  }
}
```

In `hydrate`, after the existing `logDirectory` block, add:

```ts
    const shots = await db.get("screenshotDirectory");
    if (shots) {
      const permission = await checkPermission(shots);
      if (permission === "granted") {
        screenshots = new FileSystemAccessScreenshotSource(shots);
        set({ screenshotStatus: "watching" });
      } else {
        set({ screenshotStatus: "needs-permission" });
      }
    }
```

In `pollOnce`, replace the early return so the trail is still read when no log events arrived:

```ts
      const fresh = await watcher.poll();
      if (fresh.length > 0) {
        const events = [...get().events, ...fresh];
        set({
          events,
          raid: raidFrom(fresh, get().raid),
          sessionMode: sessionModeFrom(fresh) ?? get().sessionMode,
        });
        await db.set("events", events);
      }
      // After the raid state is up to date, so a raid that just started empties the trail
      // in the same tick rather than showing the previous raid's dots for one poll.
      if (get().raid.active) await readTrail(set, get);
```

- [ ] **Step 6: Add the settings panel**

In `src/app/settings/page.tsx`, add a `ScreenshotPanel` function beside `LogPanel`, matching that file's 4-space indent and single quotes. Read `LogPanel` first and mirror its structure.

```tsx
function ScreenshotPanel() {
    const status = useAppStore((s) => s.screenshotStatus);
    const error = useAppStore((s) => s.screenshotError);
    const connect = useAppStore((s) => s.connectScreenshots);
    const reconnect = useAppStore((s) => s.reconnectScreenshots);

    return (
        <Panel className='rise' style={{ animationDelay: '90ms' }}>
            <PanelHeader
                title='Screenshot link'
                meta={status === 'watching' ? 'connected' : status === 'needs-permission' ? 'permission lapsed' : 'not connected'}
            />
            <div className='space-y-3 px-4 py-4'>
                <p className='text-[13px] leading-relaxed text-bone-dim'>
                    The game writes where you were standing into the name of every screenshot it saves. Point Raidlog at your{' '}
                    <span className='data text-bone'>Screenshots</span> folder and pressing the screenshot key in raid puts you on the map.
                </p>
                <p className='text-[13px] leading-relaxed text-muted'>
                    Usually <span className='data'>Documents\Escape from Tarkov\Screenshots</span>. The game only creates it once you have taken your
                    first screenshot, so take one in raid if it is not there yet.
                </p>
                {status === 'needs-permission' ? (
                    <Button variant='primary' onClick={() => void reconnect()}>
                        Reconnect screenshots
                    </Button>
                ) : (
                    <Button variant={status === 'watching' ? 'ghost' : 'primary'} onClick={() => void connect()}>
                        {status === 'watching' ? 'Pick a different folder' : 'Connect screenshots'}
                    </Button>
                )}
                {error ? <p className='data text-[11px] text-rust'>{error}</p> : null}
            </div>
        </Panel>
    );
}
```

Mount it in `SettingsPage` immediately after `<LogPanel />`:

```tsx
                <ScreenshotPanel />
```

- [ ] **Step 7: Run the full suite**

```bash
npm test && npm run typecheck && npm run lint
```

Expected: PASS throughout.

- [ ] **Step 8: Commit**

```bash
git add src/lib/store/ src/app/settings/page.tsx && git commit -m "Connect the screenshots folder and derive the raid trail"
```

---

### Task 7: The map panel — SVG, floors, pan and zoom

Renders the map picture with only the active floor showing. Pins and trail come in Task 8.

**Files:**
- Create: `src/components/objective-map.tsx`

**Interfaces:**
- Consumes: `calibrationFor`, `MapCalibration`, `MapFloor` (Task 2); `Panel`, `cx` from `src/components/ui.tsx`; `GameMap` from `src/lib/tarkovdev/types.ts`.
- Produces: `function ObjectiveMap({ map }: { map: GameMap }): JSX.Element | null`

- [ ] **Step 1: Write the component**

Create `src/components/objective-map.tsx`. Match `map-3d.tsx`'s 2-space indent and double quotes.

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";

import { calibrationFor, type MapFloor } from "@/lib/maps/calibration";
import type { GameMap } from "@/lib/tarkovdev/types";
import { Panel, cx } from "./ui";

/**
 * The map you are dropping into, with your objectives on it.
 *
 * The SVG is fetched as text and inlined rather than dropped into an `<img>`, because every
 * floor is a sibling `<g>` in one file and they are all opaque — the only thing marking a
 * non-ground floor is `class="shadow"`, which is a drop-shadow and nothing more. An `<img>`
 * therefore draws every storey of Streets stacked on top of each other. Inlining lets the
 * inactive ones be hidden, and is what makes a floor switcher possible at all.
 *
 * These are small: 193 KB for Customs against 0.5-11.5 MB for the 3D renders, which is why
 * this panel loads on open rather than waiting to be asked like `Map3d` does.
 */

/** Strip the layers we are not showing, and return the SVG element to mount. */
function prepare(text: string, baseLayer: string, activeFloor: MapFloor | null): SVGSVGElement | null {
  const parsed = new DOMParser().parseFromString(text, "image/svg+xml");
  const svg = parsed.querySelector("svg");
  if (!svg || parsed.querySelector("parsererror")) return null;

  const shown = new Set([baseLayer, activeFloor?.svgLayer].filter(Boolean) as string[]);

  // Only top-level groups are floors. Descending further would hit the groups that make up
  // the drawing itself — buildings, roads, trees.
  for (const group of Array.from(svg.children)) {
    const id = group.getAttribute("id");
    const isFloor = id !== null && /(_Level|_Floor|Basement)$/.test(id);
    if (isFloor && !shown.has(id)) group.remove();
  }

  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.setAttribute("class", "block h-auto w-full");
  return svg as SVGSVGElement;
}

export function ObjectiveMap({ map }: { map: GameMap }) {
  const calibration = calibrationFor(map);
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [floor, setFloor] = useState<MapFloor | null>(null);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (!calibration) return;
    const aborter = new AbortController();
    setText(null);
    setFailed(false);
    setFloor(null);
    fetch(calibration.svgPath, { signal: aborter.signal })
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error("no map"))))
      .then(setText)
      .catch(() => {
        if (!aborter.signal.aborted) setFailed(true);
      });
    return () => aborter.abort();
  }, [calibration]);

  const svg = useMemo(() => {
    if (!text || !calibration) return null;
    return prepare(text, calibration.svgLayer, floor);
  }, [text, calibration, floor]);

  // Three maps publish raster tiles instead of an SVG. Say nothing rather than apologise,
  // the same way `Map3d` does for a map nobody has drawn.
  if (!calibration || failed) return null;

  return (
    <Panel className="rise">
      <header className="border-b border-line">
        <div className="flex items-baseline justify-between gap-4 px-4 pt-3 pb-2">
          <h2 className="stencil text-[11px] text-amber">Map</h2>
          <div className="flex items-center gap-3">
            {calibration.floors.length > 0 ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setFloor(null)}
                  className={cx(
                    "stencil cursor-pointer border px-2 py-1 text-[10px] transition-colors",
                    floor === null
                      ? "border-amber text-amber"
                      : "border-line-bright text-muted hover:border-amber hover:text-amber",
                  )}
                >
                  Ground
                </button>
                {calibration.floors.map((option) => (
                  <button
                    key={option.svgLayer}
                    type="button"
                    onClick={() => setFloor(option)}
                    className={cx(
                      "stencil cursor-pointer border px-2 py-1 text-[10px] transition-colors",
                      floor?.svgLayer === option.svgLayer
                        ? "border-amber text-amber"
                        : "border-line-bright text-muted hover:border-amber hover:text-amber",
                    )}
                  >
                    {option.name}
                  </button>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setZoomed((v) => !v)}
              title={zoomed ? "Fit the whole map in the panel" : "Show at full size and pan"}
              className="stencil cursor-pointer border border-line-bright px-2 py-1 text-[10px] text-muted transition-colors hover:border-amber hover:text-amber"
            >
              {zoomed ? "Fit" : "Zoom"}
            </button>
          </div>
        </div>
        <div className="ticks h-[3px] opacity-40" />
      </header>

      <div
        className={cx(
          "relative bg-ground-2",
          zoomed ? "max-h-[70vh] overflow-auto" : "overflow-hidden",
          !svg && "min-h-[220px]",
        )}
      >
        {svg ? (
          <div
            className={cx("relative", zoomed ? "w-[200%] max-w-none" : "w-full")}
            // The SVG is fetched from assets.tarkov.dev, parsed with DOMParser and stripped
            // to the layers being shown, so what lands here is markup we built rather than
            // markup we were handed.
            ref={(node) => {
              if (!node) return;
              node.replaceChildren(svg);
            }}
          />
        ) : (
          <p className="data flex min-h-[220px] items-center justify-center text-[11px] text-muted">
            loading
          </p>
        )}
      </div>

      <p className="data border-t border-line px-4 py-2 text-[10px] text-muted">
        Drawn by{" "}
        <a
          href="https://github.com/the-hideout/tarkov-dev-svg-maps/"
          target="_blank"
          rel="noreferrer"
          className="text-bone-dim underline decoration-line-bright underline-offset-2 hover:text-amber"
        >
          the tarkov.dev map project
        </a>
        .
      </p>
    </Panel>
  );
}
```

- [ ] **Step 2: Mount it temporarily and look at it**

In `src/app/raid/page.tsx`, add the import and place `<ObjectiveMap key={map.id} map={map} />` directly above the `<Map3d ... />` line.

```bash
npm run typecheck && npm run lint
```

Expected: PASS.

- [ ] **Step 3: Verify in the browser**

Start the dev server with the `preview_start` tool (never `npm run dev` in a shell), open `/raid/`, and pick Customs in the map picker.

Confirm: the map draws; "Zoom" makes it pannable and "Fit" returns it; the Underground button swaps the drawing and Ground returns it. Then switch to Streets and confirm all five floor buttons work. Then switch to The Lab and confirm the panel disappears rather than erroring.

Check the console with `read_console_messages` for fetch or parse errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/objective-map.tsx src/app/raid/page.tsx && git commit -m "Draw the raid map, one floor at a time"
```

---

### Task 8: Pins and trail

**Files:**
- Modify: `src/components/objective-map.tsx`
- Modify: `src/components/task-row.tsx` (accept an `id`)

**Interfaces:**
- Consumes: `objectivePins`, `ObjectivePin` (Task 4); `project` (Task 2); `ScreenshotPosition` (Task 1); `foldedMapIds` from `src/lib/tarkovdev/maps.ts`; `useAppStore` and `useMaps` from the store.
- Produces: `ObjectiveMap` now takes `{ map, pins, trail, showPins, onTogglePins }` — `pins: readonly ObjectivePin[]`, `trail: readonly ScreenshotPosition[]`, `showPins: boolean`, `onTogglePins: () => void`.

- [ ] **Step 1: Give task rows an anchor**

In `src/components/task-row.tsx`, add `id` to the props type and spread it onto the root `<li>`:

```tsx
export function TaskRow({
  task,
  state,
  availability,
  mapId,
  id,
}: {
  task: Task;
  state?: TaskState;
  availability?: TaskAvailability;
  mapId?: string;
  /** Anchor, so a pin on the map can scroll to this row. */
  id?: string;
}) {
```

Find the root element the component returns and add `id={id}` to it.

- [ ] **Step 2: Take pins as a prop and draw them**

In `src/components/objective-map.tsx`, change the signature and add the overlay. Add these imports:

```tsx
import { project } from "@/lib/maps/project";
import type { ObjectivePin } from "@/lib/maps/pins";
import type { ScreenshotPosition } from "@/lib/logs/screenshots";
```

Change the signature to:

```tsx
export function ObjectiveMap({
  map,
  pins,
  trail,
  showPins,
  onTogglePins,
}: {
  map: GameMap;
  pins: readonly ObjectivePin[];
  /** This raid's screenshots, oldest first. Empty on browsers with no File System Access. */
  trail: readonly ScreenshotPosition[];
  showPins: boolean;
  onTogglePins: () => void;
}) {
```

Add a pins toggle button in the header, before the Zoom button:

```tsx
            <button
              type="button"
              onClick={onTogglePins}
              title={showPins ? "Hide objective pins" : "Show objective pins"}
              className={cx(
                "stencil cursor-pointer border px-2 py-1 text-[10px] transition-colors",
                showPins
                  ? "border-amber text-amber"
                  : "border-line-bright text-muted hover:border-amber hover:text-amber",
              )}
            >
              {pins.length} pins
            </button>
```

Inside the map container, as a sibling of the SVG holder, add the overlay:

```tsx
        {svg ? (
          <div className="pointer-events-none absolute inset-0">
            {showPins
              ? pins.map((pin) => {
                  const { u, v } = project(calibration, pin.position);
                  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
                  return (
                    <button
                      key={pin.key}
                      type="button"
                      onClick={() =>
                        document
                          .getElementById(`task-${pin.taskId}`)
                          ?.scrollIntoView({ behavior: "smooth", block: "center" })
                      }
                      title={`${pin.taskName} — ${pin.description}`}
                      style={{ left: `${u * 100}%`, top: `${v * 100}%` }}
                      className={cx(
                        "pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full border transition-transform hover:scale-150",
                        pin.kind === "zone"
                          ? "size-[10px] border-amber bg-amber/60"
                          : "size-[7px] border-bone-dim bg-bone-dim/40",
                      )}
                    />
                  );
                })
              : null}

            {/*
              The trail. Faint dots for where you have been, the last one drawn as an arrow
              because it is the only one whose facing you still care about.
            */}
            {trail.map((shot, index) => {
              const { u, v } = project(calibration, shot);
              if (u < 0 || u > 1 || v < 0 || v > 1) return null;
              const latest = index === trail.length - 1;
              if (!latest) {
                return (
                  <span
                    key={shot.name}
                    style={{ left: `${u * 100}%`, top: `${v * 100}%` }}
                    className="absolute size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-rust/50"
                  />
                );
              }
              // tarkov.dev adds the map's own rotation to the marker, and a further half
              // turn on the quarter-turn maps. Ported rather than derived; confirm it
              // against a screenshot whose facing you know.
              const extra =
                calibration.coordinateRotation === 90 || calibration.coordinateRotation === 270
                  ? calibration.coordinateRotation + 180
                  : calibration.coordinateRotation;
              return (
                <span
                  key={shot.name}
                  style={{
                    left: `${u * 100}%`,
                    top: `${v * 100}%`,
                    rotate: shot.yaw === null ? undefined : `${shot.yaw + extra}deg`,
                  }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 text-[16px] leading-none text-rust"
                  aria-label="You are here"
                >
                  {shot.yaw === null ? "●" : "▲"}
                </span>
              );
            })}
          </div>
        ) : null}
```

- [ ] **Step 3: Feed it from the raid page**

In `src/app/raid/page.tsx`, matching that file's 4-space indent and single quotes, add imports:

```tsx
import { ObjectiveMap } from '@/components/objective-map';
import { objectivePins } from '@/lib/maps/pins';
import { foldedMapIds } from '@/lib/tarkovdev/maps';
import { useMaps } from '@/lib/store/hooks';
```

Inside `RaidPage`, after the existing `keys` memo:

```tsx
    const maps = useMaps();
    const trail = useAppStore((s) => s.trail);
    const showPins = useAppStore((s) => s.settings.showObjectivePins);
    const update = useAppStore((s) => s.updateSettings);

    /** Pins for the tasks you are holding here. Folding is what keeps Night Factory on Factory. */
    const pins = useMemo(() => {
        if (!map) return [];
        return objectivePins(holding, map.id, foldedMapIds(maps));
    }, [holding, map, maps]);
```

Replace the temporary mount from Task 7 with:

```tsx
            <ObjectiveMap
                key={map.id}
                map={map}
                pins={pins}
                trail={trail}
                showPins={showPins}
                onTogglePins={() => void update({ showObjectivePins: !showPins })}
            />
```

And give the task rows their anchors — change the existing `<TaskRow ... />` in the "In progress here" list to add:

```tsx
                            id={`task-${task.id}`}
```

- [ ] **Step 4: Verify in the browser**

```bash
npm run typecheck && npm run lint
```

Then with the dev server: open `/raid/`, pick a map you hold tasks on, and confirm pins appear, the count in the toggle matches, clicking the toggle hides and shows them, and clicking a pin scrolls the matching task row into view.

**Settle the facing constant.** Connect your Screenshots folder in settings, then check the arrow against the real Customs screenshot: it sits by Warehouse 4 at `u=0.319, v=0.480`. If the arrow points the wrong way, adjust the `extra` expression — that is the one value the spec flagged as needing an eyeball rather than a proof.

- [ ] **Step 5: Commit**

```bash
git add src/components/ src/app/raid/page.tsx && git commit -m "Pin held objectives and your own trail on the raid map"
```

---

### Task 9: Guard the calibration against a redraw

The calibration is vendored, so a redraw on tarkov.dev's side would slide every pin silently. This makes that a failing test instead.

**Files:**
- Create: `src/lib/maps/__tests__/live-svg.test.ts`

**Interfaces:**
- Consumes: `MAP_CALIBRATION` (Task 2).
- Produces: nothing.

- [ ] **Step 1: Check how live tests are gated**

Read `src/lib/tarkovdev/__tests__/live-api.test.ts` and copy whatever mechanism it uses to skip when offline (an environment variable, `describe.skipIf`, or similar). Use the same one here so both behave alike in CI.

- [ ] **Step 2: Write the test**

Create `src/lib/maps/__tests__/live-svg.test.ts`, substituting the gating from Step 1:

```ts
import { describe, expect, it } from "vitest";

import { MAP_CALIBRATION } from "../calibration";

/**
 * The calibration in `calibration.ts` is vendored. If tarkov.dev redraws a map, every pin
 * on it slides and nothing else complains — so this compares each drawing's aspect ratio
 * against the bounds we hold for it. Measured drift when the table was written was under
 * 1% on every map, worst 0.94% on Customs.
 */
function rotate(x: number, z: number, degrees: number): [number, number] {
  if (!degrees) return [x, z];
  const radians = (degrees * Math.PI) / 180;
  return [
    x * Math.cos(radians) - z * Math.sin(radians),
    x * Math.sin(radians) + z * Math.cos(radians),
  ];
}

describe("vendored map calibration", () => {
  for (const [key, calibration] of Object.entries(MAP_CALIBRATION)) {
    it(`still matches the drawing for ${key}`, async () => {
      const response = await fetch(calibration.svgPath);
      expect(response.ok, `${key}: ${response.status}`).toBe(true);

      const viewBox = /viewBox="([\d.\-\s]+)"/.exec(await response.text());
      expect(viewBox, `${key}: no viewBox`).not.toBeNull();
      const [, , width, height] = viewBox![1].trim().split(/\s+/).map(Number);

      const box = calibration.svgBounds ?? calibration.bounds;
      const [ax, az] = rotate(box[0][0], box[0][1], calibration.coordinateRotation);
      const [bx, bz] = rotate(box[1][0], box[1][1], calibration.coordinateRotation);

      const drawn = width / height;
      const expected = Math.abs(bx - ax) / Math.abs(bz - az);
      expect(Math.abs(drawn - expected) / expected, `${key} drift`).toBeLessThan(0.02);
    }, 20_000);
  }
});
```

- [ ] **Step 3: Run it**

```bash
npx vitest run src/lib/maps/__tests__/live-svg.test.ts
```

Expected: PASS, 10 tests — one per map with an SVG.

- [ ] **Step 4: Run everything and commit**

```bash
npm test && npm run typecheck && npm run lint && git add src/lib/maps/__tests__/live-svg.test.ts && git commit -m "Fail loudly if tarkov.dev redraws a map"
```

---

## Self-review notes

Checked against `docs/superpowers/specs/2026-09-03-objective-map-design.md`:

| Spec requirement | Task |
| --- | --- |
| Filename → position, no file opened | 1 |
| Yaw as ordinary Y-up rotation | 1 |
| Trail derived, not accumulated; 60 s grace | 1, 6 |
| Vendored calibration, refresh procedure | 2 |
| Projection without Leaflet; `svgBounds` for Reserve | 2 |
| Floor selection from `y` | 2, 7 |
| `zones` / `possibleLocations` through `denormalize`, no cache bump | 3 |
| Map folding for Night Factory | 4 |
| `ScreenshotSource` as its own port | 5 |
| Screenshot folder picker, missing-folder guidance | 6 |
| Poll rides the existing 2 s loop, raid-active only | 6 |
| Panel on raid board, open by default | 7, 8 |
| SVG inlined so floors can be hidden | 7 |
| Panel hides itself with no SVG or no calibration | 7 |
| Pins from held tasks only, with toggle | 8 |
| Zone outline vs dot | 8 — outlines deferred, see below |
| Click a pin, highlight the row | 8 |
| Pan/zoom reuses `Map3d`'s pattern | 7 |
| Aspect-ratio guard | 9 |

**One deliberate deviation.** The spec calls for zone outlines drawn as translucent polygons. Task 8 draws every zone as a dot, sized to distinguish it from a candidate location. Polygons need a second coordinate space inside the SVG rather than percentage-positioned HTML, which is a different rendering approach for one visual refinement. Dots first; add outlines as a follow-up once the pin positions are confirmed correct in the browser. Flag this to the user rather than silently dropping it.

**Firefox and Safari.** No task gates the map on File System Access — `ObjectiveMap` takes `trail` as a prop and renders nothing extra when it is empty, so the map and pins work everywhere and only the trail is Chromium-only. This needed no code; it is a consequence of the prop boundary and is called out here so a later change does not break it by accident.
