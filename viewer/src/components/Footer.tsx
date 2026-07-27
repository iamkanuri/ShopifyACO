import { Link } from "../router";
import { useConfig } from "../config";
import { FOOTER } from "../copy";

export function Footer() {
  const { brandName, contactEmail } = useConfig();
  return (
    <footer className="site-footer no-print">
      <div className="foot-row">
        <span>
          © {new Date().getFullYear()} {brandName}
        </span>
        <nav className="foot-links">
          {/* Plain <a>: /standards is server-rendered, so the SPA router must not swallow it. */}
          {FOOTER.externalLinks.map(([href, label]) => (
            <a key={href} href={href}>{label}</a>
          ))}
          {FOOTER.links.map(([to, label]) => (
            <Link key={to} to={to}>{label}</Link>
          ))}
          {contactEmail && <a href={`mailto:${contactEmail}`}>{FOOTER.contact}</a>}
        </nav>
      </div>
      <p className="foot-fine">{FOOTER.fine}</p>
    </footer>
  );
}
