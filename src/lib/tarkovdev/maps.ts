import type { GameMap } from "./types";

/**
 * Turning what the game logs into a tarkov.dev map.
 *
 * Two independent signals, deliberately both supported:
 *   - `scene preset path:maps/<scene>.bundle` from the application log. Earliest signal,
 *     fires before the match is even confirmed.
 *   - `location` from the `UserConfirmed` notification payload, which is BSG's internal
 *     location id.
 *
 * Both are resolved to *candidate display names* and then matched against the map list the
 * API actually returned, comparing on a normalised form. Matching on names we were given at
 * runtime rather than on a hardcoded id or slug means a rename upstream degrades to "map not
 * recognised" instead of silently pointing at the wrong map.
 */

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Scene bundle name -> candidate map names, best first.
 *
 * The eight scenes verified present in real logs are marked; the rest are the remaining
 * live maps, included so a first raid on them resolves rather than reporting unknown.
 */
export const SCENE_CANDIDATES: Readonly<Record<string, readonly string[]>> = {
  customs_preset: ["Customs"], // verified in logs
  shopping_mall: ["Interchange"], // verified in logs
  factory_day_preset: ["Factory"], // verified in logs
  factory_night_preset: ["Factory"],
  shoreline_preset: ["Shoreline"], // verified in logs
  woods_preset: ["Woods"], // verified in logs
  rezerv_base_preset: ["Reserve"], // verified in logs
  sandbox_preset: ["Ground Zero"], // verified in logs
  sandbox_start_preset: ["Ground Zero"], // verified in logs
  sandbox_high_preset: ["Ground Zero 21+", "Ground Zero"], // verified in logs
  lighthouse_preset: ["Lighthouse"],
  city_preset: ["Streets of Tarkov"],
  tarkovstreets_preset: ["Streets of Tarkov"],
  laboratory_preset: ["The Lab"],
  terminal_preset: ["Terminal"],
  labyrinth_preset: ["Labyrinth"],
};

/** BSG location id (from the `UserConfirmed` payload) -> candidate map names. */
export const LOCATION_CANDIDATES: Readonly<Record<string, readonly string[]>> = {
  bigmap: ["Customs"],
  customs: ["Customs"],
  interchange: ["Interchange"], // verified in logs
  factory4_day: ["Factory"],
  factory4_night: ["Factory"],
  factory: ["Factory"],
  shoreline: ["Shoreline"], // verified in logs
  woods: ["Woods"],
  rezervbase: ["Reserve"],
  reserve: ["Reserve"],
  lighthouse: ["Lighthouse"],
  tarkovstreets: ["Streets of Tarkov"],
  streetsoftarkov: ["Streets of Tarkov"],
  laboratory: ["The Lab"],
  thelab: ["The Lab"],
  sandbox: ["Ground Zero"],
  sandboxhigh: ["Ground Zero 21+", "Ground Zero"],
  groundzero: ["Ground Zero"],
  terminal: ["Terminal"],
  labyrinth: ["Labyrinth"],
};

/** Strip the `_preset` suffix the game appends to most scene bundles. */
function sceneKey(scene: string): string {
  return scene.toLowerCase();
}

function candidatesFor(hint: MapHint): readonly string[] {
  if (hint.scene) {
    const direct = SCENE_CANDIDATES[sceneKey(hint.scene)];
    if (direct) return direct;
  }
  if (hint.location) {
    const direct = LOCATION_CANDIDATES[normalize(hint.location)];
    if (direct) return direct;
    // An unknown location id is often already the display name, e.g. "Shoreline".
    return [hint.location];
  }
  return [];
}

export interface MapHint {
  /** Scene bundle name, e.g. `customs_preset`. */
  scene?: string;
  /** BSG location id, e.g. `Shoreline`. */
  location?: string;
}

/** Find the tarkov.dev map a log hint refers to, or undefined if nothing matches. */
export function resolveMap(maps: readonly GameMap[], hint: MapHint): GameMap | undefined {
  const candidates = candidatesFor(hint);
  for (const candidate of candidates) {
    const wanted = normalize(candidate);
    const exact = maps.find((m) => normalize(m.name) === wanted);
    if (exact) return exact;
  }
  // Loosen to a prefix match so "Ground Zero 21+" still finds "Ground Zero" when the
  // API does not split them, and vice versa.
  for (const candidate of candidates) {
    const wanted = normalize(candidate);
    const loose = maps.find(
      (m) => normalize(m.name).startsWith(wanted) || wanted.startsWith(normalize(m.name)),
    );
    if (loose) return loose;
  }
  return undefined;
}

/** True when we have no mapping for this scene and should log it for the table. */
export function isKnownScene(scene: string): boolean {
  return sceneKey(scene) in SCENE_CANDIDATES;
}

/**
 * Link to the map on tarkov.dev.
 *
 * Their map routes are the display name lowercased with spaces hyphenated. Derived from
 * the name rather than from a `normalizedName` field, which is not verified to exist in
 * the schema.
 */
export function tarkovDevMapUrl(map: GameMap): string {
  const slug = map.name
    .toLowerCase()
    .replace(/\+/g, "plus")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `https://tarkov.dev/map/${slug}`;
}
