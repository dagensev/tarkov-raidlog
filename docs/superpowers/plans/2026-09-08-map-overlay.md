# Raid Map Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the always-open raid map panel to a strip, and open the map as a full-viewport overlay that arrives fitted to the screen and takes wheel zoom and drag pan, with objective pins that name themselves in a card instead of a one-second OS tooltip.

**Architecture:** One new pure module holds all the fitting, zooming and panning arithmetic, tested in isolation because the test runner is Node-only. One new component holds the overlay. `objective-map.tsx` shrinks to a strip plus the state that must outlive the overlay. The transform is a single CSS `transform` on the wrapper the drawing and the markers already share, so both move together with no per-marker maths.

**Tech Stack:** TypeScript, React 19, Next.js 16 static export, Zustand, Vitest, Tailwind 4. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-08-map-overlay-design.md`

## Global Constraints

- **No new npm dependencies.** Leaflet and `react-zoom-pan-pinch` were both considered and rejected in the spec. The arithmetic is ~40 lines.
- **Style is per-directory and must be matched exactly.** `src/lib/**` and `src/components/**` use **2-space indent and double quotes**. `src/app/**/page.tsx` uses **4-space indent and single quotes**. Copy the surrounding file.
- **Tests live in `__tests__/` beside the module**, named `<module>.test.ts`. `vitest.config.mts` only collects `src/**/*.test.ts` — a `.tsx` test file will silently never run.
- **Test environment is `node`.** There is no jsdom and no component-testing setup. Do not add one. All logic that needs testing goes in a pure module; components are verified in the browser.
- **Every regex must be non-global.** The codebase reuses regexes across calls and a `/g` flag would carry `lastIndex` between them. See the note atop `src/lib/logs/patterns.ts`.
- **No synchronous `setState` in an effect body.** `react-hooks/set-state-in-effect` is on, and `objective-map.tsx` already carries two comments explaining where state was derived at render time instead. This plan does the same for the clamped view. Setting state from a `ResizeObserver` or event callback is fine — the rule is about the effect body.
- **Comments explain why, not what.** Match the density and voice of `src/components/objective-map.tsx` and `src/lib/maps/project.ts`.
- Run `npm run typecheck` and `npm run lint` before every commit.
- **Run `npx vitest run`, never `npm test`.** `npm test` also runs the Workers pool suite, which is flaky on this machine. Nothing in this plan touches `worker/`, so a failure there is not yours.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/maps/viewport.ts` | **Create.** Fit, zoom-about-a-point, clamp. Pure, no DOM. |
| `src/lib/maps/__tests__/viewport.test.ts` | **Create.** Covers the above, including the cursor invariant. |
| `src/components/map-overlay.tsx` | **Create.** The full-viewport layer: chrome, stage, gestures, markers, pin card. |
| `src/components/objective-map.tsx` | **Modify.** Becomes the collapsed strip plus fetch, floor and open state. |

`src/app/raid/page.tsx`, `src/components/map-3d.tsx`, the store, the settings and every `lib/` module other than the new one are **unchanged**. If you find yourself editing them, stop and re-read the spec.

Task 1 is pure and test-driven. Tasks 2–4 are UI and are verified in the browser.

---

### Task 1: The viewport arithmetic

Fitting a picture into a box, zooming about the cursor, and clamping the result. All of it pure, because the runner is Node-only and this is the half where the bugs live.

**Files:**
- Create: `src/lib/maps/viewport.ts`
- Test: `src/lib/maps/__tests__/viewport.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Size { width: number; height: number }`
  - `interface Point { x: number; y: number }`
  - `interface View { scale: number; x: number; y: number }`
  - `const FITTED: View`, `const MIN_SCALE: number`, `const MAX_SCALE: number`
  - `function fitBox(aspect: number, within: Size): Size`
  - `function clampView(view: View, box: Size, within: Size): View`
  - `function zoomAt(view: View, factor: number, at: Point, box: Size, within: Size): View`

- [ ] **Step 1: Write the failing test**

Create `src/lib/maps/__tests__/viewport.test.ts`.

