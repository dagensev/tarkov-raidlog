/**
 * One barter, costed end to end.
 *
 * The shape mirrors `CraftRow`: everything a row puts on screen is worked out once here, the
 * page does nothing but format it, and one unpriceable input poisons every figure that
 * depends on it rather than settling for zero.
 *
 * **Why a barter needs two money columns.** The flea lists only found-in-raid items and a
 * traded item is not one, so what a barter hands over cannot be listed. Priced the way a
 * craft is — sell the product, subtract the inputs — almost every barter in the game is a
 * loss, which is true and useless: nobody barters in order to resell to Therapist. What a
 * barter is for is getting an item without paying the flea for it, so `savings` is the
 * headline figure and `resell` sits beside it as the honest cash-out.
 *
 * How each input is got, and where the product could go, is `@/lib/crafts/routes`'s
 * question. That module lives under crafts by history rather than by subject: the crafts
 * calculator was simply the first caller of it.
 */

import { craftPlan, type CraftPlan } from "@/lib/crafts/plan";
import { buyPrice, type BuyQuote } from "@/lib/crafts/pricing";
import {
  MAX_ROUTE_DEPTH,
  planner,
  routeGraph,
  type Disposal,
  type RouteContext,
  type RouteGraph,
  type RouteLine,
} from "@/lib/crafts/routes";
import type { SellIndex, SellItem } from "@/lib/tarkovdev/client";
import type { Barter, Craft, HideoutStation } from "@/lib/tarkovdev/economy";

/** A consumed line of the row's own barter. The same shape as any line in a route. */
export type BarterLine = RouteLine;

export interface BarterRow {
  barter: Barter;
  traderId: string;
  traderName: string;
  /** The loyalty the offer asks for. One when the document does not say. */
  minLevel: number;
  /** The loyalty recorded for the trader, or null when the reader has not said. */
  recordedLevel: number | null;
  /**
   * Whether you can make the trade now: recorded loyalty is high enough, and the logs do not
   * show its unlocking task unfinished. Anything nobody has told us counts as able.
   */
  runnable: boolean;
  taskUnlock: string | null;
  taskLocked: boolean;
  /** Whether the logs show that task finished. Null with no gate, or no logs to ask. */
  taskDone: boolean | null;
  /** Trades one restock allows, or null for no limit. */
  limit: number | null;
  lines: BarterLine[];
  product: SellItem | null;
  productName: string;
  productCount: number;
  /** Every line added up, or null when any one of them had no price. */
  cost: number | null;
  /** What buying the product outright would have cost, times the count handed over. */
  value: number | null;
  /** Which market that price came from, so the breakdown can name it. */
  valueFrom: BuyQuote | null;
  /** `value` less `cost`: what the trade is worth to someone who wanted the product. */
  savings: number | null;
  /**
   * That saving across a full restock. Not a column — the table ranks on the saving per
   * trade and shows the ration beside it — but the breakdown says it, since what a trade is
   * worth in a sitting is a fair question once you have decided to make it.
   */
  savingsPerRestock: number | null;
  /** What the product clears if you cash it out, and how. Never the flea — it is not FiR. */
  resale: Disposal | null;
  /** `resale` times `productCount`. */
  revenue: number | null;
  /** `revenue` less `cost`: the flip, which for most barters is a loss. */
  resell: number | null;
  /** Time the chosen routes add. Zero unless an input is crafted, or the product crafted on. */
  chainSeconds: number;
  /** Somewhere in the chosen routes is a barter or craft the reader cannot do yet. */
  routeLocked: boolean;
  /** The trade and its routes as whole steps to carry out. See `@/lib/crafts/plan`. */
  plan: CraftPlan;
}

/** Everything a row needs beyond the barter, the catalogue and the graph. */
export type BarterRowOptions = Omit<RouteContext, "index" | "graph">;

/**
 * What the product would have cost in cash, per unit.
 *
 * Deliberately `buyPrice` rather than the planner's `acquire`. The planner prices an item
 * through the cheapest route it can find, and one of the routes it can find is this very
 * barter — the loop guard only skips a step that *consumes* the item it is producing, so
 * nothing stops it — which would make the value equal the cost and every saving zero. It is
 * the clearer question anyway: a saving is against what you would otherwise have paid, and
 * what you would otherwise have paid is money. `buyPrice` ignores the barter and craft kinds
 * in the set already, so the reader's own buy sources go straight through.
 */
