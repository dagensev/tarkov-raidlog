import type { GamePosition, Task } from "@/lib/tarkovdev/types";

/**
 * Objectives to draw on one map.
 *
 * Flattened to one entry per thing drawn rather than per objective, because an objective
 * can name several zones and a quest item several candidate spots, and each of those is
 * its own mark on the map.
 */

export interface ObjectivePin {
  /** Stable and unique across a map's pins, for React keys. */
  key: string;
  taskId: string;
  taskName: string;
  objectiveId: string;
  description: string;
  /** `zone` is somewhere an objective happens; `location` is a candidate spot for an item. */
  kind: "zone" | "location";
  position: GamePosition;
  /** Footprint polygon, where the zone publishes one. */
  outline: GamePosition[] | null;
}

/**
 * Pins for one map, from the tasks you are holding.
 *
 * `folded` must be `foldedMapIds(maps)`. Without it every Night Factory objective vanishes:
 * the app shows Night Factory as Factory and rewrites task references accordingly, but the
 * ids inside `zone.map` are raw API data and still say `night-factory` — 64 pins across 20
 * tasks, on a map that is only ever displayed as Factory.
 */
export function objectivePins(
  tasks: readonly Task[],
  mapId: string,
  folded: ReadonlyMap<string, string>,
): ObjectivePin[] {
  const shownAs = (id: string): string => folded.get(id) ?? id;
  const pins: ObjectivePin[] = [];

  for (const task of tasks) {
    for (const objective of task.objectives) {
      // tarkov.dev reuses one zone.id across several entries to express candidate spots for
      // the same zone (e.g. 19 "Wrong_wheels" zones, one per position), so zone.id alone isn't
      // unique within an objective. Fold in the zone's index to keep keys distinct; zone.id
      // stays in the key too, for readability when debugging.
      // Prefix with task.id because the same objective id can belong to several tasks.
      for (const [zoneIndex, zone] of objective.zones.entries()) {
        if (shownAs(zone.map) !== mapId) continue;
        pins.push({
          key: `${task.id}:${objective.id}:zone:${zoneIndex}:${zone.id}`,
          taskId: task.id,
          taskName: task.name,
          objectiveId: objective.id,
          description: objective.description,
          kind: "zone",
          position: zone.position,
          outline: zone.outline,
        });
      }

      // A counter that runs across every possibleLocations entry, not one that resets per
      // entry: an objective can have several entries on the same map, and an index restarted
      // per entry would collide with itself.
      // Prefix with task.id because the same objective id can belong to several tasks.
      let locationIndex = 0;
      for (const entry of objective.possibleLocations) {
        if (shownAs(entry.map) !== mapId) continue;
        for (const position of entry.positions) {
          pins.push({
            key: `${task.id}:${objective.id}:loc:${entry.map}:${locationIndex}`,
            taskId: task.id,
            taskName: task.name,
            objectiveId: objective.id,
            description: objective.description,
            kind: "location",
            position,
            outline: null,
          });
          locationIndex++;
        }
      }
    }
  }

  return pins;
}
