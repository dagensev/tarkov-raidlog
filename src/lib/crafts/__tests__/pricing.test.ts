import { describe, expect, it } from "vitest";

import { fleaMarketFee } from "@/lib/sell/fee";

import { buyPrice, fleaPrice, reachableOffer, sellPrice } from "../pricing";
import { LIVE_FEE, item, market, offer } from "./fixtures";

describe("fleaPrice", () => {
  it("takes the 24h average on the average basis, and the last low on the other", () => {
    const lamp = item("lamp", { avg24hPrice: 30_000, lastLowPrice: 25_000 });
    expect(fleaPrice(lamp, "avg24h")).toBe(30_000);
    expect(fleaPrice(lamp, "lastLow")).toBe(25_000);
  });

  it("falls back to the other figure rather than refusing to price the item", () => {
    // An item traded once last week has a last low and no average. Dropping it would
    // silently take a whole craft off the table over a figure that is merely stale.
    expect(fleaPrice(item("lamp", { lastLowPrice: 25_000 }), "avg24h")).toBe(25_000);
    expect(fleaPrice(item("lamp", { avg24hPrice: 30_000 }), "lastLow")).toBe(30_000);
  });

  it("refuses to price a restricted item, whatever average it still carries", () => {
    const banned = item("bitcoin", { noFlea: true, avg24hPrice: 400_000 });
    expect(fleaPrice(banned, "avg24h")).toBeNull();
  });

  it("treats a zero as no price at all", () => {
    expect(fleaPrice(item("lamp", { avg24hPrice: 0, lastLowPrice: 0 }), "avg24h")).toBeNull();
  });
});

describe("reachableOffer", () => {
  const sugar = item("sugar", {
    buyOffers: [
      offer({ traderId: "jaeger", priceRUB: 10_000, minTraderLevel: 4 }),
      offer({ traderId: "prapor", priceRUB: 18_000, minTraderLevel: 2 }),
    ],
  });

  it("takes the cheapest offer outright when loyalty is not part of the question", () => {
    expect(reachableOffer(sugar, null)?.priceRUB).toBe(10_000);
  });

  it("skips an offer above your recorded loyalty", () => {
    expect(reachableOffer(sugar, { jaeger: 2, prapor: 3 })?.traderId).toBe("prapor");
  });

  it("assumes level one for a trader nobody recorded, which understates rather than over", () => {
    expect(reachableOffer(sugar, {})).toBeNull();
  });

  it("reports nothing for an item no trader stocks", () => {
    expect(reachableOffer(item("wire"), null)).toBeNull();
  });
});

describe("buyPrice", () => {
  const sugar = item("sugar", {
    avg24hPrice: 15_000,
    buyOffers: [offer({ traderId: "prapor", priceRUB: 11_000, minTraderLevel: 2 })],
  });

  it("takes whichever of the two is cheaper", () => {
    expect(buyPrice(sugar, "cheapest", market())).toMatchObject({ from: "trader", priceRUB: 11_000 });
  });

  it("takes the flea when the reachable trader offer costs more", () => {
    const dear = item("sugar", {
      avg24hPrice: 9_000,
      buyOffers: [offer({ priceRUB: 11_000 })],
    });
    expect(buyPrice(dear, "cheapest", market())).toMatchObject({ from: "flea", priceRUB: 9_000 });
  });

  it("falls back to the flea when loyalty puts every trader offer out of reach", () => {
    const context = market({ traderLevels: { prapor: 1 } });
    expect(buyPrice(sugar, "cheapest", context)).toMatchObject({ from: "flea", priceRUB: 15_000 });
  });

  it("ignores traders entirely when told to", () => {
    expect(buyPrice(sugar, "flea", market())).toMatchObject({ from: "flea", priceRUB: 15_000 });
  });

  it("ignores the flea entirely when told to", () => {
    expect(buyPrice(sugar, "trader", market())).toMatchObject({ from: "trader", priceRUB: 11_000 });
  });

  it("names the trader an offer came from", () => {
    const context = market({ traderNames: new Map([["prapor", "Prapor"]]) });
    expect(buyPrice(sugar, "trader", context)?.offer?.traderName).toBe("Prapor");
  });

  it("reports nothing when neither side has a price", () => {
    expect(buyPrice(item("quest-item"), "cheapest", market())).toBeNull();
    expect(buyPrice(sugar, "trader", market({ traderLevels: {} }))).toBeNull();
  });
});

describe("sellPrice", () => {
  const moonshine = item("moonshine", {
    basePrice: 30_000,
    avg24hPrice: 130_000,
    bestTrader: offer({ traderId: "therapist", priceRUB: 40_000 }),
  });

  it("nets the listing fee off the flea side", () => {
    const context = market({ rates: LIVE_FEE });
    const sold = sellPrice(moonshine, "flea", context)!;
    expect(sold.fee).toBe(fleaMarketFee(30_000, 130_000, LIVE_FEE, {}));
    expect(sold.net).toBe(130_000 - sold.fee);
  });

  it("charges nothing to vendor, since a trader takes no cut", () => {
    const sold = sellPrice(moonshine, "trader", market({ rates: LIVE_FEE }))!;
    expect(sold).toMatchObject({ to: "trader", fee: 0, net: 40_000 });
  });

  it("compares the two on what lands, not on what is asked", () => {
    // The sticker says the flea pays three times what Therapist does. A fee steep enough
    // to reverse that is exactly the case this table exists to catch.
    const steep = item("moonshine", {
      basePrice: 1_000,
      avg24hPrice: 130_000,
      bestTrader: offer({ priceRUB: 40_000 }),
    });
    expect(sellPrice(steep, "best", market({ rates: LIVE_FEE }))?.to).toBe("trader");
    expect(sellPrice(moonshine, "best", market({ rates: LIVE_FEE }))?.to).toBe("flea");
  });

  it("falls back to the side that exists when the other does not", () => {
    const banned = item("bitcoin", { noFlea: true, bestTrader: offer({ priceRUB: 400_000 }) });
    expect(sellPrice(banned, "best", market())?.to).toBe("trader");

    const unvendorable = item("lamp", { avg24hPrice: 5_000 });
    expect(sellPrice(unvendorable, "best", market())?.to).toBe("flea");
  });

  it("reports nothing for an item with neither a listing nor a buyer", () => {
    expect(sellPrice(item("quest-item"), "best", market())).toBeNull();
  });

  it("lets the Intelligence Center discount reach the fee", () => {
    const plain = sellPrice(moonshine, "flea", market({ rates: LIVE_FEE }))!;
    const discounted = sellPrice(
      moonshine,
      "flea",
      market({ rates: LIVE_FEE, intelligenceCenter: 3, hideoutManagement: 50 }),
    )!;
    expect(discounted.fee).toBeLessThan(plain.fee);
  });
});
