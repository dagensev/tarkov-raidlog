'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { ItemIcon } from '@/components/item-icon';
import { Button, EmptyNote, Label, Lamp, Panel, PanelHeader, Pill, cx } from '@/components/ui';
import { recordedCount } from '@/lib/sell/hideout-levels';
import {
    SELL_FILTERS,
    SELL_SORTS,
    filterRows,
    sortRows,
    type SellFilter,
    type SellSort,
} from '@/lib/sell/filters';
import type { KeepReason } from '@/lib/sell/keep-list';
import type { SellRow, Verdict } from '@/lib/sell/verdict';
import { useAppStore } from '@/lib/store/app-store';
import { useEconomy, useSellIndex, useSellRows, useTarkovData } from '@/lib/store/hooks';
import { itemIconLink, itemPageLink } from '@/lib/tarkovdev/client';

/**
 * How many rows the browsing view draws before it stops.
 *
 * A thousand items is more than anyone reads. The filters and the search box are the way
 * through the rest, and saying so beats quietly rendering a list nobody scrolls.
 */
const BROWSE_LIMIT = 250;

/**
 * The three verdicts.
 *
 * "OK to sell" is a statement about the loaded data rather than a guarantee — the panel
 * below the table lists what this page cannot see — so its tooltip says what was actually
 * checked instead of repeating the label.
 */
const VERDICT: Record<Verdict, { label: string; tone: Parameters<typeof Pill>[0]['tone']; title: string }> = {
    keep: { label: 'Keep', tone: 'rust', title: 'A task or a hideout upgrade still wants it' },
    'think-twice': {
        label: 'Barter/craft',
        tone: 'amber',
        title: 'Only a barter or a craft wants it, and neither of those ever finishes',
    },
    'ok-to-sell': {
        label: 'OK to sell',
        tone: 'moss',
        title: 'No task, hideout upgrade, barter or craft in the loaded data wants it',
    },
};

const KIND_LABEL: Record<KeepReason['kind'], string> = {
    task: 'Task',
    hideout: 'Hideout',
    barter: 'Barter',
    craft: 'Craft',
};

const roubles = (value: number): string => `${value.toLocaleString()} ₽`;

function Price({ row }: { row: SellRow }) {
    if (row.item.noFlea) {
        return (
            <Pill tone='rust' className='shrink-0'>
                no flea
            </Pill>
        );
    }
    if (row.flea === null) return <span className='data text-[11px] text-muted'>no trades</span>;
    return <span className='data text-[12px] text-bone'>{roubles(row.flea)}</span>;
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
            {reason.foundInRaid ? (
                <Pill tone='steel' className='shrink-0'>
                    found in raid
                </Pill>
            ) : null}
            {reason.alternatives > 1 ? (
                <span className='data text-[10px] text-muted'>1 of {reason.alternatives} accepted</span>
            ) : null}
            {reason.optional ? <span className='data text-[10px] text-muted'>optional</span> : null}
            {reason.returned ? <span className='data text-[10px] text-muted'>tool, handed back</span> : null}
            {reason.locked ? <span className='data text-[10px] text-muted'>not reachable yet</span> : null}
            {reason.unverified ? <span className='data text-[10px] text-amber-dim'>assumed</span> : null}
        </li>
    );
}

