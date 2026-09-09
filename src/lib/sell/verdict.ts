/**
 * The keep list plus prices, turned into something a row can render.
 *
 * The verdict is a summary of the reasons, never a judgement of its own: `ok-to-sell`
 * means nothing in the loaded data wants the item, which is narrower than it sounds.
 * What the page cannot see — your stash, your kit, category-shaped build requirements —
 * is listed beside the table, because getting this wrong costs money that does not come
 * back.
 */

import type { SellIndex, SellItem } from "@/lib/tarkovdev/client";

import type { KeepEntry, KeepList } from "./keep-list";

export type Verdict = "keep" | "think-twice" | "ok-to-sell";

export interface SellRow {
  item: SellItem;
  verdict: Verdict;
  keep: KeepEntry | null;
  /** 24h flea average, or null for an item that cannot be listed or has no trades. */
  flea: number | null;
  trader: { traderId: string; traderName: string; priceRUB: number } | null;
  /**
   * Flea minus trader, before the listing fee. Positive means the flea is worth the wait,
   * by roughly this much.
   */
  edge: number | null;
}

export function verdictFor(entry: KeepEntry | undefined | null): Verdict {
  if (!entry) return "ok-to-sell";
  return entry.tier === "hard" ? "keep" : "think-twice";
}

/** What a listing would fetch, or null when there is no listing to make. */
function fleaPrice(item: SellItem): number | null {
  // A `noFlea` item can still carry a stale average from before it was restricted.
  if (item.noFlea) return null;
  return item.avg24hPrice ?? item.lastLowPrice ?? null;
}

export function sellRow(
  item: SellItem,
  entry: KeepEntry | undefined | null,
  traderNames: ReadonlyMap<string, string> = new Map(),
): SellRow {
  const flea = fleaPrice(item);
  const trader = item.bestTrader
    ? {
        traderId: item.bestTrader.traderId,
        traderName: traderNames.get(item.bestTrader.traderId) ?? item.bestTrader.traderId,
        priceRUB: item.bestTrader.priceRUB,
      }
    : null;

  return {
    item,
    verdict: verdictFor(entry),
    keep: entry ?? null,
    flea,
    trader,
    edge: flea !== null && trader ? flea - trader.priceRUB : null,
  };
}

/**
 * A row for everything the keep list holds.
 *
 * An id with no entry in the catalogue is dropped rather than rendered as a raw id: it
 * means the two documents disagree, and a row with no name or price helps nobody.
 */
export function keepRows(
  keep: KeepList,
  index: SellIndex,
  traderNames: ReadonlyMap<string, string> = new Map(),
): SellRow[] {
  const rows: SellRow[] = [];
  for (const [itemId, entry] of keep) {
    const item = index.items[itemId];
    if (!item) continue;
    rows.push(sellRow(item, entry, traderNames));
  }
  return rows;
}

/** Rows for a specific set of items, keep-listed or not. What a search renders. */
export function rowsFor(
  items: readonly SellItem[],
  keep: KeepList,
  traderNames: ReadonlyMap<string, string> = new Map(),
): SellRow[] {
  return items.map((item) => sellRow(item, keep.get(item.id), traderNames));
}
