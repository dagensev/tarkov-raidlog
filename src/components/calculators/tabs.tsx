'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cx } from '@/components/ui';

/**
 * The strip inside the Calculators tab.
 *
 * One entry today, and a strip anyway. Barters, hideout upgrades and the Bitcoin Farm are
 * all the same shape of page and all want to sit beside crafts rather than beside Raid
 * and Squad — five top-level tabs is a navigation bar, nine is a menu.
 *
 * Crafts stays at the index rather than moving to `/calculators/crafts/` when a second
 * one arrives, so no link ever points at a route that used to exist.
 */
const CALCULATORS = [{ href: '/calculators/', label: 'Crafts' }] as const;

export function CalculatorTabs() {
    const pathname = usePathname();

    return (
        <nav className='flex flex-wrap gap-2' aria-label='Calculators'>
            {CALCULATORS.map((item) => {
                const active = pathname === item.href || pathname === item.href.slice(0, -1);
                return (
                    <Link
                        key={item.href}
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={cx(
                            'stencil border px-4 py-1.5 text-[10px] transition-colors',
                            active
                                ? 'border-amber bg-amber/15 text-amber'
                                : 'border-line-bright text-muted hover:text-bone-dim',
                        )}
                    >
                        {item.label}
                    </Link>
                );
            })}
        </nav>
    );
}
