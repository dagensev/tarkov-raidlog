'use client';

import { createContext, useContext, type ReactNode } from 'react';

import { Label, Pill, cx } from '@/components/ui';
import {
    exceedsRestock,
    type CraftPlan,
    type GivenItem,
    type MarketItem,
    type PlanItem,
    type PlanStep,
    type RunStep,
} from '@/lib/crafts/plan';
import type { Acquisition, Disposal, Gate, MakeStep, RouteLine, TradeStep } from '@/lib/crafts/routes';
import { itemPageLink, type SellItem } from '@/lib/tarkovdev/client';

import { FIGURE, duration, roubles, signed } from './craft-format';

/**
 * The pieces every breakdown is made of: a plan to follow, then the working behind it.
 *
 * Two views of one route tree, because they answer different questions. The plan says what
 * to do, in order, in whole runs and whole items. The working says why each figure is what
 * it is, one indented block per barter or craft. Both cover the same batch of the row's own
 * craft or trade — the fewest runs that come out even, see `craftPlan` — so their counts
 * match, and a block's lines add up to the line it sits under: what it costs carries a
 * minus, what it gives back carries a plus and an arrow.
 *
 * Written after a reader could not follow the first version, which counted each block per
 * single run of that block, listed a step's output as though it were another cost, showed
 * flea sales before the fee while doing the sums after it, and told them to buy a third of
 * a box of matches.
 *
 * Everything here is shared by the crafts and barters tabs. What each tab keeps to itself is
 * only its summary row — the figures that particular table is sorted on.
 */

/** Task names for the gates a route shows, handed down rather than threaded through every level. */
export const TaskNames = createContext<ReadonlyMap<string, string>>(new Map());

/** The batch the breakdown covers, for the restock check, which is about one run of the row. */
export const Batch = createContext(1);

/**
 * What one run of the row is called, so a barter's working does not talk about crafting.
 * "run" for a craft, "trade" for a barter.
 */
export const RowNoun = createContext<'run' | 'trade'>('run');

/** Below this a count is float noise, the same tolerance the plan rounds with. */
const EPSILON = 1e-6;

/** A count, with a fraction kept to two places: a fifth is 0.2, not 0.20000001. */
export const countText = (count: number) => count.toLocaleString(undefined, { maximumFractionDigits: 2 });

const nameOf = (entry: { item: SellItem | null; itemId: string }) => entry.item?.name ?? entry.itemId;

/**
 * An item's name, linked to its wiki page, or to tarkov.dev for an item the wiki has no page
 * for. Every name in the breakdown goes through here, plan and working alike, because the
 * item a reader wants to check is as often an ingredient three steps down as the product.
 */
export function WikiLink({ item, fallbackName }: { item: SellItem | null; fallbackName: string }) {
    if (!item) return <>{fallbackName}</>;
    return (
        <a
            href={item.wikiLink ?? itemPageLink(item)}
            target='_blank'
            rel='noreferrer'
            title={item.wikiLink ? `${item.name} on the wiki` : `${item.name} on tarkov.dev`}
            className='underline decoration-line-bright underline-offset-2 transition-colors hover:text-amber hover:decoration-amber'
        >
            {item.name}
        </a>
    );
}

/** "3 Bolts", or "0.66 of a Water filter" for the part of one a craft uses up. */
function Amount({ entry }: { entry: PlanItem }) {
    return (
        <>
            {entry.count < 1 ? `${countText(entry.count)} of a ` : `${countText(entry.count)} `}
            <WikiLink item={entry.item} fallbackName={entry.itemId} />
        </>
    );
}

function runsText(kind: 'craft' | 'barter', runs: number): string {
    const noun = kind === 'craft' ? 'run' : 'trade';
    if (Math.abs(runs - 1) < EPSILON) return `1 ${noun}`;
    return runs < 1 ? `${countText(runs)} of a ${noun}` : `${countText(runs)} ${noun}s`;
}

/** A cost, which only ever comes off. */
export const minus = (value: number) => (value === 0 ? roubles(0) : `−${roubles(value)}`);

