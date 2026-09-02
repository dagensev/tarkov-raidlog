import { DurableObject } from "cloudflare:workers";

import type {
  ClientMessage,
  MemberProgress,
  ServerMessage,
  SquadMember,
  SquadSnapshot,
} from "./protocol";

/**
 * One squad, one Durable Object.
 *
 * A Durable Object is the right shape here because a squad is exactly what it provides:
 * a single authoritative place that both holds the state and can broadcast it, addressed
 * by name (`idFromName(token)`) so the invite token *is* the address — no lookup table.
 *
 * Sockets are accepted with hibernation, so an idle squad costs nothing while its members
 * are in a raid with the tab in the background. That is also why the member id is stashed
 * on the socket itself: the object may be evicted from memory between messages, so it
 * cannot keep a socket-to-member map in a field.
 */

interface SocketState {
  memberId: string;
}

/** Drop members that have not been heard from in this long. */
const STALE_MEMBER_MS = 24 * 60 * 60 * 1000;

export class SquadRoom extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS members (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        faction TEXT,
        level INTEGER,
        currentMap TEXT,
        updatedAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS member_tasks (
        memberId TEXT NOT NULL,
        taskId TEXT NOT NULL,
        status TEXT NOT NULL,
        PRIMARY KEY (memberId, taskId)
      );
    `);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      // A plain GET returns the snapshot, which makes the room inspectable without a
      // socket — useful for debugging and for a read-only view later.
      return Response.json(this.snapshot());
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string") return;

    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      return this.send(ws, { type: "error", message: "malformed message" });
    }

    switch (message.type) {
      case "hello":
        return this.onHello(ws, message.member, message.progress ?? {});
      case "progress":
        return this.onProgress(ws, message.changed ?? {});
      case "presence":
        return this.onPresence(ws, message);
      default:
        return this.send(ws, { type: "error", message: "unknown message type" });
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const state = this.stateOf(ws);
    if (!state) return;
    // The member is kept — squads outlive a closed tab — but they stop showing as online.
    this.broadcastMember(state.memberId, undefined, ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  // --- message handlers -------------------------------------------------------------

  private onHello(
    ws: WebSocket,
    member: Omit<SquadMember, "online" | "updatedAt">,
    progress: MemberProgress,
  ): void {
    if (!member?.id || !member.name) {
      return this.send(ws, { type: "error", message: "hello needs an id and a name" });
    }

    ws.serializeAttachment({ memberId: member.id } satisfies SocketState);
    const now = Date.now();

    this.sql.exec(
      `INSERT INTO members (id, name, faction, level, currentMap, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         faction = excluded.faction,
         level = excluded.level,
         currentMap = excluded.currentMap,
         updatedAt = excluded.updatedAt`,
      member.id,
      member.name,
      member.faction ?? null,
      member.level ?? null,
      member.currentMap ?? null,
      now,
    );

    // A hello carries full state, so it replaces rather than merges: it is also how a
    // member whose tasks were removed gets those removals reflected.
    this.sql.exec(`DELETE FROM member_tasks WHERE memberId = ?`, member.id);
    this.writeProgress(member.id, progress);
    this.pruneStale();

    this.send(ws, { type: "snapshot", snapshot: this.snapshot() });
    this.broadcastMember(member.id, progress, ws);
  }

  private onProgress(ws: WebSocket, changed: MemberProgress): void {
    const state = this.stateOf(ws);
    if (!state) return this.send(ws, { type: "error", message: "say hello first" });
    this.touch(state.memberId);
    this.writeProgress(state.memberId, changed);
    this.broadcastMember(state.memberId, changed, ws);
  }

  private onPresence(
    ws: WebSocket,
    update: { currentMap?: string; level?: number; faction?: string; name?: string },
  ): void {
    const state = this.stateOf(ws);
    if (!state) return this.send(ws, { type: "error", message: "say hello first" });

    this.sql.exec(
      `UPDATE members
         SET currentMap = COALESCE(?, currentMap),
             level = COALESCE(?, level),
             faction = COALESCE(?, faction),
             name = COALESCE(?, name),
             updatedAt = ?
       WHERE id = ?`,
      update.currentMap ?? null,
      update.level ?? null,
      update.faction ?? null,
      update.name ?? null,
      Date.now(),
      state.memberId,
    );
    this.broadcastMember(state.memberId, undefined, ws);
  }

  // --- storage ----------------------------------------------------------------------

  private writeProgress(memberId: string, progress: MemberProgress): void {
    for (const [taskId, status] of Object.entries(progress)) {
      if (!status) {
        this.sql.exec(
          `DELETE FROM member_tasks WHERE memberId = ? AND taskId = ?`,
          memberId,
          taskId,
        );
        continue;
      }
      this.sql.exec(
        `INSERT INTO member_tasks (memberId, taskId, status) VALUES (?, ?, ?)
         ON CONFLICT(memberId, taskId) DO UPDATE SET status = excluded.status`,
        memberId,
        taskId,
        status,
      );
    }
  }

  private touch(memberId: string): void {
    this.sql.exec(`UPDATE members SET updatedAt = ? WHERE id = ?`, Date.now(), memberId);
  }

  /** Forget members nobody has heard from in a day, so a squad does not accrete strangers. */
  private pruneStale(): void {
    const cutoff = Date.now() - STALE_MEMBER_MS;
    const online = new Set(this.onlineIds());
    for (const row of this.sql
      .exec<{ id: string }>(`SELECT id FROM members WHERE updatedAt < ?`, cutoff)
      .toArray()) {
      if (online.has(row.id)) continue;
      this.sql.exec(`DELETE FROM members WHERE id = ?`, row.id);
      this.sql.exec(`DELETE FROM member_tasks WHERE memberId = ?`, row.id);
    }
  }

  private onlineIds(): string[] {
    const ids: string[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const state = this.stateOf(ws);
      if (state) ids.push(state.memberId);
    }
    return ids;
  }

  private stateOf(ws: WebSocket): SocketState | null {
    try {
      return (ws.deserializeAttachment() as SocketState | null) ?? null;
    } catch {
      return null;
    }
  }

  snapshot(): SquadSnapshot {
    const online = new Set(this.onlineIds());
    const members = this.sql
      .exec<{
        id: string;
        name: string;
        faction: string | null;
        level: number | null;
        currentMap: string | null;
        updatedAt: number;
      }>(`SELECT * FROM members ORDER BY name`)
      .toArray()
      .map<SquadMember>((row) => ({
        id: row.id,
        name: row.name,
        faction: row.faction ?? undefined,
        level: row.level ?? undefined,
        currentMap: row.currentMap ?? undefined,
        online: online.has(row.id),
        updatedAt: row.updatedAt,
      }));

    const progress: Record<string, MemberProgress> = {};
    for (const row of this.sql
      .exec<{ memberId: string; taskId: string; status: string }>(`SELECT * FROM member_tasks`)
      .toArray()) {
      (progress[row.memberId] ??= {})[row.taskId] = row.status as MemberProgress[string];
    }

    return { token: "", members, progress };
  }

  private memberRow(id: string): SquadMember | null {
    return this.snapshot().members.find((member) => member.id === id) ?? null;
  }

  // --- delivery ---------------------------------------------------------------------

  private send(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Socket closed mid-send; the close handler will clean up.
    }
  }

  /** Tell everyone except the originator about one member's new state. */
  private broadcastMember(id: string, changed: MemberProgress | undefined, from: WebSocket): void {
    const member = this.memberRow(id);
    if (!member) return;
    const message: ServerMessage = { type: "member", member, changed };
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === from) continue;
      this.send(ws, message);
    }
  }
}
