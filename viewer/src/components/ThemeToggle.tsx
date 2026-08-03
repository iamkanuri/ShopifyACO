import { useEffect, useState } from "react";
import { applyTheme, effectiveTheme, type Theme } from "../theme";

// A clean two-state light/dark toggle (sun ↔ moon).
//
// ⚠️ v4.3 — the site defaults to LIGHT for everyone, not to the OS preference (see the
// header of ../theme.ts). The `prefers-color-scheme` listener that used to live here is
// gone with it: nothing in the CSS keys off that media query any more, so a listener
// would have flipped this icon to describe a theme the stylesheet was not applying.
// A stale-but-plausible icon is the silent-render family this repo keeps paying for.

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => effectiveTheme());
  useEffect(() => {
    // Re-read once on mount: `initTheme()` runs before React and a stored choice must
    // survive hydration over the server snapshot.
    setTheme(effectiveTheme());
  }, []);
  const toggle = () => {
    const next: Theme = effectiveTheme() === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  };
  return [theme, toggle];
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.1 5.1l1.4 1.4M17.5 17.5l1.4 1.4M18.9 5.1l-1.4 1.4M6.5 17.5l-1.4 1.4" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.3 6.3 0 0 0 10.5 10.5z" />
    </svg>
  );
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, toggle] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className={`theme-toggle no-print ${className}`}
      onClick={toggle}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
