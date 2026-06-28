import { useEffect, useRef } from "react";
import type { RefObject } from "react";

// Shared dialog a11y for our `.modal` overlays. When `active` flips true it:
//  - moves focus into the dialog (first focusable, else the dialog itself),
//  - traps Tab/Shift+Tab inside the dialog,
//  - closes on Escape,
//  - restores focus to whatever was focused before the dialog opened.
// Attach the returned ref to the dialog container (give it tabIndex={-1} so the
// fallback focus target works). onClose is read through a ref so a new closure
// identity each render doesn't re-run the effect and steal focus mid-interaction.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useModalFocus<T extends HTMLElement = HTMLDivElement>(active: boolean, onClose: () => void): RefObject<T | null> {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusables = (): HTMLElement[] =>
      node ? Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];

    // Initial focus: honor an existing autoFocus already inside the dialog (React commits
    // autoFocus before this effect); otherwise the first focusable, else the dialog itself.
    if (!node?.contains(document.activeElement)) (focusables()[0] ?? node)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onCloseRef.current(); return; }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) { e.preventDefault(); node?.focus(); return; }
      const first = items[0]!, last = items[items.length - 1]!;
      const here = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (here === first || !node?.contains(here)) { e.preventDefault(); last.focus(); }
      } else {
        if (here === last || !node?.contains(here)) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previouslyFocused?.focus?.();
    };
  }, [active]);

  return ref;
}