```ts
import { describe, expect, it } from "vitest";

import { FITTED, MAX_SCALE, clampView, fitBox, zoomAt, type Point, type View } from "../viewport";

/** A 16:9 open area, in CSS pixels. */
const WIDE = { width: 1600, height: 900 };
/** A square area with a square picture, so both axes overflow together. */
const SQUARE = { width: 1000, height: 1000 };
const SQUARE_BOX = { width: 1000, height: 1000 };

/**
 * The picture point currently under a cursor, in unscaled stage pixels from the stage's
 * centre. Inverting the transform the component applies: a point `p` lands at
 * `view.x + p * view.scale` from the area's centre.
 */
function under(view: View, at: Point): Point {
  return { x: (at.x - view.x) / view.scale, y: (at.y - view.y) / view.scale };
}

describe("fitBox", () => {
  it("is bound by the area's width when the picture is the wider shape", () => {
    expect(fitBox(2, WIDE)).toEqual({ width: 1600, height: 800 });
  });

  it("is bound by the area's height when the picture is the taller shape", () => {
    expect(fitBox(1, WIDE)).toEqual({ width: 900, height: 900 });
  });

  it("keeps the picture's aspect ratio exactly", () => {
    const box = fitBox(1.3, { width: 640, height: 480 });
    expect(box.width / box.height).toBeCloseTo(1.3, 10);
  });

  it("never overflows the area", () => {
    for (const aspect of [0.2, 0.9, 1, 16 / 9, 5]) {
      const box = fitBox(aspect, WIDE);
      expect(box.width).toBeLessThanOrEqual(WIDE.width);
      expect(box.height).toBeLessThanOrEqual(WIDE.height);
    }
  });

  it("returns nothing for an area that has not been measured yet", () => {
    // The first paint, before the ResizeObserver has fired. Must not divide by zero.
    expect(fitBox(1.6, { width: 0, height: 0 })).toEqual({ width: 0, height: 0 });
  });
});

describe("clampView", () => {
  // 1600x800 inside 1600x900: width-bound, with letterboxing top and bottom.
  const BOX = fitBox(2, WIDE);

  it("allows no panning at all in the fitted view", () => {
    const clamped = clampView({ scale: 1, x: 300, y: -200 }, BOX, WIDE);
    expect(clamped.scale).toBe(1);
    expect(clamped.x).toBeCloseTo(0, 10);
    expect(clamped.y).toBeCloseTo(0, 10);
  });

  it("allows panning only across the overflow", () => {
    // At x2 the picture is 3200x1600 in a 1600x900 area: 800 px of slack each way
    // horizontally, 350 vertically.
    expect(clampView({ scale: 2, x: 5000, y: 5000 }, BOX, WIDE)).toEqual({
      scale: 2,
      x: 800,
      y: 350,
    });
    expect(clampView({ scale: 2, x: -5000, y: -5000 }, BOX, WIDE)).toEqual({
      scale: 2,
      x: -800,
      y: -350,
    });
  });

  it("leaves a view already inside the overflow alone", () => {
    const view = { scale: 2, x: 120, y: -40 };
    expect(clampView(view, BOX, WIDE)).toEqual(view);
  });

  it("clamps the scale at both ends", () => {
    expect(clampView({ scale: 0.25, x: 0, y: 0 }, BOX, WIDE).scale).toBe(1);
    expect(clampView({ scale: 99, x: 0, y: 0 }, BOX, WIDE).scale).toBe(MAX_SCALE);
  });
});

describe("zoomAt", () => {
  it("keeps the point under the cursor still", () => {
    // The property the whole feature rests on. Cases are chosen to sit well inside the
    // clamp, because clamping is allowed to override this — see the test below.
    const starts: View[] = [FITTED, { scale: 2, x: 0, y: 0 }, { scale: 4, x: -300, y: 200 }];
    const cursors: Point[] = [
      { x: 0, y: 0 },
      { x: 200, y: 100 },
      { x: -150, y: 90 },
    ];
    for (const start of starts) {
      for (const at of cursors) {
        for (const factor of [1.2, 1 / 1.2, 2]) {
          const next = zoomAt(start, factor, at, SQUARE_BOX, SQUARE);
          expect(under(next, at).x).toBeCloseTo(under(start, at).x, 6);
          expect(under(next, at).y).toBeCloseTo(under(start, at).y, 6);
        }
      }
    }
  });

  it("zooms in and out", () => {
    expect(zoomAt(FITTED, 2, { x: 0, y: 0 }, SQUARE_BOX, SQUARE).scale).toBe(2);
    expect(zoomAt({ scale: 4, x: 0, y: 0 }, 0.5, { x: 0, y: 0 }, SQUARE_BOX, SQUARE).scale).toBe(2);
  });

  it("lets the clamp override the cursor when it would pull the map off the edge", () => {
    // Panned hard right at x4 (the limit there is 1500), then zoomed out. Holding the
    // cursor point still would need x=750, but at x2 the limit is 500.
    const next = zoomAt({ scale: 4, x: 1500, y: 0 }, 0.5, { x: 0, y: 0 }, SQUARE_BOX, SQUARE);
    expect(next.scale).toBe(2);
    expect(next.x).toBe(500);
  });

  it("lands back on the fitted view when you zoom all the way out", () => {
    let view: View = { scale: 6, x: 900, y: -400 };
    for (let step = 0; step < 20; step++) {
      view = zoomAt(view, 1 / 1.2, { x: 300, y: 120 }, SQUARE_BOX, SQUARE);
    }
    expect(view.scale).toBe(1);
    expect(view.x).toBeCloseTo(0, 10);
    expect(view.y).toBeCloseTo(0, 10);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/maps/__tests__/viewport.test.ts`

Expected: FAIL — `Failed to resolve import "../viewport"`.

- [ ] **Step 3: Write the module**

Create `src/lib/maps/viewport.ts`.

```ts
/**
 * Fitting, zooming and panning the raid map.
 *
 * Split out of the component because the vitest run is `environment: node` over
 * `src/**` `/*.test.ts` — a component cannot be tested here at all, and this arithmetic is
 * where the bugs are. It is also why there is no map library: tarkov.dev drives its viewer
 * with Leaflet, but Leaflet is built around tile pyramids, and `project.ts` already
 * establishes that anything positioned *relative to the picture* needs no CRS.
 *
 * The idea that makes the rest simple: **scale 1 is the fitted view, not the drawing's
 * natural size.** The stage is sized by `fitBox` to the largest box of the picture's
 * aspect that fits the open area, so fitted is the identity transform, "Fit" is `FITTED`,
 * and the SVG's own units never reach the component.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * `translate(x, y) scale(scale)` about the stage's centre, in CSS pixels.
 *
 * The stage is centred in the open area by flexbox, so both `x` and `y` are measured from
 * the area's centre — the same frame a cursor position is converted into.
 */
export interface View {
  scale: number;
  x: number;
  y: number;
}

/** Zooming out past the whole map is deliberately impossible; there is nothing out there. */
export const MIN_SCALE = 1;
export const MAX_SCALE = 8;

export const FITTED: View = { scale: 1, x: 0, y: 0 };

/** The largest box of `aspect` that fits `within`. Zero for an area not yet measured. */
export function fitBox(aspect: number, within: Size): Size {
  if (!(aspect > 0) || within.width <= 0 || within.height <= 0) {
    return { width: 0, height: 0 };
  }
  const width = Math.min(within.width, within.height * aspect);
  return { width, height: width / aspect };
}

