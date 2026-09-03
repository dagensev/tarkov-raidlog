'use client';

import { useEffect, useMemo, useState } from 'react';

import { TaskRow } from '@/components/task-row';
import { Button, EmptyNote, Label, Lamp, Panel, PanelHeader, Pill, cx } from '@/components/ui';
import { useAvailability, useCurrentMap, useMaps, useMapsWithTasks, useTaskStates, useTasks } from '@/lib/store/hooks';
import { useSquadStore } from '@/lib/store/squad-store';

function StatusLamp() {
    const status = useSquadStore((s) => s.status);
    const state = {
        idle: { tone: 'muted', text: 'Not in a squad', live: false },
        connecting: { tone: 'amber', text: 'Connecting', live: true },
        connected: { tone: 'moss', text: 'Synced', live: true },
        reconnecting: { tone: 'amber', text: 'Reconnecting', live: true },
        error: { tone: 'rust', text: 'Error', live: false },
    }[status] as { tone: 'muted' | 'amber' | 'moss' | 'rust'; text: string; live: boolean };

    return (
        <span className='flex items-center gap-2'>
            <Lamp tone={state.tone} live={state.live} />
            <span className='data text-[11px] text-bone-dim'>{state.text}</span>
        </span>
    );
}

function JoinPanel() {
    const create = useSquadStore((s) => s.create);
    const join = useSquadStore((s) => s.join);
    const error = useSquadStore((s) => s.error);
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);

    // An invite link lands here as /squad/?join=TOKEN, put there by the Worker.
    useEffect(() => {
        const invite = new URLSearchParams(window.location.search).get('join');
        if (!invite) return;
        window.history.replaceState({}, '', '/squad/');
        void join(invite);
    }, [join]);

    return (
        <Panel className='rise'>
            <PanelHeader title='Squad' meta='not in one' />
            <div className='grid gap-6 px-4 py-5 sm:grid-cols-2'>
                <div className='space-y-3'>
                    <Label>Start one</Label>
                    <p className='text-[13px] leading-relaxed text-muted'>Creates a squad and gives you a link to share. Whoever clicks it joins.</p>
                    <Button
                        variant='primary'
                        disabled={busy}
                        onClick={() => {
                            setBusy(true);
                            void create().finally(() => setBusy(false));
                        }}
                    >
                        {busy ? 'Creating…' : 'Create a squad'}
                    </Button>
                </div>

                <div className='space-y-3'>
                    <Label>Or join one</Label>
                    <p className='text-[13px] leading-relaxed text-muted'>Paste the link or type the code.</p>
                    <form
                        className='flex gap-2'
                        onSubmit={(e) => {
                            e.preventDefault();
                            void join(code);
                        }}
                    >
                        <input
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            placeholder='ABCD1234'
                            className='data w-40 border border-line-bright bg-ground-2 px-2 py-1.5 text-[13px] tracking-widest text-bone uppercase placeholder:text-muted focus:border-amber-dim focus:outline-none'
                        />
                        <Button type='submit'>Join</Button>
                    </form>
                </div>
            </div>
            {error ? <p className='data border-t border-line px-4 py-2 text-[11px] text-rust'>{error}</p> : null}
            <p className='border-t border-line px-4 py-3 text-[12px] leading-relaxed text-muted'>
                Your squad sees your nickname, level, faction, the map you are loading into, and which tasks you have done or are holding. Nothing else — not
                your logs, not your account.
            </p>
        </Panel>
    );
}

function InvitePanel() {
    const token = useSquadStore((s) => s.token)!;
    const leave = useSquadStore((s) => s.leave);
    const identity = useSquadStore((s) => s.identity);
    const rename = useSquadStore((s) => s.rename);
    const [copied, setCopied] = useState(false);

    const link = typeof window === 'undefined' ? '' : `${window.location.origin}/j/${token}`;

    return (
        <Panel className='rise'>
            <PanelHeader title='Your squad' meta={token} action={<StatusLamp />} />
            <div className='space-y-4 px-4 py-4'>
                <div className='space-y-2'>
                    <Label>Invite link</Label>
                    <div className='flex flex-wrap items-center gap-2'>
                        <code className='data flex-1 border border-line-bright bg-ground-2 px-2 py-1.5 text-[12px] break-all text-bone-dim'>{link}</code>
                        <Button
                            onClick={() => {
                                void navigator.clipboard?.writeText(link).then(() => {
                                    setCopied(true);
                                    setTimeout(() => setCopied(false), 1500);
                                });
                            }}
                        >
                            {copied ? 'Copied' : 'Copy'}
                        </Button>
                    </div>
                </div>

                <div className='flex flex-wrap items-end gap-4'>
                    <label className='flex flex-col gap-1.5'>
                        <Label>You appear as</Label>
                        <input
                            // Keyed on the stored name so it resets when that changes, which avoids
                            // mirroring store state into component state just to keep them in step.
                            key={identity?.name}
                            defaultValue={identity?.name ?? ''}
                            onBlur={(e) => void rename(e.target.value)}
                            maxLength={24}
                            className='data w-48 border border-line-bright bg-ground-2 px-2 py-1.5 text-[13px] text-bone focus:border-amber-dim focus:outline-none'
                        />
                    </label>
                    <Button variant='ghost' onClick={() => void leave()}>
                        Leave squad
                    </Button>
                </div>
            </div>
        </Panel>
    );
}

