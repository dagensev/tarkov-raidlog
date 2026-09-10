'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ItemIcon } from '@/components/item-icon';
import { Chip, EmptyNote, Label, Lamp, Panel, PanelHeader, Pill, TextField, cx } from '@/components/ui';
import { recordedCount } from '@/lib/sell/hideout-levels';
import { CATEGORY_CHIPS, SELL_FILTERS, filterRows, nextSort, sortRows, toggle, type SellSortKey, type SellView } from '@/lib/sell/filters';
import type { KeepReason } from '@/lib/sell/keep-list';
import type { NamedOffer, SellRow, Verdict } from '@/lib/sell/verdict';
import { rowWindow } from '@/lib/sell/window';
import { useAppStore } from '@/lib/store/app-store';
import { BUNDLE_TTL_MS } from '@/lib/store/db';
import { useEconomy, useSellIndex, useSellRows } from '@/lib/store/hooks';
import { itemIconLink, itemPageLink } from '@/lib/tarkovdev/client';

/**
 * The height of one collapsed row, in pixels: `CELL` plus its padding plus the rule under
 * it, or 56 + 20 + 1.
 *
 * Windowing needs the number up front rather than measured off the DOM, and it has to be
 * the real one — the separating border sits outside a row's declared height, so a row
 * asked for 76 measures 77 and every spacer is then a pixel per row out. Nothing sets the
 * row height directly; the three parts add up to it, and changing any of them changes this.
 */
const ROW_HEIGHT = 77;

/**
 * The cell's own content box.
 *
 * Fixed and clipped rather than left to the content, because the windowing maths assumes
 * every collapsed row is exactly `ROW_HEIGHT`. One row growing to fit a long name would
 * put every row below it out of place by however much it grew.
 */
const CELL = 'flex h-14 items-center overflow-hidden';

/**
 * The money cells.
 *
 * Centred rather than aligned to either edge: each is a two-line stack — a price over the
 * trader it belongs to — and hanging those off the right made the pair read as two ragged
 * columns rather than one label under one figure.
 */
const MONEY = 'flex-col items-center justify-center text-center';

/**
 * A money figure never wraps.
 *
 * Left to itself a long price breaks across two lines, the stack grows past `CELL`, and
 * the cell clips it — so the reader loses a whole line rather than a few digits off the
 * end of one. Clipping sideways at least leaves the leading figures, which are the ones
 * that matter when scanning a column.
 */
const FIGURE = 'data whitespace-nowrap';

/** Roughly what the expanded uses list adds. Only ever an estimate; see `openHeight`. */
const OPEN_HEIGHT_GUESS = 120;

/**
 * The three verdicts.
 *
 * "OK to sell" is a statement about the loaded data rather than a guarantee — the panel
 * below the table lists what this page cannot see — so its tooltip says what was actually
 * checked instead of repeating the label.
 */
const VERDICT: Record<Verdict, { label: string; tone: Parameters<typeof Pill>[0]['tone']; title: string; hint: string }> = {
    keep: {
        label: 'Keep',
        tone: 'rust',
        title: 'A task or a hideout upgrade still wants it',
        hint: 'a task or hideout upgrade wants it',
    },
    'think-twice': {
        label: 'Barter/craft',
        tone: 'amber',
        title: 'Only a barter or a craft wants it, and neither of those ever finishes',
        hint: 'only a barter or a craft does',
    },
    'ok-to-sell': {
        label: 'OK to sell',
        tone: 'moss',
        title: 'No task, hideout upgrade, barter or craft in the loaded data wants it',
        hint: 'nothing in the loaded data wants it',
    },
};

/** Heaviest first, which is the opposite of the order the table opens on. */
const VERDICT_ORDER: readonly Verdict[] = ['keep', 'think-twice', 'ok-to-sell'];

/**
 * What the three badges mean, spelled out once above the table.
 *
 * Each badge carries the same thing as a tooltip, but a tooltip is only found by someone
 * who already suspects there is something to find, and the whole column is a judgement
 * the reader has to trust before acting on it.
 */
function VerdictKey() {
    return (
        <div className='flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line/70 px-4 py-2.5'>
            <Label>Verdicts</Label>
            {VERDICT_ORDER.map((verdict) => (
                <span key={verdict} className='flex items-center gap-2'>
                    <Pill tone={VERDICT[verdict].tone}>{VERDICT[verdict].label}</Pill>
                    <span className='text-[11px] text-muted'>{VERDICT[verdict].hint}</span>
                </span>
            ))}
        </div>
    );
}

