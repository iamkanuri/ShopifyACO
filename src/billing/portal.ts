import { ENV } from "../server/env.js";

// Stripe Billing Portal session creation (Phase 11) — NO Stripe SDK, raw `fetch` against
// the REST API (same minimal-deps discipline as the webhook). The portal lets a merchant
// update their card, see invoices, and cancel — Stripe hosts it; we only mint a session
// URL and redirect. Requires STRIPE_SECRET_KEY + a known Stripe customer id.

export type PortalResult =
  | { ok: true; url: string }
  | { ok: false; code: "not_configured" | "no_customer" | "stripe_error"; error: string };

/** Create a billing-portal session for a Stripe customer. */
export async function createPortalSession(customerId: string | null, returnUrl: string): Promise<PortalResult> {
  if (!ENV.stripeSecretKey) {
    return { ok: false, code: "not_configured", error: "Billing portal is not configured (STRIPE_SECRET_KEY unset)." };
  }
  if (!customerId) {
    return { ok: false, code: "no_customer", error: "No billing account on file yet. Complete a purchase first." };
  }
  const body = new URLSearchParams({ customer: customerId, return_url: returnUrl });
  try {
    const res = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ENV.stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: { message?: string } };
    if (!res.ok || !data.url) {
      return { ok: false, code: "stripe_error", error: data.error?.message ?? `Stripe returned ${res.status}.` };
    }
    return { ok: true, url: data.url };
  } catch (err) {
    return { ok: false, code: "stripe_error", error: (err as Error).message };
  }
}
