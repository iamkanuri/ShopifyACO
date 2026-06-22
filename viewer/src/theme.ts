// Light/dark theming. The visitor DEFAULTS to their system preference
// (`prefers-color-scheme`, handled in CSS); a manual choice sets `data-theme` on
// <html>, overrides the system default, and persists. Clearing the choice returns to
// "follow system". Kept tiny + framework-free so it can run before React renders.

export type Theme = "light" | "dark";
const KEY = "al_theme";

function systemTheme(): Theme {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** The visitor's explicit choice, or null when they're following their system preference. */
export function storedTheme(): Theme | null {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}

/** The theme actually in effect right now (explicit choice, else system). */
export function effectiveTheme(): Theme {
  return storedTheme() ?? systemTheme();
}

/** Set an explicit theme (persisted), or pass null to clear and follow the system again. */
export function applyTheme(theme: Theme | null): void {
  const root = document.documentElement;
  if (theme) root.dataset.theme = theme;
  else delete root.dataset.theme;
  try {
    if (theme) localStorage.setItem(KEY, theme);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked (private mode) — the attribute still applies for this session */
  }
}

/** Reflect a stored choice on <html> at startup (before render). No-op when following system. */
export function initTheme(): void {
  const t = storedTheme();
  if (t) document.documentElement.dataset.theme = t;
}
