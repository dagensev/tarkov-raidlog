/**
 * The crafts table's filters and orderings.
 *
 * Same rules as the flea tab's: every control narrows, an empty selection narrows
 * nothing, and picking several inside one group widens while picking across groups
 * narrows. A reader who touches nothing sees all 213 crafts.
 */

import type { CraftRow } from "./craft-row";

export type CraftSortKey = "station" | "craft" | "time" | "profit" | "profitPerHour";

export interface CraftView {
  query: string;
  /** Station ids. Empty means every station. */
  stations: string[];
  /** Station levels a craft may require. Empty means every level. */
  levels: number[];
  /** Hide crafts the recorded hideout cannot run yet. */
  runnableOnly: boolean;
  hideTaskLocked: boolean;
  sort: CraftSortKey;
  descending: boolean;
}

export const DEFAULT_CRAFT_VIEW: CraftView = {
  query: "",
  stations: [],
  levels: [],
  runnableOnly: false,
  hideTaskLocked: false,
  // The table's own question: what is worth the station slot it occupies.
  sort: "profitPerHour",
  descending: true,
};

/** The levels any craft asks for. Fixed rather than derived: no station goes past three. */
export const CRAFT_LEVELS: readonly number[] = [1, 2, 3];

/**
 * Whether a row matches a typed query.
 *
 * Matched against the product and every ingredient, not just the product, because half of
 * what anyone types into this box is "what can I do with the sugar I keep finding".
 */
function matchesQuery(row: CraftRow, needle: string): boolean {
  if (row.productName.toLowerCase().includes(needle)) return true;
  if (row.stationName.toLowerCase().includes(needle)) return true;
  return row.lines.some((line) => (line.item?.name ?? "").toLowerCase().includes(needle));
}

export function filterCraftRows(rows: readonly CraftRow[], view: CraftView): CraftRow[] {
  const needle = view.query.trim().toLowerCase();

  return rows.filter((row) => {
    if (view.stations.length > 0 && !view.stations.includes(row.craft.stationId)) return false;
    if (view.levels.length > 0 && !view.levels.includes(row.craft.level)) return false;
    if (view.runnableOnly && !row.runnable) return false;
    if (view.hideTaskLocked && row.taskLocked) return false;
    if (needle && !matchesQuery(row, needle)) return false;
    return true;
  });
}

/**
 * What each ordering reads off a row, ascending.
 *
 * Null means "no figure", and a null sinks to the bottom whichever way the column points.
 * A craft with an ingredient nobody sells is not the worst flip on the board — it is one
 * the table has nothing to say about, and floating it either way would be a claim.
 */
const VALUE: Record<Exclude<CraftSortKey, "station" | "craft">, (row: CraftRow) => number | null> =
  {
    // The whole chain, since that is how long the plan the row describes keeps you waiting.
    time: (row) => row.totalSeconds,
    profit: (row) => row.profit,
    profitPerHour: (row) => row.profitPerHour,
  };

/** Two rows the same on their column fall back to this, so nothing shuffles per render. */
function byName(a: CraftRow, b: CraftRow): number {
  return a.productName.localeCompare(b.productName) || a.craft.id.localeCompare(b.craft.id);
}

export function sortCraftRows(rows: readonly CraftRow[], view: CraftView): CraftRow[] {
  const direction = view.descending ? -1 : 1;

  if (view.sort === "craft") {
    return [...rows].sort((a, b) => direction * byName(a, b));
  }
  if (view.sort === "station") {
    return [...rows].sort(
      (a, b) =>
        direction * (a.stationName.localeCompare(b.stationName) || a.craft.level - b.craft.level) ||
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
 * A new column opens on the direction that answers its question first: money and rates
 * read high-first, while a name and a duration read low-first — the fastest craft is the
 * interesting end of "craft time", not the slowest.
 */
export function nextCraftSort(
  view: CraftView,
  sort: CraftSortKey,
): Pick<CraftView, "sort" | "descending"> {
  if (view.sort !== sort) {
    return { sort, descending: sort !== "craft" && sort !== "station" && sort !== "time" };
  }
  return { sort, descending: !view.descending };
}
