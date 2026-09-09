import { describe, expect, it } from "vitest";

import type { SellIndex, SellItem } from "@/lib/tarkovdev/client";

import { searchItems } from "../search";

function item(id: string, name: string, shortName: string, normalizedName: string): SellItem {
  return {
    id,
    name,
    shortName,
    normalizedName,
    width: 1,
    height: 1,
    noFlea: false,
    minLevelForFlea: 0,
    avg24hPrice: null,
    lastLowPrice: null,
    basePrice: null,
    bestTrader: null,
    wikiLink: null,
  };
}

const index: SellIndex = {
  mode: "regular",
  fetchedAt: 0,
  items: Object.fromEntries(
    [
      item("a", "Gas analyzer", "Gas", "gas-analyzer"),
      item("b", "Bundle of wires", "Wires", "bundle-of-wires"),
      item("c", "Gas mask", "GasMask", "gas-mask"),
      item("d", "LEDX Skin Transilluminator", "LEDX", "ledx-skin-transilluminator"),
    ].map((i) => [i.id, i]),
  ),
};

const found = (query: string) => searchItems(index, query).map((i) => i.id);

describe("searchItems", () => {
  it("returns nothing for an empty query, because the page shows the keep list instead", () => {
    expect(searchItems(index, "")).toEqual([]);
    expect(searchItems(index, "   ")).toEqual([]);
  });

  it("matches the full name, case insensitively", () => {
    expect(found("gas analyzer")).toEqual(["a"]);
    expect(found("GAS ANALYZER")).toEqual(["a"]);
  });

  it("matches the short name, which is what the game shows on the icon", () => {
    expect(found("ledx")).toEqual(["d"]);
  });

  it("matches the normalized name, so a hyphenated paste works", () => {
    expect(found("bundle-of-wires")).toEqual(["b"]);
  });

  it("matches a substring anywhere in the name", () => {
    expect(found("wires")).toEqual(["b"]);
  });

  it("ranks an exact short-name match above a mere prefix", () => {
    // Typing "gas" should land on the thing actually called Gas, not the mask.
    expect(found("gas")[0]).toBe("a");
  });

  it("respects the limit", () => {
    expect(searchItems(index, "a", 2)).toHaveLength(2);
  });

  it("returns nothing when nothing matches", () => {
    expect(found("moonshine")).toEqual([]);
  });
});
