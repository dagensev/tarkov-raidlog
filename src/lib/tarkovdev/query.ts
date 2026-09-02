/**
 * tarkov.dev GraphQL query.
 *
 * Trimmed from TarkovTracker's `tarkov-tracker/src/utils/tarkovdataquery.js`. Every field
 * here appears in that production query, so the field names are known-good; the trimming
 * drops the six image-size variants it requests per item, which dominate the response.
 *
 * Two fields carry the whole weight of two product features and come for free:
 *   - `wikiLink` on a task -> the wiki link per task.
 *   - `neededKeys { keys { ... } map { ... } }` -> which keys a task needs, per map.
 *
 * Deliberately *not* requested: `Map.normalizedName` and `Map.svg`. Neither appears in
 * TarkovTracker's query, so neither is verified to exist. See `maps.ts` for how map media
 * is resolved without guessing at the schema.
 */
export const TARKOV_DATA_QUERY = /* GraphQL */ `
  query TarkovRaidlogData {
    tasks {
      id
      name
      experience
      minPlayerLevel
      kappaRequired
      lightkeeperRequired
      factionName
      wikiLink
      trader {
        id
        name
      }
      map {
        id
        name
      }
      taskRequirements {
        task {
          id
          name
        }
        status
      }
      traderRequirements {
        trader {
          id
          name
        }
        value
      }
      objectives {
        id
        description
        type
        optional
        maps {
          id
          name
        }
        __typename
        ... on TaskObjectiveItem {
          count
          foundInRaid
          item {
            id
            name
            shortName
            iconLink
            wikiLink
          }
        }
        ... on TaskObjectiveQuestItem {
          count
          questItem {
            id
            name
          }
        }
        ... on TaskObjectiveMark {
          markerItem {
            id
            name
            shortName
            iconLink
          }
        }
        ... on TaskObjectiveShoot {
          count
          shotType
          targetNames
        }
        ... on TaskObjectiveExtract {
          exitStatus
        }
        ... on TaskObjectiveTaskStatus {
          status
          task {
            id
            name
          }
        }
        ... on TaskObjectivePlayerLevel {
          playerLevel
        }
        ... on TaskObjectiveTraderLevel {
          level
          trader {
            id
            name
          }
        }
      }
      neededKeys {
        map {
          id
          name
        }
        keys {
          id
          name
          shortName
          iconLink
          wikiLink
        }
      }
    }
    maps {
      id
      name
      tarkovDataId
      wiki
      raidDuration
      players
      enemies
      description
    }
    traders {
      id
      name
      resetTime
      levels {
        id
        level
        requiredPlayerLevel
        requiredReputation
      }
    }
    playerLevels {
      level
      exp
    }
  }
`;

/**
 * Probe for map media fields that are not verified to exist.
 *
 * Run separately from the main query so that a schema mismatch degrades to "no map
 * image" instead of failing the entire data load.
 */
export const MAP_MEDIA_PROBE_QUERY = /* GraphQL */ `
  query TarkovRaidlogMapMedia {
    maps {
      id
      normalizedName
    }
  }
`;