/**
 * The gates worth a badge on a step.
 *
 * A loyalty or station level only when it is short of what you recorded — the step already
 * names the level it needs, so a met one would say it twice. A task and an edition always,
 * since whether you have those is the one thing the step cannot say.
 */
export function GatePills({ gates }: { gates: readonly Gate[] }) {
    const taskNames = useContext(TaskNames);

    return gates.map((gate, i) => {
        switch (gate.kind) {
            case 'loyalty':
                return gate.met ? null : (
                    <Pill key={i} tone='rust'>
                        <span title={`Needs loyalty ${gate.level}, and you recorded ${gate.recorded}`}>LL{gate.level}</span>
                    </Pill>
                );
            case 'station':
                return gate.met ? null : (
                    <Pill key={i} tone='rust'>
                        <span title={`Needs the station at ${gate.level}, and you recorded ${gate.recorded}`}>level {gate.level}</span>
                    </Pill>
                );
            case 'task': {
                const name = taskNames.get(gate.taskId) ?? 'a task';
                const title =
                    gate.met === true
                        ? `Unlocked by ${name}, which your logs show you have`
                        : gate.met === false
                          ? `Unlocked by ${name}, which your logs do not show done yet`
                          : `Unlocked by ${name}. With your logs linked this can tell whether you have it.`;
                return (
                    <Pill key={i} tone={gate.met === false ? 'rust' : 'steel'}>
                        <span title={title}>task</span>
                    </Pill>
                );
            }
            case 'edition':
                return (
                    <Pill key={i} tone='steel'>
                        <span title='Edge of Darkness only'>edition</span>
                    </Pill>
                );
        }
    });
}

/** Said only when one run of the row needs more trades than a restock allows. */
export function RestockPill({ where, perRun, limit }: { where: string; perRun: number; limit: number }) {
    const noun = useContext(RowNoun);
    return (
        <Pill tone='rust'>
            <span
                title={`Each ${noun} of this row needs ${countText(perRun)} trades, and ${where} allows ${limit} a restock. The figures assume you can make them all.`}
            >
                only {limit} a restock
            </span>
        </Pill>
    );
}

// --- the plan ---------------------------------------------------------------------------

function marketText(entry: MarketItem): string {
    if (entry.market === 'flea') return 'flea';
    return `${entry.trader ?? 'trader'}${entry.level ? ` LL${entry.level}` : ''}`;
}

function Items({ items }: { items: readonly (PlanItem | GivenItem)[] }) {
    return items.map((entry, i) => (
        <span key={`${entry.itemId}-${i}`}>
            {i > 0 ? ', ' : ''}
            <Amount entry={entry} />
            {'spare' in entry && entry.spare > EPSILON ? (
                <span className='data text-[10px] text-muted'> ({countText(entry.spare)} spare)</span>
            ) : null}
        </span>
    ));
}

function MarketEntry({ entry }: { entry: MarketItem }) {
    return (
        <>
            <Amount entry={entry} />{' '}
            <span className='data text-[10px] text-muted'>
                ({marketText(entry)}
                {entry.uses !== null && entry.count - entry.uses > EPSILON ? `, uses ${countText(entry.uses)}` : ''})
            </span>
        </>
    );
}

function MarketItems({ items }: { items: readonly MarketItem[] }) {
    return items.map((entry, i) => (
        <span key={`${entry.itemId}-${i}`}>
            {i > 0 ? ', ' : ''}
            <MarketEntry entry={entry} />
        </span>
    ));
}

/**
 * A step's items one to a line. The buy step is a shopping list, and a chain can put eight
 * things on it — run together on one line they wrapped into a paragraph nobody could tick off.
 */
const SUB_LIST = 'mt-0.5 list-disc space-y-0.5 pl-5 marker:text-line-bright';

