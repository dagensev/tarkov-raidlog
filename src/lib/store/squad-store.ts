"use client";

import { create } from "zustand";

import type { MemberProgress, SquadMember } from "@worker/protocol";
import { normalizeToken } from "@worker/protocol";
import {
  SquadClient,
  createSquad as createSquadRequest,
  type SquadIdentity,
  type SquadStatus,
} from "@/lib/squad/client";
import * as db from "./db";

/**
 * Squad membership and the live room state.
 *
 * Kept apart from the main app store because it is a different lifecycle: the app store
 * is fed by your log folder, this one by a socket. The only thing crossing between them
 * is what gets published, which the sync component wires up.
 */

export interface SquadState {
  token: string | null;
  status: SquadStatus;
  error: string | null;
  identity: SquadIdentity | null;
  members: SquadMember[];
  /** `memberId -> taskId -> status`, everyone including you. */
  progress: Record<string, MemberProgress>;

  hydrate: () => Promise<void>;
  create: () => Promise<string | null>;
  join: (token: string) => Promise<boolean>;
  leave: () => Promise<void>;
  rename: (name: string) => Promise<void>;
  /** Called by the sync component when local progress or presence changes. */
  publishProgress: (changed: MemberProgress, full: MemberProgress) => void;
  publishPresence: (update: Partial<SquadIdentity>) => void;
}

/** Live outside the store: not rendered, and a socket in reactive state invites loops. */
let client: SquadClient | null = null;

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A friendly default so a guest is not "Player 3f2a" unless they want to be. */
function defaultName(): string {
  return `PMC-${randomId().slice(0, 4).toUpperCase()}`;
}

export const useSquadStore = create<SquadState>((set, get) => ({
  token: null,
  status: "idle",
  error: null,
  identity: null,
  members: [],
  progress: {},

  async hydrate() {
    const [token, stored] = await Promise.all([db.get("squadToken"), db.get("squadIdentity")]);
    // Identity is generated once and kept: it is what makes you the same person to your
    // squad across sessions, without an account.
    const identity = stored ?? { id: randomId(), name: defaultName() };
    if (!stored) await db.set("squadIdentity", identity);
    set({ identity, token: token ?? null });
  },

  async create() {
    set({ error: null });
    try {
      const { token } = await createSquadRequest();
      await get().join(token);
      return token;
    } catch (error) {
      set({ error: (error as Error).message, status: "error" });
      return null;
    }
  },

  async join(raw) {
    const token = normalizeToken(raw);
    if (!token) {
      set({ error: "That does not look like a squad code." });
      return false;
    }

    disconnect();
    await db.set("squadToken", token);
    set({ token, members: [], progress: {}, error: null });
    connect(set, get);
    return true;
  },

  async leave() {
    disconnect();
    await db.remove("squadToken");
    set({ token: null, members: [], progress: {}, status: "idle", error: null });
  },

  async rename(name) {
    const trimmed = name.trim().slice(0, 24);
    if (!trimmed) return;
    const identity = { ...(get().identity ?? { id: randomId(), name: trimmed }), name: trimmed };
    set({ identity });
    await db.set("squadIdentity", { id: identity.id, name: identity.name });
    client?.publishPresence({ name: trimmed });
  },

  publishProgress(changed, full) {
    client?.publishProgress(changed, full);
    // Show your own state alongside everyone else's without waiting for a round trip.
    const id = get().identity?.id;
    if (id) set({ progress: { ...get().progress, [id]: full } });
  },

  publishPresence(update) {
    client?.publishPresence(update);
  },
}));

type SetState = (partial: Partial<SquadState>) => void;
type GetState = () => SquadState;

function disconnect(): void {
  client?.disconnect();
  client = null;
}

function connect(set: SetState, get: GetState): void {
  const { token, identity } = get();
  if (!token || !identity) return;

  client = new SquadClient(token, identity, get().progress[identity.id] ?? {}, {
    onSnapshot(snapshot) {
      set({ members: snapshot.members, progress: snapshot.progress, error: null });
    },
    onMember(member, changed) {
      const members = get().members.filter((m) => m.id !== member.id);
      members.push(member);
      members.sort((a, b) => a.name.localeCompare(b.name));
      const progress = { ...get().progress };
      if (changed) progress[member.id] = { ...(progress[member.id] ?? {}), ...changed };
      set({ members, progress });
    },
    onGone(id) {
      set({
        members: get().members.filter((member) => member.id !== id),
        progress: Object.fromEntries(
          Object.entries(get().progress).filter(([memberId]) => memberId !== id),
        ),
      });
    },
    onStatus(status, detail) {
      set({ status, error: detail ?? (status === "error" ? "Squad sync failed." : null) });
    },
  });
  client.connect();
}

/** Reconnect after hydration, when a stored token means we were already in a squad. */
export function resumeSquad(): void {
  const state = useSquadStore.getState();
  if (state.token && !client) connect(useSquadStore.setState, useSquadStore.getState);
}
