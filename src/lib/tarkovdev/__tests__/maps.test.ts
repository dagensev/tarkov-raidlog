import { describe, expect, it } from "vitest";

import { SCENE_CANDIDATES, isKnownScene, resolveMap, tarkovDevMapUrl } from "../maps";
import type { GameMap } from "../types";

const map = (id: string, name: string): GameMap => ({
  id,
  name,
  tarkovDataId: null,
  wiki: null,
  raidDuration: null,
  players: null,
  enemies: null,
  description: null,
});

const MAPS = [
  map("m1", "Customs"),
  map("m2", "Interchange"),
  map("m3", "Shoreline"),
  map("m4", "Ground Zero"),
  map("m5", "Streets of Tarkov"),
  map("m6", "Reserve"),
];

describe("resolveMap", () => {
  it("resolves every scene name seen in real logs", () => {
    // These eight are the scene presets present in the log history on this machine.
    const seen: Array<[string, string]> = [
      ["customs_preset", "Customs"],
      ["shopping_mall", "Interchange"],
      ["shoreline_preset", "Shoreline"],
      ["woods_preset", "Woods"],
      ["rezerv_base_preset", "Reserve"],
      ["sandbox_preset", "Ground Zero"],
      ["sandbox_start_preset", "Ground Zero"],
      ["factory_day_preset", "Factory"],
    ];
    const all = [...MAPS, map("m7", "Woods"), map("m8", "Factory")];
    for (const [scene, expected] of seen) {
      expect(resolveMap(all, { scene })?.name, scene).toBe(expected);
    }
  });

  it("resolves the BSG location ids seen in real logs", () => {
    expect(resolveMap(MAPS, { location: "Shoreline" })?.id).toBe("m3");
    expect(resolveMap(MAPS, { location: "Interchange" })?.id).toBe("m2");
  });

  it("maps bigmap to Customs", () => {
    // BSG's internal id for Customs bears no resemblance to its name.
    expect(resolveMap(MAPS, { location: "bigmap" })?.name).toBe("Customs");
  });

  it("prefers the scene hint over the location hint", () => {
    // The scene fires first and is the more specific signal.
    expect(resolveMap(MAPS, { scene: "customs_preset", location: "Shoreline" })?.name).toBe(
      "Customs",
    );
  });

  it("falls back to Ground Zero when the API does not split the high-level variant", () => {
    expect(resolveMap(MAPS, { scene: "sandbox_high_preset" })?.name).toBe("Ground Zero");
  });

  it("picks the split variant when the API does provide it", () => {
    const withSplit = [...MAPS, map("m9", "Ground Zero 21+")];
    expect(resolveMap(withSplit, { scene: "sandbox_high_preset" })?.id).toBe("m9");
  });

  it("treats an unknown location id as a display name", () => {
    // Better than giving up: BSG ids are often already the name.
    expect(resolveMap(MAPS, { location: "Reserve" })?.id).toBe("m6");
  });

  it("returns undefined rather than guessing at an unknown scene", () => {
    // Pointing at the wrong map mid-raid is worse than admitting we do not know.
    expect(resolveMap(MAPS, { scene: "some_new_map_preset" })).toBeUndefined();
    expect(resolveMap(MAPS, {})).toBeUndefined();
  });

  it("flags scenes missing from the table so it can be extended", () => {
    expect(isKnownScene("customs_preset")).toBe(true);
    expect(isKnownScene("some_new_map_preset")).toBe(false);
  });
});

describe("tarkovDevMapUrl", () => {
  it("builds a slug from the map name", () => {
    expect(tarkovDevMapUrl(map("m", "Streets of Tarkov"))).toBe(
      "https://tarkov.dev/map/streets-of-tarkov",
    );
    expect(tarkovDevMapUrl(map("m", "The Lab"))).toBe("https://tarkov.dev/map/the-lab");
  });

  it("handles the plus in Ground Zero 21+", () => {
    expect(tarkovDevMapUrl(map("m", "Ground Zero 21+"))).toBe(
      "https://tarkov.dev/map/ground-zero-21plus",
    );
  });
});

describe("SCENE_CANDIDATES", () => {
  it("lists candidates best-first", () => {
    expect(SCENE_CANDIDATES.sandbox_high_preset[0]).toBe("Ground Zero 21+");
  });
});
