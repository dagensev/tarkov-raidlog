"use client";

import { create } from "zustand";

import type { LogEvent } from "@/lib/logs/events";
import {
  FileSystemAccessLogSource,
  checkPermission,
  pickLogDirectory,
  requestPermission,
} from "@/lib/logs/fs-access-source";
import { type ScreenshotPosition, trailFrom } from "@/lib/logs/screenshots";
import {
  FileSystemAccessScreenshotSource,
  pickScreenshotDirectory,
  type ScreenshotSource,
} from "@/lib/logs/screenshot-source";
import { LogWatcher, type ScanProgress } from "@/lib/logs/watcher";
import { analyzeWipes, type WipeAnalysis } from "@/lib/logs/wipe";
import {
  denormalize,
  loadCoreBundle,
  loadItemCatalogue,
  referencedItemIds,
  SELL_INDEX_VERSION,
  type CoreBundle,
  type ItemIndex,
  type SellIndex,
} from "@/lib/tarkovdev/client";
import { loadEconomyBundle, type EconomyBundle } from "@/lib/tarkovdev/economy";
import {
  DEFAULT_GAME_MODE,
  gameModeFromSessionMode,
  type GameMode,
} from "@/lib/tarkovdev/endpoints";
import { DEFAULT_SELL_VIEW, type SellView } from "@/lib/sell/filters";
import { nextHideoutLevels } from "@/lib/sell/hideout-levels";
import type { TaskFilter } from "@/lib/tasks/filters";
import type { MapFilter } from "@/lib/tasks/map-filter";
import type { SortMode } from "@/lib/tasks/sort";
import * as db from "./db";
import { DEFAULT_SETTINGS, isStale, type Settings } from "./db";

export type LogStatus =
  | "idle"
  | "unsupported"
  | "needs-permission"
  | "scanning"
  | "watching"
  | "error";

export interface RaidState {
  /** Scene bundle path from the application log, the earliest signal. */
  scene?: string;
  /** BSG location id from the UserConfirmed payload. */
  location?: string;
  /** Whether the last raid event says we are in a raid. */
  active: boolean;
  at: number;
}

/** How the task list is currently narrowed and ordered. */
export interface TaskView {
  filter: TaskFilter;
  query: string;
  kappaOnly: boolean;
  sort: SortMode;
}

interface AppState {
  logStatus: LogStatus;
  logError: string | null;
  scanProgress: ScanProgress | null;

  screenshotStatus: LogStatus;
  screenshotError: string | null;
  /** This raid's screenshots, oldest first. Derived each poll, never accumulated. */
  trail: ScreenshotPosition[];

  events: LogEvent[];
  wipes: WipeAnalysis | null;
  settings: Settings;

  /** Trimmed API documents. Denormalized on demand by the hooks. */
  bundle: CoreBundle | null;
  itemIndex: ItemIndex | null;
  /** Hideout, barters and crafts. Arrives after the task list, with the catalogue. */
  economy: EconomyBundle | null;
  /** Prices and footprints for every item. The other half of the catalogue download. */
  sellIndex: SellIndex | null;
  dataLoading: boolean;
  /**
   * The 16.7 MB catalogue fetch, which runs on its own schedule after the task list.
   * Separate from `dataLoading` so the sell check can tell "downloading" from "not
   * downloading", rather than claiming a fetch is in flight whenever its data is absent.
   */
  catalogueLoading: boolean;
  dataStale: boolean;
  dataError: string | null;
  /** The `Session mode:` most recently seen in the logs. */
  sessionMode: string | null;

  raid: RaidState;

  /**
   * The map the task lists are filtered to, shared by the Tasks and Squad tabs.
   *
   * Deliberately here and not in `settings`: a filter is a browsing choice, not a setting,
   * and it should not still be narrowing your list after a reload a week later. Living in
   * the store is enough to survive tab switches, which are client-side navigations.
   */
  mapFilter: MapFilter;

  /**
   * The rest of the tasks tab's controls, here for the same reason — the page unmounts on
   * every tab switch, and coming back to a list you had narrowed, un-narrowed, is a bug.
   *
   * Separate from `mapFilter` because only the map is shared with the squad tab. These are
   * the tasks tab's own view of its list and nothing else reads them.
   */
  taskView: TaskView;

