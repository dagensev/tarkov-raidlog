/**
 * tarkov.dev's JSON API.
 *
 * tarkov.dev retired its GraphQL endpoint: `api.tarkov.dev/graphql` now answers
 * `422 {"errors":["GraphQL server unavailable. Try again later."]}` for every query.
 * Their API page (https://tarkov.dev/api/) documents the replacement — "the API serves
 * JSON responses to simple GET requests" — with the endpoint list at
 * https://json.tarkov.dev/endpoints.
 *
 * Shape of the replacement, which drives the client:
 *
 *  - Documents are **normalized**. `task.trader`, `task.map`, `taskRequirements[].task`
 *    and `neededKeys[].keys` are id strings, not nested objects.
 *  - Human-readable text is **localized separately**. `task.name` is a translation *key*
 *    (`"<id> name"`), resolved against `<path>_<lang>`, a flat key/value dictionary.
 *    `wikiLink` and `normalizedName` are plain strings and need no lookup.
 *  - Data is split by **game mode**, which the logs already tell us.
 */

export const JSON_API_BASE =
  process.env.NEXT_PUBLIC_TARKOV_ENDPOINT ?? "https://json.tarkov.dev";

/** Game modes the API publishes, from `/endpoints`. */
export type GameMode = "regular" | "pve" | "pvp-season";

export const GAME_MODES: readonly GameMode[] = ["regular", "pve", "pvp-season"];

export const DEFAULT_GAME_MODE: GameMode = "pvp-season";

/**
 * Map the log's `Session mode:` value onto an API game mode.
 *
 * The three values seen in real logs — `PvpSeason`, `Regular`, `Pve` — line up one to one
 * with the API's modes, so we can fetch the dataset for the mode actually being played.
 */
export function gameModeFromSessionMode(sessionMode: string | undefined): GameMode | undefined {
  switch (sessionMode?.toLowerCase()) {
    case "pvpseason":
      return "pvp-season";
    case "pve":
      return "pve";
    case "regular":
      return "regular";
    default:
      return undefined;
  }
}

export type EndpointName = "tasks" | "maps" | "traders" | "items" | "hideout";

/** Path to a data document, or its translation file when `lang` is given. */
export function endpointPath(mode: GameMode, name: EndpointName, lang?: string): string {
  return `${JSON_API_BASE}/${mode}/${name}${lang ? `_${lang}` : ""}`;
}

/** EFT server status. Not mode-scoped. */
export function statusPath(): string {
  return `${JSON_API_BASE}/status`;
}

export const DEFAULT_LANGUAGE = "en";
