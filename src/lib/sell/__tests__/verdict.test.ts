import { describe, expect, it } from "vitest";

import { fleaMarketFee } from "../fee";
import { LIVE_FEE, NO_FEE, index, item, offer } from "./fixtures";
import type { KeepEntry, KeepList, KeepReason } from "../keep-list";
import { catalogueRows, keepRows, rowsFor, sellRow, verdictFor } from "../verdict";

/** No trader names and no fee, which is what most of these assertions are about. */
const plain = { rates: NO_FEE };

const reason = (overrides: Partial<KeepReason> = {}): KeepReason => ({
  kind: "task",
  sourceId: "t1",
  label: "Debut",
  count: 1,
  foundInRaid: false,
  tier: "hard",
  alternatives: 1,
  ...overrides,
});

function entry(itemId: string, overrides: Partial<KeepEntry> = {}): KeepEntry {
  return {
    itemId,
    tier: "hard",
    reasons: [reason()],
    hardCount: 1,
    softCount: 0,
    keepCount: 0,
    ...overrides,
  };
}

const list = (entries: KeepEntry[]): KeepList => new Map(entries.map((e) => [e.itemId, e]));

describe("verdictFor", () => {
  it("says it is OK to sell when there is no entry at all", () => {
    expect(verdictFor(undefined)).toBe("ok-to-sell");
  });

  it("says keep when any reason is hard", () => {
    expect(verdictFor(entry("wires"))).toBe("keep");
  });

  it("says think twice when every reason is soft", () => {
    expect(verdictFor(entry("wires", { tier: "soft", hardCount: 0, softCount: 3 }))).toBe(
      "think-twice",
    );
  });
});

describe("sellRow", () => {
  it("reports the 24h average as what a listing would fetch", () => {
    const row = sellRow(item("lamp", { avg24hPrice: 32513 }), undefined, plain);
    expect(row.flea).toBe(32513);
  });

  it("falls back to the last low price when there is no average", () => {
    expect(sellRow(item("lamp", { lastLowPrice: 31111 }), undefined, plain).flea).toBe(31111);
  });

  it("reports no flea price for an item that cannot be listed", () => {
    // A restricted item can still carry an average from before it was restricted, and
    // showing it would offer a sale that the market will not accept.
    const row = sellRow(item("roubles", { noFlea: true, avg24hPrice: 1 }), undefined, plain);
    expect(row.flea).toBeNull();
  });

  it("names the trader behind the best offer", () => {
    const row = sellRow(
      item("lamp", { bestTrader: offer({ traderId: "therapist", priceRUB: 5519, price: 5519 }) }),
      undefined,
      { rates: NO_FEE, traderNames: new Map([["therapist", "Therapist"]]) },
    );
    expect(row.trader?.traderName).toBe("Therapist");
    expect(row.trader?.priceRUB).toBe(5519);
  });

  it("keeps the trader's own currency, because that is what their screen shows", () => {
    const row = sellRow(
      item("mag", { buyFrom: offer({ traderId: "peacekeeper", price: 26, currency: "USD", priceRUB: 4470 }) }),
      undefined,
      plain,
    );
    expect(row.buy?.price).toBe(26);
    expect(row.buy?.currency).toBe("USD");
    expect(row.buy?.priceRUB).toBe(4470);
  });

  it("carries the loyalty level a buy offer needs", () => {
    const row = sellRow(item("grip", { buyFrom: offer({ minTraderLevel: 3 }) }), undefined, plain);
    expect(row.buy?.minTraderLevel).toBe(3);
  });

  it("falls back to the trader id when no name was supplied", () => {
    const row = sellRow(
      item("lamp", { bestTrader: offer({ traderId: "therapist" }) }),
      undefined,
      plain,
    );
    expect(row.trader?.traderName).toBe("therapist");
  });

  it("reports what the flea clears over the trader", () => {
    const row = sellRow(
      item("lamp", { avg24hPrice: 32513, bestTrader: offer({ priceRUB: 5519 }) }),
      undefined,
      plain,
    );
    // No fee configured here, so this is the raw difference.
    expect(row.fleaVsTrader).toBe(26994);
  });

  it("reports nothing to compare when either side is missing", () => {
    expect(sellRow(item("lamp", { avg24hPrice: 100 }), undefined, plain).fleaVsTrader).toBeNull();
    expect(
      sellRow(item("lamp", { bestTrader: offer({ priceRUB: 5 }) }), undefined, plain).fleaVsTrader,
    ).toBeNull();
  });
});

