import type { MerchantAnalysis } from "../types";

export function Insight({ a }: { a: MerchantAnalysis }) {
  return (
    <div className="card callout">
      <h3>Executive insight</h3>
      <p>{a.executiveInsight}</p>
    </div>
  );
}
