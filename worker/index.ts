import { generateToken, isValidToken, normalizeToken } from "./protocol";
import { SquadRoom } from "./squad-room";

export { SquadRoom };

/**
 * The only server-side code in the project.
 *
 * Everything else ships as static assets, which Cloudflare serves free and unlimited
 * without invoking a Worker at all. This handles `/api/*` and the pretty invite path,
 * and hands everything else to the asset binding — so the 10 ms CPU limit on the Workers
 * free plan only ever applies to these few handlers, which do almost nothing.
 */

const JSON_HEADERS = { "Content-Type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function roomFor(env: Env, token: string): DurableObjectStub<SquadRoom> {
  // The token *is* the address: no registry, no lookup, no way to enumerate squads.
  return env.SQUAD_ROOM.get(env.SQUAD_ROOM.idFromName(token));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    // Pretty invite links: /j/ABCD1234 -> the join page. Static export cannot serve a
    // dynamic route, so the Worker turns the short form into a query the page can read.
    const invite = /^\/j\/([^/]+)\/?$/.exec(pathname);
    if (invite) {
      const token = normalizeToken(decodeURIComponent(invite[1]));
      const target = new URL(isValidToken(token) ? `/squad/?join=${token}` : "/squad/", url);
      return Response.redirect(target.toString(), 302);
    }

    if (pathname === "/api/health") {
      return json({ ok: true });
    }

    // Create a squad. No auth: the returned token is the only thing that grants access,
    // and creating one costs a single Durable Object that stays empty until someone joins.
    if (pathname === "/api/squad" && request.method === "POST") {
      const token = generateToken();
      return json({ token, join: new URL(`/j/${token}`, url).toString() });
    }

    const squad = /^\/api\/squad\/([^/]+)(\/ws)?$/.exec(pathname);
    if (squad) {
      const token = normalizeToken(decodeURIComponent(squad[1]));
      if (!isValidToken(token)) return json({ error: "invalid squad code" }, 400);

      const room = roomFor(env, token);
      if (squad[2]) return room.fetch(request);

      // Snapshot without a socket.
      const response = await room.fetch(new Request(new URL("/", url)));
      const snapshot = (await response.json()) as Record<string, unknown>;
      return json({ ...snapshot, token });
    }

    if (pathname.startsWith("/api/")) return json({ error: "not found" }, 404);

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
