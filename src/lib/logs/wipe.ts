import type { LogFolderInfo } from "./log-types";

/**
 * Wipe detection.
 *
 * The game gives us no wipe marker, but profile ids are MongoDB ObjectIds whose first
 * four bytes are a Unix creation timestamp. A wipe creates a fresh PMC and Scav profile
 * in the same second, so profiles group into "generations" by creation time, and a
 * change of generation is a wipe boundary.
 *
 * Two things this deliberately does *not* do:
 *
 *  - It does not treat a profile's creation date as the wipe date. One observed profile
 *    id dates to 2020 yet was still in use in 2025, so ids can outlive several wipes.
 *    Only a *change* of generation is a reliable boundary.
 *  - It does not group profiles by co-occurrence in a log folder. PvE has its own
 *    profile, and switching modes mid-session puts two unrelated generations in one
 *    folder; co-occurrence grouping would silently merge PvP and PvE progress.
 */

/** Profiles created within this window of each other belong to the same generation. */
const GENERATION_WINDOW_MS = 60_000;

/** Decode the creation timestamp embedded in a MongoDB ObjectId. */
export function objectIdCreatedAt(id: string): number {
  return parseInt(id.slice(0, 8), 16) * 1000;
}

export function isObjectId(value: string): boolean {
  return /^[0-9a-f]{24}$/.test(value);
}

/** What we learned about one log folder while scanning it. */
export interface FolderObservation {
  folder: LogFolderInfo;
  /** Every distinct profile id seen in the folder. */
  profileIds: string[];
  /** Every distinct `Session mode:` value seen, e.g. `PvpSeason`, `Regular`, `Pve`. */
  sessionModes: string[];
}

/** A set of profiles created together — in practice one wipe's PMC and Scav pair. */
export interface ProfileGeneration {
  /** Stable id for the generation: its lowest profile id. */
  id: string;
  profileIds: string[];
  /** Creation time from the ObjectId. Approximates, but does not define, the wipe date. */
  createdAt: number;
  /**
   * Folders whose events belong to this generation, oldest first. A generation that
   * shared every session with a more dominant one has none — it is still real, just
   * never the owner of a session.
   */
  folders: string[];
  /** Every folder one of these profile ids appeared in, attributed or not. */
  observedIn: string[];
  /** Session start of the earliest and latest folder this generation was seen in. */
  firstSeenAt: number;
  lastSeenAt: number;
  gameVersions: string[];
  sessionModes: string[];
  /** True when a folder attributed here also contained another generation's profiles. */
  ambiguous: boolean;
}

export interface WipeAnalysis {
  generations: ProfileGeneration[];
  /** The generation seen in the most recent folder, or undefined if nothing was found. */
  current?: ProfileGeneration;
  /** Folders with no profile id at all, attributed by game version and proximity. */
  inferredFolders: string[];
}

/**
 * Group observed profile ids into generations and attribute each folder to one.
 *
 * Folders containing no profile id are attributed to the nearest generation that shares
 * their game version, falling back to the nearest in time.
 */
