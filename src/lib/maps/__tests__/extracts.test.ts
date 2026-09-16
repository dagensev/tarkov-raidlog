import { describe, expect, it } from "vitest";

import { foldedMapIds } from "@/lib/tarkovdev/maps";
import type { ExtractFaction, GameMap, MapExtract } from "@/lib/tarkovdev/types";
import { extractMarkers } from "../extracts";

const position = (x: number) => ({ x, y: 0, z: 0 });

function extract(id: string, name: string, patch: Partial<MapExtract> = {}): MapExtract {
  return {
    id,
    name,
    // The raw name the requirements table joins on. Equal to the display name unless a case
    // is specifically about the two differing.
    nameId: name,
    faction: "pmc" as ExtractFaction,
    position: position(0),
    outline: null,
    toll: null,
    ...patch,
  };
}

function map(id: string, normalizedName: string, extracts: MapExtract[]): GameMap {
  return {
    id,
    name: normalizedName,
    normalizedName,
    nameId: id,
    scenePath: null,
    wiki: null,
    raidDuration: null,
    players: null,
    enemies: null,
    description: null,
    extracts,
  };
}

/** Factory with Night Factory folded into it, as `resolveMap` hands it to the raid page. */
function factoryPair(nightExtracts: MapExtract[]): GameMap[] {
  return [
    map("f", "factory", [extract("f1", "Gate 0"), extract("f2", "Gate 3")]),
    { ...map("n", "night-factory", nightExtracts), name: "Night Factory" },
  ];
}

const fold = (maps: GameMap[]) => foldedMapIds(maps);

