/**
 * Client-side analytics surface — single import point for PostHog.
 *
 * Why this file exists: pre-Wave-3 the only "telemetry" in the codebase was
 * a TODO comment in server/routes-dashboard.ts that said `// - PostHog //
 * - Mixpanel`. Neither was installed. We had no UTM capture at signup, no
 * way to answer "did anyone sign up today?", and no way to attribute
 * signups to a marketing channel. This wrapper is the substrate that
 * makes the rest of distribution telemetry possible.
 *
 * Design:
 *   - Single export surface: initAnalytics / trackEvent / identifyUser /
 *     resetAnalytics. The rest of the app never imports posthog-js directly.
 *   - Graceful no-op when VITE_POSTHOG_KEY is missing. Local dev, CI, and
 *     environments that don't want telemetry simply don't set the key and
 *     every call becomes a no-op. NEVER throws.
 *   - Autocapture is disabled. Every captured event is intentional —
 *     spelled out by name in product code — because retroactively deciding
 *     "did I instrument this funnel?" with autocapture is a nightmare and
 *     the noise blows past the free tier in a week.
 *   - capture_pageview is also disabled. We capture a single deliberate
 *     `app_open` on first mount via the App-level effect and otherwise
 *     leave SPA route changes to explicit events at the boundaries that
 *     matter (signup_completed, persona_changed, etc.).
 *
 * Env:
 *   - VITE_POSTHOG_KEY   — public project key (required to enable).
 *   - VITE_POSTHOG_HOST  — defaults to https://us.i.posthog.com.
 */

import posthog from "posthog-js";

const DEFAULT_HOST = "https://us.i.posthog.com";

let initialized = false;
let enabled = false;
let initLogged = false;

function readEnv(key: string): string | undefined {
  // Vite inlines import.meta.env.* at build time. We also accept a
  // runtime-injected window.__ENV__ shape so the founder can re-tune
  // without a rebuild (mirrors how sentry.ts resolves its DSN).
  const fromBuild = (import.meta.env as Record<string, unknown>)[key];
  if (typeof fromBuild === "string" && fromBuild.length > 0) return fromBuild;
  if (typeof window !== "undefined") {
    const runtime = (window as unknown as { __ENV__?: Record<string, unknown> }).__ENV__;
    const fromRuntime = runtime?.[key];
    if (typeof fromRuntime === "string" && fromRuntime.length > 0) return fromRuntime;
  }
  return undefined;
}

/**
 * Initialize PostHog. Safe to call multiple times — only the first call
 * does any work. Call once before rendering React (see main.tsx).
 */
export function initAnalytics(): void {
  if (initialized) return;
  initialized = true;

  const key = readEnv("VITE_POSTHOG_KEY");
  if (!key) {
    enabled = false;
    if (!initLogged) {
      initLogged = true;
      // Intentional console.info — this is client-side build-time
      // telemetry configuration, not server logging. The structured
      // server logger (server/utils/logger.ts) is out of scope here.
      // eslint-disable-next-line no-console
      console.info("[analytics] PostHog key not configured; events will be no-ops");
    }
    return;
  }

  const host = readEnv("VITE_POSTHOG_HOST") ?? DEFAULT_HOST;

  try {
    posthog.init(key, {
      api_host: host,
      // SPA — we capture a single deliberate app_open on first mount and
      // emit explicit events at meaningful boundaries. Autocapture would
      // bury those signals in click noise and chew through the free tier.
      capture_pageview: false,
      autocapture: false,
      persistence: "localStorage",
    });
    enabled = true;
  } catch (err) {
    // PostHog SDK init failed (network, blocked extension, etc.). Treat
    // as no-op so the app keeps working.
    enabled = false;
    // eslint-disable-next-line no-console
    console.info("[analytics] PostHog init failed; events will be no-ops", err);
  }
}

/**
 * Capture a named event with optional structured props. No-op when the
 * key is unset or init failed.
 */
export function trackEvent(name: string, props?: Record<string, unknown>): void {
  if (!enabled) return;
  try {
    posthog.capture(name, props);
  } catch {
    /* best-effort — analytics must never break the app */
  }
}

/**
 * Canonical conversion funnel events. These five are the spine the
 * acquisition dashboard reads — every other captured event is supplemental.
 * If you're tempted to add a sixth, ask Soren first: the smaller this
 * set, the easier the funnel is to reason about.
 *
 *   signup_started        — user enters sign-up mode in AuthPage (intent)
 *   signup_completed      — server-confirmed auth + UTM flushed (conversion)
 *   first_value_reached   — org onboarding marked complete (activation)
 *   pax_first_interaction — first time user lands on the Pax surface (engagement)
 *   trial_to_paid         — subscription transitions to active billing (revenue)
 *
 * Phase Zero-Two foundation: these five are the funnel Lena/Solene use to
 * answer "where do trial signups come from + what's their funnel
 * completion %" once 30 days of traffic accumulate.
 */
export type CanonicalEvent =
  | "signup_started"
  | "signup_completed"
  | "first_value_reached"
  | "pax_first_interaction"
  | "trial_to_paid";

/**
 * Type-checked emit for the canonical funnel events. Use this in product
 * code instead of trackEvent() with a string literal — the compiler
 * catches typos, and Soren/Lena can grep usage with confidence.
 */
export function trackCanonicalEvent(
  name: CanonicalEvent,
  props?: Record<string, unknown>,
): void {
  trackEvent(name, props);
}

/**
 * Tag subsequent events with a stable user id + optional traits. Call
 * once the server has confirmed the authenticated user (useAuth().user).
 */
export function identifyUser(id: string, traits?: Record<string, unknown>): void {
  if (!enabled) return;
  try {
    posthog.identify(id, traits);
  } catch {
    /* best-effort */
  }
}

/**
 * Drop the current identity. Call from the sign-out path so subsequent
 * events on the same browser aren't attributed to the previous user.
 */
export function resetAnalytics(): void {
  if (!enabled) return;
  try {
    posthog.reset();
  } catch {
    /* best-effort */
  }
}
