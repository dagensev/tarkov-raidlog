import { describe, expect, it } from "vitest";

import type { SquadMember } from "@worker/protocol";
import type { TaskState } from "@/lib/logs/progress";
import {
  activeMemberIds,
  matchesMembers,
  memberOptions,
  memberStatuses,
  statusFor,
  type MemberSelection,
} from "../members";

const YOU = "you";
const MATE = "mate";
const OTHER = "other";

const member = (id: string, name: string): SquadMember => ({
  id,
  name,
  online: true,
  updatedAt: 0,
});

const states = (entries: Record<string, TaskState["status"]>): Map<string, TaskState> =>
  new Map(
    Object.entries(entries).map(([taskId, status]) => [taskId, { taskId, status, at: 0 }]),
  );

const selection = (patch: Partial<MemberSelection> = {}): MemberSelection => ({
  ids: [],
  youId: YOU,
  states: states({ yours: "started", both: "started", done: "finished" }),
  progress: {
    [MATE]: { theirs: "started", both: "started", theirsDone: "finished", flubbed: "failed" },
    [OTHER]: { others: "started" },
  },
  ...patch,
});

describe("matchesMembers", () => {
  it("surfaces a task only a squadmate is holding", () => {
    const sel = selection({ ids: [MATE] });
    expect(matchesMembers("theirs", "started", sel)).toBe(true);
    // The whole point: nothing in your own logs mentions this one.
    expect(sel.states.has("theirs")).toBe(false);
  });

  it("does not surface a squadmate's task when only you are lit", () => {
    expect(matchesMembers("theirs", "started", selection({ ids: [YOU] }))).toBe(false);
    expect(matchesMembers("yours", "started", selection({ ids: [YOU] }))).toBe(true);
  });

  it("is a union across the lit members, not an intersection", () => {
    const sel = selection({ ids: [YOU, MATE] });
    expect(matchesMembers("yours", "started", sel)).toBe(true);
    expect(matchesMembers("theirs", "started", sel)).toBe(true);
    expect(matchesMembers("both", "started", sel)).toBe(true);
    // Nobody lit holds this one, even though somebody in the squad does.
    expect(matchesMembers("others", "started", sel)).toBe(false);
  });

  it("keeps Done to what the lit members finished", () => {
    expect(matchesMembers("done", "finished", selection({ ids: [YOU] }))).toBe(true);
    expect(matchesMembers("done", "finished", selection({ ids: [MATE] }))).toBe(false);
    expect(matchesMembers("theirsDone", "finished", selection({ ids: [MATE] }))).toBe(true);
    // A held task is not a finished one.
    expect(matchesMembers("theirs", "finished", selection({ ids: [MATE] }))).toBe(false);
  });

  it("narrows All to what the lit members have touched, failed included", () => {
    const sel = selection({ ids: [MATE] });
    expect(matchesMembers("theirs", "all", sel)).toBe(true);
    expect(matchesMembers("theirsDone", "all", sel)).toBe(true);
    expect(matchesMembers("flubbed", "all", sel)).toBe(true);
    // All stops meaning "every task in the game" the moment a chip is lit.
    expect(matchesMembers("untouched", "all", sel)).toBe(false);
  });

  it("never matches an empty selection, so the axis is inert until a chip is lit", () => {
    expect(matchesMembers("yours", "started", selection())).toBe(false);
    expect(matchesMembers("yours", "all", selection())).toBe(false);
  });
});

describe("statusFor", () => {
  it("reads your own status from the logs, not from the published copy", () => {
    // The store publishes your progress optimistically and republishes it wholesale on a
    // reconnect, so the two can disagree. The logs win, to match the rail on the row.
    const sel = selection({
      ids: [YOU],
      progress: { ...selection().progress, [YOU]: { yours: "finished" } },
    });
    expect(statusFor("yours", YOU, sel)).toBe("started");
    expect(matchesMembers("yours", "finished", sel)).toBe(false);
  });

  it("reads a squadmate's status from the room", () => {
    expect(statusFor("theirs", MATE, selection())).toBe("started");
    expect(statusFor("nothing", MATE, selection())).toBeUndefined();
  });
});

describe("memberOptions", () => {
  it("puts you first and marks you", () => {
    const options = memberOptions([member(MATE, "Ravens"), member(YOU, "Dagen")], YOU);
    expect(options.map((o) => o.isYou)).toEqual([true, false]);
    expect(options[0].name).toBe("Dagen (you)");
    expect(options[1].name).toBe("Ravens");
  });

  it("marks nobody when there is no identity yet", () => {
    expect(memberOptions([member(MATE, "Ravens")]).every((o) => !o.isYou)).toBe(true);
  });
});

describe("activeMemberIds", () => {
  it("drops a member who has left rather than leaving the list narrowed to them", () => {
    const options = memberOptions([member(YOU, "Dagen"), member(MATE, "Ravens")], YOU);
    expect(activeMemberIds([YOU, MATE, "departed"], options)).toEqual([YOU, MATE]);
    expect(activeMemberIds(["departed"], options)).toEqual([]);
  });
});

describe("memberStatuses", () => {
  const options = memberOptions(
    [member(YOU, "Dagen"), member(MATE, "Ravens"), member(OTHER, "Kazuma")],
    YOU,
  );

  it("reports the lit squadmates' own status, leaving you out", () => {
    const sel = selection({ ids: [YOU, MATE] });
    expect(memberStatuses("both", sel, options)).toEqual([
      { id: MATE, name: "Ravens", isYou: false, status: "started" },
    ]);
  });

  it("says nothing about a member who is not lit", () => {
    expect(memberStatuses("others", selection({ ids: [MATE] }), options)).toEqual([]);
  });

  it("carries done and failed, not just holding", () => {
    const sel = selection({ ids: [MATE] });
    expect(memberStatuses("theirsDone", sel, options)[0].status).toBe("finished");
    expect(memberStatuses("flubbed", sel, options)[0].status).toBe("failed");
  });
});
