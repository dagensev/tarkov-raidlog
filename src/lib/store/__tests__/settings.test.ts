import { beforeEach, describe, expect, it } from "vitest";

import { useAppStore } from "../app-store";
import { DEFAULT_SETTINGS } from "../db";

/**
 * Found by filling the hideout checklist in by hand: 26 stations clicked, 25 recorded.
 *
 * The editor used to build the new record from the value it had rendered with and hand
 * that to `updateSettings`. Two clicks inside one frame therefore both started from the
 * same map, and the second wrote a copy that had never seen the first. Reading the record
 * inside the action is what makes rapid clicks compose.
 *
 * `db.set` no-ops without IndexedDB, so this exercises the real action under node.
 */

beforeEach(() => {
  useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, hideoutLevels: {} } });
});

const levels = () => useAppStore.getState().settings.hideoutLevels;

describe("DEFAULT_SETTINGS", () => {
  it("starts at the highest flea requirement any item carries, so nothing is hidden", () => {
    // Levels in the catalogue run 0, 20, 25, 30, 35, 40. Opening below 40 would quietly
    // drop rows from a list nobody had narrowed.
    expect(DEFAULT_SETTINGS.playerLevel).toBe(40);
  });
});

describe("setHideoutLevel", () => {
  it("records a station", async () => {
    await useAppStore.getState().setHideoutLevel("workbench", 3);
    expect(levels()).toEqual({ workbench: 3 });
  });

  it("keeps every station when calls land faster than a re-render", async () => {
    const { setHideoutLevel } = useAppStore.getState();
    // Deliberately not awaited in turn: this is the click-click-click case.
    await Promise.all([
      setHideoutLevel("workbench", 3),
      setHideoutLevel("lavatory", 2),
      setHideoutLevel("stash", 4),
    ]);
    expect(levels()).toEqual({ workbench: 3, lavatory: 2, stash: 4 });
  });

  it("clears one station without disturbing the others", async () => {
    const { setHideoutLevel } = useAppStore.getState();
    await Promise.all([setHideoutLevel("workbench", 3), setHideoutLevel("lavatory", 2)]);
    await setHideoutLevel("workbench", null);
    expect(levels()).toEqual({ lavatory: 2 });
  });

  it("leaves the rest of the settings alone", async () => {
    useAppStore.setState({
      settings: { ...DEFAULT_SETTINGS, hideoutLevels: {}, gameMode: "pve", pollIntervalMs: 5000 },
    });
    await useAppStore.getState().setHideoutLevel("workbench", 1);
    const settings = useAppStore.getState().settings;
    expect(settings.gameMode).toBe("pve");
    expect(settings.pollIntervalMs).toBe(5000);
  });
});
