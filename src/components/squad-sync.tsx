"use client";

import { useEffect, useRef } from "react";

import type { MemberProgress } from "@worker/protocol";
import { useCurrentMap, useTaskStates } from "@/lib/store/hooks";
import { resumeSquad, useSquadStore } from "@/lib/store/squad-store";

/**
 * Bridges the log-derived progress into the squad room. Renders nothing.
 *
 * Publishing deltas rather than the whole state matters here: a full task list on every
 * poll would be a message every two seconds per member, for a game where almost nothing
 * changes between raids.
 */
export function SquadSync() {
  const hydrate = useSquadStore((s) => s.hydrate);
  const token = useSquadStore((s) => s.token);
  const publishProgress = useSquadStore((s) => s.publishProgress);
  const publishPresence = useSquadStore((s) => s.publishPresence);

  const states = useTaskStates();
  const currentMap = useCurrentMap();

  /** Last state we told the room about, so we can diff against it. */
  const published = useRef<MemberProgress>({});

  useEffect(() => {
    void hydrate().then(resumeSquad);
  }, [hydrate]);

  useEffect(() => {
    if (!token) return;

    const full: MemberProgress = {};
    for (const [taskId, state] of states) full[taskId] = state.status;

    const changed: MemberProgress = {};
    for (const [taskId, status] of Object.entries(full)) {
      if (published.current[taskId] !== status) changed[taskId] = status;
    }
    // A task that dropped out entirely — a manual tick undone, or a wipe switch — has to
    // be sent too, or squadmates keep showing it as done.
    for (const taskId of Object.keys(published.current)) {
      if (!(taskId in full)) changed[taskId] = undefined as unknown as MemberProgress[string];
    }

    published.current = full;
    publishProgress(changed, full);
  }, [token, states, publishProgress]);

  useEffect(() => {
    if (!token) return;
    publishPresence({ currentMap: currentMap?.id });
  }, [token, currentMap?.id, publishPresence]);

  return null;
}
