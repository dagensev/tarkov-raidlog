/**
 * Which rows of a long list are actually worth putting in the DOM.
 *
 * The catalogue is 4835 rows and the sell check used to answer that by refusing to draw
 * past the first 250. Drawing a window instead means the whole table is scrollable and
 * sortable without the browser holding five thousand rows of markup.
 *
 * Pure arithmetic with the component kept thin, the same split `@/lib/maps/viewport` uses
 * for the map overlay: scroll maths is fiddly at the edges and off-by-ones there show up
 * as rows that flicker or vanish, which is far easier to assert than to notice.
 */

/** The one row that can be taller than the rest, because its uses are expanded. */
export interface OpenRow {
  index: number;
  /** Height of the expanded part alone, on top of the row's own `rowHeight`. */
  height: number;
}

export interface RowWindow {
  /** First row to render, inclusive. */
  start: number;
  /** Last row to render, exclusive. */
  end: number;
  /** Spacer above the window, in pixels. */
  padTop: number;
  /** Spacer below it. `padTop + rendered + padBottom` is always the full height. */
  padBottom: number;
  /** Every row's height added up, which is what the scrollbar is sized against. */
  totalHeight: number;
}

export interface WindowInput {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  count: number;
  /** Rows drawn beyond each edge, so a fast scroll does not show blank space. */
  overscan?: number;
  /** The expanded row, when there is one. */
  open?: OpenRow | null;
}

/** The offset of a row's top edge, counting the expanded row if it sits above. */
export function offsetOf(index: number, rowHeight: number, open?: OpenRow | null): number {
  const above = open && open.index < index ? open.height : 0;
  return index * rowHeight + above;
}

/**
 * The index of the row sitting at `offset`.
 *
 * The expanded row is the only one that is not `rowHeight` tall, so the list is three flat
 * stretches: the rows above it, the row itself, and the rows below shifted down by however
 * much it grew. Answering per stretch avoids searching and stays exact at the seams.
 */
export function rowAt(offset: number, rowHeight: number, open?: OpenRow | null): number {
  const at = Math.max(0, offset);
  if (!open) return Math.floor(at / rowHeight);

  const openTop = open.index * rowHeight;
  if (at < openTop) return Math.floor(at / rowHeight);
  if (at < openTop + rowHeight + open.height) return open.index;
  return Math.floor((at - open.height) / rowHeight);
}

/**
 * The rows to render for a given scroll position.
 *
 * The expanded row is handled by shifting everything below it rather than by measuring
 * each row: only one row expands at a time, so one offset covers every case. Its own
 * height is not added when it is itself the row being measured, which is what keeps the
 * top spacer correct while the open row is partly scrolled off.
 */
export function rowWindow({
  scrollTop,
  viewportHeight,
  rowHeight,
  count,
  overscan = 6,
  open = null,
}: WindowInput): RowWindow {
  // An open row that is no longer in the list — filtered away while expanded — must not
  // go on padding the table out by its height.
  const expanded = open && open.index >= 0 && open.index < count ? open : null;
  const totalHeight = Math.max(0, count * rowHeight + (expanded?.height ?? 0));

  if (count <= 0 || rowHeight <= 0) {
    return { start: 0, end: 0, padTop: 0, padBottom: 0, totalHeight };
  }

  const top = Math.max(0, scrollTop);
  const bottom = top + Math.max(0, viewportHeight);

  const start = clamp(rowAt(top, rowHeight, expanded) - overscan, 0, count);
  const end = clamp(rowAt(bottom, rowHeight, expanded) + 1 + overscan, start, count);

  const padTop = offsetOf(start, rowHeight, expanded);
  const rendered = offsetOf(end, rowHeight, expanded) - padTop;

  return {
    start,
    end,
    padTop,
    padBottom: Math.max(0, totalHeight - padTop - rendered),
    totalHeight,
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
