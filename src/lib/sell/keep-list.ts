/**
 * What still wants an item, and why.
 *
 * Four unrelated systems consume stash items — quest hand-ins, hideout upgrades, trader
 * barters and hideout crafts — and nothing in the game shows them together. This turns
 * all four into one index from item id to the reasons it is worth holding on to.
 *
 * Pure on purpose. Every input arrives as data the store already holds, so the rules can
 * be asserted without a browser, a fetch or a rendered page.
 */

import type { TaskState } from "@/lib/logs/progress";
import { CURRENCY_ITEM_IDS, type Barter, type Craft, type EconomyBundle, type HideoutStation }
  from "@/lib/tarkovdev/economy";
import type { Task } from "@/lib/tarkovdev/types";

export type KeepKind = "task" | "hideout" | "barter" | "craft";

/**
 * Hard reasons are things that finish: a task hands in, a station gets built, and then
 * the item is yours to sell. Soft ones never do — a barter and a craft will still want
 * that item at the end of the wipe — so treating them the same would mean "keep
 * everything forever", which is not advice.
 *
 * A loose task objective is soft too. "Any of these 110 medical items" is a much weaker
 * claim on one particular item than a named hand-in.
 */
export type KeepTier = "hard" | "soft";

export interface KeepReason {
  kind: KeepKind;
  /** Task id, `${stationId}:${level}`, barter id or craft id. */
  sourceId: string;
  /** Ready to render: the task's name, "Workbench 3", "Ragman barter". */
  label: string;
  /**
   * Where to read more, when there is somewhere. Tasks carry their wiki page — all 489
   * have one — while a station level, a barter and a craft have no page of their own.
   */
  link?: string;
  /** How many one satisfaction consumes. Already ceilinged upstream. */
  count: number;
  /** A flea-bought copy will not do. */
  foundInRaid: boolean;
  tier: KeepTier;
  /**
   * How many different items satisfy the same slot. One means "exactly this item". The
   * largest real objective accepts 110, meaning "any medical item", which is a far
   * weaker reason to hold any particular one of them.
   */
  alternatives: number;
  /**
   * A bonus objective rather than a required one, which is what softened it.
   *
   * Worth carrying rather than folding into `tier`: a task can want the same item twice,
   * once required and once optional, and without this the two rows read as a duplicate.
   */
  optional?: boolean;
  /** Craft tools: required present, handed back afterwards, so never consumed. */
  returned?: boolean;
  /** Real, but out of reach — a barter behind an unfinished task or above your loyalty. */
  locked?: boolean;
}

export interface KeepEntry {
  itemId: string;
  /** Hard when any one reason is hard. */
  tier: KeepTier;
  reasons: KeepReason[];
  /**
   * Summed over hard reasons. An upper bound on what you might need, not a target:
   * alternatives mean one item can satisfy several reasons, and nothing here knows what
   * you already own.
   */
  hardCount: number;
  softCount: number;
  /**
   * How many to hold, counting only hard reasons from tasks and hideout upgrades.
   *
   * Barters and crafts are left out because neither ever finishes: they will want the
   * item again next week, and the big barters ask for fifty of something, so counting
   * them would drown out the things that do finish.
   *
   * Loose task objectives are left out for the same reason they are already tiered soft.
   * Minibus asks for ten found-in-raid items from the Tools category and twenty-one items
   * satisfy it, so counting it against a wrench read as "hold eleven wrenches" when one
   * of anything on the list would do. Still an upper bound rather than a target: nothing
   * here knows what you already own.
   */
  keepCount: number;
}

export type KeepList = ReadonlyMap<string, KeepEntry>;

export interface KeepOptions {
  /**
   * Above this many alternatives a task reason drops to soft. Three keeps the figurine
   * and ammo-pack hand-ins hard while letting "any medical item" go quiet.
   */
  looseAlternativesAbove?: number;
  includeBarters?: boolean;
  includeCrafts?: boolean;
}

export interface KeepInputs {
  /** Denormalized, as `useTasks()` returns them. */
  tasks: readonly Task[];
  /** Log-derived plus manual overrides, as `useTaskStates()` returns it. */
  taskStates: ReadonlyMap<string, TaskState>;
  economy: EconomyBundle;
  /** Absent station means "not told". An explicit 0 means "not built". */
  hideoutLevels: Readonly<Record<string, number>>;
  /** Read for a barter's loyalty gate. Partial in practice. */
  traderLevels?: Readonly<Record<string, number>>;
  /** Trader id to name, for barter labels. */
  traderNames?: ReadonlyMap<string, string>;
  options?: KeepOptions;
}

const DEFAULT_LOOSE_ABOVE = 3;

/**
 * The kinds that make up `KeepEntry.keepCount`.
 *
 * Only the two that finish. A barter or a craft wanting an item is a standing appetite,
 * not a quantity to hold, so putting either in the number would turn "keep 6" into a
 * figure you can never work down.
 */
const COUNTED_KINDS: ReadonlySet<KeepKind> = new Set(["task", "hideout"]);

