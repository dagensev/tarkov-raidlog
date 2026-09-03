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
 * An earlier version of this file hardcoded the mapping and got a case wrong that the API
 * data settles: `sandbox_start_preset` is Ground Zero *Tutorial*, not Ground Zero.
 */

export interface MapHint {
  /** Scene bundle name from the log, with or without the `maps/` prefix and `.bundle` suffix. */
  scene?: string;
  /** BSG location id from the `UserConfirmed` payload. */
  location?: string;
}

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Maps that are another map in different conditions, and are shown as that map.
 *
 * tarkov.dev publishes Night Factory as its own map because BSG does — separate location
 * id, separate scene bundle, separate task list. It is still the same building, and
 * carrying both meant two Factory entries in every picker.
 *
 * Folding has to happen on the references as well as the list, not just by hiding the
 * entry. One task is *assigned* to Night Factory — Health Care Privacy - Part 5, whose
 * objectives are stashing gunpowder at the drop spot on night-time Factory — and 4 of the
 * 38 tasks with a Night Factory objective are not also tagged Factory. Hiding the map
 * without folding its references would drop those out of map filtering entirely.
 *
 * Keyed by `normalizedName` rather than id: it reads as what it is, and both come
 * straight from the API.
 */
const FOLDED_INTO: Readonly<Record<string, string>> = {
  "night-factory": "factory",
};

/** True when this map is shown as some other map rather than in its own right. */
export function isFoldedMap(map: Pick<GameMap, "normalizedName">): boolean {
  return map.normalizedName in FOLDED_INTO;
}

/**
 * Map ids that should be rewritten, as `id -> id it is shown as`.
 *
 * Built once and reused: denormalization runs this against every map reference on every
 * task, and there are some 1400 objectives.
 */
export function foldedMapIds(
  maps: readonly Pick<GameMap, "id" | "normalizedName">[],
): Map<string, string> {
  const idByName = new Map(maps.map((map) => [map.normalizedName, map.id]));
  const folded = new Map<string, string>();
  for (const map of maps) {
    const into = FOLDED_INTO[map.normalizedName];
    const target = into ? idByName.get(into) : undefined;
    // A fold whose target the API did not publish is dropped rather than applied, so a
    // renamed map leaves the reference alone instead of pointing it at nothing.
    if (target && target !== map.id) folded.set(map.id, target);
  }
  return folded;
}

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
  // Detection stays exact — a night raid is matched on its own scene bundle — and the
  // fold is applied to the answer, so queueing night Factory lands on Factory.
  const fold = (map: GameMap): GameMap => {
    const into = foldedMapIds(maps).get(map.id);
    return (into ? maps.find((m) => m.id === into) : undefined) ?? map;
  };

  if (hint.scene) {
    const wanted = sceneKey(hint.scene);
    const match = maps.find((map) => map.scenePath && sceneKey(map.scenePath) === wanted);
    if (match) return fold(match);
  }

  if (hint.location) {
    const wanted = normalize(hint.location);
    const byNameId = maps.find((map) => map.nameId && normalize(map.nameId) === wanted);
    if (byNameId) return fold(byNameId);
    // Some location values are already the display name.
    const byName = maps.find(
      (map) => normalize(map.name) === wanted || normalize(map.normalizedName) === wanted,
    );
    if (byName) return fold(byName);
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
 *
 * Folded maps are excluded too. Their task references are rewritten upstream, so nothing
 * is assigned to them by the time this runs — but saying so here keeps the picker honest
 * if that ever stops being true.
 */
export function mapsWithTasks(
  maps: readonly GameMap[],
  tasks: readonly Task[],
): GameMap[] {
  const assigned = new Set<string>();
  for (const task of tasks) {
    if (task.map?.id) assigned.add(task.map.id);
  }
  return maps.filter((map) => assigned.has(map.id) && !isFoldedMap(map));
}