const KIND_LABEL: Record<KeepReason['kind'], string> = {
    task: 'Task',
    hideout: 'Hideout',
    barter: 'Barter',
    craft: 'Craft',
};

/**
 * The level the flea market itself opens at.
 *
 * An item asking for this or less is asking for nothing beyond the market being open to
 * you, so the row stays quiet about it.
 */
const FLEA_MIN_LEVEL = 15;

/** Currency symbols for the three the traders deal in. */
const SYMBOL: Record<string, string> = { RUB: '₽', USD: '$', EUR: '€' };

const roubles = (value: number): string => `${Math.round(value).toLocaleString()} ₽`;

/** A signed figure, so a profit column never leaves you working out which way it went. */
const signed = (value: number): string => `${value > 0 ? '+' : value < 0 ? '−' : ''}${roubles(Math.abs(value))}`;

/**
 * A trader offer, priced the way the game prices it.
 *
 * Peacekeeper deals in dollars and his screen says dollars, so a row that showed only the
 * rouble conversion would not match what the reader is looking at. Both are shown, the
 * rouble figure marked as the conversion it is.
 */
function Offer({ offer, tone }: { offer: NamedOffer | null; tone?: string }) {
    if (!offer) return <span className={cx(FIGURE, 'text-[11px] text-muted')}>—</span>;
    const symbol = SYMBOL[offer.currency];
    const foreign = offer.currency !== 'RUB' && symbol;

    return (
        <span className='flex flex-col items-center gap-0.5'>
            <span className={cx(FIGURE, 'text-[12px]', tone ?? 'text-bone')}>
                {foreign ? `${symbol}${offer.price.toLocaleString()} ~ ` : ''}
                {roubles(offer.priceRUB)}
            </span>
            <span className={cx(FIGURE, 'text-[10px] text-muted')}>
                {offer.traderName}
                {offer.minTraderLevel ? ` ${offer.minTraderLevel}` : ''}
                {offer.taskUnlock ? ' · task' : ''}
            </span>
        </span>
    );
}

/** One profit figure: moss when it pays, rust when it costs, a dash when it cannot be told. */
function Profit({ value, title }: { value: number | null; title: string }) {
    if (value === null) return <span className={cx(FIGURE, 'text-[11px] text-muted')}>—</span>;
    return (
        <span title={title} className={cx(FIGURE, 'text-[12px]', value > 0 ? 'text-moss' : value < 0 ? 'text-rust' : 'text-muted')}>
            {signed(value)}
        </span>
    );
}

function Price({ row }: { row: SellRow }) {
    if (row.item.noFlea) return <Pill tone='rust'>no flea</Pill>;
    if (row.flea === null) return <span className={cx(FIGURE, 'text-[11px] text-muted')}>no trades</span>;
    return (
        <span className='flex flex-col items-center gap-0.5'>
            <span className={cx(FIGURE, 'text-[12px] text-bone')}>{roubles(row.flea)}</span>
            {row.fleaFee ? (
                <span className={cx(FIGURE, 'text-[10px] text-muted')} title='Listing fee at this price'>
                    fee {roubles(row.fleaFee)}
                </span>
            ) : null}
        </span>
    );
}

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
 */
