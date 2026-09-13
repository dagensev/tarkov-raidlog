'use client';

import { CalculatorTabs } from '@/components/calculators/tabs';
import { CraftsCalculator } from '@/components/calculators/crafts';

/**
 * The Calculators tab.
 *
 * Crafts is the only one so far and lives at the index rather than at a route of its own,
 * so the tab strip has something to select from the first day and no link ever has to move
 * when a second calculator arrives.
 */
export default function CalculatorsPage() {
    return (
        <div className='space-y-4'>
            <CalculatorTabs />
            <CraftsCalculator />
        </div>
    );
}
