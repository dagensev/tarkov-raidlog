'use client';

import { ItemIcon } from '@/components/item-icon';
import { cx } from '@/components/ui';
import type { Acquisition, Disposal, RouteLine } from '@/lib/crafts/routes';
import { itemBox, type BoxLimits } from '@/lib/table/item-box';
import { itemGridLink, type SellItem } from '@/lib/tarkovdev/client';

import { FIGURE } from './craft-format';

/**
 * The cell that draws what goes in and what comes out.
 *
 * Shared by the crafts and barters tables, which ask the same thing of it: a row of stash
 * cells, a chevron, and the product. It knows nothing about either row type — a craft's
 * ingredients and a barter's required items are both just `RouteLine`s by the time they
 * reach here.
 *
 * Each item is drawn at its stash footprint, the way the game's own trade screen does it,
 * so a built gun is a wide flat thing and a LEDX is a little square. `itemBox` works out
 * the pixels; these are the limits it works within, and they are what `ROW_HEIGHT` in both
 * tables is derived from — change them and both constants move.
 *
 * `maxWidth` is six cells, which is the widest footprint anything published has, so nothing
 * is ever scaled down for being wide. It was three, and every gun in the game is four to six
 * — so the one item the footprint mattered most for was the one always drawn at half scale,
 * which is the opposite of the point. Across is the dimension a table has to spare: the
 * median row is 172px of boxes in a 436px column, and the 19 barters and 28 crafts that
 * overflow clip, the same as they did before.
 *
 * `maxHeight` is two cells and does still scale, because down is the dimension a row has
 * none of. Guns are all two cells tall, so they are unaffected; a 6×6 case is not.
 */
export const BOX_LIMITS: BoxLimits = { maxUnit: 46, maxHeight: 92, maxWidth: 46 * 6 };

/**
 * The whole stack: name, gap, box, gap, count.
 *
 * Both tables' `ROW_HEIGHT` is built on this, and the windowing needs it exact — the name
 * and the count carry an explicit `leading` for that reason, since text left to its own
 * line height is a browser's guess rather than a number. The name's three lines are
 * reserved whether it uses them or not, so every box in a row sits at the same height
 * however long the names above them are.
 */
const LINE_HEIGHT = 12;
const LABEL_LINES = 3;
const LABEL_HEIGHT = LINE_HEIGHT * LABEL_LINES;
const GAP = 4;
export const PROCESS_HEIGHT = BOX_LIMITS.maxHeight + LABEL_HEIGHT + LINE_HEIGHT + 2 * GAP;

/**
 * The narrowest an item's column may be, whatever its footprint.
 *
 * A one-cell item is 46px, and 46px of 10px type is about seven characters — so the names
 * were "Silver Ba…" and "Dorm ro…" on a row with half its width empty. At 70px over three
 * lines, 83% of every name the barters and crafts documents use is shown whole, and the
 * rows that overflow their column and clip go from 19 to 10 of 806 barters and 29 to 18 of
 * 214 crafts, because the process columns were widened to pay for it. Measured, both of
 * those: a wider minimum reads better on the median row and costs more than it is worth on
 * the long ones — 86px buys six more points of whole names for twice the clipped crafts.
 */
export const MIN_LABEL_WIDTH = 70;

/** The barter or craft an item in the process cell goes through, for its corner tag. */
export interface Trade {
    kind: 'barter' | 'craft';
    where: string;
    locked: boolean;
    /** Whether the item is got by the trade, or got rid of by it. */
    side: 'in' | 'out';
}

export const tradeIn = (unit: Acquisition | null): Trade | null =>
    unit?.step ? { kind: unit.step.kind, where: unit.step.where, locked: unit.locked, side: 'in' } : null;

export const tradeOut = (sale: Disposal | null): Trade | null =>
    sale?.step ? { kind: sale.step.kind, where: sale.step.where, locked: sale.locked, side: 'out' } : null;

function tradeTitle(trade: Trade): string {
    const how =
        trade.side === 'in'
            ? trade.kind === 'barter'
                ? `bartered for at ${trade.where}`
                : `crafted at the ${trade.where}`
            : trade.kind === 'barter'
              ? `traded on at ${trade.where}`
              : `crafted on at the ${trade.where}`;
    return trade.locked ? `${how}, through a route you cannot take yet` : how;
}

/**
 * One item in the process cell: its name, its icon in its own stash footprint, and how many.
 *
 * The name sits above rather than beside, which is what lets six of these fit across the
 * column and still be read at a glance. It takes the box's width, so a wide gun gets a wide
 * name and a one-cell item truncates — the alternative, a fixed width for every name, either
 * wastes the gun's room or pushes the arrow and the product off the end.
 *
 * A tool is told apart by the word under its box rather than by a coloured border, since
 * there is no border left to colour.
 */
