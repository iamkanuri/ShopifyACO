// ---------------------------------------------------------------------------
// Evidence-snippet sanitizer (paid-report Phase 0 hardening, Fix 2). Real web-grounded
// AI answers are full of markdown and citation cruft — **bold**, [4] markers, inline URLs,
// "(goodhousekeeping.com)" parentheticals — which leaked straight into the quotes the
// prescription shows. The paid artifact's whole value is "paste-ready", so evidence must
// render clean. This strips FORMATTING only; it never truncates the sentence.
// ---------------------------------------------------------------------------

/**
 * Strip markdown + citation + URL cruft from an extracted snippet, preserving the actual
 * quoted sentence (and any leading/trailing "…" ellipsis). Pure + idempotent.
 */
export function sanitizeSnippet(s: string | undefined): string | undefined {
  if (s == null) return s;
  let t = s;

  // Markdown links [text](url) → keep the visible text, drop the target.
  t = t.replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, "$1");
  // Numbered citation markers: [4], [1][10], 【3】.
  t = t.replace(/\[\d+\]|【\d+】/g, "");
  // Bare inline URLs.
  t = t.replace(/https?:\/\/[^\s)]+/gi, "");
  // Tracking query fragments if any survived.
  t = t.replace(/\?utm_[^\s)]*/gi, "");
  // Parenthetical source/domain refs like "(goodhousekeeping.com)" or "(site.com/x)".
  t = t.replace(/\(\s*[^)]*\.[a-z]{2,6}(?:\/[^)]*)?\s*\)/gi, "");
  // Markdown emphasis / inline code / heading marks.
  t = t.replace(/\*\*|__|`|~~|#+\s?/g, "");
  t = t.replace(/(^|[\s(])[*_]([^\s*_])/g, "$1$2"); // leftover single emphasis openers
  // Markdown list bullets appearing mid-fragment.
  t = t.replace(/(^|\s)[-•]\s+/g, "$1");
  // Truncation artifacts: a fixed-width snippet slice can cut a URL/citation in half, leaving
  // an UNBALANCED fragment the balanced rules above can't match — a trailing "(domain.com…" or a
  // leading "=param))" remnant. Strip those at the snippet edges (keep the ellipsis marker).
  t = t.replace(/\s*\(\[?[^\s()]*\.[a-z]{2,6}[^\s]*$/i, "…"); // trailing unclosed "(domain…"
  t = t.replace(/^(…)?\s*\S*=[a-z0-9_]+\)+[\s.,]*/i, (_m, e) => (e ? "… " : "")); // leading "=param))" remnant
  t = t.replace(/\S*=openai\b\)*/gi, ""); // any stray truncated tracking token
  // Empty "()" left behind by removals, then tidy spacing/punctuation.
  t = t.replace(/\(\s*\)/g, "");
  t = t.replace(/\s{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").replace(/\s+…/g, "…").trim();

  return t;
}
