/**
 * Wire protocol between a browser and its squad room.
 *
 * Shared by the Worker and the client so the two cannot drift. Deliberately small: a
 * squad publishes only what is useful to the people you are raiding with — who you are,
 * what map you are on, and which tasks you have done or are holding. No log contents, no
 * account data, nothing that identifies a machine.
 */

export type TaskStatusWire = "started" | "finished" | "failed";

export interface SquadMember {
  /** Random id generated in the member's browser. Not derived from anything personal. */
  id: string;
  name: string;
  /** `USEC` or `BEAR`, if they set one. */
  faction?: string;
  level?: number;
  /** tarkov.dev map id they were last seen loading into. */
  currentMap?: string;
  /** Whether a socket for this member is currently open. */
  online: boolean;
  /** Last update, ms since epoch. */
  updatedAt: number;
}

/** One member's task states, as `taskId -> status`. */
export type MemberProgress = Record<string, TaskStatusWire>;

export interface SquadSnapshot {
  token: string;
  members: SquadMember[];
  progress: Record<string, MemberProgress>;
}

// --- client -> server ---------------------------------------------------------------

export interface HelloMessage {
  type: "hello";
  member: Omit<SquadMember, "online" | "updatedAt">;
  /** Full task state on join; deltas afterwards. */
  progress: MemberProgress;
}

export interface ProgressMessage {
  type: "progress";
  /** Only what changed. An empty status removes the entry. */
  changed: MemberProgress;
}

export interface PresenceMessage {
  type: "presence";
  currentMap?: string;
  level?: number;
  faction?: string;
  name?: string;
}

export type ClientMessage = HelloMessage | ProgressMessage | PresenceMessage;

// --- server -> client ---------------------------------------------------------------

export interface SnapshotMessage {
  type: "snapshot";
  snapshot: SquadSnapshot;
}

export interface MemberUpdateMessage {
  type: "member";
  member: SquadMember;
  /** Present when the update carried progress changes. */
  changed?: MemberProgress;
}

export interface MemberGoneMessage {
  type: "gone";
  id: string;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export type ServerMessage =
  | SnapshotMessage
  | MemberUpdateMessage
  | MemberGoneMessage
  | ErrorMessage;

/**
 * Invite tokens.
 *
 * Crockford base32 without the letters that read as digits, so a token survives being
 * spoken aloud or retyped from a screenshot. 8 characters of it is ~40 bits — far more
 * than enough that guessing a squad is not worth anyone's time.
 */
export const TOKEN_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const TOKEN_LENGTH = 8;

export function generateToken(random: Crypto = crypto): string {
  const bytes = new Uint8Array(TOKEN_LENGTH);
  random.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
  return out;
}

/** Normalise user-typed input: case-insensitive, and forgiving of the usual confusions. */
export function normalizeToken(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[OQ]/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/[^0-9A-Z]/g, "");
}

export function isValidToken(input: string): boolean {
  const token = normalizeToken(input);
  if (token.length !== TOKEN_LENGTH) return false;
  return [...token].every((char) => TOKEN_ALPHABET.includes(char));
}
