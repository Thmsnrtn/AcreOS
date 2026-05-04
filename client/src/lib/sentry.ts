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
 * Read a numeric env var with a default. Falls back to `__ENV__` (runtime
 * injected) so the founder can re-tune sampling without rebuilding.
 */
function readRate(envKey: string, fallback: number): number {
  const raw =
    (import.meta.env[envKey] as string | undefined) ||
    ((window as any).__ENV__?.[envKey] as string | undefined);
  if (raw === undefined || raw === "") return fallback;
  const parsed = parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return fallback;
  return parsed;
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
 * List of error patterns we never want to send to Sentry — high-volume,
 * low-signal noise that blows past the free tier without ever pointing
 * at a real bug.
 */
const NOISE_MESSAGE_PATTERNS = [
  /ResizeObserver loop limit exceeded/i,
  /ResizeObserver loop completed with undelivered notifications/i,
  /Non-Error promise rejection captured/i,
  /Network request failed/i,
  /Load failed/i,
  /The operation was aborted/i,
];

const NOISE_ERROR_NAMES = new Set([
  "AbortError",
  "CanceledError",
  "TypeError: Failed to fetch", // some browsers serialize this as the name
]);

function isExtensionFrame(filename?: string): boolean {
  if (!filename) return false;
  return (
    filename.startsWith("chrome-extension://") ||
    filename.startsWith("moz-extension://") ||
    filename.startsWith("safari-web-extension://") ||
    filename.includes("extensionId=") ||
    filename.includes("/extension/")
  );
}

/**
 * Drop common noise — abort errors during navigation, ResizeObserver
 * loops, browser-extension errors. These are the top cost contributors
 * on the free tier and never represent app bugs.
 */
function isNoiseEvent(event: Sentry.ErrorEvent, hint?: Sentry.EventHint): boolean {
  // Match by error name (AbortError, CanceledError…)
  const original = (hint?.originalException ?? null) as unknown;
  if (original && typeof original === "object") {
    const name = (original as { name?: string }).name;
    if (name && NOISE_ERROR_NAMES.has(name)) return true;
  }

  // Match by message
  const msg =
    event.message ||
    event.exception?.values?.[0]?.value ||
    "";
  if (msg && NOISE_MESSAGE_PATTERNS.some((re) => re.test(msg))) return true;

  // Match by stack: any frame from a browser extension
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
  if (frames.some((f) => isExtensionFrame(f.filename))) return true;

  return false;
}

/**
 * Actually perform the Sentry.init call.
 * Guarded so it can only run once per page load.
 */
function doSentryInit(): void {
  if (sentryInitialized) return;

  const dsn = (import.meta.env.VITE_SENTRY_DSN || (window as any).__ENV__?.VITE_SENTRY_DSN) as string | undefined;
  if (!dsn) return;

  const isProd = import.meta.env.MODE === "production";

  // Sampling rates — env-driven so the founder can re-tune without redeploy.
  // Defaults are tuned for Sentry's free tier (5k errors / 10k perf units / 50 replays per month).
  // Replay session sampling: 1% in prod (down from 10%) — we still capture
  // 100% of replays around an actual error via replaysOnErrorSampleRate.
  const replaySession = readRate(
    "VITE_SENTRY_REPLAY_SESSION_RATE",
    isProd ? 0.01 : 0.0,
  );
  // On-error replay: 0.5 default (down from 1.0 on 2026-05-04, Workstream B.5).
  // At 100 customers, 1.0 projected ~915 replays/mo vs free-tier 50/mo cap.
  // 0.5 still captures replay around half of all errors — high signal —
  // while staying within budget. Revisit when MRR > $5K (per founder
  // directive) or when Sentry Replay paid SKU is purchased.
  const replayOnError = readRate("VITE_SENTRY_REPLAY_ON_ERROR_RATE", 0.5);
  // Traces: 5% in prod, 0 in dev/local.
  const tracesRate = readRate(
    "VITE_SENTRY_TRACES_RATE",
    isProd ? 0.05 : 0.0,
  );
  // Profiles: 0 in prod for now (TODO: founder may want perf profiles —
  // bump to 0.05 if/when we sign up for the paid Profiling SKU).
  const profilesRate = readRate(
    "VITE_SENTRY_PROFILES_RATE",
    0.0,
  );

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
    replaysSessionSampleRate: replaySession,
    replaysOnErrorSampleRate: replayOnError,
    tracesSampleRate: tracesRate,
    profilesSampleRate: profilesRate,
    beforeSend(event, hint) {
      // Drop known-noise events before they count against the quota.
      if (isNoiseEvent(event, hint)) return null;

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
 *
 * Note: replay specifically requires consent — replay records DOM
 * interactions which qualify as personal data under GDPR/ePrivacy. We
 * gate the entire init (including non-replay tracing) on consent for
 * simplicity and to avoid splitting the DSN by category.
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
