import { Link, usePath } from "../router";
import { useConfig } from "../config";
import { getSchedules } from "./appApi";
import { useLoaded } from "./ui";
import { Dashboard } from "./Dashboard";
import { Evidence } from "./Evidence";
import { Fixes } from "./Fixes";
import { Experiments } from "./Experiments";
import { Monitoring } from "./Monitoring";

// The authenticated embedded experience. A real merchant arrives here after OAuth
// (shop session cookie); a prospect or local preview sees the same screens backed by
// demo fixtures with an honest "Demo data" badge + a Connect prompt. Sub-routes use
// the shared tiny history router (/app, /app/evidence, …).

const NAV = [
  { to: "/app", label: "Dashboard", key: "" },
  { to: "/app/evidence", label: "Evidence", key: "evidence" },
  { to: "/app/fixes", label: "Fix Studio", key: "fixes" },
  { to: "/app/experiments", label: "Experiments", key: "experiments" },
  { to: "/app/monitoring", label: "Monitoring", key: "monitoring" },
];

export function AppShell() {
  const path = usePath();
  const { brandName } = useConfig();
  const sub = path.replace(/^\/app\/?/, "").split("/")[0] ?? "";
  // One probe drives the global connect banner; screens still show their own badge.
  const probe = useLoaded(() => getSchedules(), []);
  const demo = probe.demo;

  let screen: React.ReactNode;
  if (sub === "evidence") screen = <Evidence />;
  else if (sub === "fixes") screen = <Fixes />;
  else if (sub === "experiments") screen = <Experiments />;
  else if (sub === "monitoring") screen = <Monitoring />;
  else screen = <Dashboard demo={demo} />;

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
          <div className={`al-conn ${demo ? "demo" : "live"}`}>
            <span className="al-dot" /> {demo ? "Demo data" : "Store connected"}
          </div>
        </div>
      </aside>

      <main className="al-main">
        {demo && !probe.loading && (
          <div className="al-connect">
            You're viewing <b>sample data</b>. <a href="/api/shopify/install">Connect your Shopify store</a> to see your real AI visibility.
          </div>
        )}
        {screen}
      </main>
    </div>
  );
}
