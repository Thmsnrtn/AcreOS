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
import { initSentryAfterConsent } from "@/lib/sentry";

const STORAGE_KEY = "acreos_cookie_consent";
type ConsentStatus = "accepted" | "declined" | null;

export function CookieConsentBanner() {
  const [status, setStatus] = useState<ConsentStatus | "loading">("loading");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as ConsentStatus | null;
    setStatus(stored);
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

  // Don't render during SSR hydration or after consent already given
  if (status !== null) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      aria-live="polite"
      // F-D05: render as a bottom-center card rather than a full-width strip.
      // The strip stacked at z-50 covered the bottom of the sidebar — Sign Out
      // (and any other bottom-sidebar control) became unclickable until the
      // user accepted/declined cookies. Card form sits clear of the sidebar
      // on desktop, still readable + reachable on mobile, and remains above
      // app content via z-50.
      className="fixed bottom-2 left-2 right-2 sm:bottom-4 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-[min(48rem,calc(100vw-2rem))] z-50 rounded-xl border border-border/60 bg-background/95 backdrop-blur-sm p-4 shadow-2xl"
      data-testid="cookie-consent-banner"
    >
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="flex-1 text-sm text-muted-foreground">
          We use cookies and similar technologies to improve your experience.
          By continuing, you agree to our{" "}
          <Link
            href="/privacy"
            className="underline hover:text-foreground inline-flex items-center min-h-11 px-1 -mx-1"
          >
            Privacy Policy
          </Link>{" "}
          and{" "}
          <Link
            href="/terms"
            className="underline hover:text-foreground inline-flex items-center min-h-11 px-1 -mx-1"
          >
            Terms of Service
          </Link>
          .
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={decline}
            aria-label="Decline cookies"
            data-testid="cookie-consent-decline"
            className="min-h-11"
          >
            Decline
          </Button>
          <Button
            type="button"
            onClick={accept}
            aria-label="Accept all cookies"
            data-testid="cookie-consent-accept"
            className="min-h-11"
          >
            Accept all
          </Button>
        </div>
      </div>
    </div>
  );
}
