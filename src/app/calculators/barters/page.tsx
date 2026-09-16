'use client';

import { BartersCalculator } from '@/components/calculators/barters';
import { CalculatorTabs } from '@/components/calculators/tabs';

/**
 * The Barters calculator.
 *
 * On a route of its own, unlike Crafts, which keeps the index so the link it has always had
 * goes on working.
 */
export default function BartersPage() {
    return (
        <div className='space-y-4'>
            <CalculatorTabs />
            <BartersCalculator />
        </div>
    );
}
