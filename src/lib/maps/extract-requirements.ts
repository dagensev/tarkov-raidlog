/**
 * What an exit asks of you beyond walking into it.
 *
 * Not part of the JSON API, and not derivable from it. tarkov.dev's extract entries carry a
 * position, a faction and a `transferItem` toll, and nothing else — no requirement field in
 * any of the ten documents `endpointPath` can build, and the GraphQL schema that had an
 * `ExitRequirement` type is the retired one (see `endpoints.ts`). So this is vendored, for
 * the same reason `crafts/fuel.ts` is: the fact is real, the reader needs it mid-raid, and
 * there is nowhere to fetch it from.
 *
 * Sourced from the game's own configuration rather than from a wiki, via SPT's mirror of it:
 *
 *  - `project/assets/database/locations/<map>/base.json` → `exits[]`, which carries
 *    `PassageRequirement` (`Empty` | `Reference` | `TransferItem` | `WorldEvent` |
 *    `ScavCooperation` | `Train` | `None`), `RequiredSlot`, `MinTime`/`MaxTime` and a
 *    `RequirementTip` localisation key.
 *  - `project/assets/database/globals.json` → `RequirementReferences`, which is what a
 *    `Reference` requirement points at. There is exactly one, `Alpinist`.
 *  - `project/assets/database/locales/global/en.json`, for the wording. What the card shows
 *    is shorter than the game's own message, so the message is quoted in a comment beside
 *    each entry instead — that is what the phrasing has to stay faithful to.
 *
 * Keyed on the **raw** extract name, which is what both sides call the same door: tarkov.dev
 * publishes `Alpinist` and translates it to "Cliff Descent" through `maps_en`, and the game's
 * config calls it `Alpinist` too. Matching on the translated name would break the moment
 * tarkov.dev retranslated one.
 *
 * Deliberately not exhaustive. Three exits the game gates are left out because tarkov.dev
 * does not publish a matching extract to hang them on — Woods' `Factory Gate`, Lighthouse's
 * `tunnel_shared`, and Reserve's `EXFIL_Bunker_D2`, which is the PMC half of a door
 * tarkov.dev only lists as the Scav-side `Exit3`. Guessing that join is exactly the mistake
 * this table exists to avoid, and `live-api.test.ts` fails if any key here stops matching.
 */

export interface ExtractCondition {
  /** A few words for the pill on the card. Lower case, like the other pills. */
  label: string;
  /**
   * The bullet under the pill: what to do about it, in as few words as carry the meaning.
   *
   * Not a sentence and not punctuated as one. This is read at a glance while a raid timer
   * runs, so it is written the way the launcher card's feature list is — a phrase you can
   * take in without reading it twice.
   */
  detail: string;
}

/**
 * `RequirementReferences.Alpinist` in `globals.json`, which all three cliff exits point at.
 *
 * Three checks, not two. The armour one is the one that catches people out — it is a
 * separate `Empty`/`ArmorVest` entry alongside the two `HasItem` entries, and the game's own
 * message for it is "You can't climb in body armor". A plate carrier rig is not an armour
 * vest and passes.
 *
 * Neither item is taken: they are checked, not spent.
 */
const ALPINIST: readonly ExtractCondition[] = [
  { label: "red rebel + paracord", detail: "Both carried — neither is consumed" },
  // The game's own words are "You can't climb in body armor".
  { label: "no body armour", detail: "Armour vest slot empty; an armoured rig is fine" },
];

/** A door a PMC and a Scav have to use together. Six exits, one per map that has one. */
const COOPERATION: ExtractCondition = {
  label: "co-op only",
  detail: "A PMC and a Scav must extract together",
};

/**
 * The backpack slot has to be **empty**, not merely small.
 *
 * One entry for both, though the game words the refusal differently depending on which door
 * you are standing at — "Your backpack is too big" at Reserve's manhole, "Drop your backpack
 * to fit in" at Interchange's fence. Same `Empty`/`Backpack` check behind each.
 */
const NO_BACKPACK: ExtractCondition = {
  label: "no backpack",
  detail: "Backpack slot empty — stash it in a container or drop it",
};

/** The armoured train, which leaves once on a timer rather than waiting for you. */
const train = (fromSeconds: number, toSeconds: number): ExtractCondition => ({
  label: "train, on a timer",
  detail: `Arrives ~${Math.round(fromSeconds / 60)}–${Math.round(
    toSeconds / 60,
  )} min in, then leaves on its own`,
});

/**
 * Conditions by map `normalizedName`, then by raw extract name.
 *
 * Only exits with something to say are listed; the ordinary ones are absent rather than
 * mapped to an empty array, so a lookup miss and "nothing required" are the same answer.
 */
export const EXTRACT_REQUIREMENTS: Readonly<
  Record<string, Readonly<Record<string, readonly ExtractCondition[]>>>
> = {
  customs: {
    // `WorldEvent` with no tip of its own. Customs publishes exactly one switch, and this is
    // the door it opens — but the config does not say so, so this says only what it knows.
    EXFIL_ZB013: [
      { label: "needs a switch", detail: "Opened by a switch elsewhere on the map" },
    ],
    Custom_scav_pmc: [COOPERATION],
  },
  woods: {},
  lighthouse: {
    EXFIL_Train: [train(1300, 1420)],
    Alpinist_light: ALPINIST,
  },
  shoreline: {
    RedRebel_alp: ALPINIST,
    Smugglers_Trail_coop: [COOPERATION],
  },
  reserve: {
    EXFIL_Train: [train(1450, 1700)],
    Alpinist: ALPINIST,
    EXFIL_ScavCooperation: [COOPERATION],
    // "Restore power supply at the generator".
    EXFIL_Bunker: [{ label: "needs power", detail: "Generator has to be running" }],
    EXFIL_vent: [NO_BACKPACK],
  },
  interchange: {
    "Saferoom Exfil": [
      { label: "lock yourself in", detail: "Shut the saferoom door behind you" },
    ],
    "Hole Exfill": [NO_BACKPACK],
    "Interchange Cooperation": [COOPERATION],
  },
  "streets-of-tarkov": {
    Exit_E10_coop: [COOPERATION],
  },
  "ground-zero": {
    Scav_coop_exit: [COOPERATION],
  },
};

/** What this exit asks for, or an empty list. `mapName` is a map's `normalizedName`. */
export function extractConditions(
  mapName: string,
  extractNameId: string,
): readonly ExtractCondition[] {
  return EXTRACT_REQUIREMENTS[mapName]?.[extractNameId] ?? [];
}
