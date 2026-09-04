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
