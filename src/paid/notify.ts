import { getProvider } from "../notify/provider.js";

// Loud, best-effort owner alert for paid-report failures. This is the backbone of the
// "no silent failure after payment" guarantee: it NEVER throws and NEVER depends on anything
// else succeeding (especially not the refund). It always writes a structured, greppable
// error line, then best-effort tries the notify provider on top.

export async function alertOwner(subject: string, body: string): Promise<void> {
  // Channel 1 — always fires, independent of everything: a structured console.error line.
  console.error(JSON.stringify({ level: "alert", scope: "paid_report", subject, body, at: new Date().toISOString() }));
  // Channel 2 — best-effort provider (email when configured, else logger). Never throws.
  try {
    const recipient = process.env.ADMIN_ALERT_EMAIL || process.env.CONTACT_EMAIL || null;
    await getProvider().send({ shop: "__ops__", recipient, subject, body });
  } catch (err) {
    console.error(`[paid_report] owner-alert provider failed (already logged above): ${(err as Error).message}`);
  }
}