describe("the profit columns", () => {
  const priced = (overrides = {}) =>
    item("lamp", {
      basePrice: 20_000,
      avg24hPrice: 40_000,
      bestTrader: offer({ priceRUB: 12_000 }),
      buyFrom: offer({ traderId: "mechanic", priceRUB: 25_000 }),
      ...overrides,
    });

  it("quotes the fee on listing at the flea average", () => {
    const row = sellRow(priced(), undefined, { rates: LIVE_FEE });
    expect(row.fleaFee).toBe(fleaMarketFee(20_000, 40_000, LIVE_FEE));
  });

  it("passes the Intelligence Center level through to the fee", () => {
    const full = sellRow(priced(), undefined, { rates: LIVE_FEE });
    const discounted = sellRow(priced(), undefined, { rates: LIVE_FEE, intelligenceCenter: 3 });
    expect(discounted.fleaFee!).toBeCloseTo(full.fleaFee! * 0.7, 6);
  });

  it("takes the fee out of the comparison, which is what makes it honest", () => {
    const row = sellRow(priced(), undefined, { rates: LIVE_FEE });
    expect(row.fleaVsTrader).toBe(40_000 - row.fleaFee! - 12_000);
    // Raw prices say the flea wins by 28,000. The fee says by rather less.
    expect(row.fleaVsTrader!).toBeLessThan(28_000);
  });

  it("turns negative when the fee costs more than the flea's advantage", () => {
    // Which is the whole reason to show the figure: the trader is sometimes the right
    // answer even on an item the flea prices higher.
    const row = sellRow(priced({ avg24hPrice: 21_000, bestTrader: offer({ priceRUB: 19_000 }) }), undefined, {
      rates: LIVE_FEE,
    });
    expect(row.fleaVsTrader!).toBeLessThan(0);
  });

  it("still compares for an item no trader stocks, since buying is not part of it", () => {
    const row = sellRow(priced({ buyFrom: null }), undefined, { rates: LIVE_FEE });
    expect(row.fleaVsTrader).toBe(40_000 - row.fleaFee! - 12_000);
  });

  it("reports nothing for an item that cannot be listed at all", () => {
    const row = sellRow(priced({ noFlea: true }), undefined, { rates: LIVE_FEE });
    expect(row.fleaFee).toBeNull();
    expect(row.fleaVsTrader).toBeNull();
  });
});

describe("keepRows", () => {
  it("builds a row for every keep-listed item", () => {
    const rows = keepRows(list([entry("wires")]), index([item("wires")]), plain);
    expect(rows.map((r) => r.item.id)).toEqual(["wires"]);
    expect(rows[0].verdict).toBe("keep");
  });

  it("skips a keep-listed id the catalogue does not know", () => {
    // The documents disagreeing is possible; a row with no name or price helps nobody.
    expect(keepRows(list([entry("ghost")]), index([item("wires")]), plain)).toEqual([]);
  });
});

describe("rowsFor", () => {
  it("gives an item nothing wants the OK-to-sell verdict, which a keep-only list cannot", () => {
    const rows = rowsFor([item("gold-chain")], list([entry("wires")]), plain);
    expect(rows[0].verdict).toBe("ok-to-sell");
    expect(rows[0].keep).toBeNull();
  });
});

describe("catalogueRows", () => {
  it("builds a row for every item, wanted or not", () => {
    // The sell check only ever built rows for the keep list, so an item nothing wanted
    // could not be priced at all. This is the whole of what the flea tab reads.
    const rows = catalogueRows(
      index([item("wires"), item("gold-chain")]),
      list([entry("wires")]),
      plain,
    );
    expect(rows.map((r) => r.item.id).sort()).toEqual(["gold-chain", "wires"]);
    expect(rows.find((r) => r.item.id === "gold-chain")?.verdict).toBe("ok-to-sell");
  });
});
