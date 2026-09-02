import { describe, expect, it, vi } from "vitest";

import { TarkovDevError, queryTarkovDev } from "../client";

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const opts = { backoffMs: 0 };

describe("queryTarkovDev", () => {
  it("returns data on success", async () => {
    const fetchImpl = vi.fn(async () => response(200, { data: { maps: [] } }));
    await expect(queryTarkovDev("{maps{id}}", { ...opts, fetchImpl })).resolves.toEqual({
      maps: [],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries the 422 tarkov.dev returns when it is down, then gives up", async () => {
    // The real outage signature: HTTP 422 with {"errors":["GraphQL server unavailable..."]}.
    const fetchImpl = vi.fn(async () =>
      response(422, { errors: ["GraphQL server unavailable. Try again later."] }),
    );
    await expect(
      queryTarkovDev("{maps{id}}", { ...opts, fetchImpl, attempts: 3 }),
    ).rejects.toThrow(/GraphQL server unavailable/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("recovers if a retry succeeds", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(500, { errors: ["boom"] }))
      .mockResolvedValueOnce(response(200, { data: { ok: true } }));
    await expect(queryTarkovDev("{ok}", { ...opts, fetchImpl })).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a query the server rejects outright", async () => {
    // A malformed query is our bug; hammering the API will not fix it.
    const fetchImpl = vi.fn(async () => response(400, { errors: [{ message: "bad field" }] }));
    await expect(queryTarkovDev("{nope}", { ...opts, fetchImpl })).rejects.toThrow(/bad field/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a network failure", async () => {
    // What a CORS rejection or a dropped connection looks like from fetch.
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(response(200, { data: { ok: true } }));
    await expect(queryTarkovDev("{ok}", { ...opts, fetchImpl })).resolves.toEqual({ ok: true });
  });

  it("marks an outage as retryable so callers can fall back to cache", async () => {
    const fetchImpl = vi.fn(async () => response(422, { errors: ["down"] }));
    let error: TarkovDevError | undefined;
    try {
      await queryTarkovDev("{ok}", { ...opts, fetchImpl, attempts: 1 });
    } catch (thrown) {
      error = thrown as TarkovDevError;
    }
    expect(error).toBeInstanceOf(TarkovDevError);
    expect(error?.retryable).toBe(true);
    expect(error?.status).toBe(422);
  });

  it("gives up immediately when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    await expect(
      queryTarkovDev("{ok}", { ...opts, fetchImpl, signal: controller.signal }),
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
