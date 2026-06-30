import { useState } from "react";
import { trackEvent } from "../api";

// Share affordance on a claimed report: copy-link + prefilled X / LinkedIn share URLs, so the
// scorecard self-propagates. The link is the report's unguessable /report/:id; when pasted it
// unfurls into the dynamic OG card (brand · score · gap). No PII in the link or the text.
export function ShareBar({ runId, shareText }: { runId: string; shareText: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/report/${runId}`;
  const xUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(url)}`;
  const liUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      trackEvent("report_share_copy", runId, {});
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked (iframe perms) — the share buttons still work */ }
  }

  return (
    <div className="sharebar no-print">
      <span className="muted sharebar-label">Share your scorecard</span>
      <button className="btn" onClick={copy}>{copied ? "Link copied ✓" : "Copy link"}</button>
      <a className="btn" href={xUrl} target="_blank" rel="noopener noreferrer" onClick={() => trackEvent("report_share_x", runId, {})}>Post on X</a>
      <a className="btn" href={liUrl} target="_blank" rel="noopener noreferrer" onClick={() => trackEvent("report_share_linkedin", runId, {})}>Share on LinkedIn</a>
    </div>
  );
}