function PriceStamp({ fetchedAt }: { fetchedAt: number }) {
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

function Reason({ reason }: { reason: KeepReason }) {
    return (
        <li className={cx('flex flex-wrap items-baseline gap-2', reason.locked && 'opacity-50')}>
            <span className='stencil text-[9px] text-muted'>{KIND_LABEL[reason.kind]}</span>
            {reason.link ? (
                <a
                    href={reason.link}
                    target='_blank'
                    rel='noreferrer'
                    title={`Wiki: ${reason.label}`}
                    className='text-[12px] text-bone-dim underline decoration-line-bright underline-offset-2 transition-colors hover:text-amber hover:decoration-amber'
                >
                    {reason.label}
                </a>
            ) : (
                <span className='text-[12px] text-bone-dim'>{reason.label}</span>
            )}
            {reason.count > 1 ? <span className='data text-[11px] text-amber'>×{reason.count}</span> : null}
            {reason.foundInRaid ? <Pill tone='steel'>found in raid</Pill> : null}
            {reason.alternatives > 1 ? <span className='data text-[10px] text-muted'>1 of {reason.alternatives} accepted</span> : null}
            {reason.optional ? <span className='data text-[10px] text-muted'>optional</span> : null}
            {reason.returned ? <span className='data text-[10px] text-muted'>tool, handed back</span> : null}
            {reason.locked ? <span className='data text-[10px] text-muted'>not reachable yet</span> : null}
        </li>
    );
}

/**
 * Where the verdicts come from.
 *
 * Two different inputs, and only one of them is automatic, so a reader who has not
 * connected their logs or filled in the hideout is looking at a weaker answer than they
 * think. Said once at the top rather than caveated on every row.
 */
function HowItWorks() {
    return (
        <p className='border-b border-line/70 px-4 py-2.5 text-[12px] leading-relaxed text-muted'>
            <Label>How this works</Label> Tasks that need an item are derived from your linked logs. Hideout upgrades and crafts that need one comes from the
            station levels you set in{' '}
            <Link
                href='/settings/'
                className='text-steel underline decoration-line-bright underline-offset-2 transition-colors hover:text-amber hover:decoration-amber'
            >
                settings
            </Link>
            .
        </p>
    );
}

/**
 * The one thing the reader has to supply by hand.
 *
 * Without it every station reads as unbuilt, which is the safe guess but also the noisy
 * one: upgrades finished months ago keep flagging their items, all 213 crafts count as
 * ones you could run, and the flea fee reads as undiscounted. Saying what it costs beats
 * telling them to go and fill a form.
 */
function HideoutPrompt({ recorded, total }: { recorded: number; total: number }) {
    if (total === 0 || recorded >= total) return null;

    return (
        <div className='rise flex flex-wrap items-center gap-3 border border-amber/40 bg-amber/10 px-4 py-3'>
            <Lamp tone='amber' />
            <p className='min-w-0 flex-1 text-[12px] leading-relaxed text-bone'>
                <span className='stencil text-[10px] text-amber'>Hideout not recorded</span>{' '}
                {recorded === 0
                    ? 'No stations recorded yet, so this assumes you have built nothing.'
                    : `${total - recorded} of ${total} stations still unrecorded, so those are assumed unbuilt.`}
            </p>
            <Link
                href='/settings/'
                className='stencil shrink-0 cursor-pointer border border-amber px-3 py-1.5 text-[10px] text-amber transition-colors hover:bg-amber hover:text-ground'
            >
                Set them in settings
            </Link>
        </div>
    );
}

/**
 * The columns, in order.
 *
 * `width` is a percentage of a fixed-layout table rather than something the content
 * decides: the rows are windowed, so a column that sized itself to whatever happens to be
 * on screen would jump every time you scrolled.
 */
const COLUMNS: ReadonlyArray<{
    key: SellSortKey;
    label: string;
    title: string;
    width: string;
    /** The money columns, which centre. Only the item and verdict cells read left. */
    centred?: true;
}> = [
    { key: 'name', label: 'Item', title: 'Alphabetical', width: '24%' },
    {
        key: 'flea',
        label: 'Flea 24h',
        title: '24h flea average, and the fee on listing at it',
        width: '14%',
        centred: true,
    },
    {
        key: 'buyTrader',
        label: 'Buy from trader',
        title: 'The cheapest trader offer, whatever level it needs',
        width: '15%',
        centred: true,
    },
    {
        key: 'sellTrader',
        label: 'Sell to trader',
        title: 'The most any trader pays',
        width: '14%',
        centred: true,
    },
    {
        key: 'fleaVsTrader',
        label: 'Flea vs trader',
        title: 'What listing it clears over vendoring it, once the flea has taken its fee',
        width: '15%',
        centred: true,
    },
    // Sized off the widest cell it can hold: the "Barter/craft" badge at 92px, the gap,
    // and the 64px button. Narrower and the button is pushed out of its fixed slot, which
    // is the one thing that column is arranged to guarantee.
    { key: 'tier', label: 'Verdict', title: 'What still wants it', width: '18%' },
];

function HeaderCell({ column, sort, descending, onSort }: { column: (typeof COLUMNS)[number]; sort: SellSortKey; descending: boolean; onSort: () => void }) {
    const active = sort === column.key;
    return (
        <th
            scope='col'
            aria-sort={active ? (descending ? 'descending' : 'ascending') : 'none'}
            className='border-b border-line bg-panel px-3 py-2 text-left font-normal'
        >
            <button
                type='button'
                onClick={onSort}
                title={column.title}
                className={cx(
                    'stencil flex w-full cursor-pointer items-center gap-1 text-[10px] transition-colors',
                    column.centred && 'justify-center',
                    active ? 'text-amber' : 'text-muted hover:text-bone-dim',
                )}
            >
                {column.label}
                <span aria-hidden className='data text-[9px]'>
                    {active ? (descending ? '▼' : '▲') : ''}
                </span>
            </button>
        </th>
    );
}

function Row({ row, open, onToggle }: { row: SellRow; open: boolean; onToggle: () => void }) {
    const verdict = VERDICT[row.verdict];
    const reasons = row.keep?.reasons ?? [];
    const keepCount = row.keep?.keepCount ?? 0;
    // Restricted items carry a level too, and it means nothing for them.
    const reqLevel = row.item.noFlea ? 0 : row.item.minLevelForFlea;
    // The flea itself opens at 15, so anything at or below that is no restriction at all
    // and saying so on every second row is noise. In today's data nothing sits between
    // 1 and 15, but the rule is the flea's rather than the data's.
    const gated = reqLevel > FLEA_MIN_LEVEL;
    // The one case where the flea is the wrong answer even though it is open to you.
    const traderWins = row.fleaVsTrader !== null && row.fleaVsTrader < 0;

    return (
        <tr className={cx('border-b border-line/70 transition-colors hover:bg-panel-2/60', open && 'bg-panel-2/60')}>
            <td className='px-3 py-[10px]'>
                <div className={cx(CELL, 'gap-3')}>
                    {/* A stash-cell box, so icons of different footprints still line up and
                        the table scans down the left edge. */}
                    <div className='flex size-14 shrink-0 items-center justify-center border border-line bg-ground-2'>
                        <ItemIcon src={itemIconLink(row.item)} size={48} />
                    </div>
                    <div className='min-w-0 flex-1'>
                        <div className='truncate text-[13px] text-bone' title={row.item.name}>
                            {row.item.name}
                        </div>
                        <div className='mt-1 flex flex-wrap items-center gap-2'>
                            <span className='data text-[10px] text-muted'>
                                {row.item.width}×{row.item.height}
                            </span>
                            {gated ? (
                                <span className='data text-[10px] text-amber-dim' title={`The flea needs level ${reqLevel} to list this`}>
                                    Req lvl {reqLevel}
                                </span>
                            ) : null}
                            <a
                                href={row.item.wikiLink ?? itemPageLink(row.item)}
                                target='_blank'
                                rel='noreferrer'
                                title={row.item.wikiLink ? 'Wiki page' : 'tarkov.dev page'}
                                className='data text-[10px] text-steel underline underline-offset-2 transition-colors hover:text-amber'
                            >
                                Wiki
                            </a>
                        </div>
                    </div>
                </div>
            </td>
            <td className='px-3 py-[10px]'>
                <div className={cx(CELL, MONEY)}>
                    <Price row={row} />
                </div>
            </td>
            <td className='px-3 py-[10px]'>
                <div className={cx(CELL, MONEY)}>
                    <Offer offer={row.buy} />
                </div>
            </td>
            <td className='px-3 py-[10px]'>
                <div className={cx(CELL, MONEY)}>
                    <Offer offer={row.trader} tone={traderWins ? 'text-moss' : undefined} />
                </div>
            </td>
            <td className='px-3 py-[10px]'>
                <div className={cx(CELL, MONEY)}>
                    <Profit value={row.fleaVsTrader} title='Flea average, less the listing fee, less what the best trader pays' />
                </div>
            </td>
            <td className='px-3 py-[10px]'>
                {/* Never wraps, and the button is flush right at a fixed width, so it sits
                    in the same place on every row whatever the verdict beside it reads.
                    Expanding one item and collapsing it again is two clicks in one spot. */}
                <div className={cx(CELL, 'justify-between gap-2')}>
                    <Pill tone={verdict.tone}>
                        <span title={verdict.title}>{verdict.label}</span>
                        {keepCount > 0 ? (
                            <span
                                className='data ml-1.5 opacity-70'
                                title='How many, counting tasks and hideout upgrades. Barters and crafts are left out, since neither ever finishes.'
                            >
                                {keepCount}
                            </span>
                        ) : null}
                    </Pill>
                    {/* Fixed at 64px wide: the longest label the data produces, "21 uses",
                        measures 58, and a fixed box is what keeps the button in the same
                        place whether it reads that or "Hide". */}
                    {reasons.length > 0 ? (
                        <button
                            type='button'
                            onClick={onToggle}
                            aria-expanded={open}
                            className='stencil w-16 shrink-0 cursor-pointer border border-line-bright px-1 py-1 text-center text-[9px] text-muted transition-colors hover:text-bone-dim'
                        >
                            {open ? 'Hide' : `${reasons.length} ${reasons.length === 1 ? 'use' : 'uses'}`}
                        </button>
                    ) : null}
                </div>
            </td>
        </tr>
    );
}

export default function FleaPage() {
    const economy = useEconomy();
    const index = useSellIndex();
    const rows = useSellRows();
    const view = useAppStore((s) => s.sellView);
    const hideoutLevels = useAppStore((s) => s.settings.hideoutLevels);
    const playerLevel = useAppStore((s) => s.settings.playerLevel);
    const update = useAppStore((s) => s.updateSettings);
    const setView = useAppStore((s) => s.setSellView);
    const loading = useAppStore((s) => s.dataLoading);
    const downloading = useAppStore((s) => s.catalogueLoading);

    const [openId, setOpenId] = useState<string | null>(null);
    const [openHeight, setOpenHeight] = useState(OPEN_HEIGHT_GUESS);
    // How far the table's first row has scrolled above the top of the window, and how much
    // window there is to fill. Both are read off the page rather than tracked, so nothing
    // above the table — the filter chips wrapping onto another line, say — throws them out.
    const [scrolled, setScrolled] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(800);
    const body = useRef<HTMLTableSectionElement | null>(null);

    const visible = useMemo(() => sortRows(filterRows(rows, view, playerLevel), view), [rows, view, playerLevel]);

    const openIndex = useMemo(() => (openId === null ? -1 : visible.findIndex((row) => row.item.id === openId)), [visible, openId]);

    const slice = rowWindow({
        scrollTop: scrolled,
        viewportHeight,
        rowHeight: ROW_HEIGHT,
        count: visible.length,
        open: openIndex >= 0 ? { index: openIndex, height: openHeight } : null,
    });

    // The page's own scrollbar drives the table, the way tarkov-market does it — a second
    // one inside a panel means two things to drag and a header that scrolls away from the
    // rows it labels.
    useEffect(() => {
        const read = () => {
            const element = body.current;
            setScrolled(element ? -element.getBoundingClientRect().top : 0);
            setViewportHeight(window.innerHeight);
        };
        read();
        window.addEventListener('scroll', read, { passive: true });
        window.addEventListener('resize', read);
        return () => {
            window.removeEventListener('scroll', read);
            window.removeEventListener('resize', read);
        };
    }, []);

    // Sorting or filtering under a scrolled table leaves you somewhere arbitrary in a list
    // that is no longer the one you were reading, so every control goes through here.
    const apply = useCallback(
        (patch: Partial<SellView>) => {
            setView(patch);
            window.scrollTo({ top: 0 });
        },
        [setView],
    );

    // Measured rather than guessed: the uses list is one line per reason and some items
    // carry a dozen, so a fixed guess would leave every row below it out of place.
    const measureOpen = useCallback((element: HTMLTableRowElement | null) => {
        if (element) setOpenHeight(element.offsetHeight);
    }, []);

    return (
        <div className='space-y-4'>
            <HideoutPrompt recorded={recordedCount(hideoutLevels)} total={economy?.stations.length ?? 0} />

            <Panel className='rise'>
                <PanelHeader title='Flea market' action={index ? <PriceStamp fetchedAt={index.fetchedAt} /> : null} />
                <HowItWorks />
                <div className='flex flex-wrap items-center gap-2 border-b border-line/70 px-4 py-3'>
                    <TextField
                        value={view.query}
                        onChange={(e) => apply({ query: e.target.value })}
                        placeholder='Search any item'
                        aria-label='Search any item'
                        className='w-56'
                    />
                    {CATEGORY_CHIPS.map((chip) => (
                        <Chip
                            key={chip.id}
                            title={chip.title}
                            active={view.categories.includes(chip.id)}
                            onClick={() => apply({ categories: toggle(view.categories, chip.id) })}
                        >
                            {chip.label}
                        </Chip>
                    ))}
                </div>
                <div className='flex flex-wrap items-center gap-2 px-4 py-3'>
                    {SELL_FILTERS.map((option) => (
                        <Chip
                            key={option.id}
                            title={option.title}
                            active={view.uses.includes(option.id)}
                            onClick={() => apply({ uses: toggle(view.uses, option.id) })}
                        >
                            {option.label}
                        </Chip>
                    ))}

                    <div className='ml-auto flex flex-wrap items-center gap-2'>
                        <Chip
                            active={view.hideNoFlea}
                            onClick={() => apply({ hideNoFlea: !view.hideNoFlea })}
                            title='Hide items that cannot be listed on the flea at all'
                        >
                            Flea only
                        </Chip>
                        <label
                            className='flex items-center gap-2'
                            title='Your character level. Items the flea will not list at that level are hidden; clear it to see them all.'
                        >
                            <span className='stencil text-[10px] text-muted'>Flea lvl</span>
                            <TextField
                                type='number'
                                min={1}
                                max={99}
                                value={playerLevel ?? ''}
                                onChange={(e) =>
                                    void update({
                                        playerLevel: e.target.value === '' ? null : Number(e.target.value),
                                    })
                                }
                                placeholder='—'
                                aria-label='Your character level'
                                className='w-16'
                            />
                        </label>
                    </div>
                </div>
            </Panel>

            <Panel className='rise' style={{ animationDelay: '60ms' }}>
                <PanelHeader title='Catalogue' meta={`${visible.length.toLocaleString()} of ${rows.length.toLocaleString()} items`} />
                <VerdictKey />
                {!index || !economy ? (
                    <EmptyNote>
                        {loading
                            ? 'Loading game data.'
                            : downloading
                              ? 'Downloading prices and the hideout, barter and craft lists. It is a 16.7 MB fetch and happens once a day.'
                              : 'The catalogue did not load. Try the button below.'}
                    </EmptyNote>
                ) : visible.length === 0 ? (
                    <EmptyNote>Nothing matches these filters.</EmptyNote>
                ) : (
                    <div>
                        <table className='w-full table-fixed border-collapse'>
                            <colgroup>
                                {COLUMNS.map((column) => (
                                    <col key={column.key} style={{ width: column.width }} />
                                ))}
                            </colgroup>
                            <thead className='sticky top-0 z-10'>
                                <tr>
                                    {COLUMNS.map((column) => (
                                        <HeaderCell
                                            key={column.key}
                                            column={column}
                                            sort={view.sort}
                                            descending={view.descending}
                                            onSort={() => apply(nextSort(view, column.key))}
                                        />
                                    ))}
                                </tr>
                            </thead>
                            <tbody ref={body}>
                                {/* Spacers stand in for the rows either side of the window, so
                                    the scrollbar measures the whole catalogue and not just what
                                    is drawn. */}
                                {slice.padTop > 0 ? (
                                    <tr aria-hidden style={{ height: slice.padTop }}>
                                        <td colSpan={COLUMNS.length} />
                                    </tr>
                                ) : null}

                                {visible.slice(slice.start, slice.end).map((row) => {
                                    const open = openId === row.item.id;
                                    const reasons = row.keep?.reasons ?? [];
                                    return (
                                        <Fragment key={row.item.id}>
                                            <Row row={row} open={open} onToggle={() => setOpenId(open ? null : row.item.id)} />
                                            {open && reasons.length > 0 ? (
                                                <tr ref={measureOpen} className='bg-panel-2/60'>
                                                    <td colSpan={COLUMNS.length} className='px-4 pb-3'>
                                                        <ul className='space-y-1 border-l border-line-bright pl-4'>
                                                            {reasons.map((reason, i) => (
                                                                // Indexed: one task can want an item for two
                                                                // objectives that differ in found-in-raid or in
                                                                // how many alternatives they take, so kind and
                                                                // source id alone are not unique.
                                                                <Reason key={`${reason.kind}-${reason.sourceId}-${i}`} reason={reason} />
                                                            ))}
                                                        </ul>
                                                    </td>
                                                </tr>
                                            ) : null}
                                        </Fragment>
                                    );
                                })}

                                {slice.padBottom > 0 ? (
                                    <tr aria-hidden style={{ height: slice.padBottom }}>
                                        <td colSpan={COLUMNS.length} />
                                    </tr>
                                ) : null}
                            </tbody>
                        </table>
                    </div>
                )}
            </Panel>
        </div>
    );
}
