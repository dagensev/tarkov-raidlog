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

  const close = useCallback(() => setOpen(false), [setOpen]);

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
