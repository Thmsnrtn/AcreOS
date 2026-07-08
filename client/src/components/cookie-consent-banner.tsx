/**
 * Cookie Consent Banner
 * Task #297: Cookie consent for EU/CCPA compliance.
 *
 * Stores consent in localStorage. Shows on first visit for
 * users who have not yet consented.
 */

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { X } from "lucide-react";
import { initSentryAfterConsent } from "@/lib/sentry";

const STORAGE_KEY = "acreos_cookie_consent";
const SNOOZE_KEY = "acreos_cookie_consent_snoozed_until";
type ConsentStatus = "accepted" | "declined" | null;

export function CookieConsentBanner() {
  const [status, setStatus] = useState<ConsentStatus | "loading">("loading");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as ConsentStatus | null;
    if (stored) {
      setStatus(stored);
      return;
    }
    // Snooze check — "Dismiss for now" hides the banner for 24h so the
    // founder can scroll past it without committing to accept/decline.
    const snoozedUntil = Number(localStorage.getItem(SNOOZE_KEY) || 0);
    if (snoozedUntil && Date.now() < snoozedUntil) {
      setStatus("declined" as ConsentStatus); // sentinel to hide; real decision still null
    } else {
      setStatus(null);
    }
  }, []);

  const accept = () => {
    localStorage.setItem(STORAGE_KEY, "accepted");
    setStatus("accepted");
    // Notify any sibling components (e.g. FloatingActionButton) that the
    // banner is gone, so they can re-show. Tab-local custom event since
    // localStorage's "storage" event only fires cross-tab.
    window.dispatchEvent(new Event("acreos:cookieconsent"));
    // Now that the user has consented, initialize Sentry (session replay, etc.)
    initSentryAfterConsent();
  };

  const decline = () => {
    localStorage.setItem(STORAGE_KEY, "declined");
    setStatus("declined");
    window.dispatchEvent(new Event("acreos:cookieconsent"));
  };

  /**
   * Dismiss (X) — records a persistent decline.
   *
   * The previous behavior was a 24h snooze that left the banner to
   * reappear on the next return visit. That gets read as "I have to
   * keep dealing with this every time I open the app" — which is
   * exactly what users complained about. Treat X as a real "no": the
   * decision sticks until they explicitly revisit consent in settings.
   * Settings still lets them flip to "accepted."
   */
  const snooze = () => {
    localStorage.setItem(STORAGE_KEY, "declined");
    // Clear any legacy snooze key so we never re-prompt from a stale
    // 24h timer after upgrading to this build.
    localStorage.removeItem(SNOOZE_KEY);
    setStatus("declined");
    window.dispatchEvent(new Event("acreos:cookieconsent"));
  };

  // Don't render during SSR hydration or after consent already given
  if (status !== null) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      aria-live="polite"
      // F-D05: render as a bottom-center card rather than a full-width strip.
      // F-D06: respect iOS safe-area-inset-bottom so the buttons don't sit
      // under the home-bar gesture zone (the previous bottom-2 had them
      // landing in iOS's tap-intercept area, making the banner feel
      // impossible to click out of on mobile).
      // z-overlay keeps it BELOW the mobile bottom nav (z-floating) so it never covers the
      // tab bar. On mobile it sits ABOVE the 72px bottom nav (+ safe area) so it
      // doesn't bury primary CTAs like "Add lead"; on sm+ (no bottom nav) it
      // returns to the normal 8px offset.
      className="fixed inset-x-2 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-[min(48rem,calc(100vw-2rem))] z-overlay rounded-xl border border-border/60 bg-surface-chrome backdrop-blur-sm p-4 pr-12 shadow-2xl bottom-[calc(72px+env(safe-area-inset-bottom,0px)+12px)] sm:bottom-[max(env(safe-area-inset-bottom,0px)+8px,8px)]"
      data-testid="cookie-consent-banner"
    >
      {/* Explicit dismiss-for-now affordance — top-right X. Snoozes 24h. */}
      <button
        type="button"
        onClick={snooze}
        aria-label="Dismiss for now"
        data-testid="cookie-consent-dismiss"
        className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted active:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex-1 text-sm text-muted-foreground">
          We use essential cookies to run this site. With your permission, we
          also use optional analytics cookies to understand and improve how it
          works. Nothing optional is set unless you choose Accept — Decline (or
          taking no action) keeps optional cookies off. See our{" "}
          <Link
            href="/privacy"
            className="underline hover:text-foreground active:text-foreground inline-flex items-center min-h-11 px-1 -mx-1"
          >
            Privacy &amp; Cookie Policy
          </Link>
          .
        </div>
        <div className="flex w-full gap-2 sm:w-auto sm:shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={decline}
            aria-label="Decline optional cookies"
            data-testid="cookie-consent-decline"
            // sm:min-h-11 — the Button default carries sm:min-h-9 (36px,
            // "desktop stays dense"), which tw-merge keeps alongside a bare
            // min-h-11 and wins at >=640px. A 768px iPad is a TOUCH device on
            // the desktop-density arm, and consent is a universal surface:
            // 44px on every pointer type, every width.
            className="min-h-11 sm:min-h-11 flex-1 sm:flex-initial"
          >
            Decline
          </Button>
          <Button
            type="button"
            onClick={accept}
            aria-label="Accept optional cookies"
            data-testid="cookie-consent-accept"
            className="min-h-11 sm:min-h-11 flex-1 sm:flex-initial"
          >
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}
