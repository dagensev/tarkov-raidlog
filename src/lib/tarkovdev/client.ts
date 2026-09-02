import { TARKOV_DATA_QUERY } from "./query";
import type { TarkovData } from "./types";

/**
 * Where game data comes from.
 *
 * tarkov.dev is called straight from the browser, which is what TarkovTracker does and
 * what keeps hosting free. If their CORS policy ever stops allowing this origin, set
 * NEXT_PUBLIC_TARKOV_ENDPOINT to a same-origin Worker route that proxies it -- no call
 * site changes.
 */
export const TARKOV_DEV_ENDPOINT =
  process.env.NEXT_PUBLIC_TARKOV_ENDPOINT ?? "https://api.tarkov.dev/graphql";

/** Thrown when the API answers but the answer is not usable. */
export class TarkovDevError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "TarkovDevError";
  }
}

export interface QueryOptions {
  endpoint?: string;
  signal?: AbortSignal;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Attempts, including the first. Retries use exponential backoff. */
  attempts?: number;
  /** Base backoff in ms; doubled each retry. */
  backoffMs?: number;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: unknown;
}

function describeErrors(errors: unknown): string {
  if (Array.isArray(errors)) {
    return errors
      .map((e) => (typeof e === "string" ? e : (e as { message?: string })?.message))
      .filter(Boolean)
      .join("; ");
  }
  return String(errors);
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Run a GraphQL query against tarkov.dev.
 *
 * The API is a free community service and does go down — it answers 422 with
 * `GraphQL server unavailable` when it does. Those, and 5xx/429, are treated as
 * retryable, and the caller is expected to fall back to cache when retries run out.
 */
export async function queryTarkovDev<T>(
  query: string,
  options: QueryOptions = {},
): Promise<T> {
  const {
    endpoint = TARKOV_DEV_ENDPOINT,
    signal,
    fetchImpl = fetch,
    attempts = 3,
    backoffMs = 500,
  } = options;

  let lastError: TarkovDevError | undefined;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(backoffMs * 2 ** (attempt - 1));

    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query }),
        signal,
      });
    } catch (cause) {
      if (signal?.aborted) throw cause;
      lastError = new TarkovDevError(`network error: ${(cause as Error).message}`, undefined, true);
      continue;
    }

    const retryable = response.status === 422 || response.status === 429 || response.status >= 500;

    let body: GraphQLResponse<T>;
    try {
      body = (await response.json()) as GraphQLResponse<T>;
    } catch {
      lastError = new TarkovDevError(
        `unreadable response (HTTP ${response.status})`,
        response.status,
        retryable,
      );
      if (!retryable) throw lastError;
      continue;
    }

    if (body.errors) {
      lastError = new TarkovDevError(describeErrors(body.errors), response.status, retryable);
      if (!retryable) throw lastError;
      continue;
    }

    if (!response.ok) {
      lastError = new TarkovDevError(`HTTP ${response.status}`, response.status, retryable);
      if (!retryable) throw lastError;
      continue;
    }

    if (!body.data) {
      lastError = new TarkovDevError("response had no data", response.status, true);
      continue;
    }

    return body.data;
  }

  throw lastError ?? new TarkovDevError("query failed");
}

/** Fetch the full dataset the app runs on. */
export function fetchTarkovData(options: QueryOptions = {}): Promise<TarkovData> {
  return queryTarkovDev<TarkovData>(TARKOV_DATA_QUERY, options);
}
