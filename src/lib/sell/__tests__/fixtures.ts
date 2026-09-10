/**
 * Fixture builders for the sell modules.
 *
 * Shared rather than repeated per suite because `SellItem` grows: three test files each
 * kept their own literal and every new field broke all three at once, which says nothing
 * about the change and takes three edits to silence.
 */

import type { FleaMarketRates, SellIndex, SellItem, TraderOffer } from "@/lib/tarkovdev/client";

/** Rates that charge nothing, so a test only pays the fee when it asks to. */
export const NO_FEE: FleaMarketRates = { sellOfferFeeRate: 0, sellRequirementFeeRate: 0 };

/** The live rates at time of writing, for tests that care what a listing actually costs. */
export const LIVE_FEE: FleaMarketRates = { sellOfferFeeRate: 0.05, sellRequirementFeeRate: 0.05 };

export function offer(overrides: Partial<TraderOffer> = {}): TraderOffer {
  return {
    traderId: "prapor",
    priceRUB: 1000,
    price: 1000,
    currency: "RUB",
    minTraderLevel: null,
    taskUnlock: null,
    ...overrides,
  };
}

export function item(id: string, overrides: Partial<SellItem> = {}): SellItem {
  return {
    id,
    name: id,
    shortName: null,
    normalizedName: id,
    width: 1,
    height: 1,
    noFlea: false,
    minLevelForFlea: 0,
    avg24hPrice: null,
    lastLowPrice: null,
    basePrice: null,
    bestTrader: null,
    buyFrom: null,
    types: [],
    categories: [],
    handbook: [],
    wikiLink: null,
    ...overrides,
  };
}

export function index(items: readonly SellItem[], overrides: Partial<SellIndex> = {}): SellIndex {
  return {
    mode: "regular",
    fetchedAt: 0,
    items: Object.fromEntries(items.map((each) => [each.id, each])),
    fleaMarket: NO_FEE,
    ...overrides,
  };
}
