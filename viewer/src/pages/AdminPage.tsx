import { useEffect, useState } from "react";
import { adminBuildIndex, adminData, adminEngineKeys, adminFulfillOrder, adminLogin, adminLogout, adminMe, adminScan, adminScanOrder, type EngineKeyStatus } from "../api";
import { useConfig } from "../config";

interface AdminData {
  summary: Record<string, number>;
  funnel: { step: string; count: number }[];
  runs: Record<string, any>[];
  leads: Record<string, any>[];
  orders: Record<string, any>[];
  errors: { runId: string; brand?: string; error: string; createdAt: string }[];
  launch: { label: string; value: number; target: number }[];
  generatedAt: string;
}

export function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [configured, setConfigured] = useState(true);
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    adminMe().then((m) => {
      setAuthed(m.authed);
      setConfigured(m.configured);
      if (m.authed) load();
    });
  }, []);

  function load() {
    adminData<AdminData>().then(setData).catch((e) => setError(e.message));
  }

  if (authed === null) return <div className="card empty">Loading…</div>;
  if (!authed) return <Login configured={configured} onIn={() => { setAuthed(true); load(); }} />;

  return (
    <div className="admin">
      <div className="admin-head">
        <h1>Admin cockpit</h1>
        <div>
          <button className="btn" onClick={load}>
            Refresh
          </button>{" "}
          <button className="btn" onClick={() => adminLogout().then(() => setAuthed(false))}>
            Log out
          </button>
        </div>
      </div>
      {error && <div className="banner-error">{error}</div>}
      {!data ? (
        <div className="card empty">Loading data…</div>
      ) : (
        <>
          <Summary s={data.summary} />
          <EngineKeys />
          <Launch launch={data.launch} />
          <Funnel funnel={data.funnel} />
          <OrdersTable orders={data.orders} onDone={load} />
          <CategoryIndexBuilder />
          <ManualScan onDone={load} />
          <RunsTable runs={data.runs} />
          <LeadsTable leads={data.leads} />
          <Errors errors={data.errors} />
          <p className="muted" style={{ fontSize: 11 }}>Generated {new Date(data.generatedAt).toLocaleString()}</p>
        </>
      )}
    </div>
  );
}

