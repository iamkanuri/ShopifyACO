import { useEffect, useRef, useState } from "react";
import {
  claimBuyerTest, confirmRequirement, createBuyerTest, getBuyerTest, getBuyerTests,
  getCatalog, getConfirmQuestions, getTestProposals, proposeFromTest, runBuyerTest,
  approveFix, applyFix, rollbackFix, dismissFix,
  type BuyerTestAssertion, type BuyerTestDelta, type BuyerTestResultView, type BuyerTestRow,
  type ConfirmQuestion,
} from "./appApi";
import { useLoaded, StatePane } from "./ui";
import { navigate } from "../router";

// ===========================================================================
// V2 CP2/CP3 — THE AUTHENTICATED BUYER TEST, and the loop that closes it.
//
// This screen exists because of one specific funnel leak: a merchant ran a public
// test, saw "2 requirements could not be proven", clicked "Connect Shopify to
// confirm, fix, and rerun" — and landed on a dashboard that talked about
// visibility scores. That discontinuity killed the conversion the test had just
// earned. So the first authenticated screen IS their test, continued.
//
// Honesty rules this screen enforces:
//   • NO SAMPLE DATA, ever. Every other screen may fall back to the labeled demo
//     fixture because it illustrates a capability. A Buyer Test is a claim about
//     THIS store, so a sample one would be a lie with the merchant's name on it.
//     No data means an empty state.
//   • "requires store access" is never rendered as a failure or counted against
//     the store, in either run.
//   • The confirm step ASKS; it never asserts. A "no" closes the row and says so.
//   • Nothing is written without an explicit approval on the exact diff shown.
// ===========================================================================

const STATUS_LABEL: Record<BuyerTestAssertion["status"], string> = {
  pass_evidenced: "Proven",
  pass_no_blocking: "No blocking evidence",
  not_proven: "Not proven",
  requires_store_access: "Requires store access",
};
const STATUS_MARK: Record<BuyerTestAssertion["status"], string> = {
  pass_evidenced: "✓", pass_no_blocking: "–", not_proven: "✕", requires_store_access: "○",
};
const CHANGE_LABEL: Record<BuyerTestDelta["change"], string> = {
  resolved: "Now checkable", improved: "Improved", regressed: "Regressed", unchanged: "",
};

