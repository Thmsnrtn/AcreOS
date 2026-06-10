/**
 * useRouteHeadingFocus — focus the page heading after an in-app route change
 * (Tier 3C keyboard layer, elevation blueprint).
 *
 * After a G-chord (or any client-side navigation) lands, keyboard + screen-
 * reader users are otherwise left focused on a node that just unmounted —
 * the new page is never announced and Tab restarts from <body>. This hook
 * moves programmatic focus to the new page's <h1> (fallback: the
 * #main-content landmark) so the destination is announced and the focus
 * order starts at the top of the new surface.
 *
 * Care taken:
 *   - Skips the initial load — the browser's own focus handling is correct
 *     there, and stealing focus on first paint breaks skip-links.
 *   - Never steals focus from a form field the user is already typing in
 *     (isEditableTarget — the same tested predicate the shortcut layer uses).
 *   - Retries briefly: door pages are React.lazy chunks, so the <h1> may not
 *     exist on the first frame after the location changes.
 *   - preventScroll — the route change already put the user at the top;
 *     focusing must not introduce a second scroll jump.
 */
import { useEffect, useRef } from "react";
import { isEditableTarget } from "@/lib/keyboard-layer";

const RETRY_INTERVAL_MS = 100;
const MAX_RETRIES = 15; // ~1.5s — covers a slow lazy-chunk fetch

export function useRouteHeadingFocus(pathname: string | undefined) {
  const prevRef = useRef(pathname);
  useEffect(() => {
    if (prevRef.current === pathname) return;
    prevRef.current = pathname;
    if (typeof document === "undefined") return;

    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;

    const tryFocus = () => {
      if (cancelled) return;
      // The user beat us to a field (e.g. "/" focused search) — leave it.
      if (isEditableTarget(document.activeElement)) return;
      const target =
        document.querySelector<HTMLElement>("h1") ??
        document.getElementById("main-content");
      if (target) {
        if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
        return;
      }
      if (attempts++ < MAX_RETRIES) timer = setTimeout(tryFocus, RETRY_INTERVAL_MS);
    };

    timer = setTimeout(tryFocus, RETRY_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pathname]);
}
