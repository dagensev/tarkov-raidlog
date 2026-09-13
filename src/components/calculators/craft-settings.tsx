'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { Chip, Label, SelectField, TextField } from '@/components/ui';
import { FUEL_TANKS } from '@/lib/crafts/fuel';
import { MARKET_KINDS, ROUTE_KINDS, type FleaBasis, type RouteKind } from '@/lib/crafts/pricing';
import { useAppStore } from '@/lib/store/app-store';
import { useFuelCost } from '@/lib/store/hooks';

import { FIGURE, roubles } from './craft-format';

/**
 * How the table prices a craft, behind a gear in the Crafts header.
 *
 * These are not filters. A filter changes which rows you are looking at; these change what
 * every row *says*, which is why they sit apart from the chips. They also get set once and
 * left alone, so they were a full panel of screen above the table that nobody reads twice.
 * A dialog keeps them one click away without pushing the list down.
 *
 * The one thing that must not hide in here is a fuel tank with no price, because then fuel
 * is silently not being charged. The gear carries a lamp for that case.
 *
 * All of it persists, unlike the filters, because re-answering "where do you buy sugar"
 * every session would make the page not worth opening.
 */

/** The four routes, in the words each side of a craft uses for them. */
const ROUTES: ReadonlyArray<{ kind: RouteKind; label: string; buy: string; sell: string }> = [
    { kind: 'flea', label: 'Flea', buy: 'Buy it on the flea market', sell: 'List it on the flea, after the fee' },
    { kind: 'trader', label: 'Trader', buy: 'Buy it from a trader for cash', sell: 'Sell it to a trader' },
    {
        kind: 'barter',
        label: 'Barter',
        buy: 'Trade other items to a trader for it',
        sell: 'Trade it to a trader for something that sells for more',
    },
    {
        kind: 'craft',
        label: 'Craft',
        buy: 'Make it at a hideout station, adding that craft’s time',
        sell: 'Craft it on into something that sells for more, adding that craft’s time',
    },
];

/**
 * Named for what the figure is, not when it was fetched. "24h average" read as a price a day
 * old once prices started refreshing hourly, when the 24 hours is only the window the
 * average is taken over — both figures arrive with the same hourly refresh.
 */
const BASES: ReadonlyArray<{ value: FleaBasis; label: string }> = [
    { value: 'avg24h', label: 'Average sale, last 24h' },
    { value: 'lastLow', label: 'Lowest listing' },
];

