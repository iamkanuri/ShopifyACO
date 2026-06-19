// Tiny shared HTTP helper for adapters. Raw fetch — no SDKs.

export class HttpError extends Error {
  status: number;
  retryAfterMs?: number;
  body: string;
  constructor(status: number, body: string, retryAfterMs?: number) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
    this.retryAfterMs = retryAfterMs;
  }
  /** 429 and 5xx are worth retrying; other 4xx are not. */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

export interface PostOpts {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal?: AbortSignal;
  /** Per-call hard timeout. A hung request fails fast (retryable) instead of
   *  pinning a worker until the whole-scan budget aborts. */
  timeoutMs?: number;
}

// Grounded web-search calls can legitimately take 20–40s; give them headroom but
// never let a single call hang. The whole-scan wall-clock budget caps total time.
const DEFAULT_TIMEOUT_MS = 45_000;

/** POST JSON, parse JSON response, throw HttpError on non-2xx. */
export async function postJson<T = unknown>(opts: PostOpts): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  // Combine the caller's abort (cost cap / scan budget) with the per-call timeout.
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal;

  let res: Response;
  try {
    res = await fetch(opts.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...opts.headers },
      body: JSON.stringify(opts.body),
      signal,
    });
  } catch (err) {
    // A per-call timeout (vs. a deliberate caller-abort) gets a clear, retryable message.
    if (timeoutSignal.aborted && !opts.signal?.aborted) {
      throw new HttpError(599, `request timed out after ${timeoutMs}ms`);
    }
    // Network/abort errors — treat as retryable 599.
    throw new HttpError(599, (err as Error).message);
  }

  const text = await res.text();
  if (!res.ok) {
    const retryAfter = res.headers.get("retry-after");
    const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : undefined;
    throw new HttpError(res.status, text, Number.isNaN(retryAfterMs) ? undefined : retryAfterMs);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(res.status, `Non-JSON response: ${text.slice(0, 300)}`);
  }
}

/** A neutral system instruction: behave like a shopping assistant, free-form answer. */
export const SHOPPING_SYSTEM_PROMPT =
  "You are a helpful shopping assistant. Answer the user's question naturally and " +
  "concretely. When recommending products or brands, name specific ones.";
