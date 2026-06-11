import { useEffect, useState } from "react";
import { adminData, adminLogin, adminLogout, adminMe, adminScan } from "../api";
import { useConfig } from "../config";

interface AdminData {
  summary: Record<string, number>;
  funnel: { step: string; count: number }[];
  runs: Record<string, any>[];
  leads: Record<string, any>[];
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
          <Launch launch={data.launch} />
          <Funnel funnel={data.funnel} />
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
  scanGateSubmissions: "Email gates",
  rateLimitBlocks: "Rate-limit blocks",
  dailyLimitBlocks: "Daily-limit blocks",
  spendCapBlocks: "Spend-cap blocks",
};
function Summary({ s }: { s: Record<string, number> }) {
  const money = new Set(["spendUsd", "remainingUsd"]);
  return (
    <section className="section">
      <h2>Today</h2>
      <div className="admin-tiles">
        {Object.keys(LABELS).map((k) => (
          <div className="card tile" key={k}>
            <div className="k">{LABELS[k]}</div>
            <div className="v">{money.has(k) ? `$${Number(s[k] ?? 0).toFixed(2)}` : (s[k] ?? 0)}</div>
          </div>
        ))}
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
