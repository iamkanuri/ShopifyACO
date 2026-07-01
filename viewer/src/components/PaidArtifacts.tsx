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

export function PaidArtifacts({ bundle }: { bundle: ArtifactBundle }) {
  return (
    <section className="section">
      <div className="card artifacts-card">
        <h2 style={{ marginTop: 0 }}>Your done-for-you fixes</h2>
        <p className="muted">
          Ready-to-adapt drafts written from this scan. Fill every <code>[placeholder]</code> with your
          real, verifiable details before publishing.
        </p>
        {bundle.artifacts.map((a) => (
          <details key={a.id} className="artifact">
            <summary>
              <b>{a.title}</b>{" "}
              <span className="muted">
                · {a.drafted === "llm" ? "drafted" : "scaffold"}
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
        ))}
        <div className="artifact-bridge">{bundle.bridge}</div>
      </div>
    </section>
  );
}
