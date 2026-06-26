import { ENV } from "../server/env.js";

// Shopify client abstraction. A 'mock' implementation lets the entire OAuth +
// webhook + (later) catalog pipeline be built and tested with NO real credentials;
// 'live' talks to the current stable GraphQL Admin API + OAuth token endpoint.
// Switch via SHOPIFY_MODE. The legacy REST Admin API is intentionally not used.

export const MOCK_SECRET = "mock-shopify-shared-secret";

/** The HMAC secret used for SIGNING (cookies, mock callbacks): the primary secret. */
export function effectiveSecret(): string | undefined {
  if (ENV.shopify.apiSecret) return ENV.shopify.apiSecret;
  return ENV.shopify.mode === "mock" ? MOCK_SECRET : undefined;
}

/** All secrets to VERIFY incoming HMACs against: the primary + an optional fallback
 *  (so a Shopify client-secret rotation, where either the old or new secret may sign a
 *  request during the grace period, never causes "Invalid HMAC"). Mock mode falls back
 *  to the fixed mock secret. Order doesn't matter — verification tries each. */
export function effectiveSecrets(): string[] {
  const list = [ENV.shopify.apiSecret, ENV.shopify.apiSecretFallback].filter((s): s is string => Boolean(s));
  if (list.length) return list;
  return ENV.shopify.mode === "mock" ? [MOCK_SECRET] : [];
}

export interface TokenExchange {
  accessToken: string;
  scope: string;
  /** Expiring offline tokens come with a rotating refresh token (~90d). Absent for mock/legacy. */
  refreshToken?: string;
  /** Seconds until the access token expires (~3600). Absent => treat as non-expiring/legacy. */
  expiresIn?: number;
  /** Seconds until the refresh token expires (~7776000). */
  refreshTokenExpiresIn?: number;
}

export interface ShopifyClient {
  mode: "live" | "mock";
  exchangeCode(shop: string, code: string): Promise<TokenExchange>;
  /** Token exchange (embedded install): swap a VERIFIED App Bridge session token for an
   *  EXPIRING offline access token for the already-granted scopes — no OAuth redirect. Used by
   *  the embedded install handshake (Shopify managed install + token exchange). */
  exchangeSessionToken(shop: string, sessionToken: string): Promise<TokenExchange>;
  /** Refresh an expiring offline access token using its (rotating) refresh token. Shopify
   *  invalidates the old refresh token and returns a NEW access + refresh token pair. Used by
   *  background paths that have no session token to re-exchange (webhooks, jobs). */
  refreshAccessToken(shop: string, refreshToken: string): Promise<TokenExchange>;
  /** Register the app + compliance webhooks. Returns the topics registered. */
  registerWebhooks(shop: string, accessToken: string): Promise<string[]>;
  /** Read the scopes the shop ACTUALLY granted, from the live installation. This is the
   *  authoritative grant — the `scope` returned by code/token exchange can under-report,
   *  which would wrongly block scope-gated writes (Fix Studio). Returns the scope handles. */
  fetchGrantedScopes(shop: string, accessToken: string): Promise<string[]>;
  /** Create (or update, when `existingId` is known) the app-owned Web Pixel with the
   *  given settings JSON. Idempotent at the caller via the stored id. Needs the
   *  write_pixels + read_customer_events scopes. Returns the WebPixel gid. */
  activateWebPixel(shop: string, accessToken: string, settings: string, existingId?: string): Promise<{ id: string }>;
}

const MANDATORY_TOPICS = [
  "APP_UNINSTALLED",
  "PRODUCTS_CREATE",
  "PRODUCTS_UPDATE",
  "PRODUCTS_DELETE",
  "SHOP_UPDATE",
  "CUSTOMERS_DATA_REQUEST",
  "CUSTOMERS_REDACT",
  "SHOP_REDACT",
];

// A deterministic mock offline token bundle (expiring), so the storage + refresh lifecycle
// is exercised end-to-end at $0. expiresIn far in the future => fresh installs never look
// stale; tests that want the refresh path set access_token_expires_at into the past directly.
const MOCK_EXPIRES_IN = 3600;
const MOCK_REFRESH_EXPIRES_IN = 7_776_000;

