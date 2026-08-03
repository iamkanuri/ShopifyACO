// Light/dark theming.
//
// ⚠️ v4.3 — THE DEFAULT IS LIGHT, NOT THE SYSTEM PREFERENCE, AND THAT IS THE POINT.
// This used to return the visitor's `prefers-color-scheme`, with the CSS carrying a
// matching media block. The site's identity is now the light editorial theme, so a
// visitor whose OS is dark would otherwise be handed a different product than the one
// every screenshot, share card and standards page is designed as. "Never a dark site"
// is a statement about identity — dark remains one click away and persists, it is just
// no longer something the operating system chooses on the visitor's behalf.
//
// The CSS mirror of this decision: `:root` IS the light theme and there is exactly one
// `[data-theme="dark"]` block. Nothing keys off a media query, so this function and the
// stylesheet cannot disagree — which the two hand-maintained light blocks previously did.
//
// Kept tiny + framework-free so it can run before React renders.

export type Theme = "light" | "dark";
const KEY = "al_theme";

/** The theme a visitor gets before they choose. Light, unconditionally — see above. */
function defaultTheme(): Theme {
  return "light";
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

/** The theme actually in effect right now (explicit choice, else the site default). */
export function effectiveTheme(): Theme {
  return storedTheme() ?? defaultTheme();
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