describe("extractMarkers", () => {
  it("returns one marker per extract, carrying what the card reads", () => {
    const maps = [
      map("customs", "customs", [
        extract("x1", "Old Gas Station Gate", { faction: "scav", position: position(300) }),
      ]),
    ];
    const markers = extractMarkers(maps, "customs", fold(maps));
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      kind: "extract",
      extractId: "x1",
      name: "Old Gas Station Gate",
      faction: "scav",
      position: position(300),
      onlyOn: null,
    });
  });

  it("ignores extracts belonging to another map", () => {
    const maps = [
      map("customs", "customs", [extract("x1", "RUAF Roadblock")]),
      map("woods", "woods", [extract("x2", "Outskirts")]),
    ];
    expect(extractMarkers(maps, "customs", fold(maps)).map((m) => m.extractId)).toEqual(["x1"]);
  });

  it("returns nothing for a map id the data does not publish", () => {
    const maps = [map("customs", "customs", [extract("x1", "RUAF Roadblock")])];
    expect(extractMarkers(maps, "ghost", fold(maps))).toEqual([]);
  });

  it("returns nothing for a map with no extracts", () => {
    // Also the shape a bundle cached before `stripMap` kept them denormalizes to, which is
    // why `denormalize` writes `?? []` rather than leaving it undefined.
    const maps = [map("terminal", "terminal", [])];
    expect(extractMarkers(maps, "terminal", fold(maps))).toEqual([]);
  });

  it("brings in an exit only the folded map publishes, labelled with that map", () => {
    const maps = factoryPair([extract("n9", "Cellars")]);
    const markers = extractMarkers(maps, "f", fold(maps));
    expect(markers).toHaveLength(3);
    expect(markers.find((m) => m.extractId === "n9")).toMatchObject({ onlyOn: "Night Factory" });
  });

  it("collapses a gate both halves publish, keeping this map's own entry", () => {
    // The live case: Night Factory republishes all nine of Factory's gates under different
    // ids, so matching on id would draw every one of them twice.
    const maps = factoryPair([
      extract("n1", "Gate 0", { faction: "scav" }),
      extract("n2", "Gate 3"),
    ]);
    const markers = extractMarkers(maps, "f", fold(maps));
    expect(markers).toHaveLength(2);
    expect(markers.map((m) => m.extractId)).toEqual(["f1", "f2"]);
    expect(markers[0]).toMatchObject({ faction: "pmc", onlyOn: null });
  });

  it("keeps two of this map's own exits that share a name", () => {
    // Factory really does publish two separate doors both called "Gate 3". Deduping within
    // a map rather than only across the folded pair would lose one of them.
    const maps = [map("f", "factory", [extract("f1", "Gate 3"), extract("f2", "Gate 3")])];
    expect(extractMarkers(maps, "f", fold(maps))).toHaveLength(2);
  });

  it("keeps two exits that share an id, which is how a gate open to both sides is published", () => {
    // Factory's "Gate 3", Woods' "UN Roadblock" and "Outskirts", Interchange's "NW Exfil":
    // one id, two entries, one per faction. Keying on the id alone drops one of each pair —
    // and React, which only warns about the duplicate key, decides which.
    const maps = [
      map("f", "factory", [
        extract("shared-id", "Gate 3", { faction: "pmc" }),
        extract("shared-id", "Gate 3", { faction: "scav" }),
      ]),
    ];
    const markers = extractMarkers(maps, "f", fold(maps));
    expect(markers).toHaveLength(2);
    expect(new Set(markers.map((m) => m.key)).size).toBe(2);
    expect(markers.map((m) => m.faction)).toEqual(["pmc", "scav"]);
  });

  it("does not bring in a map that folds somewhere else", () => {
    const maps = [
      map("customs", "customs", [extract("x1", "RUAF Roadblock")]),
      map("n", "night-factory", [extract("n1", "Gate 0")]),
      map("f", "factory", []),
    ];
    expect(extractMarkers(maps, "customs", fold(maps)).map((m) => m.extractId)).toEqual(["x1"]);
  });

  it("gives every marker a distinct key, across the folded pair as well", () => {
    const maps = factoryPair([extract("n9", "Cellars"), extract("n8", "Camera Bunker Door")]);
    const keys = extractMarkers(maps, "f", fold(maps)).map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("carries the conditions the requirements table lists for this exit", () => {
    // Joined on the raw name and the map's normalizedName, not the translated name: the game
    // calls Reserve's cliff exit `Alpinist` and tarkov.dev shows it as "Cliff Descent".
    const maps = [
      map("reserve", "reserve", [extract("x1", "Cliff Descent", { nameId: "Alpinist" })]),
    ];
    const [marker] = extractMarkers(maps, "reserve", fold(maps));
    expect(marker.conditions.map((c) => c.label)).toEqual(["red rebel + paracord", "no body armour"]);
  });

  it("leaves an ordinary exit with no conditions", () => {
    const maps = [map("reserve", "reserve", [extract("x1", "Heating Pipe", { nameId: "Exit2" })])];
    expect(extractMarkers(maps, "reserve", fold(maps))[0].conditions).toEqual([]);
  });

  it("does not match a raw name against the wrong map", () => {
    // `Alpinist` is a Reserve exit. The same name on another map must not inherit its rules.
    const maps = [map("customs", "customs", [extract("x1", "Cliff Descent", { nameId: "Alpinist" })])];
    expect(extractMarkers(maps, "customs", fold(maps))[0].conditions).toEqual([]);
  });

  it("names the toll through the resolver", () => {
    const maps = [
      map("customs", "customs", [
        extract("x1", "Dorms V-Ex", { toll: { itemId: "roubles", count: 20000 } }),
      ]),
    ];
    const [marker] = extractMarkers(maps, "customs", fold(maps), (id) =>
      id === "roubles" ? "Roubles" : null,
    );
    expect(marker.toll).toEqual({ itemId: "roubles", count: 20000, name: "Roubles" });
  });

  it("keeps the count with no name until the item catalogue lands", () => {
    const maps = [
      map("customs", "customs", [
        extract("x1", "Dorms V-Ex", { toll: { itemId: "roubles", count: 20000 } }),
      ]),
    ];
    expect(extractMarkers(maps, "customs", fold(maps))[0].toll).toEqual({
      itemId: "roubles",
      count: 20000,
      name: null,
    });
  });

  it("carries an outline through, and null where there is none", () => {
    const outline = [position(0), position(1), position(2)];
    const maps = [
      map("customs", "customs", [extract("x1", "A", { outline }), extract("x2", "B")]),
    ];
    const markers = extractMarkers(maps, "customs", fold(maps));
    expect(markers[0].outline).toEqual(outline);
    expect(markers[1].outline).toBeNull();
  });
});
