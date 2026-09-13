'use client';

import type { ReactNode } from 'react';

import { cx } from '@/components/ui';

/**
 * The money and duration formatting the crafts table shares between its cells and its
 * expanded breakdown.
 *
 * Kept beside the table rather than in `@/lib/crafts` because none of it is domain logic —
 * a rouble sign and a colour for a negative are decisions about a screen, and the modules
 * that work out the numbers should not know a screen exists.
 */

/** A money figure never wraps: a broken price loses a whole line to the cell's clip. */
export const FIGURE = 'data whitespace-nowrap';

export const roubles = (value: number): string => `${Math.round(value).toLocaleString()} ₽`;

/** A signed figure, so a profit column never leaves you working out which way it went. */
export const signed = (value: number): string =>
    `${value > 0 ? '+' : value < 0 ? '−' : ''}${roubles(Math.abs(value))}`;

/**
 * A craft's length, in the units the game's own timer uses.
 *
 * Hours and minutes rather than a decimal: "10h" is what the hideout screen says, and
 * "10.25 h" is a number nobody is comparing against anything.
 */
export function duration(seconds: number): string {
    if (seconds <= 0) return '—';
    const total = Math.round(seconds / 60);
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    if (hours === 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
}

/** Moss when it pays, rust when it costs, a dash when the table cannot tell. */
export function Money({
    value,
    title,
    className,
}: {
    value: number | null;
    title?: string;
    className?: string;
}) {
    if (value === null) {
        return (
            <span title={title} className={cx(FIGURE, 'text-[11px] text-muted', className)}>
                —
            </span>
        );
    }
    return (
        <span
            title={title}
            className={cx(
                FIGURE,
                value > 0 ? 'text-moss' : value < 0 ? 'text-rust' : 'text-muted',
                className,
            )}
        >
            {signed(value)}
        </span>
    );
}

/** A label over a figure, for the breakdown's summary line. */
export function Figure({ label, children }: { label: string; children: ReactNode }) {
    return (
        <span className='flex flex-col gap-0.5'>
            <span className='stencil text-[9px] text-muted'>{label}</span>
            {children}
        </span>
    );
}
