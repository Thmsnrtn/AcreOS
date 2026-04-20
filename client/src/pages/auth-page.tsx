import { SignIn, SignUp } from "@clerk/react";
import { Link, Redirect } from "wouter";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useBrandName } from "@/hooks/use-white-label";
import { ArrowLeft } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

export default function AuthPage() {
  const { user, isLoading } = useAuth();
  const brandName = useBrandName();
  const params = new URLSearchParams(window.location.search);
  const [mode, setMode] = useState<"sign-in" | "sign-up">(
    params.get("mode") === "register" ? "sign-up" : "sign-in"
  );
  const inviteToken = params.get("invite");
  const inviteAcceptedRef = useRef(false);

  // Don't redirect while Clerk is processing an SSO callback —
  // premature redirect unmounts <SignIn> and kills the OAuth flow
  const isHandlingCallback = window.location.hash.includes("sso-callback") ||
                             window.location.hash.includes("verify");

  // Invite-accept flow: if the user arrived with ?invite=<token> and they're
  // now signed in, attach them to the inviting org before the redirect to
  // /today. Runs once per page-load.
  useEffect(() => {
    if (!user || !inviteToken || inviteAcceptedRef.current) return;
    inviteAcceptedRef.current = true;
    (async () => {
      try {
        await apiRequest("POST", "/api/organization/invitations/accept", {
          token: inviteToken,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        queryClient.invalidateQueries({ queryKey: ["/api/organization"] });
        queryClient.invalidateQueries({ queryKey: ["/api/organization/members"] });
      } catch {
        /* non-fatal — user is still signed in; invite link may have expired */
      }
    })();
  }, [user, inviteToken]);

  // Option B: server-backed auth is the truth. If /api/auth/user came
  // back with a user, we're signed in — send to dashboard.
  if (user && !isHandlingCallback) {
    return <Redirect to="/today" />;
  }

  // Still resolving the server-side auth check after ticket/OAuth — loader.
  if (isLoading && !isHandlingCallback) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md flex flex-col items-center gap-6">
        {/* Branding — swaps to white-label tenant name when configured */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <span className="text-white font-bold text-lg">{brandName.slice(0, 1)}</span>
            </div>
            <span className="text-2xl font-bold tracking-tight">{brandName}</span>
          </div>
          <p className="text-sm text-muted-foreground text-center">
            The operating system for land investors
          </p>
        </div>

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
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to home
        </Link>
      </div>
    </div>
  );
}
