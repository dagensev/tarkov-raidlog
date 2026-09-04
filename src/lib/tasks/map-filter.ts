/**
 * The map a task list is filtered to, shared by the Tasks and Squad tabs.
 *
 * Three states, not two. "Nothing picked" and "every map" have to be told apart because each
 * page falls back differently when you have not chosen: the Tasks tab shows every map, the
 * Squad tab follows the map detected from your logs. Picking "Any map" on Squad must then
 * stick rather than snapping back to detection, which a plain `""` could not express.
 *
 * Distinct from `settings.mapOverride`, which says which map you are *on* — that one drives
 * the header and is broadcast to your squadmates. Filtering a list is nobody else's business.
 */

/** An explicit "every map". A literal, so no tarkov.dev map id can collide with it. */
export const ANY_MAP = "any";

/** `null` — nothing picked — `ANY_MAP`, or a map id. */
export type MapFilter = string | null;

/**
 * The map id a picker should show and filter by, or `""` for none.
 *
 * `""` is the empty `<option>`'s value, so the result goes straight onto the control.
 * `fallback` applies only to "nothing picked": an explicit `ANY_MAP` outranks it.
 */
export function resolveMapFilter(filter: MapFilter, fallback?: string): string {
  if (filter === ANY_MAP) return "";
  return filter ?? fallback ?? "";
}

/** A picker's `<select>` value as a filter. `""` is a deliberate "any", not an absence. */
export function mapFilterFrom(value: string): MapFilter {
  return value === "" ? ANY_MAP : value;
}
