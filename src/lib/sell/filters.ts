/**
 * The flea tab's filters and orderings.
 *
 * Every one of them narrows, and an empty selection narrows nothing, so a reader who does
 * nothing sees the whole catalogue and only a deliberate choice makes the list shorter.
 *
 * Two groups of chip sit side by side and read differently. The category chips say what an
 * item *is*, straight off the handbook; the use chips say what still *wants* it, which is
 * the sell check's own question. Picking several inside one group widens — Keys or Barter —
 * and picking across groups narrows: keys that a task wants, and nothing else.
 */

import type { SellItem } from "@/lib/tarkovdev/client";

import type { KeepKind } from "./keep-list";
import { rank } from "./search";
import type { SellRow } from "./verdict";

/**
 * Two shapes of use filter in one list.
 *
 * `hard` and `soft` cut by verdict — what the row concludes. The kind filters cut by what
 * an item is used for, whatever else also wants it, which is why they are labelled "Uses:"
 * and read differently: an item a barter wants can still be a must-keep.
 */
export type SellFilter = "hard" | "soft" | KeepKind;

export const SELL_FILTERS: ReadonlyArray<{ id: SellFilter; label: string; title: string }> = [
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
 * A category chip and what it matches.
 *
 * Exactly one of the three match fields is set. `handbook` is the top of the in-game
 * handbook tree and covers most of the list; `categories` reaches into tarkov.dev's own
 * finer tree for the few groupings the handbook does not have a root for — cases and
 * magazines both live under Gear and Weapon parts, where nobody would go looking; `types`
 * is for the one grouping that is a tag rather than a category.
 *
 * A static table rather than something derived from the document: chips can then be
 * reworded or reordered without a 16.7 MB re-download, and the app has no i18n anywhere
 * else to inherit names from. `live-api.test.ts` asserts every one of them still matches.
 */
export interface CategoryChip {
  id: string;
  label: string;
  title: string;
  /** Root handbook category normalized names. */
  handbook?: readonly string[];
  /** Item category normalized names, matched anywhere in an item's ancestry. */
  categories?: readonly string[];
  /** tarkov.dev item type tags. */
  types?: readonly string[];
}

export const CATEGORY_CHIPS: readonly CategoryChip[] = [
  { id: "keys", label: "Keys", title: "Mechanical keys and keycards", handbook: ["keys"] },
  { id: "barter", label: "Barter", title: "Barter items", handbook: ["barter-items"] },
  {
    id: "cases",
    label: "Cases",
    title: "Containers you store things in, secure containers included",
    categories: ["common-container", "port-container", "locking-container"],
  },
  { id: "provisions", label: "Provisions", title: "Food and drink", handbook: ["provisions"] },
  { id: "gear", label: "Gear", title: "Armour, rigs, headwear, eyewear and headsets", handbook: ["gear"] },
  { id: "meds", label: "Meds", title: "Medkits, pills, injectors and injury treatment", handbook: ["medication"] },
  { id: "sights", label: "Sights", title: "Scopes, collimators, ironsights and thermals", categories: ["sights"] },
  { id: "suppressors", label: "Suppressors", title: "Silencers", types: ["suppressor"] },
  { id: "weapons", label: "Weapons", title: "Guns, melee and throwables", handbook: ["weapons"] },
  { id: "ammo", label: "Ammo", title: "Rounds and ammo packs", handbook: ["ammo"] },
  { id: "packs", label: "Packs", title: "Backpacks", categories: ["backpack"] },
  { id: "mags", label: "Mags", title: "Magazines", categories: ["magazine", "cylinder-magazine"] },
  {
    id: "tactical",
    label: "Tac. devices",
    title: "Flashlights, lasers and combined tactical devices",
    categories: ["comb-tact-device", "flashlight"],
  },
  { id: "mods", label: "Mods", title: "Everything under weapon parts and mods", handbook: ["weapon-parts-mods"] },
  { id: "special", label: "Special", title: "Special equipment", handbook: ["special-equipment"] },
  { id: "maps", label: "Maps", title: "Paper maps", handbook: ["maps"] },
  { id: "money", label: "Money", title: "Roubles, dollars and euros", handbook: ["money"] },
  { id: "repair", label: "Repair", title: "Repair kits", categories: ["repair-kits"] },
  { id: "quest", label: "Quest", title: "Task items", handbook: ["task-items"] },
  { id: "info", label: "Info", title: "Notes, flyers and audio tapes", handbook: ["info-items"] },
  {
    id: "seasons",
    label: "Seasons",
    title: "Battle Pass documents",
    handbook: ["battle-pass-documents"],
  },
];

const CHIP_BY_ID = new Map(CATEGORY_CHIPS.map((chip) => [chip.id, chip]));

/** Whether an item belongs in one chip. Any one of the chip's names matching is enough. */
export function matchesChip(item: SellItem, chip: CategoryChip): boolean {
  if (chip.handbook?.some((name) => item.handbook.includes(name))) return true;
  if (chip.categories?.some((name) => item.categories.includes(name))) return true;
  if (chip.types?.some((name) => item.types.includes(name))) return true;
  return false;
}

/**
 * Orderings.
 *
 * `tier` comes first because the page's own question is still "what is safe to move", and
 * it is the only ordering whose ascending direction is the interesting one — "what must I
 * not touch" wants the keeps at the top. The rest are money, and money reads high-first.
 */
export type SellSortKey =
  | "tier"
  | "name"
  | "flea"
  | "sellTrader"
  | "buyTrader"
  | "fleaVsTrader";

export interface SellView {
  query: string;
  /** Use chips. Empty means every item, not none. */
  uses: SellFilter[];
  /** Category chip ids. Empty means every category. */
  categories: string[];
  /** Hide what cannot be listed on the flea at all. */
  hideNoFlea: boolean;
  sort: SellSortKey;
  descending: boolean;
}

export const DEFAULT_SELL_VIEW: SellView = {
  query: "",
  uses: [],
  categories: [],
  hideNoFlea: false,
  // The page's own question first: what is safe to move.
  sort: "tier",
  descending: true,
};

/** Add or remove one entry, which is what a chip click means. */
export function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((each) => each !== value) : [...list, value];
}

