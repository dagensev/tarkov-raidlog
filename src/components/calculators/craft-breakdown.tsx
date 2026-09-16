'use client';

import { Label, cx } from '@/components/ui';
import type { CraftRow } from '@/lib/crafts/craft-row';

import {
    Batch,
    CostLine,
    FuelLine,
    GUTTER,
    OutputLine,
    PlanList,
    minus,
    sellsLabel,
} from './breakdown';
import { FIGURE, Figure, Money, duration, roubles } from './craft-format';

/**
 * The breakdown under an open crafts row.
 *
 * The plan, the working and everything they are made of live in ./breakdown.tsx, shared with
 * the barters tab. What stays here is the summary strip, which is the one part that is about
 * crafting: the fuel a station burns, and the hours the profit is divided by.
 */

export { TaskNames, countText } from './breakdown';

/**
 * The plan and the working behind one row.
 *
 * Every figure the Profit column is made of, in the order they combine, so a number that
 * looks wrong can be traced to the ingredient or the fee that made it wrong rather than
 * merely disbelieved. The working covers the plan's batch, so where the plan comes out even
 * its counts are whole too; the Profit column stays per run, and the summary says both.
 */
export function Breakdown({ row }: { row: CraftRow }) {
    const revenue = row.unitRevenue;
    const batch = row.plan.batch;
    const times = (value: number | null) => (value === null ? null : value * batch);

    return (
        <Batch.Provider value={batch}>
            <div className='space-y-4 border-l border-line-bright pl-4'>
                <PlanList plan={row.plan} />

                <section className='space-y-1.5'>
                    <div className='flex flex-wrap items-baseline gap-x-2'>
                        <Label>Working</Label>
                        {batch > 1 ? <span className='data text-[10px] text-muted'>for {batch} runs</span> : null}
                    </div>
                    <ul className='space-y-1.5'>
                        {row.lines.map((line, i) => (
                            <CostLine key={`${line.itemId}-${i}`} line={line} scale={batch} />
                        ))}
                        {row.fuelCost > 0 ? (
                            <FuelLine cost={row.fuelCost * batch} seconds={row.seconds * batch} />
                        ) : !row.usesPower ? (
                            // Said rather than left out, so a missing fuel line is not mistaken for
                            // the fuel charge having been switched off.
                            <li className='flex flex-wrap items-baseline gap-x-3'>
                                <span aria-hidden className={GUTTER} />
                                <span className='min-w-48 text-[12px] text-bone-dim'>No generator fuel</span>
                                <span className='data text-[10px] text-muted'>the {row.stationName} runs without power</span>
                            </li>
                        ) : null}
                        <OutputLine
                            item={row.product}
                            fallbackName={row.productName}
                            count={row.productCount * batch}
                            sale={revenue}
                            className='border-t border-line/70 pt-2'
                        />
                    </ul>
                </section>

                {/* Read left to right, the figures are the sum: what the product comes to, less
                    everything it took, leaves the profit. All for the batch, with the per-run
                    profit beside it so it can be matched to the row. */}
                <div className='flex flex-wrap items-end gap-x-8 gap-y-3 border-t border-line/70 pt-3'>
                    <Figure label={sellsLabel(revenue)}>
                        <span className={cx(FIGURE, 'text-[13px]', revenue === null ? 'text-rust' : 'text-bone')}>
                            {revenue === null ? 'unsellable' : roubles(revenue.net * row.productCount * batch)}
                        </span>
                    </Figure>

                    <Figure label={row.fuelCost > 0 ? 'Inputs and fuel' : 'Inputs'}>
                        <span className={cx(FIGURE, 'text-[13px]', row.inputCost === null ? 'text-rust' : 'text-bone')}>
                            {row.inputCost === null ? 'unpriceable' : minus((row.inputCost + row.fuelCost) * batch)}
                        </span>
                    </Figure>

                    <Figure label={batch > 1 ? `Profit, ${batch} runs` : 'Profit'}>
                        <Money value={times(row.profit)} className='text-[13px]' />
                    </Figure>

                    {batch > 1 ? (
                        <Figure label='Per run'>
                            <Money value={row.profit} className='text-[13px]' />
                        </Figure>
                    ) : null}

                    {/* When the plan runs other crafts or more than one of this one, since that
                        is when the hours stop being the craft time the station shows. */}
                    {row.chainSeconds > 0 || batch > 1 ? (
                        <Figure label='Over'>
                            <span
                                className={cx(FIGURE, 'text-[13px] text-bone')}
                                title={`${duration(row.seconds * batch)} for this craft, ${duration(row.chainSeconds * batch)} for the others`}
                            >
                                {duration(row.totalSeconds * batch)}
                            </span>
                        </Figure>
                    ) : null}
                </div>
            </div>
        </Batch.Provider>
    );
}
