import { ENV } from "../server/env.js";

// Shopify client abstraction. A 'mock' implementation lets the entire OAuth +
// webhook + (later) catalog pipeline be built and tested with NO real credentials;
// 'live' talks to the current stable GraphQL Admin API + OAuth token endpoint.
// Switch via SHOPIFY_MODE. The legacy REST Admin API is intentionally not used.

export const MOCK_SECRET = "mock-shopify-shared-secret";

/** The HMAC secret in effect (mock mode uses a fixed secret so signatures verify). */
export function effectiveSecret(): string | undefined {
  if (ENV.shopify.apiSecret) return ENV.shopify.apiSecret;
  return ENV.shopify.mode === "mock" ? MOCK_SECRET : undefined;
}

export interface TokenExchange {
  accessToken: string;
  scope: string;
}

export interface ShopifyClient {
  mode: "live" | "mock";
  exchangeCode(shop: string, code: string): Promise<TokenExchange>;
  /** Register the app + compliance webhooks. Returns the topics registered. */
  registerWebhooks(shop: string, accessToken: string): Promise<string[]>;
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

class MockClient implements ShopifyClient {
  mode = "mock" as const;
  async exchangeCode(shop: string, code: string): Promise<TokenExchange> {
    return { accessToken: `mock_offline_token::${shop}::${code.slice(0, 8)}`, scope: ENV.shopify.scopes.join(",") };
  }
  async registerWebhooks(): Promise<string[]> {
    return MANDATORY_TOPICS; // pretend success — exercised end-to-end without Shopify
  }
}

class LiveClient implements ShopifyClient {
  mode = "live" as const;
  async exchangeCode(shop: string, code: string): Promise<TokenExchange> {
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ client_id: ENV.shopify.apiKey, client_secret: ENV.shopify.apiSecret, code }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`token exchange failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { access_token?: string; scope?: string };
    if (!json.access_token) throw new Error("token exchange returned no access_token");
    return { accessToken: json.access_token, scope: json.scope ?? ENV.shopify.scopes.join(",") };
  }
  async registerWebhooks(shop: string, accessToken: string): Promise<string[]> {
    const endpoint = `${ENV.shopify.appUrl}/api/shopify/webhooks`;
    const registered: string[] = [];
    for (const topic of MANDATORY_TOPICS) {
      const query = `mutation { webhookSubscriptionCreate(topic: ${topic},
        webhookSubscription: { callbackUrl: "${endpoint}", format: JSON }) {
        webhookSubscription { id } userErrors { message } } }`;
      const res = await fetch(`https://${shop}/admin/api/${ENV.shopify.apiVersion}/graphql.json`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Shopify-Access-Token": accessToken },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) registered.push(topic);
      else console.error(`[shopify] webhook register ${topic} failed: HTTP ${res.status}`);
    }
    return registered;
  }
}

export function getShopifyClient(): ShopifyClient {
  return ENV.shopify.mode === "mock" ? new MockClient() : new LiveClient();
}

export { MANDATORY_TOPICS };
