import { existsSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { Express } from "express";
import { flagEnabled } from "./preflight.js";
import { TOKEN_RE } from "./hosted-case.js";

// ===========================================================================
// STAGE 6.3 — hosted-case route (the funnel seam, in this repo). GET /c/:token
// serves ONE rendered diagnostic case from HOSTED_CASES_DIR, noindex/nofollow,
// no index page, no cross-links. Registered ONLY when the experiment flag is on
// (checked again per request) and ONLY when HOSTED_CASES_DIR is set — so it is
// prepared behind the existing deploy flow but inert until a human opts in.
// The token is strictly validated ([a-z2-7]{12}), so it can never traverse.
// ===========================================================================

export function registerHostedCaseRoutes(app: Express): void {
  app.get("/c/:token", (req, res) => {
    if (!flagEnabled(process.env)) {
      res.status(404).end();
      return;
    }
    const dir = process.env.HOSTED_CASES_DIR;
    const token = String(req.params.token ?? "");
    if (!dir || !TOKEN_RE.test(token)) {
      res.status(404).end();
      return;
    }
    // token is [a-z2-7]{12} (no separators/dots) → safe as a path segment; the
    // resolve+containment check is belt-and-suspenders against a misconfigured dir.
    const root = resolve(join(dir, "c"));
    const file = resolve(join(root, token, "index.html"));
    if (!(file === join(root, token, "index.html") || file.startsWith(root + sep)) || !existsSync(file)) {
      res.status(404).end();
      return;
    }
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Cache-Control", "private, no-store");
    res.type("html").send(readFileSync(file, "utf8"));
  });
}
