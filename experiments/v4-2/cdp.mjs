// ===========================================================================
// A MINIMAL, ZERO-DEPENDENCY CHROME DEVTOOLS PROTOCOL CLIENT.
//
// WHY NOT PUPPETEER. This repo's rule is "minimal dependencies, raw fetch" and the
// last thing a session should do here is `npm install` — a prior session ran one and
// emptied node_modules mid-run. Node 22 ships a global `WebSocket` and Windows ships
// Chromium (Edge and/or Chrome), so the whole capability is already on the machine.
//
// WHAT IT IS FOR. Two things this session cannot do any other way:
//   1. CP-2 — prove by RENDERING that a collapsed <details> prints its content.
//      `Emulation.setEmulatedMedia({media:'print'})` puts the real engine into print
//      media, so `innerText` afterwards is layout-derived, not a CSS read.
//   2. CP-3 — produce the reference PDFs with `Page.printToPDF`.
//
// ⚠️ printToPDF is returned AS A STREAM, never as one base64 message. A multi-megabyte
// single WebSocket frame is exactly the shape that fails intermittently and silently
// (a truncated PDF still opens in some readers), which is the flattering-direction
// failure this project keeps recording.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

export function findBrowser() {
  for (const p of CANDIDATES) if (existsSync(p)) return p;
  throw new Error("INCOMPLETE: no Chromium found. Looked in: " + CANDIDATES.join(" | "));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Browser {
  constructor(proc, wsUrl, profileDir) {
    this.proc = proc;
    this.wsUrl = wsUrl;
    this.profileDir = profileDir;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
  }

  static async launch({ timeoutMs = 30_000 } = {}) {
    const exe = findBrowser();
    const profileDir = mkdtempSync(join(tmpdir(), "v42-cdp-"));
    const proc = spawn(exe, [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      // Deterministic paint: no throttling of a backgrounded headless tab.
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      `--user-data-dir=${profileDir}`,
      "--remote-debugging-port=0",
      "about:blank",
    ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += String(d); });

    // Chrome writes the chosen port to DevToolsActivePort once the endpoint is up.
    const portFile = join(profileDir, "DevToolsActivePort");
    const deadline = Date.now() + timeoutMs;
    let port = null, wsPath = null;
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) {
        throw new Error(`INCOMPLETE: browser exited ${proc.exitCode} before listening.\n${stderr.slice(0, 800)}`);
      }
      if (existsSync(portFile)) {
        // ⚠️ EBUSY, not "not ready". On Windows the browser holds the handle while it
        // writes, so a bare readFileSync throws on a file that exists and is about to
        // be perfectly readable. Swallowing only this one error keeps a genuine failure
        // loud — the loop still ends at the deadline with its own INCOMPLETE.
        let txt = null;
        try { txt = readFileSync(portFile, "utf8").split("\n"); }
        catch (e) { if (e.code !== "EBUSY" && e.code !== "EPERM") throw e; }
        if (txt && txt.length >= 2 && txt[0].trim()) { port = txt[0].trim(); wsPath = txt[1].trim(); break; }
      }
      await sleep(60);
    }
    if (!port) throw new Error(`INCOMPLETE: browser never wrote DevToolsActivePort.\n${stderr.slice(0, 800)}`);

    const b = new Browser(proc, `ws://127.0.0.1:${port}${wsPath}`, profileDir);
    await b.connect();
    return b;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", (e) => reject(new Error(`INCOMPLETE: CDP socket error: ${e.message ?? e.type}`)));
      ws.addEventListener("message", (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.id != null && this.pending.has(msg.id)) {
          const { resolve: rs, reject: rj } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rj(new Error(`CDP ${msg.error.code}: ${msg.error.message}`));
          else rs(msg.result);
        } else if (msg.method) {
          for (const l of this.listeners) l(msg);
        }
      });
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`INCOMPLETE: CDP timeout on ${method}`));
        }
      }, 120_000);
    });
  }

  /** Wait for one CDP event, optionally scoped to a session. */
  once(method, sessionId, timeoutMs = 60_000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.listeners = this.listeners.filter((x) => x !== fn);
        reject(new Error(`INCOMPLETE: timed out waiting for ${method}`));
      }, timeoutMs);
      const fn = (msg) => {
        if (msg.method !== method) return;
        if (sessionId && msg.sessionId !== sessionId) return;
        clearTimeout(t);
        this.listeners = this.listeners.filter((x) => x !== fn);
        resolve(msg.params);
      };
      this.listeners.push(fn);
    });
  }

  async newPage() {
    const { targetId } = await this.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    await this.send("Page.enable", {}, sessionId);
    await this.send("Runtime.enable", {}, sessionId);
    return new Page(this, sessionId, targetId);
  }

  async close() {
    try { this.ws?.close(); } catch {}
    try { this.proc.kill(); } catch {}
    await sleep(250);
    try { rmSync(this.profileDir, { recursive: true, force: true }); } catch {}
  }
}

