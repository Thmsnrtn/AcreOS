import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import App from "./App";
import "./index.css";
import { initClientSentry } from "./lib/sentry";

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
    signInUrl="/auth"
    signUpUrl="/auth?mode=register"
    afterSignInUrl="/today"
    afterSignUpUrl="/today"
  >
    <App />
  </ClerkProvider>
);
