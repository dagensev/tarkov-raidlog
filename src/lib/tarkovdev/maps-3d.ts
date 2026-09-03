import type { GameMap } from "./types";

/**
 * tarkov.dev's 3D map renders.
 *
 * These are not part of the JSON API — they are flat JPEGs on tarkov.dev, listed in
 * `src/data/maps.json` in the-hideout/tarkov-dev, all drawn by re3mr (https://reemr.se).
 * The key there is not always the map's `normalizedName`, which is why this is a table
 * and not a template: Streets is published as `streets-3d`, not `streets-of-tarkov-3d`.
 *
 * Only eight of the thirteen maps have one. The rest are deliberately absent rather than
 * guessed at — tarkov.dev is a single-page app that answers a missing image with its own
 * HTML at HTTP 200, so a wrong URL is a broken picture, not a 404 we could detect.
 *
 * To refresh: pull that maps.json and take every variant whose `projection` is `3D`.
 */
const KEYS: Readonly<Record<string, string>> = {
  customs: "customs-3d",
  "ground-zero": "ground-zero-3d",
  interchange: "interchange-3d",
  lighthouse: "lighthouse-3d",
  reserve: "reserve-3d",
  shoreline: "shoreline-3d",
  "streets-of-tarkov": "streets-3d",
  woods: "woods-3d",
};

export interface Map3d {
  /** The full render. Between 0.5 MB (Ground Zero) and 11.5 MB (Lighthouse). */
  image: string;
  /** ~20 KB, and enough to orient by while the full one arrives. */
  thumbnail: string;
  /** tarkov.dev's own viewer for it. */
  page: string;
  author: string;
  authorLink: string;
}

/** The 3D render for a map, or null where nobody has drawn one. */
export function map3d(map: Pick<GameMap, "normalizedName"> | null | undefined): Map3d | null {
  const key = map ? KEYS[map.normalizedName] : undefined;
  if (!key) return null;
  return {
    image: `https://tarkov.dev/maps/${key}.jpg`,
    thumbnail: `https://tarkov.dev/maps/${key}_thumb.jpg`,
    page: `https://tarkov.dev/map/${key}`,
    author: "re3mr",
    authorLink: "https://reemr.se",
  };
}
