import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  TOKEN_ALPHABET,
  TOKEN_LENGTH,
  generateToken,
  isValidToken,
  normalizeToken,
  type ServerMessage,
} from "../protocol";

/**
 * Runs inside workerd, so the Durable Object, its SQLite storage and WebSocket
 * hibernation are the real implementations rather than stand-ins.
 */

const ORIGIN = "https://raidlog.test";

/** A socket plus a queue, so a test can await the next message rather than poll. */
class TestSocket {
  private readonly queue: ServerMessage[] = [];
  private waiting: ((message: ServerMessage) => void) | null = null;

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage;
      if (this.waiting) {
        const resolve = this.waiting;
        this.waiting = null;
        resolve(message);
      } else {
        this.queue.push(message);
      }
    });
  }

  static async open(token: string): Promise<TestSocket> {
    const response = await SELF.fetch(`${ORIGIN}/api/squad/${token}/ws`, {
      headers: { Upgrade: "websocket" },
    });
    expect(response.status).toBe(101);
    const ws = response.webSocket!;
    ws.accept();
    return new TestSocket(ws);
  }

  send(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }

  /** Bypass JSON encoding, to exercise what happens when a client sends nonsense. */
  sendRaw(text: string): void {
    this.ws.send(text);
  }

  next(timeoutMs = 2000): Promise<ServerMessage> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for a message")), timeoutMs);
      this.waiting = (message) => {
        clearTimeout(timer);
        resolve(message);
      };
    });
  }

  /** Wait for the first message of a given type, discarding others. */
  async nextOfType<T extends ServerMessage["type"]>(
    type: T,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    for (let i = 0; i < 10; i += 1) {
      const message = await this.next();
      if (message.type === type) return message as Extract<ServerMessage, { type: T }>;
    }
    throw new Error(`never saw a ${type} message`);
  }

  close(): void {
    this.ws.close();
  }
}

async function createSquad(): Promise<string> {
  const response = await SELF.fetch(`${ORIGIN}/api/squad`, { method: "POST" });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { token: string; join: string };
  return body.token;
}

const member = (id: string, name: string) => ({ id, name });

describe("invite tokens", () => {
  it("draws only from characters normalisation leaves alone", () => {
    for (const char of TOKEN_ALPHABET) {
      expect(normalizeToken(char)).toBe(char);
    }
  });

  it("generates canonical tokens of the right length", () => {
    for (let i = 0; i < 200; i++) {
      const token = generateToken();
      expect(token).toHaveLength(TOKEN_LENGTH);
      expect(normalizeToken(token)).toBe(token);
      expect(isValidToken(token)).toBe(true);
    }
  });
});

describe("squad API", () => {
  it("creates a squad with a usable token and invite link", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/squad`, { method: "POST" });
    const body = (await response.json()) as { token: string; join: string };
    expect(isValidToken(body.token)).toBe(true);
    expect(body.join).toBe(`${ORIGIN}/j/${body.token}`);
  });

  it("issues a different token each time", async () => {
    const tokens = new Set(await Promise.all([createSquad(), createSquad(), createSquad()]));
    expect(tokens.size).toBe(3);
  });

  it("rejects a malformed squad code", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/squad/nope`);
    expect(response.status).toBe(400);
  });

  it("turns a short invite link into the join page", async () => {
    // A fixed token, not a freshly created one: the redirect normalises what it is given,
    // so a random draw that happened to need normalising used to fail this comparison.
    // What the token normalises to is the subject of its own test below.
    const response = await SELF.fetch(`${ORIGIN}/j/ABCD1234`, { redirect: "manual" });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("/squad/?join=ABCD1234");
  });

  it("hands out a token that is already in its canonical form", async () => {
    // The invite link carries the raw token and the room is keyed on the normalised one, so
    // a token that changes under normalisation is shown to its owner as one code and stored
    // under another. Q used to be in the alphabet and folds to zero.
    const response = await SELF.fetch(`${ORIGIN}/api/squad`, { method: "POST" });
    const body = (await response.json()) as { token: string; join: string };
    expect(normalizeToken(body.token)).toBe(body.token);
    expect(body.join).toContain(`/j/${normalizeToken(body.token)}`);
  });

  it("accepts a token typed with the characters people confuse", async () => {
    // Crockford: O reads as 0, I and L as 1. A token off a screenshot should still work.
    expect(normalizeToken("abco1ijk")).toBe(normalizeToken("ABC01" + "1JK"));
    const token = await createSquad();
    const response = await SELF.fetch(`${ORIGIN}/api/squad/${token.toLowerCase()}`);
    expect(response.status).toBe(200);
  });

  it("returns an empty snapshot for a squad nobody has joined", async () => {
    const token = await createSquad();
    const response = await SELF.fetch(`${ORIGIN}/api/squad/${token}`);
    const snapshot = (await response.json()) as { token: string; members: unknown[] };
    expect(snapshot.token).toBe(token);
    expect(snapshot.members).toEqual([]);
  });
});