function cashValue(
  product: SellItem | null,
  context: RouteContext,
): { value: number | null; quote: BuyQuote | null } {
  if (!product) return { value: null, quote: null };
  const quote = buyPrice(product, context.buyFrom, context.market);
  return { value: quote ? quote.priceRUB : null, quote };
}

export function barterRow(
  barter: Barter,
  graph: RouteGraph,
  index: SellIndex,
  options: BarterRowOptions,
): BarterRow {
  const context: RouteContext = { ...options, index, graph };
  // A rate of zero is plain cheapest. `craftRow` searches for a better one because a craft
  // occupies a station for hours and the column it is sorted on divides by those hours; a
  // barter is instant and ranked on roubles, so there is no rate worth searching for.
  const routes = planner(context, barter.offeredItem.itemId, 0);

  const traderName = options.market.traderNames.get(barter.traderId) ?? barter.traderId;
  const minLevel = barter.minTraderLevel ?? 1;
  const recorded = options.traderLevels[barter.traderId];
  const recordedLevel = recorded === undefined ? null : recorded;

  // A barter unlock is a finish reward; nothing hands one out on accepting the task.
  const taskDone =
    barter.taskUnlock === null || options.taskStates === null
      ? null
      : options.taskStates.get(barter.taskUnlock)?.status === "finished";

  const lines = barter.requiredItems.map((line) => routes.line(line));
  const cost = lines.some((line) => line.cost === null)
    ? null
    : lines.reduce((total, line) => total + (line.cost ?? 0), 0);

  const productId = barter.offeredItem.itemId;
  const productCount = barter.offeredItem.count;
  const product = index.items[productId] ?? null;

  const { value: unitValue, quote } = cashValue(product, context);
  const value = unitValue === null ? null : unitValue * productCount;
  const savings = value === null || cost === null ? null : value - cost;

  // False, not the default: what a barter hands over is traded, so `dispose` leaves the flea
  // out of the sinks it will consider.
  const resale = routes.dispose(productId, MAX_ROUTE_DEPTH, false);
  const revenue = resale ? resale.net * productCount : null;
  const resell = revenue === null || cost === null ? null : revenue - cost;

  const chainSeconds =
    lines.reduce((total, line) => total + (line.unit?.seconds ?? 0) * line.count, 0) +
    (resale?.seconds ?? 0) * productCount;

  return {
    barter,
    traderId: barter.traderId,
    traderName,
    minLevel,
    recordedLevel,
    // Silence is not a no: an unrecorded loyalty counts as high enough, and a task gate with
    // no logs behind it counts as passed. The same stance `craftRow` takes on its station.
    runnable: (recordedLevel === null || recordedLevel >= minLevel) && taskDone !== false,
    taskUnlock: barter.taskUnlock,
    taskLocked: barter.taskUnlock !== null,
    taskDone,
    limit: barter.buyLimit,
    lines,
    product,
    productName: product?.name ?? productId,
    productCount,
    cost,
    value,
    valueFrom: quote,
    savings,
    savingsPerRestock:
      savings === null || barter.buyLimit === null ? null : savings * barter.buyLimit,
    resale,
    revenue,
    resell,
    chainSeconds,
    routeLocked: lines.some((line) => line.unit?.locked) || (resale?.locked ?? false),
    plan: craftPlan({
      kind: "barter",
      id: barter.id,
      where: traderName,
      level: minLevel,
      seconds: 0,
      limit: barter.buyLimit,
      lines,
      product: { itemId: productId, item: product, count: productCount },
      sale: resale,
    }),
  };
}

/**
 * Every barter, costed.
 *
 * Built once per data or assumption change and filtered per keystroke, the way the crafts
 * and flea tables do it. There are 806 of these against the crafts tab's 213, so keeping the
 * search query out of this matters rather more here.
 */
export function barterRows(
  economy: {
    barters: readonly Barter[];
    crafts: readonly Craft[];
    stations: readonly HideoutStation[];
  },
  index: SellIndex,
  options: BarterRowOptions,
): BarterRow[] {
  const graph = routeGraph(economy);
  return economy.barters.map((barter) => barterRow(barter, graph, index, options));
}
