import { Link, usePath } from "./router";
import { useConfig } from "./config";
import { LandingPage } from "./pages/LandingPage";
import { ReportPage } from "./pages/ReportPage";
import { ScanPage } from "./pages/ScanPage";
import { ProductTestPage } from "./pages/ProductTestPage";
import { MethodologyPage } from "./pages/MethodologyPage";
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
import { BETA_BADGE, STANDARDS_INDEX_URL } from "./copy";

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
  else if (path === "/test") page = <ProductTestPage />;
  else if (path === "/methodology") page = <MethodologyPage />;
  // `/demo` is deliberately NOT here. The Example test is a server-rendered standalone
  // document (src/server/buyerTestDemo.ts), like `/standards` — the app never loads on
  // it, so there is nothing to mount and nothing to wipe. Every link to it must be a
  // plain <a>, never the SPA <Link>: a client-side navigation would match no route
  // here and render "Page not found" over a page the server serves correctly.
  else if (path === "/admin") page = <AdminPage />;
  else if (path === "/thanks") page = <ThanksPage />;
  else if (path === "/privacy") page = <PrivacyPage />;
  else if (path === "/terms") page = <TermsPage />;
  else if (path === "/support") page = <SupportPage />;
  else if (path === "/data-deletion") page = <DataDeletionPage />;
  else if (path === "/") page = <LandingPage />;
  else page = <NotFound />;

  const active = (p: string) => (path === p ? "active" : "");

  return (
    <div className="app">
      {!isAdmin && (
        <header className={`topbar no-print ${minimalHeader ? "topbar-min" : ""}`}>
          <Link to="/" className="brandmark">
            <div className="logo"><Mark /></div>
            <div>
              {/* Brand wordmark is site chrome, not the page title — a span so each page
                  provides the single <h1> (avoids two h1s per page, Codex #23). */}
              <span className="brandname">
                {brandName}
                {/* Honest, and staying. No second party has applied a standard of ours —
                    `independently_applied` is `false` in the artifact itself — and Stripe
                    is still in test mode. A badge that is true costs nothing to show. */}
                <span className="beta-badge">{BETA_BADGE}</span>
              </span>
              <div className="sub">AI Commerce QA for Shopify</div>
            </div>
          </Link>
          <div className="topbar-actions">
            {!minimalHeader && (
              <nav className="nav">
                {/* Plain <a>: /demo and /standards are server-rendered documents, not SPA
                    routes — a <Link> would land the visitor on the SPA's own 404. */}
                <a href="/demo" className="navlink">
                  Example test
                </a>
                <a href={STANDARDS_INDEX_URL} className="navlink">
                  Standards
                </a>
                <Link to="/methodology" className={`navlink ${active("/methodology")}`}>
                  Methodology
                </Link>
                {/* ⚠️ THE APP STORE LINK IS NOT IN THE NAV ANY MORE (v4.3 §3.11). It is not
                    a login, but it is a second call to action competing with the one that
                    matters to the reader this page is now written for, and a nav with two
                    CTAs has none. It is NOT deleted: it keeps its place in the landing
                    page's pilot section, and the merchant-facing install path (managed
                    install inside Shopify admin) never went through this link at all. */}
                {/* The /test page is itself the test runner, so the nav CTA there is redundant. */}
                {path !== "/test" && (
                  <Link to="/test" className="navlink btn btn-primary">
                    Run a real test
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

function NotFound() {
  return (
    <div className="prose card" style={{ textAlign: "center" }}>
      <h1>Page not found</h1>
      <p className="muted">That page doesn't exist. <Link to="/">Go to the homepage →</Link></p>
    </div>
  );
}
