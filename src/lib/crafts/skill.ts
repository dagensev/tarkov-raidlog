/**
 * The Crafting skill's one effect this calculator models: how long a run takes.
 *
 * Its own module because two callers need it and they sit either side of an import — the
 * row costs its own craft, and ./routes.ts costs the crafts a route runs underneath it.
 */

/**
 * How much of a craft's time each level of the Crafting skill takes off.
 *
 * 0.75% a level, reaching 37.5% at Elite. The skill also speeds cyclic production, which
 * is not something this table has rows for.
 */
export const CRAFTING_TIME_PER_LEVEL = 0.0075;

/** Elite. Levels above this exist as a rank, not as more of the bonus. */
export const CRAFTING_MAX_LEVEL = 50;

/** Seconds one run takes at a given Crafting skill level. */
export function craftSeconds(baseSeconds: number, craftingSkill: number): number {
  const level = Math.min(CRAFTING_MAX_LEVEL, Math.max(0, Math.floor(craftingSkill || 0)));
  return baseSeconds * (1 - CRAFTING_TIME_PER_LEVEL * level);
}
