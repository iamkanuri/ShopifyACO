import { useState } from "react";
import type { MerchantAnalysis, RunResults } from "../types";

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportBar({
  run,
  reportMdUrl,
}: {
  run: RunResults;
  reportMdUrl?: string;
}) {
  const a = run.analysis as MerchantAnalysis;
  const [copied, setCopied] = useState(false);

  const slug = a.brand.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  function copySummary() {
    const text =
      `${a.headline}\n\n${a.executiveInsight}\n\n` +
      a.whatThisMeans.map((l) => `• ${l}`).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  async function downloadMd() {
    if (!reportMdUrl) return;
    const res = await fetch(reportMdUrl);
    download(`${slug}-ai-visibility-report.md`, await res.text(), "text/markdown");
  }

  return (
    <div className="exportbar no-print">
      <button className="btn" onClick={copySummary}>
        {copied ? "Copied ✓" : "Copy executive summary"}
      </button>
      {reportMdUrl && (
        <button className="btn" onClick={downloadMd}>
          Download report.md
        </button>
      )}
      <button
        className="btn"
        onClick={() => download(`${slug}-results.json`, JSON.stringify(run, null, 2), "application/json")}
      >
        Download results.json
      </button>
      <button className="btn" onClick={() => window.print()}>
        Print / Save PDF
      </button>
    </div>
  );
}
