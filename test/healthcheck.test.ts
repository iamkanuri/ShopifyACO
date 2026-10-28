import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEngineKeys } from "../src/server/healthcheck.js";

test("engine checks require successful provider responses and never expose diagnostics", async (t) => {
  for (const status of [200, 400, 401, 403, 404, 429, 500, 503]) {
    await t.test(`HTTP ${status}`, async (t) => {
      t.mock.method(globalThis, "fetch", async () => new Response("sensitive-provider-body", { status }));
      const rows = await checkEngineKeys({ openai: "fake", google: "fake", perplexity: "fake" });
      assert.equal(rows.length, 3);
      for (const row of rows) {
        assert.equal(row.configured, true);
        assert.equal(row.ok, status === 200);
        assert.equal(row.status, status);
      }
      assert.ok(!JSON.stringify(rows).includes("sensitive-provider-body"));
    });
  }
});

test("network failure stays incomplete and does not echo a credential-bearing error", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("request failed?key=secret-value"); });
  const rows = await checkEngineKeys({ google: "fake" });
  assert.equal(rows.find(row => row.engine === "google")?.ok, false);
  assert.ok(!JSON.stringify(rows).includes("secret-value"));
  assert.equal(rows.find(row => row.engine === "openai")?.configured, false);
});
