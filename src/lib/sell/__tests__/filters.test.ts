import { describe, expect, it } from "vitest";

import type { SellItem } from "@/lib/tarkovdev/client";

import { DEFAULT_SELL_VIEW, filterRows, sortRows, type SellView } from "../filters";
import type { KeepEntry, KeepKind, KeepReason } from "../keep-list";
import type { SellRow } from "../verdict";

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

const reason = (kind: KeepKind, locked = false): KeepReason => ({
  kind,
  sourceId: kind,
  label: kind,
  count: 1,
  foundInRaid: false,
  tier: kind === "task" || kind === "hideout" ? "hard" : "soft",
  alternatives: 1,
  ...(locked ? { locked: true } : {}),
});

function row(id: string, kinds: KeepKind[] | null, overrides: Partial<SellRow> = {}): SellRow {
  const reasons = (kinds ?? []).map((kind) => reason(kind));
  const keep: KeepEntry | null = kinds
    ? {
        itemId: id,
        tier: reasons.some((r) => r.tier === "hard") ? "hard" : "soft",
        reasons,
        hardCount: 0,
        softCount: 0,
        keepCount: 0,
        unverified: false,
      }
    : null;
  return {
    item: item(id),
    verdict: keep ? (keep.tier === "hard" ? "keep" : "think-twice") : "ok-to-sell",
    keep,
    flea: null,
    trader: null,
    edge: null,
    ...overrides,
  };
}

const view = (patch: Partial<SellView> = {}): SellView => ({ ...DEFAULT_SELL_VIEW, ...patch });
const idsOf = (rows: SellRow[]) => rows.map((r) => r.item.id);

const rows = [
  row("wires", ["task", "hideout"]),
  row("lamp", ["barter"]),
  row("wrench", ["craft"]),
  row("chain", null),
];

describe("filterRows", () => {
  it("keeps everything by default, which is the cautious answer", () => {
    expect(idsOf(filterRows(rows, view()))).toEqual(["wires", "lamp", "wrench", "chain"]);
  });

  it("narrows to must-keep rows", () => {
    expect(idsOf(filterRows(rows, view({ filter: "hard" })))).toEqual(["wires"]);
  });

  it("narrows to rows only a barter or a craft wants, which are the sellable ones", () => {
    // "wires" has a task on it too, so it is not up for sale however many barters want it.
    expect(idsOf(filterRows(rows, view({ filter: "soft" })))).toEqual(["lamp", "wrench"]);
  });

  it("narrows to a single reason kind", () => {
    expect(idsOf(filterRows(rows, view({ filter: "barter" })))).toEqual(["lamp"]);
    expect(idsOf(filterRows(rows, view({ filter: "craft" })))).toEqual(["wrench"]);
  });

  it("drops rows nothing wants when a reason kind is chosen", () => {
    expect(idsOf(filterRows(rows, view({ filter: "task" })))).toEqual(["wires"]);
  });

  it("hides what cannot be listed on the flea", () => {
    const restricted = [row("roubles", null, { item: item("roubles", { noFlea: true }) })];
    expect(filterRows(restricted, view({ hideNoFlea: true }))).toEqual([]);
  });

  it("hides items the flea will not list at your level", () => {
    const byLevel = [
      row("junk", null, { item: item("junk", { minLevelForFlea: 0 }) }),
      row("lamp", null, { item: item("lamp", { minLevelForFlea: 20 }) }),
      row("ledx", null, { item: item("ledx", { minLevelForFlea: 25 }) }),
    ];
    expect(idsOf(filterRows(byLevel, view(), 20))).toEqual(["junk", "lamp"]);
  });

  it("keeps an item whose requirement is exactly your level", () => {
    const exact = [row("lamp", null, { item: item("lamp", { minLevelForFlea: 20 }) })];
    expect(idsOf(filterRows(exact, view(), 20))).toEqual(["lamp"]);
  });

  it("never judges a restricted item by level, since its requirement is meaningless", () => {
    // Every `noFlea` item carries a level in the data. The flea-only toggle governs
    // these, not the level box.
    const restricted = [
      row("roubles", null, { item: item("roubles", { noFlea: true, minLevelForFlea: 25 }) }),
    ];
    expect(idsOf(filterRows(restricted, view(), 1))).toEqual(["roubles"]);
  });

  it("filters on nothing when the level is cleared", () => {
    const byLevel = [row("ledx", null, { item: item("ledx", { minLevelForFlea: 40 }) })];
    expect(idsOf(filterRows(byLevel, view(), null))).toEqual(["ledx"]);
  });
});

describe("sortRows", () => {
  const priced = [
    row("cheap", null, { flea: 100, trader: { traderId: "t", traderName: "T", priceRUB: 900 } }),
    row("rich", null, { flea: 5000, trader: { traderId: "t", traderName: "T", priceRUB: 10 } }),
    row("none", null),
  ];

  it("puts the highest flea value first", () => {
    expect(idsOf(sortRows(priced, "flea"))).toEqual(["rich", "cheap", "none"]);
  });

  it("puts the best trader offer first", () => {
    expect(idsOf(sortRows(priced, "trader"))).toEqual(["cheap", "rich", "none"]);
  });

  it("ascending puts must-keep first and the sellable rows last", () => {
    expect(idsOf(sortRows(rows, "tier-asc"))).toEqual(["wires", "lamp", "wrench", "chain"]);
  });

  it("descending puts the sellable rows first, which is what the page opens on", () => {
    expect(idsOf(sortRows(rows, "tier-desc"))).toEqual(["chain", "lamp", "wrench", "wires"]);
  });

  it("opens on the descending verdict order", () => {
    expect(DEFAULT_SELL_VIEW.sort).toBe("tier-desc");
  });

  it("falls through to name so equal rows never shuffle between renders", () => {
    const tied = [row("beta", null), row("alpha", null)];
    expect(idsOf(sortRows(tied, "flea"))).toEqual(["alpha", "beta"]);
    expect(idsOf(sortRows(tied, "tier-asc"))).toEqual(["alpha", "beta"]);
  });

  it("leaves the input array alone", () => {
    const input = [row("b", null), row("a", null)];
    sortRows(input, "name");
    expect(idsOf(input)).toEqual(["b", "a"]);
  });
});
