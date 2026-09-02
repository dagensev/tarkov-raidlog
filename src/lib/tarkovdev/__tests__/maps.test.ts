import { describe, expect, it } from "vitest";

import { isKnownScene, resolveMap, sceneKey, tarkovDevMapUrl } from "../maps";
import type { GameMap } from "../types";

/**
 * Map fixtures use the real `nameId` and `scenePath` values published by
 * `https://json.tarkov.dev/pvp-season/maps`, since matching against those exact strings
 * is the whole mechanism.
 */
const map = (
  id: string,
  name: string,
  normalizedName: string,
  nameId: string,
  scenePath: string | null,
): GameMap => ({
  id,
  name,
  normalizedName,
  nameId,
  scenePath,
  wiki: null,
  raidDuration: null,
  players: null,
  enemies: null,
  description: null,
});

const MAPS = [
  map("m1", "Customs", "customs", "bigmap", "maps/customs_preset.bundle"),
  map("m2", "Interchange", "interchange", "Interchange", "maps/shopping_mall.bundle"),
  map("m3", "Shoreline", "shoreline", "Shoreline", "maps/shoreline_preset.bundle"),
  map("m4", "Woods", "woods", "Woods", "maps/woods_preset.bundle"),
  map("m5", "Reserve", "reserve", "RezervBase", "maps/rezerv_base_preset.bundle"),
  map("m6", "Factory", "factory", "factory4_day", "maps/factory_day_preset.bundle"),
  map("m7", "Night Factory", "night-factory", "factory4_night", "maps/factory_night_preset.bundle"),
  map("m8", "Ground Zero", "ground-zero", "Sandbox", "maps/sandbox_preset.bundle"),
  map("m9", "Ground Zero 21+", "ground-zero-21", "Sandbox_high", "maps/sandbox_high_preset.bundle"),
  map(
    "m10",
    "Ground Zero Tutorial",
    "ground-zero-tutorial",
    "Sandbox_start",
    "maps/sandbox_start_preset.bundle",
  ),
  map("m11", "Streets of Tarkov", "streets-of-tarkov", "TarkovStreets", "maps/city_preset.bundle"),
];

describe("sceneKey", () => {
  it("reduces a scene path to its bundle name", () => {
    expect(sceneKey("maps/customs_preset.bundle")).toBe("customs_preset");
    expect(sceneKey("customs_preset")).toBe("customs_preset");
  });
});

describe("resolveMap", () => {
  it("resolves every scene seen in real logs", () => {
    // These are the scene presets present in the log history on this machine, taken
    // verbatim from `scene preset path:` lines.
    const seen: Array<[string, string]> = [
      ["maps/customs_preset.bundle", "Customs"],
      ["maps/shopping_mall.bundle", "Interchange"],
      ["maps/factory_day_preset.bundle", "Factory"],
      ["maps/shoreline_preset.bundle", "Shoreline"],
      ["maps/woods_preset.bundle", "Woods"],
      ["maps/rezerv_base_preset.bundle", "Reserve"],
      ["maps/sandbox_preset.bundle", "Ground Zero"],
      ["maps/sandbox_high_preset.bundle", "Ground Zero 21+"],
      ["maps/sandbox_start_preset.bundle", "Ground Zero Tutorial"],
    ];
    for (const [scene, expected] of seen) {
      expect(resolveMap(MAPS, { scene })?.name, scene).toBe(expected);
    }
  });

  it("distinguishes the Ground Zero variants", () => {
    // A hardcoded table previously collapsed all three into "Ground Zero". The tutorial
    // and the level-21+ instance are separate maps with separate task lists.
    expect(resolveMap(MAPS, { scene: "maps/sandbox_preset.bundle" })?.id).toBe("m8");
    expect(resolveMap(MAPS, { scene: "maps/sandbox_high_preset.bundle" })?.id).toBe("m9");
    expect(resolveMap(MAPS, { scene: "maps/sandbox_start_preset.bundle" })?.id).toBe("m10");
  });

  it("treats Night Factory as its own map", () => {
    expect(resolveMap(MAPS, { scene: "maps/factory_night_preset.bundle" })?.name).toBe(
      "Night Factory",
    );
  });

  it("resolves the location ids seen in real logs via nameId", () => {
    expect(resolveMap(MAPS, { location: "Shoreline" })?.id).toBe("m3");
    expect(resolveMap(MAPS, { location: "Interchange" })?.id).toBe("m2");
  });

  it("maps bigmap to Customs", () => {
    // BSG's internal id bears no resemblance to the map's name, which is exactly why
    // this reads nameId from the API instead of guessing.
    expect(resolveMap(MAPS, { location: "bigmap" })?.name).toBe("Customs");
  });

  it("prefers the scene hint, which the log emits first", () => {
    expect(
      resolveMap(MAPS, { scene: "maps/customs_preset.bundle", location: "Shoreline" })?.name,
    ).toBe("Customs");
  });

  it("falls back to the display name for an unrecognised location id", () => {
    expect(resolveMap(MAPS, { location: "Streets of Tarkov" })?.id).toBe("m11");
  });

  it("returns undefined rather than guessing", () => {
    // Pointing at the wrong map mid-raid is worse than admitting we do not know.
    expect(resolveMap(MAPS, { scene: "maps/some_new_map.bundle" })).toBeUndefined();
    expect(resolveMap(MAPS, { location: "Atlantis" })).toBeUndefined();
    expect(resolveMap(MAPS, {})).toBeUndefined();
  });

  it("copes with a map whose scenePath the API omits", () => {
    const partial = [map("x", "Mystery", "mystery", "Mystery", null)];
    expect(resolveMap(partial, { scene: "maps/anything.bundle" })).toBeUndefined();
    expect(resolveMap(partial, { location: "Mystery" })?.id).toBe("x");
  });
});

describe("isKnownScene", () => {
  it("flags a scene the API does not publish", () => {
    expect(isKnownScene(MAPS, "maps/customs_preset.bundle")).toBe(true);
    expect(isKnownScene(MAPS, "maps/some_new_map.bundle")).toBe(false);
  });
});

describe("tarkovDevMapUrl", () => {
  it("uses the slug the API supplies", () => {
    expect(tarkovDevMapUrl(MAPS[10])).toBe("https://tarkov.dev/map/streets-of-tarkov");
    expect(tarkovDevMapUrl(MAPS[8])).toBe("https://tarkov.dev/map/ground-zero-21");
  });
});
