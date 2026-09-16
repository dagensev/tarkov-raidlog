import type { ExtractFaction, GameMap, GamePosition, MapExtract } from "@/lib/tarkovdev/types";
import { extractConditions, type ExtractCondition } from "./extract-requirements";

/**
 * Ways out of one map.
 *
 * The sibling of `pins.ts`, and shaped the same way for the same reason: one entry per
 * thing drawn, flattened ahead of the overlay so the component holds no map knowledge.
 *
 * Where it differs is the fold. A task's zones name the map they are on, so `pins.ts`
 * rewrites that reference and Night Factory's objectives land on Factory. An extract has
 * no such reference — it hangs off the map document itself — so folding has to mean
 * *merging* one map's list into another's.
 */

/** The toll, with the item named where the catalogue has arrived to name it. */
export interface ExtractTollDisplay {
  itemId: string;
  count: number;
  /** Null until the 16.7 MB item catalogue lands. The count alone is still worth showing. */
  name: string | null;
}

export interface ExtractMarker {
  /** Stable and unique across a map's markers, for React keys. */
  key: string;
  /**
   * Discriminates against `ObjectivePin["kind"]`, which is `zone` | `location`. The two
   * share the overlay's single hover/selection slot, so one field has to narrow both.
   */
  kind: "extract";
  extractId: string;
  name: string;
  faction: ExtractFaction;
  position: GamePosition;
  outline: GamePosition[] | null;
  toll: ExtractTollDisplay | null;
  /**
   * What this exit asks for beyond walking into it — a Red Rebel, an empty backpack slot,
   * the generator running. Empty for most of them.
   *
   * Joined here rather than in `denormalize` so the tarkov.dev layer stays free of game
   * trivia it cannot source, and so the table sits beside `calibration.ts`, which is
   * vendored for the same reason.
   */
  conditions: readonly ExtractCondition[];
  /**
   * Set only for an exit brought in from a map folded into this one, named by that map —
   * "Night Factory". Null for this map's own exits.
   */
  onlyOn: string | null;
}

/** Item id to display name. Returns null for an id the catalogue cannot name yet. */
export type ItemNamer = (id: string) => string | null;

/**
 * Every way out of one map, including any brought in from a map folded into it.
 *
 * `folded` must be `foldedMapIds(maps)`, the same argument `objectivePins` takes.
 *
 * On the fold: a night raid resolves to the Factory document, so without this Factory's
 * ten daytime exits would be the only ones drawn. That matters more than an extra marker
 * does — a drawn door that is not there is the one mistake a player acts on mid-raid.
 *
 * Checked against live data: Night Factory publishes the same nine gates as Factory under
 * entirely different ids, so today the merge adds nothing and the dedupe removes all nine.
 * It earns its keep if that ever stops being true, when a night-only exit appears as an
 * extra marker labelled "Night Factory" rather than not appearing at all.
 *
 * The dedupe is on the translated name, because the ids cannot help — the two documents
 * give the same physical gate different GUIDs, so there is nothing else to match on. And
 * it runs only *across* the pair, never within one map: Factory publishes two separate
 * doors both called "Gate 3", and collapsing those would lose a real exit.
 */
export function extractMarkers(
  maps: readonly GameMap[],
  mapId: string,
  folded: ReadonlyMap<string, string>,
  itemName: ItemNamer = () => null,
): ExtractMarker[] {
  const target = maps.find((map) => map.id === mapId);
  if (!target) return [];

  // tarkov.dev reuses one extract id across the PMC and Scav halves of the same gate, the
  // same way it reuses zone ids in `pins.ts` — Factory's "Gate 3", Woods' "UN Roadblock" and
  // "Outskirts", Interchange's "NW Exfil", five entries across four maps. So the id alone is
  // not unique within a map, and the index has to go in the key; the id stays in it too, for
  // readability when debugging.
  const build = (
    extract: MapExtract,
    from: GameMap,
    index: number,
    onlyOn: string | null,
  ): ExtractMarker => ({
    conditions: extractConditions(from.normalizedName, extract.nameId),
    key: `extract:${from.id}:${index}:${extract.id}`,
    kind: "extract",
    extractId: extract.id,
    name: extract.name,
    faction: extract.faction,
    position: extract.position,
    outline: extract.outline,
    toll: extract.toll
      ? { ...extract.toll, name: itemName(extract.toll.itemId) }
      : null,
    onlyOn,
  });

  const markers = target.extracts.map((extract, index) => build(extract, target, index, null));
  const own = new Set(markers.map((marker) => marker.name.toLowerCase()));

  for (const source of maps) {
    if (folded.get(source.id) !== mapId) continue;
    for (const [index, extract] of source.extracts.entries()) {
      // This map's own entry wins, so a gate both publish keeps this map's faction and
      // toll and shows unlabelled.
      if (own.has(extract.name.toLowerCase())) continue;
      markers.push(build(extract, source, index, source.name));
    }
  }

  return markers;
}