export class Page {
  constructor(browser, sessionId, targetId) {
    this.b = browser;
    this.sessionId = sessionId;
    this.targetId = targetId;
  }

  send(method, params) { return this.b.send(method, params, this.sessionId); }

  async goto(url, { waitMs = 400 } = {}) {
    const loaded = this.b.once("Page.loadEventFired", this.sessionId);
    const nav = await this.send("Page.navigate", { url });
    if (nav.errorText) throw new Error(`INCOMPLETE: navigation to ${url} failed: ${nav.errorText}`);
    await loaded;
    // Webfonts are loaded by <link>; a print measurement taken before they settle
    // measures a fallback face. Same class as v3.3's OG-card font defect.
    await this.eval(`document.fonts ? document.fonts.ready.then(() => true) : true`, true);
    await sleep(waitMs);
  }

  /** Load an HTML string without a server — for the CP-2 control fixtures. */
  async setContent(html) {
    const loaded = this.b.once("Page.loadEventFired", this.sessionId);
    await this.send("Page.navigate", { url: "about:blank" });
    await loaded.catch(() => {});
    await this.send("Page.setDocumentContent", {
      frameId: (await this.send("Page.getFrameTree")).frameTree.frame.id,
      html,
    });
    await sleep(250);
  }

  async eval(expression, awaitPromise = false) {
    const r = await this.send("Runtime.evaluate", {
      expression, returnByValue: true, awaitPromise,
    });
    if (r.exceptionDetails) {
      throw new Error(`INCOMPLETE: page threw: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ""}`);
    }
    return r.result.value;
  }

  /** Put the real engine into print media. Everything measured after this is print layout. */
  async emulatePrint(on = true) {
    await this.send("Emulation.setEmulatedMedia", on ? { media: "print" } : { media: "" });
    // Force a style+layout pass so the very next measurement is not the stale one.
    await this.eval(`(() => { void document.body.offsetHeight; return true })()`);
    await sleep(120);
  }

  /**
   * The PDF, read back as a STREAM. A single multi-megabyte base64 frame is the shape
   * that truncates silently, and a truncated PDF still opens.
   */
  async pdf(opts = {}) {
    const { stream } = await this.send("Page.printToPDF", {
      printBackground: true,
      preferCSSPageSize: false,
      paperWidth: 8.27, paperHeight: 11.69,   // A4
      marginTop: 0.4, marginBottom: 0.4, marginLeft: 0.4, marginRight: 0.4,
      transferMode: "ReturnAsStream",
      ...opts,
    });
    if (!stream) throw new Error("INCOMPLETE: printToPDF returned no stream handle");
    const chunks = [];
    for (;;) {
      const r = await this.send("IO.read", { handle: stream, size: 512 * 1024 });
      if (r.data) chunks.push(Buffer.from(r.data, r.base64Encoded ? "base64" : "utf8"));
      if (r.eof) break;
    }
    await this.send("IO.close", { handle: stream }).catch(() => {});
    const buf = Buffer.concat(chunks);
    if (buf.length < 1000 || buf.subarray(0, 5).toString() !== "%PDF-") {
      throw new Error(`INCOMPLETE: printToPDF produced ${buf.length} bytes that are not a PDF`);
    }
    return buf;
  }

  async close() { await this.b.send("Target.closeTarget", { targetId: this.targetId }).catch(() => {}); }
}
