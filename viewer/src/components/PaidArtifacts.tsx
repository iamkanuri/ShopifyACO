import type { ArtifactBundle } from "../types";

// The $29 done-for-you artifacts (Phase 2). Each is a ready-to-adapt draft; [placeholders] are
// where the merchant fills in their own verifiable facts (we never fabricate store data). The
// bundle closes with the recurring-app bridge.

function download(filename: string, body: string) {
  const blob = new Blob([body], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Count crawled-fact provenance tags — "(fact Fn — crawled …)" — in an artifact. */
function sourcedFactCount(provenance: string[] | undefined): number {
  return (provenance ?? []).filter((t) => /^\(fact\s+F\d+/i.test(t)).length;
}

export function PaidArtifacts({ bundle, demo = false }: { bundle: ArtifactBundle; demo?: boolean }) {
  // Whether the store crawl produced facts (drives the honest note) — from the bundle, NOT a tag count
  // (llms.txt / schema embed crawled values WITHOUT (fact Fn) tags, so counting tags undercounts).
  const totalSourced = bundle.sourcedFacts ?? bundle.artifacts.reduce((n, a) => n + sourcedFactCount(a.provenance), 0);
  return (
    <section className="section">
      <div className="card artifacts-card">
        <h2 style={{ marginTop: 0 }}>Your done-for-you fixes</h2>
        <p className="muted">
          Ready-to-adapt drafts written from this scan. Fill every <code>[placeholder]</code> with your
          real, verifiable details before publishing.
          {totalSourced > 0 && (
            <>
              {" "}Lines tagged <code>(fact … — crawled …)</code> were read from your live store —{" "}
              <b>{totalSourced}</b> sourced {totalSourced === 1 ? "fact" : "facts"} in all. Verify each
              tagged line and remove the tags before publishing.
            </>
          )}
        </p>
        {totalSourced === 0 && demo && (
          <p className="muted" style={{ borderLeft: "3px solid var(--accent, #5b8def)", paddingLeft: 10 }}>
            <b>These are demo scaffolds.</b> They show the exact structure and value you'd get — with{" "}
            <code>[placeholders]</code> in place of invented facts. In <b>your</b> paid report, every placeholder{" "}
            <b>auto-fills from your real store data</b> — prices, ratings, and product details read straight from
            your live site. AisleLens drafts from your real data; it never makes facts up.
          </p>
        )}
        {totalSourced === 0 && !demo && (
          <p className="muted" style={{ borderLeft: "3px solid var(--warn, #c90)", paddingLeft: 10 }}>
            These are <b>fill-in templates</b> — we couldn't pull sourced facts from your live store. If you
            didn't give us your store URL, add it and run a fresh scan to auto-fill your real prices, ratings,
            and product details.
          </p>
        )}
        {bundle.artifacts.map((a) => {
          const sourced = sourcedFactCount(a.provenance);
          return (
            <details key={a.id} className="artifact">
              <summary>
                <b>{a.title}</b>{" "}
                <span className="muted">
                  · {a.drafted === "llm" ? "drafted" : "scaffold"}
                  {sourced ? ` · ${sourced} sourced ${sourced === 1 ? "fact" : "facts"}` : ""}
                  {a.placeholders.length ? ` · ${a.placeholders.length} to fill in` : ""}
                </span>
              </summary>
              <div className="artifact-body">
                <div className="artifact-actions">
                  <button className="btn" onClick={() => download(a.filename, a.body)}>Download {a.filename}</button>
                  <button className="btn" onClick={() => navigator.clipboard?.writeText(a.body).catch(() => {})}>Copy</button>
                </div>
                <pre className="artifact-pre">{a.body}</pre>
              </div>
            </details>
          );
        })}
        <div className="artifact-bridge">{bundle.bridge}</div>
      </div>
    </section>
  );
}
