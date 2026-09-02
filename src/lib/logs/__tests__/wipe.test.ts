import { describe, expect, it } from "vitest";

import type { LogFolderInfo } from "../log-types";
import { parseLogFolderName } from "../log-types";
import { analyzeWipes, objectIdCreatedAt, type FolderObservation } from "../wipe";

/**
 * Profile ids below keep the real 8-hex timestamp prefixes observed on this machine —
 * that prefix is the only part wipe detection reads. Suffixes are synthetic.
 *
 *   5e5c26bf -> 2020-03-01  (previous wipe's PMC/Scav pair, still in use through 2025)
 *   6934db41 -> 2025-12-07  (a second profile created mid-session; EFT's PvE profile)
 *   6a8632b9 -> 2026-08-19  (current wipe's PMC/Scav pair)
 */
const OLD_PMC = "5e5c26bf000000000000000c";
const OLD_SCAV = "5e5c26bf000000000000000d";
const PVE = "6934db41000000000000000f";
const NEW_PMC = "6a8632b90000000000000001";
const NEW_SCAV = "6a8632b90000000000000002";

function folder(name: string): LogFolderInfo {
  const info = parseLogFolderName(name);
  if (!info) throw new Error(`bad folder name in test: ${name}`);
  return info;
}

function obs(name: string, profileIds: string[], sessionModes: string[] = []): FolderObservation {
  return { folder: folder(name), profileIds, sessionModes };
}

describe("objectIdCreatedAt", () => {
  it("decodes the creation timestamp embedded in an ObjectId", () => {
    expect(new Date(objectIdCreatedAt(NEW_PMC)).toISOString()).toBe("2026-08-19T22:48:25.000Z");
    expect(new Date(objectIdCreatedAt(OLD_PMC)).toISOString()).toBe("2020-03-01T21:18:55.000Z");
  });
});

describe("analyzeWipes", () => {
  it("separates wipes and picks the generation owning the newest folder", () => {
    const result = analyzeWipes([
      obs("log_2025.11.15_13-01-25_1.0.0.0.41760", [OLD_PMC, OLD_SCAV], ["Regular"]),
      obs("log_2025.11.16_11-52-20_1.0.0.0.41771", [OLD_PMC]),
      obs("log_2026.08.19_16-31-24_1.1.0.1.46777", [NEW_PMC]),
      obs("log_2026.09.01_19-27-07_1.1.0.1.46911", [NEW_PMC, NEW_SCAV], ["PvpSeason"]),
    ]);

    expect(result.generations).toHaveLength(2);
    expect(result.current?.profileIds).toEqual([NEW_PMC, NEW_SCAV]);
    expect(result.current?.folders).toEqual([
      "log_2026.08.19_16-31-24_1.1.0.1.46777",
      "log_2026.09.01_19-27-07_1.1.0.1.46911",
    ]);
    // The old generation keeps its folders; nothing is discarded.
    const old = result.generations.find((g) => g.id === OLD_PMC);
    expect(old?.folders).toHaveLength(2);
  });

  it("groups a PMC and Scav pair created in the same second into one generation", () => {
    const result = analyzeWipes([obs("log_2026.09.01_19-27-07_1.1.0.1.46911", [NEW_PMC, NEW_SCAV])]);
    expect(result.generations).toHaveLength(1);
    expect(result.generations[0].profileIds).toEqual([NEW_PMC, NEW_SCAV]);
  });

  it("does not merge a PvE profile into the wipe it was created during", () => {
    // The real 2025-12-06 session contains both the 2020 profile and a profile created
    // mid-session. Grouping by co-occurrence would fuse two unrelated generations.
    const result = analyzeWipes([
      obs("log_2025.11.15_13-01-25_1.0.0.0.41760", [OLD_PMC, OLD_SCAV]),
      obs("log_2025.12.06_18-40-01_1.0.0.2.42157", [OLD_PMC, PVE], ["Regular", "Pve"]),
    ]);
    expect(result.generations).toHaveLength(2);
    expect(result.generations.map((g) => g.id)).toEqual([OLD_PMC, PVE]);
  });

  it("flags a folder that mixes two generations", () => {
    const result = analyzeWipes([
      obs("log_2025.11.15_13-01-25_1.0.0.0.41760", [OLD_PMC, OLD_SCAV]),
      obs("log_2025.12.06_18-40-01_1.0.0.2.42157", [OLD_PMC, PVE]),
    ]);
    expect(result.generations.find((g) => g.id === OLD_PMC)?.ambiguous).toBe(true);
  });

  it("attributes a folder with no profile id using its game version", () => {
    const result = analyzeWipes([
      obs("log_2025.11.15_13-01-25_1.0.0.0.41760", [OLD_PMC]),
      // Real logs contain sessions where the game never wrote a profile id.
      obs("log_2026.08.23_10-48-37_1.1.0.1.46911", []),
      obs("log_2026.09.01_19-27-07_1.1.0.1.46911", [NEW_PMC]),
    ]);
    expect(result.inferredFolders).toEqual(["log_2026.08.23_10-48-37_1.1.0.1.46911"]);
    expect(result.current?.folders).toContain("log_2026.08.23_10-48-37_1.1.0.1.46911");
  });

  it("does not treat profile creation date as the wipe date", () => {
    // The 2020 profile was still in use in late 2025, across several real wipes.
    const result = analyzeWipes([obs("log_2025.11.15_13-01-25_1.0.0.0.41760", [OLD_PMC])]);
    const gen = result.generations[0];
    expect(gen.createdAt).toBeLessThan(gen.firstSeenAt);
    expect(new Date(gen.createdAt).getFullYear()).toBe(2020);
    expect(new Date(gen.firstSeenAt).getFullYear()).toBe(2025);
  });

  it("returns nothing when no profile id was ever seen", () => {
    const result = analyzeWipes([obs("log_2026.09.01_19-27-07_1.1.0.1.46911", [])]);
    expect(result.generations).toHaveLength(0);
    expect(result.current).toBeUndefined();
  });
});
