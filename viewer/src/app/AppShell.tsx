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
import { Catalog } from "./Catalog";
import { Settings } from "./Settings";
import { Billing } from "./Billing";
import { Measure } from "./Measure";

// The authenticated embedded experience. A real merchant arrives here after OAuth
// (shop session cookie); a prospect or local preview sees the same screens backed by
// demo fixtures with an honest "Demo data" badge + a Connect prompt. Sub-routes use
// the shared tiny history router (/app, /app/evidence, …).

const NAV = [
  { to: "/app", label: "Dashboard", key: "" },
  { to: "/app/catalog", label: "Catalog", key: "catalog" },
  { to: "/app/measure", label: "Measure", key: "measure" },
  { to: "/app/evidence", label: "Evidence", key: "evidence" },
  { to: "/app/fixes", label: "Fix Studio", key: "fixes" },
  { to: "/app/experiments", label: "Experiments", key: "experiments" },
  { to: "/app/monitoring", label: "Monitoring", key: "monitoring" },
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

  let screen: React.ReactNode;
  if (sub === "catalog") screen = <Catalog />;
  else if (sub === "measure") screen = <Measure />;
  else if (sub === "evidence") screen = <Evidence />;
  else if (sub === "fixes") screen = <Fixes />;
  else if (sub === "experiments") screen = <Experiments />;
  else if (sub === "monitoring") screen = <Monitoring />;
  else if (sub === "billing") screen = <Billing />;
  else if (sub === "settings") screen = <Settings connected={!demo} />;
  else screen = <Dashboard />;

  return (
    <div className="al-shell">
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

      <main className="al-main">
        {demo && !probe.loading && (
          liveError ? (
            <div className="al-connect al-connect-err">
              We couldn't load your live data, so you're seeing <b>sample data</b>. This is an error (not your real results) — please retry shortly. <span className="muted">({probe.error})</span>
            </div>
          ) : (
            <div className="al-connect">
              You're viewing <b>sample data</b>. <ConnectShopify className="as-link al-connect-link" label="Connect your Shopify store" /> to see your real AI visibility.
            </div>
          )
        )}
        {screen}
      </main>
    </div>
  );
}
