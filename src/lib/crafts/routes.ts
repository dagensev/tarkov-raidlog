/**
 * Getting hold of an item, or getting rid of one, through trades that take items of their own.
 *
 * ./pricing.ts quotes the two markets, which take and pay money. This adds the other two
 * ways an item changes hands: a trader barter, which swaps items for an item and takes no
 * time, and a hideout craft, which does the same at a station and takes hours. Either can
 * stand on either side of a craft — an ingredient bartered for rather than bought, a product
 * crafted into something that sells better — and each is priced by pricing its own inputs
 * and outputs the same way, so a route is a tree. The tree is followed `MAX_ROUTE_DEPTH`
 * trades down before it has to end at a market.
 *
 * **Choosing between routes.** Cheapest stops being the right question as soon as a route
 * can take time. A craft that saves 2,000 ₽ on an ingredient but adds ten hours to the
 * chain wrecks the profit per hour the table is sorted on. So every choice here minimises
 * cost plus time charged at `rate` roubles an hour — maximises value less time, on the
 * selling side — and ./craft-row.ts searches for the rate that makes the row's own profit
 * per hour largest. At a rate of zero this is plain cheapest, which is where that search
 * starts.
 *
 * **Locked routes are used, and marked.** A barter above the loyalty you recorded, or a
 * craft behind a task your logs show unfinished, still prices; the step carries the gate
 * and the acquisition carries `locked`, so the page can say so. Anything nobody has told us
 * about counts as able, the same stance the row takes on its own station and task.
 *
 * **Found in raid.** The flea lists only found-in-raid items. A crafted item is found in raid
 * and a traded one is not, so what a barter hands back can go to a trader, or on into another
 * barter or craft, but never onto the flea. Left out, the top of the table filled with
 * barters whose prize "sells" on a market that would refuse the listing.
 *
 * **Loops.** A step is skipped when it would consume the item it is meant to produce, or
 * produce the item it is meant to consume, or touch the root craft's own product at all.
 * Longer loops — A bartered from B, B crafted from A — are left to the depth cap, since each
 * trade in them is one somebody could actually make.
 */

import type { TaskStatus } from "@/lib/logs/progress";
import type { NamedOffer } from "@/lib/sell/verdict";
import type { SellIndex, SellItem } from "@/lib/tarkovdev/client";
import type { Barter, Craft, HideoutStation, ItemRequirement } from "@/lib/tarkovdev/economy";

import { stationNeedsPower } from "./fuel";
import { buyPrice, sellPrice, type MarketContext, type RouteKind } from "./pricing";
import { craftSeconds } from "./skill";
import { craftTaskUnlock, unlockMet, type CraftUnlock } from "./unlocks";

/**
 * How many barters and crafts deep a route may go, on each side of the row.
 *
 * Three covers every chain worth reading — a bartered part, crafted into a component,
 * crafted into the ingredient — and the breakdown shows each level indented, so a deeper
 * one would be more tree than anyone checks before trusting the row.
 */
export const MAX_ROUTE_DEPTH = 3;

/**
 * Something standing between the reader and a step.
 *
 * `met` is null where nobody has said: an unrecorded trader or station, a task with no logs
 * to ask, an edition the app cannot see. Only a false makes a route `locked`.
 */
export type Gate =
  | { kind: "loyalty"; traderId: string; level: number; recorded: number; met: boolean }
  | { kind: "station"; stationId: string; level: number; recorded: number; met: boolean }
  | { kind: "task"; taskId: string; met: boolean | null }
  | { kind: "edition"; met: null };

/** One line of what a craft or a trade consumes, costed through its own route. */
export interface RouteLine {
  itemId: string;
  /** Null when the catalogue does not have the item, which means the documents disagree. */
  item: SellItem | null;
  /** Unrounded, because 0.66 of a water filter is genuinely what one craft asks for. */
  count: number;
  /** Present at the start, handed back at the end, so it costs nothing to run the craft. */
  tool: boolean;
  /** What one costs, and how it is got. Null for a tool, and for anything unpriceable. */
  unit: Acquisition | null;
  /** `unit` times `count`. Zero for a tool; null when there was no price to multiply. */
  cost: number | null;
}

