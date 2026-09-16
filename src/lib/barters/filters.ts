/**
 * The barters table's filters and orderings.
 *
 * Same rules as the crafts and flea tabs': every control narrows, an empty selection narrows
 * nothing, and picking several inside one group widens while picking across groups narrows.
 * A reader who touches nothing sees all 806 barters.
 */

import type { BarterRow } from "./barter-row";

export type BarterSortKey = "trader" | "barter" | "cost" | "savings" | "resell" | "limit";

export interface BarterView {
  query: string;
  /** Trader ids. Empty means every trader. */
  traders: string[];
  /** Loyalty levels a barter may ask for. Empty means every level. */
  levels: number[];
  /** Hide barters the recorded loyalty or the logs say you cannot make yet. */
  runnableOnly: boolean;
  hideTaskLocked: boolean;
  sort: BarterSortKey;
  descending: boolean;
}

export const DEFAULT_BARTER_VIEW: BarterView = {
  query: "",
  traders: [],
  levels: [],
  runnableOnly: false,
  hideTaskLocked: false,
  // The table's own question: which trade is worth making, which is what it saves you
  // against buying the thing — not what it would fetch resold, which is a different tab's
  // sort of question and mostly a negative number.
  sort: "savings",
  descending: true,
};

/** The loyalty levels any barter asks for. Fixed rather than derived: none goes past four. */
export const BARTER_LEVELS: readonly number[] = [1, 2, 3, 4];

/**
 * Whether a row matches a typed query.
 *
 * Matched against the product, the trader and every input, not just the product, because
 * half of what anyone types into this box is the name of something already in their stash.
 */
function matchesQuery(row: BarterRow, needle: string): boolean {
  if (row.productName.toLowerCase().includes(needle)) return true;
  if (row.traderName.toLowerCase().includes(needle)) return true;
  return row.lines.some((line) => (line.item?.name ?? "").toLowerCase().includes(needle));
}

export function filterBarterRows(rows: readonly BarterRow[], view: BarterView): BarterRow[] {
  const needle = view.query.trim().toLowerCase();

  return rows.filter((row) => {
    if (view.traders.length > 0 && !view.traders.includes(row.traderId)) return false;
    if (view.levels.length > 0 && !view.levels.includes(row.minLevel)) return false;
    if (view.runnableOnly && !row.runnable) return false;
    if (view.hideTaskLocked && row.taskLocked) return false;
    if (needle && !matchesQuery(row, needle)) return false;
    return true;
  });
}

/**
 * What each ordering reads off a row, ascending.
 *
 * Null means "no figure", and a null sinks to the bottom whichever way the column points. A
 * barter wanting an item nobody sells is not the worst trade on the board — it is one the
 * table has nothing to say about, and floating it either way would be a claim.
 */
const VALUE: Record<
  Exclude<BarterSortKey, "trader" | "barter">,
  (row: BarterRow) => number | null
> = {
  cost: (row) => row.cost,
  savings: (row) => row.savings,
  resell: (row) => row.resell,
  limit: (row) => row.limit,
};

/** Two rows the same on their column fall back to this, so nothing shuffles per render. */
function byName(a: BarterRow, b: BarterRow): number {
  return a.productName.localeCompare(b.productName) || a.barter.id.localeCompare(b.barter.id);
}

export function sortBarterRows(rows: readonly BarterRow[], view: BarterView): BarterRow[] {
  const direction = view.descending ? -1 : 1;

  if (view.sort === "barter") {
    return [...rows].sort((a, b) => direction * byName(a, b));
  }
  if (view.sort === "trader") {
    return [...rows].sort(
      (a, b) =>
        direction * (a.traderName.localeCompare(b.traderName) || a.minLevel - b.minLevel) ||
        byName(a, b),
    );
  }

  const value = VALUE[view.sort];
  return [...rows].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (left === null && right === null) return byName(a, b);
    if (left === null) return 1;
    if (right === null) return -1;
    return direction * (left - right) || byName(a, b);
  });
}

/**
 * What clicking a column header does.
 *
 * A new column opens on the direction that answers its question first: what a trade saves,
 * fetches or allows reads high-first, while a name and a price read low-first — the cheap
 * end is the interesting end of "cost", and the dear end says nothing anyone asked.
 */
export function nextBarterSort(
  view: BarterView,
  sort: BarterSortKey,
): Pick<BarterView, "sort" | "descending"> {
  if (view.sort !== sort) {
    return { sort, descending: sort !== "trader" && sort !== "barter" && sort !== "cost" };
  }
  return { sort, descending: !view.descending };
}
