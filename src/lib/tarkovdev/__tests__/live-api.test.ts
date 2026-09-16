import { describe, expect, it } from "vitest";

import { FUEL_TANKS } from "@/lib/crafts/fuel";
import { craftUnlockIndex } from "@/lib/crafts/unlocks";
import { CATEGORY_CHIPS, matchesChip } from "@/lib/sell/filters";
import { buildKeepList } from "@/lib/sell/keep-list";

import {
  denormalize,
  loadCoreBundle,
  loadItemCatalogue,
  referencedItemIds,
  type CoreBundle,
  type SellIndex,
} from "../client";
import {
  CURRENCY_ITEM_IDS,
  economyItemIds,
  loadEconomyBundle,
  type EconomyBundle,
} from "../economy";
import { calibrationFor } from "@/lib/maps/calibration";
import { EXTRACT_REQUIREMENTS } from "@/lib/maps/extract-requirements";
import { extractMarkers } from "@/lib/maps/extracts";
import { project } from "@/lib/maps/project";

import { foldedMapIds, mapsWithTasks, resolveMap, taskIsOnMap } from "../maps";

/**
 * Checks the real tarkov.dev JSON API.
 *
 * Everything else in this suite runs against fixtures, which proves the reshaping is
 * self-consistent but not that it matches what the API actually sends. This one talks to
 * the live service, and self-skips when it is unreachable so an outage or an offline
 * machine does not fail the build.
 *
 * Set `SKIP_LIVE_API=1` to skip it deliberately.
 */

const skip = process.env.SKIP_LIVE_API === "1";

async function probe(): Promise<CoreBundle | null> {
  if (skip) return null;
  try {
    return await loadCoreBundle("pvp-season", { attempts: 1, backoffMs: 0 });
  } catch {
    return null;
  }
}

const bundle = await probe();