/**
 * Scale into range, and translation into the picture's overflow.
 *
 * Because `box` is the *fitted* box it never exceeds `within`, so at scale 1 both limits
 * are zero and there is nothing to pan. Past that the picture's edges can never be dragged
 * inside the open area.
 */
export function clampView(view: View, box: Size, within: Size): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale));
  const limitX = Math.max(0, (box.width * scale - within.width) / 2);
  const limitY = Math.max(0, (box.height * scale - within.height) / 2);
  return {
    scale,
    x: Math.min(limitX, Math.max(-limitX, view.x)),
    y: Math.min(limitY, Math.max(-limitY, view.y)),
  };
}

/**
 * Zoom by `factor` about `at`, holding the picture point under that cursor still.
 *
 * A cursor at `c` sits over picture point `p = (c − t) / k`. Keeping it there at `k′`
 * rearranges to `t′ = c − (c − t)·(k′/k)`. The ratio uses the *clamped* `k′`, so hitting
 * `MAX_SCALE` stops the translation moving too, rather than sliding the map sideways
 * against a scale that did not change.
 *
 * Clamping can override the invariant near an edge. That is correct: showing the ground
 * beyond the map's border to honour a cursor position would be the worse answer.
 */
export function zoomAt(
  view: View,
  factor: number,
  at: Point,
  box: Size,
  within: Size,
): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
  const ratio = scale / view.scale;
  return clampView(
    { scale, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio },
    box,
    within,
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/maps/__tests__/viewport.test.ts`

Expected: PASS, 13 tests.

- [ ] **Step 5: Typecheck, lint and commit**

```bash
npm run typecheck
npm run lint
git add src/lib/maps/viewport.ts src/lib/maps/__tests__/viewport.test.ts
git commit -m "Add the fit, zoom and clamp arithmetic for a full-screen map"
```

---

### Task 2: Collapse the panel to a strip and open the map full-screen

The panel stops rendering a map and becomes a header strip. The map moves into a new overlay that covers the viewport and arrives fitted. No zoom or pan yet — this task's deliverable is "the whole map, on the whole screen, opened on demand".

**Files:**
- Create: `src/components/map-overlay.tsx`
- Modify: `src/components/objective-map.tsx` (whole file rewritten)

**Interfaces:**
- Consumes: `fitBox`, `FITTED`, `type Size` (Task 1); `calibrationFor`, `type MapCalibration`, `type MapFloor` from `@/lib/maps/calibration`; `floorFor`, `project` from `@/lib/maps/project`; `type ObjectivePin` from `@/lib/maps/pins`; `type ScreenshotPosition` from `@/lib/logs/screenshots`; `Panel`, `cx` from `./ui`.
- Produces:
  - `function MapOverlay(props): JSX.Element` with props
    `{ map: GameMap; calibration: MapCalibration; text: string | null; floor: MapFloor | null; onFloor: (floor: MapFloor | null) => void; pins: readonly ObjectivePin[]; trail: readonly ScreenshotPosition[]; showPins: boolean; onTogglePins: () => void; onClose: () => void }`
  - `ObjectiveMap` keeps its existing props exactly: `{ map, pins, trail, showPins, onTogglePins }`. `raid/page.tsx` does not change.

- [ ] **Step 1: Write the overlay component**

Create `src/components/map-overlay.tsx`. 2-space indent, double quotes.

`prepare` moves here from `objective-map.tsx` and gains an aspect ratio. Three changes to it: it returns an object, it reads and validates `viewBox`, and the mounted SVG gets `size-full` instead of `h-auto w-full` because the stage is now sized explicitly to the same aspect.

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { ScreenshotPosition } from "@/lib/logs/screenshots";
import type { MapCalibration, MapFloor } from "@/lib/maps/calibration";
import type { ObjectivePin } from "@/lib/maps/pins";
import { project } from "@/lib/maps/project";
import { FITTED, fitBox, type Size } from "@/lib/maps/viewport";
import type { GameMap } from "@/lib/tarkovdev/types";
import { cx } from "./ui";

/**
 * The raid map, full screen.
 *
 * Covers the viewport rather than sitting in the raid board's column, because fitted into
 * that column Streets is unreadable — pins overlap and the arrow marking you is about the
 * size of a building. tarkov.dev's own viewer is the same shape and for the same reason.
 *
 * The drawing and the markers are siblings inside one wrapper whose box *is* the picture.
 * That is what makes this cheap: one `transform` on that wrapper moves the SVG and every
 * marker together, with no per-marker arithmetic and no second coordinate system.
 */

interface Prepared {
  svg: SVGSVGElement;
  /** Width over height, from the drawing's own `viewBox`. */
  aspect: number;
}

/** Strip the layers we are not showing, and return the SVG element to mount. */
function prepare(
  text: string,
  baseLayer: string,
  activeFloor: MapFloor | null,
): Prepared | null {
  const parsed = new DOMParser().parseFromString(text, "image/svg+xml");
  const svg = parsed.querySelector("svg");
  if (!svg || parsed.querySelector("parsererror")) return null;

  // `live-svg.test.ts` reads this same attribute out of all ten drawings and fails the
  // build if one loses it, so a miss here means a corrupt response rather than a map that
  // was ever shaped this way. Nothing can be sized without it, so treat it as a parse
  // failure and let the caller hide the map.
  const box = svg.getAttribute("viewBox")?.trim().split(/\s+/).map(Number);
  if (!box || box.length !== 4 || !box.every(Number.isFinite)) return null;
  const [, , width, height] = box;
  if (width <= 0 || height <= 0) return null;

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
  // The stage below is sized to exactly this aspect ratio, so filling it cannot distort.
  svg.setAttribute("class", "block size-full");
  return { svg: svg as SVGSVGElement, aspect: width / height };
}

export function MapOverlay({
  map,
  calibration,
  text,
  floor,
  onFloor,
  pins,
  trail,
  showPins,
  onTogglePins,
  onClose,
}: {
  map: GameMap;
  calibration: MapCalibration;
  /** The drawing, or null while it is still being fetched. */
  text: string | null;
  floor: MapFloor | null;
  onFloor: (floor: MapFloor | null) => void;
  pins: readonly ObjectivePin[];
  /** This raid's screenshots, oldest first. Empty on browsers with no File System Access. */
  trail: readonly ScreenshotPosition[];
  showPins: boolean;
  onTogglePins: () => void;
  onClose: () => void;
}) {
  const prepared = useMemo(() => {
    if (!text) return null;
    return prepare(text, calibration.svgLayer, floor);
  }, [text, calibration, floor]);

  const areaRef = useRef<HTMLDivElement | null>(null);
  const [area, setArea] = useState<Size>({ width: 0, height: 0 });

  // Measured rather than assumed: the open area is the viewport minus this overlay's own
  // header and footer, and it changes when the window does.
  useEffect(() => {
    const node = areaRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setArea({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const box = useMemo(
    () => (prepared ? fitBox(prepared.aspect, area) : { width: 0, height: 0 }),
    [prepared, area],
  );

  const view = FITTED;

  const svgHolderRef = useRef<HTMLDivElement | null>(null);
  // Keyed on `prepared`, not run on every render: an unrelated re-render (the trail polling
  // at 2 Hz, a pin toggle, a pan) must not re-detach and re-attach a several-thousand-node
  // SVG. This only needs to run again when `prepare` hands back a genuinely different
  // element — a fresh fetch or a floor switch.
  useEffect(() => {
    if (!svgHolderRef.current || !prepared) return;
    svgHolderRef.current.replaceChildren(prepared.svg);
  }, [prepared]);

  // The page behind must not scroll under a layer that covers it.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const chip =
    "stencil cursor-pointer border px-2 py-1 text-[10px] transition-colors";
  const chipOff = "border-line-bright text-muted hover:border-amber hover:text-amber";
  const chipOn = "border-amber text-amber";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Map of ${map.name}`}
      className="fixed inset-0 z-50 flex flex-col bg-ground"
    >
      <header className="shrink-0 border-b border-line bg-panel/70">
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 pt-3 pb-2">
          <h2 className="stencil text-[13px] text-amber glow-amber">{map.name}</h2>
          <div className="flex flex-wrap items-center gap-3">
            {calibration.floors.length > 0 ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onFloor(null)}
                  className={cx(chip, floor === null ? chipOn : chipOff)}
                >
                  Ground
                </button>
                {calibration.floors.map((option) => (
                  <button
                    key={option.svgLayer}
                    type="button"
                    onClick={() => onFloor(option)}
                    className={cx(
                      chip,
                      floor?.svgLayer === option.svgLayer ? chipOn : chipOff,
                    )}
                  >
                    {option.name}
                  </button>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              onClick={onTogglePins}
              title={showPins ? "Hide objective pins" : "Show objective pins"}
              className={cx(chip, showPins ? chipOn : chipOff)}
            >
              {pins.length} pins
            </button>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              title="Close the map (Esc)"
              className={cx(chip, chipOff)}
            >
              Close ✕
            </button>
          </div>
        </div>
        <div className="ticks h-[3px] opacity-40" />
      </header>

      <div
        ref={areaRef}
        className="relative flex flex-1 touch-none items-center justify-center overflow-hidden bg-ground-2 select-none"
      >
        {prepared && box.width > 0 ? (
          <div
            style={{
              width: box.width,
              height: box.height,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            }}
            className="relative"
          >
            <div
              // This markup is still someone else's SVG, not something sanitised: `prepare`
              // only drops inactive floor groups, so a `<script>` in the source would run
              // when `replaceChildren` mounts it. Trust rests entirely on `svgPath` being a
              // fixed, pinned assets.tarkov.dev URL rather than on anything done to the markup.
              ref={svgHolderRef}
              className="size-full"
            />

            {/*
              A sibling of the SVG holder, not a child of it: the effect above replaces that
              node's children outright whenever `prepared` changes, which would silently wipe
              any JSX mounted inside it. Sharing this wrapper is also what keeps every marker
              aligned with the picture through the transform above, for free.
            */}
            <div className="pointer-events-none absolute inset-0">
              {/*
                Decoration only — the dot rendered below stays the clickable control for
                every zone, polygon or not. `viewBox="0 0 100 100"` with
                `preserveAspectRatio="none"` maps the same 0–1 `project()` fractions the
                dots use, stretched independently on each axis exactly as their percentage
                positioning already is.
              */}
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-0 size-full"
              >
                {showPins
                  ? pins.map((pin) => {
                      if (pin.kind !== "zone" || !pin.outline || pin.outline.length < 3) return null;
                      const points = pin.outline.map((point) => project(calibration, point));
                      if (points.some(({ u, v }) => u < 0 || u > 1 || v < 0 || v > 1)) return null;
                      return (
                        <polygon
                          key={pin.key}
                          points={points.map(({ u, v }) => `${u * 100},${v * 100}`).join(" ")}
                          className="fill-amber/20 stroke-amber/70"
                          strokeWidth="0.3"
                        />
                      );
                    })
                  : null}

                {/* The trail, joined in order. Fewer than two points has nothing to join. */}
                {trail.length >= 2 ? (
                  <polyline
                    points={trail
                      .map((shot) => {
                        const { u, v } = project(calibration, shot);
                        return `${u * 100},${v * 100}`;
                      })
                      .join(" ")}
                    fill="none"
                    className="stroke-rust/50"
                    strokeWidth="0.3"
                  />
                ) : null}
              </svg>

              {showPins
                ? pins.map((pin) => {
                    const { u, v } = project(calibration, pin.position);
                    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
                    return (
                      <button
                        key={pin.key}
                        type="button"
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
          </div>
        ) : (
          <p className="data text-[11px] text-muted">
            {/*
              `prepare` returning null against text that did arrive means a drawing this
              cannot read — no `viewBox`, or malformed XML. Said out loud rather than left
              as a permanent "loading", and not folded into the parent's `failed` flag,
              which would mean reaching for a callback and a synchronous setState in an
              effect to reach it.
            */}
            {text !== null && prepared === null ? "this map could not be read" : "loading"}
          </p>
        )}
      </div>

      <p className="data shrink-0 border-t border-line bg-panel/70 px-4 py-2 text-[10px] text-muted">
        Drawn by{" "}
        <a
          href="https://github.com/the-hideout/tarkov-dev-svg-maps/"
          target="_blank"
          rel="noreferrer"
          className="text-bone-dim underline decoration-line-bright underline-offset-2 hover:text-amber"
        >
          the tarkov.dev map project
        </a>
        . Your position appears once you take a screenshot in raid — this is not live tracking.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite the panel as a strip**

Replace the whole of `src/components/objective-map.tsx` with this. It keeps the fetch, the failure flag and the derived floor, adds `open`, and renders a strip plus the overlay. The `zoomed` state, the `Zoom`/`Fit` toggle, `prepare`, the SVG holder and every marker have gone to `map-overlay.tsx`.

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";

import type { ScreenshotPosition } from "@/lib/logs/screenshots";
import { calibrationFor, type MapFloor } from "@/lib/maps/calibration";
import type { ObjectivePin } from "@/lib/maps/pins";
import { floorFor } from "@/lib/maps/project";
import type { GameMap } from "@/lib/tarkovdev/types";
import { MapOverlay } from "./map-overlay";
import { Panel } from "./ui";

/**
 * The strip that opens the raid map.
 *
 * Collapsed until asked for, which is also why nothing is fetched until then: the raid
 * board is opened far more often than the map is actually looked at, and 193 KB of SVG
 * parsed into several thousand nodes is not free. Same bargain `Map3d` already makes
 * directly below it.
 *
 * What lives here rather than in the overlay is the state that has to outlive it: the
 * fetched drawing, so closing and reopening is instant, and the floor you picked.
 *
 * State is per map, so the caller keys this on the map id.
 */
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
  const calibration = calibrationFor(map);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // What the user last clicked, and which shot was newest when they clicked it — not the
  // floor itself. That lets the floor be derived below instead of pushed into state from an
  // effect (`react-hooks/set-state-in-effect`), and it gives a manual click a well-defined
  // lifetime: it sticks while you look around, and your next screenshot resumes following
  // automatically.
  const [manualFloor, setManualFloor] = useState<{
    floor: MapFloor | null;
    againstShot: string | null;
  }>({ floor: null, againstShot: null });

  const newestShot = trail.length > 0 ? trail[trail.length - 1] : null;
  // Ground_Level, standing on the 3rd floor, is still Ground_Level until you say otherwise:
  // follow the newest screenshot's height band, unless the last click was made against that
  // very shot, in which case honour it instead.
  const floor =
    manualFloor.againstShot === (newestShot?.name ?? null)
      ? manualFloor.floor
      : calibration && newestShot
        ? floorFor(calibration, newestShot.y)
        : null;

  // Gated on `open`, so the raid board costs nothing until you ask for the map. Not reset
  // when you close: `text` outliving the overlay is the whole reason it lives up here, and
  // the effect will not re-run because `open` only ever goes false again.
  //
  // No reset of text/failed/manualFloor here either: the caller keys this component on the
  // map id (see raid/page.tsx), so a map change remounts rather than re-running this
  // effect, and the useState defaults above already are the reset values.
  useEffect(() => {
    if (!calibration || !open || text !== null) return;
    const aborter = new AbortController();
    fetch(calibration.svgPath, { signal: aborter.signal })
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error("no map"))))
      .then(setText)
      .catch(() => {
        if (!aborter.signal.aborted) setFailed(true);
      });
    return () => aborter.abort();
  }, [calibration, open, text]);

  const close = useCallback(() => setOpen(false), []);

  // Three maps publish raster tiles instead of an SVG. Say nothing rather than apologise,
  // the same way `Map3d` does for a map nobody has drawn.
  if (!calibration || failed) return null;

  return (
    <>
      <Panel className="rise">
        <header className="border-b border-line">
          <div className="flex items-baseline justify-between gap-4 px-4 pt-3 pb-2">
            {/*
              PanelHeader's title is not clickable and this one must be, so this mirrors its
              markup with a button in place of the heading — the same trick `Map3d` uses.
              `aria-haspopup` rather than `aria-expanded`: this opens a dialog, it does not
              disclose a region below itself.
            */}
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-haspopup="dialog"
              title={`Open the map of ${map.name}`}
              className="stencil flex cursor-pointer items-center gap-2 text-[11px] text-amber transition-colors hover:text-bone"
            >
              <span aria-hidden className="text-[9px] text-muted">
                ▸
              </span>
              Map
            </button>
            <span className="data text-[11px] text-muted">
              {pins.length} pins · click to open
            </span>
          </div>
          <div className="ticks h-[3px] opacity-40" />
        </header>
      </Panel>

      {open ? (
        <MapOverlay
          map={map}
          calibration={calibration}
          text={text}
          floor={floor}
          onFloor={(next) => setManualFloor({ floor: next, againstShot: newestShot?.name ?? null })}
          pins={pins}
          trail={trail}
          showPins={showPins}
          onTogglePins={onTogglePins}
          onClose={close}
        />
      ) : null}
    </>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

```bash
npm run typecheck
npm run lint
```

Expected: both clean. If lint flags `setArea` inside the `ResizeObserver` callback, do **not** silence it — re-read the rule, it targets synchronous `setState` in an effect body, and a callback is not that.

- [ ] **Step 4: Verify in the browser**

Start the dev server through the preview tooling, not `npm run dev` in a shell. If `.claude/launch.json` does not exist, create it:

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "raidlog", "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev"], "port": 3000 }
  ]
}
```

Open `/raid` and pick **Streets of Tarkov** from the map picker, because it is the map with floors and the worst crowding. Check, in order:

1. The Map strip sits above the 3D map strip and reads `N pins · click to open`.
2. The network panel shows **no** request to `assets.tarkov.dev/maps/svg/` on page load.
3. Clicking Map covers the whole window. The request fires now, `loading` shows, then the whole map appears fitted and centred with letterboxing on the short axis.
4. Pins, zone polygons and the trail sit on the map in the same places they did before this change.
5. The floor buttons switch floors. Close and reopen: the floor you picked is still selected, and no second network request fires.
6. Escape closes. So does Close. The page behind cannot be scrolled while it is open, and can be after it closes.
7. Resize the window: the map re-fits, still whole, still centred.

- [ ] **Step 5: Commit**

```bash
git add src/components/map-overlay.tsx src/components/objective-map.tsx
git commit -m "Open the raid map full-screen instead of parking it in the page"
```

---

### Task 3: Wheel zoom, drag pan and a Fit control

The overlay becomes navigable. Nothing outside `map-overlay.tsx` changes.

**Files:**
- Modify: `src/components/map-overlay.tsx`

**Interfaces:**
- Consumes: `clampView`, `zoomAt`, `type Point`, `type View` (Task 1), in addition to the `FITTED` and `fitBox` already imported.
- Produces: no new exports. `MapOverlay`'s props are unchanged.

- [ ] **Step 1: Widen the viewport import and add the cursor helper**

Replace the import line:

```tsx
import { FITTED, fitBox, type Size } from "@/lib/maps/viewport";
```

with:

```tsx
import {
  FITTED,
  clampView,
  fitBox,
  zoomAt,
  type Point,
  type Size,
  type View,
} from "@/lib/maps/viewport";
```

Then add this beside `prepare`, at module scope. **Not inside the component** — it closes over nothing, and a function declared in the body would be a missing dependency of the wheel effect below, which `react-hooks/exhaustive-deps` will flag.

```tsx
/** A cursor in the frame the transform uses: CSS pixels from the open area's centre. */
function pointerAt(event: { clientX: number; clientY: number }, node: HTMLElement): Point {
  const rect = node.getBoundingClientRect();
  return {
    x: event.clientX - (rect.left + rect.width / 2),
    y: event.clientY - (rect.top + rect.height / 2),
  };
}
```

- [ ] **Step 2: Replace the frozen view with state, derived clamped**

Replace this line:

```tsx
  const view = FITTED;
```

with:

```tsx
  const [raw, setRaw] = useState<View>(FITTED);

  // Clamped at render rather than corrected in an effect, for the same reason `floor` is
  // derived in `objective-map.tsx`: pushing a corrected value back into state from an
  // effect is exactly what `react-hooks/set-state-in-effect` exists to stop. It also makes
  // a window resize free — the limits fall out of the new `area` on the next render, with
  // an existing zoom left alone. Clamping is idempotent, so nothing drifts.
  const view = clampView(raw, box, area);

  // The wheel listener is registered by hand because React attaches `wheel` at the root as
  // a *passive* listener, so `preventDefault()` inside an `onWheel` prop does nothing and
  // the raid board scrolls underneath the map. Re-registers when the box or area changes,
  // which is cheap and beats stashing both in refs.
  useEffect(() => {
    const node = areaRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // Firefox reports whole lines rather than pixels. Exponential so that zooming in and
      // back out by the same scroll distance returns you to where you started.
      const distance = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      const factor = Math.exp(-distance * 0.0015);
      const at = pointerAt(event, node);
      setRaw((current) => zoomAt(clampView(current, box, area), factor, at, box, area));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [box, area]);
```

- [ ] **Step 3: Add the drag state and its window listeners**

Insert immediately after the wheel effect:

```tsx
  /** A drag in flight. `moved` stays false until the pointer clears the slop below. */
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  /** Whether the gesture that just ended was a drag. Read by pin clicks in Task 4. */
  const dragged = useRef(false);

  // Deliberately *not* pointer capture. Capturing on the stage would retarget the click
  // that follows to the stage itself, and a pin would never see its own click. Window
  // listeners keep native click dispatch intact and still follow the pointer off-screen.
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const active = drag.current;
      if (!active || active.id !== event.pointerId) return;
      const dx = event.clientX - active.x;
      const dy = event.clientY - active.y;
      // A few pixels of slop, so a click on a pin with a shaky hand is still a click.
      if (!active.moved && Math.hypot(dx, dy) < 4) return;
      active.moved = true;
      active.x = event.clientX;
      active.y = event.clientY;
      setRaw((current) => {
        const from = clampView(current, box, area);
        return clampView({ ...from, x: from.x + dx, y: from.y + dy }, box, area);
      });
    };
    const end = (event: PointerEvent) => {
      const active = drag.current;
      if (!active || active.id !== event.pointerId) return;
      dragged.current = active.moved;
      drag.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [box, area]);
```

- [ ] **Step 4: Add the Fit control to the header**

Insert between the pins toggle and the Close button:

```tsx
            <button
              type="button"
              onClick={() => setRaw(FITTED)}
              disabled={view.scale === 1}
              title="Fit the whole map on screen"
              className={cx(chip, chipOff, "disabled:cursor-not-allowed disabled:opacity-40")}
            >
              Fit
            </button>
```

- [ ] **Step 5: Hook the gestures onto the stage**

Replace the opening tag of the stage container:

```tsx
      <div
        ref={areaRef}
        className="relative flex flex-1 touch-none items-center justify-center overflow-hidden bg-ground-2 select-none"
      >
```

with:

```tsx
      <div
        ref={areaRef}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          dragged.current = false;
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
        }}
        onDoubleClick={(event) => {
          const at = pointerAt(event, event.currentTarget);
          setRaw((current) => zoomAt(clampView(current, box, area), 2, at, box, area));
        }}
        className={cx(
          "relative flex flex-1 touch-none items-center justify-center overflow-hidden bg-ground-2 select-none",
          // No grab cursor at the fitted scale, because there is nothing to pan to.
          view.scale > 1 && "cursor-grab active:cursor-grabbing",
        )}
      >
