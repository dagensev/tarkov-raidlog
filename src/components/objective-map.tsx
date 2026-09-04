"use client";

import { useEffect, useMemo, useState } from "react";

import type { ScreenshotPosition } from "@/lib/logs/screenshots";
import { calibrationFor, type MapFloor } from "@/lib/maps/calibration";
import type { ObjectivePin } from "@/lib/maps/pins";
import { project } from "@/lib/maps/project";
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
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [floor, setFloor] = useState<MapFloor | null>(null);
  const [zoomed, setZoomed] = useState(false);

  // No reset of text/failed/floor here: the caller keys this component on the map id (see
  // raid/page.tsx), so a map change remounts rather than re-running this effect, and the
  // useState defaults above already are the reset values. Resetting here too would just be
  // a synchronous setState in an effect body, which the lint rule (rightly) flags.
  useEffect(() => {
    if (!calibration) return;
    const aborter = new AbortController();
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
          <div className={cx("relative", zoomed ? "w-[200%] max-w-none" : "w-full")}>
            <div
              // This markup is still someone else's SVG, not something sanitised: `prepare`
              // only drops inactive floor groups, so a `<script>` in the source would run
              // when `replaceChildren` mounts it. Trust rests entirely on `svgPath` being a
              // fixed, pinned assets.tarkov.dev URL rather than on anything done to the markup.
              ref={(node) => {
                if (!node) return;
                node.replaceChildren(svg);
              }}
            />

            {/*
              A sibling of the SVG holder, not a child of it: that node's `replaceChildren`
              re-fires on every render (the ref callback is a fresh closure each time), which
              would silently wipe any JSX mounted inside it. Sharing this wrapper rather than
              the scroll container above keeps pins aligned with the picture in both zoom
              states — the scroll container's own box stays the panel's visible size when
              zoomed, while this wrapper grows to the picture's full doubled width.
            */}
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
          </div>
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