function AssertionTable({ result, deltas }: { result: BuyerTestResultView; deltas?: BuyerTestDelta[] }) {
  const byLabel = new Map((deltas ?? []).map((d) => [d.label, d]));
  return (
    <table className="pt-table bt-table">
      <thead>
        <tr>
          <th>Buyer requirement</th>
          <th>Result</th>
          {deltas && deltas.length > 0 && <th className="bt-changecol">Change</th>}
        </tr>
      </thead>
      <tbody>
        {result.assertions.map((a, i) => {
          const d = byLabel.get(a.label);
          return (
            <tr key={i} className={`pt-row pt-${a.status}`}>
              <td className="pt-req">{a.label}</td>
              <td className="pt-res">
                <span className="pt-mark" aria-hidden>{STATUS_MARK[a.status]}</span>
                <span>
                  <b>{STATUS_LABEL[a.status]}</b>
                  <div className="pt-detail">{a.detail}</div>
                  {a.evidenceQuote && (
                    <div className="pt-quote">
                      “{a.evidenceQuote}”{a.evidenceSurface ? <span className="pt-src"> — {a.evidenceSurface}</span> : null}
                    </div>
                  )}
                </span>
              </td>
              {deltas && deltas.length > 0 && (
                <td className="bt-changecol">
                  {d && d.change !== "unchanged" ? (
                    <span className={`bt-change bt-${d.change}`}>{CHANGE_LABEL[d.change]}</span>
                  ) : <span className="muted">—</span>}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The headline counts only rows the merchant can act on. Surfaces we can't reach
 *  are our limit, never their omission — so they are excluded and said so. */
function Headline({ r }: { r: BuyerTestResultView }) {
  const parts = [`${r.evidencedCount} proven`];
  if (r.noBlockingCount) parts.push(`${r.noBlockingCount} no blocking evidence`);
  if (r.notProvenCount) parts.push(`${r.notProvenCount} unproven`);
  if (r.requiresAccessCount) parts.push(`${r.requiresAccessCount} need store access (not counted against you)`);
  return (
    <>
      <div className={`pt-outcome ${r.notProvenCount === 0 ? "clean" : ""}`}>
        {r.notProvenCount === 0
          ? "RESULT: every requirement we could check is proven"
          : `RESULT: ${r.notProvenCount} of ${r.total} requirement${r.notProvenCount === 1 ? "" : "s"} could not be proven from your store data`}
      </div>
      <div className="pt-breakdown">{parts.join(" · ")}</div>
    </>
  );
}

// ---- the confirm → propose → approve → apply → rerun loop -------------------

function ConfirmStep({ testId, onChanged }: { testId: number; onChanged: () => void }) {
  const { data, loading, reload } = useLoaded(() => getConfirmQuestions(testId), [testId]);
  const [busy, setBusy] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function answer(q: ConfirmQuestion, a: "yes" | "no" | "unsure") {
    setBusy(q.requirementId);
    const res = await confirmRequirement(testId, q.requirementId, a);
    setNotes((n) => ({ ...n, [q.requirementId]: res.data?.message ?? res.error ?? "" }));
    setBusy("");
    reload();
    onChanged();
  }

  async function propose(q: ConfirmQuestion) {
    setBusy(q.requirementId);
    const res = await proposeFromTest(testId, q.requirementId);
    setNotes((n) => ({
      ...n,
      [q.requirementId]: res.ok ? "Proposed — review the exact change below before anything is written." : (res.error ?? "Couldn't propose a change."),
    }));
    setBusy("");
    onChanged();
  }

  const questions = data?.questions ?? [];
  return (
    <section className="al-card bt-confirm">
      <h2>Confirm</h2>
      <p className="muted">
        These are the questions only you can answer. The test can tell you an AI buyer
        couldn't <i>verify</i> something; it can't tell you whether it's true of your product.
      </p>
      <StatePane loading={loading} empty={questions.length === 0} emptyText="Nothing to confirm — every claim in this test is already proven from your store data.">
        <ul className="bt-qlist">
          {questions.map((q) => (
            <li key={q.requirementId} className="bt-q">
              <div className="bt-qtext">{q.question}</div>
              <div className="bt-qdetail muted">{q.detail}</div>
              <div className="bt-qactions">
                <button className="btn btn-sm" disabled={busy === q.requirementId} onClick={() => answer(q, "yes")}
                  aria-pressed={q.answer === "yes"}>Yes</button>
                <button className="btn btn-sm" disabled={busy === q.requirementId} onClick={() => answer(q, "no")}
                  aria-pressed={q.answer === "no"}>No</button>
                <button className="btn btn-sm" disabled={busy === q.requirementId} onClick={() => answer(q, "unsure")}
                  aria-pressed={q.answer === "unsure"}>Not sure</button>
                {q.answer === "yes" && (
                  <button className="btn btn-sm btn-primary" disabled={busy === q.requirementId} onClick={() => propose(q)}>
                    Propose the change
                  </button>
                )}
              </div>
              {q.answer === "no" && (
                <div className="bt-closed">
                  Closed — an AI buyer is right not to verify this, and no fix is needed.
                </div>
              )}
              {notes[q.requirementId] && <div className="bt-note">{notes[q.requirementId]}</div>}
            </li>
          ))}
        </ul>
      </StatePane>
    </section>
  );
}

function ProposalsStep({ testId, onApplied }: { testId: number; onApplied: () => void }) {
  const { data, loading, reload } = useLoaded(() => getTestProposals(testId), [testId]);
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<Record<number, string>>({});

  async function act(id: number, fn: (i: number) => Promise<{ ok: boolean; error?: string }>, label: string) {
    setBusy(id);
    const res = await fn(id);
    setMsg((m) => ({ ...m, [id]: res.ok ? `${label} ✓` : (res.error ?? `Couldn't ${label.toLowerCase()}.`) }));
    setBusy(null);
    reload();
    if (res.ok) onApplied();
  }

  const proposals = data?.proposals ?? [];
  return (
    <section className="al-card bt-proposals">
      <h2>Proposed changes</h2>
      <p className="muted">
        Nothing here is written to your store until you approve the exact change shown.
        Every applied change keeps a snapshot and can be rolled back.
      </p>
      <StatePane loading={loading} empty={proposals.length === 0} emptyText="No proposed changes yet. Confirm a claim above to generate one.">
        <ul className="bt-plist">
          {proposals.map((p) => {
            const id = Number(p.id);
            const status = String(p.status);
            return (
              <li key={id} className="bt-p">
                <div className="bt-phead">
                  <b>{String(p.label)}</b>
                  <span className={`bt-status bt-s-${status}`}>{status}</span>
                </div>
                {p.rationale && <div className="bt-prationale muted">{String(p.rationale)}</div>}
                <div className="bt-diff">
                  <div className="bt-diff-side">
                    <div className="bt-diff-lab">Now</div>
                    <pre>{String(p.current_value ?? "(empty)")}</pre>
                  </div>
                  <div className="bt-diff-side">
                    <div className="bt-diff-lab">After</div>
                    <pre className="bt-diff-new">{String(p.proposed_value ?? "")}</pre>
                  </div>
                </div>
                <div className="bt-pactions">
                  {status === "proposed" && (
                    <>
                      <button className="btn btn-sm btn-primary" disabled={busy === id} onClick={() => act(id, approveFix, "Approved")}>Approve</button>
                      <button className="btn btn-sm" disabled={busy === id} onClick={() => act(id, dismissFix, "Dismissed")}>Dismiss</button>
                    </>
                  )}
                  {(status === "approved" || status === "failed") && (
                    <button className="btn btn-sm btn-primary" disabled={busy === id} onClick={() => act(id, applyFix, "Applied")}>Apply to my store</button>
                  )}
                  {status === "applied" && (
                    <button className="btn btn-sm" disabled={busy === id} onClick={() => act(id, rollbackFix, "Rolled back")}>Roll back</button>
                  )}
                </div>
                {p.error && <div className="bt-err">{String(p.error)}</div>}
                {msg[id] && <div className="bt-note">{msg[id]}</div>}
              </li>
            );
          })}
        </ul>
      </StatePane>
    </section>
  );
}

// ---- one saved test: the whole loop on a single screen ---------------------

export function BuyerTestDetail({ id }: { id: number }) {
  const { data, loading, reload } = useLoaded(() => getBuyerTest(id), [id]);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [fresh, setFresh] = useState<BuyerTestResultView | null>(null);

  async function rerun(trigger?: string) {
    setRunning(true);
    setRunError("");
    const res = await runBuyerTest(id, trigger);
    if (res.ok && res.data) setFresh(res.data);
    // A refusal (changed contract / engine) is shown verbatim: it is a real,
    // deliberate outcome, not a transient error to retry away.
    else setRunError(res.error ?? "Couldn't run this test.");
    setRunning(false);
    reload();
  }

  const test = data?.test ?? null;
  const result = fresh ?? test?.latest ?? test?.baseline ?? null;
  const isAuthenticated = Boolean(fresh ?? test?.latest);

  return (
    <div className="al-screen bt-detail">
      <StatePane loading={loading} empty={!test} emptyText="That test isn't available for this store.">
        {test && (
          <>
            <header className="al-head">
              <div>
                <h1>{isAuthenticated ? "Your Buyer Test, now with full store access" : "Your Buyer Test"}</h1>
                <p className="muted">
                  {test.productTitle ?? test.productUrl}
                  {" · "}
                  <span title={`contract ${test.contractVersion} · engine ${test.engineVersion}`}>
                    contract {test.contractVersion}
                  </span>
                </p>
              </div>
              <button className="btn btn-primary" disabled={running} onClick={() => rerun("manual")}>
                {running ? "Running…" : "Re-run this test"}
              </button>
            </header>

            {runError && <div className="banner-error" role="alert">{runError}</div>}

            {result && (
              <section className="al-card">
                <div className="bt-task"><b>Task:</b> {result.task || test.contract.summary}</div>
                <Headline r={result} />
                {(result.resolvedCount ?? 0) > 0 && (
                  <div className="bt-resolved">
                    {result.resolvedCount} requirement{result.resolvedCount === 1 ? "" : "s"} that public data
                    couldn't reach {result.resolvedCount === 1 ? "is" : "are"} now checkable with your store connected.
                  </div>
                )}
                <AssertionTable result={result} deltas={result.deltas} />
                {result.surfacesChecked.length > 0 && (
                  <div className="pt-trace"><b>Evidence trace:</b> checked {result.surfacesChecked.join(", ")}.</div>
                )}
              </section>
            )}

            <ConfirmStep testId={id} onChanged={reload} />
            <ProposalsStep testId={id} onApplied={() => rerun("post_fix")} />

            <section className="al-card bt-history">
              <h2>History</h2>
              <p className="muted">
                This test is saved. Re-run it any time to check the same requirements against
                your current store data.
              </p>
              <StatePane loading={false} empty={(data?.runs ?? []).length === 0} emptyText="No runs recorded yet.">
                <table className="al-table">
                  <thead><tr><th>When</th><th>Mode</th><th>Trigger</th><th>Unproven</th></tr></thead>
                  <tbody>
                    {(data?.runs ?? []).map((r, i) => {
                      const res = r.result as BuyerTestResultView | null;
                      return (
                        <tr key={i}>
                          <td>{new Date(String(r.created_at)).toLocaleString()}</td>
                          <td>{String(r.mode)}</td>
                          <td>{String(r.trigger)}</td>
                          <td>{res ? `${res.notProvenCount} of ${res.total}` : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </StatePane>
              <p className="muted bt-fineprint">
                Automatic re-runs on product edits, policy edits, catalog sync and engine
                updates are planned; today re-runs are manual.
              </p>
            </section>
          </>
        )}
      </StatePane>
    </div>
  );
}

// ---- the Tests home: continue the public test, or start the first one -------

function ProductPicker({ onPicked }: { onPicked: (gid: string) => void }) {
  const [q, setQ] = useState("");
  const { data, loading } = useLoaded(() => getCatalog({ limit: 25, q }), [q]);
  return (
    <section className="al-card">
      <h2>Run your first Buyer Test</h2>
      <p className="muted">Pick a product. We'll build a buyer task for it and check every requirement against your store data.</p>
      <input className="bt-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your catalog" aria-label="Search your catalog" />
      <StatePane loading={loading} empty={(data?.products ?? []).length === 0} emptyText="No products found. Sync your catalog first.">
        <ul className="bt-picker">
          {(data?.products ?? []).map((p) => (
            <li key={String(p.product_gid)}>
              <button className="btn btn-sm" onClick={() => onPicked(String(p.product_gid))}>
                {String(p.title ?? p.product_gid)}
              </button>
            </li>
          ))}
        </ul>
      </StatePane>
    </section>
  );
}

export function BuyerTests() {
  const { data, loading, reload } = useLoaded(() => getBuyerTests(), []);
  const [claiming, setClaiming] = useState(false);
  const [claimMsg, setClaimMsg] = useState("");
  const [creating, setCreating] = useState(false);
  const tried = useRef(false);

  // On first authenticated load, try to CONTINUE the public test this merchant just
  // ran. The token arrives on our own OAuth redirect (?t=); the App Store install
  // path carries none, so the server falls back to matching this store's storefront
  // host. Either way the merchant lands on their own test, not a cold app.
  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    const token = new URLSearchParams(window.location.search).get("t") ?? undefined;
    (async () => {
      setClaiming(true);
      const res = await claimBuyerTest(token);
      if (res.ok && res.data?.testId) {
        navigate(`/app/tests/${res.data.testId}`);
        return;
      }
      // No public test to import is a completely normal state (a direct install) —
      // it is not an error and must not be shown as one.
      setClaiming(false);
      reload();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startFrom(gid: string) {
    setCreating(true);
    const res = await createBuyerTest(gid);
    setCreating(false);
    if (res.ok && res.data?.testId) navigate(`/app/tests/${res.data.testId}`);
    else setClaimMsg(res.error ?? "Couldn't start a test for that product.");
  }

  const tests = data?.tests ?? [];
  return (
    <div className="al-screen">
      <header className="al-head">
        <div>
          <h1>Tests</h1>
          <p className="muted">Every Buyer Test you've run, and the requirements each one checks.</p>
        </div>
      </header>

      {(claiming || creating) && <div className="al-state">{claiming ? "Looking for your Buyer Test…" : "Building your test…"}</div>}
      {claimMsg && <div className="banner-error" role="alert">{claimMsg}</div>}

      {!claiming && (
        <StatePane loading={loading} empty={tests.length === 0} emptyText="">
          {tests.length > 0 ? (
            <section className="al-card">
              <table className="al-table">
                <thead><tr><th>Product</th><th>Task</th><th>Last result</th><th>Updated</th><th /></tr></thead>
                <tbody>
                  {tests.map((t: BuyerTestRow) => {
                    const r = t.latest ?? t.baseline;
                    return (
                      <tr key={t.id}>
                        <td>{t.productTitle ?? t.productUrl}</td>
                        <td className="muted">{t.contract.summary}</td>
                        <td>{r ? `${r.notProvenCount} of ${r.total} unproven` : "not run yet"}</td>
                        <td className="muted">{new Date(t.updatedAt).toLocaleDateString()}</td>
                        <td><button className="btn btn-sm" onClick={() => navigate(`/app/tests/${t.id}`)}>Open</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          ) : null}
        </StatePane>
      )}

      {!claiming && !loading && <ProductPicker onPicked={startFrom} />}
    </div>
  );
}
