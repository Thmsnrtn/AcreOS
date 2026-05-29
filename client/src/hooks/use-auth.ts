import { useClerk } from "@clerk/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/models/auth";
import { hasAnyClerkSession } from "@/lib/clerk-session-detect";
import { touchClerkSession } from "@/lib/clerk-touch";

export type AuthUser = User & { isFounder?: boolean };

// Cycle 3 / Option B: auth is decided by the server, not by Clerk-JS
// client-side state. Clerk 6.7.4 in our proxy config has a hydration bug
// where Clerk.client.sessions stays empty after ticket sign-in (see
// _cycle3-smoke-status.md). Since clerk-express on the server reads the
// __session cookie correctly and /api/auth/user is healthy, we treat a
// 200 from that endpoint as the truth of "is this browser signed in."
//
// The query is enabled whenever a Clerk session cookie exists on the
// domain (bare `__session=` OR suffixed `__session_<hash>=` — see
// clerk-session-detect.ts); we don't wait for Clerk-JS to confirm
// because its confirmation can never arrive in the broken flow. On 401
// we clear and bounce to /auth.

let authFailCount = 0;

async function fetchAppUser(): Promise<AuthUser | null> {
  let response = await fetch("/api/auth/user", { credentials: "include" });

  // Cycle 4 follow-up: /finance and /portfolio rendered blank on nav
  // because /api/auth/user 401'd on route change. Proactively refresh
  // the __session JWT via the Clerk proxy touch and retry once before
  // accepting the 401 as "logged out." This mirrors the transparent
  // 401 retry in queryClient.apiRequest.
  if (response.status === 401) {
    await touchClerkSession();
    response = await fetch("/api/auth/user", { credentials: "include" });
  }

  if (response.status === 401) {
    // Both the initial call and the touched retry came back 401 — the
    // session is dead, not refreshing. Jump authFailCount past
    // ProtectedRoute's PageLoader threshold (≥3) so the user redirects
    // to /auth on this render instead of sitting on the splash. Without
    // this, react-query's 30s staleTime traps a settled-null result and
    // the retry loop that would otherwise push the count up never fires.
    authFailCount = Math.max(authFailCount + 1, 3);
    return null;
  }

  if (response.status === 429) {
    // A 429 on the session check means the global apiLimiter throttled us
    // (a real user shouldn't trip this; misbehaving QA loops or a tab
    // that auto-refreshes too aggressively can). Treat it like an auth
    // failure rather than letting react-query throw — otherwise the SPA
    // sits on "Loading AcreOS…" forever waiting for a 200 that never
    // comes. The user is bounced to /auth and the session-purge guard
    // there clears any stale Clerk cookies before re-rendering the form.
    authFailCount = Math.max(authFailCount + 1, 3);
    return null;
  }

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  authFailCount = 0;
  return response.json();
}

// E2E test-auth: ClerkProvider is not mounted in this mode (see main.tsx), so
// useClerk() would throw. Stable per-session constant → consistent hook order.
const IS_E2E_TEST_AUTH =
  typeof window !== "undefined" &&
  (window as unknown as { __ENV__?: { E2E_TEST_AUTH?: string } }).__ENV__
    ?.E2E_TEST_AUTH === "1";

export function useAuth() {
  const { signOut } = IS_E2E_TEST_AUTH
    ? { signOut: async () => {} }
    : useClerk();
  const queryClient = useQueryClient();

  // In E2E the API-based session is authoritative; force the query on.
  const cookiePresent = IS_E2E_TEST_AUTH || hasAnyClerkSession();

  const { data: user, isLoading: userLoading, isFetched } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchAppUser,
    enabled: cookiePresent,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 2,
    retry: (failureCount) => failureCount < 2,
    retryDelay: 3000,
  });

  const isAuthed = !!user;

  // Loading states:
  // - Cookie present + query in flight → loading
  // - No cookie and no cached user → not loading, not authed
  const isLoading = cookiePresent && (userLoading || !isFetched);

  const logout = async () => {
    // F-D07: sign-out used to bounce back to /today because the steps below
    // raced — Clerk-JS resurrected the session from its device hint before
    // /api/auth/logout finished. We now (1) await the server logout so the
    // HttpOnly cookies are gone before Clerk-JS gets a chance to re-fetch,
    // (2) enumerate every cookie in document.cookie that smells like Clerk
    // and clear it (the suffixed __session_<hash> + __client_uat_<hash> +
    // __clerk_db_jwt_<hash> names that the canonical 3-name sweep missed),
    // (3) plant a "just-logged-out" sentinel that AuthPage reads to suppress
    // its bounce-to-/today branch, and (4) hard-navigate instead of letting
    // Clerk's signOut do its own redirect.
    authFailCount = 0;
    queryClient.setQueryData(["/api/auth/user"], null);
    queryClient.removeQueries({ queryKey: ["/api/auth/user"] });
    try {
      sessionStorage.setItem("acreos:just-logged-out", String(Date.now()));
      // Clear the divergence-guard one-tab cap so AuthPage will run a fresh
      // resync attempt if Clerk-JS does manage to re-resurrect us.
      sessionStorage.removeItem("acreos:auth-resync-attempted");
    } catch { /* sessionStorage unavailable */ }

    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch { /* best-effort — fall through */ }

    // Clear every Clerk-shaped cookie visible to client JS, including the
    // suffixed instance names. HttpOnly cookies remain server-cleared above.
    for (const raw of document.cookie.split(";")) {
      const name = raw.split("=")[0].trim();
      if (!name) continue;
      if (/^(__session|__client|__clerk)/.test(name)) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.acreos.io`;
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      }
    }

    try {
      await signOut({ redirectUrl: undefined });
    } catch { /* best-effort */ }

    // Hard reload to /auth so Clerk-JS reboots clean and AuthPage mounts
    // with the just-logged-out sentinel set.
    window.location.replace("/auth?_loggedout=1");
  };

  return {
    user: isAuthed ? (user ?? null) : null,
    isLoading,
    isAuthenticated: isAuthed,
    isFounder: user?.isFounder ?? false,
    authFailCount,
    logout,
  };
}
