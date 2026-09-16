'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { PriceStamp } from '@/components/price-stamp';
import { Chip, EmptyNote, Label, Panel, PanelHeader, Pill, TextField, cx } from '@/components/ui';
import type { BarterRow } from '@/lib/barters/barter-row';
import {
    BARTER_LEVELS,
    filterBarterRows,
    nextBarterSort,
    sortBarterRows,
    type BarterSortKey,
    type BarterView,
} from '@/lib/barters/filters';
import { useAppStore } from '@/lib/store/app-store';
import { useBarterRows, useBarterTraders, useEconomy, useSellIndex, useTasks } from '@/lib/store/hooks';
import { rowWindow } from '@/lib/table/window';
import { uiScale } from '@/lib/ui-scale';

import { BarterBreakdown } from './barter-breakdown';
import { TaskNames } from './breakdown';
import { FIGURE, Money, duration, roubles } from './craft-format';
import { CraftSettings } from './craft-settings';
import { HeaderCell, type Column } from './header-cell';
import { PROCESS_HEIGHT, Process, tradeOut } from './process';

/**
 * The barters table.
 *
 * The same shape as the crafts table, and for the same reasons — a windowed fixed-height
 * table under the page's own scrollbar, filters that only ever narrow, and a row that opens
 * into its own working. What differs is the question it answers. See `@/lib/barters/barter-row`
 * for why a barter needs both a Saves column and a Resell one.
 */

/** Same as the crafts table's: `CELL` at `PROCESS_HEIGHT`, 10px of padding each side, the 1px rule. */
const ROW_HEIGHT = PROCESS_HEIGHT + 21;

/**
 * The cell's own content box.
 *
 * Fixed and clipped rather than left to the content: the windowing assumes every collapsed
 * row is exactly `ROW_HEIGHT`, and the one barter in the data that asks for five items would
 * put every row below it out of place if it grew to fit.
 */
const CELL = 'flex items-center overflow-hidden';

/** Paired with `CELL`: the height lives here because Tailwind cannot read a constant. */
const CELL_HEIGHT = { height: PROCESS_HEIGHT };

/** Roughly what the breakdown adds. Only ever an estimate; the real one is measured. */
const OPEN_HEIGHT_GUESS = 200;

const COLUMNS: ReadonlyArray<Column<BarterSortKey>> = [
    { key: 'trader', label: 'Trader', title: 'By trader, then by the loyalty the offer needs', width: '11%' },
    {
        key: 'barter',
        // The widest the table can spare, for the same reason the crafts tab gives its own
        // process column: only 10 of the 806 barters have more boxes and labels than fit.
        label: 'Barter',
        title: 'What you hand over and what you get. Alphabetical by what you get.',
        width: '52%',
    },
    {
        key: 'cost',
        label: 'Cost',
        title: 'What the items you hand over cost you, however your settings say to get them. Cheapest first.',
        width: '10%',
        centred: true,
    },
    {
        key: 'savings',
        label: 'Savings',
        title: 'What buying the item outright would have cost, less what the trade costs you. This is what a barter is for.',
        width: '11%',
        centred: true,
    },
    {
        key: 'resell',
        label: 'Resell',
        title: 'What the trade clears if you sell what you get rather than keep it. A traded item is not found in raid, so this is never a flea price — which is why it is usually a loss.',
        width: '10%',
        centred: true,
    },
    {
        key: 'limit',
        label: 'Limit',
        title: 'How many times one restock lets you make the trade',
        width: '6%',
        centred: true,
    },
];