/** Tasks more than one of you still needs — the reason to run together. */
function SharedTasks() {
    const members = useSquadStore((s) => s.members);
    const progress = useSquadStore((s) => s.progress);
    const tasks = useTasks();
    const states = useTaskStates();
    const availability = useAvailability();
    const maps = useMapsWithTasks();
    const currentMap = useCurrentMap();
    // Null means "follow the detected map"; picking anything, including Any map, sticks.
    const [chosenMapId, setChosenMapId] = useState<string | null>(null);
    const mapId = chosenMapId ?? currentMap?.id ?? '';

    const shared = useMemo(() => {
        if (members.length < 2) return [];
        const byId = new Map(tasks.map((task) => [task.id, task]));

        return tasks
            .map((task) => {
                const holding = members.filter((m) => progress[m.id]?.[task.id] === 'started');
                return { task, holding };
            })
            .filter(({ task, holding }) => {
                if (holding.length < 2) return false;
                if (!byId.has(task.id)) return false;
                if (mapId) {
                    const onMap = task.map?.id === mapId || task.objectives.some((o) => o.maps.some((m) => m.id === mapId));
                    if (!onMap) return false;
                }
                return true;
            })
            .sort((a, b) => b.holding.length - a.holding.length || a.task.name.localeCompare(b.task.name));
    }, [members, progress, tasks, mapId]);

    if (members.length < 2) {
        return (
            <Panel className='rise' style={{ animationDelay: '60ms' }}>
                <PanelHeader title='Shared tasks' meta='waiting for squadmates' />
                <EmptyNote>Send someone your invite link. Once two of you are in, this shows the tasks you are both holding.</EmptyNote>
            </Panel>
        );
    }

    return (
        <Panel className='rise' style={{ animationDelay: '60ms' }}>
            <PanelHeader
                title='Both holding'
                meta={`${shared.length} tasks`}
                action={
                    <select
                        value={mapId}
                        onChange={(e) => setChosenMapId(e.target.value)}
                        className='data border border-line-bright bg-ground-2 px-2 py-1 text-[11px] text-bone focus:border-amber-dim focus:outline-none'
                    >
                        <option value=''>Any map</option>
                        {maps.map((map) => (
                            <option key={map.id} value={map.id}>
                                {map.name}
                            </option>
                        ))}
                    </select>
                }
            />
            {shared.length === 0 ? (
                <EmptyNote>Nothing your squad is working on together{mapId ? ' on this map' : ''} right now.</EmptyNote>
            ) : (
                // The same row the task list uses, so objectives, keys and the wiki link are all
                // here. Who else is holding it comes from the squad tag inside the row.
                <ul>
                    {shared.map(({ task }) => (
                        <TaskRow key={task.id} task={task} state={states.get(task.id)} availability={availability.get(task.id)} mapId={mapId || undefined} />
                    ))}
                </ul>
            )}
        </Panel>
    );
}

function Members() {
    const members = useSquadStore((s) => s.members);
    const identity = useSquadStore((s) => s.identity);
    const maps = useMaps();

    if (members.length === 0) return null;

    return (
        <Panel className='rise' style={{ animationDelay: '120ms' }}>
            <PanelHeader title='Members' meta={`${members.length}`} />
            <ul className='divide-y divide-line'>
                {members.map((member) => {
                    const map = maps.find((m) => m.id === member.currentMap);
                    return (
                        <li key={member.id} className='flex flex-wrap items-center gap-3 px-4 py-2.5'>
                            <Lamp tone={member.online ? 'moss' : 'muted'} live={member.online} />
                            <span className={cx('text-[14px]', member.id === identity?.id ? 'text-amber' : 'text-bone')}>
                                {member.name}
                                {member.id === identity?.id ? ' (you)' : ''}
                            </span>
                            {member.faction ? <Pill tone='steel'>{member.faction}</Pill> : null}
                            {member.level ? <span className='data text-[11px] text-muted'>Lv{member.level}</span> : null}
                            {map ? <Pill tone='amber'>{map.name}</Pill> : null}
                            {!member.online ? <span className='data ml-auto text-[10px] text-muted'>offline</span> : null}
                        </li>
                    );
                })}
            </ul>
        </Panel>
    );
}

export default function SquadPage() {
    const token = useSquadStore((s) => s.token);

    if (!token) return <JoinPanel />;

    return (
        <div className='space-y-4'>
            <InvitePanel />
            <SharedTasks />
            <Members />
        </div>
    );
}
