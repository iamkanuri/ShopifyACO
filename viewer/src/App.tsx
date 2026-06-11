import { Link, usePath } from "./router";
import { useConfig } from "./config";
import { LandingPage } from "./pages/LandingPage";
import { DemoPage } from "./pages/DemoPage";
import { ReportPage } from "./pages/ReportPage";
import { ScanPage } from "./pages/ScanPage";
import { AdminPage } from "./pages/AdminPage";
import { ThanksPage } from "./pages/ThanksPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { Footer } from "./components/Footer";

export function App() {
  const path = usePath();
  const { brandName } = useConfig();
  const isAdmin = path === "/admin";

  let page: React.ReactNode;
  if (path.startsWith("/report/")) page = <ReportPage runId={decodeURIComponent(path.split("/")[2] ?? "")} />;
  else if (path === "/scan") page = <ScanPage />;
  else if (path === "/demo") page = <DemoPage />;
  else if (path === "/admin") page = <AdminPage />;
  else if (path === "/thanks") page = <ThanksPage />;
  else if (path === "/privacy") page = <PrivacyPage />;
  else page = <LandingPage />;

  const active = (p: string) => (path === p ? "active" : "");

  return (
    <div className="app">
      {!isAdmin && (
        <header className="topbar no-print">
          <Link to="/" className="brandmark">
            <div className="logo">{brandName.charAt(0).toUpperCase()}</div>
            <div>
              <h1>{brandName}</h1>
              <div className="sub">Are AI assistants recommending your store?</div>
            </div>
          </Link>
          <nav className="nav">
            <Link to="/demo" className={`navlink ${active("/demo")}`}>
              Demo
            </Link>
            <Link to="/scan" className={`navlink btn btn-primary ${active("/scan")}`}>
              Run free scan
            </Link>
          </nav>
        </header>
      )}
      {page}
      {!isAdmin && <Footer />}
    </div>
  );
}
