import { useEffect, useMemo, useRef, useState } from "react";
import { useConfig } from "../config";
import type { ScanBrand, ScanForm } from "../scanTypes";
import { generatePrompts, inferStore, startScan, suggestPrompts } from "../api";
import { getStatus } from "../api";
import { navigate } from "../router";
import { useModalFocus } from "../useModalFocus";

interface FieldErrors { brand?: string; category?: string; email?: string; competitors?: string }

interface PromptRow {
  category: string;
  text: string;
  selected: boolean;
}

const MINI_PROMPTS = 5;

const ENGINE_LABEL: Record<string, string> = { openai: "ChatGPT", gemini: "Gemini", perplexity: "Perplexity" };

const looksLikeUrl = (s: string) => /\./.test(s.trim()) && !/\s/.test(s.trim());

// Best-effort brand guess from a store URL/name (editable fallback if AI detection
// doesn't return a brand). "https://www.carawayhome.com/x" → "Carawayhome".
function brandFromInput(raw: string): string {
  const v = raw.trim();
  if (!looksLikeUrl(v)) return v ? v.charAt(0).toUpperCase() + v.slice(1) : "";
  try {
    const host = new URL(/^https?:\/\//.test(v) ? v : `https://${v}`).hostname.replace(/^www\./, "");
    const label = host.split(".")[0] ?? "";
    return label ? label.charAt(0).toUpperCase() + label.slice(1) : "";
  } catch {
    return "";
  }
}

export function ScanPage() {
  // Prefill from ?url= (landing) or ?brand=&category= (Index leaderboard row).
  const qp = new URLSearchParams(window.location.search);
  const qpUrl = qp.get("url") ?? "";
  const qpBrand = qp.get("brand") ?? "";
  const qpCategory = qp.get("category") ?? "";

  const [storeInput, setStoreInput] = useState(qpUrl);
  const [brand, setBrand] = useState<ScanBrand>({ name: qpBrand, storeUrl: looksLikeUrl(qpUrl) ? qpUrl : "" });
  const [category, setCategory] = useState(qpCategory);
  const [persona] = useState("");
  const [location] = useState("");
  const [priceRange] = useState("");
  const [competitors, setCompetitors] = useState<ScanBrand[]>([{ name: "", storeUrl: "" }]);
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [engines, setEngines] = useState({ openai: true, gemini: true, perplexity: true });
  const [email, setEmail] = useState("");
  const [hp, setHp] = useState(""); // honeypot — must stay empty
  const [newPrompt, setNewPrompt] = useState("");
  const [suggestMsg, setSuggestMsg] = useState("");
  const [suggestErr, setSuggestErr] = useState("");
  const [inferNote, setInferNote] = useState("");
  const [busy, setBusy] = useState<"" | "inferring" | "generating" | "suggesting" | "starting">("");
  const [phase, setPhase] = useState<"entry" | "details" | "running">(
    qpUrl || qpBrand || qpCategory ? "details" : "entry",
  );
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [progress, setProgress] = useState<string[]>([]);
  const inferred = useRef(false);

  // Field refs so we can move focus to the FIRST invalid field on a failed submit.
  const brandRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const firstCompRef = useRef<HTMLInputElement>(null);

  // a11y: confirm dialog gets initial focus, a focus trap, Escape, and focus restoration.
  const confirmRef = useModalFocus<HTMLDivElement>(showConfirm, () => setShowConfirm(false));

  const clearFieldError = (k: keyof FieldErrors) =>
    setFieldErrors((f) => (f[k] ? { ...f, [k]: undefined } : f));

  // Cost numbers come from the server (/api/config), never hardcoded in React — so the
  // displayed estimate matches the backend's reservation (Codex #9).
  const { scanCostPerCall, scanCostCapUsd } = useConfig();
  const enabledEngines = Object.entries(engines).filter(([, v]) => v).map(([k]) => k);
  const selected = prompts.filter((p) => p.selected);
  const estMaxCost = useMemo(
    () => selected.length * enabledEngines.reduce((s, e) => s + (scanCostPerCall[e] ?? 0), 0),
    [selected.length, enabledEngines.join(","), scanCostPerCall],
  );
  const overCap = estMaxCost > scanCostCapUsd;
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  // Arrived from the landing page (or a deep link) with a store already typed —
  // auto-detect once. The Index path already supplies brand+category, so skip it there.
  useEffect(() => {
    if (inferred.current) return;
    if (qpUrl && !qpBrand) {
      inferred.current = true;
      runInference(qpUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function buildForm(): ScanForm {
    const clean = (s?: string) => (s && s.trim() ? s.trim() : undefined);
    const url = (brand.storeUrl ?? "").trim() || (looksLikeUrl(storeInput) ? storeInput.trim() : "");
    return {
      brand: { name: brand.name.trim(), storeUrl: clean(url) },
      category: category.trim(),
      competitors: competitors
        .filter((c) => c.name.trim())
        .map((c) => ({ name: c.name.trim(), storeUrl: clean(c.storeUrl ?? "") })),
      persona: clean(persona),
      location: clean(location),
      priceRange: clean(priceRange),
    };
  }

  // Collect ALL invalid fields at once (not one-error-per-submit) so the shopper sees the
  // whole list. `requireEmail` is on only for the run, not for prompt generation.
  function collectErrors(requireEmail: boolean): FieldErrors {
    const e: FieldErrors = {};
    if (!brand.name.trim()) e.brand = "Enter your brand name.";
    if (!category.trim()) e.category = "Enter a product category.";
    if (!competitors.some((c) => c.name.trim())) e.competitors = "Add at least one competitor.";
    if (requireEmail && !emailValid) e.email = "Enter a valid email address to run the scan.";
    return e;
  }

  // Move focus to the first invalid field, in visual (top-to-bottom) order.
  function focusFirstError(e: FieldErrors): void {
    const target = e.brand ? brandRef : e.category ? categoryRef : e.email ? emailRef : e.competitors ? firstCompRef : null;
    target?.current?.focus();
  }

  /** Ask the server to auto-detect brand/category/competitors/prompts from the
   *  store the shopper typed, then prefill the form. Best-effort — on any failure
   *  we just leave the form for manual entry (with a guessed brand name). */
  async function runInference(store: string) {
    setBusy("inferring");
    setInferNote("");
    setError("");
    try {
      const r = await inferStore(store);
      const guessedBrand = r.brand || brandFromInput(store);
      setBrand({
        name: guessedBrand,
        storeUrl: r.storeUrl || (looksLikeUrl(store) ? store.trim() : ""),
      });
      if (r.category) setCategory(r.category);
      if (r.competitors && r.competitors.length) {
        setCompetitors(r.competitors.map((name) => ({ name, storeUrl: "" })));
      }
      if (r.prompts && r.prompts.length) {
        setPrompts(r.prompts.map((text, i) => ({ category: "ai_suggested", text, selected: i < MINI_PROMPTS })));
      }
      if (r.error) {
        setInferNote("Couldn't auto-detect your store — fill in the details below.");
      } else if (guessedBrand) {
        setInferNote(`Detected ${guessedBrand}${r.category ? ` · ${r.category}` : ""}. Edit anything that's off.`);
      }
    } catch {
      const guessedBrand = brandFromInput(store);
      setBrand({ name: guessedBrand, storeUrl: looksLikeUrl(store) ? store.trim() : "" });
      setInferNote("Couldn't auto-detect your store — fill in the details below.");
    } finally {
      setBusy("");
    }
  }

  function startDetails(e?: React.FormEvent) {
    e?.preventDefault();
    const s = storeInput.trim();
    if (!s) return;
    setPhase("details");
    inferred.current = true;
    runInference(s);
  }

  /** Ensure prompts exist (generate + auto-select the mini default). */
  async function ensurePrompts(): Promise<PromptRow[] | null> {
    if (prompts.length) return prompts;
    const errs = collectErrors(false); // email not needed just to generate prompts
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      return null;
    }
    setFieldErrors({});
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
    const base = await ensurePrompts();
    if (!base) return;
    setBusy("suggesting");
    try {
      const { prompts: extra, costUsd, error: sErr } = await suggestPrompts(buildForm());
      if (sErr) {
        setSuggestErr(`Couldn't get AI suggestions: ${sErr}`);
        return;
      }
      // Dedupe against `base` (the freshly-ensured list), not the possibly-stale `prompts`
      // state — otherwise a suggestion duplicating a just-generated prompt slips through.
      const existing = new Set(base.map((p) => p.text.toLowerCase()));
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
    // Validate every field up front, surface the full list, and focus the first invalid one.
    const errs = collectErrors(true);
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      focusFirstError(errs);
      return;
    }
    setFieldErrors({});
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
        <p className="muted">Asking {enabledEngines.length} AI assistants your {selected.length} shopper prompts. This usually takes under a minute.</p>
        <pre className="progress-log">{progress.join("\n") || "Starting…"}</pre>
      </div>
    );
  }

  // ---- step 1: single store input ----
  if (phase === "entry") {
    return (
      <div className="scan-entry">
        <h1>See if AI recommends your store</h1>
        <p className="muted">Enter your store name or URL — we'll detect the rest.</p>
        <form className="hero-form" onSubmit={startDetails}>
          <input
            type="text"
            value={storeInput}
            onChange={(e) => setStoreInput(e.target.value)}
            placeholder="yourstore.com"
            aria-label="Your store name or URL"
            autoFocus
          />
          <button type="submit" className="btn btn-primary lg">
            Run free scan
          </button>
        </form>
        <div className="hero-trust">Free scan · instant on-screen report</div>
      </div>
    );
  }

  // ---- step 2: details (auto-detected, editable) ----
  const errorList = [fieldErrors.brand, fieldErrors.category, fieldErrors.email, fieldErrors.competitors].filter(Boolean) as string[];
  return (
    <div className="scanpage">
      <h1 className="report-headline">Confirm your store</h1>
      <p className="muted" style={{ marginTop: -6 }}>
        {busy === "inferring"
          ? "Detecting your brand, category, and competitors…"
          : "We'll ask ChatGPT, Gemini, and Perplexity what real shoppers ask — and show who they recommend."}
      </p>

      {inferNote && busy !== "inferring" && <div className="infer-note">{inferNote}</div>}

      {errorList.length > 0 && (
        <div className="banner-error scan-error-summary" role="alert">
          <strong>Please fix {errorList.length === 1 ? "this" : "these"} before running:</strong>
          <ul>{errorList.map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      )}

      <fieldset className="scan-fields" disabled={busy === "inferring"}>
        <div className="card formcard">
          <h3>Your store</h3>
          <div className="form-grid">
            <Field label="Brand name *" error={fieldErrors.brand} errorId="err-brand">
              <input ref={brandRef} value={brand.name}
                onChange={(e) => { setBrand({ ...brand, name: e.target.value }); clearFieldError("brand"); }}
                placeholder="Olipop"
                aria-invalid={fieldErrors.brand ? true : undefined}
                aria-describedby={fieldErrors.brand ? "err-brand" : undefined} />
            </Field>
            <Field label="Category *" error={fieldErrors.category} errorId="err-category">
              <input ref={categoryRef} value={category}
                onChange={(e) => { setCategory(e.target.value); clearFieldError("category"); }}
                placeholder="nonstick cookware"
                aria-invalid={fieldErrors.category ? true : undefined}
                aria-describedby={fieldErrors.category ? "err-category" : undefined} />
            </Field>
            <Field label="Your email *" error={fieldErrors.email} errorId="err-email">
              <input ref={emailRef} type="email" value={email}
                onChange={(e) => { setEmail(e.target.value); clearFieldError("email"); }}
                placeholder="you@store.com"
                aria-invalid={fieldErrors.email ? true : undefined}
                aria-describedby={fieldErrors.email ? "err-email" : undefined} />
            </Field>
          </div>
        </div>

        <div className="card formcard">
          <h3>Competitors <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· at least one</span></h3>
          {competitors.map((c, i) => (
            <div className="comp-row" key={i}>
              <input
                ref={i === 0 ? firstCompRef : undefined}
                placeholder="Competitor name"
                value={c.name}
                onChange={(e) => { updateComp(i, { name: e.target.value }); clearFieldError("competitors"); }}
                aria-invalid={i === 0 && fieldErrors.competitors ? true : undefined}
                aria-describedby={fieldErrors.competitors ? "err-competitors" : undefined}
              />
              <input
                placeholder="Store URL (optional)"
                value={c.storeUrl ?? ""}
                onChange={(e) => updateComp(i, { storeUrl: e.target.value })}
              />
              <button className="btn icon" aria-label="Remove competitor" onClick={() => setCompetitors(competitors.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
          ))}
          {fieldErrors.competitors && <span className="field-error" id="err-competitors">{fieldErrors.competitors}</span>}
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
                      aria-label="Remove prompt"
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
                    Est. max cost <b>${estMaxCost.toFixed(3)}</b> (cap ${scanCostCapUsd.toFixed(2)})
                  </div>
                </div>
              </div>
            </>
          )}
        </details>
      </fieldset>

      {overCap && (
        <div className="banner-error">
          Over the ${scanCostCapUsd.toFixed(2)} mini-scan cap. Deselect prompts or engines in “Customize prompts”.
        </div>
      )}
      {enabledEngines.length === 0 && (
        <div className="banner-error">Select at least one AI assistant (in “Customize prompts”) to run a scan.</div>
      )}
      {prompts.length > 0 && selected.length === 0 && (
        <div className="banner-error">Select at least one prompt to run a scan.</div>
      )}
      {error && <div className="banner-error" role="alert">{error}</div>}

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
          disabled={busy === "inferring" || busy === "generating" || busy === "starting" || overCap || enabledEngines.length === 0 || (prompts.length > 0 && selected.length === 0)}
          onClick={openConfirm}
        >
          {busy === "inferring" ? "Detecting…" : busy === "generating" ? "Preparing…" : "Run free scan →"}
        </button>
        <span className="muted" style={{ alignSelf: "center", fontSize: 12.5 }}>
          {prompts.length ? `${selected.length} shopper prompts × ${enabledEngines.length} AI assistants` : `${MINI_PROMPTS} shopper prompts × 3 AI assistants`}
        </span>
      </div>

      {showConfirm && (
        <div className="modal-overlay" onClick={() => setShowConfirm(false)}>
          <div ref={confirmRef} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="confirm-title">Run a live scan?</h3>
            <p className="muted">
              AisleLens will ask{" "}
              <b>{selected.length} realistic shopper {selected.length === 1 ? "question" : "questions"}</b> across{" "}
              {enabledEngines.map((e) => ENGINE_LABEL[e]).join(", ")} and compare who they recommend. That's{" "}
              <b>{selected.length * enabledEngines.length} live API calls</b>, costing up to{" "}
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

function Field({ label, error, errorId, children }: { label: string; error?: string; errorId?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error && <span className="field-error" id={errorId}>{error}</span>}
    </label>
  );
}
