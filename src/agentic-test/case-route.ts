import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Express } from "express";
import { flagEnabled } from "./preflight.js";
import { buildClaims, renderCase } from "./case-render.js";

// ===========================================================================
// Internal case route (Stage 4, spec 4.6). Dev/admin only: registered ONLY
// when AGENTIC_INSTRUMENT_TEST_ENABLED=true (checked again per request).
// Locally it may hydrate the real competitor name from the GITIGNORED meta
// file; the committed static export stays anonymized.
// ===========================================================================

export function registerAgenticCaseRoute(app: Express): void {
  app.get("/admin/agentic-case", (_req, res) => {
    if (!flagEnabled(process.env)) {
      res.status(404).end();
      return;
    }
    try {
      const claims = buildClaims();
      const metaPath = join(process.cwd(), "experiments", "agentic-stage3", "probes", "competitors-meta.json");
      const realName = existsSync(metaPath)
        ? (JSON.parse(readFileSync(metaPath, "utf8")) as { mapping: Array<{ name: string }> }).mapping[0]?.name
        : undefined;
      res
        .type("html")
        .send(
          `<!doctype html><html><head><meta charset="utf-8"><title>Agentic Commerce Case (internal)</title></head><body>` +
            renderCase(claims, realName) +
            `</body></html>`,
        );
    } catch (err) {
      res.status(500).type("text").send(`case render failed: ${(err as Error).message}`);
    }
  });
}