function matchesUse(row: SellRow, filter: SellFilter): boolean {
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
  const needle = view.query.trim().toLowerCase();
  const chips = view.categories
    .map((id) => CHIP_BY_ID.get(id))
    .filter((chip): chip is CategoryChip => chip !== undefined);

  return rows.filter((row) => {
    // Within a group any one match is enough; across groups every group must match.
    if (view.uses.length > 0 && !view.uses.some((use) => matchesUse(row, use))) return false;
    if (chips.length > 0 && !chips.some((chip) => matchesChip(row.item, chip))) return false;
    if (needle && rank(row.item, needle) < 0) return false;
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

/**
 * What each ordering reads off a row, ascending.
 *
 * A missing figure sorts to the bottom whichever way the column is pointing, which is why
 * it is `null` here rather than a sentinel number: an item no trader stocks has no profit,
 * and floating it to the top of "worst flips" would be a lie about the data.
 */
const VALUE: Record<Exclude<SellSortKey, "name">, (row: SellRow) => number | null> = {
  tier: (row) => TIER_RANK[row.verdict],
  flea: (row) => row.flea,
  sellTrader: (row) => row.trader?.priceRUB ?? null,
  buyTrader: (row) => row.buy?.priceRUB ?? null,
  fleaVsTrader: (row) => row.fleaVsTrader,
};

/**
 * Every ordering falls through to name, so equal rows never shuffle between renders.
 *
 * Rows with nothing to sort on are pushed to the end in both directions rather than being
 * flipped along with everything else.
 */
export function sortRows(rows: readonly SellRow[], view: SellView): SellRow[] {
  const direction = view.descending ? -1 : 1;
  const byName = (a: SellRow, b: SellRow) => a.item.name.localeCompare(b.item.name);
  if (view.sort === "name") {
    return [...rows].sort((a, b) => direction * byName(a, b));
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

/** What clicking a column header does: a new column starts high-first, the same one flips. */
export function nextSort(view: SellView, sort: SellSortKey): Pick<SellView, "sort" | "descending"> {
  if (view.sort !== sort) return { sort, descending: sort !== "name" };
  return { sort, descending: !view.descending };
}
