import { SignIn, SignUp, useUser } from "@clerk/react";
import { Redirect } from "wouter";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";

export default function AuthPage() {
  const { user, isLoading } = useAuth();
  const { isSignedIn, isLoaded } = useUser();
  const params = new URLSearchParams(window.location.search);
  const [mode, setMode] = useState<"sign-in" | "sign-up">(
    params.get("mode") === "register" ? "sign-up" : "sign-in"
  );

  // Don't redirect while Clerk is processing an SSO callback —
  // premature redirect unmounts <SignIn> and kills the OAuth flow
  const isHandlingCallback = window.location.hash.includes("sso-callback") ||
                             window.location.hash.includes("verify");

  // If fully authenticated AND not mid-callback, go to dashboard
  if (isLoaded && isSignedIn && user && !isHandlingCallback) {
    return <Redirect to="/today" />;
  }

  // If Clerk says signed in but we don't have app user yet, show loader briefly
  if (isLoaded && isSignedIn && isLoading && !isHandlingCallback) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md flex flex-col items-center gap-4">
        {mode === "sign-in" ? (
          <SignIn
            routing="hash"
            fallbackRedirectUrl="/today"
          />
        ) : (
          <SignUp
            routing="hash"
            fallbackRedirectUrl="/today"
          />
        )}
        <button
          onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {mode === "sign-in" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