/** What the task badge says on hover: which task gates it, and what the logs know about it. */
function taskTitle(row: BarterRow, taskName: string | null): string {
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
    row: BarterRow;
    taskName: string | null;
    open: boolean;
    onToggle: () => void;
}) {
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
                <div className={cx(CELL, 'gap-2')} style={CELL_HEIGHT}>
                    <span className='min-w-0 flex-1'>
                        <span className='block truncate text-[12px] text-bone' title={row.traderName}>
                            {row.traderName}
                        </span>
                        <span className='data text-[10px] text-muted'>LL{row.minLevel}</span>
                    </span>
                </div>
            </td>

            <td className='px-3 py-[10px]'>
                <div className={cx(CELL, 'gap-3')} style={CELL_HEIGHT}>
                    <Process
                        lines={row.lines}
                        product={row.product}
                        productName={row.productName}
                        productCount={row.productCount}
                        productTrade={tradeOut(row.resale)}
                    />
                    <span className='flex shrink-0 flex-col gap-1'>
                        {row.taskLocked ? (
                            <Pill tone={row.taskDone === false ? 'rust' : 'steel'}>
                                <span title={taskTitle(row, taskName)}>task</span>
                            </Pill>
                        ) : null}
                        {row.recordedLevel !== null && row.recordedLevel < row.minLevel ? (
                            <Pill tone='rust'>
                                <span title={`Your ${row.traderName} is recorded at ${row.recordedLevel}`}>
                                    LL{row.minLevel}
                                </span>
                            </Pill>
                        ) : null}
                        {row.routeLocked ? (
                            <Pill tone='rust'>
                                <span title='The plan behind these figures goes through a barter or craft you cannot do yet. Open the row to see which.'>
                                    route
                                </span>
                            </Pill>
                        ) : null}
                        {/* A barter is instant, so any wait at all came from a craft the plan
                            runs to make one of the items you hand over. */}
                        {row.chainSeconds > 0 ? (
                            <Pill tone='amber'>
                                <span title={`The plan waits ${duration(row.chainSeconds)} on crafts to make what this trade takes`}>
                                    {duration(row.chainSeconds)}
                                </span>
                            </Pill>
                        ) : null}
                    </span>
                </div>
            </td>

            <td className='px-3 py-[10px]'>
                <div className={cx(CELL, 'justify-center text-center')} style={CELL_HEIGHT}>
                    <span className={cx(FIGURE, 'text-[12px]', row.cost === null ? 'text-rust' : 'text-bone')}>
                        {row.cost === null ? '—' : roubles(row.cost)}
                    </span>
                </div>
            </td>

            <td className='px-3 py-[10px]'>
                <div className={cx(CELL, 'justify-center text-center')} style={CELL_HEIGHT}>
                    <Money
                        value={row.savings}
                        title='What the item would have cost you to buy, less what this trade costs'
                        className='text-[13px]'
                    />
                </div>
            </td>

            <td className='px-3 py-[10px]'>
                <div className={cx(CELL, 'justify-center text-center')} style={CELL_HEIGHT}>
                    <Money
                        value={row.resell}
                        title='What it clears sold on rather than kept. Never a flea price: a traded item is not found in raid.'
                        className='text-[12px]'
                    />
                </div>
            </td>

            <td className='px-3 py-[10px]'>
                <div className={cx(CELL, 'justify-center text-center')} style={CELL_HEIGHT}>
                    <span className={cx(FIGURE, 'text-[12px]', row.limit === null ? 'text-muted' : 'text-bone')}>
                        {row.limit === null ? '∞' : `×${row.limit}`}
                    </span>
                </div>
            </td>
        </tr>
    );
}

