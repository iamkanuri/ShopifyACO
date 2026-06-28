import { normalizeShopDomain } from "../shopify/domain.js";
import { audit, markUninstalled, recordInstallation, upsertShop } from "../db/shops.js";
import { deleteProduct, productGidFromId, syncOneProduct } from "../catalog/sync.js";
import { redactShop } from "../db/redact.js";
import { registerHandler } from "../queue/handlers.js";

// Topic dispatch for a Shopify webhook whose HMAC has ALREADY been verified. Pure of HTTP —
// called inline (queue disabled) and by the durable `shopify_webhook` job (queue enabled).
//
// CONTRACT: this THROWS on a processing failure so the caller can signal a retry (HTTP 5xx
// inline, queue retry+backoff+dead-letter async). Shopify re-delivers webhooks that weren't
// acked / failed, so a transient failure is retried rather than silently dropped. Permanent
// problems (an unparseable body, a shop/header mismatch) are logged and treated as done — a
// retry can't fix them and would just burn attempts.

interface ProcessOpts { jobId?: number }

export async function processWebhookTopic(topic: string, shop: string | null, raw: Buffer, opts: ProcessOpts = {}): Promise<void> {
  if (!shop) return; // no shop header → nothing tenant-scoped to do

  switch (topic) {
    case "app/uninstalled":
      await markUninstalled(shop);
      await recordInstallation(shop, "uninstall");
      await audit(shop, "webhook", "app_uninstalled", "shop");
      break;

    case "shop/update":
      await upsertShop(shop, {});
      await audit(shop, "webhook", "shop_update", "shop");
      break;

    case "products/create":
    case "products/update":
    case "products/delete": {
      await audit(shop, "webhook", topic.replace("/", "_"), "product");
      let id: string | number | undefined;
      try {
        id = (JSON.parse(raw.toString("utf8")) as { id?: string | number }).id;
      } catch {
        console.error(`[shopify] ${topic}: unparseable body — skipping (permanent)`);
        break; // a malformed body won't parse on retry either
      }
      if (id == null) break; // nothing to sync
      const gid = productGidFromId(id);
      // Let real sync errors PROPAGATE so the job retries (transient Shopify/DB issues) — the
      // old path swallowed these, losing a catalog delta on any hiccup.
      if (topic === "products/delete") await deleteProduct(shop, gid);
      else await syncOneProduct(shop, gid);
      break;
    }

    case "customers/data_request":
    case "customers/redact":
      // We store no Shopify customer PII (pixel data uses random session nonces + salted IP
      // hashes, never a customer id), so there's nothing to return or erase per-customer.
      await audit(shop, "webhook", topic.replace("/", "_"), "compliance");
      break;

    case "shop/redact": {
      // Defense-in-depth before a DESTRUCTIVE erase: HMAC authenticates the BODY, but routing
      // uses the X-Shopify-Shop-Domain HEADER — cross-check the body's shop so a mis-delivered
      // signed payload can't erase a different tenant. A mismatch is PERMANENT (don't retry).
      let bodyShop: string | null = null;
      try {
        bodyShop = normalizeShopDomain((JSON.parse(raw.toString("utf8")) as { shop_domain?: string }).shop_domain);
      } catch { /* unparseable body → fall through to header-only */ }
      if (bodyShop && bodyShop !== shop) {
        console.error(`[shopify] shop/redact body/header shop mismatch (${bodyShop} vs ${shop}) — refusing erase`);
        return;
      }
      // Erase ALL data we hold for this shop. exceptJobId preserves THIS running job's row so
      // the queue can still complete/retry it (without it, the job would delete itself and a
      // partial-failure retry would be lost). The surviving row is a no-PII redaction receipt.
      const summary = await redactShop(shop, { exceptJobId: opts.jobId });
      console.log(`[shopify] shop/redact erased ${shop}:`, JSON.stringify(summary));
      const failed = Object.keys(summary).filter((k) => k.endsWith(":error"));
      // Signal incompleteness so the delivery is retried until every table is clean (idempotent
      // — already-erased tables delete 0 rows on the next attempt).
      if (failed.length) throw new Error(`shop/redact incomplete (${failed.join(", ")}) — will retry`);
      break;
    }

    default:
      await audit(shop, "webhook", `unhandled:${topic}`, "webhook");
  }
}

/** Worker handler for the durable webhook inbox. Decodes the stored raw body and dispatches;
 *  throwing propagates to the queue's retry/backoff/dead-letter. */
export function registerWebhookJobs(): void {
  registerHandler("shopify_webhook", async (payload, ctx) => {
    const topic = String(payload.topic ?? "");
    const shop = payload.shop ? String(payload.shop) : null;
    const raw = Buffer.from(String(payload.rawBase64 ?? ""), "base64");
    await processWebhookTopic(topic, shop, raw, { jobId: ctx.jobId });
    return { topic, shop, processed: true };
  });
}
