/**
 * Fixture builders for the crafts modules.
 *
 * `SellItem` and its offers come from the sell suite's builders rather than a second copy
 * here — the two tables read the same catalogue, and two literals of the same growing
 * type is exactly the duplication that file was written to stop.
 */

import { NO_FEE } from "@/lib/sell/__tests__/fixtures";
import type { FleaMarketRates } from "@/lib/tarkovdev/client";
import type { Craft, HideoutStation, ItemRequirement } from "@/lib/tarkovdev/economy";

import type { MarketContext } from "../pricing";

export { LIVE_FEE, NO_FEE, index, item, offer } from "@/lib/sell/__tests__/fixtures";

export function line(
  itemId: string,
  exactCount = 1,
  extra: Partial<Pick<ItemRequirement, "foundInRaid" | "tool">> = {},
): ItemRequirement {
  return {
    itemId,
    count: Math.max(1, Math.ceil(exactCount)),
    exactCount,
    foundInRaid: extra.foundInRaid ?? false,
    tool: extra.tool ?? false,
  };
}

export function craft(overrides: Partial<Craft> = {}): Craft {
  return {
    id: "c1",
    stationId: "workbench",
    level: 1,
    requiredItems: [line("sugar", 2)],
    productItem: { itemId: "moonshine", count: 1 },
    durationSeconds: 3600,
    taskUnlock: null,
    gameEditions: [],
    ...overrides,
  };
}

export function station(
  id: string,
  overrides: Partial<HideoutStation> = {},
): HideoutStation {
  return {
    id,
    name: id,
    normalizedName: id,
    levels: [{ level: 1, requirements: [] }],
    imageLink: null,
    ...overrides,
  };
}

/** A context that charges no fee and knows no loyalty, so a test only opts into either. */
export function market(overrides: Partial<MarketContext> = {}): MarketContext {
  const rates: FleaMarketRates = overrides.rates ?? NO_FEE;
  return {
    rates,
    traderNames: new Map(),
    traderLevels: null,
    basis: "avg24h",
    ...overrides,
  };
}