export function BartersCalculator() {
    const rows = useBarterRows();
    const traders = useBarterTraders();
    const tasks = useTasks();
    const taskNames = useMemo(() => new Map(tasks.map((task) => [task.id, task.name])), [tasks]);
    const index = useSellIndex();
    const economy = useEconomy();
    const view = useAppStore((s) => s.barterView);
    const setView = useAppStore((s) => s.setBarterView);
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

    const visible = useMemo(() => sortBarterRows(filterBarterRows(rows, view), view), [rows, view]);

    const openIndex = useMemo(
        () => (openId === null ? -1 : visible.findIndex((row) => row.barter.id === openId)),
        [visible, openId],
    );

    const slice = rowWindow({
        scrollTop: scrolled,
        viewportHeight,
        rowHeight: ROW_HEIGHT,
        count: visible.length,
        open: openIndex >= 0 ? { index: openIndex, height: openHeight } : null,
    });

    // The page's own scrollbar drives the table, the way the crafts and flea tabs do it — a
    // second one inside a panel means two things to drag and a header that scrolls away from
    // the rows it labels.
    useEffect(() => {
        const read = () => {
            // Both come back in drawn pixels, and everything they are compared against is in
            // laid-out ones. `globals.css` zooms the root, so without the divide the window
            // is a quarter too tall and lands a quarter too far down the list.
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
        (patch: Partial<BarterView>) => {
            setView(patch);
            window.scrollTo({ top: 0 });
        },
        [setView],
    );

    // Measured rather than guessed: the breakdown is one line per item handed over, and a
    // route under one of them adds a whole indented block.
    const measureOpen = useCallback((element: HTMLTableRowElement | null) => {
        if (element) setOpenHeight(element.offsetHeight);
    }, []);

    const toggleTrader = (id: string) =>
        apply({
            traders: view.traders.includes(id)
                ? view.traders.filter((each) => each !== id)
                : [...view.traders, id],
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
                    title='Barters'
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
                        placeholder='Search what you get or what it takes'
                        aria-label='Search what you get or what it takes'
                        className='w-64'
                    />
                    {traders.map((trader) => (
                        <Chip
                            key={trader.id}
                            active={view.traders.includes(trader.id)}
                            onClick={() => toggleTrader(trader.id)}
                            title={`Only ${trader.name} barters`}
                        >
                            {trader.name}
                        </Chip>
                    ))}
                </div>

                <div className='flex flex-wrap items-center gap-2 px-4 py-3'>
                    <Label>Loyalty</Label>
                    {BARTER_LEVELS.map((level) => (
                        <Chip
                            key={level}
                            active={view.levels.includes(level)}
                            onClick={() => toggleLevel(level)}
                            title={`Barters that need the trader at loyalty ${level}`}
                        >
                            {level}
                        </Chip>
                    ))}

                    <div className='ml-auto flex flex-wrap items-center gap-2'>
                        <Chip
                            active={view.runnableOnly}
                            onClick={() => apply({ runnableOnly: !view.runnableOnly })}
                            title='Hide barters your recorded loyalty is too low for, or whose unlocking task your logs do not show done. Anything unrecorded counts as able.'
                        >
                            Can trade now
                        </Chip>
                        <Chip
                            active={view.hideTaskLocked}
                            onClick={() => apply({ hideTaskLocked: !view.hideTaskLocked })}
                            title='Hide barters a task unlocks'
                        >
                            Hide task-locked
                        </Chip>
                    </div>
                </div>
            </Panel>

            <Panel className='rise' style={{ animationDelay: '120ms' }}>
                <PanelHeader
                    title='Barter list'
                    meta={`${visible.length.toLocaleString()} of ${rows.length.toLocaleString()} barters`}
                />
                {!index || !economy ? (
                    <EmptyNote>
                        {loading
                            ? 'Loading game data.'
                            : downloading
                              ? 'Downloading prices and the hideout, barter and craft lists. It is a 16.7 MB fetch and happens once an hour.'
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
                                            onSort={() => apply(nextBarterSort(view, column.key))}
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
                                    const open = openId === row.barter.id;
                                    return (
                                        <Fragment key={row.barter.id}>
                                            <Row
                                                row={row}
                                                taskName={row.taskUnlock ? (taskNames.get(row.taskUnlock) ?? null) : null}
                                                open={open}
                                                onToggle={() => setOpenId(open ? null : row.barter.id)}
                                            />
                                            {open ? (
                                                <tr ref={measureOpen} className='bg-panel-2/60'>
                                                    <td colSpan={COLUMNS.length} className='px-4 pt-3 pb-3'>
                                                        <TaskNames.Provider value={taskNames}>
                                                            <BarterBreakdown row={row} />
                                                        </TaskNames.Provider>
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
