"use client";

import { create } from "zustand";

import type { LogEvent } from "@/lib/logs/events";
import {
  FileSystemAccessLogSource,
  checkPermission,
  pickLogDirectory,
  requestPermission,
} from "@/lib/logs/fs-access-source";
import type { TaskStatus } from "@/lib/logs/progress";
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
  loadItemIndex,
  referencedItemIds,
  type CoreBundle,
  type ItemIndex,
} from "@/lib/tarkovdev/client";
import {
  DEFAULT_GAME_MODE,
  gameModeFromSessionMode,
  type GameMode,
} from "@/lib/tarkovdev/endpoints";
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
  manualTasks: Record<string, TaskStatus>;
  settings: Settings;

  /** Trimmed API documents. Denormalized on demand by the hooks. */
  bundle: CoreBundle | null;
  itemIndex: ItemIndex | null;
  dataLoading: boolean;
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

  hydrate: () => Promise<void>;
  connectLogs: () => Promise<void>;
  reconnectLogs: () => Promise<void>;
  connectScreenshots: () => Promise<void>;
  reconnectScreenshots: () => Promise<void>;
  rescan: () => Promise<void>;
  refreshData: (force?: boolean) => Promise<void>;
  setManualTask: (taskId: string, status: TaskStatus | null) => Promise<void>;
  setMapFilter: (filter: MapFilter) => void;
  setTaskView: (patch: Partial<TaskView>) => void;
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
  manualTasks: {},
  settings: DEFAULT_SETTINGS,

  bundle: null,
  itemIndex: null,
  dataLoading: false,
  dataStale: false,
  dataError: null,
  sessionMode: null,

  raid: { active: false, at: 0 },
  screenshotStatus: "idle",
  screenshotError: null,
  trail: [],
  mapFilter: null,
  taskView: { filter: "started", query: "", kappaOnly: false, sort: "progress" },

  async hydrate() {
    const [settings, manualTasks, events, bundle, itemIndex] = await Promise.all([
      db.loadSettings(),
      db.get("manualTasks"),
      db.get("events"),
      db.get("tarkovBundle"),
      db.get("itemIndex"),
    ]);

    set({
      settings,
      manualTasks: manualTasks ?? {},
      events: events ?? [],
      bundle: bundle ?? null,
      itemIndex: itemIndex ?? null,
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
    const fresh = state.bundle && state.bundle.mode === mode && !isStale(state.bundle);
    if (fresh && !force) return;
    if (state.dataLoading) return;

    set({ dataLoading: true, dataError: null });
    try {
      const bundle = await loadCoreBundle(mode);
      await db.set("tarkovBundle", bundle);
      set({ bundle, dataStale: false, dataLoading: false });

      // Item names are only needed to label keys, and cost a 15.8 MB download, so they
      // arrive after the task list is already on screen.
      void loadItems(bundle, set);
    } catch (error) {
      // Keep whatever is cached; a stale task list beats an empty screen.
      set({ dataError: (error as Error).message, dataLoading: false });
    }
  },

  async setManualTask(taskId, status) {
    const manualTasks = { ...get().manualTasks };
    if (status === null) delete manualTasks[taskId];
    else manualTasks[taskId] = status;
    set({ manualTasks });
    await db.set("manualTasks", manualTasks);
  },

  setMapFilter(mapFilter) {
    set({ mapFilter });
  },

  setTaskView(patch) {
    set({ taskView: { ...get().taskView, ...patch } });
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

async function loadItems(bundle: CoreBundle, set: SetState): Promise<void> {
  try {
    const index = await loadItemIndex(bundle.mode, referencedItemIds(bundle.tasks));
    await db.set("itemIndex", index);
    set({ itemIndex: index });
  } catch {
    // Keys fall back to showing an id; not worth surfacing as a failure.
  }
}

/**
 * Re-derive the trail from the screenshots folder.
 *
 * A listing, not a read: the position is in the file name, so this never opens a file and
 * costs the same whether the folder holds five screenshots or five thousand.
 */
async function readTrail(set: SetState, get: GetState): Promise<void> {
  if (!screenshots) return;
  try {
    set({ trail: trailFrom(await screenshots.list(), get().raid.at) });
  } catch (error) {
    // The folder was moved, or permission lapsed while the tab was open.
    screenshots = null;
    set({ screenshotStatus: "needs-permission", screenshotError: (error as Error).message });
  }
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
