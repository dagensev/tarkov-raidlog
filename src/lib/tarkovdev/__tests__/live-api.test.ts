import { describe, expect, it } from "vitest";

import { denormalize, loadCoreBundle, referencedItemIds, type CoreBundle } from "../client";
import { mapsWithTasks, resolveMap, taskIsOnMap } from "../maps";

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
        `  map names     ${data.maps.map((m) => m.name).join(", ")}`,
        `  pickable maps ${mapsWithTasks(data.maps, data.tasks).map((m) => m.name).join(", ")}`,
        "",
      ].join("\n"),
    );
    expect(data.tasks.length).toBeGreaterThan(0);
  });
});
