/**
 * What the flea market takes out of a sale.
 *
 * The formula is the game's, as documented on the wiki and implemented by tarkov.dev's own
 * client. It is not a percentage: the fee climbs steeply as the asking price pulls away
 * from the item's base price in either direction, which is why listing a cheap item for a
 * fortune costs more than the item is worth, and why a trader-to-flea flip that looks
 * profitable on the raw prices often is not.
 *
 * The rates come from the catalogue rather than from a constant here. tarkov.dev's client
 * still defaults them to 0.03 and the live document has said 0.05 for some time.
 */

import type { FleaMarketRates } from "@/lib/tarkovdev/client";

export interface FeeOptions {
  /** Stack size. Only ammo and money list in stacks, and the page never does. */
  count?: number;
  /**
   * Intelligence Center level, from the reader's recorded hideout.
   *
   * Level 3 is the only one that does anything; below it there is no discount at all. An
   * unrecorded station reads as 0, which overstates the fee rather than the profit.
   */
  intelligenceCenter?: number;
  /**
   * Hideout Management skill level, which deepens the Intelligence Center discount.
   *
   * Fixed at 0 by every caller: it is a character skill and nothing in the app or in
   * tarkov.dev's data knows what yours is. Guessing high would flatter the profit columns.
   */
  hideoutManagement?: number;
}

/**
 * The fee on listing one item at `sellPrice`, in roubles.
 *
 * `basePrice` is the item's handbook value, which is what the game charges against — not
 * its flea price. An item with no base price cannot be charged for, so the fee is zero.
 */
export function fleaMarketFee(
  basePrice: number | null,
  sellPrice: number | null,
  rates: FleaMarketRates,
  options: FeeOptions = {},
): number {
  if (!basePrice || !sellPrice || basePrice <= 0 || sellPrice <= 0) return 0;

  const count = options.count ?? 1;
  const intelligenceCenter = options.intelligenceCenter ?? 0;
  const hideoutManagement = options.hideoutManagement ?? 0;

  // The two exponents are each raised on the side of parity they belong to, so the curve
  // is steeper the further the asking price sits from the base price.
  let offer = Math.log10(basePrice / sellPrice);
  let requirement = Math.log10(sellPrice / basePrice);
  if (sellPrice < basePrice) offer = Math.pow(offer, 1.08);
  else requirement = Math.pow(requirement, 1.08);

  const discount =
    intelligenceCenter >= 3 ? 1 - (0.01 * hideoutManagement + 1) * 0.3 : 1;

  const raw =
    basePrice * rates.sellOfferFeeRate * Math.pow(4, offer) * count +
    sellPrice * rates.sellRequirementFeeRate * Math.pow(4, requirement) * count;

  // Rounded before the discount, matching the game and tarkov.dev.
  return Math.ceil(raw) * discount;
}

/** What a listing actually clears: the asking price less the fee. */
export function netOfFee(
  basePrice: number | null,
  sellPrice: number | null,
  rates: FleaMarketRates,
  options: FeeOptions = {},
): number | null {
  if (sellPrice === null) return null;
  return sellPrice - fleaMarketFee(basePrice, sellPrice, rates, options);
}
