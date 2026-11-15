/**
 * Entry of the FOUNDER build (dist/founder — client/founder.html, base
 * `/founder-app/`). P1-9 / X-2. Mounts FounderApp, which holds only the founder
 * route tree.
 *
 * Mirrors client/src/main.tsx's boot (CSRF interceptor, Clerk session
 * recovery, Sentry, analytics, chunk-failure self-heal, version check) so the
 * founder surface authenticates and reports errors exactly as before. It does
 * NOT register the service worker: the customer entry owns /sw.js (scope `/`),
 * which already covers this origin, and a second registration path would only
 * race the first one's update/reload handling.
 */
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import FounderApp from "./FounderApp";
import "./fonts.css";
import "./index.css";
import { initClientSentry } from "./lib/sentry";
import { initAnalytics } from "./lib/analytics";
import { installCsrfFetchInterceptor } from "./lib/csrf-fetch";
import { shouldReloadForChunkFailure } from "./lib/chunkReload";
import { installClerkSessionRecovery } from "./lib/clerk-session-recovery";
import { clerkProviderProxyProps } from "./lib/clerkDirect";
import { installVersionCheck } from "./lib/version-check";

// Install CSRF header interceptor before any fetch fires.
installCsrfFetchInterceptor();
// Safety net for ticket/OAuth sign-ins that leave Clerk.session un-selected.
installClerkSessionRecovery();

// F-D10: detect lazy-chunk load failures and hard-reload to pull the new
// bundle (an open tab still references pre-deploy chunk hashes; the server
// answers a missing /founder-app/ chunk with a 404, not the HTML shell). Guard
// against an infinite reload loop with a per-window cap in sessionStorage —
// the same logic, and the same key, as the customer entry.
if (typeof window !== "undefined") {
  const RELOAD_KEY = "acreos:chunk-reloaded-at";
  // A navigation away aborts in-flight dynamic imports; that abort is not a
  // stale bundle and must never reload the page being left (lib/chunkReload).
  let unloading = false;
  let unloadingTimer: ReturnType<typeof setTimeout> | undefined;
  const markUnloading = () => {
    unloading = true;
    clearTimeout(unloadingTimer);
    unloadingTimer = setTimeout(() => { unloading = false; }, 5_000);
  };
  window.addEventListener("pagehide", markUnloading);
  window.addEventListener("beforeunload", markUnloading);
  window.addEventListener("pageshow", () => { unloading = false; });
  const handle = (msg: string) => {
    let lastReloadAt = 0;
    try {
      lastReloadAt = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    } catch { /* sessionStorage unavailable — treat as never reloaded */ }
    if (!shouldReloadForChunkFailure({ message: msg, unloading, lastReloadAt, now: Date.now() })) return;
    try {
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch { /* sessionStorage unavailable — still reload */ }
    window.location.reload();
  };
  window.addEventListener("error", (e) => handle(String(e.message || "")));
  window.addEventListener("unhandledrejection", (e) => handle(String((e as PromiseRejectionEvent).reason || "")));
}

// Initialize Sentry before rendering (no-op if VITE_SENTRY_DSN is unset)
initClientSentry();

// Initialize PostHog before rendering (no-op if VITE_POSTHOG_KEY is unset).
initAnalytics();

// Stale-build self-heal: polls /api/version and reloads when it changes.
if (import.meta.env.PROD) {
  installVersionCheck();
}

// Runtime env injected by the server into window.__ENV__ (production builds
// have no VITE_* vars at Docker build time).
const runtimeEnv = (window as any).__ENV__ || {};
const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || runtimeEnv.VITE_CLERK_PUBLISHABLE_KEY;

// E2E test-auth: skip the real ClerkProvider and let the API-based useAuth
// carry the session (set only by the server when E2E_TEST_AUTH is active
// off-Fly — see client/src/main.tsx).
const isE2ETestAuth = runtimeEnv.E2E_TEST_AUTH === "1";

if (!publishableKey && !isE2ETestAuth) {
  throw new Error("VITE_CLERK_PUBLISHABLE_KEY is not set");
}

createRoot(document.getElementById("root")!).render(
  isE2ETestAuth ? (
    <FounderApp />
  ) : (
    <ClerkProvider
      publishableKey={publishableKey}
      {...clerkProviderProxyProps(runtimeEnv)}
      signInFallbackRedirectUrl="/today"
      signUpFallbackRedirectUrl="/onboarding-v2"
      appearance={{
        // Same terracotta primary override as the customer entry.
        variables: {
          colorPrimary: "#c17a4c",
          borderRadius: "0.625rem",
          fontFamily: "inherit",
        },
      }}
    >
      <FounderApp />
    </ClerkProvider>
  )
);
