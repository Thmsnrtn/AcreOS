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
  };

  const decline = () => {
    localStorage.setItem(STORAGE_KEY, "declined");
    setStatus("declined");
  };

  // Don't render during SSR hydration or after consent already given
  if (status !== null) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      aria-live="polite"
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/50 bg-background/95 backdrop-blur-sm p-4 shadow-lg"
      data-testid="cookie-consent-banner"
    >
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="flex-1 text-sm text-muted-foreground">
          We use cookies and similar technologies to improve your experience.
          By continuing, you agree to our{" "}
          <Link href="/privacy" className="underline hover:text-foreground">
            Privacy Policy
          </Link>{" "}
          and{" "}
          <Link href="/terms" className="underline hover:text-foreground">
            Terms of Service
          </Link>
          .
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={decline}
            data-testid="cookie-consent-decline"
          >
            Decline
          </Button>
          <Button
            size="sm"
            onClick={accept}
            data-testid="cookie-consent-accept"
          >
            Accept All
          </Button>
        </div>
      </div>
    </div>
  );
}
