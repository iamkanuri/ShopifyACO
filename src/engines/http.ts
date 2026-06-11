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
}

/** POST JSON, parse JSON response, throw HttpError on non-2xx. */
export async function postJson<T = unknown>(opts: PostOpts): Promise<T> {
  let res: Response;
  try {
    res = await fetch(opts.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...opts.headers },
      body: JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (err) {
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
