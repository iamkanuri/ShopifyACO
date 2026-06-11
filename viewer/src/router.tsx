import { useSyncExternalStore } from "react";

// Tiny history router — no dependency. Routes: /, /demo, /scan, /report/:runId.

function subscribe(cb: () => void) {
  window.addEventListener("popstate", cb);
  window.addEventListener("navigate", cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener("navigate", cb);
  };
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

export function navigate(to: string): void {
  if (to === window.location.pathname) return;
  window.history.pushState({}, "", to);
  window.dispatchEvent(new Event("navigate"));
}

export function Link(props: { to: string; className?: string; children: React.ReactNode }) {
  return (
    <a
      href={props.to}
      className={props.className}
      onClick={(e) => {
        e.preventDefault();
        navigate(props.to);
      }}
    >
      {props.children}
    </a>
  );
}