describe.skipIf(!bundle)("live tarkov.dev JSON API", () => {
  it("returns a full task list", () => {
    expect(Object.keys(bundle!.tasks).length).toBeGreaterThan(300);
  });

  it("resolves task names through the translation document", () => {
    // The raw documents give `"<id> name"`; readable text only exists in `<path>_en`.
    const data = denormalize(bundle!);
    const named = data.tasks.filter((t) => t.name && !/^[0-9a-f]{24} name$/.test(t.name));
    expect(named.length).toBe(data.tasks.length);

    const known = data.tasks.find((t) => t.normalizedName === "first-in-line");
    expect(known?.name).toBe("First in Line");
  });

  it("resolves objective descriptions, not translation keys", () => {
    const data = denormalize(bundle!);
    const objectives = data.tasks.flatMap((t) => t.objectives);
    const unresolved = objectives.filter((o) => /^[0-9a-f]{24}$/.test(o.description));
    expect(unresolved.length).toBe(0);
    expect(objectives.length).toBeGreaterThan(500);
  });

  it("carries the wiki link and Kappa flag the UI shows", () => {
    const data = denormalize(bundle!);
    expect(data.tasks.filter((t) => t.wikiLink?.startsWith("https://")).length).toBeGreaterThan(
      300,
    );
    // Only a handful of tasks are Kappa-required in the seasonal mode -- 13 at the time
    // of writing -- so this asserts the flag is populated, not that it is common.
    const kappa = data.tasks.filter((t) => t.kappaRequired).length;
    expect(kappa).toBeGreaterThan(0);
    expect(kappa).toBeLessThan(data.tasks.length);
  });

  it("carries needed keys, which the raid board turns into a packing list", () => {
    const data = denormalize(bundle!);
    const withKeys = data.tasks.filter((t) => t.neededKeys.some((g) => g.keys.length > 0));
    expect(withKeys.length).toBeGreaterThan(10);
    expect(referencedItemIds(bundle!.tasks).length).toBeGreaterThan(20);
  });

  it("expands trader and map references to real names", () => {
    const data = denormalize(bundle!);
    const traders = new Set(data.tasks.map((t) => t.trader?.name).filter(Boolean));
    expect(traders).toContain("Prapor");
    expect(data.maps.map((m) => m.name)).toContain("Customs");
  });

  it("resolves every scene name seen in this machine's real logs", () => {
    // The exact `scene preset path:` values found in the log history. This is the check
    // that the log signal and the API field genuinely line up.
    const scenes = [
      "maps/customs_preset.bundle",
      "maps/shopping_mall.bundle",
      "maps/factory_day_preset.bundle",
      "maps/shoreline_preset.bundle",
      "maps/woods_preset.bundle",
      "maps/rezerv_base_preset.bundle",
      "maps/sandbox_preset.bundle",
      "maps/sandbox_start_preset.bundle",
      "maps/sandbox_high_preset.bundle",
    ];
    const maps = denormalize(bundle!).maps;
    for (const scene of scenes) {
      expect(resolveMap(maps, { scene })?.name, scene).toBeTruthy();
    }
  });

  it("resolves the location ids seen in this machine's real logs", () => {
    const maps = denormalize(bundle!).maps;
    expect(resolveMap(maps, { location: "Shoreline" })?.name).toBe("Shoreline");
    expect(resolveMap(maps, { location: "Interchange" })?.name).toBe("Interchange");
  });

  it("offers only maps that have tasks, and orphans none by doing so", () => {
    const data = denormalize(bundle!);
    const pickable = mapsWithTasks(data.maps, data.tasks);

    // Level-bracket variants share objectives with the base map, so listing them would
    // show the same physical location several times over.
    const names = pickable.map((m) => m.name);
    expect(names).toContain("Ground Zero");
    expect(names).not.toContain("Ground Zero 21+");
    expect(names).not.toContain("Ground Zero Tutorial");
    expect(names.length).toBeLessThan(data.maps.length);

    // Every map offered matches at least one task, and no task is reachable only
    // through a map that was dropped.
    for (const map of pickable) {
      expect(data.tasks.some((t) => taskIsOnMap(t, map.id)), map.name).toBe(true);
    }
    const orphaned = data.tasks.filter(
      (t) =>
        data.maps.some((m) => taskIsOnMap(t, m.id)) &&
        !pickable.some((m) => taskIsOnMap(t, m.id)),
    );
    expect(orphaned.map((t) => t.name)).toEqual([]);
  });

  it("shows Night Factory as Factory without stranding its tasks", () => {
    const data = denormalize(bundle!);
    const pickable = mapsWithTasks(data.maps, data.tasks);
    expect(pickable.map((m) => m.name)).not.toContain("Night Factory");

    // BSG assigns exactly one task to the night variant, and 4 of the 38 tasks with a
    // Night Factory objective are not also tagged Factory. Folding the references is
    // what keeps them under Factory; merely hiding the map would lose them.
    const factory = pickable.find((m) => m.name === "Factory");
    expect(factory).toBeDefined();
    const nightOnly = data.tasks.find((t) => t.normalizedName === "health-care-privacy-part-5");
    expect(nightOnly?.map?.name).toBe("Factory");
    expect(taskIsOnMap(nightOnly!, factory!.id)).toBe(true);

    // No task still points at the folded map.
    const nightMap = data.maps.find((m) => m.normalizedName === "night-factory");
    expect(nightMap).toBeDefined();
    expect(data.tasks.filter((t) => taskIsOnMap(t, nightMap!.id))).toEqual([]);

    // Detection still recognises the night bundle exactly; it just answers with Factory.
    expect(resolveMap(data.maps, { scene: "maps/factory_night_preset.bundle" })?.name).toBe(
      "Factory",
    );
  });

  it("keeps extracts through the strip, which is the one piece of geometry that survives", () => {
    const total = Object.values(bundle!.maps).reduce((n, map) => n + (map.extracts?.length ?? 0), 0);
    // 152 across 17 maps when this was written. A floor well under that catches the field
    // being dropped again without failing every time BSG adds or removes a door.
    expect(total).toBeGreaterThan(140);
  });

  it("resolves extract names through the maps translation document", () => {
    // "Old Azs Gate" is a misspelled key that happens to read as English, which is exactly
    // why the lookup cannot be skipped: without it the app ships tarkov.dev's typo.
    const data = denormalize(bundle!);
    const customs = data.maps.find((m) => m.normalizedName === "customs");
    expect(customs!.extracts.map((e) => e.name)).toContain("Old Gas Station Gate");
    expect(customs!.extracts.every((e) => e.name.length > 0)).toBe(true);
  });

  it("projects extract positions onto the drawings they are marked on", () => {
    // What catches a bounds or rotation regression breaking every marker at once, the way
    // `live-svg.test.ts` catches a redrawn map.
    //
    // Asserted two ways rather than as a per-map ratio, because a per-map floor would have
    // to be set low enough for Ground Zero, which really does publish three exits far
    // outside the drawn area — UN Roadblock at x=-527 against bounds that stop at -99, and
    // East Gate 340 metres past the other end — while every one of its spawns sits inside.
    // That is upstream data, not a calibration fault, and the overlay already drops anything
    // out of range. So: no map may lose *all* its markers, which is what a broken rotation
    // looks like, and the whole set must stay overwhelmingly on the map. Measured 122 of 129
    // inside when this was written, the seven being Ground Zero's three and four single
    // exits sitting within 1.5% of an edge.
    const data = denormalize(bundle!);
    const folded = foldedMapIds(data.maps);
    let total = 0;
    let onMap = 0;
    const empty: string[] = [];

    for (const map of data.maps) {
      const calibration = calibrationFor(map);
      const markers = extractMarkers(data.maps, map.id, folded);
      if (!calibration || markers.length === 0) continue;
      const inside = markers.filter((marker) => {
        const { u, v } = project(calibration, marker.position);
        return u >= 0 && u <= 1 && v >= 0 && v <= 1;
      }).length;
      total += markers.length;
      onMap += inside;
      // Named rather than counted, so a failure says which map drifted.
      if (inside === 0) empty.push(map.normalizedName);
    }

    expect(empty).toEqual([]);
    expect(total).toBeGreaterThan(100);
    expect(onMap / total).toBeGreaterThan(0.85);
  });

  it("has a requirements table whose every entry still matches a published exit", () => {
    // The table is vendored from the game's own config, so nothing upstream keeps it honest.
    // This does: a renamed or removed exit turns into a key that matches nothing, which is a
    // condition silently not being shown rather than a visible break. Named rather than
    // counted, so the failure says which entry went stale.
    const data = denormalize(bundle!);
    const orphans: string[] = [];

    for (const [mapName, exits] of Object.entries(EXTRACT_REQUIREMENTS)) {
      const map = data.maps.find((m) => m.normalizedName === mapName);
      if (!map) {
        orphans.push(`${mapName} (no such map)`);
        continue;
      }
      const published = new Set(map.extracts.map((extract) => extract.nameId));
      for (const nameId of Object.keys(exits)) {
        if (!published.has(nameId)) orphans.push(`${mapName}/${nameId}`);
      }
    }

    expect(orphans).toEqual([]);
  });

  it("still gates the exits the table says it gates", () => {
    // A spot check on the join rather than on the table's contents: these three are the ones
    // worth getting wrong-proof, since walking to a cliff without a Red Rebel costs the raid.
    const data = denormalize(bundle!);
    const folded = foldedMapIds(data.maps);
    const labels = (mapName: string, displayName: string) => {
      const map = data.maps.find((m) => m.normalizedName === mapName)!;
      const marker = extractMarkers(data.maps, map.id, folded).find((m) => m.name === displayName);
      return marker?.conditions.map((c) => c.label) ?? null;
    };

    expect(labels("reserve", "Cliff Descent")).toEqual(["red rebel + paracord", "no body armour"]);
    expect(labels("reserve", "Sewer Manhole")).toEqual(["no backpack"]);
    expect(labels("interchange", "Saferoom Exfil")).toEqual(["lock yourself in"]);
  });

  it("reports what the live API returned", () => {
    const data = denormalize(bundle!);
    const keys = referencedItemIds(bundle!.tasks).length;
    console.log(
      [
        "",
        `  mode          ${bundle!.mode}`,
        `  tasks         ${data.tasks.length}`,
        `  maps          ${data.maps.length}`,
        `  traders       ${data.traders.length}`,
        `  objectives    ${data.tasks.reduce((n, t) => n + t.objectives.length, 0)}`,
        `  kappa tasks   ${data.tasks.filter((t) => t.kappaRequired).length}`,
        `  key items     ${keys}`,
        `  extracts      ${data.maps.reduce((n, m) => n + m.extracts.length, 0)}`,
        `  gated exits   ${Object.values(EXTRACT_REQUIREMENTS).reduce((n, m) => n + Object.keys(m).length, 0)}`,
        `  map names     ${data.maps.map((m) => m.name).join(", ")}`,
        `  pickable maps ${mapsWithTasks(data.maps, data.tasks).map((m) => m.name).join(", ")}`,
        "",
      ].join("\n"),
    );
    expect(data.tasks.length).toBeGreaterThan(0);
  });
});

