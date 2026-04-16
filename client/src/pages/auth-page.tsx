import { SignIn, SignUp } from "@clerk/react";
import { Redirect } from "wouter";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";

function getInitialMode(): "sign-in" | "sign-up" {
  const params = new URLSearchParams(window.location.search);
  if (params.get("mode") === "register") return "sign-up";
  // Default to sign-up: it handles both new AND existing Google OAuth accounts
  // without the "External Account not found" error that SignIn throws
  return "sign-up";
}

// Prevent redirect loops: track how many times we've landed on /auth
let authPageLoadCount = 0;
let lastAuthPageLoad = 0;

export default function AuthPage() {
  const { user, isLoading, authFailCount } = useAuth();
  const [mode, setMode] = useState(getInitialMode);

  // Track rapid redirects to /auth (strobe light prevention)
  const now = Date.now();
  if (now - lastAuthPageLoad < 3000) {
    authPageLoadCount++;
  } else {
    authPageLoadCount = 1;
  }
  lastAuthPageLoad = now;

  // If we're in a redirect loop (hit auth page 3+ times in 10 seconds),
  // just show the sign-in form and stop redirecting
  const inRedirectLoop = authPageLoadCount >= 3;

  // Listen for Clerk "External Account not found" errors and auto-switch to SignUp
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const errorEl = document.querySelector('[data-localization-key*="externalAccountNotFound"], .cl-formFieldErrorText');
      if (errorEl && errorEl.textContent?.toLowerCase().includes("external account")) {
        setMode("sign-up");
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!isLoading && user && !inRedirectLoop) {
    return <Redirect to="/today" />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      {mode === "sign-in" ? (
        <SignIn
          routing="hash"
          forceRedirectUrl="/today"
          signUpUrl="/auth?mode=register"
        />
      ) : (
        <SignUp
          routing="hash"
          forceRedirectUrl="/today"
          signInUrl="/auth"
        />
      )}
    </div>
  );
}
