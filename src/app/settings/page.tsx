'use client';

import { ConnectLogs } from '@/components/connect-logs';
import { Button, Label, Lamp, Panel, PanelHeader, Pill, cx } from '@/components/ui';
import { useAppStore } from '@/lib/store/app-store';
import { useGameMode, useSelectedWipe, useTarkovData } from '@/lib/store/hooks';
import { GAME_MODES } from '@/lib/tarkovdev/endpoints';

function fmt(ms: number): string {
    return new Date(ms).toLocaleDateString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}

function WipeSettings() {
    const wipes = useAppStore((s) => s.wipes);
    const settings = useAppStore((s) => s.settings);
    const update = useAppStore((s) => s.updateSettings);
    const selected = useSelectedWipe();

    if (!wipes || wipes.generations.length === 0) return null;

    return (
        <Panel className='rise' style={{ animationDelay: '60ms' }}>
            <PanelHeader
                title='Which wipe counts'
                meta={settings.wipeId ? 'chosen by you' : 'detected'}
                action={
                    settings.wipeId ? (
                        <Button variant='ghost' onClick={() => void update({ wipeId: null })}>
                            Use detected
                        </Button>
                    ) : null
                }
            />
            <ul className='divide-y divide-line'>
                {wipes.generations.map((generation) => {
                    const active = generation.id === selected?.id;
                    return (
                        <li key={generation.id}>
                            <button
                                type='button'
                                onClick={() => void update({ wipeId: generation.id })}
                                className={cx(
                                    'flex w-full cursor-pointer flex-wrap items-center gap-3 px-4 py-3 text-left transition-colors',
                                    active ? 'bg-amber/5' : 'hover:bg-panel-2/60',
                                )}
                            >
                                <Lamp tone={active ? 'amber' : 'muted'} />
                                <span className='data text-[12px] text-bone'>
                                    {fmt(generation.firstSeenAt)} → {fmt(generation.lastSeenAt)}
                                </span>
                                <span className='data text-[11px] text-muted'>
                                    {generation.folders.length} session{generation.folders.length === 1 ? '' : 's'}
                                </span>
                                <span className='data text-[10px] text-muted'>profile made {fmt(generation.createdAt)}</span>
                                {generation.sessionModes.map((mode) => (
                                    <Pill key={mode} tone={mode === 'Pve' ? 'steel' : 'muted'}>
                                        {mode}
                                    </Pill>
                                ))}
                                {generation.ambiguous ? (
                                    <Pill tone='rust' className='opacity-80'>
                                        mixed session
                                    </Pill>
                                ) : null}
                                {generation === wipes.current ? <Pill tone='amber'>detected</Pill> : null}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </Panel>
    );
}

function LogPanel() {
    const status = useAppStore((s) => s.logStatus);
    const rescan = useAppStore((s) => s.rescan);
    const events = useAppStore((s) => s.events);
    const manualCount = Object.keys(useAppStore((s) => s.manualTasks)).length;

    if (status !== 'watching') return <ConnectLogs />;

    return (
        <Panel className='rise'>
            <PanelHeader title='Log link' meta='connected' />
            <div className='space-y-4 px-4 py-4'>
                <div className='flex flex-wrap gap-x-8 gap-y-3'>
                    <div className='flex flex-col gap-1'>
                        <Label>Events read</Label>
                        <span className='data text-lg text-bone'>{events.length.toLocaleString()}</span>
                    </div>
                    <div className='flex flex-col gap-1'>
                        <Label>Set by hand</Label>
                        <span className='data text-lg text-bone'>{manualCount}</span>
                    </div>
                </div>
                <Button onClick={() => void rescan()}>Re-read all logs</Button>
                <p className='text-[12px] leading-relaxed text-muted'>Re-reading starts from scratch. Anything you ticked off by hand is kept.</p>
            </div>
        </Panel>
    );
}

function ScreenshotPanel() {
    const status = useAppStore((s) => s.screenshotStatus);
    const error = useAppStore((s) => s.screenshotError);
    const connect = useAppStore((s) => s.connectScreenshots);
    const reconnect = useAppStore((s) => s.reconnectScreenshots);

    return (
        <Panel className='rise' style={{ animationDelay: '90ms' }}>
            <PanelHeader
                title='Screenshot link'
                meta={status === 'watching' ? 'connected' : status === 'needs-permission' ? 'permission lapsed' : 'not connected'}
            />
            <div className='space-y-3 px-4 py-4'>
                <p className='text-[13px] leading-relaxed text-bone-dim'>
                    The game writes where you were standing into the name of every screenshot it saves. Point Raidlog at your{' '}
                    <span className='data text-bone'>Screenshots</span> folder and pressing the screenshot key in raid puts you on the map.
                </p>
                <p className='text-[13px] leading-relaxed text-muted'>
                    Usually <span className='data'>Documents\Escape from Tarkov\Screenshots</span>. The game only creates it once you have taken your
                    first screenshot, so take one in raid if it is not there yet.
                </p>
                {status === 'needs-permission' ? (
                    <Button variant='primary' onClick={() => void reconnect()}>
                        Reconnect screenshots
                    </Button>
                ) : (
                    <Button variant={status === 'watching' ? 'ghost' : 'primary'} onClick={() => void connect()}>
                        {status === 'watching' ? 'Pick a different folder' : 'Connect screenshots'}
                    </Button>
                )}
                {error ? <p className='data text-[11px] text-rust'>{error}</p> : null}
            </div>
        </Panel>
    );
}

function DataPanel() {
    const refresh = useAppStore((s) => s.refreshData);
    const update = useAppStore((s) => s.updateSettings);
    const data = useTarkovData();
    const error = useAppStore((s) => s.dataError);
    const loading = useAppStore((s) => s.dataLoading);
    const chosenMode = useAppStore((s) => s.settings.gameMode);
    const sessionMode = useAppStore((s) => s.sessionMode);
    const mode = useGameMode();

    return (
        <Panel className='rise' style={{ animationDelay: '120ms' }}>
            <PanelHeader title='Game data' meta={loading ? 'loading…' : data ? `${data.tasks.length} tasks` : 'none'} />
            <div className='space-y-4 px-4 py-4'>
                <div className='flex flex-col gap-1.5'>
                    <Label>Game mode</Label>
                    <div className='flex flex-wrap'>
                        {GAME_MODES.map((option) => (
                            <button
                                key={option}
                                type='button'
                                onClick={() => void update({ gameMode: option })}
                                className={cx(
                                    'stencil cursor-pointer border px-3 py-1.5 text-[10px] transition-colors',
                                    mode === option ? 'border-amber bg-amber/15 text-amber' : 'border-line-bright text-muted hover:text-bone-dim',
                                )}
                            >
                                {option}
                            </button>
                        ))}
                        {chosenMode ? (
                            <Button variant='ghost' onClick={() => void update({ gameMode: null })}>
                                Use logs
                            </Button>
                        ) : null}
                    </div>
                    <p className='data text-[10px] text-muted'>
                        {chosenMode
                            ? 'Chosen by you.'
                            : sessionMode
                              ? `Detected from your logs (Session mode: ${sessionMode}).`
                              : 'No session mode seen in the logs yet.'}
                    </p>
                </div>

                <Button onClick={() => void refresh(true)} disabled={loading}>
                    {loading ? 'Loading…' : 'Refresh from tarkov.dev'}
                </Button>
                {error ? <p className='data text-[11px] text-rust'>{error}</p> : null}
                <p className='text-[12px] leading-relaxed text-muted'>Cached on this machine and refreshed daily.</p>
            </div>
        </Panel>
    );
}

export default function SettingsPage() {
    return (
        <div className='grid gap-4 lg:grid-cols-2'>
            <div className='space-y-4'>
                <LogPanel />
                <ScreenshotPanel />
            </div>
            <div className='space-y-4'>
                <WipeSettings />
                <DataPanel />
            </div>
        </div>
    );
}
