import { describe, expect, it } from "vitest";

import { SELL_INDEX_VERSION, type SellIndex } from "@/lib/tarkovdev/client";
import type { EconomyBundle } from "@/lib/tarkovdev/economy";
import { catalogueBehind } from "../app-store";
import { BUNDLE_TTL_MS } from "../db";

/**
 * Found by using the app, not by reading the code.
 *
 * The catalogue used to be fetched only on the branch that refetched the core bundle, so
 * anyone whose bundle was still fresh — everyone who had opened the app that day — got a
 * permanently empty sell check until they pressed refresh by hand.
 */

const economy = (patch: Partial<EconomyBundle> = {}): EconomyBundle => ({
  mode: "regular",
  stations: [],
  barters: [],
  crafts: [],
  fetchedAt: Date.now(),
  ...patch,
});

const sellIndex = (patch: Partial<SellIndex> = {}): SellIndex => ({
  mode: "regular",
  version: SELL_INDEX_VERSION,
  fetchedAt: Date.now(),
  items: {},
  ...patch,
});

const state = (patch: Partial<{ economy: EconomyBundle | null; sellIndex: SellIndex | null }> = {}) => ({
  economy: economy(),
  sellIndex: sellIndex(),
  ...patch,
});

describe("catalogueBehind", () => {
  it("is behind when nothing has been cached yet", () => {
    // The case that shipped broken: an existing user's bundle is fresh, so the refresh
    // returned early and this never got a chance to say the catalogue was missing.
    expect(catalogueBehind({ economy: null, sellIndex: null }, "regular")).toBe(true);
  });

  it("is behind when only one half arrived", () => {
    expect(catalogueBehind(state({ sellIndex: null }), "regular")).toBe(true);
    expect(catalogueBehind(state({ economy: null }), "regular")).toBe(true);
  });

  it("is behind when the cached copy belongs to another game mode", () => {
    expect(catalogueBehind(state({ economy: economy({ mode: "pve" }) }), "regular")).toBe(true);
    expect(catalogueBehind(state({ sellIndex: sellIndex({ mode: "pve" }) }), "regular")).toBe(true);
  });

  it("is behind when either half has gone stale", () => {
    const old = Date.now() - BUNDLE_TTL_MS - 1;
    expect(catalogueBehind(state({ economy: economy({ fetchedAt: old }) }), "regular")).toBe(true);
    expect(catalogueBehind(state({ sellIndex: sellIndex({ fetchedAt: old }) }), "regular")).toBe(
      true,
    );
  });

  it("is behind when the cached entries predate a field the page now reads", () => {
    // A cache lives for a day. Without this, a newly added field renders blank until
    // tomorrow — present in the code, missing from every existing reader's copy.
    const old = sellIndex({ version: undefined });
    expect(catalogueBehind(state({ sellIndex: old }), "regular")).toBe(true);
  });

  it("is not behind when both halves are fresh and in the right mode", () => {
    // The only case that may skip the 16.7 MB download.
    expect(catalogueBehind(state(), "regular")).toBe(false);
  });
});