function Field({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
    return (
        <label className='flex min-w-0 flex-col gap-1.5' title={hint}>
            <Label>{label}</Label>
            {children}
        </label>
    );
}

const isMarket = (kind: RouteKind) => MARKET_KINDS.includes(kind);

/**
 * Which of the four routes one side of a craft may take.
 *
 * Toggles rather than a select, because the answer is a set: the table takes whichever
 * enabled route suits each row, so "flea and barter but not trader" is a real choice. The
 * last market on a side will not switch off — a barter or a craft is paid for in items, and
 * a chain with no market to end at prices nothing, which would blank every row.
 */
function RouteToggles({
    label,
    side,
    value,
    onChange,
}: {
    label: string;
    side: 'buy' | 'sell';
    value: readonly RouteKind[];
    onChange: (next: RouteKind[]) => void;
}) {
    const markets = value.filter(isMarket).length;

    return (
        <div className='flex min-w-0 flex-col gap-1.5' role='group' aria-label={label}>
            <Label>{label}</Label>
            <div className='flex flex-wrap gap-1.5'>
                {ROUTES.map((route) => {
                    const active = value.includes(route.kind);
                    const pinned = active && isMarket(route.kind) && markets === 1;
                    return (
                        <Chip
                            key={route.kind}
                            active={active}
                            title={
                                pinned
                                    ? `${route[side]}. The last market stays on: barters and crafts are paid for in items, and those have to be bought or sold somewhere.`
                                    : route[side]
                            }
                            onClick={() => {
                                if (pinned) return;
                                // Rebuilt in the fixed order, so the stored list never depends on
                                // the order the toggles were clicked in.
                                onChange(ROUTE_KINDS.filter((kind) => (kind === route.kind ? !active : value.includes(kind))));
                            }}
                            className={pinned ? 'cursor-default' : undefined}
                        >
                            {route.label}
                        </Chip>
                    );
                })}
            </div>
        </div>
    );
}

/**
 * A gear, drawn from two stroked rings: a dashed outer one for the teeth and a solid inner
 * one for the body. Stroke only, in `currentColor`, so it takes the button's hover colour
 * with nothing else to keep in step.
 */
function GearIcon() {
    return (
        <svg aria-hidden viewBox='0 0 24 24' width={13} height={13} fill='none' stroke='currentColor'>
            <circle cx='12' cy='12' r='8.3' strokeWidth='2.6' strokeDasharray='3.26 3.26' />
            <circle cx='12' cy='12' r='5.4' strokeWidth='2.6' />
        </svg>
    );
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
    const settings = useAppStore((s) => s.settings);
    const update = useAppStore((s) => s.updateSettings);
    const fuel = useFuelCost();

    // Fuel is switched on but the tank has no price, so nothing is being charged. Said out
    // loud rather than left as a silently absent cost: a profit figure that quietly forgot
    // the fuel is the most misleading thing this table could print.
    const fuelUnpriced = settings.craftIncludeFuel && fuel.roublesPerHour === null;

    // The same three behaviours the raid map overlay has: Escape closes, the page behind
    // stops scrolling, and focus goes to Close. Handing focus back to the gear is the
    // gear's job, see `CraftSettings`.
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    useEffect(() => {
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previous;
        };
    }, []);

    const closeRef = useRef<HTMLButtonElement | null>(null);
    useEffect(() => {
        closeRef.current?.focus();
    }, []);

    return (
        <div
            // Mouse down rather than click, so dragging out of a select and releasing over
            // the backdrop does not throw the dialog away.
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
            className='fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ground/75 px-4 py-16'
        >
            <div role='dialog' aria-modal='true' aria-labelledby='craft-settings-title' className='bracket w-full max-w-3xl border border-line bg-panel'>
                <header className='border-b border-line'>
                    <div className='flex items-center justify-between gap-4 px-4 pt-3 pb-2'>
                        <h2 id='craft-settings-title' className='stencil text-[11px] text-amber'>
                            Settings
                        </h2>
                        <div className='flex items-center gap-3'>
                            <span className='data text-[11px] text-muted'>
                                {settings.craftIncludeFuel && fuel.roublesPerHour !== null ? `fuel ${roubles(fuel.roublesPerHour)}/h` : 'fuel off'}
                            </span>
                            <button
                                ref={closeRef}
                                type='button'
                                onClick={onClose}
                                className='stencil cursor-pointer border border-line-bright px-2 py-1 text-[10px] text-muted transition-colors hover:border-amber hover:text-amber'
                            >
                                Close
                            </button>
                        </div>
                    </div>
                    <div className='ticks h-[3px] opacity-40' />
                </header>

                {/* How the table reaches its numbers. Three of its inputs are things the reader
                    supplied, and someone who has filled in none of them is looking at a weaker
                    answer than they think, so it is said once here rather than on 213 rows.
                    One short point each, because a paragraph of it went unread. */}
                <div className='border-b border-line/70 px-4 py-2.5 text-[12px] leading-relaxed text-muted'>
                    <Label>How this works</Label>
                    <ul className='mt-1 list-disc space-y-0.5 pl-4 marker:text-line-bright'>
                        <li>Ingredients cost the cheapest way you can get them.</li>
                        <li>The product earns the most it can, after the flea fee.</li>
                        <li>Turn on Barter or Craft to let them replace buying or selling, up to three steps deep.</li>
                        <li>Extra crafts add their time, so each row picks the plan with the best profit per hour.</li>
                        <li>Barters and crafts you can’t do yet are still used, and marked in red.</li>
                        <li>Powered stations are charged fuel.</li>
                        <li>
                            Hideout levels, trader loyalty and Crafting skill are set on the{' '}
                            <Link
                                href='/settings/'
                                className='text-steel underline decoration-line-bright underline-offset-2 transition-colors hover:text-amber hover:decoration-amber'
                            >
                                Settings page
                            </Link>
                            .
                        </li>
                    </ul>
                </div>

                <div className='grid gap-4 border-b border-line/70 px-4 py-4 sm:grid-cols-2'>
                    <RouteToggles label='Buy inputs from' side='buy' value={settings.craftBuyFrom} onChange={(next) => void update({ craftBuyFrom: next })} />
                    <RouteToggles label='Sell output to' side='sell' value={settings.craftSellTo} onChange={(next) => void update({ craftSellTo: next })} />
                </div>

                <div className='grid gap-4 px-4 py-4 sm:grid-cols-2 lg:grid-cols-3'>
                    <Field
                        label='Flea price'
                        hint='Which flea figure stands in for the price, on both sides of the trade. Both update with the hourly price refresh: the average smooths out spikes, the lowest listing is the cheapest offer at that refresh.'
                    >
                        <SelectField value={settings.craftFleaBasis} onChange={(e) => void update({ craftFleaBasis: e.target.value as FleaBasis })}>
                            {BASES.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </SelectField>
                    </Field>

                    <Field label='Fuel tank' hint='Priced from its own flea figure, divided by how much it holds.'>
                        <SelectField
                            value={settings.fuelTankId}
                            disabled={!settings.craftIncludeFuel}
                            onChange={(e) => void update({ fuelTankId: e.target.value })}
                        >
                            {FUEL_TANKS.map((tank) => (
                                <option key={tank.itemId} value={tank.itemId}>
                                    {tank.label}
                                </option>
                            ))}
                        </SelectField>
                    </Field>

                    <Field
                        label='Fuel per hour'
                        hint='Derived from the tank. Overwrite it to cover what the derivation leaves out, Hideout Management chiefly.'
                    >
                        <TextField
                            type='number'
                            min={0}
                            disabled={!settings.craftIncludeFuel}
                            value={settings.fuelRoublesPerHour ?? (fuel.derived === null ? '' : Math.round(fuel.derived))}
                            onChange={(e) =>
                                void update({
                                    fuelRoublesPerHour: e.target.value === '' ? null : Number(e.target.value),
                                })
                            }
                            placeholder='—'
                            aria-label='Fuel roubles per hour'
                        />
                    </Field>

                    <div className='flex flex-col justify-end gap-1.5'>
                        <span className={`${FIGURE} text-[11px] text-muted`}>
                            {fuel.solarPower ? 'Solar Power halves the burn' : 'No Solar Power recorded'}
                        </span>
                        {settings.fuelRoublesPerHour !== null ? (
                            <button
                                type='button'
                                onClick={() => void update({ fuelRoublesPerHour: null })}
                                className='stencil w-fit cursor-pointer border border-line-bright px-2 py-1 text-[9px] text-muted transition-colors hover:text-bone-dim'
                            >
                                Use derived
                            </button>
                        ) : null}
                    </div>
                </div>

                <div className='flex flex-wrap gap-2 border-t border-line/70 px-4 py-3'>
                    <Chip
                        active={settings.craftIncludeFuel}
                        onClick={() => void update({ craftIncludeFuel: !settings.craftIncludeFuel })}
                        title='The generator burns at a flat rate whenever it is on, so every craft at a powered station carries a share of it. The Lavatory runs without power and is never charged.'
                    >
                        Charge fuel
                    </Chip>
                    <Chip
                        active={settings.craftRespectLoyalty}
                        onClick={() => void update({ craftRespectLoyalty: !settings.craftRespectLoyalty })}
                        title='Skip trader offers above the loyalty recorded in settings. An unrecorded trader counts as level 1.'
                    >
                        My loyalty only
                    </Chip>
                </div>

                {fuelUnpriced ? (
                    <p className='border-t border-line/70 px-4 py-2.5 text-[12px] leading-relaxed text-amber-dim'>
                        <Label>No fuel price</Label> The {fuel.tank.label} has no flea figure right now, so nothing is being charged for fuel. Type a figure
                        above, or turn the charge off, rather than reading these profits as though fuel were free.
                    </p>
                ) : null}
            </div>
        </div>
    );
}

/**
 * The gear and the dialog it opens.
 *
 * Portalled to the body rather than rendered in place. It is opened from inside a panel
 * header, and a fixed element under any ancestor with a transform — the panels' rise
 * animation leaves one — is positioned against that ancestor rather than the window.
 */
export function CraftSettings() {
    const [open, setOpen] = useState(false);
    const gear = useRef<HTMLButtonElement | null>(null);
    // Focus goes back to the gear by reference rather than to whatever was focused when the
    // dialog opened: Safari never focuses a button on click, so "what was focused" is often
    // the page itself, and a keyboard reader would land back at the top of the document.
    const close = useCallback(() => {
        setOpen(false);
        gear.current?.focus();
    }, []);
    const includeFuel = useAppStore((s) => s.settings.craftIncludeFuel);
    const fuel = useFuelCost();
    const fuelUnpriced = includeFuel && fuel.roublesPerHour === null;

    return (
        <>
            <button
                ref={gear}
                type='button'
                onClick={() => setOpen(true)}
                aria-haspopup='dialog'
                aria-expanded={open}
                title={fuelUnpriced ? 'The fuel tank has no price, so fuel is not being charged' : 'How crafts are priced'}
                className='stencil relative flex cursor-pointer items-center gap-1.5 border border-line-bright px-2 py-1 text-[10px] text-muted transition-colors hover:border-amber hover:text-amber'
            >
                <GearIcon />
                Settings
                {fuelUnpriced ? <span aria-hidden className='absolute -top-1 -right-1 size-2 bg-amber' /> : null}
            </button>
            {open ? createPortal(<SettingsDialog onClose={close} />, document.body) : null}
        </>
    );
}
