// On-demand engine-key health check for the admin cockpit. Pings each provider's
// cheapest auth-verifying endpoint so a dead/rotated key surfaces immediately
// instead of silently dropping an engine from every scan (the failure mode that
// hid a stale OpenAI key in prod). Never throws — returns a status per engine.

export interface KeyStatus {
  engine: string;
  label: string;
  configured: boolean;
  ok?: boolean;
  status?: number;
  detail?: string;
}

interface Keys {
  openai?: string;
  google?: string;
  perplexity?: string;
}

const TIMEOUT_MS = 10_000;

async function ping(req: () => Promise<Response>): Promise<{ ok: boolean; status?: number; detail?: string }> {
  try {
    const res = await req();
    if (res.ok) return { ok: true, status: res.status };
    // 401/403 = bad key. Other 4xx (e.g. a validation 400) still proves the key
    // authenticated, so treat only auth failures as "invalid".
    const status = res.status;
    const ok = status !== 401 && status !== 403;
    let detail: string | undefined;
    if (!ok) {
      const body = await res.text().catch(() => "");
      detail = `HTTP ${status}${body ? `: ${body.slice(0, 140)}` : ""}`;
    }
    return { ok, status, detail };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

function withTimeout(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

export async function checkEngineKeys(keys: Keys): Promise<KeyStatus[]> {
  const checks: Array<Promise<KeyStatus>> = [];

  // OpenAI — free list endpoint.
  checks.push(
    (async (): Promise<KeyStatus> => {
      const base = { engine: "openai", label: "ChatGPT (OpenAI)" };
      if (!keys.openai) return { ...base, configured: false };
      const r = await ping(() =>
        withTimeout("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${keys.openai}` } }),
      );
      return { ...base, configured: true, ...r };
    })(),
  );

  // Google / Gemini — free list endpoint (key as query param).
  checks.push(
    (async (): Promise<KeyStatus> => {
      const base = { engine: "google", label: "Gemini (Google)" };
      if (!keys.google) return { ...base, configured: false };
      const r = await ping(() =>
        withTimeout(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(keys.google!)}`, {}),
      );
      return { ...base, configured: true, ...r };
    })(),
  );

  // Perplexity — no free list endpoint, so a 1-token completion (~$0.0001). A 401
  // means a bad key; a 400 validation error still proves the key authenticated.
  checks.push(
    (async (): Promise<KeyStatus> => {
      const base = { engine: "perplexity", label: "Perplexity" };
      if (!keys.perplexity) return { ...base, configured: false };
      const r = await ping(() =>
        withTimeout("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: { authorization: `Bearer ${keys.perplexity}`, "content-type": "application/json" },
          body: JSON.stringify({ model: "sonar", messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
        }),
      );
      return { ...base, configured: true, ...r };
    })(),
  );

  return Promise.all(checks);
}
