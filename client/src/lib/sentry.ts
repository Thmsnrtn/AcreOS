import * as Sentry from "@sentry/react";
import { onCLS, onINP, onLCP, onFCP, onTTFB } from "web-vitals";

const COOKIE_CONSENT_KEY = "acreos_cookie_consent";

let sentryInitialized = false;

/**
 * Resolve the build's git SHA. Injected at build time as `VITE_GIT_SHA`
 * (see vite.config.ts / fly.toml). Falls back to "unknown" so missing
 * env doesn't break the release tag entirely; CI should fail the build
 * before we ever ship "unknown" to prod.
 */
function getRelease(): string {
  const sha =
    (import.meta.env.VITE_GIT_SHA as string | undefined) ||
    ((window as any).__ENV__?.VITE_GIT_SHA as string | undefined);
  return sha && sha.length > 0 ? sha : "unknown";
}

/**
 * Capture Core Web Vitals as Sentry custom events. Each metric is
 * attached as a measurement on a transaction-shaped breadcrumb so it
 * shows up alongside performance data in the Sentry UI.
 *
 * We intentionally use `captureMessage` with structured `extra` rather
 * than the (heavier) BrowserTracing transactions so we get vitals data
 * at every page load without paying the tracing-bundle weight.
 */
function installWebVitalsReporter(): void {
  const report = (name: string) => (metric: { value: number; id: string; rating?: string }) => {
    Sentry.captureMessage(`web-vital.${name}`, {
      level: "info",
      tags: { metric: name, rating: metric.rating ?? "unknown" },
      extra: { value: metric.value, id: metric.id },
    });
  };
  // Core Web Vitals — CLS / LCP / INP cover the Google triad. FID was
  // retired in favor of INP in 2024; we keep FCP+TTFB for diagnostics.
  onCLS(report("CLS"));
  onLCP(report("LCP"));
  onINP(report("INP"));
  onFCP(report("FCP"));
  onTTFB(report("TTFB"));
}

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
    // Tag every event with the deployed git SHA so source maps line up
    // and we can attribute regressions to a specific deploy.
    release: getRelease(),
    integrations: [
      // Privacy-safe session replay: text is masked, media is blocked.
      // This is the strictest setting — even our own app text won't
      // appear in replays, only DOM structure + interactions.
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
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

  // Web vitals reporter only makes sense once Sentry is up.
  installWebVitalsReporter();
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

/**
 * Attach the authenticated user to subsequent Sentry events. Call from
 * an effect that watches `useAuth()` so we tag events as soon as the
 * server confirms identity. No-op if Sentry hasn't initialized (e.g.,
 * pre-consent or local dev without DSN).
 */
export function setSentryUser(user: { id: string | number; email?: string } | null): void {
  if (!sentryInitialized) return;
  if (user === null) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({
    id: String(user.id),
    ...(user.email ? { email: user.email } : {}),
  });
}

export { Sentry };
