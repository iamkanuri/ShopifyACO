// v4.5 A1 — WAS THE `$75.00` FALSE WHEN WE RENDERED IT?
//
// The four stored gardenerskit.com results were minted 2026-07-25/26 and render
// "Lowest readable price is $75.00." The store declares CAD today. Two readings:
//   (a) it was CAD then too  -> the sentence was false when published (a US-dollar cap
//       compared against a Canadian-dollar number), and the v3.8 refusal exists for it;
//   (b) it was USD then and switched  -> the sentence was true when published.
// These are distinguishable WITHOUT the Wayback Machine, because Shopify RE-PRICES on a
// currency switch: a store moving USD->CAD would not land on the identical numeral 75.00.
// So an unchanged 75.00 under a CAD declaration is evidence for (a).
//
// It also prints what the engine answers on TODAY's bytes, which is the thing the
// remediation notice will offer: unlike the v4.4 tier case, a price defect IS
// correctable by re-running, and this shows what the re-run says.
import { extractPage } from "../../src/crawler/extract.js";
import { shopifyActiveCurrency } from "../../src/server/productTest.js";

const URL_ = "https://gardenerskit.com/products/niwaki-hori-hori-pro";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

const html = await (await fetch(URL_, { headers: { "user-agent": UA, accept: "text/html" } })).text();
const ld = extractPage(html)?.product;
console.log(JSON.stringify({
  jsonld_price: ld?.offer?.price ?? null,
  jsonld_currency: (ld?.offer as { currency?: string } | null | undefined)?.currency ?? null,
  shopify_active_currency: shopifyActiveCurrency(html),
  stored_rendered: "Lowest readable price is $75.00.",
}, null, 2));

// The `.json` tier the engine prefers for variant prices, read the same way.
const j = await (await fetch(URL_ + ".json", { headers: { "user-agent": UA, accept: "application/json" } })).text();
try {
  const p = JSON.parse(j) as { product?: { variants?: { price?: string; title?: string }[] } };
  console.log(JSON.stringify({ json_tier_variant_prices: p.product?.variants?.map((v) => v.price) ?? null }, null, 2));
} catch { console.log(JSON.stringify({ json_tier_variant_prices: "unparseable" })); }
