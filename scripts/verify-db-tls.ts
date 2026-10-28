// Credential-free transport check; sends PostgreSQL SSLRequest, never a login.
import net from "node:net";
import tls from "node:tls";
import assert from "node:assert/strict";
import { pgSslConfig } from "../src/db/pg.js";

const host = "aws-1-us-east-1.pooler.supabase.com";
const strict = pgSslConfig(`postgres://unused@${host}:5432/postgres`, "");
assert.notEqual(strict, false);

function connect(options: tls.ConnectionOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port: 5432 });
    socket.setTimeout(10_000, () => socket.destroy(new Error("TLS check timed out")));
    socket.once("error", reject);
    socket.once("connect", () => {
      const request = Buffer.alloc(8);
      request.writeInt32BE(8, 0);
      request.writeInt32BE(80877103, 4);
      socket.write(request);
    });
    socket.once("data", (response) => {
      if (response.length !== 1 || response[0] !== 83) {
        socket.destroy();
        reject(new Error("Postgres did not accept TLS"));
        return;
      }
      const secure = tls.connect({ socket, servername: host, ...options });
      secure.once("error", reject);
      secure.once("secureConnect", () => {
        assert.equal(secure.authorized, true);
        secure.end();
        resolve();
      });
    });
  });
}

await connect(strict || {});
await assert.rejects(connect({ ...strict || {}, checkServerIdentity: (_name, cert) => tls.checkServerIdentity("wrong.invalid", cert) }), { code: "ERR_TLS_CERT_ALTNAME_INVALID" });
await assert.rejects(connect({ rejectUnauthorized: true }), /self.signed certificate|unable to verify|unable to get local issuer/i);
console.log(JSON.stringify({ status: "VERIFIED_CLEAN", host, official_ca_verified: true, wrong_hostname_rejected: true, untrusted_chain_rejected: true, credentials_sent: false }));