interface StepBase {
  kind: "barter" | "craft";
  /** The barter's or the craft's id. */
  id: string;
  /** The trader's name for a barter, the station's for a craft. */
  where: string;
  /** Loyalty level for a barter, station level for a craft. */
  level: number;
  /** Only the ones worth saying: known loyalty and station shortfalls, tasks, editions. */
  gates: Gate[];
  /**
   * What one run consumes, each through its own route. On a step that takes the item away,
   * every line except that item.
   */
  lines: RouteLine[];
  /** Generator fuel one run burns. Zero for a barter and for a station that needs no power. */
  fuelCost: number;
  /** One run at the Crafting skill. Zero for a barter. */
  seconds: number;
  /**
   * Barter only: how many times one restock lets you take it, or null for no limit. Every
   * figure here is per run, and a profit you can take once every few hours is worth knowing
   * before planning on twenty.
   */
  limit: number | null;
}

/** A barter or craft that hands over the item being got hold of. */
export interface MakeStep extends StepBase {
  /** How many of the item one run hands over. */
  yields: number;
}

/** A barter or craft that takes the item being got rid of. */
export interface TradeStep extends StepBase {
  /** How many of the item one run takes. */
  takes: number;
  /**
   * What the run gives back, and where that goes in turn. `foundInRaid` is false for a
   * barter's, which is why its disposal never reaches the flea.
   */
  product: {
    itemId: string;
    item: SellItem | null;
    count: number;
    foundInRaid: boolean;
    disposal: Disposal;
  };
}

/** How one of an item is got hold of. */
export interface Acquisition {
  from: RouteKind;
  /** One unit, all in: for a barter or craft, its inputs and fuel over what one run yields. */
  priceRUB: number;
  /** The trader offer, for a cash purchase. */
  offer: NamedOffer | null;
  /** Craft time one unit carries, through every craft beneath it. Zero for anything bought. */
  seconds: number;
  step: MakeStep | null;
  /** A gate somewhere in the route that the reader is known not to meet. */
  locked: boolean;
}

/** How one of an item is got rid of. */
export interface Disposal {
  to: RouteKind;
  /** What you ask, before the flea takes anything. For a barter or craft, the same as `net`. */
  priceRUB: number;
  /** The listing fee. Zero anywhere but the flea. */
  fee: number;
  /**
   * What one unit ends up worth. For a barter or craft: what its product clears, less its
   * other inputs and fuel, over how many of this item it takes. Can be negative.
   */
  net: number;
  offer: NamedOffer | null;
  /** Craft time one unit carries, through every craft after it. */
  seconds: number;
  step: TradeStep | null;
  locked: boolean;
}

/** The barters and crafts, indexed from both ends. */
export interface RouteGraph {
  stations: ReadonlyMap<string, HideoutStation>;
  bartersMaking: ReadonlyMap<string, readonly Barter[]>;
  bartersTaking: ReadonlyMap<string, readonly Barter[]>;
  craftsMaking: ReadonlyMap<string, readonly Craft[]>;
  craftsTaking: ReadonlyMap<string, readonly Craft[]>;
}

export interface RouteContext {
  index: SellIndex;
  graph: RouteGraph;
  market: MarketContext;
  /** How ingredients may be got. */
  buyFrom: ReadonlySet<RouteKind>;
  /** How the product may be got rid of. */
  sellTo: ReadonlySet<RouteKind>;
  /** 0 to 50. Anything outside is clamped rather than refused. */
  craftingSkill: number;
  /** Roubles an hour of generator time costs, or null to charge no fuel. */
  fuelRoublesPerHour: number | null;
  /** Recorded hideout, for the station gate on a craft. */
  hideoutLevels: Readonly<Record<string, number>>;
  /**
   * Recorded loyalty, for the gate on a barter. Separate from `market.traderLevels`, which
   * is null when "My loyalty only" is off: that switch decides which cash offers count, and
   * a barter is flagged against what you recorded either way.
   */
  traderLevels: Readonly<Record<string, number>>;
  /** Station and product to unlocking task, from `craftUnlockIndex`. */
  craftUnlocks: ReadonlyMap<string, CraftUnlock>;
  /** Task progress from the logs, or null when there are no logs to read. */
  taskStates: ReadonlyMap<string, { status: TaskStatus }> | null;
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (!list) map.set(key, [value]);
  else if (!list.includes(value)) list.push(value);
}