```

- [ ] **Step 6: Counter-scale the markers**

A pin drawn at ×8 would be a blob covering half a building, so each marker shrinks by the same factor the picture grew. Tailwind's translate utilities compile to the `translate` CSS property, and the individual transform properties apply in the order `translate`, `rotate`, `scale` — so adding a `scale` **property** composes correctly with the classes already there, and with the arrow's existing `rotate`. Do not fold this into a `transform` string; that would apply after all three and re-order the composition.

Add `scale: 1 / view.scale` to the inline style of all three markers.

Objective pin:

```tsx
                        style={{ left: `${u * 100}%`, top: `${v * 100}%`, scale: 1 / view.scale }}
```

Trail dot:

```tsx
                      style={{ left: `${u * 100}%`, top: `${v * 100}%`, scale: 1 / view.scale }}
```

Position arrow:

```tsx
                    style={{
                      left: `${u * 100}%`,
                      top: `${v * 100}%`,
                      scale: 1 / view.scale,
                      rotate: shot.yaw === null ? undefined : `${shot.yaw + extra}deg`,
                    }}
```

Zone polygons are **not** counter-scaled. They are ground area rather than symbols, so they should grow with the map.

- [ ] **Step 7: Typecheck, lint and verify in the browser**

```bash
npm run typecheck
npm run lint
```

Then, on `/raid` with Streets open:

1. The wheel zooms. The building under the cursor stays under the cursor, in both directions. This is the one to be fussy about — put the cursor on a distinctive corner and watch it.
2. The page behind does not scroll while the wheel is over the map.
3. Dragging pans, the cursor shows grab, and the map cannot be dragged past its own edge.
4. Zooming all the way out lands exactly on the fitted view, and Fit greys out there.
5. Double-click zooms in one step toward the cursor.
6. Pins and the position arrow stay the same size on screen at every zoom level. Zone polygons grow with the map.
7. Resize the window while zoomed in: the zoom survives and the map stays clamped.

- [ ] **Step 8: Commit**

```bash
git add src/components/map-overlay.tsx
git commit -m "Zoom the raid map toward the cursor and drag it around"
```

---

### Task 4: Name a pin without waiting a second for it

The `title` attribute takes about a second to appear and arrives in OS chrome. It is replaced by a card in the corner of the stage, fed by hover and by click.

**Files:**
- Modify: `src/components/map-overlay.tsx`

**Interfaces:**
- Consumes: `ObjectivePin` (already imported), `dragged` and `drag` refs (Task 3).
- Produces: no new exports.

- [ ] **Step 1: Add the two pieces of state**

Insert after the `dragged` ref and its effect:

```tsx
  // Two sources, one card. Hover wins while it lasts, so leaving a pin falls back to
  // whatever you clicked, or to nothing. Keyed by `key` rather than holding the pin object,
  // because `objectivePins` rebuilds the array in the parent and identity would not survive
  // it — and because a pin that disappears (pins toggled off, a task completed) then takes
  // its card with it for free.
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const visible = showPins ? pins : [];
  const shownKey = hoveredKey ?? selectedKey;
  const shown = visible.find((pin) => pin.key === shownKey) ?? null;
