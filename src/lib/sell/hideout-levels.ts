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