describe("squad room", () => {
  it("greets a joiner with the current snapshot", async () => {
    const token = await createSquad();
    const a = await TestSocket.open(token);
    a.send({ type: "hello", member: member("a", "Alpha"), progress: { t1: "finished" } });

    const snapshot = await a.nextOfType("snapshot");
    expect(snapshot.snapshot.members).toHaveLength(1);
    expect(snapshot.snapshot.members[0]).toMatchObject({ id: "a", name: "Alpha", online: true });
    expect(snapshot.snapshot.progress.a).toEqual({ t1: "finished" });
    a.close();
  });

  it("shows an existing member to someone joining later", async () => {
    const token = await createSquad();
    const a = await TestSocket.open(token);
    a.send({ type: "hello", member: member("a", "Alpha"), progress: { t1: "finished" } });
    await a.nextOfType("snapshot");

    const b = await TestSocket.open(token);
    b.send({ type: "hello", member: member("b", "Bravo"), progress: {} });
    const snapshot = await b.nextOfType("snapshot");

    expect(snapshot.snapshot.members.map((m) => m.id).sort()).toEqual(["a", "b"]);
    expect(snapshot.snapshot.progress.a).toEqual({ t1: "finished" });
    a.close();
    b.close();
  });

  it("tells the room when someone joins", async () => {
    const token = await createSquad();
    const a = await TestSocket.open(token);
    a.send({ type: "hello", member: member("a", "Alpha"), progress: {} });
    await a.nextOfType("snapshot");

    const b = await TestSocket.open(token);
    b.send({ type: "hello", member: member("b", "Bravo"), progress: {} });

    const update = await a.nextOfType("member");
    expect(update.member).toMatchObject({ id: "b", name: "Bravo", online: true });
    a.close();
    b.close();
  });

  it("broadcasts a progress change to everyone else", async () => {
    const token = await createSquad();
    const a = await TestSocket.open(token);
    a.send({ type: "hello", member: member("a", "Alpha"), progress: {} });
    await a.nextOfType("snapshot");
    const b = await TestSocket.open(token);
    b.send({ type: "hello", member: member("b", "Bravo"), progress: {} });
    await b.nextOfType("snapshot");
    await a.nextOfType("member");

    b.send({ type: "progress", changed: { "657315ddab5a49b71f098853": "finished" } });

    const update = await a.nextOfType("member");
    expect(update.member.id).toBe("b");
    expect(update.changed).toEqual({ "657315ddab5a49b71f098853": "finished" });
    a.close();
    b.close();
  });

  it("broadcasts the map a squadmate is loading into", async () => {
    const token = await createSquad();
    const a = await TestSocket.open(token);
    a.send({ type: "hello", member: member("a", "Alpha"), progress: {} });
    await a.nextOfType("snapshot");
    const b = await TestSocket.open(token);
    b.send({ type: "hello", member: member("b", "Bravo"), progress: {} });
    await b.nextOfType("snapshot");
    await a.nextOfType("member");

    b.send({ type: "presence", currentMap: "56f40101d2720b2a4d8b45d6" });

    const update = await a.nextOfType("member");
    expect(update.member.currentMap).toBe("56f40101d2720b2a4d8b45d6");
    a.close();
    b.close();
  });

  it("keeps a member's progress after they close the tab", async () => {
    // Squads outlive a closed tab: you should still see what a squadmate has done.
    const token = await createSquad();
    const a = await TestSocket.open(token);
    a.send({ type: "hello", member: member("a", "Alpha"), progress: { t1: "finished" } });
    await a.nextOfType("snapshot");
    a.close();

    const response = await SELF.fetch(`${ORIGIN}/api/squad/${token}`);
    const snapshot = (await response.json()) as {
      members: Array<{ id: string; online: boolean }>;
      progress: Record<string, Record<string, string>>;
    };
    expect(snapshot.progress.a).toEqual({ t1: "finished" });
    expect(snapshot.members[0].id).toBe("a");
  });

  it("replaces state on a fresh hello, so removals propagate", async () => {
    const token = await createSquad();
    const first = await TestSocket.open(token);
    first.send({ type: "hello", member: member("a", "Alpha"), progress: { t1: "finished", t2: "started" } });
    await first.nextOfType("snapshot");
    first.close();

    const again = await TestSocket.open(token);
    again.send({ type: "hello", member: member("a", "Alpha"), progress: { t1: "finished" } });
    const snapshot = await again.nextOfType("snapshot");
    expect(snapshot.snapshot.progress.a).toEqual({ t1: "finished" });
    again.close();
  });

  it("refuses progress from a socket that never said hello", async () => {
    const token = await createSquad();
    const ws = await TestSocket.open(token);
    ws.send({ type: "progress", changed: { t1: "finished" } });
    const message = await ws.nextOfType("error");
    expect(message.message).toMatch(/hello/i);
    ws.close();
  });

  it("rejects a hello with no name", async () => {
    const token = await createSquad();
    const ws = await TestSocket.open(token);
    ws.send({ type: "hello", member: { id: "a" }, progress: {} });
    expect((await ws.nextOfType("error")).message).toMatch(/name/i);
    ws.close();
  });

  it("survives a malformed message and stays usable", async () => {
    const token = await createSquad();
    const ws = await TestSocket.open(token);
    ws.sendRaw("not json at all");
    expect((await ws.nextOfType("error")).message).toMatch(/malformed/i);

    // Still usable afterwards.
    ws.send({ type: "hello", member: member("a", "Alpha"), progress: {} });
    expect((await ws.nextOfType("snapshot")).snapshot.members).toHaveLength(1);
    ws.close();
  });

  it("keeps squads separate", async () => {
    const one = await createSquad();
    const two = await createSquad();
    const a = await TestSocket.open(one);
    a.send({ type: "hello", member: member("a", "Alpha"), progress: { t1: "finished" } });
    await a.nextOfType("snapshot");

    const response = await SELF.fetch(`${ORIGIN}/api/squad/${two}`);
    const snapshot = (await response.json()) as { members: unknown[] };
    expect(snapshot.members).toEqual([]);
    a.close();
  });
});