  /** The sell check's own controls, here for the same reason `taskView` is. */
  sellView: SellView;

  hydrate: () => Promise<void>;
  connectLogs: () => Promise<void>;
  reconnectLogs: () => Promise<void>;
  connectScreenshots: () => Promise<void>;
  reconnectScreenshots: () => Promise<void>;
  rescan: () => Promise<void>;
  refreshData: (force?: boolean) => Promise<void>;
  setHideoutLevel: (stationId: string, level: number | null) => Promise<void>;
  setMapFilter: (filter: MapFilter) => void;
  setTaskView: (patch: Partial<TaskView>) => void;
  setSellView: (patch: Partial<SellView>) => void;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  stopWatching: () => void;
}

/**
 * Watcher and timer live outside the store: they are not rendered, and putting a
 * `setInterval` handle in reactive state invites re-render loops.
 */
let watcher: LogWatcher | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
/**
 * Kept out of reactive state for the same reason the watcher is: this is a handle, not
 * something the UI renders, and putting it in the store would re-render on every poll.
 */
let screenshots: ScreenshotSource | null = null;
/** Detaches the "tab became visible" catch-up read. Set while watching. */
let stopVisibilityCatchUp: (() => void) | null = null;
/** True while a read is in flight, so two triggers cannot read the same bytes twice. */
let polling = false;

/** Tear down both poll triggers together; leaving one attached would keep reading. */
function stopPolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  stopVisibilityCatchUp?.();
  stopVisibilityCatchUp = null;
}

/**
 * A raid cannot outlast this, so a raid-start older than it is history, not a raid in
 * progress. The longest map is 50 minutes; the rest is queue and load time.
 */
export const RAID_ACTIVE_WINDOW_MS = 90 * 60 * 1000;

/**
 * Whether the last raid events describe a raid happening *now*.
 *
 * The window matters because the game does not always write `UserMatchOver` — if it is
 * closed mid-raid, the log simply stops. Without a cutoff, a full historical scan replays
 * that dangling raid-start and the app insists you are in a raid forever.
 */
export function isRaidActive(raid: RaidState, now = Date.now()): boolean {
  return raid.active && now - raid.at < RAID_ACTIVE_WINDOW_MS;
}

/**
 * Fold raid events into the current raid state.
 *
 * Events are sorted first: each log file is read whole before the next, so a batch
 * arrives grouped by file rather than in time order, and a `raid-starting` from the
 * notifications log can land after a later `game-started` from the application log.
 * Only this reducer cares about order — task progress compares timestamps directly.
 */
function raidFrom(events: readonly LogEvent[], previous: RaidState): RaidState {
  const ordered = [...events].sort((a, b) => a.timestamp - b.timestamp);
  let next = previous;
  for (const event of ordered) {
    if (event.kind === "map-loading") {
      next = { ...next, scene: event.scene, active: true, at: event.timestamp };
    } else if (event.kind === "raid-starting") {
      next = { ...next, location: event.location, active: true, at: event.timestamp };
    } else if (event.kind === "game-started") {
      // The last thing the game logs before you are actually playing, so it is the best
      // anchor for the recency window — measuring from map-load would spend several
      // minutes of it on queue and loading.
      next = { ...next, active: true, at: event.timestamp };
    } else if (event.kind === "raid-ended") {
      next = { ...next, active: false, at: event.timestamp };
    }
  }
  return next;
}

/** Latest `Session mode:` in a batch of events, if any. */
function sessionModeFrom(events: readonly LogEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.kind === "session-mode") return event.mode;
  }
  return null;
}