/**
 * The economy documents, probed separately so an outage in one does not skip the other.
 */
async function probeEconomy(): Promise<EconomyBundle | null> {
  if (skip) return null;
  try {
    return await loadEconomyBundle("pvp-season", { attempts: 1, backoffMs: 0 });
  } catch {
    return null;
  }
}

const economy = await probeEconomy();

describe.skipIf(!economy || !bundle)("live economy documents", () => {
  it("returns every hideout station", () => {
    expect(economy!.stations.length).toBeGreaterThanOrEqual(20);
  });

  it("resolves station names through the translation document", () => {
    // Left unresolved these read `hideout_area_12_name`, which is what the raw doc holds.
    const unresolved = economy!.stations.filter((s) => s.name.startsWith("hideout_area_"));
    expect(unresolved).toEqual([]);
  });

  it("returns barters and crafts", () => {
    expect(economy!.barters.length).toBeGreaterThan(400);
    expect(economy!.crafts.length).toBeGreaterThan(100);
  });

  it("gives every craft a duration, which is what profit per hour divides by", () => {
    const timeless = economy!.crafts.filter((craft) => craft.durationSeconds <= 0);
    expect(timeless.map((craft) => craft.id)).toEqual([]);
  });

  it("still finds the crafts the calculator badges as locked", () => {
    // 33 behind a task and one behind a game edition at time of writing. A count of zero
    // would mean the filter chips silently narrow nothing.
    expect(economy!.crafts.filter((craft) => craft.taskUnlock).length).toBeGreaterThan(10);
    expect(economy!.crafts.filter((craft) => craft.gameEditions.length > 0).length).toBeGreaterThan(0);
  });

  it("keeps a fractional ingredient count unrounded", () => {
    // Purified water asks for 0.66 of a water filter. Costing the ceilinged count would
    // overstate that craft by half.
    const fractional = economy!.crafts.flatMap((craft) =>
      craft.requiredItems.filter((line) => line.exactCount !== Math.ceil(line.exactCount)),
    );
    expect(fractional.length).toBeGreaterThan(0);
    expect(fractional.every((line) => line.count === Math.ceil(line.exactCount))).toBe(true);
  });

  it("names a real craft for every task that unlocks one, so a dropped gate can be put back", () => {
    // tarkov.dev's crafts document drops a quest gate its importer cannot match. The tasks
    // side is what restores it, and that only works while each unlock names a craft.
    const unlocks = craftUnlockIndex(bundle!.tasks);
    expect(unlocks.size).toBeGreaterThan(10);
    const crafts = new Set(
      economy!.crafts.map((craft) => `${craft.stationId}:${craft.productItem.itemId}`),
    );
    expect([...unlocks.keys()].filter((key) => !crafts.has(key))).toEqual([]);
  });

  it("points every craft at a station the hideout document contains", () => {
    const known = new Set(economy!.stations.map((s) => s.id));
    const orphans = economy!.crafts.filter((c) => !known.has(c.stationId)).map((c) => c.id);
    expect(orphans).toEqual([]);
  });

  it("never reports money as an item something wants", () => {
    // The Library alone asks for 400,000 roubles, and there is no `currency` item type
    // to spot that with, so the exclusion is by id and worth pinning against live data.
    const ids = economyItemIds(economy!);
    expect(ids.filter((id) => CURRENCY_ITEM_IDS.has(id))).toEqual([]);
  });

  it("still has at least one sellItem objective listing over a hundred alternatives", () => {
    // This is the trap `CONSUMING_OBJECTIVES` exists for. If it ever stops being true the
    // exclusion is no longer load-bearing and the keep list should be re-measured.
    const widest = Object.values(bundle!.tasks)
      .flatMap((task) => task.objectives ?? [])
      .filter((objective) => objective.type === "sellItem")
      .reduce((most, objective) => Math.max(most, (objective.items ?? []).length), 0);
    expect(widest).toBeGreaterThan(100);
  });

  it("keeps the keep list to a plausible slice of the catalogue", () => {
    // A canary on an upstream shape change: measured at 1037 of 5320 items. Either bound
    // being crossed means a document changed shape, not that the game changed.
    const keep = buildKeepList({
      tasks: denormalize(bundle!).tasks,
      taskStates: new Map(),
      economy: economy!,
      hideoutLevels: {},
    });
    expect(keep.size).toBeGreaterThan(800);
    expect(keep.size).toBeLessThan(1400);
  });
});

