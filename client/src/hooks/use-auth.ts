import { useUser, useClerk } from "@clerk/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/models/auth";

// Extended user type with founder status (added by server)
export type AuthUser = User & { isFounder?: boolean };

// Track consecutive auth failures to prevent redirect loops
let authFailCount = 0;
let lastAuthSuccess = 0;

async function fetchAppUser(): Promise<AuthUser | null> {
  const response = await fetch("/api/auth/user", {
    credentials: "include",
  });

  if (response.status === 401) {
    authFailCount++;
    return null;
  }

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  authFailCount = 0;
  lastAuthSuccess = Date.now();
  return response.json();
}

export function useAuth() {
  const { isSignedIn, isLoaded } = useUser();
  const { signOut } = useClerk();
  const queryClient = useQueryClient();

  // Only fetch app user when Clerk confirms the user is signed in.
  // Don't use cookie fallback for the enabled check — it causes stale
  // cache to keep isAuthed true after session death.
  const { data: user, isLoading: userLoading } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchAppUser,
    enabled: isSignedIn === true,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 2, // 2 min GC — short enough to not persist stale sessions
    retry: (failureCount) => failureCount < 2,
    retryDelay: 3000,
  });

  // Auth state: require BOTH Clerk session AND app user.
  // Previous OR logic (isSignedIn || user) kept isAuthed true from stale cache.
  const isAuthed = !!(isSignedIn && user);

  const logout = () => {
    authFailCount = 0;
    lastAuthSuccess = 0;
    queryClient.setQueryData(["/api/auth/user"], null);
    queryClient.removeQueries({ queryKey: ["/api/auth/user"] });
    // Clear session cookies — use .acreos.io (with dot) for subdomain coverage
    document.cookie = "__session=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.acreos.io";
    document.cookie = "__session=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    document.cookie = "__client_uat=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.acreos.io";
    document.cookie = "__client_uat=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    signOut({ redirectUrl: "/auth" });
  };

  return {
    user: isAuthed ? (user ?? null) : null,
    isLoading: !isLoaded || (isSignedIn === true && userLoading),
    isAuthenticated: isAuthed,
    isFounder: user?.isFounder ?? false,
    authFailCount,
    logout,
  };
}
