/**
 * One craft, costed end to end.
 *
 * The shape mirrors `SellRow` on the flea tab: everything a row puts on screen is worked
 * out once here, and the page does nothing but format it. The one habit worth keeping is
 * the null discipline — an ingredient nobody sells has no cost, a craft with such an
 * ingredient has no profit, and both say so rather than settling for zero. A table sorted
 * on profit per hour is only worth reading if the top of it is real.
 *
 * How each ingredient is got and where the product goes is ./routes.ts's question. This
 * adds the row's own craft to what it answers, and picks the one plan the row describes.
 */

import type { SellIndex, SellItem } from "@/lib/tarkovdev/client";
import type { Barter, Craft, HideoutStation } from "@/lib/tarkovdev/economy";

import { stationNeedsPower } from "./fuel";
import { craftPlan, type CraftPlan } from "./plan";
import {
  planner,
  routeGraph,
  type Disposal,
  type RouteContext,
  type RouteGraph,
  type RouteLine,
} from "./routes";
import { craftSeconds } from "./skill";
import { craftTaskUnlock, unlockMet } from "./unlocks";

export { CRAFTING_MAX_LEVEL, CRAFTING_TIME_PER_LEVEL, craftSeconds } from "./skill";

/** A consumed line of the row's own craft. The same shape as any line in a route. */
export type CraftLine = RouteLine;

/**
 * How many times the routes are re-chosen at a better rate before the row settles.
 *
 * The search converges in two or three on the live data; the cap is only there so a
 * pathological case costs a bounded amount rather than a frozen tab.
 */
const RATE_ROUNDS = 6;

export interface CraftRow {
  craft: Craft;
  station: HideoutStation | null;
  stationName: string;
  /** The level recorded for the station, or null when the reader has not said. */
  recordedLevel: number | null;
  /**
   * Whether you can start it now: the recorded hideout is high enough, and the logs do not
   * show its unlocking task unfinished. Anything nobody has told us counts as able.
   */
  runnable: boolean;
  /** The task that unlocks it, from the craft or recovered from task rewards. */
  taskUnlock: string | null;
  taskLocked: boolean;
  /**
   * Whether the logs show that task far enough along to have handed the craft out. Null
   * when there is no gate, or no logs to ask — the page cannot tell, and says so.
   */
  taskDone: boolean | null;
  editionLocked: boolean;
  /** Whether the station needs the generator on. The Lavatory does not, so it burns no fuel. */
  usesPower: boolean;
  lines: CraftLine[];
  product: SellItem | null;
  productName: string;
  productCount: number;
  /** The document's own figure, before the Crafting skill. */
  baseSeconds: number;
  /** What this craft takes at the reader's skill level. */
  seconds: number;
  /**
   * Time the chosen routes add: the crafts making its ingredients and the crafts its
   * product goes on into, each scaled by how much of a run the row uses.
   */
  chainSeconds: number;
  /** `seconds` plus `chainSeconds`, which is what profit per hour divides by. */
  totalSeconds: number;
  /** Every consumed line added up, or null when any one of them had no price. */
  inputCost: number | null;
  /** Fuel burned over `seconds`. Zero when fuel is switched off or has no price. */
  fuelCost: number;
  /** What the product clears, once, and how. */
  unitRevenue: Disposal | null;
  /** `unitRevenue` times `productCount`. */
  revenue: number | null;
  profit: number | null;
  profitPerHour: number | null;
  /** Somewhere in the chosen routes is a barter or craft the reader is known not to be able to do. */
  routeLocked: boolean;
  /** The chosen routes as whole steps to carry out, for the fewest runs that come out even. See ./plan.ts. */
  plan: CraftPlan;
}

/** Everything a row needs beyond the craft, the catalogue and the graph. */
export type CraftRowOptions = Omit<RouteContext, "index" | "graph">;

/** The parts of a row that depend on which routes were chosen. */
type Choice = Pick<
  CraftRow,
  | "lines"
  | "chainSeconds"
  | "totalSeconds"
  | "inputCost"
  | "unitRevenue"
  | "revenue"
  | "profit"
  | "profitPerHour"
  | "routeLocked"
>;

function choose(
  craft: Craft,
  context: RouteContext,
  seconds: number,
  fuelCost: number,
  rate: number,
): Choice {
  const routes = planner(context, craft.productItem.itemId, rate);
  const count = craft.productItem.count;

  const lines = craft.requiredItems.map((line) => routes.line(line));
  // One unpriceable line poisons the sum, which is the point: a partial cost read as a
  // whole one is a profit figure that is too high by however much was missing.
  const inputCost = lines.some((line) => line.cost === null)
    ? null
    : lines.reduce((total, line) => total + (line.cost ?? 0), 0);

  const unitRevenue = routes.dispose(craft.productItem.itemId);
  const revenue = unitRevenue ? unitRevenue.net * count : null;

  const chainSeconds =
    lines.reduce((total, line) => total + (line.unit?.seconds ?? 0) * line.count, 0) +
    (unitRevenue?.seconds ?? 0) * count;
  const totalSeconds = seconds + chainSeconds;

  const profit = revenue === null || inputCost === null ? null : revenue - inputCost - fuelCost;
  // A craft with no duration cannot have a rate, and dividing by zero would put Infinity
  // at the top of the default ordering.
  const profitPerHour = profit === null || totalSeconds <= 0 ? null : profit / (totalSeconds / 3600);

  return {
    lines,
    chainSeconds,
    totalSeconds,
    inputCost,
    unitRevenue,
    revenue,
    profit,
    profitPerHour,
    routeLocked: lines.some((line) => line.unit?.locked) || (unitRevenue?.locked ?? false),
  };
}

