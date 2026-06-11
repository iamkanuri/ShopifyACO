import { useEffect, useRef, useState } from "react";
import type { MerchantAnalysis, RunResults } from "./types";
import { fmtUsd } from "./types";
import { ScorePanel } from "./components/ScorePanel";
import { StatTiles } from "./components/StatTiles";
import { Insight } from "./components/Insight";
import { Leaderboard } from "./components/Leaderboard";
import { EngineCards } from "./components/EngineCards";
import { GapAnalysis } from "./components/GapAnalysis";
import { LostPrompts } from "./components/LostPrompts";
import { FixCards } from "./components/FixCards";

export function App() {
  const [run, setRun] = useState<RunResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("./sample-results.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no bundled sample"))))
      .then(setRun)
      .catch(() => setError("Load a results.json to begin."));
  }, []);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((t) => {
      try {
        setRun(JSON.parse(t));
        setError(null);
      } catch {
        setError("That file isn't valid JSON.");
      }
    });
  }

  const a: MerchantAnalysis | undefined = run?.analysis;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brandmark">
          <div className="logo">A</div>
          <div>
            <h1>ShopifyACO — AI Visibility</h1>
            <div className="sub">Are AI assistants recommending your store?</div>
          </div>
        </div>
        <div>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Load results.json
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onFile} />
        </div>
      </header>

      {!a && (
        <div className="card empty">
          {error ?? "Loading…"}
          <div style={{ marginTop: 16 }}>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              Choose a results.json
            </button>
          </div>
        </div>
      )}

      {a && run && (
        <>
          <RunMeta a={a} run={run} />

          <section className="hero section">
            <ScorePanel score={a.visibilityScore} />
            <StatTiles a={a} />
          </section>

          <section className="section">
            <Insight a={a} />
          </section>

          <section className="section">
            <h2>Competitor leaderboard</h2>
            <Leaderboard rows={a.leaderboard} />
          </section>

          <section className="section">
            <h2>Engine breakdown</h2>
            <EngineCards engines={a.engineWeakness} brand={a.brand} />
          </section>

          <section className="section">
            <h2>Gap analysis — why AI picks your competitor</h2>
            <GapAnalysis a={a} />
          </section>

          <section className="section">
            <h2>Lost prompts</h2>
            <LostPrompts lost={a.lostPrompts} brand={a.brand} />
          </section>

          <section className="section">
            <h2>Recommended fixes</h2>
            <FixCards cards={a.fixCards} />
          </section>

          <footer className="caveat" style={{ marginTop: 36 }}>
            <span>⚠️</span>
            <span>{a.caveat}</span>
          </footer>
        </>
      )}
    </div>
  );
}

function RunMeta({ a, run }: { a: MerchantAnalysis; run: RunResults }) {
  return (
    <div className="runmeta">
      <span className="chip" style={{ fontWeight: 700 }}>
        {a.brand} · {a.category}
      </span>
      {a.groundedEngines.map((e) => (
        <span className="chip" key={e}>
          <span className="dot" /> {e} · web-grounded
        </span>
      ))}
      {a.ungroundedEngines.map((e) => (
        <span className="chip warn" key={e}>
          <span className="dot" /> {e} · ungrounded
        </span>
      ))}
      <span className="chip">{run.meta.promptCount} prompts</span>
      <span className="chip">{a.basedOnResponses} grounded answers</span>
      <span className="chip">{fmtUsd(a.totalCostUsd)} spend</span>
      <span className="chip">{new Date(a.generatedAt).toLocaleString()}</span>
    </div>
  );
}
