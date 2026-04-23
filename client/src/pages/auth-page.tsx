import { SignIn, SignUp } from "@clerk/react";
import { Link, Redirect } from "wouter";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useBrandName } from "@/hooks/use-white-label";
import { ArrowLeft } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { usePageMeta } from "@/hooks/use-document-title";

export default function AuthPage() {
  usePageMeta(
    "Sign in",
    "Sign in to AcreOS — the AI-powered platform land investors use to manage leads, properties, deals, and seller financing in one place."
  );
  const { user, isLoading } = useAuth();
  const brandName = useBrandName();
  const params = new URLSearchParams(window.location.search);
  const [mode, setMode] = useState<"sign-in" | "sign-up">(
    params.get("mode") === "register" ? "sign-up" : "sign-in"
  );
  const inviteToken = params.get("invite");
  const inviteAcceptedRef = useRef(false);
  const [inviteState, setInviteState] = useState<"idle" | "accepting" | "done">(
    inviteToken ? "accepting" : "idle"
  );

  // Don't redirect while Clerk is processing an SSO callback —
  // premature redirect unmounts <SignIn> and kills the OAuth flow
  const isHandlingCallback = window.location.hash.includes("sso-callback") ||
                             window.location.hash.includes("verify");

  // Invite-accept flow: if the user arrived with ?invite=<token> and they're
  // now signed in, attach them to the inviting org BEFORE redirecting to
  // /today. Runs once per page-load. The `inviteState` gate below prevents
  // the Redirect from firing until the accept POST resolves, so the user
  // lands on the correct org without a race.
  useEffect(() => {
    if (!user || !inviteToken || inviteAcceptedRef.current) return;
    inviteAcceptedRef.current = true;
    (async () => {
      try {
        await apiRequest("POST", "/api/organization/invitations/accept", {
          token: inviteToken,
        });
      } catch {
        /* non-fatal — user is still signed in; invite link may have expired */
      } finally {
        // Drop server-side-cached queries so the post-redirect /today
        // page fetches the inviting org, not the shadow org.
        queryClient.removeQueries({ queryKey: ["/api/auth/user"] });
        queryClient.removeQueries({ queryKey: ["/api/organization"] });
        queryClient.removeQueries({ queryKey: ["/api/organization/members"] });
        setInviteState("done");
      }
    })();
  }, [user, inviteToken]);

  // Hold the redirect while the invite is still being processed.
  if (inviteToken && inviteState !== "done") {
    // If the user isn't signed in yet, let the SignIn component render
    // normally. We only block the redirect once the ticket has landed
    // us a user and the accept POST is mid-flight.
    if (user && !isHandlingCallback) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-3">
            <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
            <p className="text-sm text-muted-foreground">Joining organization…</p>
          </div>
        </div>
      );
    }
  }

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
    <div className="relative min-h-screen flex items-center justify-center bg-background px-4 py-12 overflow-hidden">
      {/* Subtle aerial backdrop — same asset as landing hero for visual
          continuity when the user clicks "Sign in" from the landing
          page.  Heavy gradient keeps copy readable on both themes. */}
      <div
        className="absolute inset-0 -z-10 bg-cover bg-center opacity-40 dark:opacity-25"
        style={{ backgroundImage: "url(/images/aerial_view_wide_hor_0f1000c4.jpg)" }}
        aria-hidden="true"
      />
      <div
        className="absolute inset-0 -z-10 bg-gradient-to-b from-background/70 via-background/85 to-background"
        aria-hidden="true"
      />
      <div className="w-full max-w-md flex flex-col items-center gap-6">
        {/* Branding — swaps to white-label tenant name when configured */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-sm">
              <span className="text-white font-bold text-lg">{brandName.slice(0, 1)}</span>
            </div>
            <span className="text-2xl font-bold tracking-tight">{brandName}</span>
          </div>
          <p className="text-sm text-muted-foreground text-center">
            The AI-powered platform for Land Investors
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
        {/* Clerk's widget already renders "Don't have an account? Sign up"
            inside its card, so we don't duplicate it here. The mode
            toggle still exists via route/hash if needed programmatically. */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-2 -m-2 rounded-md"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          Back to home
        </Link>
      </div>
    </div>
  );
}
