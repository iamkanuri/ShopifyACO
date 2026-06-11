import { Link, usePath } from "./router";
import { DemoPage } from "./pages/DemoPage";
import { ReportPage } from "./pages/ReportPage";
import { ScanPage } from "./pages/ScanPage";

export function App() {
  const path = usePath();

  let page: React.ReactNode;
  if (path.startsWith("/report/")) page = <ReportPage runId={decodeURIComponent(path.split("/")[2] ?? "")} />;
  else if (path === "/scan") page = <ScanPage />;
  else page = <DemoPage />; // "/", "/demo"

  const active = (p: string) => (path === p || (p === "/demo" && path === "/") ? "active" : "");

  return (
    <div className="app">
      <header className="topbar no-print">
        <Link to="/demo" className="brandmark">
          <div className="logo">A</div>
          <div>
            <h1>ShopifyACO — AI Visibility</h1>
            <div className="sub">Are AI assistants recommending your store?</div>
          </div>
        </Link>
        <nav className="nav">
          <Link to="/demo" className={`navlink ${active("/demo")}`}>
            Demo
          </Link>
          <Link to="/scan" className={`navlink btn btn-primary ${active("/scan")}`}>
            New scan
          </Link>
        </nav>
      </header>
      {page}
    </div>
  );
}
