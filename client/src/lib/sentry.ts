import * as Sentry from "@sentry/react";

const COOKIE_CONSENT_KEY = "acreos_cookie_consent";

let sentryInitialized = false;

/**
 * Actually perform the Sentry.init call.
 * Guarded so it can only run once per page load.
 */
function doSentryInit(): void {
  if (sentryInitialized) return;

  const dsn = (import.meta.env.VITE_SENTRY_DSN || (window as any).__ENV__?.VITE_SENTRY_DSN) as string | undefined;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // 10% of sessions get full replay — useful for debugging UX issues
    replaysSessionSampleRate: 0.1,
    // 100% of sessions with an error get a replay
    replaysOnErrorSampleRate: 1.0,
    tracesSampleRate: parseFloat((import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE as string) ?? "0.1"),
    beforeSend(event) {
      // Never send auth tokens or session cookies to Sentry
      if (event.request?.headers) {
        delete event.request.headers["Authorization"];
        delete event.request.headers["Cookie"];
      }
      return event;
    },
  });

  sentryInitialized = true;
}

/**
 * Initialize Sentry for the React client, but only if cookie consent
 * has already been given. No-op when VITE_SENTRY_DSN is not set (local dev)
 * or when the user has not yet accepted cookies (GDPR/ePrivacy).
 */
export function initClientSentry(): void {
  const consent = localStorage.getItem(COOKIE_CONSENT_KEY);
  if (consent === "accepted") {
    doSentryInit();
  }
}

/**
 * Called when the user explicitly accepts cookies in the consent banner.
 * Initializes Sentry immediately so the rest of the session is tracked.
 */
export function initSentryAfterConsent(): void {
  doSentryInit();
}

export { Sentry };
