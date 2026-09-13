'use client';

import { useAppStore } from '@/lib/store/app-store';
import { Panel, PanelHeader, TextField } from './ui';

/**
 * The two character skills that change a number on another page.
 *
 * Like the hideout, these are typed rather than derived: the logs never mention a skill
 * level and tarkov.dev's data has no idea what yours is. Both default to zero, which
 * understates rather than flatters — a craft that looks marginal at skill 0 and pays at
 * skill 40 is the right way round for a table you act on.
 *
 * Deliberately not a general skills editor. Only these two feed a calculation anywhere in
 * the app, and a form with fifty rows for two live values is a form nobody fills in.
 */

/** Elite. Levels beyond it are a rank rather than more of the bonus. */
const MAX_SKILL = 51;

const SKILLS = [
    {
        key: 'craftingSkill',
        label: 'Crafting',
        hint: "Takes 0.75% off every craft's time per level, reaching 37.5% at Elite.",
    },
    {
        key: 'hideoutManagement',
        label: 'Hideout Management',
        hint: 'Deepens the Intelligence Center 3 discount on flea listing fees.',
    },
] as const;

export function CharacterSkills() {
    const settings = useAppStore((s) => s.settings);
    const update = useAppStore((s) => s.updateSettings);

    return (
        <Panel className='rise' style={{ animationDelay: '150ms' }}>
            <PanelHeader title='Character skills' />
            <div className='space-y-3 px-4 py-4'>
                <p className='text-[12px] leading-relaxed text-muted'>Factors into craft time and flea market fee.</p>

                <ul className='divide-y divide-line'>
                    {SKILLS.map((skill) => (
                        <li key={skill.key} className='flex flex-wrap items-center gap-3 py-2.5'>
                            <span className='min-w-40 text-[13px] text-bone'>{skill.label}</span>
                            <TextField
                                type='number'
                                min={0}
                                max={MAX_SKILL}
                                value={settings[skill.key]}
                                onChange={(e) =>
                                    void update({
                                        [skill.key]: Math.min(MAX_SKILL, Math.max(0, Number(e.target.value) || 0)),
                                    })
                                }
                                aria-label={`${skill.label} level`}
                                className='w-20'
                            />
                            {/* Plain rather than a stencil Label: these are sentences, and the stencil
                  face uppercases, which turns each of them into a shout. */}
                            <span className='min-w-0 flex-1 text-[11px] leading-relaxed text-muted'>{skill.hint}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </Panel>
    );
}