function RunLine({ step, batch }: { step: RunStep; batch: number }) {
    const heading =
        step.kind === 'craft' ? `Craft at ${step.where} ${step.level}` : `Trade with ${step.where}${step.level > 1 ? ` LL${step.level}` : ''}`;

    return (
        <>
            <span className='text-bone'>{heading}</span>{' '}
            <span className='data text-[10px] text-muted'>
                {runsText(step.kind, step.runs)}
                {step.kind === 'craft' ? `, ${duration(step.seconds)} each` : ''}
            </span>
            {': '}
            <Items items={step.takes} /> <span className='text-moss'>→</span> <Items items={step.gives} />
            <span className='ml-2 inline-flex flex-wrap gap-1 align-middle'>
                <GatePills gates={step.gates} />
                {exceedsRestock(step, batch) ? <RestockPill where={step.where} perRun={step.runs / batch} limit={step.limit} /> : null}
            </span>
        </>
    );
}

function PlanLine({ step, batch }: { step: PlanStep; batch: number }) {
    switch (step.kind) {
        case 'buy':
            return (
                <>
                    {step.items.length > 0 ? (
                        <>
                            <span className='text-bone'>Buy</span>
                            <ul className={SUB_LIST}>
                                {step.items.map((entry, i) => (
                                    <li key={`${entry.itemId}-${i}`}>
                                        <MarketEntry entry={entry} />
                                    </li>
                                ))}
                            </ul>
                        </>
                    ) : null}
                    {step.tools.length > 0 ? (
                        <div className={step.items.length > 0 ? 'mt-1' : undefined}>
                            <span className='text-bone'>Have on hand</span>{' '}
                            <span className='data text-[10px] text-muted'>(tools, handed back)</span>
                            <ul className={SUB_LIST}>
                                {step.tools.map((entry, i) => (
                                    <li key={`${entry.itemId}-${i}`}>
                                        <Amount entry={entry} />
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : null}
                </>
            );
        case 'sell':
            return (
                <>
                    <span className='text-bone'>Sell</span> <MarketItems items={step.items} />
                </>
            );
        default:
            return <RunLine step={step} batch={batch} />;
    }
}

/** What the plan's heading says about the batch, when there is anything to say. */
function batchNote(plan: CraftPlan, noun: 'run' | 'trade'): string | null {
    const runs = `${plan.batch} ${noun}${plan.batch === 1 ? '' : 's'} of this row`;
    if (plan.exact) return plan.batch === 1 ? null : `for ${runs}, the fewest that come out even`;
    return `for ${runs}, rounded up to whole ${noun}s and items`;
}

export function PlanList({ plan }: { plan: CraftPlan }) {
    const note = batchNote(plan, useContext(RowNoun));

    return (
        <section className='space-y-1.5'>
            <div className='flex flex-wrap items-baseline gap-x-2'>
                <Label>Plan</Label>
                {note ? <span className='data text-[10px] text-muted'>{note}</span> : null}
            </div>
            <ol className='list-decimal space-y-1 pl-5 text-[12px] leading-relaxed text-bone-dim marker:text-muted'>
                {plan.steps.map((step, i) => (
                    <li key={i}>
                        <PlanLine step={step} batch={plan.batch} />
                    </li>
                ))}
            </ol>
            {plan.leftovers.length > 0 ? (
                <p className='pl-5 text-[12px] leading-relaxed text-bone-dim'>
                    <span className='text-bone'>Left over</span> <Items items={plan.leftovers} />{' '}
                    <span className='data text-[10px] text-muted'>(keep for next time)</span>
                </p>
            ) : null}
        </section>
    );
}

// --- the working ------------------------------------------------------------------------

/**
 * Every working line starts with this, empty on a cost and "→ gives" on what a step hands
 * back, so the two can be told apart down the left edge without reading a word of either.
 */
export const GUTTER = 'data w-12 shrink-0 text-[10px]';

/** A block under a line: the barter or craft that line's figure came from. */
const BLOCK = 'ml-6 space-y-1.5 border-l border-line pl-3';

function boughtFrom(unit: Acquisition): string {
    switch (unit.from) {
        case 'flea':
            return 'flea';
        case 'trader':
            return `${unit.offer?.traderName ?? 'trader'}${unit.offer?.minTraderLevel ? ` LL${unit.offer.minTraderLevel}` : ''}${unit.offer?.taskUnlock ? ' · task' : ''}`;
        case 'barter':
            return `bartered with ${unit.step?.where ?? 'a trader'}`;
        case 'craft':
            return `crafted at ${unit.step?.where ?? 'a station'}`;
    }
}

/** Where it went. A flea sale names its asking price and fee, since "each" is after both. */
function soldTo(sale: Disposal): string {
    switch (sale.to) {
        case 'flea':
            return sale.fee > 0 ? `flea: ${roubles(sale.priceRUB)} less ${roubles(sale.fee)} fee` : 'flea';
        case 'trader':
            return sale.offer?.traderName ?? 'trader';
        case 'barter':
            return `traded with ${sale.step?.where ?? 'a trader'}`;
        case 'craft':
            return `crafted on at ${sale.step?.where ?? 'a station'}`;
    }
}

/** The figure a summary puts the product's value under. */
export function sellsLabel(sale: Disposal | null): string {
    switch (sale?.to) {
        case 'flea':
            return 'Sells on the flea, after fee';
        case 'trader':
            return `Sells to ${sale.offer?.traderName ?? 'a trader'}`;
        case 'barter':
            return `Traded with ${sale.step?.where ?? 'a trader'}`;
        case 'craft':
            return `Crafted on at ${sale.step?.where ?? 'a station'}`;
        default:
            return 'Sells';
    }
}

/**
 * A working line's item name. The width sits on a wrapper so the link's underline runs under
 * the name and not the padding that lines the columns up.
 */
function ItemName({ item, fallbackName, className }: { item: SellItem | null; fallbackName: string; className: string }) {
    return (
        <span className={cx('min-w-48 text-[12px]', className)}>
            <WikiLink item={item} fallbackName={fallbackName} />
        </span>
    );
}

/** A block's first line: how many runs, where, and what each run does with the item above. */
function StepHeader({ step, runs, children }: { step: MakeStep | TradeStep; runs: number; children: ReactNode }) {
    const batch = useContext(Batch);
    const where =
        step.kind === 'craft'
            ? `${runsText('craft', runs)} at ${step.where} ${step.level} (${duration(step.seconds)} each)`
            : `${runsText('barter', runs)} with ${step.where}${step.level > 1 ? ` LL${step.level}` : ''}`;
    const rationed = step.kind === 'barter' && step.limit !== null && runs / batch > step.limit + EPSILON;

    return (
        <li className='flex flex-wrap items-center gap-x-2 gap-y-1'>
            <span className='data text-[10px] text-muted'>
                {where}, {children}
                {step.limit !== null && !rationed ? ` (${step.limit} a restock)` : ''}
            </span>
            {rationed && step.limit !== null ? <RestockPill where={step.where} perRun={runs / batch} limit={step.limit} /> : null}
            <GatePills gates={step.gates} />
        </li>
    );
}

export function FuelLine({ cost, seconds }: { cost: number; seconds: number }) {
    return (
        <li className='flex flex-wrap items-baseline gap-x-3'>
            <span aria-hidden className={GUTTER} />
            <span className='min-w-48 text-[12px] text-bone-dim'>Generator fuel</span>
            <span className='data text-[10px] text-muted'>over {duration(seconds)}</span>
            <span className={cx(FIGURE, 'ml-auto text-[12px] text-bone')}>{minus(cost)}</span>
        </li>
    );
}

/** A cost: an item, how many, what one costs and where from, and what they come to. */
export function CostLine({ line, scale }: { line: RouteLine; scale: number }) {
    const count = line.count * scale;
    const unit = line.unit;
    const step = unit?.step ?? null;
    const runs = step ? count / Math.max(1, step.yields) : 0;

    return (
        <li className='space-y-1.5'>
            <div className='flex flex-wrap items-baseline gap-x-3 gap-y-1'>
                <span aria-hidden className={GUTTER} />
                <ItemName item={line.item} fallbackName={line.itemId} className='text-bone-dim' />
                {/* A tool is needed once however many runs use it, so it is never scaled. */}
                <span className={cx(FIGURE, 'text-[11px] text-muted')}>×{countText(line.tool ? line.count : count)}</span>
                {line.tool ? (
                    <span className='data text-[10px] text-steel'>tool, handed back</span>
                ) : unit ? (
                    <>
                        <span className={cx(FIGURE, 'text-[11px] text-bone')}>{roubles(unit.priceRUB)} each</span>
                        <span className={cx('data text-[10px]', unit.locked ? 'text-rust' : 'text-muted')}>{boughtFrom(unit)}</span>
                        {unit.seconds > 0 ? (
                            <span className={cx(FIGURE, 'text-[10px] text-amber-dim')}>+{duration(unit.seconds * count)}</span>
                        ) : null}
                    </>
                ) : (
                    <span className='data text-[10px] text-rust'>no price</span>
                )}
                <span className={cx(FIGURE, 'ml-auto text-[12px]', line.cost === null && !line.tool ? 'text-rust' : 'text-bone')}>
                    {line.tool ? '' : line.cost === null ? '—' : minus(line.cost * scale)}
                </span>
            </div>
            {step ? (
                <ul className={BLOCK}>
                    <StepHeader step={step} runs={runs}>
                        each gives {countText(step.yields)} {nameOf(line)}
                    </StepHeader>
                    {step.lines.map((each, i) => (
                        <CostLine key={`${each.itemId}-${i}`} line={each} scale={runs} />
                    ))}
                    {step.fuelCost > 0 ? <FuelLine cost={step.fuelCost * runs} seconds={step.seconds * runs} /> : null}
                </ul>
            ) : null}
        </li>
    );
}

/**
 * What a step gives back: what one is worth and how it goes, then the lot. Used for the
 * row's own product, and again inside every step the product is traded or crafted on through.
 */
export function OutputLine({
    item,
    fallbackName,
    count,
    sale,
    traded,
    className,
}: {
    item: SellItem | null;
    fallbackName: string;
    count: number;
    sale: Disposal | null;
    /** Handed over by a barter, so not found in raid and never on the flea. */
    traded?: boolean;
    className?: string;
}) {
    const step = sale?.step ?? null;
    const runs = step ? count / (step.takes > 0 ? step.takes : 1) : 0;

    return (
        <li className={cx('space-y-1.5', className)}>
            <div className='flex flex-wrap items-baseline gap-x-3 gap-y-1'>
                <span className={cx(GUTTER, 'text-moss')}>→ gives</span>
                <ItemName item={item} fallbackName={fallbackName} className='text-bone' />
                <span className={cx(FIGURE, 'text-[11px] text-muted')}>×{countText(count)}</span>
                {traded ? (
                    <span className='data text-[10px] text-muted' title='A traded item is not found in raid, and the flea only lists found-in-raid items'>
                        not FIR
                    </span>
                ) : null}
                {sale ? (
                    <>
                        <span className={cx(FIGURE, 'text-[11px] text-bone')}>{roubles(sale.net)} each</span>
                        <span className={cx('data text-[10px]', sale.locked ? 'text-rust' : 'text-muted')}>{soldTo(sale)}</span>
                        {sale.seconds > 0 ? (
                            <span className={cx(FIGURE, 'text-[10px] text-amber-dim')}>+{duration(sale.seconds * count)}</span>
                        ) : null}
                    </>
                ) : (
                    <span className='data text-[10px] text-rust'>no price</span>
                )}
                <span className={cx(FIGURE, 'ml-auto text-[12px]', sale === null || sale.net < 0 ? 'text-rust' : 'text-bone')}>
                    {sale === null ? '—' : signed(sale.net * count)}
                </span>
            </div>
            {step ? (
                <ul className={BLOCK}>
                    <StepHeader step={step} runs={runs}>
                        each takes {countText(step.takes)} {item?.name ?? fallbackName}
                    </StepHeader>
                    {step.lines.map((each, i) => (
                        <CostLine key={`${each.itemId}-${i}`} line={each} scale={runs} />
                    ))}
                    {step.fuelCost > 0 ? <FuelLine cost={step.fuelCost * runs} seconds={step.seconds * runs} /> : null}
                    <OutputLine
                        item={step.product.item}
                        fallbackName={step.product.itemId}
                        count={step.product.count * runs}
                        sale={step.product.disposal}
                        traded={!step.product.foundInRaid}
                        className='border-t border-line/50 pt-1.5'
                    />
                </ul>
            ) : null}
        </li>
    );
}
