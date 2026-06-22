import { useEffect, useState } from "react";
import { applyTheme, effectiveTheme, storedTheme, type Theme } from "../theme";

// A clean two-state light/dark toggle (sun ↔ moon). Defaults to the visitor's system
// preference until they choose; the choice persists. If they're following system and the
// OS theme changes, the icon updates to match.

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => effectiveTheme());
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      if (storedTheme() == null) setTheme(effectiveTheme()); // only when following system
    };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
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
