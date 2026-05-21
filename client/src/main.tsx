import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import App from "./App";
import { clientLogger } from "@/lib/clientLogger";
import "./fonts.css";
import "./index.css";
import { initClientSentry } from "./lib/sentry";
import { installCsrfFetchInterceptor } from "./lib/csrf-fetch";
import { installClerkSessionRecovery } from "./lib/clerk-session-recovery";
import { installVersionCheck } from "./lib/version-check";

// Install CSRF header interceptor before any fetch fires.
installCsrfFetchInterceptor();
// Safety net for ticket/OAuth sign-ins that leave Clerk.session un-selected.
installClerkSessionRecovery();

// F-D10: detect lazy-chunk load failures and hard-reload to pull the new
// bundle. When a deploy lands, an already-open tab still references the
// pre-deploy chunk hashes; the next dynamic import resolves to a 404 (or,
// before F-D10's server fix, to the SPA HTML shell that the browser
// refuses to execute as a module). Without this self-heal the user lands
// on the global 500 page and has to manually refresh. Guard against an
// infinite reload loop by tagging sessionStorage with a per-window cap.
if (typeof window !== "undefined") {
  const RELOAD_KEY = "acreos:chunk-reloaded-at";
  const handle = (msg: string) => {
    if (!/Failed to fetch dynamically imported module|Loading (?:CSS )?chunk|Importing a module script failed|MIME type of "text\/html"/i.test(msg)) {
      return;
    }
    try {
      const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
      if (Date.now() - last < 10_000) return; // already reloaded recently
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch { /* sessionStorage unavailable — still reload */ }
    window.location.reload();
  };
  window.addEventListener("error", (e) => handle(String(e.message || "")));
  window.addEventListener("unhandledrejection", (e) => handle(String((e as PromiseRejectionEvent).reason || "")));
}

// Initialize Sentry before rendering (no-op if VITE_SENTRY_DSN is unset)
initClientSentry();

// Stale-build self-heal — independent of the SW path so it still works
// for users whose service worker (or Cloudflare edge, or HTTP cache) is
// holding an old build. Polls /api/version and reloads when it changes.
if (import.meta.env.PROD) {
  installVersionCheck();
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // Real-user goal: "open the app, see latest UI; no manual cache clearing."
  // Three pieces below make this work even in Safari (which is the most
  // aggressive HTTP-cacher of service-worker scripts):
  //
  //   1. updateViaCache: 'none' — Safari otherwise serves /sw.js itself
  //      from the HTTP cache for up to 24h, so users never see new SWs
  //      ship. 'none' forces a network revalidation on every check.
  //   2. registration.update() on each page load — actively pulls the
  //      latest sw.js even if the browser hasn't decided to check yet.
  //   3. controllerchange listener — once a new SW takes over the page,
  //      reload exactly once so the user instantly sees the new build.
  //      The `reloaded` guard prevents the reload loop that can happen
  //      when DevTools' "Update on reload" is enabled.
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => {
        clientLogger.info('SW registered:', registration.scope);
        registration.update().catch(() => { /* best-effort */ });

        // When a new SW is detected, tell it to skip the waiting phase
        // so activation is immediate. The controllerchange listener below
        // handles the reload.
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              installing.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      })
      .catch((error) => {
        clientLogger.info('SW registration failed:', error);
      });

    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
  });
}

// Runtime env injected by server into window.__ENV__ (for production builds
// where VITE_* vars aren't available at Docker build time)
const runtimeEnv = (window as any).__ENV__ || {};
const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || runtimeEnv.VITE_CLERK_PUBLISHABLE_KEY;
if (!publishableKey) {
  throw new Error("VITE_CLERK_PUBLISHABLE_KEY is not set");
}

createRoot(document.getElementById("root")!).render(
  <ClerkProvider
    publishableKey={publishableKey}
    proxyUrl="/__clerk"
    signInFallbackRedirectUrl="/today"
    signUpFallbackRedirectUrl="/onboarding-v2"
    appearance={{
      // Clerk's default brand color is purple (#6c47ff). Override to our
      // terracotta primary so the Sign In / Sign Up widgets match the
      // rest of AcreOS. Hex mirrors hsl(18 48% 52%) = terracotta.
      variables: {
        colorPrimary: "#c17a4c",
        borderRadius: "0.625rem",
        fontFamily: "inherit",
      },
    }}
  >
    <App />
  </ClerkProvider>
);
