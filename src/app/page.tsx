'use client';

import { useMemo } from 'react';

import { ConnectLogs } from '@/components/connect-logs';
import { TaskRow, rowStatus } from '@/components/task-row';
import { Chip, EmptyNote, Panel, PanelHeader, SelectField, TextField } from '@/components/ui';
import { useAppStore } from '@/lib/store/app-store';
import { useAvailability, useMapsWithTasks, useTaskStates, useTasks } from '@/lib/store/hooks';
import { useInSquad, useSquadHoldingCounts, useSquadRoster } from '@/lib/store/squad-hooks';
import { toggle } from '@/lib/sell/filters';
import { taskIsOnMap } from '@/lib/tarkovdev/maps';
import { FILTERS, type TaskFilter } from '@/lib/tasks/filters';
import { mapFilterFrom, resolveMapFilter } from '@/lib/tasks/map-filter';
import { mapOptions } from '@/lib/tasks/map-options';
import { activeMemberIds, matchesMembers, memberStatuses, type MemberSelection } from '@/lib/tasks/members';
import { SORT_MODES, sharedWithSquad, sortTasks, type SortMode } from '@/lib/tasks/sort';

export default function TasksPage() {
    const tasks = useTasks();
    const states = useTaskStates();
    const availability = useAvailability();
    const pickableMaps = useMapsWithTasks();
    const squadHolders = useSquadHoldingCounts();
    const inSquad = useInSquad();
    const roster = useSquadRoster();

    // Every control on this page lives in the store rather than in component state: the tab
    // links are routes, so the page unmounts whenever you look at a raid or your squad, and
    // a filter you set thirty seconds ago should still be set when you come back.
    const { filter, query, kappaOnly, sort, members } = useAppStore((s) => s.taskView);
    const setView = useAppStore((s) => s.setTaskView);

    // The map is the one control the squad tab shares, so it is kept apart from the rest.
    // Nothing picked means every map here; the squad tab reads the same absence as "follow
    // the detected map".
    const mapFilter = useAppStore((s) => s.mapFilter);
    const setMapFilter = useAppStore((s) => s.setMapFilter);
    const mapId = resolveMapFilter(mapFilter);

    /**
     * Whose logs the status filter reads.
     *
     * Nobody lit is the whole axis off, and the page behaves as it did before squads: the
     * filter reads your states and All means every task in the game. Light a chip and the
     * filter applies to those people instead, which is the only way a task you have never
     * accepted can appear at all. Ids for members who have left are dropped rather than
     * left narrowing the list, exactly as a stale map or sort selection is.
     */
    const selected = useMemo(() => activeMemberIds(members, roster.options), [members, roster.options]);
    const selection = useMemo<MemberSelection>(
        () => ({ ids: selected, youId: roster.youId, states, progress: roster.progress }),
        [selected, roster.youId, roster.progress, states],
    );

    const counts = useMemo<Record<TaskFilter, number>>(() => {
        // With a selection the counts have to be tallied the same way the list is filtered,
        // or the number on a chip stops describing what pressing it shows — including All,
        // which is no longer every task once the axis is on.
        if (selected.length > 0) {
            const tally = { started: 0, finished: 0, all: 0 };
            for (const task of tasks) {
                for (const option of FILTERS) {
                    if (matchesMembers(task.id, option.id, selection)) tally[option.id] += 1;
                }
            }
            return tally;
        }

        let started = 0;
        let finished = 0;
        for (const task of tasks) {
            const status = rowStatus(states.get(task.id));
            if (status === 'started') started += 1;
            if (status === 'finished') finished += 1;
        }
        return { started, finished, all: tasks.length };
    }, [tasks, states, selected, selection]);

    /** Everything passing the filters *except* the map, which the map options derive from. */
    const beforeMapFilter = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return tasks.filter((task) => {
            if (selected.length > 0) {
                if (!matchesMembers(task.id, filter, selection)) return false;
            } else if (filter !== 'all' && rowStatus(states.get(task.id)) !== filter) {
                return false;
            }
            if (kappaOnly && !task.kappaRequired) return false;
            if (needle) {
                const name = task.name.toLowerCase();
                const trader = task.trader?.name.toLowerCase() ?? '';
                if (!name.includes(needle) && !trader.includes(needle)) return false;
            }
            return true;
        });
    }, [tasks, states, filter, query, kappaOnly, selected, selection]);

    /**
     * Maps that still have something to show under the current filters, with a count.
     *
     * Derived from the already-filtered tasks so that picking any option always lands on
     * at least one task — filter to In progress and you are offered only the maps you have
     * something running on.
     */
    const options = useMemo(() => mapOptions(pickableMaps, beforeMapFilter), [pickableMaps, beforeMapFilter]);

    // A map chosen under one filter may have nothing under the next. Ignore it rather than
    // showing an empty list against a stale selection; it reapplies if the filter comes back.
    const activeMapId = options.some((o) => o.map.id === mapId) ? mapId : '';

    // Sorting by what your squad is on says nothing while you are alone, so that option is
    // offered only in a squad — and a selection left over from one is dropped, exactly as a
    // stale map selection is.
    const sortModes = useMemo(() => SORT_MODES.filter((mode) => mode.id !== 'squad' || inSquad), [inSquad]);
    const activeSort = sortModes.some((mode) => mode.id === sort) ? sort : 'progress';
    // The map goes in too: filtering to one is a statement about where you are going, so the
    // tasks handed out for it lead the list whichever ordering is picked.
    const sortInputs = useMemo(() => ({ states, squadHolders, mapId: activeMapId || undefined }), [states, squadHolders, activeMapId]);

    const matching = useMemo(
        () => (activeMapId ? beforeMapFilter.filter((task) => taskIsOnMap(task, activeMapId)) : beforeMapFilter),
        [beforeMapFilter, activeMapId],
    );

    const visible = useMemo(() => sortTasks(matching, activeSort, sortInputs), [matching, activeSort, sortInputs]);

    /** How many of the tasks on screen a squadmate is holding too. */
    const sharedCount = useMemo(() => matching.reduce((n, task) => n + (sharedWithSquad(task.id, sortInputs) ? 1 : 0), 0), [matching, sortInputs]);

    if (tasks.length === 0) {
        return (
            <div className='space-y-4'>
                <ConnectLogs />
                <Panel>
                    <PanelHeader title='Tasks' meta='no game data' />
                    <EmptyNote>Task data comes from tarkov.dev and has not loaded yet. Your log history is safe either way.</EmptyNote>
                </Panel>
            </div>
        );
    }

    return (
        <div className='space-y-4'>
            {/*
        The landing page, so it carries the one thing that has to happen before anything
        works. Renders nothing once a folder is connected.
      */}
            <ConnectLogs />
            <Panel className='rise'>
                <PanelHeader title='Filters' meta={`${visible.length} shown`} />
                <div className='flex flex-wrap items-center gap-2 px-4 py-3'>
                    {FILTERS.map((option) => (
                        <Chip
                            key={option.id}
                            title={option.title}
                            active={filter === option.id}
                            onClick={() => setView({ filter: option.id })}
                        >
                            {option.label}
                            <span className='data ml-2 text-[10px] opacity-60'>{counts[option.id]}</span>
                        </Chip>
                    ))}

                    <div className='ml-auto flex flex-wrap items-center gap-2'>
                        <TextField
                            value={query}
                            onChange={(e) => setView({ query: e.target.value })}
                            placeholder='Search tasks or traders'
                            className='w-52'
                        />
                        <SelectField
                            value={activeMapId}
                            onChange={(e) => setMapFilter(mapFilterFrom(e.target.value))}
                            title='Only maps with something to show under the current filters'
                        >
                            <option value=''>Any map ({beforeMapFilter.length})</option>
                            {options.map(({ map, count }) => (
                                <option key={map.id} value={map.id}>
                                    {map.name} ({count})
                                </option>
                            ))}
                        </SelectField>
                        <SelectField
                            value={activeSort}
                            onChange={(e) => setView({ sort: e.target.value as SortMode })}
                            aria-label='Sort order'
                            title={sortModes.find((mode) => mode.id === activeSort)?.title}
                        >
                            {sortModes.map((mode) => (
                                <option key={mode.id} value={mode.id} title={mode.title}>
                                    {/* The squad option carries its count, since "none right now" is the
                      answer often enough to be worth seeing before you pick it. */}
                                    {mode.id === 'squad' ? `${mode.label} (${sharedCount})` : mode.label}
                                </option>
                            ))}
                        </SelectField>
                        <Chip title='Only tasks required for Kappa' active={kappaOnly} onClick={() => setView({ kappaOnly: !kappaOnly })}>
                            κ only
                        </Chip>
                    </div>
                </div>

                {/*
          Whose logs the filters above read. Its own line because it is a different
          question from the rest of the row, and absent entirely when you are alone.
        */}
                {roster.options.length > 0 ? (
                    <div className='flex flex-wrap items-center gap-2 border-t border-line/70 px-4 py-3'>
                        <span className='stencil text-[9px] text-muted' title='Nobody lit reads your logs alone'>
                            Read tasks from
                        </span>
                        {roster.options.map((option) => (
                            <Chip
                                key={option.id}
                                active={selected.includes(option.id)}
                                title={
                                    option.isYou
                                        ? 'Your own logs'
                                        : `${option.name}'s logs, including tasks you have not accepted`
                                }
                                onClick={() => setView({ members: toggle(members, option.id) })}
                            >
                                {option.name}
                            </Chip>
                        ))}
                        {selected.length > 0 ? (
                            <button
                                type='button'
                                onClick={() => setView({ members: [] })}
                                className='data cursor-pointer text-[10px] text-muted underline decoration-line-bright underline-offset-4 transition-colors hover:text-bone-dim'
                            >
                                clear
                            </button>
                        ) : null}
                    </div>
                ) : null}
            </Panel>

            <Panel className='rise' style={{ animationDelay: '60ms' }}>
                <PanelHeader
                    title={activeMapId ? `Tasks · ${options.find((o) => o.map.id === activeMapId)?.map.name}` : 'Tasks'}
                    meta={`${visible.length} of ${tasks.length}`}
                />
                {/* Says where the ticks come from, now that none of them are yours to set. */}
                <p className='border-b border-line/70 px-4 py-2.5 text-[12px] leading-relaxed text-muted'>
                    Progress is read from your linked Tarkov logs and updates automatically.
                    {selected.length > 0 ? ' Squad rows come from what your squadmates have published.' : ''}
                </p>
                {visible.length === 0 ? (
                    <EmptyNote>Nothing matches those filters.</EmptyNote>
                ) : (
                    <ul>
                        {visible.map((task) => (
                            <TaskRow
                                key={task.id}
                                task={task}
                                state={states.get(task.id)}
                                availability={availability.get(task.id)}
                                mapId={activeMapId || undefined}
                                members={selected.length > 0 ? memberStatuses(task.id, selection, roster.options) : undefined}
                            />
                        ))}
                    </ul>
                )}
            </Panel>
        </div>
    );
}
