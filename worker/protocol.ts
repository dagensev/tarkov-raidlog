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
 * spoken aloud or retyped from a screenshot. 8 characters of it is ~39 bits — far more
 * than enough that guessing a squad is not worth anyone's time.
 *
 * Q is dropped on top of Crockford's own exclusions, because `normalizeToken` folds it to
 * zero alongside O. Every character here must survive that fold untouched: a generated
 * token that normalises to something else is shown to its owner as one code and stored
 * under another. The alphabet is asserted against the fold in `squad-room.test.ts`, so a
 * character added back here fails a test rather than reaching a squad.
 */
export const TOKEN_ALPHABET = "0123456789ABCDEFGHJKMNPRSTVWXYZ";
export const TOKEN_LENGTH = 8;

export function generateToken(random: Crypto = crypto): string {
  // 31 characters no longer divide 256, so `byte % length` would hand the first 8 symbols
  // a ninth chance the other 23 do not get. Bytes at or above the last whole multiple are
  // thrown away and redrawn instead — about 3% of them — which keeps every character
  // equally likely and the ~39 bits above honest.
  const limit = 256 - (256 % TOKEN_ALPHABET.length);
  let out = "";
  while (out.length < TOKEN_LENGTH) {
    const bytes = new Uint8Array(TOKEN_LENGTH);
    random.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= limit) continue;
      out += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
      if (out.length === TOKEN_LENGTH) break;
    }
  }
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