/**
 * The item catalogue, probed separately again — it is the 16.7 MB document, and it is the
 * one the flea tab is built out of.
 */
async function probeCatalogue(): Promise<SellIndex | null> {
  if (skip) return null;
  try {
    const { sell } = await loadItemCatalogue("pvp-season", [], { attempts: 1, backoffMs: 0 });
    return sell;
  } catch {
    return null;
  }
}

const catalogue = await probeCatalogue();

describe.skipIf(!catalogue)("live item catalogue", () => {
  const items = () => Object.values(catalogue!.items);

  it("returns the whole catalogue with presets dropped", () => {
    // Measured at 4835 of the 5320 the document holds.
    expect(items().length).toBeGreaterThan(4000);
    expect(items().filter((item) => item.types.includes("preset"))).toEqual([]);
  });

  it("carries a buy offer for the items traders stock", () => {
    // Measured at 2399. The column is blank for everything else, which is correct and is
    // why the count matters: a shape change upstream would read the same as a quiet game
    // change, and this says which.
    const buyable = items().filter((item) => item.buyOffers.length > 0);
    expect(buyable.length).toBeGreaterThan(1800);
    expect(buyable.every((item) => item.buyOffers[0].priceRUB > 0)).toBe(true);
  });

  it("carries the loyalty level on buy offers and never on sell offers", () => {
    // Traders buy your loot whatever your standing, so a level on that side would be a
    // field the row is not entitled to show.
    const gated = items().filter((item) => item.buyOffers.some((each) => each.minTraderLevel));
    expect(gated.length).toBeGreaterThan(1000);
    expect(items().filter((item) => item.bestTrader?.minTraderLevel)).toEqual([]);
  });

  it("quotes at least one trader in a currency that is not roubles", () => {
    // Peacekeeper. Losing this would silently turn his prices into rouble conversions
    // that do not match the number on his screen.
    const foreign = items().filter((item) => item.buyOffers.some((each) => each.currency !== "RUB"));
    expect(foreign.length).toBeGreaterThan(100);
    const quoted = foreign[0].buyOffers.find((each) => each.currency !== "RUB")!;
    expect(quoted.price).not.toBe(quoted.priceRUB);
  });

  it("orders every buy offer list cheapest first", () => {
    // The crafts calculator walks this list to find the cheapest offer within reach of a
    // loyalty level, and stops at the first match.
    const unsorted = items().filter((item) =>
      item.buyOffers.some((each, i) => i > 0 && each.priceRUB < item.buyOffers[i - 1].priceRUB),
    );
    expect(unsorted.map((item) => item.id)).toEqual([]);
  });

  it("carries the capacity of both generator fuel tanks", () => {
    // The crafts calculator divides a tank's price by this to price an hour of generator
    // time. Losing it would silently make fuel free.
    const tanks = FUEL_TANKS.map((tank) => catalogue!.items[tank.itemId]);
    expect(tanks.map((item) => item?.resourceUnits)).toEqual([100, 60]);
  });

  it("carries listing fee rates that are neither missing nor zero", () => {
    // The fallback in the client would hide a document that stopped carrying these, and
    // the profit column would quietly go back to being the raw price difference.
    expect(catalogue!.fleaMarket.sellOfferFeeRate).toBeGreaterThan(0);
    expect(catalogue!.fleaMarket.sellRequirementFeeRate).toBeGreaterThan(0);
  });

  it("resolves every category chip to a non-empty set of items", () => {
    // The chips name categories by their normalized name, so a rename upstream shows up
    // as a chip that silently matches nothing rather than as an error.
    const empty = CATEGORY_CHIPS.filter(
      (chip) => !items().some((item) => matchesChip(item, chip)),
    );
    expect(empty.map((chip) => chip.id)).toEqual([]);
  });

  it("keeps the handbook side to roots, which is what the chips match on", () => {
    // An item lists its leaf and its root; keeping both would make "Keys" and
    // "Mechanical keys" two chips that mean the same thing.
    const roots = new Set(items().flatMap((item) => item.handbook));
    expect(roots.size).toBeLessThanOrEqual(20);
    expect(roots).toContain("keys");
    expect(roots).not.toContain("mechanical-keys");
  });

  it("reports what the catalogue returned", () => {
    const withFlea = items().filter((item) => !item.noFlea && (item.avg24hPrice ?? item.lastLowPrice));
    const counts = CATEGORY_CHIPS.map(
      (chip) => `${chip.label} ${items().filter((item) => matchesChip(item, chip)).length}`,
    );
    console.log(
      [
        "",
        `  items         ${items().length}`,
        `  with a price  ${withFlea.length}`,
        `  buyable       ${items().filter((item) => item.buyOffers.length > 0).length}`,
        `  fee rates     ${catalogue!.fleaMarket.sellOfferFeeRate} / ${catalogue!.fleaMarket.sellRequirementFeeRate}`,
        `  chips         ${counts.join(", ")}`,
        "",
      ].join("\n"),
    );
    expect(items().length).toBeGreaterThan(0);
  });
});
