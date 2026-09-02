import type { GameMap, Task } from "./types";

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

/**
 * Is this task worth showing when filtered to this map?
 *
 * Shared by the map picker and the filter itself so the two cannot drift apart and offer
 * a map that then matches nothing.
 */
export function taskIsOnMap(task: Task, mapId: string): boolean {
  return (
    task.map?.id === mapId ||
    task.objectives.some((objective) => objective.maps.some((m) => m.id === mapId)) ||
    task.neededKeys.some((group) => group.map?.id === mapId)
  );
}

/**
 * Maps worth offering in a picker: those with at least one task assigned to them.
 *
 * Assignment means `task.map`, not merely an objective mentioning the map. That
 * distinction is what removes the level-bracket variants — Ground Zero 21+ and Ground
 * Zero Tutorial are the same physical location as Ground Zero, and objectives there are
 * tagged with all three, so counting objective mentions would list the same map three
 * times. Same for The Lab (Dark), and Terminal has no tasks at all.
 *
 * Verified against live data: hiding those four leaves every task still reachable through
 * a map that remains.
 */
export function mapsWithTasks(
  maps: readonly GameMap[],
  tasks: readonly Task[],
): GameMap[] {
  const assigned = new Set<string>();
  for (const task of tasks) {
    if (task.map?.id) assigned.add(task.map.id);
  }
  return maps.filter((map) => assigned.has(map.id));
}
