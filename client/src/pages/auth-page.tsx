import { SignIn, SignUp } from "@clerk/react";
import { Redirect } from "wouter";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";

function getInitialMode(): "sign-in" | "sign-up" {
  const params = new URLSearchParams(window.location.search);
  if (params.get("mode") === "register") return "sign-up";
  return "sign-in";
}

// Prevent redirect loops
let authPageLoadCount = 0;
let lastAuthPageLoad = 0;

export default function AuthPage() {
  const { user, isLoading, authFailCount } = useAuth();
  const [mode, setMode] = useState(getInitialMode);

  const now = Date.now();
  if (now - lastAuthPageLoad < 3000) {
    authPageLoadCount++;
  } else {
    authPageLoadCount = 1;
  }
  lastAuthPageLoad = now;

  const inRedirectLoop = authPageLoadCount >= 3;

  // Watch for Clerk errors and auto-switch modes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const allText = document.querySelector('.cl-rootBox')?.textContent?.toLowerCase() || '';
      // "External Account not found" → switch to SignUp
      if (mode === 'sign-in' && allText.includes('external account')) {
        setMode('sign-up');
      }
      // "already has an account" or "already exists" → switch to SignIn
      if (mode === 'sign-up' && (allText.includes('already has an account') || allText.includes('already exists') || allText.includes('already been taken'))) {
        setMode('sign-in');
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [mode]);

  if (!isLoading && user && !inRedirectLoop) {
    return <Redirect to="/today" />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md">
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
        <div className="text-center mt-4">
          <button
            onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {mode === "sign-in" ? "Need an account? Sign up" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
