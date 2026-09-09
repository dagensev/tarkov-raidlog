/**
 * The sell check's filters and orderings.
 *
 * Every one of them narrows. The default view is the widest net there is — not-started
 * tasks in, unknown hideout levels treated as needed, barters and crafts included — so a
 * reader who does nothing sees everything and only a deliberate choice makes the list
 * shorter.
 */

import type { KeepKind } from "./keep-list";
import type { SellRow } from "./verdict";

/**
 * Two shapes of filter in one list.
 *
 * `hard` and `soft` cut by verdict — what the row concludes. The kind filters cut by
 * what an item is used for, whatever else also wants it, which is why they are labelled
 * "Uses:" and read differently: an item a barter wants can still be a must-keep.
 */
export type SellFilter = "all" | "hard" | "soft" | KeepKind;

export const SELL_FILTERS: ReadonlyArray<{ id: SellFilter; label: string; title: string }> = [
  { id: "all", label: "Everything", title: "Every item something still wants" },
  { id: "hard", label: "Must keep", title: "Wanted by a task or a hideout upgrade" },
  {
    id: "soft",
    label: "Barter/craft",
    title: "Only a barter or a craft wants it, so it is yours to sell",
  },
  { id: "task", label: "Uses: task", title: "A task wants it, whatever else does too" },
  { id: "hideout", label: "Uses: hideout", title: "An upgrade wants it, whatever else does too" },
  { id: "barter", label: "Uses: barter", title: "Spent on a trader barter" },
  { id: "craft", label: "Uses: craft", title: "Spent on a hideout craft" },
];

/**
 * Orderings.
 *
 * The verdict ordering comes in both directions because the page answers two questions
 * with one list: "what can I sell" wants the barter and craft rows first, "what must I
 * not touch" wants the keeps.
 */
export type SellSort = "tier-desc" | "tier-asc" | "flea" | "trader" | "name";

export const SELL_SORTS: ReadonlyArray<{ id: SellSort; label: string; title: string }> = [
  {
    id: "tier-desc",
    label: "Barter/craft first",
    title: "Descending by verdict: sellable first, must-keep last",
  },
  {
    id: "tier-asc",
    label: "Keep first",
    title: "Ascending by verdict: must-keep first, sellable last",
  },
  { id: "flea", label: "Flea value", title: "Highest 24h flea average first" },
  { id: "trader", label: "Trader value", title: "Best trader offer first" },
  { id: "name", label: "By name", title: "Alphabetical" },
];

export interface SellView {
  query: string;
  filter: SellFilter;
  sort: SellSort;
  /** Hide what cannot be listed on the flea at all. */
  hideNoFlea: boolean;
}

export const DEFAULT_SELL_VIEW: SellView = {
  query: "",
  filter: "all",
  // The page's own question first: what is safe to move.
  sort: "tier-desc",
  hideNoFlea: false,
};

function matchesFilter(row: SellRow, filter: SellFilter): boolean {
  if (filter === "all") return true;
  if (!row.keep) return false;
  if (filter === "hard" || filter === "soft") return row.keep.tier === filter;
  return row.keep.reasons.some((reason) => reason.kind === filter);
}

/**
 * @param playerLevel Character level, or null to not filter on it. Items the flea will
 *   not list at that level are dropped, since there is nothing to decide about them yet.
 *   A restricted item is never judged this way: its level requirement is filled in but
 *   meaningless, and the `hideNoFlea` toggle is what governs those.
 */
export function filterRows(
  rows: readonly SellRow[],
  view: SellView,
  playerLevel: number | null = null,
): SellRow[] {
  return rows.filter((row) => {
    if (!matchesFilter(row, view.filter)) return false;
    if (view.hideNoFlea && row.item.noFlea) return false;
    if (
      playerLevel !== null &&
      !row.item.noFlea &&
      row.item.minLevelForFlea > playerLevel
    ) {
      return false;
    }
    return true;
  });
}

/** Must-keep is the heaviest verdict, so it sorts last when the order is descending. */
const TIER_RANK: Record<SellRow["verdict"], number> = {
  keep: 0,
  "think-twice": 1,
  "ok-to-sell": 2,
};

const COMPARE: Record<SellSort, (a: SellRow, b: SellRow) => number> = {
  "tier-asc": (a, b) => TIER_RANK[a.verdict] - TIER_RANK[b.verdict],
  "tier-desc": (a, b) => TIER_RANK[b.verdict] - TIER_RANK[a.verdict],
  flea: (a, b) => (b.flea ?? -1) - (a.flea ?? -1),
  trader: (a, b) => (b.trader?.priceRUB ?? -1) - (a.trader?.priceRUB ?? -1),
  name: () => 0,
};

/** Every ordering falls through to name, so equal rows never shuffle between renders. */
export function sortRows(rows: readonly SellRow[], sort: SellSort): SellRow[] {
  return [...rows].sort(
    (a, b) => COMPARE[sort](a, b) || a.item.name.localeCompare(b.item.name),
  );
}