```

- [ ] **Step 2: Use `visible` where the pins are drawn**

Both pin loops currently read `showPins ? pins.map(...) : null`. Replace the condition in each with a plain map over `visible`, so the card and the drawing can never disagree about what exists.

The polygon loop becomes:

```tsx
                {visible.map((pin) => {
                  if (pin.kind !== "zone" || !pin.outline || pin.outline.length < 3) return null;
                  const points = pin.outline.map((point) => project(calibration, point));
                  if (points.some(({ u, v }) => u < 0 || u > 1 || v < 0 || v > 1)) return null;
                  return (
                    <polygon
                      key={pin.key}
                      points={points.map(({ u, v }) => `${u * 100},${v * 100}`).join(" ")}
                      className="fill-amber/20 stroke-amber/70"
                      strokeWidth="0.3"
                    />
                  );
                })}
```

- [ ] **Step 3: Rewrite the pin button**

Replace the whole `{showPins ? pins.map((pin) => { ... }) : null}` block that draws the dots with this. The `title` attribute is gone — left in place, the OS bubble still fades in a second later and sits on top of the card.

```tsx
              {visible.map((pin) => {
                const { u, v } = project(calibration, pin.position);
                if (u < 0 || u > 1 || v < 0 || v > 1) return null;
                return (
                  <button
                    key={pin.key}
                    type="button"
                    // Focus counts as hover: these are real buttons, so tabbing through them
                    // is what makes the map reachable without a mouse at all.
                    onFocus={() => setHoveredKey(pin.key)}
                    onBlur={() => setHoveredKey((current) => (current === pin.key ? null : current))}
                    onPointerEnter={() => {
                      // Sweeping the map to pan would otherwise strobe the card through
                      // every pin crossed.
                      if (!drag.current) setHoveredKey(pin.key);
                    }}
                    onPointerLeave={() =>
                      setHoveredKey((current) => (current === pin.key ? null : current))
                    }
                    onClick={(event) => {
                      // Without this the stage's own click clears the selection again.
                      event.stopPropagation();
                      if (dragged.current) return;
                      setSelectedKey((current) => (current === pin.key ? null : pin.key));
                    }}
                    aria-label={`${pin.taskName} — ${pin.description}`}
                    style={{ left: `${u * 100}%`, top: `${v * 100}%`, scale: 1 / view.scale }}
                    className={cx(
                      "pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full border transition-transform hover:scale-150",
                      pin.kind === "zone"
                        ? "size-[10px] border-amber bg-amber/60"
                        : "size-[7px] border-bone-dim bg-bone-dim/40",
                      pin.key === shownKey && "ring-2 ring-amber",
                    )}
                  />
                );
              })}
