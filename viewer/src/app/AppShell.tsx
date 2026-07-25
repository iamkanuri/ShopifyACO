import { useEffect } from "react";
import { Link, usePath } from "../router";
import { useConfig } from "../config";
import { ThemeToggle } from "../components/ThemeToggle";
import { ConnectShopify } from "../components/ConnectShopify";
import { getSchedules, primeSession } from "./appApi";
import { useLoaded } from "./ui";
import { Dashboard } from "./Dashboard";
import { Evidence } from "./Evidence";
import { Fixes } from "./Fixes";
import { Experiments } from "./Experiments";
import { Monitoring } from "./Monitoring";
import { Attribution } from "./Attribution";
import { Catalog } from "./Catalog";
import { Settings } from "./Settings";
import { Billing } from "./Billing";
import { Measure } from "./Measure";
import { BuyerTests, BuyerTestDetail } from "./BuyerTests";

// The authenticated embedded experience. A real merchant arrives here after OAuth
// (shop session cookie); a prospect or local preview sees the same screens backed by
// demo fixtures with an honest "Demo data" badge + a Connect prompt. Sub-routes use
// the shared tiny history router (/app, /app/evidence, …).

// V2 CP4 — TESTS and CASES lead. The product is AI Commerce QA: what a merchant
// owns here is a set of tests over their store and the cases behind them. The old
// score dashboard is still reachable at /app/overview for anyone who wants it, but
// it is no longer the thing a merchant lands on, and it is no longer the frame.
const NAV = [
  { to: "/app", label: "Tests", key: "" },
  { to: "/app/evidence", label: "Cases", key: "evidence" },
  { to: "/app/catalog", label: "Catalog", key: "catalog" },
  { to: "/app/measure", label: "Measure", key: "measure" },
  { to: "/app/fixes", label: "Fix Studio", key: "fixes" },
  { to: "/app/experiments", label: "Experiments", key: "experiments" },
  { to: "/app/monitoring", label: "Monitoring", key: "monitoring" },
  { to: "/app/attribution", label: "Attribution", key: "attribution" },
  { to: "/app/overview", label: "Overview", key: "overview" },
  { to: "/app/billing", label: "Billing", key: "billing" },
  { to: "/app/settings", label: "Settings", key: "settings" },
];

export function AppShell() {
  const path = usePath();
  const { brandName } = useConfig();
  const sub = path.replace(/^\/app\/?/, "").split("/")[0] ?? "";
  // Refresh the embedded offline token on load (Shopify offline tokens now expire — a stored
  // token would otherwise silently lapse and break Admin API calls like Fix Studio apply).
  useEffect(() => { primeSession(); }, []);
  // One probe drives the global connect banner; screens still show their own badge.
  const probe = useLoaded(() => getSchedules(), []);
  const demo = probe.demo;
  // demo + an error means we're in a connected/merchant context but the live call failed —
  // show an honest "live data unavailable" state, not the "connect your store" preview.
  const liveError = demo && Boolean(probe.error);

  // `/app/tests/:id` — the saved test detail. Parsed here because the shell owns
  // sub-routing (the tiny router has no nested-route concept).
  const testId = /^\/app\/tests\/(\d+)$/.exec(path)?.[1];

  let screen: React.ReactNode;
  if (testId) screen = <BuyerTestDetail id={Number(testId)} />;
  else if (sub === "catalog") screen = <Catalog />;
  else if (sub === "measure") screen = <Measure />;
  else if (sub === "evidence") screen = <Evidence />;
  else if (sub === "fixes") screen = <Fixes />;
  else if (sub === "experiments") screen = <Experiments />;
  else if (sub === "monitoring") screen = <Monitoring />;
  else if (sub === "attribution") screen = <Attribution />;
  else if (sub === "billing") screen = <Billing />;
  else if (sub === "settings") screen = <Settings connected={!demo} />;
  else if (sub === "overview") screen = <Dashboard />;
  // The FIRST authenticated screen is the merchant's own Buyer Test, continued —
  // never a score dashboard (V2 §3.2/§3.3).
  else screen = <BuyerTests />;

  const screenName = testId ? "Tests" : (NAV.find((n) => n.key === sub)?.label ?? "Tests");

  return (
    <div className="al-shell">
      <a href="#al-main" className="skip-link">Skip to content</a>
      <aside className="al-side">
        <Link to="/" className="al-side-brand">{brandName}</Link>
        <nav className="al-nav">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} className={`al-navlink ${sub === n.key ? "active" : ""}`}>{n.label}</Link>
          ))}
        </nav>
        <div className="al-side-foot">
          <div className={`al-conn ${liveError ? "err" : demo ? "demo" : "live"}`}>
            <span className="al-dot" /> {liveError ? "Live data unavailable" : demo ? "Demo data" : "Store connected"}
          </div>
          <ThemeToggle />
        </div>
      </aside>

      <main className="al-main" id="al-main">
        <h1 className="sr-only">{brandName} — {screenName}</h1>
        {demo && !probe.loading && (
          liveError ? (
            <div className="al-connect al-connect-err">
              We couldn't load your live data, so you're seeing <b>sample data</b>. This is an error (not your real results) — please retry shortly. <span className="muted">({probe.error})</span>
            </div>
          ) : (
            <div className="al-connect">
              You're viewing <b>sample data</b>. <ConnectShopify className="as-link al-connect-link" label="Get it on the Shopify App Store" /> to see your real AI visibility.
            </div>
          )
        )}
        {screen}
      </main>
    </div>
  );
}
