'use client';

import { Label, cx } from '@/components/ui';
import type { BarterRow } from '@/lib/barters/barter-row';

import { Batch, CostLine, OutputLine, PlanList, RowNoun, minus } from './breakdown';
import { FIGURE, Figure, Money, duration, roubles } from './craft-format';

/**
 * The breakdown under an open barters row.
 *
 * The plan and the working are the shared ones. The summary strip is this tab's own, because
 * a barter has two answers rather than one: what the trade saves you against buying the
 * thing, which is why anyone makes it, and what it fetches resold, which is usually a loss
 * and is here so that a reader who was about to flip it finds out before the stash does.
 */

/** Where the value the saving is measured against came from. */
function valueLabel(row: BarterRow): string {
    switch (row.valueFrom?.from) {
        case 'flea':
            return 'Costs on the flea';
        case 'trader':
            return `Costs at ${row.valueFrom.offer?.traderName ?? 'a trader'}`;
        default:
            return 'Costs to buy';
    }
}

/** Where the resale would go. Never the flea: a traded item is not found in raid. */
function resellLabel(row: BarterRow): string {
    switch (row.resale?.to) {
        case 'trader':
            return `Resell to ${row.resale.offer?.traderName ?? 'a trader'}`;
        case 'barter':
            return `Trade on at ${row.resale.step?.where ?? 'a trader'}`;
        case 'craft':
            return `Craft on at ${row.resale.step?.where ?? 'a station'}`;
        default:
            return 'Resell';
    }
}

export function BarterBreakdown({ row }: { row: BarterRow }) {
    const batch = row.plan.batch;
    const times = (value: number | null) => (value === null ? null : value * batch);

    return (
        <RowNoun.Provider value='trade'>
            <Batch.Provider value={batch}>
                <div className='space-y-4 border-l border-line-bright pl-4'>
                    <PlanList plan={row.plan} />

                    <section className='space-y-1.5'>
                        <div className='flex flex-wrap items-baseline gap-x-2'>
                            <Label>Working</Label>
                            {batch > 1 ? <span className='data text-[10px] text-muted'>for {batch} trades</span> : null}
                        </div>
                        <ul className='space-y-1.5'>
                            {row.lines.map((line, i) => (
                                <CostLine key={`${line.itemId}-${i}`} line={line} scale={batch} />
                            ))}
                            {/* `traded` is what puts the "not FIR" tag on the product, which is the
                                explanation a reader wants at the exact moment they notice the
                                resale figure is smaller than the flea price beside it. */}
                            <OutputLine
                                item={row.product}
                                fallbackName={row.productName}
                                count={row.productCount * batch}
                                sale={row.resale}
                                traded
                                className='border-t border-line/70 pt-2'
                            />
                        </ul>
                    </section>

                    {/* Read left to right: what the product would have cost, less what the trade
                        costs, leaves what it saves. The resale sits apart on the right, since it
                        is a different sum on the same two facts rather than part of this one. */}
                    <div className='flex flex-wrap items-end gap-x-8 gap-y-3 border-t border-line/70 pt-3'>
                        <Figure label={valueLabel(row)}>
                            <span className={cx(FIGURE, 'text-[13px]', row.value === null ? 'text-rust' : 'text-bone')}>
                                {row.value === null ? 'unpriced' : roubles(row.value * batch)}
                            </span>
                        </Figure>

                        <Figure label='What you hand over'>
                            <span className={cx(FIGURE, 'text-[13px]', row.cost === null ? 'text-rust' : 'text-bone')}>
                                {row.cost === null ? 'unpriceable' : minus(row.cost * batch)}
                            </span>
                        </Figure>

                        <Figure label={batch > 1 ? `Saves, ${batch} trades` : 'Saves'}>
                            <Money value={times(row.savings)} className='text-[13px]' />
                        </Figure>

                        {row.limit !== null ? (
                            <Figure label={`Over a restock, ${row.limit} trade${row.limit === 1 ? '' : 's'}`}>
                                <Money value={row.savingsPerRestock} className='text-[13px]' />
                            </Figure>
                        ) : null}

                        <Figure label={resellLabel(row)}>
                            <Money
                                value={times(row.resell)}
                                title='What the trade clears if you sell the product instead of keeping it. A traded item is not found in raid, so this is never a flea price.'
                                className='text-[13px]'
                            />
                        </Figure>

                        {/* Only when a route added one. A barter itself is instant. */}
                        {row.chainSeconds > 0 ? (
                            <Figure label='Waiting on crafts'>
                                <span className={cx(FIGURE, 'text-[13px] text-bone')}>{duration(row.chainSeconds * batch)}</span>
                            </Figure>
                        ) : null}
                    </div>
                </div>
            </Batch.Provider>
        </RowNoun.Provider>
    );
}
