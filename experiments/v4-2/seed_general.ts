// Seed the NON-COFFEE / GENERAL-LAYER reference result (CP-3's second artifact).
//
// WHY A REPLAY RATHER THAN A LIVE RUN. A live `POST /api/product-test` against this store
// came back `rate_limited` — the documented `safeFetch` fingerprint refusal, where a
// Cloudflare-fronted host rejects our pinned-IP HTTP/1.1 transport while a plain fetch to
// the same host succeeds seconds later. Replaying the committed raw HTTP capture through
// the REAL `runProductTest`, with only the transport swapped, is the same discipline
// `/demo` and `experiments/v2-9/replay.ts` use: $0, no network, deterministic, and it
// cannot drift from the engine because it IS the engine.
//
// WHY THIS STORE. It is drawn from the v3.7 general-sample audit, where all 488 pass rows
// were adjudicated individually. `vaerwatches.com` is one of the 142 hosts whose EVERY
// passing row came back `true_pass` with zero borderline, and it carries the widest kind
// coverage in that clean set. The gate below re-checks that from the audit file rather
// than trusting this comment.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { runProductTest } from "../../src/server/productTest.js";
import { __resetCaches } from "../../src/server/productTestCache.js";
import { newTestToken, storePublicTest } from "../../src/db/buyerTests.js";
import { ENGINE_VERSION } from "../../src/server/productTest.js";

// ⚠️ v4.5 — EXPLICIT DEFAULT-OFF. The semantic tier is pinned off in production's two
// public ROUTES (v4.4), not in the engine module, so a harness that imports the engine
// directly inherits whatever `PRODUCT_TEST_SEMANTIC` happens to be in the environment.
// On a developer machine with a model key that means real spend and, worse, a
// NON-DETERMINISTIC result: v4.4 measured the tier answering differently on 11% of claim
// rows across two identical runs. A harness whose output silently depends on whose
// machine ran it is not an instrument. Set it here rather than relying on the caller.
process.env.PRODUCT_TEST_SEMANTIC = process.env.PRODUCT_TEST_SEMANTIC ?? "0";


const HOST = process.env.SEED_HOST ?? "vaerwatches.com";
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repoRoot = path.resolve(here, "..", "..");

interface Recorded { status: number; contentType: string | null; body: string; finalUrl?: string }
interface Snap { host: string; url: string; capturedAt: string; responses: Record<string, Recorded> }

const snapPath = path.join(repoRoot, "experiments/v2-9/snaps", `${HOST}.json`);
if (!fs.existsSync(snapPath)) throw new Error(`INCOMPLETE: no snapshot for ${HOST}`);
const snap: Snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));

// GATE: refuse to publish a store the audit did not clear. Without this the reference
// artifact could quietly become one of the eighteen known false passes.
const verdictsPath = path.join(repoRoot, "experiments/v3-7/out/general_verdicts.json");
let auditedRows = 0, clean = true;
if (fs.existsSync(verdictsPath)) {
  const raw = JSON.parse(fs.readFileSync(verdictsPath, "utf8"));
  const list: Array<Record<string, unknown>> = Array.isArray(raw) ? raw : (raw.rows ?? raw.verdicts ?? []);
  const mine = list.filter((v) => String(v.host ?? "").replace(/^www\./, "") === HOST.replace(/^www\./, ""));
  auditedRows = mine.length;
  clean = mine.every((v) => String(v.verdict ?? v.adjudication ?? "") === "true_pass");
  if (!auditedRows) throw new Error(`INCOMPLETE: ${HOST} has no adjudicated rows in the v3.7 audit — cannot publish it as a reference`);
  if (!clean) throw new Error(`REFUSED: ${HOST} carries a non-true_pass adjudication; it must not be a published reference`);
} else {
  throw new Error(`INCOMPLETE: ${verdictsPath} not found — the adjudication gate could not run`);
}

const misses: string[] = [];
const replay = async (url: string): Promise<Recorded> => {
  const r = snap.responses[url];
  if (!r) { misses.push(url); throw new Error(`REPLAY MISS: ${url}`); }
  return r;
};

__resetCaches();
const result = await runProductTest(snap.url, { fetchUrl: replay, force: true, sleep: async () => {} });
if (!result.ok) throw new Error(`INCOMPLETE: replay produced ok=false (${result.errorKind ?? result.error})`);
if (misses.length) throw new Error(`INCOMPLETE: ${misses.length} replay misses — the capture is not sufficient`);

const token = newTestToken();
await storePublicTest(token, snap.url, snap.host, result, Date.now(), {
  kind: "general",
  engineVersion: ENGINE_VERSION,
  contractVersion: result.contractVersion ?? null,
  ranAt: Date.parse(snap.capturedAt),
});

console.log(JSON.stringify({
  completion: "VERIFIED_CLEAN",
  token, host: snap.host, productUrl: snap.url,
  auditedRows, allTruePass: clean, replayMisses: misses.length,
  counts: {
    evidenced: result.evidencedCount, noBlocking: result.noBlockingCount,
    notProven: result.notProvenCount, requiresAccess: result.requiresAccessCount, total: result.total,
  },
  rows: result.assertions.map((a) => `${a.label}=${a.status}`),
}, null, 2));
