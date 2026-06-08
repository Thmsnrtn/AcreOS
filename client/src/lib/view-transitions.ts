/**
 * View Transitions — cross-fade client-side route changes.
 *
 * The browser View Transitions API (`document.startViewTransition`) snapshots
 * the old DOM, runs the callback that mutates it, snapshots the new DOM, then
 * cross-fades between the two snapshots. We wire it to wouter navigations so
 * route changes animate instead of hard-cutting.
 *
 * Why patch history instead of wrapping a navigate() call:
 * ───────────────────────────────────────────────────────
 * Wouter 3 drives its location hook off the browser History API and does not
 * expose a single navigate() seam we can decorate. Both `<Link>` clicks and
 * programmatic `setLocation` calls ultimately flow through
 * `history.pushState` / `history.replaceState`. Patching those two methods is
 * the one chokepoint that catches every in-app navigation without touching
 * every call site.
 *
 * Feature detection + reduced motion:
 * ───────────────────────────────────
 * `startViewTransition` is feature-detected; when it's absent (Firefox, older
 * Safari) we call the state-change synchronously — a hard cut, exactly today's
 * behavior. When the user has `prefers-reduced-motion: reduce` we also skip the
 * transition so the navigation is instant. The `::view-transition` CSS in
 * index.css additionally zeroes the animation under reduced-motion as a
 * belt-and-suspenders guard.
 *
 * Coexistence with Framer Motion:
 * ───────────────────────────────
 * The page-level `AnimatePresence` in App.tsx still owns the per-page
 * enter/exit. The View Transition layer is a fast root-level cross-fade of the
 * whole document, kept subtle (~180ms) so the two read as one motion, not two
 * competing ones.
 */

type StartViewTransition = (callback: () => void) => unknown;

// A structural view of `document` that does NOT extend `Document`. Extending it
// would clash with the lib.dom `startViewTransition` declaration (non-optional,
// different signature) on TS versions that ship it — TS2430. Accessing the
// method through `document as unknown as DocumentWithViewTransitions` is
// version-agnostic: it works whether or not the DOM lib declares the API.
type DocumentWithViewTransitions = { startViewTransition?: StartViewTransition };

/** True when the browser exposes the View Transitions API. */
export function supportsViewTransitions(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof (document as unknown as DocumentWithViewTransitions)
      .startViewTransition === "function"
  );
}

/** True when the user has asked the OS to reduce motion. */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Run `update` inside a view transition when supported and motion is allowed,
 * otherwise run it synchronously (a hard cut — today's behavior). Safe to call
 * directly; it never throws if the API is missing.
 */
export function withViewTransition(update: () => void): void {
  if (!supportsViewTransitions() || prefersReducedMotion()) {
    update();
    return;
  }
  try {
    (document as unknown as DocumentWithViewTransitions).startViewTransition!(
      update,
    );
  } catch {
    // Some engines throw if a transition is already in flight; fall back to a
    // plain synchronous update rather than dropping the navigation entirely.
    update();
  }
}

let installed = false;

/**
 * Patch `history.pushState` / `history.replaceState` so every wouter
 * navigation cross-fades. Idempotent — calling more than once is a no-op.
 * Mount once at app startup (see App.tsx). No-op on the server and when the
 * View Transitions API is unsupported (we never patch in that case, so there's
 * zero overhead on unsupported browsers).
 */
export function installViewTransitions(): void {
  if (installed) return;
  if (typeof window === "undefined" || !supportsViewTransitions()) return;
  installed = true;

  const origPush = window.history.pushState.bind(window.history);
  const origReplace = window.history.replaceState.bind(window.history);

  const wrap =
    (orig: History["pushState"]): History["pushState"] =>
    function patched(this: History, ...args: Parameters<History["pushState"]>) {
      // Same-URL navigations (e.g. a `<Link>` to the current route) shouldn't
      // trigger a cross-fade of identical frames — skip the transition.
      const nextUrl = args[2];
      const sameUrl =
        nextUrl != null &&
        new URL(String(nextUrl), window.location.href).href ===
          window.location.href;

      if (sameUrl || prefersReducedMotion()) {
        orig(...args);
        return;
      }
      withViewTransition(() => {
        orig(...args);
      });
    };

  window.history.pushState = wrap(origPush);
  window.history.replaceState = wrap(origReplace);
}
