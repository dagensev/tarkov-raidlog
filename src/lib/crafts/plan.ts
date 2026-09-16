/**
 * A row's plan, step by step, in whole runs and whole items.
 *
 * ./routes.ts prices a route as a tree, per unit, which is the shape a figure is worked out
 * in and the wrong one to follow at the hideout. Averaged like that, one run of a row can
 * need half a craft and a third of a box of matches. A plan has to be something you can do,
 * so this walks the tree again in whole runs: a craft that makes two when one is needed runs
 * once and leaves a spare, and a trade that takes three waits until there are three.
 *
 * Then it looks for the smallest batch of the row's own craft, up to `MAX_BATCH`, at which
 * nothing is left over. At that batch the whole-run plan and the averaged price agree
 * exactly, which is why the breakdown scales its working to the same batch. Where no batch
 * that small comes out even — a craft using 0.66 of a water filter only does at fifty — it
 * settles for the smallest batch that carries the chain all the way through, and lists what
 * is left over. Measured on the live data, about four rows in five come out even by ten.
 *
 * No prices. The working under the plan carries those, and a plan that repeated them would
 * be a second place for a figure to disagree with itself.
 */

import type { SellItem } from "@/lib/tarkovdev/client";

import type { Disposal, Gate, RouteLine } from "./routes";

/** The most runs of the row a plan will batch up to find whole numbers. */
export const MAX_BATCH = 10;

/** Below this a count is float noise, not part of an item: a third times three is 0.9999999. */
const EPSILON = 1e-6;
const roundUp = (n: number) => Math.ceil(n - EPSILON);
const roundDown = (n: number) => Math.floor(n + EPSILON);

export interface PlanItem {
  itemId: string;
  /** Null when the catalogue does not have the item. */
  item: SellItem | null;
  count: number;
}

/** An item bought or sold for money, and where. */
export interface MarketItem extends PlanItem {
  market: "flea" | "trader";
  /** The trader's name, for a trader. */
  trader: string | null;
  /** Buying only: the loyalty level the trader's offer needs, when it names one. */
  level: number | null;
  /**
   * Buying only: how much of what is bought gets used. Under `count` for an item a craft uses
   * part of — 0.66 of a water filter is two thirds of its resource, and filters come whole.
   */
  uses: number | null;
}

/** What a step hands over, and how much of it the plan has no use for. */
export interface GivenItem extends PlanItem {
  spare: number;
}

/** Everything bought for money, and the tools that have to be on hand. */
export interface BuyStep {
  kind: "buy";
  items: MarketItem[];
  /** Needed but handed back, so counted once each however many runs use them. */
  tools: PlanItem[];
}

/** A craft at a station, or a barter with a trader. */
export interface RunStep {
  kind: "craft" | "barter";
  /** The craft's or barter's id. One reached twice is one step, with the runs added. */
  id: string;
  /** The station's name for a craft, the trader's for a barter. */
  where: string;
  /** Station level for a craft, loyalty level for a barter. */
  level: number;
  /** Whole crafts run, or trades made, across the batch. */
  runs: number;
  /** One run at the Crafting skill. Zero for a barter. */
  seconds: number;
  /** Everything consumed across the runs. Tools are in the buy step instead. */
  takes: PlanItem[];
  gives: GivenItem[];
  gates: readonly Gate[];
  /** Barter only: trades one restock allows, or null for no limit. */
  limit: number | null;
}

/** Everything sold for money at the ends of the chain. */
export interface SellStep {
  kind: "sell";
  items: MarketItem[];
}

export type PlanStep = BuyStep | RunStep | SellStep;

export interface CraftPlan {
  /** Runs of the row's own craft the plan covers. */
  batch: number;
  /** Whether that batch comes out even: nothing rounded, nothing left over. */
  exact: boolean;
  steps: PlanStep[];
  /** Made beyond what the batch uses, or not enough of to trade yet. Kept for the next one. */
  leftovers: PlanItem[];
}

