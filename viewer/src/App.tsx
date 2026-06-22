import { Link, usePath } from "./router";
import { useConfig } from "./config";
import { LandingPage } from "./pages/LandingPage";
import { DemoPage } from "./pages/DemoPage";
import { ReportPage } from "./pages/ReportPage";
import { ScanPage } from "./pages/ScanPage";
import { AdminPage } from "./pages/AdminPage";
import { ThanksPage } from "./pages/ThanksPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { TermsPage } from "./pages/TermsPage";
import { SupportPage } from "./pages/SupportPage";
import { DataDeletionPage } from "./pages/DataDeletionPage";
import { IndexListPage } from "./pages/IndexListPage";
import { IndexLeaderboardPage } from "./pages/IndexLeaderboardPage";
import { Footer } from "./components/Footer";
import { Mark } from "./components/Mark";
import { ThemeToggle } from "./components/ThemeToggle";
import { AppShell } from "./app/AppShell";

export function App() {
  const path = usePath();
  const { brandName } = useConfig();
  const isAdmin = path === "/admin";
  const isApp = path === "/app" || path.startsWith("/app/");

  // The embedded merchant app has its own sidebar chrome — render it standalone.
  if (isApp) return <div className="app app-embedded"><AppShell /></div>;
  // On result/confirmation pages the acquisition CTAs are redundant — keep the
  // header minimal (brand only) so the page's own content carries the next step.
  const legalPaths = ["/privacy", "/terms", "/support", "/data-deletion"];
  const minimalHeader = path.startsWith("/report/") || path === "/thanks" || legalPaths.includes(path);

  let page: React.ReactNode;
  if (path.startsWith("/report/")) page = <ReportPage runId={decodeURIComponent(path.split("/")[2] ?? "")} />;
  else if (path.startsWith("/index/")) page = <IndexLeaderboardPage slug={decodeURIComponent(path.split("/")[2] ?? "")} />;
  else if (path === "/index") page = <IndexListPage />;
  else if (path === "/scan") page = <ScanPage />;
  else if (path === "/demo") page = <DemoPage />;
  else if (path === "/admin") page = <AdminPage />;
  else if (path === "/thanks") page = <ThanksPage />;
  else if (path === "/privacy") page = <PrivacyPage />;
  else if (path === "/terms") page = <TermsPage />;
  else if (path === "/support") page = <SupportPage />;
  else if (path === "/data-deletion") page = <DataDeletionPage />;
  else page = <LandingPage />;

  const active = (p: string) => (path === p ? "active" : "");

  return (
    <div className="app">
      {!isAdmin && (
        <header className={`topbar no-print ${minimalHeader ? "topbar-min" : ""}`}>
          <Link to="/" className="brandmark">
            <div className="logo"><Mark /></div>
            <div>
              <h1>{brandName}</h1>
              <div className="sub">Are AI assistants recommending your store?</div>
            </div>
          </Link>
          <div className="topbar-actions">
            {!minimalHeader && (
              <nav className="nav">
                <Link to="/index" className={`navlink ${active("/index")}`}>
                  Index
                </Link>
                <Link to="/demo" className={`navlink ${active("/demo")}`}>
                  Demo
                </Link>
                {/* The /scan page is itself the scan, so the nav CTA there is redundant. */}
                {path !== "/scan" && (
                  <Link to="/scan" className="navlink btn btn-primary">
                    Run free scan
                  </Link>
                )}
              </nav>
            )}
            {/* Theme toggle shows on every page, including the minimal-header ones. */}
            <ThemeToggle />
          </div>
        </header>
      )}
      {page}
      {!isAdmin && <Footer />}
    </div>
  );
}
