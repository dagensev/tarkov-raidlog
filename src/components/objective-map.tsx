'use client';

import { useCallback, useEffect, useState } from 'react';

import type { ScreenshotPosition } from '@/lib/logs/screenshots';
import { calibrationFor, type MapFloor } from '@/lib/maps/calibration';
import type { ObjectivePin } from '@/lib/maps/pins';
import { floorFor } from '@/lib/maps/project';
import type { GameMap } from '@/lib/tarkovdev/types';
import { MapLauncher } from './map-launcher';
import { MapOverlay } from './map-overlay';

/**
 * The card that opens the raid map.
 *
 * Nothing is fetched until you open it: the raid board is opened far more often than the
 * map is actually looked at, and 193 KB of SVG parsed into several thousand nodes is not
 * free.
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
        manualFloor.againstShot === (newestShot?.name ?? null) ? manualFloor.floor : calibration && newestShot ? floorFor(calibration, newestShot.y) : null;

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
            .then((response) => (response.ok ? response.text() : Promise.reject(new Error('no map'))))
            .then(setText)
            .catch(() => {
                if (!aborter.signal.aborted) setFailed(true);
            });
        return () => aborter.abort();
    }, [calibration, open, text]);

    const close = useCallback(() => setOpen(false), [setOpen]);

    // Three maps publish raster tiles instead of an SVG. Say nothing rather than apologise:
    // a card that opens an empty map is worse than no card.
    if (!calibration || failed) return null;

    return (
        <>
            <MapLauncher
                label='Raid map'
                tags={['position tracker', 'task pins']}
                features={[
                    'Displays your position and the route you have walked, when you take an in-raid screenshot',
                    `Pins active task locations`,
                    'Click a pin to read the task',
                ]}
                hints={[
                    `${pins.length} pin${pins.length === 1 ? '' : 's'}`,
                    'drag to pan',
                    'scroll to zoom',
                    'esc to close',
                    trail.length > 0 ? `${trail.length} positions this raid` : 'no position yet this raid',
                ]}
                onOpen={() => setOpen(true)}
            />

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