/**
 * The route choice with the best profit per hour.
 *
 * Profit per hour is a ratio, and a ratio does not split into one best choice per
 * ingredient. What does split is profit less hours at a fixed rate, so this is Dinkelbach's
 * method: choose every route at the rate the last choice earned, and repeat while that earns
 * more. Each round can only raise the rate, and a round that does not has found the best.
 *
 * It starts at zero, which is plain cheapest, and stops there whenever that choice adds no
 * craft time — nothing slower can beat a choice that is already the cheapest and the
 * fastest, which is most rows. A loss-making row is left at cheapest too: chasing its rate
 * would favour slower routes to spread the loss thinner, which answers nobody's question.
 */
function bestChoice(craft: Craft, context: RouteContext, seconds: number, fuelCost: number): Choice {
  let best = choose(craft, context, seconds, fuelCost, 0);
  for (let round = 0; round < RATE_ROUNDS; round += 1) {
    if (best.profitPerHour === null || best.profitPerHour <= 0 || best.chainSeconds === 0) break;
    const next = choose(craft, context, seconds, fuelCost, best.profitPerHour);
    // Under a rouble an hour is float noise, and a choice that merely ties is the same answer.
    if (next.profitPerHour === null || next.profitPerHour < best.profitPerHour + 1) break;
    best = next;
  }
  return best;
}

export function craftRow(
  craft: Craft,
  graph: RouteGraph,
  index: SellIndex,
  options: CraftRowOptions,
): CraftRow {
  const context: RouteContext = { ...options, index, graph };
  const station = graph.stations.get(craft.stationId) ?? null;
  const stationName = station?.name ?? craft.stationId;
  const recorded = options.hideoutLevels[craft.stationId];
  const recordedLevel = recorded === undefined ? null : recorded;

  const unlock = craftTaskUnlock(craft, options.craftUnlocks);
  const taskDone =
    unlock === null || options.taskStates === null
      ? null
      : unlockMet(unlock, options.taskStates.get(unlock.taskId)?.status);

  const seconds = craftSeconds(craft.durationSeconds, options.craftingSkill);
  // A station that works with the generator off costs nothing to keep going, whatever the
  // generator is doing for the others.
  const usesPower = stationNeedsPower(station?.normalizedName);
  const fuelCost =
    usesPower && options.fuelRoublesPerHour ? (options.fuelRoublesPerHour * seconds) / 3600 : 0;

  const product = index.items[craft.productItem.itemId] ?? null;
  const chosen = bestChoice(craft, context, seconds, fuelCost);

  return {
    craft,
    station,
    stationName,
    recordedLevel,
    // An unrecorded station is treated as able, matching the keep list: silence about a
    // station is not the same as being told it is not built. The same holds for a gated
    // craft when there are no logs to say where the task stands.
    runnable: (recordedLevel === null || recordedLevel >= craft.level) && taskDone !== false,
    taskUnlock: unlock?.taskId ?? null,
    taskLocked: unlock !== null,
    taskDone,
    editionLocked: craft.gameEditions.length > 0,
    usesPower,
    product,
    productName: product?.name ?? craft.productItem.itemId,
    productCount: craft.productItem.count,
    baseSeconds: craft.durationSeconds,
    seconds,
    fuelCost,
    ...chosen,
    plan: craftPlan({
      craftId: craft.id,
      stationName,
      level: craft.level,
      seconds,
      lines: chosen.lines,
      product: { itemId: craft.productItem.itemId, item: product, count: craft.productItem.count },
      sale: chosen.unitRevenue,
    }),
  };
}

/**
 * Every craft, costed.
 *
 * Built once per data or assumption change and filtered per keystroke, the way the flea
 * tab does it: 213 rows is cheap to rebuild and cheaper still to re-filter, and keeping
 * the query out of this means typing in the search box never re-prices anything.
 */
export function craftRows(
  economy: {
    crafts: readonly Craft[];
    stations: readonly HideoutStation[];
    barters: readonly Barter[];
  },
  index: SellIndex,
  options: CraftRowOptions,
): CraftRow[] {
  const graph = routeGraph(economy);
  return economy.crafts.map((craft) => craftRow(craft, graph, index, options));
}
