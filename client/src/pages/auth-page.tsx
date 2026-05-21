import { SignIn, SignUp, useClerk, useUser } from "@clerk/react";
import { Link, Redirect } from "wouter";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useBrandName } from "@/hooks/use-white-label";
import { ArrowLeft } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { usePageMeta } from "@/hooks/use-document-title";
import { hasAnyClerkCookie } from "@/lib/clerk-session-detect";

export default function AuthPage() {
  usePageMeta(
    "Sign in",
    "Sign in to AcreOS — the operating system property investors use to manage leads, properties, deals, notes, and rehabs in one place."
  );
  const { user, isLoading, authFailCount } = useAuth();
  const clerk = useClerk();
  const { isLoaded: clerkLoaded, isSignedIn: clerkSignedIn } = useUser();

  // Loader stall guard: if useAuth.isLoading stays true longer than 4s
  // (slow network, retried fetch, stuck touchClerkSession, etc.) the page
  // would otherwise wedge on the "Signing you in…" splash with no recovery
  // path. After the timer fires we treat the page as if isLoading is false
  // so the divergence / dead-session guards downstream can run and the user
  // either lands on the form, the resync CTA, or the redirect path —
  // never a blank loader.
  const [loaderStalled, setLoaderStalled] = useState(false);
  useEffect(() => {
    if (!isLoading) {
      setLoaderStalled(false);
      return;
    }
    const t = setTimeout(() => setLoaderStalled(true), 4000);
    return () => clearTimeout(t);
  }, [isLoading]);
  const effectiveIsLoading = isLoading && !loaderStalled;

  // Dead-session guard: a Clerk cookie still in the jar after the server
  // has 401'd /api/auth/user means the JWT can't be refreshed but Clerk-JS
  // still believes the user is signed in. Without intervention the SignIn
  // widget's fallbackRedirectUrl bounces us straight to /today, which then
  // ProtectedRoute-bounces back here, looping forever on the splash. Clear
  // the cookies + hard-reload so Clerk-JS re-initializes with no session.
  const isDeadSession =
    !effectiveIsLoading && !user && authFailCount >= 3 && hasAnyClerkCookie();
  // Divergence guard: Clerk-JS reports signed-in (because of __client_uat /
  // device hint persistence) but the server says 401. In this state the
  // <SignUp>/<SignIn> Clerk components render NOTHING (they hide themselves
  // when a user is already signed in), and AuthPage doesn't redirect to
  // /today either (server user is null). The user sees an empty page with
  // just the logo + "Back to home." Detect the mismatch and force a Clerk
  // signOut so the widget will render the form on the next render.
  const isClerkServerDivergent =
    !effectiveIsLoading && !user && clerkLoaded === true && clerkSignedIn === true;
  const purgingRef = useRef(false);
  const resyncingRef = useRef(false);
  useEffect(() => {
    if (!isDeadSession || purgingRef.current) return;
    purgingRef.current = true;
    void (async () => {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          credentials: "include",
        });
      } catch {
        /* best effort */
      }
      for (const name of ["__session", "__client_uat", "__client"]) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.acreos.io`;
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      }
      // Hard reload (not wouter navigate) so Clerk-JS reboots from scratch
      // without the stale __client_uat that triggers the false-positive
      // signed-in state.
      window.location.replace("/auth" + window.location.search);
    })();
  }, [isDeadSession]);
  // Once-per-tab cap on the auto-resync. Clerk-JS can re-resurrect a session
  // from device hints stored at Clerk's backend even after a successful
  // signOut + cookie clear, so if we naively keep retrying we end up in a
  // reload loop. After the first attempt, fall through to the manual-resync
  // CTA below.
  const RESYNC_ATTEMPTED_KEY = "acreos:auth-resync-attempted";
  const [resyncBlocked, setResyncBlocked] = useState(false);
  useEffect(() => {
    if (!isClerkServerDivergent) return;
    if (resyncingRef.current) return;
    if (sessionStorage.getItem(RESYNC_ATTEMPTED_KEY)) {
      // Already tried once this tab — render the manual CTA instead of looping.
      setResyncBlocked(true);
      return;
    }
    resyncingRef.current = true;
    sessionStorage.setItem(RESYNC_ATTEMPTED_KEY, "1");
    void (async () => {
      try {
        await clerk.signOut({ redirectUrl: undefined });
      } catch {
        /* best effort — fall through to reload */
      }
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          credentials: "include",
        });
      } catch {
        /* best effort */
      }
      // Hard reload so the SignUp/SignIn widget mounts with a fresh Clerk-JS
      // state that matches what the server sees (signed-out). Without the
      // reload, @clerk/react keeps the now-stale "signed in" snapshot in
      // memory and continues to hide the form.
      window.location.replace("/auth" + window.location.search);
    })();
  }, [isClerkServerDivergent, clerk]);

  // Clear the once-per-tab flag only when the server confirms a signed-in
  // user. Earlier we also cleared it when no Clerk cookie was present, but
  // that fires in the brief window between our signOut+reload and Clerk-JS
  // resurrecting the device session — letting the divergence cap reset and
  // the loop continue. Tying the clear to a real server-confirmed sign-in
  // means the cap only resets after a genuine successful auth.
  useEffect(() => {
    if (user) {
      sessionStorage.removeItem(RESYNC_ATTEMPTED_KEY);
    }
  }, [user]);
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
        <div
          className="min-h-screen flex items-center justify-center bg-background"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-col items-center gap-3">
            <div
              className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full"
              aria-hidden="true"
            />
            <p className="text-sm text-muted-foreground">Joining organization…</p>
          </div>
        </div>
      );
    }
  }

  // F-D07: when the user explicitly signed out, the logout flow plants
  // a "just-logged-out" sentinel and hard-navigates here with ?_loggedout=1.
  // Clerk-JS occasionally resurrects the session from its device hint a
  // beat later, which would otherwise re-trip the bounce-to-/today branch
  // below and trap the user back in the app they just left. Honor the
  // sentinel for 30 seconds so the resurrection can't outrun an intentional
  // logout. After 30s the sentinel is treated as stale (user may have
  // wandered off and come back genuinely wanting to sign in).
  const loggedOutParam = params.has("_loggedout");
  let justLoggedOut = false;
  try {
    const ts = Number(sessionStorage.getItem("acreos:just-logged-out") || 0);
    justLoggedOut = ts > 0 && Date.now() - ts < 30_000;
  } catch { /* sessionStorage unavailable */ }
  const suppressBounce = loggedOutParam || justLoggedOut;

  // Option B: server-backed auth is the truth. If /api/auth/user came
  // back with a user, we're signed in — send to dashboard. UNLESS the
  // user just explicitly logged out (see suppressBounce above).
  if (user && !isHandlingCallback && !suppressBounce) {
    return <Redirect to="/today" />;
  }

  // If we're showing the form because of just-logged-out and Clerk-JS has
  // re-resurrected the user, fire another signOut to clear the device hint.
  // (Async; we still render the form below so the user can sign in fresh.)
  if (user && suppressBounce && clerk) {
    try { void clerk.signOut(); } catch { /* best-effort */ }
  }

  // Dead session being purged — show a loader while we hard-reload below.
  if (isDeadSession || (isClerkServerDivergent && !resyncBlocked)) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-background"
        role="status"
        aria-live="polite"
      >
        <div
          className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full"
          aria-hidden="true"
        />
        <span className="sr-only">Refreshing session…</span>
      </div>
    );
  }

  // Auto-resync exhausted its single attempt and Clerk-JS keeps reviving a
  // session the server won't accept. Show a manual CTA so the user can
  // explicitly sign out (clears Clerk-side state) and try signing in again.
  if (isClerkServerDivergent && resyncBlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="max-w-md w-full text-center space-y-5">
          <h1 className="text-xl font-semibold tracking-tight">
            Your session expired
          </h1>
          <p className="text-sm text-muted-foreground">
            We couldn't refresh your sign-in. Sign out and back in to continue.
          </p>
          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={async () => {
                sessionStorage.removeItem(RESYNC_ATTEMPTED_KEY);
                try {
                  await clerk.signOut({ redirectUrl: "/auth" });
                } catch {
                  window.location.replace("/auth");
                }
              }}
              className="inline-flex items-center justify-center min-h-11 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold shadow-sm hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              Sign out and continue
            </button>
            <Link
              href="/"
              className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              Back to home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Still resolving the server-side auth check after ticket/OAuth — loader.
  // Capped at 4s by the loaderStalled timer above so we never wedge here.
  if (effectiveIsLoading && !isHandlingCallback) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-background"
        role="status"
        aria-live="polite"
      >
        <div
          className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full"
          aria-hidden="true"
        />
        <span className="sr-only">Signing you in…</span>
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
        <h1 className="sr-only">
          {mode === "sign-up" ? `Create an ${brandName} account` : `Sign in to ${brandName}`}
        </h1>
        {/* Branding — swaps to white-label tenant name when configured */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div
              className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-sm"
              aria-hidden="true"
            >
              <span className="text-white font-bold text-lg">{brandName.slice(0, 1)}</span>
            </div>
            <span className="text-2xl font-bold tracking-tight" aria-hidden="true">{brandName}</span>
          </div>
          <p className="text-sm text-muted-foreground text-center">
            The operating system for property investors
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
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-2 -m-2 rounded-md min-h-11"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          Back to home
        </Link>
      </div>
    </div>
  );
}
