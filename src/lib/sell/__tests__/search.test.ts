import { describe, expect, it } from "vitest";

import type { SellIndex, SellItem } from "@/lib/tarkovdev/client";

import { searchItems } from "../search";
import { item as build, index as buildIndex } from "./fixtures";

const item = (id: string, name: string, shortName: string, normalizedName: string): SellItem =>
  build(id, { name, shortName, normalizedName });

const index: SellIndex = buildIndex([
  item("a", "Gas analyzer", "Gas", "gas-analyzer"),
  item("b", "Bundle of wires", "Wires", "bundle-of-wires"),
  item("c", "Gas mask", "GasMask", "gas-mask"),
  item("d", "LEDX Skin Transilluminator", "LEDX", "ledx-skin-transilluminator"),
]);

const found = (query: string) => searchItems(index, query).map((i) => i.id);

describe("searchItems", () => {
  it("returns nothing for an empty query, since a lookup with no query has no answer", () => {
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
