import { SignIn, SignUp, useUser } from "@clerk/react";
import { Redirect } from "wouter";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";

// Only allow same-origin paths to protect against open-redirect abuse.
function sanitizeNextPath(raw: string | null): string {
  if (!raw) return "/today";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/today";
  if (raw === "/auth" || raw.startsWith("/auth?") || raw.startsWith("/auth/")) return "/today";
  return raw;
}

export default function AuthPage() {
  const { user, isLoading } = useAuth();
  const { isSignedIn, isLoaded } = useUser();
  const params = new URLSearchParams(window.location.search);
  const [mode, setMode] = useState<"sign-in" | "sign-up">(
    params.get("mode") === "register" ? "sign-up" : "sign-in"
  );
  const redirectTo = sanitizeNextPath(params.get("next"));

  // If fully authenticated, go to intended destination (or /today fallback)
  if (isLoaded && isSignedIn && user) {
    return <Redirect to={redirectTo} />;
  }

  // If Clerk says signed in but we don't have app user yet, show loader briefly
  if (isLoaded && isSignedIn && isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" aria-label="Signing you in">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md flex flex-col items-center gap-4">
        {mode === "sign-in" ? (
          <SignIn
            routing="hash"
            afterSignInUrl={redirectTo}
            afterSignUpUrl={redirectTo}
          />
        ) : (
          <SignUp
            routing="hash"
            afterSignUpUrl={redirectTo}
            afterSignInUrl={redirectTo}
          />
        )}
        <button
          onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors min-h-[44px] px-4"
        >
          {mode === "sign-in" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
