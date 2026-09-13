/**
 * One craft, costed end to end.
 *
 * The shape mirrors `SellRow` on the flea tab: everything a row puts on screen is worked
 * out once here, and the page does nothing but format it. The one habit worth keeping is
 * the null discipline — an ingredient nobody sells has no cost, a craft with such an
 * ingredient has no profit, and both say so rather than settling for zero. A table sorted
 * on profit per hour is only worth reading if the top of it is real.
 */

import type { TaskStatus } from "@/lib/logs/progress";
import type { SellIndex, SellItem } from "@/lib/tarkovdev/client";
import type { Craft, HideoutStation } from "@/lib/tarkovdev/economy";

import { stationNeedsPower } from "./fuel";
import { craftTaskUnlock, unlockMet, type CraftUnlock } from "./unlocks";
import type {
  Acquisition,
  Disposal,
  InputSource,
  MarketContext,
  OutputSource,
} from "./pricing";
import { buyPrice, sellPrice } from "./pricing";

/**
 * How much of a craft's time each level of the Crafting skill takes off.
 *
 * 0.75% a level, reaching 37.5% at Elite. The skill also speeds cyclic production, which
 * is not something this table has rows for.
 */
export const CRAFTING_TIME_PER_LEVEL = 0.0075;

/** Elite. Levels above this exist as a rank, not as more of the bonus. */
export const CRAFTING_MAX_LEVEL = 50;

export interface CraftLine {
  itemId: string;
  /** Null when the catalogue does not have the item, which means the documents disagree. */
  item: SellItem | null;
  /** Unrounded, because 0.66 of a water filter is genuinely what one craft asks for. */
  count: number;
  /** Present at the start, handed back at the end, so it costs nothing to run the craft. */
  tool: boolean;
  /** What one costs, and where from. Null for a tool, and for anything unpriceable. */
  unit: Acquisition | null;
  /** `unit` times `count`. Zero for a tool; null when there was no price to multiply. */
  cost: number | null;
}

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
  /** What it takes at the reader's skill level. */
  seconds: number;
  /** Every consumed line added up, or null when any one of them had no price. */
  inputCost: number | null;
  /** Fuel burned over `seconds`. Zero when fuel is switched off or has no price. */
  fuelCost: number;
  /** What the product clears, once. */
  unitRevenue: Disposal | null;
  /** `unitRevenue` times `productCount`. */
  revenue: number | null;
  profit: number | null;
  profitPerHour: number | null;
}

export interface CraftRowOptions {
  market: MarketContext;
  inputSource: InputSource;
  outputSource: OutputSource;
  /** 0 to 50. Anything outside is clamped rather than refused. */
  craftingSkill: number;
  /** Roubles an hour of generator time costs, or null to charge no fuel. */
  fuelRoublesPerHour: number | null;
  /** Recorded hideout, for the runnable flag. */
  hideoutLevels: Readonly<Record<string, number>>;
  /** Station and product to unlocking task, from `craftUnlockIndex`. */
  craftUnlocks: ReadonlyMap<string, CraftUnlock>;
  /** Task progress from the logs, or null when there are no logs to read. */
  taskStates: ReadonlyMap<string, { status: TaskStatus }> | null;
}

/** Seconds one run takes at a given Crafting skill level. */
export function craftSeconds(baseSeconds: number, craftingSkill: number): number {
  const level = Math.min(CRAFTING_MAX_LEVEL, Math.max(0, Math.floor(craftingSkill || 0)));
  return baseSeconds * (1 - CRAFTING_TIME_PER_LEVEL * level);
}

function costLine(
  line: Craft["requiredItems"][number],
  index: SellIndex,
  options: CraftRowOptions,
): CraftLine {
  const item = index.items[line.itemId] ?? null;
  const base: CraftLine = {
    itemId: line.itemId,
    item,
    count: line.exactCount,
    tool: line.tool,
    unit: null,
    cost: line.tool ? 0 : null,
  };
  // A tool is not bought for the craft, so pricing it would be an amount nobody pays.
  if (line.tool || !item) return base;

  const unit = buyPrice(item, options.inputSource, options.market);
  if (!unit) return base;
  return { ...base, unit, cost: unit.priceRUB * line.exactCount };
}

export function craftRow(
  craft: Craft,
  stations: ReadonlyMap<string, HideoutStation>,
  index: SellIndex,
  options: CraftRowOptions,
): CraftRow {
  const station = stations.get(craft.stationId) ?? null;
  const recorded = options.hideoutLevels[craft.stationId];
  const recordedLevel = recorded === undefined ? null : recorded;

  const unlock = craftTaskUnlock(craft, options.craftUnlocks);
  const taskDone =
    unlock === null || options.taskStates === null
      ? null
      : unlockMet(unlock, options.taskStates.get(unlock.taskId)?.status);

  const lines = craft.requiredItems.map((line) => costLine(line, index, options));
  // One unpriceable line poisons the sum, which is the point: a partial cost read as a
  // whole one is a profit figure that is too high by however much was missing.
  const inputCost = lines.some((line) => line.cost === null)
    ? null
    : lines.reduce((total, line) => total + (line.cost ?? 0), 0);

  const seconds = craftSeconds(craft.durationSeconds, options.craftingSkill);
  const hours = seconds / 3600;
  // A station that works with the generator off costs nothing to keep going, whatever the
  // generator is doing for the others.
  const usesPower = stationNeedsPower(station?.normalizedName);
  const fuelCost =
    usesPower && options.fuelRoublesPerHour ? options.fuelRoublesPerHour * hours : 0;

  const product = index.items[craft.productItem.itemId] ?? null;
  const unitRevenue = product ? sellPrice(product, options.outputSource, options.market) : null;
  const revenue = unitRevenue ? unitRevenue.net * craft.productItem.count : null;

  const profit = revenue === null || inputCost === null ? null : revenue - inputCost - fuelCost;
  // A craft with no duration cannot have a rate, and dividing by zero would put Infinity
  // at the top of the default ordering.
  const profitPerHour = profit === null || hours <= 0 ? null : profit / hours;

  return {
    craft,
    station,
    stationName: station?.name ?? craft.stationId,
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
    lines,
    product,
    productName: product?.name ?? craft.productItem.itemId,
    productCount: craft.productItem.count,
    baseSeconds: craft.durationSeconds,
    seconds,
    inputCost,
    fuelCost,
    unitRevenue,
    revenue,
    profit,
    profitPerHour,
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
  crafts: readonly Craft[],
  stations: readonly HideoutStation[],
  index: SellIndex,
  options: CraftRowOptions,
): CraftRow[] {
  const byId = new Map(stations.map((station) => [station.id, station]));
  return crafts.map((craft) => craftRow(craft, byId, index, options));
}
