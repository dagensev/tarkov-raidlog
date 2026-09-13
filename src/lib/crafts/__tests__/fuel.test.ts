import { describe, expect, it } from "vitest";

import {
  FUEL_TANKS,
  GENERATOR_UNITS_PER_HOUR,
  fuelRoublesPerHour,
  fuelUnitsPerHour,
  solarPowerBuilt,
  stationNeedsPower,
} from "../fuel";
import { station } from "./fixtures";

describe("the generator burn rate", () => {
  it("empties a full metal tank in the time the wiki measures", () => {
    // 100 units at 4.75 an hour is 21h03m09s, which is the figure the rate was derived
    // from. Asserting the round trip is what keeps the constant honest if anyone edits it.
    const hours = 100 / GENERATOR_UNITS_PER_HOUR;
    expect(Math.round(hours * 3600)).toBe(21 * 3600 + 3 * 60 + 9);
  });

  it("halves with Solar Power", () => {
    expect(fuelUnitsPerHour(true)).toBe(fuelUnitsPerHour(false) / 2);
  });
});

describe("solarPowerBuilt", () => {
  const stations = [station("solar-id", { normalizedName: "solar-power" })];

  it("is true once a level is recorded", () => {
    expect(solarPowerBuilt({ "solar-id": 1 }, stations)).toBe(true);
  });

  it("reads an unrecorded station as not built, which overstates the fuel bill", () => {
    expect(solarPowerBuilt({}, stations)).toBe(false);
  });

  it("reads an explicit zero as not built", () => {
    expect(solarPowerBuilt({ "solar-id": 0 }, stations)).toBe(false);
  });

  it("is false when the hideout document has no such station", () => {
    expect(solarPowerBuilt({ "solar-id": 3 }, [])).toBe(false);
  });
});

describe("fuelRoublesPerHour", () => {
  it("divides the tank by its capacity and multiplies by the burn rate", () => {
    // A 240,000 rouble metal tank is 2,400 a unit, and 4.75 units an hour.
    const cost = fuelRoublesPerHour({ tankPrice: 240_000, tankUnits: 100, solarPower: false });
    expect(cost).toBeCloseTo(2_400 * GENERATOR_UNITS_PER_HOUR, 6);
  });

  it("halves the bill with Solar Power", () => {
    const plain = fuelRoublesPerHour({ tankPrice: 240_000, tankUnits: 100, solarPower: false })!;
    const solar = fuelRoublesPerHour({ tankPrice: 240_000, tankUnits: 100, solarPower: true })!;
    expect(solar).toBeCloseTo(plain / 2, 6);
  });

  it("prices the two tanks the same per hour when they cost the same per unit", () => {
    // Which is the whole point of dividing by capacity: the tank you buy is a packaging
    // choice, not a different rate of burn.
    const metal = fuelRoublesPerHour({ tankPrice: 200_000, tankUnits: 100, solarPower: false });
    const expeditionary = fuelRoublesPerHour({ tankPrice: 120_000, tankUnits: 60, solarPower: false });
    expect(metal).toBeCloseTo(expeditionary!, 6);
  });

  it("reports nothing rather than a confident zero when either figure is missing", () => {
    expect(fuelRoublesPerHour({ tankPrice: null, tankUnits: 100, solarPower: false })).toBeNull();
    expect(fuelRoublesPerHour({ tankPrice: 240_000, tankUnits: undefined, solarPower: false })).toBeNull();
    expect(fuelRoublesPerHour({ tankPrice: 240_000, tankUnits: 0, solarPower: false })).toBeNull();
  });
});

describe("the tank list", () => {
  it("offers the metal tank first, since it is the one most hideouts run", () => {
    expect(FUEL_TANKS.map((tank) => tank.label)).toEqual([
      "Metal fuel tank",
      "Expeditionary fuel tank",
    ]);
  });
});

describe("stationNeedsPower", () => {
  it("lets the Lavatory run with the generator off", () => {
    expect(stationNeedsPower("lavatory")).toBe(false);
  });

  it("charges every other crafting station", () => {
    for (const name of [
      "workbench",
      "medstation",
      "nutrition-unit",
      "intelligence-center",
      "water-collector",
      "booze-generator",
    ]) {
      expect(stationNeedsPower(name)).toBe(true);
    }
  });

  it("assumes power for a station it cannot name, which overstates rather than flatters", () => {
    expect(stationNeedsPower(undefined)).toBe(true);
    expect(stationNeedsPower("somewhere-new")).toBe(true);
  });
});
