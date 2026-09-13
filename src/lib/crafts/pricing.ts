/**
 * What an item costs to get hold of, and what it clears when you let it go.
 *
 * The flea tab asks a narrower version of this — it only ever quotes the cheapest offer
 * and the best one — because it is describing an item. A craft is a trade, so both ends
 * have to answer the question the reader is actually asking: what will *I* pay, at *my*
 * loyalty, and what will *I* get, after the flea has taken its cut.
 *
 * Everything here returns null rather than a zero when there is no price to be had. A
 * craft with one unpriceable ingredient has no honest profit figure, and a zero would
 * quietly turn that into the most profitable row on the table.
 */

import { fleaMarketFee } from "@/lib/sell/fee";
import { namedOffer, type NamedOffer } from "@/lib/sell/verdict";
import type { FleaMarketRates, SellItem, TraderOffer } from "@/lib/tarkovdev/client";

/**
 * The four ways an item changes hands, on either side of a craft.
 *
 * The same four for buying and for selling, so one set of toggles reads the same way at
 * both ends. Only the first two are markets; the other two are trades that need items of
 * their own, and are worked out in ./routes.ts on top of what this module quotes.
 */
export type RouteKind = "flea" | "trader" | "barter" | "craft";

export const ROUTE_KINDS: readonly RouteKind[] = ["flea", "trader", "barter", "craft"];

/**
 * The two that end a chain.
 *
 * A barter or a craft is paid for in items, and those items have to come from somewhere
 * that takes money, so a set with neither of these prices nothing at all.
 */
export const MARKET_KINDS: readonly RouteKind[] = ["flea", "trader"];

/**
 * Which flea figure stands in for "the price".
 *
 * The 24 hour average is the steadier of the two and the one the flea tab already shows.
 * The last low is what the market is asking right now, which is the better guide when you
 * are about to go and buy, and the noisier one when you are comparing 213 crafts.
 */
export type FleaBasis = "avg24h" | "lastLow";

/**
 * The loyalty level to assume for a trader nobody has recorded.
 *
 * One rather than four: every trader starts here, so it understates what you can reach
 * instead of promising a price behind a standing you may not have.
 */
const UNRECORDED_LOYALTY = 1;

/** The rates and character facts every row on the crafts table shares. */
export interface MarketContext {
  rates: FleaMarketRates;
  traderNames: ReadonlyMap<string, string>;
  /**
   * Recorded loyalty by trader id, or null to ignore loyalty and take the cheapest offer
   * whatever it needs.
   */
  traderLevels: Readonly<Record<string, number>> | null;
  basis: FleaBasis;
  /** Level 3 is the only one that discounts the listing fee. */
  intelligenceCenter?: number;
  /** Deepens that discount. Zero unless the reader has typed their skill level. */
  hideoutManagement?: number;
}

/** What a market charges for one of an item. */
export interface BuyQuote {
  from: "flea" | "trader";
  priceRUB: number;
  /** The trader offer this came from, when it came from a trader. */
  offer: NamedOffer | null;
}

/** What a market pays for one of an item. */
export interface SellQuote {
  to: "flea" | "trader";
  /** What you ask, before the flea takes anything. */
  priceRUB: number;
  /** The listing fee. Zero at a trader, who charges nothing to take your loot. */
  fee: number;
  /** What actually lands: `priceRUB` less `fee`. */
  net: number;
  offer: NamedOffer | null;
}

/**
 * The flea figure for one item, on the chosen basis.
 *
 * Each basis falls back to the other rather than to nothing: an item traded once last
 * week has a last low and no average, and refusing to price it would drop a whole craft
 * over a figure that is merely stale.
 */
export function fleaPrice(item: SellItem, basis: FleaBasis): number | null {
  // A restricted item can still carry an average from before it was restricted, and that
  // number is not a price anyone can pay.
  if (item.noFlea) return null;
  const pair =
    basis === "lastLow"
      ? [item.lastLowPrice, item.avg24hPrice]
      : [item.avg24hPrice, item.lastLowPrice];
  return pair.find((each): each is number => typeof each === "number" && each > 0) ?? null;
}

/**
 * The cheapest trader offer you could actually take.
 *
 * `buyOffers` arrives cheapest first, so the first one within reach is the answer and
 * there is nothing to compare. A task-gated offer is not skipped — the task may well be
 * done, the app cannot always tell, and the row labels the gate so the reader can.
 */
export function reachableOffer(
  item: SellItem,
  traderLevels: Readonly<Record<string, number>> | null,
): TraderOffer | null {
  for (const offer of item.buyOffers) {
    if (traderLevels === null) return offer;
    const needed = offer.minTraderLevel ?? 1;
    if (needed <= (traderLevels[offer.traderId] ?? UNRECORDED_LOYALTY)) return offer;
  }
  return null;
}

/**
 * What one of an item costs, from the cheaper of the markets in `sources`.
 *
 * Barter and craft in the set are ignored here rather than refused: they are routes, not
 * markets, and ./routes.ts weighs them against whatever this returns.
 */
export function buyPrice(
  item: SellItem,
  sources: ReadonlySet<RouteKind>,
  context: MarketContext,
): BuyQuote | null {
  const flea = sources.has("flea") ? fleaPrice(item, context.basis) : null;
  const offer = sources.has("trader") ? reachableOffer(item, context.traderLevels) : null;

  if (offer && (flea === null || offer.priceRUB <= flea)) {
    return {
      from: "trader",
      priceRUB: offer.priceRUB,
      offer: namedOffer(offer, context.traderNames),
    };
  }
  if (flea !== null) return { from: "flea", priceRUB: flea, offer: null };
  return null;
}

/** Listing the item, and what the fee leaves of it. */
function listing(item: SellItem, context: MarketContext): SellQuote | null {
  const price = fleaPrice(item, context.basis);
  if (price === null) return null;
  const fee = fleaMarketFee(item.basePrice, price, context.rates, {
    intelligenceCenter: context.intelligenceCenter,
    hideoutManagement: context.hideoutManagement,
  });
  return { to: "flea", priceRUB: price, fee, net: price - fee, offer: null };
}

/** Vendoring the item, which costs nothing to do. */
function vendoring(item: SellItem, context: MarketContext): SellQuote | null {
  if (!item.bestTrader) return null;
  return {
    to: "trader",
    priceRUB: item.bestTrader.priceRUB,
    fee: 0,
    net: item.bestTrader.priceRUB,
    offer: namedOffer(item.bestTrader, context.traderNames),
  };
}

/**
 * What one of an item clears, sold to whichever market in `sinks` leaves more.
 *
 * The two are compared on what lands rather than on what is asked, which is the whole
 * point of carrying the fee: a listing that beats the trader on the sticker often loses
 * once the flea has taken its cut, and that is exactly the case a crafts table exists to
 * catch.
 */
export function sellPrice(
  item: SellItem,
  sinks: ReadonlySet<RouteKind>,
  context: MarketContext,
): SellQuote | null {
  const flea = sinks.has("flea") ? listing(item, context) : null;
  const trader = sinks.has("trader") ? vendoring(item, context) : null;

  if (flea && trader) return flea.net >= trader.net ? flea : trader;
  return flea ?? trader;
}
