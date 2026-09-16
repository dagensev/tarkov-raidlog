'use client';

import { cx } from '@/components/ui';

/**
 * A sortable column header, shared by the calculator tables.
 *
 * Generic in the sort key so each table keeps its own closed union rather than widening to
 * string. `width` is a percentage of a fixed-layout table rather than something the content
 * decides: the rows are windowed, so a column that sized itself to whatever happened to be
 * on screen would jump every time you scrolled.
 */
export interface Column<K extends string> {
    key: K;
    label: string;
    title: string;
    width: string;
    /** The money and time columns, which centre. Names read left. */
    centred?: true;
}

export function HeaderCell<K extends string>({
    column,
    sort,
    descending,
    onSort,
}: {
    column: Column<K>;
    sort: K;
    descending: boolean;
    onSort: () => void;
}) {
    const active = sort === column.key;
    return (
        <th
            scope='col'
            aria-sort={active ? (descending ? 'descending' : 'ascending') : 'none'}
            className='border-b border-line bg-panel px-3 py-2 text-left font-normal'
        >
            <button
                type='button'
                onClick={onSort}
                title={column.title}
                className={cx(
                    'stencil flex w-full cursor-pointer items-center gap-1 text-[10px] transition-colors',
                    column.centred && 'justify-center',
                    active ? 'text-amber' : 'text-muted hover:text-bone-dim',
                )}
            >
                {column.label}
                <span aria-hidden className='data text-[9px]'>
                    {active ? (descending ? '▼' : '▲') : ''}
                </span>
            </button>
        </th>
    );
}
