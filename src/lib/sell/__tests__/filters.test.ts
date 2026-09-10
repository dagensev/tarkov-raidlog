import { describe, expect, it } from "vitest";

import {
  CATEGORY_CHIPS,
  DEFAULT_SELL_VIEW,
  filterRows,
  matchesChip,
  nextSort,
  sortRows,
  toggle,
  type SellView,
} from "../filters";
import { item, offer } from "./fixtures";
import type { KeepEntry, KeepKind, KeepReason } from "../keep-list";
import type { SellRow } from "../verdict";

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
      }
    : null;
  return {
    item: item(id, { shortName: id }),
    verdict: keep ? (keep.tier === "hard" ? "keep" : "think-twice") : "ok-to-sell",
    keep,
    flea: null,
    trader: null,
    buy: null,
    fleaFee: null,
    fleaVsTrader: null,
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
  it("keeps everything by default, which is the whole catalogue and the point of the tab", () => {
    expect(idsOf(filterRows(rows, view()))).toEqual(["wires", "lamp", "wrench", "chain"]);
  });

  it("narrows to must-keep rows", () => {
    expect(idsOf(filterRows(rows, view({ uses: ["hard"] })))).toEqual(["wires"]);
  });

  it("narrows to rows only a barter or a craft wants, which are the sellable ones", () => {
    // "wires" has a task on it too, so it is not up for sale however many barters want it.
    expect(idsOf(filterRows(rows, view({ uses: ["soft"] })))).toEqual(["lamp", "wrench"]);
  });

  it("narrows to a single reason kind", () => {
    expect(idsOf(filterRows(rows, view({ uses: ["barter"] })))).toEqual(["lamp"]);
    expect(idsOf(filterRows(rows, view({ uses: ["craft"] })))).toEqual(["wrench"]);
  });

  it("widens across several use chips rather than narrowing", () => {
    expect(idsOf(filterRows(rows, view({ uses: ["barter", "craft"] })))).toEqual([
      "lamp",
      "wrench",
    ]);
  });

  it("drops rows nothing wants when a reason kind is chosen", () => {
    expect(idsOf(filterRows(rows, view({ uses: ["task"] })))).toEqual(["wires"]);
  });

  it("widens within the category group", () => {
    const catalogue = [
      row("key", null, { item: item("key", { handbook: ["keys"] }) }),
      row("bolts", null, { item: item("bolts", { handbook: ["barter-items"] }) }),
      row("ak", null, { item: item("ak", { handbook: ["weapons"] }) }),
    ];
    expect(idsOf(filterRows(catalogue, view({ categories: ["keys", "barter"] })))).toEqual([
      "key",
      "bolts",
    ]);
  });

  it("narrows across the two groups, so a category and a use must both hold", () => {
    // The reason the groups combine differently: "keys or barter items" is a wider net,
    // "keys that a task wants" is a narrower one, and both are things a reader asks for.
    const catalogue = [
      row("wanted-key", ["task"], { item: item("wanted-key", { handbook: ["keys"] }) }),
      row("spare-key", null, { item: item("spare-key", { handbook: ["keys"] }) }),
      row("wanted-bolts", ["task"], { item: item("wanted-bolts", { handbook: ["barter-items"] }) }),
    ];
    const narrowed = filterRows(catalogue, view({ categories: ["keys"], uses: ["task"] }));
    expect(idsOf(narrowed)).toEqual(["wanted-key"]);
  });

  it("matches the search box against name, short name and slug", () => {
    const catalogue = [
      row("ledx", null, { item: item("ledx", { name: "LEDX Skin Transilluminator" }) }),
      row("bolts", null, { item: item("bolts", { name: "Bolts" }) }),
    ];
    expect(idsOf(filterRows(catalogue, view({ query: "transillum" })))).toEqual(["ledx"]);
  });

  it("ignores an unknown category chip rather than emptying the table", () => {
    // A chip id can outlive its chip — the view survives tab switches and the table does not.
    expect(idsOf(filterRows(rows, view({ categories: ["no-such-chip"] })))).toEqual([
      "wires",
      "lamp",
      "wrench",
      "chain",
    ]);
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

describe("matchesChip", () => {
  const chip = (id: string) => CATEGORY_CHIPS.find((each) => each.id === id)!;

  it("matches on a root handbook category", () => {
    expect(matchesChip(item("key", { handbook: ["keys"] }), chip("keys"))).toBe(true);
    expect(matchesChip(item("bolts", { handbook: ["barter-items"] }), chip("keys"))).toBe(false);
  });

  it("reaches into the finer tree for groupings the handbook has no root for", () => {
    // Cases live under Gear and magazines under Weapon parts, where nobody goes looking.
    const case_ = item("case", { handbook: ["gear"], categories: ["common-container"] });
    expect(matchesChip(case_, chip("cases"))).toBe(true);
    expect(matchesChip(case_, chip("packs"))).toBe(false);
  });

  it("matches on a type tag where the grouping is a tag rather than a category", () => {
    expect(matchesChip(item("can", { types: ["suppressor"] }), chip("suppressors"))).toBe(true);
  });

  it("gives every chip a unique id, since the view stores them by id", () => {
    const ids = CATEGORY_CHIPS.map((each) => each.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("toggle", () => {
  it("adds what is missing and removes what is there", () => {
    expect(toggle(["a"], "b")).toEqual(["a", "b"]);
    expect(toggle(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("sortRows", () => {
  const priced = [
    row("cheap", null, {
      flea: 100,
      trader: { ...offer({ priceRUB: 900 }), traderName: "T" },
      fleaVsTrader: -805,
    }),
    row("rich", null, {
      flea: 5000,
      trader: { ...offer({ priceRUB: 10 }), traderName: "T" },
      fleaVsTrader: 4740,
    }),
    row("none", null),
  ];

  it("puts the highest flea value first", () => {
    expect(idsOf(sortRows(priced, view({ sort: "flea" })))).toEqual(["rich", "cheap", "none"]);
  });

  it("puts the best trader offer first", () => {
    expect(idsOf(sortRows(priced, view({ sort: "sellTrader" })))).toEqual([
      "cheap",
      "rich",
      "none",
    ]);
  });

  it("puts the biggest gain over the trader first", () => {
    expect(idsOf(sortRows(priced, view({ sort: "fleaVsTrader" })))).toEqual([
      "rich",
      "cheap",
      "none",
    ]);
  });

  it("leaves rows with nothing to sort on at the bottom in both directions", () => {
    // Floating them to the top of "worst to list" would read as a loss the data never showed.
    expect(idsOf(sortRows(priced, view({ sort: "fleaVsTrader", descending: false })))).toEqual([
      "cheap",
      "rich",
      "none",
    ]);
  });

  it("ascending puts must-keep first and the sellable rows last", () => {
    expect(idsOf(sortRows(rows, view({ sort: "tier", descending: false })))).toEqual([
      "wires",
      "lamp",
      "wrench",
      "chain",
    ]);
  });

  it("descending puts the sellable rows first, which is what the page opens on", () => {
    expect(idsOf(sortRows(rows, view({ sort: "tier" })))).toEqual([
      "chain",
      "lamp",
      "wrench",
      "wires",
    ]);
  });

  it("opens on the descending verdict order", () => {
    expect(DEFAULT_SELL_VIEW.sort).toBe("tier");
    expect(DEFAULT_SELL_VIEW.descending).toBe(true);
  });

  it("falls through to name so equal rows never shuffle between renders", () => {
    const tied = [row("beta", null), row("alpha", null)];
    expect(idsOf(sortRows(tied, view({ sort: "flea" })))).toEqual(["alpha", "beta"]);
    expect(idsOf(sortRows(tied, view({ sort: "tier", descending: false })))).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("leaves the input array alone", () => {
    const input = [row("b", null), row("a", null)];
    sortRows(input, view({ sort: "name" }));
    expect(idsOf(input)).toEqual(["b", "a"]);
  });
});

describe("nextSort", () => {
  it("starts a money column high-first, because that is the interesting end", () => {
    expect(nextSort(view({ sort: "name" }), "fleaVsTrader")).toEqual({
      sort: "fleaVsTrader",
      descending: true,
    });
  });

  it("starts the name column A-first", () => {
    expect(nextSort(view({ sort: "flea" }), "name")).toEqual({ sort: "name", descending: false });
  });

  it("flips the column that is already sorted", () => {
    expect(nextSort(view({ sort: "flea", descending: true }), "flea")).toEqual({
      sort: "flea",
      descending: false,
    });
  });
});