```

- [ ] **Step 4: Clear the selection on a click into empty map**

Add an `onClick` to the stage container, beside the `onPointerDown` and `onDoubleClick` added in Task 3:

```tsx
        onClick={() => {
          if (!dragged.current) setSelectedKey(null);
        }}
```

- [ ] **Step 5: Draw the card**

Insert immediately before the closing `</div>` of the stage container — a sibling of the transformed stage, so it stays put in the corner while the map moves under it.

```tsx
        {shown ? (
          <div className="absolute bottom-4 left-4 max-w-[min(360px,calc(100%-2rem))] border border-line-bright bg-panel/95 p-3">
            <p className="stencil text-[11px] text-amber">{shown.taskName}</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-bone-dim">{shown.description}</p>
            {hoveredKey === null ? (
              // Only on a pin you clicked. A hover card vanishes the moment you move toward
              // it, so offering a link on one would be offering something unreachable.
              <button
                type="button"
                onClick={() => {
                  const id = `task-${shown.taskId}`;
                  onClose();
                  // After the overlay unmounts, so the scroll lock is off and the row is
                  // somewhere a smooth scroll can actually take you.
                  requestAnimationFrame(() => {
                    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
                  });
                }}
                className="stencil mt-2.5 cursor-pointer border border-line-bright px-2 py-1 text-[10px] text-muted transition-colors hover:border-amber hover:text-amber"
              >
                Go to task →
              </button>
            ) : null}
          </div>
        ) : null}
