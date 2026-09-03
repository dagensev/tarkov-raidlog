"use client";

import { useMemo } from "react";

import type { SquadMember } from "@worker/protocol";
import { squadHoldersOf, squadHoldingCounts, useSquadStore } from "./squad-store";

const NONE: SquadMember[] = [];
const NO_COUNTS: ReadonlyMap<string, number> = new Map();

/** Squadmates holding this task. Empty when you are not in a squad. */
export function useSquadHolders(taskId: string): SquadMember[] {
  const members = useSquadStore((s) => s.members);
  const progress = useSquadStore((s) => s.progress);
  const identity = useSquadStore((s) => s.identity);

  return useMemo(() => {
    if (members.length < 2) return NONE;
    const holders = squadHoldersOf(taskId, { members, progress, identity });
    return holders.length > 0 ? holders : NONE;
  }, [taskId, members, progress, identity]);
}

/**
 * Squadmates holding each task, keyed by task id. Empty when you are not in a squad.
 *
 * The whole-list companion to `useSquadHolders`, for callers that rank tasks against one
 * another rather than decorate a single row.
 */
export function useSquadHoldingCounts(): ReadonlyMap<string, number> {
  const members = useSquadStore((s) => s.members);
  const progress = useSquadStore((s) => s.progress);
  const identity = useSquadStore((s) => s.identity);

  return useMemo(() => {
    if (members.length < 2) return NO_COUNTS;
    return squadHoldingCounts({ members, progress, identity });
  }, [members, progress, identity]);
}

/** Whether a squad is worth showing tags for at all. */
export function useInSquad(): boolean {
  return useSquadStore((s) => s.members.length > 1);
}
