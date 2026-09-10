/**
 * Editing the hideout record.
 *
 * Its own module rather than a closure in the component so the distinction that matters
 * can be asserted: forgetting a station removes its key, which is "not told", while
 * setting zero writes one, which is "not built". The two want the same upgrade items but
 * only one of them stops crafts you cannot run from padding the keep list.
 */

export function nextHideoutLevels(
  current: Readonly<Record<string, number>>,
  stationId: string,
  level: number | null,
): Record<string, number> {
  const next = { ...current };
  if (level === null) delete next[stationId];
  else if (Number.isFinite(level)) next[stationId] = Math.max(0, Math.floor(level));
  return next;
}

/** How many stations the reader has actually answered for. */
export function recordedCount(levels: Readonly<Record<string, number>>): number {
  return Object.keys(levels).length;
}

/** The station whose third level cuts the flea market's listing fee by 30%. */
export const INTELLIGENCE_CENTER = "intelligence-center";

/**
 * The recorded Intelligence Center level, for the flea fee.
 *
 * Zero when the station is not in the record, which reads the fee as undiscounted. That is
 * the pessimistic guess and the right one: overstating the fee understates a flip's
 * profit, and a row that promises money it does not pay out is the expensive mistake.
 */
export function intelligenceCenterLevel(
  levels: Readonly<Record<string, number>>,
  stations: ReadonlyArray<{ id: string; normalizedName: string }>,
): number {
  const station = stations.find((each) => each.normalizedName === INTELLIGENCE_CENTER);
  if (!station) return 0;
  return levels[station.id] ?? 0;
}
