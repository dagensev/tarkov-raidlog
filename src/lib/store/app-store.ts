"use client";

import { create } from "zustand";

import type { LogEvent, MapLoadingEvent, RaidStartingEvent } from "@/lib/logs/events";
import {
  FileSystemAccessLogSource,
  checkPermission,
  pickLogDirectory,
  requestPermission,
} from "@/lib/logs/fs-access-source";
import type { TaskStatus } from "@/lib/logs/progress";
import { LogWatcher, type ScanProgress } from "@/lib/logs/watcher";
import { analyzeWipes, type WipeAnalysis } from "@/lib/logs/wipe";
import { fetchTarkovData } from "@/lib/tarkovdev/client";
import type { TarkovData } from "@/lib/tarkovdev/types";
import * as db from "./db";
import { DEFAULT_SETTINGS, type Settings } from "./db";

export type LogStatus =
  | "idle"
  | "unsupported"
  | "needs-permission"
  | "scanning"
  | "watching"
  | "error";

export interface RaidState {
  /** Scene bundle name from the application log, the earliest signal. */
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

  tarkovData: TarkovData | null;
  tarkovDataStale: boolean;
  tarkovDataError: string | null;

  raid: RaidState;

  hydrate: () => Promise<void>;
  connectLogs: () => Promise<void>;
  reconnectLogs: () => Promise<void>;
  rescan: () => Promise<void>;
  refreshTarkovData: (force?: boolean) => Promise<void>;
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

function raidFrom(events: readonly LogEvent[], previous: RaidState): RaidState {
  let next = previous;
  for (const event of events) {
    if (event.kind === "map-loading") {
      const e = event as MapLoadingEvent;
      next = { ...next, scene: e.scene, active: true, at: e.timestamp };
    } else if (event.kind === "raid-starting") {
      const e = event as RaidStartingEvent;
      next = { ...next, location: e.location, active: true, at: e.timestamp };
    } else if (event.kind === "raid-ended") {
      next = { ...next, active: false, at: event.timestamp };
    }
  }
  return next;
}

export const useAppStore = create<AppState>((set, get) => ({
  logStatus: "idle",
  logError: null,
  scanProgress: null,

  events: [],
  wipes: null,
  manualTasks: {},
  settings: DEFAULT_SETTINGS,

  tarkovData: null,
  tarkovDataStale: false,
  tarkovDataError: null,

  raid: { active: false, at: 0 },

  async hydrate() {
    const [settings, manualTasks, events, cached] = await Promise.all([
      db.loadSettings(),
      db.get("manualTasks"),
      db.get("events"),
      db.loadCachedTarkovData(),
    ]);

    set({
      settings,
      manualTasks: manualTasks ?? {},
      events: events ?? [],
      tarkovData: cached?.data ?? null,
      tarkovDataStale: cached?.stale ?? false,
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

    void get().refreshTarkovData();
  },

  async connectLogs() {
    try {
      const handle = await pickLogDirectory();
      await db.set("logDirectory", handle);
      await startWatching(handle, set, get);
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

  async refreshTarkovData(force = false) {
    const { tarkovData, tarkovDataStale } = get();
    if (tarkovData && !tarkovDataStale && !force) return;
    try {
      const data = await fetchTarkovData();
      await db.saveTarkovData(data);
      set({ tarkovData: data, tarkovDataStale: false, tarkovDataError: null });
    } catch (error) {
      // Keep whatever is cached; a stale task list beats an empty screen.
      set({ tarkovDataError: (error as Error).message });
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
  },

  stopWatching() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  },
}));

type SetState = (partial: Partial<AppState>) => void;
type GetState = () => AppState;

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
    const wipes = analyzeWipes(observations);
    set({
      events,
      wipes,
      raid: raidFrom(events, get().raid),
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
        set({ events, raid: raidFrom(fresh, get().raid) });
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
