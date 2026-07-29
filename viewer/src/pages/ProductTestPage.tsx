import { useEffect, useRef, useState } from "react";
import { Link, navigate } from "../router";
import { ConnectShopify } from "../components/ConnectShopify";

// PHASE B — the AI-buyer PRODUCT TEST result page. Paste a Shopify product URL →
// a buyer task of 4–6 requirements run as honest, evidence-availability assertions
// against public data → an assertion-table result. This is the funnel mechanic the
// repositioned hero promises: the interface IS the test runner.

// The four honest result states. `pass_no_blocking` renders deliberately WEAKER
// than `pass_evidenced` (neutral glyph + muted label): an inference from absence
// is never presented as proof.
type AssertionStatus = "pass_evidenced" | "pass_no_blocking" | "not_proven" | "requires_store_access";
interface Assertion {
  label: string; status: AssertionStatus; detail: string;
  evidenceQuote?: string; evidenceSurface?: string; surfacesChecked: string[];
}
interface TestResult {
  ok: boolean; error?: string; errorKind?: string; productUrl: string;
  storeName: string | null; productName: string | null; task: string;
  assertions: Assertion[];
  evidencedCount: number; noBlockingCount: number; notProvenCount: number; requiresAccessCount: number;
  total: number; surfacesChecked: string[]; notInspectable: string[];
  suggestedCorrections: string[]; suggestedCorrection: string | null;
  deferred: Assertion[];
  testedAt?: string; cached?: boolean;
  /** V2 §2.3 — a fetch tier was refused upstream and the test ran on partial data.
   *  The affected rows carry their own accurate reason; this drives the banner. */
  degraded?: boolean;
  /** The failure is an upstream limit, not a verdict — offer a retry, not a shrug. */
  retryable?: boolean;
  /** Carries THIS result through install so the first authenticated screen is the
   *  merchant's own test, continued. Also ties a later install click back to it. */
  testToken?: string;
}

const RESULT_LABEL: Record<AssertionStatus, string> = {
  pass_evidenced: "Proven",
  pass_no_blocking: "No blocking evidence",
  not_proven: "Not proven",
  requires_store_access: "Requires store access",
};
const RESULT_MARK: Record<AssertionStatus, string> = {
  pass_evidenced: "✓", pass_no_blocking: "–", not_proven: "✕", requires_store_access: "○",
};

function Row({ a }: { a: Assertion }) {
  return (
    <tr className={`pt-row pt-${a.status}`}>
      <td className="pt-req">{a.label}</td>
      <td className="pt-res">
        <span className="pt-mark" aria-hidden>{RESULT_MARK[a.status]}</span>
        <span>
          <b>{RESULT_LABEL[a.status]}</b>
          <div className="pt-detail">{a.detail}</div>
          {a.evidenceQuote && (
            <div className="pt-quote">
              “{a.evidenceQuote}”{a.evidenceSurface ? <span className="pt-src"> — {a.evidenceSurface}</span> : null}
            </div>
          )}
        </span>
      </td>
    </tr>
  );
}

/** Coarse relative time for the cache label. Results now live 7 days (V2 §2.4), so
 *  this has to read naturally all the way out to "6 days ago". */
function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** "3 proven · 1 no blocking evidence · 1 unproven · 1 needs store access (not counted against you)" */
function breakdown(r: TestResult): string {
  const parts = [`${r.evidencedCount} proven`];
  if (r.noBlockingCount) parts.push(`${r.noBlockingCount} no blocking evidence`);
  if (r.notProvenCount) parts.push(`${r.notProvenCount} unproven`);
  if (r.requiresAccessCount) parts.push(`${r.requiresAccessCount} need store access (not counted against you)`);
  return parts.join(" · ");
}

