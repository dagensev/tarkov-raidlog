/**
 * What an hour of generator time costs.
 *
 * Most craft stations need power, so a craft's real cost is its ingredients plus however
 * much fuel burned while it ran. None of this is in tarkov.dev's data: the documents carry
 * the fuel tanks as ordinary barter items and the generator as a station with no
 * consumption figure, so two facts here had to come from outside — the burn rate, and
 * which stations keep working with the generator off.
 *
 * The rate is cross-checked rather than asserted. A full metal fuel tank holds 100 units
 * and the wiki times it at 21h03m09s, which is 4.75 units an hour to four figures. The
 * expeditionary tank's 60 units land on the same rate, which is what makes it a property
 * of the generator rather than of either tank.
 *
 * Two things deliberately left out. Hideout Management also reduces fuel burn, and the
 * published figures do not reconcile with any simple formula — modelling it on a guess
 * would put a wrong number on every row, so the derived cost is editable instead and the
 * reader can overwrite it with whatever they measure. And fuel is charged to every powered
 * craft alike, because the generator burns at a flat rate whenever it is on, whatever is
 * cooking.
 */

/** Fuel units the generator burns per hour with no Solar Power. See the header. */
export const GENERATOR_UNITS_PER_HOUR = 4.75;

/** The station whose only level halves fuel consumption. */
export const SOLAR_POWER = "solar-power";

/**
 * The multiplier Solar Power applies.
 *
 * Read off the station's own `FuelConsumption = -0.5` bonus in the hideout document
 * rather than written down as a rule, so a rebalance upstream shows up as a wrong number
 * here that can be traced, not as a silent divergence.
 */
export const SOLAR_POWER_MULTIPLIER = 0.5;

/**
 * Stations that keep producing with the generator off, by normalized name.
 *
 * Only the Lavatory, among the stations that have crafts. The game marks this per hideout
 * area — `needsFuel` in its area table, read from SPT's dump of the game database, since
 * tarkov.dev's hideout document does not carry it — and Workbench, Medstation, Nutrition
 * Unit, Intelligence Center, Water Collector and Booze Generator all have it set. A
 * Lavatory craft does not need the generator on, so it causes no fuel burn, and charging it
 * a share would bury the one station whose crafts cost nothing to keep running.
 *
 * A list of the exceptions rather than of the powered stations, so a station added upstream
 * is charged fuel until someone says otherwise, which is the cautious reading for a profit.
 */
export const UNPOWERED_STATIONS: ReadonlySet<string> = new Set(["lavatory"]);

/** Whether crafting at a station burns fuel. A station nobody can name is assumed to. */
export function stationNeedsPower(normalizedName: string | null | undefined): boolean {
  return !normalizedName || !UNPOWERED_STATIONS.has(normalizedName);
}

export interface FuelTank {
  itemId: string;
  label: string;
}

/**
 * The two tanks the generator takes, in the order they are worth offering.
 *
 * Ids rather than names because the label is ours and the catalogue's is a translation;
 * the capacity is not listed here at all, since the catalogue carries it as
 * `resourceUnits` and a second copy would be a second thing to be wrong.
 */
export const FUEL_TANKS: readonly FuelTank[] = [
  { itemId: "5d1b36a186f7742523398433", label: "Metal fuel tank" },
  { itemId: "5d1b371186f774253763a656", label: "Expeditionary fuel tank" },
];

export const DEFAULT_FUEL_TANK_ID = FUEL_TANKS[0].itemId;

/** Whether the reader has recorded Solar Power as built. Unrecorded reads as not built. */
export function solarPowerBuilt(
  levels: Readonly<Record<string, number>>,
  stations: ReadonlyArray<{ id: string; normalizedName: string }>,
): boolean {
  const station = stations.find((each) => each.normalizedName === SOLAR_POWER);
  if (!station) return false;
  return (levels[station.id] ?? 0) >= 1;
}

/** Units burned per hour, with Solar Power taken into account. */
export function fuelUnitsPerHour(solarPower: boolean): number {
  return GENERATOR_UNITS_PER_HOUR * (solarPower ? SOLAR_POWER_MULTIPLIER : 1);
}

/**
 * Roubles an hour of generator time costs, or null when the tank has no price.
 *
 * A tank with no capacity is the same case as one with no price: it means the catalogue
 * stopped carrying `resourceUnits`, and inventing a divisor would put a confident wrong
 * figure on every row.
 */
export function fuelRoublesPerHour(input: {
  tankPrice: number | null;
  tankUnits: number | null | undefined;
  solarPower: boolean;
}): number | null {
  const { tankPrice, tankUnits, solarPower } = input;
  if (!tankPrice || !tankUnits || tankPrice <= 0 || tankUnits <= 0) return null;
  return (tankPrice / tankUnits) * fuelUnitsPerHour(solarPower);
}
