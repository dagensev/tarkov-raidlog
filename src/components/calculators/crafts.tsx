'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ItemIcon } from '@/components/item-icon';
import { PriceStamp } from '@/components/price-stamp';
import { Chip, EmptyNote, Label, Panel, PanelHeader, Pill, TextField, cx } from '@/components/ui';
import type { CraftLine, CraftRow } from '@/lib/crafts/craft-row';
import {
    CRAFT_LEVELS,
    filterCraftRows,
    nextCraftSort,
    sortCraftRows,
    type CraftSortKey,
    type CraftView,
} from '@/lib/crafts/filters';
import { useAppStore } from '@/lib/store/app-store';
import { useCraftRows, useCraftStations, useEconomy, useSellIndex, useTasks } from '@/lib/store/hooks';
import { rowWindow } from '@/lib/table/window';
import { itemIconLink, itemPageLink, type SellItem } from '@/lib/tarkovdev/client';
import { uiScale } from '@/lib/ui-scale';

import { CraftSettings } from './craft-settings';
import { FIGURE, Figure, Money, duration, roubles } from './craft-format';

/**
 * The height of one collapsed row, in pixels.
 *
 * `CELL` at 80, its 10px of padding top and bottom, and the 1px rule under it. The
 * windowing needs this up front rather than measured, and it has to be the real number —
 * the border sits outside the declared height, so being one out puts every spacer a pixel
 * per row wrong. Nothing sets the row height directly; these three add up to it.
 *
 * Taller than the flea tab's 77 because the process cell stacks a name over an icon over
 * a count, which is the whole point of drawing it that way.
 */
const ROW_HEIGHT = 101;

/**
 * The cell's own content box.
 *
 * Fixed and clipped rather than left to the content: the windowing assumes every collapsed
 * row is exactly `ROW_HEIGHT`, and one craft with six ingredients growing to fit would put
 * every row below it out of place.
 */
const CELL = 'flex h-20 items-center overflow-hidden';

/** Roughly what the breakdown adds. Only ever an estimate; the real one is measured. */
const OPEN_HEIGHT_GUESS = 200;

/**
 * The columns, in order.
 *
 * `width` is a percentage of a fixed-layout table rather than something the content
 * decides: the rows are windowed, so a column that sized itself to whatever happened to be
 * on screen would jump every time you scrolled.
 */
const COLUMNS: ReadonlyArray<{
    key: CraftSortKey;
    label: string;
    title: string;
    width: string;
    /** The money and time columns, which centre. Station and craft read left. */
    centred?: true;
}> = [
    { key: 'station', label: 'Station', title: 'By station, then by the level it needs', width: '12%' },
    {
        key: 'craft',
        // Sized off the widest craft the data holds: five ingredients, a chevron and a
        // product is 402px of boxes, which fits this column down to a 1024px window.
        label: 'Craft',
        title: 'What goes in and what comes out. Alphabetical by product.',
        width: '48%',
    },
    {
        key: 'time',
        label: 'Craft time',
        title: 'One run at your Crafting skill. Fastest first.',
        width: '11%',
        centred: true,
    },
    {
        key: 'profit',
        label: 'Profit',
        title: 'What one run clears: the product sold, less the ingredients, less the fuel',
        width: '14%',
        centred: true,
    },
    {
        key: 'profitPerHour',
        label: 'Profit / H',
        title: 'That profit over the time the station is occupied, which is what actually ranks a craft',
        width: '15%',
        centred: true,
    },
];

