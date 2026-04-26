import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import App from "./App";
import "./fonts.css";
import "./index.css";
import { initClientSentry } from "./lib/sentry";
import { installCsrfFetchInterceptor } from "./lib/csrf-fetch";
import { installClerkSessionRecovery } from "./lib/clerk-session-recovery";

// Install CSRF header interceptor before any fetch fires.
installCsrfFetchInterceptor();
// Safety net for ticket/OAuth sign-ins that leave Clerk.session un-selected.
installClerkSessionRecovery();

// Initialize Sentry before rendering (no-op if VITE_SENTRY_DSN is unset)
initClientSentry();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('SW registered:', registration.scope);
      })
      .catch((error) => {
        console.log('SW registration failed:', error);
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
