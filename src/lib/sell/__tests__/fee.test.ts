import { describe, expect, it } from "vitest";

import { fleaMarketFee, netOfFee } from "../fee";
import { LIVE_FEE } from "./fixtures";

/** The formula, written out separately so a test failure says which one of us is wrong. */
function expected(basePrice: number, sellPrice: number, rate = 0.05, count = 1): number {
  let offer = Math.log10(basePrice / sellPrice);
  let requirement = Math.log10(sellPrice / basePrice);
  if (sellPrice < basePrice) offer = Math.pow(offer, 1.08);
  else requirement = Math.pow(requirement, 1.08);
  return Math.ceil(
    basePrice * rate * Math.pow(4, offer) * count +
      sellPrice * rate * Math.pow(4, requirement) * count,
  );
}

describe("fleaMarketFee", () => {
  it("charges both halves of the formula when the ask matches the base price", () => {
    // Both exponents are zero here, so the fee is a flat 5% of each side.
    expect(fleaMarketFee(10_000, 10_000, LIVE_FEE)).toBe(1000);
  });

  it("matches the formula above the base price", () => {
    expect(fleaMarketFee(10_000, 40_000, LIVE_FEE)).toBeCloseTo(expected(10_000, 40_000), 6);
  });

  it("matches the formula below it", () => {
    expect(fleaMarketFee(40_000, 10_000, LIVE_FEE)).toBeCloseTo(expected(40_000, 10_000), 6);
  });

  it("climbs steeply as the ask pulls away from the base price", () => {
    // The reason a flip that looks profitable on raw prices often is not.
    const near = fleaMarketFee(10_000, 12_000, LIVE_FEE);
    const far = fleaMarketFee(10_000, 60_000, LIVE_FEE);
    expect(far).toBeGreaterThan(near * 4);
  });

  it("takes 30% off at Intelligence Center 3", () => {
    const full = fleaMarketFee(10_000, 40_000, LIVE_FEE);
    expect(fleaMarketFee(10_000, 40_000, LIVE_FEE, { intelligenceCenter: 3 })).toBeCloseTo(
      full * 0.7,
      6,
    );
  });

  it("gives no discount below level 3, which is why an unrecorded hideout reads as zero", () => {
    const full = fleaMarketFee(10_000, 40_000, LIVE_FEE);
    for (const level of [0, 1, 2]) {
      expect(fleaMarketFee(10_000, 40_000, LIVE_FEE, { intelligenceCenter: level })).toBe(full);
    }
  });

  it("deepens the discount with Hideout Management, but only alongside the station", () => {
    const withSkill = fleaMarketFee(10_000, 40_000, LIVE_FEE, {
      intelligenceCenter: 3,
      hideoutManagement: 50,
    });
    const withoutSkill = fleaMarketFee(10_000, 40_000, LIVE_FEE, { intelligenceCenter: 3 });
    expect(withSkill).toBeLessThan(withoutSkill);
    // The skill alone does nothing without the station built.
    expect(fleaMarketFee(10_000, 40_000, LIVE_FEE, { hideoutManagement: 50 })).toBe(
      fleaMarketFee(10_000, 40_000, LIVE_FEE),
    );
  });

  it("scales with the stack", () => {
    expect(fleaMarketFee(10_000, 40_000, LIVE_FEE, { count: 3 })).toBeCloseTo(
      expected(10_000, 40_000, 0.05, 3),
      6,
    );
  });

  it("reads the rates off the catalogue rather than a constant", () => {
    const half = fleaMarketFee(10_000, 10_000, {
      sellOfferFeeRate: 0.025,
      sellRequirementFeeRate: 0.025,
    });
    expect(half).toBe(500);
  });

  it("charges nothing when either price is missing, since there is nothing to charge on", () => {
    expect(fleaMarketFee(null, 40_000, LIVE_FEE)).toBe(0);
    expect(fleaMarketFee(10_000, null, LIVE_FEE)).toBe(0);
    expect(fleaMarketFee(0, 40_000, LIVE_FEE)).toBe(0);
  });
});

describe("netOfFee", () => {
  it("is the asking price less the fee", () => {
    expect(netOfFee(10_000, 40_000, LIVE_FEE)).toBe(
      40_000 - fleaMarketFee(10_000, 40_000, LIVE_FEE),
    );
  });

  it("is null when there is no listing to make", () => {
    expect(netOfFee(10_000, null, LIVE_FEE)).toBeNull();
  });
});
