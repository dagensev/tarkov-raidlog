import { describe, expect, it } from "vitest";

import { ANY_MAP, mapFilterFrom, resolveMapFilter } from "../map-filter";

describe("resolveMapFilter", () => {
  it("filters by nothing when nothing has been picked", () => {
    expect(resolveMapFilter(null)).toBe("");
  });

  it("takes the fallback when nothing has been picked", () => {
    // How the squad tab follows the map detected from the logs until you choose.
    expect(resolveMapFilter(null, "m1")).toBe("m1");
  });

  it("lets an explicit Any map outrank the fallback", () => {
    // The reason there are three states: choosing Any map on the squad tab has to stick,
    // not snap back to the detected map on the next render.
    expect(resolveMapFilter(ANY_MAP, "m1")).toBe("");
  });

  it("uses the chosen map over the fallback", () => {
    expect(resolveMapFilter("m2", "m1")).toBe("m2");
  });
});

describe("mapFilterFrom", () => {
  it("reads the empty option as a deliberate Any map", () => {
    expect(mapFilterFrom("")).toBe(ANY_MAP);
    expect(resolveMapFilter(mapFilterFrom(""), "m1")).toBe("");
  });

  it("passes a map id through", () => {
    expect(resolveMapFilter(mapFilterFrom("m2"))).toBe("m2");
  });
});