/**
 * Objectives that consume an item from your stash.
 *
 * `sellItem` is deliberately absent, and that is the whole reason this set exists. Five
 * of them list every sellable item in the game as an alternative — the largest at 3535 —
 * so a reverse index that trusted every objective type would flag almost the entire
 * catalogue as a keep. They also mean the opposite of one: sell these to a trader.
 *
 * `findQuestItem` and `giveQuestItem` are absent too. Quest items are not in the item
 * catalogue and cannot be sold, so there is nothing to warn about.
 */
const CONSUMING_OBJECTIVES: ReadonlySet<string> = new Set([
  "giveItem",
  "findItem",
  "plantItem",
]);

function push(map: Map<string, KeepReason[]>, itemId: string, reason: KeepReason): void {
  if (!itemId || CURRENCY_ITEM_IDS.has(itemId)) return;
  const existing = map.get(itemId);
  if (existing) existing.push(reason);
  else map.set(itemId, [reason]);
}

/**
 * Items the tasks you have not finished still want.
 *
 * Not-started tasks count. Narrowing to the ones you are holding is the whole failure
 * this page exists to prevent, so it is a filter the reader can apply, never the default.
 */
export function taskReasons(
  tasks: readonly Task[],
  taskStates: ReadonlyMap<string, TaskState>,
  options: KeepOptions = {},
): Map<string, KeepReason[]> {
  const looseAbove = options.looseAlternativesAbove ?? DEFAULT_LOOSE_ABOVE;
  const reasons = new Map<string, KeepReason[]>();

  for (const task of tasks) {
    const status = taskStates.get(task.id)?.status;
    if (status === "finished") continue;
    // A failed task keeps its claim only if you can pick it up again.
    if (status === "failed" && !task.restartable) continue;

    for (const objective of task.objectives) {
      let ids: string[];
      let alternatives: number;
      let count: number;

      if (CONSUMING_OBJECTIVES.has(objective.type)) {
        ids = objective.items;
        alternatives = ids.length;
        count = objective.count ?? 1;
      } else if (objective.type === "buildWeapon") {
        // Every part is required together, so none of them is an alternative to another.
        ids = objective.item ? [objective.item.id, ...objective.containsAll] : objective.containsAll;
        alternatives = 1;
        count = 1;
      } else {
        continue;
      }

      const loose = objective.optional || alternatives > looseAbove;
      for (const itemId of ids) {
        push(reasons, itemId, {
          kind: "task",
          sourceId: task.id,
          label: task.name,
          ...(task.wikiLink ? { link: task.wikiLink } : {}),
          count: Math.max(1, count),
          foundInRaid: objective.foundInRaid === true,
          tier: loose ? "soft" : "hard",
          alternatives: Math.max(1, alternatives),
          ...(objective.optional ? { optional: true } : {}),
        });
      }
    }
  }
  return reasons;
}

/**
 * Items the hideout levels you have not built still want.
 *
 * Levels are cumulative, so everything above the one you recorded is still ahead of you.
 * A station's own build prerequisites are deliberately not a gate: a level you cannot
 * start yet will still want its items when you can.
 */
export function hideoutReasons(
  stations: readonly HideoutStation[],
  hideoutLevels: Readonly<Record<string, number>>,
): Map<string, KeepReason[]> {
  const reasons = new Map<string, KeepReason[]>();

  for (const station of stations) {
    const recorded = hideoutLevels[station.id];
    // Nothing recorded means we are guessing, and the safe guess for a keep is "not built".
    const unverified = recorded === undefined;
    const current = unverified ? 0 : recorded;

    for (const level of station.levels) {
      if (level.level <= current) continue;
      for (const line of level.requirements) {
        push(reasons, line.itemId, {
          kind: "hideout",
          sourceId: `${station.id}:${level.level}`,
          label: `${station.name} ${level.level}`,
          count: line.count,
          foundInRaid: line.foundInRaid,
          tier: "hard",
          alternatives: 1,
        });
      }
    }
  }
  return reasons;
}

/**
 * Items a trader barter wants.
 *
 * Always soft. A barter never completes, so "keep four" would really mean "keep four
 * forever". An unreachable barter is marked rather than dropped, because the thing that
 * makes it unreachable is usually temporary.
 */
export function barterReasons(
  barters: readonly Barter[],
  taskStates: ReadonlyMap<string, TaskState>,
  traderLevels: Readonly<Record<string, number>> = {},
  traderNames: ReadonlyMap<string, string> = new Map(),
): Map<string, KeepReason[]> {
  const reasons = new Map<string, KeepReason[]>();

  for (const barter of barters) {
    let locked = false;

    if (barter.taskUnlock && taskStates.get(barter.taskUnlock)?.status !== "finished") {
      locked = true;
    }
    if (barter.minTraderLevel != null && barter.minTraderLevel > 1) {
      const level = traderLevels[barter.traderId];
      if (level !== undefined && level < barter.minTraderLevel) locked = true;
    }

    const label = `${traderNames.get(barter.traderId) ?? barter.traderId} barter`;
    for (const line of barter.requiredItems) {
      push(reasons, line.itemId, {
        kind: "barter",
        sourceId: barter.id,
        label,
        count: line.count,
        foundInRaid: line.foundInRaid,
        tier: "soft",
        alternatives: 1,
        ...(locked ? { locked: true } : {}),
      });
    }
  }
  return reasons;
}

