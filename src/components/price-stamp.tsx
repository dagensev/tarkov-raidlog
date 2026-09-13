'use client';

import { useEffect, useState } from 'react';

import { BUNDLE_TTL_MS } from '@/lib/store/db';

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
 * The catalogue is cached for a day and only re-fetched when the app next opens and finds
 * it stale, so "refreshes" is where it becomes eligible rather than a promise that
 * something happens at that moment. Saying both is what stops a time on its own reading
 * as this morning when it was in fact yesterday afternoon.
 *
 * Shared by every page that quotes a price, which is now the flea tab and the crafts
 * calculator. A craft's profit is a claim about the market at a moment, and a table of
 * them with no date on it is the same trap the flea tab was written to avoid.
 */
export function PriceStamp({ fetchedAt }: { fetchedAt: number }) {
    const due = fetchedAt + BUNDLE_TTL_MS;
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
                    ? 'Older than a day. Reload the page, or refresh from tarkov.dev in settings.'
                    : 'Cached for a day. The next time you open this after that, it re-downloads.'
            }
        >
            prices {stamp(fetchedAt)} · {stale ? <span className='text-amber-dim'>refresh due</span> : <>refreshes {stamp(due)}</>}
        </span>
    );
}
