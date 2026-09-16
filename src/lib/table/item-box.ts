/**
 * How large to draw one item in a process cell.
 *
 * The calculators used to draw every item in the same square, which made an M4A1 the same
 * shape as a LEDX and lost the one thing the game's own trade screen tells you at a glance:
 * a built gun is a wide flat thing and a medical item is a little square. So a box is its
 * stash footprint — `width` × `height` cells — at a fixed number of pixels per cell.
 *
 * Fixed, because a unit that varied per row would draw the same LEDX large beside a pistol
 * and small beside a weapon case, and the eye reads that as a difference in the item. The
 * one thing that does vary is an item too big for the space: a 6×6 case at the full unit is
 * taller than the row, so those scale down, keeping their proportions, and everything that
 * fits stays exactly the size it is everywhere else — which is nearly all of them.
 *
 * Arithmetic here rather than in the component for the same reason as `./window.ts`: it is
 * fiddly at the edges, and a row a few pixels out of its declared height puts every spacer
 * in the windowed table wrong.
 */

/** An item's stash footprint, in cells. */
export interface GridSize {
  width: number;
  height: number;
}

export interface BoxLimits {
  /** Pixels per stash cell, and the size nearly every item is drawn at. */
  maxUnit: number;
  /** The tallest a box may be drawn. Anything taller scales down to it. */
  maxHeight: number;
  /** The widest a box may be drawn. */
  maxWidth: number;
}

export interface Box {
  width: number;
  height: number;
  /** Pixels per cell this box settled on, at or below `maxUnit`. */
  unit: number;
}

/**
 * Below this a box is a smudge rather than a picture, so an absurd footprint clips instead
 * of shrinking away. Nothing published reaches it — the largest case in the game is 6×6.
 */
const MIN_UNIT = 10;

/** A missing item is drawn as one cell: the row still has a name and a count to show. */
export function itemBox(size: GridSize | null, limits: BoxLimits): Box {
  const cellsWide = Math.max(1, Math.round(size?.width ?? 1));
  const cellsTall = Math.max(1, Math.round(size?.height ?? 1));

  const unit = Math.max(
    MIN_UNIT,
    Math.floor(
      Math.min(limits.maxUnit, limits.maxHeight / cellsTall, limits.maxWidth / cellsWide),
    ),
  );

  return { width: unit * cellsWide, height: unit * cellsTall, unit };
}
