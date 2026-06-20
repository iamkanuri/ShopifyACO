import { useMemo, useState } from "react";
import type { ScanBrand, ScanForm } from "../scanTypes";
import { generatePrompts, startScan, suggestPrompts } from "../api";
import { getStatus } from "../api";
import { navigate } from "../router";

interface PromptRow {
  category: string;
  text: string;
  selected: boolean;
}

// Per-call worst-case cost (max output tokens) by engine — mirrors src/engines/models.
const PER_CALL: Record<string, number> = { openai: 0.00715, gemini: 0.00177, perplexity: 0.00076 };
const MINI_CAP = 0.5;

const ENGINE_LABEL: Record<string, string> = { openai: "ChatGPT", gemini: "Gemini", perplexity: "Perplexity" };

// Best-effort brand guess from a store URL (editable). "https://www.carawayhome.com/x"
// → "Carawayhome". Just a starting point so step 2 isn't empty.
function brandFromUrl(raw: string): string {
  try {
    const host = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, "");
    const label = host.split(".")[0] ?? "";
    return label ? label.charAt(0).toUpperCase() + label.slice(1) : "";
  } catch {
    return "";
  }
}

export function ScanPage() {
  // Prefill from ?url= (landing), or ?brand=&category= (Index leaderboard row).
  const qp = new URLSearchParams(window.location.search);
  const qpUrl = qp.get("url") ?? "";
  const qpBrand = qp.get("brand") ?? "";
  const qpCategory = qp.get("category") ?? "";

  const [storeUrl, setStoreUrl] = useState(qpUrl);
  const [brand, setBrand] = useState<ScanBrand>({
    name: qpBrand || (qpUrl ? brandFromUrl(qpUrl) : ""),
    storeUrl: qpUrl,
  });
  const [category, setCategory] = useState(qpCategory);
  const [persona, setPersona] = useState("");
  const [location, setLocation] = useState("");
  const [priceRange, setPriceRange] = useState("");
  const [competitors, setCompetitors] = useState<ScanBrand[]>([{ name: "", storeUrl: "" }]);
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [engines, setEngines] = useState({ openai: true, gemini: true, perplexity: true });
  const [email, setEmail] = useState("");
  const [hp, setHp] = useState(""); // honeypot — must stay empty
  const [newPrompt, setNewPrompt] = useState("");
  const [suggestMsg, setSuggestMsg] = useState("");
  const [suggestErr, setSuggestErr] = useState("");
  const [busy, setBusy] = useState<"" | "generating" | "suggesting" | "starting">("");
  // First screen is a single URL input unless we already arrived with details.
  const [phase, setPhase] = useState<"entry" | "details" | "running">(
    qpBrand || qpCategory ? "details" : "entry",
  );
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<string[]>([]);

  const enabledEngines = Object.entries(engines).filter(([, v]) => v).map(([k]) => k);
  const selected = prompts.filter((p) => p.selected);
  const estMaxCost = useMemo(
    () => selected.length * enabledEngines.reduce((s, e) => s + (PER_CALL[e] ?? 0), 0),
    [selected.length, enabledEngines.join(",")],
  );
  const overCap = estMaxCost > MINI_CAP;
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  function buildForm(): ScanForm {
    const clean = (s: string) => (s.trim() ? s.trim() : undefined);
    return {
      brand: { name: brand.name.trim(), storeUrl: clean(brand.storeUrl ?? storeUrl ?? "") },
      category: category.trim(),
      competitors: competitors
        .filter((c) => c.name.trim())
        .map((c) => ({ name: c.name.trim(), storeUrl: clean(c.storeUrl ?? "") })),
      persona: clean(persona),
      location: clean(location),
      priceRange: clean(priceRange),
    };
  }

  function formValid(): string | null {
    if (!brand.name.trim()) return "Enter your brand name.";
    if (!category.trim()) return "Enter a product category.";
    if (!competitors.some((c) => c.name.trim())) return "Add at least one competitor.";
    return null;
  }

  function startDetails(e?: React.FormEvent) {
    e?.preventDefault();
    const u = storeUrl.trim();
    if (u && !brand.name.trim()) setBrand({ name: brandFromUrl(u), storeUrl: u });
    else if (u) setBrand((b) => ({ ...b, storeUrl: u }));
    setPhase("details");
  }

  /** Ensure prompts exist (generate + auto-select the mini default). Returns the
   *  selected prompts so callers can act on the fresh list synchronously. */
  async function ensurePrompts(): Promise<PromptRow[] | null> {
    if (prompts.length) return prompts;
    const v = formValid();
    if (v) {
      setError(v);
      return null;
    }
    setError("");
    setBusy("generating");
    try {
      const { prompts: gen, miniDefault } = await generatePrompts(buildForm());
      const mini = new Set(miniDefault);
      const rows = gen.map((p) => ({ ...p, selected: mini.has(p.text) }));
      setPrompts(rows);
      return rows;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy("");
    }
  }

  async function doSuggest() {
    setSuggestMsg("");
    setSuggestErr("");
    // Suggest extends an existing prompt set — make sure one exists first.
    const base = await ensurePrompts();
    if (!base) return;
    setBusy("suggesting");
    try {
      const { prompts: extra, costUsd, error: sErr } = await suggestPrompts(buildForm());
      if (sErr) {
        setSuggestErr(`Couldn't get AI suggestions: ${sErr}`);
        return;
      }
      const existing = new Set(prompts.map((p) => p.text.toLowerCase()));
      const added = extra
        .filter((t) => !existing.has(t.toLowerCase()))
        .map((t) => ({ category: "ai_suggested", text: t, selected: false }));
      if (added.length === 0) {
        setSuggestErr("No new suggestions came back — try again or add your own below.");
        return;
      }
      setPrompts((prev) => [...prev, ...added]);
      setSuggestMsg(`Added ${added.length} suggestion${added.length === 1 ? "" : "s"} (cost $${costUsd.toFixed(4)}). Select any to include.`);
    } catch (e) {
      setSuggestErr((e as Error).message || "AI suggestion request failed.");
    } finally {
      setBusy("");
    }
  }

  function addManual() {
    const t = newPrompt.trim();
    if (!t) return;
    setPrompts((prev) => [{ category: "custom", text: t, selected: true }, ...prev]);
    setNewPrompt("");
  }

  async function openConfirm() {
    if (!emailValid) return setError("Enter a valid email to run.");
    const rows = await ensurePrompts();
    if (!rows) return;
    if (rows.filter((p) => p.selected).length === 0) {
      return setError("No prompts selected. Open “Customize prompts” to pick some.");
    }
    setError("");
    setShowConfirm(true);
  }

  async function confirmRun() {
    setBusy("starting");
    setError("");
    try {
      const { runId } = await startScan({
        form: buildForm(),
        prompts: selected.map((p) => p.text),
        engines: enabledEngines,
        email: email.trim(),
        hp,
        sourcePage: window.location.pathname,
      });
      setShowConfirm(false);
      setPhase("running");
      poll(runId);
    } catch (e) {
      setError((e as Error).message);
      setShowConfirm(false);
    } finally {
      setBusy("");
    }
  }

  function poll(runId: string) {
    const tick = async () => {
      try {
        const s = await getStatus(runId);
        setProgress(s.progress ?? []);
        if (s.status === "complete") return navigate(`/report/${runId}`);
        if (s.status === "failed") {
          setError(s.error ?? "Scan failed.");
          setPhase("details");
          return;
        }
      } catch {
        /* keep polling */
      }
      setTimeout(tick, 2500);
    };
    tick();
  }

  // ---- running ----
  if (phase === "running") {
    return (
      <div className="card scan-running">
        <div className="spinner" />
        <h2>Scanning AI assistants…</h2>
        <p className="muted">Asking {enabledEngines.length} engines your {selected.length} prompts. This usually takes under a minute.</p>
        <pre className="progress-log">{progress.join("\n") || "Starting…"}</pre>
      </div>
    );
  }

  // ---- step 1: single URL input ----
  if (phase === "entry") {
    return (
      <div className="scan-entry">
        <h1>See if AI recommends your store</h1>
        <p className="muted">Enter your store URL to start a free scan.</p>
        <form className="hero-form" onSubmit={startDetails}>
          <input
            type="text"
            inputMode="url"
            value={storeUrl}
            onChange={(e) => setStoreUrl(e.target.value)}
            placeholder="yourstore.com"
            aria-label="Your store URL"
            autoFocus
          />
          <button type="submit" className="btn btn-primary lg">
            Run free scan
          </button>
        </form>
        <div className="hero-trust">Free · no store login required</div>
      </div>
    );
  }

  // ---- step 2: details (progressively revealed) ----
  return (
    <div className="scanpage">
      <h1 className="report-headline">A few details and we'll scan</h1>
      <p className="muted" style={{ marginTop: -6 }}>
        We'll ask ChatGPT, Gemini, and Perplexity what real shoppers ask — and show who they recommend.
      </p>

      <div className="card formcard">
        <h3>Your store</h3>
        <div className="form-grid">
          <Field label="Brand name *">
            <input value={brand.name} onChange={(e) => setBrand({ ...brand, name: e.target.value })} placeholder="Caraway" />
          </Field>
          <Field label="Store URL">
            <input value={brand.storeUrl ?? ""} onChange={(e) => setBrand({ ...brand, storeUrl: e.target.value })} placeholder="https://carawayhome.com" />
          </Field>
          <Field label="Category *">
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="nonstick cookware" />
          </Field>
          <Field label="Your email *">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@store.com" />
          </Field>
        </div>
      </div>

      <div className="card formcard">
        <h3>Competitors <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· at least one</span></h3>
        {competitors.map((c, i) => (
          <div className="comp-row" key={i}>
            <input
              placeholder="Competitor name"
              value={c.name}
              onChange={(e) => updateComp(i, { name: e.target.value })}
            />
            <input
              placeholder="Store URL (optional)"
              value={c.storeUrl ?? ""}
              onChange={(e) => updateComp(i, { storeUrl: e.target.value })}
            />
            <button className="btn icon" onClick={() => setCompetitors(competitors.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
        ))}
        <button className="btn" onClick={() => setCompetitors([...competitors, { name: "", storeUrl: "" }])}>
          + Add competitor
        </button>
      </div>

      {/* Advanced: prompt customization is hidden by default (progressive disclosure). */}
      <details className="adv-prompts card formcard" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && ensurePrompts()}>
        <summary>Customize prompts (optional)</summary>

        <div className="scan-actions" style={{ marginTop: 14 }}>
          <button className="btn" disabled={busy === "generating"} onClick={() => ensurePrompts()}>
            {busy === "generating" ? "Generating…" : prompts.length ? "Regenerate prompts" : "Generate prompts"}
          </button>
          <button className="btn" disabled={busy === "suggesting"} onClick={doSuggest}>
            {busy === "suggesting" ? "Asking AI…" : "Suggest more with AI"}
          </button>
        </div>
        {suggestErr && <div className="banner-error">{suggestErr}</div>}
        {suggestMsg && <div className="suggest-msg">{suggestMsg}</div>}

        {prompts.length > 0 && (
          <>
            <div className="add-prompt" style={{ marginTop: 14 }}>
              <input
                placeholder="Add your own prompt…"
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addManual()}
              />
              <button className="btn" onClick={addManual}>
                Add
              </button>
            </div>
            <div className="prompt-list">
              {prompts.map((p, i) => (
                <label className={`prompt-row ${p.selected ? "on" : ""}`} key={i}>
                  <input
                    type="checkbox"
                    checked={p.selected}
                    onChange={() => setPrompts(prompts.map((x, j) => (j === i ? { ...x, selected: !x.selected } : x)))}
                  />
                  <span className="ptag">{p.category}</span>
                  <span className="ptext">{p.text}</span>
                  <button
                    className="btn icon"
                    onClick={(e) => {
                      e.preventDefault();
                      setPrompts(prompts.filter((_, j) => j !== i));
                    }}
                  >
                    ×
                  </button>
                </label>
              ))}
            </div>

            <div className="run-bar">
              <div className="engine-toggles">
                {(["openai", "gemini", "perplexity"] as const).map((e) => (
                  <label key={e} className={`engine-toggle ${engines[e] ? "on" : ""}`}>
                    <input type="checkbox" checked={engines[e]} onChange={() => setEngines({ ...engines, [e]: !engines[e] })} />
                    {ENGINE_LABEL[e]}
                  </label>
                ))}
              </div>
              <div className="estimate">
                <div>
                  <b>{selected.length}</b> prompts × <b>{enabledEngines.length}</b> engines ={" "}
                  <b>{selected.length * enabledEngines.length}</b> calls
                </div>
                <div className={overCap ? "over" : ""}>
                  Est. max cost <b>${estMaxCost.toFixed(3)}</b> (cap ${MINI_CAP.toFixed(2)})
                </div>
              </div>
            </div>
          </>
        )}
      </details>

      {overCap && (
        <div className="banner-error">
          Over the ${MINI_CAP.toFixed(2)} mini-scan cap. Deselect prompts or engines in “Customize prompts”.
        </div>
      )}
      {error && <div className="banner-error">{error}</div>}

      {/* Honeypot: hidden from real users; bots fill every field and get rejected. */}
      <input
        className="hp-field"
        type="text"
        name="hp_contact_ref"
        tabIndex={-1}
        autoComplete="off"
        data-lpignore="true"
        data-1p-ignore="true"
        data-bwignore="true"
        data-form-type="other"
        aria-hidden="true"
        value={hp}
        onChange={(e) => setHp(e.target.value)}
      />

      <div className="scan-actions">
        <button
          className="btn btn-primary lg"
          disabled={busy === "generating" || busy === "starting" || overCap}
          onClick={openConfirm}
        >
          {busy === "generating" ? "Preparing…" : "Run free scan →"}
        </button>
        <span className="muted" style={{ alignSelf: "center", fontSize: 12.5 }}>
          {prompts.length ? `${selected.length} prompts × ${enabledEngines.length} engines` : "5 prompts × 3 engines"}
        </span>
      </div>

      {showConfirm && (
        <div className="modal-overlay" onClick={() => setShowConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Run a live scan?</h3>
            <p className="muted">
              This makes <b>{selected.length * enabledEngines.length} live API calls</b> to{" "}
              {enabledEngines.map((e) => ENGINE_LABEL[e]).join(", ")} and costs up to{" "}
              <b>${estMaxCost.toFixed(3)}</b> (real money). Proceed?
            </p>
            <div className="scan-actions">
              <button className="btn" onClick={() => setShowConfirm(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={busy === "starting"} onClick={confirmRun}>
                {busy === "starting" ? "Starting…" : `Yes, run ($${estMaxCost.toFixed(3)} max)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  function updateComp(i: number, patch: Partial<ScanBrand>) {
    setCompetitors(competitors.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
