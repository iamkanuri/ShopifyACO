import type { EngineWeakness } from "../types";
import { fmtRateN } from "../types";

const PRETTY: Record<string, string> = {
  openai: "ChatGPT (OpenAI)",
  gemini: "Gemini",
  perplexity: "Perplexity",
  anthropic: "Claude",
};

export function EngineCards({ engines, brand }: { engines: EngineWeakness[]; brand: string }) {
  return (
    <div className="grid enginecards">
      {engines.map((e) => (
        <div className="card enginecard" key={e.engine}>
          <h3>
            {PRETTY[e.engine] ?? e.engine}
            {e.isWeakest && <span className="weak">WEAKEST</span>}
          </h3>
          <div className="row">
            <span className="lab">Recommends {brand}</span>
            <span className="val" style={{ color: e.recommendation.rate > 0 ? "var(--good)" : "var(--bad)" }}>
              {fmtRateN(e.recommendation)}
            </span>
          </div>
          <div className="row">
            <span className="lab">Mentions {brand}</span>
            <span className="val">{fmtRateN(e.mention)}</span>
          </div>
          <div className="row">
            <span className="lab">Avg rank when listed</span>
            <span className="val">
              {e.avgRankWhenMentioned != null ? e.avgRankWhenMentioned.toFixed(1) : "—"}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
