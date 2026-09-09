import { describe, expect, it } from "vitest";

import type { SellIndex, SellItem } from "@/lib/tarkovdev/client";

import type { KeepEntry, KeepList, KeepReason } from "../keep-list";
import { keepRows, rowsFor, sellRow, verdictFor } from "../verdict";

function item(id: string, overrides: Partial<SellItem> = {}): SellItem {
  return {
    id,
    name: id,
    shortName: id,
    normalizedName: id,
    width: 1,
    height: 1,
    noFlea: false,
    minLevelForFlea: 0,
    avg24hPrice: null,
    lastLowPrice: null,
    basePrice: null,
    bestTrader: null,
    wikiLink: null,
    ...overrides,
  };
}

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
    unverified: false,
    ...overrides,
  };
}

const index = (items: SellItem[]): SellIndex => ({
  mode: "regular",
  fetchedAt: 0,
  items: Object.fromEntries(items.map((i) => [i.id, i])),
});

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
    const row = sellRow(item("lamp", { avg24hPrice: 32513 }), undefined);
    expect(row.flea).toBe(32513);
  });

  it("falls back to the last low price when there is no average", () => {
    expect(sellRow(item("lamp", { lastLowPrice: 31111 }), undefined).flea).toBe(31111);
  });

  it("reports no flea price for an item that cannot be listed", () => {
    // A restricted item can still carry an average from before it was restricted, and
    // showing it would offer a sale that the market will not accept.
    const row = sellRow(item("roubles", { noFlea: true, avg24hPrice: 1 }), undefined);
    expect(row.flea).toBeNull();
  });

  it("names the trader behind the best offer", () => {
    const row = sellRow(
      item("lamp", { bestTrader: { traderId: "therapist", priceRUB: 5519 } }),
      undefined,
      new Map([["therapist", "Therapist"]]),
    );
    expect(row.trader).toEqual({ traderId: "therapist", traderName: "Therapist", priceRUB: 5519 });
  });

  it("falls back to the trader id when no name was supplied", () => {
    const row = sellRow(item("lamp", { bestTrader: { traderId: "therapist", priceRUB: 1 } }), undefined);
    expect(row.trader?.traderName).toBe("therapist");
  });

  it("reports the edge the flea has over the trader", () => {
    const row = sellRow(
      item("lamp", { avg24hPrice: 32513, bestTrader: { traderId: "t", priceRUB: 5519 } }),
      undefined,
    );
    expect(row.edge).toBe(26994);
  });

  it("reports no edge when either side is missing", () => {
    expect(sellRow(item("lamp", { avg24hPrice: 100 }), undefined).edge).toBeNull();
    expect(
      sellRow(item("lamp", { bestTrader: { traderId: "t", priceRUB: 5 } }), undefined).edge,
    ).toBeNull();
  });
});

describe("keepRows", () => {
  it("builds a row for every keep-listed item", () => {
    const rows = keepRows(list([entry("wires")]), index([item("wires")]));
    expect(rows.map((r) => r.item.id)).toEqual(["wires"]);
    expect(rows[0].verdict).toBe("keep");
  });

  it("skips a keep-listed id the catalogue does not know", () => {
    // The documents disagreeing is possible; a row with no name or price helps nobody.
    expect(keepRows(list([entry("ghost")]), index([item("wires")]))).toEqual([]);
  });
});

describe("rowsFor", () => {
  it("gives an item nothing wants the OK-to-sell verdict, which a keep-only list cannot", () => {
    const rows = rowsFor([item("gold-chain")], list([entry("wires")]));
    expect(rows[0].verdict).toBe("ok-to-sell");
    expect(rows[0].keep).toBeNull();
  });
});