/**
 * Index the barters and crafts by what they make and what they use up.
 *
 * Tools are left out of the taking side: a craft that borrows an item and hands it back is
 * not somewhere to get rid of one.
 */
export function routeGraph(economy: {
  stations: readonly HideoutStation[];
  barters: readonly Barter[];
  crafts: readonly Craft[];
}): RouteGraph {
  const bartersMaking = new Map<string, Barter[]>();
  const bartersTaking = new Map<string, Barter[]>();
  const craftsMaking = new Map<string, Craft[]>();
  const craftsTaking = new Map<string, Craft[]>();

  for (const barter of economy.barters) {
    push(bartersMaking, barter.offeredItem.itemId, barter);
    for (const line of barter.requiredItems) {
      if (!line.tool) push(bartersTaking, line.itemId, barter);
    }
  }
  for (const craft of economy.crafts) {
    push(craftsMaking, craft.productItem.itemId, craft);
    for (const line of craft.requiredItems) {
      if (!line.tool) push(craftsTaking, line.itemId, craft);
    }
  }

  return {
    stations: new Map(economy.stations.map((station) => [station.id, station])),
    bartersMaking,
    bartersTaking,
    craftsMaking,
    craftsTaking,
  };
}

/** What stands between the reader and a barter. */
export function barterGates(
  barter: Barter,
  context: Pick<RouteContext, "traderLevels" | "taskStates">,
): Gate[] {
  const gates: Gate[] = [];
  const level = barter.minTraderLevel ?? 1;
  const recorded = context.traderLevels[barter.traderId];
  if (level > 1 && recorded !== undefined) {
    gates.push({
      kind: "loyalty",
      traderId: barter.traderId,
      level,
      recorded,
      met: recorded >= level,
    });
  }
  if (barter.taskUnlock) {
    // A barter unlock is a finish reward; nothing hands one out on accepting the task.
    const status = context.taskStates?.get(barter.taskUnlock)?.status;
    gates.push({
      kind: "task",
      taskId: barter.taskUnlock,
      met: context.taskStates === null ? null : status === "finished",
    });
  }
  return gates;
}

/** What stands between the reader and a craft, by the same rules the row uses for its own. */
export function craftGates(
  craft: Craft,
  context: Pick<RouteContext, "hideoutLevels" | "craftUnlocks" | "taskStates">,
): Gate[] {
  const gates: Gate[] = [];
  const recorded = context.hideoutLevels[craft.stationId];
  if (recorded !== undefined) {
    gates.push({
      kind: "station",
      stationId: craft.stationId,
      level: craft.level,
      recorded,
      met: recorded >= craft.level,
    });
  }
  const unlock = craftTaskUnlock(craft, context.craftUnlocks);
  if (unlock) {
    gates.push({
      kind: "task",
      taskId: unlock.taskId,
      met:
        context.taskStates === null
          ? null
          : unlockMet(unlock, context.taskStates.get(unlock.taskId)?.status),
    });
  }
  if (craft.gameEditions.length > 0) gates.push({ kind: "edition", met: null });
  return gates;
}

const unmet = (gates: readonly Gate[]) => gates.some((gate) => gate.met === false);

export interface Planner {
  /** The best way to get one of an item, or null when no enabled route prices it. */
  acquire(itemId: string, depth?: number): Acquisition | null;
  /**
   * The best way to get rid of one, or null when no enabled route takes it. Found in raid
   * unless told otherwise, since the row's own product is crafted.
   */
  dispose(itemId: string, depth?: number, foundInRaid?: boolean): Disposal | null;
  /** A consumed line, costed through `acquire`. */
  line(requirement: ItemRequirement, depth?: number): RouteLine;
}

/**
 * Route choices for one row, at one rate.
 *
 * Memoised per item and depth, and only for the life of the planner: the rate and the root
 * product both change what the best answer is, so nothing here is safe to share between
 * rows. Every call below recurses at a strictly smaller depth, which is what keeps a key
 * from being asked for while it is still being worked out.
 */