/**
 * The row's own craft or barter, and the routes chosen on either side of it.
 *
 * A barter root is the barters tab's; everything below treats it exactly as it treats a
 * barter reached partway down a route, which is what lets one plan serve both tables.
 */
export interface PlanRoot {
  kind: "craft" | "barter";
  /** The craft's or the barter's id. */
  id: string;
  /** The station's name for a craft, the trader's for a barter. */
  where: string;
  /** Station level for a craft, loyalty level for a barter. */
  level: number;
  /** One run at the Crafting skill. Zero for a barter. */
  seconds: number;
  /** Barter only: trades one restock allows, or null for no limit. */
  limit: number | null;
  lines: readonly RouteLine[];
  product: PlanItem;
  sale: Disposal | null;
}

/**
 * Whether one run of the row needs more trades of a barter than one restock allows.
 *
 * Per run of the row rather than per batch, since a batch of six is a choice this module
 * made, and a trade you can make twice a restock is not rationed for a row that needs one.
 * The figures stay per run either way; this is only whether you can carry it out in a sitting.
 */
export function exceedsRestock(step: PlanStep, batch = 1): step is RunStep & { limit: number } {
  return step.kind === "barter" && step.limit !== null && step.runs / batch > step.limit + EPSILON;
}

function addTo<T extends PlanItem>(list: T[], entry: T): void {
  const found = list.find((each) => each.itemId === entry.itemId);
  if (!found) {
    list.push({ ...entry });
    return;
  }
  found.count += entry.count;
  if ("spare" in found && "spare" in entry) (found as GivenItem).spare += (entry as GivenItem).spare;
}

const consumed = (lines: readonly RouteLine[], runs: number): PlanItem[] =>
  lines
    .filter((line) => !line.tool)
    .map((line) => ({ itemId: line.itemId, item: line.item, count: line.count * runs }));

