// Seed the two REFERENCE results CP-3 asks for, as real stored rows.
//
//  A) Coffee / STANDARD layer, with peer lines — built from the committed frozen capture
//     of klatchcoffee.com by replaying the real engine (`runDemo`), so it costs $0, touches
//     no network, and is the same result /demo publishes. Every passing row of this product
//     was adjudicated `true_pass` in the v3.2 coffee audit.
//  B) Non-coffee / GENERAL layer, no invented benchmark — seeded by the caller through
//     `POST /api/product-test`, which now persists on its own.
//
// This does NOT fabricate a verdict. It takes the engine's real output and writes it where
// the permanent URL can read it.
import "dotenv/config";
import { runDemo } from "../../src/server/buyerTestDemo.js";
import { newTestToken, storePublicTest } from "../../src/db/buyerTests.js";
import { peerRatesFor } from "../../src/server/publicStandard.js";
import { findStandard } from "../../src/server/standardsSite.js";
import { ENGINE_VERSION } from "../../src/server/productTest.js";

const d = await runDemo();

const askedIds = d.rows.map((r) => r.entryId).filter((x): x is string => Boolean(x));
if (!askedIds.length) throw new Error("INCOMPLETE: the demo produced no traceable entry ids");

const published = findStandard(d.standard.slug, String(d.standard.doc.version));
if (!published) throw new Error(`INCOMPLETE: ${d.standard.slug} v${d.standard.doc.version} is not published`);

const stdUrl = `/standards/${d.standard.slug}/${d.standard.publicVersion}`;
const entryUrls: Record<string, string> = {};
for (const id of askedIds) entryUrls[id] = `${stdUrl}/${encodeURIComponent(id)}`;

// The join key: DemoRow is the only place that holds BOTH the entry id and the label
// the engine stamped on the assertion.
const labelById = new Map(d.rows.filter((r) => r.entryId).map((r) => [r.entryId!, r.label]));
const peers = peerRatesFor(published, askedIds, labelById);
const joinable = peers.filter((x) => x.requirementLabel && d.raw.assertions.some((a) => a.label === x.requirementLabel));
if (joinable.length !== peers.length) throw new Error(`INCOMPLETE: only ${joinable.length}/${peers.length} peer records join to a row — the one-pager would show a partial benchmark`);
if (!peers.length) throw new Error("INCOMPLETE: no peer rates resolved — the one-pager would show no benchmark");

// The same shape `runStandardTest` returns, so the stored row is indistinguishable from
// one produced by the live route. Anything else would make this a special case the
// renderer has to know about.
const blob = {
  ok: true,
  productUrl: d.productUrl,
  standard: {
    id: d.standard.doc.standard_id, version: String(d.standard.doc.version),
    hash: d.standardHash, slug: d.standard.slug, url: stdUrl, title: d.standard.doc.title,
  },
  entryUrls,
  peers,
  result: d.raw,
  ranAt: d.capturedAt,
};

const token = newTestToken();
await storePublicTest(token, d.productUrl, d.host, blob, Date.now(), {
  kind: "standard",
  engineVersion: ENGINE_VERSION,
  standardSlug: d.standard.slug,
  standardVersion: d.standard.publicVersion,
  standardHash: d.standardHash,
  contractVersion: d.contractVersion,
  ranAt: Date.parse(d.capturedAt),
});

console.log(JSON.stringify({
  completion: "VERIFIED_CLEAN",
  token,
  host: d.host,
  productUrl: d.productUrl,
  standard: `${d.standard.doc.standard_id} v${d.standard.doc.version}`,
  hash: d.standardHash.slice(0, 16),
  rows: d.rows.length,
  askedIds: askedIds.length,
  peers: peers.length,
  counts: d.counts,
}, null, 2));
