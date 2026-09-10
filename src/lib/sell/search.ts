/**
 * Finding an item by what you would type.
 *
 * Plain substring matching over the three names the catalogue carries. No regex: the
 * query is user input, and building a pattern out of it would need escaping for no gain
 * over `includes`.
 */

import type { SellIndex, SellItem } from "@/lib/tarkovdev/client";

/**
 * Lower is better, and -1 is no match. Exact beats prefix beats substring, so "gas" finds
 * the analyzer.
 *
 * Exported because the flea tab filters on it directly: there the query narrows a table
 * that is already on screen rather than producing a list of its own, so it needs the
 * predicate without the ranking, the sorting or the cap that `searchItems` wraps it in.
 * `query` must already be trimmed and lowercased.
 */
export function rank(item: SellItem, query: string): number {
  const name = item.name.toLowerCase();
  const short = (item.shortName ?? "").toLowerCase();
  const normalized = item.normalizedName.toLowerCase();

  if (name === query || short === query) return 0;
  if (name.startsWith(query) || short.startsWith(query)) return 1;
  if (normalized.startsWith(query)) return 2;
  if (name.includes(query) || short.includes(query) || normalized.includes(query)) return 3;
  return -1;
}

/**
 * Items matching `query`, best match first.
 *
 * An empty query returns nothing rather than everything, and the cap keeps the answer to a
 * readable length. Both suit a lookup — "find me this item" — rather than the flea tab's
 * table, which filters on `rank` and orders itself.
 */
export function searchItems(index: SellIndex, query: string, limit = 60): SellItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const hits: Array<{ item: SellItem; score: number }> = [];
  for (const item of Object.values(index.items)) {
    const score = rank(item, needle);
    if (score >= 0) hits.push({ item, score });
  }

  hits.sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name));
  return hits.slice(0, limit).map((hit) => hit.item);
}