class MockClient implements ShopifyClient {
  mode = "mock" as const;
  async exchangeCode(shop: string, code: string): Promise<TokenExchange> {
    return { accessToken: `mock_offline_token::${shop}::${code.slice(0, 8)}`, scope: ENV.shopify.scopes.join(","), refreshToken: `mock_refresh::${shop}`, expiresIn: MOCK_EXPIRES_IN, refreshTokenExpiresIn: MOCK_REFRESH_EXPIRES_IN };
  }
  async exchangeSessionToken(shop: string): Promise<TokenExchange> {
    return { accessToken: `mock_offline_token::${shop}::texch`, scope: ENV.shopify.scopes.join(","), refreshToken: `mock_refresh::${shop}`, expiresIn: MOCK_EXPIRES_IN, refreshTokenExpiresIn: MOCK_REFRESH_EXPIRES_IN };
  }
  async refreshAccessToken(shop: string): Promise<TokenExchange> {
    return { accessToken: `mock_offline_token::${shop}::refreshed`, scope: ENV.shopify.scopes.join(","), refreshToken: `mock_refresh::${shop}::r`, expiresIn: MOCK_EXPIRES_IN, refreshTokenExpiresIn: MOCK_REFRESH_EXPIRES_IN };
  }
  async registerWebhooks(): Promise<string[]> {
    return MANDATORY_TOPICS; // pretend success — exercised end-to-end without Shopify
  }
  async fetchGrantedScopes(): Promise<string[]> {
    // A mock store "granted" exactly the configured scopes — so the gate is exercised
    // honestly (e.g. write_products present when SHOPIFY_SCOPES includes it).
    return [...ENV.shopify.scopes];
  }
  async activateWebPixel(shop: string, _accessToken: string, _settings: string, existingId?: string): Promise<{ id: string }> {
    return { id: existingId ?? `gid://shopify/WebPixel/mock-${shop}` };
  }
}

// Shopify's offline token responses. `expiring=1` adds expires_in + a rotating refresh_token.
interface TokenResponse {
  access_token?: string;
  scope?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}
function parseTokenResponse(json: TokenResponse): TokenExchange {
  return {
    accessToken: json.access_token!,
    scope: json.scope ?? ENV.shopify.scopes.join(","),
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
    refreshTokenExpiresIn: json.refresh_token_expires_in,
  };
}

