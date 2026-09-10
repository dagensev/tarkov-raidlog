/**
 * The keep list plus prices, turned into something a row can render.
 *
 * The verdict is a summary of the reasons, never a judgement of its own: `ok-to-sell`
 * means nothing in the loaded data wants the item, which is narrower than it sounds.
 * What the page cannot see — your stash, your kit, category-shaped build requirements —
 * is listed beside the table, because getting this wrong costs money that does not come
 * back.
 */

import type { FleaMarketRates, SellIndex, SellItem, TraderOffer } from "@/lib/tarkovdev/client";

import { fleaMarketFee, type FeeOptions } from "./fee";
import type { KeepEntry, KeepList } from "./keep-list";

export type Verdict = "keep" | "think-twice" | "ok-to-sell";

/** A trader offer with its trader named, which is all a row needs beyond the numbers. */
export interface NamedOffer extends TraderOffer {
  traderName: string;
}

export interface SellRow {
  item: SellItem;
  verdict: Verdict;
  keep: KeepEntry | null;
  /** 24h flea average, or null for an item that cannot be listed or has no trades. */
  flea: number | null;
  /** The most a trader pays. Traders buy at any loyalty level, so this is never gated. */
  trader: NamedOffer | null;
  /** The least a trader charges, and the loyalty level that offer needs. */
  buy: NamedOffer | null;
  /** What the flea would take to list it at `flea`. Null when there is nothing to list. */
  fleaFee: number | null;
  /**
   * What listing it on the flea clears over vendoring it: flea price, less the fee, less
   * what the best trader pays.
   *
   * The fee is the whole point of the figure. Before it, the flea wins on almost
   * everything and the column says nothing; after it, a negative reads as "this one is
   * not worth the wait, take the trader's money".
   */
  fleaVsTrader: number | null;
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

/** The rates and hideout facts every row on a page shares. */
export interface PriceContext extends FeeOptions {
  rates: FleaMarketRates;
  traderNames?: ReadonlyMap<string, string>;
}

const NO_RATES: FleaMarketRates = { sellOfferFeeRate: 0, sellRequirementFeeRate: 0 };

function named(
  offer: TraderOffer | null,
  traderNames: ReadonlyMap<string, string>,
): NamedOffer | null {
  if (!offer) return null;
  return { ...offer, traderName: traderNames.get(offer.traderId) ?? offer.traderId };
}

export function sellRow(
  item: SellItem,
  entry: KeepEntry | undefined | null,
  context: PriceContext = { rates: NO_RATES },
): SellRow {
  const traderNames = context.traderNames ?? new Map<string, string>();
  const flea = fleaPrice(item);
  const trader = named(item.bestTrader, traderNames);
  const buy = named(item.buyFrom, traderNames);

  const fleaFee =
    flea === null ? null : fleaMarketFee(item.basePrice, flea, context.rates, context);

  return {
    item,
    verdict: verdictFor(entry),
    keep: entry ?? null,
    flea,
    trader,
    buy,
    fleaFee,
    fleaVsTrader:
      flea !== null && fleaFee !== null && trader ? flea - fleaFee - trader.priceRUB : null,
  };
}

/**
 * A row for everything the keep list holds.
 *
 * An id with no entry in the catalogue is dropped rather than rendered as a raw id: it
 * means the two documents disagree, and a row with no name or price helps nobody.
 */
export function keepRows(keep: KeepList, index: SellIndex, context: PriceContext): SellRow[] {
  const rows: SellRow[] = [];
  for (const [itemId, entry] of keep) {
    const item = index.items[itemId];
    if (!item) continue;
    rows.push(sellRow(item, entry, context));
  }
  return rows;
}

/** Rows for a specific set of items, keep-listed or not. */
export function rowsFor(
  items: readonly SellItem[],
  keep: KeepList,
  context: PriceContext,
): SellRow[] {
  return items.map((item) => sellRow(item, keep.get(item.id), context));
}

/**
 * A row for every item in the catalogue.
 *
 * The flea tab's row source. Most of these are wanted by nothing, which is the point —
 * the sell check only ever showed the keep list, and an item you cannot see is an item you
 * cannot price.
 */
export function catalogueRows(index: SellIndex, keep: KeepList, context: PriceContext): SellRow[] {
  return rowsFor(Object.values(index.items), keep, context);
}