/**
 * Items a hideout craft wants.
 *
 * The one place the station checklist tightens the list rather than loosening it: a
 * craft you cannot run is not a reason to hold anything. An unrecorded station still
 * counts, so an empty checklist never quietly makes 247 items look sellable.
 *
 * Soft, like a barter: a craft never completes either, so "keep four" would really mean
 * "keep four for the rest of the wipe".
 */
export function craftReasons(
  crafts: readonly Craft[],
  stations: readonly HideoutStation[],
  hideoutLevels: Readonly<Record<string, number>>,
): Map<string, KeepReason[]> {
  const names = new Map(stations.map((station) => [station.id, station.name]));
  const reasons = new Map<string, KeepReason[]>();

  for (const craft of crafts) {
    const recorded = hideoutLevels[craft.stationId];
    // Nothing recorded means we are guessing, and the safe guess for a keep is that you
    // can run it.
    if (recorded !== undefined && recorded < craft.level) continue;

    const label = `${names.get(craft.stationId) ?? craft.stationId} craft`;
    for (const line of craft.requiredItems) {
      push(reasons, line.itemId, {
        kind: "craft",
        sourceId: craft.id,
        label,
        // A tool is needed once and handed back, so its count is never a quantity.
        count: line.tool ? 1 : line.count,
        foundInRaid: line.foundInRaid,
        tier: "soft",
        alternatives: 1,
        ...(line.tool ? { returned: true } : {}),
      });
    }
  }
  return reasons;
}

/**
 * Everything about a reason except how many it wants.
 *
 * Two objectives of the same task can want the same item — "A Bitter Victory" asks for
 * moonshine twice — and listing the task twice reads as a bug rather than as two
 * requirements. Where the reasons are identical in every other respect their counts add
 * up, which is also the honest answer to how many you need.
 */
function identity(reason: KeepReason): string {
  return [
    reason.kind,
    reason.sourceId,
    reason.tier,
    reason.alternatives,
    reason.foundInRaid,
    reason.optional ?? false,
    reason.returned ?? false,
    reason.locked ?? false,
  ].join("|");
}

/** Adds up counts across reasons that differ in nothing else. */
function mergeIdentical(reasons: readonly KeepReason[]): KeepReason[] {
  const merged = new Map<string, KeepReason>();
  for (const reason of reasons) {
    const key = identity(reason);
    const existing = merged.get(key);
    if (existing) existing.count += reason.count;
    else merged.set(key, { ...reason });
  }
  return [...merged.values()];
}

/** Hard first, then reachable before locked, so the strongest claim reads first. */
function byWeight(a: KeepReason, b: KeepReason): number {
  return (
    Number(b.tier === "hard") - Number(a.tier === "hard") ||
    Number(Boolean(a.locked)) - Number(Boolean(b.locked)) ||
    a.alternatives - b.alternatives ||
    a.label.localeCompare(b.label)
  );
}

/** Every reason every source has, folded into one entry per item. */
export function buildKeepList(inputs: KeepInputs): KeepList {
  const { options = {} } = inputs;
  const sources = [
    taskReasons(inputs.tasks, inputs.taskStates, options),
    hideoutReasons(inputs.economy.stations, inputs.hideoutLevels),
    options.includeBarters === false
      ? new Map<string, KeepReason[]>()
      : barterReasons(
          inputs.economy.barters,
          inputs.taskStates,
          inputs.traderLevels,
          inputs.traderNames,
        ),
    options.includeCrafts === false
      ? new Map<string, KeepReason[]>()
      : craftReasons(inputs.economy.crafts, inputs.economy.stations, inputs.hideoutLevels),
  ];

  const merged = new Map<string, KeepReason[]>();
  for (const source of sources) {
    for (const [itemId, reasons] of source) {
      const existing = merged.get(itemId);
      if (existing) existing.push(...reasons);
      else merged.set(itemId, [...reasons]);
    }
  }

  const list = new Map<string, KeepEntry>();
  for (const [itemId, duplicated] of merged) {
    const reasons = mergeIdentical(duplicated);
    let hardCount = 0;
    let softCount = 0;
    let keepCount = 0;
    let anyReturned = false;

    for (const reason of reasons) {
      // One wrench serves every craft that asks for one, forever, so tools are added
      // once at the end rather than per reason.
      if (reason.returned) {
        anyReturned = true;
        continue;
      }

      if (reason.tier === "hard") hardCount += reason.count;
      else softCount += reason.count;
      if (reason.tier === "hard" && COUNTED_KINDS.has(reason.kind)) keepCount += reason.count;
    }
    // Tools only ever come from crafts, which are soft and never counted.
    if (anyReturned) softCount += 1;

    reasons.sort(byWeight);
    list.set(itemId, {
      itemId,
      tier: hardCount > 0 ? "hard" : "soft",
      reasons,
      hardCount,
      softCount,
      keepCount,
    });
  }
  return list;
}