```

- [ ] **Step 6: Typecheck, lint and verify in the browser**

```bash
npm run typecheck
npm run lint
```

On `/raid` with Streets open:

1. Hovering a pin shows the card **immediately**, bottom-left, and no OS tooltip ever appears.
2. Moving off restores the clicked pin's card, or clears it if nothing is clicked.
3. Clicking a pin pins the card and reveals `Go to task →`. Clicking the same pin again clears it.
4. Clicking empty map clears the card. Dragging across the map does not, and does not flicker the card through the pins you cross.
5. `Go to task →` closes the map and lands on the right task row.
6. Tab moves through the pins and each one shows its card.
7. Toggling pins off clears the card with them.

- [ ] **Step 7: Commit**

```bash
git add src/components/map-overlay.tsx
git commit -m "Name a map pin in a card instead of a one-second OS tooltip"
```

---

## Self-review notes

Checked against `docs/superpowers/specs/2026-09-08-map-overlay-design.md`:

| Spec requirement | Task |
| --- | --- |
| Panel collapses to a strip mirroring `Map3d` | 2 |
| Nothing fetched until first open; kept after close | 2 |
| Full-viewport layer, `role="dialog"`, no portal | 2 |
| Escape, close control, focus on open, body scroll lock | 2 |
| Floor switcher and pins toggle move into the overlay header | 2 |
| Floor selection outlives the overlay | 2 |
| Aspect from the drawing's own `viewBox`; parse failure hides the map | 2 |
| `scale: 1` is fitted; `fitBox` sizes the stage | 1, 2 |
| Attribution and "not live tracking" line kept | 2 |
| Wheel zoom toward the cursor, non-passive listener | 1, 3 |
| Clamped 1–8; no pan at scale 1; edges cannot come inside | 1, 3 |
| Drag pan with 4 px slop; drag beginning on a pin pans | 3, 4 |
| Double-click zooms one step | 3 |
| `Fit` control | 3 |
| Markers counter-scale; polygons do not | 3 |
| Resize re-fits without disturbing zoom | 3 |
| Card fed by hover and click, hover winning | 4 |
| No delay; focus counts as hover | 4 |
| `Go to task →` only for a clicked pin | 4 |
| Hover suppressed while dragging | 4 |
| `title` removed from the pins | 4 |
| Zone polygons stay decoration | 2, 4 |
| `viewport.test.ts`, including the cursor invariant | 1 |
| No component test, no jsdom | Global constraints |

**Three things the spec leaves open that this plan decides.**

The spec says the card appears on hover and on click but not what a second click on the same pin does. Task 4 makes it a toggle, which is the only reading under which a selection can be cleared from the keyboard.

The spec does not mention marking which pin the card is describing. Task 4 adds a ring to it. Without one, a card naming one of thirty pins on Streets does not tell you which.

The spec's failure table says a bad `viewBox` is "treated as a parse failure by `prepare`", but the row above it — a failed fetch — closes the overlay, and `prepare` has no way to reach the parent's `failed` flag without a callback plus a synchronous setState in an effect. Task 2 says so in the stage instead of hanging on "loading" forever. The distinction is real: a fetch that failed leaves nothing to show, while a drawing that cannot be read is worth naming.

**Where clamping beats the cursor.** `zoomAt` holds the point under the cursor still *unless* that would drag the map's edge inside the open area, in which case the clamp wins and the point slides. This is asserted as its own test rather than treated as a flaw. Anything else means showing empty ground beside the map.

**The pointer-capture trap.** Task 3 uses window listeners rather than `setPointerCapture` on the stage. With capture, the `click` that follows a `pointerup` is dispatched against the capturing element, so a pin would never receive its own click and Task 4's card would never open. If a future change reaches for capture, this is why it must not.
