"use client";

import { useMemo } from "react";

import type { SquadMember } from "@worker/protocol";
import { squadHoldersOf, useSquadStore } from "./squad-store";

const NONE: SquadMember[] = [];

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

/** Whether a squad is worth showing tags for at all. */
export function useInSquad(): boolean {
  return useSquadStore((s) => s.members.length > 1);
}