/**
 * The one thing the reader has to supply by hand.
 *
 * Without it every station reads as unbuilt, which is the safe guess but also the noisy
 * one: upgrades finished months ago keep flagging their items, and all 213 crafts count
 * as ones you could run. Saying what it costs beats telling them to go and fill a form.
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
                    : `${total - recorded} of ${total} stations still unrecorded, so those are assumed unbuilt.`}{' '}
                Upgrades you have already finished keep flagging their items, and every craft
                counts as one you can run.
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

function Row({ row, open, onToggle }: { row: SellRow; open: boolean; onToggle: () => void }) {
    const verdict = VERDICT[row.verdict];
    const reasons = row.keep?.reasons ?? [];
    const keepCount = row.keep?.keepCount ?? 0;
    // Restricted items carry a level too, and it means nothing for them.
    const reqLevel = row.item.noFlea ? 0 : row.item.minLevelForFlea;
    // The one case where the flea is the wrong answer even though it is open to you.
    const traderWins = row.edge !== null && row.edge < 0;

    return (
        <li className='border-b border-line/70 transition-colors hover:bg-panel-2/60'>
            <div className='flex flex-wrap items-center gap-3 px-4 py-3'>
                {/* A stash-cell box, so icons of different footprints still line up and
                    the list scans down the left edge. */}
                <div className='flex size-16 shrink-0 items-center justify-center border border-line bg-ground-2'>
                    <ItemIcon src={itemIconLink(row.item)} size={56} />
                </div>

                <div className='min-w-0 flex-1'>
                    <div className='truncate text-[14px] text-bone' title={row.item.name}>
                        {row.item.name}
                    </div>
                    <div className='mt-1 flex flex-wrap items-center gap-2'>
                        {row.item.shortName ? (
                            <span className='data border border-line-bright px-1.5 py-[1px] text-[10px] text-muted'>
                                {row.item.shortName}
                            </span>
                        ) : null}
                        <span className='data text-[10px] text-muted'>
                            {row.item.width}×{row.item.height}
                        </span>
                        {reqLevel > 0 ? (
                            <span
                                className='data text-[10px] text-muted'
                                title={`The flea needs level ${reqLevel} to list this`}
                            >
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

                <Price row={row} />
                {row.trader ? (
                    <span
                        className={cx('data text-[11px]', traderWins ? 'text-moss' : 'text-muted')}
                        title={
                            traderWins
                                ? `${row.trader.traderName} pays more than the flea average here`
                                : `Best trader offer: ${row.trader.traderName}`
                        }
                    >
                        {row.trader.traderName} {roubles(row.trader.priceRUB)}
                    </span>
                ) : null}

                <Pill tone={verdict.tone} className='shrink-0'>
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

                {reasons.length > 0 ? (
                    <button
                        type='button'
                        onClick={onToggle}
                        aria-expanded={open}
                        className='stencil cursor-pointer border border-line-bright px-2 py-1 text-[9px] text-muted transition-colors hover:text-bone-dim'
                    >
                        {open ? 'Hide' : `${reasons.length} ${reasons.length === 1 ? 'use' : 'uses'}`}
                    </button>
                ) : null}
            </div>

            {open && reasons.length > 0 ? (
                <ul className='space-y-1 border-l border-line-bright px-4 py-2 pl-6'>
                    {reasons.map((reason, i) => (
                        // Indexed: one task can want an item for two objectives that
                        // differ in found-in-raid or in how many alternatives they take,
                        // so kind and source id alone are not unique.
                        <Reason key={`${reason.kind}-${reason.sourceId}-${i}`} reason={reason} />
                    ))}
                </ul>
            ) : null}
        </li>
    );
}