function HeaderCell({
    column,
    sort,
    descending,
    onSort,
}: {
    column: (typeof COLUMNS)[number];
    sort: CraftSortKey;
    descending: boolean;
    onSort: () => void;
}) {
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

/**
 * One item in the process cell: its name, its icon in a stash-cell box, and how many.
 *
 * The name sits above rather than beside, which is what lets six of these fit across the
 * column and still be read at a glance. Fixed width, so a long name truncates instead of
 * pushing the arrow and the product off the end.
 */
function ProcessItem({
    item,
    fallbackName,
    count,
    tool,
}: {
    item: SellItem | null;
    fallbackName: string;
    count: number;
    tool?: boolean;
}) {
    const name = item?.name ?? fallbackName;
    // A tool is shown at ×1 whatever the document says, because you need one and hand it
    // back — "×3 silicone tube" would read as three tubes consumed.
    const quantity = tool ? 1 : count;

    return (
        <span className='flex w-14 shrink-0 flex-col items-center gap-1' title={tool ? `${name} (tool, handed back)` : name}>
            <span className='w-full truncate text-center text-[10px] text-bone-dim'>{name}</span>
            <span
                className={cx(
                    'flex size-11 items-center justify-center border bg-ground-2',
                    tool ? 'border-steel/50' : 'border-line',
                )}
            >
                {item ? <ItemIcon src={itemIconLink(item)} size={38} /> : null}
            </span>
            <span className={cx(FIGURE, 'text-[10px]', tool ? 'text-steel' : 'text-muted')}>
                {tool ? 'tool' : `×${quantity % 1 === 0 ? quantity : quantity.toFixed(2)}`}
            </span>
        </span>
    );
}

function Process({ row }: { row: CraftRow }) {
    return (
        <div className='flex items-center gap-2'>
            {row.lines.map((line, i) => (
                <ProcessItem
                    // Indexed: a craft can ask for the same item twice, once as a tool.
                    key={`${line.itemId}-${i}`}
                    item={line.item}
                    fallbackName={line.itemId}
                    count={line.count}
                    tool={line.tool}
                />
            ))}
            <span aria-hidden className='data shrink-0 px-1 text-[16px] text-line-bright'>
                ❯
            </span>
            <ProcessItem item={row.product} fallbackName={row.productName} count={row.productCount} />
        </div>
    );
}

/** What one line of the breakdown says: an item, a unit price, where from, a line cost. */
function BreakdownLine({ line }: { line: CraftLine }) {
    return (
        <li className='flex flex-wrap items-baseline gap-x-3 gap-y-1'>
            <span className='min-w-48 text-[12px] text-bone-dim'>{line.item?.name ?? line.itemId}</span>
            <span className={cx(FIGURE, 'text-[11px] text-muted')}>
                ×{line.count % 1 === 0 ? line.count : line.count.toFixed(2)}
            </span>
            {line.tool ? (
                <span className='data text-[10px] text-steel'>tool, handed back</span>
            ) : line.unit ? (
                <>
                    <span className={cx(FIGURE, 'text-[11px] text-bone')}>{roubles(line.unit.priceRUB)} each</span>
                    <span className='data text-[10px] text-muted'>
                        {line.unit.from === 'flea' ? 'flea' : (line.unit.offer?.traderName ?? 'trader')}
                        {line.unit.offer?.minTraderLevel ? ` ${line.unit.offer.minTraderLevel}` : ''}
                        {line.unit.offer?.taskUnlock ? ' · task' : ''}
                    </span>
                </>
            ) : (
                <span className='data text-[10px] text-rust'>no price</span>
            )}
            <span className={cx(FIGURE, 'ml-auto text-[12px]', line.cost === null ? 'text-rust' : 'text-bone')}>
                {line.cost === null ? '—' : roubles(line.cost)}
            </span>
        </li>
    );
}

/**
 * The product, laid out the way an ingredient is: what one sells for and where, then the lot.
 *
 * A craft that yields five reads very differently at 16,000 each than at 80,000 for the lot,
 * and the per-item figure is the one to check against the flea before trusting the row. The
 * fee is per item too, since that is how the flea charges it.
 */
function ProductLine({ row }: { row: CraftRow }) {
    const revenue = row.unitRevenue;

    return (
        <li className='flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-line/70 pt-2'>
            <span className='min-w-48 text-[12px] text-bone'>{row.productName}</span>
            <span className={cx(FIGURE, 'text-[11px] text-muted')}>×{row.productCount}</span>
            {revenue ? (
                <>
                    <span className={cx(FIGURE, 'text-[11px] text-bone')}>{roubles(revenue.priceRUB)} each</span>
                    <span className='data text-[10px] text-muted'>
                        {revenue.to === 'flea' ? 'flea' : (revenue.offer?.traderName ?? 'trader')}
                        {revenue.fee > 0 ? ` · fee ${roubles(revenue.fee)} each` : ''}
                    </span>
                </>
            ) : (
                <span className='data text-[10px] text-rust'>no price</span>
            )}
            <span className={cx(FIGURE, 'ml-auto text-[12px]', revenue === null ? 'text-rust' : 'text-bone')}>
                {revenue === null ? '—' : roubles(revenue.priceRUB * row.productCount)}
            </span>
        </li>
    );
}

/**
 * The working behind one row.
 *
 * Every figure the Profit column is made of, in the order they combine, so a number that
 * looks wrong can be traced to the ingredient or the fee that made it wrong rather than
 * merely disbelieved.
 */
function Breakdown({ row }: { row: CraftRow }) {
    const revenue = row.unitRevenue;

    return (
        <div className='space-y-3 border-l border-line-bright pl-4'>
            <ul className='space-y-1.5'>
                {row.lines.map((line, i) => (
                    <BreakdownLine key={`${line.itemId}-${i}`} line={line} />
                ))}
                {row.fuelCost > 0 ? (
                    <li className='flex flex-wrap items-baseline gap-x-3'>
                        <span className='min-w-48 text-[12px] text-bone-dim'>Generator fuel</span>
                        <span className='data text-[10px] text-muted'>over {duration(row.seconds)}</span>
                        <span className={cx(FIGURE, 'ml-auto text-[12px] text-bone')}>{roubles(row.fuelCost)}</span>
                    </li>
                ) : !row.usesPower ? (
                    // Said rather than left out, so a missing fuel line is not mistaken for
                    // the fuel charge having been switched off.
                    <li className='flex flex-wrap items-baseline gap-x-3'>
                        <span className='min-w-48 text-[12px] text-bone-dim'>No generator fuel</span>
                        <span className='data text-[10px] text-muted'>the {row.stationName} runs without power</span>
                    </li>
                ) : null}
                <ProductLine row={row} />
            </ul>

            {/* Read left to right, the four figures are the sum: what it sells for, less
                the fee on selling it, less everything above, leaves the profit. Which is
                why the asking price is shown gross here — a net figure beside a fee reads
                as though the fee were still to come off. */}
            <div className='flex flex-wrap items-end gap-x-8 gap-y-3 border-t border-line/70 pt-3'>
                <Figure label={`Sells ${revenue ? (revenue.to === 'flea' ? 'on the flea' : `to ${revenue.offer?.traderName ?? 'a trader'}`) : ''}`}>
                    <span className={cx(FIGURE, 'text-[13px]', revenue === null ? 'text-rust' : 'text-bone')}>
                        {revenue === null ? 'unsellable' : roubles(revenue.priceRUB * row.productCount)}
                    </span>
                </Figure>

                {revenue && revenue.fee > 0 ? (
                    <Figure label='Listing fee'>
                        <span className={cx(FIGURE, 'text-[13px] text-rust')}>
                            −{roubles(revenue.fee * row.productCount)}
                        </span>
                    </Figure>
                ) : null}

                <Figure label={row.fuelCost > 0 ? 'Inputs and fuel' : 'Inputs'}>
                    <span className={cx(FIGURE, 'text-[13px]', row.inputCost === null ? 'text-rust' : 'text-bone')}>
                        {row.inputCost === null ? 'unpriceable' : `−${roubles(row.inputCost + row.fuelCost)}`}
                    </span>
                </Figure>

                <Figure label='Profit'>
                    <Money value={row.profit} className='text-[13px]' />
                </Figure>

                {row.product ? (
                    <a
                        href={row.product.wikiLink ?? itemPageLink(row.product)}
                        target='_blank'
                        rel='noreferrer'
                        className='data ml-auto text-[10px] text-steel underline underline-offset-2 transition-colors hover:text-amber'
                    >
                        {row.product.wikiLink ? 'Wiki' : 'tarkov.dev'}
                    </a>
                ) : null}
            </div>
        </div>
    );
}

/** What the task badge says on hover: which task gates it, and what the logs know about it. */
function taskTitle(row: CraftRow, taskName: string | null): string {
    const name = taskName ?? 'a task';
    if (row.taskDone === true) return `Unlocked by ${name}, which your logs show you have`;
    if (row.taskDone === false) return `Unlocked by ${name}, which your logs do not show done yet`;
    return `Unlocked by ${name}. With your logs linked this can tell whether you have it.`;
}

function Row({
    row,
    taskName,
    open,
    onToggle,
}: {
    row: CraftRow;
    taskName: string | null;
    open: boolean;
    onToggle: () => void;
}) {
    // The document's own time, worth showing only when the skill has moved it.
    const reduced = Math.round(row.seconds) !== Math.round(row.baseSeconds);

    return (
        <tr
            onClick={onToggle}
            className={cx(
                'cursor-pointer border-b border-line/70 transition-colors hover:bg-panel-2/60',
                open && 'bg-panel-2/60',
                !row.runnable && 'opacity-55',
            )}
        >
            <td className='px-3 py-[10px]'>
                <div className={cx(CELL, 'gap-2')}>
                    {row.station?.imageLink ? <ItemIcon src={row.station.imageLink} size={28} /> : null}
                    <span className='min-w-0 flex-1'>
                        <span className='block truncate text-[12px] text-bone' title={row.stationName}>
                            {row.stationName}
                        </span>
                        <span className='data text-[10px] text-muted'>lvl {row.craft.level}</span>
                    </span>
                </div>
            </td>

            <td className='px-3 py-[10px]'>
                <div className={cx(CELL, 'gap-3')}>
                    <Process row={row} />
                    <span className='flex shrink-0 flex-col gap-1'>
                        {row.taskLocked ? (
                            <Pill tone={row.taskDone === false ? 'rust' : 'steel'}>
                                <span title={taskTitle(row, taskName)}>task</span>
                            </Pill>
                        ) : null}
                        {row.editionLocked ? (
                            <Pill tone='steel'>
                                <span title='Edge of Darkness only'>edition</span>
                            </Pill>
                        ) : null}
                        {row.recordedLevel !== null && row.recordedLevel < row.craft.level ? (
                            <Pill tone='rust'>
                                <span title={`Your ${row.stationName} is recorded at ${row.recordedLevel}`}>
                                    level {row.craft.level}
                                </span>
                            </Pill>
                        ) : null}
                    </span>
                </div>
            </td>

            <td className='px-3 py-[10px]'>
                <div className={cx(CELL, 'flex-col items-center justify-center text-center')}>
                    <span className={cx(FIGURE, 'text-[12px] text-bone')}>{duration(row.seconds)}</span>
                    {reduced ? (
                        <span className={cx(FIGURE, 'text-[10px] text-muted')} title='Before your Crafting skill'>
                            was {duration(row.baseSeconds)}
                        </span>
                    ) : null}
                </div>
            </td>

            <td className='px-3 py-[10px]'>
                <div className={cx(CELL, 'justify-center text-center')}>
                    <Money
                        value={row.profit}
                        title='One run: the product sold, less every ingredient, less the fuel burned'
                        className='text-[12px]'
                    />
                </div>
            </td>

            <td className='px-3 py-[10px]'>
                <div className={cx(CELL, 'justify-center text-center')}>
                    <Money
                        value={row.profitPerHour}
                        title='That profit over the hours the station is occupied'
                        className='text-[13px]'
                    />
                </div>
            </td>
        </tr>
    );
}

export function CraftsCalculator() {
    const rows = useCraftRows();
    const stations = useCraftStations();
    const tasks = useTasks();
    const taskNames = useMemo(() => new Map(tasks.map((task) => [task.id, task.name])), [tasks]);
    const index = useSellIndex();
    const economy = useEconomy();
    const view = useAppStore((s) => s.craftView);
    const setView = useAppStore((s) => s.setCraftView);
    const loading = useAppStore((s) => s.dataLoading);
    const downloading = useAppStore((s) => s.catalogueLoading);

    const [openId, setOpenId] = useState<string | null>(null);
    const [openHeight, setOpenHeight] = useState(OPEN_HEIGHT_GUESS);
    // How far the table's first row has scrolled above the top of the window, and how much
    // window there is to fill. Both read off the page rather than tracked, so the filter
    // chips wrapping onto another line does not throw them out.
    const [scrolled, setScrolled] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(800);
    const body = useRef<HTMLTableSectionElement | null>(null);

    const visible = useMemo(() => sortCraftRows(filterCraftRows(rows, view), view), [rows, view]);

    const openIndex = useMemo(
        () => (openId === null ? -1 : visible.findIndex((row) => row.craft.id === openId)),
        [visible, openId],
    );

    const slice = rowWindow({
        scrollTop: scrolled,
        viewportHeight,
        rowHeight: ROW_HEIGHT,
        count: visible.length,
        open: openIndex >= 0 ? { index: openIndex, height: openHeight } : null,
    });

    // The page's own scrollbar drives the table, the way the flea tab does it — a second
    // one inside a panel means two things to drag and a header that scrolls away from the
    // rows it labels.
    useEffect(() => {
        const read = () => {
            // Both come back in drawn pixels, and everything they are compared against is
            // in laid-out ones. `globals.css` zooms the root, so without the divide the
            // window is a quarter too tall and lands a quarter too far down the list.
            const scale = uiScale();
            const element = body.current;
            setScrolled(element ? -element.getBoundingClientRect().top / scale : 0);
            setViewportHeight(window.innerHeight / scale);
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
        (patch: Partial<CraftView>) => {
            setView(patch);
            window.scrollTo({ top: 0 });
        },
        [setView],
    );

    // Measured rather than guessed: the breakdown is one line per ingredient and some
    // crafts have six, so a fixed guess would leave every row below it out of place.
    const measureOpen = useCallback((element: HTMLTableRowElement | null) => {
        if (element) setOpenHeight(element.offsetHeight);
    }, []);

    const toggleStation = (id: string) =>
        apply({
            stations: view.stations.includes(id)
                ? view.stations.filter((each) => each !== id)
                : [...view.stations, id],
        });

    const toggleLevel = (level: number) =>
        apply({
            levels: view.levels.includes(level)
                ? view.levels.filter((each) => each !== level)
                : [...view.levels, level],
        });

    return (
        <div className='space-y-4'>
            <Panel className='rise'>
                <PanelHeader
                    title='Crafts'
                    action={
                        <>
                            {index ? <PriceStamp fetchedAt={index.fetchedAt} /> : null}
                            <CraftSettings />
                        </>
                    }
                />

                <div className='flex flex-wrap items-center gap-2 border-b border-line/70 px-4 py-3'>
                    <TextField
                        value={view.query}
                        onChange={(e) => apply({ query: e.target.value })}
                        placeholder='Search a product or an ingredient'
                        aria-label='Search a product or an ingredient'
                        className='w-64'
                    />
                    {stations.map((station) => (
                        <Chip
                            key={station.id}
                            active={view.stations.includes(station.id)}
                            onClick={() => toggleStation(station.id)}
                            title={`Only ${station.name} crafts`}
                        >
                            {station.name}
                        </Chip>
                    ))}
                </div>

                <div className='flex flex-wrap items-center gap-2 px-4 py-3'>
                    <Label>Station level</Label>
                    {CRAFT_LEVELS.map((level) => (
                        <Chip
                            key={level}
                            active={view.levels.includes(level)}
                            onClick={() => toggleLevel(level)}
                            title={`Crafts that need the station at level ${level}`}
                        >
                            {level}
                        </Chip>
                    ))}

                    <div className='ml-auto flex flex-wrap items-center gap-2'>
                        <Chip
                            active={view.runnableOnly}
                            onClick={() => apply({ runnableOnly: !view.runnableOnly })}
                            title='Hide crafts your recorded hideout is too low for, or whose unlocking task your logs do not show done. Anything unrecorded counts as able.'
                        >
                            Can run now
                        </Chip>
                        <Chip
                            active={view.hideTaskLocked}
                            onClick={() => apply({ hideTaskLocked: !view.hideTaskLocked })}
                            title='Hide crafts a task unlocks'
                        >
                            Hide task-locked
                        </Chip>
                    </div>
                </div>
            </Panel>


            <Panel className='rise' style={{ animationDelay: '120ms' }}>
                <PanelHeader
                    title='Craft list'
                    meta={`${visible.length.toLocaleString()} of ${rows.length.toLocaleString()} crafts`}
                />
                {!index || !economy ? (
                    <EmptyNote>
                        {loading
                            ? 'Loading game data.'
                            : downloading
                              ? 'Downloading prices and the hideout, barter and craft lists. It is a 16.7 MB fetch and happens once a day.'
                              : 'The catalogue did not load. Try refreshing from tarkov.dev in settings.'}
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
                                            onSort={() => apply(nextCraftSort(view, column.key))}
                                        />
                                    ))}
                                </tr>
                            </thead>
                            <tbody ref={body}>
                                {/* Spacers stand in for the rows either side of the window, so
                                    the scrollbar measures the whole list and not just what is
                                    drawn. */}
                                {slice.padTop > 0 ? (
                                    <tr aria-hidden style={{ height: slice.padTop }}>
                                        <td colSpan={COLUMNS.length} />
                                    </tr>
                                ) : null}

                                {visible.slice(slice.start, slice.end).map((row) => {
                                    const open = openId === row.craft.id;
                                    return (
                                        <Fragment key={row.craft.id}>
                                            <Row
                                                row={row}
                                                taskName={row.taskUnlock ? (taskNames.get(row.taskUnlock) ?? null) : null}
                                                open={open}
                                                onToggle={() => setOpenId(open ? null : row.craft.id)}
                                            />
                                            {open ? (
                                                <tr ref={measureOpen} className='bg-panel-2/60'>
                                                    <td colSpan={COLUMNS.length} className='px-4 pt-3 pb-3'>
                                                        <Breakdown row={row} />
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
