"use client";

import type {
  ClientMessage,
  MemberProgress,
  ServerMessage,
  SquadMember,
  SquadSnapshot,
} from "@worker/protocol";

/**
 * The browser half of squad sync.
 *
 * Reconnects on its own, because the interesting moment for this app is exactly when the
 * network is least reliable: alt-tabbed out of a raid, machine under load, tab throttled
 * in the background. A dropped socket should heal quietly rather than needing a click.
 */

export interface SquadIdentity {
  id: string;
  name: string;
  currentMap?: string;
}

export interface SquadClientEvents {
  onSnapshot(snapshot: SquadSnapshot): void;
  onMember(member: SquadMember, changed?: MemberProgress): void;
  onGone(id: string): void;
  onStatus(status: SquadStatus, detail?: string): void;
}

export type SquadStatus = "idle" | "connecting" | "connected" | "reconnecting" | "error";

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 20_000;

export class SquadClient {
  private ws: WebSocket | null = null;
  private retries = 0;
  private closedByUs = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly token: string,
    private identity: SquadIdentity,
    private progress: MemberProgress,
    private readonly events: SquadClientEvents,
  ) {}

  connect(): void {
    this.closedByUs = false;
    this.open();
  }

  private url(): string {
    const base = new URL(`/api/squad/${this.token}/ws`, window.location.origin);
    base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    return base.toString();
  }

  private open(): void {
    this.events.onStatus(this.retries === 0 ? "connecting" : "reconnecting");

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url());
    } catch (error) {
      return this.scheduleRetry((error as Error).message);
    }
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.retries = 0;
      this.events.onStatus("connected");
      // A hello carries full state, so a reconnect resyncs rather than replaying deltas
      // that were missed while the socket was down.
      this.send({ type: "hello", member: this.identity, progress: this.progress });
    });

    ws.addEventListener("message", (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return;
      }
      switch (message.type) {
        case "snapshot":
          return this.events.onSnapshot(message.snapshot);
        case "member":
          return this.events.onMember(message.member, message.changed);
        case "gone":
          return this.events.onGone(message.id);
        case "error":
          return this.events.onStatus("error", message.message);
      }
    });

    ws.addEventListener("close", () => {
      if (this.closedByUs) return;
      this.scheduleRetry();
    });

    ws.addEventListener("error", () => {
      // `close` always follows, so retry scheduling lives there.
    });
  }

  private scheduleRetry(detail?: string): void {
    if (this.closedByUs) return;
    const delay = Math.min(RETRY_BASE_MS * 2 ** this.retries, RETRY_MAX_MS);
    this.retries += 1;
    this.events.onStatus("reconnecting", detail);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  private send(message: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(message));
    return true;
  }

  /** Publish task changes. Held locally if the socket is down; the next hello carries them. */
  publishProgress(changed: MemberProgress, full: MemberProgress): void {
    this.progress = full;
    if (Object.keys(changed).length === 0) return;
    this.send({ type: "progress", changed });
  }

  /** Publish who and where you are. */
  publishPresence(update: Partial<SquadIdentity>): void {
    this.identity = { ...this.identity, ...update };
    this.send({ type: "presence", ...update });
  }

  disconnect(): void {
    this.closedByUs = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.ws?.close();
    this.ws = null;
    this.events.onStatus("idle");
  }
}

/** Create a squad and get its token back. */
export async function createSquad(): Promise<{ token: string; join: string }> {
  const response = await fetch("/api/squad", { method: "POST" });
  if (!response.ok) throw new Error(`could not create a squad (HTTP ${response.status})`);
  return (await response.json()) as { token: string; join: string };
}
