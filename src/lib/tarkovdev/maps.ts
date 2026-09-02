import type { GameMap } from "./types";

/**
 * Turning what the game logs into a tarkov.dev map.
 *
 * Both log signals match a field the API already publishes, so this is exact lookup
 * rather than a maintained table of guesses:
 *
 *  - `scene preset path:maps/customs_preset.bundle` (application log) matches
 *    `GameMap.scenePath` verbatim.
 *  - `location: "Shoreline"` (the `UserConfirmed` payload) matches `GameMap.nameId`,
 *    which is BSG's internal location id — including the ones that look nothing like the
 *    map's name, such as `bigmap` for Customs.
 *
 * An earlier version of this file hardcoded the mapping and got two cases wrong that the
 * API data settles: `sandbox_start_preset` is Ground Zero *Tutorial*, not Ground Zero, and
 * `factory_night_preset` is *Night Factory*, a separate map from Factory.
 */

export interface MapHint {
  /** Scene bundle name from the log, with or without the `maps/` prefix and `.bundle` suffix. */
  scene?: string;
  /** BSG location id from the `UserConfirmed` payload. */
  location?: string;
}

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Reduce a scene path to its bare bundle name: `maps/customs_preset.bundle` -> `customs_preset`. */
export function sceneKey(scene: string): string {
  return scene
    .toLowerCase()
    .replace(/^.*\//, "")
    .replace(/\.bundle$/, "");
}

/**
 * Find the map a log hint refers to.
 *
 * Returns undefined rather than guessing: pointing at the wrong map mid-raid is worse
 * than admitting we do not recognise it, and an unmatched scene is worth surfacing so the
 * cause can be found.
 */
export function resolveMap(maps: readonly GameMap[], hint: MapHint): GameMap | undefined {
  if (hint.scene) {
    const wanted = sceneKey(hint.scene);
    const match = maps.find((map) => map.scenePath && sceneKey(map.scenePath) === wanted);
    if (match) return match;
  }

  if (hint.location) {
    const wanted = normalize(hint.location);
    const byNameId = maps.find((map) => map.nameId && normalize(map.nameId) === wanted);
    if (byNameId) return byNameId;
    // Some location values are already the display name.
    const byName = maps.find(
      (map) => normalize(map.name) === wanted || normalize(map.normalizedName) === wanted,
    );
    if (byName) return byName;
  }

  return undefined;
}

/** True when the API knows this scene. A false here means the log saw a map we cannot name. */
export function isKnownScene(maps: readonly GameMap[], scene: string): boolean {
  const wanted = sceneKey(scene);
  return maps.some((map) => map.scenePath && sceneKey(map.scenePath) === wanted);
}

/** Link to the map on tarkov.dev, using the slug the API supplies. */
export function tarkovDevMapUrl(map: GameMap): string {
  return `https://tarkov.dev/map/${map.normalizedName}`;
}
