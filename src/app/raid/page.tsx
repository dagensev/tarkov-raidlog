'use client';

import { useMemo } from 'react';

import { ItemIcon } from '@/components/item-icon';
import { Map3d } from '@/components/map-3d';
import { ObjectiveMap } from '@/components/objective-map';
import { TaskRow, rowStatus } from '@/components/task-row';
import { EmptyNote, Lamp, Panel, PanelHeader, Pill, cx } from '@/components/ui';
import { useAppStore } from '@/lib/store/app-store';
import { useAvailability, useCurrentMap, useMapsWithTasks, useRaidActive, useTaskStates, useTasks } from '@/lib/store/hooks';
import { tarkovDevMapUrl, taskIsOnMap } from '@/lib/tarkovdev/maps';

/**
 * The raid board.
 *
 * Answers one question — "what can I get done on the map I am dropping into, and what do I
 * need to bring" — so keys are hoisted to the top rather than buried in each task.
 */

function MapPicker() {
    const maps = useMapsWithTasks();
    const override = useAppStore((s) => s.settings.mapOverride);
    const update = useAppStore((s) => s.updateSettings);
    const scene = useAppStore((s) => s.raid.scene);

    return (
        <div className='flex flex-wrap items-center gap-2'>
            <select
                value={override ?? ''}
                onChange={(e) => void update({ mapOverride: e.target.value || null })}
                className='data border border-line-bright bg-ground-2 px-2 py-1.5 text-[12px] text-bone focus:border-amber-dim focus:outline-none'
            >
                <option value=''>Detect from logs{scene ? ` (${scene})` : ''}</option>
                {maps.map((map) => (
                    <option key={map.id} value={map.id}>
                        {map.name}
                    </option>
                ))}
            </select>
            {override ? <Pill tone='amber'>manual</Pill> : null}
        </div>
    );
}

export default function RaidPage() {
    const map = useCurrentMap();
    const inRaid = useRaidActive();
    const tasks = useTasks();
    const states = useTaskStates();
    const availability = useAvailability();

    /**
     * Tasks you are holding on this map — nothing else.
     *
     * Not-started tasks are a browsing question, answered on the tasks page. Loading into a
     * raid is the moment for the list you can actually act on, and the unfinished list ran
     * to dozens of entries you have not picked up from a trader yet.
     */
    const holding = useMemo(() => {
        if (!map) return [];
        return tasks.filter((task) => rowStatus(states.get(task.id)) === 'started' && taskIsOnMap(task, map.id));
    }, [tasks, states, map]);

    /** Keys those tasks need on this map — the packing list. */
    const keys = useMemo(() => {
        const collected = new Map<string, { name: string; short: string; icon: string | null; wiki: string | null; tasks: string[] }>();
        for (const task of holding) {
            for (const group of task.neededKeys) {
                if (group.map && map && group.map.id !== map.id) continue;
                for (const key of group.keys) {
                    const existing = collected.get(key.id);
                    if (existing) existing.tasks.push(task.name);
                    else
                        collected.set(key.id, {
                            name: key.name,
                            short: key.shortName ?? key.name,
                            icon: key.iconLink ?? null,
                            wiki: key.wikiLink ?? null,
                            tasks: [task.name],
                        });
                }
            }
        }
        return [...collected.entries()].sort((a, b) => b[1].tasks.length - a[1].tasks.length);
    }, [holding, map]);

    if (!map) {
        return (
            <Panel>
                <PanelHeader title='Raid board' meta='no map' action={<MapPicker />} />
                <EmptyNote>
                    {tasks.length === 0
                        ? 'Game data has not loaded, so there is nothing to match a map against yet.'
                        : 'No map detected. Start a raid, or pick one above to plan ahead.'}
                </EmptyNote>
            </Panel>
        );
    }

    return (
        <div className='space-y-4'>
            <Panel className={cx('rise', inRaid && 'border-amber/40')}>
                <div className='flex flex-wrap items-start justify-between gap-4 px-4 py-4'>
                    <div className='space-y-2'>
                        <div className='flex items-center gap-3'>
                            {inRaid ? <Lamp tone='amber' live /> : null}
                            <h1 className='stencil text-2xl text-amber glow-amber'>{map.name}</h1>
                        </div>
                        <div className='flex flex-wrap items-center gap-x-5 gap-y-1'>
                            {map.raidDuration ? <span className='data text-[11px] text-bone-dim'>{map.raidDuration} min</span> : null}
                            {map.players ? <span className='data text-[11px] text-bone-dim'>{map.players} players</span> : null}
                            <a
                                href={tarkovDevMapUrl(map)}
                                target='_blank'
                                rel='noreferrer'
                                className='stencil text-[10px] text-muted underline decoration-line-bright underline-offset-4 transition-colors hover:text-amber'
                            >
                                Interactive map ↗
                            </a>
                            {map.wiki ? (
                                <a
                                    href={map.wiki}
                                    target='_blank'
                                    rel='noreferrer'
                                    className='stencil text-[10px] text-muted underline decoration-line-bright underline-offset-4 transition-colors hover:text-amber'
                                >
                                    Wiki ↗
                                </a>
                            ) : null}
                        </div>
                    </div>
                    <MapPicker />
                </div>
                {map.description ? <p className='border-t border-line px-4 py-3 text-[12px] leading-relaxed text-muted'>{map.description}</p> : null}
            </Panel>

            {/* Keyed on the map so the load state starts fresh when you switch. */}
            <ObjectiveMap key={map.id} map={map} />
            <Map3d key={map.id} map={map} />

            {keys.length > 0 ? (
                <Panel className='rise border-rust/30' style={{ animationDelay: '60ms' }}>
                    <PanelHeader title='Bring these keys' meta={`${keys.length} · tasks in progress`} />
                    <ul className='divide-y divide-line'>
                        {keys.map(([id, key]) => (
                            <li key={id} className='flex flex-wrap items-center gap-3 px-4 py-2.5'>
                                {/* Bigger here than on a task row: this is the list you pack from. */}
                                <ItemIcon src={key.icon} size={32} />
                                <a
                                    href={key.wiki ?? undefined}
                                    target='_blank'
                                    rel='noreferrer'
                                    className='data border border-rust/40 bg-rust/10 px-2 py-[2px] text-[11px] text-rust transition-colors hover:bg-rust hover:text-ground'
                                >
                                    {key.short}
                                </a>
                                <span className='text-[13px] text-bone-dim'>{key.name}</span>
                                <span className='data ml-auto text-[11px] text-muted'>
                                    {key.tasks.length === 1 ? key.tasks[0] : `${key.tasks.length} tasks`}
                                </span>
                            </li>
                        ))}
                    </ul>
                </Panel>
            ) : null}

            <Panel className='rise' style={{ animationDelay: '120ms' }}>
                <PanelHeader title='In progress here' meta={`${holding.length} tasks`} />
                {holding.length === 0 ? (
                    <EmptyNote>You are not holding any tasks with objectives on {map.name}.</EmptyNote>
                ) : (
                    <ul>
                        {holding.map((task) => (
                            <TaskRow key={task.id} task={task} state={states.get(task.id)} availability={availability.get(task.id)} mapId={map.id} />
                        ))}
                    </ul>
                )}
            </Panel>
        </div>
    );
}