export const useAppStore = create<AppState>((set, get) => ({
  logStatus: "idle",
  logError: null,
  scanProgress: null,

  events: [],
  wipes: null,
  settings: DEFAULT_SETTINGS,

  bundle: null,
  itemIndex: null,
  economy: null,
  sellIndex: null,
  dataLoading: false,
  catalogueLoading: false,
  dataStale: false,
  dataError: null,
  sessionMode: null,

  raid: { active: false, at: 0 },
  screenshotStatus: "idle",
  screenshotError: null,
  trail: [],
  mapFilter: null,
  taskView: { filter: "started", query: "", kappaOnly: false, sort: "progress" },
  sellView: DEFAULT_SELL_VIEW,

  async hydrate() {
    const [settings, events, bundle, itemIndex, economy, sellIndex] =
      await Promise.all([
        db.loadSettings(),
        db.get("events"),
        db.get("tarkovBundle"),
        db.get("itemIndex"),
        db.get("economyBundle"),
        db.get("sellIndex"),
      ]);

    set({
      settings,
      events: events ?? [],
      bundle: bundle ?? null,
      itemIndex: itemIndex ?? null,
      economy: economy ?? null,
      sellIndex: sellIndex ?? null,
      dataStale: isStale(bundle),
      sessionMode: sessionModeFrom(events ?? []),
    });

    const handle = await db.get("logDirectory");
    if (handle) {
      const permission = await checkPermission(handle);
      if (permission === "granted") {
        await startWatching(handle, set, get);
      } else {
        // Re-granting needs a user gesture, so the UI shows a button rather than
        // prompting on load.
        set({ logStatus: "needs-permission" });
      }
    }

    const shots = await db.get("screenshotDirectory");
    if (shots) {
      const permission = await checkPermission(shots);
      if (permission === "granted") {
        screenshots = new FileSystemAccessScreenshotSource(shots);
        set({ screenshotStatus: "watching" });
      } else {
        set({ screenshotStatus: "needs-permission" });
      }
    }

    void get().refreshData();
  },

  async connectLogs() {
    try {
      const handle = await pickLogDirectory();
      await db.set("logDirectory", handle);
      await startWatching(handle, set, get);
      // The scan may have revealed which game mode is being played.
      void get().refreshData();
    } catch (error) {
      // An aborted picker is the user changing their mind, not a failure.
      if ((error as DOMException)?.name === "AbortError") return;
      set({ logStatus: "error", logError: (error as Error).message });
    }
  },

  async reconnectLogs() {
    const handle = await db.get("logDirectory");
    if (!handle) return get().connectLogs();
    const permission = await requestPermission(handle);
    if (permission !== "granted") {
      set({ logStatus: "needs-permission" });
      return;
    }
    await startWatching(handle, set, get);
  },

  async connectScreenshots() {
    try {
      const handle = await pickScreenshotDirectory();
      await db.set("screenshotDirectory", handle);
      screenshots = new FileSystemAccessScreenshotSource(handle);
      set({ screenshotStatus: "watching", screenshotError: null });
      await readTrail(set, get);
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError") return;
      set({ screenshotStatus: "error", screenshotError: (error as Error).message });
    }
  },

  async reconnectScreenshots() {
    const handle = await db.get("screenshotDirectory");
    if (!handle) return get().connectScreenshots();
    const permission = await requestPermission(handle);
    if (permission !== "granted") {
      set({ screenshotStatus: "needs-permission" });
      return;
    }
    screenshots = new FileSystemAccessScreenshotSource(handle);
    set({ screenshotStatus: "watching", screenshotError: null });
    await readTrail(set, get);
  },

  async rescan() {
    const handle = await db.get("logDirectory");
    if (!handle) return;
    watcher?.reset();
    set({ events: [] });
    await startWatching(handle, set, get);
  },

  async refreshData(force = false) {
    const state = get();
    const mode = resolveGameMode(state);
    const bundleFresh = Boolean(
      state.bundle && state.bundle.mode === mode && !isStale(state.bundle),
    );

    if (!bundleFresh || force) {
      if (state.dataLoading) return;
      set({ dataLoading: true, dataError: null });
      try {
        const bundle = await loadCoreBundle(mode);
        await db.set("tarkovBundle", bundle);
        set({ bundle, dataStale: false, dataLoading: false });

        // The item catalogue costs a 16.7 MB download and only labels keys on the task
        // screen, so it arrives after the list is already up. The sell check's data
        // rides along with it rather than triggering a second download of its own.
        void loadCatalogue(bundle, set);
      } catch (error) {
        // Keep whatever is cached; a stale task list beats an empty screen.
        set({ dataError: (error as Error).message, dataLoading: false });
      }
      return;
    }

    // The bundle can be fresh while the catalogue is not: it is a separate and much
    // larger fetch, so it can be missing entirely on the first run against an existing
    // cache, a day behind, or left over from another game mode. Returning early on a
    // fresh bundle alone left the sell check empty until someone pressed refresh.
    if (state.bundle && catalogueBehind(state, mode)) void loadCatalogue(state.bundle, set);
  },

  /**
   * Record one station's built level.
   *
   * Its own action rather than a `updateSettings` call from the editor, because the whole
   * record has to be read at click time. Building the new map in the component reads the
   * value React rendered with, and two clicks inside one frame then both start from the
   * same map — the second silently dropping the first. Filling in all 26 stations at
   * speed lost one almost every time.
   */
  async setHideoutLevel(stationId, level) {
    const settings = {
      ...get().settings,
      hideoutLevels: nextHideoutLevels(get().settings.hideoutLevels, stationId, level),
    };
    set({ settings });
    await db.set("settings", settings);
  },

  setMapFilter(mapFilter) {
    set({ mapFilter });
  },

  setTaskView(patch) {
    set({ taskView: { ...get().taskView, ...patch } });
  },

  setSellView(patch) {
    set({ sellView: { ...get().sellView, ...patch } });
  },

  async updateSettings(patch) {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    await db.set("settings", settings);
    // Switching game mode means a different dataset.
    if (patch.gameMode !== undefined) void get().refreshData();
  },

  stopWatching() {
    stopPolling();
  },
}));

