import type { Confidence, RunSize } from "../types";

const RUN_LABEL: Record<RunSize, string> = { mini: "Mini scan", standard: "Standard scan", deep: "Deep scan" };

export function RunSizeBadge({ runSize }: { runSize: RunSize }) {
  return <span className={`pill run-${runSize}`}>{RUN_LABEL[runSize]}</span>;
}

export function ConfidenceBadge({ c, compact }: { c: Confidence; compact?: boolean }) {
  const short = c.tier === "high" ? "Strong signal" : c.tier === "medium" ? "Moderate signal" : "Directional";
  return (
    <span className={`pill conf-${c.tier}`} title={`${c.label} (n=${c.basedOnResponses})`}>
      {compact ? short : c.label}
    </span>
  );
}