export function ProductTestPage() {
  const initialUrl = new URLSearchParams(window.location.search).get("url") ?? "";
  const [url, setUrl] = useState(initialUrl);
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">(initialUrl ? "running" : "idle");
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState("");
  const [retryable, setRetryable] = useState(false);
  const ran = useRef(false);

  async function run(target: string, force = false) {
    setPhase("running");
    setError("");
    setRetryable(false);
    setResult(null);
    try {
      const res = await fetch("/api/product-test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: target, force }),
      });
      const data = (await res.json()) as TestResult & { error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error || "Couldn't run the test on that URL.");
        setRetryable(Boolean(data.retryable));
        setPhase("error");
        return;
      }
      setResult(data);
      // Remember which test this was, so a later "Connect Shopify" click can be tied
      // back to it. The token is the server's own unguessable id and the host is
      // already public; neither identifies a person. Same pattern as `al_last_run`.
      try {
        if (data.testToken) localStorage.setItem("al_last_test_token", data.testToken);
        localStorage.setItem("al_last_test_host", new URL(/^https?:\/\//i.test(target) ? target : `https://${target}`).host);
      } catch { /* private mode / bad URL — telemetry is optional */ }
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

  // The headline counts ONLY merchant-addressable gaps. Surfaces we can't reach are
  // never held against the store (that's our access limit, not their omission).
  const unresolved = result ? result.notProvenCount : 0;

  return (
    <div className="scanpage pt-page">
      <h1 className="report-headline">Can an AI buyer verify this product?</h1>
      <p className="muted" style={{ marginTop: -6 }}>
        One product. One buyer task. Every requirement proven from your public store data — or honestly marked unproven.
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
        <div className="banner-error" role="alert" style={{ marginTop: 16 }}>
          {error}
          {/* An upstream rate limit is transient and not a verdict on the store, so
              the honest affordance is a retry rather than a dead end (V2 §2.3). */}
          {retryable && (
            <>
              {" "}
              <button className="as-link" onClick={() => run(url.trim() || initialUrl, true)}>Try again</button>
            </>
          )}
        </div>
      )}

      {phase === "done" && result && (
        <div className="testcard pt-result" style={{ maxWidth: 720, margin: "18px 0 0" }}>
          <div className="testcard-head">
            <span className="tc-dot" aria-hidden /> BUYER TEST
            {result.storeName ? ` · ${result.storeName}` : ""}
            {result.productName ? ` · ${result.productName}` : ""}
          </div>
          <div className="testcard-task"><b>Task:</b> {result.task}</div>

          {/* No "FAILED" verdict: the unresolved count is the same fact without the
              accusation. Crimson stays on the individual unproven rows. */}
          <div className={`pt-outcome ${unresolved === 0 ? "clean" : ""}`}>
            {unresolved === 0
              ? "RESULT: every requirement we could check from public data is proven"
              : `RESULT: ${unresolved} of ${result.total} requirement${unresolved === 1 ? "" : "s"} could not be proven from your public store data`}
          </div>
          <div className="pt-breakdown">{breakdown(result)}</div>

          {/* A partial test says so, up front. The affected rows already carry the
              accurate per-row reason; this makes the whole result legible without
              the merchant having to infer it (V2 §2.3). */}
          {result.degraded && (
            <div className="pt-degraded" role="status">
              <b>Partial test.</b> Some of this store's product endpoints were limiting automated
              requests while we ran, so we couldn't read every surface. The rows below say which.
              That's an upstream limit rather than something about this store —{" "}
              <button className="as-link" onClick={() => run(result.productUrl, true)}>run it again</button> in a few minutes for the full picture.
            </div>
          )}

          {result.cached && result.testedAt && (
            <div className="pt-cached">
              Tested {timeAgo(result.testedAt)} · <button className="as-link" onClick={() => run(result.productUrl, true)}>Run again</button>
            </div>
          )}

          <table className="pt-table">
            <thead><tr><th>Buyer requirement</th><th>Result</th></tr></thead>
            <tbody>{result.assertions.map((a, i) => <Row a={a} key={i} />)}</tbody>
          </table>

          <div className="pt-trace">
            <b>Evidence trace:</b> AisleLens checked {result.surfacesChecked.join(", ")}.
            {result.notInspectable.length > 0 && (
              <> <i>Not inspectable without store access: {result.notInspectable.join(", ")}. We do not report these as missing.</i></>
            )}
          </div>

          {result.suggestedCorrections.length > 0 && (
            <div className="pt-suggest">
              <b>Suggested {result.suggestedCorrections.length === 1 ? "correction" : "corrections"}:</b>
              <ul className="pt-fixlist">
                {result.suggestedCorrections.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}

          {/* Requirements public data can't decide are the INSTALL ARGUMENT, not
              blind rows in the merchant's result table. */}
          <div className="pt-cta">
            <div className="pt-auth">
              <b>What authenticated testing adds</b>
              <p>
                Merchant-confirmed product facts · metafield evidence · full policy data · the fix,
                the rerun, and permanent regression tests.
                {result.deferred.length > 0 && (
                  <> <span className="muted">Also checkable with access: {result.deferred.map((d) => d.label.toLowerCase()).join(", ")}.</span></>
                )}
              </p>
            </div>
            {/* The ONE funnel-step CTA: it follows a completed test, so a click here
                has an originating test to attribute it to. Every other ConnectShopify
                on the site deliberately does not count. */}
            <ConnectShopify className="btn btn-primary" label="Connect Shopify to confirm, fix, and rerun" countAsFunnelStep />
            {/* ⚠️ THE LINE THAT WAS HERE SOLD THE RETIRED PRODUCT, in the last sentence a
                visitor reads: "how live AI assistants currently answer questions like this
                in your category — and which stores they send buyers to instead." It was
                also outside the lint surface entirely (not in PUBLIC_MARKETING_STRINGS), so
                no gate could see it. Replaced with the thing that is actually true of this
                result and is the reason to connect: the same contract, re-run, as proof. */}
            <p className="pt-enrich"><i>Connecting re-runs this exact contract with your metafields and policy data readable, so a fix can be proven rather than asserted.</i></p>
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