type SetState = (partial: Partial<AppState>) => void;
type GetState = () => AppState;

/** Manual choice wins; otherwise take it from the logs; otherwise the season default. */
function resolveGameMode(state: Pick<AppState, "settings" | "sessionMode">): GameMode {
  return (
    state.settings.gameMode ??
    gameModeFromSessionMode(state.sessionMode ?? undefined) ??
    DEFAULT_GAME_MODE
  );
}

/**
 * Everything the task list did not need: the item catalogue and the three documents that
 * say what consumes items.
 *
 * The economy documents go first because they are 437 KB against the catalogue's 16.7 MB,
 * so a failure there still leaves the big download running. Each half is caught on its
 * own: neither is worth surfacing as a failure, since the task list is already on screen
 * and both degrade to something usable.
 */
/**
 * Whether either half of the catalogue is missing, a day old, from another mode, or of
 * an older shape than the page now reads.
 */
export function catalogueBehind(
  state: Pick<AppState, "economy" | "sellIndex">,
  mode: GameMode,
): boolean {
  return (
    state.economy?.mode !== mode ||
    state.sellIndex?.mode !== mode ||
    state.sellIndex?.version !== SELL_INDEX_VERSION ||
    isStale(state.economy ?? undefined) ||
    isStale(state.sellIndex ?? undefined)
  );
}

/**
 * Latch on the 16.7 MB download.
 *
 * Outside the store like the watcher and the timer: it guards re-entry across an await,
 * which reactive state cannot do — two callers both read `false` before either writes.
 */
let catalogueInFlight = false;

async function loadCatalogue(bundle: CoreBundle, set: SetState): Promise<void> {
  if (catalogueInFlight) return;
  catalogueInFlight = true;
  set({ catalogueLoading: true });

  try {
    try {
      const economy = await loadEconomyBundle(bundle.mode);
      await db.set("economyBundle", economy);
      set({ economy });
    } catch {
      // 437 KB against the catalogue's 16.7 MB, so it goes first: failing here must not
      // take the big download down with it.
    }

    try {
      const { index, sell } = await loadItemCatalogue(
        bundle.mode,
        referencedItemIds(bundle.tasks),
      );
      await db.set("itemIndex", index);
      await db.set("sellIndex", sell);
      set({ itemIndex: index, sellIndex: sell });
    } catch {
      // Keys fall back to showing an id, as they did before the catalogue existed.
    }
  } finally {
    catalogueInFlight = false;
    set({ catalogueLoading: false });
  }
}