class LiveClient implements ShopifyClient {
  mode = "live" as const;
  // The OAuth token endpoint is form-encoded (per Shopify docs); `expiring=1` is only honored
  // as a form param, so all three token calls below post application/x-www-form-urlencoded.
  async exchangeCode(shop: string, code: string): Promise<TokenExchange> {
    const body = new URLSearchParams({
      client_id: ENV.shopify.apiKey ?? "",
      client_secret: ENV.shopify.apiSecret ?? "",
      code,
      expiring: "1", // request an EXPIRING offline token (Shopify rejects non-expiring ones)
    });
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`token exchange failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as TokenResponse;
    if (!json.access_token) throw new Error("token exchange returned no access_token");
    return parseTokenResponse(json);
  }
  async exchangeSessionToken(shop: string, sessionToken: string): Promise<TokenExchange> {
    // OAuth 2.0 Token Exchange (RFC 8693) — Shopify's embedded-app install path. The
    // subject_token is the App Bridge session token (already signature-verified by us before
    // this call); we request an EXPIRING OFFLINE access token (expiring=1) so background sync
    // works and Shopify accepts it on the Admin API.
    const body = new URLSearchParams({
      client_id: ENV.shopify.apiKey ?? "",
      client_secret: ENV.shopify.apiSecret ?? "",
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: sessionToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
      requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
      expiring: "1",
    });
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`session token exchange failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as TokenResponse;
    if (!json.access_token) throw new Error("session token exchange returned no access_token");
    return parseTokenResponse(json);
  }
  async refreshAccessToken(shop: string, refreshToken: string): Promise<TokenExchange> {
    const body = new URLSearchParams({
      client_id: ENV.shopify.apiKey ?? "",
      client_secret: ENV.shopify.apiSecret ?? "",
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`token refresh failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as TokenResponse;
    if (!json.access_token) throw new Error("token refresh returned no access_token");
    return parseTokenResponse(json);
  }
  async fetchGrantedScopes(shop: string, accessToken: string): Promise<string[]> {
    // The live grant: what the merchant actually approved for THIS installation. Used to
    // record shops.scopes accurately (the exchange `scope` can under-report).
    const query = `{ currentAppInstallation { accessScopes { handle } } }`;
    const res = await fetch(`https://${shop}/admin/api/${ENV.shopify.apiVersion}/graphql.json`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Shopify-Access-Token": accessToken },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`accessScopes query failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as {
      data?: { currentAppInstallation?: { accessScopes?: Array<{ handle?: string }> } };
      errors?: Array<{ message?: string }>;
    };
    if (json.errors?.length) throw new Error(`accessScopes query error: ${json.errors[0]?.message ?? "unknown"}`);
    return (json.data?.currentAppInstallation?.accessScopes ?? [])
      .map((s) => s.handle?.trim())
      .filter((h): h is string => Boolean(h));
  }
  async registerWebhooks(shop: string, accessToken: string): Promise<string[]> {
    const endpoint = `${ENV.shopify.appUrl}/api/shopify/webhooks`;
    const registered: string[] = [];
    // callbackUrl is passed as a typed GraphQL variable (not string-interpolated). The
    // topic stays inline because it's a GraphQL enum from a fixed allowlist, not input.
    const query = `mutation reg($url: URL!) { webhookSubscriptionCreate(topic: TOPIC_PLACEHOLDER,
      webhookSubscription: { callbackUrl: $url, format: JSON }) {
      webhookSubscription { id } userErrors { message } } }`;
    for (const topic of MANDATORY_TOPICS) {
      const res = await fetch(`https://${shop}/admin/api/${ENV.shopify.apiVersion}/graphql.json`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Shopify-Access-Token": accessToken },
        body: JSON.stringify({ query: query.replace("TOPIC_PLACEHOLDER", topic), variables: { url: endpoint } }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) registered.push(topic);
      else console.error(`[shopify] webhook register ${topic} failed: HTTP ${res.status}`);
    }
    return registered;
  }
  async activateWebPixel(shop: string, accessToken: string, settings: string, existingId?: string): Promise<{ id: string }> {
    // settings is a JSON string matching the extension's settings schema.
    const isUpdate = Boolean(existingId);
    const op = isUpdate ? "webPixelUpdate" : "webPixelCreate";
    const query = isUpdate
      ? `mutation a($id: ID!, $wp: WebPixelInput!){ webPixelUpdate(id: $id, webPixel: $wp){ webPixel { id } userErrors { field message code } } }`
      : `mutation a($wp: WebPixelInput!){ webPixelCreate(webPixel: $wp){ webPixel { id } userErrors { field message code } } }`;
    const variables = isUpdate ? { id: existingId, wp: { settings } } : { wp: { settings } };
    const res = await fetch(`https://${shop}/admin/api/${ENV.shopify.apiVersion}/graphql.json`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Shopify-Access-Token": accessToken },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`${op} failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { data?: Record<string, { webPixel?: { id?: string }; userErrors?: Array<{ message?: string }> }> };
    const payload = json.data?.[op];
    const errs = payload?.userErrors ?? [];
    if (errs.length) throw new Error(`${op} userErrors: ${errs.map((e) => e.message).join("; ")}`);
    const id = payload?.webPixel?.id;
    if (!id) throw new Error(`${op} returned no web pixel id`);
    return { id };
  }
}

export function getShopifyClient(): ShopifyClient {
  return ENV.shopify.mode === "mock" ? new MockClient() : new LiveClient();
}

export { MANDATORY_TOPICS };