export function planner(
  context: RouteContext,
  rootProductId: string | null,
  rate: number,
): Planner {
  const perSecond = Math.max(0, rate) / 3600;
  const bought = new Map<string, Acquisition | null>();
  const sold = new Map<string, Disposal | null>();
  // Where an item that is not found in raid can be sold: anywhere enabled but the flea.
  const sellToUnfound = new Set([...context.sellTo].filter((kind) => kind !== "flea"));

  const buyScore = (each: Acquisition) => each.priceRUB + perSecond * each.seconds;
  const sellScore = (each: Disposal) => each.net - perSecond * each.seconds;

  // Ties go to the faster route, which is also the one a rate above zero would pick.
  const cheaper = (a: Acquisition | null, b: Acquisition | null): Acquisition | null => {
    if (!a || !b) return a ?? b;
    const diff = buyScore(b) - buyScore(a);
    return diff < 0 || (diff === 0 && b.seconds < a.seconds) ? b : a;
  };
  const better = (a: Disposal | null, b: Disposal | null): Disposal | null => {
    if (!a || !b) return a ?? b;
    const diff = sellScore(b) - sellScore(a);
    return diff > 0 || (diff === 0 && b.seconds < a.seconds) ? b : a;
  };

  /** Whether any consumed line is one of `ids` or the root product. Tools do not count. */
  const touches = (consumed: readonly ItemRequirement[], id: string) =>
    consumed.some(
      (each) => !each.tool && (each.itemId === id || each.itemId === rootProductId),
    );

  const fuelFor = (station: HideoutStation | undefined, seconds: number) =>
    stationNeedsPower(station?.normalizedName) && context.fuelRoublesPerHour
      ? (context.fuelRoublesPerHour * seconds) / 3600
      : 0;

  function line(requirement: ItemRequirement, depth = MAX_ROUTE_DEPTH): RouteLine {
    const base: RouteLine = {
      itemId: requirement.itemId,
      item: context.index.items[requirement.itemId] ?? null,
      count: requirement.exactCount,
      tool: requirement.tool,
      unit: null,
      cost: requirement.tool ? 0 : null,
    };
    // A tool is not bought for the craft, so pricing it would be an amount nobody pays.
    if (requirement.tool) return base;
    const unit = acquire(requirement.itemId, depth);
    if (!unit) return base;
    return { ...base, unit, cost: unit.priceRUB * requirement.exactCount };
  }

  /** One unit of what a step makes: everything it cost, over how many it hands over. */
  function made(step: MakeStep): Acquisition | null {
    let cost = step.fuelCost;
    let seconds = step.seconds;
    let locked = unmet(step.gates);
    for (const each of step.lines) {
      // One unpriceable input and the route has no price, the same poison the row uses.
      if (each.cost === null) return null;
      cost += each.cost;
      if (each.unit) {
        seconds += each.unit.seconds * each.count;
        locked ||= each.unit.locked;
      }
    }
    const yields = Math.max(1, step.yields);
    return {
      from: step.kind,
      priceRUB: cost / yields,
      offer: null,
      seconds: seconds / yields,
      step,
      locked,
    };
  }

  /** One unit of what a step takes: what its product clears less everything else, per unit. */
  function traded(step: TradeStep): Disposal | null {
    const { disposal, count } = step.product;
    let value = disposal.net * count - step.fuelCost;
    let seconds = step.seconds + disposal.seconds * count;
    let locked = unmet(step.gates) || disposal.locked;
    for (const each of step.lines) {
      if (each.cost === null) return null;
      value -= each.cost;
      if (each.unit) {
        seconds += each.unit.seconds * each.count;
        locked ||= each.unit.locked;
      }
    }
    const takes = step.takes > 0 ? step.takes : 1;
    return {
      to: step.kind,
      priceRUB: value / takes,
      fee: 0,
      net: value / takes,
      offer: null,
      seconds: seconds / takes,
      step,
      locked,
    };
  }

  function acquire(itemId: string, depth = MAX_ROUTE_DEPTH): Acquisition | null {
    const key = `${itemId}@${depth}`;
    const memo = bought.get(key);
    if (memo !== undefined) return memo;

    let best: Acquisition | null = null;
    const item = context.index.items[itemId];
    if (item) {
      const quote = buyPrice(item, context.buyFrom, context.market);
      if (quote) best = { ...quote, seconds: 0, step: null, locked: false };
    }

    if (depth > 0 && context.buyFrom.has("barter")) {
      for (const barter of context.graph.bartersMaking.get(itemId) ?? []) {
        if (touches(barter.requiredItems, itemId)) continue;
        best = cheaper(
          best,
          made({
            kind: "barter",
            id: barter.id,
            where: context.market.traderNames.get(barter.traderId) ?? barter.traderId,
            level: barter.minTraderLevel ?? 1,
            gates: barterGates(barter, context),
            lines: barter.requiredItems.map((each) => line(each, depth - 1)),
            fuelCost: 0,
            seconds: 0,
            limit: barter.buyLimit,
            yields: barter.offeredItem.count,
          }),
        );
      }
    }

    if (depth > 0 && context.buyFrom.has("craft")) {
      for (const craft of context.graph.craftsMaking.get(itemId) ?? []) {
        if (touches(craft.requiredItems, itemId)) continue;
        const station = context.graph.stations.get(craft.stationId);
        const seconds = craftSeconds(craft.durationSeconds, context.craftingSkill);
        best = cheaper(
          best,
          made({
            kind: "craft",
            id: craft.id,
            where: station?.name ?? craft.stationId,
            level: craft.level,
            gates: craftGates(craft, context),
            lines: craft.requiredItems.map((each) => line(each, depth - 1)),
            fuelCost: fuelFor(station, seconds),
            seconds,
            limit: null,
            yields: craft.productItem.count,
          }),
        );
      }
    }

    bought.set(key, best);
    return best;
  }

  /**
   * The step half of a disposal, shared by barters and crafts: split the item's own lines
   * from the rest, and follow the product before costing anything, since most products
   * lead nowhere and the other lines need not be priced for those.
   */
  function taking(
    itemId: string,
    depth: number,
    consumed: readonly ItemRequirement[],
    product: { itemId: string; count: number },
    step: Omit<TradeStep, "lines" | "takes" | "product">,
  ): Disposal | null {
    if (product.itemId === itemId || product.itemId === rootProductId) return null;
    const others = consumed.filter((each) => each.tool || each.itemId !== itemId);
    if (touches(others, itemId)) return null;
    const takes = consumed
      .filter((each) => !each.tool && each.itemId === itemId)
      .reduce((total, each) => total + each.exactCount, 0);

    const foundInRaid = step.kind === "craft";
    const disposal = dispose(product.itemId, depth - 1, foundInRaid);
    if (!disposal) return null;

    return traded({
      ...step,
      lines: others.map((each) => line(each, depth - 1)),
      takes,
      product: {
        itemId: product.itemId,
        item: context.index.items[product.itemId] ?? null,
        count: product.count,
        foundInRaid,
        disposal,
      },
    });
  }

  function dispose(itemId: string, depth = MAX_ROUTE_DEPTH, foundInRaid = true): Disposal | null {
    const key = `${itemId}@${depth}${foundInRaid ? "" : ":traded"}`;
    const memo = sold.get(key);
    if (memo !== undefined) return memo;

    let best: Disposal | null = null;
    const item = context.index.items[itemId];
    if (item) {
      const quote = sellPrice(item, foundInRaid ? context.sellTo : sellToUnfound, context.market);
      if (quote) best = { ...quote, seconds: 0, step: null, locked: false };
    }

    if (depth > 0 && context.sellTo.has("barter")) {
      for (const barter of context.graph.bartersTaking.get(itemId) ?? []) {
        best = better(
          best,
          taking(itemId, depth, barter.requiredItems, barter.offeredItem, {
            kind: "barter",
            id: barter.id,
            where: context.market.traderNames.get(barter.traderId) ?? barter.traderId,
            level: barter.minTraderLevel ?? 1,
            gates: barterGates(barter, context),
            fuelCost: 0,
            seconds: 0,
            limit: barter.buyLimit,
          }),
        );
      }
    }

    if (depth > 0 && context.sellTo.has("craft")) {
      for (const craft of context.graph.craftsTaking.get(itemId) ?? []) {
        const station = context.graph.stations.get(craft.stationId);
        const seconds = craftSeconds(craft.durationSeconds, context.craftingSkill);
        best = better(
          best,
          taking(itemId, depth, craft.requiredItems, craft.productItem, {
            kind: "craft",
            id: craft.id,
            where: station?.name ?? craft.stationId,
            level: craft.level,
            gates: craftGates(craft, context),
            fuelCost: fuelFor(station, seconds),
            seconds,
            limit: null,
          }),
        );
      }
    }

    sold.set(key, best);
    return best;
  }

  return { acquire, dispose, line };
}
