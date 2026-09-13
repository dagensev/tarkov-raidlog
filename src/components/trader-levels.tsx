'use client';

import { useMemo } from 'react';

import { useAppStore } from '@/lib/store/app-store';
import { useTarkovData } from '@/lib/store/hooks';
import { Label, Panel, PanelHeader, cx } from './ui';

/**
 * Your loyalty level with each trader.
 *
 * Like the hideout, the logs never say: a loyalty change produces no message, and
 * tarkov.dev has no idea who you are. Typed once, it does three jobs — it stops tasks
 * behind a loyalty requirement from reading as unverified, marks barters you cannot take
 * yet, and keeps the crafts calculator from pricing an ingredient at an offer above your
 * standing.
 *
 * Only traders with a ladder to climb are listed. Lightkeeper, the BTR Driver and the rest
 * have a single level, so there is nothing to record and nothing that could be gated on
 * it; a row for each would be seven rows of one button.
 */
export function TraderLevels() {
    const data = useTarkovData();
    const levels = useAppStore((s) => s.settings.traderLevels);
    const setLevel = useAppStore((s) => s.setTraderLevel);

    // Document order, which is the order the trader screen uses in game.
    const traders = useMemo(() => (data?.traders ?? []).filter((trader) => trader.levels.length > 1), [data]);

    // Nothing to edit until the trader list arrives, the same stance HideoutLevels takes.
    if (traders.length === 0) return null;

    const recorded = traders.filter((trader) => levels[trader.id] !== undefined).length;

    return (
        <Panel className='rise' style={{ animationDelay: '120ms' }}>
            <PanelHeader title='Trader loyalty' meta={`${recorded} of ${traders.length} recorded`} />
            <div className='space-y-3 px-4 py-4'>
                <p className='text-[12px] leading-relaxed text-muted'>
                    Blank means we have not been told. The task list assumes the requirement is met and marks the task unverified, rather than hiding work you
                    can do. The crafts calculator assumes level 1, rather than pricing an ingredient at an offer you may not have.
                </p>

                <ul className='divide-y divide-line'>
                    {traders.map((trader) => {
                        const current = levels[trader.id];
                        const ladder = [...trader.levels].sort((a, b) => a.level - b.level);

                        return (
                            <li key={trader.id} className='flex flex-wrap items-center justify-between gap-2 py-2'>
                                <Label>{trader.name}</Label>
                                <div className='flex'>
                                    <button
                                        type='button'
                                        title='Not told'
                                        onClick={() => void setLevel(trader.id, null)}
                                        className={cx(
                                            'data cursor-pointer border px-2.5 py-1 text-[11px] transition-colors',
                                            current === undefined ? 'border-amber bg-amber/15 text-amber' : 'border-line-bright text-muted hover:text-bone-dim',
                                        )}
                                    >
                                        ?
                                    </button>
                                    {ladder.map((step) => (
                                        <button
                                            key={step.level}
                                            type='button'
                                            // What the level costs to reach, since that is the question a reader
                                            // unsure of their own standing is actually asking.
                                            title={
                                                step.requiredPlayerLevel > 1 || step.requiredReputation > 0
                                                    ? `Loyalty ${step.level}: player level ${step.requiredPlayerLevel}, standing ${step.requiredReputation}`
                                                    : `Loyalty ${step.level}`
                                            }
                                            onClick={() => void setLevel(trader.id, step.level)}
                                            className={cx(
                                                'data cursor-pointer border px-2.5 py-1 text-[11px] transition-colors',
                                                current === step.level
                                                    ? 'border-amber bg-amber/15 text-amber'
                                                    : 'border-line-bright text-muted hover:text-bone-dim',
                                            )}
                                        >
                                            {step.level}
                                        </button>
                                    ))}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </Panel>
    );
}
