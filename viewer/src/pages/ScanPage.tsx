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

export function ScanPage() {
  // Prefill from ?brand=&category= (e.g. arriving from an Index leaderboard row).
  const qp = new URLSearchParams(window.location.search);
  const [brand, setBrand] = useState<ScanBrand>({ name: qp.get("brand") ?? "", storeUrl: "" });
  const [category, setCategory] = useState(qp.get("category") ?? "");
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
  const [busy, setBusy] = useState<"" | "generating" | "suggesting" | "starting">("");
  const [phase, setPhase] = useState<"form" | "confirm" | "running">("form");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<string[]>([]);

  const enabledEngines = Object.entries(engines).filter(([, v]) => v).map(([k]) => k);
  const selected = prompts.filter((p) => p.selected);
  const estMaxCost = useMemo(
    () => selected.length * enabledEngines.reduce((s, e) => s + (PER_CALL[e] ?? 0), 0),
    [selected.length, enabledEngines.join(",")],
  );
  const overCap = estMaxCost > MINI_CAP;

  function buildForm(): ScanForm {
    const clean = (s: string) => (s.trim() ? s.trim() : undefined);
    return {
      brand: { name: brand.name.trim(), storeUrl: clean(brand.storeUrl ?? "") },
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

  async function doGenerate() {
    const v = formValid();
    if (v) return setError(v);
    setError("");
    setBusy("generating");
    try {
      const { prompts: gen, miniDefault } = await generatePrompts(buildForm());
      const mini = new Set(miniDefault);
      setPrompts(gen.map((p) => ({ ...p, selected: mini.has(p.text) })));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function doSuggest() {
    const v = formValid();
    if (v) return setError(v);
    setBusy("suggesting");
    setSuggestMsg("");
    try {
      const { prompts: extra, costUsd, error: sErr } = await suggestPrompts(buildForm());
      if (sErr) {
        setSuggestMsg(`AI suggest unavailable: ${sErr}`);
      } else {
        const existing = new Set(prompts.map((p) => p.text.toLowerCase()));
        const added = extra
          .filter((t) => !existing.has(t.toLowerCase()))
          .map((t) => ({ category: "ai_suggested", text: t, selected: false }));
        setPrompts((prev) => [...prev, ...added]);
        setSuggestMsg(`Added ${added.length} AI suggestions (cost $${costUsd.toFixed(4)}). Select any you want to include.`);
      }
    } catch (e) {
      setSuggestMsg((e as Error).message);
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
      setPhase("running");
      poll(runId);
    } catch (e) {
      setError((e as Error).message);
      setPhase("form");
    } finally {
      setBusy("");
    }
  }

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  function poll(runId: string) {
    const tick = async () => {
      try {
        const s = await getStatus(runId);
        setProgress(s.progress ?? []);
        if (s.status === "complete") return navigate(`/report/${runId}`);
        if (s.status === "failed") {
          setError(s.error ?? "Scan failed.");
          setPhase("form");
          return;
        }
      } catch {
        /* keep polling */
      }
      setTimeout(tick, 2500);
    };
    tick();
  }

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

  return (
    <div className="scanpage">
      <h1 className="report-headline">New AI visibility scan</h1>
      <p className="muted" style={{ marginTop: -6 }}>
        Tell us your brand and competitors. We'll ask ChatGPT, Gemini, and Perplexity what real
        shoppers ask — and show who they recommend.
      </p>

      {/* ---- Brand ---- */}
      <div className="card formcard">
        <h3>Your brand</h3>
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
          <Field label="Price range">
            <input value={priceRange} onChange={(e) => setPriceRange(e.target.value)} placeholder="under $400" />
          </Field>
          <Field label="Buyer persona">
            <input value={persona} onChange={(e) => setPersona(e.target.value)} placeholder="a health-conscious home cook" />
          </Field>
          <Field label="Location">
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="US" />
          </Field>
        </div>
      </div>

      {/* ---- Competitors ---- */}
      <div className="card formcard">
        <h3>Competitors</h3>
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

      {error && <div className="banner-error">{error}</div>}

      {/* ---- Generate / prompts ---- */}
      <div className="scan-actions">
        <button className="btn btn-primary" disabled={busy === "generating"} onClick={doGenerate}>
          {busy === "generating" ? "Generating…" : prompts.length ? "Regenerate prompts" : "Generate prompts"}
        </button>
        <button className="btn" disabled={busy === "suggesting" || prompts.length === 0} onClick={doSuggest}>
          {busy === "suggesting" ? "Asking AI…" : "✨ Suggest more with AI (~$0.01)"}
        </button>
      </div>
      {suggestMsg && <div className="suggest-msg">{suggestMsg}</div>}

      {prompts.length > 0 && (
        <div className="card formcard">
          <h3>
            Prompts to run <span className="muted">· {selected.length} selected</span>
          </h3>
          <div className="add-prompt">
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

          {/* ---- Engines + estimate ---- */}
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

          {overCap && (
            <div className="banner-error">
              Over the ${MINI_CAP.toFixed(2)} mini-scan cap. Deselect prompts or engines to continue.
            </div>
          )}

          <div className="email-gate">
            <label className="field">
              <span>Your email * — we'll send results and notify you if capacity is reached</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@store.com"
              />
            </label>
            {/* Honeypot: hidden from real users; bots fill every field and get
                rejected. Hardened so password managers / browser autofill skip it
                (it sits next to the email field, so an autofilled email cluster was
                falsely tripping real users). The data-* attrs are the documented
                ignore hints for 1Password / LastPass / Bitwarden / Dashlane, and the
                non-standard name + autocomplete=off keep Chrome autofill away. */}
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
          </div>

          <div className="scan-actions">
            <button
              className="btn btn-primary lg"
              disabled={selected.length === 0 || enabledEngines.length === 0 || overCap || !emailValid}
              onClick={() => setPhase("confirm")}
            >
              Run mini scan →
            </button>
            {!emailValid && email.length > 0 && <span className="muted" style={{ alignSelf: "center" }}>Enter a valid email to run.</span>}
          </div>
        </div>
      )}

      {phase === "confirm" && (
        <div className="modal-overlay" onClick={() => setPhase("form")}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Run a live scan?</h3>
            <p className="muted">
              This makes <b>{selected.length * enabledEngines.length} live API calls</b> to{" "}
              {enabledEngines.map((e) => ENGINE_LABEL[e]).join(", ")} and costs up to{" "}
              <b>${estMaxCost.toFixed(3)}</b> (real money). Proceed?
            </p>
            <div className="scan-actions">
              <button className="btn" onClick={() => setPhase("form")}>
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
