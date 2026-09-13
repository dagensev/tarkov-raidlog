'use client';

import { useEffect, useState } from 'react';

import { PRICES_TTL_MS } from '@/lib/store/db';

/** Day, month and time. The time alone read as today's when the prices were yesterday's. */
const stamp = (ms: number): string =>
    new Date(ms).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });

/**
 * When these prices were fetched, and when they stop counting as current.
 *
 * The catalogue is cached for an hour and re-fetched by a check that only runs while the
 * tab is in view, so "refreshes" is where it becomes eligible rather than a promise that
 * something happens at that moment — a tab hidden behind the game all evening sits past
 * it until you look. Saying both is what stops a time on its own reading as current when
 * it was in fact hours ago.
 *
 * Shared by every page that quotes a price, which is now the flea tab and the crafts
 * calculator. A craft's profit is a claim about the market at a moment, and a table of
 * them with no date on it is the same trap the flea tab was written to avoid.
 */
export function PriceStamp({ fetchedAt }: { fetchedAt: number }) {
    const due = fetchedAt + PRICES_TTL_MS;
    // The clock is read here rather than during render, which would be impure, and it is
    // re-read on a slow tick so a tab left open overnight stops claiming to be current.
    const [now, setNow] = useState<number | null>(null);
    useEffect(() => {
        const tick = () => setNow(Date.now());
        tick();
        const timer = setInterval(tick, 60_000);
        return () => clearInterval(timer);
    }, []);

    const stale = now !== null && now > due;
    return (
        <span
            className='data text-[10px] text-muted'
            title={
                stale
                    ? 'Older than an hour. It re-downloads within a few minutes while this tab is in view, or refresh from tarkov.dev in settings.'
                    : 'Cached for an hour, then re-downloaded while this tab is in view.'
            }
        >
            prices {stamp(fetchedAt)} · {stale ? <span className='text-amber-dim'>refresh due</span> : <>refreshes {stamp(due)}</>}
        </span>
    );
}