/** The plan at one batch size, and whether some trade never got enough to happen at all. */
function simulate(root: PlanRoot, batch: number): CraftPlan & { short: boolean } {
  const bought = new Map<string, MarketItem>();
  const sold = new Map<string, MarketItem>();
  const tools = new Map<string, PlanItem>();
  const leftovers: PlanItem[] = [];
  const runs: RunStep[] = [];
  const byId = new Map<string, RunStep>();
  let exact = true;
  let short = false;

  const atMarket = (target: Map<string, MarketItem>, entry: MarketItem) => {
    const key = `${entry.itemId}:${entry.market}:${entry.trader ?? ""}`;
    const found = target.get(key);
    if (!found) {
      target.set(key, { ...entry });
      return;
    }
    found.count += entry.count;
    if (found.uses !== null && entry.uses !== null) found.uses += entry.uses;
  };

  const keep = (entry: PlanItem) => {
    exact = false;
    addTo(leftovers, entry);
  };

  // Each step is recorded after everything that feeds it, so the list reads in the order the
  // work has to happen. A step reached a second time keeps its first place.
  const record = (step: RunStep) => {
    const key = `${step.kind}:${step.id}`;
    const found = byId.get(key);
    if (!found) {
      const copy = { ...step, takes: step.takes.map((e) => ({ ...e })), gives: step.gives.map((e) => ({ ...e })) };
      byId.set(key, copy);
      runs.push(copy);
      return;
    }
    found.runs += step.runs;
    for (const each of step.takes) addTo(found.takes, each);
    for (const each of step.gives) addTo(found.gives, each);
  };

  function obtain(line: RouteLine, need: number): void {
    if (line.tool) {
      if (!tools.has(line.itemId)) tools.set(line.itemId, { itemId: line.itemId, item: line.item, count: 1 });
      return;
    }
    const unit = line.unit;
    // An unpriceable line leaves the row with no profit, and nothing honest to plan.
    if (!unit || need <= EPSILON) return;

    const step = unit.step;
    if (!step) {
      const count = roundUp(need);
      // The unused part of an item bought whole is its resource, not a spare worth listing.
      if (count - need > EPSILON) exact = false;
      const trader = unit.from === "trader";
      atMarket(bought, {
        itemId: line.itemId,
        item: line.item,
        count,
        market: trader ? "trader" : "flea",
        trader: trader ? (unit.offer?.traderName ?? null) : null,
        level: trader ? (unit.offer?.minTraderLevel ?? null) : null,
        uses: need,
      });
      return;
    }

    // The same guard the route's price divides by, so the plan and the price agree on a run.
    const yields = Math.max(1, step.yields);
    const times = roundUp(need / yields);
    const made = times * yields;
    const spare = made - need > EPSILON ? made - need : 0;
    if (spare > 0) keep({ itemId: line.itemId, item: line.item, count: spare });

    for (const each of step.lines) obtain(each, each.count * times);
    record({
      kind: step.kind,
      id: step.id,
      where: step.where,
      level: step.level,
      runs: times,
      seconds: step.seconds,
      takes: consumed(step.lines, times),
      gives: [{ itemId: line.itemId, item: line.item, count: made, spare }],
      gates: step.gates,
      limit: step.limit,
    });
  }

  function release(entry: PlanItem, sale: Disposal | null): void {
    if (!sale || entry.count <= EPSILON) return;

    const step = sale.step;
    if (!step) {
      const trader = sale.to === "trader";
      atMarket(sold, {
        ...entry,
        market: trader ? "trader" : "flea",
        trader: trader ? (sale.offer?.traderName ?? null) : null,
        level: null,
        uses: null,
      });
      return;
    }

    const takes = step.takes > 0 ? step.takes : 1;
    const times = roundDown(entry.count / takes);
    const used = times * takes;
    if (entry.count - used > EPSILON) keep({ ...entry, count: entry.count - used });
    if (times === 0) {
      short = true;
      return;
    }

    for (const each of step.lines) obtain(each, each.count * times);
    const product: PlanItem = {
      itemId: step.product.itemId,
      item: step.product.item,
      count: step.product.count * times,
    };
    record({
      kind: step.kind,
      id: step.id,
      where: step.where,
      level: step.level,
      runs: times,
      seconds: step.seconds,
      takes: [{ ...entry, count: used }, ...consumed(step.lines, times)],
      gives: [{ ...product, spare: 0 }],
      gates: step.gates,
      limit: step.limit,
    });
    release(product, step.product.disposal);
  }

  for (const line of root.lines) obtain(line, line.count * batch);
  const made: PlanItem = { ...root.product, count: root.product.count * batch };
  // The row's own gates are on the row already, so its step carries none. Its restock limit
  // is carried anyway, and never fires `exceedsRestock` — the root runs exactly `batch`
  // times, so it is one trade per run of the row however large the batch grew.
  record({
    kind: root.kind,
    id: root.id,
    where: root.where,
    level: root.level,
    runs: batch,
    seconds: root.seconds,
    takes: consumed(root.lines, batch),
    gives: [{ ...made, spare: 0 }],
    gates: [],
    limit: root.limit,
  });
  release(made, root.sale);

  const steps: PlanStep[] = [];
  if (bought.size > 0 || tools.size > 0) {
    steps.push({ kind: "buy", items: [...bought.values()], tools: [...tools.values()] });
  }
  steps.push(...runs);
  if (sold.size > 0) steps.push({ kind: "sell", items: [...sold.values()] });
  return { batch, exact, steps, leftovers, short };
}

export function craftPlan(root: PlanRoot): CraftPlan {
  let settled: ReturnType<typeof simulate> | null = null;
  for (let batch = 1; batch <= MAX_BATCH; batch += 1) {
    const plan = simulate(root, batch);
    if (plan.exact) {
      settled = plan;
      break;
    }
    // Kept only if every trade in it got enough to happen. A plan that stops halfway down
    // the chain it was priced on is not the plan the figures describe.
    if (!settled && !plan.short) settled = plan;
  }
  const { batch, exact, steps, leftovers } = settled ?? simulate(root, 1);
  return { batch, exact, steps, leftovers };
}