export default function SellPage() {
    const data = useTarkovData();
    const economy = useEconomy();
    const index = useSellIndex();
    const rows = useSellRows();
    const view = useAppStore((s) => s.sellView);
    const hideoutLevels = useAppStore((s) => s.settings.hideoutLevels);
    const playerLevel = useAppStore((s) => s.settings.playerLevel);
    const update = useAppStore((s) => s.updateSettings);
    const setView = useAppStore((s) => s.setSellView);
    const refresh = useAppStore((s) => s.refreshData);
    const loading = useAppStore((s) => s.dataLoading);
    const downloading = useAppStore((s) => s.catalogueLoading);
    const [openId, setOpenId] = useState<string | null>(null);

    const visible = useMemo(
        () => sortRows(filterRows(rows, view, playerLevel), view.sort),
        [rows, view, playerLevel],
    );
    const searching = view.query.trim().length > 0;
    const shown = searching ? visible : visible.slice(0, BROWSE_LIMIT);

    const coverage = economy
        ? `${data?.tasks.length ?? 0} tasks · ${economy.stations.length} stations · ${economy.barters.length} barters · ${economy.crafts.length} crafts`
        : 'loading';

    return (
        <div className='space-y-4'>
            <HideoutPrompt
                recorded={recordedCount(hideoutLevels)}
                total={economy?.stations.length ?? 0}
            />

            <Panel className='rise'>
                <PanelHeader
                    title='Sell check'
                    meta={coverage}
                    action={
                        index ? (
                            <span className='data text-[10px] text-muted'>
                                prices as of {new Date(index.fetchedAt).toLocaleTimeString()}
                            </span>
                        ) : null
                    }
                />
                <div className='flex flex-wrap items-center gap-2 px-4 py-3'>
                    <input
                        value={view.query}
                        onChange={(e) => setView({ query: e.target.value })}
                        placeholder='Search any item'
                        aria-label='Search any item'
                        className='data w-56 border border-line-bright bg-ground-2 px-2 py-1.5 text-[12px] text-bone placeholder:text-muted focus:border-amber-dim focus:outline-none'
                    />

                    {SELL_FILTERS.map((option) => (
                        <button
                            key={option.id}
                            type='button'
                            title={option.title}
                            onClick={() => setView({ filter: option.id as SellFilter })}
                            className={cx(
                                'stencil cursor-pointer border px-3 py-1.5 text-[10px] transition-colors',
                                view.filter === option.id
                                    ? 'border-amber bg-amber/15 text-amber'
                                    : 'border-line-bright text-muted hover:text-bone-dim',
                            )}
                        >
                            {option.label}
                        </button>
                    ))}

                    <div className='ml-auto flex flex-wrap items-center gap-2'>
                        <button
                            type='button'
                            onClick={() => setView({ hideNoFlea: !view.hideNoFlea })}
                            title='Hide items that cannot be listed on the flea at all'
                            className={cx(
                                'stencil cursor-pointer border px-3 py-1.5 text-[10px] transition-colors',
                                view.hideNoFlea
                                    ? 'border-amber bg-amber/15 text-amber'
                                    : 'border-line-bright text-muted hover:text-bone-dim',
                            )}
                        >
                            Flea only
                        </button>
                        <label
                            className='flex items-center gap-2'
                            title='Your character level. Items the flea will not list at that level are hidden; clear it to see them all.'
                        >
                            <span className='stencil text-[10px] text-muted'>Flea lvl</span>
                            <input
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
                                className='data w-16 border border-line-bright bg-ground-2 px-2 py-1.5 text-[12px] text-bone placeholder:text-muted focus:border-amber-dim focus:outline-none'
                            />
                        </label>
                        <select
                            value={view.sort}
                            onChange={(e) => setView({ sort: e.target.value as SellSort })}
                            aria-label='Sort order'
                            className='data border border-line-bright bg-ground-2 px-2 py-1.5 text-[12px] text-bone focus:border-amber-dim focus:outline-none'
                        >
                            {SELL_SORTS.map((mode) => (
                                <option key={mode.id} value={mode.id} title={mode.title}>
                                    {mode.label}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
            </Panel>

            <Panel className='rise' style={{ animationDelay: '60ms' }}>
                <PanelHeader
                    title={searching ? 'Matches' : 'Still wanted'}
                    meta={
                        shown.length === visible.length
                            ? `${visible.length} items`
                            : `${shown.length} of ${visible.length} items`
                    }
                />
                {!index || !economy ? (
                    <EmptyNote>
                        {loading
                            ? 'Loading game data.'
                            : downloading
                              ? 'Downloading prices and the hideout, barter and craft lists. It is a 16.7 MB fetch and happens once a day.'
                              : 'The catalogue did not load. Try the button below.'}
                    </EmptyNote>
                ) : visible.length === 0 ? (
                    <EmptyNote>
                        {searching
                            ? `Nothing in the catalogue matches “${view.query}”.`
                            : 'Nothing matches these filters.'}
                    </EmptyNote>
                ) : (
                    <ul>
                        {shown.map((row) => (
                            <Row
                                key={row.item.id}
                                row={row}
                                open={openId === row.item.id}
                                onToggle={() => setOpenId(openId === row.item.id ? null : row.item.id)}
                            />
                        ))}
                    </ul>
                )}
                {!searching && shown.length < visible.length ? (
                    <p className='data border-t border-line px-4 py-2 text-[11px] text-muted'>
                        Search or filter to see the rest.
                    </p>
                ) : null}
            </Panel>

            <Panel className='rise' style={{ animationDelay: '90ms' }}>
                <PanelHeader title='What this does not check' />
                <div className='space-y-2 px-4 py-4 text-[12px] leading-relaxed text-muted'>
                    <p>
                        <Label>What you already own.</Label> Counts are what a source wants in
                        total, not what is left to find, and one item can satisfy several
                        alternatives at once.
                    </p>
                    <p>
                        <Label>Your kit.</Label> Guns, armour, ammo and meds you actually run are
                        nobody&rsquo;s requirement, so they read as wanted by nothing.
                    </p>
                    <p>
                        <Label>Weapon builds by category.</Label> Objectives that ask for any
                        suppressor rather than a named one are not read.
                    </p>
                    <p>
                        <Label>Event and seasonal tasks</Label>, and anything tarkov.dev has not
                        published yet.
                    </p>
                    <Button onClick={() => void refresh(true)} disabled={loading || downloading}>
                        {downloading ? 'Downloading…' : loading ? 'Loading…' : 'Re-download catalogue'}
                    </Button>
                    <p>
                        There is no prices-only endpoint, so refreshing prices means fetching the
                        whole 16.7 MB catalogue again.
                    </p>
                </div>
            </Panel>
        </div>
    );
}