/**
 * Re-derive the trail from the screenshots folder.
 *
 * A listing, not a read: the position is in the file name, so this never opens a file. That
 * is the part worth keeping, not "cheap" — `list()` still walks every directory entry and
 * `trailFrom` runs two regexes per name, so the cost scales with how many screenshots are
 * in the folder.
 */
async function readTrail(set: SetState, get: GetState): Promise<void> {
  if (!screenshots) return;
  try {
    const trail = trailFrom(await screenshots.list(), get().raid.at);
    // This runs on every 2 s poll. Setting a fresh array reference even when the folder
    // has not changed would re-render the raid board — and the map SVG under it — at 2 Hz.
    if (!sameTrail(get().trail, trail)) set({ trail });
  } catch (error) {
    // The folder was moved, or permission lapsed while the tab was open.
    screenshots = null;
    set({ screenshotStatus: "needs-permission", screenshotError: (error as Error).message });
  }
}

/**
 * Whether two trails are the same, without a deep comparison.
 *
 * Names are the identity of a trail point, and the trail only ever grows within a raid, so
 * the length plus the newest name is enough to tell "unchanged" from "one more shot landed".
 */
function sameTrail(a: readonly ScreenshotPosition[], b: readonly ScreenshotPosition[]): boolean {
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;
  return a[a.length - 1].name === b[b.length - 1].name;
}

async function startWatching(
  handle: FileSystemDirectoryHandle,
  set: SetState,
  get: GetState,
): Promise<void> {
  stopPolling();

  set({ logStatus: "scanning", logError: null, scanProgress: null });
  watcher = new LogWatcher(new FileSystemAccessLogSource(handle));

  try {
    const { events, observations } = await watcher.scanAll((progress) =>
      set({ scanProgress: progress }),
    );
    set({
      events,
      wipes: analyzeWipes(observations),
      raid: raidFrom(events, get().raid),
      sessionMode: sessionModeFrom(events) ?? get().sessionMode,
      logStatus: "watching",
      scanProgress: null,
    });
    await db.set("events", events);
  } catch (error) {
    set({ logStatus: "error", logError: (error as Error).message });
    return;
  }

  /**
   * Read whatever the game has written since the last read.
   *
   * The re-entrancy guard is not optional now that two things trigger this. A poll reads
   * from the stored byte offset and only advances it once the bytes are in hand, so two
   * overlapping runs would read the same range twice and append every event in it twice.
   */
  const pollOnce = async (): Promise<void> => {
    if (!watcher || polling) return;
    polling = true;
    try {
      const fresh = await watcher.poll();
      if (fresh.length > 0) {
        const events = [...get().events, ...fresh];
        set({
          events,
          raid: raidFrom(fresh, get().raid),
          sessionMode: sessionModeFrom(fresh) ?? get().sessionMode,
        });
        await db.set("events", events);
      }
      // After the raid state is up to date, so a raid that just started empties the trail
      // in the same tick rather than showing the previous raid's dots for one poll.
      if (get().raid.active) await readTrail(set, get);
    } catch (error) {
      // A revoked permission or a folder that vanished mid-session.
      set({ logStatus: "needs-permission", logError: (error as Error).message });
      stopPolling();
    } finally {
      polling = false;
    }
  };

  pollTimer = setInterval(() => void pollOnce(), get().settings.pollIntervalMs);

  /**
   * Catch up the moment the tab is looked at again.
   *
   * Chrome throttles timers in hidden tabs to roughly once a minute, and Tarkov running
   * fullscreen keeps this tab hidden for the whole raid — so the interval above is only
   * really running at its stated rate while you can see the page. Nothing is lost either
   * way, since the cursor is a byte offset and a late read just returns a bigger chunk,
   * but without this you alt-tab to a board that is up to a throttled tick stale.
   */
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") void pollOnce();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  stopVisibilityCatchUp = () =>
    document.removeEventListener("visibilitychange", onVisibilityChange);
}

export { denormalize, resolveGameMode };

/** Exposed for tests: the ordering rule is easy to regress and hard to see from outside. */
export { raidFrom as __testRaidFrom };
