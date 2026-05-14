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

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  authFailCount = 0;
  return response.json();
}

export function useAuth() {
  const { signOut } = useClerk();
  const queryClient = useQueryClient();

  const cookiePresent = hasAnyClerkSession();

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

  const logout = () => {
    authFailCount = 0;
    queryClient.setQueryData(["/api/auth/user"], null);
    queryClient.removeQueries({ queryKey: ["/api/auth/user"] });
    // Clerk's instance cookies are suffixed (`__session_<hash>`, `__client_uat_<hash>`)
    // and HttpOnly — client JS can't enumerate or clear them. Ask the server to
    // clearCookie() every one it can see on the request, then fall through to
    // Clerk's own sign-out which handles the non-HttpOnly names.
    void fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    }).catch(() => { /* best-effort */ });
    // Also clear the canonical (non-suffixed) names from the client for old
    // sessions that predate the suffixed-cookie rollout.
    for (const name of ["__session", "__client_uat", "__client"]) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.acreos.io`;
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
    signOut({ redirectUrl: "/auth" });
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