export function analyzeWipes(observations: FolderObservation[]): WipeAnalysis {
  const ordered = [...observations].sort((a, b) => a.folder.startedAt - b.folder.startedAt);

  const allIds = new Set<string>();
  for (const obs of ordered) {
    for (const id of obs.profileIds) if (isObjectId(id)) allIds.add(id);
  }
  if (allIds.size === 0) return { generations: [], inferredFolders: [] };

  // Bucket ids by creation time. PMC and Scav share a timestamp to the second.
  const byTime = [...allIds].sort((a, b) => objectIdCreatedAt(a) - objectIdCreatedAt(b));
  const buckets: string[][] = [];
  for (const id of byTime) {
    const last = buckets[buckets.length - 1];
    if (last && objectIdCreatedAt(id) - objectIdCreatedAt(last[0]) <= GENERATION_WINDOW_MS) {
      last.push(id);
    } else {
      buckets.push([id]);
    }
  }

  const generations: ProfileGeneration[] = buckets.map((ids) => ({
    id: [...ids].sort()[0],
    profileIds: [...ids].sort(),
    createdAt: objectIdCreatedAt(ids[0]),
    folders: [],
    observedIn: [],
    firstSeenAt: Number.POSITIVE_INFINITY,
    lastSeenAt: Number.NEGATIVE_INFINITY,
    gameVersions: [],
    sessionModes: [],
    ambiguous: false,
  }));

  const genOfProfile = new Map<string, ProfileGeneration>();
  for (const gen of generations) {
    for (const id of gen.profileIds) genOfProfile.set(id, gen);
  }

  // Pass 1: attribute folders that name a profile directly.
  const attributed = new Map<string, ProfileGeneration>();
  for (const obs of ordered) {
    const counts = new Map<ProfileGeneration, number>();
    for (const id of obs.profileIds) {
      const gen = genOfProfile.get(id);
      if (gen) counts.set(gen, (counts.get(gen) ?? 0) + 1);
    }
    if (counts.size === 0) continue;
    for (const gen of counts.keys()) gen.observedIn.push(obs.folder.name);
    // A mid-session profile switch puts two generations in one folder. The one with
    // more distinct ids wins; ties go to the older generation, since a session that
    // switches profiles started out on the one that already existed.
    const winner = [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].createdAt - b[0].createdAt,
    )[0][0];
    if (counts.size > 1) winner.ambiguous = true;
    attributed.set(obs.folder.name, winner);
  }

  // Pass 2: folders with no profile id. Prefer a generation that has seen the same game
  // version; otherwise take the nearest attributed folder in time.
  const inferredFolders: string[] = [];
  const versionsOf = new Map<ProfileGeneration, Set<string>>();
  for (const obs of ordered) {
    const gen = attributed.get(obs.folder.name);
    if (!gen) continue;
    let set = versionsOf.get(gen);
    if (!set) versionsOf.set(gen, (set = new Set()));
    set.add(obs.folder.gameVersion);
  }

  for (const obs of ordered) {
    if (attributed.has(obs.folder.name)) continue;
    const byVersion = generations.filter((g) => versionsOf.get(g)?.has(obs.folder.gameVersion));
    let chosen: ProfileGeneration | undefined;
    if (byVersion.length === 1) {
      chosen = byVersion[0];
    } else {
      const pool = byVersion.length > 1 ? byVersion : generations;
      let best = Number.POSITIVE_INFINITY;
      for (const other of ordered) {
        const gen = attributed.get(other.folder.name);
        if (!gen || !pool.includes(gen)) continue;
        const distance = Math.abs(other.folder.startedAt - obs.folder.startedAt);
        if (distance < best) {
          best = distance;
          chosen = gen;
        }
      }
    }
    if (chosen) {
      attributed.set(obs.folder.name, chosen);
      inferredFolders.push(obs.folder.name);
    }
  }

  // Roll the attributions up into each generation.
  for (const obs of ordered) {
    const gen = attributed.get(obs.folder.name);
    if (!gen) continue;
    gen.folders.push(obs.folder.name);
    if (!gen.gameVersions.includes(obs.folder.gameVersion)) {
      gen.gameVersions.push(obs.folder.gameVersion);
    }
    for (const mode of obs.sessionModes) {
      if (!gen.sessionModes.includes(mode)) gen.sessionModes.push(mode);
    }
  }

  // The seen range covers every folder the generation appeared in, including sessions
  // it shared with another generation and therefore does not own.
  const startedAt = new Map(ordered.map((o) => [o.folder.name, o.folder.startedAt]));
  for (const gen of generations) {
    for (const name of new Set([...gen.observedIn, ...gen.folders])) {
      const at = startedAt.get(name);
      if (at === undefined) continue;
      gen.firstSeenAt = Math.min(gen.firstSeenAt, at);
      gen.lastSeenAt = Math.max(gen.lastSeenAt, at);
    }
  }

  generations.sort((a, b) => a.createdAt - b.createdAt);

  // Current wipe is whichever generation owns the most recent folder — not the most
  // recently *created* profile, which would pick a PvE profile made after the wipe.
  const newest = ordered[ordered.length - 1];
  const current = newest ? attributed.get(newest.folder.name) : undefined;

  return { generations, current, inferredFolders };
}

/** Folder names belonging to a generation, as a set for fast filtering. */
export function folderSet(generation: ProfileGeneration | undefined): Set<string> {
  return new Set(generation?.folders ?? []);
}
