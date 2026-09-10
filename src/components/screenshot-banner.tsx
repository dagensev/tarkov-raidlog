'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';

import { isFileSystemAccessSupported } from '@/lib/logs/fs-access-source';
import { useAppStore } from '@/lib/store/app-store';
import { Panel } from './ui';

/**
 * The one thing about the raid map nobody guesses: it cannot show where you are until the
 * game's Screenshots folder is linked.
 *
 * Said as a banner across the raid board rather than as a line inside the map card,
 * because it is a job to go and do — and the settings page it sends you to is two clicks
 * away otherwise.
 *
 * Silent once the folder is linked. A banner that is always there stops being read, which
 * is the same reason the header's log lamp says nothing while it is watching.
 */

/** Capability never changes within a page load, so there is nothing to subscribe to. */
const subscribeNever = () => () => {};

export function ScreenshotBanner() {
    const status = useAppStore((s) => s.screenshotStatus);

    // A browser capability is external state, not React state. The server snapshot claims
    // support so the prerendered HTML does not flash a banner at a browser that has it; the
    // client snapshot corrects it on hydration.
    const supported = useSyncExternalStore(subscribeNever, isFileSystemAccessSupported, () => true);

    // Nothing to nag about once it is watching, and nothing to offer a browser that cannot do
    // it at all — Firefox and Safari have no File System Access API, and the settings page
    // explains that in full rather than repeating it on every raid board.
    if (status === 'watching' || !supported) return null;

    const lapsed = status === 'needs-permission';

    return (
        <Panel className='rise border-rust/50' style={{ animationDelay: '30ms' }}>
            <div className='flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3'>
                <span aria-hidden className='text-[15px] leading-none text-rust'>
                    ⚠
                </span>
                <div className='min-w-[16rem] flex-1 space-y-1'>
                    <p className='stencil text-[11px] text-rust'>{lapsed ? 'Screenshot link needs reconnecting' : 'Screenshot link not connected'}</p>
                    <p className='text-[12px] leading-relaxed text-bone-dim'>The raid map cannot show where you are standing.</p>
                </div>
                <Link
                    href='/settings/'
                    className='stencil border border-rust bg-rust/15 px-3 py-1.5 text-[10px] whitespace-nowrap text-rust transition-colors hover:bg-rust hover:text-ground'
                >
                    {lapsed ? 'Reconnect in settings →' : 'Connect in settings →'}
                </Link>
            </div>
            <div className='ticks h-[3px] opacity-40' />
        </Panel>
    );
}
