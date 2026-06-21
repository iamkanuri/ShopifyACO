import http from "node:http";

// Minimal health endpoint for non-web process modes (worker/scheduler). They have no
// Express app, but railway.json sets a shared `/healthz` healthcheck for every service
// built from this repo — so without this they'd fail the check and restart-loop. No-op
// when PORT is unset (local CLI runs).
export function startHealthServer(role: string): void {
  const port = Number(process.env.PORT);
  if (!Number.isFinite(port) || port <= 0) return;
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith("/healthz")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, role }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.on("error", (e) => console.error(`[${role}] health server error:`, (e as Error).message));
  server.listen(port, "0.0.0.0", () => console.log(`[${role}] health server listening on :${port}`));
}
