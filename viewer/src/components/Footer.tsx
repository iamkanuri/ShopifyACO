import { Link } from "../router";
import { useConfig } from "../config";

export function Footer() {
  const { brandName, contactEmail } = useConfig();
  return (
    <footer className="site-footer no-print">
      <div className="foot-row">
        <span>
          © {new Date().getFullYear()} {brandName}
        </span>
        <nav className="foot-links">
          <Link to="/demo">Demo</Link>
          <Link to="/scan">Run a scan</Link>
          <Link to="/privacy">Privacy</Link>
          {contactEmail && <a href={`mailto:${contactEmail}`}>Contact</a>}
        </nav>
      </div>
      <p className="foot-fine">
        AI answers vary by model, time, prompt, and location. Results are directional market
        intelligence, not a guarantee of ranking. Not affiliated with any AI provider.
      </p>
    </footer>
  );
}
