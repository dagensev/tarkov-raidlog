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

interface AppState {
  logStatus: LogStatus;
  logError: string | null;
  scanProgress: ScanProgress | null;

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

  hydrate: () => Promise<void>;
  connectLogs: () => Promise<void>;
  reconnectLogs: () => Promise<void>;
  rescan: () => Promise<void>;
  refreshData: (force?: boolean) => Promise<void>;
  setManualTask: (taskId: string, status: TaskStatus | null) => Promise<void>;
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

  async updateSettings(patch) {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    await db.set("settings", settings);
    // Switching game mode means a different dataset.
    if (patch.gameMode !== undefined) void get().refreshData();
  },

  stopWatching() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
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

async function startWatching(
  handle: FileSystemDirectoryHandle,
  set: SetState,
  get: GetState,
): Promise<void> {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;

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

  const interval = get().settings.pollIntervalMs;
  pollTimer = setInterval(() => {
    void (async () => {
      if (!watcher) return;
      try {
        const fresh = await watcher.poll();
        if (fresh.length === 0) return;
        const events = [...get().events, ...fresh];
        set({
          events,
          raid: raidFrom(fresh, get().raid),
          sessionMode: sessionModeFrom(fresh) ?? get().sessionMode,
        });
        await db.set("events", events);
      } catch (error) {
        // A revoked permission or a folder that vanished mid-session.
        set({ logStatus: "needs-permission", logError: (error as Error).message });
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
      }
    })();
  }, interval);
}

export { denormalize, resolveGameMode };

/** Exposed for tests: the ordering rule is easy to regress and hard to see from outside. */
export { raidFrom as __testRaidFrom };
