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
          <Link to="/demo">Example test</Link>
          <Link to="/methodology">Methodology</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/support">Support</Link>
          {contactEmail && <a href={`mailto:${contactEmail}`}>Contact</a>}
        </nav>
      </div>
      <p className="foot-fine">
        AI systems vary by model, prompt, time, and location. AisleLens reports what it tested and
        what it could verify from your store's own data — it does not predict or guarantee the
        behavior of any external AI system. Not affiliated with any AI provider.
      </p>
    </footer>
  );
}
