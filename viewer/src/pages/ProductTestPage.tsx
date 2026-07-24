import { useEffect, useRef, useState } from "react";
import { Link, navigate } from "../router";
import { ConnectShopify } from "../components/ConnectShopify";

// PHASE B — the AI-buyer PRODUCT TEST result page. Paste a Shopify product URL →
// a buyer task of 4–6 requirements run as honest, evidence-availability assertions
// against public data → an assertion-table result. This is the funnel mechanic the
// repositioned hero promises: the interface IS the test runner.

type AssertionStatus = "pass" | "fail_no_evidence" | "fail_value" | "requires_store_access";
interface Assertion { label: string; status: AssertionStatus; detail: string; evidenceQuote?: string }
interface TestResult {
  ok: boolean; error?: string; productUrl: string;
  storeName: string | null; productName: string | null; task: string;
  outcome: "passed" | "failed"; provenCount: number; total: number;
  assertions: Assertion[]; surfacesChecked: string[]; notInspectable: string[]; suggestedCorrection: string | null;
}

const RESULT_LABEL: Record<AssertionStatus, string> = {
  pass: "Pass",
  fail_no_evidence: "Fail — no evidence found",
  fail_value: "Fail",
  requires_store_access: "Requires store access",
};

function Row({ a }: { a: Assertion }) {
  const mark = a.status === "pass" ? "✓" : a.status === "requires_store_access" ? "○" : "✕";
  return (
    <tr className={`pt-row pt-${a.status}`}>
      <td className="pt-req">{a.label}</td>
      <td className="pt-res">
        <span className="pt-mark" aria-hidden>{mark}</span>
        <span>
          <b>{RESULT_LABEL[a.status]}</b>
          <div className="pt-detail">{a.status === "fail_value" ? a.detail : a.detail}</div>
          {a.evidenceQuote && <div className="pt-quote">“{a.evidenceQuote}”</div>}
        </span>
      </td>
    </tr>
  );
}

export function ProductTestPage() {
  const initialUrl = new URLSearchParams(window.location.search).get("url") ?? "";
  const [url, setUrl] = useState(initialUrl);
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">(initialUrl ? "running" : "idle");
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState("");
  const ran = useRef(false);

  async function run(target: string) {
    setPhase("running");
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/product-test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: target }),
      });
      const data = (await res.json()) as TestResult & { error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error || "Couldn't run the test on that URL.");
        setPhase("error");
        return;
      }
      setResult(data);
      setPhase("done");
    } catch {
      setError("Network error — try again.");
      setPhase("error");
    }
  }

  useEffect(() => {
    if (initialUrl && !ran.current) {
      ran.current = true;
      run(initialUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const q = url.trim();
    if (!q) return;
    navigate(`/test?url=${encodeURIComponent(q)}`);
    run(q);
  }

  const unproven = result ? result.total - result.provenCount : 0;

  return (
    <div className="scanpage pt-page">
      <h1 className="report-headline">AI buyer test</h1>
      <p className="muted" style={{ marginTop: -6 }}>
        One product. One buyer task. Pass or fail — with evidence, from your public store data only.
      </p>

      <form className="hero-form" style={{ margin: "18px 0 8px" }} onSubmit={submit}>
        <input
          type="text" inputMode="url" value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a Shopify product URL"
          aria-label="Shopify product URL"
        />
        <button type="submit" className="btn btn-primary" disabled={phase === "running"}>
          {phase === "running" ? "Running…" : "Run test"}
        </button>
      </form>

      {phase === "running" && (
        <div className="card scan-running">
          <div className="spinner" />
          <h2>Running your test…</h2>
          <p className="muted">Reading your public product data and checking each buyer requirement. A few seconds.</p>
        </div>
      )}

      {phase === "error" && (
        <div className="banner-error" role="alert" style={{ marginTop: 16 }}>{error}</div>
      )}

      {phase === "done" && result && (
        <div className="testcard pt-result" style={{ maxWidth: 720, margin: "18px 0 0" }}>
          <div className="testcard-head">
            <span className="tc-dot" aria-hidden /> AI BUYER TEST{result.storeName ? ` · ${result.storeName}` : ""}
          </div>
          <div className="testcard-task"><b>Test:</b> {result.task}</div>

          <div className={`pt-outcome ${result.outcome}`}>
            {result.outcome === "passed"
              ? `PASSED — all ${result.total} requirements proven`
              : `FAILED — ${unproven} of ${result.total} requirement${unproven === 1 ? "" : "s"} could not be proven`}
          </div>

          <table className="pt-table">
            <thead><tr><th>Buyer requirement</th><th>Result</th></tr></thead>
            <tbody>{result.assertions.map((a, i) => <Row a={a} key={i} />)}</tbody>
          </table>

          <div className="pt-trace">
            <b>Failure trace:</b> AisleLens checked {result.surfacesChecked.join(", ")}.
            {result.notInspectable.length > 0 && (
              <> <i>Not inspectable without store access: {result.notInspectable.join(", ")}. We do not report these as missing.</i></>
            )}
          </div>

          {result.suggestedCorrection && (
            <div className="pt-suggest"><b>Suggested correction:</b> {result.suggestedCorrection}</div>
          )}

          <div className="pt-cta">
            <ConnectShopify className="btn btn-primary" label="Connect Shopify to confirm, fix, and rerun" />
            <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
              Authenticated testing adds complete catalog data, merchant confirmation, reversible changes, and permanent regression tests.
            </p>
            <p className="pt-enrich"><i>Included in the full diagnostic: how live AI assistants currently answer questions like this in your category — and which stores they send buyers to instead.</i></p>
          </div>
        </div>
      )}

      {(phase === "done" || phase === "error") && (
        <p className="muted" style={{ fontSize: 12.5, marginTop: 18 }}>
          This test uses only your public store data. It reports what an AI buyer can verify — not what is true about your product. <Link to="/methodology">How testing works →</Link>
        </p>
      )}
    </div>
  );
}
