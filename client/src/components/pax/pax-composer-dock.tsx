/**
 * Pax composer dock — keeps the composer on screen on the Pax door
 * (D11 front-door fix 1: "A Pax you cannot find is not a Pax").
 *
 * Measured before this existed (Step 0, 2026-11-03, fresh post-onboarding
 * user): the composer rendered and passed Playwright's `isVisible()`, but its
 * top sat at 1,758px (phone), 1,622px (tablet) and 1,316px (desktop) of the
 * document — below the hero, the disclosure banner, two suggestion lists and
 * the welcome block, on every viewport and theme. Visible to a test, not to a
 * person.
 *
 * The dock is a `position: sticky; bottom: …` slot rendered by PaxPage as a
 * child of the conversation region, whose top is inside the first screen on
 * every viewport. CommandCenterPage portals its composer block into the slot,
 * so the composer keeps all of its own state, handlers and behaviour — only
 * WHERE it is laid out changes. While the region extends past the viewport the
 * composer pins to the viewport bottom (above the mobile bottom nav when that
 * nav is shown); at the end of the conversation it rests in its natural place
 * after the last message, so it never covers the tail of the thread.
 *
 * Sticky needs the page's `<main>` not to be a scroll container — PaxPage
 * passes `stickyToViewport` to PageShell for that (see page-shell.tsx).
 */
import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "@/hooks/use-mobile";

/**
 * The composer's placeholder, in the UI design's own words (§3.1: the
 * placeholder teaches by example). Pinned verbatim — a test that paraphrases
 * it means the product copy drifted.
 */
export const PAX_COMPOSER_PLACEHOLDER = "Ask about a note, a parcel, or what changed this week";

/** The dock element, once mounted. Null outside the Pax door. */
export const PaxComposerDockContext = createContext<HTMLElement | null>(null);

/**
 * Bottom offset that clears the fixed mobile bottom nav. Mirrors that nav's
 * own visibility rule (MobileBottomNav renders only when `isMobile` and the
 * on-screen keyboard is closed) and its 72px + safe-area height, the same
 * figure the quick-add FAB and `.mobile-safe-content` use.
 */
export function dockBottomOffset(isMobile: boolean, isKeyboardOpen: boolean): string {
  return isMobile && !isKeyboardOpen ? "calc(72px + env(safe-area-inset-bottom, 0px))" : "0px";
}

/** The sticky slot. PaxPage renders it; `onElement` receives the node. */
export function PaxComposerDock({ onElement }: { onElement: (el: HTMLElement | null) => void }) {
  const { isMobile, isKeyboardOpen } = useIsMobile();
  return (
    <div
      ref={onElement}
      data-testid="pax-composer-dock"
      className="sticky z-docked bg-background"
      style={{ bottom: dockBottomOffset(isMobile, isKeyboardOpen) }}
    />
  );
}

/**
 * Render `children` into the dock when the Pax door provides one, otherwise
 * in place (any other host keeps the old inline layout).
 */
export function InPaxComposerDock({ children }: { children: ReactNode }) {
  const dock = useContext(PaxComposerDockContext);
  return dock ? createPortal(children, dock) : <>{children}</>;
}