function Login({ configured, onIn }: { configured: boolean; onIn: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    setErr("");
    try {
      await adminLogin(pw);
      onIn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card center-card" style={{ maxWidth: 360 }}>
      <h2>Admin</h2>
      {!configured && <div className="banner-error">ADMIN_PASSWORD not set on the server.</div>}
      <input
        className="modal-input"
        type="password"
        placeholder="Admin password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && go()}
        autoFocus
      />
      {err && <div className="modal-err">{err}</div>}
      <button className="btn btn-primary" disabled={busy} onClick={go}>
        {busy ? "…" : "Log in"}
      </button>
    </div>
  );
}

const LABELS: Record<string, string> = {
  scansStarted: "Scans started",
  scansCompleted: "Completed",
  scansFailed: "Failed",
  spendUsd: "Spend today",
  remainingUsd: "Cap remaining",
  leads: "Leads",
  ctaClicks: "CTA clicks",
  paymentClicks: "Payment clicks",
  paidOrders: "Paid orders",
  scanGateSubmissions: "Email gates",
  rateLimitBlocks: "Rate-limit blocks",
  dailyLimitBlocks: "Daily-limit blocks",
  spendCapBlocks: "Spend-cap blocks",
};
// Tiles that deep-link to a detail section below.
const TILE_JUMP: Record<string, string> = { paidOrders: "paid-orders", paymentClicks: "paid-orders" };
function Summary({ s }: { s: Record<string, number> }) {
  const money = new Set(["spendUsd", "remainingUsd"]);
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <section className="section">
      <h2>Today</h2>
      <div className="admin-tiles">
        {Object.keys(LABELS).map((k) => {
          const target = TILE_JUMP[k];
          return (
            <div
              className={`card tile ${target ? "tile-link" : ""}`}
              key={k}
              onClick={target ? () => jump(target) : undefined}
              role={target ? "button" : undefined}
              tabIndex={target ? 0 : undefined}
              onKeyDown={target ? (e) => (e.key === "Enter" || e.key === " ") && jump(target) : undefined}
            >
              <div className="k">
                {LABELS[k]}
                {target && <span className="tile-go"> ↓</span>}
              </div>
              <div className="v">{money.has(k) ? `$${Number(s[k] ?? 0).toFixed(2)}` : s[k] ?? 0}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function EngineKeys() {
  const [rows, setRows] = useState<EngineKeyStatus[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function run() {
    setBusy(true);
    setErr("");
    try {
      const r = await adminEngineKeys();
      setRows(r.engines);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="section">
      <h2>Engine keys</h2>
      <div className="card formcard">
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Pings each provider to confirm its API key authenticates. A failing engine is otherwise
          dropped silently from every scan. (Perplexity check costs ~$0.0001.)
        </p>
        <div className="scan-actions" style={{ marginTop: 0 }}>
          <button className="btn btn-primary" disabled={busy} onClick={run}>
            {busy ? "Checking…" : "Check engine keys"}
          </button>
        </div>
        {err && <div className="banner-error">{err}</div>}
        {rows && (
          <div className="keystatus-list">
            {rows.map((r) => {
              const state = !r.configured ? "missing" : r.ok ? "ok" : "bad";
              const label = state === "ok" ? "Valid" : state === "missing" ? "Not configured" : "Invalid";
              const cls = state === "ok" ? "rec" : state === "missing" ? "low" : "abs";
              return (
                <div className="keystatus-row" key={r.engine}>
                  <span className={`badge ${cls}`}>{label}</span>
                  <span className="ks-label">{r.label}</span>
                  {r.detail && <span className="ks-detail muted">{r.detail}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function Launch({ launch }: { launch: AdminData["launch"] }) {
  return (
    <section className="section">
      <h2>Launch targets</h2>
      <div className="admin-tiles">
        {launch.map((m) => {
          const pct = Math.min(100, Math.round((m.value / m.target) * 100));
          return (
            <div className="card tile" key={m.label}>
              <div className="k">{m.label}</div>
              <div className="v">
                {m.value}<span className="muted" style={{ fontSize: 14 }}> / {m.target}</span>
              </div>
              <div className="bar"><span style={{ width: `${pct}%`, background: pct >= 100 ? "var(--good)" : "var(--accent)" }} /></div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Funnel({ funnel }: { funnel: AdminData["funnel"] }) {
  const top = Math.max(1, ...funnel.map((f) => f.count));
  return (
    <section className="section">
      <h2>Funnel (today)</h2>
      <div className="card cardpad">
        {funnel.map((f) => (
          <div className="funnel-row" key={f.step}>
            <span className="funnel-step">{f.step}</span>
            <span className="funnel-bar"><span style={{ width: `${(f.count / top) * 100}%` }} /></span>
            <span className="funnel-n">{f.count}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function CategoryIndexBuilder() {
  const { baseUrl } = useConfig();
  const [label, setLabel] = useState("");
  const [brands, setBrands] = useState("");
  const [mode, setMode] = useState("deep");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const brandCount = brands.split(/[,\n]/).filter((s) => s.trim()).length;
  async function build() {
    setBusy(true);
    setMsg("");
    try {
      const brandList = brands.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
      const r = await adminBuildIndex({ label: label.trim(), brands: brandList, mode });
      setMsg(`Building "${label}" (${r.brands} brands, ~$${r.estimateMaxUsd.toFixed(3)}). Live in ~1–2 min: ${baseUrl}/index/${r.slug}`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="section">
      <h2>Build an AI Visibility Index (public leaderboard)</h2>
      <div className="card formcard">
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          One scan ranks every brand in a category and publishes a public page at <code>/index/&lt;slug&gt;</code> — your SEO/growth asset.
        </p>
        <div className="form-grid">
          <input placeholder="Category label (e.g. Non-toxic cookware)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="deep">Deep (30 prompts — richest)</option>
            <option value="standard">Standard (15 prompts)</option>
          </select>
        </div>
        <textarea
          className="index-brands"
          placeholder="Brands — comma or newline separated (3–25). All ranked equally on the same prompts."
          value={brands}
          onChange={(e) => setBrands(e.target.value)}
          rows={3}
        />
        <div className="scan-actions">
          <button className="btn btn-primary" disabled={busy || !label.trim() || brandCount < 3} onClick={build}>
            {busy ? "Starting…" : `Build index (${brandCount} brands)`}
          </button>
        </div>
        {msg && <div className="suggest-msg" style={{ wordBreak: "break-all" }}>{msg}</div>}
      </div>
    </section>
  );
}

function ManualScan({ onDone }: { onDone: () => void }) {
  const { baseUrl } = useConfig();
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [comp, setComp] = useState("");
  const [mode, setMode] = useState("standard");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    setMsg("");
    try {
      const form = {
        brand: { name: brand.trim() },
        category: category.trim(),
        competitors: comp.split(",").map((c) => ({ name: c.trim() })).filter((c) => c.name),
      };
      const r = await adminScan({ form, mode });
      const link = `${baseUrl}/report/${r.runId}`;
      setMsg(`Started ${r.mode} scan (${r.prompts} prompts, ~$${r.estimateMaxUsd.toFixed(3)}). Report: ${link}`);
      setTimeout(onDone, 1500);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="section">
      <h2>Run a paid-beta scan (standard / deep)</h2>
      <div className="card formcard">
        <div className="form-grid">
          <input placeholder="Brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
          <input placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} />
          <input placeholder="Competitors (comma-separated)" value={comp} onChange={(e) => setComp(e.target.value)} />
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="standard">Standard (15 prompts, $2 cap)</option>
            <option value="deep">Deep (30 prompts, $5 cap)</option>
          </select>
        </div>
        <div className="scan-actions">
          <button className="btn btn-primary" disabled={busy || !brand || !category || !comp} onClick={run}>
            {busy ? "Starting…" : "Run scan"}
          </button>
        </div>
        {msg && <div className="suggest-msg" style={{ wordBreak: "break-all" }}>{msg}</div>}
      </div>
    </section>
  );
}

function OrdersTable({ orders, onDone }: { orders: AdminData["orders"]; onDone: () => void }) {
  const { baseUrl } = useConfig();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");

  async function fulfill(id: number) {
    setBusyId(id);
    setMsg("");
    try {
      await adminFulfillOrder(id);
      onDone();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function scan(id: number) {
    setBusyId(id);
    setMsg("");
    try {
      const r = await adminScanOrder(id);
      setMsg(`Started deep scan (${r.prompts} prompts, ~$${r.estimateMaxUsd.toFixed(3)}). Report: ${baseUrl}/report/${r.runId}`);
      setTimeout(onDone, 1500);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="section" id="paid-orders">
      <h2>Paid orders (webhook-confirmed)</h2>
      <div className="card cardpad" style={{ overflowX: "auto" }}>
        {orders.length === 0 ? (
          <div className="muted" style={{ padding: 12 }}>No paid orders yet. A verified Stripe checkout lands here.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>created</th><th>email</th><th>product</th><th>amount</th><th>status</th><th>source run</th><th>actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const id = Number(o.id);
                const fulfilled = o.status === "fulfilled";
                return (
                  <tr key={id}>
                    <td>{new Date(o.created_at).toLocaleString()}</td>
                    <td>{o.email ?? "—"}</td>
                    <td>{o.plan ?? "—"}</td>
                    <td>${Number(o.amount_usd ?? 0).toFixed(2)} {String(o.currency ?? "").toUpperCase()}</td>
                    <td><span className={`badge ${fulfilled ? "rec" : o.status === "scanning" ? "men" : "medium"}`}>{o.status}</span></td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>
                      {o.source_run_id ? (
                        <a href={`/report/${o.source_run_id}`} target="_blank" rel="noreferrer">{o.source_run_id}</a>
                      ) : "—"}
                      {o.scan_run_id && (
                        <div style={{ marginTop: 2 }}>
                          deep: <a href={`/report/${o.scan_run_id}`} target="_blank" rel="noreferrer">{o.scan_run_id}</a>
                        </div>
                      )}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button
                        className="btn"
                        disabled={busyId === id || !o.source_run_id}
                        title={o.source_run_id ? "Run a deep scan from this order's source run" : "No source run — use the manual scan form"}
                        onClick={() => scan(id)}
                      >
                        Deep scan
                      </button>{" "}
                      <button className="btn" disabled={busyId === id || fulfilled} onClick={() => fulfill(id)}>
                        {fulfilled ? "Fulfilled ✓" : "Mark fulfilled"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {msg && <div className="suggest-msg" style={{ wordBreak: "break-all" }}>{msg}</div>}
      </div>
    </section>
  );
}

function RunsTable({ runs }: { runs: AdminData["runs"] }) {
  const { baseUrl } = useConfig();
  return (
    <section className="section">
      <h2>Runs</h2>
      <div className="card cardpad" style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>runId</th><th>created</th><th>brand</th><th>email</th><th>mode</th><th>cost</th><th>status</th><th>report</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td style={{ fontFamily: "monospace", fontSize: 11 }}>{r.id}</td>
                <td>{new Date(r.created_at).toLocaleString()}</td>
                <td>{r.brand}</td>
                <td>{r.email ?? "—"}</td>
                <td>{r.mode ?? "mini"}</td>
                <td>${Number(r.cost_usd ?? 0).toFixed(4)}</td>
                <td><span className={`badge ${r.status === "complete" ? "rec" : r.status === "failed" ? "abs" : "men"}`}>{r.status}</span></td>
                <td>
                  <a href={`/report/${r.id}`} target="_blank" rel="noreferrer">open</a>{" · "}
                  <button className="linkbtn" onClick={() => navigator.clipboard.writeText(`${baseUrl}/report/${r.id}`)}>copy link</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LeadsTable({ leads }: { leads: AdminData["leads"] }) {
  return (
    <section className="section">
      <h2>Leads</h2>
      <div className="card cardpad" style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr><th>time</th><th>email</th><th>plan</th><th>source</th><th>page</th><th>runId</th></tr>
          </thead>
          <tbody>
            {leads.map((l, i) => (
              <tr key={i}>
                <td>{new Date(l.created_at).toLocaleString()}</td>
                <td>{l.email}</td>
                <td>{l.plan}</td>
                <td>{l.source}</td>
                <td>{l.source_page ?? "—"}</td>
                <td style={{ fontFamily: "monospace", fontSize: 11 }}>{l.run_id ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Errors({ errors }: { errors: AdminData["errors"] }) {
  return (
    <section className="section">
      <h2>Error log</h2>
      <div className="card cardpad">
        {errors.length === 0 ? (
          <div className="muted" style={{ padding: 12 }}>No failed scans 🎉</div>
        ) : (
          errors.map((e, i) => (
            <div key={i} className="err-row">
              <span style={{ fontFamily: "monospace", fontSize: 11 }}>{e.runId}</span> · {e.brand} —{" "}
              <span style={{ color: "var(--bad)" }}>{e.error}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