export function ProcessItem({
    item,
    fallbackName,
    count,
    tool,
    trade,
}: {
    item: SellItem | null;
    fallbackName: string;
    count: number;
    tool?: boolean;
    /** The barter or craft this item goes through, when its route is one. */
    trade?: Trade | null;
}) {
    const name = item?.name ?? fallbackName;
    // A tool is shown at ×1 whatever the document says, because you need one and hand it
    // back — "×3 silicone tube" would read as three tubes consumed.
    const quantity = tool ? 1 : count;
    const title = tool ? `${name} (tool, handed back)` : trade ? `${name}, ${tradeTitle(trade)}` : name;
    const box = itemBox(item, BOX_LIMITS);

    return (
        <span
            className='flex shrink-0 flex-col items-center gap-1'
            // Wider than the box for a small item, so the name gets room the row has going
            // spare. The box stays its own size and centres in it.
            style={{ width: Math.max(box.width, MIN_LABEL_WIDTH) }}
            title={title}
        >
            {/* The three lines are reserved, and the name sits on the bottom of them, so a
                one-line name and a three-line one put their boxes at the same height. */}
            <span className='flex w-full items-end justify-center' style={{ height: LABEL_HEIGHT }}>
                <span className='line-clamp-3 text-center text-[10px] leading-[12px] text-bone-dim'>
                    {name}
                </span>
            </span>
            <span
                className={cx(
                    // The backdrop stands in while the picture loads — the pictures are
                    // lazy, and without it a scrolled-to row is names and counts with a hole
                    // between them. The loaded art covers it.
                    'relative flex items-center justify-center bg-ground-2/60',
                    // The grid picture carries the game's own cell frame, so a border here
                    // drew a second line just outside the first. Only an item the catalogue
                    // has no picture for gets one, and then it is all there is to see.
                    !item && 'border border-line',
                )}
                style={{ width: box.width, height: box.height }}
            >
                {item ? (
                    // The grid picture, not the icon. The icon is 64×64 for everything, so in
                    // a box the shape of a rifle's footprint `object-contain` drew it as a
                    // small square adrift in the middle — which is what this whole cell was
                    // meant to stop. The grid picture carries the footprint's own ratio and
                    // fills it. See `itemGridLink`.
                    <ItemIcon src={itemGridLink(item)} width={box.width - 2} height={box.height - 2} />
                ) : null}
                {/* A corner tag rather than a line of text, since the column has no room for
                    one: the route is the breakdown's to explain, and the row only has to say
                    that this item is not simply bought or sold. */}
                {trade ? (
                    <span
                        aria-hidden
                        className={cx(
                            'stencil absolute -top-1.5 -right-1.5 border bg-panel px-[3px] text-[8px] leading-[12px]',
                            trade.locked ? 'border-rust/60 text-rust' : 'border-amber/50 text-amber',
                        )}
                    >
                        {trade.kind === 'barter' ? 'B' : 'C'}
                    </span>
                ) : null}
            </span>
            <span className={cx(FIGURE, 'text-[10px] leading-[12px]', tool ? 'text-steel' : 'text-muted')}>
                {tool ? 'tool' : `×${quantity % 1 === 0 ? quantity : quantity.toFixed(2)}`}
            </span>
        </span>
    );
}

/**
 * The arrow between what goes in and what comes out.
 *
 * Built as an item column with the name and the count left empty, rather than simply
 * centred in the row. Centring put it 12px high on every row: the stack is asymmetric —
 * three lines of name above the box and one of count below — so the boxes all centre 12px
 * lower than the row does. Matching the stack makes it line up by construction, and go on
 * doing so if either label ever changes height.
 */
function Chevron() {
    return (
        <span aria-hidden className='flex shrink-0 flex-col items-center gap-1'>
            <span style={{ height: LABEL_HEIGHT }} />
            <span
                className='data flex items-center px-1 text-[16px] text-line-bright'
                style={{ height: BOX_LIMITS.maxHeight }}
            >
                ❯
            </span>
            <span style={{ height: LINE_HEIGHT }} />
        </span>
    );
}

export function Process({
    lines,
    product,
    productName,
    productCount,
    productTrade,
}: {
    lines: readonly RouteLine[];
    product: SellItem | null;
    productName: string;
    productCount: number;
    productTrade?: Trade | null;
}) {
    return (
        // Centred rather than bottom-aligned: the boxes are all different heights, and a
        // shelf line under them left every name floating at a height of its own.
        <div className='flex items-center gap-2'>
            {lines.map((line, i) => (
                <ProcessItem
                    // Indexed: a craft can ask for the same item twice, once as a tool.
                    key={`${line.itemId}-${i}`}
                    item={line.item}
                    fallbackName={line.itemId}
                    count={line.count}
                    tool={line.tool}
                    trade={tradeIn(line.unit)}
                />
            ))}
            <Chevron />
            <ProcessItem
                item={product}
                fallbackName={productName}
                count={productCount}
                trade={productTrade}
            />
        </div>
    );
}
