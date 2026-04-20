import { useClerk } from "@clerk/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/models/auth";

export type AuthUser = User & { isFounder?: boolean };

// Cycle 3 / Option B: auth is decided by the server, not by Clerk-JS
// client-side state. Clerk 6.7.4 in our proxy config has a hydration bug
// where Clerk.client.sessions stays empty after ticket sign-in (see
// _cycle3-smoke-status.md). Since clerk-express on the server reads the
// __session cookie correctly and /api/auth/user is healthy, we treat a
// 200 from that endpoint as the truth of "is this browser signed in."
//
// The query is enabled whenever a __session cookie exists on the domain;
// we don't wait for Clerk-JS to confirm because its confirmation can
// never arrive in the broken flow. On 401 we clear and bounce to /auth.

let authFailCount = 0;

function hasSessionCookie(): boolean {
  if (typeof document === "undefined") return false;
  return /(^|;\s*)__session=/.test(document.cookie);
}

async function fetchAppUser(): Promise<AuthUser | null> {
  const response = await fetch("/api/auth/user", { credentials: "include" });

  if (response.status === 401) {
    authFailCount++;
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

  const cookiePresent = hasSessionCookie();

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
    document.cookie = "__session=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.acreos.io";
    document.cookie = "__session=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    document.cookie = "__client_uat=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.acreos.io";
    document.cookie = "__client_uat=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
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
