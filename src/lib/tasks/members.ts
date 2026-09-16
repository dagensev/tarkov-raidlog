import type { MemberProgress, SquadMember, TaskStatusWire } from "@worker/protocol";
import type { TaskState } from "@/lib/logs/progress";
import type { TaskFilter } from "./filters";

/**
 * Reading the task list through somebody else's logs.
 *
 * The room already carries every member's full `taskId -> status` map, but the tasks page
 * only ever read your own. The chips below pick *whose* logs the status filter applies to,
 * which is what makes a squadmate's task visible when you have never accepted it.
 *
 * An empty selection means no narrowing at all — the same house rule as the flea page's
 * chip groups — so the page opens exactly as it did before anyone joined a squad.
 *
 * Kept out of the page because a squad is not something a test can conjure by rendering,
 * the same reason `sort.ts` exists.
 */

/** One chip: a squad member whose logs the list can read. */
export interface MemberOption {
  id: string;
  name: string;
  /** You. Led with in the chip row, and left out of the row tag. */
  isYou: boolean;
}

/** A member's status on one task, for the row tag. */
export interface MemberStatus extends MemberOption {
  status: TaskStatusWire;
}

export interface MemberSelection {
  /** Member ids currently lit. Empty means the whole axis is off. */
  ids: readonly string[];
  youId?: string;
  /**
   * Your own logs. Authoritative for you: `progress[youId]` is a published copy that the
   * store writes optimistically and a reconnect republishes wholesale, so it can lag what
   * the rail on the row beside the chip is already showing.
   */
  states: ReadonlyMap<string, TaskState>;
  /** Everyone's published progress, as the room sent it. */
  progress: Record<string, MemberProgress>;
}

/** Chips for the roster, you first and the rest in the order the store keeps them. */
export function memberOptions(
  members: readonly SquadMember[],
  youId?: string,
): MemberOption[] {
  const options = members.map((member) => ({
    id: member.id,
    name: member.id === youId ? `${member.name} (you)` : member.name,
    isYou: member.id === youId,
  }));
  return options.sort((a, b) => Number(b.isYou) - Number(a.isYou));
}

/**
 * The selection with departed members dropped.
 *
 * Same self-healing as a stale map or sort selection on the page: somebody leaving the
 * squad should not leave the list narrowed to a person who is no longer offered.
 */
export function activeMemberIds(
  selected: readonly string[],
  options: readonly MemberOption[],
): string[] {
  const known = new Set(options.map((option) => option.id));
  return selected.filter((id) => known.has(id));
}

export function statusFor(
  taskId: string,
  memberId: string,
  selection: MemberSelection,
): TaskStatusWire | undefined {
  if (memberId === selection.youId) return selection.states.get(taskId)?.status;
  return selection.progress[memberId]?.[taskId];
}

/**
 * Whether any selected member's status answers the filter.
 *
 * "All" narrows here, unlike the unselected case: with a chip lit the question is no
 * longer "every task in the game" but "everything in these people's books", so it keeps a
 * task anyone selected has touched at all — failed included, which no chip asks for on
 * its own but which is still a thing that happened to the task.
 */
export function matchesMembers(
  taskId: string,
  filter: TaskFilter,
  selection: MemberSelection,
): boolean {
  return selection.ids.some((id) => {
    const status = statusFor(taskId, id, selection);
    if (!status) return false;
    return filter === "all" || status === filter;
  });
}

/** Selected members with a status on this task, for the row tag. You excluded. */
export function memberStatuses(
  taskId: string,
  selection: MemberSelection,
  options: readonly MemberOption[],
): MemberStatus[] {
  const statuses: MemberStatus[] = [];
  for (const option of options) {
    if (option.isYou) continue;
    if (!selection.ids.includes(option.id)) continue;
    const status = statusFor(taskId, option.id, selection);
    if (status) statuses.push({ ...option, status });
  }
  return statuses;
}
